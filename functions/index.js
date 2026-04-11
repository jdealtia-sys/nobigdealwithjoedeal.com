/**
 * Firebase Cloud Functions — NBD Pro API Proxy
 *
 * Keeps the Anthropic API key server-side (in Firebase secrets).
 * Client calls this function instead of hitting Anthropic directly.
 *
 * SETUP:
 *   1. cd functions && npm install
 *   2. firebase functions:secrets:set ANTHROPIC_API_KEY
 *      (paste your sk-ant-... key when prompted)
 *   3. firebase deploy --only functions
 *
 * CLIENT USAGE:
 *   const result = await fetch('https://us-central1-nobigdeal-pro.cloudfunctions.net/claudeProxy', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer <firebase-id-token>' },
 *     body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, messages: [...] })
 *   });
 */

const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const Stripe = require('stripe');

admin.initializeApp();

const { enforceRateLimit, httpRateLimit, clientIp } = require('./rate-limit');

// Secrets stored in Firebase Secret Manager
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const STRIPE_PRICE_FOUNDATION = defineSecret('STRIPE_PRICE_FOUNDATION');
const STRIPE_PRICE_PROFESSIONAL = defineSecret('STRIPE_PRICE_PROFESSIONAL');

// CORS origins — exact match, no startsWith, no wildcards.
const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

// Shared helper: verify Firebase auth + optional admin role via custom claims.
async function requireAuth(req, { adminOnly = false } = {}) {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return { error: { status: 401, body: { error: 'Missing authorization token' } } };
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken, true);
  } catch (e) {
    if (e.code === 'auth/id-token-expired') {
      return { error: { status: 401, body: { error: 'Token expired — please re-authenticate' } } };
    }
    return { error: { status: 401, body: { error: 'Invalid token' } } };
  }
  if (adminOnly && decoded.role !== 'admin') {
    return { error: { status: 403, body: { error: 'Admin access required' } } };
  }
  return { decoded };
}

// Anthropic model allowlist — Opus removed; too expensive to expose to end users.
const ALLOWED_CLAUDE_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-20250514',
]);
const CLAUDE_MAX_TOKENS_CAP = 1024;
const CLAUDE_DAILY_TOKEN_BUDGET = 200000; // per uid per calendar day
const CLAUDE_PER_MIN_LIMIT = 20;

exports.claudeProxy = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: true,
    maxInstances: 100,
    concurrency: 80,
    minInstances: 0,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const authResult = await requireAuth(req);
    if (authResult.error) { res.status(authResult.error.status).json(authResult.error.body); return; }
    const { decoded } = authResult;

    try {
      // Subscription gate — server-trusted Firestore doc written only by Stripe webhook.
      const subSnap = await admin.firestore().doc(`subscriptions/${decoded.uid}`).get();
      const sub = subSnap.exists ? subSnap.data() : null;
      const isAdmin = decoded.role === 'admin';
      const hasPaidPlan = sub && sub.plan && sub.plan !== 'free' && sub.status === 'active';
      if (!isAdmin && !hasPaidPlan) {
        res.status(403).json({ error: 'AI features require an active paid subscription.' });
        return;
      }

      // Per-uid rate limit (admin-SDK-only Firestore doc so clients cannot reset it).
      try {
        await enforceRateLimit('claudeProxy:uid', decoded.uid, CLAUDE_PER_MIN_LIMIT, 60_000);
      } catch (e) {
        if (e.rateLimited) { res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' }); return; }
        throw e;
      }

      // Per-day token budget (rolling 24h, tracked via api_usage sum).
      const dayAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 86_400_000);
      const usageSnap = await admin.firestore().collection('api_usage')
        .where('uid', '==', decoded.uid)
        .where('timestamp', '>', dayAgo)
        .get();
      let consumed = 0;
      usageSnap.forEach(d => {
        const r = d.data();
        consumed += (r.inputTokens || 0) + (r.outputTokens || 0);
      });
      if (!isAdmin && consumed >= CLAUDE_DAILY_TOKEN_BUDGET) {
        res.status(429).json({ error: 'Daily AI budget exceeded. Resets in 24 hours.' });
        return;
      }

      // Validate inputs.
      const { model, max_tokens, messages, system, temperature } = req.body || {};
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'messages array required' });
        return;
      }
      const safeModel = ALLOWED_CLAUDE_MODELS.has(model) ? model : 'claude-haiku-4-5-20251001';
      const safeMaxTokens = Math.min(Number(max_tokens) || 500, CLAUDE_MAX_TOKENS_CAP);

      const anthropicBody = { model: safeModel, max_tokens: safeMaxTokens, messages };
      if (typeof system === 'string') anthropicBody.system = system.slice(0, 4000);
      if (typeof temperature === 'number') anthropicBody.temperature = Math.max(0, Math.min(1, temperature));

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': ANTHROPIC_API_KEY.value(),
        },
        body: JSON.stringify(anthropicBody),
      });

      const data = await response.json();
      if (!response.ok) { res.status(response.status).json(data); return; }

      try {
        await admin.firestore().collection('api_usage').add({
          uid: decoded.uid,
          model: anthropicBody.model,
          inputTokens: data.usage?.input_tokens || 0,
          outputTokens: data.usage?.output_tokens || 0,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        logger.warn('api_usage logging failed', { uid: decoded.uid, err: e.message });
      }

      res.json(data);
    } catch (e) {
      logger.error('claudeProxy error', { uid: decoded?.uid, err: e.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * Creates a Stripe Checkout Session for subscription
 * POST /createCheckoutSession
 * Body: { plan: 'foundation' | 'professional' }
 * Headers: Authorization: Bearer <firebase-id-token>
 */
exports.createCheckoutSession = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [STRIPE_SECRET_KEY, STRIPE_PRICE_FOUNDATION, STRIPE_PRICE_PROFESSIONAL],
    enforceAppCheck: true,
    maxInstances: 20,
    concurrency: 40,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Per-IP rate limit — 10 checkout sessions / hour from a single IP.
    if (!(await httpRateLimit(req, res, 'createCheckoutSession:ip', 10, 3_600_000))) return;

    const authResult = await requireAuth(req);
    if (authResult.error) { res.status(authResult.error.status).json(authResult.error.body); return; }
    const { decoded } = authResult;
    if (!decoded.email) { res.status(401).json({ error: 'Account has no email' }); return; }
    if (!decoded.email_verified) {
      res.status(403).json({ error: 'Please verify your email before starting a paid subscription.' });
      return;
    }

    try {
      const { plan } = req.body;

      // Validate plan
      if (!['foundation', 'professional'].includes(plan)) {
        res.status(400).json({ error: 'Invalid plan. Must be "foundation" or "professional".' });
        return;
      }
      // Remove the "free subscription while checkout is open" loophole — any prior
      // client-side self-write to subscriptions gets overwritten on webhook return
      // anyway, but the rules now block client writes entirely.

      // Get price ID based on plan
      const priceId = plan === 'foundation'
        ? STRIPE_PRICE_FOUNDATION.value()
        : STRIPE_PRICE_PROFESSIONAL.value();

      // Initialize Stripe
      const stripe = new Stripe(STRIPE_SECRET_KEY.value());

      // Create Checkout Session
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: `https://nobigdealwithjoedeal.com/pro/stripe-success.html?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
        cancel_url: 'https://nobigdealwithjoedeal.com/pro/landing.html?cancelled=true',
        client_reference_id: decoded.uid,
        customer_email: decoded.email,
        metadata: {
          firebaseUid: decoded.uid,
          plan,
        },
      });

      console.log(`Checkout session created: ${session.id} for user ${decoded.uid} (plan: ${plan})`);

      res.json({ url: session.url });

    } catch (e) {
      console.error('Checkout session creation error:', e);
      if (e.code === 'auth/id-token-expired') {
        res.status(401).json({ error: 'Token expired — please re-authenticate' });
      } else {
        res.status(500).json({ error: 'Failed to create checkout session' });
      }
    }
  }
);

/**
 * Handles Stripe webhook events
 * POST /stripeWebhook
 * No auth required (verifies Stripe signature instead)
 */
exports.stripeWebhook = onRequest(
  {
    cors: false, // Webhook should not use CORS
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
    maxInstances: 10,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY.value());
    const sig = req.headers['stripe-signature'];
    const webhookSecret = STRIPE_WEBHOOK_SECRET.value();

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (e) {
      console.error('Webhook signature verification failed:', e.message);
      res.status(400).json({ error: 'Webhook signature verification failed' });
      return;
    }

    try {
      const db = admin.firestore();

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const uid = session.client_reference_id;
          const customerId = session.customer;

          if (!uid) {
            console.warn('checkout.session.completed: no client_reference_id');
            break;
          }

          await db.doc(`subscriptions/${uid}`).set(
            {
              plan: session.metadata?.plan || 'unknown',
              status: 'active',
              stripeSessionId: session.id,
              stripeCustomerId: customerId,
              stripeSubscriptionId: session.subscription || null,
              source: 'checkout',
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          console.log(`Subscription activated for user ${uid} (session: ${session.id})`);
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object;
          const customerId = subscription.customer;

          // Find user by customer ID
          const snapshot = await db
            .collection('subscriptions')
            .where('stripeCustomerId', '==', customerId)
            .limit(1)
            .get();

          if (snapshot.empty) {
            console.warn(`customer.subscription.updated: no user found for customer ${customerId}`);
            break;
          }

          const doc = snapshot.docs[0];
          const uid = doc.id;

          await doc.ref.update({
            status: subscription.status,
            stripeSubscriptionId: subscription.id,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          console.log(`Subscription updated for user ${uid} (status: ${subscription.status})`);
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const customerId = subscription.customer;

          // Find user by customer ID
          const snapshot = await db
            .collection('subscriptions')
            .where('stripeCustomerId', '==', customerId)
            .limit(1)
            .get();

          if (snapshot.empty) {
            console.warn(`customer.subscription.deleted: no user found for customer ${customerId}`);
            break;
          }

          const doc = snapshot.docs[0];
          const uid = doc.id;

          await doc.ref.update({
            status: 'cancelled',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          console.log(`Subscription cancelled for user ${uid}`);
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object;
          const customerId = invoice.customer;

          // Find user by customer ID
          const snapshot = await db
            .collection('subscriptions')
            .where('stripeCustomerId', '==', customerId)
            .limit(1)
            .get();

          if (snapshot.empty) {
            console.warn(`invoice.payment_failed: no user found for customer ${customerId}`);
            break;
          }

          const doc = snapshot.docs[0];
          const uid = doc.id;

          await doc.ref.update({
            status: 'past_due',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          console.log(`Payment failed for user ${uid} (invoice: ${invoice.id})`);
          break;
        }

        default:
          console.log(`Unhandled webhook event type: ${event.type}`);
      }

      res.json({ received: true });

    } catch (e) {
      console.error('Webhook processing error:', e);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

/**
 * Creates a Stripe billing portal session for customer to manage subscription
 * POST /createCustomerPortalSession
 * Headers: Authorization: Bearer <firebase-id-token>
 */
exports.createCustomerPortalSession = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [STRIPE_SECRET_KEY],
    enforceAppCheck: true,
    maxInstances: 20,
    concurrency: 40,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    if (!(await httpRateLimit(req, res, 'createCustomerPortalSession:ip', 20, 3_600_000))) return;

    const authResult = await requireAuth(req);
    if (authResult.error) { res.status(authResult.error.status).json(authResult.error.body); return; }
    const { decoded } = authResult;

    try {
      const db = admin.firestore();
      const subscriptionSnap = await db.doc(`subscriptions/${decoded.uid}`).get();

      if (!subscriptionSnap.exists) {
        res.status(404).json({ error: 'No subscription found for this user' });
        return;
      }

      const customerId = subscriptionSnap.data().stripeCustomerId;

      if (!customerId) {
        res.status(400).json({ error: 'No Stripe customer associated with this subscription' });
        return;
      }

      const stripe = new Stripe(STRIPE_SECRET_KEY.value());

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: 'https://nobigdealwithjoedeal.com/pro/settings',
      });

      console.log(`Billing portal session created for user ${decoded.uid}`);

      res.json({ url: portalSession.url });

    } catch (e) {
      console.error('Billing portal session creation error:', e);
      if (e.code === 'auth/id-token-expired') {
        res.status(401).json({ error: 'Token expired — please re-authenticate' });
      } else {
        res.status(500).json({ error: 'Failed to create billing portal session' });
      }
    }
  }
);

/**
 * Retrieves current subscription status for a user
 * GET /getSubscriptionStatus
 * Headers: Authorization: Bearer <firebase-id-token>
 */
exports.getSubscriptionStatus = onRequest(
  {
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    maxInstances: 50,
    concurrency: 80,
    timeoutSeconds: 10,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const authResult = await requireAuth(req);
    if (authResult.error) { res.status(authResult.error.status).json(authResult.error.body); return; }
    const { decoded } = authResult;

    try {
      const db = admin.firestore();
      const subscriptionSnap = await db.doc(`subscriptions/${decoded.uid}`).get();

      if (!subscriptionSnap.exists) {
        res.json({ status: 'none', plan: null });
        return;
      }

      const data = subscriptionSnap.data();
      res.json({
        status: data.status,
        plan: data.plan,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });

    } catch (e) {
      console.error('Get subscription status error:', e);
      if (e.code === 'auth/id-token-expired') {
        res.status(401).json({ error: 'Token expired — please re-authenticate' });
      } else {
        res.status(500).json({ error: 'Failed to retrieve subscription status' });
      }
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// STORAGE CORS + IMAGE PROXY
// ═══════════════════════════════════════════════════════════════

/**
 * One-time function to set CORS on the Firebase Storage bucket.
 * Call once via: POST /setStorageCors with Authorization header
 */
exports.setStorageCors = onRequest(
  {
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    maxInstances: 1,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    // Admin-only — uses custom claims, not a self-owned Firestore role doc.
    const authResult = await requireAuth(req, { adminOnly: true });
    if (authResult.error) { res.status(authResult.error.status).json(authResult.error.body); return; }
    try {
      const bucket = admin.storage().bucket();
      await bucket.setCorsConfiguration([
        {
          origin: [
            'https://nobigdealwithjoedeal.com',
            'https://www.nobigdealwithjoedeal.com',
            'https://nobigdeal-pro.web.app',
          ],
          method: ['GET', 'HEAD', 'OPTIONS'],
          maxAgeSeconds: 3600,
          responseHeader: ['Content-Type', 'Authorization', 'Content-Length', 'User-Agent'],
        },
      ]);
      console.log('Storage CORS configuration updated successfully');
      res.json({ success: true, message: 'CORS configuration applied to storage bucket' });
    } catch (e) {
      console.error('setCors error:', e);
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * Image proxy — bypasses CORS for loading photos into the editor canvas.
 * GET /imageProxy?path=photos/filename.jpg
 */
exports.imageProxy = onRequest(
  {
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    maxInstances: 50,
    concurrency: 80,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'GET') { res.status(405).end(); return; }

    const authResult = await requireAuth(req);
    if (authResult.error) { res.status(authResult.error.status).json(authResult.error.body); return; }
    const { decoded } = authResult;

    // Per-IP and per-uid rate limit — imageProxy is a bandwidth amplifier.
    if (!(await httpRateLimit(req, res, 'imageProxy:ip', 120, 60_000))) return;
    try {
      await enforceRateLimit('imageProxy:uid', decoded.uid, 120, 60_000);
    } catch (e) {
      if (e.rateLimited) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
      throw e;
    }

    // Normalize and validate path.
    let filePath = req.query.path;
    if (typeof filePath !== 'string') { res.status(400).json({ error: 'Invalid path' }); return; }
    // Reject encoded traversal variants + null bytes + backslashes + semicolons.
    if (/%2e|\0|\\|;|\.\./.test(filePath) || filePath.includes('//')) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    // Allowed patterns — owner-scoped only. Caller's uid MUST appear as the 2nd path segment.
    // photos/<uid>/<file>, portals/<uid>/<file>, galleries/<uid>/<file>, reports/<uid>/<file>.
    const match = filePath.match(/^(photos|portals|galleries|reports|docs)\/([^/]+)\/(.+)$/);
    if (!match) { res.status(400).json({ error: 'Invalid path shape' }); return; }
    const [, bucketKey, ownerUid] = match;

    const isOwner = ownerUid === decoded.uid;
    const isAdmin = decoded.role === 'admin';

    // If not owner or admin, allow only if caller is a manager in the same company.
    let allowed = isOwner || isAdmin;
    if (!allowed) {
      try {
        const repSnap = await admin.firestore().doc(`reps/${decoded.uid}`).get();
        const ownerRepSnap = await admin.firestore().doc(`reps/${ownerUid}`).get();
        if (repSnap.exists && ownerRepSnap.exists
            && repSnap.data().role === 'manager'
            && repSnap.data().companyId
            && repSnap.data().companyId === ownerRepSnap.data().companyId) {
          allowed = true;
        }
      } catch (e) { /* fall through */ }
    }
    if (!allowed) { res.status(403).json({ error: 'Forbidden' }); return; }

    try {
      const bucket = admin.storage().bucket();
      const file = bucket.file(filePath);
      const [exists] = await file.exists();
      if (!exists) { res.status(404).json({ error: 'File not found' }); return; }

      const [metadata] = await file.getMetadata();
      res.set('Content-Type', metadata.contentType || 'application/octet-stream');
      res.set('Cache-Control', 'private, max-age=300');
      res.set('X-Content-Type-Options', 'nosniff');

      file.createReadStream().pipe(res);
    } catch (e) {
      logger.error('imageProxy error', { uid: decoded.uid, err: e.message });
      res.status(500).json({ error: 'Failed to proxy image' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// PUSH NOTIFICATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const pushFunctions = require('./push-functions');
Object.assign(exports, pushFunctions);

// ═══════════════════════════════════════════════════════════════
// EMAIL FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const emailFunctions = require('./email-functions');
Object.assign(exports, emailFunctions);

// ═══════════════════════════════════════════════════════════════
// SMS FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const smsFunctions = require('./sms-functions');
Object.assign(exports, smsFunctions);

// ═══════════════════════════════════════════════════════════════
// INVOICE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Creates a Stripe Payment Link for an invoice
 * POST /createStripePaymentLink
 * Body: { invoiceId: string }
 * Headers: Authorization: Bearer <firebase-id-token>
 * Returns: { url: string, paymentLinkId: string }
 */
exports.createStripePaymentLink = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [STRIPE_SECRET_KEY],
    enforceAppCheck: true,
    maxInstances: 20,
    concurrency: 40,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    if (!(await httpRateLimit(req, res, 'createStripePaymentLink:ip', 30, 60_000))) return;

    const authResult = await requireAuth(req);
    if (authResult.error) { res.status(authResult.error.status).json(authResult.error.body); return; }
    const { decoded } = authResult;

    try {
      const { invoiceId } = req.body;

      if (!invoiceId) {
        res.status(400).json({ error: 'invoiceId required' });
        return;
      }

      // Fetch invoice from Firestore
      const db = admin.firestore();
      const invoiceSnap = await db.collection('invoices').doc(invoiceId).get();

      if (!invoiceSnap.exists) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }

      const invoice = invoiceSnap.data();

      // Validate ownership
      if (invoice.createdBy !== decoded.uid) {
        res.status(403).json({ error: 'Unauthorized' });
        return;
      }

      // Recompute totals server-side from canonical product prices where possible.
      // For items with a productId, look up the catalog; otherwise use the
      // client-provided total but enforce sanity bounds to block $0.01/absurd values.
      const MIN_CENTS = 100;            // $1.00 minimum per line
      const MAX_CENTS = 10_000_000;     // $100k maximum per line
      const lineItems = [];
      for (const item of (invoice.items || [])) {
        let cents;
        if (item.productId) {
          const prodSnap = await db.doc(`products/${item.productId}`).get();
          if (prodSnap.exists && prodSnap.data().userId === decoded.uid) {
            const unit = prodSnap.data().unitPrice;
            const qty = Math.max(1, Number(item.quantity) || 1);
            if (typeof unit === 'number' && unit > 0) {
              cents = Math.round(unit * qty * 100);
            }
          }
        }
        if (cents === undefined) {
          cents = Math.round(Number(item.total || 0) * 100);
        }
        if (!Number.isFinite(cents) || cents < MIN_CENTS || cents > MAX_CENTS) {
          res.status(400).json({ error: 'Line item amount out of allowed range' });
          return;
        }
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: String(item.description || 'Invoice line item').slice(0, 250),
              description: `Invoice ${invoiceId}`,
            },
            unit_amount: cents,
          },
          quantity: 1,
        });
      }
      if (lineItems.length === 0) {
        res.status(400).json({ error: 'Invoice has no line items' });
        return;
      }

      const stripe = new Stripe(STRIPE_SECRET_KEY.value());
      const paymentLink = await stripe.paymentLinks.create({
        line_items: lineItems,
        metadata: { invoiceId: String(invoiceId), userId: decoded.uid },
        payment_intent_data: {
          metadata: { invoiceId: String(invoiceId), userId: decoded.uid },
        },
        after_completion: {
          type: 'redirect',
          redirect: {
            url: `https://nobigdealwithjoedeal.com/pro/invoice-success.html?invoiceId=${encodeURIComponent(invoiceId)}`,
          },
        },
      });

      logger.info('payment_link_created', { invoiceId, uid: decoded.uid, paymentLinkId: paymentLink.id });
      res.json({ url: paymentLink.url, paymentLinkId: paymentLink.id });

    } catch (e) {
      logger.error('createStripePaymentLink error', { uid: decoded.uid, err: e.message });
      res.status(500).json({ error: 'Failed to create payment link' });
    }
  }
);

/**
 * Handles Stripe webhook events for invoice payments
 * POST /invoiceWebhook
 * No auth required (verifies Stripe signature instead)
 * Handles: payment_intent.succeeded → marks invoice as paid
 */
exports.invoiceWebhook = onRequest(
  {
    cors: false, // Webhook should not use CORS
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
    maxInstances: 5,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      const signature = req.headers['stripe-signature'] || '';
      const stripe = new Stripe(STRIPE_SECRET_KEY.value());

      // Verify Stripe signature
      let event;
      try {
        event = stripe.webhooks.constructEvent(
          req.rawBody || req.body,
          signature,
          STRIPE_WEBHOOK_SECRET.value()
        );
      } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        res.status(400).json({ error: 'Invalid signature' });
        return;
      }

      // Handle payment_intent.succeeded event
      if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const metadata = paymentIntent.metadata || {};
        const invoiceId = metadata.invoiceId;
        const claimedUserId = metadata.userId;

        if (invoiceId) {
          const db = admin.firestore();
          const invRef = db.collection('invoices').doc(invoiceId);
          const invSnap = await invRef.get();
          if (!invSnap.exists) {
            logger.warn('invoiceWebhook: invoice not found', { invoiceId });
          } else if (claimedUserId && invSnap.data().createdBy !== claimedUserId) {
            // Metadata tampering — record the event but do not mark paid.
            logger.error('invoiceWebhook: metadata userId mismatch', {
              invoiceId,
              claimedUserId,
              actualCreatedBy: invSnap.data().createdBy,
            });
          } else {
            await invRef.update({
              status: 'paid',
              paidAt: admin.firestore.FieldValue.serverTimestamp(),
              stripePaymentIntentId: paymentIntent.id,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            logger.info('invoice_paid', { invoiceId });
          }
        }
      }

      res.json({ received: true });

    } catch (e) {
      console.error('invoiceWebhook error:', e);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);


// ── Verification Functions (SMS OTP + Lead Notifications) ──
const verifyFunctions = require('./verify-functions');
Object.assign(exports, verifyFunctions);

// ── Audit log triggers ──
const auditLog = require('./audit-log');
Object.assign(exports, auditLog);

// ═══════════════════════════════════════════════════════════════════════════
// publicVisualizerAI — Public homeowner visualizer endpoint.
//
// The marketing-site visualizer.html calls this to get an AI-generated
// assessment of a home photo. Homeowners are NOT authenticated, so we
// cannot use the claudeProxy subscription gate. Instead:
//   - enforceAppCheck: true (blocks curl/bot replay of the reCAPTCHA token)
//   - per-IP rolling-window rate limit: 5 requests / hour
//   - model locked to Haiku (cheapest tier)
//   - max_tokens hard-capped at 800
//   - system prompt is server-owned, client cannot inject one
//   - image payload must be a base64-encoded JPEG/PNG under 1.5 MB
// ═══════════════════════════════════════════════════════════════════════════
const VISUALIZER_MAX_B64_BYTES = Math.round(1.5 * 1024 * 1024 * 4 / 3); // ~2 MB base64
const VISUALIZER_SYSTEM_PROMPT = "You are Joe Deal, owner of No Big Deal Home Solutions in Greater Cincinnati, OH. You're a roofing and exterior contractor — honest, plain-spoken, helpful. A homeowner has uploaded a photo of their house and selected exterior options they want to visualize. Give them: (1) a practical assessment of what their home currently has (roof, siding, gutters you can see), (2) specific honest feedback on how their chosen options would look on THIS house, (3) any recommendations. Keep it conversational, 150-200 words, then a short visual description prefixed with 'CANVAS:' that describes colors and materials as hex values for the canvas overlay.";

exports.publicVisualizerAI = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: true,
    maxInstances: 10,
    concurrency: 20,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Per-IP cap — 5 visualizer calls / hour from a single IP. Each call is
    // a ~$0.01 Haiku request; 5/hour caps cost per IP at ~$0.05/hour worst case.
    if (!(await httpRateLimit(req, res, 'publicVisualizerAI:ip', 5, 3_600_000))) return;

    try {
      const { imageBase64, mediaType, selectionsText, notes } = req.body || {};

      if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
        res.status(400).json({ error: 'imageBase64 required' });
        return;
      }
      if (imageBase64.length > VISUALIZER_MAX_B64_BYTES) {
        res.status(413).json({ error: 'Image too large (max 1.5 MB)' });
        return;
      }
      const allowedMedia = new Set(['image/jpeg', 'image/png', 'image/webp']);
      const safeMediaType = allowedMedia.has(mediaType) ? mediaType : 'image/jpeg';
      const safeSelections = String(selectionsText || '').slice(0, 400);
      const safeNotes = String(notes || '').slice(0, 400);

      const anthropicBody = {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: VISUALIZER_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: safeMediaType, data: imageBase64 } },
            { type: 'text', text: `Selections: ${safeSelections}.${safeNotes ? ' Notes: ' + safeNotes : ''}` },
          ],
        }],
      };

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': ANTHROPIC_API_KEY.value(),
        },
        body: JSON.stringify(anthropicBody),
      });

      const data = await response.json();
      if (!response.ok) {
        logger.warn('publicVisualizerAI: upstream error', { status: response.status });
        res.status(response.status).json({ error: 'Upstream AI error' });
        return;
      }

      // Return only the text content, never the full upstream payload.
      const text = Array.isArray(data.content)
        ? data.content.map(c => (c && c.type === 'text' ? c.text : '')).join('')
        : '';
      res.json({ text });
    } catch (e) {
      logger.error('publicVisualizerAI error', { err: e.message });
      res.status(500).json({ error: 'Internal error' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// seedDemoData — REMOVED.
// Previously this was an unauthenticated POST that ran the full demo
// seeder. It's a destructive cost-DoS vector. Demo data is now seeded
// manually via the Firebase Admin CLI against a local emulator, not
// via a deployed Cloud Function.
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// validateAccessCode — hardened.
//
// Security notes:
// - Codes live in Firestore (`access_codes/{CODE}`) and are writable only
//   via admin SDK. Clients cannot enumerate or read this collection.
// - Never returns a password. Instead mints a Firebase custom token that
//   the client exchanges via `signInWithCustomToken`.
// - The `admin` role is NEVER granted via access code. Admin access is
//   provisioned by a Joe-only CLI script that calls setCustomUserClaims.
// - Per-IP rate limit (5 requests / 5 minutes). Failed attempts logged.
// - Requires App Check so random curl/script callers are blocked.
// ═══════════════════════════════════════════════════════════════════
exports.validateAccessCode = onCall(
  {
    enforceAppCheck: true,
    maxInstances: 5,
    concurrency: 10,
    timeoutSeconds: 15,
    memory: '256MiB',
  },
  async (request) => {
    const ip = clientIp(request.rawRequest || {});

    // Per-IP rate limit — tight. 5 attempts / 5 minutes.
    try {
      await enforceRateLimit('validateAccessCode:ip', ip, 5, 5 * 60_000);
    } catch (e) {
      if (e.rateLimited) {
        throw new HttpsError('resource-exhausted', 'Too many attempts. Try again in a few minutes.');
      }
      throw e;
    }

    const rawCode = (request.data && request.data.code) || '';
    if (typeof rawCode !== 'string' || rawCode.length < 3 || rawCode.length > 40) {
      throw new HttpsError('invalid-argument', 'Code not recognized');
    }
    const normalized = rawCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!normalized) {
      throw new HttpsError('invalid-argument', 'Code not recognized');
    }

    const db = admin.firestore();
    const codeRef = db.collection('access_codes').doc(normalized);
    const codeSnap = await codeRef.get();
    if (!codeSnap.exists) {
      logger.warn('access_code_invalid', { ip, normalized });
      throw new HttpsError('not-found', 'Code not recognized');
    }
    const code = codeSnap.data();
    if (code.active !== true) {
      logger.warn('access_code_inactive', { ip, normalized });
      throw new HttpsError('permission-denied', 'Code not recognized');
    }
    if (code.expiresAt && code.expiresAt.toMillis && code.expiresAt.toMillis() < Date.now()) {
      throw new HttpsError('permission-denied', 'Code expired');
    }
    if (typeof code.maxUses === 'number' && typeof code.useCount === 'number' && code.useCount >= code.maxUses) {
      throw new HttpsError('resource-exhausted', 'Code fully redeemed');
    }
    // Hard rule: access codes NEVER grant admin.
    const role = code.role === 'manager' ? 'manager' : 'member';
    const email = typeof code.email === 'string' && code.email.includes('@') ? code.email : null;
    if (!email) {
      logger.error('access_code_missing_email', { normalized });
      throw new HttpsError('failed-precondition', 'Code misconfigured. Contact support.');
    }

    try {
      // Look up or create the user — but do not overwrite passwords.
      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch (e) {
        if (e.code === 'auth/user-not-found') {
          userRecord = await admin.auth().createUser({
            email,
            emailVerified: false,
            displayName: code.displayName || 'NBD Member',
          });
        } else {
          throw e;
        }
      }

      // Set role claim (never admin).
      await admin.auth().setCustomUserClaims(userRecord.uid, { role });

      // Create subscription doc via admin SDK. Trust only the fields from the
      // Firestore-stored access code record.
      const planFromCode = code.plan === 'professional' ? 'professional' : 'foundation';
      const subData = {
        plan: planFromCode,
        status: 'active',
        source: 'access_code',
        accessCode: normalized,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (typeof code.trialDays === 'number' && code.trialDays > 0) {
        const trialEnd = new Date(Date.now() + code.trialDays * 86_400_000);
        subData.trialEndsAt = admin.firestore.Timestamp.fromDate(trialEnd);
      }
      const subRef = db.doc(`subscriptions/${userRecord.uid}`);
      if (!(await subRef.get()).exists) {
        subData.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }
      await subRef.set(subData, { merge: true });

      // Create user profile doc if missing. Role is set via claim, not via the
      // users/<uid>.role field (which clients can write).
      const userDocRef = db.doc(`users/${userRecord.uid}`);
      const userDocSnap = await userDocRef.get();
      if (!userDocSnap.exists) {
        await userDocRef.set({
          email,
          displayName: userRecord.displayName || 'NBD Member',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Increment usage counter.
      await codeRef.update({
        useCount: admin.firestore.FieldValue.increment(1),
        lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Mint a short-lived custom token. Client exchanges via signInWithCustomToken.
      const customToken = await admin.auth().createCustomToken(userRecord.uid, { role });
      logger.info('access_code_redeemed', { normalized, uid: userRecord.uid, role });
      return { success: true, customToken, role };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error('validateAccessCode error', { normalized, err: e.message });
      throw new HttpsError('internal', 'Authentication error. Please try again.');
    }
  }
);
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
const { beforeUserCreated } = require('firebase-functions/v2/identity');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const Stripe = require('stripe');

admin.initializeApp();

// Rate limiter: adapter module picks Upstash vs Firestore at call time
// based on NBD_RATE_LIMIT_PROVIDER + whether Upstash secrets are set.
// Falls back to the Firestore limiter automatically.
const { enforceRateLimit, httpRateLimit, clientIp } = require('./integrations/upstash-ratelimit');
const { withSentry } = require('./integrations/sentry');

// Secrets stored in Firebase Secret Manager
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const STRIPE_PRICE_FOUNDATION = defineSecret('STRIPE_PRICE_FOUNDATION');
const STRIPE_PRICE_PROFESSIONAL = defineSecret('STRIPE_PRICE_PROFESSIONAL');
// Google Geocoding API key — optional. If not set, backfillAnalytics
// runs in degraded mode (derives hour/day from timestamps only,
// skips reverse-geocoding). To enable full geocoding:
//   firebase functions:secrets:set GOOGLE_GEOCODING_API_KEY
const GOOGLE_GEOCODING_API_KEY = defineSecret('GOOGLE_GEOCODING_API_KEY');

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
// H-5: per-uid budget stays as a per-seat fairness floor, but we now
// also enforce a per-COMPANY budget. Previously, with free signups
// (pre-C-2) and no company cap, an attacker could spray 10 burner
// accounts on NBD-2026 and multiply the per-uid limit by 10x.
// Per-plan caps:
//   lite        →  10k tokens/day/company
//   foundation  →  50k tokens/day/company
//   growth      → 250k tokens/day/company
//   professional→ 1M  tokens/day/company
const CLAUDE_DAILY_TOKEN_BUDGET = 200000; // per uid per calendar day
const CLAUDE_PER_MIN_LIMIT = 20;
const CLAUDE_COMPANY_BUDGET = {
  lite:          10_000,
  foundation:    50_000,
  growth:       250_000,
  professional: 1_000_000
};
const CLAUDE_COMPANY_BUDGET_DEFAULT = 10_000;

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
      // M-1: email-verification gate. An unverified email can be
      // anything — squatters can burn legitimate emails by signing
      // up first. Block unverified accounts from touching billable
      // surfaces (AI proxy). Platform admin exempt for support.
      const isAdmin = decoded.role === 'admin';
      if (!isAdmin && decoded.email_verified !== true) {
        res.status(403).json({ error: 'Verify your email before using AI features.' });
        return;
      }

      // Subscription gate — server-trusted Firestore doc written only by Stripe webhook.
      const subSnap = await admin.firestore().doc(`subscriptions/${decoded.uid}`).get();
      const sub = subSnap.exists ? subSnap.data() : null;
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
      const callerCompanyId = decoded.companyId || decoded.uid; // solo op = own company
      // Fetch both per-uid AND per-company usage in parallel. The
      // per-company query uses `companyId`, which we now stamp on
      // every api_usage doc below.
      const [perUidSnap, perCompanySnap] = await Promise.all([
        admin.firestore().collection('api_usage')
          .where('uid', '==', decoded.uid)
          .where('timestamp', '>', dayAgo)
          .get(),
        admin.firestore().collection('api_usage')
          .where('companyId', '==', callerCompanyId)
          .where('timestamp', '>', dayAgo)
          .get()
      ]);
      const sumTokens = (snap) => {
        let s = 0;
        snap.forEach(d => {
          const r = d.data();
          s += (r.inputTokens || 0) + (r.outputTokens || 0);
        });
        return s;
      };
      const consumedUid     = sumTokens(perUidSnap);
      const consumedCompany = sumTokens(perCompanySnap);

      // Resolve per-company cap from the plan on the subscription doc.
      const plan = (sub && sub.plan) || 'lite';
      const companyCap = CLAUDE_COMPANY_BUDGET[plan] ?? CLAUDE_COMPANY_BUDGET_DEFAULT;

      if (!isAdmin && consumedUid >= CLAUDE_DAILY_TOKEN_BUDGET) {
        res.status(429).json({ error: 'Daily AI budget exceeded for your account. Resets in 24 hours.' });
        return;
      }
      if (!isAdmin && consumedCompany >= companyCap) {
        res.status(429).json({
          error: 'Company AI budget exceeded for today. Upgrade plan or try again in 24 hours.',
          plan, capacity: companyCap
        });
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
          companyId: callerCompanyId,   // H-5: per-company budget query
          plan,
          model: anthropicBody.model,
          inputTokens: data.usage?.input_tokens || 0,
          outputTokens: data.usage?.output_tokens || 0,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        logger.warn('api_usage logging failed', { err: e.message });
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

      // Validate plan — accept both old names (foundation/professional)
      // and new names (starter/growth) for backwards compatibility
      const VALID_PLANS = ['foundation', 'professional', 'starter', 'growth'];
      if (!VALID_PLANS.includes(plan)) {
        res.status(400).json({ error: 'Invalid plan. Must be starter, growth, foundation, or professional.' });
        return;
      }
      // Normalize old names → new names for consistent storage
      const normalizedPlan = plan === 'foundation' ? 'starter' : (plan === 'professional' ? 'growth' : plan);
      // Remove the "free subscription while checkout is open" loophole — any prior
      // client-side self-write to subscriptions gets overwritten on webhook return
      // anyway, but the rules now block client writes entirely.

      // Get price ID based on plan
      // Maps both old and new plan names to Stripe Price IDs.
      // STRIPE_PRICE_FOUNDATION = Starter ($99), STRIPE_PRICE_PROFESSIONAL = Growth ($249)
      const priceId = (normalizedPlan === 'starter')
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
        success_url: `https://nobigdealwithjoedeal.com/pro/stripe-success.html?session_id={CHECKOUT_SESSION_ID}&plan=${normalizedPlan}`,
        cancel_url: 'https://nobigdealwithjoedeal.com/pro/pricing.html?cancelled=true',
        client_reference_id: decoded.uid,
        customer_email: decoded.email,
        metadata: {
          firebaseUid: decoded.uid,
          plan: normalizedPlan,
        },
        // 14-day trial on Growth tier — no card required upfront
        ...(normalizedPlan === 'growth' ? {
          subscription_data: { trial_period_days: 14 }
        } : {}),
      });

      logger.info('checkout_session_created', { sessionId: session.id, uid: decoded.uid, plan });

      res.json({ url: session.url });

    } catch (e) {
      logger.error('createCheckoutSession error', { err: e.message });
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

    // H-6: Stripe requires the RAW request body for signature
    // verification. If rawBody is missing (middleware re-parsed as
    // JSON, body-parser mounted before onRequest, etc.) we MUST
    // reject rather than fall back to req.body — the fallback would
    // either never verify OR accept a forged event if the signature
    // library is lenient. Explicit check + explicit tolerance.
    if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
      logger.error('stripeWebhook missing rawBody — misconfigured middleware');
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }
    if (typeof sig !== 'string' || !sig.length) {
      res.status(400).json({ error: 'Missing Stripe signature' });
      return;
    }

    let event;
    try {
      // 300s tolerance is Stripe's default; setting it explicitly so
      // it's not silently widened by a future SDK upgrade.
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret, 300);
    } catch (e) {
      logger.error('stripeWebhook signature verification failed', { err: e.message });
      res.status(400).json({ error: 'Webhook signature verification failed' });
      return;
    }

    try {
      const db = admin.firestore();

      // ── Idempotency guard ──
      // Stripe retries webhooks up to 15 times. Check if this event
      // ID was already processed to prevent duplicate writes to
      // subscriptions, custom claims, and usage counters.
      const eventRef = db.doc(`stripe_events/${event.id}`);
      const eventSnap = await eventRef.get();
      if (eventSnap.exists()) {
        logger.info('stripeWebhook.duplicate_event', { eventId: event.id });
        res.json({ received: true, duplicate: true });
        return;
      }
      await eventRef.set({ type: event.type, processedAt: admin.firestore.FieldValue.serverTimestamp() });

      switch (event.type) {
        // ═══════════════════════════════════════════════════
        // PLAN TIER EXTRACTION HELPER
        // Maps Stripe Price IDs to NBD plan tiers. The IDs
        // are set as Firebase secrets. Unknown prices fall
        // back to 'starter'. Enterprise is handled via
        // Stripe metadata since it's custom-priced.
        // ═══════════════════════════════════════════════════
        // (defined inline in the switch to have access to secrets)

        case 'checkout.session.completed': {
          const session = event.data.object;
          const uid = session.client_reference_id;
          const customerId = session.customer;

          if (!uid) {
            logger.warn('stripeWebhook.checkout_session_completed missing client_reference_id');
            break;
          }

          // Extract plan tier from metadata or price
          const plan = session.metadata?.plan || 'starter';

          const subData = {
            plan,
            status: 'active',
            stripeSessionId: session.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: session.subscription || null,
            source: 'checkout',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            // Usage counters — reset on subscription start
            usage: { leads: 0, reports: 0, aiCalls: 0, cycleStart: new Date().toISOString() }
          };

          await db.doc(`subscriptions/${uid}`).set(subData, { merge: true });

          // ── Set Firebase Auth custom claims ──
          // These claims are available in Firestore security rules
          // via request.auth.token.plan and in client JS via
          // user.getIdTokenResult().claims.plan
          try {
            await admin.auth().setCustomUserClaims(uid, {
              plan,
              subscriptionStatus: 'active',
              stripeCustomerId: customerId
            });
            logger.info('custom_claims_set', { uid, plan });
          } catch (claimErr) {
            logger.error('custom_claims_failed', { uid, err: claimErr.message });
          }

          logger.info('subscription_activated', { uid, plan, sessionId: session.id });
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object;
          const customerId = subscription.customer;

          const snapshot = await db
            .collection('subscriptions')
            .where('stripeCustomerId', '==', customerId)
            .limit(1)
            .get();

          if (snapshot.empty) {
            logger.warn('stripeWebhook.subscription_updated no matching user', { customerId });
            break;
          }

          const subDoc = snapshot.docs[0];
          const uid = subDoc.id;

          // Extract plan from subscription items' price metadata
          let plan = subDoc.data().plan || 'starter';
          if (subscription.items?.data?.[0]?.price?.metadata?.plan) {
            plan = subscription.items.data[0].price.metadata.plan;
          }

          await subDoc.ref.update({
            plan,
            status: subscription.status,
            stripeSubscriptionId: subscription.id,
            currentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : null,
            cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          // Sync custom claims
          try {
            await admin.auth().setCustomUserClaims(uid, {
              plan,
              subscriptionStatus: subscription.status,
              stripeCustomerId: customerId
            });
          } catch (e) { logger.warn('claims_update_failed', { uid, err: e.message }); }

          logger.info('subscription_updated', { uid, plan, status: subscription.status });
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const customerId = subscription.customer;

          const snapshot = await db
            .collection('subscriptions')
            .where('stripeCustomerId', '==', customerId)
            .limit(1)
            .get();

          if (snapshot.empty) {
            logger.warn('stripeWebhook.subscription_deleted no matching user', { customerId });
            break;
          }

          const subDoc = snapshot.docs[0];
          const uid = subDoc.id;

          await subDoc.ref.update({
            plan: 'free',
            status: 'cancelled',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          // Downgrade custom claims to free
          try {
            await admin.auth().setCustomUserClaims(uid, {
              plan: 'free',
              subscriptionStatus: 'cancelled',
              stripeCustomerId: customerId
            });
          } catch (e) { logger.warn('claims_downgrade_failed', { uid, err: e.message }); }

          logger.info('subscription_cancelled', { uid });
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object;
          const customerId = invoice.customer;

          const snapshot = await db
            .collection('subscriptions')
            .where('stripeCustomerId', '==', customerId)
            .limit(1)
            .get();

          if (snapshot.empty) {
            logger.warn('stripeWebhook.invoice_payment_failed no matching user', { customerId });
            break;
          }

          const subDoc = snapshot.docs[0];
          const uid = subDoc.id;

          await subDoc.ref.update({
            status: 'past_due',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          // Update claims to past_due so client can show warning
          try {
            await admin.auth().setCustomUserClaims(uid, {
              plan: subDoc.data().plan || 'free',
              subscriptionStatus: 'past_due',
              stripeCustomerId: customerId
            });
          } catch (e) { logger.warn('claims_pastdue_failed', { uid, err: e.message }); }

          logger.warn('invoice_payment_failed', { uid, invoiceId: invoice.id });
          break;
        }

        // ── Invoice paid — reset monthly usage counters ──
        case 'invoice.paid': {
          const invoice = event.data.object;
          const customerId = invoice.customer;
          if (invoice.billing_reason !== 'subscription_cycle') break;

          const snapshot = await db
            .collection('subscriptions')
            .where('stripeCustomerId', '==', customerId)
            .limit(1)
            .get();
          if (!snapshot.empty) {
            const subDoc = snapshot.docs[0];
            await subDoc.ref.update({
              'usage.leads': 0,
              'usage.reports': 0,
              'usage.aiCalls': 0,
              'usage.cycleStart': new Date().toISOString(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            logger.info('usage_counters_reset', { uid: subDoc.id });
          }
          break;
        }

        default:
          logger.info('stripeWebhook.unhandled_event_type', { type: event.type });
      }

      res.json({ received: true });

    } catch (e) {
      logger.error('stripeWebhook processing error', { err: e.message });
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

      logger.info('billing_portal_session_created', { uid: decoded.uid });

      res.json({ url: portalSession.url });

    } catch (e) {
      logger.error('createCustomerPortalSession error', { err: e.message });
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
      logger.error('getSubscriptionStatus error', { err: e.message });
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
      logger.info('storage_cors_updated');
      res.json({ success: true, message: 'CORS configuration applied to storage bucket' });
    } catch (e) {
      logger.error('setStorageCors error', { err: e.message });
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
    // Platform admin can cross-tenant for support; everything else
    // must share a company. H-3: previously platform admin was the
    // only cross-tenant escape, but pre-C-1 that claim was grantable
    // through the invite flow. With invite-role allowlisting landed,
    // a legitimate platform admin is the only caller that hits this
    // branch, and it's now narrow (support workflow only).
    const isPlatformAdmin = decoded.role === 'admin';

    // Tenant-scoped manager / company_admin: must share companyId
    // with the file's owner. Claims are the cheap path; fall back
    // to a Firestore lookup only if the claim is missing.
    let allowed = isOwner || isPlatformAdmin;
    if (!allowed) {
      const callerCompanyId = decoded.companyId || null;
      const callerRole = decoded.role || '';
      if (callerCompanyId && ['manager', 'company_admin'].includes(callerRole)) {
        try {
          // Look up the file-owner's company. Prefer the users/{uid}
          // doc (authoritative), falling back to reps/{uid} for older
          // seeded data.
          const db = admin.firestore();
          const [userDoc, repDoc] = await Promise.all([
            db.doc(`users/${ownerUid}`).get(),
            db.doc(`reps/${ownerUid}`).get()
          ]);
          const ownerCompanyId = (userDoc.exists && userDoc.data().companyId)
            || (repDoc.exists  && repDoc.data().companyId)
            || null;
          if (ownerCompanyId && ownerCompanyId === callerCompanyId) {
            allowed = true;
          }
        } catch (e) { /* fall through → 403 */ }
      }
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
// AUDIT LOG TRIGGERS (H-4)
// Loaded from a sibling module to keep index.js tractable.
// ═══════════════════════════════════════════════════════════════
const auditTriggers = require('./audit-triggers');
Object.assign(exports, auditTriggers);

// ═══════════════════════════════════════════════════════════════
// INTEGRATIONS — every adapter is a no-op when its secret is unset.
// Add more to functions/integrations/ and register them here.
// ═══════════════════════════════════════════════════════════════
const slackIntegration       = require('./integrations/slack');
const measurementIntegration = require('./integrations/measurement');
const esignIntegration       = require('./integrations/esign');
const parcelIntegration      = require('./integrations/parcel');
const hailIntegration        = require('./integrations/hail');
const calcomIntegration      = require('./integrations/calcom');
Object.assign(exports, slackIntegration);
Object.assign(exports, measurementIntegration);
Object.assign(exports, esignIntegration);
Object.assign(exports, parcelIntegration);
Object.assign(exports, hailIntegration);
Object.assign(exports, calcomIntegration);

// ═══════════════════════════════════════════════════════════════
// integrationStatus — client-facing readout of which adapters are
// configured in this deploy. Lets the UI disable a button for an
// unconfigured provider instead of showing a cryptic error.
// ═══════════════════════════════════════════════════════════════
const {
  hasSecret: _hasInt,
  getSecret: _getInt,
  PROVIDERS: _intProviders,
  SECRETS: _intSecrets
} = require('./integrations/_shared');
exports.integrationStatus = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 10,
    memory: '128MiB',
    secrets: Object.values(_intSecrets)
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    return {
      providers: _intProviders,
      configured: {
        sentry:      _hasInt('SENTRY_DSN_FUNCTIONS'),
        slack:       _hasInt('SLACK_WEBHOOK_URL'),
        turnstile:   _hasInt('TURNSTILE_SECRET'),
        upstash:     _hasInt('UPSTASH_REDIS_REST_URL') && _hasInt('UPSTASH_REDIS_REST_TOKEN'),
        hover:       _hasInt('HOVER_API_KEY'),
        eagleview:   _hasInt('EAGLEVIEW_API_KEY'),
        nearmap:     _hasInt('NEARMAP_API_KEY'),
        boldsign:    _hasInt('BOLDSIGN_API_KEY'),
        regrid:      _hasInt('REGRID_API_TOKEN'),
        hailtrace:   _hasInt('HAILTRACE_API_KEY'),
        calcom:      _hasInt('CALCOM_WEBHOOK_SECRET')
      }
    };
  }
);

// ═══════════════════════════════════════════════════════════════
// HOMEOWNER PORTAL — public-by-token access to a redacted lead view
//
// Flow:
//   1. Rep clicks "Share portal link" on a lead → createPortalToken
//      mints a 24-char opaque token, stores it in portal_tokens/{tok}
//      with { leadId, ownerUid, expiresAt, uses }.
//   2. Rep SMSes/emails the URL `https://nobigdealwithjoedeal.com/
//      pro/portal.html?token=<tok>` to the homeowner.
//   3. Homeowner opens the page → getHomeownerPortalView({token})
//      verifies the token and returns a REDACTED projection of the
//      lead, rep, estimate, and booking URL. No auth required on
//      the client side.
//
// portal_tokens is admin-SDK only (firestore.rules deny read/write
// to clients) — the tokens are cryptographically random so guessing
// is infeasible, and expiry + max-uses keep the blast radius small.
// ═══════════════════════════════════════════════════════════════
const PORTAL_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function mintPortalToken() {
  const bytes = require('crypto').randomBytes(24);
  let s = '';
  for (const b of bytes) s += PORTAL_TOKEN_ALPHABET[b % PORTAL_TOKEN_ALPHABET.length];
  return s;
}

exports.createPortalToken = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 15,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const leadId = typeof request.data?.leadId === 'string' ? request.data.leadId : null;
    if (!leadId) throw new HttpsError('invalid-argument', 'leadId required');

    const db = admin.firestore();
    const leadSnap = await db.doc(`leads/${leadId}`).get();
    if (!leadSnap.exists) throw new HttpsError('not-found', 'Lead not found');
    const lead = leadSnap.data();
    // Owner-scope: rep who owns the lead OR platform admin.
    const isAdmin = request.auth.token.role === 'admin';
    if (lead.userId !== uid && !isAdmin) {
      throw new HttpsError('permission-denied', 'Not your lead');
    }

    // 30-day default TTL — rep can force re-mint anytime.
    const ttlDays = Math.min(90, Math.max(1, Number(request.data?.ttlDays) || 30));
    const now = Date.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(now + ttlDays * 86_400_000);

    const token = mintPortalToken();
    await db.doc(`portal_tokens/${token}`).set({
      leadId,
      ownerUid: lead.userId,
      mintedBy: uid,
      mintedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
      uses: 0,
      maxUses: 100  // generous — homeowner may reload across days
    });
    return { token, expiresAt: expiresAt.toMillis() };
  }
);

// ─── revokePortalToken ────────────────────────────────────
// Flips all active tokens for a lead to active:false so they stop
// resolving in getHomeownerPortalView. Owner-scoped — a rep can
// only revoke tokens on their own leads. Platform admin unrestricted.
exports.revokePortalToken = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 15,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const leadId = typeof request.data?.leadId === 'string' ? request.data.leadId : null;
    const tokenId = typeof request.data?.token === 'string' ? request.data.token : null;
    if (!leadId && !tokenId) {
      throw new HttpsError('invalid-argument', 'leadId or token required');
    }

    const db = admin.firestore();
    const isAdmin = request.auth.token.role === 'admin';
    let revoked = [];

    if (tokenId) {
      const ref = db.doc(`portal_tokens/${tokenId}`);
      const snap = await ref.get();
      if (!snap.exists) throw new HttpsError('not-found', 'Token not found');
      if (!isAdmin && snap.data().ownerUid !== uid) {
        throw new HttpsError('permission-denied', 'Not your token');
      }
      // We flip to an expired timestamp rather than deleting so the
      // audit trail survives. getHomeownerPortalView checks expiresAt.
      await ref.update({
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1),
        revokedAt: admin.firestore.FieldValue.serverTimestamp(),
        revokedBy: uid
      });
      revoked = [tokenId];
    } else {
      // Revoke every token for this lead owned by the caller.
      const q = await db.collection('portal_tokens')
        .where('leadId', '==', leadId)
        .get();
      const batch = db.batch();
      q.forEach(d => {
        const data = d.data();
        if (!isAdmin && data.ownerUid !== uid) return;
        batch.update(d.ref, {
          expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1),
          revokedAt: admin.firestore.FieldValue.serverTimestamp(),
          revokedBy: uid
        });
        revoked.push(d.id);
      });
      if (revoked.length) await batch.commit();
    }
    logger.info('revokePortalToken', { leadId, count: revoked.length });
    return { success: true, revoked: revoked.length };
  }
);

exports.getHomeownerPortalView = onRequest(
  {
    region: 'us-central1',
    cors: true, // intentionally open — this is the homeowner-facing endpoint
    maxInstances: 20,
    concurrency: 80,
    timeoutSeconds: 15,
    memory: '256MiB',
    // BoldSign key: needed to mint the embedded signing URL when
    // the estimate is awaiting signature.
    secrets: [_intSecrets.BOLDSIGN_API_KEY]
  },
  async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET') { res.status(405).end(); return; }

    // Rate-limit per IP — 30/min is plenty for a homeowner on the
    // page and stops an attacker from brute-forcing tokens.
    if (!(await httpRateLimit(req, res, 'portal:ip', 30, 60_000))) return;

    const token = (req.method === 'GET' ? req.query.token : (req.body && req.body.token)) || '';
    if (typeof token !== 'string' || token.length < 10 || token.length > 64) {
      res.status(400).json({ error: 'Invalid token' });
      return;
    }

    const db = admin.firestore();
    const tokRef = db.doc(`portal_tokens/${token}`);
    const tokSnap = await tokRef.get();
    if (!tokSnap.exists) { res.status(404).json({ error: 'Invalid link' }); return; }
    const tok = tokSnap.data();

    if (tok.expiresAt && tok.expiresAt.toMillis && tok.expiresAt.toMillis() < Date.now()) {
      res.status(410).json({ error: 'This link has expired. Contact your rep for a new one.' });
      return;
    }
    if (typeof tok.maxUses === 'number' && (tok.uses || 0) >= tok.maxUses) {
      res.status(429).json({ error: 'This link has been opened too many times.' });
      return;
    }

    // Load the lead, rep, and latest estimate in parallel.
    const [leadSnap, repSnap, estSnap] = await Promise.all([
      db.doc(`leads/${tok.leadId}`).get(),
      db.doc(`users/${tok.ownerUid}`).get(),
      db.collection('estimates')
        .where('leadId', '==', tok.leadId)
        .limit(10)
        .get()
    ]);

    if (!leadSnap.exists) { res.status(404).json({ error: 'Project not found' }); return; }
    const lead = leadSnap.data();
    const rep = repSnap.exists ? repSnap.data() : {};

    // Pick the latest estimate (createdAt desc). In-memory sort to
    // avoid a composite-index requirement for this rarely-hit path.
    const estimates = estSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    estimates.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() || 0;
      const tb = b.createdAt?.toMillis?.() || 0;
      return tb - ta;
    });
    const latest = estimates[0] || null;

    // REDACTION: only non-sensitive fields reach the homeowner.
    // In particular: no claim details, no internal notes, no rep
    // commission, no other leads.

    // If the estimate is awaiting signature AND BoldSign is
    // configured AND the signer email on file matches the one
    // stored on the estimate, request a fresh embed signing URL so
    // the homeowner can sign right inside the portal instead of
    // digging up the BoldSign email. We never expose the document
    // id — only the iframe URL, which BoldSign scopes to the signer
    // email automatically.
    let signEmbedUrl = null;
    if (latest
        && (latest.signatureStatus === 'sent' || latest.signatureStatus === 'viewed')
        && latest.signatureProvider === 'boldsign'
        && latest.signatureDocumentId
        && latest.signerEmail
        && _hasInt('BOLDSIGN_API_KEY')) {
      try {
        const apiKey = _getInt('BOLDSIGN_API_KEY');
        const embedRes = await fetch(
          `https://api.boldsign.com/v1/document/getEmbeddedSignLink?documentId=${encodeURIComponent(latest.signatureDocumentId)}&signerEmail=${encodeURIComponent(latest.signerEmail)}`,
          { headers: { 'X-API-KEY': apiKey } }
        );
        if (embedRes.ok) {
          const d = await embedRes.json();
          signEmbedUrl = d.signLink || d.signUrl || null;
        }
      } catch (e) {
        logger.warn('portal embed link fetch failed', { err: e.message });
      }
    }

    const view = {
      homeowner: {
        firstName: lead.firstName || '',
        lastName:  lead.lastName || '',
        address:   lead.address || ''
      },
      rep: {
        displayName:    rep.displayName || lead.repName || 'Your Rep',
        calcomUsername: rep.calcomUsername || null,
        calcomEventSlug: rep.calcomEventSlug || 'roof-inspection',
        phone: rep.phone || null
      },
      company: {
        name: rep.companyName || 'No Big Deal Home Solutions'
      },
      estimate: latest ? {
        id:              latest.id,
        builder:         latest.builder || 'classic',
        grandTotal:      latest.grandTotal || latest.total || null,
        tierName:        latest.tierName || null,
        signatureStatus: latest.signatureStatus || 'none',
        signedAt:        latest.signedAt?.toDate?.()?.toISOString() || null,
        signedDocumentUrl: latest.signedDocumentUrl || null,
        signEmbedUrl:    signEmbedUrl,
        // Line-item summary only — NOT the internal cost breakdown.
        lineCount: Array.isArray(latest.lines) ? latest.lines.length : null,
        createdAt: latest.createdAt?.toDate?.()?.toISOString() || null
      } : null,
      bookingUrl: rep.calcomUsername
        ? ('https://cal.com/' + rep.calcomUsername + '/' + (rep.calcomEventSlug || 'roof-inspection'))
        : null,
      tokenInfo: {
        // Let the UI show "expires in N days" without exposing the
        // exact timestamp shape.
        daysRemaining: tok.expiresAt
          ? Math.max(0, Math.ceil((tok.expiresAt.toMillis() - Date.now()) / 86_400_000))
          : null
      }
    };

    // Bump use counter (fire-and-forget; don't fail the response).
    tokRef.update({
      uses: admin.firestore.FieldValue.increment(1),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});

    res.status(200).json(view);
  }
);

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

      // H-6: same rawBody requirement as stripeWebhook. The previous
      // `req.rawBody || req.body` fallback is a footgun — it gives
      // stripe.constructEvent a parsed object that never yields a
      // valid signature match, silently 400ing legit events, or (on
      // older SDKs) re-serialising into a different byte sequence
      // and accepting forgeries.
      if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
        logger.error('invoiceWebhook missing rawBody');
        res.status(400).json({ error: 'Invalid request body' });
        return;
      }
      if (!signature) {
        res.status(400).json({ error: 'Missing signature' });
        return;
      }

      // Verify Stripe signature with explicit replay tolerance.
      let event;
      try {
        event = stripe.webhooks.constructEvent(
          req.rawBody,
          signature,
          STRIPE_WEBHOOK_SECRET.value(),
          300
        );
      } catch (err) {
        logger.error('invoiceWebhook signature verification failed', { err: err.message });
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
      logger.error('invoiceWebhook error', { err: e.message });
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

// ═════════════════════════════════════════════════════════════
// backfillAnalytics — one-time enrichment of existing knocks + leads
//
// Derives analytics fields from the data that's already stored:
//   - hourOfDay, dayOfWeek (from timestamp) — for time-of-day heatmaps
//   - city, zip, state (via Google Geocoding if API key set + lat/lng)
//
// Scope: owner-only. Runs against the calling user's own docs. Never
// touches another user's data.
//
// Degraded mode: if GOOGLE_GEOCODING_API_KEY isn't set, the function
// still processes timestamp-based fields (hourOfDay, dayOfWeek) so
// the Rep Report Generator's heatmaps work. Reverse-geocoding is
// skipped with a warning in the response.
//
// Idempotent: re-running the function only enriches docs that are
// missing the fields. Existing enriched docs are skipped.
// ═════════════════════════════════════════════════════════════
exports.backfillAnalytics = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    secrets: [GOOGLE_GEOCODING_API_KEY],
    timeoutSeconds: 540, // 9 minutes — enough for ~5k docs
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');

    // Rate-limit: max 1 call per 10 minutes per user. Backfill is
    // expensive (hits Google Geocoding + writes to Firestore), so
    // we don't want someone spamming the button.
    try {
      await enforceRateLimit({
        key: 'backfill:' + uid,
        windowSec: 600,
        maxCalls: 1
      });
    } catch (e) {
      throw new HttpsError('resource-exhausted', 'Please wait 10 minutes between backfill runs.');
    }

    const geocodingKey = GOOGLE_GEOCODING_API_KEY.value();
    const hasGeocoding = !!(geocodingKey && geocodingKey.startsWith('AIza'));

    const summary = {
      knocksProcessed: 0,
      knocksEnriched: 0,
      knocksGeocoded: 0,
      leadsProcessed: 0,
      leadsEnriched: 0,
      leadsGeocoded: 0,
      geocodingEnabled: hasGeocoding,
      warnings: []
    };

    // ─ Knocks enrichment ─
    // Path: leads/{uid}/knocks/* (if the app stores knocks under user
    // subcollections) OR leads/{uid}/leads/{leadId}/knocks/*. We check
    // both paths. For safety this backfill only reads, writes, and
    // deletes from within the caller's uid namespace.
    const db = admin.firestore();

    // Fetch knocks collection — assumes top-level 'knocks' with userId field
    const knocksSnap = await db.collection('knocks').where('userId', '==', uid).limit(5000).get();
    logger.info('backfillAnalytics: knocks fetched', { uid, count: knocksSnap.size });

    // Process in batches of 400 writes (Firestore batch limit is 500)
    const geocodeCache = new Map();
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of knocksSnap.docs) {
      summary.knocksProcessed++;
      const data = doc.data();
      const updates = {};

      // Time-of-day fields
      const ts = data.timestamp || data.createdAt;
      let d = null;
      if (ts && typeof ts.toDate === 'function') d = ts.toDate();
      else if (ts && ts.seconds) d = new Date(ts.seconds * 1000);
      else if (ts) d = new Date(ts);

      if (d && !isNaN(d.getTime())) {
        if (data.hourOfDay == null) updates.hourOfDay = d.getHours();
        if (data.dayOfWeek == null) updates.dayOfWeek = d.getDay();
      }

      // Reverse geocode if we have lat/lng and missing city
      if (hasGeocoding && data.location && data.location.lat && data.location.lng && !data.city) {
        try {
          const key = data.location.lat.toFixed(3) + ',' + data.location.lng.toFixed(3);
          let geo = geocodeCache.get(key);
          if (!geo) {
            geo = await reverseGeocode(data.location.lat, data.location.lng, geocodingKey);
            geocodeCache.set(key, geo);
          }
          if (geo) {
            if (geo.city) updates.city = geo.city;
            if (geo.zip) updates.zip = geo.zip;
            if (geo.state) updates.state = geo.state;
            summary.knocksGeocoded++;
          }
        } catch (e) {
          summary.warnings.push('Geocoding failed for knock ' + doc.id + ': ' + e.message);
        }
      }

      if (Object.keys(updates).length > 0) {
        batch.update(doc.ref, updates);
        batchCount++;
        summary.knocksEnriched++;
        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    // ─ Leads enrichment ─
    // Top-level 'leads' collection with userId == uid. Parse address
    // text into city/zip if those fields are missing.
    const leadsSnap = await db.collection('leads').where('userId', '==', uid).limit(5000).get();
    logger.info('backfillAnalytics: leads fetched', { uid, count: leadsSnap.size });

    for (const doc of leadsSnap.docs) {
      summary.leadsProcessed++;
      const data = doc.data();
      const updates = {};

      // Parse city/zip from address string if missing
      if (data.address && !data.city) {
        const parsed = parseAddress(data.address);
        if (parsed.city) updates.city = parsed.city;
        if (parsed.zip) updates.zip = parsed.zip;
        if (parsed.state) updates.state = parsed.state;
      }

      // Stage transition: if a lead is won/lost and has no closedAt,
      // use updatedAt as a proxy so velocity calcs have a signal.
      const stage = (data.stage || '').toString().toLowerCase();
      if (['closed','install_complete','final_payment','complete','lost'].includes(stage) && !data.closedAt) {
        updates.closedAt = data.updatedAt || data.createdAt || admin.firestore.FieldValue.serverTimestamp();
      }

      if (Object.keys(updates).length > 0) {
        batch.update(doc.ref, updates);
        batchCount++;
        summary.leadsEnriched++;
        if (updates.city) summary.leadsGeocoded++;
        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    // Final batch commit
    if (batchCount > 0) await batch.commit();

    if (!hasGeocoding) {
      summary.warnings.push('GOOGLE_GEOCODING_API_KEY not set — reverse geocoding skipped. Set the secret and re-run for full enrichment.');
    }

    logger.info('backfillAnalytics: done', { uid, ...summary });
    return summary;
  }
);

// Google Geocoding reverse lookup. Returns { city, zip, state } or null.
async function reverseGeocode(lat, lng, apiKey) {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + lat + ',' + lng + '&key=' + apiKey;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  if (data.status !== 'OK' || !data.results || !data.results.length) return null;
  const components = data.results[0].address_components || [];
  const result = {};
  for (const c of components) {
    if (c.types.includes('locality')) result.city = c.long_name;
    else if (c.types.includes('administrative_area_level_1')) result.state = c.short_name;
    else if (c.types.includes('postal_code')) result.zip = c.long_name;
  }
  return result;
}

// Cheap address parser — pulls city/state/zip from typical US format.
// Format: "123 Main St, Cincinnati, OH 45202" → { city, state, zip }
// Not perfect but covers the 80% case without an API call.
function parseAddress(addr) {
  if (!addr || typeof addr !== 'string') return {};
  const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return {};
  const result = {};
  // Last part: "OH 45202" or "45202"
  const last = parts[parts.length - 1];
  const zipMatch = last.match(/\b(\d{5}(?:-\d{4})?)\b/);
  if (zipMatch) result.zip = zipMatch[1];
  const stateMatch = last.match(/\b([A-Z]{2})\b/);
  if (stateMatch) result.state = stateMatch[1];
  // Second-to-last: city
  if (parts.length >= 2) {
    result.city = parts[parts.length - 2];
  }
  return result;
}

// ═════════════════════════════════════════════════════════════
// migratePinsToKnocks — one-time migration of the old 'pins'
// collection into 'knocks' so the Maps retirement is complete.
//
// Pin status → knock disposition mapping:
//   Signed       → appointment
//   Interested   → interested
//   Not Home     → not_home
//   Not Interested → not_interested
//   Callback     → interested  (closest match)
//   Do Not Knock → do_not_knock
//   Left Material → interested
//   Follow Up    → interested
//
// Scope: owner-only. Migrates only the calling user's pins.
// Idempotent: pins with migrated:true are skipped on re-runs.
// ═════════════════════════════════════════════════════════════
exports.migratePinsToKnocks = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 300,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');

    const db = admin.firestore();
    const STATUS_TO_DISPO = {
      'Signed':         'appointment',
      'Interested':     'interested',
      'Not Home':       'not_home',
      'Not Interested': 'not_interested',
      'Callback':       'interested',
      'Do Not Knock':   'do_not_knock',
      'Left Material':  'interested',
      'Follow Up':      'interested'
    };

    // Load all non-migrated pins for this user
    const pinsSnap = await db.collection('pins')
      .where('userId', '==', uid)
      .limit(5000)
      .get();

    let migrated = 0;
    let skipped = 0;
    let batch = db.batch();
    let batchCount = 0;

    for (const pinDoc of pinsSnap.docs) {
      const pin = pinDoc.data();
      if (pin.migrated) { skipped++; continue; }

      const disposition = STATUS_TO_DISPO[pin.status] || 'not_home';
      const knockDoc = {
        userId: uid,
        repId: uid,
        companyId: pin.companyId || 'default',
        address: pin.notes || pin.address || '',
        lat: pin.lat || null,
        lng: pin.lng || null,
        homeowner: '',
        phone: '',
        email: '',
        disposition: disposition,
        notes: 'Migrated from Maps pin: ' + (pin.status || 'unknown'),
        stage: disposition === 'appointment' ? 'appointment' : 'knock',
        attemptNumber: 1,
        createdAt: pin.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        convertedToLead: false,
        estimateValue: 0,
        closedDealValue: 0,
        insCarrier: '',
        claimNumber: '',
        photoUrls: [],
        voiceUrl: '',
        followUpTime: '',
        _migratedFromPin: pinDoc.id
      };

      // Create knock
      const knockRef = db.collection('knocks').doc();
      batch.set(knockRef, knockDoc);

      // Mark pin as migrated (don't delete — keep for audit)
      batch.update(pinDoc.ref, { migrated: true, migratedAt: admin.firestore.FieldValue.serverTimestamp() });

      batchCount += 2;
      migrated++;

      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) await batch.commit();

    logger.info('migratePinsToKnocks: done', { uid, migrated, skipped, total: pinsSnap.size });
    return { migrated, skipped, total: pinsSnap.size };
  }
);

// ═════════════════════════════════════════════════════════════
// onRepSignup — Blocking auth trigger (beforeUserCreated)
//
// Fires when ANY user creates an account. Checks if their email
// is in any company's members subcollection. If found:
//   1. Sets custom claims: { companyId, role, plan }
//   2. Updates the member doc status from 'invited' → 'active'
//   3. Creates a Firestore user profile with company scoping
//
// If the email isn't in any company's members list, this is a
// solo operator signup — they get no company claims (default).
//
// This is a BLOCKING trigger — it runs before the user's
// account is finalized, so the claims are available immediately
// on their first login (no token refresh delay).
// ═════════════════════════════════════════════════════════════
// Role taxonomy — platform-wide allowlist. The `admin` role is PLATFORM
// admin and is reserved for support/ops — it grants cross-tenant reads via
// Firestore rules. Tenant-scoped admins use `company_admin`, which is
// bounded to their own `companyId` claim. Nothing below platform admin
// should ever be settable through the invite flow.
const INVITE_ALLOWED_ROLES = new Set(['company_admin', 'manager', 'sales_rep', 'viewer']);

exports.onRepSignup = beforeUserCreated(
  { region: 'us-central1' },
  async (event) => {
    const user = event.data;
    const email = (user.email || '').toLowerCase().trim();
    if (!email) return; // No email = nothing to match

    const db = admin.firestore();

    let companyId, role;
    try {
      // Search all companies' member lists for this email
      // This is a collectionGroup query on 'members' subcollections.
      const memberSnap = await db.collectionGroup('members')
        .where('email', '==', email)
        .where('status', '==', 'invited')
        .limit(1)
        .get();

      if (memberSnap.empty) {
        // Not an invited rep — solo operator signup. No claims to set.
        logger.info('onRepSignup: no matching invite');
        return;
      }

      const memberDoc = memberSnap.docs[0];
      const memberData = memberDoc.data();
      // The parent path is companies/{companyId}/members/{email}
      companyId = memberDoc.ref.parent.parent.id;

      // CRITICAL: hard allowlist. A malicious/compromised company owner
      // could have written `role: 'admin'` into the invite doc in an
      // attempt to mint platform-admin claims. Reject anything outside
      // the invite allowlist and fall back to the lowest-privilege role.
      const requested = typeof memberData.role === 'string' ? memberData.role : '';
      if (!INVITE_ALLOWED_ROLES.has(requested)) {
        logger.warn('onRepSignup: invite role outside allowlist', { companyId, requested });
        role = 'sales_rep';
      } else {
        role = requested;
      }

      logger.info('onRepSignup: matched invite', { companyId, role });
    } catch (e) {
      // Fail CLOSED. Previously we returned no claims and let signup
      // succeed "so claims can be set later" — but that created a
      // window where the user could read any doc missing a companyId
      // field, since myCompanyId() was null. Block signup on error.
      logger.error('onRepSignup error — blocking signup', { err: e.message });
      throw new HttpsError('internal', 'Signup temporarily unavailable. Try again shortly.');
    }

    return {
      customClaims: {
        companyId: companyId,
        role: role,
        plan: 'growth' // invited reps inherit the company's plan
      }
    };
  }
);

// ═════════════════════════════════════════════════════════════
// activateInvitedRep — Callable function that reps call after
// their first login to mark their invite as active + create
// their user profile. The beforeUserCreated trigger sets claims
// but can't write to Firestore (blocking triggers are limited).
// This function does the Firestore writes.
// ═════════════════════════════════════════════════════════════
exports.activateInvitedRep = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');

    const companyId = request.auth.token.companyId;
    const role = request.auth.token.role;
    const email = request.auth.token.email || '';

    if (!companyId) {
      // Not an invited rep — nothing to activate
      return { activated: false, reason: 'no_company_claim' };
    }

    const db = admin.firestore();

    try {
      // Update the member doc: invited → active
      const memberRef = db.doc(`companies/${companyId}/members/${email.toLowerCase()}`);
      const memberSnap = await memberRef.get();
      if (memberSnap.exists()) {
        await memberRef.update({
          status: 'active',
          uid: uid,
          activatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // Create user profile with company scoping
      await db.doc(`users/${uid}`).set({
        email: email,
        role: role,
        companyId: companyId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        displayName: request.auth.token.name || email.split('@')[0]
      }, { merge: true });

      logger.info('activateInvitedRep: success');
      return { activated: true, companyId, role };

    } catch (e) {
      logger.error('activateInvitedRep error', { uid, err: e.message });
      throw new HttpsError('internal', 'Activation failed');
    }
  }
);

// ═════════════════════════════════════════════════════════════
// submitPublicLead — C-3 gated write path for the four public forms
// (guide, contact, estimate, storm_alert). Replaces the previous
// unauthenticated direct-Firestore-create, which had no rate limit
// and could be mass-fired at Firestore's list price for ~$2/M writes.
//
// Defenses:
//   - enforceAppCheck: rejects calls without a valid App Check token
//     (curl/bot without the attestation token fails immediately).
//   - httpRateLimit: per-IP 20/min — plenty for a human on a form,
//     enough to stop a single-box 1000 rps attack cold.
//   - Origin allowlist via CORS_ORIGINS matches only the two public
//     domains. Browsers refuse to send the request otherwise.
//   - Honeypot field 'website': bots fill every field; real forms
//     leave it empty. Non-empty → silent 200 with no Firestore write.
//   - Per-shape validation + hard size caps.
//   - Generic 200 response with opaque id so enumerating invalid
//     payloads gives no side-channel.
// ═════════════════════════════════════════════════════════════
const PUBLIC_LEAD_KINDS = {
  guide: {
    collection: 'guide_leads',
    required: ['name', 'email', 'source'],
    maxLen:   { name: 200, email: 200, source: 200 }
  },
  contact: {
    collection: 'contact_leads',
    required: ['firstName', 'phone', 'source'],
    maxLen:   { firstName: 200, phone: 30, source: 200 }
  },
  estimate: {
    collection: 'estimate_leads',
    required: ['address', 'source'],
    maxLen:   { address: 500, source: 200 }
  },
  storm: {
    collection: 'storm_alert_subscribers',
    required: ['name', 'phone', 'zip', 'source'],
    maxLen:   { name: 200, phone: 30, zip: 10, source: 200 },
    exact:    { zip: 5 }
  }
};

const { verifyTurnstile } = require('./integrations/turnstile');
const { SECRETS: INT_SECRETS } = require('./integrations/_shared');

exports.submitPublicLead = onRequest(
  {
    cors: CORS_ORIGINS,        // same origin allowlist used by claudeProxy
    enforceAppCheck: true,     // required; App Check sits in front
    secrets: [INT_SECRETS.TURNSTILE_SECRET],
    maxInstances: 20,
    concurrency: 80,
    timeoutSeconds: 15,
    memory: '256MiB'
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

    // Per-IP rate limit — the single most important gate. 20/min/IP.
    // A human filling a form takes >10s; a spam script fires faster.
    if (!(await httpRateLimit(req, res, 'publicLead:ip', 20, 60_000))) return;

    // Turnstile verification (if configured). Fail closed on verifier
    // error. No-op passthrough when TURNSTILE_SECRET is unset so dev
    // environments still work.
    const turnstile = await verifyTurnstile(
      (req.body && req.body.turnstileToken) || '',
      clientIp(req)
    );
    if (!turnstile.ok) {
      res.status(403).json({ error: 'Verification failed', reason: turnstile.reason });
      return;
    }

    const body = req.body || {};
    const kind = typeof body.kind === 'string' ? body.kind : '';
    const spec = PUBLIC_LEAD_KINDS[kind];
    if (!spec) {
      // Opaque error: same shape as success so an attacker can't
      // enumerate valid kinds without also fetching a real response.
      res.status(400).json({ error: 'Invalid submission' });
      return;
    }

    // Honeypot — real humans never fill this. Pretend success.
    if (typeof body.website === 'string' && body.website.length > 0) {
      logger.info('submitPublicLead: honeypot tripped', { kind, ip: clientIp(req) });
      res.status(200).json({ success: true });
      return;
    }

    // Per-shape validation.
    const data = {};
    for (const key of spec.required) {
      const val = body[key];
      if (typeof val !== 'string') { res.status(400).json({ error: 'Invalid submission' }); return; }
      const max = spec.maxLen[key] || 200;
      if (val.length === 0 || val.length > max) { res.status(400).json({ error: 'Invalid submission' }); return; }
      if (spec.exact && spec.exact[key] != null && val.length !== spec.exact[key]) {
        res.status(400).json({ error: 'Invalid submission' }); return;
      }
      data[key] = val;
    }

    // Optional fields — passed through but bounded.
    for (const key of Object.keys(body)) {
      if (spec.required.includes(key)) continue;
      if (['kind', 'website'].includes(key)) continue;
      const v = body[key];
      if (typeof v !== 'string' || v.length > 500) continue;
      data[key] = v;
    }

    // Trust-but-tag: server-only fields the client can't spoof.
    data.ip = clientIp(req);
    data.userAgent = String(req.headers['user-agent'] || '').slice(0, 200);
    data.createdAt = admin.firestore.FieldValue.serverTimestamp();

    try {
      const ref = await admin.firestore().collection(spec.collection).add(data);
      logger.info('submitPublicLead', { kind, id: ref.id });
      res.status(200).json({ success: true, id: ref.id });
    } catch (e) {
      logger.error('submitPublicLead error', { kind, err: e.message });
      res.status(500).json({ error: 'Submission failed' });
    }
  }
);

// ═════════════════════════════════════════════════════════════
// rotateAccessCodes — platform-admin-only kill switch for legacy
// hardcoded access codes (C-2).
//
// Until this runs, NBD-2026 and the other pre-rotation codes are
// still live in Firestore because the old seed script wrote them.
// Calling this deactivates them server-side. After this, the seed
// script is the only way to mint new codes — and it prints them
// to stdout only.
//
// Platform admin only. Intentionally very loud in logs — every
// call creates an audit_log entry.
// ═════════════════════════════════════════════════════════════
const LEGACY_ACCESS_CODES = [
  'NBD-2026', 'NBD-DEMO', 'DEMO', 'TRYIT',
  'DEAL-2026', 'ROOFCON26', 'NBD-STORM'
];

exports.rotateAccessCodes = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    if (request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Platform admin required');
    }

    const db = admin.firestore();
    const deactivated = [];
    for (const codeId of LEGACY_ACCESS_CODES) {
      const ref = db.doc(`access_codes/${codeId}`);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const cur = snap.data();
      if (cur.active === false) continue;
      await ref.update({
        active: false,
        rotatedAt: admin.firestore.FieldValue.serverTimestamp(),
        rotatedBy: uid,
        rotatedReason: 'legacy hardcoded code auto-disabled'
      });
      deactivated.push(codeId);
    }
    logger.warn('rotateAccessCodes: legacy codes disabled', { by: uid, deactivated });
    // Write an audit_log entry explicitly — this predates the audit
    // triggers, so we record it here too.
    await db.collection('audit_log').add({
      type: 'rotate_access_codes',
      actorUid: uid,
      deactivated,
      ts: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, deactivated };
  }
);

// ═════════════════════════════════════════════════════════════
// ADMIN ACCOUNT MANAGER — Team lifecycle Cloud Functions
//
// These callables back the "Team" admin view. Only a global admin
// OR the company owner can invoke them. All writes go through the
// Admin SDK so they bypass Firestore rules — meaning the auth check
// below is the ONLY thing standing between the caller and the data.
// Treat every guard as load-bearing.
//
// Roles: admin | manager | sales_rep | viewer
// ═════════════════════════════════════════════════════════════

// Tenant-scoped roles. `admin` (platform-global) is deliberately NOT in
// this list — granting it requires manual admin SDK script, never a UI
// path. Tenant admins use `company_admin`, which owns the company but
// cannot read other tenants' data.
const TEAM_ROLES = ['company_admin', 'manager', 'sales_rep', 'viewer'];

// Resolve the caller's company and confirm they can manage it.
// Returns { uid, companyId, isOwner, isGlobalAdmin } or throws HttpsError.
async function requireTeamAdmin(request, targetCompanyId = null) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

  const claims = request.auth.token || {};
  const isGlobalAdmin = claims.role === 'admin';
  // Solo operators own a company keyed by their uid. Team members carry a
  // companyId claim set by onRepSignup. Fall back to uid for solo owners.
  const callerCompanyId = claims.companyId || uid;
  const companyId = targetCompanyId || callerCompanyId;

  // Cross-company ops are admin-only.
  if (!isGlobalAdmin && companyId !== callerCompanyId) {
    throw new HttpsError('permission-denied', 'Cannot manage another company');
  }

  // Verify ownership against the company doc if one exists.
  const db = admin.firestore();
  const companyRef = db.doc(`companies/${companyId}`);
  const companySnap = await companyRef.get();
  const ownerId = companySnap.exists ? (companySnap.data().ownerId || null) : null;
  const isOwner = ownerId === uid || (!companySnap.exists && companyId === uid);

  if (!isGlobalAdmin && !isOwner) {
    // Managers can list their team but not mutate — the caller gates mutations.
    throw new HttpsError('permission-denied', 'Owner or admin access required');
  }

  return { uid, companyId, isOwner, isGlobalAdmin, companyRef };
}

// Platform admin role is NEVER grantable through this function — not
// even by another platform admin. It is a manual admin-SDK script
// operation so it leaves a clear paper trail and cannot be triggered
// through a compromised browser session. The UI picker only offers
// the four tenant-scoped roles.
function normalizeRole(role) {
  if (typeof role !== 'string') return null;
  const r = role.trim().toLowerCase();
  if (r === 'admin') return null;  // platform admin — blocked here
  if (!TEAM_ROLES.includes(r)) return null;
  return r;
}

function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (!e.includes('@') || e.length < 5 || e.length > 200) return null;
  return e;
}

// ── createTeamMember ─────────────────────────────────────────
// Creates (or adopts) a Firebase Auth user, stamps role + companyId
// claims, and records the member in companies/{companyId}/members.
// The target's default status is 'active' if we created them fresh,
// 'invited' if they don't have a password set yet.
exports.createTeamMember = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const { uid: callerUid, companyId, companyRef } = await requireTeamAdmin(request);

    const email = normalizeEmail(request.data && request.data.email);
    if (!email) throw new HttpsError('invalid-argument', 'Valid email required');

    // Global admin can grant admin; company owners cannot.
    const role = normalizeRole(request.data && request.data.role);
    if (!role) throw new HttpsError('invalid-argument', 'Invalid role');

    const displayName = typeof request.data?.displayName === 'string'
      ? request.data.displayName.trim().slice(0, 120)
      : '';

    const db = admin.firestore();

    // Make sure the company doc exists so security rules for members work.
    const companySnap = await companyRef.get();
    if (!companySnap.exists) {
      await companyRef.set({
        ownerId: callerUid,
        name: (request.auth.token.name || 'My Company'),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    let userRecord;
    let created = false;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        userRecord = await admin.auth().createUser({
          email,
          emailVerified: false,
          displayName: displayName || email.split('@')[0],
          disabled: false
        });
        created = true;
      } else {
        throw e;
      }
    }

    // Block cross-company poaching: if the target already has a different
    // companyId claim, require global admin to reassign.
    const existingClaims = userRecord.customClaims || {};
    if (existingClaims.companyId && existingClaims.companyId !== companyId && request.auth.token.role !== 'admin') {
      throw new HttpsError('already-exists', 'User is already a member of another company');
    }

    // Merge claims — preserve plan/subscriptionStatus if present.
    const newClaims = {
      ...existingClaims,
      companyId,
      role
    };
    await admin.auth().setCustomUserClaims(userRecord.uid, newClaims);

    const memberRef = db.doc(`companies/${companyId}/members/${email}`);
    await memberRef.set({
      email,
      role,
      displayName: displayName || userRecord.displayName || email.split('@')[0],
      uid: userRecord.uid,
      status: created ? 'invited' : 'active',
      invitedAt: admin.firestore.FieldValue.serverTimestamp(),
      invitedBy: callerUid,
      active: true
    }, { merge: true });

    // Seed user profile doc so the user list query has a name to show.
    await db.doc(`users/${userRecord.uid}`).set({
      email,
      displayName: displayName || userRecord.displayName || email.split('@')[0],
      companyId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // M-5: hash email before logging so Cloud Logging retention can't
    // leak PII. Log the first 16 hex chars — enough for correlation
    // between admins and audit_log entries, not enough for reversal.
    const emailHash = require('crypto').createHash('sha256').update(email).digest('hex').slice(0, 16);
    logger.info('createTeamMember', { companyId, emailHash, role, created });
    return {
      success: true,
      uid: userRecord.uid,
      email,
      role,
      status: created ? 'invited' : 'active',
      created
    };
  }
);

// ── updateUserRole ───────────────────────────────────────────
// Change an existing team member's role. Rewrites custom claims
// and the member doc. Won't let a non-admin promote to admin or
// demote the company owner.
exports.updateUserRole = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const { uid: callerUid, companyId, companyRef } = await requireTeamAdmin(request);

    const targetUid = typeof request.data?.uid === 'string' ? request.data.uid : null;
    const targetEmail = normalizeEmail(request.data && request.data.email);
    if (!targetUid && !targetEmail) {
      throw new HttpsError('invalid-argument', 'Target uid or email required');
    }

    const role = normalizeRole(request.data && request.data.role);
    if (!role) throw new HttpsError('invalid-argument', 'Invalid role');

    const isGlobalAdmin = request.auth.token.role === 'admin';

    // Resolve the target user.
    let userRecord;
    try {
      userRecord = targetUid
        ? await admin.auth().getUser(targetUid)
        : await admin.auth().getUserByEmail(targetEmail);
    } catch (e) {
      throw new HttpsError('not-found', 'User not found');
    }

    const existingClaims = userRecord.customClaims || {};
    // Block changing a user from a different company unless platform admin.
    if (existingClaims.companyId && existingClaims.companyId !== companyId && !isGlobalAdmin) {
      throw new HttpsError('permission-denied', 'User belongs to another company');
    }

    // Prevent demoting the company owner through this path. The owner
    // must keep at least company_admin privileges; downgrade requires
    // transferring ownership first.
    const companySnap = await companyRef.get();
    const ownerId = companySnap.exists ? companySnap.data().ownerId : null;
    if (ownerId && userRecord.uid === ownerId && role !== 'company_admin' && !isGlobalAdmin) {
      throw new HttpsError('failed-precondition', 'Cannot demote the company owner');
    }

    await admin.auth().setCustomUserClaims(userRecord.uid, {
      ...existingClaims,
      companyId,
      role
    });

    const emailKey = (userRecord.email || targetEmail || '').toLowerCase();
    if (emailKey) {
      await admin.firestore().doc(`companies/${companyId}/members/${emailKey}`).set({
        role,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: callerUid
      }, { merge: true });
    }

    logger.info('updateUserRole', { companyId, targetUid: userRecord.uid, role });
    return { success: true, uid: userRecord.uid, role };
  }
);

// ── deactivateUser ───────────────────────────────────────────
// Disable the Firebase Auth account and mark the member doc
// deactivated. Data is preserved; toggle `reactivate: true` to
// re-enable. Won't let anyone deactivate the company owner.
exports.deactivateUser = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const { uid: callerUid, companyId, companyRef } = await requireTeamAdmin(request);

    const targetUid = typeof request.data?.uid === 'string' ? request.data.uid : null;
    const targetEmail = normalizeEmail(request.data && request.data.email);
    if (!targetUid && !targetEmail) {
      throw new HttpsError('invalid-argument', 'Target uid or email required');
    }
    const reactivate = request.data?.reactivate === true;

    let userRecord;
    try {
      userRecord = targetUid
        ? await admin.auth().getUser(targetUid)
        : await admin.auth().getUserByEmail(targetEmail);
    } catch (e) {
      throw new HttpsError('not-found', 'User not found');
    }

    const existingClaims = userRecord.customClaims || {};
    const isGlobalAdmin = request.auth.token.role === 'admin';
    if (existingClaims.companyId && existingClaims.companyId !== companyId && !isGlobalAdmin) {
      throw new HttpsError('permission-denied', 'User belongs to another company');
    }

    // Safety: never kill the owner's login from this path.
    const companySnap = await companyRef.get();
    const ownerId = companySnap.exists ? companySnap.data().ownerId : null;
    if (ownerId && userRecord.uid === ownerId) {
      throw new HttpsError('failed-precondition', 'Cannot deactivate the company owner');
    }
    // Don't let the caller lock themselves out.
    if (userRecord.uid === callerUid) {
      throw new HttpsError('failed-precondition', 'Cannot deactivate your own account');
    }

    await admin.auth().updateUser(userRecord.uid, { disabled: !reactivate });
    // Revoke tokens when deactivating so existing sessions die.
    if (!reactivate) {
      await admin.auth().revokeRefreshTokens(userRecord.uid);
    }

    const emailKey = (userRecord.email || targetEmail || '').toLowerCase();
    if (emailKey) {
      await admin.firestore().doc(`companies/${companyId}/members/${emailKey}`).set({
        status: reactivate ? 'active' : 'deactivated',
        active: !!reactivate,
        deactivatedAt: reactivate ? null : admin.firestore.FieldValue.serverTimestamp(),
        deactivatedBy: reactivate ? null : callerUid
      }, { merge: true });
    }

    logger.info(reactivate ? 'reactivateUser' : 'deactivateUser', {
      companyId, targetUid: userRecord.uid
    });
    return { success: true, uid: userRecord.uid, disabled: !reactivate };
  }
);

// ── listTeamMembers ──────────────────────────────────────────
// Returns the team roster enriched with Auth data (lastSignInTime,
// disabled) and a lead count per member. The member doc by itself
// has email/role/status; the extras come from Auth + a cheap
// collectionGroup count on leads.
exports.listTeamMembers = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    const claims = request.auth.token || {};
    const isGlobalAdmin = claims.role === 'admin';
    const isManager = claims.role === 'manager';
    const callerCompanyId = claims.companyId || uid;
    const companyId = (request.data && request.data.companyId) || callerCompanyId;

    // Managers and owners can list their own team. Admins can list any.
    if (!isGlobalAdmin && companyId !== callerCompanyId) {
      throw new HttpsError('permission-denied', 'Cannot view another company');
    }

    const db = admin.firestore();
    const companySnap = await db.doc(`companies/${companyId}`).get();
    const ownerId = companySnap.exists ? companySnap.data().ownerId : null;
    if (!isGlobalAdmin && !isManager && ownerId !== uid) {
      throw new HttpsError('permission-denied', 'Owner, manager, or admin required');
    }

    const membersSnap = await db.collection(`companies/${companyId}/members`).get();
    const members = [];

    // Always include the owner card first.
    if (ownerId) {
      try {
        const ownerRecord = await admin.auth().getUser(ownerId);
        members.push({
          uid: ownerId,
          email: (ownerRecord.email || '').toLowerCase(),
          displayName: ownerRecord.displayName || 'Owner',
          role: 'company_admin',
          status: ownerRecord.disabled ? 'deactivated' : 'active',
          isOwner: true,
          disabled: !!ownerRecord.disabled,
          lastSignInTime: ownerRecord.metadata?.lastSignInTime || null,
          creationTime: ownerRecord.metadata?.creationTime || null,
          leadCount: 0
        });
      } catch (e) {
        logger.warn('listTeamMembers: owner lookup failed', { ownerId, err: e.message });
      }
    }

    for (const doc of membersSnap.docs) {
      const m = doc.data() || {};
      if (!m.email) continue;
      if (m.uid && m.uid === ownerId) continue; // owner already listed

      let authMeta = null;
      try {
        const u = m.uid
          ? await admin.auth().getUser(m.uid)
          : await admin.auth().getUserByEmail(m.email);
        authMeta = {
          uid: u.uid,
          disabled: !!u.disabled,
          lastSignInTime: u.metadata?.lastSignInTime || null,
          creationTime: u.metadata?.creationTime || null
        };
      } catch (e) { /* invited but not signed up yet */ }

      // Lead count — skip if member never activated (no uid to match).
      let leadCount = 0;
      if (authMeta?.uid) {
        try {
          const leadsSnap = await db.collection('leads')
            .where('userId', '==', authMeta.uid)
            .count()
            .get();
          leadCount = leadsSnap.data().count || 0;
        } catch (e) { /* counts may fail on missing index; leave 0 */ }
      }

      members.push({
        uid: authMeta?.uid || m.uid || null,
        email: m.email,
        displayName: m.displayName || m.email.split('@')[0],
        role: m.role || 'sales_rep',
        status: authMeta?.disabled
          ? 'deactivated'
          : (m.status || (authMeta ? 'active' : 'invited')),
        isOwner: false,
        disabled: !!authMeta?.disabled,
        lastSignInTime: authMeta?.lastSignInTime || null,
        creationTime: authMeta?.creationTime || m.invitedAt?.toDate?.()?.toISOString() || null,
        leadCount
      });
    }

    return { success: true, companyId, members, count: members.length };
  }
);
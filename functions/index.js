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

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Stripe = require('stripe');

admin.initializeApp();

// Secrets stored in Firebase Secret Manager
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const STRIPE_PRICE_FOUNDATION = defineSecret('STRIPE_PRICE_FOUNDATION');
const STRIPE_PRICE_PROFESSIONAL = defineSecret('STRIPE_PRICE_PROFESSIONAL');

// CORS origins
const CORS_ORIGINS = ['https://nobigdealwithjoedeal.com', 'https://nobigdeal-pro.web.app', 'http://localhost:5000'];

exports.claudeProxy = onRequest(
  {
    cors: ['https://nobigdealwithjoedeal.com', 'https://nobigdeal-pro.web.app', 'http://localhost:5000'],
    secrets: [ANTHROPIC_API_KEY],
    maxInstances: 10,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    // Only POST allowed
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Verify Firebase auth token
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!idToken) {
      res.status(401).json({ error: 'Missing authorization token' });
      return;
    }

    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      if (!decoded.uid) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }

      // Rate limiting check (simple — per-user, per-minute)
      const userRef = admin.firestore().doc(`rate_limits/${decoded.uid}`);
      const userSnap = await userRef.get();
      const now = Date.now();
      const windowMs = 60000; // 1 minute
      const maxRequests = 30;  // 30 requests per minute

      if (userSnap.exists()) {
        const data = userSnap.data();
        const windowStart = data.windowStart || 0;
        const count = data.count || 0;

        if (now - windowStart < windowMs && count >= maxRequests) {
          res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
          return;
        }

        if (now - windowStart >= windowMs) {
          await userRef.set({ windowStart: now, count: 1 });
        } else {
          await userRef.update({ count: count + 1 });
        }
      } else {
        await userRef.set({ windowStart: now, count: 1 });
      }

      // Forward to Anthropic
      const { model, max_tokens, messages, system, temperature } = req.body;

      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: 'messages array required' });
        return;
      }

      const anthropicBody = {
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: Math.min(max_tokens || 1000, 4096), // Cap at 4096
        messages,
      };
      if (system) anthropicBody.system = system;
      if (temperature !== undefined) anthropicBody.temperature = temperature;

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
        res.status(response.status).json(data);
        return;
      }

      // Log usage for analytics
      try {
        await admin.firestore().collection('api_usage').add({
          uid: decoded.uid,
          model: anthropicBody.model,
          inputTokens: data.usage?.input_tokens || 0,
          outputTokens: data.usage?.output_tokens || 0,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        // Non-critical — don't fail the request
        console.warn('Usage logging failed:', e);
      }

      res.json(data);

    } catch (e) {
      console.error('Claude proxy error:', e);
      if (e.code === 'auth/id-token-expired') {
        res.status(401).json({ error: 'Token expired — please re-authenticate' });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
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
    maxInstances: 10,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Verify Firebase auth token
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!idToken) {
      res.status(401).json({ error: 'Missing authorization token' });
      return;
    }

    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      if (!decoded.uid || !decoded.email) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }

      const { plan } = req.body;

      // Validate plan
      if (!['foundation', 'professional'].includes(plan)) {
        res.status(400).json({ error: 'Invalid plan. Must be "foundation" or "professional".' });
        return;
      }

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
    maxInstances: 10,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Verify Firebase auth token
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!idToken) {
      res.status(401).json({ error: 'Missing authorization token' });
      return;
    }

    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      if (!decoded.uid) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }

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
    maxInstances: 10,
    timeoutSeconds: 10,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Verify Firebase auth token
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!idToken) {
      res.status(401).json({ error: 'Missing authorization token' });
      return;
    }

    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      if (!decoded.uid) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }

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
        stripeCustomerId: data.stripeCustomerId,
        stripeSubscriptionId: data.stripeSubscriptionId,
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
    maxInstances: 10,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Verify Firebase auth token
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!idToken) {
      res.status(401).json({ error: 'Missing authorization token' });
      return;
    }

    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      if (!decoded.uid) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }

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

      // Initialize Stripe
      const stripe = new Stripe(STRIPE_SECRET_KEY.value());

      // Build line items for payment link
      const lineItems = (invoice.items || []).map(item => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.description,
            description: `Invoice ${invoiceId}`,
          },
          unit_amount: Math.round(item.total * 100), // Convert to cents
        },
        quantity: 1,
      }));

      // Create Payment Link
      const paymentLink = await stripe.paymentLinks.create({
        line_items: lineItems,
        after_completion: {
          type: 'redirect',
          redirect: {
            url: `https://nobigdeal-pro.web.app/pro/invoice-success.html?invoiceId=${invoiceId}`,
          },
        },
      });

      console.log(`Payment link created: ${paymentLink.url} for invoice ${invoiceId}`);

      res.json({ url: paymentLink.url, paymentLinkId: paymentLink.id });

    } catch (e) {
      console.error('createStripePaymentLink error:', e);
      if (e.code === 'auth/id-token-expired') {
        res.status(401).json({ error: 'Token expired — please re-authenticate' });
      } else {
        res.status(500).json({ error: 'Failed to create payment link' });
      }
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

        if (invoiceId) {
          const db = admin.firestore();
          await db.collection('invoices').doc(invoiceId).update({
            status: 'paid',
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            stripePaymentIntentId: paymentIntent.id,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          console.log(`Invoice ${invoiceId} marked as paid via Stripe`);
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


// ═══════════════════════════════════════════════════════════════════
// validateAccessCode — Server-side access code validation
// Keeps credentials out of client-side JavaScript
// ═══════════════════════════════════════════════════════════════════
const { onCall } = require('firebase-functions/v2/https');

exports.validateAccessCode = onCall(
  {
    maxInstances: 10,
    timeoutSeconds: 15,
    memory: '256MiB',
  },
  async (request) => {
    const { code } = request.data || {};

    if (!code || typeof code !== 'string') {
      return { success: false, error: 'Access code required' };
    }

    const normalized = code.trim().toUpperCase();

    // Access code → Firebase auth credentials (server-side only)
    const ACCESS_CODES = {
      'NBD-2026':  { email: 'invite.2026@nobigdeal.pro',  pass: 'nbd_invite_2026!', role: 'member' },
      'DEAL-2026': { email: 'invite.2026@nobigdeal.pro',  pass: 'nbd_invite_2026!', role: 'member' },
      'NBD-DEMO':  { email: 'demo@nobigdeal.pro',          pass: 'nbd_demo_access!', role: 'demo' },
      'DEMO':      { email: 'demo@nobigdeal.pro',          pass: 'nbd_demo_access!', role: 'demo' },
      'TRYIT':     { email: 'demo@nobigdeal.pro',          pass: 'nbd_demo_access!', role: 'demo' },
    };

    const creds = ACCESS_CODES[normalized];
    if (!creds) {
      console.warn(`Invalid access code attempt: ${normalized}`);
      return { success: false, error: 'Code not recognized' };
    }

    try {
      // Look up or create the Firebase user, then generate a custom token
      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(creds.email);
      } catch (e) {
        if (e.code === 'auth/user-not-found') {
          userRecord = await admin.auth().createUser({
            email: creds.email,
            password: creds.pass,
            displayName: creds.role === 'demo' ? 'Demo User' : 'Invited Member'
          });
        } else {
          throw e;
        }
      }

      // Generate custom token for client-side signIn
      const customToken = await admin.auth().createCustomToken(userRecord.uid, {
        role: creds.role,
        accessCode: normalized
      });

      console.log(`Access code validated: ${normalized} → ${creds.email}`);
      return { success: true, token: customToken, role: creds.role };

    } catch (e) {
      console.error('validateAccessCode error:', e);
      return { success: false, error: 'Authentication error. Please try again.' };
    }
  }
);
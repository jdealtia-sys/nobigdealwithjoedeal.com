/**
 * functions/stripe.js — Stripe Cloud Functions.
 *
 * L-03 continuation. Six handlers extracted verbatim from
 * functions/index.js: createCheckoutSession, stripeWebhook,
 * createCustomerPortalSession, getSubscriptionStatus,
 * createStripePaymentLink, invoiceWebhook.
 *
 * index.js loads this via `Object.assign(exports, require('./stripe'))`
 * — same pattern used for functions/portal.js (L-03).
 *
 * No behaviour change. Every handler keeps its exact config
 * (maxInstances, concurrency, timeoutSeconds, minInstances, memory,
 * secrets, cors, enforceAppCheck) and body.
 */

'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const Stripe = require('stripe');

// Shared helpers (B2).
const { requireAuth } = require('./shared');
const { httpRateLimit } = require('./integrations/upstash-ratelimit');

// Stripe secrets. Redeclared here because defineSecret scope is
// per-module. index.js still declares them too for claudeProxy +
// other endpoints. Both declarations resolve to the SAME underlying
// Secret Manager entry — no duplication at runtime.
const STRIPE_SECRET_KEY         = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET     = defineSecret('STRIPE_WEBHOOK_SECRET');
const STRIPE_PRICE_FOUNDATION   = defineSecret('STRIPE_PRICE_FOUNDATION');
const STRIPE_PRICE_PROFESSIONAL = defineSecret('STRIPE_PRICE_PROFESSIONAL');

// CORS origins — same allowlist as index.js + portal.js. Deliberately
// duplicated for module independence (matches portal.js precedent).
const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

exports.createCheckoutSession = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [STRIPE_SECRET_KEY, STRIPE_PRICE_FOUNDATION, STRIPE_PRICE_PROFESSIONAL],
    enforceAppCheck: true,
    // R-05 sizing: conversion funnel spike — if 10k trial users are
    // prompted to subscribe at once (email campaign, end-of-trial
    // cron), the checkout click-through rate of 5-10% still maps to
    // 500-1000 concurrent checkout creates. Old 20×40 = 800 was
    // right at the edge; 50×40 = 2000 gives 2× headroom. Stripe
    // API latency (~400ms) keeps instances busy briefly per call.
    maxInstances: 50,
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

exports.stripeWebhook = onRequest(
  {
    cors: false, // Webhook should not use CORS
    // F-08: price secrets are read inside the handler to map
    // Stripe Price IDs to our plan tier. Must be declared here
    // so .value() resolves at runtime.
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
              STRIPE_PRICE_FOUNDATION, STRIPE_PRICE_PROFESSIONAL],
    // R-05 sizing: Stripe's retry fanout (up to 15 retries over 3
    // days on failure) + bulk billing cycle events (invoice.paid
    // fires for every active sub on billing day) can burst. Old
    // maxInstances:10 was enough for steady state but tight for
    // month-start. 20 with Cloud Run's default concurrency (80)
    // gives headroom for a few hundred concurrent webhook deliveries.
    maxInstances: 20,
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
      // Stripe retries webhooks up to 15 times. F-07: the previous
      // check-then-write pattern left a window where two concurrent
      // deliveries of the same event.id could both pass the exists()
      // check and both process. Use create() — atomic, fails if the
      // doc already exists.
      const eventRef = db.doc(`stripe_events/${event.id}`);
      try {
        await eventRef.create({
          type: event.type,
          processedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (e) {
        // code 6 = ALREADY_EXISTS. Duplicate delivery — ack Stripe so
        // it stops retrying, but do nothing else.
        if (e.code === 6 || /already exists/i.test(String(e.message))) {
          logger.info('stripeWebhook.duplicate_event', { eventId: event.id });
          res.json({ received: true, duplicate: true });
          return;
        }
        throw e;
      }

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

          // F-08: derive plan from Stripe Price ID via an in-code
          // map, not from price.metadata.plan. Stripe metadata is
          // editable in the dashboard — trusting it for authorization
          // puts tier grants one click from anyone with Stripe write
          // access. Price IDs are immutable secrets known only to
          // deploy.
          const PRICE_TO_PLAN = {
            [STRIPE_PRICE_FOUNDATION.value()]:   'starter',
            [STRIPE_PRICE_PROFESSIONAL.value()]: 'growth'
          };
          const priceId = subscription.items?.data?.[0]?.price?.id || '';
          let plan = PRICE_TO_PLAN[priceId] || subDoc.data().plan || 'starter';

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

          // E1: dunning. Enqueue an email to the rep, Slack the ops
          // channel, and stamp a lead activity row if the invoice
          // has a leadId on its metadata (auto-invoice C5 sets it).
          try {
            const userRecord = await admin.auth().getUser(uid);
            const email = userRecord.email;
            const leadId = (invoice.metadata && invoice.metadata.leadId) || null;
            const estimateId = (invoice.metadata && invoice.metadata.estimateId) || null;
            const amount = ((invoice.amount_due || 0) / 100).toFixed(2);

            if (email) {
              await db.collection('email_queue').add({
                to: email,
                subject: 'Payment failed — $' + amount + ' — NBD Pro',
                bodyPlain:
                  'A customer payment attempt just failed.\n\n' +
                  'Invoice: ' + invoice.id + '\n' +
                  'Amount:  $' + amount + '\n' +
                  (invoice.hosted_invoice_url
                    ? 'Link:    ' + invoice.hosted_invoice_url + '\n'
                    : '') +
                  '\nReach out to the customer to update their card. Stripe will auto-retry 3 more times.',
                status: 'pending',   // F-wave fix: worker filters on this field
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                source: 'stripe_dunning'
              });
            }

            if (leadId) {
              await db.collection('leads/' + leadId + '/activity').add({
                userId: uid,
                type: 'stripe_payment_failed',
                label: 'Payment failed ($' + amount + ')',
                stripeInvoiceId: invoice.id,
                stripeCustomerId: customerId,
                amountCents: invoice.amount_due || 0,
                hostedInvoiceUrl: invoice.hosted_invoice_url || null,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
              });
            }

            // Slack — only posts when SLACK_WEBHOOK_URL secret is set.
            const slack = require('./integrations/slack');
            if (typeof slack.postSlack === 'function') {
              await slack.postSlack({
                text: '💳 Payment failed ($' + amount + ')',
                blocks: [{
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text:
                      '*💳 Stripe payment failed*\n' +
                      'Amount: *$' + amount + '*\n' +
                      'Invoice: `' + invoice.id + '`\n' +
                      (estimateId ? 'Estimate: `' + estimateId + '`\n' : '') +
                      (leadId ? 'Lead: `' + leadId + '`\n' : '') +
                      (invoice.hosted_invoice_url ? 'Hosted: ' + invoice.hosted_invoice_url : '')
                  }
                }]
              });
            }
          } catch (e) {
            logger.warn('dunning: enqueue failed', { err: e.message });
          }

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

exports.getSubscriptionStatus = onRequest(
  {
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    // R-05 sizing: called on every pro-surface page load (the NBDAuth
    // init path at docs/pro/js/nbd-auth.js fetches the subscription
    // doc directly via Firestore, but this function is the server-
    // authoritative fallback and is called by billing-status panels
    // on dashboard/settings/stripe-success). A 10k concurrent page-
    // load spike maps directly onto this endpoint. Old 50×80 = 4k
    // ceiling 429'd legitimate users. 200×80 = 16k headroom.
    // minInstances:2 prevents the "1s loading spinner on every
    // dashboard open" UX cost.
    maxInstances: 200,
    concurrency: 80,
    minInstances: 2,
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

exports.invoiceWebhook = onRequest(
  {
    cors: false, // Webhook should not use CORS
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
    // R-05 sizing: payment_intent.succeeded fanout on bulk billing
    // days. 10 is a reasonable ceiling now that we've grown;
    // mirrors stripeWebhook's headroom without over-provisioning.
    maxInstances: 10,
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

      // ── Idempotency guard ──
      // Mirrors the stripeWebhook pattern (F-07). Stripe retries up to
      // 15 times on transient failure; the current "update invoice to
      // paid" body is idempotent for the invoice doc itself, but any
      // future side effects (receipt emails, Slack notifications,
      // analytics events) MUST NOT fire twice — so gate the whole
      // handler behind an atomic create() that fails on duplicate.
      const db = admin.firestore();
      const eventRef = db.doc(`stripe_events/${event.id}`);
      try {
        await eventRef.create({
          type: event.type,
          source: 'invoiceWebhook',
          processedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (e) {
        if (e.code === 6 || /already exists/i.test(String(e.message))) {
          logger.info('invoiceWebhook.duplicate_event', { eventId: event.id });
          res.json({ received: true, duplicate: true });
          return;
        }
        throw e;
      }

      // Handle payment_intent.succeeded event
      if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const metadata = paymentIntent.metadata || {};
        const invoiceId = metadata.invoiceId;
        const claimedUserId = metadata.userId;

        if (invoiceId) {
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

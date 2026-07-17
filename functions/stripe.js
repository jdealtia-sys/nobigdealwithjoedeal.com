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
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue } = require('firebase-admin/firestore');
const Stripe = require('stripe');

// Pin the Stripe API version explicitly. stripe-node 14.x defaults to
// '2023-10-16'; without an explicit pin, bumping the SDK (e.g. #654 → v22)
// would silently change the API version every request uses — altering webhook
// event shapes + checkout behavior on the LIVE billing path. Pinning to the
// version we already run makes any SDK upgrade behavior-neutral; a deliberate
// API-version upgrade is then a separate, testable change.
const STRIPE_API_VERSION = '2023-10-16';

// Shared helpers (B2).
const { requireAuth } = require('./shared');
const { httpRateLimit } = require('./integrations/upstash-ratelimit');

// setCustomUserClaims REPLACES the entire claim set. Writing a bare billing
// patch ({ plan, subscriptionStatus, stripeCustomerId }) therefore WIPES a
// user's role/companyId on every billing event — turning a tenant company_admin
// into a no-companyId account, which (a) breaks their own company-scoped
// Firestore access and (b) makes them a cross-tenant takeover target for the
// team-admin callables. Always read-then-merge so identity claims survive.
async function mergeCustomClaims(uid, patch) {
  // Read-then-merge is only safe when the READ succeeds. On a transient getUser
  // failure, writing a bare patch would strip role/companyId — the exact wipe
  // this helper exists to prevent — so abort and let the next billing event
  // re-sync (the subscriptions/{uid} doc is written separately and survives).
  let existing;
  try { existing = (await getAuth().getUser(uid)).customClaims || {}; }
  catch (e) {
    logger.error('mergeCustomClaims_abort_getUser_failed', { uid, err: e.message });
    return;
  }
  await getAuth().setCustomUserClaims(uid, { ...existing, ...patch });
}

// Stripe secrets. Redeclared here because defineSecret scope is
// per-module. index.js still declares them too for claudeProxy +
// other endpoints. Both declarations resolve to the SAME underlying
// Secret Manager entry — no duplication at runtime.
const STRIPE_SECRET_KEY         = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET     = defineSecret('STRIPE_WEBHOOK_SECRET');
// Stripe issues a DISTINCT signing secret per webhook endpoint, but both
// endpoints used to verify against the single STRIPE_WEBHOOK_SECRET — so the
// moment that secret was set to the subscription endpoint's whsec, every
// invoiceWebhook delivery would fail verification forever. invoiceWebhook now
// prefers this dedicated secret and falls back to the legacy shared one while
// the value is still the PENDING-ROTATION placeholder (2026-07-16).
const STRIPE_INVOICE_WEBHOOK_SECRET = defineSecret('STRIPE_INVOICE_WEBHOOK_SECRET');
const STRIPE_PRICE_FOUNDATION   = defineSecret('STRIPE_PRICE_FOUNDATION');
const STRIPE_PRICE_PROFESSIONAL = defineSecret('STRIPE_PRICE_PROFESSIONAL');
// Team ($149/mo, 2 seats) — the mid-tier between Starter and Growth. Set this
// secret to the Team recurring Stripe Price ID after creating the product.
const STRIPE_PRICE_TEAM         = defineSecret('STRIPE_PRICE_TEAM');

// ── Shared Stripe client ────────────────────────────────────────────
// Single source for the SDK instance across all 5 handlers (was a separate
// `new Stripe(SECRET.value(), …)` in each). Two things this centralizes:
//   1. TRIM the secret key. A stored STRIPE_SECRET_KEY with a trailing newline
//      (how it got pasted into Secret Manager) made the SDK throw ERR_INVALID_CHAR
//      setting the Authorization header → surfaced as an opaque "An error
//      occurred with our connection to Stripe. Request was retried N times" 500,
//      which looks like a Stripe outage but is purely the tainted key. .trim()
//      kills it. (Supersedes the per-site trim in draft PR #711.)
//   2. maxNetworkRetries + a bounded timeout so a transient network blip
//      self-heals instead of bubbling up as a 500.
// Memoized: the key is constant per deployment, so one client is reused across
// warm invocations. value() is read lazily (inside the handler, where the secret
// is bound) — never at module load.
let _stripeClient = null;
function getStripe() {
  if (_stripeClient) return _stripeClient;
  const raw = STRIPE_SECRET_KEY.value();
  const key = String(raw == null ? '' : raw).trim();
  if (!key) throw new Error('STRIPE_SECRET_KEY is empty/unset');
  _stripeClient = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20000,
  });
  return _stripeClient;
}

// CORS origins — same allowlist as index.js + portal.js. Deliberately
// duplicated for module independence (matches portal.js precedent).
const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

// ── Plan + purchased-seat derivation from a subscription's line items ──
// Both webhook cases used to read items.data[0] only. That breaks the moment
// a subscription carries a SECOND line item (the per-seat add-on, Route 1):
// if the seat item happens to sort first, checkout.session.completed derives
// "unknown price" and silently DOWNGRADES a paying tenant to starter, and
// customer.subscription.updated freezes them on the stale stored plan.
// Scan every item instead: the item whose price is in PRICE_TO_PLAN names the
// plan; every OTHER item's quantity is a purchased extra seat. This read path
// needs no seat-price secret — it works by exclusion, so it deploys before
// STRIPE_PRICE_SEAT exists and stays correct after.
// `priceToPlan` is passed in because the map is built per-request from
// secrets (.value() only resolves inside a handler).
function derivePlanAndSeats(items, priceToPlan) {
  const data = items && Array.isArray(items.data) ? items.data : [];
  let plan = null;
  let purchasedSeats = 0;
  for (const item of data) {
    const priceId = item && item.price && item.price.id;
    const mapped = priceId ? priceToPlan[priceId] : undefined;
    if (mapped) {
      // First plan-price item wins; a duplicate plan item is anomalous and
      // must never be counted as seats.
      if (!plan) plan = mapped;
    } else {
      const qty = Math.floor(Number(item && item.quantity));
      if (Number.isFinite(qty) && qty > 0) purchasedSeats += qty;
    }
  }
  return { plan, purchasedSeats };
}

exports.createCheckoutSession = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [STRIPE_SECRET_KEY, STRIPE_PRICE_FOUNDATION, STRIPE_PRICE_PROFESSIONAL, STRIPE_PRICE_TEAM],
    enforceAppCheck: true,
    // Explicit public ingress: browser fetch calls this directly. Declared in
    // code so a redeploy can never drop the allUsers run.invoker binding again
    // (2026-07-16: stripewebhook/getsubscriptionstatus/createcustomerportalsession
    // shipped with EMPTY invoker IAM and 403'd every request pre-handler).
    // Auth stays enforced in-code (requireAuth / Stripe signatures).
    invoker: 'public',
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
    // Unverified email no longer blocks checkout: the ID token already proves
    // account ownership, Stripe's hosted checkout re-collects the receipt
    // email, and the hard 403 sat exactly at the moment of buying intent — a
    // fresh signup couldn't pay until they went hunting for the verification
    // email (product audit 2026-07, funnel break #3). Logged for visibility.
    if (!decoded.email_verified) {
      logger.info('createCheckoutSession_unverified_email_proceeding', { uid: decoded.uid });
    }

    try {
      const { plan } = req.body;

      // Validate plan — accept both old names (foundation/professional)
      // and new names (starter/growth) for backwards compatibility
      const VALID_PLANS = ['foundation', 'professional', 'starter', 'team', 'growth'];
      if (!VALID_PLANS.includes(plan)) {
        res.status(400).json({ error: 'Invalid plan. Must be starter, team, growth, foundation, or professional.' });
        return;
      }
      // Normalize old names → new names for consistent storage (team is already canonical).
      const normalizedPlan = plan === 'foundation' ? 'starter' : (plan === 'professional' ? 'growth' : plan);
      // Remove the "free subscription while checkout is open" loophole — any prior
      // client-side self-write to subscriptions gets overwritten on webhook return
      // anyway, but the rules now block client writes entirely.

      // Get price ID based on plan
      // Maps both old and new plan names to Stripe Price IDs.
      // STRIPE_PRICE_FOUNDATION = Starter ($99/mo), STRIPE_PRICE_PROFESSIONAL =
      // Growth ($299/mo — the price sold on /pro/pricing and in the Terms table;
      // the Stripe price object is the charged truth, keep them in sync).
      const priceId = normalizedPlan === 'starter' ? STRIPE_PRICE_FOUNDATION.value()
        : normalizedPlan === 'team' ? STRIPE_PRICE_TEAM.value()
        : STRIPE_PRICE_PROFESSIONAL.value();

      // Billing is keyed to the COMPANY, not the purchaser (locked decision:
      // subscriptions/{companyId}). For solo owners companyId == uid; for a
      // company_admin buying on the owner's behalf this keeps the entitlement
      // on the company doc that nbd-auth/billing-gate/trackUsage actually read,
      // instead of stranding it under the admin's own uid.
      const billingKey = decoded.companyId || decoded.uid;

      // Initialize Stripe
      const stripe = getStripe();

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
        client_reference_id: billingKey,
        customer_email: decoded.email,
        metadata: {
          firebaseUid: decoded.uid,
          companyId: billingKey,
          plan: normalizedPlan,
        },
        // 14-day trial on the paid team tiers (Team + Growth). Hosted Checkout
        // still collects a card up front (payment_method_collection defaults to
        // 'always'); the pricing page copy matches. Starter has no trial.
        ...((normalizedPlan === 'growth' || normalizedPlan === 'team') ? {
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
    // Stripe's servers call this unauthenticated — public ingress is
    // REQUIRED. Declared in code because this service shipped with an
    // empty invoker IAM policy (2026-07-16): every Stripe delivery
    // 403'd at Google's front door and no subscription was ever
    // activated. Security = signature verification below, not IAM.
    invoker: 'public',
    // F-08: price secrets are read inside the handler to map
    // Stripe Price IDs to our plan tier. Must be declared here
    // so .value() resolves at runtime.
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
              STRIPE_PRICE_FOUNDATION, STRIPE_PRICE_PROFESSIONAL, STRIPE_PRICE_TEAM],
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

    const stripe = getStripe();
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
      const db = getFirestore();

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
          processedAt: FieldValue.serverTimestamp()
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

      // ═══════════════════════════════════════════════════
      // PLAN TIER EXTRACTION HELPER
      // Maps Stripe Price IDs to NBD plan tiers. The IDs
      // are set as Firebase secrets. Unknown prices fall
      // back to 'starter'. NOTE: Enterprise has NO Stripe
      // path at all — custom-priced deals are granted by a
      // manual admin write of subscriptions/{companyId}
      // (plan:'enterprise') + claims; nothing here can mint
      // an enterprise plan (metadata allowlist below is
      // starter/growth only).
      // Hoisted out of the switch (was previously inline in
      // customer.subscription.updated only — see F-08) so
      // checkout.session.completed can apply the same
      // price-ID-trusted derivation (Audit G).
      // ═══════════════════════════════════════════════════
      const PRICE_TO_PLAN = {
        [STRIPE_PRICE_FOUNDATION.value()]:   'starter',
        [STRIPE_PRICE_TEAM.value()]:         'team',
        [STRIPE_PRICE_PROFESSIONAL.value()]: 'growth'
      };

      switch (event.type) {

        case 'checkout.session.completed': {
          const session = event.data.object;
          const uid = session.client_reference_id;
          const customerId = session.customer;

          if (!uid) {
            logger.warn('stripeWebhook.checkout_session_completed missing client_reference_id');
            break;
          }

          // Audit G: derive plan from the Stripe Price ID, not from
          // session.metadata. F-08 already flagged this trust pattern
          // for customer.subscription.updated; it applied just as much
          // to checkout.session.completed but the fix wasn't carried
          // forward. Stripe Dashboard metadata is editable by anyone
          // with Stripe write access, so trusting metadata.plan for
          // tier grants made a free "enterprise" promotion one click
          // away. Price IDs are immutable secrets known only to deploy.
          //
          // Fall back to metadata.plan only if the subscription lookup
          // fails AND the value is one we'd accept (defensive — should
          // never happen for a real checkout session, but better than
          // silently downgrading a paying customer to 'starter').
          let plan = 'starter';
          // Real Stripe status, not an 'active' literal: a Growth checkout
          // starts a 14-day trial, so the true status is 'trialing' until the
          // first charge. Both count as paid everywhere (nbd-auth treats
          // active+trialing identically); writing the truth keeps the client
          // badge honest and spares a confusing flip on the first
          // subscription.updated event. Unknown/failed lookup → 'active'
          // (errs in the customer's favor).
          let subStatus = 'active';
          // Per-seat add-ons (Route 1): extra rep seats bought as additional
          // subscription-item quantity. Derived by exclusion (non-plan items),
          // persisted on the sub doc so the invite/assign/lapse cap sites can
          // grant base + purchased without any Stripe read.
          let purchasedSeats = 0;
          try {
            if (session.subscription) {
              const sub = await stripe.subscriptions.retrieve(session.subscription, {
                expand: ['items.data.price']
              });
              if (sub.status === 'trialing' || sub.status === 'active') subStatus = sub.status;
              const derived = derivePlanAndSeats(sub.items, PRICE_TO_PLAN);
              if (derived.plan) {
                plan = derived.plan;
                purchasedSeats = derived.purchasedSeats;
                // Tripwire: until the per-seat charging path (Route 1b)
                // ships, our checkout mints single-item subs only — any
                // nonzero here means an unexpected extra line item.
                if (purchasedSeats > 0) {
                  logger.info('purchased_seats_derived', { uid, purchasedSeats, sessionId: session.id });
                }
              } else {
                logger.warn('stripeWebhook.checkout_session_completed unknown_price', {
                  uid, priceId: sub.items?.data?.[0]?.price?.id || '', sessionId: session.id
                });
              }
            }
          } catch (e) {
            logger.warn('stripeWebhook.checkout_session_completed sub_lookup_failed', {
              uid, sessionId: session.id, err: e.message
            });
            // Fall back to metadata ONLY for the small allowlist we mint.
            const ALLOWED_FROM_METADATA = new Set(['starter', 'team', 'growth']);
            const meta = session.metadata?.plan;
            if (ALLOWED_FROM_METADATA.has(meta)) plan = meta;
          }

          const subData = {
            plan,
            status: subStatus,
            purchasedSeats,
            stripeSessionId: session.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: session.subscription || null,
            source: 'checkout',
            // Clear any lapse state — a fresh subscription ends the pause
            // lifecycle (cancelledAt survives merge writes otherwise and
            // the enforcement cron keys off it).
            lapseEnforced: false,
            cancelledAt: FieldValue.delete(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            // Seed the subscription.updated ordering high-water mark so a
            // stale updated event created before this checkout can't clobber
            // the fresh activation.
            lastSubEventAt: typeof event.created === 'number' ? event.created : FieldValue.delete(),
            // Usage counters — reset on subscription start
            usage: { leads: 0, reports: 0, aiCalls: 0, cycleStart: new Date().toISOString() }
          };

          await db.doc(`subscriptions/${uid}`).set(subData, { merge: true });

          // Reactivation after a lapse: restore exactly the seats the lapse
          // cron paused (deactivatedReason 'lapse'); owner-deactivated
          // members stay off. Non-fatal — a failure here must never break
          // subscription activation itself.
          try {
            const { reactivateLapsedSeats } = require('./lapse-enforcement');
            // Pass the new plan so a downgrade-on-return (e.g. Growth lapse →
            // Starter re-subscribe) restores only up to the new seat cap
            // instead of every previously-paused rep. purchasedSeats widens
            // that cap by the seats the tenant is still paying for.
            await reactivateLapsedSeats(db, uid, plan, purchasedSeats);
          } catch (e) {
            logger.warn('lapse_reactivation_failed', { uid, err: e.message });
          }

          // ── Set Firebase Auth custom claims ──
          // These claims are available in Firestore security rules
          // via request.auth.token.plan and in client JS via
          // user.getIdTokenResult().claims.plan
          try {
            await mergeCustomClaims(uid, {
              plan,
              subscriptionStatus: subStatus,
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
          const stored = subDoc.data() || {};

          // Event-ordering guard (Route 1b). Stripe does NOT guarantee webhook
          // delivery order. Two rapid subscription changes — e.g. the seat
          // stepper going 3 → 5 — can arrive reversed; without this, the stale
          // event's line-item snapshot overwrites the fresh one and the tenant
          // pays for 5 seats but is granted 3 (or the reverse: 3 paid, 5
          // granted) until the NEXT subscription event, possibly the monthly
          // renewal. Skip any event older than the newest we've applied to this
          // doc. event.created is unix seconds; same-second ties still process
          // (human-paced clicks + a confirm dialog never tie), and the stamp is
          // written in the same update() below so it advances monotonically.
          const eventCreated = typeof event.created === 'number' ? event.created : 0;
          const lastApplied = typeof stored.lastSubEventAt === 'number' ? stored.lastSubEventAt : 0;
          if (eventCreated && eventCreated < lastApplied) {
            logger.info('stripeWebhook.subscription_updated stale_event_skipped',
              { uid, eventCreated, lastApplied });
            break;
          }

          // F-08: derive plan from Stripe Price ID via the hoisted
          // PRICE_TO_PLAN map at the top of the switch (Audit G
          // promoted it so checkout.session.completed can apply the
          // same defense). Stripe metadata is editable in the
          // dashboard — trusting it for authorization puts tier grants
          // one click from anyone with Stripe write access. Price IDs
          // are immutable secrets known only to deploy.
          // Scans ALL line items (not [0]) so a per-seat add-on item can
          // never shadow the plan price; its quantity syncs purchasedSeats
          // (this event fires on every seat-quantity change).
          const derived = derivePlanAndSeats(subscription.items, PRICE_TO_PLAN);
          const plan = derived.plan || stored.plan || 'starter';
          // No recognizable plan price (secret rotation mid-flight, foreign
          // sub) → keep the stored seat count rather than zeroing a
          // paid-for entitlement on ambiguous data.
          const purchasedSeats = derived.plan
            ? derived.purchasedSeats
            : Math.max(0, Number(stored.purchasedSeats) || 0);
          // Tripwire — see checkout.session.completed: nonzero is unexpected
          // until Route 1b's seat-charging callable exists.
          if (purchasedSeats > 0 && purchasedSeats !== stored.purchasedSeats) {
            logger.info('purchased_seats_derived', { uid, purchasedSeats, subscriptionId: subscription.id });
          }

          await subDoc.ref.update({
            plan,
            purchasedSeats,
            status: subscription.status,
            stripeSubscriptionId: subscription.id,
            currentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : null,
            cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
            // Advance the ordering high-water mark so a later-delivered but
            // older-created event is skipped (see the guard above). Preserve
            // the prior mark if this event lacks a created timestamp, so a
            // malformed event can't erase the watermark and reopen the race.
            lastSubEventAt: eventCreated || lastApplied || FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Sync custom claims
          try {
            await mergeCustomClaims(uid, {
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
            // The Stripe subscription is gone — any per-seat add-on items
            // died with it. Server cap sites already ignore purchasedSeats on
            // a non-entitled sub; clearing it keeps the client mirror honest.
            purchasedSeats: 0,
            // Anchors the lapse grace period (gauntlet batch 2): the daily
            // enforceLapsedSeats cron pauses team seats LAPSE_GRACE_DAYS
            // after this stamp; lapseEnforced is cleared on reactivation.
            cancelledAt: FieldValue.serverTimestamp(),
            lapseEnforced: false,
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Downgrade custom claims to free
          try {
            await mergeCustomClaims(uid, {
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
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Update claims to past_due so client can show warning
          try {
            await mergeCustomClaims(uid, {
              plan: subDoc.data().plan || 'free',
              subscriptionStatus: 'past_due',
              stripeCustomerId: customerId
            });
          } catch (e) { logger.warn('claims_pastdue_failed', { uid, err: e.message }); }

          // E1: dunning. Enqueue an email to the rep, Slack the ops
          // channel, and stamp a lead activity row if the invoice
          // has a leadId on its metadata (auto-invoice C5 sets it).
          try {
            const userRecord = await getAuth().getUser(uid);
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
                createdAt: FieldValue.serverTimestamp(),
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
                createdAt: FieldValue.serverTimestamp()
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
              updatedAt: FieldValue.serverTimestamp()
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
      // The idempotency marker stripe_events/{event.id} is written BEFORE the
      // switch body. If processing then threw (a transient Firestore blip /
      // deadline on the subscriptions write), returning 500 alone is not
      // enough: Stripe retries the delivery, but the retry hits the create()
      // guard, sees ALREADY_EXISTS, and short-circuits as a duplicate doing
      // ZERO work — so a paid tenant's entitlement doc + claims (or a
      // cancellation / past_due flag) are lost permanently, with no
      // reconciliation path. Delete the marker so the retry re-processes from
      // scratch. The handlers' writes are all idempotent (merge/update + reset),
      // so a re-run is safe. `db` is scoped inside the try; use getFirestore()
      // (same memoized instance).
      if (event && event.id) {
        try {
          await getFirestore().doc(`stripe_events/${event.id}`).delete();
        } catch (delErr) {
          logger.error('stripeWebhook marker cleanup failed — event may not retry',
            { eventId: event.id, err: delErr.message });
        }
      }
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

exports.createCustomerPortalSession = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [STRIPE_SECRET_KEY],
    enforceAppCheck: true,
    invoker: 'public', // see createCheckoutSession — auth enforced in-code
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
      const db = getFirestore();
      // Billing docs live at subscriptions/{companyId} (== owner uid for solo
      // operators). Resolve via the companyId claim so company admins can
      // reach the portal for their company's subscription.
      const billingKey = decoded.companyId || decoded.uid;
      const subscriptionSnap = await db.doc(`subscriptions/${billingKey}`).get();

      if (!subscriptionSnap.exists) {
        res.status(404).json({ error: 'No subscription found for this company' });
        return;
      }

      const customerId = subscriptionSnap.data().stripeCustomerId;

      if (!customerId) {
        res.status(400).json({ error: 'No Stripe customer associated with this subscription' });
        return;
      }

      const stripe = getStripe();

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        // /pro/settings does not exist (Settings is a view inside the
        // dashboard) — it 404'd every portal return. Land on the dashboard.
        return_url: 'https://nobigdealwithjoedeal.com/pro/dashboard',
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
    invoker: 'public', // see createCheckoutSession — auth enforced in-code
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
      const db = getFirestore();
      // Same companyId-first resolution as the portal: a team member's
      // entitlement comes from their COMPANY's subscription doc.
      const billingKey = decoded.companyId || decoded.uid;
      const subscriptionSnap = await db.doc(`subscriptions/${billingKey}`).get();

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
    invoker: 'public', // see createCheckoutSession — auth enforced in-code
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
      const db = getFirestore();
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

      // ── Sales-tax line + total reconciliation (H3, money bug) ─────────
      // invoice.items hold TAX-EXCLUSIVE line totals; the invoice's sales
      // tax lives only in invoice.tax / invoice.total. Without an explicit
      // tax line the payment link would charge the pre-tax subtotal, so the
      // customer underpays by the entire tax and the contractor eats it.
      // Append a dedicated tax line, then assert the link total reconciles
      // to invoice.total to the penny before we ever create the link.
      const productSumCents = lineItems.reduce(
        (sum, li) => sum + li.price_data.unit_amount * li.quantity, 0);
      const expectedTotalCents = Math.round(Number(invoice.total || 0) * 100);
      const taxCents = Math.round(Number(invoice.tax || 0) * 100);

      if (!Number.isFinite(taxCents) || taxCents < 0 || taxCents > MAX_CENTS) {
        res.status(400).json({ error: 'Invoice tax amount out of allowed range' });
        return;
      }
      if (taxCents > 0) {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Sales Tax',
              description: `Invoice ${invoiceId}`,
            },
            unit_amount: taxCents,
          },
          quantity: 1,
        });
      }

      // The charged total must equal invoice.total. Line totals from the
      // estimate engine are full-precision floats (fractional quantities ×
      // per-unit cents), so the sum of per-line rounding can drift a few
      // cents from the stored total — allow a tolerance that scales with
      // line count but stays far below any real tax amount, so a genuine
      // mismatch (e.g. a missing tax line, or a server-recomputed line that
      // diverges from the client total) still trips the guard and we refuse
      // to charge rather than bill the wrong amount.
      const linkTotalCents = lineItems.reduce(
        (sum, li) => sum + li.price_data.unit_amount * li.quantity, 0);
      const reconcileTolCents = Math.max(2, lineItems.length);
      if (Math.abs(linkTotalCents - expectedTotalCents) > reconcileTolCents) {
        logger.error('payment_link_total_mismatch', {
          invoiceId, uid: decoded.uid,
          productSumCents, taxCents, linkTotalCents, expectedTotalCents,
        });
        res.status(400).json({ error: 'Invoice total does not reconcile; refusing to create payment link' });
        return;
      }

      const stripe = getStripe();
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
    invoker: 'public', // Stripe calls unauthenticated — see stripeWebhook
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_INVOICE_WEBHOOK_SECRET],
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
      const stripe = getStripe();

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

      // Verify Stripe signature with explicit replay tolerance. Prefer the
      // endpoint's OWN signing secret; fall back to the legacy shared secret
      // so deliveries keep verifying during the rotation window (the
      // dedicated secret starts life as a PENDING-ROTATION placeholder).
      const candidates = [];
      const dedicated = String(STRIPE_INVOICE_WEBHOOK_SECRET.value() || '').trim();
      if (dedicated && dedicated.startsWith('whsec_')) candidates.push(dedicated);
      const legacy = String(STRIPE_WEBHOOK_SECRET.value() || '').trim();
      if (legacy) candidates.push(legacy);

      let event = null;
      let lastErr = null;
      for (const secret of candidates) {
        try {
          event = stripe.webhooks.constructEvent(req.rawBody, signature, secret, 300);
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!event) {
        logger.error('invoiceWebhook signature verification failed', { err: lastErr && lastErr.message });
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
      const db = getFirestore();
      const eventRef = db.doc(`stripe_events/${event.id}`);
      try {
        await eventRef.create({
          type: event.type,
          source: 'invoiceWebhook',
          processedAt: FieldValue.serverTimestamp()
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
            const inv = invSnap.data();
            await invRef.update({
              status: 'paid',
              paidAt: FieldValue.serverTimestamp(),
              stripePaymentIntentId: paymentIntent.id,
              // The payment link charges the full invoice.total, so the invoice
              // is fully settled — converge the ledger with the manual markPaid
              // path (zero balanceDue, mark deposit paid, stamp amountPaid) so
              // the money-dashboard AR/collected math doesn't read a stale
              // balanceDue and double-count this invoice as outstanding.
              balanceDue: 0,
              depositPaid: true,
              amountPaid: Number(inv.total) || 0,
              updatedAt: FieldValue.serverTimestamp(),
            });
            logger.info('invoice_paid', { invoiceId });

            // ── Auto-advance kanban stage on payment ──────────────────
            // Close the loop: when the homeowner pays via Stripe, the
            // rep shouldn't have to manually drag the card — bump it
            // to 'final_payment' (or 'closed' if it's already there).
            // The CRM's `STAGE_META` treats both as won-revenue stages.
            //
            // Idempotency: only auto-advance if the lead is currently
            // pre-final-payment AND not already lost. Never overwrite
            // a manually-set 'closed' or 'lost' state.
            if (inv.leadId) {
              try {
                const leadRef = db.collection('leads').doc(inv.leadId);
                const leadSnap = await leadRef.get();
                if (leadSnap.exists) {
                  const lead = leadSnap.data();
                  const curStage = (lead.stage || '').toLowerCase();
                  // Stages we won't override (already at-or-past final payment, or lost).
                  const PROTECTED = new Set(['final_payment', 'closed', 'lost']);
                  if (!PROTECTED.has(curStage)) {
                    await leadRef.update({
                      stage: 'final_payment',
                      _stageKey: 'final_payment',
                      stageStartedAt: FieldValue.serverTimestamp(),
                      autoAdvancedFromInvoiceId: invoiceId,
                      autoAdvancedAt: FieldValue.serverTimestamp(),
                      updatedAt: FieldValue.serverTimestamp(),
                    });
                    logger.info('lead_auto_advanced_on_payment', {
                      invoiceId, leadId: inv.leadId, fromStage: curStage
                    });
                  }
                }
              } catch (advanceErr) {
                // Non-fatal — invoice is already marked paid, just log.
                logger.warn('lead_auto_advance_failed', {
                  invoiceId, leadId: inv.leadId, err: advanceErr.message
                });
              }
            }
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

// Test-only export. NON-enumerable on purpose: index.js absorbs this module
// via Object.assign(exports, require('./stripe')), which copies enumerable
// props only — a plain `exports._test` would leak into the deploy surface
// the Firebase CLI enumerates.
Object.defineProperty(exports, '_test', {
  value: { derivePlanAndSeats },
  enumerable: false,
});

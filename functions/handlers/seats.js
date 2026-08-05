/**
 * functions/handlers/seats.js — per-seat add-on purchase (Route 1b).
 *
 * setCompanySeatCount({ extraSeats }) — the company OWNER (or platform
 * admin) sets the number of PURCHASED extra rep seats (an absolute target,
 * not a delta). The seats are billed as a Stripe subscription line item
 * (STRIPE_PRICE_SEAT × qty) on the company's existing plan subscription,
 * prorated and invoiced immediately.
 *
 * The READ path (Route 1a, PR #973) is already live: the
 * customer.subscription.updated webhook derives purchasedSeats from the
 * sub's non-plan line items and every seat-cap site grants
 * seatLimitForPlan(plan) + purchasedSeats. This callable is the only WRITE
 * path — nothing else may create seat line items.
 *
 * ── DARK GATE / DEPLOY ORDER ─────────────────────────────────────────
 * This module binds the STRIPE_PRICE_SEAT secret. A Firebase deploy FAILS
 * if a bound secret does not exist in Secret Manager — so the PR adding
 * this file MUST NOT merge to main (main auto-deploys) until the secret
 * is created. Once set, the handler still refuses to act unless the value
 * looks like a real price id ('price_…'), so a placeholder value keeps the
 * feature dark while allowing deploys.
 *
 * Money-path posture (mirrors stripe.js):
 *  - Stripe API version pinned; key trimmed; retries bounded.
 *  - payment_behavior 'error_if_incomplete': the proration charge must
 *    clear or the whole update is rejected — seats are never granted on a
 *    declined card.
 *  - Validate in Stripe TEST MODE before any prod use (codebase money rule).
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const Stripe = require('stripe');

const { requireTeamAdmin } = require('./_shared');
const { callableRateLimit } = require('../shared');
// Same plan/seat maths as the enforcement sites. invites.js exports both via
// _test; requiring it here is fine (index.js loads it anyway) — its secrets
// are only read inside its own handlers.
const { _test: { seatLimitForPlan, isInviteExpired } } = require('./invites');

// Pinned API version — see functions/stripe.js STRIPE_API_VERSION rationale.
const STRIPE_API_VERSION = '2023-10-16';

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
// The per-extra-rep-seat recurring price. Created by Jo in the Stripe
// dashboard; the id is the authorization boundary (immutable, deploy-known).
const STRIPE_PRICE_SEAT = defineSecret('STRIPE_PRICE_SEAT');
// Plan price ids — needed to tell plan line items from seat line items when
// reconciling. All three already exist in Secret Manager (no deploy risk).
const STRIPE_PRICE_FOUNDATION   = defineSecret('STRIPE_PRICE_FOUNDATION');
const STRIPE_PRICE_PROFESSIONAL = defineSecret('STRIPE_PRICE_PROFESSIONAL');
const STRIPE_PRICE_TEAM         = defineSecret('STRIPE_PRICE_TEAM');

// CORS origins — deliberately duplicated per module (portal.js precedent).
const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

// Sanity ceiling: nobody buys 51 roofing-rep seats by accident. Raising it is
// a one-line change; a fat-fingered 400 × $39/mo is not.
const MAX_EXTRA_SEATS = 50;

// Memoized Stripe client — mirrors stripe.js getStripe() (trim kills the
// tainted-secret ERR_INVALID_CHAR failure mode; value() read lazily).
let _stripeClient = null;
function getStripe() {
  if (_stripeClient) return _stripeClient;
  const key = String(STRIPE_SECRET_KEY.value() == null ? '' : STRIPE_SECRET_KEY.value()).trim();
  if (!key) throw new Error('STRIPE_SECRET_KEY is empty/unset');
  _stripeClient = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20000,
  });
  return _stripeClient;
}

// Build the stripe.subscriptions.update `items` payload that reconciles the
// subscription's CURRENT line items to `extraSeats` purchased seats.
//
// Mirrors the read path's derivation-by-exclusion: every item whose price is
// NOT a plan price is a seat item — including items left on a rotated-away
// seat price id, which are deleted (not orphaned to keep billing forever).
// The target quantity always lands on the CURRENT seat price.
// Returns null when the subscription already matches (no API call needed).
// Pure — exported for unit tests.
function buildSeatItemsUpdate(items, seatPriceId, extraSeats, planPriceIds) {
  const data = items && Array.isArray(items.data) ? items.data : [];
  const isPlan = (id) => !!id && !!planPriceIds && planPriceIds.has(id);
  const qtyOf = (it) => Math.max(0, Math.floor(Number(it && it.quantity)) || 0);
  const seatItems = data.filter((it) => it && it.price && it.price.id && !isPlan(it.price.id));
  const current = seatItems.find((it) => it.price.id === seatPriceId) || null;
  const strays = seatItems.filter((it) => it.price.id !== seatPriceId);
  const totalQty = seatItems.reduce((s, it) => s + qtyOf(it), 0);
  if (totalQty === extraSeats && strays.length === 0) return null;
  const ops = strays.map((it) => ({ id: it.id, deleted: true }));
  if (extraSeats === 0) {
    if (current) ops.push({ id: current.id, deleted: true });
  } else if (current) {
    if (qtyOf(current) !== extraSeats) ops.push({ id: current.id, quantity: extraSeats });
  } else {
    ops.push({ price: seatPriceId, quantity: extraSeats });
  }
  return ops.length ? ops : null;
}

exports.setCompanySeatCount = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB',
    // MERGE GATE: deploy fails until STRIPE_PRICE_SEAT exists in Secret
    // Manager — see the module header. The three plan-price secrets
    // already exist.
    secrets: [STRIPE_SECRET_KEY, STRIPE_PRICE_SEAT,
              STRIPE_PRICE_FOUNDATION, STRIPE_PRICE_PROFESSIONAL, STRIPE_PRICE_TEAM],
  },
  async (request) => {
    await callableRateLimit(request, 'setCompanySeatCount', 20, 3_600_000);
    // Company OWNER (or platform admin) only — ownerOnly refuses non-owner
    // company_admins even now that requireTeamAdmin accepts them elsewhere
    // (audit 2026-08-02 / Jo 2026-08-05). Seat money is the bill-payer's
    // call alone.
    const { uid, companyId } = await requireTeamAdmin(request, null, { ownerOnly: true });

    // Dark gate: a placeholder secret (anything that isn't a price id) keeps
    // the whole feature off without breaking deploys.
    const seatPriceId = String(STRIPE_PRICE_SEAT.value() || '').trim();
    if (!seatPriceId.startsWith('price_')) {
      throw new HttpsError('failed-precondition', 'Per-seat add-ons are not available yet.');
    }
    // Misconfiguration tripwire: if STRIPE_PRICE_SEAT were pasted as one of
    // the PLAN price ids, "reconcile seat items" would re-quantity or delete
    // the plan line item itself. Refuse outright.
    const planPriceIds = new Set([
      String(STRIPE_PRICE_FOUNDATION.value() || '').trim(),
      String(STRIPE_PRICE_PROFESSIONAL.value() || '').trim(),
      String(STRIPE_PRICE_TEAM.value() || '').trim(),
    ].filter(Boolean));
    if (planPriceIds.has(seatPriceId)) {
      logger.error('setCompanySeatCount.seat_price_is_plan_price', { companyId });
      throw new HttpsError('failed-precondition', 'Per-seat add-ons are misconfigured — contact support.');
    }

    // Strict type check BEFORE any numeric handling: Number(null|''|[]|false)
    // coerces to 0, which would silently delete all purchased seat billing on
    // a buggy client payload. Only an actual integer number is accepted.
    const raw = request.data && request.data.extraSeats;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MAX_EXTRA_SEATS) {
      throw new HttpsError('invalid-argument', `extraSeats must be a whole number from 0 to ${MAX_EXTRA_SEATS}.`);
    }
    const extraSeats = raw;

    const db = getFirestore();
    const subRef = db.doc(`subscriptions/${companyId}`);
    const subData = (await subRef.get()).data() || {};
    const storedSeats = Math.max(0, Number(subData.purchasedSeats) || 0);

    // Seats ride on a card-billed Stripe subscription. Access-code comps and
    // free tenants have nothing to attach the line item to.
    if (!subData.stripeSubscriptionId || !subData.stripeCustomerId) {
      throw new HttpsError('failed-precondition',
        'Extra seats need an active paid plan billed by card. Choose a plan first, then add seats.');
    }
    // active/trialing may change freely. past_due may only REDUCE — the
    // tenant who triggered a failed proration invoice must be able to undo
    // it, but no NEW charges go onto a delinquent sub. (The read path keeps
    // already-purchased seats granted during dunning; this only gates
    // CHANGING the count.)
    const entitledStatus = subData.status === 'active' || subData.status === 'trialing';
    const pastDueReduction = subData.status === 'past_due' && extraSeats < storedSeats;
    if (!entitledStatus && !pastDueReduction) {
      throw new HttpsError('failed-precondition',
        'Your subscription has a billing issue — fix it in Manage billing, then adjust seats.');
    }

    const plan = subData.plan || 'free';
    const base = seatLimitForPlan(plan);
    if (base === Infinity) {
      throw new HttpsError('failed-precondition', 'Your plan already includes unlimited seats.');
    }

    // Never let a seat REDUCTION strand more occupied seats than the new cap
    // allows. Occupied = active claimed members + live (non-expired) pending
    // invites — createTeamInvite's occupied filter, plus an explicit
    // owner-doc exclusion (the owner never consumes an invite seat even if a
    // stray member doc exists for them; normally they have none). The owner
    // resolves the roster first (remove / bench via seat picker), so a
    // billing call never silently deactivates a person.
    const newCap = base + extraSeats;
    const coSnap = await db.doc(`companies/${companyId}`).get();
    const ownerId = coSnap.exists ? (coSnap.data() || {}).ownerId : null;
    const countOccupied = (snap) => snap.docs.filter((m) => {
      const md = m.data() || {};
      if (md.uid && ownerId && md.uid === ownerId) return false;
      if (md.status === 'invited') return !isInviteExpired(md);
      return md.status === 'active';
    }).length;
    const occupied = countOccupied(await db.collection(`companies/${companyId}/members`).get());
    if (occupied > newCap) {
      throw new HttpsError('failed-precondition',
        `You're using ${occupied} seat${occupied === 1 ? '' : 's'} but this change leaves ${newCap}. `
        + 'Remove members or cancel invites first, then reduce seats.');
    }

    const stripe = getStripe();
    let sub;
    try {
      sub = await stripe.subscriptions.retrieve(subData.stripeSubscriptionId);
    } catch (e) {
      logger.error('setCompanySeatCount.retrieve_failed', { companyId, err: e.message });
      throw new HttpsError('internal', 'Could not load your subscription — try again in a minute.');
    }
    // Cross-check the sub still belongs to this tenant's Stripe customer —
    // a stale/foreign id must never be billed.
    const subCustomer = typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id);
    if (subCustomer !== subData.stripeCustomerId) {
      logger.error('setCompanySeatCount.customer_mismatch', { companyId, subCustomer });
      throw new HttpsError('internal', 'Subscription record mismatch — contact support.');
    }
    const liveEntitled = sub.status === 'active' || sub.status === 'trialing'
      || (sub.status === 'past_due' && extraSeats < storedSeats);
    if (!liveEntitled) {
      throw new HttpsError('failed-precondition',
        'Your subscription has a billing issue — fix it in Manage billing, then adjust seats.');
    }

    // Rotation safety (mirrors the webhook read path's F-08 fallback): if a
    // plan price gets rotated (STRIPE_PRICE_TEAM etc. repointed to a new
    // price id), an EXISTING subscription's plan line item still carries the
    // OLD id, which is absent from the current `planPriceIds` set.
    // buildSeatItemsUpdate identifies seat items BY EXCLUSION ("not a known
    // plan price") — without this guard, the old plan item would be
    // misclassified as a stray seat item and DELETED from the live Stripe
    // subscription, silently converting the tenant to seat-only billing. Only
    // proceed when at least one line item is a price we currently recognize
    // as a plan; otherwise refuse rather than reconcile against ambiguous
    // data (same "don't act on what you can't identify" rule as the webhook).
    const items = sub.items && Array.isArray(sub.items.data) ? sub.items.data : [];
    const hasRecognizedPlanItem = items.some((it) => it && it.price && it.price.id && planPriceIds.has(it.price.id));
    if (!hasRecognizedPlanItem) {
      logger.error('setCompanySeatCount.no_recognized_plan_item', { companyId, subscriptionId: sub.id });
      throw new HttpsError('failed-precondition',
        'Your subscription price could not be verified — contact support before changing seats.');
    }

    const itemsUpdate = buildSeatItemsUpdate(sub.items, seatPriceId, extraSeats, planPriceIds);
    if (!itemsUpdate) {
      // Still sync the mirror: if subscriptions/{companyId}.purchasedSeats
      // diverged from Stripe truth (lost/out-of-order webhook), re-submitting
      // the true value must repair it at zero Stripe cost — without this, the
      // owner's only UI escape was bouncing through a wrong value, which
      // costs a real proration charge.
      try {
        await subRef.set({ purchasedSeats: extraSeats, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      } catch (e) {
        logger.warn('setCompanySeatCount.noop_sync_failed', { companyId, err: e.message });
      }
      return { ok: true, unchanged: true, purchasedSeats: extraSeats, effectiveCap: newCap, plan };
    }

    // REDUCTIONS: reserve the lower entitlement BEFORE calling Stripe, so a
    // concurrent createTeamInvite reads the reduced cap instead of racing the
    // old one into a seat that is about to stop being paid for. Rolled back
    // if the Stripe update fails. (A sub-second phantom window remains — an
    // invite that read the old cap before this write and commits after the
    // occupied check; the post-update re-verify below logs it for ops.)
    const isReduction = extraSeats < storedSeats;
    if (isReduction) {
      await subRef.set({ purchasedSeats: extraSeats, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    try {
      await stripe.subscriptions.update(sub.id, {
        items: itemsUpdate,
        // Invoice the proration NOW — the owner just clicked "add a seat";
        // a surprise lump at renewal reads as a billing bug. During a trial
        // the proration is $0 and seat billing starts when the trial
        // converts (Stripe semantics; the UI copy says so).
        proration_behavior: 'always_invoice',
        // The proration charge must CLEAR for the update to apply. Without
        // this, Stripe's default (allow_incomplete) grants the seats and
        // leaves the invoice to dunning — seats before money.
        payment_behavior: 'error_if_incomplete',
      });
    } catch (e) {
      if (isReduction) {
        // Roll the reservation back — Stripe still bills the old count.
        try {
          await subRef.set({ purchasedSeats: storedSeats, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        } catch (rbErr) {
          logger.error('setCompanySeatCount.reservation_rollback_failed', { companyId, err: rbErr.message });
        }
      }
      if (e && e.type === 'StripeCardError') {
        logger.warn('setCompanySeatCount.card_declined', { companyId, extraSeats });
        throw new HttpsError('failed-precondition',
          'Your card was declined for the prorated seat charge — no seats were changed. Update your card in Manage billing and try again.');
      }
      logger.error('setCompanySeatCount.update_failed', { companyId, extraSeats, err: e.message });
      // Honest copy for indeterminate outcomes (e.g. a timeout after Stripe
      // applied the change): never assert "you were not charged" — promise
      // idempotence instead. A retry that finds Stripe already at the target
      // takes the no-op path above and costs nothing.
      throw new HttpsError('internal',
        'Stripe could not confirm the seat update. If a charge already went through, retrying will NOT charge you again — the update applies once.');
    }

    // Sync the mirror so the UI reflects the purchase immediately; the
    // customer.subscription.updated webhook re-derives the same value from
    // the line items (Route 1a) and remains the source of truth. A failure
    // here must NOT surface as an error — the charge already succeeded and
    // the webhook converges the doc moments later.
    try {
      await subRef.set({ purchasedSeats: extraSeats, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    } catch (e) {
      logger.warn('setCompanySeatCount.mirror_sync_failed_webhook_will_converge', { companyId, err: e.message });
    }

    // Post-reduction re-verify: if an invite raced past the occupied check,
    // surface it loudly (the roster is now over cap; the seat picker UI
    // already models over-capacity states).
    if (isReduction) {
      try {
        const after = countOccupied(await db.collection(`companies/${companyId}/members`).get());
        if (after > newCap) {
          logger.warn('setCompanySeatCount.reduction_race_overcap', { companyId, occupied: after, newCap });
        }
      } catch (_) { /* best-effort */ }
    }

    logger.info('seat_count_set', { companyId, uid, plan, extraSeats, effectiveCap: newCap });
    return { ok: true, purchasedSeats: extraSeats, effectiveCap: newCap, plan };
  },
);

exports._test = { buildSeatItemsUpdate, MAX_EXTRA_SEATS };

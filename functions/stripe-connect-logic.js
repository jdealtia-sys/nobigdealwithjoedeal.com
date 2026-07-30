/**
 * stripe-connect-logic.js — pure decisions behind Stripe Connect Express.
 * Dependency-free (no firebase, no stripe) so tests can require() it directly
 * and the handlers share the exact same code path — no logic mirror to drift.
 *
 * WHY CONNECT EXISTS HERE: Stripe served two money flows on ONE platform key —
 * subscriptions (contractors paying us: ours, correct) and invoice payments
 * (a contractor's HOMEOWNER paying the CONTRACTOR: theirs, landing in our
 * balance). #1123 gated the second to the platform tenant; Connect is the real
 * fix. Phase 1 is accounts + onboarding ONLY: the money gate stays closed and
 * nothing here mints a payment link.
 *
 * Everything in this module is a decision, not an effect: what state a Stripe
 * account object implies, whether a creation attempt may proceed, whether a
 * webhook delivery should be applied, and whether a tenant is eventually
 * allowed to collect online. The handlers do the I/O.
 */
'use strict';

// Only these two fields are requested at creation. card_payments lets the
// homeowner's card be charged on the contractor's account; transfers lets funds
// settle to them. Nothing else (no card_issuing, no treasury).
const REQUESTED_CAPABILITIES = ['card_payments', 'transfers'];

// Claim TTL: a 'creating' row older than this is stale, not in-flight.
const CLAIM_STALE_MS = 5 * 60 * 1000;

const str = (v) => (typeof v === 'string' ? v : '');
const bool = (v) => v === true;

// Requirement FIELD NAMES are safe to mirror ('individual.id_number');
// requirement VALUES are the contractor's SSN-class PII and must stay in
// Stripe. Same for requirements.errors: keep `code`, never the free-text
// `reason`.
function reqList(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 40) : [];
}
function errorCodes(v) {
  if (!Array.isArray(v)) return [];
  return v.map((e) => (e && typeof e.code === 'string' ? e.code : null)).filter(Boolean).slice(0, 40);
}

/**
 * Derive the Firestore mirror from a Stripe Account object. Pure.
 * Booleans DEFAULT FALSE: an absent/garbage capability must never read as
 * "enabled" — this state is what a later gate will trust to move money.
 */
function deriveConnectState(account) {
  const a = account || {};
  const req = a.requirements || {};
  const caps = a.capabilities || {};
  return {
    accountId: str(a.id) || null,
    accountType: str(a.type) || null,
    // livemode is load-bearing: ONE deployed function serves both modes, so a
    // test-mode acct_ must never satisfy a live gate.
    livemode: bool(a.livemode),
    chargesEnabled: bool(a.charges_enabled),
    payoutsEnabled: bool(a.payouts_enabled),
    detailsSubmitted: bool(a.details_submitted),
    disabledReason: str(req.disabled_reason) || null,
    requirementsCurrentlyDue: reqList(req.currently_due),
    requirementsPastDue: reqList(req.past_due),
    requirementsEventuallyDue: reqList(req.eventually_due),
    requirementsPendingVerification: reqList(req.pending_verification),
    requirementsErrorCodes: errorCodes(req.errors),
    capabilities: {
      cardPayments: str(caps.card_payments) || null,
      transfers: str(caps.transfers) || null,
    },
    country: str(a.country) || null,
    defaultCurrency: str(a.default_currency) || null,
  };
}

/**
 * May a create-account attempt proceed?
 * Mirrors reserveCompanyPrefix's decide-then-write split so the race logic is
 * unit-tested rather than living inside a transaction closure.
 *
 * @param existing current connectAccounts/{companyId} data (or null)
 * @param nowMs    Date.now() from the caller (never read the clock in here)
 */
function decideAccountCreate(existing, nowMs) {
  if (existing && str(existing.accountId)) {
    // Already provisioned — idempotent no-op, return what we have.
    return { action: 'existing', accountId: str(existing.accountId) };
  }
  if (existing && existing.status === 'creating') {
    const startedMs = Number(existing.claimedAtMs);
    const age = Number.isFinite(startedMs) ? (nowMs - startedMs) : Infinity;
    if (age < CLAIM_STALE_MS) {
      return { action: 'in_flight', retryAfterMs: CLAIM_STALE_MS - age };
    }
    // STALE. Deliberately NOT auto-retried: Stripe retains idempotency keys for
    // a limited window, so a retry days later is unprotected and there is no
    // accounts.search-by-metadata to find the first account with. A duplicate
    // account can silently hold real money, so a human reconciles via
    // metadata.companyId in the Dashboard.
    return { action: 'stale_claim' };
  }
  return { action: 'create' };
}

/**
 * Stable forever, derived from companyId ALONE. Never a random uuid — a retry
 * with a fresh key mints a SECOND connected account.
 */
function accountIdempotencyKey(companyId) {
  return 'nbd-connect-acct-' + str(companyId);
}

/**
 * Should this webhook delivery be applied to the stored state?
 * `account.updated` carries no monotonic version, so use the same high-water
 * mark the subscription webhook uses for out-of-order seat events.
 */
function decideWebhookApply(stored, event) {
  const e = event || {};
  const acct = str(e.account);
  if (!acct) return { apply: false, reason: 'platform_event' };
  if (!stored) return { apply: false, reason: 'unknown_account' };

  // ONE function serves both modes. Without this, a test-mode
  // account.updated{charges_enabled:true} could flip a LIVE tenant's state.
  if (typeof stored.livemode === 'boolean' && typeof e.livemode === 'boolean'
      && stored.livemode !== e.livemode) {
    return { apply: false, reason: 'livemode_mismatch' };
  }

  const prior = Number(stored.lastAccountEventAt);
  const created = Number(e.created);
  if (Number.isFinite(prior) && Number.isFinite(created) && created < prior) {
    return { apply: false, reason: 'out_of_order' };
  }
  // Same-second ties DO process: two real changes can share a timestamp.
  return { apply: true, watermark: Number.isFinite(created) ? created : null };
}

/**
 * The condition a LATER phase will require before minting a payment link on a
 * tenant's behalf. Defined here now so the gate lift is a one-line predicate
 * swap reviewed against this contract, not a fresh judgement call under
 * pressure. Phase 1 has NO caller — the #1123 platform-only gate still stands.
 *
 * payoutsEnabled is deliberately NOT required: a tenant can legitimately
 * collect while payouts are on hold (that is a UI warning, not a charge block).
 */
function mayCollectOnline(state, opts) {
  const s = state || {};
  const wantLive = !(opts && opts.allowTestMode === true);
  if (!str(s.accountId).startsWith('acct_')) return false;
  if (!bool(s.chargesEnabled)) return false;
  if (!bool(s.detailsSubmitted)) return false;
  if (wantLive && !bool(s.livemode)) return false;
  return true;
}

/** Human-facing status for the Settings card. Never invents reassurance. */
function describeConnectStatus(state) {
  const s = state || {};
  if (!str(s.accountId)) return { code: 'not_started', label: 'Not connected' };
  if (!bool(s.detailsSubmitted)) return { code: 'onboarding_incomplete', label: 'Finish setup' };
  if (bool(s.chargesEnabled) && bool(s.payoutsEnabled)) return { code: 'ready', label: 'Connected' };
  if (bool(s.chargesEnabled) && !bool(s.payoutsEnabled)) {
    return { code: 'payouts_paused', label: 'Connected — payouts on hold' };
  }
  // details submitted, charges not yet enabled = Stripe is verifying. NOT an
  // error state; the fix-it path is the Express dashboard, not a new
  // onboarding link.
  return { code: 'verifying', label: 'Verification in progress' };
}

module.exports = {
  deriveConnectState,
  decideAccountCreate,
  accountIdempotencyKey,
  decideWebhookApply,
  mayCollectOnline,
  describeConnectStatus,
  REQUESTED_CAPABILITIES,
  CLAIM_STALE_MS,
};

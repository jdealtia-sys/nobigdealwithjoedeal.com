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

// ── Platform fee (phase 3) ──────────────────────────────────────────────
// 340 bps + 30¢ = Stripe's 2.9% + 30¢ pass-through plus a 0.5% platform
// margin. Charged ONLY on Connect-routed tenant mints — the platform
// tenant's own mints carry no fee. Input is strict integer cents: anything
// else fails CLOSED to 0. Clamped strictly below the charge so the
// tenant's settlement is never zero or negative. (The mint already refuses
// balances under 100 cents — stripe.js MIN_CENTS — so the clamp is a
// backstop, not the normal path.)
const PLATFORM_FEE_BPS = 340;
const PLATFORM_FEE_FLAT_CENTS = 30;
function platformFeeCents(chargedCents) {
  if (typeof chargedCents !== 'number' || !Number.isInteger(chargedCents) || chargedCents <= 0) return 0;
  const fee = Math.round((chargedCents * PLATFORM_FEE_BPS) / 10000) + PLATFORM_FEE_FLAT_CENTS;
  return Math.max(0, Math.min(fee, chargedCents - 1));
}

// ── Has Stripe actually taken the money? (phase 3) ──────────────────────
// NEW 2026-07-30 (#1146 audit finding 2/6). An INQUIRY — Amex/Discover
// retrieval, Stripe status `warning_needs_response` / `warning_under_review`
// / `warning_closed` — is a REQUEST FOR INFORMATION. Stripe withdraws
// NOTHING from the platform balance for it, and there is no "won" outcome
// to close it with, so a claw-back taken at inquiry time is never returned
// by any outcome event. It must therefore never trigger one.
//
// The authority is the dispute's own balance-transaction list: it holds
// "zero, one, or two balance transactions that show funds withdrawn and
// reinstated". A negative entry IS the platform debit. Two deliberate
// asymmetries:
//   - a `warning_*` status short-circuits to false even if the array is
//     somehow present, because an inquiry never debits us;
//   - when the array is ABSENT (older payload shape, a caller that built
//     the object by hand) we fall back to the status and assume withdrawn,
//     so a real chargeback is never left unrecovered by a missing field.
//     The false-positive cost of that fallback is bounded — a `warning_*`
//     status is still caught by the first rule.
// An empty array on a non-warning status means "not withdrawn YET" — that
// is the legitimate wait-for-the-withdrawal state, and it is why the
// caller must also handle the funds-withdrawn event.
function disputeFundsWithdrawn(dispute) {
  const d = dispute || {};
  const status = str(d.status).toLowerCase();
  if (status.startsWith('warning_')) return { withdrawn: false, inquiry: true, basis: 'status' };
  const bts = d.balance_transactions;
  if (Array.isArray(bts)) {
    const debited = bts.some((b) => b && Number(b.amount) < 0);
    return { withdrawn: debited, inquiry: false, basis: 'balance_transactions' };
  }
  return { withdrawn: true, inquiry: false, basis: 'status' };
}

// ── Dispute reversal decision (phase 3) ─────────────────────────────────
// Under destination routing a chargeback debits the PLATFORM balance. The
// transfer attached to the disputed charge is the recovery lever: reverse
// the DISPUTED amount (clamped to what remains reversible) so the
// contractor, not the platform, bears the loss — and a PARTIAL dispute
// never over-recovers from the contractor. Pure decision — the webhook
// does the I/O and retrieves the charge with the transfer expanded. A
// platform-tenant charge has no transfer. amountCents === null means the
// transfer object was not expanded: the caller omits the amount and Stripe
// reverses the full remainder (can never over-reverse).
//
// REWRITTEN 2026-07-30 (#1146 audit findings 2 + 6). This used to read only
// the transfer and the amount, so it recovered "the disputed amount"
// whenever a transfer existed. The stale premise was that every
// charge.dispute.* delivery means the platform has been debited. It does
// not: an inquiry costs the platform $0, and on a $10k invoice the old
// behaviour held ~$9.6k of the contractor's money with no event that ever
// gives it back. Recovery is now gated on the debit having HAPPENED
// (disputeFundsWithdrawn above), which makes this a two-event decision —
// see the caller's runbook note for the events that must be registered.
function decideDisputeReversal(dispute, charge) {
  const d = dispute || {};
  const c = charge || {};
  const t = c.transfer;
  const funds = disputeFundsWithdrawn(d);
  const transferId = typeof t === 'string' ? t : str(t && t.id);
  if (!transferId.startsWith('tr_')) {
    return { reverse: false, transferId: null, amountCents: 0, reason: 'no_transfer', inquiry: funds.inquiry };
  }
  if (!funds.withdrawn) {
    // Two distinct waits, never collapsed: an inquiry may never debit us at
    // all, while a real dispute whose withdrawal has not landed yet will.
    // The caller's copy says which one out loud.
    return {
      reverse: false,
      transferId,
      amountCents: 0,
      reason: funds.inquiry ? 'inquiry_no_funds_withdrawn' : 'funds_not_yet_withdrawn',
      inquiry: funds.inquiry,
    };
  }
  const disputed = Number(d.amount);
  if (!Number.isInteger(disputed) || disputed <= 0) {
    return { reverse: false, transferId, amountCents: 0, reason: 'malformed', inquiry: false };
  }
  const tAmount = (t && typeof t === 'object') ? Number(t.amount) : NaN;
  const tReversed = (t && typeof t === 'object') ? (Number(t.amount_reversed) || 0) : 0;
  if (Number.isInteger(tAmount) && tAmount > 0) {
    const remaining = tAmount - tReversed;
    if (remaining <= 0) return { reverse: false, transferId, amountCents: 0, reason: 'nothing_to_reverse', inquiry: false };
    return { reverse: true, transferId, amountCents: Math.min(disputed, remaining), reason: 'destination_charge', inquiry: false };
  }
  return { reverse: true, transferId, amountCents: null, reason: 'destination_charge', inquiry: false };
}

// ── Test-mode opt-in (phase 3) ──────────────────────────────────────────
// The ONLY sanctioned source of mayCollectOnline's allowTestMode. Set in
// the emulator/QA env (functions/.env.local, demo- projects only), NEVER a
// prod default. Takes the env object as an argument so this module stays
// pure and unit-testable. Strict string '1' — never truthiness.
function connectTestModeAllowed(env) {
  return !!env && env.NBD_CONNECT_ALLOW_TEST_MODE === '1';
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
  platformFeeCents,
  disputeFundsWithdrawn,
  decideDisputeReversal,
  connectTestModeAllowed,
  PLATFORM_FEE_BPS,
  PLATFORM_FEE_FLAT_CENTS,
  REQUESTED_CAPABILITIES,
  CLAIM_STALE_MS,
};

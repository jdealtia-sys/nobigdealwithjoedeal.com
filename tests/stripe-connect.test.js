/**
 * tests/stripe-connect.test.js — Stripe Connect Express, phase 1.
 *
 * Phase 1 creates connected accounts and onboards them. It moves NO money: no
 * payment links, no charges, no application_fee, no on_behalf_of. The #1123
 * platform-only gate stays closed, and tests/stripe-platform-only-payments.test.js
 * still pins that. This suite pins the decisions that would be expensive to get
 * wrong later:
 *
 *   - a bad/absent Stripe capability must never read as "enabled"
 *   - two admins clicking Connect must not mint two accounts holding real money
 *   - an out-of-order or TEST-mode account.updated must not flip LIVE state
 *   - requirement VALUES (SSN-class PII) must never be mirrored into Firestore
 *   - mayCollectOnline() — the future gate-lift predicate — must be strict now,
 *     while nothing depends on it, rather than argued about under pressure later
 *
 * Zero deps (the logic module is deliberately firebase-free).
 * Run: node tests/stripe-connect.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const L = require(path.join('..', 'functions', 'stripe-connect-logic.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HANDLER = read('functions/handlers/stripe-connect.js');
// Comment-stripped view. Every NEGATIVE assertion below MUST use this: the
// handler's own comments legitimately mention STRIPE_WEBHOOK_SECRET, req.body,
// companyProfile+chargesEnabled and mayCollectOnline() while explaining why it
// does NOT use them — asserting on raw source makes the prose fail the test.
const decomment = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const CODE = decomment(HANDLER);
const LOGIC = read('functions/stripe-connect-logic.js');
const INDEX = read('functions/index.js');
const RULES = read('firestore.rules');

console.log('STRIPE CONNECT — phase 1 (accounts + onboarding, money gate closed)');

// ── deriveConnectState: booleans must FAIL CLOSED ─────────────────────────
console.log('\nderiveConnectState — capability state fails closed');
{
  const full = L.deriveConnectState({
    id: 'acct_123', type: 'express', livemode: true,
    charges_enabled: true, payouts_enabled: true, details_submitted: true,
    country: 'US', default_currency: 'usd',
    capabilities: { card_payments: 'active', transfers: 'active' },
    requirements: { disabled_reason: null, currently_due: [], past_due: [] },
  });
  ok('a fully onboarded account maps through', full.accountId === 'acct_123'
    && full.chargesEnabled === true && full.payoutsEnabled === true
    && full.detailsSubmitted === true && full.livemode === true);

  const empty = L.deriveConnectState({});
  ok('an empty account object yields all-false, never undefined',
    empty.chargesEnabled === false && empty.payoutsEnabled === false
    && empty.detailsSubmitted === false && empty.livemode === false,
    JSON.stringify(empty));
  ok('null/undefined input does not throw',
    L.deriveConnectState(null).chargesEnabled === false
    && L.deriveConnectState(undefined).chargesEnabled === false);

  // Truthy-but-not-true must NOT enable. 'true', 1, {} are the shapes a sloppy
  // mirror or a hand-edited doc produces.
  for (const bad of ['true', 1, {}, [], 'yes']) {
    const s = L.deriveConnectState({ id: 'acct_1', charges_enabled: bad, livemode: bad });
    ok('charges_enabled=' + JSON.stringify(bad) + ' does NOT enable charges',
      s.chargesEnabled === false && s.livemode === false);
  }
}

// ── PII: requirement NAMES yes, VALUES never ──────────────────────────────
console.log('\nPII containment');
{
  const s = L.deriveConnectState({
    id: 'acct_1',
    requirements: {
      currently_due: ['individual.id_number', 'external_account'],
      errors: [{ code: 'verification_failed_other', reason: 'The SSN 123-45-6789 could not be verified' }],
    },
    individual: { id_number: '123-45-6789', ssn_last_4: '6789', email: 'contractor@example.com' },
    external_accounts: { data: [{ last4: '4242' }] },
    tos_acceptance: { ip: '1.2.3.4', user_agent: 'Mozilla' },
  });
  ok('requirement FIELD NAMES are mirrored',
    eq(s.requirementsCurrentlyDue, ['individual.id_number', 'external_account']));
  ok('requirement error CODES are mirrored, not free-text reasons',
    eq(s.requirementsErrorCodes, ['verification_failed_other']));
  const blob = JSON.stringify(s);
  for (const secret of ['123-45-6789', '6789', 'could not be verified', '1.2.3.4', 'Mozilla', '4242']) {
    ok('no PII leak: ' + JSON.stringify(secret) + ' is absent from the mirror',
      blob.indexOf(secret) === -1, blob.slice(0, 160));
  }
  ok('the individual / external_accounts / tos blocks are not mirrored at all',
    !('individual' in s) && !('external_accounts' in s) && !('tos_acceptance' in s));
}

// ── decideAccountCreate: two admins must not mint two accounts ────────────
console.log('\ndecideAccountCreate — the duplicate-account race');
{
  const now = 1_700_000_000_000;
  ok('no row → create', L.decideAccountCreate(null, now).action === 'create');
  ok('row with an accountId → idempotent no-op (never a second account)',
    L.decideAccountCreate({ accountId: 'acct_9' }, now).action === 'existing');
  ok('a FRESH creating claim blocks a concurrent caller',
    L.decideAccountCreate({ status: 'creating', claimedAtMs: now - 1000 }, now).action === 'in_flight');
  ok('a STALE creating claim is surfaced, NOT auto-retried',
    L.decideAccountCreate({ status: 'creating', claimedAtMs: now - (L.CLAIM_STALE_MS + 1) }, now).action === 'stale_claim',
    'auto-retry is the one behaviour that can mint a duplicate holding real money');
  ok('a claim with a garbage timestamp is treated as stale, not in-flight',
    L.decideAccountCreate({ status: 'creating', claimedAtMs: 'nope' }, now).action === 'stale_claim');
  ok('a failed row can be retried',
    L.decideAccountCreate({ status: 'failed' }, now).action === 'create');
  ok('an accountId WINS over a creating status (never re-create over a real account)',
    L.decideAccountCreate({ status: 'creating', claimedAtMs: now, accountId: 'acct_9' }, now).action === 'existing');
}

// ── idempotency key must be companyId-derived and stable ──────────────────
console.log('\naccountIdempotencyKey');
{
  ok('stable across calls', L.accountIdempotencyKey('c1') === L.accountIdempotencyKey('c1'));
  ok('distinct per tenant', L.accountIdempotencyKey('c1') !== L.accountIdempotencyKey('c2'));
  ok('contains the companyId', L.accountIdempotencyKey('c1').indexOf('c1') !== -1);
  ok('the handler passes it as idempotencyKey to accounts.create',
    /idempotencyKey: L\.accountIdempotencyKey\(companyId\)/.test(HANDLER));
  ok('no random/uuid/Date.now key anywhere near account creation',
    !/idempotencyKey:\s*(?:.*(?:random|uuid|Date\.now))/i.test(HANDLER),
    'a fresh key on retry mints a SECOND connected account');
}

// ── decideWebhookApply: order + livemode ──────────────────────────────────
console.log('\ndecideWebhookApply — out-of-order and cross-mode protection');
{
  const stored = { livemode: true, lastAccountEventAt: 1000 };
  ok('a platform event (no event.account) is not applied',
    L.decideWebhookApply(stored, { created: 2000, livemode: true }).reason === 'platform_event');
  ok('an unknown account is not applied',
    L.decideWebhookApply(null, { account: 'acct_x', created: 2000, livemode: true }).reason === 'unknown_account');
  ok('a newer event applies',
    L.decideWebhookApply(stored, { account: 'acct_x', created: 2000, livemode: true }).apply === true);
  ok('an OLDER event is skipped (the seat-reversal class)',
    L.decideWebhookApply(stored, { account: 'acct_x', created: 999, livemode: true }).reason === 'out_of_order');
  ok('a same-second event DOES apply (two real changes can share a timestamp)',
    L.decideWebhookApply(stored, { account: 'acct_x', created: 1000, livemode: true }).apply === true);
  ok('a TEST-mode event must not touch LIVE state',
    L.decideWebhookApply(stored, { account: 'acct_x', created: 2000, livemode: false }).reason === 'livemode_mismatch',
    'one deployed function serves both modes');
  ok('a LIVE event must not touch TEST state',
    L.decideWebhookApply({ livemode: false, lastAccountEventAt: 1 }, { account: 'acct_x', created: 2, livemode: true }).reason === 'livemode_mismatch');
  ok('a first event with no stored watermark applies and sets one',
    L.decideWebhookApply({ livemode: true }, { account: 'acct_x', created: 500, livemode: true }).watermark === 500);
}

// ── mayCollectOnline: the FUTURE gate-lift predicate ──────────────────────
console.log('\nmayCollectOnline — strict now, while nothing depends on it');
{
  const ready = { accountId: 'acct_1', chargesEnabled: true, detailsSubmitted: true, livemode: true, payoutsEnabled: true };
  ok('a live, charges-enabled, onboarded account may collect', L.mayCollectOnline(ready) === true);
  ok('a TEST-mode account may NOT collect in live', L.mayCollectOnline(Object.assign({}, ready, { livemode: false })) === false);
  ok('charges disabled → no', L.mayCollectOnline(Object.assign({}, ready, { chargesEnabled: false })) === false);
  ok('onboarding incomplete → no', L.mayCollectOnline(Object.assign({}, ready, { detailsSubmitted: false })) === false);
  ok('no account id → no', L.mayCollectOnline(Object.assign({}, ready, { accountId: null })) === false);
  ok('a non-acct_ id → no', L.mayCollectOnline(Object.assign({}, ready, { accountId: 'cus_123' })) === false);
  ok('payouts on hold does NOT block collecting (UI warning, not a charge block)',
    L.mayCollectOnline(Object.assign({}, ready, { payoutsEnabled: false })) === true);
  ok('empty/null state → no', L.mayCollectOnline(null) === false && L.mayCollectOnline({}) === false);
  ok('allowTestMode:true is opt-in only (for test-mode QA)',
    L.mayCollectOnline(Object.assign({}, ready, { livemode: false }), { allowTestMode: true }) === true);
}

// ── describeConnectStatus ─────────────────────────────────────────────────
console.log('\ndescribeConnectStatus');
{
  ok('no account → not_started', L.describeConnectStatus({}).code === 'not_started');
  ok('account, no details → onboarding_incomplete',
    L.describeConnectStatus({ accountId: 'acct_1' }).code === 'onboarding_incomplete');
  ok('details in, charges pending → verifying (NOT an error)',
    L.describeConnectStatus({ accountId: 'acct_1', detailsSubmitted: true }).code === 'verifying');
  ok('charges on, payouts off → payouts_paused',
    L.describeConnectStatus({ accountId: 'acct_1', detailsSubmitted: true, chargesEnabled: true }).code === 'payouts_paused');
  ok('all on → ready',
    L.describeConnectStatus({ accountId: 'acct_1', detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true }).code === 'ready');
}

// ── PHASE-1 CONTAINMENT: this must not move money ─────────────────────────
console.log('\nPhase-1 containment (the money gate stays closed)');
{
  const decommented = HANDLER.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const forbidden of ['application_fee', 'on_behalf_of', 'transfer_data', 'paymentLinks.create', 'paymentIntents.create', 'charges.create']) {
    ok('phase 1 contains no ' + forbidden, decommented.indexOf(forbidden) === -1,
      'phase 1 creates accounts only — money movement is a later, deliberate change');
  }
  ok('the #1123 platform-only gate is still intact in stripe.js',
    /if \(!isPlatformTenant\(decoded\)\) \{/.test(read('functions/stripe.js'))
    && /ONLINE_PAYMENTS_UNAVAILABLE/.test(read('functions/stripe.js')));
  ok('phase 1 reports onlinePaymentsEnabled:false to the client',
    /onlinePaymentsEnabled: false/.test(HANDLER));
  ok('mayCollectOnline has NO caller yet (it is the future gate, documented now)',
    !/mayCollectOnline\(/.test(CODE) && !/mayCollectOnline\(/.test(decomment(read('functions/stripe.js'))));
}

// ── Wiring: deploy discoverability, secrets, rules ────────────────────────
console.log('\nWiring');
{
  // The deploy enumerates functions by grepping `^exports.NAME = onCall|onRequest`
  // in functions/*.js, integrations/*.js, handlers/*.js. A function declared any
  // other way silently never deploys.
  const DEPLOY_RE = /^exports\.([a-zA-Z_][a-zA-Z0-9_]*) *= *(onRequest|onCall)/gm;
  const found = [];
  let m;
  while ((m = DEPLOY_RE.exec(HANDLER)) !== null) found.push(m[1]);
  const expected = ['createConnectAccount', 'createConnectOnboardingLink', 'getConnectStatus', 'createConnectDashboardLink', 'stripeConnectWebhook'];
  for (const fn of expected) {
    ok('deploy scanner can see ' + fn, found.indexOf(fn) !== -1,
      'must be a top-level `exports.NAME = onCall(`/`onRequest(` or it never deploys');
    ok('index.js re-exports ' + fn, new RegExp('exports\\.' + fn + '\\s*=\\s*stripeConnectHandlers\\.' + fn).test(INDEX));
  }

  ok('the Connect webhook uses its OWN signing secret',
    /defineSecret\('STRIPE_CONNECT_WEBHOOK_SECRET'\)/.test(HANDLER));
  ok('it does NOT fall back to the platform webhook secret',
    !/STRIPE_WEBHOOK_SECRET/.test(CODE),
    'accepting a platform-signed payload here would let a replayed event write account state');
  ok('an unset webhook secret fails CLOSED (never "skip verification")',
    /startsWith\('whsec_'\)/.test(HANDLER) && /webhook not configured/.test(HANDLER));
  ok('signature verification pins an explicit 300s tolerance',
    /constructEvent\(req\.rawBody, sig, secret, 300\)/.test(HANDLER));
  ok('rawBody is required with no req.body fallback',
    /Buffer\.isBuffer\(req\.rawBody\)/.test(CODE) && !/req\.body\b/.test(CODE));
  ok('the idempotency marker is DELETED before a 500 (or the retry no-ops)',
    /eventRef\.delete\(\)[\s\S]{0,200}status\(500\)/.test(HANDLER));
  ok('an unknown connected account returns 200, not 500 (no 3-day retry storm)',
    /connect_webhook_unknown_account[\s\S]{0,200}res\.json/.test(HANDLER));

  ok('account state is admin-SDK-only in the rules',
    /match \/connectAccounts\/\{companyId\}[\s\S]{0,400}allow write: if false;/.test(RULES));
  ok('account state is same-tenant readable (a rep needs the capability check)',
    /match \/connectAccounts\/\{companyId\}[\s\S]{0,400}companyId == myCompanyId\(\)/.test(RULES));
  ok('the reverse index is fully client-denied',
    /match \/connectAccountIds\/\{accountId\}[\s\S]{0,200}allow read, write: if false;/.test(RULES));
  ok('Connect state is NOT stored on the browser-writable companyProfile',
    !/companyProfile/.test(CODE) && !/pricing\.connect/.test(CODE));

  ok('account creation is owner/company_admin gated',
    /createConnectAccount = onCall\([\s\S]{0,600}requireTeamAdmin\(request\)/.test(HANDLER));
  ok('onboarding + dashboard links are owner/company_admin gated (they authenticate the holder)',
    /createConnectOnboardingLink = onCall\([\s\S]{0,700}requireTeamAdmin\(request\)/.test(HANDLER)
    && /createConnectDashboardLink = onCall\([\s\S]{0,700}requireTeamAdmin\(request\)/.test(HANDLER));
  ok('the onboarding link is never persisted (it authenticates the account holder)',
    !/set\([\s\S]{0,120}link\.url/.test(HANDLER) && !/onboardingUrl/.test(HANDLER));
  ok('return/refresh URLs are absolute apex /pro/dashboard (the /pro/settings 404 lesson)',
    /const APEX = 'https:\/\/nobigdealwithjoedeal\.com'/.test(CODE)
    && /APEX \+ '\/pro\/dashboard\?settings=billing&connect=return'/.test(CODE)
    && /APEX \+ '\/pro\/dashboard\?settings=billing&connect=refresh'/.test(CODE));
  ok('the logic module stays firebase-free so it is unit-testable',
    !/require\('firebase/.test(LOGIC) && !/require\('stripe'\)/.test(LOGIC));
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }

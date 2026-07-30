/**
 * tests/stripe-platform-only-payments.test.js — online card collection is
 * PLATFORM-ONLY until Stripe Connect ships.
 *
 * THE PROBLEM. Stripe serves two different money flows here through ONE client
 * on the platform's secret key:
 *   1. subscription billing — a contractor paying US. Ours. Correct.
 *   2. invoice payment links — a contractor's HOMEOWNER paying the CONTRACTOR.
 *      Theirs. Was settling into OUR balance.
 *
 * getStripe() memoizes one client on STRIPE_SECRET_KEY. That was fine while we
 * were the only tenant and became wrong the moment anyone else could sign up —
 * chargebacks against our account for work we did not do, a 1099-K reporting
 * their revenue as ours, and collecting funds on behalf of other businesses
 * (which is why Connect exists).
 *
 * STATUS 2026-07-29: Connect Express PHASE 1 has landed — connected accounts
 * and onboarding exist (functions/handlers/stripe-connect.js). What still does
 * NOT exist is any way to ROUTE money to those accounts, so the platform-only
 * gate remains necessary and this suite still guards it.
 *
 * So this pins:
 *   Part 1 — the MONEY primitives (on_behalf_of / transfer_data /
 *            application_fee) are absent everywhere, and Connect ACCOUNT
 *            plumbing stays confined to the Connect files. When phase 3 lifts
 *            the gate, Part 1 is the assertion to rewrite — deliberately, as
 *            this one was — and the gate checks below are what
 *            mayCollectOnline() replaces. Never delete them.
 *   Part 2 — the server refuses non-platform tenants BEFORE any Stripe call.
 *   Part 3 — the client mirrors it, fails closed, and an invoice is never lost
 *            because a link failed.
 *
 * Zero deps.  Run: node tests/stripe-platform-only-payments.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const decomment = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('STRIPE — online collection is platform-only until Connect ships');

// ── Part 1: Connect exists, but CANNOT route money yet ────────────────
//
// REWRITTEN 2026-07-29 (Connect phase 1), exactly as the original assertion
// instructed: it asserted "no Connect plumbing anywhere in functions/", which
// was the gate's premise while Connect did not exist. Phase 1 added connected
// ACCOUNTS + onboarding, so that assertion fired — the documented signal to
// rewrite it deliberately, never to delete it.
//
// The premise the gate actually rests on is narrower and still true: no code
// path can route a homeowner's payment to a tenant's account. So this now pins
// two things instead:
//   (a) the MONEY primitives are absent everywhere — that is what makes the
//       platform-only gate still necessary. When phase 3 lifts the gate, THIS
//       is the assertion to rewrite (again, deliberately), and the gate checks
//       in Parts 2-4 are what must be replaced by mayCollectOnline().
//   (b) the ACCOUNT primitives are confined to the two Connect files, so
//       account plumbing cannot quietly appear inside the subscription or
//       invoice paths.
{
  const fnDir = path.join(ROOT, 'functions');
  // Routing money on someone else's behalf. NONE of these may exist yet.
  const MONEY = /on_behalf_of|transfer_data|application_fee/;
  // Creating/holding a connected account. Allowed, but only in the Connect files.
  const ACCOUNT = /stripeAccount|accounts\.create|accountLinks\.create|createLoginLink/;
  const CONNECT_FILES = new Set([
    path.join('functions', 'handlers', 'stripe-connect.js'),
    path.join('functions', 'stripe-connect-logic.js'),
  ]);

  const moneyHits = [];
  const accountHits = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '_archive') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.js')) continue;
      const rel = path.relative(ROOT, full);
      const src = decomment(fs.readFileSync(full, 'utf8'));
      if (MONEY.test(src)) moneyHits.push(rel);
      if (ACCOUNT.test(src) && !CONNECT_FILES.has(rel)) accountHits.push(rel);
    }
  })(fnDir);

  ok('no per-tenant MONEY routing anywhere in functions/ (so the gate is still required)',
    moneyHits.length === 0,
    moneyHits.length
      ? 'on_behalf_of / transfer_data / application_fee appeared in ' + moneyHits.join(', ')
        + ' — that is the gate lift. Rewrite this assertion and Parts 2-4 deliberately, do not delete them.'
      : '');

  ok('Connect ACCOUNT plumbing stays inside the two Connect files',
    accountHits.length === 0,
    accountHits.length
      ? 'account primitives leaked into ' + accountHits.join(', ')
        + ' — the subscription and invoice paths must not grow Connect plumbing sideways'
      : '');

  // The phase-1 files themselves must exist, or the two checks above are
  // vacuously true and this test would silently stop meaning anything.
  ok('the Connect phase-1 files are present (these checks are not vacuous)',
    fs.existsSync(path.join(ROOT, 'functions/handlers/stripe-connect.js'))
    && fs.existsSync(path.join(ROOT, 'functions/stripe-connect-logic.js')));
}

// ── Part 2: the server refuses non-platform tenants ───────────────────
{
  const s = read('functions/stripe.js');
  const code = decomment(s);

  ok('a platform-tenant predicate exists', /function isPlatformTenant\(decoded\)/.test(code));
  ok('it accepts either the companyId claim or the raw owner uid',
    /decoded\.uid === NBD_OWNER_UID \|\| companyId === NBD_OWNER_UID/.test(code),
    'solo convention is companyId == uid; a platform admin without the claim must not be locked out');
  ok('the owner uid is env-overridable', /process\.env\.NBD_OWNER_UID/.test(code));

  ok('createStripePaymentLink refuses non-platform tenants',
    /if \(!isPlatformTenant\(decoded\)\) \{/.test(code));
  ok('it refuses with 403, not 402',
    /res\.status\(403\)[\s\S]{0,200}ONLINE_PAYMENTS_UNAVAILABLE/.test(code),
    '402 reads as an upsell; this is a capability we must not exercise on their behalf');

  // Ordering is the whole point: refusing after the Stripe call would still
  // have minted the link.
  const handlerAt = s.indexOf('exports.createStripePaymentLink');
  const gateAt = s.indexOf('if (!isPlatformTenant(decoded))', handlerAt);
  const stripeCallAt = s.indexOf('paymentLinks.create', handlerAt);
  ok('the refusal happens BEFORE any Stripe call',
    gateAt > handlerAt && stripeCallAt > gateAt,
    'a gate after paymentLinks.create has already taken the money');
}

// ── Part 3: the client mirrors it and never loses an invoice ──────────
{
  const c = decomment(read('docs/pro/js/invoice-pipeline.js'));

  ok('client has a matching capability check', /function _canCollectOnline\(\)/.test(c));
  ok('it fails CLOSED on an unresolved identity',
    /catch \(e\) \{\s*return false;/.test(c),
    'an unknown identity must not be treated as the platform tenant');
  ok('generateStripePaymentLink short-circuits for a tenant',
    /if \(!_canCollectOnline\(\)\) \{[\s\S]{0,300}ONLINE_PAYMENTS_UNAVAILABLE/.test(c));

  // The duplicate-invoice bug: link generation must not sit inside the same
  // try as invoice creation, or a link failure reads as a creation failure.
  const createAt = c.indexOf('const invoiceId = await createInvoiceFromEstimate(estimateId);');
  const toastAt = c.indexOf("showToast('Invoice created successfully', 'success')");
  const linkAt = c.indexOf('await generateStripePaymentLink(invoiceId);', createAt);
  ok('invoice creation is reported BEFORE the payment link is attempted',
    createAt > -1 && toastAt > createAt && linkAt > toastAt,
    'a link failure used to skip the success toast AND the detail modal -> rep clicks Create again -> two invoices');
  ok('the link attempt has its own catch',
    /catch \(linkErr\)/.test(c));
  ok('a tenant is told to use Mark Paid rather than shown an error',
    /Mark Paid/.test(c));

  // An invoice SMS with no link must not send a dangling "Payment link: ".
  ok('the invoice SMS drops the link line when there is no link',
    /link\s*\n?\s*\? `Your \$\{_invoiceCompany\(\)\} invoice is ready\. Payment link/.test(c)
    || /\? `Your \$\{_invoiceCompany\(\)\} invoice is ready\. Payment link: \$\{link\}`/.test(c));
}

// ── Part 4: the OTHER homeowner→contractor path is gated too ──────────
// Found while scoping Connect (2026-07-29): createStripePaymentLink was gated
// by #1123, but functions/integrations/esign.js createStripeInvoiceForEstimate
// — which runs from the BoldSign signature webhook on every signed estimate —
// had NO tenant check at all. It creates a Stripe CUSTOMER for the homeowner and
// an INVOICE on the PLATFORM account. Nothing is charged (the invoice is a draft:
// auto_advance:false + collection_method:'send_invoice'), but for a non-platform
// tenant it still parks their homeowner's PII and their job amount in our
// dashboard, one "send" click from collecting another business's money.
{
  const e = decomment(read('functions/integrations/esign.js'));

  ok('esign auto-invoice resolves the tenant from the estimate (no token in a webhook)',
    /const ownerUid = est\.userId \|\| null;/.test(e) && /const companyId = est\.companyId \|\| null;/.test(e),
    'the BoldSign webhook has no decoded token, so the gate must read the estimate');

  ok('esign auto-invoice computes the platform check',
    /const isPlatform = ownerUid === NBD_OWNER_UID \|\| companyId === NBD_OWNER_UID;/.test(e));

  // The refusal must RETURN. "Warn and continue" is the explicitly forbidden
  // shape (see the block comment in stripe.js): minting the customer/invoice IS
  // the act, and a log line nobody reads does not change where the money can go.
  // Scoped to the text BETWEEN the gate and the first Stripe call — a loose
  // whole-file window matches an unrelated later `return;` and passes over a
  // deleted one (verified by mutation).
  {
    // Brace-match the gate's OWN block. Anything looser passes over a deleted
    // return by matching an unrelated one — a whole-file window matched a later
    // return, and a gate→first-Stripe-call window matched the adjacent
    // `if (!signerEmail) { … return; }`. Both verified by mutation.
    const gateAt = e.indexOf('if (!isPlatform) {');
    let block = '';
    if (gateAt !== -1) {
      const open = e.indexOf('{', gateAt);
      let depth = 0;
      for (let i = open; i < e.length; i++) {
        if (e[i] === '{') depth++;
        else if (e[i] === '}') { depth--; if (depth === 0) { block = e.slice(open, i + 1); break; } }
      }
    }
    ok('the non-platform branch RETURNS (never warn-and-continue)',
      gateAt !== -1 && block !== '' && /\breturn;/.test(block),
      'the refusal block must return; a log line nobody reads does not stop the Stripe writes');
  }

  // Order matters: the refusal has to precede the Stripe calls, exactly like the
  // payment-link gate. A check placed after the customer create would still
  // leave their homeowner on our account.
  const gateIdx = e.indexOf('const isPlatform = ownerUid === NBD_OWNER_UID');
  const custIdx = e.indexOf('stripe.customers.search');
  const invIdx = e.indexOf('stripe.invoices.create');
  ok('the gate sits BEFORE the customer search and the invoice create',
    gateIdx !== -1 && custIdx !== -1 && invIdx !== -1 && gateIdx < custIdx && gateIdx < invIdx,
    `gate@${gateIdx} customers.search@${custIdx} invoices.create@${invIdx}`);

  // stripe.js keeps isPlatformTenant() private (it takes a decoded token), so
  // esign.js re-reads the same env override. The two defaults must not drift —
  // a mismatch would silently gate the platform owner out of our own invoicing,
  // or let a tenant through.
  const s = read('functions/stripe.js');
  const grab = (src) => (src.match(/NBD_OWNER_UID \|\| '([^']+)'/) || [])[1] || null;
  ok('esign.js and stripe.js resolve the SAME platform owner uid',
    grab(s) && grab(e) && grab(s) === grab(e),
    `stripe.js=${grab(s)} esign.js=${grab(e)}`);
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

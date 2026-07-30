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
 * There is no Connect: no stripeAccount, no on_behalf_of, no transfer_data, no
 * accounts.create anywhere in functions/. getStripe() memoizes one client on
 * STRIPE_SECRET_KEY. That was fine while we were the only tenant and became
 * wrong the moment anyone else could sign up — chargebacks against our account
 * for work we did not do, a 1099-K reporting their revenue as ours, and
 * collecting funds on behalf of other businesses (which is why Connect exists).
 *
 * So this pins three things:
 *   Part 1 — Connect really is absent, so the gate stays necessary. If someone
 *            adds Connect, this test SHOULD fail and be rewritten; that is the
 *            signal to lift the restriction, not to delete the assertion.
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

// ── Part 1: Connect is still absent (the gate's whole premise) ────────
{
  const fnDir = path.join(ROOT, 'functions');
  const CONNECT = /stripeAccount|on_behalf_of|transfer_data|application_fee|accounts\.create|acct_/;
  const hits = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '_archive') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.js')) continue;
      const src = decomment(fs.readFileSync(full, 'utf8'));
      if (CONNECT.test(src)) hits.push(path.relative(ROOT, full));
    }
  })(fnDir);
  ok('no Stripe Connect plumbing in functions/ (so the gate is still required)',
    hits.length === 0,
    hits.length ? 'Connect appeared in ' + hits.join(', ') + ' — time to lift the gate deliberately, not delete this test' : '');
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

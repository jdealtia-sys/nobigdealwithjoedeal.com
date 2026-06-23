/**
 * tests/stripe-payment-link-tax.test.js — regression tests for the sales-tax
 * reconciliation in createStripePaymentLink (functions/stripe.js, H3 money bug).
 *
 * The Cloud Function can't be require()d standalone (it calls onRequest /
 * defineSecret at module load), so this is a LOGIC-MIRROR test: `reconcile()`
 * below is a faithful copy of the synchronous line-item / tax / total-guard
 * block in functions/stripe.js (the part after the catalog loop, ~L763-820).
 * If you change that block in stripe.js, mirror it here.
 *
 * The bug it guards: invoice.items hold TAX-EXCLUSIVE line totals; without an
 * explicit tax line the payment link charges the pre-tax subtotal and the
 * customer underpays by the entire sales tax. These tests prove (1) a taxed
 * invoice gets a 'Sales Tax' line and the link total equals invoice.total, and
 * (2) any invoice that would charge the wrong amount is REFUSED, not billed.
 *
 * Zero deps. Run: node tests/stripe-payment-link-tax.test.js
 */
'use strict';

const MIN_CENTS = 100;            // $1.00 minimum per product line
const MAX_CENTS = 10_000_000;     // $100k maximum per line

// Faithful mirror of the stripe.js block. Returns { lineItems } on success or
// { error } when the function would have responded with a 4xx.
function reconcile(invoice) {
  const lineItems = [];
  for (const item of (invoice.items || [])) {
    // (productId catalog branch omitted — estimate→invoice items carry no
    // productId, so the live path always uses the client line total.)
    const cents = Math.round(Number(item.total || 0) * 100);
    if (!Number.isFinite(cents) || cents < MIN_CENTS || cents > MAX_CENTS) {
      return { error: 'Line item amount out of allowed range' };
    }
    lineItems.push({ price_data: { unit_amount: cents }, quantity: 1 });
  }
  if (lineItems.length === 0) return { error: 'Invoice has no line items' };

  const productSumCents = lineItems.reduce((s, li) => s + li.price_data.unit_amount * li.quantity, 0);
  const expectedTotalCents = Math.round(Number(invoice.total || 0) * 100);
  const taxCents = Math.round(Number(invoice.tax || 0) * 100);

  if (!Number.isFinite(taxCents) || taxCents < 0 || taxCents > MAX_CENTS) {
    return { error: 'Invoice tax amount out of allowed range' };
  }
  if (taxCents > 0) {
    lineItems.push({ price_data: { product_data: { name: 'Sales Tax' }, unit_amount: taxCents }, quantity: 1 });
  }

  const linkTotalCents = lineItems.reduce((s, li) => s + li.price_data.unit_amount * li.quantity, 0);
  const reconcileTolCents = Math.max(2, lineItems.length);
  if (Math.abs(linkTotalCents - expectedTotalCents) > reconcileTolCents) {
    return { error: 'Invoice total does not reconcile; refusing to create payment link' };
  }
  return { lineItems, productSumCents, linkTotalCents, expectedTotalCents };
}

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }
const taxLine = (r) => (r.lineItems || []).find(li => li.price_data.product_data && li.price_data.product_data.name === 'Sales Tax');

// S1 — happy path: $10,000 subtotal + 7.5% tax = $10,750 total.
{
  const r = reconcile({ items: [{ total: 5000 }, { total: 5000 }], tax: 750, total: 10750 });
  ok('S1 taxed invoice succeeds', !r.error);
  ok('S1 has a Sales Tax line of 75000¢', !!taxLine(r) && taxLine(r).price_data.unit_amount === 75000);
  ok('S1 link total === invoice.total (1075000¢)', r.linkTotalCents === 1075000 && r.linkTotalCents === r.expectedTotalCents);
}

// S2 — THE BUG: items sum to the pre-tax subtotal but total includes tax, and
// no tax line is produced (tax field 0). The pre-fix code would have charged
// productSumCents and undercharged by $750. The guard must REFUSE.
{
  const r = reconcile({ items: [{ total: 5000 }, { total: 5000 }], tax: 0, total: 10750 });
  ok('S2 undercharge-by-tax is REFUSED (not billed pre-tax)', r.error === 'Invoice total does not reconcile; refusing to create payment link');
}

// S3 — zero-tax insurance scope: subtotal === total, no tax line, reconciles.
{
  const r = reconcile({ items: [{ total: 5000 }, { total: 5000 }], tax: 0, total: 10000 });
  ok('S3 zero-tax invoice succeeds', !r.error);
  ok('S3 has no Sales Tax line', !taxLine(r));
  ok('S3 link total === invoice.total', r.linkTotalCents === r.expectedTotalCents);
}

// S4 — full-precision line totals (fractional qty × cents): per-line rounding
// drift must stay within tolerance and still reconcile.
{
  const r = reconcile({ items: [{ total: 33.335 }, { total: 33.335 }, { total: 33.335 }], tax: 7.500375, total: 107.505375 });
  ok('S4 fractional-drift invoice succeeds within tolerance', !r.error);
  ok('S4 link total within 2¢ of expected', Math.abs(r.linkTotalCents - r.expectedTotalCents) <= 2);
}

// S5 — corrupt/tampered stored total beyond tolerance: items+tax = $10,750 but
// invoice.total claims $11,000. Must REFUSE rather than charge the wrong amount.
{
  const r = reconcile({ items: [{ total: 5000 }, { total: 5000 }], tax: 750, total: 11000 });
  ok('S5 total mismatch beyond tolerance is REFUSED', r.error === 'Invoice total does not reconcile; refusing to create payment link');
}

// S6 — sub-$1 tax is allowed: the tax line is NOT subject to the $1 per-line
// minimum that applies to product lines.
{
  const r = reconcile({ items: [{ total: 5.00 }], tax: 0.30, total: 5.30 });
  ok('S6 sub-$1 tax line succeeds', !r.error);
  ok('S6 Sales Tax line is 30¢', !!taxLine(r) && taxLine(r).price_data.unit_amount === 30);
  ok('S6 link total === 530¢', r.linkTotalCents === 530 && r.linkTotalCents === r.expectedTotalCents);
}

// S7 — product line below $1 minimum still rejected (existing guard preserved).
{
  const r = reconcile({ items: [{ total: 0.50 }], tax: 0.04, total: 0.54 });
  ok('S7 sub-$1 product line rejected', r.error === 'Line item amount out of allowed range');
}

// S8 — negative tax rejected.
{
  const r = reconcile({ items: [{ total: 100 }], tax: -5, total: 95 });
  ok('S8 negative tax rejected', r.error === 'Invoice tax amount out of allowed range');
}

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }

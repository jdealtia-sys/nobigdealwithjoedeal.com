/**
 * invoice-pipeline.test.js
 *
 * Locks in the supplement-inclusive invoice math added for the
 * 2026-06-27 adversarial-review finding (HIGH): createInvoiceFromEstimate
 * billed only the estimate's saved total and IGNORED approved/partial
 * insurance supplements, so invoices undercharged by the supplement amount.
 *
 * Covers the pure helpers exported from docs/pro/js/invoice-pipeline.js:
 *   - supplementBillableAmount  (approved → supplementTotal; partial → approvedAmount)
 *   - selectBillableSupplements (filter to billable + build line description)
 *   - applySupplementsToTotals  (fold into subtotal/total, leave tax untouched)
 *
 * Pure-Node test, no emulator/DOM required. Run via:
 *   node tests/invoice-pipeline.test.js
 */

const path = require('path');
const IP = require(path.join('..', 'docs', 'pro', 'js', 'invoice-pipeline.js'));
const ES = require(path.join('..', 'docs', 'pro', 'js', 'estimate-supplement.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failed++; }
}
function eq(actual, expected, label) {
  if (actual !== expected) throw new Error((label || 'value') + ' = ' + JSON.stringify(actual) + ' (expected ' + JSON.stringify(expected) + ')');
}
function near(actual, expected, tol, label) {
  if (Math.abs(actual - expected) > (tol || 0.005)) throw new Error((label || 'value') + ' = ' + actual + ' (expected ~' + expected + ')');
}

// Supplement doc shapes mirror docs/pro/js/estimate-supplement.js.
const approved2000 = { id: 's1', version: 1, status: 'approved', reason: 'Decking', supplementTotal: 2000, submission: { approvedAmount: null } };
const partial1500  = { id: 's2', version: 2, status: 'partial',  reason: 'Drip edge', supplementTotal: 3000, submission: { approvedAmount: 1500 } };
const denied       = { id: 's3', version: 3, status: 'denied',   supplementTotal: 999,  submission: { approvedAmount: 0 } };
const draft        = { id: 's4', version: 4, status: 'draft',    supplementTotal: 500,  submission: { approvedAmount: null } };
const submitted    = { id: 's5', version: 5, status: 'submitted',supplementTotal: 700,  submission: { approvedAmount: null } };
const partialNull  = { id: 's6', version: 6, status: 'partial',  supplementTotal: 800,  submission: { approvedAmount: null } };

console.log('\ninvoice-pipeline supplement math');
console.log('──────────────────────────────────────────────────');

// ── supplementBillableAmount ──
test('approved → full supplementTotal', () => {
  eq(IP.supplementBillableAmount(approved2000), 2000);
});
test('partial → submission.approvedAmount (NOT supplementTotal)', () => {
  eq(IP.supplementBillableAmount(partial1500), 1500);
});
test('denied / draft / submitted → 0 (not billable)', () => {
  eq(IP.supplementBillableAmount(denied), 0, 'denied');
  eq(IP.supplementBillableAmount(draft), 0, 'draft');
  eq(IP.supplementBillableAmount(submitted), 0, 'submitted');
});
test('partial with null approvedAmount → 0 (no amount to bill)', () => {
  eq(IP.supplementBillableAmount(partialNull), 0);
});
test('null / undefined / garbage supplement → 0, never NaN', () => {
  eq(IP.supplementBillableAmount(null), 0, 'null');
  eq(IP.supplementBillableAmount(undefined), 0, 'undefined');
  eq(IP.supplementBillableAmount({ status: 'approved', supplementTotal: 'abc' }), 0, 'garbage total');
});

// ── selectBillableSupplements ──
test('keeps only approved/partial-with-amount, drops the rest', () => {
  const out = IP.selectBillableSupplements([approved2000, partial1500, denied, draft, submitted, partialNull]);
  eq(out.length, 2, 'billable count');
  eq(out[0].billable, 2000);
  eq(out[1].billable, 1500);
});
test('line description carries version + status tag + reason', () => {
  const out = IP.selectBillableSupplements([approved2000, partial1500]);
  eq(out[0].description, 'Insurance Supplement #1 (approved) — Decking');
  eq(out[1].description, 'Insurance Supplement #2 (partial approval) — Drip edge');
});
test('empty / null input → []', () => {
  eq(IP.selectBillableSupplements([]).length, 0);
  eq(IP.selectBillableSupplements(null).length, 0);
});

// ── applySupplementsToTotals ──
const base = { items: [{ description: 'Roof', quantity: 1, unitPrice: 10000, total: 10000 }], subtotal: 10000, tax: 750, total: 10750 };

test('no supplements → totals + items unchanged, supplementTotal 0', () => {
  const r = IP.applySupplementsToTotals(base, []);
  eq(r.subtotal, 10000, 'subtotal');
  eq(r.tax, 750, 'tax');
  eq(r.total, 10750, 'total');
  eq(r.supplementTotal, 0, 'supplementTotal');
  eq(r.items.length, 1, 'items');
});

test('one approved supplement adds to subtotal + total but NOT tax', () => {
  const r = IP.applySupplementsToTotals(base, [approved2000]);
  eq(r.subtotal, 12000, 'subtotal += 2000');
  eq(r.tax, 750, 'tax UNCHANGED (supplements are tax-exempt)');
  eq(r.total, 12750, 'total += 2000');
  eq(r.supplementTotal, 2000, 'supplementTotal');
  eq(r.supplementCount, 1, 'count');
  eq(r.items.length, 2, 'appended one line');
  const line = r.items[1];
  eq(line.quantity, 1, 'line qty');
  eq(line.unitPrice, 2000, 'line unitPrice');
  eq(line.total, 2000, 'line total');
});

test('partial supplement folds approvedAmount (1500), not supplementTotal (3000)', () => {
  const r = IP.applySupplementsToTotals(base, [partial1500]);
  eq(r.supplementTotal, 1500, 'partial uses approvedAmount');
  eq(r.total, 12250, 'total += 1500');
  eq(r.tax, 750, 'tax unchanged');
});

test('mixed list: only approved + partial(amount) billed; others ignored', () => {
  const r = IP.applySupplementsToTotals(base, [approved2000, partial1500, denied, draft, submitted, partialNull]);
  eq(r.supplementTotal, 3500, '2000 + 1500');
  eq(r.subtotal, 13500, 'subtotal += 3500');
  eq(r.total, 14250, 'total += 3500');
  eq(r.tax, 750, 'tax unchanged');
  eq(r.supplementCount, 2, 'two billable lines');
  eq(r.items.length, 3, 'base 1 + 2 supplement lines');
});

test('tax-exempt holds even on a taxable (cash) base with a positive rate', () => {
  // Cash estimate: $10,000 base @ 7.5% = $750 tax, $10,750 total. Attaching a
  // $2,000 insurance supplement must NOT add 7.5% tax on the supplement.
  const cashBase = { items: [], subtotal: 10000, tax: 750, total: 10750 };
  const r = IP.applySupplementsToTotals(cashBase, [approved2000]);
  eq(r.tax, 750, 'no extra tax on the supplement');
  eq(r.total, 12750, 'supplement added at face value, untaxed');
});

test('money math rounds to cents (no float drift)', () => {
  const b = { items: [], subtotal: 100.1, tax: 0, total: 100.1 };
  const supp = { status: 'partial', version: 1, supplementTotal: 0, submission: { approvedAmount: 0.2 } };
  const r = IP.applySupplementsToTotals(b, [supp]);
  near(r.total, 100.3, 0.0001, 'total');
  near(r.subtotal, 100.3, 0.0001, 'subtotal');
});

// ── CROSS-MODULE CONTRACT: the RUNTIME supplement path reaches billable ──
// The fixtures above are hand-built {status:'approved'|'partial'} docs. That
// alone can pass while production is inert — which is exactly what happened:
// supplements were created 'draft' and no code path ever flipped them, so the
// invoice fold added $0. These tests drive the REAL estimate-supplement.js
// functions so the two modules can never silently drift apart again:
//   createSupplement() (draft) → recordResponse() → IP.supplementBillableAmount()
console.log('\nsupplement → invoice billable contract (real estimate-supplement.js)');
console.log('──────────────────────────────────────────────────');

const parentEstimate = {
  lines: [{ code: 'RFG', name: 'Shingles', unit: 'sq', quantity: 20,
            materialCostPerUnit: 100, laborCostPerUnit: 50, lineTotal: 3000 }],
  total: 3000, materialCost: 2000, laborCost: 1000,
};

test('a freshly created supplement is draft and bills $0 (the #881 bug shape)', () => {
  const s = ES.createSupplement(parentEstimate, { version: 1 });
  s.supplementTotal = 2500; // calculateDelta stamps this before save
  eq(s.status, 'draft', 'created status');
  eq(IP.supplementBillableAmount(s), 0, 'draft is not billable');
});

test('recordResponse("approved") flips it to bill the full supplementTotal', () => {
  const s = ES.createSupplement(parentEstimate, { version: 1 });
  s.supplementTotal = 2500;
  ES.recordResponse(s, { status: 'approved' });
  eq(s.status, 'approved', 'status');
  eq(IP.supplementBillableAmount(s), 2500, 'bills full total');
});

test('recordResponse("partial", $1500) bills the adjuster amount, not the total', () => {
  const s = ES.createSupplement(parentEstimate, { version: 2 });
  s.supplementTotal = 4000;
  ES.recordResponse(s, { status: 'partial', approvedAmount: 1500 });
  eq(s.status, 'partial', 'status');
  eq(s.submission.approvedAmount, 1500, 'approvedAmount persisted on doc');
  eq(IP.supplementBillableAmount(s), 1500, 'bills approvedAmount');
});

test('recordResponse("denied") stays non-billable', () => {
  const s = ES.createSupplement(parentEstimate, { version: 3 });
  s.supplementTotal = 900;
  ES.recordResponse(s, { status: 'denied' });
  eq(IP.supplementBillableAmount(s), 0, 'denied bills $0');
});

test('end-to-end fold: one approved + one partial supplement land on the invoice', () => {
  const a = ES.createSupplement(parentEstimate, { version: 1 }); a.supplementTotal = 2000;
  ES.recordResponse(a, { status: 'approved' });
  const b = ES.createSupplement(parentEstimate, { version: 2 }); b.supplementTotal = 3000;
  ES.recordResponse(b, { status: 'partial', approvedAmount: 1200 });
  const draftC = ES.createSupplement(parentEstimate, { version: 3 }); draftC.supplementTotal = 500; // never responded
  const invBase = { items: [], subtotal: 10000, tax: 750, total: 10750 };
  const r = IP.applySupplementsToTotals(invBase, [a, b, draftC]);
  eq(r.supplementTotal, 3200, '2000 + 1200 (draft ignored)');
  eq(r.total, 13950, 'total += 3200, tax untouched');
  eq(r.supplementCount, 2, 'two billable lines');
});

console.log('──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);

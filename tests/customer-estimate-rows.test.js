/**
 * customer-estimate-rows.test.js
 *
 * Locks in the customer-portal retail line-item derivation (money-math sweep
 * 2026-07-18, residual surface): exportCustomerEstimate printed est.rows
 * verbatim, so V2/insurance estimates saved BEFORE the sweep — whose
 * rows[].rate/total hold the internal COST basis — showed the contractor's
 * cost to the homeowner (margin exposure). buildDisplayRows must mirror
 * InvoicePipeline.buildRowItems:
 *   retailTotal → material×(1+markup)+labor → face value, all-zero splits
 *   (SVC pass-throughs) at face, classic rows untouched, per-SQ docs render
 *   NO rows, and V2 docs get the O&P line so lines foot to the subtotal.
 *
 * Pure-Node test, no DOM. Run via: node tests/customer-estimate-rows.test.js
 */

const path = require('path');
const CR = require(path.join('..', 'docs', 'pro', 'js', 'customer-estimate-rows.js'));

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

const build = CR.buildDisplayRows;

console.log('\ncustomer-estimate-rows — buildDisplayRows retail ladder');
console.log('──────────────────────────────────────────────────');

test('exports buildDisplayRows', () => {
  eq(typeof build, 'function');
});

// ── Post-sweep V2 doc: rows[].retailTotal is authoritative ──
test('retailTotal wins over cost fields; rate derived from retail/qty', () => {
  const est = {
    materialMarkupPct: 0.25,
    rows: [{ code: 'SHNG', desc: 'Shingles', qty: '20.00SQ', rate: '$100.00',
             total: 2000, retailTotal: 2600, materialTotal: 1600, laborTotal: 400 }]
  };
  const rows = build(est);
  eq(rows.length, 1);
  near(rows[0].total, 2600, 0.005, 'total');
  eq(rows[0].rate, '$130.00', 'rate = 2600/20');
});

// ── Pre-sweep V2 doc: no retailTotal, derive from the cost split ──
test('old V2 doc: material×(1+markup)+labor replaces the cost total', () => {
  const est = {
    materialMarkupPct: 0.25,
    rows: [{ code: 'SHNG', desc: 'Shingles', qty: '10.00SQ', rate: '$150.00',
             total: 1500, materialTotal: 1000, laborTotal: 500 }]
  };
  const rows = build(est);
  // 1000×1.25 + 500 = 1750, not the saved cost 1500
  near(rows[0].total, 1750, 0.005, 'derived retail');
  eq(rows[0].rate, '$175.00', 'unit rate from retail, not the saved cost rate');
});

test('old V2 doc: saved COST rate string is never printed on derived rows', () => {
  const est = {
    materialMarkupPct: 0.40,
    rows: [{ code: 'X', desc: 'x', qty: '4.00EA', rate: '$55.00',
             total: 220, materialTotal: 200, laborTotal: 20 }]
  };
  const rows = build(est);
  near(rows[0].total, 300, 0.005, '200×1.4+20');
  eq(rows[0].rate, '$75.00', '300/4 — not $55 cost rate');
});

// ── SVC pass-throughs: split present but all-zero → face value ──
test('pass-through row (0/0 split) stays at face value', () => {
  const est = {
    materialMarkupPct: 0.25,
    rows: [{ code: 'SVC MEAS', desc: 'Measurement report', qty: '1.00ea',
             total: 35, materialTotal: 0, laborTotal: 0 }]
  };
  near(build(est)[0].total, 35, 0.005);
});

// ── V2 doc, row with NO split fields at all → keep saved total ──
test('V2 doc, row without split fields keeps its saved total + rate string', () => {
  const est = {
    materialMarkupPct: 0.25,
    rows: [{ code: 'MISC', desc: 'Misc', qty: '1 EA', rate: '$99/EA', total: 99 }]
  };
  const rows = build(est);
  near(rows[0].total, 99, 0.005);
  eq(rows[0].rate, '$99/EA', 'display rate untouched');
});

// ── Classic docs (no materialMarkupPct): rows pass through verbatim ──
test('classic doc rows are untouched (already customer prices)', () => {
  const est = {
    rows: [
      { code: 'RFG SYS', desc: 'Better — Reroof Plus', qty: '20.00 SQ', rate: '$595/SQ', total: 11900 },
      { code: 'PERMIT', desc: 'Local building permit', qty: '1 EA', rate: '', total: 350 }
    ]
  };
  const rows = build(est);
  eq(rows.length, 2, 'no O&P row without V2 pricing');
  near(rows[0].total, 11900, 0.005);
  eq(rows[0].rate, '$595/SQ');
  eq(rows[1].rate, '');
  near(rows[1].total, 350, 0.005);
});

test('classic doc with cost-split-looking fields but no markup → verbatim', () => {
  // materialTotal without est.materialMarkupPct must NOT trigger derivation
  const est = { rows: [{ code: 'A', desc: 'a', qty: '1 EA', rate: '$10', total: 10, materialTotal: 8 }] };
  const rows = build(est);
  near(rows[0].total, 10, 0.005);
  eq(rows[0].rate, '$10');
});

// ── O&P line foots the V2 lines to the subtotal ──
test('V2 doc with overhead+profit appends the O&P line with pct label', () => {
  const est = {
    materialMarkupPct: 0.25, overhead: 300, profit: 450,
    overheadPct: 0.10, profitPct: 0.15,
    rows: [{ code: 'SHNG', desc: 'Shingles', qty: '10.00SQ', total: 1500,
             materialTotal: 1000, laborTotal: 500 }]
  };
  const rows = build(est);
  eq(rows.length, 2);
  eq(rows[1].code, 'O&P');
  eq(rows[1].desc, 'Overhead & Profit (25%)');
  near(rows[1].total, 750, 0.005);
});

test('lines + O&P foot to retailBeforeOHP subtotal', () => {
  const est = {
    materialMarkupPct: 0.25, overhead: 200, profit: 300,
    rows: [
      { code: 'A', desc: 'a', qty: '10.00SQ', total: 1500, materialTotal: 1000, laborTotal: 500 },
      { code: 'SVC E-SIGN', desc: 'fee', qty: '1.00ea', total: 15, materialTotal: 0, laborTotal: 0 }
    ]
  };
  const rows = build(est);
  const sum = rows.reduce((s, r) => s + r.total, 0);
  near(sum, 1750 + 15 + 500, 0.01, 'Σ rows incl. O&P');
});

test('no O&P line when overhead+profit is 0, or when there are no rows', () => {
  eq(build({ materialMarkupPct: 0.25, overhead: 0, profit: 0,
             rows: [{ code: 'A', desc: 'a', total: 10, materialTotal: 8, laborTotal: 0 }] }).length, 1);
  eq(build({ materialMarkupPct: 0.25, overhead: 100, profit: 100, rows: [] }).length, 0, 'no orphan O&P row');
});

test('classic doc never gets an O&P line even if overhead/profit fields exist', () => {
  const est = { overhead: 100, profit: 100, rows: [{ code: 'A', desc: 'a', total: 10 }] };
  eq(build(est).length, 1);
});

// ── Per-SQ docs: internal cost rows must not render at all ──
test('per-SQ doc (priceMode) renders no rows', () => {
  const est = { priceMode: 'per-sq', materialMarkupPct: 0.25,
                rows: [{ code: 'A', desc: 'a', total: 1000, materialTotal: 800, laborTotal: 200 }] };
  eq(build(est).length, 0);
});
test('per-SQ doc (prices object, classic V2 shape) renders no rows', () => {
  const est = { prices: { good: 9000, better: 11000, best: 14000 },
                rows: [{ code: 'A', desc: 'a', total: 1000 }] };
  eq(build(est).length, 0);
});
test('prices: null (line-item V2 save shape) does NOT suppress rows', () => {
  const est = { prices: null, materialMarkupPct: 0.25,
                rows: [{ code: 'A', desc: 'a', total: 100, retailTotal: 125 }] };
  eq(build(est).length, 1);
});

// ── Robustness ──
test('null / missing est or rows → []', () => {
  eq(build(null).length, 0);
  eq(build({}).length, 0);
  eq(build({ rows: null }).length, 0);
});

test('garbage totals never NaN the output', () => {
  const est = { rows: [{ code: 'A', desc: 'a', qty: 'x', rate: null, total: 'not-a-number' }] };
  const rows = build(est);
  eq(rows[0].total, 0, 'NaN clamps to 0');
  eq(rows[0].rate, '', 'null rate → empty string');
});

test('retail rate falls back to the line total when qty is unparseable', () => {
  const est = { materialMarkupPct: 0.25,
                rows: [{ code: 'A', desc: 'a', qty: 'set', total: 100, retailTotal: 125 }] };
  eq(build(est)[0].rate, '$125.00');
});

test('totals round to cents', () => {
  const est = { materialMarkupPct: 0.333,
                rows: [{ code: 'A', desc: 'a', qty: '3.00SQ', total: 100, materialTotal: 100, laborTotal: 0 }] };
  near(build(est)[0].total, 133.3, 0.005, '100×1.333 rounded');
});

// ═══════════════════════════════════════════════════════════════════════
// Two-shape readers: estimateValue / estimateName
// ═══════════════════════════════════════════════════════════════════════
console.log('\ncustomer-estimate-rows — estimateValue / estimateName');
console.log('──────────────────────────────────────────────────');

test('estimateValue reads V2 grandTotal and Classic amount|total alike', () => {
  eq(CR.estimateValue({ grandTotal: 14500 }), 14500, 'V2');
  eq(CR.estimateValue({ total: 14500 }), 14500, 'classic total');
  eq(CR.estimateValue({ amount: 14500 }), 14500, 'classic amount');
  eq(CR.estimateValue({ amount: '$14,500' }), 14500, 'display-string amount');
});

test('estimateValue preserves a real 0 and never NaNs', () => {
  eq(CR.estimateValue({ grandTotal: 0, amount: 9000 }), 0, 'genuine $0 draft');
  eq(CR.estimateValue({ amount: 'n/a' }), 0);
  eq(CR.estimateValue(null), 0);
});

test('estimateName reads Classic title, V2 name, then addr', () => {
  eq(CR.estimateName({ title: 'Roof — 12 Oak' }), 'Roof — 12 Oak');
  eq(CR.estimateName({ name: 'Reroof Plus' }), 'Reroof Plus');
  eq(CR.estimateName({ addr: '12 Oak St' }), '12 Oak St');
  eq(CR.estimateName({}), 'Estimate');
});

// ═══════════════════════════════════════════════════════════════════════
// Integration: the REAL exportCustomerEstimate from
// customer-bootstrap.module.js (extracted by marker — the module itself
// imports firebase, so it can't be require()d).
//
// This targets the jsPDF export, which is the one that actually RUNS. A
// second, earlier document.write definition used to shadow-lose to it and
// this suite used to assert against that dead code; the jsPDF winner read
// only est.lineItems + est.title, so V2 docs (rows/name/grandTotal — every
// new estimate) exported a homeowner PDF with no line items at all, and it
// hardcoded NBD's name + navy onto every tenant's quote. Both behaviours
// were ported in; these tests lock them.
//
// jsPDF text() is not an HTML sink, so there is no escaping assertion here
// (the deleted document.write version needed one).
// ═══════════════════════════════════════════════════════════════════════
const fs = require('fs');
const vm = require('vm');
const modSrc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'pro', 'js', 'customer-bootstrap.module.js'), 'utf8');
const START = 'window.exportCustomerEstimate = async function(estimateId) {';
const END = '// ── END EXPORT';
const s = modSrc.indexOf(START), e = modSrc.indexOf(END, s < 0 ? 0 : s);

console.log('\nexportCustomerEstimate — real jsPDF export via vm sandbox');
console.log('──────────────────────────────────────────────────');

test('export function found in customer-bootstrap.module.js', () => {
  if (s < 0 || e < 0 || e <= s) throw new Error('extraction markers not found — update tests/customer-estimate-rows.test.js');
});

test('exactly one exportCustomerEstimate definition survives', () => {
  const n = modSrc.split('window.exportCustomerEstimate = ').length - 1;
  eq(n, 1, 'definitions (a shadowed duplicate silently wins/loses at load)');
});

// Minimal jsPDF stand-in: records what the export actually drew so the
// assertions can talk about printed text and brand fills instead of a PDF blob.
function fakeJsPDF(rec) {
  function Doc() {
    this.internal = { pageSize: { getWidth: function () { return 216; } } };
    this._color = null;
  }
  Doc.prototype.setFillColor = function (r, g, b) { rec.fills.push([r, g, b]); };
  Doc.prototype.setTextColor = function (r, g, b) { this._color = [r, g, b]; };
  Doc.prototype.setDrawColor = function () {};
  Doc.prototype.setFontSize = function () {};
  Doc.prototype.rect = function () {};
  Doc.prototype.line = function () {};
  Doc.prototype.addPage = function () {};
  Doc.prototype.splitTextToSize = function (t) { return [String(t)]; };
  Doc.prototype.text = function (t) {
    const self = this;
    (Array.isArray(t) ? t : [t]).forEach(function (str) {
      rec.texts.push({ s: String(str), color: self._color });
    });
  };
  Doc.prototype.save = function (f) { rec.saved = f; };
  return Doc;
}

function runExport(est, opts) {
  opts = opts || {};
  const rec = { texts: [], fills: [], saved: null, errors: [] };
  const win = {
    _customerEstimates: [est],
    _currentLead: { firstName: 'Ada', lastName: 'Ruiz', address: '12 Oak St' },
    jspdf: { jsPDF: fakeJsPDF(rec) },
  };
  if (opts.brand) win._brand = function () { return opts.brand; };
  if (!opts.noHelper) win.NBDCustomerEstimateRows = CR;
  win.window = win;
  const sandbox = {
    window: win,
    console: { error: function (m, err) { rec.errors.push(String((err && err.message) || m)); }, warn: function () {}, log: function () {} },
    Number, Math, String, Date, Array, JSON, parseFloat, parseInt,
  };
  vm.runInNewContext(modSrc.slice(s, e), sandbox, { filename: 'exportCustomerEstimate.extracted.js' });
  // Async fn, but window.jspdf is already present so nothing awaits: the whole
  // body runs synchronously before the returned promise settles.
  const p = win.exportCustomerEstimate(est.id);
  if (p && typeof p.catch === 'function') p.catch(function () {});
  rec.all = rec.texts.map(function (t) { return t.s; }).join('\n');
  return rec;
}

// Pre-sweep V2/insurance doc: rows persisted at COST (1000 mat + 500 lab per
// line, saved total 1500) under a retail grandTotal. No lineItems, no title —
// the exact shape the old lineItems/title-only export rendered blank.
const preSweepV2 = {
  id: 'e1abc9', tier: 'better', addr: '12 Oak St', name: 'Reroof Plus — 12 Oak St',
  materialMarkupPct: 0.25, overhead: 200, profit: 300,
  overheadPct: 0.10, profitPct: 0.15,
  grandTotal: 2250, subtotal: 2250,
  rows: [{ code: 'SHNG', desc: 'Shingles GAF', qty: '10.00SQ', rate: '$150.00',
           total: 1500, materialTotal: 1000, laborTotal: 500 }],
};

test('V2 doc (rows, no lineItems) prints its line items at all', () => {
  const rec = runExport(preSweepV2);
  eq(rec.errors.length, 0, 'export threw: ' + rec.errors.join('; '));
  if (rec.all.indexOf('Shingles GAF') < 0) throw new Error('V2 row description missing — export printed no lines');
  if (rec.all.indexOf('DESCRIPTION') < 0) throw new Error('line-item table header missing');
});

test('V2 lines print RETAIL, never the internal cost basis', () => {
  const rec = runExport(preSweepV2);
  if (rec.all.indexOf('$1750.00') < 0) throw new Error('derived retail $1750.00 missing');
  if (rec.all.indexOf('$1500.00') >= 0) throw new Error('internal cost total leaked into the PDF');
  if (rec.all.indexOf('$150.00') >= 0) throw new Error('internal cost rate leaked into the PDF');
  if (rec.all.indexOf('$175.00') < 0) throw new Error('retail unit rate $175.00 missing');
});

test('O&P line prints so the lines foot to the subtotal', () => {
  const rec = runExport(preSweepV2);
  if (rec.all.indexOf('Overhead & Profit (25%)') < 0) throw new Error('O&P line missing');
  if (rec.all.indexOf('$500.00') < 0) throw new Error('O&P amount missing');
});

test('title reads estimateName — V2 name, not the absent title', () => {
  const rec = runExport(preSweepV2);
  if (rec.all.indexOf('Reroof Plus — 12 Oak St') < 0) throw new Error('V2 est.name not printed as the title');
});

test('total reads estimateValue (grandTotal)', () => {
  const rec = runExport(preSweepV2);
  if (rec.all.indexOf('Total: $2,250') < 0) throw new Error('grand total missing');
});

test('classic lineItems doc still renders its lines and its amount', () => {
  const classic = {
    id: 'e2def8', title: 'Roof Replacement — 12 Oak St', amount: 14500,
    lineItems: [{ description: 'Tear-off + reroof', quantity: 20, unitPrice: 595, total: 11900 }]
  };
  const rec = runExport(classic);
  eq(rec.errors.length, 0, 'export threw: ' + rec.errors.join('; '));
  if (rec.all.indexOf('Tear-off + reroof') < 0) throw new Error('classic line item missing');
  if (rec.all.indexOf('$595.00') < 0) throw new Error('classic unit price missing');
  if (rec.all.indexOf('$11900.00') < 0) throw new Error('classic line total missing');
  if (rec.all.indexOf('Total: $14,500') < 0) throw new Error('classic amount not read as the total');
});

test('per-SQ doc prints no cost rows and does not crash — tier total only', () => {
  const perSq = { id: 'e3ghi7', tier: 'best', priceMode: 'per-sq', grandTotal: 14000,
    prices: { good: 9000, better: 11000, best: 14000 }, materialMarkupPct: 0.25,
    rows: [{ code: 'SHNG', desc: 'Shingles', qty: '10.00SQ', rate: '$150.00',
             total: 1500, materialTotal: 1000, laborTotal: 500 }] };
  const rec = runExport(perSq);
  eq(rec.errors.length, 0, 'export threw: ' + rec.errors.join('; '));
  if (rec.all.indexOf('Shingles') >= 0) throw new Error('per-SQ internal rows leaked');
  if (rec.all.indexOf('DESCRIPTION') >= 0) throw new Error('empty line table rendered its header');
  if (rec.all.indexOf('Total: $14,000') < 0) throw new Error('tier grand total missing');
});

test('helper missing → fail closed: V2 cost rows absent, total still prints', () => {
  const rec = runExport(preSweepV2, { noHelper: true });
  if (rec.all.indexOf('Shingles GAF') >= 0) throw new Error('V2 rows rendered without the helper (must fail closed)');
  if (rec.all.indexOf('$1500.00') >= 0 || rec.all.indexOf('$150.00') >= 0) throw new Error('cost leaked without the helper');
  if (rec.all.indexOf('Total: $2,250') < 0) throw new Error('grand total missing');
});

test('helper missing → classic lineItems still render (fail-open only for retail rows)', () => {
  const classic = { id: 'e4jkl6', title: 'Roof', amount: 11900,
    lineItems: [{ description: 'Good — Standard Reroof', quantity: 20, unitPrice: 595, total: 11900 }] };
  const rec = runExport(classic, { noHelper: true });
  if (rec.all.indexOf('Good — Standard Reroof') < 0) throw new Error('classic line item missing');
  if (rec.all.indexOf('$11900.00') < 0) throw new Error('classic line total missing');
});

// ── Tenant branding: no other company's homeowner may receive Joe's name ──
test('NBD (no brand override) renders byte-identical: NBD name + navy', () => {
  const rec = runExport(preSweepV2);
  if (rec.all.indexOf('No Big Deal Home Solutions') < 0) throw new Error('NBD legal name missing');
  if (!rec.fills.some(function (f) { return f[0] === 30 && f[1] === 58 && f[2] === 110; })) {
    throw new Error('NBD navy header fill missing');
  }
  if (String(rec.saved).indexOf('NBD_Estimate_') !== 0) throw new Error('NBD filename prefix changed: ' + rec.saved);
});

test('non-NBD tenant gets its own name, primary color and doc prefix', () => {
  const rec = runExport(preSweepV2, {
    brand: { legalName: 'Acme Exteriors LLC', docPrefix: 'ACME',
             colors: { primary: '#0A5F38', accent: '#FFB300' } }
  });
  if (rec.all.indexOf('No Big Deal') >= 0) throw new Error("NBD's name leaked onto another tenant's estimate");
  if (rec.all.indexOf('Acme Exteriors LLC') < 0) throw new Error('tenant legal name missing');
  if (!rec.fills.some(function (f) { return f[0] === 10 && f[1] === 95 && f[2] === 56; })) {
    throw new Error('tenant primary color not applied to the header (#0A5F38)');
  }
  if (rec.fills.some(function (f) { return f[0] === 30 && f[1] === 58 && f[2] === 110; })) {
    throw new Error('NBD navy still painted for a non-NBD tenant');
  }
  if (String(rec.saved).indexOf('ACME_Estimate_') !== 0) throw new Error('tenant doc prefix missing from filename: ' + rec.saved);
});

// ── functions/ mirror (audit 2026-08-02) ────────────────────────────────
// getEstimateForView (functions/portal.js) sanitizes the shared-estimate
// lines through the SAME ladder, but Cloud Functions deploys only functions/,
// so the file is byte-copied there. Drift = the homeowner link and the portal
// PDF disagree about the customer's numbers — assert identity, not just parity.
test('functions/customer-estimate-rows.js is a byte-identical copy of the docs file', () => {
  const fs = require('fs');
  const a = fs.readFileSync(path.join(__dirname, '..', 'docs', 'pro', 'js', 'customer-estimate-rows.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', 'functions', 'customer-estimate-rows.js'), 'utf8');
  if (a !== b) throw new Error('functions/customer-estimate-rows.js has drifted from docs/pro/js/customer-estimate-rows.js — re-copy it');
});

test('functions copy exposes the same API and prices a cost-basis V2 row at retail', () => {
  const FR = require(path.join('..', 'functions', 'customer-estimate-rows.js'));
  ['buildDisplayRows', 'numFrom', 'estimateValue', 'estimateName'].forEach((k) => {
    if (typeof FR[k] !== 'function') throw new Error('functions copy missing ' + k);
  });
  // The exact leak scenario the server whitelist must never reproduce:
  // pre-sweep V2 row with cost split (mat 100, lab 50, markup .25) → 175 retail.
  const rows = FR.buildDisplayRows({
    materialMarkupPct: 0.25,
    rows: [{ desc: 'Shingles', qty: 1, materialTotal: 100, laborTotal: 50, total: 150 }],
  });
  near(rows[0].total, 175, 0.005, 'retail total from cost split');
  if (/\b150\b/.test(rows[0].rate)) throw new Error('cost-basis rate leaked into the display rate');
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

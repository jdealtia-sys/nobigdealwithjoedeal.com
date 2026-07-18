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
// Integration: the REAL exportCustomerEstimate template from
// customer-bootstrap.module.js (extracted by marker — the module itself
// imports firebase, so it can't be require()d). Locks the wiring: the
// export must render the helper's retail rows, escape row fields, and
// fail CLOSED (no V2 cost rows) if the helper script is missing.
// ═══════════════════════════════════════════════════════════════════════
const fs = require('fs');
const modSrc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'pro', 'js', 'customer-bootstrap.module.js'), 'utf8');
const START = 'window.exportCustomerEstimate = function(estId) {';
const END = '// ── END EXPORT';
const s = modSrc.indexOf(START), e = modSrc.indexOf(END);

console.log('\nexportCustomerEstimate — real template via vm sandbox');
console.log('──────────────────────────────────────────────────');

test('export function found in customer-bootstrap.module.js', () => {
  if (s < 0 || e < 0 || e <= s) throw new Error('extraction markers not found — update tests/customer-estimate-rows.test.js');
});

function runExport(est, opts) {
  const vm = require('vm');
  const win = {
    _customerEstimates: [est],
    _brand: null,
    open: () => {
      const w = { document: { html: '', write(h) { this.html += h; }, close() {} } };
      win._lastWindow = w;
      return w;
    },
  };
  if (!opts || !opts.noHelper) win.NBDCustomerEstimateRows = CR;
  win.window = win;
  const sandbox = { window: win, alert: () => {}, Number, Math, String, Date, parseFloat, JSON };
  vm.runInNewContext(modSrc.slice(s, e), sandbox, { filename: 'exportCustomerEstimate.extracted.js' });
  win.exportCustomerEstimate(est.id);
  return (win._lastWindow && win._lastWindow.document.html) || '';
}

// Pre-sweep V2/insurance doc: rows persisted at COST (1000 mat + 500 lab
// per line, saved total 1500) under a retail grandTotal.
const preSweepV2 = {
  id: 'e1', tier: 'better', addr: '12 Oak St',
  materialMarkupPct: 0.25, overhead: 200, profit: 300,
  overheadPct: 0.10, profitPct: 0.15,
  grandTotal: 2250, subtotal: 2250,
  rows: [{ code: 'SHNG', desc: 'Shingles <b>GAF</b>', qty: '10.00SQ', rate: '$150.00',
           total: 1500, materialTotal: 1000, laborTotal: 500 }],
};

test('pre-sweep V2 doc renders RETAIL line total, not the cost basis', () => {
  const html = runExport(preSweepV2);
  if (html.indexOf('$1,750.00') < 0) throw new Error('derived retail $1,750.00 missing from export HTML');
  if (html.indexOf('$1,500.00') >= 0) throw new Error('internal cost total $1,500.00 leaked into export HTML');
  if (html.indexOf('$150.00') >= 0) throw new Error('internal cost rate $150.00 leaked into export HTML');
  if (html.indexOf('$175.00') < 0) throw new Error('retail unit rate $175.00 missing');
});

test('O&P line renders so lines foot to the subtotal', () => {
  const html = runExport(preSweepV2);
  if (html.indexOf('Overhead &amp; Profit (25%)') < 0) throw new Error('O&P line missing (or unescaped)');
  if (html.indexOf('$500.00') < 0) throw new Error('O&P amount missing');
});

test('row fields are HTML-escaped in the export', () => {
  const html = runExport(preSweepV2);
  if (html.indexOf('<b>GAF</b>') >= 0) throw new Error('row desc rendered unescaped');
  if (html.indexOf('&lt;b&gt;GAF&lt;/b&gt;') < 0) throw new Error('escaped desc not found');
});

test('helper missing → fail closed: V2 cost rows absent, grand total still renders', () => {
  const html = runExport(preSweepV2, { noHelper: true });
  if (html.indexOf('1,500.00') >= 0 || html.indexOf('$150.00') >= 0) throw new Error('cost leaked without helper');
  if (html.indexOf('SHNG') >= 0) throw new Error('V2 rows rendered without helper (must fail closed)');
  if (html.indexOf('$2,250.00') < 0) throw new Error('grand total missing');
});

test('helper missing → classic doc rows still render (fail-open only for retail rows)', () => {
  const classic = { id: 'e2', tier: 'good', grandTotal: 12250,
    rows: [{ code: 'RFG SYS', desc: 'Good — Standard Reroof', qty: '20.00 SQ', rate: '$595/SQ', total: 11900 }] };
  const html = runExport(classic, { noHelper: true });
  if (html.indexOf('$595/SQ') < 0) throw new Error('classic row rate missing');
  if (html.indexOf('$11,900.00') < 0) throw new Error('classic row total missing');
});

test('per-SQ V2 doc renders no cost rows, tier total only', () => {
  const perSq = { id: 'e3', tier: 'best', priceMode: 'per-sq', grandTotal: 14000,
    prices: { good: 9000, better: 11000, best: 14000 }, materialMarkupPct: 0.25,
    rows: [{ code: 'SHNG', desc: 'Shingles', qty: '10.00SQ', rate: '$150.00',
             total: 1500, materialTotal: 1000, laborTotal: 500 }] };
  const html = runExport(perSq);
  if (html.indexOf('SHNG') >= 0) throw new Error('per-SQ internal rows leaked');
  if (html.indexOf('$14,000.00') < 0) throw new Error('tier grand total missing');
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

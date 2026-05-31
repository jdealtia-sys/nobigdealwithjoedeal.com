/**
 * tests/estimate-profit.test.js — Phase 4 profit + supplement math.
 *
 * The core estimate pricing engine (estimate-builder-v2) is already covered by
 * estimate-pricing.test.js. This file exercises the two adjacent money engines
 * that were untested, in a vm sandbox over their browser IIFEs:
 *   - ProfitTracker.computeJobPL / computeMarginAnalytics — job P&L + margins
 *   - EstimateSupplement.calculateDelta — insurance-supplement OH&P + rounding
 *
 * Zero deps. Run: node tests/estimate-profit.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }
const near = (a, b) => Math.abs(a - b) < 0.005;

function loadIIFE(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js', file), 'utf8');
  const noop = () => ({ style: {}, appendChild() {}, addEventListener() {}, remove() {}, classList: { add() {}, remove() {} }, dataset: {} });
  const win = { addEventListener() {}, removeEventListener() {}, location: { pathname: '/pro/dashboard' } };
  win.window = win;
  const sandbox = {
    window: win,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, createElement() { return noop(); }, body: noop(), readyState: 'complete' },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, Math, JSON,
  };
  vm.runInNewContext(src, sandbox, { filename: file });
  return win;
}

// ── ProfitTracker ────────────────────────────────────────────
{
  console.log('PROFIT TRACKER — computeJobPL / computeMarginAnalytics');
  const win = loadIIFE('profit-tracker.js');
  const PT = win.ProfitTracker;
  ok('exposes ProfitTracker.computeJobPL', PT && typeof PT.computeJobPL === 'function');

  // revenue 20000, mat 6000, lab 4000, misc 1000, overhead 10% = 2000.
  const pl = PT.computeJobPL({ jobValue: 20000, materialCost: 6000, laborCost: 4000, miscCosts: 1000, overheadPct: 10 });
  ok('overhead = revenue * pct (2000)', near(pl.overhead, 2000));
  ok('totalCost = mat+lab+overhead+misc (13000)', near(pl.totalCost, 13000));
  ok('grossProfit excludes overhead (9000)', near(pl.grossProfit, 9000));
  ok('netProfit = revenue - totalCost (7000)', near(pl.netProfit, 7000));
  ok('grossMargin = 45%', pl.grossMargin === 45);
  ok('netMargin = 35%', pl.netMargin === 35);

  // default overhead 10% when overheadPct omitted
  const pl2 = PT.computeJobPL({ jobValue: 10000, materialCost: 0, laborCost: 0 });
  ok('default overhead pct 10% applied (overhead 1000)', near(pl2.overhead, 1000));
  ok('zero revenue → margins 0 (no NaN)', PT.computeJobPL({}).grossMargin === 0 && PT.computeJobPL({}).netMargin === 0);

  // computeMarginAnalytics aggregates only WON jobs that have costs.
  win._leads = [
    { stage: 'closed', jobValue: 20000, materialCost: 6000, laborCost: 4000, miscCosts: 1000, overheadPct: 10 },
    { stage: 'closed', jobValue: 10000, materialCost: 2000, laborCost: 1000, overheadPct: 10 },
    { stage: 'new',    jobValue: 50000, materialCost: 9000, laborCost: 9000 }, // not WON → excluded
    { stage: 'closed', jobValue: 8000 },                                       // WON but no costs → excluded from margins
    { stage: 'closed', jobValue: 5000, materialCost: 1000, laborCost: 500, deleted: true }, // deleted → excluded
  ];
  const m = PT.computeMarginAnalytics();
  ok('marginAnalytics tracks only the 2 WON-with-costs jobs', m.jobsTracked === 2);
  ok('totalRevenue counts both tracked jobs (30000)', near(m.totalRevenue, 30000));
  ok('avgGrossMargin is a sane 0-100 number', m.avgGrossMargin > 0 && m.avgGrossMargin <= 100);
  ok('totalProfit = revenue - totalCost', near(m.totalProfit, m.totalRevenue - m.totalCost));
}

// ── EstimateSupplement.calculateDelta ────────────────────────
{
  console.log('\nESTIMATE SUPPLEMENT — calculateDelta (OH&P + $25 rounding)');
  const ES = loadIIFE('estimate-supplement.js').EstimateSupplement;
  ok('exposes EstimateSupplement.calculateDelta', ES && typeof ES.calculateDelta === 'function');

  const sup = {
    settingsSnapshot: { overheadPct: 0.10, profitPct: 0.10, materialMarkupPct: 0.25, roundTo: 25 },
    originalTotal: 10000,
    addedItems: [{ quantity: 10, materialCostPerUnit: 5, laborCostPerUnit: 3 }], // mat 50, lab 30
    modifiedItems: [],
  };
  ES.calculateDelta(sup);
  ok('supplementMaterial = qty*matCost (50)', near(sup.supplementMaterial, 50));
  ok('supplementLabor = qty*labCost (30)', near(sup.supplementLabor, 30));
  ok('material retail applies 25% markup (62.5)', near(sup.supplementMatRetail, 62.5));
  ok('retailPreOhp = matRetail + labor (92.5)', near(sup.supplementRetailPreOhp, 92.5));
  ok('OH&P = (10%+10%) of preOhp (18.5)', near(sup.supplementOhp, 18.5));
  ok('subtotal = preOhp + OH&P (111)', near(sup.supplementSubtotal, 111));
  ok('total rounded to nearest $25 (100)', sup.supplementTotal === 100);
  ok('newGrandTotal = original + supplement (10100)', sup.newGrandTotal === 10100);
  ok('supplements skip tax (0)', sup.supplementTax === 0);
  ok('deltaPct = supplement/original*100 (1%)', near(sup.deltaPct, 1));

  // line totals stamped on each added item
  ok('added item lineTotal stamped (10 * (5+3) = 80)', near(sup.addedItems[0].lineTotal, 80));

  // modification deltas roll in
  const sup2 = {
    settingsSnapshot: { overheadPct: 0.10, profitPct: 0.10, materialMarkupPct: 0.25, roundTo: 25 },
    originalTotal: 5000,
    addedItems: [],
    modifiedItems: [{ deltaMaterial: 200, deltaLabor: 100 }],
  };
  ES.calculateDelta(sup2);
  ok('modification deltas feed supplementMaterial/Labor', near(sup2.supplementMaterial, 200) && near(sup2.supplementLabor, 100));
}

// ── InvoicePipeline.createInvoiceFromEstimate ────────────────
(async () => {
  console.log('\nINVOICE PIPELINE — createInvoiceFromEstimate (totals + deposit)');
  const win = loadIIFE('invoice-pipeline.js');
  const IP = win.InvoicePipeline;
  ok('exposes InvoicePipeline.createInvoiceFromEstimate', IP && typeof IP.createInvoiceFromEstimate === 'function');

  // Stub the v9 Firestore globals: read returns an estimate, write captures the
  // built invoice so we can assert the money math.
  const EST = { leadId: 'L1', customerId: 'C1', rows: [
    { desc: 'Shingles', qty: 2, rate: 100, total: 200 },
    { desc: 'Labor', qty: 1, rate: 300, total: 300 },
  ] };
  let captured = null;
  Object.assign(win, {
    _db: {}, doc: () => ({}), collection: () => ({}),
    getDoc: async () => ({ exists: () => true, data: () => EST }),
    addDoc: async (_c, data) => { captured = data; return { id: 'inv_1' }; },
  });

  const id = await IP.createInvoiceFromEstimate('est1');
  ok('returns new invoice id', id === 'inv_1');
  ok('subtotal = sum of row totals (500)', near(captured.subtotal, 500));
  ok('tax = 7.5% of subtotal (37.5)', near(captured.tax, 37.5));
  ok('total = subtotal + tax (537.5)', near(captured.total, 537.5));
  ok('deposit = 50% of total (268.75)', near(captured.depositAmount, 268.75));
  ok('balanceDue = total - deposit (268.75)', near(captured.balanceDue, 268.75));
  ok('new invoice starts in draft, unpaid', captured.status === 'draft' && captured.depositPaid === false);
  ok('carries leadId + estimateId linkage', captured.leadId === 'L1' && captured.estimateId === 'est1');

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})().catch(e => { console.error('estimate-profit test crashed:', e && (e.stack || e.message)); process.exit(1); });

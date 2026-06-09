/**
 * tests/estimate-v2-payload.test.js — V2 estimate payload builders.
 *
 * Covers the two pure payload builders extracted from docs/pro/js/estimate-v2-ui.js
 * (exposed via window.EstimateV2UI._test), and a persistence round-trip:
 *
 *   1. 2f — _buildEstimatePayload('single-quote', …) must produce a clean
 *      one-number PDF payload: tiers:false, tierList:null, lines:[] (so
 *      estimate.hbs suppresses the Scope table), correct headline total.
 *      Other formats keep their line items.
 *   2. 3A — _buildSavePayload(estimate, state) must persist materialMarkupPct
 *      + the O&P-ladder inputs + per-line material/labor splits, so a reopened
 *      insurance estimate can reconstruct B-8 retail pricing instead of
 *      silently defaulting markup to 0.25.
 *   3. Round-trip — feed the SAVED fields back through a reconstructor into
 *      estimate-finalization.formatInsuranceScope and assert the retail line
 *      totals + O&P ladder reconcile, with a NON-default 40% markup proving the
 *      persisted markup is honored (not the 0.25 fallback).
 *
 * Run: node tests/estimate-v2-payload.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

// ── Load estimate-v2-ui.js in a vm with a window shim + minimal stubs (the
//    payload builders are pure; the stubs only satisfy module load). ──
function loadV2UI() {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/estimate-v2-ui.js'), 'utf8');
  const win = {}; win.window = win;
  win.EstimateLogic = { resolveEstimate: () => ({}), buildContext: (x) => x, MEASUREMENT_VARS: [] };
  win.EstimateBuilderV2 = { loadSettings: () => ({ countyTax: {} }), calculateAllTiers: () => ({}), calculatePerSq: () => ({}) };
  const sandbox = {
    window: win,
    console: { log() {}, warn() {}, error() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }), addEventListener() {}, getElementById: () => null, querySelector: () => null },
    Date, Math, JSON, Set, setTimeout, navigator: {}, localStorage: { getItem: () => null, setItem() {} },
  };
  vm.runInNewContext(SRC, sandbox, { filename: 'estimate-v2-ui.js' });
  return win.EstimateV2UI._test;
}

// ── Load estimate-finalization.js for the round-trip render. ──
function loadFin() {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/estimate-finalization.js'), 'utf8');
  const win = {}; win.window = win;
  vm.runInNewContext(SRC, { window: win, console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Set }, { filename: 'estimate-finalization.js' });
  return win.EstimateFinalization;
}

const T = loadV2UI();

// A representative resolved estimate, self-consistent at a NON-default 40%
// material markup so the round-trip can prove the persisted markup is honored
// over the 0.25 default. Engine identities:
//   materialCost = Σ materialTotal = 1000 (line A) + 0 (line B) = 1000
//   laborCost    = Σ laborTotal    = 500  (line A) + 450 (line B) = 950
//   materialRetail   = materialCost × 1.40 = 1400
//   retailBeforeOHP  = materialRetail + laborCost = 1400 + 950 = 2350
//   overhead = profit = 10% × 2350 = 235 ; subtotal = 2350 + 235 + 235 = 2820
function estimateFixtureFixed() {
  return {
    method: 'line-item', tier: 'better', mode: 'insurance',
    context: { rawSqft: 2000, adjustedSqft: 2300, sq: 23, waste: 1.15, ridgeLf: 50, eaveLf: 100, hipLf: 0, pipes: 2 },
    lines: [
      { code: 'A', name: 'Architectural Shingles', category: 'roofing', quantity: 10, unit: 'SQ',
        materialCostPerUnit: 100, laborCostPerUnit: 50, materialTotal: 1000, laborTotal: 500, lineTotal: 1500, codeRefs: {} },
      { code: 'B', name: 'Tear-off', category: 'labor', quantity: 10, unit: 'SQ',
        materialCostPerUnit: 0, laborCostPerUnit: 45, materialTotal: 0, laborTotal: 450, lineTotal: 450, codeRefs: {} },
    ],
    materialCost: 1000, laborCost: 950, materialRetail: 1400,
    materialMarkupPct: 0.40, retailBeforeOHP: 2350,
    overhead: 235, overheadPct: 0.10, profit: 235, profitPct: 0.10,
    subtotal: 2820, tax: 0, taxRate: 0, total: 2820, minJobApplied: false,
    prices: null, priceMode: 'line-item', deposit: 0, internal: { margin: 1270 },
  };
}

function stateFixture() {
  return {
    estimateName: '', customer: { address: '1 Main St', name: 'Jane Homeowner' },
    leadId: null, tier: 'better', jobMode: 'insurance', mode: 'line-item',
    measurements: { pitch: 6 },
  };
}

// ════════════════════════════════════════════════════════════════════
// 2f — single-quote payload
// ════════════════════════════════════════════════════════════════════
console.log('\nV2 PAYLOAD — 2f single-quote (one number, no tiers, no line table)');
const est = estimateFixtureFixed();
const metaNoTiers = { customer: { name: 'Jane', address: '1 Main St' }, estimate: { date: '2026-06-08', number: 'EST-1' } };

const sq = T.buildEstimatePayload('single-quote', est, metaNoTiers);
ok('single-quote: tiers=false (no GBB block)', sq.tiers === false);
ok('single-quote: tierList=null', sq.tierList === null);
ok('single-quote: lines=[] (Scope table suppressed)', Array.isArray(sq.lines) && sq.lines.length === 0);
ok('single-quote: headline total preserved (2820)', sq.total === 2820);
ok('single-quote: cover/summary copy is single-quote flavored (no "three tiers")', !/three tiers|Good \/ Better \/ Best/i.test(JSON.stringify(sq.summary) + sq.coverSub));

// A non-single format keeps its line items (regression guard).
const ins = T.buildEstimatePayload('insurance-scope', est, metaNoTiers);
ok('insurance-scope: lines preserved (not zeroed)', Array.isArray(ins.lines) && ins.lines.length === 2);
ok('insurance-scope: tiers=false (no meta.tiers)', ins.tiers === false);

// R6: single-quote stays one-number even if meta.tiers is somehow populated —
// the format must always win (no GBB cards, no line table).
const metaWithTiers = { customer: { name: 'Jane', address: '1 Main St' }, estimate: { date: '2026-06-08', number: 'EST-1' },
  tiers: { good: { total: 15000 }, better: { total: 16500 }, best: { total: 18500 } } };
const sqT = T.buildEstimatePayload('single-quote', est, metaWithTiers);
ok('single-quote+meta.tiers: tiers still false (format wins)', sqT.tiers === false);
ok('single-quote+meta.tiers: tierList still null', sqT.tierList === null);
ok('single-quote+meta.tiers: lines still []', Array.isArray(sqT.lines) && sqT.lines.length === 0);
// And retail-quote WITH tiers still builds the GBB block (regression guard).
const rq = T.buildEstimatePayload('retail-quote', est, metaWithTiers);
ok('retail-quote+meta.tiers: tiers=true (GBB preserved)', rq.tiers === true && Array.isArray(rq.tierList) && rq.tierList.length === 3);

// ════════════════════════════════════════════════════════════════════
// 3A — save payload persists markup + per-line splits + O&P ladder
// ════════════════════════════════════════════════════════════════════
console.log('\nV2 PAYLOAD — 3A save persists markup + per-line splits');
const saved = T.buildSavePayload(est, stateFixture());
ok('save: materialMarkupPct persisted (0.40)', saved.materialMarkupPct === 0.40);
ok('save: retailBeforeOHP persisted', saved.retailBeforeOHP === 2350);
ok('save: overhead/profit + pcts persisted', saved.overhead === 235 && saved.overheadPct === 0.10 && saved.profit === 235 && saved.profitPct === 0.10);
ok('save: rows carry per-line materialTotal', saved.rows[0].materialTotal === 1000 && saved.rows[1].materialTotal === 0);
ok('save: rows carry per-line laborTotal', saved.rows[0].laborTotal === 500 && saved.rows[1].laborTotal === 450);
ok('save: rows keep classic shape (code/desc/qty/rate/total)', saved.rows[0].code === 'A' && /^\$/.test(saved.rows[0].rate) && saved.rows[0].total === 1500);
ok('save: grandTotal = canonical total', saved.grandTotal === 2820);

// ════════════════════════════════════════════════════════════════════
// Round-trip — reconstruct from SAVED fields, render, assert reconcile +
// that the 40% markup is honored (not the 0.25 fallback).
// ════════════════════════════════════════════════════════════════════
console.log('\nV2 PAYLOAD — persistence round-trip reconciles formatInsuranceScope');
// This reconstructor mirrors what the (future) V2 reopen path (3B) will do:
// rebuild a resolveEstimate-shaped object from the persisted doc.
function reconstruct(s) {
  return {
    materialMarkupPct: s.materialMarkupPct,
    overhead: s.overhead, overheadPct: s.overheadPct,
    profit: s.profit, profitPct: s.profitPct,
    subtotal: s.subtotal, tax: s.tax, taxRate: s.taxRate, total: s.grandTotal,
    minJobApplied: false,
    lines: (s.rows || []).map((r) => ({
      code: r.code, name: r.desc, category: r.category,
      quantity: r.quantity, unit: r.unit,
      materialCostPerUnit: r.materialCostPerUnit, laborCostPerUnit: r.laborCostPerUnit,
      materialTotal: r.materialTotal, laborTotal: r.laborTotal,
      lineTotal: r.total, codeRefs: {},
    })),
  };
}
const fin = loadFin();
const reEst = reconstruct(saved);
const reMeta = { customer: { name: 'Jane', address: '1 Main St' }, claim: {}, estimate: { date: '2026-06-08', number: null } };
let html = '';
try { html = fin.formatEstimate(reEst, 'insurance-scope', reMeta).html || ''; } catch (e) { html = 'ERR:' + e.message; }
// Line A retail at 40%: 1000×1.40 + 500 = 1,900. At the 0.25 default it would be 1,750.
ok('round-trip: line A retail uses persisted 40% markup ($1,900.00)', /1,900\.00/.test(html));
ok('round-trip: NOT the 0.25-default ($1,750.00 absent)', !/1,750\.00/.test(html));
// Line B retail: 0×1.40 + 450 = 450. scopeGrand = 1900 + 450 = 2,350 = retailBeforeOHP.
ok('round-trip: Line Item Total = $2,350.00 (= retailBeforeOHP)', /2,350\.00/.test(html));
ok('round-trip: Subtotal $2,820.00 = Line Item Total + O&P (235+235)', /2,820\.00/.test(html));
ok('round-trip: O&P rows present ($235.00 ×2)', (html.match(/235\.00/g) || []).length >= 2);

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
process.exit(0);

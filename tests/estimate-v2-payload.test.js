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
  return { test: win.EstimateV2UI._test, win: win };
}

// ── Load estimate-finalization.js for the round-trip render. ──
function loadFin() {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/estimate-finalization.js'), 'utf8');
  const win = {}; win.window = win;
  vm.runInNewContext(SRC, { window: win, console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Set }, { filename: 'estimate-finalization.js' });
  return win.EstimateFinalization;
}

const { test: T, win: V2WIN } = loadV2UI();

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
    claim: { carrier: 'State Farm', number: 'CLM-99', adjuster: 'Bob A.', dateOfLoss: '2026-04-01', deductible: 1000, acv: 14000, recoverableDepreciation: 4500, policyNumber: 'POL-7' },
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

// A non-single format keeps its line items (regression guard) — now at RETAIL
// plus an explicit O&P row (money-math sweep 2026-07-18: the server-rendered
// proposal printed the internal COST basis with $0.00 unit prices).
const ins = T.buildEstimatePayload('insurance-scope', est, metaNoTiers);
ok('insurance-scope: lines preserved (2 scope + O&P row)', Array.isArray(ins.lines) && ins.lines.length === 3);
ok('insurance-scope: tiers=false (no meta.tiers)', ins.tiers === false);
ok('server lines: line A at retail w/ persisted 40% markup (1900, not cost 1500)',
  ins.lines[0].lineTotal === 1900 && ins.lines[0].unitPrice === 190);
ok('server lines: labor-only line B stays 450 (margin via O&P)', ins.lines[1].lineTotal === 450);
ok('server lines: O&P row labeled + priced (20% → 470)',
  /Overhead & Profit \(20%\)/.test(ins.lines[2].description) && ins.lines[2].lineTotal === 470);
ok('server lines: Σ lineTotal == subtotal (2820)',
  Math.abs(ins.lines.reduce((s, l) => s + l.lineTotal, 0) - ins.subtotal) < 0.01);
ok('server lines: stats card counts scope lines only (2, not the O&P row)',
  (ins.stats.find(s => s.label === 'Line Items') || {}).value === '2');
// Per-SQ estimates: lines are the internal cost basis while subtotal/total are
// the selected TIER price — the payload must suppress the table entirely.
const perSqEst = Object.assign(estimateFixtureFixed(), { priceMode: 'per-sq' });
const perSq = T.buildEstimatePayload('retail-quote', perSqEst, metaNoTiers);
ok('per-sq retail-quote: lines suppressed (cost basis can never foot to tier price)',
  Array.isArray(perSq.lines) && perSq.lines.length === 0);

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
// rate/total are CUSTOMER-facing (portal, classic views, invoice items print
// them verbatim) → RETAIL at the persisted 40% markup, never the cost basis
// (money-math sweep 2026-07-18). Cost stays in the split fields above.
ok('save: rows keep classic shape (code/desc/qty/rate/total)', saved.rows[0].code === 'A' && /^\$/.test(saved.rows[0].rate) && saved.rows[0].total === 1900);
ok('save: row A rate/total at RETAIL (190/SQ, 1900 — not cost 150/1500)',
  saved.rows[0].rate === '$190.00' && saved.rows[0].total === 1900 && saved.rows[0].retailTotal === 1900);
ok('save: labor-only row B at 450 (labor margin comes via O&P)',
  saved.rows[1].rate === '$45.00' && saved.rows[1].total === 450 && saved.rows[1].retailTotal === 450);
ok('save: grandTotal = canonical total', saved.grandTotal === 2820);
// FU-1: insurance claim info persists (was dropped before → reopened scope
// showed "—" for carrier/deductible).
ok('save: claim persisted (carrier + deductible)', saved.claim && saved.claim.carrier === 'State Farm' && saved.claim.deductible === 1000);
ok('save: claim acv persisted', saved.claim && saved.claim.acv === 14000);
ok('save: claim recoverableDepreciation + policyNumber persisted', saved.claim && saved.claim.recoverableDepreciation === 4500 && saved.claim.policyNumber === 'POL-7');
// Edge cases: deductible 0 must survive (not be dropped/null'd); a fully-empty
// claim serializes to null (Firestore-safe, no NaN/undefined).
const savedZeroDed = T.buildSavePayload(est, Object.assign(stateFixture(), { claim: { carrier: 'X', deductible: 0 } }));
ok('save: deductible 0 survives (not coerced to null)', savedZeroDed.claim && savedZeroDed.claim.deductible === 0);
const savedEmptyClaim = T.buildSavePayload(est, Object.assign(stateFixture(), { claim: { carrier: '', number: '', adjuster: '', dateOfLoss: '', deductible: null, acv: null } }));
ok('save: empty claim → null (no {} / undefined)', savedEmptyClaim.claim === null);
const savedNanDed = T.buildSavePayload(est, Object.assign(stateFixture(), { claim: { carrier: 'X', deductible: 'abc' } }));
ok('save: non-numeric deductible → null (never NaN)', savedNanDed.claim && savedNanDed.claim.deductible === null);

// ════════════════════════════════════════════════════════════════════
// 3B — _reconstructEstimateFromSaved: faithful for a 3A doc, null for pre-3A.
// ════════════════════════════════════════════════════════════════════
console.log('\nV2 PAYLOAD — 3B reconstruct from saved doc');
const reFrom3A = T.reconstructEstimateFromSaved(saved);
ok('3B: reconstructs a non-null estimate from a 3A doc', reFrom3A && Array.isArray(reFrom3A.lines));
ok('3B: markup preserved (0.40)', reFrom3A && reFrom3A.materialMarkupPct === 0.40);
ok('3B: per-line splits carried', reFrom3A && reFrom3A.lines[0].materialTotal === 1000 && reFrom3A.lines[0].laborTotal === 500);
// r.total now persists the RETAIL price (1900); the reconstructed line's
// lineTotal is the engine's COST invariant, rebuilt from the split (1500).
ok('3B: lineTotal rebuilt as COST from the split (1500, not retail 1900)',
  reFrom3A && reFrom3A.lines[0].lineTotal === 1500);
ok('3B: retailTotal carried for retail consumers (1900)',
  reFrom3A && reFrom3A.lines[0].retailTotal === 1900);
ok('3B: total = saved grandTotal (2820)', reFrom3A && reFrom3A.total === 2820);
ok('3B: context echoes saved measurements (for re-save)', reFrom3A && reFrom3A.context && reFrom3A.context.eaveLf === 100);
// BLK-2: internal-view reads top-level hardCost (= materialCost + laborCost).
ok('3B: hardCost present for internal-view (1950)', reFrom3A && reFrom3A.hardCost === 1950);
// N1: internal block normalized so marginPct.toFixed() can't throw.
ok('3B: internal.marginPct normalized to a number', reFrom3A && typeof reFrom3A.internal.marginPct === 'number');
// A pre-3A doc (old shape: rows have only code/desc/qty/rate/total, no markup)
// must return null so the caller falls back to a live re-resolve.
const preDoc = { id: 'old1', builder: 'v2', mode: 'insurance', tier: 'better', grandTotal: 5000,
  rows: [{ code: 'A', desc: 'X', qty: '10.00SQ', rate: '$150.00', total: 1500 }] };
ok('3B: pre-3A doc (no materialMarkupPct) → null (fall back to re-resolve)', T.reconstructEstimateFromSaved(preDoc) === null);

// ════════════════════════════════════════════════════════════════════
// 3B — rehydrateFromSaved populates state from a saved doc.
// ════════════════════════════════════════════════════════════════════
console.log('\nV2 PAYLOAD — 3B rehydrateFromSaved');
// Start from the real 3A save payload, then override the fields the rehydrate
// test pins (explicit values must WIN over `saved`).
const savedDoc = Object.assign({}, saved, { id: 'est_abc', builder: 'v2',
  raw: 2000, adj: 2300, sq: 23, wf: 1.15, pl: '8/12', ridge: 50, eave: 100, hip: 0, pipes: 2,
  mode: 'insurance', tier: 'better',
  owner: 'Jane Homeowner', addr: '1 Main St', leadId: 'lead_9', name: 'Jane estimate',
  rows: [{ code: 'RFG 240-GAF-HDZ', desc: 'GAF', total: 1500 }, { code: 'SVC RPT', desc: 'Report', total: 75, source: 'passthru' }] });
V2WIN._estimates = [savedDoc];
const okRehydrate = T.rehydrateFromSaved('est_abc');
const st = T.getState();
ok('3B rehydrate: returns true for a known id', okRehydrate === true);
ok('3B rehydrate: customer name from owner', st.customer.name === 'Jane Homeowner');
ok('3B rehydrate: address from addr', st.customer.address === '1 Main St');
ok('3B rehydrate: pitch parsed from "8/12" → 8', st.measurements.pitch === 8);
ok('3B rehydrate: rawSqft from raw', st.measurements.rawSqft === 2000);
ok('3B rehydrate: scope rebuilt from catalog rows (passthru/SVC excluded)', st.scope.length === 1 && st.scope[0].code === 'RFG 240-GAF-HDZ');
// BLK-1: pass-through fees must be repopulated (not zeroed) so an edit-after-
// reopen doesn't silently drop the $75 service line on the next save.
ok('3B rehydrate: passThru repopulated from SVC row ($75)', st.passThru.length === 1 && st.passThru[0].amount === 75 && st.passThru[0].code === 'SVC RPT');
ok('3B rehydrate: jobMode from mode (insurance)', st.jobMode === 'insurance');
// FU-1: claim restored on reopen (savedDoc inherits the claim from `saved`).
ok('3B rehydrate: claim restored (carrier State Farm, deductible 1000)', st.claim && st.claim.carrier === 'State Farm' && st.claim.deductible === 1000);
ok('3B rehydrate: _reopenedClean=true', st._reopenedClean === true);
ok('3B rehydrate: _editingEstimateId set (re-save updates same doc)', V2WIN._editingEstimateId === 'est_abc');
// effectiveEstimate: clean reopen → faithful replay; simulate an edit → falls
// back to live re-resolve (getCurrentEstimate → null here, no catalog stubbed).
const effClean = T.effectiveEstimate();
ok('3B effectiveEstimate: clean reopen replays saved (markup 0.40)', effClean && effClean.materialMarkupPct === 0.40);
st._reopenedClean = false;  // simulate an edit
ok('3B effectiveEstimate: after edit → re-resolve (no replay)', T.effectiveEstimate() === null);
st._reopenedClean = true;   // restore for later assertions
ok('3B rehydrate: unknown id → false', T.rehydrateFromSaved('nope') === false);

// ════════════════════════════════════════════════════════════════════
// REGRESSION — complexity/add-on measurement block + county + per-line
// qty overrides must SURVIVE save→rehydrate. Before this fix the save
// payload dropped them and rehydrate reset them to defaults, so the FIRST
// edit after reopen silently changed the customer's price (the V2 recurrence
// of the classic "Edit-on-Classic corrupted totals" bug).
// ════════════════════════════════════════════════════════════════════
console.log('\nV2 PAYLOAD — complexity/add-on + county + qty-override round-trip');
const cxState = Object.assign(stateFixture(), {
  county: 'boone-ky',
  scope: [{ code: 'A', overrides: { qty: 7 } }, { code: 'B', overrides: {} }],
  measurements: {
    pitch: 8, rawSqft: 3000, waste: 1.17, ridgeLf: 60, eaveLf: 120, hipLf: 10, pipes: 3,
    rakeLf: 90, valleyLf: 40, wallLf: 25, chimneys: 1, skylights: 2, stories: 2,
    tearOffLayers: 2, deckReplacePct: 0.30, cutUpRoof: true,
    hasChimneyFlash: true, hasSkylightFlash: true, valleyMetalLf: 40, guttersLf: 150,
    accessLevel: 'difficult',
  },
});
const cxSaved = T.buildSavePayload(estimateFixtureFixed(), cxState);
ok('save: county persisted (boone-ky)', cxSaved.county === 'boone-ky');
ok('save: stories persisted (2)', cxSaved.stories === 2);
ok('save: accessLevel persisted (difficult)', cxSaved.accessLevel === 'difficult');
ok('save: cutUpRoof persisted (true)', cxSaved.cutUpRoof === true);
ok('save: tearOffLayers persisted (2)', cxSaved.tearOffLayers === 2);
ok('save: deckReplacePct persisted (0.30)', cxSaved.deckReplacePct === 0.30);
ok('save: rake/valley/wall LF persisted', cxSaved.rakeLf === 90 && cxSaved.valleyLf === 40 && cxSaved.wallLf === 25);
ok('save: chimneys/skylights persisted', cxSaved.chimneys === 1 && cxSaved.skylights === 2);
ok('save: flashing flags persisted', cxSaved.hasChimneyFlash === true && cxSaved.hasSkylightFlash === true);
ok('save: valleyMetalLf/guttersLf persisted', cxSaved.valleyMetalLf === 40 && cxSaved.guttersLf === 150);
ok('save: per-line qty override persisted on row A (7)', (cxSaved.rows.find(r => r.code === 'A') || {}).qtyOverride === 7);
ok('save: row B with no override → null', (cxSaved.rows.find(r => r.code === 'B') || {}).qtyOverride === null);

const cxDoc = Object.assign({}, cxSaved, { id: 'est_cx', builder: 'v2' });
V2WIN._estimates = [cxDoc];
ok('rehydrate(cx): returns true', T.rehydrateFromSaved('est_cx') === true);
const cxSt = T.getState();
ok('rehydrate: county restored (not default)', cxSt.county === 'boone-ky');
ok('rehydrate: stories restored (2, not reset to 1)', cxSt.measurements.stories === 2);
ok('rehydrate: accessLevel restored (difficult, not standard)', cxSt.measurements.accessLevel === 'difficult');
ok('rehydrate: cutUpRoof restored (true, not false)', cxSt.measurements.cutUpRoof === true);
ok('rehydrate: tearOffLayers restored (2, not 1)', cxSt.measurements.tearOffLayers === 2);
ok('rehydrate: deckReplacePct restored (0.30, not 0.15)', cxSt.measurements.deckReplacePct === 0.30);
ok('rehydrate: rake/valley/wall LF restored', cxSt.measurements.rakeLf === 90 && cxSt.measurements.valleyLf === 40 && cxSt.measurements.wallLf === 25);
ok('rehydrate: chimneys/skylights restored', cxSt.measurements.chimneys === 1 && cxSt.measurements.skylights === 2);
ok('rehydrate: flashing flags restored', cxSt.measurements.hasChimneyFlash === true && cxSt.measurements.hasSkylightFlash === true);
ok('rehydrate: valleyMetal/gutters restored', cxSt.measurements.valleyMetalLf === 40 && cxSt.measurements.guttersLf === 150);
ok('rehydrate: per-line qty override restored on A (7)', ((cxSt.scope.find(s => s.code === 'A') || {}).overrides || {}).qty === 7);
ok('rehydrate: row B keeps empty overrides', !!cxSt.scope.find(s => s.code === 'B') && Object.keys(cxSt.scope.find(s => s.code === 'B').overrides).length === 0);

// Backward-compat: an OLD doc lacking the block rehydrates to safe defaults
// (graceful — no NaN, no crash) rather than corrupting.
const oldDoc = { id: 'est_old', builder: 'v2', mode: 'insurance', tier: 'better', grandTotal: 5000,
  raw: 2000, pl: '6/12', rows: [{ code: 'A', desc: 'X', total: 1500 }] };
V2WIN._estimates = [oldDoc];
T.rehydrateFromSaved('est_old');
const oldSt = T.getState();
ok('rehydrate(old doc): stories defaults to 1', oldSt.measurements.stories === 1);
ok('rehydrate(old doc): cutUpRoof defaults to false', oldSt.measurements.cutUpRoof === false);
ok('rehydrate(old doc): accessLevel defaults to standard', oldSt.measurements.accessLevel === 'standard');
ok('rehydrate(old doc): deckReplacePct defaults to 0.15', oldSt.measurements.deckReplacePct === 0.15);

// ════════════════════════════════════════════════════════════════════
// Round-trip — production reconstruct → render → reconcile + markup honored.
// ════════════════════════════════════════════════════════════════════
console.log('\nV2 PAYLOAD — persistence round-trip reconciles formatInsuranceScope');
const fin = loadFin();
const reEst = T.reconstructEstimateFromSaved(saved);
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

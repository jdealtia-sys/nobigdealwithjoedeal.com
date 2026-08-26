#!/usr/bin/env node
/*
 * estimate-reopen-cost-basis.test.js — a reopened estimate must keep the cost
 * basis it was SAVED at, not silently re-price off today's catalog.
 * ═════════════════════════════════════════════════
 *
 * THE BUG THIS PINS (2026-08-18). rehydrateFromSaved rebuilt state.scope from
 * the saved rows' CODES ONLY, discarding the persisted materialCostPerUnit /
 * laborCostPerUnit. getCurrentEstimate() then re-resolved every line through
 * `cat.find(s.code)` against the live NBD_XACT_CATALOG. Because
 * state._reopenedClean is flipped false by any measurement / county / tier
 * edit, while window._editingEstimateId still points at the same customer
 * doc, the next save rewrote already-quoted work at whatever the catalog says
 * today.
 *
 * It bites hardest on 'JT *' job-template codes, whose catalog entries are
 * REGISTERED AT BOOT by job-templates.js from a cost source — so a device that
 * boots without that source resolves them at zero and can persist the zeros
 * over a signed estimate. That is also why this suite is a prerequisite for
 * moving job-template costs out of the public bundle: the strip would turn a
 * rare hole into a universal one. See
 * documentation/projects/JOB-TEMPLATE-COST-MIGRATION-PLAN-2026-08-18.md.
 *
 * This file is the regression pin for the fix (state.scope[].savedCost +
 * withSavedCost()). It drives the REAL estimate-v2-ui.js and the REAL
 * estimate-logic-engine.js in a vm — no re-implementation of the money math.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name); }
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Catalog stub: the JT line as the CURRENT catalog would price it. The saved
// row was quoted at 5/15; this is the "catalog moved / booted unpriced" state.
function makeCatalog(mat, lab) {
  const item = {
    code: 'JT TEST-0', name: 'Seeded custom item', category: 'custom', unit: 'EA',
    materialCost: mat, laborCost: lab, qtyFormula: '1', tier: 'any'
  };
  return { byCode: { 'JT TEST-0': item }, find: (c) => (c === 'JT TEST-0' ? item : null) };
}

function loadV2UI(catalog) {
  const win = {}; win.window = win;
  win.NBD_XACT_CATALOG = catalog;
  win.EstimateBuilderV2 = { loadSettings: () => ({ countyTax: {} }), calculateAllTiers: null, calculatePerSq: () => ({}) };

  const sandbox = {
    window: win,
    console: { log() {}, warn() {}, error() {} },
    document: {
      createElement: () => ({ style: {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } }),
      addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
    },
    Date, Math, JSON, Set, Number, String, Object, Array, setTimeout, navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  // The REAL engine — resolveEstimate/resolveLineItem do the cost math.
  vm.runInNewContext(read('docs/pro/js/estimate-logic-engine.js'), sandbox, { filename: 'estimate-logic-engine.js' });
  vm.runInNewContext(read('docs/pro/js/estimate-v2-ui.js'), sandbox, { filename: 'estimate-v2-ui.js' });
  return { T: win.EstimateV2UI && win.EstimateV2UI._test, win };
}

// A saved customer doc with one JT row quoted at material 5 / labor 15.
// materialMarkupPct is deliberately ABSENT so _reconstructEstimateFromSaved
// returns null (pre-3A doc) and effectiveEstimate falls through to the live
// re-resolve — the exact path that used to lose the cost basis.
function savedDoc(extraRowFields) {
  return {
    id: 'est_test_1',
    rawSqft: 2000, pitch: 6, waste: 1.1, stories: 1, county: 'hamilton',
    tier: 'better', jobMode: 'cash',
    rows: [Object.assign({
      code: 'JT TEST-0', name: 'Seeded custom item', quantity: 1, unit: 'EA',
      materialCostPerUnit: 5, laborCostPerUnit: 15,
      materialTotal: 5, laborTotal: 15, lineTotal: 26.25
    }, extraRowFields || {})]
  };
}

// rehydrateFromSaved takes an ID and looks the doc up in window._estimates —
// it does NOT take the doc. Reopen exactly the way the dashboard does, then
// force the post-edit path: with _reopenedClean true, effectiveEstimate()
// replays the saved doc verbatim and would pass even with the bug present.
// Every assertion below must go through the LIVE re-resolve to mean anything.
function reopenEdited(T, win, doc) {
  win._estimates = [doc];
  T.rehydrateFromSaved(doc.id);
  const st = T.getState();
  st._reopenedClean = false;
  return st;
}

function lineCostOf(est) {
  if (!est || !Array.isArray(est.lines)) return null;
  const l = est.lines.find((x) => x.code === 'JT TEST-0');
  return l ? { mat: Number(l.materialCostPerUnit), lab: Number(l.laborCostPerUnit) } : null;
}

console.log('\nREOPEN COST BASIS — a saved estimate must not re-price itself\n');

// ── 1. The regression itself ────────────────────────────────────────
{
  // Catalog now prices this code at ZERO — the unpriced-boot case.
  const { T, win } = loadV2UI(makeCatalog(0, 0));
  ok('estimate-v2-ui exposes the _test surface', !!T && typeof T.rehydrateFromSaved === 'function');

  if (T) {
    const st = reopenEdited(T, win, savedDoc());
    ok('rehydrate carried savedCost onto the scope entry',
      !!(st.scope && st.scope[0] && st.scope[0].savedCost
         && st.scope[0].savedCost.materialCost === 5
         && st.scope[0].savedCost.laborCost === 15));

    const cost = lineCostOf(T.effectiveEstimate());
    ok('reopened line keeps its SAVED cost basis (5/15), not the catalog\'s 0/0',
      !!cost && cost.mat === 5 && cost.lab === 15);
  }
}

// ── 2. It is the SAVED number that wins, not merely a non-zero one ──
{
  // Catalog drifted UP to 99/99. The saved 5/15 must still win, otherwise the
  // test above would also pass on a "take whichever is larger" bug.
  const { T, win } = loadV2UI(makeCatalog(99, 99));
  if (T) {
    reopenEdited(T, win, savedDoc());
    const cost = lineCostOf(T.effectiveEstimate());
    ok('a catalog that drifted UP (99/99) does not override the saved 5/15',
      !!cost && cost.mat === 5 && cost.lab === 15);
  }
}

// ── 3. Legacy rows without a persisted basis fall through cleanly ───
{
  const { T, win } = loadV2UI(makeCatalog(7, 21));
  if (T) {
    // A row saved before costs were persisted: no *PerUnit fields at all.
    const st = reopenEdited(T, win, savedDoc({ materialCostPerUnit: undefined, laborCostPerUnit: undefined }));
    ok('a legacy row with no persisted basis gets savedCost = null',
      !!(st.scope && st.scope[0] && st.scope[0].savedCost === null));
    const cost = lineCostOf(T.effectiveEstimate());
    ok('legacy row falls through to the catalog (7/21) rather than resolving at 0',
      !!cost && cost.mat === 7 && cost.lab === 21);
  }
}

// ── 4. A HALF-written row must not resolve at half its cost ─────────
{
  const { T, win } = loadV2UI(makeCatalog(7, 21));
  if (T) {
    // materialCostPerUnit present, laborCostPerUnit missing. Trusting this
    // partially would quote labor at 0 — worse than falling back.
    const st = reopenEdited(T, win, savedDoc({ laborCostPerUnit: undefined }));
    ok('a half-written row is rejected wholesale (savedCost = null)',
      !!(st.scope && st.scope[0] && st.scope[0].savedCost === null));
    const cost = lineCostOf(T.effectiveEstimate());
    ok('half-written row falls back to the catalog, never labor-at-zero',
      !!cost && cost.lab === 21);
  }
}

// ── 5. A legitimately ZERO saved cost is preserved, not treated as absent ──
{
  const { T, win } = loadV2UI(makeCatalog(50, 50));
  if (T) {
    // 0/0 is a real, quotable basis (an included/no-charge line). Number.isFinite
    // keeps it; a truthiness check would have dropped it and re-priced at 50/50.
    const st = reopenEdited(T, win, savedDoc({ materialCostPerUnit: 0, laborCostPerUnit: 0 }));
    ok('a genuine 0/0 saved basis is kept (not confused with "missing")',
      !!(st.scope && st.scope[0] && st.scope[0].savedCost
         && st.scope[0].savedCost.materialCost === 0));
    const cost = lineCostOf(T.effectiveEstimate());
    ok('a no-charge line stays no-charge on reopen', !!cost && cost.mat === 0 && cost.lab === 0);
  }
}

console.log('\n' + '─'.repeat(50));
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILED:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }

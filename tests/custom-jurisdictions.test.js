/**
 * tests/custom-jurisdictions.test.js — per-tenant custom jurisdictions
 * (county-jurisdiction settings, 2026-07-29).
 *
 * companyProfile/{companyId}.pricing.customJurisdictions:
 *   { 'custom-<slug>': { name, cost, rate } }   (rate is a DECIMAL)
 *
 * The engine overlays the tenant map onto its resolved settings at CALL time
 * (applyCompanyPricing for per-SQ; a jurisdictions-only overlay in
 * calculateLineItem), so a custom county prices the permit line (named after
 * the jurisdiction, at its cost) and the cash tax (at its rate) on every
 * estimate path — while blank/unknown/canonical counties behave exactly as
 * before (DEFAULT_PERMIT_COST $150, 7% fallback, canonical 7 untouched).
 *
 * Harness: estimate-builder-v2.js is vm-loaded with a `window` sandbox (the
 * estimate-v2-payload.test.js style) so window._companyProfile is visible to
 * the typeof-window-guarded overlay; a plain Node require() (the
 * estimate-pricing.test.js style) doubles as the no-window neutrality check.
 *
 * Run: node tests/custom-jurisdictions.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failed++; }
}
function eq(actual, expected, label) {
  if (actual !== expected) throw new Error((label || 'value') + ' = ' + JSON.stringify(actual) + ' (expected ' + JSON.stringify(expected) + ')');
}
function near(actual, expected, tol, label) {
  if (Math.abs(actual - expected) > tol) throw new Error((label || 'value') + ' = ' + actual + ' (expected ~' + expected + ' ±' + tol + ')');
}

// ── vm-load the engine with a window sandbox (no require/localStorage/config
//    → inline fallback tables, no saved settings — same base as pricing test). ──
function loadEngine(companyProfile) {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/estimate-builder-v2.js'), 'utf8');
  const win = {}; win.window = win;
  if (companyProfile !== undefined) win._companyProfile = companyProfile;
  const sandbox = { window: win, console: { log() {}, warn() {}, error() {} } };
  vm.runInNewContext(SRC, sandbox, { filename: 'estimate-builder-v2.js' });
  if (!win.EstimateBuilderV2) throw new Error('engine did not attach to window');
  return win.EstimateBuilderV2;
}

const PROFILE = {
  pricing: {
    customJurisdictions: {
      'custom-metro-nashville': { name: 'Metro Nashville, TN', cost: 200, rate: 0.0925 },
      // Sanity filters: these must NOT poison the maps.
      'custom-no-name':   { name: '',               cost: 100,  rate: 0.05 },  // nameless → dropped entirely
      'custom-null-cost': { name: 'Null Cost City', cost: null, rate: 0.05 },  // null cost → permit falls back, tax applies
      'custom-bad-rate':  { name: 'Bad Rate Town',  cost: 90,   rate: 9.25 },  // rate > 1 (percent, not decimal) → tax falls back
      '':                 { name: 'Empty Slug',     cost: 999,  rate: 0.5 }    // '' reserved for Other → skipped
    }
  }
};

const EB2 = loadEngine(PROFILE);
const BASE = { tier: 'better', rawSqft: 3900, pitch: '6/12', wasteFactorOverride: 1.0 };

console.log('\ncustom jurisdictions — engine overlay');
console.log('──────────────────────────────────────────────────');

// ── Line-item path ──
test('calculateLineItem: custom county names + prices the permit line', () => {
  const r = EB2.calculateLineItem(Object.assign({}, BASE, { mode: 'cash', county: 'custom-metro-nashville' }));
  const permit = r.items.find(i => i.code === 'PERMIT');
  if (!permit) throw new Error('no PERMIT line generated');
  eq(permit.name, 'Building Permit — Metro Nashville, TN', 'permit line name');
  eq(permit.materialCost, 200, 'permit cost');
});
test('calculateLineItem: custom county taxes cash at its stored rate', () => {
  const r = EB2.calculateLineItem(Object.assign({}, BASE, { mode: 'cash', county: 'custom-metro-nashville' }));
  eq(r.taxRate, 0.0925, 'taxRate');
});
test('calculateLineItem: blank county still yields Local Jurisdiction + $150 + fallback rate', () => {
  const r = EB2.calculateLineItem(Object.assign({}, BASE, { mode: 'cash' }));
  const permit = r.items.find(i => i.code === 'PERMIT');
  eq(permit.name, 'Building Permit — Local Jurisdiction', 'blank permit name');
  eq(permit.materialCost, 150, 'blank permit cost');
  eq(r.taxRate, 0.07, 'blank taxRate (fallback)');
});
test('calculateLineItem: canonical county unchanged (hamilton-oh $185 / 7.80%)', () => {
  const r = EB2.calculateLineItem(Object.assign({}, BASE, { mode: 'cash', county: 'hamilton-oh' }));
  const permit = r.items.find(i => i.code === 'PERMIT');
  eq(permit.name, 'Building Permit — Hamilton County, OH', 'canonical permit name');
  eq(permit.materialCost, 185, 'canonical permit cost');
  eq(r.taxRate, 0.078, 'canonical taxRate');
});

// ── Per-SQ path (applyCompanyPricing overlay) ──
test('calculatePerSq: custom county resolves permit cost + tax rate', () => {
  const r = EB2.calculateEstimate(Object.assign({ method: 'per-sq', mode: 'cash' }, BASE, { county: 'custom-metro-nashville' }));
  eq(r.addOns.permit, 200, 'per-SQ permit');
  eq(r.taxRate, 0.0925, 'per-SQ taxRate');
});
test('calculatePerSq: blank + unknown county keep the $150 / 7% fail-safes', () => {
  const blank   = EB2.calculateEstimate(Object.assign({ method: 'per-sq', mode: 'cash' }, BASE));
  const unknown = EB2.calculateEstimate(Object.assign({ method: 'per-sq', mode: 'cash' }, BASE, { county: 'zz-nowhere' }));
  eq(blank.addOns.permit, 150, 'blank permit');
  eq(blank.taxRate, 0.07, 'blank taxRate');
  eq(unknown.addOns.permit, 150, 'unknown permit');
  eq(unknown.taxRate, 0.07, 'unknown taxRate');
});
test('calculatePerSq: insurance mode still hides tax on a custom county', () => {
  const r = EB2.calculateEstimate(Object.assign({ method: 'per-sq', mode: 'insurance' }, BASE, { county: 'custom-metro-nashville' }));
  eq(r.taxRate, 0, 'insurance taxRate');
});

// ── Sanity filters ──
test('nameless entry is dropped entirely (no permit, no tax)', () => {
  const r = EB2.calculateEstimate(Object.assign({ method: 'per-sq', mode: 'cash' }, BASE, { county: 'custom-no-name' }));
  eq(r.addOns.permit, 150, 'nameless permit falls back');
  eq(r.taxRate, 0.07, 'nameless tax falls back');
});
test('null cost → permit falls back to $150 (never a silent $0) while the sane rate applies', () => {
  const r = EB2.calculateEstimate(Object.assign({ method: 'per-sq', mode: 'cash' }, BASE, { county: 'custom-null-cost' }));
  eq(r.addOns.permit, 150, 'null-cost permit falls back');
  eq(r.taxRate, 0.05, 'sane rate still applies');
});
test('rate outside 0..1 (percent typo) → tax falls back while the sane cost applies', () => {
  const r = EB2.calculateEstimate(Object.assign({ method: 'per-sq', mode: 'cash' }, BASE, { county: 'custom-bad-rate' }));
  eq(r.addOns.permit, 90, 'sane cost still applies');
  eq(r.taxRate, 0.07, 'out-of-range rate falls back');
});

// ── getCountyTaxMap (the EstimateLogic/JT consumption point) ──
test('getCountyTaxMap: canonical 7 + sane custom rates, no "" key, junk filtered', () => {
  const m = EB2.getCountyTaxMap();
  eq(m['hamilton-oh'], 0.078, 'canonical hamilton-oh');
  eq(m['campbell-ky'], 0.06, 'canonical campbell-ky');
  eq(m['custom-metro-nashville'], 0.0925, 'custom rate');
  eq(m['custom-null-cost'], 0.05, 'custom rate with null cost');
  eq('' in m, false, 'no empty-string key (double-index NaN hazard)');
  eq('custom-no-name' in m, false, 'nameless entry filtered');
  eq('custom-bad-rate' in m, false, 'out-of-range rate filtered');
});
test('getCountyTaxMap does not bake the overlay into loadSettings (loadSettings stays pure)', () => {
  eq('custom-metro-nashville' in EB2.loadSettings().countyTax, false, 'loadSettings().countyTax');
});

// ── No-profile + Node-neutrality ──
test('window without _companyProfile: blank county behaves exactly as factory', () => {
  const bare = loadEngine(undefined);
  const r = bare.calculateEstimate(Object.assign({ method: 'per-sq', mode: 'cash' }, BASE));
  eq(r.addOns.permit, 150, 'permit');
  eq(r.taxRate, 0.07, 'taxRate');
  eq('custom-metro-nashville' in bare.getCountyTaxMap(), false, 'no custom keys');
});
test('pure Node require (no window at all): overlay is a no-op, getter still works', () => {
  const EBn = require(path.join('..', 'docs', 'pro', 'js', 'estimate-builder-v2.js'));
  const m = EBn.getCountyTaxMap();
  eq(m['hamilton-oh'], 0.078, 'canonical rate');
  eq(Object.keys(m).some(k => k.indexOf('custom-') === 0), false, 'no custom keys in Node');
  const r = EBn.calculateEstimate(Object.assign({ method: 'per-sq', mode: 'cash' }, BASE));
  eq(r.addOns.permit, 150, 'Node blank permit');
  eq(r.taxRate, 0.07, 'Node blank taxRate');
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

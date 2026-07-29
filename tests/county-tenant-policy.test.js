/**
 * tests/county-tenant-policy.test.js — the canonical-7 county permit costs and
 * tax rates are PER-TENANT policy (migrated off per-device localStorage
 * 2026-07-29).
 *
 * BEFORE: the 14 county inputs in Settings → Estimates wrote only to
 * localStorage 'nbd_est_settings_v3'. The Firestore copy at
 * userSettings/{uid}.estimateSettingsV2 was WRITE-ONLY DEAD (nothing ever read
 * it back), so a second rep, a second device, or a cleared cache silently
 * priced off the factory tables — and nobody could tell, because the numbers
 * still looked plausible.
 *
 * AFTER: they live in companyProfile.pricing.{permits,countyTax,fallbackTaxRate}
 * and are overlaid onto resolved settings at CALL time by ONE helper
 * (_withTenantCounties) used by every county-resolving entry point — per-SQ
 * (applyCompanyPricing), the line-item generator, and getCountyTaxMap for
 * EstimateLogic / Job Templates — so one estimate cannot price differently
 * depending on which path computed it.
 *
 * Harness mirrors tests/custom-jurisdictions.test.js: vm-load the engine with a
 * `window` sandbox so the typeof-window-guarded overlay is live, plus a plain
 * require() as the no-window neutrality check (Node-side suites like
 * job-templates.test.js depend on that no-op).
 *
 * Run: node tests/county-tenant-policy.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
const fails = [];
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failed++; fails.push(name); }
}
function eq(actual, expected, label) {
  if (actual !== expected) throw new Error((label || 'value') + ' = ' + JSON.stringify(actual) + ' (expected ' + JSON.stringify(expected) + ')');
}
function near(actual, expected, tol, label) {
  if (Math.abs(actual - expected) > tol) throw new Error((label || 'value') + ' = ' + actual + ' (expected ~' + expected + ' ±' + tol + ')');
}

const ENGINE_SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/estimate-builder-v2.js'), 'utf8');
const BOOT = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/dashboard-bootstrap.module.js'), 'utf8');

// Optional savedSettings simulates what THIS DEVICE has in localStorage, so the
// device-vs-tenant precedence can be exercised for real.
function loadEngine(companyProfile, savedSettings) {
  const win = {}; win.window = win;
  if (companyProfile !== undefined) win._companyProfile = companyProfile;
  if (savedSettings !== undefined) {
    const store = { nbd_est_settings_v3: JSON.stringify(savedSettings) };
    win.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
  }
  const sandbox = { window: win, localStorage: win.localStorage, console: { log() {}, warn() {}, error() {} } };
  vm.runInNewContext(ENGINE_SRC, sandbox, { filename: 'estimate-builder-v2.js' });
  if (!win.EstimateBuilderV2) throw new Error('engine did not attach to window');
  return win.EstimateBuilderV2;
}

const perSq = (EB2, county) => EB2.calculatePerSq({
  squares: 20, tier: 'good', mode: 'cash', layers: 1, county: county, city: county,
});

console.log('COUNTY TENANT POLICY — canonical overrides are company-wide');

// ── Precedence: tenant policy beats the device ────────────────────────────
console.log('\nPrecedence');
{
  // This device saved 999 for Hamilton; the company says 210. Company wins.
  const DEVICE = { permits: { 'hamilton-oh': { name: 'Hamilton County, OH', cost: 999 } }, countyTax: { 'hamilton-oh': 0.11 } };
  const TENANT = { pricing: { permits: { 'hamilton-oh': { name: 'Hamilton County, OH', cost: 210 } }, countyTax: { 'hamilton-oh': 0.0825 } } };

  test('tenant permit cost overrides the device value', () => {
    const EB2 = loadEngine(TENANT, DEVICE);
    eq(EB2.loadSettings().permits['hamilton-oh'].cost, 999, 'loadSettings stays PURE (device value)');
    const r = perSq(EB2, 'hamilton-oh');
    const permit = r.addOns.permit;
    eq(permit, 210, 'resolved permit');
  });

  test('tenant county tax rate overrides the device value', () => {
    const EB2 = loadEngine(TENANT, DEVICE);
    near(perSq(EB2, 'hamilton-oh').taxRate, 0.0825, 1e-9, 'resolved tax rate');
  });

  test('getCountyTaxMap agrees with the per-SQ path (no per-path drift)', () => {
    const EB2 = loadEngine(TENANT, DEVICE);
    near(EB2.getCountyTaxMap()['hamilton-oh'], 0.0825, 1e-9, 'getCountyTaxMap rate');
  });

  test('the line-item path resolves the same tenant permit', () => {
    const EB2 = loadEngine(TENANT, DEVICE);
    const items = EB2.generateLineItemsFromMeasurements({ squares: 20, county: 'hamilton-oh', city: 'hamilton-oh' });
    const line = (Array.isArray(items) ? items : []).find(l => /Building Permit/.test(l.name || ''));
    if (!line) throw new Error('no permit line generated');
    eq(Number(line.materialCost), 210, 'line-item permit cost');
    if (!/Hamilton County, OH/.test(line.name)) throw new Error('permit line lost its label: ' + line.name);
  });

  test('a county the tenant has NOT overridden keeps its config rate', () => {
    const EB2 = loadEngine(TENANT, DEVICE);
    near(perSq(EB2, 'butler-oh').taxRate, 0.0725, 1e-9, 'butler-oh untouched');
  });

  test('with NO tenant policy the device value still applies (nothing regressed)', () => {
    const EB2 = loadEngine({ pricing: {} }, DEVICE);
    eq(perSq(EB2, 'hamilton-oh').addOns.permit, 999, 'device permit stands');
  });
}

// ── Sanitization: a bad tenant value must never under-price ───────────────
console.log('\nSanitization (L-1 under-pricing class)');
{
  const bad = (permits, countyTax) => loadEngine({ pricing: { permits: permits, countyTax: countyTax } });

  test('blank permit cost is DROPPED — config $185 stands, never $0', () => {
    const EB2 = bad({ 'hamilton-oh': { name: 'Hamilton County, OH', cost: '' } });
    eq(perSq(EB2, 'hamilton-oh').addOns.permit, 185, 'permit');
  });
  test('garbage permit cost is DROPPED', () => {
    const EB2 = bad({ 'hamilton-oh': { name: 'Hamilton County, OH', cost: 'free' } });
    eq(perSq(EB2, 'hamilton-oh').addOns.permit, 185, 'permit');
  });
  test('negative permit cost is DROPPED', () => {
    const EB2 = bad({ 'hamilton-oh': { name: 'Hamilton County, OH', cost: -50 } });
    eq(perSq(EB2, 'hamilton-oh').addOns.permit, 185, 'permit');
  });
  test('a literal 0 permit IS honored (a jurisdiction that charges nothing)', () => {
    const EB2 = bad({ 'hamilton-oh': { name: 'Hamilton County, OH', cost: 0 } });
    eq(perSq(EB2, 'hamilton-oh').addOns.permit, 0, 'permit');
  });
  test('blank tenant NAME falls back to the base label (never "Building Permit — ")', () => {
    const EB2 = bad({ 'hamilton-oh': { name: '   ', cost: 240 } });
    const items = EB2.generateLineItemsFromMeasurements({ squares: 20, county: 'hamilton-oh', city: 'hamilton-oh' });
    const line = (Array.isArray(items) ? items : []).find(l => /Building Permit/.test(l.name || ''));
    if (!line || !/Hamilton County, OH/.test(line.name)) throw new Error('label lost: ' + (line && line.name));
    eq(Number(line.materialCost), 240, 'cost still applied');
  });
  test('blank tax rate is DROPPED — config rate stands, never 0%', () => {
    const EB2 = bad(undefined, { 'hamilton-oh': '' });
    near(perSq(EB2, 'hamilton-oh').taxRate, 0.078, 1e-9, 'tax rate');
  });
  test('a literal 0 tax rate IS honored (a tenant with no sales tax)', () => {
    const EB2 = bad(undefined, { 'hamilton-oh': 0 });
    eq(perSq(EB2, 'hamilton-oh').taxRate, 0, 'tax rate');
  });
  test("an '' county key never enters the maps (the NaN double-index hazard)", () => {
    const EB2 = bad({ '': { name: 'Nowhere', cost: 500 } }, { '': 0.5 });
    const s = EB2.getCountyTaxMap();
    if ('' in s) throw new Error("'' key leaked into the tax map");
  });
  test('a non-object permit entry is ignored', () => {
    const EB2 = bad({ 'hamilton-oh': 240 });
    eq(perSq(EB2, 'hamilton-oh').addOns.permit, 185, 'permit');
  });
}

// ── fallbackTaxRate (the blank-county rate) ───────────────────────────────
console.log('\nfallbackTaxRate');
{
  test('tenant fallback rate applies when no county is set', () => {
    const EB2 = loadEngine({ pricing: { fallbackTaxRate: 0.0625 } });
    near(perSq(EB2, '').taxRate, 0.0625, 1e-9, 'blank-county rate');
  });
  test('tenant fallback of 0 is honored (no sales tax)', () => {
    const EB2 = loadEngine({ pricing: { fallbackTaxRate: 0 } });
    eq(perSq(EB2, '').taxRate, 0, 'blank-county rate');
  });
  test('null / blank fallback is ignored — 7% config default stands', () => {
    near(perSq(loadEngine({ pricing: { fallbackTaxRate: null } }), '').taxRate, 0.07, 1e-9, 'null');
    near(perSq(loadEngine({ pricing: { fallbackTaxRate: '' } }), '').taxRate, 0.07, 1e-9, 'blank');
  });
  test('blank county still charges the $150 permit fail-safe (C-1 intact)', () => {
    eq(perSq(loadEngine({ pricing: { fallbackTaxRate: 0.05 } }), '').addOns.permit, 150, 'permit');
  });
}

// ── Coexistence with custom jurisdictions (#1133) ─────────────────────────
console.log('\nCoexistence with custom jurisdictions');
{
  const BOTH = { pricing: {
    permits:   { 'hamilton-oh': { name: 'Hamilton County, OH', cost: 210 } },
    countyTax: { 'hamilton-oh': 0.0825 },
    customJurisdictions: { 'custom-metro-nashville': { name: 'Metro Nashville, TN', cost: 200, rate: 0.0925 } },
  } };
  test('canonical override and custom jurisdiction both resolve', () => {
    const EB2 = loadEngine(BOTH);
    eq(perSq(EB2, 'hamilton-oh').addOns.permit, 210, 'canonical permit');
    eq(perSq(EB2, 'custom-metro-nashville').addOns.permit, 200, 'custom permit');
    near(perSq(EB2, 'custom-metro-nashville').taxRate, 0.0925, 1e-9, 'custom rate');
  });
  test('both appear in getCountyTaxMap', () => {
    const m = loadEngine(BOTH).getCountyTaxMap();
    near(m['hamilton-oh'], 0.0825, 1e-9, 'canonical');
    near(m['custom-metro-nashville'], 0.0925, 1e-9, 'custom');
  });
}

// ── Node neutrality: no window → no overlay (other suites depend on this) ──
console.log('\nNode neutrality');
{
  test('a plain require() (no window) prices off the config tables', () => {
    const EB2 = require(path.join(__dirname, '..', 'docs/pro/js/estimate-builder-v2.js'))
      || (typeof global !== 'undefined' && global.EstimateBuilderV2);
    const api = EB2 && EB2.calculatePerSq ? EB2 : (global.window && global.window.EstimateBuilderV2);
    if (!api || typeof api.calculatePerSq !== 'function') { console.log('    (engine not require-able standalone — covered by job-templates.test.js)'); return; }
    eq(api.calculatePerSq({ squares: 20, tier: 'good', mode: 'cash', layers: 1, county: 'hamilton-oh', city: 'hamilton-oh' }).addOns.permit, 185, 'config permit');
  });
  test('the overlay is guarded by typeof window (source pin)', () => {
    if (!/function _withTenantCounties[\s\S]{0,400}typeof window !== 'undefined'/.test(ENGINE_SRC)) {
      throw new Error('_withTenantCounties must read companyProfile behind a typeof-window guard');
    }
  });
}

// ── Persistence contract (settings panel save / load / reset) ─────────────
console.log('\nPersistence contract (dashboard-bootstrap)');
{
  test('SAVE writes the county maps + fallback to companyProfile.pricing', () => {
    if (!/pricing\.permits = patch\.permits/.test(BOOT)) throw new Error('permits not persisted per-tenant');
    if (!/pricing\.countyTax = patch\.countyTax/.test(BOOT)) throw new Error('countyTax not persisted per-tenant');
    if (!/pricing\.fallbackTaxRate = patch\.fallbackTaxRate/.test(BOOT)) throw new Error('fallbackTaxRate not persisted per-tenant');
  });
  test('the per-tenant write is gated on a hydrated profile (no wipe from a stale page)', () => {
    if (!/if \(profileReady\) \{[\s\S]{0,220}pricing\.permits = patch\.permits/.test(BOOT)) {
      throw new Error('county persistence must sit behind profileReady');
    }
  });
  test('the county maps are FULL-REPLACED at their dot paths (merge would resurrect)', () => {
    if (!/'pricing\.permits'\] = patch\.permits/.test(BOOT)) throw new Error('permits not full-replaced');
    if (!/'pricing\.countyTax'\] = patch\.countyTax/.test(BOOT)) throw new Error('countyTax not full-replaced');
  });
  test('RESET clears the tenant county policy, not just localStorage', () => {
    const i = BOOT.indexOf('const _resetEstimateDefaultsV2');
    const block = BOOT.slice(i, i + 2600);
    if (!/'pricing\.permits': \{\}/.test(block)) throw new Error('reset does not clear permits');
    if (!/'pricing\.countyTax': \{\}/.test(block)) throw new Error('reset does not clear countyTax');
    if (!/'pricing\.fallbackTaxRate': null/.test(block)) throw new Error('reset does not clear fallbackTaxRate');
    if (!/window\._companyProfileLoaded === true/.test(block)) throw new Error('reset must gate on a hydrated profile');
  });
  test('reset warns that county rates are company-wide before wiping them', () => {
    const i = BOOT.indexOf('const _resetEstimateDefaultsV2');
    if (!/COMPANY-wide/.test(BOOT.slice(i, i + 600))) throw new Error('confirm() copy must say the reset hits every rep');
  });
  test('the panel DISPLAYS resolved (tenant) values but SAVES from pure device settings', () => {
    if (!/const s = _v2ReadResolvedSettings\(\);/.test(BOOT)) throw new Error('load must read the resolved settings');
    if (!/function _v2ReadResolvedSettings/.test(BOOT)) throw new Error('missing resolved-settings bridge');
    const si = BOOT.indexOf('window._saveEstimateDefaultsV2');
    const save = BOOT.slice(si, si + 4000);
    if (/_v2ReadResolvedSettings\(\)/.test(save)) throw new Error('the SAVE path must use the PURE read, or the overlay is written back as device state');
  });
  test('a rules denial is reported as permission, not as a network blip', () => {
    if (!/function _pricingDenied/.test(BOOT)) throw new Error('missing _pricingDenied helper');
    if (!/owner or company admin/i.test(BOOT)) throw new Error('denied copy must name who can change company pricing');
  });
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }

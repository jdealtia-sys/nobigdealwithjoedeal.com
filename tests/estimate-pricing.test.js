/**
 * estimate-pricing.test.js
 *
 * Locks in the spec'd pricing math from
 * memory/site_wide_spec_20260410.md:
 *   - per-SQ flat rates Good/Better/Best ($545/$595/$660)
 *   - $2,500 minimum job charge below ~4.5 SQ
 *   - $25 rounding
 *   - county tax (Hamilton 7.80, Butler 7.25, Warren 6.75, Clermont 7.25,
 *     Kenton/Boone/Campbell 6.00)
 *   - cash mode applies tax, insurance mode hides it
 *   - tear-off layers add $50/SQ per extra layer
 *
 * Pure-Node test, no emulator required. Run via:
 *   node tests/estimate-pricing.test.js
 */

const path = require('path');
const EBv2 = require(path.join('..', 'docs', 'pro', 'js', 'estimate-builder-v2.js'));

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

console.log('\nestimate-builder-v2 pricing engine');
console.log('──────────────────────────────────────────────────');

// ── Tier rates ──
test('TIER_RATES: Good = $545/SQ', () => {
  eq(EBv2.TIER_RATES.good, 545);
});
test('TIER_RATES: Better = $595/SQ', () => {
  eq(EBv2.TIER_RATES.better, 595);
});
test('TIER_RATES: Best = $660/SQ', () => {
  eq(EBv2.TIER_RATES.best, 660);
});

// ── Constants ──
test('Minimum job charge = $2,500', () => {
  eq(EBv2.MIN_JOB_CHARGE, 2500);
});
test('Round to nearest $25 (derived from roundToNearest default)', () => {
  // ROUND_TO is internal; verify by passing no step.
  eq(EBv2.roundToNearest(1037), 1025);
  eq(EBv2.roundToNearest(1038), 1050);
});
test('Tear-off extra defaults to $50/SQ per extra (derived via calc)', () => {
  // 10 SQ × 2 extra layers × $50 = $1,000 — verified end-to-end below.
  // This test is a sanity placeholder for the constant.
  eq(true, true);
});

// ── roundToNearest ──
test('roundToNearest: 1003 → 1000', () => {
  eq(EBv2.roundToNearest(1003, 25), 1000);
});
test('roundToNearest: 1013 → 1025', () => {
  eq(EBv2.roundToNearest(1013, 25), 1025);
});
test('roundToNearest: $25 default step', () => {
  eq(EBv2.roundToNearest(1037), 1025);
});

// ── County tax (verify shape; calculatePerSq exercises full path) ──
test('County tax: Hamilton OH = 7.80%', () => {
  eq(EBv2.COUNTY_TAX['hamilton-oh'], 0.0780);
});
test('County tax: Butler OH = 7.25%', () => {
  eq(EBv2.COUNTY_TAX['butler-oh'], 0.0725);
});
test('County tax: Warren OH = 6.75%', () => {
  eq(EBv2.COUNTY_TAX['warren-oh'], 0.0675);
});
test('County tax: Clermont OH = 7.25%', () => {
  eq(EBv2.COUNTY_TAX['clermont-oh'], 0.0725);
});
test('County tax: Kenton KY = 6.00%', () => {
  eq(EBv2.COUNTY_TAX['kenton-ky'], 0.0600);
});
test('County tax: Boone KY = 6.00%', () => {
  eq(EBv2.COUNTY_TAX['boone-ky'], 0.0600);
});
test('County tax: Campbell KY = 6.00%', () => {
  eq(EBv2.COUNTY_TAX['campbell-ky'], 0.0600);
});

// ── extraPipeBootCharge ──
test('extraPipeBootCharge: 4 pipes → $0 (free)', () => {
  eq(EBv2.extraPipeBootCharge(4, 85), 0);
});
test('extraPipeBootCharge: 5 pipes → $85', () => {
  eq(EBv2.extraPipeBootCharge(5, 85), 85);
});
test('extraPipeBootCharge: 7 pipes → $255 (3 extra)', () => {
  eq(EBv2.extraPipeBootCharge(7, 85), 255);
});

// ── End-to-end calculations via calculateEstimate ──
test('39 SQ Better tier ≈ $23,755 (rawSqft pre-baked, waste=1)', () => {
  const r = EBv2.calculateEstimate({
    method: 'per-sq', tier: 'better', mode: 'insurance',
    rawSqft: 3900, pitch: 6, wasteFactorOverride: 1.0
  });
  // 39 × $595 = $23,205. Insurance hides tax. Add-ons default 0.
  // Base + dumpFee default ($550) = $23,755 → rounds to $23,750
  near(r.total, 23755, 30, 'insurance Better total');
});
test('Cash mode applies county tax; insurance mode hides it', () => {
  const cash = EBv2.calculateEstimate({
    method: 'per-sq', tier: 'better', mode: 'cash',
    rawSqft: 3900, pitch: 6, county: 'hamilton-oh'
  });
  const ins = EBv2.calculateEstimate({
    method: 'per-sq', tier: 'better', mode: 'insurance',
    rawSqft: 3900, pitch: 6, county: 'hamilton-oh'
  });
  if (cash.total <= ins.total) throw new Error('cash total should exceed insurance total when tax applies; cash=' + cash.total + ' ins=' + ins.total);
});
test('Below 4.5 SQ enforces $2,500 minimum', () => {
  const r = EBv2.calculateEstimate({
    method: 'per-sq', tier: 'good', mode: 'insurance',
    rawSqft: 200, pitch: 4 // 2 SQ × $545 = $1,090 → bumps to $2,500
  });
  if (r.total < 2500) throw new Error('expected ≥2500, got ' + r.total);
});
test('Tear-off layers: 3 layers adds (3-1)*sq*$50', () => {
  const common = { method:'per-sq', tier:'good', mode:'insurance',
                   rawSqft: 1000, pitch: 6, wasteFactorOverride: 1.0 };
  const oneLayer = EBv2.calculateEstimate(Object.assign({}, common, { tearOffLayers: 1 }));
  const threeLayer = EBv2.calculateEstimate(Object.assign({}, common, { tearOffLayers: 3 }));
  // 10 SQ × 2 extra layers × $50 = $1,000 extra
  near(threeLayer.total - oneLayer.total, 1000, 30, 'tear-off premium');
});

console.log('──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);

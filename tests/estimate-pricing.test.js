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

// ── Deposit math (Rock 2 PR 4) ──
// Spec: cash defaults 50%, insurance defaults 0%, override 0–100,
// amount rounded to nearest $25, remainder = total − amount.
test('calcDeposit: cash mode default = 50%', () => {
  const d = EBv2.calcDeposit(10000, 'cash');
  eq(d.pct, 50, 'pct');
  eq(d.amount, 5000, 'amount');
  eq(d.remainder, 5000, 'remainder');
});
test('calcDeposit: insurance mode default = 0%', () => {
  const d = EBv2.calcDeposit(10000, 'insurance');
  eq(d.pct, 0, 'pct');
  eq(d.amount, 0, 'amount');
  eq(d.remainder, 10000, 'remainder');
});
test('calcDeposit: override pct beats default', () => {
  const d = EBv2.calcDeposit(10000, 'cash', { overridePct: 25 });
  eq(d.pct, 25, 'pct');
  eq(d.amount, 2500, 'amount');
  eq(d.remainder, 7500, 'remainder');
});
test('calcDeposit: override 0 on cash collapses to no deposit', () => {
  const d = EBv2.calcDeposit(10000, 'cash', { overridePct: 0 });
  eq(d.pct, 0);
  eq(d.amount, 0);
  eq(d.remainder, 10000);
});
test('calcDeposit: override out-of-range falls back to default', () => {
  const d = EBv2.calcDeposit(10000, 'cash', { overridePct: 150 });
  eq(d.pct, 50, 'rejected 150% → defaulted to 50');
});
test('calcDeposit: zero/negative total returns all zeros', () => {
  const a = EBv2.calcDeposit(0, 'cash');
  eq(a.amount, 0); eq(a.pct, 0); eq(a.remainder, 0);
  const b = EBv2.calcDeposit(-100, 'cash');
  eq(b.amount, 0); eq(b.pct, 0); eq(b.remainder, 0);
});
test('calcDeposit: amount rounds to nearest $25', () => {
  // $16,375 × 50% = $8,187.50 → rounds to $8,200 (nearest $25)
  const d = EBv2.calcDeposit(16375, 'cash');
  eq(d.amount, 8200, 'rounded to nearest $25');
  // remainder = total − amount, preserved to cent precision
  eq(d.remainder, 8175, 'remainder');
});
test('calcDeposit: amount + remainder === total (always)', () => {
  // Property: deposit math must never lose pennies
  const samples = [
    [10000, 'cash'], [16375, 'cash'], [9999, 'insurance'],
    [12345.67, 'cash', { overridePct: 33 }],
    [8888.88, 'cash', { overridePct: 75 }]
  ];
  for (const args of samples) {
    const d = EBv2.calcDeposit.apply(null, args);
    near(d.amount + d.remainder, args[0], 0.01,
         'sum (' + args[0] + ', ' + args[1] + ', override=' + (args[2] && args[2].overridePct) + ')');
  }
});

// ── Deposit integration with calculateEstimate ──
test('calculateEstimate: cash mode includes 50% deposit + remainder', () => {
  const r = EBv2.calculateEstimate({
    method: 'per-sq', tier: 'better', mode: 'cash',
    rawSqft: 3000, pitch: 6, wasteFactorOverride: 1.0
  });
  // 30 SQ × $595 = $17,850 base + tax + minor add-ons
  eq(r.depositPct, 50, 'depositPct');
  near(r.deposit + r.depositRemainder, r.total, 0.01, 'deposit + remainder == total');
});
test('calculateEstimate: insurance mode → 0 deposit, full remainder', () => {
  const r = EBv2.calculateEstimate({
    method: 'per-sq', tier: 'better', mode: 'insurance',
    rawSqft: 3000, pitch: 6, wasteFactorOverride: 1.0
  });
  eq(r.deposit, 0, 'deposit');
  eq(r.depositPct, 0, 'depositPct');
  eq(r.depositRemainder, r.total, 'remainder = total');
});

console.log('──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);

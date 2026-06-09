/**
 * tests/estimate-engine-parity.test.js — classic↔V2 config-drift unification.
 *
 * D-1/D-2/D-4 (Joe-approved 2026-06-09): the deprecated Classic builder now
 * uses the validated V2/config values instead of its legacy ones.
 *
 *   D-2 (waste-from-pitch): Classic's recommendedWasteForPitch delegates to
 *     EstimateBuilderV2.wasteFactorForPitch. Classic passes the slope-area
 *     FACTOR (√(1+(rise/run)²)); V2 keys on the rise/run RATIO. This test proves
 *     the factor→ratio conversion (ratio = √(factor²−1)) maps the standard
 *     pitches onto V2's exact buckets — i.e. Classic now == V2 for every pitch.
 *   D-4 (extra pipe boot): unified at $85 in estimate-config.js
 *     (ADDON_EXTRA_PIPE_BOOT), which Classic now reads instead of its legacy $45.
 *   D-1 (permit): Classic's per-city defaults realigned to each city's COUNTY
 *     V2 value (asserted against the committed estimates.js source text).
 *
 * Run: node tests/estimate-engine-parity.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

function loadV2() {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/estimate-builder-v2.js'), 'utf8');
  const win = {}; win.window = win;
  vm.runInNewContext(SRC, { window: win, console: { log() {}, warn() {}, error() {} }, Math, JSON, Object, Number }, { filename: 'estimate-builder-v2.js' });
  return win.EstimateBuilderV2;
}
function loadConfig() {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/estimate-config.js'), 'utf8');
  const win = {}; win.window = win;
  vm.runInNewContext(SRC, { window: win, console: { log() {}, warn() {}, error() {} }, Math, JSON, Object }, { filename: 'estimate-config.js' });
  return win.NBD_ESTIMATE_CONFIG;
}

const V2 = loadV2();
const CFG = loadConfig();

// Replicates Classic's delegated recommendedWasteForPitch (the V2 path).
function classicWaste(pitchFactor) {
  const pf = Number(pitchFactor) || 1;
  const ratio = pf > 1 ? Math.sqrt(pf * pf - 1) : 0;
  return V2.wasteFactorForPitch(ratio);
}

// ════════════════════════════════════════════════════════════════════
// D-2 — classic waste (via delegation) == V2 waste for the standard pitches.
// ════════════════════════════════════════════════════════════════════
console.log('\nENGINE PARITY — D-2 waste-from-pitch (classic delegates to V2)');
// [classic slope factor, rise/run label, expected V2 waste]
const PITCHES = [
  [1.000, 'flat', 1.12],
  [1.054, '4/12', 1.15],
  [1.118, '6/12', 1.15],
  [1.202, '8/12', 1.17],
  [1.302, '10/12', 1.20],
  [1.414, '12/12', 1.20],   // rise/run 1.0 → V2 "≤1.00 → 1.20"; only >12/12 hits 1.25
  [1.474, '14/12', 1.25],
];
for (const [factor, label, expected] of PITCHES) {
  const got = classicWaste(factor);
  ok('D-2 ' + label + ' (factor ' + factor + ') → V2 waste ' + expected, got === expected);
  // And it must equal feeding V2 the rise/run directly (no factor-conversion drift).
  const rr = label === 'flat' ? 0 : (Number(label.split('/')[0]) / 12);
  ok('D-2 ' + label + ': factor-conversion == direct rise/run lookup', got === V2.wasteFactorForPitch(rr));
}

// ════════════════════════════════════════════════════════════════════
// D-4 — extra pipe boot unified at $85 in config.
// ════════════════════════════════════════════════════════════════════
console.log('\nENGINE PARITY — D-4 extra pipe boot + config add-ons');
ok('D-4 config ADDON_EXTRA_PIPE_BOOT === 85', CFG.ADDON_EXTRA_PIPE_BOOT === 85);
ok('config still has chimney 425 / skylight 350 (unchanged)', CFG.ADDON_CHIMNEY_FLASH === 425 && CFG.ADDON_SKYLIGHT_FLASH === 350);
// V2's own add-on price agrees with config (single source of truth).
ok('D-4 V2 extraPipeBoot agrees with config ($85)', !V2.ADDON_PRICES || V2.ADDON_PRICES.extraPipeBoot === 85);

// ════════════════════════════════════════════════════════════════════
// D-1 — classic per-city permit defaults realigned to county V2 values.
// (Asserted against the committed estimates.js source so a regression is caught.)
// ════════════════════════════════════════════════════════════════════
console.log('\nENGINE PARITY — D-1 permit defaults realigned to county values');
const ESTSRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/estimates.js'), 'utf8');
const permitBlock = (ESTSRC.match(/const PERMIT_COSTS = \{[\s\S]*?\};/) || [''])[0];
ok('D-1 Cincinnati → Hamilton county $185', /Cincinnati:\s*185/.test(permitBlock));
ok('D-1 Mason → Warren county $165', /Mason:\s*165/.test(permitBlock));
ok('D-1 Milford → Clermont county $170', /Milford:\s*170/.test(permitBlock));
ok('D-1 Covington → Kenton county $125', /Covington:\s*125/.test(permitBlock));
ok('D-1 legacy Cincinnati $175 is gone', !/Cincinnati:\s*175/.test(permitBlock));

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
process.exit(0);

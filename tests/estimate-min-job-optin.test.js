/**
 * MINIMUM JOB CHARGE IS OPT-IN, NOT A DEFAULT.
 *
 * resolveEstimate() used to fall back to a $2,500 floor whenever the caller
 * passed no minJobCharge — and the manual line-item path passes none, because
 * estimate-v2-ui.js only forwards state.minJobCharge when it is non-null and
 * its default is null.
 *
 * The result was a scope that never asked for a floor getting one anyway.
 * Joe built a pipe-boot repair by hand — four catalog items totalling $555 —
 * and the app quoted $2,500. That is not a rounding problem; it is a quote no
 * homeowner accepts, from a business whose own rate card has invoiced $125 and
 * $225 jobs. It also drove the Good/Better/Best cards to show GOOD $2,500 /
 * BETTER $725 / BEST $2,500, so "Better" read cheaper than "Good".
 *
 * What must NOT regress: a caller that DOES ask for a floor still gets it.
 * Job templates carry their own (pipe boot 350, 3-pack 450, 5-shingle 500) and
 * job-templates.test.js enforces that convention; the per-SQ replacement
 * engine keeps its own MIN_JOB_CHARGE, which is the case the floor was
 * designed for.
 *
 * Run: node tests/estimate-min-job-optin.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/estimate-logic-engine.js'), 'utf8');
function loadEngine() {
  const win = {}; win.window = win;
  const sandbox = { window: win, console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Set };
  vm.runInNewContext(SRC, sandbox, { filename: 'estimate-logic-engine.js' });
  return win.EstimateLogic;
}
const EL = loadEngine();

// The SHAPE of Joe's scope — a hand-entered repair with no template, so no
// minJobCharge — with SYNTHETIC costs.
//
// The costs are deliberately invented rather than copied from the catalog.
// catalog-cost-seed.test.js enforces that no file outside docs/ quotes a real
// published cost pair, and it is right to: a fixture that duplicates catalog
// numbers silently drifts from them the moment a price changes, and then pins
// a price that no longer exists. What this suite is about is the FLOOR, not
// the figures — every assertion below is a threshold or a comparison, so the
// exact costs do not matter as long as the scope totals a few hundred dollars.
// The codes are synthetic too, so nothing here can be mistaken for a rate.
const SCOPE = [
  { code: 'TST JOB-A', name: 'Mobilization (synthetic)', category: 'labor',   unit: 'JOB', quantity: 1,  materialCost: 0,    laborCost: 200 },
  { code: 'TST LF-A',  name: 'Linear trim (synthetic)',  category: 'roofing', unit: 'LF',  quantity: 20, materialCost: 2.00, laborCost: 0.50 },
  { code: 'TST HR-A',  name: 'Detail hours (synthetic)', category: 'labor',   unit: 'HR',  quantity: 2,  materialCost: 0,    laborCost: 80 },
  { code: 'TST JOB-B', name: 'Cleanup (synthetic)',      category: 'labor',   unit: 'JOB', quantity: 1,  materialCost: 0,    laborCost: 100 },
];
const MEAS = { rawSqft: 200, pitch: 6, stories: 1 };

console.log('MIN JOB — a scope that asks for no floor gets none');
const none = EL.resolveEstimate(SCOPE, MEAS, { tier: 'better', mode: 'retail' });
ok('estimate resolves', !!none && typeof none.total === 'number');
ok('no floor was applied', none.minJobApplied === false, 'minJobApplied=' + (none && none.minJobApplied));
ok('total is NOT the retired $2,500 default', Math.round(none.total) !== 2500, 'total=' + (none && none.total));
// The synthetic scope is a few hundred in hard cost; retail adds the material
// markup and O&P, so the figure lands well under a thousand — nowhere near the
// old floor. Joe's real scope behaved the same way: $555 of items, quoted
// $2,500.
ok('total is in the hundreds, not thousands', none.total > 100 && none.total < 1500, 'total=' + (none && none.total));

console.log('\nMIN JOB — a caller that DOES ask for a floor still gets one');
const withFloor = EL.resolveEstimate(SCOPE, MEAS, { tier: 'better', mode: 'retail', minJobCharge: 2500 });
ok('floor applied when explicitly requested', withFloor.minJobApplied === true);
ok('total raised to the requested floor', Math.round(withFloor.total) === 2500, 'total=' + withFloor.total);

// The real template values, so the fix cannot quietly disable them.
const tpl = EL.resolveEstimate(SCOPE, MEAS, { tier: 'better', mode: 'retail', minJobCharge: 350 });
ok('a $350 template floor below the scope total does NOT inflate it',
  tpl.minJobApplied === false && Math.round(tpl.total) === Math.round(none.total),
  'total=' + tpl.total);

const tiny = EL.resolveEstimate(
  [{ code: 'TST JOB-C', name: 'Tiny scope (synthetic)', category: 'labor', unit: 'JOB', quantity: 1, materialCost: 0, laborCost: 40 }],
  MEAS, { tier: 'better', mode: 'retail', minJobCharge: 350 });
ok('a $350 template floor ABOVE the scope total does bind',
  tiny.minJobApplied === true && Math.round(tiny.total) === 350, 'total=' + tiny.total);

console.log('\nMIN JOB — explicit zero is honoured, not treated as absent');
const zero = EL.resolveEstimate(SCOPE, MEAS, { tier: 'better', mode: 'retail', minJobCharge: 0 });
ok('minJobCharge 0 applies no floor', zero.minJobApplied === false);
ok('minJobCharge 0 matches the no-setting total', Math.round(zero.total) === Math.round(none.total));

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
process.exit(0);

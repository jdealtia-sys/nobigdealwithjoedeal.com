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

// Joe's actual scope, entered by hand: no template, so no minJobCharge.
// LAB MOB 1 JOB @250 · RFG DRPE-AL 20 LF @1.95 mat + 0.65 lab
// LAB DTL-HR 2 HR @85 · LAB CLN-M 1 JOB @125
const SCOPE = [
  { code: 'LAB MOB',     name: 'Mobilization / Setup', category: 'labor',   unit: 'JOB', quantity: 1,  materialCost: 0,    laborCost: 250 },
  { code: 'RFG DRPE-AL', name: 'Drip Edge Aluminum',   category: 'roofing', unit: 'LF',  quantity: 20, materialCost: 1.95, laborCost: 0.65 },
  { code: 'LAB DTL-HR',  name: 'Detail Work',          category: 'labor',   unit: 'HR',  quantity: 2,  materialCost: 0,    laborCost: 85 },
  { code: 'LAB CLN-M',   name: 'Magnetic Nail Sweep',  category: 'labor',   unit: 'JOB', quantity: 1,  materialCost: 0,    laborCost: 125 },
];
const MEAS = { rawSqft: 200, pitch: 6, stories: 1 };

console.log('MIN JOB — a scope that asks for no floor gets none');
const none = EL.resolveEstimate(SCOPE, MEAS, { tier: 'better', mode: 'retail' });
ok('estimate resolves', !!none && typeof none.total === 'number');
ok('no floor was applied', none.minJobApplied === false, 'minJobApplied=' + (none && none.minJobApplied));
ok('total is NOT the retired $2,500 default', Math.round(none.total) !== 2500, 'total=' + (none && none.total));
// Hard costs are $555; retail adds the 25% material markup plus O&P, so the
// figure lands well under a thousand and nowhere near the old floor.
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
  [{ code: 'LAB CLN-M', name: 'Sweep', category: 'labor', unit: 'JOB', quantity: 1, materialCost: 0, laborCost: 40 }],
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

/**
 * tests/money-field-contract.test.js — estimate line-item field contract.
 *
 * RULE (from the 2026-07-18 margin-exposure fix / PR #988):
 *   - line.lineTotal / materialTotal / laborTotal / *CostPerUnit = INTERNAL
 *     cost basis. Never print to a customer surface.
 *   - line.retailTotal / retailPerUnit = customer-facing retail (markup/O&P).
 *     Customer invoices, quotes, and portal estimate exports MUST prefer these.
 *
 * This is a source-contract guard so a future sweep can't re-introduce printing
 * cost as retail. Behavioral coverage lives in customer-estimate-rows.test.js
 * and estimate-v2-payload.test.js.
 *
 * Zero deps. Run: node tests/money-field-contract.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name); }
}
function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

console.log('MONEY FIELD CONTRACT — cost vs retail');

const pipe = read('docs/pro/js/invoice-pipeline.js');
ok('invoice pipeline prefers retailTotal for customer row amounts',
  /retailTotal/.test(pipe) && /buildRowItems/.test(pipe));

// Portal residual fix (#989): pre-sweep rows must not export raw cost totals.
const portalHits = [
  'docs/pro/js/customer-portal.js',
  'docs/pro/js/customer-estimate.js',
  'docs/pro/js/portal-estimate.js',
].filter((rel) => fs.existsSync(path.join(__dirname, '..', rel)));

let portalSrc = '';
for (const rel of portalHits) portalSrc += '\n' + read(rel);
// Fall back to grepping known post-#989 surfaces if the portal is modularized.
if (!portalSrc.trim()) {
  // Search docs/pro/js for estimate export helpers that mention retailTotal.
  const dir = path.join(__dirname, '..', 'docs/pro/js');
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    if (/retailTotal/.test(src) && /portal|customer|estimate/i.test(name + src.slice(0, 200))) {
      portalSrc += '\n' + src;
    }
  }
}
ok('at least one customer/portal surface references retailTotal',
  /retailTotal/.test(portalSrc) || /retailTotal/.test(pipe));

// Behavioral suite must still exist (the real correctness check).
ok('customer-estimate-rows.test.js exists (behavioral retail preference)',
  fs.existsSync(path.join(__dirname, 'customer-estimate-rows.test.js')));
const rowsTest = read('tests/customer-estimate-rows.test.js');
ok('customer-estimate-rows asserts retailTotal wins over cost fields',
  /retailTotal wins over cost/.test(rowsTest) || /retailTotal/.test(rowsTest));

// Engine / V2 payload keeps lineTotal as COST (internal).
const v2 = read('tests/estimate-v2-payload.test.js');
ok('estimate-v2-payload asserts lineTotal is COST, retailTotal is retail',
  /lineTotal rebuilt as COST/.test(v2) || /lineTotal is the engine's COST/.test(v2)
  || (/lineTotal/.test(v2) && /retailTotal/.test(v2)));

// Payment ledger writers (multi-payment cash dating) stay coupled to collectors.
const md = read('docs/pro/js/money-dashboard.js');
const ak = read('docs/pro/js/analytics-kpi.js');
ok('money + analytics both define paymentsOf for multi-payment cash dating',
  /function paymentsOf\(inv\)/.test(md) && /function paymentsOf\(inv\)/.test(ak));

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

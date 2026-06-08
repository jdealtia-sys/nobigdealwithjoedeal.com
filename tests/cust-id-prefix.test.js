/**
 * tests/cust-id-prefix.test.js — per-tenant customer-ID minting helpers.
 *
 * Verifies window._custIdPrefix() / window._custCounterId() in company-profile.js:
 *   - NBD (and any unconfigured/half-configured tenant) → legacy 'customerIds'
 *     counter + 'NBD' prefix (byte-identical, sequence never reset).
 *   - A configured tenant (non-NBD legalName + its own docPrefix, e.g. Oaks 'OAK')
 *     → per-tenant counter 'customerIds_<companyId>' + its own prefix.
 *
 * Zero deps. Evals the browser IIFE in a vm sandbox (same pattern as
 * tenant-brand.test.js). Run: node tests/cust-id-prefix.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

function loadCompanyProfile() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js', 'company-profile.js'), 'utf8');
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const win = { addEventListener() {}, removeEventListener() {}, localStorage };
  win.window = win;
  const sandbox = { window: win, localStorage, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Date, Math, JSON };
  vm.runInNewContext(src, sandbox, { filename: 'company-profile.js' });
  return win;
}

(async () => {
  const win = loadCompanyProfile();
  console.log('CUST-ID PREFIX — helpers exist');
  ok('_custIdPrefix is a function', typeof win._custIdPrefix === 'function');
  ok('_custCounterId is a function', typeof win._custCounterId === 'function');

  console.log('\nNBD (default) — must be byte-identical to legacy');
  ok('NBD prefix = NBD', win._custIdPrefix() === 'NBD');
  ok('NBD counter = legacy "customerIds"', win._custCounterId('1phDvAVXHSg82wDLegAbQFq14Ci1') === 'customerIds');
  ok('NBD counter ignores companyId arg', win._custCounterId('anything-here') === 'customerIds');

  console.log('\nConfigured tenant (Oaks: legalName + docPrefix OAK)');
  await win._saveCompanyProfile({ brand: { legalName: 'Oaks Roofing & Construction', docPrefix: 'OAK' } });
  ok('Oaks prefix = OAK', win._custIdPrefix() === 'OAK');
  ok('Oaks counter = customerIds_oaks', win._custCounterId('oaks') === 'customerIds_oaks');
  ok('Oaks counter lowercases the companyId', win._custCounterId('OAKS') === 'customerIds_oaks');

  console.log('\nHalf-configured tenant (non-NBD legalName, NO docPrefix) → safe NBD fallback');
  await win._saveCompanyProfile({ brand: { legalName: 'Some Other Roofing Co' } });
  ok('no-docPrefix tenant → prefix falls back to NBD', win._custIdPrefix() === 'NBD');
  ok('no-docPrefix tenant → legacy counter (no blank-prefix mint)', win._custCounterId('someco') === 'customerIds');

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('✓ All cust-id-prefix tests passed');
})().catch(e => { console.error('test crashed:', e && (e.stack || e.message)); process.exit(1); });

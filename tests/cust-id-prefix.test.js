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

  // ── Customer-ID salt (defense-in-depth against prefix collision) ──
  console.log('\nCustomer-ID salt + formatter (client)');
  ok('_custIdSalt is a function', typeof win._custIdSalt === 'function');
  ok('_formatCustomerId is a function', typeof win._formatCustomerId === 'function');
  ok('salt is 4 upper-alnum chars', /^[0-9A-Z]{4}$/.test(win._custIdSalt('oaks')));
  ok('salt is deterministic', win._custIdSalt('oaks') === win._custIdSalt('oaks'));
  ok('salt differs per companyId', win._custIdSalt('oaks') !== win._custIdSalt('acme'));

  console.log('\n_formatCustomerId — NBD stays byte-identical (legacy), non-NBD is salted');
  ok('NBD → un-salted NBD-0001', win._formatCustomerId('NBD', 1, 'anything') === 'NBD-0001');
  ok('NBD → un-salted NBD-0042', win._formatCustomerId('NBD', 42, 'anything') === 'NBD-0042');
  ok('OAK → salted OAK-0001-<salt>', win._formatCustomerId('OAK', 1, 'oaks') === 'OAK-0001-' + win._custIdSalt('oaks'));
  ok('salt binds to companyId (same seq+prefix, different company → different ID)',
    win._formatCustomerId('OAK', 1, 'oaks') !== win._formatCustomerId('OAK', 1, 'acme'));

  // ── Client ⇄ server parity — the two mint paths MUST agree byte-for-byte ──
  console.log('\nClient ⇄ server salt parity (functions/customer-id.js)');
  const srv = require('../functions/customer-id');
  ok('salt parity: oaks', win._custIdSalt('oaks') === srv.custIdSalt('oaks'));
  ok('salt parity: a long uid', win._custIdSalt('1phDvAVXHSg82wDLegAbQFq14Ci1') === srv.custIdSalt('1phDvAVXHSg82wDLegAbQFq14Ci1'));
  ok('salt parity: empty', win._custIdSalt('') === srv.custIdSalt(''));
  ok('format parity: NBD-0001', win._formatCustomerId('NBD', 1, 'x') === srv.formatCustomerId('NBD', 1, 'x'));
  ok('format parity: OAK-0007', win._formatCustomerId('OAK', 7, 'oaks') === srv.formatCustomerId('OAK', 7, 'oaks'));

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('✓ All cust-id-prefix tests passed');
})().catch(e => { console.error('test crashed:', e && (e.stack || e.message)); process.exit(1); });

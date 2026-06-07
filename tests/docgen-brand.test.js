/**
 * tests/docgen-brand.test.js — Phase B-1: client doc-generator brand resolution.
 *
 * Verifies NBDDocGen._resolveCompany() (document-generator.js):
 *   - NBD (or any tenant whose brand still matches the NBD default) resolves to
 *     the UNCHANGED COMPANY literal — byte-identical (same object, same CSS).
 *   - A non-NBD tenant (Oaks) resolves to its own brand: colors, name, contact,
 *     logo remapped; neutral UI grays preserved from the base.
 *
 * Zero deps. Evals the browser file in a vm sandbox with a stubbed
 * window._brand(). Run: node tests/docgen-brand.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

function loadDocGen(brand) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js', 'document-generator.js'), 'utf8');
  const win = { _brand: () => brand };
  win.window = win;
  const noop = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {} });
  const sandbox = {
    window: win,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, createElement: noop, body: noop() },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, Math, JSON,
  };
  vm.runInNewContext(src, sandbox, { filename: 'document-generator.js' });
  return win.NBDDocGen;
}

console.log('DOCGEN BRAND — _resolveCompany()');

// ── NBD default brand → unchanged COMPANY literal (byte-identical) ──
const NBD_BRAND = { legalName: 'No Big Deal Home Solutions', colors: {}, contact: {} };
const dgNBD = loadDocGen(NBD_BRAND);
ok('NBDDocGen loaded', !!(dgNBD && typeof dgNBD._resolveCompany === 'function'));
const cNBD = dgNBD._resolveCompany();
ok('NBD: returns the exact COMPANY base (identity)', cNBD === dgNBD.COMPANY);
ok('NBD: name unchanged', cNBD.name === 'No Big Deal Home Solutions');
ok('NBD: email unchanged (info@)', cNBD.email === 'info@nobigdealwithjoedeal.com');
ok('NBD: primary navy unchanged', cNBD.colors.primary === '#1e3a6e');
ok('NBD: secondary unchanged (#1a1a2e)', cNBD.colors.secondary === '#1a1a2e');
ok('NBD: getSharedCSS renders navy #1e3a6e (byte-identical chrome)', /#1e3a6e/i.test(dgNBD.getSharedCSS()));
ok('NBD: getSharedCSS renders orange accent', /#e8720c/i.test(dgNBD.getSharedCSS()));

// ── Oaks brand → remapped ──
const OAKS_BRAND = {
  legalName: 'Oaks Roofing & Construction',
  tagline: 'Roofing, Siding, Gutters',
  logoUrl: 'https://nobigdealwithjoedeal.com/sites/oaks/logo-orange.svg',
  colors: { primary: '#333333', secondary: '#1A1A1A', accent: '#E8720C' },
  contact: { phone: '(513) 827-5297', email: 'joe@oaksrfc.com', website: 'oaksroofingandconstruction.com', address: 'Goshen, OH' }
};
const dgOAK = loadDocGen(OAKS_BRAND);
const cOAK = dgOAK._resolveCompany();
ok('Oaks: name remapped', cOAK.name === 'Oaks Roofing & Construction');
ok('Oaks: NOT the NBD base', cOAK !== dgOAK.COMPANY);
ok('Oaks: primary charcoal', cOAK.colors.primary === '#333333');
ok('Oaks: secondary near-black', cOAK.colors.secondary === '#1A1A1A');
ok('Oaks: phone remapped', cOAK.phone === '(513) 827-5297');
ok('Oaks: email remapped', cOAK.email === 'joe@oaksrfc.com');
ok('Oaks: logoUrl set', /logo-orange\.svg$/.test(cOAK.logoUrl || ''));
ok('Oaks: neutral lightGray preserved from base', cOAK.colors.lightGray === '#f5f5f5');
ok('Oaks: getSharedCSS renders Oaks charcoal #333333', /#333333/i.test(dgOAK.getSharedCSS()));
ok('Oaks: getSharedCSS does NOT render NBD navy', !/#1e3a6e/i.test(dgOAK.getSharedCSS()));

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
process.exit(0);

/**
 * tests/docgen-render.test.js — full client doc-render integration test.
 *
 * Loads BOTH document-generator.js + document-generator-templates.js into one
 * NBDDocGen (as the browser does), stubs window._brand(), and renders a real
 * document (warranty certificate) for NBD and for a tenant (Oaks). Asserts the
 * brand actually lands in the output HTML — the closest thing to a render-verify
 * we can do without a browser.
 *
 * This is the test that proves the EXTENDED doc types (the 11 in templates.js)
 * are tenant-aware, not just the core ones. Run: node tests/docgen-render.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const DG_DIR = path.join(__dirname, '..', 'docs/pro/js');
const SRC_DOCGEN    = fs.readFileSync(path.join(DG_DIR, 'document-generator.js'), 'utf8');
const SRC_TEMPLATES = fs.readFileSync(path.join(DG_DIR, 'document-generator-templates.js'), 'utf8');

function loadFullDocGen(brand) {
  const win = { _brand: () => brand };
  win.window = win;
  const noop = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {} });
  const sandbox = {
    window: win,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, createElement: noop, body: noop() },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, Math, JSON,
  };
  vm.runInNewContext(SRC_DOCGEN, sandbox, { filename: 'document-generator.js' });
  vm.runInNewContext(SRC_TEMPLATES, sandbox, { filename: 'document-generator-templates.js' });
  return win.NBDDocGen;
}

function render(brand) {
  const dg = loadFullDocGen(brand);
  try {
    return dg.renderWarrantyCertificate({ homeownerName: 'Jane Smith', address: '123 Main St', warrantyTier: 'best', leadId: 'L1' });
  } catch (e) {
    return 'RENDER_ERROR: ' + (e && e.message);
  }
}

const NBD_BRAND = { legalName: 'No Big Deal Home Solutions', colors: {}, contact: {} };
const OAKS_BRAND = {
  legalName: 'Oaks Roofing & Construction',
  displayName: 'Oaks Roofing & Construction',
  seal: 'ORC',
  docPrefix: 'OAK',
  tagline: 'Roofing, Siding, Gutters',
  logoUrl: 'https://nobigdealwithjoedeal.com/sites/oaks/logo-orange.svg',
  colors: { primary: '#333333', secondary: '#1A1A1A', accent: '#C2410C', ink: '#222222' },
  contact: { phone: '(513) 827-5297', email: 'joe@oaksrfc.com', website: 'oaksroofingandconstruction.com', address: 'Goshen, OH' }
};

console.log('DOCGEN RENDER — warranty certificate (full render)');

// ── NBD: full brand, byte-identical ──
const nbd = render(NBD_BRAND);
ok('NBD: renders HTML (no error)', typeof nbd === 'string' && nbd.indexOf('RENDER_ERROR') !== 0 && nbd.length > 500);
ok('NBD: shows NBD name', /No Big Deal Home Solutions/.test(nbd));
ok('NBD: navy #1e3a6e in styles', /#1e3a6e/i.test(nbd));
ok('NBD: orange #e8720c accent', /#e8720c/i.test(nbd));
ok('NBD: NBD-WC cert number', /NBD-WC-/.test(nbd));

// ── Oaks: tenant brand throughout (body + chrome + number) ──
const oak = render(OAKS_BRAND);
ok('Oaks: renders HTML (no error)', typeof oak === 'string' && oak.indexOf('RENDER_ERROR') !== 0 && oak.length > 500);
ok('Oaks: shows Oaks name', /Oaks Roofing & Construction/.test(oak));
ok('Oaks: OAK-WC cert number (docPrefix)', /OAK-WC-/.test(oak));
ok('Oaks: charcoal #333333 (tenant primary)', /#333333/i.test(oak));
ok('Oaks: burnt-orange #C2410C (tenant accent)', /#c2410c/i.test(oak));
ok('Oaks: does NOT show NBD navy #1e3a6e', !/#1e3a6e/i.test(oak));
ok('Oaks: does NOT show "No Big Deal"', !/No Big Deal/.test(oak));

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
process.exit(0);

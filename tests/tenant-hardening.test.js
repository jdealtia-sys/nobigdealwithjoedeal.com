/**
 * tests/tenant-hardening.test.js — review M1/L4/L5 hardening guards.
 *
 * These cover the LATENT edge case the brand review flagged: a non-NBD tenant
 * that sets its legalName but leaves identity fields (contact/logo/seal/prefix)
 * unset. Before the fix, the deep-merge onto NBD defaults silently stamped
 * NBD's phone/email/logo/seal onto that tenant's documents, portal, and PDFs.
 * After the fix, an unset identity field comes back BLANK — never NBD's — at
 * every layer:
 *   1. window._brand()      (docs/pro/js/company-profile.js resolver)
 *   2. NBDDocGen._resolveCompany/_logoSrc/_docPrefix (client doc generator)
 *   3. hexToRgb/darken      (functions/render-pdf.js — L5 3-digit, L4 darker)
 * plus _rgba() (L4 client) which must reproduce NBD's hardcoded rgba exactly.
 *
 * Pure string/vm tests — no browser, no emulator. Run: node tests/tenant-hardening.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }
function eq(name, got, want) { ok(name + ' (= ' + JSON.stringify(want) + ', got ' + JSON.stringify(got) + ')', got === want); }

const PRO_JS = path.join(__dirname, '..', 'docs/pro/js');
const SRC_PROFILE  = fs.readFileSync(path.join(PRO_JS, 'company-profile.js'), 'utf8');
const SRC_DOCGEN   = fs.readFileSync(path.join(PRO_JS, 'document-generator.js'), 'utf8');
const SRC_RENDER   = fs.readFileSync(path.join(__dirname, '..', 'functions/render-pdf.js'), 'utf8');

// ════════════════════════════════════════════════════════════════════
// 1. company-profile.js — window._brand() does not inherit NBD identity
// ════════════════════════════════════════════════════════════════════
// Load the IIFE with a localStorage cache holding a PARTIAL tenant brand
// (legalName + accent only). The cache-hydrate path populates both
// _companyProfile and the raw override _brandOverrideRaw, exactly as a real
// Firestore load would. No window.db, so no network load is attempted.
function loadProfile(cacheObj) {
  const win = {};
  win.window = win;
  const store = {};
  if (cacheObj) store['nbd_company_profile_v1'] = JSON.stringify(cacheObj);
  const sandbox = {
    window: win,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, JSON,
  };
  vm.runInNewContext(SRC_PROFILE, sandbox, { filename: 'company-profile.js' });
  return win;
}

console.log('M1 — company-profile.js resolver (under-configured tenant)');
const underCache = { brand: { legalName: 'Oaks Roofing & Construction', colors: { accent: '#C2410C' } } };
const w = loadProfile(underCache);
const b = w._brand();
eq('tenant legalName preserved', b.legalName, 'Oaks Roofing & Construction');
eq('displayName derives from legalName (not "No Big Deal")', b.displayName, 'Oaks Roofing & Construction');
eq('phone blanked (not NBD)', b.contact.phone, '');
eq('email blanked (not NBD)', b.contact.email, '');
eq('website blanked', b.contact.website, '');
eq('alertEmail blanked (no lead bleed to Joe)', b.contact.alertEmail, '');
eq('alertSms blanked', b.contact.alertSms, '');
eq('logoUrl blanked (not NBD logo)', b.logoUrl, '');
eq('seal blanked (not "NBD")', b.seal, '');
eq('docPrefix blanked (not "NBD")', b.docPrefix, '');
eq('tagline blanked (not NBD tagline)', b.tagline, '');
eq('smsSignOff blanked (not "Joe from...")', b.smsSignOff, '');
eq('tenant accent kept', b.colors.accent, '#C2410C');
ok('_brandOverride() exposes RAW (no contact key)', w._brandOverride() && w._brandOverride().legalName === 'Oaks Roofing & Construction' && !w._brandOverride().contact);

console.log('\nNBD — byte-identical (no override)');
const wn = loadProfile(null);
const bn = wn._brand();
eq('NBD legalName', bn.legalName, 'No Big Deal Home Solutions');
eq('NBD phone intact', bn.contact.phone, '(859) 420-7382');
eq('NBD seal intact', bn.seal, 'NBD');
eq('NBD docPrefix intact', bn.docPrefix, 'NBD');
eq('NBD logoUrl intact', bn.logoUrl, 'https://nobigdealwithjoedeal.com/assets/images/nbd-logo.png');
eq('NBD _brandOverride() is null', wn._brandOverride(), null);

// ════════════════════════════════════════════════════════════════════
// 2. document-generator.js — _resolveCompany / _logoSrc / _docPrefix / _rgba
// ════════════════════════════════════════════════════════════════════
function loadDocGen(brand) {
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
  return win.NBDDocGen;
}

console.log('\nM1 — document-generator.js (under-configured tenant)');
// The shape window._brand() now returns for an under-configured tenant.
const UNDER = {
  legalName: 'Oaks Roofing & Construction', displayName: 'Oaks Roofing & Construction',
  seal: '', docPrefix: '', tagline: '', smsSignOff: '', logoUrl: '',
  colors: { accent: '#C2410C' },
  contact: { phone: '', email: '', website: '', address: '', alertEmail: '', alertSms: '' },
};
const dgU = loadDocGen(UNDER);
const rc = dgU._resolveCompany();
eq('_resolveCompany phone blank (not NBD)', rc.phone, '');
eq('_resolveCompany email blank (not NBD)', rc.email, '');
eq('_resolveCompany website blank (not NBD)', rc.website, '');
eq('_logoSrc blank (not NBD logo)', dgU._logoSrc(), '');
eq('_docPrefix blank (not "NBD")', dgU._docPrefix(), '');

console.log('\nNBD — document-generator.js byte-identical');
const dgN = loadDocGen({ legalName: 'No Big Deal Home Solutions' });
ok('_resolveCompany returns base COMPANY', dgN._resolveCompany() === dgN.COMPANY);
ok('_logoSrc returns NBD logo', /nbd-logo/.test(dgN._logoSrc()));
eq('_docPrefix is NBD', dgN._docPrefix(), 'NBD');

console.log('\nL4/L5 — _rgba() helper');
eq('NBD accent byte-identical (.04)', dgN._rgba('#e8720c', '.04'), 'rgba(232,114,12,.04)');
eq('NBD accent byte-identical (0)', dgN._rgba('#e8720c', '0'), 'rgba(232,114,12,0)');
eq('tenant accent', dgN._rgba('#C2410C', '.05'), 'rgba(194,65,12,.05)');
eq('3-digit shorthand (L5)', dgN._rgba('#fc0', '.05'), 'rgba(255,204,0,.05)');

// ════════════════════════════════════════════════════════════════════
// 3. render-pdf.js — hexToRgb (L5 3-digit) + darken (L4) extracted + eval'd
// ════════════════════════════════════════════════════════════════════
// These are pure top-level functions with no deps; slice them out of the
// module source (between `function hexToRgb` and `function buildBrandVars`)
// and eval in isolation so we don't have to init firebase-admin.
console.log('\nL5/L4 — render-pdf.js hexToRgb + darken');
const start = SRC_RENDER.indexOf('function hexToRgb');
const end = SRC_RENDER.indexOf('function buildBrandVars');
ok('located hexToRgb..buildBrandVars block', start >= 0 && end > start);
const block = SRC_RENDER.slice(start, end);
const sb = {};
vm.runInNewContext(block + '\nthis.hexToRgb = hexToRgb; this.darken = darken;', sb, { filename: 'render-pdf-extract.js' });
eq('hexToRgb 6-digit', sb.hexToRgb('#C2410C'), '194, 65, 12');
eq('hexToRgb 3-digit (L5)', sb.hexToRgb('#fc0'), '255, 204, 0');
eq('hexToRgb bad input → null', sb.hexToRgb('nope'), null);
ok('darken returns a darker hex (L4)', /^#[0-9a-f]{6}$/i.test(sb.darken('#C2410C', 0.15)) && sb.darken('#C2410C', 0.15) !== '#C2410C');

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
process.exit(0);

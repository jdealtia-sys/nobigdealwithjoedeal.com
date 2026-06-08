/**
 * tests/tenant-brand.test.js — TenantContext backbone (Phase A, 2026-06-07).
 *
 * Verifies the per-tenant brand resolver added to company-profile.js:
 *   - NBD canonical brand ships as the defaults (window._brand()).
 *   - window._tenant() returns the fuller context ({companyId, brand, profile}).
 *   - A tenant's companyProfile.brand override deep-merges on top: COSMETIC
 *     fields the tenant didn't set inherit NBD defaults, but IDENTITY fields
 *     (name/contact/logo/seal/prefix) blank out instead of inheriting NBD's —
 *     so NBD stays byte-identical yet NBD's identity never bleeds onto another
 *     tenant (review M1). _brandOverride() exposes the raw un-merged override.
 *
 * Zero deps. Evals the browser IIFE in a vm sandbox (same pattern as
 * customer-portal-logic.test.js). Run: node tests/tenant-brand.test.js
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
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const win = { addEventListener() {}, removeEventListener() {}, localStorage };
  win.window = win;
  const sandbox = {
    window: win,
    localStorage,
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, Math, JSON,
  };
  vm.runInNewContext(src, sandbox, { filename: 'company-profile.js' });
  return win;
}

(async () => {
  const win = loadCompanyProfile();

  console.log('TENANTCONTEXT — brand schema + resolver');
  ok('brand block exists on defaults', !!(win.NBD_COMPANY_PROFILE_DEFAULTS && win.NBD_COMPANY_PROFILE_DEFAULTS.brand));
  ok('_brand() is a function', typeof win._brand === 'function');
  ok('_tenant() is a function', typeof win._tenant === 'function');

  const b = win._brand();
  ok('NBD accent = canonical orange #E8720C', b.colors.accent === '#E8720C');
  ok('NBD primary = navy #1E3A6E', b.colors.primary === '#1E3A6E');
  ok('NBD legalName', b.legalName === 'No Big Deal Home Solutions');
  ok('NBD displayName', b.displayName === 'No Big Deal');
  ok('NBD seal', b.seal === 'NBD');
  ok('NBD docPrefix', b.docPrefix === 'NBD');
  ok('NBD logo url points at nbd-logo.png', /nbd-logo\.png$/.test(b.logoUrl || ''));
  ok('NBD contact phone', b.contact.phone === '(859) 420-7382');
  ok('NBD alert SMS hook', b.contact.alertSms === '+18594207382');
  ok('NBD doc fonts (Barlow)', b.fonts.docDisplay === 'Barlow Condensed' && b.fonts.docBody === 'Barlow');
  ok('NBD smsSignOff', b.smsSignOff === 'Joe from No Big Deal Roofing');

  console.log('\nTENANTCONTEXT — _tenant() shape');
  const t = win._tenant();
  ok('_tenant returns brand + profile', !!(t.brand && t.profile));
  ok('_tenant.brand === _brand()', t.brand === win._brand());
  ok('_tenant.companyId null before auth', t.companyId === null);

  console.log('\nTENANTCONTEXT — tenant override (cosmetic inherits, identity does NOT — M1)');
  await win._saveCompanyProfile({
    brand: {
      legalName: 'Oaks Roofing & Construction',
      docPrefix: 'OAK',
      colors: { accent: '#E8720C', primary: '#333333', secondary: '#1A1A1A' }
    }
  });
  const ob = win._brand();
  ok('override: legalName replaced', ob.legalName === 'Oaks Roofing & Construction');
  ok('override: docPrefix replaced', ob.docPrefix === 'OAK');
  ok('override: primary replaced (charcoal)', ob.colors.primary === '#333333');
  ok('override: ink (cosmetic) still inherits NBD default', ob.colors.ink === '#14181F');
  // Identity fields the tenant did NOT set must NOT inherit NBD's — they blank
  // out so NBD's name/phone never bleed onto another company (review M1).
  ok('override: displayName derives from legalName (NOT "No Big Deal")', ob.displayName === 'Oaks Roofing & Construction');
  ok('override: phone blanked (NOT NBD\'s number)', ob.contact.phone === '');
  ok('override: logoUrl blanked (NOT NBD\'s logo)', ob.logoUrl === '');
  ok('override: seal blanked (NOT "NBD")', ob.seal === '');
  ok('override: _brandOverride() returns the raw un-merged override', win._brandOverride() && win._brandOverride().legalName === 'Oaks Roofing & Construction' && !win._brandOverride().contact);

  console.log('\n──────────────────────────────────────────────────');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
  process.exit(0);
})();

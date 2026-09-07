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
  // NBD DOCUMENT STANDARD, locked 2026-09-07 — palette re-measured off the
  // master logo artwork. #E8720C also failed WCAG AA on white (3.07:1).
  ok('NBD accent = canonical orange #BD5728', b.colors.accent === '#BD5728');
  ok('NBD primary = navy #1A3057', b.colors.primary === '#1A3057');
  ok('NBD legalName', b.legalName === 'No Big Deal Home Solutions');
  ok('NBD displayName', b.displayName === 'No Big Deal');
  ok('NBD seal', b.seal === 'NBD');
  ok('NBD docPrefix', b.docPrefix === 'NBD');
  ok('NBD logo url points at nbd-logo.png', /nbd-logo\.png$/.test(b.logoUrl || ''));
  ok('NBD contact phone', b.contact.phone === '(859) 420-7382');
  ok('NBD alert SMS hook', b.contact.alertSms === '+18594207382');
  // Document faces are Montserrat over Lato per the standard. These two tokens
  // were previously declared but consumed nowhere — printCSS() now reads them,
  // so this assertion guards something real rather than a dead default.
  ok('NBD doc fonts (Montserrat/Lato)', b.fonts.docDisplay === 'Montserrat' && b.fonts.docBody === 'Lato');
  ok('NBD smsSignOff', b.smsSignOff === 'Joe from No Big Deal Roofing');
  // NBD itself DOES carry its credentials — the blanking above must not be so
  // aggressive that the real owner loses their own badges.
  ok('NBD carries its own affiliate credentials',
    Array.isArray(b.affiliates) && b.affiliates.length === 2 &&
    b.affiliates.some(a => a.name === 'GAF Certified'   && a.number === '#1162011') &&
    b.affiliates.some(a => a.name === 'TAMKO Pro Gold'  && a.number === '#181382'));

  // Phase C step 1 — contact.slackWebhook + integrations{} schema on the tenant doc.
  ok('NBD contact.slackWebhook field present', 'slackWebhook' in b.contact);
  ok('NBD integrations block present', !!b.integrations);
  ok('NBD integrations.resendDomain', b.integrations.resendDomain === 'nobigdealwithjoedeal.com');
  ok('NBD integrations has twilioNumber/reviewUrl/calLink keys',
    ['twilioNumber','reviewUrl','calLink'].every(k => k in b.integrations));

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
  // AFFILIATES ARE A CREDENTIAL CLAIM, NOT COSMETIC STYLING (NBD Document
  // Standard section 5). Colours and fonts may inherit — a GAF or TAMKO
  // licence number may NOT. Left to deep-merge, a stranger tenant's signed
  // contract would print NBD's GAF #1162011 as though it were their own
  // certification. This is the assertion that stops that, and it is why
  // 'affiliates' sits in _IDENTITY_TOP rather than in the cosmetic bucket.
  ok('override: affiliates blanked (NOT NBD\'s GAF/TAMKO credentials)',
    !(Array.isArray(ob.affiliates) && ob.affiliates.length));
  ok('override: no NBD licence number anywhere in the resolved brand',
    !/1162011|181382/.test(JSON.stringify(ob)));
  ok('override: _brandOverride() returns the raw un-merged override', win._brandOverride() && win._brandOverride().legalName === 'Oaks Roofing & Construction' && !win._brandOverride().contact);

  console.log('\n──────────────────────────────────────────────────');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
  process.exit(0);
})();

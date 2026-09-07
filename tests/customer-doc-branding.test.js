/**
 * CUSTOMER DOCUMENT BRANDING — the company's name, never the product's.
 *
 * "PRO" is the name of the SaaS platform. It is correct in the app chrome and
 * WRONG on a document a homeowner or adjuster receives, who know the
 * contractor and have never heard of the software.
 *
 * This suite exists because the bug it guards shipped with a comment
 * describing the correct behaviour sitting directly above code that did the
 * opposite: brandHeaderHtml() claimed "for a tenant the .pro accent span is
 * dropped" while appending " PRO" in BOTH branches. Every tenant's estimates
 * and insurance scopes went out reading "<Their Company> PRO". A comment is
 * not a guarantee; this is.
 *
 * Also pins that a tenant never inherits NBD's logo — a document with no logo
 * is fine, a document wearing someone else's logo is not.
 *
 * Run: node tests/customer-doc-branding.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/estimate-finalization.js'), 'utf8');
const NBD_LOGO = 'data:image/png;base64,NBDLOGOSTUB';

function loadFin(brand, logoSrc) {
  const win = {};
  win.window = win;
  if (brand !== undefined) win._brand = () => brand;
  if (logoSrc !== undefined) win._brandLogoSrc = () => logoSrc;
  const sandbox = { window: win, console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Set };
  vm.runInNewContext(SRC, sandbox, { filename: 'estimate-finalization.js' });
  return win.EstimateFinalization;
}

// resolveBrand + brandHeaderHtml are module-private, so exercise them through
// the public surface the documents actually render: BASE_CSS for the styles,
// and a real formatted estimate for the header markup.
const FIXTURE = {
  estimate: {
    total: 1000, subtotal: 900, materialRetail: 400, laborCost: 300,
    materialCost: 350, hardCost: 650, overhead: 50, profit: 50,
    overheadPct: 0.10, profitPct: 0.10, taxRate: 0.07, tax: 70,
    tier: 'better', mode: 'retail', minJobApplied: false,
    internal: { margin: 350, marginPct: 35 },
    lines: [{ code: 'RFG-01', name: 'Shingles', category: 'roofing', quantity: 1, unit: 'SQ',
      materialCostPerUnit: 100, laborCostPerUnit: 50, lineTotal: 150, codeRefs: {} }],
  },
  meta: {
    customer: { name: 'Jane Homeowner', address: '1 Main St', phone: '513-555-0100', email: 'j@e.com' },
    estimateNumber: 'TEST-1',
  },
};

// formatEstimate(estimate, format, meta) -> { html, ... }
function headerOf(brand, logoSrc, format) {
  const EF = loadFin(brand, logoSrc);
  try {
    const res = EF.formatEstimate(FIXTURE.estimate, format || 'retail-quote', FIXTURE.meta);
    return String((res && res.html) || '');
  } catch (e) { return 'RENDER_ERROR: ' + e.message; }
}
// A negative assertion against an empty or errored string passes for the wrong
// reason. Every "does NOT contain" check below is gated on the document having
// actually rendered, so a broken harness fails loudly instead of going green.
function rendered(s) {
  return typeof s === 'string' && s.indexOf('RENDER_ERROR') !== 0 && s.length > 400;
}

console.log('CUSTOMER DOC BRANDING — NBD');
const nbd = headerOf(undefined, NBD_LOGO);
ok('NBD document renders', rendered(nbd));
if (rendered(nbd)) {
  ok('carries the COMPANY name', /No Big Deal Home Solutions/.test(nbd));
  // The product name must not appear as a brand suffix. Checked as the exact
  // markup that shipped plus a looser word-boundary sweep of the header block.
  ok('does NOT append " PRO" to the brand', !/<span class="pro">\s*PRO<\/span>/i.test(nbd));
  ok('no bare " PRO" anywhere in the document', !/\bNo Big Deal\s+PRO\b/i.test(nbd));
  ok('embeds the logo when one resolves', nbd.indexOf(NBD_LOGO) !== -1);
  ok('logo is an <img>, not a text wordmark', /class="brand-logo-img"/.test(nbd));
}

console.log('\nCUSTOMER DOC BRANDING — tenant (Oaks)');
const OAKS = { legalName: 'Oaks Roofing & Construction', displayName: 'Oaks Roofing & Construction',
  seal: 'ORC', docPrefix: 'OAK', colors: { accent: '#C2410C' }, contact: {} };
const oak = headerOf(OAKS, '');   // tenant with no logo of its own
ok('tenant document renders', rendered(oak));
if (rendered(oak)) {
  ok('carries the TENANT name', /Oaks Roofing/.test(oak));
  ok('tenant does NOT get " PRO" appended', !/<span class="pro">\s*PRO<\/span>/i.test(oak));
  ok('tenant does NOT leak "No Big Deal"', !/No Big Deal/.test(oak));
  // The one that matters most: an unset tenant logo must render NOTHING, not
  // NBD's artwork. _brandLogoSrc returns '' and the renderer omits the <img>.
  ok('tenant does NOT inherit the NBD logo', oak.indexOf(NBD_LOGO) === -1);
  ok('no empty <img> when there is no logo', !/class="brand-logo-img" src=""/.test(oak));
}

console.log('\nCUSTOMER DOC BRANDING — document typography');
const EF = loadFin(undefined, NBD_LOGO);
const css = String(EF.BASE_CSS || '');
ok('BASE_CSS uses the standard display face', /Montserrat/.test(css));
ok('BASE_CSS uses the standard body face', /Lato/.test(css));
ok('BASE_CSS has dropped the retired Barlow faces', !/Barlow/.test(css));
// Neither face is a system font: without a stack a machine missing them
// silently renders the document in Times.
ok('display face carries a fallback stack', /'Montserrat',\s*'Segoe UI'/.test(css));
ok('body face carries a fallback stack', /'Lato',\s*'Segoe UI'/.test(css));

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
process.exit(0);

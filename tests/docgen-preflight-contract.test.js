/**
 * tests/docgen-preflight-contract.test.js — DocPreflight ↔ renderer contract.
 *
 * The REAL document path is: rep fills the DocPreflight modal -> submit() builds
 * mergedData keyed by each schema field's `key` -> hydrateDerivedFields() adds
 * aliases -> NBDDocGen.generate(type, mergedData) -> renderer. A 2026-06-25 audit
 * found the modal and the renderers had grown divergent key vocabularies, so
 * rep-entered values were silently dropped (e.g. modal "Carrier" = insCarrier but
 * the supplement renderer reads insuranceCompany; payment modal collects
 * payment1Amount but the renderer reads depositAmount; financing collects jobTotal
 * but the renderer reads totalPrice). hydrateDerivedFields now BRIDGES those keys.
 *
 * This test reproduces that exact path: it loads doc-preflight.js (for the real
 * hydrateDerivedFields) + both generator files (for the real renderers) into one
 * sandbox, feeds data under the PREFLIGHT keys a rep would actually enter, hydrates,
 * renders, and asserts the rep's distinctive value reaches the output HTML (and the
 * old fabricated default does not). The existing docgen-render.test.js feeds RENDERER
 * keys, so it cannot catch this drift — this is its companion.
 *
 * Run: node tests/docgen-preflight-contract.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const DG_DIR = path.join(__dirname, '..', 'docs/pro/js');
const SRC_PREFLIGHT = fs.readFileSync(path.join(DG_DIR, 'doc-preflight.js'), 'utf8');
const SRC_DOCGEN    = fs.readFileSync(path.join(DG_DIR, 'document-generator.js'), 'utf8');
const SRC_TEMPLATES = fs.readFileSync(path.join(DG_DIR, 'document-generator-templates.js'), 'utf8');

// One sandbox holding the real hydrateDerivedFields + the real renderers, wired
// as the browser wires them. Brand stub mirrors docgen-render.test.js.
function loadEnv() {
  const brand = { legalName: 'No Big Deal Home Solutions', colors: {}, contact: {} };
  const win = { _brand: () => brand };
  win.window = win;
  const noop = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {} } });
  const sandbox = {
    window: win,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, createElement: noop, head: noop(), body: noop() },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, Math, JSON,
  };
  vm.runInNewContext(SRC_DOCGEN, sandbox, { filename: 'document-generator.js' });
  vm.runInNewContext(SRC_TEMPLATES, sandbox, { filename: 'document-generator-templates.js' });
  vm.runInNewContext(SRC_PREFLIGHT, sandbox, { filename: 'doc-preflight.js' });
  return { dg: win.NBDDocGen, hydrate: win.DocPreflight && win.DocPreflight._hydrateDerivedFields };
}

const env = loadEnv();
ok('env: NBDDocGen loaded', !!env.dg);
ok('env: DocPreflight._hydrateDerivedFields exposed', typeof env.hydrate === 'function');

// Feed PREFLIGHT-keyed data through the real hydrate, then the real renderer.
function renderViaPreflight(method, preflightData) {
  const data = Object.assign({ homeownerName: 'Jane Smith', address: '123 Main St', leadId: 'L1' }, preflightData);
  try {
    env.hydrate(data);
    const html = env.dg[method](data);
    return (typeof html === 'string') ? html : 'RENDER_ERROR: non-string';
  } catch (e) {
    return 'RENDER_ERROR: ' + (e && e.message);
  }
}

// ── payment_agreement: modal keys totalPrice/payment{1,2}Amount/payment{1,2}Date
//    bridge to renderer keys totalAmount/deposit*/progress* ──
{
  const html = renderViaPreflight('renderPaymentAgreement', {
    totalPrice: 27345, payment1Amount: 9000, payment1Date: '2026-07-01',
    payment2Amount: 8000, payment2Date: '2026-08-01',
  });
  console.log('PREFLIGHT CONTRACT — payment_agreement');
  ok('payment: renders (no error)', html.indexOf('RENDER_ERROR') !== 0);
  ok('payment: rep total $27,345 reaches doc (totalPrice→totalAmount)', /27,345/.test(html));
  ok('payment: rep deposit $9,000 reaches doc (payment1Amount→depositAmount)', /9,000/.test(html));
  ok('payment: rep deposit date reaches doc (payment1Date→depositDue)', /2026-07-01/.test(html));
  ok('payment: rep progress $8,000 reaches doc (payment2Amount→progressAmount)', /8,000/.test(html));
  ok('payment: rep progress date reaches doc (payment2Date→progressDue)', /2026-08-01/.test(html));
}

// ── financing_options: modal jobTotal bridges to renderer totalPrice (+ parse strip) ──
{
  const html = renderViaPreflight('renderFinancingOptions', { jobTotal: 33210 });
  console.log('PREFLIGHT CONTRACT — financing_options');
  ok('financing: renders (no error)', html.indexOf('RENDER_ERROR') !== 0);
  ok('financing: rep job total $33,210 reaches doc (jobTotal→totalPrice)', /33,210/.test(html));
  ok('financing: fabricated $10,000 default is GONE', !/10,000/.test(html));
}

// ── change_order: modal changeDescription bridges to renderer changesDescription ──
{
  const SENT = 'SENTINELchangedescXYZ';
  const html = renderViaPreflight('renderChangeOrder', { changeDescription: SENT, originalTotal: 12000, changeAmount: 1500, newTotal: 13500 });
  console.log('PREFLIGHT CONTRACT — change_order');
  ok('change_order: renders (no error)', html.indexOf('RENDER_ERROR') !== 0);
  ok('change_order: rep change description reaches doc (changeDescription→changesDescription)', html.indexOf(SENT) !== -1);
}

// ── supplement_request: modal insCarrier bridges to renderer insuranceCompany;
//    supplementItems arrive as {description,rate} (estimate shape, not normalized)
//    and must not render blank rows / $0 prices ──
{
  const html = renderViaPreflight('renderSupplementRequest', {
    insCarrier: 'Acme Mutual Insurance', claimNumber: 'CLM-77',
    supplementItems: [{ description: 'Ridge cap replacement', qty: 120, unit: 'LF', rate: 5.5 }],
  });
  console.log('PREFLIGHT CONTRACT — supplement_request');
  ok('supplement: renders (no error)', html.indexOf('RENDER_ERROR') !== 0);
  ok('supplement: rep carrier reaches doc (insCarrier→insuranceCompany)', /Acme Mutual Insurance/.test(html));
  ok('supplement: "[Insurance Company]" placeholder is GONE', !/\[Insurance Company\]/.test(html));
  ok('supplement: line-item description reaches doc (i.description shape)', /Ridge cap replacement/.test(html));
  ok('supplement: line-item price reaches doc, not $0 (i.rate shape)', /5\.50/.test(html) && /660\.00/.test(html));
}

// ── invoice: lineItems are normalized to {description,unitPrice}; the renderer
//    historically read i.rate and priced every row at $0 ──
{
  const html = renderViaPreflight('renderInvoice', {
    lineItems: [{ description: 'Tear off and replace shingles', qty: 30, unit: 'SQ', rate: 50 }],
  });
  console.log('PREFLIGHT CONTRACT — invoice');
  ok('invoice: renders (no error)', html.indexOf('RENDER_ERROR') !== 0);
  ok('invoice: line-item description reaches doc', /Tear off and replace shingles/.test(html));
  ok('invoice: line-item unit price reaches doc (normalized unitPrice, not $0)', /50\.00/.test(html));
  ok('invoice: line amount + subtotal total correctly (30 x 50 = 1,500)', /1,500/.test(html));
}

// ── warranty_certificate: modal installDate bridges to renderer issueDate ──
{
  const html = renderViaPreflight('renderWarrantyCertificate', { installDate: '2026-09-15', warrantyTier: 'best' });
  console.log('PREFLIGHT CONTRACT — warranty_certificate');
  ok('warranty: renders (no error)', html.indexOf('RENDER_ERROR') !== 0);
  ok('warranty: rep install date reaches doc (installDate→issueDate)', /2026-09-15/.test(html));
}

// ── certificate_of_completion: modal scopeCompleted bridges to renderer scopeSummary ──
{
  const SENT = 'SENTINELscopedoneABC';
  const html = renderViaPreflight('renderCertificateOfCompletion', { scopeCompleted: SENT, completionDate: '2026-09-20' });
  console.log('PREFLIGHT CONTRACT — certificate_of_completion');
  ok('cert: renders (no error)', html.indexOf('RENDER_ERROR') !== 0);
  ok('cert: rep scope reaches doc (scopeCompleted→scopeSummary)', html.indexOf(SENT) !== -1);
}

// ── scope_of_work: modal projectScope/timeline bridge to projectDescription/estimatedTimeline ──
{
  const html = renderViaPreflight('renderScopeOfWork', { projectScope: 'SENTINELprojscope', timeline: 'SENTINELtimeline99' });
  console.log('PREFLIGHT CONTRACT — scope_of_work');
  ok('scope: renders (no error)', html.indexOf('RENDER_ERROR') !== 0);
  ok('scope: rep project scope reaches doc (projectScope→projectDescription)', html.indexOf('SENTINELprojscope') !== -1);
  ok('scope: rep timeline reaches doc (timeline→estimatedTimeline)', html.indexOf('SENTINELtimeline99') !== -1);
}

// ── before_after_report: modal projectDescription bridges to renderer workDescription ──
{
  const html = renderViaPreflight('renderBeforeAfterReport', { projectDescription: 'SENTINELbadesc' });
  console.log('PREFLIGHT CONTRACT — before_after_report');
  ok('before_after: renders (no error)', html.indexOf('RENDER_ERROR') !== 0);
  ok('before_after: rep description reaches doc (projectDescription→workDescription)', html.indexOf('SENTINELbadesc') !== -1);
}

// ── inspectionInsurance: modal estimatedRepairCost bridges to renderer {{totalPrice}};
//    damageNotes/scopeItems/photos now render; fabricated damage table is gone ──
{
  const html = renderViaPreflight('renderInspectionInsurance', {
    estimatedRepairCost: 44556, claimNumber: 'CLM-99', damageType: 'Hail',
    damageNotes: 'SENTINELdamagenotes', scopeItems: ['SENTINELscopeitem1', 'SENTINELscopeitem2'],
  });
  console.log('PREFLIGHT CONTRACT — inspectionInsurance');
  ok('insIns: renders (no error)', html.indexOf('RENDER_ERROR') !== 0);
  ok('insIns: rep repair cost reaches doc (estimatedRepairCost→totalPrice)', /44,556/.test(html));
  ok('insIns: rep damage notes reach doc (damageNotes wired)', html.indexOf('SENTINELdamagenotes') !== -1);
  ok('insIns: rep scope items reach doc (scopeItems wired)', html.indexOf('SENTINELscopeitem1') !== -1 && html.indexOf('SENTINELscopeitem2') !== -1);
  ok('insIns: fabricated "North Slope ~400 sq ft" damage table is GONE', !/North Slope/.test(html) && !/400 sq ft/.test(html));
  ok('insIns: hardcoded 7-item restoration scope is GONE', !/Remove all damaged roofing materials/.test(html));
}

// ── inspectionHomeowner: rep condition notes / recommendations / property
//    details render; fabricated $11,500 recs + [object Object] + uncollected
//    siding/windows assessments are gone ──
{
  const html = renderViaPreflight('renderInspectionHomeowner', {
    overallDescription: 'SENTINELoverall', roofCondition: 'SENTINELroofcond',
    gutterCondition: 'SENTINELguttercond', recommendationsNote: 'SENTINELrecnote',
    roofType: 'Architectural asphalt', roofAge: 12, squareFootage: 2400,
  });
  console.log('PREFLIGHT CONTRACT — inspectionHomeowner');
  ok('insHome: renders (no error)', html.indexOf('RENDER_ERROR') !== 0);
  ok('insHome: rep overall + roof + gutter notes reach doc', html.indexOf('SENTINELoverall') !== -1 && html.indexOf('SENTINELroofcond') !== -1 && html.indexOf('SENTINELguttercond') !== -1);
  ok('insHome: rep recommendations note reaches doc (not a fabricated table)', html.indexOf('SENTINELrecnote') !== -1);
  ok('insHome: rep roof type / age / sqft reach doc', /Architectural asphalt/.test(html) && /12 years/.test(html) && /2400 sq ft/.test(html));
  ok('insHome: fabricated $11,500 recommendation table is GONE', !/11,500/.test(html));
  ok('insHome: no "[object Object]" condition rendering', !/\[object Object\]/.test(html));
  ok('insHome: uncollected "Vinyl siding"/"Windows in good condition" assessments are GONE', !/Vinyl siding/.test(html) && !/Windows in good condition/.test(html));
}

console.log('\n──────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
process.exit(0);

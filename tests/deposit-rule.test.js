/**
 * tests/deposit-rule.test.js — ONE deposit rule, and every surface prints it.
 *
 * Jo's rule (2026-09-25): cash under $2,000 no deposit; cash $2,000+ 50% at
 * signing, balance on completion; insurance the deductible + the ACV payment
 * (the carrier's first check) up front when possible, the deductible the
 * minimum and never waived / reduced. Before this suite the app answered five
 * ways at once: V2's on-screen Retail Quote fell back to 50/50, the server
 * Retail Quote PDF hard-coded "25% at contract signing", invoices defaulted to
 * 50%, insurance quotes printed $0, the contract said "Fifty percent (50%)",
 * and Job Templates saved no deposit (so a $555 repair invoiced a 50% one).
 *
 * TABLE-DRIVEN, THROUGH THE REAL CODE. Every case below is run through:
 *   A. RULE          docs/pro/js/deposit-rule.js compute()
 *   B. V2 BUILDER    the real estimate-v2-ui.js: a saved doc rehydrated and
 *                    re-stamped by effectiveEstimate() (live claim fields)
 *   C. ON-SCREEN     the real estimate-finalization.js Retail / Single Quote
 *   D. SERVER PDF    V2's real _buildEstimatePayload, compiled through the
 *                    REAL functions/print/templates/estimate.hbs + helpers
 *   E. SAVE          V2's real _buildSavePayload (deposit + depositPlan)
 *   F. INVOICE       the real invoice-pipeline.js createInvoiceFromEstimate
 *   G. PORTAL        functions/deposit-plan-view.js on the saved doc, then the
 *                    real estimate-view.js render and portal.js's card snippet
 *   H. CONTRACT      the real doc-preflight.js → document-generator.js server
 *                    payload, compiled through the REAL contract.hbs
 *   I. CLOSE BOARD   the real close-board.js deal page
 *   J. JOB TEMPLATES the real job-templates.js payload
 *   K. ENGINE        estimate-builder-v2.js calcDeposit (classic delegates here)
 * The expected figures are written out by hand — never computed by the rule —
 * so a broken rule reddens every surface at once.
 *
 * Needs functions/ deps (handlebars) like estimate-v2-payload.test.js; fails,
 * not skips, without them.
 *
 * Run: node tests/deposit-rule.test.js   (DEPOSIT_VERBOSE=1 for ✓ lines)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; if (process.env.DEPOSIT_VERBOSE) console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
function section(name) { console.log('\n' + name); }
const cents = (d) => Math.round(Number(String(d).replace(/[$,]/g, '')) * 100);
const stripTags = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ════════════════════════════════════════════════════════════════════
// Sandbox — the minimal fake DOM the upgrades / honest-paperwork suites use.
// ════════════════════════════════════════════════════════════════════
function makeSandbox(extraWin) {
  const byId = {};
  const listeners = {};
  function el(tag) {
    const classes = new Set();
    return {
      tagName: String(tag || 'div').toUpperCase(), id: '', innerHTML: '', textContent: '', value: '',
      style: {}, dataset: {}, disabled: false, firstChild: null,
      classList: {
        add(c) { classes.add(c); }, remove(c) { classes.delete(c); }, contains(c) { return classes.has(c); },
        toggle(c, on) { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
      },
      appendChild(ch) { if (ch && ch.id) byId[ch.id] = ch; return ch; },
      setAttribute() {}, getAttribute() { return null; }, addEventListener() {}, removeEventListener() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
      focus() {}, setSelectionRange() {}, remove() {},
    };
  }
  const document = {
    head: el('head'), body: el('body'), createElement: el,
    getElementById(id) {
      if (byId[id]) return byId[id];
      const e = el('div'); e.id = id; byId[id] = e; return e;
    },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
  };
  const store = {};
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; },
  };
  const win = Object.assign({ localStorage, document }, extraWin || {});
  win.window = win;
  const sandbox = {
    window: win, document, localStorage, navigator: { userAgent: 'node' },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Promise,
    CSS: { escape: (s) => String(s) }, location: { origin: 'https://example.test', pathname: '/pro/dashboard' },
    URL, URLSearchParams,
  };
  vm.createContext(sandbox);
  return { win, sandbox, byId, listeners };
}
function load(env, rel) {
  vm.runInContext(read(rel), env.sandbox, { filename: path.basename(rel) });
}

// The real dashboard load order for these files (deposit-rule.js is eager
// right after estimate-config.js; the rest ride the `estimates` bundle).
const STACK = [
  'docs/pro/js/estimate-config.js',
  'docs/pro/js/deposit-rule.js',
  'docs/pro/js/product-data.js',
  'docs/pro/js/roofivent-catalog.js',
  'docs/pro/js/estimate-labor-catalog.js',
  'docs/pro/js/estimate-builder-v2.js',
  'docs/pro/js/estimate-catalog-xactimate.js',
  'docs/pro/js/estimate-logic-engine.js',
  'docs/pro/js/job-templates-data.js',
  'docs/pro/js/job-templates.js',
  'docs/pro/js/customer-estimate-rows.js',
  'docs/pro/js/invoice-pipeline.js',
  'docs/pro/js/estimate-finalization.js',
  'docs/pro/js/estimate-v2-ui.js',
];
const APP = makeSandbox();
STACK.forEach((f) => load(APP, f));
const W = APP.win;
const R = W.NBDDepositRule;
const CFG = W.NBD_ESTIMATE_CONFIG;
const V2 = W.EstimateV2UI && W.EstimateV2UI._test;
const FIN = W.EstimateFinalization;
const IP = W.InvoicePipeline;
const JT = W.JobTemplates;
const ENGINE = W.EstimateBuilderV2;
if (!R || !CFG || !V2 || !FIN || !IP || !JT || !ENGINE) {
  console.log('FATAL: stack did not load', { R: !!R, CFG: !!CFG, V2: !!V2, FIN: !!FIN, IP: !!IP, JT: !!JT, ENGINE: !!ENGINE });
  process.exit(1);
}

// Doc pre-flight + generator on their own page-shaped sandbox (docgen bundle).
const DOCS = makeSandbox({ _brand: () => ({ legalName: 'No Big Deal Home Solutions', colors: {}, contact: {} }) });
['docs/pro/js/estimate-config.js', 'docs/pro/js/deposit-rule.js', 'docs/pro/js/customer-estimate-rows.js',
  'docs/pro/js/document-generator.js', 'docs/pro/js/document-generator-templates.js', 'docs/pro/js/doc-preflight.js']
  .forEach((f) => load(DOCS, f));
DOCS.win.showToast = () => {};

// The REAL server templates + helpers.
const Handlebars = require(path.join(ROOT, 'functions/node_modules/handlebars'));
const RENDER = require(path.join(ROOT, 'functions/render-pdf.js'));
RENDER._registerPartialsOnce();
RENDER._registerHelpersOnce();
const ESTIMATE_HBS = Handlebars.compile(read('functions/print/templates/estimate.hbs'));
const CONTRACT_HBS = Handlebars.compile(read('functions/print/templates/contract.hbs'));
const { safeDepositPlan } = require(path.join(ROOT, 'functions/deposit-plan-view.js'));

// ════════════════════════════════════════════════════════════════════
// The table. Figures written out by hand.
// ════════════════════════════════════════════════════════════════════
const ACV_SENT = 'insurance ACV payment (your carrier’s first check)';
const CASES = [
  { name: 'cash $1,999.99', mode: 'cash', total: 1999.99,
    dep: 0, bal: 199999, label: 'Due at signing', value: 'No deposit',
    summary: 'No deposit. The full $1,999.99 is due on completion.',
    rows: [['Payment in full', 'On completion', '$1,999.99']] },
  { name: 'cash $2,000.00', mode: 'cash', total: 2000,
    dep: 100000, bal: 100000, label: 'Due at signing', value: '$1,000',
    summary: '50% deposit of $1,000 due at signing; balance of $1,000 due on completion.',
    rows: [['50% deposit', 'At signing', '$1,000'], ['Balance', 'On completion', '$1,000']] },
  { name: 'cash $6,988.13', mode: 'cash', total: 6988.13,
    dep: 350000, bal: 348813, label: 'Due at signing', value: '$3,500',
    summary: '50% deposit of $3,500 due at signing; balance of $3,488.13 due on completion.',
    rows: [['50% deposit', 'At signing', '$3,500'], ['Balance', 'On completion', '$3,488.13']] },
  { name: 'insurance, deductible only (ACV not known yet)', mode: 'insurance', total: 12000, deductible: 2500,
    dep: 250000, bal: 950000, label: 'Due at signing', value: '$2,500',
    summary: 'Your $2,500 deductible is due at signing. Your ' + ACV_SENT +
      ' is due when your carrier releases it, and the rest of the $9,500 balance is due on completion.',
    rows: [['Your deductible', 'At signing', '$2,500'],
      ['Balance', 'Insurance ACV payment when your carrier releases it; the rest on completion', '$9,500']] },
  { name: 'insurance, deductible + ACV (both up front)', mode: 'insurance', total: 15000, deductible: 2500, acv: 10500,
    dep: 1050000, bal: 450000, label: 'Due up front', value: '$10,500',
    // A Close Board deal carries the deductible but no ACV field, so its
    // cards state the rule's ACV-not-known-yet answer: the deductible.
    cb: ['Due at signing', '$2,500'],
    cbTerms: 'Your deductible at signing; your insurance ACV payment when your carrier releases it; the balance on completion.',
    summary: 'Due up front: your $2,500 deductible at signing, plus your $8,000 ' + ACV_SENT +
      ' as soon as your carrier releases it — $10,500 in all. Balance of $4,500 due on completion.',
    rows: [['Your deductible', 'At signing', '$2,500'],
      ['Insurance ACV payment (your carrier’s first check)', 'Up front — as soon as your carrier releases it', '$8,000'],
      ['Balance', 'On completion', '$4,500']] },
  { name: 'insurance, deductible above the job total', mode: 'insurance', total: 1800, deductible: 2500,
    dep: 180000, bal: 0, label: 'Due at signing', value: '$1,800',
    summary: 'The job total of $1,800 is at or below your $2,500 deductible, so the full $1,800 is due at signing.',
    rows: [['Job total (at or below your deductible)', 'At signing', '$1,800']] },
  { name: 'insurance, deductible blank + ACV blank', mode: 'insurance', total: 12000, deductible: null, acv: '',
    dep: 0, bal: 1200000, label: 'Due at signing', value: 'Your deductible', needsDeductible: true,
    summary: 'Your insurance deductible is due at signing. Your ' + ACV_SENT +
      ' is due when your carrier releases it, and the rest of the balance is due on completion.',
    rows: [['Your deductible', 'At signing', 'Per your policy'],
      ['Insurance ACV payment (your carrier’s first check)', 'When your carrier releases it', 'Set by your carrier'],
      ['Balance', 'On completion', 'Remainder of $12,000']] },
  { name: 'insurance, deductible 0 (a cleared field) + ACV given', mode: 'insurance', total: 12000, deductible: 0, acv: 9000,
    dep: 0, bal: 1200000, label: 'Due at signing', value: 'Your deductible', needsDeductible: true,
    summary: 'Your insurance deductible is due at signing. Your ' + ACV_SENT +
      ' is due when your carrier releases it, and the rest of the balance is due on completion.',
    rows: [['Your deductible', 'At signing', 'Per your policy'],
      ['Insurance ACV payment (your carrier’s first check)', 'When your carrier releases it', 'Set by your carrier'],
      ['Balance', 'On completion', 'Remainder of $12,000']] },
];

// A saved V2 doc (post-sweep shape: retail rows + the O&P ladder inputs) for
// a case. One retail line at the full price, no tax, so the saved grandTotal
// IS the case total to the cent.
function savedDocFor(c, id) {
  return {
    id, builder: 'v2', estimateVersion: 'v2', method: 'line-item', tier: 'better',
    mode: c.mode, priceMode: 'line-item', leadId: 'lead_' + id,
    addr: '1 Elm St, Cincinnati, OH 45202', owner: 'Jane Smith',
    customerEmail: 'jane@example.test', customerPhone: '5135550100',
    claim: c.mode === 'insurance'
      ? { carrier: 'State Farm', number: 'CLM-1', adjuster: '', dateOfLoss: '', deductible: c.deductible == null ? null : c.deductible,
        acv: (c.acv === '' || c.acv == null) ? null : c.acv, recoverableDepreciation: null, policyNumber: '' }
      : null,
    rows: [{ code: 'GUT K5', desc: 'Seamless 5" K-style gutter', qty: '100.00LF', rate: '$' + (c.total / 100).toFixed(2),
      total: c.total, retailTotal: c.total, quantity: 100, unit: 'LF', category: 'gutters',
      materialTotal: null, laborTotal: null, materialCostPerUnit: null, laborCostPerUnit: null, unitPrice: c.total / 100 }],
    grandTotal: c.total, subtotal: c.total, tax: 0, taxRate: 0,
    materialMarkupPct: 0.25, retailBeforeOHP: c.total, overhead: 0, overheadPct: 0, profit: 0, profitPct: 0,
    materialCost: 0, laborCost: 0, internal: { margin: 0, marginPct: 0 },
    // Deliberately STALE: the old engine's 50/50 answer. Nothing may print it.
    deposit: Math.round(c.total * 0.5 / 25) * 25,
  };
}

// Readers for rendered output.
function quoteRows(html) {
  const out = [];
  const re = /<tr>\s*<td><strong>([^<]*?) — ([^<]*?)<\/strong><\/td>\s*<td class="num"><strong>([^<]*)<\/strong><\/td>\s*<\/tr>/g;
  let m;
  while ((m = re.exec(html))) out.push([stripTags(m[1]), stripTags(m[2]), stripTags(m[3])]);
  return out;
}
function contractRows(html) {
  const out = [];
  const re = /<tr class="avoid-break">\s*<td><strong>([^<]*)<\/strong><\/td>\s*<td>([^<]*)<\/td>\s*<td class="num money"><strong>([^<]*)<\/strong><\/td>/g;
  let m;
  while ((m = re.exec(html))) out.push([stripTags(m[1]), stripTags(m[2]), stripTags(m[3])]);
  return out;
}
const sameRows = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// estimate-view.js, run for real against a stubbed getEstimateForView.
async function renderEstimateView(estimatePayload) {
  const root = {
    _h: '', set innerHTML(v) { this._h = String(v); }, get innerHTML() { return this._h; },
    addEventListener() {}, querySelector() { return null; },
  };
  const sb = {
    document: { getElementById: (id) => (id === 'evRoot' ? root : null), title: '',
      documentElement: { style: { setProperty() {} } }, body: null, referrer: '' },
    location: { hostname: 'example.test', search: '?token=abcdefghij1234&estimateId=est1', origin: 'https://example.test' },
    history: { length: 1, back() {} },
    URLSearchParams, URL, JSON, Math, Number, String, Promise, setTimeout,
    console: { log() {}, warn() {}, error() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve({ estimate: estimatePayload, company: null }) }),
  };
  sb.window = sb;
  vm.runInNewContext(read('docs/pro/js/estimate-view.js'), sb, { filename: 'estimate-view.js' });
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  return root.innerHTML;
}

// portal.js's estimate-card deposit block, lifted and run (the file boots a
// live portal; the block is one expression inside renderView).
const PORTAL_SRC = read('docs/pro/js/portal.js').replace(/\r\n/g, '\n');
const portalBlockM = PORTAL_SRC.match(/\n(\s*)\(\(e\.depositPlan && e\.depositPlan\.summary\)\n[\s\S]*?\n\s*: ''\) \+\n/);
const portalBlock = (() => {
  if (!portalBlockM) return null;
  const expr = portalBlockM[0].trim().replace(/ \+$/, '');
  const ctx = { esc };
  vm.createContext(ctx);
  vm.runInContext('this.__card = function (e) { return ' + expr + '; };', ctx);
  return ctx.__card;
})();

// The contract, through doc pre-flight exactly as a rep generates it.
async function contractFor(savedDoc, lead, editDeposit) {
  const w = DOCS.win;
  w._leadDoc = Object.assign({ firstName: 'Jane', lastName: 'Smith', address: '1 Elm St, Cincinnati, OH 45202',
    phone: '5135550100', email: 'jane@example.test', scopeOfWork: 'Gutters as quoted.' }, lead || {});
  w._currentLead = w._leadDoc;
  w._customerEstimates = [savedDoc];
  let captured = null;
  const real = w.NBDDocGen.generate;
  w.NBDDocGen.generate = (t, data) => { captured = data; };
  try {
    w.DocPreflight.open('contract', null);
    const st = w.DocPreflight._state;
    if (editDeposit != null) st.values.depositAmount = String(editDeposit);
    if (st.open) { st.softAck = true; await w.DocPreflight.submit(); }
  } finally { w.NBDDocGen.generate = real; }
  if (!captured) return null;
  const payload = w.NBDDocGen._buildServerPayload('contract', Object.assign({}, captured));
  const html = CONTRACT_HBS(Object.assign({ company: { footerName: 'NBD Co' } }, payload));
  return { data: captured, payload, html };
}

// The Close Board deal page (the real close-board.js; its Firestore import()
// is routed to a stub the way the close-board suites do it).
function closeBoardPage(price, mode, deductible) {
  const raw = read('docs/pro/js/close-board.js').replace(/\bimport\(/g, '__testImport(');
  const mk = () => ({ _h: '', get innerHTML() { return this._h; }, set innerHTML(v) { this._h = String(v); },
    get textContent() { return this._h; },
    set textContent(v) { this._h = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    style: {}, dataset: {}, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } });
  const els = {}; const store = {};
  const sb = {
    console: { log() {}, info() {}, warn() {}, error() {} }, JSON, Math, Date, Number, String, Array, Object, RegExp,
    Boolean, Error, Promise, Set, Map, isNaN, parseFloat, parseInt, encodeURIComponent,
    setTimeout: () => 0, clearTimeout: () => {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { getElementById: (id) => (els[id] = els[id] || mk()), createElement: mk, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    navigator: {},
    __testImport: async () => ({ doc: () => ({}), collection: () => ({}), where: () => ({}), query: () => ({}),
      setDoc: () => Promise.resolve(), deleteDoc: () => Promise.resolve(), getDocs: () => Promise.resolve({ empty: true, size: 0, forEach() {} }) }),
  };
  sb.window = sb; sb.addEventListener = () => {}; sb.showToast = () => {}; sb.open = () => null;
  sb._db = null; sb._user = { uid: 'u1' }; sb._userClaims = { companyId: 'c1' };
  sb.getLineItems = () => [];
  vm.createContext(sb);
  vm.runInContext(read('docs/pro/js/deposit-rule.js'), sb, { filename: 'deposit-rule.js' });
  vm.runInContext(raw, sb, { filename: 'close-board.js' });
  const deal = sb.CloseBoard.createFromEstimate({ prices: { good: price, better: price, best: price } },
    { name: 'Jane Smith', address: '1 Elm St', insuranceCarrier: mode === 'insurance' ? 'State Farm' : '', deductible: deductible || 0 });
  return sb.CloseBoard.generatePageHTML(deal) || '';
}

(async function main() {
  // ══════════════════════════════════════════════════════════════════
  section('0. ONE SOURCE — thresholds live in NBD_ESTIMATE_CONFIG, the rule module carries the same defaults');
  // ══════════════════════════════════════════════════════════════════
  {
    ok('found portal.js\'s estimate-card deposit block (if it moved, update the extractor — do NOT delete the check)', typeof portalBlock === 'function');
    ok('estimate-config.js carries DEPOSIT_RULE', !!(CFG.DEPOSIT_RULE && CFG.DEPOSIT_RULE.CASH_NO_DEPOSIT_UNDER_CENTS));
    ok('the rule module\'s DEFAULTS equal the config (customer.html loads no config)',
      JSON.stringify(R.DEFAULTS) === JSON.stringify(Object.assign({}, CFG.DEPOSIT_RULE)),
      JSON.stringify(R.DEFAULTS) + ' vs ' + JSON.stringify(CFG.DEPOSIT_RULE));
    ok('defaults are Jo\'s rule: under $2,000 none, 50%, $25 step',
      CFG.DEPOSIT_RULE.CASH_NO_DEPOSIT_UNDER_CENTS === 200000 && CFG.DEPOSIT_RULE.CASH_DEPOSIT_PCT === 50
        && CFG.DEPOSIT_RULE.CASH_DEPOSIT_ROUND_TO_CENTS === 2500);
    // The loaded config is what the rule reads: a tenant raising the
    // threshold changes the answer (proves the number is not baked in).
    const tenant = makeSandbox({ NBD_ESTIMATE_CONFIG: { DEPOSIT_RULE: { CASH_NO_DEPOSIT_UNDER_CENTS: 300000, CASH_DEPOSIT_PCT: 40, CASH_DEPOSIT_ROUND_TO_CENTS: 100 } } });
    load(tenant, 'docs/pro/js/deposit-rule.js');
    const t1 = tenant.win.NBDDepositRule.compute({ total: 2500, mode: 'cash' });
    const t2 = tenant.win.NBDDepositRule.compute({ total: 5000, mode: 'cash' });
    ok('a tenant config is honored: $2,500 is under a $3,000 threshold → no deposit', t1.depositCents === 0 && t1.rule === 'cash-none');
    ok('…and its 40% applies above it ($5,000 → $2,000)', t2.depositCents === 200000 && /^40% deposit of \$2,000/.test(t2.summary), t2.summary);
    // company-profile.js's payment-terms defaults ARE the rule's statement,
    // with and without the rule loaded (its literal fallback must match).
    const withRule = makeSandbox(); load(withRule, 'docs/pro/js/deposit-rule.js'); load(withRule, 'docs/pro/js/company-profile.js');
    const noRule = makeSandbox(); load(noRule, 'docs/pro/js/company-profile.js');
    const d1 = withRule.win.NBD_COMPANY_PROFILE_DEFAULTS || {}, d2 = noRule.win.NBD_COMPANY_PROFILE_DEFAULTS || {};
    ok('company profile paymentTermsContract default === the rule\'s policyText()', d1.paymentTermsContract === R.policyText(), d1.paymentTermsContract);
    ok('…and its no-rule fallback literal is the same sentence', d2.paymentTermsContract === R.policyText(), d2.paymentTermsContract);
    ok('proposal terms default is the same statement (+ insurance assignment)', d1.paymentTermsProposal === R.policyText() + ' Insurance assignments accepted.');
    ok('no "Fifty percent" / flat 50% default left in the company profile',
      !/Fifty percent|50% deposit due upon/i.test(String(d1.paymentTermsContract) + String(d1.paymentTermsProposal)));
    ok('policy text never implies a waived / reduced deductible (it says the opposite)',
      /never waived or reduced/.test(R.policyText()) && !/waive (?:it|your)|we (?:cover|pay) (?:the|your) deductible/i.test(R.policyText()));
  }

  // ══════════════════════════════════════════════════════════════════
  section('1. THE TABLE — every surface agrees, to the cent');
  // ══════════════════════════════════════════════════════════════════
  let seq = 0;
  for (const c of CASES) {
    const tag = '[' + c.name + '] ';
    const totalC = Math.round(c.total * 100);

    // A. RULE
    const plan = R.compute({ total: c.total, mode: c.mode, deductible: c.deductible, acv: c.acv });
    ok(tag + 'A rule: deposit ' + c.dep + '¢, balance ' + c.bal + '¢', plan.depositCents === c.dep && plan.balanceCents === c.bal,
      plan.depositCents + ' / ' + plan.balanceCents);
    ok(tag + 'A rule: deposit + balance === total exactly', plan.depositCents + plan.balanceCents === totalC);
    ok(tag + 'A rule: label / value', plan.label === c.label && plan.valueText === c.value, plan.label + ' / ' + plan.valueText);
    ok(tag + 'A rule: summary', plan.summary === c.summary, plan.summary);
    ok(tag + 'A rule: stages', sameRows(plan.rows.map((r) => [r.label, r.due, r.amountText]), c.rows), JSON.stringify(plan.rows.map((r) => [r.label, r.due, r.amountText])));
    ok(tag + 'A rule: needsDeductible flag', !!plan.needsDeductible === !!c.needsDeductible);

    // B. V2 — a saved doc (carrying a STALE 50/50 deposit) reopened; the
    // clean-reopen replay is re-stamped from the rule + the live claim.
    const doc = savedDocFor(c, 'est_' + (++seq));
    W._estimates = [JSON.parse(JSON.stringify(doc))];
    V2.rehydrateFromSaved(doc.id);
    const st = V2.getState();
    const est = V2.effectiveEstimate();
    ok(tag + 'B V2: reopened on the saved total', !!est && cents(est.total) === totalC, est && est.total);
    ok(tag + 'B V2: stamped plan = the rule (not the stale saved 50/50)',
      !!(est && est.depositPlan) && est.depositPlan.depositCents === c.dep && cents(est.deposit) === c.dep
        && est.depositPlan.summary === c.summary, est && JSON.stringify(est.depositPlan && est.depositPlan.summary));

    // C. ON-SCREEN Retail Quote + Single Quote (the rep's preview / BoldSign body)
    const meta = { customer: { name: 'Jane Smith', address: '1 Elm St' }, claim: st.claim,
      estimate: { number: 'EST-' + seq, date: '2026-09-25', preparedBy: 'Joe' } };
    const rq = FIN.formatEstimate(est, 'retail-quote', meta);
    const sq = FIN.formatEstimate(est, 'single-quote', meta);
    ok(tag + 'C on-screen quote: deposit/balance', cents(rq.deposit) === c.dep && cents(rq.balance) === c.bal, rq.deposit + ' / ' + rq.balance);
    ok(tag + 'C on-screen quote: stages printed', sameRows(quoteRows(rq.html), c.rows), JSON.stringify(quoteRows(rq.html)));
    ok(tag + 'C on-screen quote: the rule\'s sentence printed', stripTags(rq.html).indexOf(c.summary) !== -1);
    ok(tag + 'C on-screen quote: PROJECT TOTAL is the total', new RegExp('PROJECT TOTAL</strong></td>\\s*<td class="num"><strong>'
      + FIN.fmtMoneyBig(c.total).replace(/[$.]/g, '\\$&') + '<').test(rq.html));
    ok(tag + 'C single quote: same stages + sentence', sameRows(quoteRows(sq.html), c.rows) && stripTags(sq.html).indexOf(c.summary) !== -1);
    ok(tag + 'C on-screen quote: no old "Deposit (NN% — Upon signing)" label', !/Deposit \(\d+% — Upon signing\)/.test(rq.html));

    // D. SERVER Retail Quote PDF — the real payload through the real template.
    const pay = V2.buildEstimatePayload('retail-quote', est, meta);
    const pdf = ESTIMATE_HBS(Object.assign({ company: { footerName: 'NBD Co', seal: 'Estimate' } }, pay));
    const kv = /<div class="kv-label">([^<]*)<\/div>\s*<div class="kv-value">([^<]*)<\/div>/.exec(pdf);
    ok(tag + 'D server PDF: payload deposit === rule', !!pay.terms.deposit && cents(pay.terms.deposit.amount) === c.dep
      && cents(pay.terms.deposit.balance) === c.bal && pay.terms.deposit.summary === c.summary);
    ok(tag + 'D server PDF: first Terms row is "' + c.label + ': ' + c.value + '"', !!kv && stripTags(kv[1]) === c.label && stripTags(kv[2]) === c.value,
      kv && (kv[1] + ' / ' + kv[2]));
    ok(tag + 'D server PDF: prints the rule\'s sentence', stripTags(pdf).indexOf('Payment terms: ' + c.summary) !== -1);
    ok(tag + 'D server PDF: no hard-coded "25%" / "% at contract signing"', !/25%|% at contract signing/.test(pdf));

    // E. SAVE
    const saved = V2.buildSavePayload(est, st);
    ok(tag + 'E save: deposit + depositPlan are the rule', cents(saved.deposit) === c.dep && !!saved.depositPlan
      && saved.depositPlan.depositCents === c.dep && saved.depositPlan.balanceCents === c.bal && saved.depositPlan.summary === c.summary);
    ok(tag + 'E save: stored plan carries no rep-only note', saved.depositPlan && !('repNote' in saved.depositPlan));
    const savedDoc = Object.assign({ id: doc.id, leadId: doc.leadId }, saved);

    // F. INVOICE — from the saved doc (the lead carries no deductible), and
    // from the same estimate as it was saved BEFORE the rule: no stamp, a
    // stale 50/50 `deposit`. The invoice must ask the rule either way (the
    // fresh doc's `deposit` already equals the rule, so only the pre-rule doc
    // can tell "asked the rule" from "trusted the saved number").
    let captured = null;
    let invSource = savedDoc;
    Object.assign(W, {
      _db: {}, doc: () => ({}), collection: () => ({}), _leads: [],
      getDoc: async () => ({ exists: () => true, data: () => JSON.parse(JSON.stringify(invSource)) }),
      addDoc: async (_c, data) => { captured = data; return { id: 'inv_' + seq }; },
      getDocs: async () => ({ empty: true, size: 0, forEach() {}, docs: [] }), query: () => ({}), where: () => ({}),
    });
    let invErr = null;
    invSource = doc;
    try { await IP.createInvoiceFromEstimate(doc.id); } catch (e) { invErr = e; }
    ok(tag + 'F invoice (pre-rule doc, stale deposit ' + doc.deposit + '): depositAmount === rule', !invErr && !!captured
      && cents(captured.depositAmount) === c.dep && captured.terms === 'Net 14. ' + c.summary, captured && captured.depositAmount);
    captured = null; invErr = null; invSource = savedDoc;
    try { await IP.createInvoiceFromEstimate(doc.id); } catch (e) { invErr = e; }
    ok(tag + 'F invoice: created', !!captured && !invErr, invErr && invErr.message);
    if (captured) {
      ok(tag + 'F invoice: depositAmount === rule', cents(captured.depositAmount) === c.dep, captured.depositAmount);
      ok(tag + 'F invoice: total unchanged, balanceDue = full total', cents(captured.total) === totalC && cents(captured.balanceDue) === totalC);
      ok(tag + 'F invoice: terms carry the rule\'s sentence', captured.terms === 'Net 14. ' + c.summary && captured.depositTerms === c.summary, captured.terms);
      const invHtml = IP.buildInvoiceHtml(Object.assign({ invoiceNumber: 'INV-' + seq, customerName: 'Jane', customerAddress: '1 Elm St', items: [] }, captured));
      ok(tag + 'F invoice HTML: prints the terms sentence', stripTags(invHtml).indexOf(c.summary) !== -1);
    }

    // G. PORTAL / estimate-view — the saved stamp, validated server-side.
    const view = safeDepositPlan(savedDoc);
    ok(tag + 'G portal: server whitelists the stamp', !!view && view.depositCents === c.dep && view.balanceCents === c.bal && view.summary === c.summary,
      JSON.stringify(view));
    ok(tag + 'G portal: nothing rep-only crosses (no repNote / override detail)', !!view && !('repNote' in view) && !('override' in view));
    const evHtml = await renderEstimateView({ grandTotal: c.total, total: c.total, lines: [], depositPlan: view, owner: 'Jane', addr: '1 Elm St' });
    ok(tag + 'G estimate-view: prints the sentence', stripTags(evHtml).indexOf(c.summary) !== -1, stripTags(evHtml).slice(0, 200));
    const evRows = [];
    const evRe = /<li class="ev-line"><span class="ev-line-name">([^<]*)<\/span><span class="ev-line-qty">([^<]*)<\/span><span class="ev-line-amt">([^<]*)<\/span><\/li>/g;
    let em; while ((em = evRe.exec(evHtml))) evRows.push([stripTags(em[1]), stripTags(em[2]), stripTags(em[3])]);
    ok(tag + 'G estimate-view: prints the same stages', sameRows(evRows, c.rows), JSON.stringify(evRows));
    const card = portalBlock ? portalBlock({ depositPlan: view }) : '';
    ok(tag + 'G portal card: label, value and sentence', stripTags(card) === stripTags(esc(c.label) + ' ' + esc(c.value) + ' ' + esc(c.summary)), stripTags(card));

    // H. CONTRACT — doc pre-flight → server payload → contract.hbs.
    const k = await contractFor(savedDoc, null, null);
    ok(tag + 'H contract: generated', !!(k && k.html));
    if (k) {
      ok(tag + 'H contract: pre-flight Deposit Amount prefilled from the rule', cents(k.data.depositAmount) === c.dep, k.data.depositAmount);
      ok(tag + 'H contract: Payment Schedule table = the rule\'s stages', sameRows(contractRows(k.html), c.rows), JSON.stringify(contractRows(k.html)));
      ok(tag + 'H contract: Payment Terms paragraph = the rule\'s sentence', k.payload.paymentTerms === c.summary, k.payload.paymentTerms);
      ok(tag + 'H contract: no "Fifty percent" literal', !/Fifty percent|50% due upon contract execution/.test(k.html));
    }

    // I. CLOSE BOARD — every tier card at this price says the same.
    const cb = closeBoardPage(c.total, c.mode, c.deductible);
    const cbLines = cb.match(/<div class="tier-deposit">[^\n]*?<\/div>/g) || [];
    const cbWant = (c.cb || [c.label, c.value]).join(': ');
    ok(tag + 'I close board: each tier card prints "' + cbWant + '"',
      cbLines.length === 3 && cbLines.every((l) => stripTags(l) === cbWant), cbLines.map(stripTags).join(' | '));
    if (c.mode === 'insurance') {
      ok(tag + 'I close board: insurance box uses the rule\'s terms, not "you typically only pay your deductible"',
        stripTags(cb).indexOf('We work directly with your insurance. ' + (c.cbTerms || plan.terms)) !== -1 && !/typically only pay your deductible/.test(cb),
        (stripTags(cb).match(/We work directly with your insurance\.[^|]{0,160}/) || [''])[0]);
    }

    // J. JOB TEMPLATES payload (cash / insurance, no claim fields of its own).
    const jt = JT.buildEstimatePayload({ totals: { total: c.total, mode: c.mode, lines: [] }, measurements: {} }, { owner: 'Jane' });
    const jtPlan = R.compute({ total: c.total, mode: c.mode });
    ok(tag + 'J job templates: saves the rule\'s deposit (no deductible on a template → the rule\'s unset case)',
      !!jt && cents(jt.deposit) === jtPlan.depositCents && !!jt.depositPlan && jt.depositPlan.summary === jtPlan.summary);

    // K. ENGINE adapter (classic calcDeposit delegates here).
    const eng = ENGINE.calcDeposit(c.total, c.mode, { deductible: c.deductible, acv: c.acv });
    ok(tag + 'K engine calcDeposit: amount/remainder', cents(eng.amount) === c.dep && cents(eng.remainder) === c.bal, eng.amount + ' / ' + eng.remainder);

    // Legal copy guard — every insurance string.
    if (c.mode === 'insurance') {
      const all = [plan.summary, plan.terms, plan.label, plan.valueText].concat(plan.rows.map((r) => r.label + ' ' + r.due + ' ' + r.amountText)).join(' | ');
      ok(tag + 'legal: nothing implies the deductible is waived, reduced, rebated or absorbed',
        !/waiv|reduc|rebat|absorb|no deposit|\$0 deductible|deductible of \$0|free/i.test(all), all);
      ok(tag + 'legal: the deductible is always named as due', /deductible/i.test(plan.summary));
    }
  }

  // ══════════════════════════════════════════════════════════════════
  section('2. ZERO / BLANK TOTALS — nothing is invented');
  // ══════════════════════════════════════════════════════════════════
  for (const blank of [0, '', null, undefined, 'abc', -50]) {
    const p = R.compute({ total: blank, mode: 'cash' });
    ok('total ' + JSON.stringify(blank) + ' → no plan to print (rule "none", 0/0, no rows, no sentence)',
      p.rule === 'none' && p.depositCents === 0 && p.balanceCents === 0 && p.rows.length === 0 && p.summary === '' && R.toStored(p) === null);
  }
  {
    const e0 = { total: 0, lines: [], mode: 'cash' };
    const rq0 = FIN.formatEstimate(e0, 'retail-quote', { customer: {}, estimate: {} });
    ok('a $0 quote prints no deposit stages and no sentence (PROJECT TOTAL only)', quoteRows(rq0.html).length === 0 && !/deposit-terms/.test(rq0.html));
    const pay0 = V2.buildEstimatePayload('retail-quote', e0, { customer: {}, estimate: {} });
    ok('a $0 server payload carries no deposit term', pay0.terms.deposit === null);
    ok('portal refuses a stamp whose total no longer matches the estimate (stale after an edit)',
      safeDepositPlan({ grandTotal: 5000, depositPlan: R.toStored(R.compute({ total: 4000, mode: 'cash' })) }) === null);
    ok('portal refuses a stamp whose cents do not foot', safeDepositPlan({ grandTotal: 4000,
      depositPlan: { totalCents: 400000, depositCents: 200000, balanceCents: 100000, summary: 'x' } }) === null);
    ok('portal: no stamp → null (older estimates print nothing, as before)', safeDepositPlan({ grandTotal: 4000 }) === null);
  }

  // ══════════════════════════════════════════════════════════════════
  section('3. REP OVERRIDE — kept working, and labelled');
  // ══════════════════════════════════════════════════════════════════
  {
    const o = R.compute({ total: 10000, mode: 'cash', overridePct: 25 });
    ok('classic "Override %" 25% on $10,000 → $2,500, kind "override"', o.depositCents === 250000 && o.kind === 'override');
    ok('…labelled for the rep with what the rule would ask', o.repNote === 'Rep override — the deposit rule would ask $5,000.', o.repNote);
    ok('…and the customer sentence states the override honestly', o.summary === '25% deposit of $2,500 due at signing; balance of $7,500 due on completion.', o.summary);
    const same = R.compute({ total: 10000, mode: 'cash', overridePct: 50 });
    ok('an "override" equal to the rule is not an override', same.kind === 'cash-percent' && !same.repNote);
    const low = R.compute({ total: 12000, mode: 'insurance', deductible: 2500, overrideAmount: 1000 });
    ok('insurance override below the deductible is raised to it (never reduced)', low.depositCents === 250000 && /raised to the \$2,500 deductible/.test(low.repNote), low.repNote);
    const hi = R.compute({ total: 12000, mode: 'insurance', deductible: 2500, overrideAmount: 5000 });
    ok('insurance override above the deductible is honored and says it includes the deductible',
      hi.depositCents === 500000 && /includes your \$2,500 deductible/.test(hi.summary));
    const zeroIns = R.compute({ total: 12000, mode: 'insurance', overridePct: 0 });
    ok('a $0 override on a claim with no deductible entered is ignored (never "No deposit" on a claim)',
      zeroIns.kind === 'insurance' && zeroIns.needsDeductible && !/no deposit/i.test(zeroIns.summary));
    // Classic estimates persist depositPctOverride; the invoice honors it.
    const classic = { grandTotal: 10000, mode: 'cash', depositPctOverride: 30, deposit: { pct: 30, amount: 3000, remainder: 7000 } };
    const cp = R.fromEstimate(classic);
    ok('fromEstimate honors a saved classic depositPctOverride (30% → $3,000)', cp.depositCents === 300000 && cp.kind === 'override');
    // A stored plan's AMOUNT is never trusted — only its override.
    const stale = { grandTotal: 1500, mode: 'cash', deposit: 750, depositPlan: { totalCents: 150000, depositCents: 75000, override: null } };
    ok('a stale saved deposit ($750 on a $1,500 cash job) is recomputed → $0', R.fromEstimate(stale).depositCents === 0);
    // The lead's deductible fills in when the estimate carries none (invoice path).
    const leadDed = R.fromEstimate({ grandTotal: 12000, mode: 'insurance' }, { lead: { deductibleOrOwedByHO: '1500' } });
    ok('fromEstimate: the lead\'s deductible fills in for an estimate with none', leadDed.depositCents === 150000);
    // Doc pre-flight: a rep-edited Deposit Amount flows into the contract.
    const c6 = CASES[2];
    const d6 = Object.assign({ id: 'est_ovr', leadId: 'lead_ovr' }, V2.buildSavePayload(
      (W._estimates = [savedDocFor(c6, 'est_ovr')], V2.rehydrateFromSaved('est_ovr'), V2.effectiveEstimate()), V2.getState()));
    const k = await contractFor(d6, null, '2000.00');
    ok('contract: an edited Deposit Amount ($2,000) becomes the schedule', !!k && sameRows(contractRows(k.html),
      [['Deposit', 'At signing', '$2,000'], ['Balance', 'On completion', '$4,988.13']]), k && JSON.stringify(contractRows(k.html)));
    ok('contract: …and the untouched terms paragraph follows it (no stale "$3,500")',
      !!k && k.payload.paymentTerms === 'Deposit of $2,000 due at signing; balance of $4,988.13 due on completion.', k && k.payload.paymentTerms);
    // Pre-rule prefills persisted as per-doc overrides are retired, not revived.
    const PF = DOCS.win.DocPreflight;
    const retiredSched = PF._resolveFieldValue({ key: 'paymentSchedule', source: 'computed.depositTerms' },
      { lead: {}, estimate: { grandTotal: 1500, mode: 'cash' },
        overrides: { paymentSchedule: '50% due upon contract execution; remaining balance due upon substantial completion.' } });
    ok('pre-flight: the retired 50% literal saved as an override does not come back', retiredSched === 'No deposit. The full $1,500 is due on completion.', retiredSched);
    const retiredAmt = PF._resolveFieldValue({ key: 'depositAmount', source: 'computed.depositAmount' },
      { lead: {}, estimate: { grandTotal: 1500, mode: 'cash' }, overrides: { depositAmount: '750.00' } });
    ok('pre-flight: the retired jobValue × 0.5 saved as an override does not come back', retiredAmt === '0.00', retiredAmt);
    const keptAmt = PF._resolveFieldValue({ key: 'depositAmount', source: 'computed.depositAmount' },
      { lead: {}, estimate: { grandTotal: 1500, mode: 'cash' }, overrides: { depositAmount: '400.00' } });
    ok('pre-flight: a figure a rep actually typed still wins', keptAmt === '400.00', keptAmt);
  }

  // ══════════════════════════════════════════════════════════════════
  section('4. V2 BUILDER — the claim block feeds the deposit; no phantom deductible');
  // ══════════════════════════════════════════════════════════════════
  {
    const src = read('docs/pro/js/estimate-v2-ui.js');
    ok('V2 claim block has an ACV input bound to claim.acv', /id="v2claimAcv" data-claim="acv"/.test(src));
    ok('V2 state default deductible is null, not a $2,500 placeholder',
      /claim: \{ carrier: '', number: '', adjuster: '', dateOfLoss: '', deductible: null,/.test(src)
        && !/deductible: 2500/.test(src.replace(/\/\/[^\n]*/g, '')));
    // A reopened insurance doc with no deductible → the builder states it is
    // still due and warns the rep; it never prints "$2,500".
    const noDed = savedDocFor({ mode: 'insurance', total: 9000, deductible: null }, 'est_nd');
    noDed.claim = null;
    W._estimates = [noDed];
    V2.rehydrateFromSaved('est_nd');
    const e = V2.effectiveEstimate();
    const ep = (e && e.depositPlan) || {};
    ok('reopened claim with no deductible: plan says the deductible is due, no number invented',
      ep.needsDeductible === true && ep.valueText === 'Your deductible' && !/\$2,500/.test(String(ep.summary)));
    ok('…and the rep sees why', /No deductible entered/.test(String(ep.repNote)));
  }

  // ══════════════════════════════════════════════════════════════════
  section('5. RETIRED LITERALS — none of the five old answers survives in code');
  // ══════════════════════════════════════════════════════════════════
  {
    const code = (p) => read(p).replace(/\r\n/g, '\n').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    ok('V2 server payload has no hard-coded depositPct', !/depositPct:\s*25/.test(code('docs/pro/js/estimate-v2-ui.js')));
    ok('V2 has no inline "insurance 0 / cash 50%" deposit', !/estimate\.deposit\s*=\s*\(state\.jobMode === 'insurance'\)/.test(code('docs/pro/js/estimate-v2-ui.js')));
    ok('estimate.hbs prints no "% at contract signing"', !/% at contract signing/.test(read('functions/print/templates/estimate.hbs').replace(/\{\{!--[\s\S]*?--\}\}/g, '')));
    ok('the on-screen quote has no 50/50 fallback', !/estimate\.total \* 0\.5/.test(code('docs/pro/js/estimate-finalization.js')));
    ok('the invoice has no "total * 0.5" fallback and no "50% deposit due upon scheduling"',
      !/total \* 0\.5/.test(code('docs/pro/js/invoice-pipeline.js')) && !/50% deposit due upon scheduling/.test(code('docs/pro/js/invoice-pipeline.js')));
    ok('the contract payload has no "Fifty percent" default', !/Fifty percent/.test(code('docs/pro/js/document-generator.js')));
    ok('doc pre-flight has no jobValue × 0.5 deposit and no 50% literal default',
      !/\(jv \* 0\.5\)\.toFixed\(2\) : ''/.test(code('docs/pro/js/doc-preflight.js'))
        && !/literal:50% due upon contract execution/.test(code('docs/pro/js/doc-preflight.js')));
    ok('the blank contract template in the Document Library prints the rule, not "50% due at material delivery"',
      !/50% due at material delivery/.test(code('docs/pro/js/dashboard-ui.js')) && /\{\{PAYMENT_TERMS\}\}/.test(code('docs/pro/js/dashboard-ui.js')));
    ok('the rep training script no longer teaches "Zero deposit"', !/Zero deposit/.test(code('docs/pro/js/sales-training-engine.js')));
    ok('the insurance playbook no longer says "50/50 deposit structure"', !/50\/50 deposit structure/.test(code('docs/pro/js/decision-engine.js')));
    ok('both CRM pages load deposit-rule.js', /<script defer src="js\/deposit-rule\.js\?v=\d+"><\/script>/.test(read('docs/pro/dashboard.html'))
      && /<script defer src="js\/deposit-rule\.js\?v=\d+"><\/script>/.test(read('docs/pro/customer.html')));
    const dash = read('docs/pro/dashboard.html');
    ok('dashboard.html: deposit-rule.js loads after estimate-config.js and before company-profile.js',
      dash.indexOf('js/estimate-config.js') < dash.indexOf('js/deposit-rule.js') && dash.indexOf('js/deposit-rule.js') < dash.indexOf('js/company-profile.js'));
    const cust = read('docs/pro/customer.html');
    ok('customer.html: deposit-rule.js loads before company-profile.js', cust.indexOf('js/deposit-rule.js') > 0 && cust.indexOf('js/deposit-rule.js') < cust.indexOf('js/company-profile.js'));
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('FAILURES: ' + fails.length); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('deposit-rule test crashed:', e && (e.stack || e.message)); process.exit(1); });

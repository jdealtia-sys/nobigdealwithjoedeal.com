/**
 * tests/job-template-honest-paperwork.test.js — Upgrades & Add-ons slice 0:
 * honest tier + workmanship-warranty paperwork for Job Template estimates.
 *
 * WHY (documentation/projects/UPGRADES-ADDONS-DESIGN-2026-09-25.md): every Job
 * Template showed a Good/Better/Best row that priced nothing, saved tier
 * 'better' by default, and the paperwork turned that into "Preferred" plus a
 * LIFETIME workmanship warranty on gutter jobs, repairs and inspections. Jo's
 * decisions (2026-09-25): new gutter systems 5 yr, guard-only 2 yr, repairs a
 * per-estimate 1-yr box that starts OFF, every other install 2 yr, roofing
 * keeps its existing wording unchanged.
 *
 * Everything below runs the REAL files in vm sandboxes with real inputs — no
 * source-string matching except two lifted portal expressions, which are
 * EXECUTED, not matched:
 *   1. DATA          every template declares a warranty kind; the roofing id
 *                    rule matches the roof kind exactly, both ways.
 *   2. PREMISE       tiers price nothing: all templates, good = better = best,
 *                    bare and with a cost book (re-measured, not assumed).
 *   3. TIER STATE    tiersApply() is metadata (tierPriced), not the price band;
 *                    payload records tier null / tierApplies false; a flagged
 *                    template still saves its tier.
 *   4. WARRANTY      estimateWarranty() per kind, repair box on/off, mixed
 *                    jobs, config table == the customer.html fallback copy,
 *                    server copy (functions/) says the same.
 *   5. OLD ESTIMATES the pre-2026-09-25 rule: template + no roofing source →
 *                    no tier, no claim; roofing, V2, classic, per-SQ untouched.
 *   6. PORTAL        functions/portal.js tierName / view tier, lifted + run.
 *   7. PAPERWORK     proposal / contract / certificate through the real
 *                    DocPreflight open→submit→NBDDocGen path, with and
 *                    without estimate-config.js (dashboard vs customer.html).
 *   8. ROOFING       a new roofing template estimate prints byte-for-byte the
 *                    proposal + contract a pre-change one prints.
 *   9. BUILD SCREEN  the real job-templates-ui.js on a fake DOM: no tier row,
 *                    the repair box only on a repair job, off by default,
 *                    persisted by Create estimate; the preview's warranty line.
 *
 * Run: node tests/job-template-honest-paperwork.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PRO_JS = path.join(ROOT, 'docs', 'pro', 'js');
const read = (p) => fs.readFileSync(p, 'utf8');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(name) { console.log('\n' + name); }

// ════════════════════════════════════════════════════════════════════
// Sandbox with a minimal fake DOM. getElementById only knows the ids the
// Job Templates modal reads, so the dashboard library view never paints.
// ════════════════════════════════════════════════════════════════════
const DOM_IDS = ['jtModal', 'jtModalBody', 'jtModalFoot', 'jtStepLbl', 'jtUIStyles', 'jtEditModal',
  'jtEstName', 'jtLeadSel', 'jtRunTotal', 'jtEditCard'];
function makeSandbox(extraWin) {
  const byId = {};
  const listeners = {};
  function el(tag) {
    const classes = new Set();
    const e = {
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
    return e;
  }
  const document = {
    head: el('head'), body: el('body'),
    createElement: el,
    getElementById(id) {
      if (byId[id]) return byId[id];
      if (DOM_IDS.indexOf(id) === -1) return null;
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
    CSS: { escape: (s) => String(s) }, location: { origin: 'https://example.test' },
  };
  vm.createContext(sandbox);
  return { win, sandbox, byId, listeners };
}
function load(env, rel) {
  vm.runInContext(read(path.join(ROOT, rel)), env.sandbox, { filename: path.basename(rel) });
}

const ENGINE_FILES = [
  'docs/pro/js/estimate-config.js',
  'docs/pro/js/product-data.js',
  'docs/pro/js/roofivent-catalog.js',
  'docs/pro/js/estimate-labor-catalog.js',
  'docs/pro/js/estimate-builder-v2.js',
  'docs/pro/js/estimate-catalog-xactimate.js',
  'docs/pro/js/estimate-logic-engine.js',
  'docs/pro/js/job-templates-data.js',
  'docs/pro/js/job-templates.js',
  'docs/pro/js/customer-estimate-rows.js',
];
function engineStack(book) {
  const env = makeSandbox(book ? { NBDCatalogCosts: book } : null);
  ENGINE_FILES.forEach((f) => load(env, f));
  return env;
}

const BARE = engineStack(null);
const W = BARE.win;
const TPLS = W.NBD_JOB_TEMPLATES;
const JT = W.JobTemplates;
const ROWS = W.NBDCustomerEstimateRows;
const CFG = W.NBD_ESTIMATE_CONFIG;
if (!Array.isArray(TPLS) || !JT || !ROWS || !CFG) {
  console.log('FATAL: stack did not load (templates/engine/rows/config)');
  process.exit(1);
}
// A cost book so custom items price too (invented flat fixture, tests/ only).
const { jtKey } = require(path.join(ROOT, 'functions', 'job-template-cost-logic.js'));
const BOOK = {};
TPLS.forEach((t) => (t.items || []).forEach((it, i) => {
  if (it && it.custom && it.custom.name) BOOK[jtKey(t.id, i)] = { materialCost: 1, laborCost: 2 };
}));
const PRICED = engineStack({
  jobItem: (k) => BOOK[k] || null, jobItemKeys: () => Object.keys(BOOK),
  recordJobItems: () => Promise.resolve(false), hydrate: () => Promise.resolve(null),
});

const KINDS = ['roof', 'gutter_system', 'guard_only', 'install_default', 'repair', 'none'];
const byId = {}; TPLS.forEach((t) => { byId[t.id] = t; });
const payloadFor = (ids, opts, env) => {
  const jt = (env || BARE).win.JobTemplates;
  const res = jt.resolveSelection(ids.map((id) => ({ templateId: id })), opts || {});
  return jt.buildEstimatePayload(res, opts || {});
};

// ════════════════════════════════════════════════════════════════════
section('1. DATA — explicit warranty kind per template');
// ════════════════════════════════════════════════════════════════════
{
  const bad = TPLS.filter((t) => KINDS.indexOf(t.warrantyKind) === -1).map((t) => t.id);
  ok('every default template declares a valid warrantyKind', bad.length === 0, bad.slice(0, 8).join(', '));
  ok('the engine exports the same kind list', JSON.stringify(JT.WARRANTY_KINDS) === JSON.stringify(KINDS));
  const flagged = TPLS.filter((t) => t.tierPriced === true).map((t) => t.id);
  ok('no default template sets tierPriced today (tiers price nothing)', flagged.length === 0, flagged.join(', '));
  const roofIds = TPLS.filter((t) => t.warrantyKind === 'roof').map((t) => t.id).sort();
  const reIds = TPLS.filter((t) => ROWS.ROOFING_TEMPLATE_ID_RE.test(t.id)).map((t) => t.id).sort();
  ok('legacy roofing id rule == the roof kind, both ways (' + roofIds.length + ' ids)',
    JSON.stringify(roofIds) === JSON.stringify(reIds), 'kind: ' + roofIds.join(',') + ' | rule: ' + reIds.join(','));
  ok('every roof_replacement template is roof kind',
    TPLS.filter((t) => t.category === 'roof_replacement').every((t) => t.warrantyKind === 'roof'));
  const gs = TPLS.filter((t) => t.warrantyKind === 'gutter_system');
  ok('gutter_system only on Gutter Systems installs', gs.length > 0 && gs.every((t) => t.category === 'gutters_install'));
  ok('the guard install is guard_only', byId.jt_gr_guard_install_50lf && byId.jt_gr_guard_install_50lf.warrantyKind === 'guard_only');
  ok('downspout-only (existing gutters stay) is NOT a new gutter system',
    byId.jt_gi_downspout_only && byId.jt_gi_downspout_only.warrantyKind === 'install_default');
  const repairJobs = TPLS.filter((t) => t.jobType === 'repair');
  ok('every jobType "repair" template is repair kind (' + repairJobs.length + ')',
    repairJobs.every((t) => t.warrantyKind === 'repair'), repairJobs.filter((t) => t.warrantyKind !== 'repair').map((t) => t.id).join(','));
  ok('inspections carry no workmanship warranty',
    TPLS.filter((t) => t.jobType === 'inspection').every((t) => t.warrantyKind === 'none'));
  ok('temporary emergency work (tarp) carries none', byId.jt_se_emergency_tarp && byId.jt_se_emergency_tarp.warrantyKind === 'none');
}

// ════════════════════════════════════════════════════════════════════
section('2. PREMISE — Good/Better/Best prices nothing on any template');
// ════════════════════════════════════════════════════════════════════
[['bare', BARE], ['with cost book', PRICED]].forEach(([label, env]) => {
  const jt = env.win.JobTemplates;
  const differ = [];
  TPLS.forEach((t) => {
    const tot = ['good', 'better', 'best'].map((tier) => {
      const r = jt.resolveSelection([{ templateId: t.id }], { tier });
      return r && r.totals ? Math.round(Number(r.totals.total) * 100) : NaN;
    });
    if (!(tot[0] === tot[1] && tot[1] === tot[2]) || !Number.isFinite(tot[0])) differ.push(t.id + ' ' + tot.join('/'));
  });
  ok('[' + label + '] all ' + TPLS.length + ' templates: identical total at good, better and best', differ.length === 0,
    differ.slice(0, 5).join('; ') + ' — a template now prices by tier: set tierPriced:true on it');
});

// ════════════════════════════════════════════════════════════════════
section('3. TIER STATE — metadata-driven, recorded as "no tier applies"');
// ════════════════════════════════════════════════════════════════════
{
  ok('tiersApply() is false for every default template', TPLS.every((t) => JT.tiersApply([t.id]) === false));
  // Not keyed off the price band: templates with and without a band (bare
  // stack has no cost book, so custom-item templates have none) agree.
  const PJ = PRICED.win.JobTemplates;
  ok('tiersApply() ignores the price band (priced stack agrees)', TPLS.every((t) => PJ.tiersApply([t.id]) === false));

  const p = payloadFor(['jt_gi_k5_seamless_full'], { tier: 'best' });
  ok('payload: tier is null (was silently "better")', p.tier === null, JSON.stringify(p.tier));
  ok('payload: selectedTier is null', p.selectedTier === null, JSON.stringify(p.selectedTier));
  ok('payload: tierApplies is recorded false', p.tierApplies === false);
  ok('payload: warrantyKind gutter_system', p.warrantyKind === 'gutter_system', p.warrantyKind);
  ok('payload: warrantyParts names the template', Array.isArray(p.warrantyParts) && p.warrantyParts.length === 1
    && p.warrantyParts[0].kind === 'gutter_system' && p.warrantyParts[0].name === byId.jt_gi_k5_seamless_full.name);
  ok('payload: repairWarranty false on a non-repair job even if asked', payloadFor(['jt_gi_k5_seamless_full'], { repairWarranty: true }).repairWarranty === false);
  const stale = payloadFor(['jt_gi_k5_seamless_full'], { tier: 'good' });
  ok('a stale UI tier changes neither the saved tier nor the total', stale.tier === null && stale.grandTotal === p.grandTotal);

  // The tier path stays intact: a template that says tierPriced saves its tier.
  const tiered = JSON.parse(JSON.stringify(byId.jt_fr_asphalt_better));
  tiered.id = 'jt_custom_tiered_test'; tiered.name = 'Tiered test'; tiered.tierPriced = true; delete tiered.basedOn;
  JT.saveCustom(tiered);
  ok('tiersApply() is true for a tierPriced template', JT.tiersApply(['jt_custom_tiered_test']) === true);
  ok('…and for a selection that includes one', JT.tiersApply(['jt_gi_k5_seamless_full', 'jt_custom_tiered_test']) === true);
  const tp = payloadFor(['jt_custom_tiered_test'], { tier: 'best' });
  ok('a tierPriced template saves the chosen tier', tp.tier === 'best' && tp.selectedTier === 'best' && tp.tierApplies === true,
    JSON.stringify({ tier: tp.tier, sel: tp.selectedTier, ta: tp.tierApplies }));
  JT.remove('jt_custom_tiered_test');

  // A custom saved before warrantyKind existed inherits its default's kind.
  const fork = JSON.parse(JSON.stringify(byId.jt_gr_hanger_resecure)); delete fork.warrantyKind;
  fork.id = 'jt_custom_old_fork'; fork.basedOn = 'jt_gr_hanger_resecure';
  ok('an old fork (no kind, basedOn) inherits the default kind', JT.warrantyKindOf(fork) === 'repair');
  const scratch = { id: 'jt_custom_scratch', name: 'x', category: 'gutters_install', jobType: 'install', items: [] };
  ok('a from-scratch custom install without a kind gets install_default, never lifetime', JT.warrantyKindOf(scratch) === 'install_default');
}

// ════════════════════════════════════════════════════════════════════
section('4. WARRANTY — sentence per job type (NBDCustomerEstimateRows.estimateWarranty)');
// ════════════════════════════════════════════════════════════════════
const SERVER_ROWS = require(path.join(ROOT, 'functions', 'customer-estimate-rows.js'));
{
  const w = (ids, opts) => ROWS.estimateWarranty(payloadFor(ids, opts));
  const txt = (ids, opts) => { const r = w(ids, opts); return r ? r.text : 'NULL'; };
  ok('new gutter system → 5-year', txt(['jt_gi_k5_seamless_full']) === '5-year workmanship warranty.', txt(['jt_gi_k5_seamless_full']));
  ok('guard-only install → 2-year', txt(['jt_gr_guard_install_50lf']) === '2-year workmanship warranty.', txt(['jt_gr_guard_install_50lf']));
  ok('soffit replacement (install_default) → 2-year', txt(['jt_sf_soffit_replacement_vented']) === '2-year workmanship warranty.');
  ok('ventilation install → 2-year', txt(['jt_vt_ridge_vent_retrofit']) === '2-year workmanship warranty.');
  ok('repair, box unticked (default) → no workmanship warranty', txt(['jt_gr_hanger_resecure']) === '', JSON.stringify(txt(['jt_gr_hanger_resecure'])));
  ok('repair, box ticked → 1-year', txt(['jt_gr_hanger_resecure'], { repairWarranty: true }) === '1-year workmanship warranty.');
  ok('roof repair, unticked → none (a 5-shingle repair is not lifetime)', txt(['jt_rr_shingle_5']) === '');
  ok('inspection → none', txt(['jt_se_storm_inspection']) === '');
  ok('gutter system years = 5 for the badge', w(['jt_gi_k5_seamless_full']).years === 5);
  const roof = w(['jt_fr_asphalt_best']);
  ok('roofing → tier wording, wordingTier "better", no sentence of its own',
    roof && roof.kind === 'roof' && roof.text === null && roof.wordingTier === 'better', JSON.stringify(roof));

  const mixA = txt(['jt_gi_k5_seamless_full', 'jt_sf_fascia_board_repair']);
  ok('mixed job, repair unticked → names only the warranted part',
    mixA === '5-year workmanship warranty on ' + byId.jt_gi_k5_seamless_full.name + '.', mixA);
  const mixB = txt(['jt_gi_k5_seamless_full', 'jt_sf_fascia_board_repair'], { repairWarranty: true });
  ok('mixed job, repair ticked → each part named with its own years',
    mixB === '5-year workmanship warranty on ' + byId.jt_gi_k5_seamless_full.name + '. 1-year workmanship warranty on '
      + byId.jt_sf_fascia_board_repair.name + '.', mixB);
  ok('mixed job with a roof → roofing wording for the estimate', w(['jt_fr_asphalt_good', 'jt_gi_k5_seamless_full']).kind === 'roof');
  ok('same years across kinds → one plain sentence',
    txt(['jt_gr_guard_install_50lf', 'jt_sf_soffit_replacement_vented']) === '2-year workmanship warranty.');

  // Config is the source; customer.html (no estimate-config.js) and the
  // server use the fallback copy — which must not drift.
  const cfgTable = JSON.parse(JSON.stringify(CFG.WORKMANSHIP_WARRANTY));
  ok('NBD_ESTIMATE_CONFIG.WORKMANSHIP_WARRANTY == the fallback copy',
    JSON.stringify(cfgTable) === JSON.stringify(ROWS.WORKMANSHIP_WARRANTY_FALLBACK),
    JSON.stringify(cfgTable) + ' vs ' + JSON.stringify(ROWS.WORKMANSHIP_WARRANTY_FALLBACK));
  ok('config: gutter_system 5 / guard_only 2 / install_default 2 / repair 1 opt-in / none 0',
    cfgTable.gutter_system.years === 5 && cfgTable.guard_only.years === 2 && cfgTable.install_default.years === 2
      && cfgTable.repair.years === 1 && cfgTable.repair.optIn === true && cfgTable.none.years === 0 && cfgTable.roof.tierWording === true);
  const ids = ['jt_gi_k5_seamless_full', 'jt_gr_guard_install_50lf', 'jt_gr_hanger_resecure', 'jt_fr_asphalt_good'];
  const same = ids.every((id) => [false, true].every((rw) => {
    const est = payloadFor([id], { repairWarranty: rw });
    return JSON.stringify(ROWS.estimateWarranty(est)) === JSON.stringify(SERVER_ROWS.estimateWarranty(est));
  }));
  ok('server copy (functions/, no window) returns the same result', same);
  ok('functions/customer-estimate-rows.js is byte-identical to the docs copy',
    read(path.join(ROOT, 'functions', 'customer-estimate-rows.js')) === read(path.join(PRO_JS, 'customer-estimate-rows.js')));
}

// ════════════════════════════════════════════════════════════════════
section('5. OLD ESTIMATES — saved before 2026-09-25');
// ════════════════════════════════════════════════════════════════════
function LEGACY(ids, extra) {
  const est = Object.assign(payloadFor(ids), { tier: 'better', selectedTier: 'better' }, extra || {});
  delete est.tierApplies; delete est.warrantyKind; delete est.warrantyParts; delete est.repairWarranty;
  return est;
}
{
  const g = LEGACY(['jt_gi_k5_seamless_full']);
  ok('legacy gutter template estimate: no tier applies', ROWS.tierApplies(g) === false);
  const gw = ROWS.estimateWarranty(g);
  ok('legacy gutter template estimate: no workmanship claim (not lifetime)', gw && gw.text === '' && gw.wordingTier === '', JSON.stringify(gw));
  ok('legacy repair template estimate: no tier', ROWS.tierApplies(LEGACY(['jt_rr_pipe_boot_1'])) === false);
  ok('legacy Duplicate (jt_custom_*) cannot be proven roofing → no claim', ROWS.tierApplies(LEGACY(['jt_custom_my-k5_abc'])) === false);
  const r = LEGACY(['jt_fr_asphalt_better'], { tier: 'best', selectedTier: 'best' });
  ok('legacy roofing template estimate keeps its tier', ROWS.tierApplies(r) === true);
  ok('legacy roofing template estimate: wording untouched (null → caller\'s tier path)', ROWS.estimateWarranty(r) === null);
  ok('legacy roof + gutter mix keeps the roofing tier (unchanged)', ROWS.tierApplies(LEGACY(['jt_gi_k5_seamless_full', 'jt_fr_compact_home'])) === true);
  const v2 = { builder: 'v2', tier: 'best', selectedTier: 'best', priceMode: 'line-item', grandTotal: 9 };
  ok('V2 estimate: tier applies, warranty untouched', ROWS.tierApplies(v2) === true && ROWS.estimateWarranty(v2) === null);
  const classic = { tier: 'good', tierName: 'Standard', lineItems: [], total: 5 };
  ok('classic estimate: tier applies, warranty untouched', ROWS.tierApplies(classic) === true && ROWS.estimateWarranty(classic) === null);
  const reSavedPerSq = Object.assign(payloadFor(['jt_gi_k5_seamless_full']), { builder: 'v2', priceMode: 'per-sq', tier: 'best', prices: { good: 1, better: 2, best: 3 } });
  ok('template estimate re-saved per-SQ in V2: the per-SQ tier applies', ROWS.tierApplies(reSavedPerSq) === true && ROWS.estimateWarranty(reSavedPerSq) === null);
  const reSavedLine = Object.assign(payloadFor(['jt_gi_k5_seamless_full']), { builder: 'v2', tier: 'better', selectedTier: 'better' });
  ok('template estimate re-saved line-item in V2 (merge keeps tierApplies:false): still no tier, still 5-year',
    ROWS.tierApplies(reSavedLine) === false && ROWS.estimateWarranty(reSavedLine).text === '5-year workmanship warranty.');
  ok('null estimate: nothing to suppress', ROWS.tierApplies(null) === true && ROWS.estimateWarranty(null) === null);
}

// ════════════════════════════════════════════════════════════════════
section('6. PORTAL — functions/portal.js tier label (lifted and run)');
// ════════════════════════════════════════════════════════════════════
{
  const PORTAL = read(path.join(ROOT, 'functions', 'portal.js')).replace(/\r\n/g, '\n');
  const m = PORTAL.match(/\n\s*tierName:\s*(tierApplies\(latest\)[\s\S]*?),\n\s*signatureStatus:/);
  ok('found the tierName expression in getHomeownerPortalView', !!m, 'if it moved, update the extractor — do NOT delete the check');
  const v = PORTAL.match(/\n\s*tier:\s*(tierApplies\(est\)[\s\S]*?),\n\s*mode:/);
  ok('found the tier expression in getEstimateForView', !!v);
  ok('portal.js imports tierApplies from the shared module',
    /const \{[^}]*\btierApplies\b[^}]*\} = require\('\.\/customer-estimate-rows'\)/.test(PORTAL));
  if (m && v) {
    const ctx = { tierApplies: SERVER_ROWS.tierApplies };
    vm.createContext(ctx);
    vm.runInContext('this.__name = function (latest) { return (' + m[1] + '); };'
      + 'this.__tier = function (est) { return (' + v[1] + '); };', ctx);
    const name = ctx.__name, tier = ctx.__tier;
    ok('new gutter template estimate → no tier name', name(payloadFor(['jt_gi_k5_seamless_full'])) === null);
    ok('legacy gutter template estimate (tier "better") → no "Preferred"', name(LEGACY(['jt_gi_k5_seamless_full'])) === null,
      JSON.stringify(name(LEGACY(['jt_gi_k5_seamless_full']))));
    ok('legacy roofing template estimate → "Preferred" as before', name(LEGACY(['jt_fr_asphalt_better'])) === 'Preferred');
    ok('V2 estimate tier "best" → "Elite" as before', name({ builder: 'v2', tier: 'best' }) === 'Elite');
    ok('an explicit tierName still wins', name({ builder: 'v2', tier: 'best', tierName: 'Custom Name' }) === 'Custom Name');
    ok('shared estimate view: tier null for a template estimate', tier(LEGACY(['jt_gi_k5_seamless_full'])) === null);
    ok('shared estimate view: V2 tier passes through', tier({ builder: 'v2', tier: 'good' }) === 'good');
  }
}

// ════════════════════════════════════════════════════════════════════
// Paperwork stacks: dashboard (estimate-config loaded) and customer.html
// (not loaded). Real DocPreflight open → submit → NBDDocGen renderer.
// ════════════════════════════════════════════════════════════════════
function docStack(withConfig) {
  const env = makeSandbox({ _brand: () => ({ legalName: 'No Big Deal Home Solutions', colors: {}, contact: {} }) });
  if (withConfig) load(env, 'docs/pro/js/estimate-config.js');
  load(env, 'docs/pro/js/customer-estimate-rows.js');
  load(env, 'docs/pro/js/document-generator.js');
  load(env, 'docs/pro/js/document-generator-templates.js');
  load(env, 'docs/pro/js/doc-preflight.js');
  const w = env.win;
  const toasts = [];
  w.showToast = (m) => toasts.push(m);
  env.toasts = toasts;
  return env;
}
const FIXED = { date: 'September 25, 2026', issueDate: 'September 25, 2026' };
// Opens DocPreflight on `est` for `type`, submits, and returns the renderer's
// HTML plus the captured modal HTML and merged data. generate() is captured,
// then the REAL renderer runs on exactly what it was handed.
function throughPreflight(env, type, est) {
  const w = env.win;
  w._leadDoc = { firstName: 'Jane', lastName: 'Smith', address: '123 Main St, Cincinnati, OH 45202', phone: '5135550100', email: 'j@example.test', scopeOfWork: 'Work as quoted.' };
  w._customerEstimates = est ? [est] : [];
  let captured = null;
  const dg = w.NBDDocGen;
  const realGenerate = dg.generate;
  dg.generate = (t, data) => { captured = data; };
  let modalHtml = '';
  const origCreate = env.sandbox.document.createElement;
  env.sandbox.document.createElement = (tag) => {
    const e = origCreate(tag);
    let inner = '';
    Object.defineProperty(e, 'innerHTML', { get() { return inner; }, set(v) { inner = v; if (String(v).indexOf('dpf-') !== -1) modalHtml = String(v); } });
    return e;
  };
  const before = env.toasts.length;
  try {
    w.DocPreflight.open(type, null);
    if (w.DocPreflight._state.open) {
      w.DocPreflight._state.softAck = true;   // the address is fine; skip the soft warning round-trip
      return Promise.resolve(w.DocPreflight.submit()).then(() => finish());
    }
    return Promise.resolve(finish());
  } catch (e) {
    return Promise.resolve({ error: String(e && e.stack || e) });
  }
  function finish() {
    dg.generate = realGenerate;
    env.sandbox.document.createElement = origCreate;
    const data = captured ? Object.assign({}, captured, FIXED) : null;
    const method = { proposal: 'renderProposal', contract: 'renderContract', warranty_certificate: 'renderWarrantyCertificate' }[type];
    let html = null;
    if (data) { try { html = dg[method](data); } catch (e) { html = 'RENDER_ERROR ' + e.message; } }
    return { html, data, modalHtml, toast: env.toasts.slice(before).join(' | ') };
  }
}

(async function () {
  // ══════════════════════════════════════════════════════════════════
  section('7. PAPERWORK — proposal / contract / certificate by job type');
  // ══════════════════════════════════════════════════════════════════
  for (const withConfig of [true, false]) {
    const tag = withConfig ? '[dashboard]' : '[customer.html]';
    const env = docStack(withConfig);
    const gutter = payloadFor(['jt_gi_k5_seamless_full']);
    for (const type of ['proposal', 'contract']) {
      const r = await throughPreflight(env, type, gutter);
      ok(tag + ' ' + type + ': gutter system renders', r.html && r.html.indexOf('RENDER_ERROR') !== 0, r.error || r.toast);
      if (!r.html) continue;
      ok(tag + ' ' + type + ': prints the 5-year workmanship warranty', r.html.indexOf('5-year workmanship warranty.') !== -1);
      ok(tag + ' ' + type + ': 5-Year badge', r.html.indexOf('5-Year Workmanship Warranty') !== -1);
      ok(tag + ' ' + type + ': no "Preferred", no lifetime workmanship', !/Preferred/.test(r.html) && !/Lifetime Workmanship|Lifetime workmanship/.test(r.html));
      ok(tag + ' ' + type + ': the build screen\'s warranty field shows the estimate\'s sentence, no tier cards',
        /From the estimate/.test(r.modalHtml) && r.modalHtml.indexOf('5-year workmanship warranty.') !== -1
          && !/data-warranty-tier=/.test(r.modalHtml));
      ok(tag + ' ' + type + ': submit was not blocked by the (tierless) required warranty field', !!r.data);
      ok(tag + ' ' + type + ': server contract bridge carries the sentence', r.data && r.data.warranty === '5-year workmanship warranty.');
    }
    // Repair, unticked: the whole Warranty Coverage section is omitted.
    const repairOff = payloadFor(['jt_gr_hanger_resecure']);
    for (const type of ['proposal', 'contract']) {
      const r = await throughPreflight(env, type, repairOff);
      ok(tag + ' ' + type + ': unticked repair renders', r.html && r.html.indexOf('RENDER_ERROR') !== 0, r.error || r.toast);
      if (!r.html) continue;
      ok(tag + ' ' + type + ': unticked repair prints no Warranty Coverage section', r.html.indexOf('Warranty Coverage') === -1);
      ok(tag + ' ' + type + ': unticked repair — no lifetime, no Preferred', !/Lifetime|Preferred/.test(r.html));
      ok(tag + ' ' + type + ': unticked repair — server bridge leaves warranty null', r.data.warranty === null);
    }
    const repairOn = payloadFor(['jt_gr_hanger_resecure'], { repairWarranty: true });
    const ron = await throughPreflight(env, 'contract', repairOn);
    ok(tag + ' contract: ticked repair prints the 1-year warranty', ron.html && ron.html.indexOf('1-year workmanship warranty.') !== -1
      && ron.html.indexOf('1-Year Workmanship Warranty') !== -1);
    // Certificates
    const certG = await throughPreflight(env, 'warranty_certificate', gutter);
    ok(tag + ' certificate: gutter system says 5 years, not lifetime / Preferred tier',
      certG.html && /5-YEAR WORKMANSHIP WARRANTY/.test(certG.html) && /5 years from issue date/.test(certG.html)
        && !/LIFETIME|Lifetime Workmanship|PREFERRED|lifetime coverage/.test(certG.html), certG.error || certG.toast);
    ok(tag + ' certificate: no roofing-materials line on a gutter job', certG.html && !/roofing materials carry/.test(certG.html));
    const certNone = await throughPreflight(env, 'warranty_certificate', repairOff);
    ok(tag + ' certificate: refused for a job with no workmanship warranty', certNone.html === null && /no workmanship warranty/.test(certNone.toast),
      certNone.toast);
    // Legacy (pre-change) gutter template estimate: no Preferred, no lifetime.
    const lg = await throughPreflight(env, 'proposal', LEGACY(['jt_gi_k5_seamless_full']));
    ok(tag + ' legacy gutter estimate proposal: no "Preferred", no lifetime claim',
      lg.html && !/Preferred|Lifetime/.test(lg.html), lg.error || lg.toast);
  }

  // ══════════════════════════════════════════════════════════════════
  section('8. ROOFING — byte-for-byte what a pre-change roofing estimate prints');
  // ══════════════════════════════════════════════════════════════════
  for (const withConfig of [true, false]) {
    const tag = withConfig ? '[dashboard]' : '[customer.html]';
    const env = docStack(withConfig);
    const roofIds = TPLS.filter((t) => t.warrantyKind === 'roof').map((t) => t.id);
    let identical = 0; const diffs = [];
    for (const id of roofIds) {
      const fresh = payloadFor([id]);
      // What the pre-change buildEstimatePayload saved for the same template:
      // tier/selectedTier 'better', none of the new fields.
      const legacy = Object.assign({}, fresh, { tier: 'better', selectedTier: 'better' });
      delete legacy.tierApplies; delete legacy.warrantyKind; delete legacy.warrantyParts; delete legacy.repairWarranty;
      for (const type of ['proposal', 'contract', 'warranty_certificate']) {
        const a = await throughPreflight(env, type, fresh);
        const b = await throughPreflight(env, type, legacy);
        if (a.html && b.html && a.html === b.html && JSON.stringify(a.data) === JSON.stringify(b.data)) identical++;
        else diffs.push(id + ' ' + type);
      }
    }
    ok(tag + ' all ' + roofIds.length + ' roofing templates × proposal/contract/certificate: identical HTML + data to a pre-change estimate',
      diffs.length === 0, diffs.slice(0, 4).join('; '));
    const one = await throughPreflight(env, 'contract', payloadFor(['jt_fr_asphalt_good']));
    const expectSentence = withConfig ? CFG.tierWarrantyText('better') : 'Lifetime workmanship warranty.';
    ok(tag + ' roofing contract still prints the existing wording ("' + expectSentence.slice(0, 40) + '…")',
      one.html && one.html.indexOf(expectSentence) !== -1 && /Preferred: Lifetime Workmanship/.test(one.html));
  }

  // ══════════════════════════════════════════════════════════════════
  section('9. BUILD SCREEN — the real job-templates-ui.js on a fake DOM');
  // ══════════════════════════════════════════════════════════════════
  {
    const env = engineStack(null);
    load(env, 'docs/pro/js/job-templates-ui.js');
    const w = env.win;
    const saved = [];
    w._saveEstimate = (payload) => { saved.push(JSON.parse(JSON.stringify(payload))); return Promise.resolve('est_' + saved.length); };
    const click = (action, id) => env.listeners.click.forEach((fn) => fn({
      target: { closest: () => ({ tagName: 'BUTTON', dataset: { jtAction: action, id: id } }) },
    }));
    const input = (dataset, extra) => env.listeners.change.forEach((fn) => fn({ target: Object.assign({ dataset: dataset }, extra || {}) }));
    const body = () => env.byId.jtModalBody ? env.byId.jtModalBody.innerHTML : '';
    const start = (id) => { click('clear-selection'); click('close-modal'); click('quick-use', id); return body(); };

    ok('UI loaded and bound its delegates', !!w.JobTemplatesUI && !!env.listeners.click && !!env.listeners.change);

    const gutterScreen = start('jt_gi_k5_seamless_full');
    ok('gutter build screen rendered', /jt-topctl/.test(gutterScreen));
    ok('gutter build screen: no Good/Better/Best row', !/data-jt-action="set-tier"/.test(gutterScreen));
    ok('gutter build screen: no repair warranty box', !/set-repair-warranty/.test(gutterScreen));
    const roofScreen = start('jt_fr_asphalt_better');
    ok('roofing build screen: no tier row either (tiers price nothing there too)', !/data-jt-action="set-tier"/.test(roofScreen));
    const repairScreen = start('jt_gr_hanger_resecure');
    ok('repair build screen: shows the 1-year workmanship warranty box', /data-jt-action="set-repair-warranty"/.test(repairScreen)
      && /1-year workmanship warranty/.test(repairScreen));
    ok('repair box is OFF by default', /set-repair-warranty"(?! checked)>/.test(repairScreen));

    // Preview (the rep's on-screen proposal): unticked repair → no warranty line.
    click('go-preview');
    ok('repair preview: no "tier" line, no warranty line while unticked',
      !/ tier</.test(body()) && !/jt-prop-warranty/.test(body()));
    click('back-to-preconfirm');
    input({ jtAction: 'set-repair-warranty' }, { checked: true, type: 'checkbox' });
    ok('ticking the box re-renders it checked', /set-repair-warranty" checked>/.test((click('back-to-preconfirm'), body())));
    click('go-preview');
    ok('repair preview after ticking: prints the 1-year warranty', /jt-prop-warranty[\s\S]*1-year workmanship warranty\./.test(body()));
    click('create-estimate');
    await new Promise((r) => setTimeout(r, 30));
    const last = saved[saved.length - 1];
    ok('Create estimate persists repairWarranty true', last && last.repairWarranty === true, last && JSON.stringify({ rw: last.repairWarranty }));
    ok('…with no tier recorded', last && last.tier === null && last.selectedTier === null && last.tierApplies === false);
    ok('…and the repair kind', last && last.warrantyKind === 'repair');

    // A fresh estimate starts unticked again (never carried over).
    const again = start('jt_gr_hanger_resecure');
    ok('the next estimate starts with the box unticked', /set-repair-warranty"(?! checked)>/.test(again));
    click('go-preview');
    click('create-estimate');
    await new Promise((r) => setTimeout(r, 30));
    const last2 = saved[saved.length - 1];
    ok('an unticked repair saves repairWarranty false', last2 && last2.repairWarranty === false);

    start('jt_gi_k5_seamless_full');
    click('go-preview');
    ok('gutter preview: the 5-year warranty line and no tier line',
      /jt-prop-warranty[\s\S]*5-year workmanship warranty\./.test(body()) && !/ tier</.test(body()));
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });

/**
 * tests/estimate-gutter-source.test.js — one gutter footage per job.
 *
 * Jo's Draw-tool decision 2 (2026-09-25): when gutter runs are drawn, the
 * drawn gutter feet price the gutters; otherwise eave length does, as today.
 * Guards follow the same number. Gutters are never priced twice for one job.
 *
 * Before this, the job's gutter footage depended on which engine priced it:
 *   - EstimateLogic (estimate-logic-engine.js) sized every 'gutters' and
 *     'guards' catalog line from eaveLf, and had no guttersLf variable at all;
 *   - EstimateBuilderV2 (estimate-builder-v2.js) priced gutters from guttersLf,
 *     on the per-SQ quote (calculatePerSq) and on its generated line-item scope.
 * A drawn job with 66.6 + 15.2 = 81.8 LF of gutter and 120 LF of eave
 * therefore carried two gutter footages: 81.8 LF on its per-SQ quote and
 * 120 LF on its catalog scope lines. The Draw tool is about to start sending
 * guttersLf (lane L2), so the estimate side is made safe first.
 *
 * Everything runs against the REAL files in one vm context, booted in the
 * browser's load order, with real catalog items and real Job Templates. No
 * source-text assertion stands in for behaviour: every claim is an executed
 * quantity or amount.
 *
 * Sections:
 *   1. DRAWN JOB     81.8 LF of gutter, 120 LF of eave: every path prices the
 *                    gutters and guards from 81.8, exactly one gutter line
 *   2. NO GUTTER     guttersLf absent / 0 / blank / invalid: eave prices, as
 *                    before; a legacy twin of the engine (main's formula) must
 *                    agree on every Job Template and a spread of V2 scopes;
 *                    fixed-price fixture totals pinned from origin/main
 *   3. ONE TEST      every engine agrees on whether a footage is present
 *
 * Break-tested against origin/main f7408d71, all three engine files swapped
 * back and then each one alone. What goes red on main:
 *   - every section-1 drawn-job row except the four main already got right
 *     (per-SQ alone, generated scope, the 20 LF repair, a typed footage);
 *   - the pinned drawn fixture, and the legacy-twin rows (no GUTTER_LF);
 *   - the negative, non-numeric and infinite rows of the no-charge test and
 *     section 3 (main: a -$42.50 gutter credit, a NaN-quantity gutter line,
 *     and an infinite per-SQ gutter charge).
 * The eave-priced no-gutter rows and the pinned no-gutter fixture stay green.
 *
 * Run: node tests/estimate-gutter-source.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PRO_JS = path.resolve(__dirname, '..', 'docs', 'pro', 'js');
const ENGINE = 'estimate-logic-engine.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failed++; }
}
function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label || 'value') + ' = ' + JSON.stringify(actual) + ' (expected ' + JSON.stringify(expected) + ')');
  }
}
function truthy(cond, label) { if (!cond) throw new Error(label || 'expected truthy'); }
function cents(d) { return Math.round(Number(d) * 100); }
// Run every row and report every failing one, so one bad row cannot hide the
// rows after it (a break-test must show exactly which inputs go red).
function eachRow(rows, fn) {
  const bad = [];
  rows.forEach((r) => { try { fn(r); } catch (e) { bad.push(e.message); } });
  if (bad.length) throw new Error(bad.join('; '));
}

// ── Boot the real browser stack ─────────────────────────────────────────
// `sources` may replace a file's text (the legacy twin below).
function boot(sources) {
  const win = {};
  win.window = win;
  const store = {};
  const ls = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); },
  };
  win.localStorage = ls;
  const sb = {
    window: win, localStorage: ls,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    document: {
      createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {}, setAttribute() {} }),
      addEventListener() {}, removeEventListener() {},
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    },
    navigator: {}, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON,
  };
  vm.createContext(sb);
  [
    'estimate-config.js', 'product-data.js', 'roofivent-catalog.js', 'estimate-labor-catalog.js',
    'estimate-builder-v2.js', 'estimate-catalog-xactimate.js', ENGINE,
    'job-templates-data.js', 'job-templates.js',
    'upgrade-library.js', 'upgrade-pricing.js',
  ].forEach((f) => {
    const src = (sources && sources[f] != null) ? sources[f] : fs.readFileSync(path.join(PRO_JS, f), 'utf8');
    vm.runInContext(src, sb, { filename: f });
  });
  return win;
}

const win = boot();
const EL = win.EstimateLogic;
const V2 = win.EstimateBuilderV2;
const CAT = win.NBD_XACT_CATALOG;
const JT = win.JobTemplates;
const U = win.NBDUpgrades;

// ── The drawn job ───────────────────────────────────────────────────────
// Two gutter runs (66.6 + 15.2 LF) on a house with 120 LF of eave: the Draw
// plan's worked example. Everything else is an ordinary one-story reroof.
const GUTTER = 81.8;
const EAVE = 120;
const JOB = {
  rawSqft: 2400, pitch: 6, stories: 1, eaveLf: EAVE, rakeLf: 90, ridgeLf: 70,
  hipLf: 0, valleyLf: 24, wallLf: 20, pipes: 3, chimneys: 0, skylights: 0,
};
const DRAWN = Object.assign({}, JOB, { guttersLf: GUTTER });

// A V2 catalog scope a rep builds for that job: gutter run, guard, downspout,
// the gutter accessories, and roof lines that are rightly sized off the eave.
const RUN = 'GTR 5K-AL';
const GUARD = 'GTR GG-MESH';
const SCOPE = [RUN, GUARD, 'GTR DSP23-AL', 'GTR HNG-H', 'GTR EC', 'GTR SPLASH',
  'RFG 240-GAF-HDZ', 'RFG GAPR', 'LAB TO1', 'DSP 20YD'];
const SETTINGS = { tier: 'better', mode: 'cash', county: '' };

function scopeItems(W, codes) {
  return (codes || SCOPE).map((c) => {
    const it = W.NBD_XACT_CATALOG.find(c);
    if (!it) throw new Error('catalog code missing: ' + c);
    return it;
  });
}
function lineFor(est, code) { return est.lines.filter((l) => l.code === code); }
// Gutter-RUN lines: what a homeowner reads as "the gutters".
function runLines(lines) { return lines.filter((l) => (l.subcategory || l.sub) === 'gutters'); }

function perSqInput(m) {
  return Object.assign({ pitch: (Number(m.pitch) || 6) + '/12', county: '', mode: 'cash', tier: 'better' }, m);
}
const GUTTER_RATE = Number(V2.loadSettings().addonPrices
  ? V2.loadSettings().addonPrices.guttersLf : V2.ADDON_PRICES.guttersLf);

console.log('\nestimate-gutter-source — boot');
console.log('──────────────────────────────────────────────────');
test('real stack booted: EstimateLogic, EstimateBuilderV2, catalog, Job Templates, Upgrades', () => {
  truthy(EL && typeof EL.resolveEstimate === 'function', 'EstimateLogic');
  truthy(V2 && typeof V2.calculatePerSq === 'function' && typeof V2.calculateLineItem === 'function', 'EstimateBuilderV2');
  truthy(CAT && typeof CAT.find === 'function' && CAT.find(RUN) && CAT.find(GUARD), 'catalog');
  truthy(JT && typeof JT.resolveSelection === 'function', 'JobTemplates');
  truthy(U && typeof U.offeredFor === 'function', 'NBDUpgrades');
  truthy(GUTTER_RATE > 0, 'per-SQ gutter rate ' + GUTTER_RATE);
  eq(CAT.find(RUN).sub, 'gutters', 'fixture: ' + RUN + ' is a gutter run');
  eq(CAT.find(GUARD).sub, 'guards', 'fixture: ' + GUARD + ' is a guard');
});

// ═════════════════════════════════════════════════════════════════════════
console.log('\n1. drawn job — 81.8 LF of gutter, 120 LF of eave: one footage everywhere');
console.log('──────────────────────────────────────────────────');

const drawnEst = EL.resolveEstimate(scopeItems(win), DRAWN, SETTINGS);

test('catalog scope: exactly ONE gutter-run line, and it is 81.8 LF (not the 120 LF eave)', () => {
  const runs = runLines(drawnEst.lines);
  eq(runs.length, 1, 'gutter-run lines');
  eq(runs[0].code, RUN, 'run code');
  eq(runs[0].quantity, GUTTER, 'gutter run LF');
});

test('guards follow the same number: the guard line is 81.8 LF', () => {
  const g = lineFor(drawnEst, GUARD);
  eq(g.length, 1, 'guard lines');
  eq(g[0].quantity, GUTTER, 'guard LF');
});

test('no gutter-footage line anywhere in the scope is sized off the eave', () => {
  const eaveSized = drawnEst.lines.filter((l) => l.category === 'gutters' && l.quantity === EAVE);
  eq(eaveSized.map((l) => l.code).join(','), '', 'gutter lines still at 120');
  // The rest of the gutter category follows the footage too (it has always
  // been sized by the gutter stand-in); downspouts keep their own rule.
  eq(lineFor(drawnEst, 'GTR HNG-H')[0].quantity, GUTTER, 'hangers');
  eq(lineFor(drawnEst, 'GTR DSP23-AL')[0].quantity, 10, 'downspout LF (stories x 10, unchanged)');
});

test('eave lines stay on the eave: gutter apron is still 120 LF', () => {
  eq(lineFor(drawnEst, 'RFG GAPR')[0].quantity, EAVE, 'gutter apron');
});

test('the gutter line\'s money is 81.8 LF of it, to the cent', () => {
  const run = runLines(drawnEst.lines)[0];
  const it = CAT.find(RUN);
  eq(cents(run.lineTotal), cents(GUTTER * (it.materialCost + it.laborCost)), 'run lineTotal');
});

test('per-SQ quote for the same job bills 81.8 LF of gutters, once', () => {
  const t = V2.calculatePerSq(perSqInput(DRAWN));
  eq(cents(t.addOns.gutters), Math.round(GUTTER * GUTTER_RATE * 100), 'per-SQ gutters add-on');
});

test('ONE footage per job: per-SQ quote, catalog gutter line and guard all read 81.8 LF', () => {
  // The defect this file exists for. On main the per-SQ quote billed
  // 81.8 LF (guttersLf) while the catalog scope billed 120 LF (eaveLf).
  const perSqLf = V2.calculatePerSq(perSqInput(DRAWN)).addOns.gutters / GUTTER_RATE;
  const catalogLf = runLines(drawnEst.lines)[0].quantity;
  const guardLf = lineFor(drawnEst, GUARD)[0].quantity;
  truthy(Math.abs(perSqLf - catalogLf) < 0.005 && catalogLf === guardLf,
    'two gutter footages on one job: per-SQ ' + perSqLf.toFixed(2) + ' LF (guttersLf), catalog run '
    + catalogLf + ' LF, guard ' + guardLf + ' LF');
});

test('generated line-item scope (EstimateBuilderV2): one gutter line of 81.8 LF, no eave gutter', () => {
  const t = V2.calculateLineItem(Object.assign({ method: 'line-item' }, perSqInput(DRAWN)));
  const g = t.items.filter((i) => i.category === 'gutters');
  eq(g.length, 1, 'gutter lines');
  eq(g[0].qty, GUTTER, 'gutter LF');
  const spec = V2.CATALOG[g[0].catalogKey];
  eq(cents(g[0].lineTotal), cents(GUTTER * (spec.cost + spec.labor)), 'gutter line total');
});

test('explicit scope handed to EstimateBuilderV2 with guttersLf: still exactly one gutter line, 81.8 LF', () => {
  // The catalog scope's resolved lines, as V2 line items, plus the job's
  // guttersLf. The gutter must not ALSO be generated from guttersLf.
  const lineItems = drawnEst.lines.map((l) => ({
    code: l.code, name: l.name, category: l.category, unit: l.unit,
    qty: l.quantity, materialCost: l.materialCostPerUnit, laborCost: l.laborCostPerUnit,
  }));
  const t = V2.calculateLineItem(Object.assign({ method: 'line-item', lineItems }, perSqInput(DRAWN)));
  const g = t.items.filter((i) => i.category === 'gutters' && /^GTR (5K|6K|HR|BOX)-|^GUT-/.test(i.code));
  eq(g.length, 1, 'gutter-run lines');
  eq(g[0].qty, GUTTER, 'gutter LF');
});

test('Job Template repair keeps its stated section: a 20 LF section replace stays 20 LF on a drawn job', () => {
  const r = JT.resolveSelection([{ templateId: 'jt_gr_section_replace_20lf' }],
    { tier: 'better', jobMode: 'cash', county: '', measurements: { eaveLf: EAVE, guttersLf: GUTTER } });
  const run = r.lines.filter((l) => l.code === RUN);
  eq(run.length, 1, 'run lines');
  eq(run[0].quantity, 20, 'section LF (an explicit quantity always wins)');
  eq(r.measurements.guttersLf, GUTTER, 'the drawn footage reached the template context');
});

test('Upgrades: a guard on existing gutters is priced at the drawn footage, not refused', () => {
  // Cleaning template: no run lines, so on main the guard had no quantity
  // and only the template eave as a suggestion.
  const id = 'jt_gr_clean_1story';
  const r = JT.resolveSelection([{ templateId: id }],
    { tier: 'better', jobMode: 'cash', county: '', measurements: { eaveLf: EAVE, guttersLf: GUTTER } });
  const ctx = { templateIds: [id], lines: r.lines, measurements: r.measurements, taxRate: 0.07 };
  const o = U.offeredFor(id, ctx).find((x) => x.id === 'alurex');
  eq(o.state, 'available', 'offer state');
  eq(o.qty, Math.ceil(GUTTER), 'guard LF (81.8 rounds up to 82)');
  eq(o.qtySource, 'guttersLf', 'qtySource');
  const p = U.price(['alurex'], ctx);
  eq(p.errors.length, 0, 'price errors: ' + JSON.stringify(p.errors));
  eq(p.upgradeCents, Math.ceil(GUTTER) * o.unitCents, 'guard cents');
});

test('Upgrades: over a whole-house gutter run, the guard follows the run the scope bills (81.8 LF)', () => {
  // The same scope without its base guard (a base guard hides the upgrade).
  const id = 'jt_gi_k5_seamless_full';
  const est = EL.resolveEstimate(scopeItems(win, SCOPE.filter((c) => c !== GUARD)), DRAWN, SETTINGS);
  const ctx = { templateIds: [id], lines: est.lines, measurements: DRAWN, taxRate: 0.07 };
  const o = U.offeredFor(id, ctx).find((x) => x.id === 'alurex');
  eq(o.state, 'available', 'offer state (' + o.reason + ')');
  eq(o.qtySource, 'gutter_lines', 'qtySource');
  eq(o.qty, Math.ceil(runLines(est.lines)[0].quantity), 'guard LF == the billed gutter run');
  eq(o.qty, Math.ceil(GUTTER), 'guard LF');
});

test('Upgrades: a rep-typed guard footage still wins over the drawn one', () => {
  const id = 'jt_gr_clean_1story';
  const r = JT.resolveSelection([{ templateId: id }], { tier: 'better', jobMode: 'cash', county: '', measurements: { guttersLf: GUTTER } });
  const base = { templateIds: [id], lines: r.lines, measurements: r.measurements, taxRate: 0.07 };
  eq(U.offeredFor(id, Object.assign({ gutterLf: 140 }, base)).find((x) => x.id === 'alurex').qty, 140, 'ctx.gutterLf');
  eq(U.offeredFor(id, Object.assign({ quantities: { alurex: 95 } }, base)).find((x) => x.id === 'alurex').qty, 95, 'typed qty');
});

test('no shipped Job Template carries a guttersLf, so a guttersLf is always the caller\'s measurement', () => {
  // upgrade-pricing prices a guard from measurements.guttersLf on that basis
  // (a template default is only ever a suggestion there).
  const withIt = (win.NBD_JOB_TEMPLATES || []).filter((t) => t.measurements && t.measurements.guttersLf != null);
  truthy((win.NBD_JOB_TEMPLATES || []).length >= 100, 'templates loaded');
  eq(withIt.map((t) => t.id).join(','), '', 'templates with a guttersLf');
});

// ═════════════════════════════════════════════════════════════════════════
console.log('\n2. no drawn gutter — eave prices, exactly as before');
console.log('──────────────────────────────────────────────────');

const ABSENT = [
  ['absent', {}], ['0', { guttersLf: 0 }], ['blank', { guttersLf: '' }], ['null', { guttersLf: null }],
  ['negative', { guttersLf: -5 }], ['text', { guttersLf: 'abc' }], ['NaN', { guttersLf: NaN }],
];

test('guttersLf absent, 0, blank, null, negative or non-numeric: gutter run and guard are 120 LF (eave)', () => {
  eachRow(ABSENT, ([label, g]) => {
    const est = EL.resolveEstimate(scopeItems(win), Object.assign({}, JOB, g), SETTINGS);
    eq(runLines(est.lines)[0].quantity, EAVE, label + ' run');
    eq(lineFor(est, GUARD)[0].quantity, EAVE, label + ' guard');
  });
});

test('per-SQ quote and generated scope with no gutter footage: no gutter charge at all', () => {
  // As before for absent / 0 / blank / null. Negative and non-numeric are the
  // fix: main priced -5 LF as a $42.50 gutter CREDIT on the per-SQ quote and
  // put a NaN-quantity gutter line in the generated scope.
  eachRow(ABSENT, ([label, g]) => {
    const input = perSqInput(Object.assign({}, JOB, g));
    eq(V2.calculatePerSq(input).addOns.gutters, 0, label + ' per-SQ gutters');
    const li = V2.calculateLineItem(Object.assign({ method: 'line-item' }, input));
    eq(li.items.filter((i) => i.category === 'gutters').length, 0, label + ' generated gutter lines');
  });
});

// Legacy twin: this file's own engine source with GUTTER_LF put back to
// main's plain 'eaveLf'. Everything else in the twin is byte-identical, so
// any disagreement with no gutter footage is a behaviour change the rule
// does not allow. Built from the live source, so catalog or template edits
// can never make this stale.
const LIVE_SRC = fs.readFileSync(path.join(PRO_JS, ENGINE), 'utf8');
const RULE = "const GUTTER_LF = 'guttersLf > 0 ? guttersLf : eaveLf';";
let twin = null;

test('legacy twin builds: GUTTER_LF is defined exactly once, as the documented rule', () => {
  eq(LIVE_SRC.split(RULE).length - 1, 1, 'GUTTER_LF definitions');
  eq(EL.QTY_BY_SUB.gutters, EL.QTY_BY_SUB.guards, 'gutters and guards share one formula');
  twin = boot({ [ENGINE]: LIVE_SRC.replace(RULE, "const GUTTER_LF = 'eaveLf';") });
  eq(twin.EstimateLogic.QTY_BY_SUB.gutters, 'eaveLf', 'twin formula');
});

// Numbers only: qtyFormula is descriptive text and the context gains a
// guttersLf key (0 when absent), neither of which is money.
function money(o) {
  return JSON.stringify(o, (k, v) => {
    if (k === 'qtyFormula') return undefined;
    if (k === 'context' && v && typeof v === 'object') { const c = Object.assign({}, v); delete c.guttersLf; return c; }
    return v;
  });
}

test('every Job Template, every tier and job mode, prices identically to the legacy engine', () => {
  truthy(twin, 'twin not built');
  const ids = (win.NBD_JOB_TEMPLATES || []).map((t) => t.id);
  let n = 0;
  ids.forEach((id) => ['good', 'better', 'best'].forEach((tier) => ['cash', 'insurance'].forEach((jobMode) => {
    const a = JT.resolveSelection([{ templateId: id }], { tier, jobMode, county: '' });
    const b = twin.JobTemplates.resolveSelection([{ templateId: id }], { tier, jobMode, county: '' });
    eq(money(a.totals), money(b.totals), id + ' ' + tier + ' ' + jobMode);
    n++;
  })));
  truthy(n >= 600, 'only ' + n + ' template cases — vacuous?');
});

test('every gutter catalog item, over a spread of roofs, prices identically to the legacy engine', () => {
  truthy(twin, 'twin not built');
  const codes = CAT.byCat('gutters').map((i) => i.code).concat(['RFG 240-GAF-HDZ', 'RFG GAPR', 'LAB TO1', 'DSP 20YD']);
  truthy(codes.length >= 20, 'only ' + codes.length + ' codes');
  const roofs = [
    {}, { rawSqft: 1200, pitch: 4, eaveLf: 80, rakeLf: 60, ridgeLf: 40 }, JOB,
    { rawSqft: 3000, pitch: 8, stories: 2, eaveLf: 137.3, rakeLf: 110, ridgeLf: 80, cutUpRoof: 1 },
    { rawSqft: 9000, pitch: 10, stories: 3, eaveLf: 300, rakeLf: 240, ridgeLf: 160 },
  ];
  let n = 0;
  roofs.forEach((roof, ri) => ABSENT.forEach(([label, g]) => ['cash', 'insurance'].forEach((mode) => {
    const m = Object.assign({}, roof, g);
    const s = { tier: 'better', mode, county: '' };
    const a = EL.resolveEstimate(scopeItems(win, codes), m, s);
    const b = twin.EstimateLogic.resolveEstimate(scopeItems(twin, codes), m, s);
    eq(money(a), money(b), 'roof ' + ri + ' ' + label + ' ' + mode);
    n++;
  })));
  truthy(n >= 70, 'only ' + n + ' scope cases');
});

test('the twin is not blind: with a drawn footage it disagrees with the live engine', () => {
  truthy(twin, 'twin not built');
  const a = runLines(EL.resolveEstimate(scopeItems(win), DRAWN, SETTINGS).lines)[0].quantity;
  const b = runLines(twin.EstimateLogic.resolveEstimate(scopeItems(twin), DRAWN, SETTINGS).lines)[0].quantity;
  eq(a, GUTTER, 'live'); eq(b, EAVE, 'twin');
});

// Fixed-price fixture: explicit per-unit costs and explicit settings, so no
// catalog, config or tenant edit can move these numbers. The ABSENT totals
// were measured on origin/main f7408d71 and must never move; the DRAWN ones
// are the rule (main priced 120 LF there too, i.e. the ABSENT figures).
const FX_ITEMS = [
  { code: 'FX RUN', name: 'Fixture gutter run', sub: 'gutters', category: 'gutters', unit: 'LF', materialCost: 4, laborCost: 3 },
  { code: 'FX GUARD', name: 'Fixture guard', sub: 'guards', category: 'gutters', unit: 'LF', materialCost: 6, laborCost: 2 },
  { code: 'FX HANGER', name: 'Fixture hanger', sub: 'accessories', category: 'gutters', unit: 'EA', materialCost: 2, laborCost: 1 },
  { code: 'FX DSP', name: 'Fixture downspout', sub: 'downspout', category: 'gutters', unit: 'LF', materialCost: 3, laborCost: 2 },
  { code: 'FX STARTER', name: 'Fixture starter', sub: 'starter', category: 'roofing', unit: 'LF', materialCost: 1, laborCost: 1 },
];
const FX_SETTINGS = {
  tier: 'better', mode: 'cash', county: '', countyTax: {}, fallbackTaxRate: 0.07,
  overheadPct: 0.10, profitPct: 0.10, materialMarkupPct: 0.25, roundTo: 25,
};
function fx(m) {
  const e = EL.resolveEstimate(FX_ITEMS, m, FX_SETTINGS);
  return {
    qty: e.lines.map((l) => l.code + '=' + l.quantity).join(' '),
    retailBeforeOHP: cents(e.retailBeforeOHP), subtotal: cents(e.subtotal), tax: cents(e.tax), total: cents(e.total),
  };
}

test('fixture, no gutter footage: totals pinned from origin/main', () => {
  const want = {
    qty: 'FX RUN=120 FX GUARD=120 FX HANGER=120 FX DSP=20 FX STARTER=120',
    retailBeforeOHP: 290500, subtotal: 348600, tax: 24402, total: 372500,
  };
  eachRow(ABSENT, ([label, g]) => {
    const got = fx(Object.assign({ stories: 2, eaveLf: EAVE }, g));
    Object.keys(want).forEach((k) => eq(got[k], want[k], label + ' ' + k));
  });
});

test('fixture, drawn 81.8 LF: gutter run, guard and hangers at 81.8, starter still at 120', () => {
  const got = fx({ stories: 2, eaveLf: EAVE, guttersLf: GUTTER });
  eq(got.qty, 'FX RUN=81.8 FX GUARD=81.8 FX HANGER=81.8 FX DSP=20 FX STARTER=120', 'quantities');
  // By hand: material 1,161.60 x 1.25 + labor 650.80 = 2,102.80; x 1.20 O&P =
  // 2,523.36; 7% tax 176.6352; 2,699.9952 rounds to the nearest $25 = 2,700.
  eq(got.retailBeforeOHP, 210280, 'retailBeforeOHP');
  eq(got.subtotal, 252336, 'subtotal');
  eq(got.tax, 17664, 'tax');
  eq(got.total, 270000, 'total');
});

// ═════════════════════════════════════════════════════════════════════════
console.log('\n3. one test for "a gutter footage is present", on every path');
console.log('──────────────────────────────────────────────────');

test('present exactly when finite and above zero — EstimateLogic, per-SQ and generated scope agree', () => {
  const rows = [
    [GUTTER, true], ['81.8', true], [150, true], [0.5, true],
    [0, false], ['', false], [null, false], [undefined, false], [-5, false], ['abc', false],
    [NaN, false], [Infinity, false], [-Infinity, false],
  ];
  eachRow(rows, ([v, present]) => {
    const m = Object.assign({}, JOB, { guttersLf: v });
    const label = 'guttersLf=' + String(v);
    const run = runLines(EL.resolveEstimate(scopeItems(win), m, SETTINGS).lines)[0].quantity;
    eq(run, present ? Number(v) : EAVE, label + ' catalog run');
    const ps = V2.calculatePerSq(perSqInput(m)).addOns.gutters;
    eq(cents(ps), present ? Math.round(Number(v) * GUTTER_RATE * 100) : 0, label + ' per-SQ gutters');
    const gen = V2.calculateLineItem(Object.assign({ method: 'line-item' }, perSqInput(m))).items
      .filter((i) => i.category === 'gutters');
    eq(gen.length, present ? 1 : 0, label + ' generated gutter lines');
    if (present) eq(gen[0].qty, Number(v), label + ' generated gutter LF');
  });
});

console.log('\n──────────────────────────────────────────────────');
console.log('estimate-gutter-source: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

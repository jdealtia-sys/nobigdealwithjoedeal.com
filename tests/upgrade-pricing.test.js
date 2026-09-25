/**
 * tests/upgrade-pricing.test.js
 *
 * Upgrades & Add-ons core (2026-09-25): docs/pro/js/upgrade-library.js
 * (window.NBD_UPGRADE_LIBRARY) + docs/pro/js/upgrade-pricing.js
 * (window.NBDUpgrades). Design: documentation/projects/
 * UPGRADES-ADDONS-DESIGN-2026-09-25.md.
 *
 * Everything runs against the REAL files in one vm context, booted in the
 * browser's load order (estimate config → catalogs → EstimateBuilderV2 →
 * EstimateLogic → Job Templates → the three row readers → the upgrade files),
 * with REAL inputs: resolveSelection() lines from real templates and a real
 * buildEstimatePayload() doc. No string-shape assertions stand in for
 * behavior — every money claim is an executed number.
 *
 * Sections:
 *   1. LIBRARY      retail-only data, Jo's four approved prices, needs_price
 *                   items carry NO price, families ≤ 5 offers, every gutter
 *                   template mapped
 *   2. COPY         warranty honesty per item, banned brands anywhere in the
 *                   two files, no pressure/free copy, tenant-neutral installer
 *   3. OFFERS       nothing pre-picked; eligibility (copper, steel, half-round,
 *                   3x4 already); family hides; base-scope double-bill guard;
 *                   quantities follow gutter footage and never guess
 *   4. PRICE        exact cents (137 LF × $18 = $2,466.00), one-per-group,
 *                   needs_price refused, requires, overrides sanitized, tax
 *   5. ROUND-TRIP   rows through the three REAL readers (buildDisplayRows,
 *                   buildDocLineItems, InvoicePipeline.buildRowItems) and the
 *                   functions/ mirror the portal uses: printed == quoted to
 *                   the cent, and the total moves by exactly the quote
 *   6. TOTALS       job-minimum floor unwound and re-applied to the whole job
 *
 * Run: node tests/upgrade-pricing.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PRO_JS = path.join(ROOT, 'docs', 'pro', 'js');
const LIB_PATH = path.join(PRO_JS, 'upgrade-library.js');
const PRICING_PATH = path.join(PRO_JS, 'upgrade-pricing.js');

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
function cents(dollars) { return Math.round(Number(dollars) * 100); }

// ── Boot the real browser stack ─────────────────────────────────────────
function boot() {
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
    'estimate-builder-v2.js', 'estimate-catalog-xactimate.js', 'estimate-logic-engine.js',
    'job-templates-data.js', 'job-templates.js',
    'customer-estimate-rows.js', 'invoice-pipeline.js',
    'upgrade-library.js', 'upgrade-pricing.js',
  ].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(PRO_JS, f), 'utf8'), sb, { filename: f });
  });
  return win;
}

const win = boot();
const U = win.NBDUpgrades;
const LIB = win.NBD_UPGRADE_LIBRARY;
const JT = win.JobTemplates;
const CR = win.NBDCustomerEstimateRows;
const IP = win.InvoicePipeline;
// The portal's server-side quote requires this byte-identical mirror.
const CR_SERVER = require(path.join(ROOT, 'functions', 'customer-estimate-rows.js'));

function resolve(id, choices) {
  const r = JT.resolveSelection([{ templateId: id, itemChoices: choices || undefined }],
    { tier: 'better', jobMode: 'cash', county: '' });
  if (!r || !r.totals) throw new Error('resolveSelection failed for ' + id + ': ' + (r && r.warnings));
  return r;
}
function ctxFor(ids, r, extra) {
  return Object.assign({
    templateIds: Array.isArray(ids) ? ids : [ids],
    lines: r.lines, measurements: r.measurements, taxRate: 0.07,
  }, extra || {});
}
function offerMap(list) { const m = {}; list.forEach((o) => { m[o.id] = o; }); return m; }
function codes(errors) { return errors.map((e) => e.code); }

const LEAF = ['amerimax_lockin_mesh', 'leafblaster_pro_micromesh', 'leafblaster_pro_reinforced', 'alurex'];
const NEEDS_PRICE = ['underground_drain', 'popup_emitter', 'flip_up_extension', 'gutter_apron', 'downspout_3x4_step_up', 'fascia_wrap'];
const K5 = 'jt_gi_k5_seamless_full';
// The K5 full-wrap template with its gutter run set to 137 LF: the design
// note's worked example (137 LF × $18 = $2,466.00).
const k5 = resolve(K5, { 1: { qty: 137 } });

console.log('\nupgrade-pricing — boot');
console.log('──────────────────────────────────────────────────');
test('real stack booted: library, pricing, Job Templates and all three readers loaded', () => {
  truthy(U && typeof U.price === 'function' && typeof U.offeredFor === 'function', 'NBDUpgrades missing');
  truthy(LIB && Array.isArray(LIB.items), 'NBD_UPGRADE_LIBRARY missing');
  truthy(JT && typeof JT.buildEstimatePayload === 'function', 'JobTemplates missing');
  truthy(CR && typeof CR.buildDisplayRows === 'function' && typeof CR.buildDocLineItems === 'function', 'NBDCustomerEstimateRows missing');
  truthy(IP && typeof IP.buildRowItems === 'function', 'InvoicePipeline.buildRowItems missing');
  eq(U.version, LIB.version, 'NBDUpgrades.version');
});

// ═════════════════════════════════════════════════════════════════════════
console.log('\n1. library — retail only, Jo-approved prices, needs_price carries none');
console.log('──────────────────────────────────────────────────');

const byId = {};
LIB.items.forEach((it) => { byId[it.id] = it; });

test('library is deep-frozen (a page cannot reprice it at runtime)', () => {
  truthy(Object.isFrozen(LIB) && Object.isFrozen(LIB.items) && LIB.items.every(Object.isFrozen), 'not frozen');
  truthy(Object.isFrozen(LIB.families.new_gutters.offers), 'family offers not frozen');
});

test('ids and codes are unique; every code is an UPG code; units are LF or EA', () => {
  const ids = new Set(), cs = new Set();
  LIB.items.forEach((it) => {
    truthy(!ids.has(it.id), 'duplicate id ' + it.id); ids.add(it.id);
    truthy(!cs.has(it.code), 'duplicate code ' + it.code); cs.add(it.code);
    truthy(/^UPG [A-Z0-9-]+$/.test(it.code), 'bad code ' + it.code);
    truthy(it.unit === 'LF' || it.unit === 'EA', it.id + ' unit ' + it.unit);
  });
});

test('Jo\'s four leaf-protection prices, exact integer cents (2026-09-25)', () => {
  eq(byId.amerimax_lockin_mesh.retailCents, 600, 'Amerimax Lock-In');
  eq(byId.leafblaster_pro_micromesh.retailCents, 1200, 'LeafBlaster PRO micromesh');
  eq(byId.leafblaster_pro_reinforced.retailCents, 1500, 'LeafBlaster PRO Frame-Reinforced');
  eq(byId.alurex.retailCents, 1800, 'Alu-Rex');
  eq(byId.alurex.retailCents, 3 * byId.amerimax_lockin_mesh.retailCents, 'Alu-Rex = triple the screen rate');
  LEAF.forEach((id) => {
    eq(byId[id].priceStatus, 'approved', id + ' priceStatus');
    eq(byId[id].priceApproved, '2026-09-25', id + ' priceApproved');
    eq(byId[id].group, 'leaf_protection', id + ' group');
    eq(byId[id].unit, 'LF', id + ' unit');
  });
});

test('exactly four leaf-protection items, and they are the four above', () => {
  const leaf = LIB.items.filter((it) => it.group === 'leaf_protection').map((it) => it.id).sort();
  eq(leaf.join(','), LEAF.slice().sort().join(','), 'leaf group');
  eq(LIB.groups.leaf_protection.pick, 'one', 'pick rule');
});

test('the six unpriced upgrades exist with priceStatus needs_price and retailCents null', () => {
  NEEDS_PRICE.forEach((id) => {
    truthy(byId[id], id + ' missing');
    eq(byId[id].priceStatus, 'needs_price', id + ' priceStatus');
    eq(byId[id].retailCents, null, id + ' retailCents');
    eq(byId[id].priceApproved, null, id + ' priceApproved');
  });
  eq(LIB.items.length, LEAF.length + NEEDS_PRICE.length, 'item count');
});

test('popup emitter requires the underground drain; installers are company or certified_sub', () => {
  eq(byId.popup_emitter.requires.join(','), 'underground_drain', 'requires');
  LIB.items.forEach((it) => truthy(it.installer === 'company' || it.installer === 'certified_sub', it.id + ' installer'));
  eq(byId.alurex.installer, 'certified_sub', 'alurex installer');
  eq(byId.alurex.certification, 'Alu-Rex', 'alurex certification');
  ['amerimax_lockin_mesh', 'leafblaster_pro_micromesh', 'leafblaster_pro_reinforced'].forEach((id) =>
    eq(byId[id].installer, 'company', id + ' installer'));
});

test('no cost / margin / contractor / wholesale key anywhere in the library object', () => {
  const bad = [];
  (function walk(o, p) {
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach((k) => {
      if (/cost|margin|contractor|wholesale|dealer|buy|markup/i.test(k)) bad.push(p + '.' + k);
      walk(o[k], p + '.' + k);
    });
  })(LIB, 'LIB');
  eq(bad.join(', '), '', 'private-shaped keys');
});

test('every family offers at most 5 (a pick-one group counts once) and names only real ids', () => {
  Object.keys(LIB.families).forEach((f) => {
    const fam = LIB.families[f];
    truthy(fam.offers.length <= 5, f + ' offers ' + fam.offers.length);
    fam.offers.concat(Object.keys(fam.hide)).forEach((k) =>
      truthy(LIB.groups[k] || byId[k], f + ' names unknown id ' + k));
    truthy(typeof fam.newGutters === 'boolean' && typeof fam.eaveLfIsWholeHouse === 'boolean', f + ' flags');
  });
});

test('every gutters_install / gutters_repair template is mapped, and every mapped id is one', () => {
  const gutter = win.NBD_JOB_TEMPLATES.filter((t) => t.category === 'gutters_install' || t.category === 'gutters_repair');
  truthy(gutter.length >= 18, 'only ' + gutter.length + ' gutter templates — data file changed?');
  const unmapped = gutter.filter((t) => !LIB.templates[t.id]).map((t) => t.id);
  eq(unmapped.join(','), '', 'unmapped gutter templates');
  const ids = new Set(gutter.map((t) => t.id));
  const stale = Object.keys(LIB.templates).filter((id) => !ids.has(id));
  eq(stale.join(','), '', 'mapped ids that are not gutter templates');
  Object.keys(LIB.templates).forEach((id) => truthy(LIB.families[LIB.templates[id]], id + ' → unknown family'));
});

// ═════════════════════════════════════════════════════════════════════════
console.log('\n2. copy honesty');
console.log('──────────────────────────────────────────────────');

// Every homeowner-facing string the library can produce, variants included.
function libraryCopy() {
  const out = [];
  LIB.items.forEach((it) => {
    ['name', 'benefit', 'warrantyLine', 'notCovered'].forEach((k) => { if (it[k]) out.push([it.id + '.' + k, it[k]]); });
    Object.keys(it.variants || {}).forEach((v) => ['name', 'benefit', 'warrantyLine', 'notCovered'].forEach((k) => {
      if (it.variants[v][k]) out.push([it.id + '.' + v + '.' + k, it.variants[v][k]]);
    }));
  });
  return out;
}

const OVERCLAIM = /lifetime|no[\s-]?clog|clog[\s-]?free|never clogs?|guarantee/i;
test('LeafBlaster PRO (both) and Amerimax never say lifetime / no-clog / clog-free / guarantee', () => {
  ['amerimax_lockin_mesh', 'leafblaster_pro_micromesh', 'leafblaster_pro_reinforced'].forEach((id) => {
    const it = byId[id];
    [it.name, it.benefit, it.warrantyLine, it.notCovered].forEach((s) => {
      if (s) truthy(!OVERCLAIM.test(s), id + ' over-claims: "' + s + '"');
    });
  });
});

test('LeafBlaster PRO warranty is the 40-year limited PARTS warranty, no clog coverage', () => {
  ['leafblaster_pro_micromesh', 'leafblaster_pro_reinforced'].forEach((id) => {
    eq(byId[id].warrantyLine, '40-year limited parts warranty.', id + ' warrantyLine');
    truthy(/Parts only/.test(byId[id].notCovered) && /does not cover clogging/.test(byId[id].notCovered), id + ' notCovered');
  });
  truthy(/excessive-snowfall/.test(byId.leafblaster_pro_reinforced.notCovered), 'Frame-Reinforced snowfall exclusion');
  truthy(!/snow/i.test(byId.leafblaster_pro_micromesh.notCovered), 'micromesh must not borrow the Frame-Reinforced exclusion');
});

test('Amerimax Lock-In states its own 10-year limited manufacturer warranty and nothing more', () => {
  eq(byId.amerimax_lockin_mesh.warrantyLine, 'Amerimax 10-year limited manufacturer warranty.', 'warrantyLine');
});

test('Alu-Rex: lifetime clog-free LIMITED, transferable once; pine areas only on the new-gutter model', () => {
  const v = byId.alurex.variants;
  [v.existing.warrantyLine, v['new'].warrantyLine].forEach((w) => {
    truthy(/lifetime clog-free limited warranty/.test(w), 'limited wording: ' + w);
    truthy(/transferable once/.test(w), 'transfer wording: ' + w);
  });
  truthy(/pine/.test(v['new'].warrantyLine), 'DoublePro covers pine areas');
  truthy(!/pine/.test(v.existing.warrantyLine), 'Gutter Clean Pro must not claim pine coverage');
  eq(v.existing.name, 'Alu-Rex Gutter Clean Pro gutter guard', 'existing-gutter product');
  eq(v['new'].name, 'Alu-Rex DoublePro gutter guard', 'new-gutter product');
});

test('no dealer-locked or dropped guard brand anywhere in either file (comments included)', () => {
  const BRANDS = /Leaf\s*Filter|\bLeafGuard\b|Gutter\s*Helmet|Leaf\s*Sentry/i;
  [LIB_PATH, PRICING_PATH].forEach((p) => {
    const m = fs.readFileSync(p, 'utf8').match(BRANDS);
    truthy(!m, path.basename(p) + ' names "' + (m && m[0]) + '"');
  });
});

// "clog-free" is Alu-Rex's own warranty term and is allowed; every other
// "free" (hands-free, maintenance-free, free install) is not.
const PRESSURE = [
  [/(?<!clog-)\bfree\b/i, '"free"'],
  [/today only/i, '"today only"'],
  [/limited[\s-]time/i, '"limited time"'],
  [/act now|hurry|while supplies/i, 'urgency'],
  [/our (own )?crews?\b|in-house|our installers/i, 'in-house crew claim'],
];
function assertNoPressure(pairs) {
  pairs.forEach(([where, s]) => PRESSURE.forEach(([re, what]) => {
    truthy(!re.test(s), where + ' carries ' + what + ': "' + s + '"');
  }));
}

test('library copy: no free / today only / limited time / urgency / in-house claims', () => {
  assertNoPressure(libraryCopy());
});

test('generated copy (every offer on every gutter template, every priced row) is just as clean', () => {
  const pairs = [];
  const tenants = [null, { certifiedInstallerName: 'Acme Gutter Co' }];
  const allPriced = {};
  LIB.items.forEach((it) => { allPriced[it.id] = 999; });
  Object.keys(LIB.templates).forEach((id) => {
    const r = resolve(id);
    tenants.forEach((tenant) => {
      U.offeredFor(id, ctxFor(id, r, { tenant, gutterLf: 100, downspoutCount: 4, quantities: { underground_drain: 20, popup_emitter: 1 } }), allPriced)
        .forEach((o) => ['name', 'benefit', 'warrantyLine', 'notCovered', 'installerLine', 'reason', 'check']
          .forEach((k) => { if (o[k]) pairs.push([id + ' ' + o.id + '.' + k, o[k]]); }));
    });
  });
  const p = U.price(['alurex', 'underground_drain', { id: 'popup_emitter', qty: 1 }],
    ctxFor(K5, k5, { tenant: { certifiedInstallerName: 'Acme Gutter Co' }, quantities: { underground_drain: 20 } }), allPriced);
  eq(p.errors.length, 0, 'fixture errors');
  p.rows.forEach((r) => ['desc', 'upgradeWarranty', 'upgradeNotCovered', 'upgradeInstaller']
    .forEach((k) => { if (r[k]) pairs.push(['row ' + r.upgradeId + '.' + k, r[k]]); }));
  truthy(pairs.length > 150, 'only ' + pairs.length + ' strings swept — vacuous?');
  assertNoPressure(pairs);
  pairs.filter(([w]) => /(amerimax|leafblaster)/.test(w) && /\.(name|benefit|warrantyLine|notCovered)$/.test(w))
    .forEach(([w, s]) => truthy(!OVERCLAIM.test(s), w + ' over-claims: "' + s + '"'));
});

test('the pressure scanner is not vacuous (it flags each banned shape, and passes clog-free)', () => {
  ['Free install', 'hands-free', 'Today only!', 'limited-time price', 'our crew installs it', 'in-house install']
    .forEach((s) => truthy(PRESSURE.some(([re]) => re.test(s)), 'scanner missed "' + s + '"'));
  truthy(!PRESSURE.some(([re]) => re.test('lifetime clog-free limited warranty')), 'scanner flags clog-free');
});

test('installer line is tenant neutral: no name → "an independent certified installer"', () => {
  eq(U.installerLine(byId.alurex, null), 'Installed by an independent certified installer.', 'no tenant');
  eq(U.installerLine(byId.alurex, { certifiedInstallerName: '   ' }), 'Installed by an independent certified installer.', 'blank name');
  eq(U.installerLine(byId.alurex, { certifiedInstallerName: 'Acme Gutter Co' }),
    'Installed by Acme Gutter Co, an independent Alu-Rex-certified installer.', 'named');
  eq(U.installerLine(byId.alurex, { certifiedInstallerName: 'Acme\n\tGutter   Co' }),
    'Installed by Acme Gutter Co, an independent Alu-Rex-certified installer.', 'control chars collapsed');
  truthy(U.installerLine(byId.alurex, { certifiedInstallerName: 'x'.repeat(500) }).length < 160, 'name length capped');
  eq(U.installerLine(byId.leafblaster_pro_micromesh, { certifiedInstallerName: 'Acme' }), null, 'company-installed item has no installer line');
});

// ═════════════════════════════════════════════════════════════════════════
console.log('\n3. offeredFor — eligibility, hides, quantities, nothing pre-picked');
console.log('──────────────────────────────────────────────────');

test('K5 system: leaf group + drain/emitter/step-up offered; NOTHING picked or recommended', () => {
  const offers = U.offeredFor(K5, ctxFor(K5, k5));
  const m = offerMap(offers);
  LEAF.forEach((id) => { eq(m[id].state, 'available', id); eq(m[id].qty, 137, id + ' qty'); eq(m[id].qtySource, 'gutter_lines', id + ' qtySource'); });
  eq(m.alurex.unitCents, 1800, 'alurex unitCents');
  eq(m.alurex.priceSource, 'library', 'priceSource');
  ['downspout_3x4_step_up', 'underground_drain', 'popup_emitter'].forEach((id) => {
    eq(m[id].state, 'needs_price', id); eq(m[id].unitCents, null, id + ' unitCents');
  });
  eq(m.downspout_3x4_step_up.qty, 72, 'step-up qty = the 2x3 downspout footage');
  eq(m.underground_drain.needsQuantity, true, 'drain length is never guessed');
  truthy(!m.fascia_wrap && !m.flip_up_extension, 'K5 family does not offer fascia wrap / flip-up');
  truthy(offers.every((o) => o.picked === false && o.recommended === false), 'something arrived pre-picked');
});

test('K5 new gutters → Alu-Rex DoublePro; cleaning (existing gutters) → Gutter Clean Pro', () => {
  const k = offerMap(U.offeredFor(K5, ctxFor(K5, k5)));
  eq(k.alurex.name, 'Alu-Rex DoublePro gutter guard', 'new gutters');
  truthy(/pine/.test(k.alurex.warrantyLine), 'DoublePro warranty line');
  const cl = resolve('jt_gr_clean_1story');
  const c = offerMap(U.offeredFor('jt_gr_clean_1story', ctxFor('jt_gr_clean_1story', cl)));
  eq(c.alurex.name, 'Alu-Rex Gutter Clean Pro gutter guard', 'existing gutters');
  truthy(!/pine/.test(c.alurex.warrantyLine), 'Gutter Clean Pro warranty line');
  eq(offerMap(U.offeredFor(K5, ctxFor(K5, k5, { newGutters: false }))).alurex.name, 'Alu-Rex Gutter Clean Pro gutter guard', 'ctx.newGutters override');
});

test('silent pre-tick guard: K5\'s pre-ticked RFG GAPR hides the apron upgrade; untick it and the upgrade returns', () => {
  const on = offerMap(U.offeredFor(K5, ctxFor(K5, k5)));
  eq(on.gutter_apron.state, 'hidden', 'apron with RFG GAPR in scope');
  truthy(/base scope/.test(on.gutter_apron.reason), 'reason names the base scope');
  const off = resolve(K5, { 1: { qty: 137 }, 7: { include: false } });
  truthy(!off.lines.some((l) => l.code === 'RFG GAPR'), 'fixture: apron unticked');
  const m = offerMap(U.offeredFor(K5, ctxFor(K5, off)));
  eq(m.gutter_apron.state, 'needs_price', 'apron offered once unticked');
  eq(m.gutter_apron.qty, 137, 'apron follows the gutter footage');
});

test('copper K-style (brand swap on the K5 template) → every guard ineligible, copper reason', () => {
  const cu = resolve(K5, { 1: { brandCode: 'GTR 5K-CU' } });
  const m = offerMap(U.offeredFor(K5, ctxFor(K5, cu)));
  LEAF.forEach((id) => {
    eq(m[id].state, 'ineligible', id);
    truthy(/copper/i.test(m[id].reason) && /LeafBlaster voids/.test(m[id].reason), id + ' reason: ' + m[id].reason);
  });
});

test('galvanized steel K-style → guards ineligible (listed for aluminum)', () => {
  const st = resolve(K5, { 1: { brandCode: 'GTR 5K-ST' } });
  const m = offerMap(U.offeredFor(K5, ctxFor(K5, st)));
  LEAF.forEach((id) => { eq(m[id].state, 'ineligible', id); truthy(/aluminum/.test(m[id].reason), id + ' reason'); });
});

test('6" aluminum K-style is eligible; K6 already has 3x4 downspouts → step-up ineligible', () => {
  const r = resolve('jt_gi_k6_oversize');
  const m = offerMap(U.offeredFor('jt_gi_k6_oversize', ctxFor('jt_gi_k6_oversize', r)));
  LEAF.forEach((id) => eq(m[id].state, 'available', id));
  eq(m.alurex.qty, 180, 'K6 run footage');
  eq(m.downspout_3x4_step_up.state, 'ineligible', 'step-up');
  truthy(/already 3x4/.test(m.downspout_3x4_step_up.reason), 'step-up reason');
});

test('Guards Package: guard is the base → leaf group hidden; its pre-ticked drain hides the drain upgrade', () => {
  const id = 'jt_gi_gutters_guards_package';
  const r = resolve(id);
  const m = offerMap(U.offeredFor(id, ctxFor(id, r)));
  LEAF.forEach((l) => { eq(m[l].state, 'hidden', l); truthy(/base scope/.test(m[l].reason), l + ' reason'); });
  eq(m.underground_drain.state, 'hidden', 'drain pre-ticked');
  const r2 = resolve(id, { 8: { include: false } });
  eq(offerMap(U.offeredFor(id, ctxFor(id, r2))).underground_drain.state, 'needs_price', 'drain offered once unticked');
});

test('half-round and copper-accent templates: leaf group hidden (no aluminum guard next to copper)', () => {
  ['jt_gi_half_round', 'jt_gi_copper_accent'].forEach((id) => {
    const m = offerMap(U.offeredFor(id, ctxFor(id, resolve(id))));
    LEAF.forEach((l) => { eq(m[l].state, 'hidden', id + ' ' + l); truthy(/copper/.test(m[l].reason), 'reason'); });
  });
});

test('downspout-only: no leaf group; step-up quantity is the 2x3 footage', () => {
  const id = 'jt_gi_downspout_only';
  const m = offerMap(U.offeredFor(id, ctxFor(id, resolve(id))));
  LEAF.forEach((l) => eq(m[l].state, 'hidden', l));
  eq(m.downspout_3x4_step_up.qty, 120, 'step-up qty');
  eq(m.flip_up_extension.state, 'needs_price', 'flip-up offered');
  eq(m.flip_up_extension.needsQuantity, true, 'downspout count is never guessed');
});

test('cleaning (existing gutters): guard quantity = the whole-house eaveLf, with a confirm prompt', () => {
  const id = 'jt_gr_clean_1story';
  const r = resolve(id);
  const m = offerMap(U.offeredFor(id, ctxFor(id, r)));
  eq(m.alurex.qty, 160, 'eaveLf 160');
  eq(m.alurex.qtySource, 'eaveLf', 'qtySource');
  truthy(/Confirm the gutters are 5" or 6" aluminum K-style/.test(m.alurex.check), 'check prompt');
  const steel = offerMap(U.offeredFor(id, ctxFor(id, r, { gutter: { profile: 'k5', material: 'steel' } })));
  eq(steel.alurex.state, 'ineligible', 'rep says steel');
  const al = offerMap(U.offeredFor(id, ctxFor(id, r, { gutter: { profile: 'k6', material: 'aluminum' } })));
  eq(al.alurex.state, 'available', 'rep says 6" aluminum');
  eq(al.alurex.check, null, 'no prompt once confirmed');
});

test('partial-run repair: eaveLf is the repaired run, so the guard needs a typed footage', () => {
  const id = 'jt_gr_hanger_resecure';
  const r = resolve(id);
  const m = offerMap(U.offeredFor(id, ctxFor(id, r)));
  eq(m.alurex.qty, null, 'no guessed qty (eaveLf 40 is not the house)');
  eq(m.alurex.needsQuantity, true, 'needsQuantity');
  eq(offerMap(U.offeredFor(id, ctxFor(id, r, { gutterLf: 137 }))).alurex.qty, 137, 'ctx.gutterLf wins');
  const mixed = offerMap(U.offeredFor(['jt_gr_clean_1story', id], ctxFor(['jt_gr_clean_1story', id], resolve('jt_gr_clean_1story'))));
  eq(mixed.alurex.qty, null, 'one partial-run template in the mix disables the eaveLf fallback');
});

test('downspout-extension template already ships a flip-up kit → flip-up upgrade hidden', () => {
  const id = 'jt_gr_downspout_ext_4ea';
  const m = offerMap(U.offeredFor(id, ctxFor(id, resolve(id))));
  eq(m.flip_up_extension.state, 'hidden', 'flip-up');
  eq(offerMap(U.offeredFor('jt_gr_downspout_replace_2ea', ctxFor('jt_gr_downspout_replace_2ea', resolve('jt_gr_downspout_replace_2ea')))).flip_up_extension.state,
    'needs_price', 'offered on the replacement template');
});

test('guard install + K5 together: a guard in the base hides the whole leaf group', () => {
  const ids = [K5, 'jt_gr_guard_install_50lf'];
  const r = JT.resolveSelection(ids.map((templateId) => ({ templateId })), { tier: 'better', jobMode: 'cash', county: '' });
  const m = offerMap(U.offeredFor(ids, ctxFor(ids, r)));
  LEAF.forEach((l) => eq(m[l].state, 'hidden', l));
});

test('a non-gutter template offers nothing; an unknown id offers nothing', () => {
  const roof = win.NBD_JOB_TEMPLATES.find((t) => t.category === 'roof_replacement');
  eq(U.offeredFor(roof.id, {}).length, 0, 'roof template');
  eq(U.offeredFor('jt_nope', {}).length, 0, 'unknown id');
  eq(U.offeredFor([], {}).length, 0, 'empty');
});

test('insurance and per-SQ contexts hide every offer with the reason', () => {
  const ins = U.offeredFor(K5, ctxFor(K5, k5, { mode: 'insurance' }));
  truthy(ins.length > 0 && ins.every((o) => o.state === 'hidden' && /insurance claim/.test(o.reason)), 'insurance');
  truthy(U.offeredFor(K5, ctxFor(K5, k5, { insurance: true })).every((o) => o.state === 'hidden'), 'insurance flag');
  truthy(U.offeredFor(K5, ctxFor(K5, k5, { priceMode: 'per-sq' })).every((o) => o.state === 'hidden' && /Per-square/.test(o.reason)), 'per-sq');
});

test('tenant overrides: {enabled:false} hides; a saved price makes a needs_price item available', () => {
  const m = offerMap(U.offeredFor(K5, ctxFor(K5, k5), { alurex: { enabled: false }, underground_drain: 1234 }));
  eq(m.alurex.state, 'hidden', 'disabled alurex');
  eq(m.underground_drain.state, 'available', 'tenant-priced drain');
  eq(m.underground_drain.unitCents, 1234, 'drain unitCents');
  eq(m.underground_drain.priceSource, 'tenant', 'priceSource');
});

test('upgrade rows already on the estimate are NOT base scope (the leaf group stays offered)', () => {
  const priced = U.price(['alurex'], ctxFor(K5, k5));
  const lines = k5.lines.concat(priced.rows);
  const m = offerMap(U.offeredFor(K5, ctxFor(K5, k5, { lines })));
  LEAF.forEach((l) => eq(m[l].state, 'available', l));
});

// ═════════════════════════════════════════════════════════════════════════
console.log('\n4. price — exact cents, refusals, overrides, tax');
console.log('──────────────────────────────────────────────────');

test('137 LF × $18.00 Alu-Rex = $2,466.00 exactly (246600 cents)', () => {
  const p = U.price(['alurex'], ctxFor(K5, k5));
  eq(p.errors.length, 0, 'errors');
  eq(p.upgradeCents, 246600, 'upgradeCents');
  eq(p.rows.length, 1, 'rows');
  const r = p.rows[0];
  eq(r.total, 2466, 'row.total'); eq(r.retailTotal, 2466, 'row.retailTotal');
  eq(r.qty, '137.00LF', 'row.qty'); eq(r.rate, '$18.00', 'row.rate'); eq(r.unitPrice, 18, 'row.unitPrice');
  eq(r.desc, 'Upgrade — Alu-Rex DoublePro gutter guard', 'row.desc');
  eq(r.upgrade, true, 'upgrade tag'); eq(r.upgradeId, 'alurex', 'upgradeId'); eq(r.upgradeCents, 246600, 'upgradeCents');
  eq(r.upgradeVersion, LIB.version, 'upgradeVersion');
});

test('every approved item prices qty × unit exactly across 1..999 LF', () => {
  LEAF.forEach((id) => {
    const unit = byId[id].retailCents;
    for (let q = 1; q < 1000; q += 7) {
      const p = U.price([{ id, qty: q }], ctxFor(K5, k5));
      if (p.errors.length) throw new Error(id + ' @' + q + ': ' + p.errors[0].message);
      eq(p.upgradeCents, q * unit, id + ' @' + q + ' cents');
      eq(cents(p.rows[0].total), q * unit, id + ' @' + q + ' row total');
      truthy(Number.isInteger(p.upgradeCents), 'non-integer cents');
    }
  });
});

test('LF rounds UP to the whole foot; EA must be whole; zero / negative / junk refused', () => {
  eq(U.price([{ id: 'alurex', qty: 137.2 }], ctxFor(K5, k5)).rows[0].quantity, 138, '137.2 → 138');
  eq(U.price([{ id: 'alurex', qty: '140' }], ctxFor(K5, k5)).upgradeCents, 252000, 'numeric string qty');
  [0, -5, 'abc', NaN].forEach((q) => {
    const p = U.price([{ id: 'alurex', qty: q }], ctxFor(K5, k5));
    eq(p.rows.length, 0, 'qty ' + q + ' rows'); eq(codes(p.errors).join(), 'quantity', 'qty ' + q);
  });
  const ov = { underground_drain: 1000, popup_emitter: 2500 };
  const half = U.price(['underground_drain', { id: 'popup_emitter', qty: 2.5 }], ctxFor(K5, k5, { quantities: { underground_drain: 30 } }), ov);
  truthy(codes(half.errors).includes('quantity'), '2.5 emitters refused');
});

test('pick-one group: two leaf protections refuse BOTH (no silent winner)', () => {
  const p = U.price(['alurex', 'amerimax_lockin_mesh'], ctxFor(K5, k5));
  eq(p.rows.length, 0, 'rows'); eq(p.upgradeCents, 0, 'cents');
  eq(codes(p.errors).join(), 'group,group', 'errors');
});

test('a duplicate pick refuses every copy (never bills one guard twice)', () => {
  const p = U.price(['alurex', 'alurex'], ctxFor(K5, k5));
  eq(p.rows.length, 0, 'rows'); eq(codes(p.errors).join(), 'duplicate', 'errors');
});

test('needs_price items are refused — the helper never prices them for a homeowner', () => {
  // Three families together offer all six, with nothing in the base that
  // would hide one — so each refusal below is the price rule and nothing else.
  const ids = ['jt_gi_gutters_guards_package', K5, 'jt_gr_downspout_replace_2ea'];
  const lines = resolve(K5, { 7: { include: false } }).lines;
  const offered = offerMap(U.offeredFor(ids, { lines }));
  NEEDS_PRICE.forEach((id) => {
    eq(offered[id] && offered[id].state, 'needs_price', id + ' offered state');
    const p = U.price([{ id, qty: 10 }], { templateIds: ids, lines, taxRate: 0.07 });
    eq(p.rows.length, 0, id + ' rows'); eq(p.upgradeCents, 0, id + ' cents');
    eq(codes(p.errors).join(), 'needs_price', id + ' error');
  });
  const d = U.price([{ id: 'underground_drain', qty: 30 }], ctxFor(K5, k5));
  eq(codes(d.errors).join(), 'needs_price', 'drain error code');
});

test('a tenant-saved price makes a needs_price item quotable, at exact cents', () => {
  const p = U.price([{ id: 'underground_drain', qty: 33 }], ctxFor(K5, k5), { underground_drain: 1234 });
  eq(p.errors.length, 0, 'errors'); eq(p.upgradeCents, 33 * 1234, 'cents'); eq(p.rows[0].rate, '$12.34', 'rate');
  eq(p.priced[0].priceSource, 'tenant', 'priceSource');
});

test('emitter without a drain is refused; with a priced drain, or a drain already in the base, it prices', () => {
  const ov = { underground_drain: 1000, popup_emitter: 2500 };
  const alone = U.price([{ id: 'popup_emitter', qty: 1 }], ctxFor(K5, k5), ov);
  eq(alone.rows.length, 0, 'alone rows'); eq(codes(alone.errors).join(), 'requires', 'alone error');
  const both = U.price([{ id: 'popup_emitter', qty: 2 }, { id: 'underground_drain', qty: 40 }], ctxFor(K5, k5), ov);
  eq(both.errors.length, 0, 'both errors');
  eq(both.upgradeCents, 40 * 1000 + 2 * 2500, 'both cents');
  eq(both.rows.map((r) => r.upgradeId).join(','), 'underground_drain,popup_emitter', 'library order, not pick order');
  const gp = 'jt_gi_gutters_guards_package';
  const inBase = U.price([{ id: 'popup_emitter', qty: 2 }], ctxFor(gp, resolve(gp)), ov);
  eq(inBase.errors.length, 0, 'drain in base satisfies the emitter');
  const drainBad = U.price([{ id: 'popup_emitter', qty: 2 }, { id: 'underground_drain', qty: 0 }], ctxFor(K5, k5), ov);
  eq(drainBad.rows.length, 0, 'an invalid drain cannot carry the emitter');
});

test('ineligible, hidden, not-offered and unknown picks are refused with their own codes', () => {
  const cu = resolve(K5, { 1: { brandCode: 'GTR 5K-CU' } });
  eq(codes(U.price(['alurex'], ctxFor(K5, cu)).errors).join(), 'ineligible', 'copper');
  const gp = 'jt_gi_gutters_guards_package';
  eq(codes(U.price(['alurex'], ctxFor(gp, resolve(gp))).errors).join(), 'hidden', 'guards package');
  eq(codes(U.price([{ id: 'fascia_wrap', qty: 10 }], ctxFor(K5, k5), { fascia_wrap: 500 }).errors).join(), 'not_offered', 'fascia on K5');
  eq(codes(U.price(['gold_plated_gutters'], ctxFor(K5, k5)).errors).join(), 'unknown', 'unknown');
  eq(codes(U.price(['alurex'], ctxFor(K5, k5), { alurex: { enabled: false } }).errors).join(), 'hidden', 'tenant disabled');
});

test('insurance and per-SQ refuse everything; no template ids refuses', () => {
  const ins = U.price(['alurex'], ctxFor(K5, k5, { mode: 'insurance' }));
  eq(ins.rows.length, 0, 'insurance rows'); eq(codes(ins.errors).join(), 'insurance', 'insurance');
  eq(codes(U.price(['alurex'], ctxFor(K5, k5, { insurance: true, priceMode: 'per-sq' })).errors).join(), 'insurance', 'insurance wins over per-sq');
  eq(codes(U.price(['alurex'], ctxFor(K5, k5, { priceMode: 'per-sq' })).errors).join(), 'per_sq', 'per-sq');
  eq(codes(U.price(['alurex'], { lines: k5.lines, taxRate: 0.07 }).errors).join(), 'no_templates', 'no templateIds');
});

test('no picks → nothing priced (the empty quote is the default, never a pre-pick)', () => {
  const p = U.price([], ctxFor(K5, k5));
  eq(p.rows.length + p.upgradeCents + p.taxCents + p.errors.length, 0, 'empty');
  eq(U.price(undefined, ctxFor(K5, k5)).rows.length, 0, 'undefined picks');
});

test('tenant overrides sanitized like applyCompanyPricing (and $0 dropped, never printed as free)', () => {
  const s = U.sanitizeOverrides({
    alurex: '1900', amerimax_lockin_mesh: '', leafblaster_pro_micromesh: 0, leafblaster_pro_reinforced: 18.5,
    gutter_apron: -5, fascia_wrap: NaN, popup_emitter: null, flip_up_extension: { enabled: false },
    underground_drain: { enabled: true }, nope: 700, __proto__: { polluted: 1 },
  });
  eq(JSON.stringify(s.prices), '{"alurex":1900}', 'prices');
  eq(JSON.stringify(s.disabled), '{"flip_up_extension":true}', 'disabled');
  ['amerimax_lockin_mesh', 'leafblaster_pro_micromesh', 'leafblaster_pro_reinforced', 'gutter_apron', 'fascia_wrap', 'popup_emitter', 'underground_drain', 'nope']
    .forEach((k) => truthy(s.ignored.includes(k), k + ' not ignored'));
  eq(({}).polluted, undefined, 'prototype untouched');
  const p = U.price(['alurex'], ctxFor(K5, k5), { alurex: '1900' });
  eq(p.upgradeCents, 137 * 1900, 'override wins');
  eq(U.price(['alurex'], ctxFor(K5, k5), { alurex: 0 }).upgradeCents, 137 * 1800, '$0 override → library price stands');
  eq(U.price(['alurex'], ctxFor(K5, k5), { alurex: 'abc' }).upgradeCents, 137 * 1800, 'garbage → library price stands');
});

test('tax: one half-up rounding on the upgrade subtotal, integer cents; 0% allowed; missing rate is an error', () => {
  eq(U.price(['alurex'], ctxFor(K5, k5, { taxRate: 0.07 })).taxCents, 17262, '7% of 246600');
  eq(U.price(['alurex'], ctxFor(K5, k5, { taxRate: 0.0725 })).taxCents, 17879, '7.25% of 246600 = 17878.5 → 17879');
  eq(U.price(['alurex'], ctxFor(K5, k5, { taxRate: 0 })).taxCents, 0, '0%');
  const noRate = U.price(['alurex'], ctxFor(K5, k5, { taxRate: undefined }));
  eq(codes(noRate.errors).join(), 'tax_rate', 'missing rate');
  eq(codes(U.price(['alurex'], ctxFor(K5, k5, { taxRate: 7 })).errors).join(), 'tax_rate', '7 (not 0.07) refused');
  const p = U.price(['alurex'], ctxFor(K5, k5, { taxRate: 0.07 }));
  eq(p.totalCents, 246600 + 17262, 'totalCents');
});

// ═════════════════════════════════════════════════════════════════════════
console.log('\n5. round-trip — the real readers print exactly what was quoted');
console.log('──────────────────────────────────────────────────');

const basePayload = JT.buildEstimatePayload(k5, { name: 'Upgrade round-trip' });

test('upgrade rows carry every key of a real buildEstimatePayload row, plus only the upgrade tag', () => {
  const contract = Object.keys(basePayload.rows[0]);
  eq(contract.length, 15, 'contract key count (job-templates.js changed? re-read ~1086-1115)');
  const row = U.price(['alurex'], ctxFor(K5, k5)).rows[0];
  const missing = contract.filter((k) => !(k in row));
  eq(missing.join(','), '', 'missing contract keys');
  const extra = Object.keys(row).filter((k) => !contract.includes(k));
  truthy(extra.every((k) => k === 'upgrade' || /^upgrade[A-Z]/.test(k)), 'untagged extra keys: ' + extra.join(','));
  truthy(extra.includes('upgrade') && extra.includes('upgradeId'), 'upgrade tag + upgradeId');
  contract.forEach((k) => {
    const t = typeof basePayload.rows[0][k];
    if (basePayload.rows[0][k] !== null && row[k] !== null) eq(typeof row[k], t, 'type of ' + k);
  });
  truthy(/^\d+\.\d{2}[A-Z]+$/.test(row.qty) && /^\$\d+\.\d{2}$/.test(row.rate), 'display-string shapes');
});

function printedUpgrade(est, code) {
  return {
    display: CR.buildDisplayRows(est).find((r) => r.code === code),
    server: CR_SERVER.buildDisplayRows(est).find((r) => r.code === code),
    doc: CR.buildDocLineItems(est).find((r) => r.code === code),
    invoice: IP.buildRowItems(est).find((r) => /^Upgrade — /.test(r.description) && r.description === est.rows.find((x) => x.code === code).desc),
  };
}

test('Alu-Rex 137 LF: all three readers (+ the portal\'s server mirror) print $2,466.00 at $18.00 × 137', () => {
  const priced = U.price(['alurex'], ctxFor(K5, k5, { taxRate: basePayload.taxRate }));
  const est = U.applyToEstimate(basePayload, priced);
  const p = printedUpgrade(est, 'UPG LG-ARX');
  truthy(p.display && p.server && p.doc && p.invoice, 'a reader dropped the upgrade row');
  eq(cents(p.display.total), 246600, 'buildDisplayRows total'); eq(p.display.rate, '$18.00', 'display rate'); eq(p.display.qty, '137.00LF', 'display qty');
  eq(JSON.stringify(p.server), JSON.stringify(p.display), 'functions/ mirror prints the same row');
  eq(cents(p.doc.total), 246600, 'buildDocLineItems total'); eq(p.doc.rate, 18, 'doc rate'); eq(p.doc.qty, 137, 'doc qty'); eq(p.doc.unit, 'LF', 'doc unit');
  eq(cents(p.invoice.total), 246600, 'buildRowItems total'); eq(p.invoice.unitPrice, 18, 'invoice unitPrice'); eq(p.invoice.quantity, 137, 'invoice qty');
});

test('every leaf item × a quantity sweep: printed == quoted to the cent in every reader', () => {
  LEAF.forEach((id) => {
    [1, 33, 99, 137, 250, 413].forEach((q) => {
      const priced = U.price([{ id, qty: q }], ctxFor(K5, k5, { taxRate: basePayload.taxRate }));
      const est = U.applyToEstimate(basePayload, priced);
      const p = printedUpgrade(est, byId[id].code);
      const want = q * byId[id].retailCents;
      eq(cents(p.display.total), want, id + '@' + q + ' display');
      eq(cents(p.doc.total), want, id + '@' + q + ' doc');
      eq(cents(p.invoice.total), want, id + '@' + q + ' invoice');
      eq(cents(p.invoice.unitPrice), byId[id].retailCents, id + '@' + q + ' invoice unit');
      eq(p.display.rate, '$' + (byId[id].retailCents / 100).toFixed(2), id + '@' + q + ' display rate');
    });
  });
});

test('a tenant-priced odd unit ($12.34 × 33 LF drain) prints $407.22 in every reader', () => {
  const priced = U.price([{ id: 'underground_drain', qty: 33 }], ctxFor(K5, k5, { taxRate: basePayload.taxRate }), { underground_drain: 1234 });
  const p = printedUpgrade(U.applyToEstimate(basePayload, priced), 'UPG UND-DR');
  eq(cents(p.display.total), 40722, 'display'); eq(p.display.rate, '$12.34', 'display rate');
  eq(cents(p.doc.total), 40722, 'doc'); eq(cents(p.invoice.total), 40722, 'invoice'); eq(p.invoice.unitPrice, 12.34, 'invoice unit');
});

test('the printed lines, the subtotal and the grand total each move by EXACTLY the quote', () => {
  const priced = U.price(['alurex'], ctxFor(K5, k5, { taxRate: basePayload.taxRate }));
  const est = U.applyToEstimate(basePayload, priced);
  const sum = (rows) => rows.reduce((s, r) => s + cents(r.total), 0);
  eq(sum(CR.buildDisplayRows(est)) - sum(CR.buildDisplayRows(basePayload)), 246600, 'display lines delta');
  eq(sum(CR.buildDocLineItems(est)) - sum(CR.buildDocLineItems(basePayload)), 246600, 'doc lines delta');
  eq(sum(IP.buildRowItems(est)) - sum(IP.buildRowItems(basePayload)), 246600, 'invoice lines delta');
  eq(cents(est.subtotal) - cents(basePayload.subtotal), 246600, 'subtotal delta');
  eq(cents(est.tax) - cents(basePayload.tax), priced.taxCents, 'tax delta');
  eq(cents(est.grandTotal) - cents(basePayload.grandTotal), 246600 + priced.taxCents, 'grandTotal delta');
  eq(CR.estimateValue(est), est.grandTotal, 'estimateValue reads the new grand total');
  eq(est.upgradeCents, 246600, 'payload.upgradeCents');
  eq(est.upgrades[0].id, 'alurex', 'payload.upgrades');
});

test('the O&P row is untouched: upgrades never re-enter markup or O&P', () => {
  const est = U.applyToEstimate(basePayload, U.price(['alurex'], ctxFor(K5, k5)));
  const op = (rows) => rows.find((r) => r.code === 'O&P');
  eq(op(CR.buildDisplayRows(est)).total, op(CR.buildDisplayRows(basePayload)).total, 'O&P row');
  eq(est.overhead, basePayload.overhead, 'overhead'); eq(est.profit, basePayload.profit, 'profit');
});

test('applyToEstimate: does not mutate its input; refuses a payload that already has upgrades; refuses errors', () => {
  const before = JSON.stringify(basePayload);
  const priced = U.price(['alurex'], ctxFor(K5, k5));
  const est = U.applyToEstimate(basePayload, priced);
  eq(JSON.stringify(basePayload), before, 'input mutated');
  let threw = false;
  try { U.applyToEstimate(est, priced); } catch (e) { threw = /already has upgrade rows/.test(e.message); }
  truthy(threw, 're-applying on top of upgrades must throw');
  threw = false;
  try { U.applyToEstimate(basePayload, U.price(['alurex', 'alurex'], ctxFor(K5, k5))); } catch (e) { threw = /has errors/.test(e.message); }
  truthy(threw, 'a quote with errors must not be totalled');
});

// ═════════════════════════════════════════════════════════════════════════
console.log('\n6. totals — the job minimum applies to the whole job');
console.log('──────────────────────────────────────────────────');

// A real floored payload: the reseal template with only mobilization left,
// quoted below its $400 minimum.
const RESEAL = 'jt_gr_reseal';
const small = resolve(RESEAL, { 1: { include: false }, 2: { include: false }, 3: { include: false } });
const smallPayload = JT.buildEstimatePayload(small, { name: 'floored' });

test('fixture: the stripped-down reseal really is floored at its $400 minimum', () => {
  eq(smallPayload.minJobApplied, true, 'minJobApplied');
  eq(smallPayload.grandTotal, 400, 'grandTotal');
  eq(small.minJobCharge, 400, 'minJobCharge');
});

test('a $720 guard on a floored job: the floor gap is NOT billed on top — the whole job clears the minimum', () => {
  const priced = U.price([{ id: 'amerimax_lockin_mesh', qty: 120 }], ctxFor(RESEAL, small, { taxRate: smallPayload.taxRate }));
  eq(priced.upgradeCents, 72000, 'quote');
  const est = U.applyToEstimate(smallPayload, priced, { minJobCharge: small.minJobCharge });
  const unfloored = Math.round((smallPayload.subtotal + smallPayload.tax) / 25) * 25;
  truthy(unfloored < 400, 'fixture: the engine total sits under the floor');
  eq(cents(est.grandTotal), cents(unfloored) + 72000 + priced.taxCents, 'grand total = engine total + quote');
  truthy(cents(est.grandTotal) < 40000 + 72000 + priced.taxCents, 'the floor gap was billed on top');
  eq(est.minJobApplied, false, 'minJobApplied cleared');
});

test('a tiny upgrade that leaves the job under the minimum keeps the floor', () => {
  const priced = U.price([{ id: 'flip_up_extension', qty: 1 }], ctxFor(RESEAL, small, { taxRate: smallPayload.taxRate }), { flip_up_extension: 100 });
  eq(priced.errors.length, 0, 'errors');
  const est = U.applyToEstimate(smallPayload, priced, { minJobCharge: small.minJobCharge });
  eq(est.grandTotal, 400, 'still the minimum'); eq(est.minJobApplied, true, 'still floored');
});

test('a floored payload without the minimum charge is refused, not guessed', () => {
  const priced = U.price([{ id: 'amerimax_lockin_mesh', qty: 120 }], ctxFor(RESEAL, small));
  let threw = false;
  try { U.applyToEstimate(smallPayload, priced); } catch (e) { threw = /minJobCharge is required/.test(e.message); }
  truthy(threw, 'must throw');
});

test('totalsWithUpgrades on an unfloored base adds the quote at face, in cents', () => {
  const t = U.totalsWithUpgrades({ subtotal: 1000.10, tax: 70.01, grandTotal: 1075 }, { upgradeCents: 246600, taxCents: 17262, errors: [] });
  eq(t.subtotalCents, 100010 + 246600, 'subtotal'); eq(t.taxCents, 7001 + 17262, 'tax');
  eq(t.grandTotalCents, 107500 + 246600 + 17262, 'grand'); eq(t.grandTotal, 3713.62, 'grand dollars');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

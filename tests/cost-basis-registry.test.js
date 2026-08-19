/**
 * tests/cost-basis-registry.test.js
 *
 * The rotation toolchain for the catalogs that still publish a contractor cost
 * basis (functions/cost-basis-registry.js + scripts/cost-rotation.js +
 * scripts/import-cost-rotation.js).
 *
 * Rotation is the half of the leak fix that addresses the copies already out
 * there — the figures are readable forever at their pre-strip commits, so
 * removing them from HEAD stops only NEW exposure. What this suite protects is
 * the property that makes rotation meaningful: **a no-op cannot pass as a
 * rotation.** Every refusal path is asserted, because a tool that silently
 * accepts an empty worksheet is worse than no tool — it produces a stamped
 * artefact certifying work that did not happen.
 *
 * Sections:
 *   1. The registry sees the real catalogs — non-vacuous row/value counts, and
 *      the bridge rows that belong to other catalogs are excluded.
 *   2. Worksheet shape — every row is fillable (key + item + unit + a current
 *      column per field + a blank column per field).
 *   3. applyRotation semantics — blanks keep, changes count, unknown keys warn,
 *      bad values are collected rather than coerced.
 *   4. validateSeed mutants — one per failure mode.
 *
 * Pure-Node, no emulator. Run: node tests/cost-basis-registry.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const REG = require(path.join(ROOT, 'functions', 'cost-basis-registry.js'));

let passed = 0, failed = 0;
const fails = [];
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failed++; fails.push(name + ': ' + e.message); }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'assertion failed'); }
function eq(a, b, label) {
  if (a !== b) throw new Error((label || 'value') + ' = ' + JSON.stringify(a) + ' (expected ' + JSON.stringify(b) + ')');
}

/** Load one catalog's files into a bare window sandbox — same as the scripts. */
function loadCatalog(catalog) {
  const win = {};
  win.window = win;
  const sandbox = {
    window: win,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      addEventListener() {}, removeEventListener() {},
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, setAttribute() {} }),
      body: { appendChild() {} },
    },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    navigator: {},
    Date, Math, JSON, Set, Map, Object, isFinite, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.createContext(sandbox);
  catalog.files.forEach((rel) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs', rel), 'utf8'), sandbox, { filename: path.basename(rel) });
  });
  return win;
}

const LOADED = {};
Object.keys(REG.CATALOGS).forEach((id) => { LOADED[id] = loadCatalog(REG.get(id)); });

/* ── 1. the registry sees the real catalogs ────────────────────────────── */

console.log('\nregistry sees the real catalogs');
console.log('──────────────────────────────────────────────────');

// Floors, not exact counts: a catalog legitimately grows. They exist so a
// loader that silently returns nothing cannot make every assertion below pass.
const FLOORS = { labor: 60, xact: 250, v2: 25 };

Object.keys(REG.CATALOGS).forEach((id) => {
  test(id + ': enumerates priced entries (non-vacuous)', () => {
    const catalog = REG.get(id);
    const rows = REG.pricedEntries(catalog, LOADED[id]);
    ok(rows.length >= FLOORS[id], id + ' returned ' + rows.length + ' priced entries (floor ' + FLOORS[id] + ')');
    ok(rows.every((r) => r.key && typeof r.key === 'string'), 'every entry needs a stable key');
  });
});

test('every catalog declares a distinct book field on the shared cost document', () => {
  const fields = Object.keys(REG.CATALOGS).map((id) => REG.get(id).bookField);
  eq(new Set(fields).size, fields.length, 'distinct bookField count');
  // These sit beside `costs` (products, 2026-07-30) and `jtCosts` (job
  // templates, PR-B) on catalogCosts/{companyId}. Colliding with either would
  // have one migration silently overwrite another's book.
  ok(!fields.includes('costs') && !fields.includes('jtCosts'), 'must not collide with an existing map');
});

test('v2 EXCLUDES the xact and job-template bridge rows', () => {
  // estimate-catalog-xactimate.js and job-templates.js both write into
  // EstimateBuilderV2.CATALOG at load. Those rows belong to their own
  // catalogs; rotating them here would double-count and produce two books
  // that disagree about the same line.
  const win = loadCatalog(REG.get('xact'));            // loads EBv2 *and* the xact bridge
  const rows = REG.get('v2').entries(win).map((r) => r.key);
  ok(rows.length > 0, 'v2 still enumerates its native rows');
  ok(!rows.some((k) => /^xact-|^jt-/.test(k)), 'bridge rows leaked into the v2 catalog: ' + rows.filter((k) => /^xact-|^jt-/.test(k)).slice(0, 3).join(', '));
});

/* ── 2. worksheet shape ────────────────────────────────────────────────── */

console.log('\nworksheet is fillable');
console.log('──────────────────────────────────────────────────');

Object.keys(REG.CATALOGS).forEach((id) => {
  test(id + ': every worksheet row is fillable', () => {
    const catalog = REG.get(id);
    const rows = REG.buildWorksheet(catalog, LOADED[id]);
    ok(rows.length > 0, 'no rows');
    rows.forEach((r) => {
      // A bare key is unfillable — this is the difference between data entry
      // and archaeology.
      ok(r.key, 'row missing key');
      ok(typeof r.item === 'string' && r.item.length > 0, r.key + ': no item name to identify it by');
      catalog.fields.forEach((f) => {
        ok(('current_' + f) in r, r.key + ': missing current_' + f);
        ok(f in r, r.key + ': missing blank column ' + f);
        eq(r[f], null, r.key + '.' + f + ' must start blank');
      });
    });
  });
});

/* ── 3. applyRotation semantics ────────────────────────────────────────── */

console.log('\napplyRotation — a no-op cannot pass as a rotation');
console.log('──────────────────────────────────────────────────');

const LAB = REG.get('labor');
const LABWIN = LOADED.labor;
const sheetFor = (mut) => {
  const rows = REG.buildWorksheet(LAB, LABWIN).map((r) => Object.assign({}, r));
  if (mut) rows.forEach(mut);
  return rows;
};

test('an UNTOUCHED worksheet changes nothing (this is what the coverage floor catches)', () => {
  const res = REG.applyRotation(LAB, LABWIN, sheetFor(null));
  eq(res.changed, 0, 'changed');
  // Derived from the catalog, not a magic number. This assertion read
  // `total > 100` until the productivity strip took the labor worksheet from
  // 198 values to 66 — a correct failure that a hardcoded floor turned into a
  // puzzle. The count is now whatever the published file actually offers.
  const rows = REG.pricedEntries(LAB, LABWIN);
  const expected = rows.reduce((n, e) => n + LAB.fields.filter((f) => Number.isFinite(e.values[f])).length, 0);
  eq(res.total, expected, 'total values');
  ok(res.total >= rows.length, 'every priced row contributes at least one value');
  eq(res.badValues.length, 0, 'badValues');
});

test('the published labor worksheet offers RATE only — productivity is not there to rotate', () => {
  // After the strip, hoursPerUnit/crewSize exist only in git history. Rotating
  // them needs `--from <pre-strip-ref>`; a worksheet built from the working
  // tree cannot offer a current value it can no longer read, and must not
  // pretend to by emitting a blank column that silently writes nothing.
  const rows = REG.buildWorksheet(LAB, LABWIN);
  ok(rows.every((r) => r.current_rate != null), 'every row must carry its baseline rate');
  ok(rows.every((r) => r.current_hoursPerUnit == null), 'productivity must not appear from the published file');
});

test('a fully filled worksheet moves (nearly) every value', () => {
  const res = REG.applyRotation(LAB, LABWIN, sheetFor((r) => {
    LAB.fields.forEach((f) => { if (r['current_' + f] != null) r[f] = Math.round(r['current_' + f] * 1.07 * 100) / 100; });
  }));
  ok(res.changed / res.total > 0.9, 'coverage was ' + (res.changed / res.total * 100).toFixed(1) + '%');
});

test('a BLANK cell keeps the current value rather than zeroing it', () => {
  const res = REG.applyRotation(LAB, LABWIN, sheetFor((r) => { r.rate = null; r.hoursPerUnit = ''; }));
  eq(res.changed, 0, 'changed');
  const anyKey = Object.keys(res.seed.laborOps)[0];
  const live = REG.pricedEntries(LAB, LABWIN).find((e) => e.key === anyKey);
  eq(res.seed.laborOps[anyKey].rate, live.values.rate, 'kept rate');
});

test('re-stating the SAME value is not counted as a change', () => {
  const res = REG.applyRotation(LAB, LABWIN, sheetFor((r) => { r.rate = r.current_rate; }));
  eq(res.changed, 0, 'changed');
});

test('a bad value is COLLECTED, never coerced into the seed', () => {
  const rows = sheetFor((r) => { LAB.fields.forEach((f) => { if (r['current_' + f] != null) r[f] = r['current_' + f] * 2; }); });
  rows[2].rate = 'free';
  rows[4].hoursPerUnit = -1;
  const res = REG.applyRotation(LAB, LABWIN, rows);
  eq(res.badValues.length, 2, 'badValues');
  const k2 = rows[2].key;
  const live = REG.pricedEntries(LAB, LABWIN).find((e) => e.key === k2);
  eq(res.seed.laborOps[k2].rate, live.values.rate, 'the bad row must keep its original value');
});

test('an unknown key is reported, not silently written', () => {
  const rows = sheetFor(null);
  rows.push({ key: 'LAB NOPE', rate: 5 });
  const res = REG.applyRotation(LAB, LABWIN, rows);
  ok(res.unknownKeys.includes('LAB NOPE'), 'unknownKeys');
  ok(!('LAB NOPE' in res.seed.laborOps), 'must not reach the seed');
});

test('the seed is stamped with its catalog, so a sheet cannot be imported into the wrong book', () => {
  const res = REG.applyRotation(LAB, LABWIN, sheetFor(null));
  eq(res.seed.catalog, 'labor', 'seed.catalog');
  eq(res.seed.version, REG.SEED_VERSION, 'seed.version');
});

/* ── 4. validateSeed mutants ───────────────────────────────────────────── */

console.log('\nvalidateSeed refuses a corrupted book');
console.log('──────────────────────────────────────────────────');

const GOOD = REG.applyRotation(LAB, LABWIN, sheetFor((r) => {
  LAB.fields.forEach((f) => { if (r['current_' + f] != null) r[f] = Math.round(r['current_' + f] * 1.07 * 100) / 100; });
})).seed;
const A_KEY = Object.keys(GOOD.laborOps)[0];
const mutate = (fn) => { const c = JSON.parse(JSON.stringify(GOOD)); fn(c); return REG.validateSeed(LAB, c, LABWIN); };

test('control: a rotated seed validates against the live catalog', () => {
  const r = REG.validateSeed(LAB, GOOD, LABWIN);
  ok(r.ok, r.errors.slice(0, 3).join(' | '));
  eq(r.warnings.length, 0, 'warnings');
});

test('MUTANT killed: a non-finite value', () => {
  const r = mutate((c) => { c.laborOps[A_KEY].rate = 'free'; });
  ok(!r.ok && /rate/.test(r.errors.join(' ')), r.errors.join(' | '));
});

test('MUTANT killed: a negative value', () => {
  const r = mutate((c) => { c.laborOps[A_KEY].rate = -1; });
  ok(!r.ok && />= 0/.test(r.errors.join(' ')), r.errors.join(' | '));
});

test('MUTANT killed: every field zero', () => {
  const r = mutate((c) => { LAB.fields.forEach((f) => { c.laborOps[A_KEY][f] = 0; }); });
  ok(!r.ok && /every field is 0/.test(r.errors.join(' ')), r.errors.join(' | '));
});

test('MUTANT killed: an unknown field smuggled in', () => {
  const r = mutate((c) => { c.laborOps[A_KEY].overheadMultiplier = 1.35; });
  ok(!r.ok && /unknown field/.test(r.errors.join(' ')), r.errors.join(' | '));
});

test('MUTANT killed: a version mismatch', () => {
  const r = mutate((c) => { c.version = 99; });
  ok(!r.ok && /version/.test(r.errors.join(' ')), r.errors.join(' | '));
});

test('MUTANT killed: a seed stamped for a different catalog', () => {
  const r = mutate((c) => { c.catalog = 'xact'; });
  ok(!r.ok && /catalog/.test(r.errors.join(' ')), r.errors.join(' | '));
});

test('an ORPHAN key is a WARNING, not an error (a retired line must not strand the rest)', () => {
  const c = JSON.parse(JSON.stringify(GOOD));
  c.laborOps['LAB RETIRED'] = { rate: 5, hoursPerUnit: 1, crewSize: 2 };
  const r = REG.validateSeed(LAB, c, LABWIN);
  ok(r.ok, 'should still validate: ' + r.errors.slice(0, 2).join(' | '));
  ok(r.warnings.some((w) => /LAB RETIRED/.test(w)), 'expected a warning');
});

test('shape-only mode (no catalog) still refuses a corrupted seed', () => {
  ok(REG.validateSeed(LAB, GOOD, null).ok, 'clean seed');
  const c = JSON.parse(JSON.stringify(GOOD));
  c.laborOps[A_KEY] = { rate: null, hoursPerUnit: null, crewSize: null };
  ok(!REG.validateSeed(LAB, c, null).ok, 'a seed of nulls must be refused, not served');
});

test('get() refuses an unknown catalog rather than returning undefined', () => {
  let threw = false;
  try { REG.get('nope'); } catch (e) { threw = /unknown catalog/.test(e.message); }
  ok(threw, 'expected a throw naming the valid catalogs');
});

/* ── 5. the labor split, end to end ────────────────────────────────────── */

console.log('\nlabor catalog: baseline published, tenant book overrides');
console.log('──────────────────────────────────────────────────');

/** Boot the pricing stack, optionally with a stub cost book installed first. */
function bootPricing(book) {
  const win = {};
  win.window = win;
  const sandbox = {
    window: win,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      addEventListener() {}, removeEventListener() {},
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, setAttribute() {} }),
      body: { appendChild() {} },
    },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    navigator: {},
    Date, Math, JSON, Set, Map, Object, isFinite, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.createContext(sandbox);
  if (book) win.NBDCatalogCosts = book;
  ['estimate-config.js', 'product-data.js', 'roofivent-catalog.js', 'estimate-labor-catalog.js',
   'estimate-builder-v2.js', 'estimate-catalog-xactimate.js', 'estimate-logic-engine.js'].forEach((f) => {
    const p = path.join(ROOT, 'docs', 'pro', 'js', f);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
  });
  return win;
}

const SAMPLE_LABOR = 'LAB TO1';

test('NO BOOK: the published starter baseline prices normally', () => {
  // The whole reason `rate` stayed published. A tenant with no cost book must
  // still be able to produce an estimate — stripping it would turn the
  // estimator off rather than degrade it.
  const win = bootPricing(null);
  const e = win.NBD_LABOR.get(SAMPLE_LABOR);
  ok(e, 'labor action missing');
  ok(Number(e.rate) > 0, 'baseline rate must be present and positive, got ' + e.rate);
});

test('NO BOOK: crew productivity is ABSENT (it left the published tree)', () => {
  const win = bootPricing(null);
  const e = win.NBD_LABOR.get(SAMPLE_LABOR);
  eq(e.hoursPerUnit, undefined, 'hoursPerUnit');
  eq(e.crewSize, undefined, 'crewSize');
  eq(e.ratePerManHour, undefined, 'ratePerManHour');
});

test('WITH BOOK: the tenant\'s rate OVERRIDES the published baseline', () => {
  const win = bootPricing({ laborOp: (id) => (id === SAMPLE_LABOR ? { rate: 99, hoursPerUnit: 0.9, crewSize: 3 } : null) });
  const e = win.NBD_LABOR.get(SAMPLE_LABOR);
  eq(e.rate, 99, 'overridden rate');
  eq(e.hoursPerUnit, 0.9, 'restored hoursPerUnit');
  eq(e.crewSize, 3, 'restored crewSize');
});

test('WITH BOOK: an action the tenant has NOT priced keeps the baseline', () => {
  const win = bootPricing({ laborOp: (id) => (id === SAMPLE_LABOR ? { rate: 99 } : null) });
  const bare = bootPricing(null).NBD_LABOR.get('LAB TO2').rate;
  eq(win.NBD_LABOR.get('LAB TO2').rate, bare, 'untouched action');
});

test('the override reaches PRICING, not just the accessor', () => {
  // resolveLabor goes through NBD_LABOR.get(), so this is the assertion that
  // says a tenant's own figure actually decides the money.
  const win = bootPricing({ laborOp: (id) => (id === SAMPLE_LABOR ? { rate: 99 } : null) });
  const MEAS = { rawSqft: 2000, pitch: 6, waste: 1.12, ridgeLf: 40, eaveLf: 120, rakeLf: 60, hipLf: 0, valleyLf: 20, wallLf: 0, pipes: 3, chimneys: 1, skylights: 0, stories: 1, tearOffLayers: 1, deckReplacePct: 0.15, cutUpRoof: false };
  const res = win.EstimateLogic.resolveEstimate(
    [{ code: 'X', name: 'x', unit: 'SQ', laborId: SAMPLE_LABOR, qtyOverride: 10 }], MEAS,
    { tier: 'better', mode: 'cash' });
  eq(res.lines[0].laborCostPerUnit, 99, 'engine priced off the book');
});

test('a THROWING cost book never breaks pricing', () => {
  // No book is a normal state; a broken one must degrade to the baseline
  // rather than take the estimator down with it.
  const win = bootPricing({ laborOp: () => { throw new Error('boom'); } });
  ok(Number(win.NBD_LABOR.get(SAMPLE_LABOR).rate) > 0, 'fell back to baseline');
});

test('find() is get() — both consult the book', () => {
  const win = bootPricing({ laborOp: (id) => (id === SAMPLE_LABOR ? { rate: 99 } : null) });
  eq(win.NBD_LABOR.find(SAMPLE_LABOR).rate, 99, 'find()');
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }

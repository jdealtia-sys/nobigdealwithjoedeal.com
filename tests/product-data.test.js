/**
 * tests/product-data.test.js
 *
 * Guards the PRODUCT catalog (product-data.js + roofivent-catalog.js merge)
 * and the product-library.js DATA_VERSION migration:
 *   1. Catalog integrity — unique ids across the merge, required fields,
 *      category/unit registered, sell >= cost > 0 across all three tiers,
 *      total count >= 260 (188 base + 88 RoofIVent = 276).
 *   2. Migration (v3 store -> v4) — user-created products and user-edited
 *      defaults (updatedAt !== createdAt) survive; untouched defaults are
 *      refreshed; new default SKUs appear. The old reseed WIPED user data.
 *
 * Pure-Node test, no emulator required. Run via:
 *   node tests/product-data.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failed++; }
}
function eq(actual, expected, label) {
  if (actual !== expected) throw new Error((label || 'value') + ' = ' + JSON.stringify(actual) + ' (expected ' + JSON.stringify(expected) + ')');
}
function ok(cond, label) {
  if (!cond) throw new Error(label || 'assertion failed');
}

const SRC_DIR = path.join(__dirname, '..', 'docs', 'pro', 'js');
const DATA_SRC = fs.readFileSync(path.join(SRC_DIR, 'product-data.js'), 'utf8');
const RIV_SRC = fs.readFileSync(path.join(SRC_DIR, 'roofivent-catalog.js'), 'utf8');
const LIB_SRC = fs.readFileSync(path.join(SRC_DIR, 'product-library.js'), 'utf8');

// ── 1. Catalog: load product-data.js + roofivent-catalog.js into one window ──

const catalogWin = {};
catalogWin.window = catalogWin;
vm.runInNewContext(DATA_SRC, { window: catalogWin, Date, Math, JSON, Set }, { filename: 'product-data.js' });
const BASE_COUNT = (catalogWin.NBD_PRODUCTS || []).length;
vm.runInNewContext(RIV_SRC, { window: catalogWin, Date, Math, JSON, Set, Object }, { filename: 'roofivent-catalog.js' });

const PRODUCTS = catalogWin.NBD_PRODUCTS || [];
const CATEGORIES = catalogWin.NBD_CATEGORIES || {};
const UNITS = catalogWin.NBD_UNITS || {};
const TIERS = ['good', 'better', 'best'];

// Pre-existing intentional zero-cost SKUs (owned equipment / free warranty
// certificate). Everything else — including every new SKU — must have
// cost > 0 on all tiers.
const ZERO_COST_OK = new Set(['acc_023', 'riv_warranty_cert']);

console.log('\nproduct catalog (product-data.js + roofivent-catalog.js)');
console.log('──────────────────────────────────────────────────');

test('total merged count >= 260 (got ' + PRODUCTS.length + ', base ' + BASE_COUNT + ')', () => {
  ok(PRODUCTS.length >= 260, 'count ' + PRODUCTS.length + ' < 260');
});

test('ids are unique across the base + RoofIVent merge', () => {
  const seen = new Set(); const dupes = [];
  PRODUCTS.forEach(p => { if (seen.has(p.id)) dupes.push(p.id); seen.add(p.id); });
  eq(dupes.join(','), '', 'duplicate ids');
});

test('every product has a non-empty name and description', () => {
  const bad = PRODUCTS.filter(p => !p.name || typeof p.name !== 'string' || !p.name.trim() ||
                                    !p.description || typeof p.description !== 'string' || !p.description.trim());
  eq(bad.map(p => p.id).join(','), '', 'missing name/description');
});

test('every product category is registered in NBD_CATEGORIES', () => {
  const bad = PRODUCTS.filter(p => !(p.category in CATEGORIES));
  eq(bad.map(p => p.id + ':' + p.category).join(','), '', 'unregistered category');
});

test('every product unit is registered in NBD_UNITS', () => {
  const bad = PRODUCTS.filter(p => !(p.unit in UNITS));
  eq(bad.map(p => p.id + ':' + p.unit).join(','), '', 'unregistered unit');
});

test('pricing: sell >= cost > 0 on all three tiers (allowlisted zero-cost SKUs exempt from cost > 0)', () => {
  const bad = [];
  PRODUCTS.forEach(p => {
    TIERS.forEach(t => {
      const tr = p.pricing && p.pricing[t];
      if (!tr || typeof tr.sell !== 'number' || typeof tr.cost !== 'number') { bad.push(p.id + ':' + t + ':shape'); return; }
      if (!(tr.sell >= tr.cost)) bad.push(p.id + ':' + t + ':sell<cost');
      if (ZERO_COST_OK.has(p.id) ? !(tr.cost >= 0) : !(tr.cost > 0)) bad.push(p.id + ':' + t + ':cost');
    });
  });
  eq(bad.join(','), '', 'pricing violations');
});

test('isActive is a boolean on every product', () => {
  const bad = PRODUCTS.filter(p => typeof p.isActive !== 'boolean');
  eq(bad.map(p => p.id).join(','), '', 'non-boolean isActive');
});

test('new gap-fill prefixes are present (chim_, sky_, gut_, maint_, ext_)', () => {
  ['chim_', 'sky_', 'gut_', 'maint_', 'ext_'].forEach(pre => {
    ok(PRODUCTS.some(p => p.id.startsWith(pre)), 'no products with prefix ' + pre);
  });
});

// ── 2. product-library.js: not loadable without a window ──

console.log('\nproduct-library.js load guard');
console.log('──────────────────────────────────────────────────');

let bareLoadThrew = false;
test('bare load (no window shim) throws — library is browser-only', () => {
  try {
    vm.runInNewContext(LIB_SRC, { Date, Math, JSON, Set }, { filename: 'product-library.js' });
  } catch (e) { bareLoadThrew = true; }
  ok(bareLoadThrew, 'expected ReferenceError without window');
});

// ── 3. Migration merge logic, via window + localStorage shims ──
// (If the bare load had somehow succeeded we would still run this — the
//  shimmed load is the supported harness either way.)

function makeLocalStorage(seed) {
  const store = new Map(Object.entries(seed || {}));
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    _dump: () => Object.fromEntries(store)
  };
}

function loadLibraryWith(seededStore) {
  const win = {};
  win.window = win;
  const localStorage = makeLocalStorage(seededStore);
  const sandbox = {
    window: win,
    localStorage,
    document: { addEventListener() {}, getElementById: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } },
    console: { log() {}, warn() {}, error() {} },
    Date, Math, JSON, Set, Object,
    setTimeout, navigator: {}
  };
  // Library consumes window.NBD_* — load the full catalog first.
  vm.runInNewContext(DATA_SRC, sandbox, { filename: 'product-data.js' });
  vm.runInNewContext(RIV_SRC, sandbox, { filename: 'roofivent-catalog.js' });
  vm.runInNewContext(LIB_SRC, sandbox, { filename: 'product-library.js' });
  return { win, localStorage };
}

console.log('\nproduct-library.js v3 → v4 migration (merge, not wipe)');
console.log('──────────────────────────────────────────────────');

const DEFAULTS_COUNT = PRODUCTS.length;
const freshHdz = JSON.parse(JSON.stringify(PRODUCTS.find(p => p.id === 'shingle_001')));
const freshHd = JSON.parse(JSON.stringify(PRODUCTS.find(p => p.id === 'shingle_002')));

// v3 store: one user-EDITED default, one untouched (stale) default,
// one user-CREATED custom product.
const editedDefault = Object.assign(JSON.parse(JSON.stringify(freshHdz)), {
  name: 'EDITED HDZ (user pricing)',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z' // != createdAt → user-edited
});
editedDefault.pricing.good.sell = 999;

const staleDefault = Object.assign(JSON.parse(JSON.stringify(freshHd)), {
  name: 'STALE PRE-V4 NAME',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z' // == createdAt → untouched, refresh it
});

const customProduct = {
  id: 'prod_1700000000_joecap', name: 'Joe Custom Ridge Cap', description: 'User-created product',
  category: 'roofing_flashing', section: 'Ridge', unit: 'BDNL', unitOptions: ['BDNL'],
  coverage: null, defaultQty: 1, colors: [], styles: [], sizes: [],
  pricing: { good: { sell: 50, cost: 20 }, better: { sell: 60, cost: 25 }, best: { sell: 75, cost: 30 } },
  labor: { perUnit: 10, ratePerManHour: 35, crewSize: 1, hoursPerUnit: 0.2, overheadMultiplier: 1.35, profitMarginPct: 25 },
  manufacturer: 'Custom', sku: '', warranty: '', isActive: true, isDefault: false, sortOrder: 99,
  tags: ['custom'], notes: '',
  createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z'
};

const v3Store = JSON.stringify({ _v: 3, items: [editedDefault, staleDefault, customProduct] });
const migrated = loadLibraryWith({ nbd_product_library: v3Store });
const savedRaw = migrated.localStorage.getItem('nbd_product_library');
const saved = savedRaw ? JSON.parse(savedRaw) : null;
const savedById = saved ? new Map(saved.items.map(p => [p.id, p])) : new Map();

test('migrated store is stamped _v = 4', () => {
  ok(saved, 'nothing saved to localStorage');
  eq(saved._v, 4);
});

test('user-EDITED default survives (name + custom sell price kept)', () => {
  const p = savedById.get('shingle_001');
  ok(p, 'shingle_001 missing after migration');
  eq(p.name, 'EDITED HDZ (user pricing)', 'name');
  eq(p.pricing.good.sell, 999, 'good sell');
});

test('user-CREATED product survives migration', () => {
  const p = savedById.get('prod_1700000000_joecap');
  ok(p, 'custom product wiped by migration');
  eq(p.name, 'Joe Custom Ridge Cap', 'name');
  eq(p.pricing.best.sell, 75, 'best sell');
});

test('untouched default is REFRESHED from the new catalog', () => {
  const p = savedById.get('shingle_002');
  ok(p, 'shingle_002 missing');
  eq(p.name, freshHd.name, 'stale copy should be replaced by fresh default');
});

test('new default SKUs appear after migration (chim_001 + RoofIVent)', () => {
  ok(savedById.has('chim_001'), 'chim_001 missing');
  ok(savedById.has('riv_turbo_round_6'), 'riv_turbo_round_6 missing');
});

test('migrated item count = all defaults + 1 custom (no dupes, no losses)', () => {
  eq(saved.items.length, DEFAULTS_COUNT + 1);
});

test('no-store case still seeds full defaults at v4', () => {
  const fresh = loadLibraryWith({});
  const s = JSON.parse(fresh.localStorage.getItem('nbd_product_library'));
  eq(s._v, 4, '_v');
  eq(s.items.length, DEFAULTS_COUNT, 'seeded count');
});

test('matching-version store is used as-is (no reseed at _v 4)', () => {
  const tiny = JSON.stringify({ _v: 4, items: [customProduct] });
  const same = loadLibraryWith({ nbd_product_library: tiny });
  const s = JSON.parse(same.localStorage.getItem('nbd_product_library'));
  eq(s.items.length, 1, 'v4 store must not be reseeded');
});

// ── 4. Archive / hard-delete survive migration (P1-P3) ──

console.log('\nproduct-library.js archive + tombstone survival');
console.log('──────────────────────────────────────────────────');

test('archived default (pre-P1 store: isActive=false, updatedAt===createdAt) survives migration as archived', () => {
  const archived = Object.assign(JSON.parse(JSON.stringify(PRODUCTS.find(p => p.id === 'shingle_003'))), {
    name: 'ARCHIVED PRE-P1 COPY',
    isActive: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z' // == createdAt: timestamps say untouched, archive flag says user intent
  });
  const store = JSON.stringify({ _v: 3, items: [archived] });
  const res = loadLibraryWith({ nbd_product_library: store });
  const s = JSON.parse(res.localStorage.getItem('nbd_product_library'));
  const p = s.items.find(x => x.id === 'shingle_003');
  ok(p, 'shingle_003 missing after migration');
  eq(p.isActive, false, 'archive flag must survive (default must NOT be resurrected active)');
  eq(p.name, 'ARCHIVED PRE-P1 COPY', 'stored archived copy must be kept verbatim');
});

test('tombstoned default (_deleted) stays gone through migration and _deleted is preserved', () => {
  const store = JSON.stringify({ _v: 3, items: [customProduct], _deleted: ['shingle_004'] });
  const res = loadLibraryWith({ nbd_product_library: store });
  const s = JSON.parse(res.localStorage.getItem('nbd_product_library'));
  ok(!s.items.some(x => x.id === 'shingle_004'), 'hard-deleted default resurrected by migration');
  ok(Array.isArray(s._deleted) && s._deleted.includes('shingle_004'), '_deleted tombstone not preserved by saveAll');
  ok(s.items.some(x => x.id === 'prod_1700000000_joecap'), 'custom product lost');
});

test('deleteProduct() stamps updatedAt (archive counts as an edit)', () => {
  const item = Object.assign(JSON.parse(JSON.stringify(PRODUCTS.find(p => p.id === 'shingle_001'))), {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  });
  const store = JSON.stringify({ _v: 4, items: [item] });
  const res = loadLibraryWith({ nbd_product_library: store });
  res.win._productLib.delete('shingle_001');
  const s = JSON.parse(res.localStorage.getItem('nbd_product_library'));
  const p = s.items.find(x => x.id === 'shingle_001');
  ok(p, 'shingle_001 missing after archive');
  eq(p.isActive, false, 'isActive');
  ok(p.updatedAt !== p.createdAt, 'updatedAt must be bumped on archive so migration keeps it');
});

test('end-to-end: hardDelete writes tombstone, next migration does not resurrect', () => {
  // Fresh seed at v4, hard-delete a default, then replay the resulting store
  // through a version-mismatch migration (as a future v5 bump would).
  const first = loadLibraryWith({});
  first.win._productLib.hardDelete('shingle_003');
  const afterDelete = JSON.parse(first.localStorage.getItem('nbd_product_library'));
  ok(!afterDelete.items.some(x => x.id === 'shingle_003'), 'item not removed by hardDelete');
  ok(Array.isArray(afterDelete._deleted) && afterDelete._deleted.includes('shingle_003'), 'tombstone not recorded');

  afterDelete._v = 3; // simulate a stale store hitting the current DATA_VERSION
  const second = loadLibraryWith({ nbd_product_library: JSON.stringify(afterDelete) });
  const s = JSON.parse(second.localStorage.getItem('nbd_product_library'));
  ok(!s.items.some(x => x.id === 'shingle_003'), 'tombstoned default resurrected on migration');
  ok(s._deleted.includes('shingle_003'), 'tombstone dropped after migration');
  eq(s.items.length, DEFAULTS_COUNT - 1, 'migrated count should be all defaults minus the tombstoned one');
});

console.log('──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exitCode = 1;

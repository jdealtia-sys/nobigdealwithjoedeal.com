/**
 * tests/job-template-cost-seed.test.js
 *
 * The BEHAVIOUR half of the tenant-owned JOB TEMPLATE cost model (the leak
 * guard itself lives in tests/catalog-cost-privacy.test.js). Mirrors
 * tests/catalog-cost-seed.test.js, which does this job for the product
 * catalog — same four sections, same reasons.
 *
 *   1. Lossless split — strip(full) === the published template and
 *      merge(published, book) === full, byte-for-byte via JSON.stringify so
 *      key ORDER is asserted too. Plus hasJtPrivateFields() === false across
 *      all 107 REAL templates: the published file is the assertion's subject,
 *      not a fixture.
 *   2. validateJtCostOverlay — the "costs >= 0, at least one > 0" invariant
 *      that used to live in tests/job-templates.test.js, where it REQUIRED the
 *      leak to be present. Each failure mode gets a mutant.
 *   3. Client hydration — catalog-costs.js + job-templates.js driven through
 *      window / localStorage / Firestore shims: warm path, cold path
 *      (applyJtCostSeed re-registering after JT already booted unset),
 *      recordJobItem's dotted-path write, the adoptLocal fix for a
 *      jtCosts-only document, a fork no longer re-embedding costs, and a rep
 *      whose write is refused by rules.
 *   4. The KEY is the contract — jtKey() must agree with job-templates.js's
 *      jtCostKey() character for character, and the whole key set is pinned by
 *      hash. A silent re-key orphans every tenant's book.
 *
 * Pure-Node, no emulator. Run: node tests/job-template-cost-seed.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PRO_JS = path.join(ROOT, 'docs', 'pro', 'js');
const {
  JT_PRIVATE_KEYS, SEED_VERSION, slugify, jtKey,
  extractJtCosts, stripJtCosts, hasJtPrivateFields,
  buildJtCostOverlay, validateJtCostOverlay,
} = require(path.join(ROOT, 'functions', 'job-template-cost-logic.js'));

let passed = 0, failed = 0;
const fails = [];

// Several cases here await a Firestore hydrate, so tests are QUEUED onto one
// chain and run in order rather than fired synchronously. A plain
// `try { fn() }` would report an async case as passing and then kill the
// process with an unhandled rejection AFTER the summary printed — which is
// exactly what it did while this file was being written.
let chain = Promise.resolve();
function test(name, fn) {
  chain = chain.then(async () => {
    try { await fn(); console.log('  ✓ ' + name); passed++; }
    catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failed++; fails.push(name + ': ' + e.message); }
  });
}
function section(title) {
  chain = chain.then(() => {
    console.log('\n' + title);
    console.log('──────────────────────────────────────────────────');
  });
}
function ok(cond, label) { if (!cond) throw new Error(label || 'assertion failed'); }
function eq(a, b, label) {
  if (a !== b) throw new Error((label || 'value') + ' = ' + JSON.stringify(a) + ' (expected ' + JSON.stringify(b) + ')');
}

const TENANT = 'co_test';
const CACHE_PREFIX = 'nbd_catalog_costs';
const CACHE_KEY = CACHE_PREFIX + ':' + TENANT;
const BOOK_PATH = 'catalogCosts/' + TENANT;

const SRC = {};
[
  'estimate-config.js', 'product-data.js', 'roofivent-catalog.js', 'catalog-costs.js',
  'product-library.js', 'estimate-labor-catalog.js', 'estimate-builder-v2.js',
  'estimate-catalog-xactimate.js', 'estimate-logic-engine.js',
  'job-templates-data.js', 'job-templates.js',
].forEach((f) => {
  const p = path.join(PRO_JS, f);
  if (fs.existsSync(p)) SRC[f] = fs.readFileSync(p, 'utf8');
});

function loadLibrary() {
  const win = {};
  win.window = win;
  vm.runInNewContext(SRC['job-templates-data.js'], { window: win, Date, Math, JSON, Set, Object }, { filename: 'job-templates-data.js' });
  return win.NBD_JOB_TEMPLATES;
}
const PUBLIC = loadLibrary();

/**
 * Rebuild a plausible PRE-STRIP template: costs put back inside each custom
 * block, in the position they occupied. Deterministic and INVENTED (index-
 * derived) so assertions are readable and no real figure is checked into the
 * repo — the real ones live in the tenant's Firestore book, which is the whole
 * point of the migration.
 *
 * Key order matters: the published shape is
 * {name, desc, unit, qty, category} and the pre-strip shape was
 * {name, desc, unit, qty, materialCost, laborCost, category}. Reinsert in that
 * position or the lossless assertion is testing nothing.
 */
function synthCosts(i) {
  return { materialCost: Math.round((3 + i * 1.5) * 100) / 100, laborCost: Math.round((7 + i * 2.25) * 100) / 100 };
}
function makeFull(tpl) {
  const full = JSON.parse(JSON.stringify(tpl));
  full.items = (full.items || []).map((item, i) => {
    if (!item || !item.custom) return item;
    const c = item.custom;
    const rebuilt = {};
    Object.keys(c).forEach((k) => {
      if (k === 'category') Object.assign(rebuilt, synthCosts(i));
      rebuilt[k] = c[k];
    });
    // A custom block with no `category` key would otherwise lose the costs.
    if (!('materialCost' in rebuilt)) Object.assign(rebuilt, synthCosts(i));
    return Object.assign({}, item, { custom: rebuilt });
  });
  return full;
}
const FULL = PUBLIC.map(makeFull);
const BOOK = buildJtCostOverlay(FULL);

/** Put the private half back — the inverse of stripJtCosts, for the round trip. */
function mergeJtCosts(tpl, jtCosts) {
  const out = JSON.parse(JSON.stringify(tpl));
  out.items = (out.items || []).map((item, i) => {
    if (!item || !item.custom) return item;
    const entry = jtCosts[jtKey(tpl.id, i)];
    if (!entry) return item;
    const c = item.custom;
    const rebuilt = {};
    Object.keys(c).forEach((k) => {
      if (k === 'category') { rebuilt.materialCost = entry.materialCost; rebuilt.laborCost = entry.laborCost; }
      rebuilt[k] = c[k];
    });
    if (!('materialCost' in rebuilt)) { rebuilt.materialCost = entry.materialCost; rebuilt.laborCost = entry.laborCost; }
    return Object.assign({}, item, { custom: rebuilt });
  });
  return out;
}

/* ── 1. lossless split ─────────────────────────────────────────────────── */

section('job-template split is lossless (' + PUBLIC.length + ' templates)');

test('strip(full) reproduces the published template exactly (key order included)', () => {
  const bad = [];
  FULL.forEach((f, i) => {
    if (JSON.stringify(stripJtCosts(f)) !== JSON.stringify(PUBLIC[i])) bad.push(PUBLIC[i].id);
  });
  ok(bad.length === 0, bad.length + ' template(s) differ after strip: ' + bad.slice(0, 4).join(', '));
});

test('merge(published, book) reproduces the full template exactly', () => {
  const bad = [];
  PUBLIC.forEach((p, i) => {
    if (JSON.stringify(mergeJtCosts(p, BOOK.jtCosts)) !== JSON.stringify(FULL[i])) bad.push(p.id);
  });
  ok(bad.length === 0, bad.length + ' template(s) differ after merge: ' + bad.slice(0, 4).join(', '));
});

test('the PUBLISHED library carries no private cost field on any template', () => {
  const leaking = PUBLIC.filter(hasJtPrivateFields).map((t) => t.id);
  ok(leaking.length === 0, 'leaking: ' + leaking.slice(0, 5).join(', '));
});

test('the guard is non-vacuous — the pre-strip fixture IS flagged', () => {
  const flagged = FULL.filter(hasJtPrivateFields).length;
  ok(flagged >= 40, 'only ' + flagged + ' pre-strip templates flagged (expected >= 40)');
});

test('every custom item is covered by exactly one overlay entry (84 of them)', () => {
  let customs = 0;
  PUBLIC.forEach((t) => (t.items || []).forEach((it) => { if (it && it.custom && it.custom.name) customs++; }));
  eq(customs, 84, 'live custom items');
  eq(Object.keys(BOOK.jtCosts).length, 84, 'overlay entries');
});

test('extractJtCosts returns NULL for a template with no cost data (no invented zeroes)', () => {
  eq(extractJtCosts(PUBLIC.find((t) => (t.items || []).some((i) => i && i.custom))), null, 'stripped template');
  eq(extractJtCosts({ id: 'x', items: [{ code: 'LAB MOB' }] }), null, 'coded-only template');
  eq(extractJtCosts(null), null, 'null');
});

test('buildJtCostOverlay stamps the seed version and nothing else', () => {
  eq(BOOK.version, SEED_VERSION, 'version');
  eq(Object.keys(BOOK).sort().join(','), 'jtCosts,version', 'overlay top-level keys');
  // Deliberate: unlike the product overlay there is NO `defaults` block. JT
  // custom items are tier:'any' and carry no labor policy, so there is no
  // company-wide mode to derive and nothing for a form to prefill.
});

/* ── 2. validateJtCostOverlay ──────────────────────────────────────────── */

section('validateJtCostOverlay (the invariant that left the public file)');

const A_KEY = Object.keys(BOOK.jtCosts)[0];
function mutant(fn) {
  const clone = JSON.parse(JSON.stringify(BOOK));
  fn(clone);
  return validateJtCostOverlay(clone, PUBLIC);
}

test('control: the real overlay validates against the published library', () => {
  const r = validateJtCostOverlay(BOOK, PUBLIC);
  ok(r.ok, r.errors.slice(0, 3).join(' | '));
  eq(r.warnings.length, 0, 'warnings');
});

test('MUTANT killed: a non-finite cost', () => {
  const r = mutant((o) => { o.jtCosts[A_KEY].materialCost = 'free'; });
  ok(!r.ok && /materialCost/.test(r.errors.join(' ')), r.errors.join(' | '));
});

test('MUTANT killed: a negative cost', () => {
  const r = mutant((o) => { o.jtCosts[A_KEY].laborCost = -5; });
  ok(!r.ok && />= 0/.test(r.errors.join(' ')), r.errors.join(' | '));
});

test('MUTANT killed: BOTH costs zero (the "at least one > 0" invariant)', () => {
  const r = mutant((o) => { o.jtCosts[A_KEY] = { materialCost: 0, laborCost: 0 }; });
  ok(!r.ok && /both 0/.test(r.errors.join(' ')), r.errors.join(' | '));
});

test('MUTANT killed: an unknown key smuggled into an entry', () => {
  const r = mutant((o) => { o.jtCosts[A_KEY].overheadMultiplier = 1.35; });
  ok(!r.ok && /unknown key overheadMultiplier/.test(r.errors.join(' ')), r.errors.join(' | '));
});

test('MUTANT killed: a version mismatch', () => {
  const r = mutant((o) => { o.version = 99; });
  ok(!r.ok && /version/.test(r.errors.join(' ')), r.errors.join(' | '));
});

test('MUTANT killed: an incomplete book (a live item with no entry)', () => {
  const r = mutant((o) => { delete o.jtCosts[A_KEY]; });
  ok(!r.ok && /no overlay entry/.test(r.errors.join(' ')), r.errors.join(' | '));
});

test('incompleteness is waivable with requireComplete:false (an ongoing edit is not a migration)', () => {
  const clone = JSON.parse(JSON.stringify(BOOK));
  delete clone.jtCosts[A_KEY];
  ok(validateJtCostOverlay(clone, PUBLIC, { requireComplete: false }).ok);
});

test('an ORPHAN key is a WARNING, not an error (a retired template must not strand 83 entries)', () => {
  const clone = JSON.parse(JSON.stringify(BOOK));
  clone.jtCosts['jt-retired-template-0'] = { materialCost: 5, laborCost: 9 };
  const r = validateJtCostOverlay(clone, PUBLIC);
  ok(r.ok, 'should still validate: ' + r.errors.slice(0, 2).join(' | '));
  ok(r.warnings.some((w) => /jt-retired-template-0/.test(w)), 'expected a warning');
});

test('shape-only mode (no library) still refuses a corrupted book', () => {
  ok(validateJtCostOverlay(BOOK, null).ok, 'clean book');
  const clone = JSON.parse(JSON.stringify(BOOK));
  clone.jtCosts[A_KEY] = { materialCost: null, laborCost: null };
  ok(!validateJtCostOverlay(clone, null).ok, 'a book of nulls must be refused, not served');
});

test('a book that is not an object, or has no jtCosts map, is refused', () => {
  ok(!validateJtCostOverlay(null, PUBLIC).ok);
  ok(!validateJtCostOverlay({ version: SEED_VERSION }, PUBLIC).ok);
});

/* ── 3. client hydration ───────────────────────────────────────────────── */

section('client hydration (catalog-costs.js → job-templates.js bridge)');

function makeLocalStorage(seed) {
  const store = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    _keys: () => Array.from(store.keys()),
  };
}

// setDoc(...,{merge:true}) DEEP-merges nested maps; updateDoc with a dotted
// path REPLACES the value at that path. A stub that treated both the same
// would hide the very bug the dotted-path write exists to fix.
function deepMerge(prev, next) {
  const out = Object.assign({}, prev);
  Object.keys(next).forEach((k) => {
    const a = out[k], b = next[k];
    const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
    out[k] = (isMap(a) && isMap(b)) ? deepMerge(a, b) : b;
  });
  return out;
}

function makeFirestore(docs, opts) {
  const state = Object.assign({ denyWrite: false, reads: 0, writes: 0, failRead: false }, opts || {});
  const guard = () => {
    if (state.denyWrite) { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; }
  };
  return {
    doc: (db, col, id) => ({ __path: col + '/' + id }),
    getDoc: async (ref) => {
      state.reads++;
      if (state.failRead) { const e = new Error('client is offline'); e.code = 'unavailable'; throw e; }
      const data = docs[ref.__path];
      return { exists: () => !!data, data: () => (data ? JSON.parse(JSON.stringify(data)) : null) };
    },
    setDoc: async (ref, data, options) => {
      guard(); state.writes++;
      const prev = (options && options.merge && docs[ref.__path]) ? docs[ref.__path] : {};
      docs[ref.__path] = JSON.parse(JSON.stringify(deepMerge(prev, data)));
    },
    updateDoc: async (ref, paths) => {
      guard();
      const prev = docs[ref.__path];
      if (!prev) { const e = new Error('No document to update'); e.code = 'not-found'; throw e; }
      state.writes++;
      const next = JSON.parse(JSON.stringify(prev));
      Object.keys(paths).forEach((p) => {
        const parts = p.split('.');
        let cur = next;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = JSON.parse(JSON.stringify(paths[p])); // REPLACE
      });
      docs[ref.__path] = next;
    },
    __state: state,
  };
}

/** Boot the real estimates-bundle order in one context. */
function boot(cfg) {
  cfg = cfg || {};
  const docs = cfg.docs || {};
  const win = {};
  win.window = win;
  const localStorage = makeLocalStorage(cfg.storage || {});
  // BOTH spellings. product-library.js reads the bare global; job-templates.js
  // reads window.localStorage. Wiring only the global made loadCustoms() return
  // [] silently, so every fork/legacy assertion below passed vacuously.
  win.localStorage = localStorage;
  const fsStub = makeFirestore(docs, cfg.fs);
  const sandbox = {
    window: win, localStorage,
    document: {
      addEventListener() {}, removeEventListener() {},
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {}, setAttribute() {} }),
      body: { appendChild() {} },
    },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    navigator: {},
    Date, Math, JSON, Set, Map, Object, isFinite, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.createContext(sandbox);
  const run = (f) => { if (SRC[f]) vm.runInContext(SRC[f], sandbox, { filename: f }); };
  run('estimate-config.js');
  run('product-data.js');
  run('roofivent-catalog.js');
  // Tenant identity + Firestore, wired BEFORE catalog-costs.js so its
  // boot-time hydrate() exercises the real read path.
  win._userClaims = cfg.claims === undefined ? { companyId: TENANT } : cfg.claims;
  win.db = {};
  win.__NBD_FS__ = fsStub;
  run('catalog-costs.js');
  run('product-library.js');
  run('estimate-labor-catalog.js');
  run('estimate-builder-v2.js');
  run('estimate-catalog-xactimate.js');
  run('estimate-logic-engine.js');
  run('job-templates-data.js');
  run('job-templates.js');
  return {
    win, localStorage, docs, fsStub,
    bookDoc: () => docs[BOOK_PATH],
    xactFind: (code) => win.NBD_XACT_CATALOG.find(code),
  };
}

// A real key + its template, taken from the live library so the assertions
// below are about the shipped data, not a fixture.
const SAMPLE = (() => {
  for (const t of PUBLIC) {
    for (let i = 0; i < (t.items || []).length; i++) {
      const it = t.items[i];
      if (it && it.custom && it.custom.name && Number(it.custom.qty) > 0) {
        return { tpl: t, index: i, custom: it.custom, key: jtKey(t.id, i) };
      }
    }
  }
  return null;
})();
const SAMPLE_CODE = 'JT ' + slugify(SAMPLE.tpl.id).toUpperCase() + '-' + SAMPLE.index;
const TENANT_ENTRY = { materialCost: 12.5, laborCost: 30 };

test('NO BOOK: the item registers at an EXPLICIT zero, flagged costUnset', () => {
  const env = boot({});
  const found = env.xactFind(SAMPLE_CODE);
  ok(found, 'JT code did not register at all');
  eq(found.materialCost, 0, 'materialCost');
  eq(found.laborCost, 0, 'laborCost');
  eq(found.costUnset, true, 'costUnset');
  eq(found.costSource, null, 'costSource');
  // The reason the zero is explicit rather than omitted, asserted rather than
  // described: an omitted laborCost would let inferLaborId resolve a public
  // NBD_LABOR rate for 14 of these 84 items.
  const line = env.win.JobTemplates.resolveSelection([{ templateId: SAMPLE.tpl.id }], { tier: 'better' })
    .lines.find((l) => l.code === SAMPLE_CODE);
  eq(line.labSource, 'explicit', 'labSource');
  eq(line.matSource, 'explicit', 'matSource');
  eq(line.retailTotal, 0, 'retailTotal');
  eq(line.costUnset, true, 'line costUnset');
});

test('WARM device: the cached book is applied before job-templates.js evaluates', () => {
  const cached = { version: SEED_VERSION, jtCosts: {} };
  cached.jtCosts[SAMPLE.key] = TENANT_ENTRY;
  const storage = {};
  storage[CACHE_KEY] = JSON.stringify(cached);
  const env = boot({ storage });
  const found = env.xactFind(SAMPLE_CODE);
  eq(found.materialCost, TENANT_ENTRY.materialCost, 'materialCost');
  eq(found.laborCost, TENANT_ENTRY.laborCost, 'laborCost');
  eq(found.costUnset, false, 'costUnset');
  eq(found.costSource, 'book', 'costSource');
});

test('WARM device: a jtCosts-ONLY cache is a real book (not discarded for lacking `costs`)', () => {
  const cached = { version: SEED_VERSION, jtCosts: {} };
  cached.jtCosts[SAMPLE.key] = TENANT_ENTRY;
  const storage = {};
  storage[CACHE_KEY] = JSON.stringify(cached);
  const env = boot({ storage });
  ok(env.win.NBDCatalogCosts.get(), 'readCache returned null for a jtCosts-only book');
  ok(env.win.NBDCatalogCosts.jobItem(SAMPLE.key), 'jobItem() could not see it');
});

test('COLD device: applyJtCostSeed re-registers after JT already booted unset', async () => {
  const docs = {};
  docs[BOOK_PATH] = { version: SEED_VERSION, jtCosts: {} };
  docs[BOOK_PATH].jtCosts[SAMPLE.key] = TENANT_ENTRY;
  const env = boot({ docs });
  // At this instant the Firestore read has not resolved: the bridge ran unset.
  eq(env.xactFind(SAMPLE_CODE).costUnset, true, 'pre-hydrate costUnset');
  await env.win.NBDCatalogCosts.hydrate();
  await new Promise((r) => setTimeout(r, 0));
  const found = env.xactFind(SAMPLE_CODE);
  eq(found.materialCost, TENANT_ENTRY.materialCost, 'post-hydrate materialCost');
  eq(found.costUnset, false, 'post-hydrate costUnset');
  eq(env.win.EstimateBuilderV2.CATALOG[SAMPLE.key].cost, TENANT_ENTRY.materialCost, 'V2 CATALOG cost');
});

test('COLD device: the book is cached for next boot', async () => {
  const docs = {};
  docs[BOOK_PATH] = { version: SEED_VERSION, jtCosts: {} };
  docs[BOOK_PATH].jtCosts[SAMPLE.key] = TENANT_ENTRY;
  const env = boot({ docs });
  await env.win.NBDCatalogCosts.hydrate();
  const cached = JSON.parse(env.localStorage.getItem(CACHE_KEY));
  eq(cached.jtCosts[SAMPLE.key].laborCost, TENANT_ENTRY.laborCost, 'cached laborCost');
});

test('recordJobItem writes a DOTTED path (per-item REPLACE, not a deep merge)', async () => {
  const docs = {};
  docs[BOOK_PATH] = { version: SEED_VERSION, jtCosts: { 'jt-other-0': { materialCost: 1, laborCost: 2 } } };
  docs[BOOK_PATH].jtCosts[SAMPLE.key] = { materialCost: 99, laborCost: 99 };
  const env = boot({ docs });
  await env.win.NBDCatalogCosts.hydrate();
  const wrote = await env.win.NBDCatalogCosts.recordJobItem(SAMPLE.key, { materialCost: 4, laborCost: 8 });
  ok(wrote, 'write reported failure');
  eq(env.bookDoc().jtCosts[SAMPLE.key].materialCost, 4, 'replaced materialCost');
  eq(env.bookDoc().jtCosts[SAMPLE.key].laborCost, 8, 'replaced laborCost');
  eq(env.bookDoc().jtCosts['jt-other-0'].materialCost, 1, 'the sibling entry must be untouched');
});

test('recordJobItem refuses a non-numeric or negative entry rather than writing it', async () => {
  const docs = {};
  docs[BOOK_PATH] = { version: SEED_VERSION, jtCosts: {} };
  const env = boot({ docs });
  await env.win.NBDCatalogCosts.hydrate();
  eq(await env.win.NBDCatalogCosts.recordJobItem(SAMPLE.key, { materialCost: 'x', laborCost: 1 }), false, 'non-numeric');
  eq(await env.win.NBDCatalogCosts.recordJobItem(SAMPLE.key, { materialCost: -1, laborCost: 1 }), false, 'negative');
  eq(await env.win.NBDCatalogCosts.recordJobItem('', { materialCost: 1, laborCost: 1 }), false, 'empty key');
});

test('a REP whose write is refused by rules gets false, never a throw', async () => {
  const docs = {};
  docs[BOOK_PATH] = { version: SEED_VERSION, jtCosts: {} };
  const env = boot({ docs, fs: { denyWrite: true } });
  await env.win.NBDCatalogCosts.hydrate();
  eq(await env.win.NBDCatalogCosts.recordJobItem(SAMPLE.key, { materialCost: 4, laborCost: 8 }), false);
});

test('THE adoptLocal FIX: a jtCosts-ONLY document still triggers the product-cost upgrade', async () => {
  // Before this fix adoptLocal() sat in hydrate's `else` branch. Once readBook
  // started accepting a jtCosts-only book, a tenant seeded with job-template
  // costs but no product costs took the `if (remote)` branch and PERMANENTLY
  // skipped the one-time upgrade that lifts product costs out of per-device
  // localStorage. The lost data would have been silent and unrecoverable.
  const docs = {};
  docs[BOOK_PATH] = { version: SEED_VERSION, jtCosts: {} };
  docs[BOOK_PATH].jtCosts[SAMPLE.key] = TENANT_ENTRY;
  const env = boot({ docs });
  await env.win.NBDCatalogCosts.hydrate();

  // The published product catalog carries no costs either (the 2026-07-30
  // migration), so a fresh store has nothing to adopt. Give this device the
  // per-device product costs the upgrade exists to rescue, then re-hydrate:
  // the document DOES have a remote book (jtCosts), so this exercises the
  // `if (remote)` branch — the exact branch adoptLocal used to sit outside of.
  env.win._productLib.getProducts = () => ([
    { id: 'shingle_001', pricing: { good: { cost: 11 }, better: { cost: 22 }, best: { cost: 33 } } },
  ]);
  await env.win.NBDCatalogCosts.hydrate({ force: true });
  await new Promise((r) => setTimeout(r, 0));

  ok(env.bookDoc().jtCosts[SAMPLE.key], 'jtCosts must survive');
  const adopted = Object.keys(env.bookDoc().costs || {}).length;
  ok(adopted > 0, 'adoptLocal did not run for a jtCosts-only book (0 product costs adopted)');
  eq(env.bookDoc().costs.shingle_001.cost.good, 11, 'adopted product cost');
});

test('a FORK no longer re-embeds cost data into the template document', async () => {
  const docs = {};
  docs[BOOK_PATH] = { version: SEED_VERSION, jtCosts: {} };
  const env = boot({ docs });
  await env.win.NBDCatalogCosts.hydrate();
  const forked = env.win.JobTemplates.saveCustom({
    id: 'jt_fork_probe', name: 'Fork probe', category: 'roof_repair', jobType: 'repair',
    items: [{ code: 'LAB MOB' }, { custom: { name: 'Probe item', unit: 'EA', qty: 1, materialCost: 11, laborCost: 22, category: 'roofing' } }],
  });
  const stored = (JSON.parse(env.localStorage.getItem('nbd_job_templates_v1')).items || [])
    .find((t) => t.id === 'jt_fork_probe');
  ok(stored, 'fork not persisted');
  ok(!('materialCost' in stored.items[1].custom), 'materialCost was re-embedded into the template doc');
  ok(!('laborCost' in stored.items[1].custom), 'laborCost was re-embedded into the template doc');
  await new Promise((r) => setTimeout(r, 0));
  const key = jtKey('jt_fork_probe', 1);
  eq(env.bookDoc().jtCosts[key].materialCost, 11, 'lifted materialCost');
  eq(env.bookDoc().jtCosts[key].laborCost, 22, 'lifted laborCost');
});

test('DUPLICATE carries the source template\'s costs onto the new keys', async () => {
  const docs = {};
  docs[BOOK_PATH] = { version: SEED_VERSION, jtCosts: {} };
  docs[BOOK_PATH].jtCosts[SAMPLE.key] = TENANT_ENTRY;
  const env = boot({ docs });
  await env.win.NBDCatalogCosts.hydrate();
  await new Promise((r) => setTimeout(r, 0));
  const copy = env.win.JobTemplates.duplicate(SAMPLE.tpl.id);
  ok(copy && copy.id !== SAMPLE.tpl.id, 'duplicate minted no new id');
  await new Promise((r) => setTimeout(r, 0));
  const newKey = jtKey(copy.id, SAMPLE.index);
  ok(env.bookDoc().jtCosts[newKey], 'the duplicate would have resolved unpriced — costs were not carried');
  eq(env.bookDoc().jtCosts[newKey].materialCost, TENANT_ENTRY.materialCost, 'carried materialCost');
});

test('adoptLegacyCosts lifts a PRE-STRIP fork\'s embedded costs into the company book', async () => {
  const legacy = [{
    id: 'jt_legacy_fork', name: 'Legacy fork', custom: true, category: 'roof_repair', jobType: 'repair',
    items: [{ code: 'LAB MOB' }, { custom: { name: 'Old item', unit: 'EA', qty: 1, materialCost: 13, laborCost: 37, category: 'roofing' } }],
  }];
  const docs = {};
  docs[BOOK_PATH] = { version: SEED_VERSION, jtCosts: {} };
  docs[BOOK_PATH].jtCosts[SAMPLE.key] = TENANT_ENTRY;
  const env = boot({ docs, storage: { nbd_job_templates_v1: JSON.stringify({ _v: 1, items: legacy }) } });
  // The fork prices from its embedded costs even before adoption — a tenant
  // must not lose pricing on deploy day.
  const code = 'JT ' + slugify('jt_legacy_fork').toUpperCase() + '-1';
  const found = env.xactFind(code);
  ok(found, 'legacy fork item did not register');
  eq(found.costSource, 'legacy-template', 'costSource');
  eq(found.materialCost, 13, 'legacy materialCost still readable');
  await env.win.NBDCatalogCosts.hydrate();
  await new Promise((r) => setTimeout(r, 0));
  const key = jtKey('jt_legacy_fork', 1);
  ok(env.bookDoc().jtCosts[key], 'legacy costs were not adopted into the book');
  eq(env.bookDoc().jtCosts[key].laborCost, 37, 'adopted laborCost');
  // The book stays the authority — adoption must never overwrite it.
  eq(env.bookDoc().jtCosts[SAMPLE.key].materialCost, TENANT_ENTRY.materialCost, 'existing entry clobbered');
});

test('a FAILED read never adopts (a flaky boot must not upload a half-empty book)', async () => {
  const docs = {};
  const env = boot({ docs, fs: { failRead: true } });
  await env.win.NBDCatalogCosts.hydrate();
  await new Promise((r) => setTimeout(r, 0));
  eq(env.bookDoc(), undefined, 'a document was written despite the read failing');
});

/* ── 4. the key is the contract ────────────────────────────────────────── */

section('the key is the contract (jtKey / slugify parity + a frozen key set)');

test('slugify() is character-identical to job-templates.js:slugify', () => {
  const client = SRC['job-templates.js'].match(/function slugify\(name\) \{[\s\S]*?\n  \}/);
  ok(client, 'could not find slugify() in job-templates.js');
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  eq(norm(client[0]), norm(slugify.toString()), 'slugify source');
});

test('jtKey() agrees with job-templates.js:jtCostKey for every live custom item', () => {
  const env = boot({});
  const clientKey = env.win.JobTemplates.jtCostKey;
  ok(typeof clientKey === 'function', 'jtCostKey is not exported');
  const bad = [];
  PUBLIC.forEach((t) => (t.items || []).forEach((it, i) => {
    if (!it || !it.custom || !it.custom.name) return;
    if (clientKey(t.id, i) !== jtKey(t.id, i)) bad.push(t.id + '[' + i + ']');
  }));
  ok(bad.length === 0, bad.length + ' key(s) disagree: ' + bad.slice(0, 4).join(', '));
});

test('the full key set is unchanged (a silent re-key orphans every tenant\'s book)', () => {
  // A template id change, an item REORDER, or an inserted item all re-key the
  // cost book: the tenant's entries stay in Firestore under keys nothing looks
  // up any more, and the affected items silently show "Cost not set".
  //
  // If you legitimately added or reordered templates, update the hash below —
  // AND work out whether any existing tenant needs their book re-keyed. This
  // assertion exists to make that a decision rather than an accident.
  const keys = [];
  PUBLIC.forEach((t) => (t.items || []).forEach((it, i) => {
    if (it && it.custom && it.custom.name) keys.push(jtKey(t.id, i));
  }));
  keys.sort();
  eq(keys.length, 84, 'key count');
  const hash = crypto.createHash('sha256').update(keys.join('\n')).digest('hex');
  eq(hash, 'ad0726530ae3d91858d53b0d7f330d93c5d1a077329df14e6b74f562a6838e71', 'key-set sha256');
});

test('JT_PRIVATE_KEYS is exactly the two cost fields', () => {
  eq(JT_PRIVATE_KEYS.join(','), 'materialCost,laborCost');
});

chain.then(() => {
  console.log('\n──────────────────────────────────────────────────');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
});

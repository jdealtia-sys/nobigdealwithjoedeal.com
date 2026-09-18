/**
 * tests/customer-photo-fetch-unification-2026-09-17.test.js
 *
 * customer.html's overview strip (#photoList, customer-bootstrap.module.js's
 * loadPhotos()) and phase grid (#photosByPhase, customer-tasks-ui.js's
 * loadPhotosByPhase()) each ran their own independent getDocs() against the
 * IDENTICAL _photoQueryScopes(leadId) query — every lifecycle event that
 * needs both views (initial page load, upload complete) cost two Firestore
 * reads for the same lead's photos.
 *
 * Fix: a shared _fetchPhotosRaw(leadId) with in-flight de-dup — genuinely
 * concurrent callers (loadAllCustomerPhotos(), the new function used at both
 * lifecycle points) collapse into one real fetch. loadPhotos() and
 * loadPhotosByPhase() keep their own independent transform, render, and (for
 * the phase grid) IndexedDB cache completely untouched — only the underlying
 * network primitive is shared.
 *
 * Also fixed in passing: the bulk/single photo-delete handlers in
 * customer-tasks-ui.js called a BARE `loadPhotos(...)` to refresh the
 * overview strip. customer-tasks-ui.js is a classic script and loadPhotos()
 * is module-scoped in customer-bootstrap.module.js — that call threw
 * ReferenceError every time, silently swallowed by an empty catch block, so
 * #photoList never actually refreshed after a delete. Both call sites now
 * read loadPhotos off the __NBD_CALL_REGISTRY bridge (Globals Tranche 3
 * T3-C, 2026-09-18 — registry-only, not a bare window export).
 *
 * House style: vm-lift the de-dup logic (the actual novel/risky code) for
 * direct scenario testing; source-shape assert the higher-level plumbing
 * (loadAllCustomerPhotos, the delete-handler fix, loadNewPortalSections no
 * longer double-loading photos-by-phase).
 *
 * Run: node tests/customer-photo-fetch-unification-2026-09-17.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}
async function group(name, fn) { console.log('\n' + name); return fn(); }

const BOOT = read('docs/pro/js/customer-bootstrap.module.js');
const TASKS_UI = read('docs/pro/js/customer-tasks-ui.js');

function liftFunction(src, name) {
  const sig = 'function ' + name + '(';
  const start = src.indexOf(sig);
  if (start < 0) return null;
  const bodyStart = src.indexOf('{', start);
  let depth = 0, i = bodyStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return i < src.length ? src.slice(start, i + 1) : null;
}

const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

/* ══════════════════════════════════════════════════════════════════
   1. Source contract — the pieces this test's vm-lift assumes exist
   ══════════════════════════════════════════════════════════════════ */
const photoQueryScopesSrc = liftFunction(BOOT, '_photoQueryScopes');
const fetchPhotosRawSrc = liftFunction(BOOT, '_fetchPhotosRaw');

/* ══════════════════════════════════════════════════════════════════
   2. _fetchPhotosRaw — in-flight de-dup, vm-lifted and run for real
   ══════════════════════════════════════════════════════════════════ */
function makeCtx({ uid }) {
  const calls = [];
  const deferreds = [];
  const getDocs = (q) => {
    calls.push(q);
    let resolve;
    const p = new Promise((r) => { resolve = r; });
    deferreds.push({ resolve, forQuery: q });
    return p;
  };
  const ctx = {
    Map,
    Promise,
    auth: { currentUser: uid ? { uid } : null },
    getDocs,
    query: (...parts) => ({ parts }),
    collection: (db, name) => ({ db, name }),
    db: { __db: true },
    where: (field, op, val) => ({ field, op, val }),
    window: { _userClaims: {}, _currentLead: {}, _user: uid ? { uid } : null },
  };
  vm.createContext(ctx);
  vm.runInContext(
    decomment(photoQueryScopesSrc) + '\n'
    + 'const _inflightPhotoFetch = new Map();\n'
    + decomment(fetchPhotosRawSrc) + '\n'
    + 'this.__fetchPhotosRaw = _fetchPhotosRaw;\n'
    + 'this.__inflightSize = () => _inflightPhotoFetch.size;',
    ctx
  );
  return { ctx, calls, deferreds, resolveNth: (n, docs) => { deferreds[n].resolve({ docs }); } };
}

(async () => {

await group('source contract', () => {
  ok('_photoQueryScopes is present and liftable', !!photoQueryScopesSrc, 'if it moved, update the extractor');
  ok('_fetchPhotosRaw is present and liftable', !!fetchPhotosRawSrc, 'if it moved, update the extractor');
  ok('_fetchPhotosRaw is registered in __NBD_CALL_REGISTRY for customer-tasks-ui.js to reuse (Globals Tranche 3 T3-C)',
    /\b_fetchPhotosRaw:\s*_fetchPhotosRaw\b/.test(BOOT));
});

if (photoQueryScopesSrc && fetchPhotosRawSrc) {
  await group('two concurrent calls for the SAME lead collapse into one fetch', async () => {
    const { ctx, calls, resolveNth } = makeCtx({ uid: 'u1' });
    const p1 = ctx.__fetchPhotosRaw('leadA');
    const p2 = ctx.__fetchPhotosRaw('leadA');
    ok('only one getDocs() call was made for two concurrent callers', calls.length === 1, 'calls=' + calls.length);
    resolveNth(0, [{ id: 'p1', data: () => ({ url: 'https://x/1.jpg' }) }]);
    const [r1, r2] = await Promise.all([p1, p2]);
    ok('both callers resolve to equivalent data', r1.length === 1 && r2.length === 1 && r1[0].id === 'p1' && r2[0].id === 'p1');
    ok('in-flight map is empty again after resolving', ctx.__inflightSize() === 0, 'size=' + ctx.__inflightSize());
  });

  await group('concurrent calls for DIFFERENT leads are NOT collapsed', async () => {
    const { ctx, calls, resolveNth } = makeCtx({ uid: 'u1' });
    const p1 = ctx.__fetchPhotosRaw('leadA');
    const p2 = ctx.__fetchPhotosRaw('leadB');
    ok('two separate getDocs() calls were made', calls.length === 2, 'calls=' + calls.length);
    resolveNth(0, [{ id: 'a1', data: () => ({}) }]);
    resolveNth(1, [{ id: 'b1', data: () => ({}) }]);
    const [r1, r2] = await Promise.all([p1, p2]);
    ok('each lead gets its own result', r1[0].id === 'a1' && r2[0].id === 'b1');
  });

  await group('a SEQUENTIAL call after the first resolves fetches again (no permanent staleness)', async () => {
    const { ctx, calls, resolveNth } = makeCtx({ uid: 'u1' });
    const p1 = ctx.__fetchPhotosRaw('leadA');
    resolveNth(0, [{ id: 'p1', data: () => ({}) }]);
    await p1;
    const p2 = ctx.__fetchPhotosRaw('leadA');
    ok('a second, non-overlapping call issues a NEW fetch', calls.length === 2, 'calls=' + calls.length);
    resolveNth(1, [{ id: 'p2', data: () => ({}) }]);
    const r2 = await p2;
    ok('the second call gets fresh data, not a stale cached result', r2[0].id === 'p2');
  });

  await group('no signed-in user resolves to [] without touching Firestore', async () => {
    const { ctx, calls } = makeCtx({ uid: null });
    const r = await ctx.__fetchPhotosRaw('leadA');
    ok('resolves to an empty array', Array.isArray(r) && r.length === 0);
    ok('getDocs was never called', calls.length === 0);
  });

  await group('a rejected fetch still cleans up the in-flight map (no stuck de-dup on error)', async () => {
    const calls = [];
    const rejectFns = [];
    const ctx = {
      Map, Promise,
      auth: { currentUser: { uid: 'u1' } },
      getDocs: () => { calls.push(1); return new Promise((_, rej) => rejectFns.push(rej)); },
      query: (...p) => ({ p }), collection: (d, n) => ({ d, n }), db: {},
      where: (f, o, v) => ({ f, o, v }),
      window: { _userClaims: {}, _currentLead: {}, _user: { uid: 'u1' } },
    };
    vm.createContext(ctx);
    vm.runInContext(
      decomment(photoQueryScopesSrc) + '\n'
      + 'const _inflightPhotoFetch = new Map();\n'
      + decomment(fetchPhotosRawSrc) + '\n'
      + 'this.__fetchPhotosRaw = _fetchPhotosRaw;\n'
      + 'this.__inflightSize = () => _inflightPhotoFetch.size;',
      ctx
    );
    const p1 = ctx.__fetchPhotosRaw('leadA').catch((e) => e);
    rejectFns[0](new Error('boom'));
    await p1;
    ok('in-flight map is empty after a rejection', ctx.__inflightSize() === 0, 'size=' + ctx.__inflightSize());
    const before = calls.length;
    ctx.__fetchPhotosRaw('leadA');
    ok('a retry after the failure issues a fresh fetch', calls.length === before + 1);
  });
}

/* ══════════════════════════════════════════════════════════════════
   3. loadAllCustomerPhotos — fires both loaders concurrently
   ══════════════════════════════════════════════════════════════════ */
await group('loadAllCustomerPhotos', () => {
  const src = liftFunction(BOOT, 'loadAllCustomerPhotos');
  ok('is present', !!src);
  const body = decomment(src || '');
  ok('awaits loadPhotos AND window.loadPhotosByPhase together via Promise.all (not sequential awaits)',
    /Promise\.all\(\[[\s\S]*?loadPhotos\(leadId\)[\s\S]*?loadPhotosByPhase\(leadId\)[\s\S]*?\]\)/.test(body), body);
  ok('is exported for customer-tasks-ui.js and used at both lifecycle points', /window\.loadAllCustomerPhotos\s*=\s*loadAllCustomerPhotos/.test(BOOT));
});

/* ══════════════════════════════════════════════════════════════════
   4. Call sites — both "need both views" events use the unified loader
   ══════════════════════════════════════════════════════════════════ */
await group('call sites use loadAllCustomerPhotos instead of two separate calls', () => {
  const anchor1 = BOOT.indexOf('Load photos into BOTH');
  const initialLoad = BOOT.slice(anchor1, anchor1 + 700);
  ok('initial customer-page load calls loadAllCustomerPhotos', /await loadAllCustomerPhotos\(id\)/.test(initialLoad), initialLoad);

  const anchor2 = BOOT.indexOf('closeUploadModal();');
  const uploadComplete = BOOT.slice(anchor2, anchor2 + 400);
  ok('upload-complete calls loadAllCustomerPhotos, not two sequential loader calls',
    /await loadAllCustomerPhotos\(window\._customerId\)/.test(uploadComplete)
    && !/await window\.loadPhotosByPhase\(window\._customerId\);[\s\S]{0,80}await loadPhotos\(window\._customerId\)/.test(uploadComplete),
    uploadComplete);
});

await group('loadNewPortalSections no longer double-loads photos-by-phase', () => {
  const start = TASKS_UI.indexOf('window.loadNewPortalSections = async function');
  const body = TASKS_UI.slice(start, start + 900);
  ok('loadPhotosByPhase is gone from its Promise.all bundle', !/loadPhotosByPhase/.test(decomment(body)));
  ok('the other four sections it always loaded are still there',
    /loadProjectTimeline/.test(body) && /loadInvoices/.test(body) && /loadReports/.test(body) && /loadCommunicationLog/.test(body));
});

/* ══════════════════════════════════════════════════════════════════
   5. loadPhotosByPhase's fetchFresh now shares the fetch
   ══════════════════════════════════════════════════════════════════ */
await group('loadPhotosByPhase routes through the shared fetch', () => {
  const start = TASKS_UI.indexOf('window.loadPhotosByPhase = async function');
  const body = decomment(TASKS_UI.slice(start, start + 1900));
  ok('fetchFresh calls _fetchPhotosRaw off the registry (Globals Tranche 3 T3-C)',
    /window\.__NBD_CALL_REGISTRY\._fetchPhotosRaw\(leadId\)/.test(body));
  ok('no more independent getDocs() call in this function', !/window\.getDocs\(/.test(body));
  ok('still maps through photoDocToView (its own transform is untouched)', /photoDocToView\(/.test(body));
  ok('still wrapped in NBDIDBCache.revalidate with the same 30-day maxAgeMs (its own caching is untouched)',
    /NBDIDBCache\.revalidate/.test(body) && /maxAgeMs:\s*30\s*\*\s*86400000/.test(body), body);
});

/* ══════════════════════════════════════════════════════════════════
   6. The discovered-in-passing bug: delete handlers called a bare,
      undefined loadPhotos() from a classic script
   ══════════════════════════════════════════════════════════════════ */
await group('delete handlers call loadPhotos off the registry (the bare reference was ReferenceError, silently swallowed)', () => {
  ok('loadPhotos is registered in __NBD_CALL_REGISTRY (Globals Tranche 3 T3-C)', /\bloadPhotos:\s*loadPhotos\b/.test(BOOT));
  const bulkIdx = TASKS_UI.indexOf("showToast('✓ Deleted '");
  const bulkBefore = TASKS_UI.slice(Math.max(0, bulkIdx - 300), bulkIdx);
  ok('bulk-delete handler uses the registry', /await window\.__NBD_CALL_REGISTRY\.loadPhotos\(window\._customerId\)/.test(bulkBefore), bulkBefore);
  const singleIdx = TASKS_UI.indexOf("showToast('Photo deleted'");
  const singleBefore = TASKS_UI.slice(Math.max(0, singleIdx - 300), singleIdx);
  ok('single-delete handler uses the registry', /await window\.__NBD_CALL_REGISTRY\.loadPhotos\(window\._customerId\)/.test(singleBefore), singleBefore);
  ok('no remaining BARE (non-dot-qualified) loadPhotos( call anywhere in customer-tasks-ui.js',
    !/[^.\w]loadPhotos\(/.test(decomment(TASKS_UI).replace(/window\.__NBD_CALL_REGISTRY\.loadPhotos\(/g, '')));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }

})();

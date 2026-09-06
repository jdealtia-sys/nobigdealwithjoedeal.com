/**
 * photo-queue-durability.test.js — the offline photo queue survives a reload.
 *
 * WHY THIS SUITE IS BEHAVIOURAL AND NOT A GREP
 *
 * photo-offline-queue.test.js locks the *shape* of photo-engine.js's drain by
 * reading its source. That was adequate while the queue was a plain array. It
 * is not adequate for durability: the only claim that matters here is "a photo
 * queued before the page goes away is still there afterwards", and no regex
 * over a source file can establish that.
 *
 * So this suite runs docs/pro/js/photo-queue-store.js for real, against a
 * minimal in-memory IndexedDB, and simulates the reload that motivated the
 * whole change — dashboard-sw-bootstrap.js reloads on every `pageshow` with
 * event.persisted, i.e. every iOS bfcache resume — by throwing away the module
 * instance and re-evaluating the file over the same backing data. If
 * persistence regresses to memory, the reload test goes red.
 *
 * The shim implements only what the store touches (open/upgradeneeded,
 * transaction→objectStore, add/getAll/count/delete/clear) and copies every
 * ArrayBuffer on write, so a record cannot appear to survive merely because
 * the test handed it a live reference.
 *
 * Run: node tests/photo-queue-durability.test.js   (no deps, no DOM)
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

const ROOT = path.join(__dirname, '..');
const STORE_SRC = fs.readFileSync(path.join(ROOT, 'docs/pro/js/photo-queue-store.js'), 'utf8');

// ── minimal IndexedDB ────────────────────────────────────────────────────
// `disk` outlives any single module instance — that is the whole point.
function makeIDB(disk) {
  const fire = (req, prop, value) => setTimeout(() => {
    req.result = value;
    const h = req[prop];
    if (typeof h === 'function') h({ target: req });
  }, 0);

  function makeStore(table) {
    return {
      add(record) {
        const req = {};
        setTimeout(() => {
          if (disk.failWrites) {
            req.error = { name: disk.failWrites };
            if (req.onerror) req.onerror({ target: req });
            return;
          }
          const id = table.nextId++;
          // Copy the bytes: a record must not survive by reference.
          const copy = Object.assign({}, record, {
            id,
            bytes: record.bytes ? record.bytes.slice(0) : record.bytes
          });
          table.rows.set(id, copy);
          req.result = id;
          if (req.onsuccess) req.onsuccess({ target: req });
        }, 0);
        return req;
      },
      getAll() {
        const req = {};
        fire(req, 'onsuccess', [...table.rows.values()].map((r) =>
          Object.assign({}, r, { bytes: r.bytes ? r.bytes.slice(0) : r.bytes })));
        return req;
      },
      count() { const req = {}; fire(req, 'onsuccess', table.rows.size); return req; },
      delete(id) { const req = {}; table.rows.delete(id); fire(req, 'onsuccess', undefined); return req; },
      clear() { const req = {}; table.rows.clear(); fire(req, 'onsuccess', undefined); return req; }
    };
  }

  return {
    open(name, _version) {
      const req = {};
      setTimeout(() => {
        if (disk.failOpen) {
          req.error = { name: 'InvalidStateError' };
          if (req.onerror) req.onerror({ target: req });
          return;
        }
        const fresh = !disk.tables[name];
        if (fresh) disk.tables[name] = {};
        const db = {
          objectStoreNames: { contains: (s) => !!disk.tables[name][s] },
          createObjectStore(s) {
            disk.tables[name][s] = { rows: new Map(), nextId: 1 };
            return makeStore(disk.tables[name][s]);
          },
          transaction(s) {
            if (!disk.tables[name][s]) throw new Error('NotFoundError');
            return { objectStore: () => makeStore(disk.tables[name][s]) };
          }
        };
        req.result = db;
        // Upgrade only when the store is absent — matches real IDB semantics
        // closely enough that a second load reuses the existing rows.
        if (!disk.tables[name][disk.storeName]) {
          if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      }, 0);
      return req;
    }
  };
}

// ── load photo-queue-store.js as a fresh "page load" ─────────────────────
function loadStore(disk, opts = {}) {
  const localStore = disk.localStorage;
  const sandbox = {
    console: opts.quiet ? { warn() {}, log() {}, error() {} } : console,
    setTimeout, clearTimeout, Promise, Blob, Object, Array, Error, Date, JSON,
    parseInt, String, Number,
    navigator: {
      storage: {
        persisted: () => Promise.resolve(!!disk.persisted),
        persist: () => { disk.persisted = true; return Promise.resolve(true); }
      }
    },
    localStorage: {
      getItem: (k) => (k in localStore ? localStore[k] : null),
      setItem: (k, v) => { localStore[k] = String(v); },
      removeItem: (k) => { delete localStore[k]; }
    }
  };
  sandbox.window = sandbox;
  sandbox.indexedDB = disk.failOpen === 'absent' ? undefined : makeIDB(disk);
  vm.createContext(sandbox);
  vm.runInContext(STORE_SRC, sandbox);
  return sandbox.window.NBDPhotoQueueStore;
}

function newDisk() {
  return { tables: {}, localStorage: {}, storeName: 'pending-photos', persisted: false };
}

function jpeg(sizeBytes, byteVal = 7) {
  return new Blob([new Uint8Array(sizeBytes).fill(byteVal)], { type: 'image/jpeg' });
}

(async function run() {
  console.log('\nphoto-queue-durability — the queue outlives the page\n');

  // ── THE HEADLINE: survives a reload ────────────────────────────────────
  {
    const disk = newDisk();
    const s1 = loadStore(disk);
    await s1.add({ blob: jpeg(2048, 42), leadId: 'lead-1', tags: ['hail'], description: 'north slope', location: 'Front Slope', timestamp: 111 });
    await s1.add({ blob: jpeg(1024, 9), leadId: 'lead-2', tags: [], description: '', location: '', timestamp: 222 });
    ok('two photos queued', (await s1.count()) === 2);

    // The bfcache reload: module state gone, storage untouched.
    const s2 = loadStore(disk);
    const after = await s2.all();
    ok('BOTH photos survive a page reload', after.length === 2,
      'got ' + after.length + ' — this is the bug the change exists to fix');
    ok('the reloaded queue carries the lead id', after[0] && after[0].leadId === 'lead-1');
    ok('tags survive', after[0] && after[0].tags.length === 1 && after[0].tags[0] === 'hail');
    ok('description survives', after[0] && after[0].description === 'north slope');
    ok('location survives', after[0] && after[0].location === 'Front Slope');
    ok('capture timestamp survives', after[0] && after[0].timestamp === 111);

    const bytes = after[0] ? Buffer.from(await after[0].blob.arrayBuffer()) : null;
    ok('the image bytes survive intact', !!bytes && bytes.length === 2048 && bytes[0] === 42 && bytes[2047] === 42,
      bytes ? 'len=' + bytes.length + ' first=' + bytes[0] : 'no blob');
    ok('the rebuilt Blob keeps its MIME type', after[0] && after[0].blob.type === 'image/jpeg');
    ok('oldest-first order is preserved across the reload',
      after[0].leadId === 'lead-1' && after[1].leadId === 'lead-2',
      'a drain must retry in capture order');
  }

  // ── removal is the only way out ────────────────────────────────────────
  {
    const disk = newDisk();
    const s = loadStore(disk);
    const id1 = await s.add({ blob: jpeg(512), leadId: 'a', timestamp: 1 });
    await s.add({ blob: jpeg(512), leadId: 'b', timestamp: 2 });
    await s.remove(id1);
    ok('remove() drops exactly one row', (await s.count()) === 1);
    const left = await s.all();
    ok('the surviving row is the one not removed', left[0].leadId === 'b');

    const s2 = loadStore(disk);
    ok('a removed photo stays removed across a reload', (await s2.count()) === 1);
  }

  // ── caps are sized for photos, and refuse OUT LOUD ─────────────────────
  {
    const disk = newDisk();
    const s = loadStore(disk, { quiet: true });
    ok('the item cap is photo-sized, not the 500 of the JSON write queue',
      s.MAX_ITEMS === 80, 'MAX_ITEMS=' + s.MAX_ITEMS);
    ok('there is a byte cap at all', s.MAX_BYTES === 80 * 1024 * 1024,
      'a count-only cap cannot bound blob storage; MAX_BYTES=' + s.MAX_BYTES);
    ok('the byte cap holds a full high-res roof set (40 x 1.5MB)',
      s.MAX_BYTES >= 40 * 1.5 * 1024 * 1024);

    // One blob larger than the whole cap must be refused, not attempted.
    let reason = null;
    try { await s.add({ blob: jpeg(s.MAX_BYTES + 1), leadId: 'x' }); }
    catch (e) { reason = e.reason; }
    ok('an oversized photo is refused with reason "queue-full"', reason === 'queue-full', 'reason=' + reason);
    ok('the refused photo was not stored', (await s.count()) === 0);
  }

  // ── a rejection is the caller's signal not to over-promise ─────────────
  {
    const disk = newDisk();
    disk.failWrites = 'QuotaExceededError';
    const s = loadStore(disk, { quiet: true });
    let reason = null;
    try { await s.add({ blob: jpeg(256), leadId: 'x' }); }
    catch (e) { reason = e.reason; }
    ok('a browser quota error surfaces as reason "quota"', reason === 'quota', 'reason=' + reason);
  }
  {
    const disk = newDisk();
    disk.failOpen = 'absent';
    const s = loadStore(disk, { quiet: true });
    ok('with no IndexedDB at all, available() is false', (await s.available()) === false);
    let reason = null;
    try { await s.add({ blob: jpeg(256), leadId: 'x' }); }
    catch (e) { reason = e.reason; }
    ok('...and add() rejects with "unavailable" rather than pretending',
      reason === 'unavailable', 'reason=' + reason);
    ok('...and count() degrades to 0 instead of throwing', (await s.count()) === 0);
  }
  {
    const disk = newDisk();
    const s = loadStore(disk, { quiet: true });
    let reason = null;
    try { await s.add({ leadId: 'x' }); } catch (e) { reason = e.reason; }
    ok('a record with no Blob is refused, not stored as a null photo',
      reason === 'bad-item', 'reason=' + reason);
  }

  // ── eviction is reported, not swallowed ────────────────────────────────
  {
    const disk = newDisk();
    const s1 = loadStore(disk);
    await s1.add({ blob: jpeg(256), leadId: 'a' });
    await s1.add({ blob: jpeg(256), leadId: 'b' });
    ok('no loss reported while the rows are present', (await s1.detectLoss()) === 0);

    // WebKit's 7-day purge: IndexedDB cleared, localStorage survives.
    disk.tables['nbd-photo-queue-db']['pending-photos'] = { rows: new Map(), nextId: 1 };
    const s2 = loadStore(disk);
    ok('an eviction is detected and counted', (await s2.detectLoss()) === 2,
      'silence here is how a rep learns a week later that the photos never existed');
    ok('the loss is reported once, not on every boot', (await s2.detectLoss()) === 0);
  }

  // ── the boot fast-path must not cost an IndexedDB open ─────────────────
  // photo-queue-recovery.js runs on EVERY dashboard boot and almost always
  // finds nothing queued. lastKnownCount() lets it decide that synchronously.
  {
    const disk = newDisk();
    const s1 = loadStore(disk);
    ok('a never-written counter reads null, not 0', s1.lastKnownCount() === null,
      'null means "unknown, go look"; 0 would wrongly skip the check');

    await s1.add({ blob: jpeg(256), leadId: 'a' });
    ok('the counter tracks an add', s1.lastKnownCount() === 1);

    const s2 = loadStore(disk);
    ok('the counter survives a reload', s2.lastKnownCount() === 1,
      'this is what lets boot skip the DB open when it is 0');

    const rows = await s2.all();
    await s2.remove(rows[0].id);
    ok('the counter tracks a remove', s2.lastKnownCount() === 0);

    const s3 = loadStore(disk);
    ok('an emptied queue reports 0 on the next boot', s3.lastKnownCount() === 0,
      'recovery returns here without touching IndexedDB at all');
  }
  {
    // The dangerous case: localStorage cleared, IndexedDB intact. Reporting 0
    // here would strand real photos forever, so it must report null.
    const disk = newDisk();
    const s1 = loadStore(disk);
    await s1.add({ blob: jpeg(256), leadId: 'a' });
    disk.localStorage = {};
    const s2 = loadStore(disk);
    ok('a cleared counter over a surviving queue reports null, not 0',
      s2.lastKnownCount() === null,
      'a 0 here would skip recovery and strand the photo permanently');
    ok('...and the photo is still really there', (await s2.count()) === 1);
  }

  // ── persistence is requested ───────────────────────────────────────────
  {
    const disk = newDisk();
    const s = loadStore(disk);
    await s.requestPersistence();
    ok('storage persistence is requested (exempts the origin from eviction)', disk.persisted === true);
  }

  // ── isolation from the Firestore write queue ───────────────────────────
  {
    const disk = newDisk();
    const s = loadStore(disk);
    ok('photos do NOT share offline-manager.js\'s database',
      s.DB_NAME !== 'nbd-offline-db', 'DB_NAME=' + s.DB_NAME);
    ok('photos do NOT share sw.js\'s pending-writes store',
      s.DB_STORE !== 'pending-writes', 'DB_STORE=' + s.DB_STORE);
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * photo-queue-durability.test.js — the offline photo queue survives a reload,
 * and never claims to have stored a photo it did not.
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
 * ── The shim models TRANSACTION LIFETIME, deliberately ──────────────────
 * A pre-merge review found the first version of this shim returned a live
 * object store forever and completed nothing, so it could not detect the one
 * real-IDB hazard the store code explicitly guards (a handle used after an
 * await is inactive), and it modelled quota as a request-level error when
 * Chromium and Firefox actually raise it at COMMIT — a put fires `success`
 * with an id and then the transaction aborts. A store resolving on request
 * success therefore reports a photo as durable that was never written. Both
 * are modelled here:
 *   - a transaction auto-commits once its request queue drains, after which
 *     objectStore handles from it throw TransactionInactiveError
 *   - `disk.abortAtCommit` reproduces the Chromium quota shape
 *   - `disk.failWrites` fails the request AND aborts the transaction, as real
 *     IDB does
 * ArrayBuffers are copied on write, so a record cannot appear to survive
 * merely because the test handed it a live reference.
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

// ── minimal IndexedDB, with real transaction lifetime ────────────────────
// `disk` outlives any single module instance — that is the whole point.
function makeIDB(disk) {
  function makeTx(table, mode) {
    const tx = {
      mode, error: null, oncomplete: null, onabort: null, onerror: null,
      _pending: 0, _active: true, _settled: false, _undo: []
    };

    const finish = () => {
      if (tx._settled) return;
      tx._settled = true;
      tx._active = false;
      const abortName = (mode === 'readwrite' && disk.abortAtCommit) || tx._abortName;
      if (abortName) {
        for (const undo of tx._undo.reverse()) undo();
        tx.error = { name: abortName };
        if (tx.onabort) tx.onabort({ target: tx });
      } else if (tx.oncomplete) {
        tx.oncomplete({ target: tx });
      }
    };

    const drain = () => { if (tx._pending === 0) setTimeout(finish, 0); };
    // A transaction with no requests still commits.
    setTimeout(drain, 0);

    function request(apply) {
      if (tx._settled || !tx._active) {
        const e = new Error('Failed to execute on IDBTransaction: The transaction is not active.');
        e.name = 'TransactionInactiveError';
        throw e;
      }
      const req = { onsuccess: null, onerror: null, result: undefined, error: null };
      tx._pending++;
      setTimeout(() => {
        if (tx._settled) { tx._pending--; return; }
        if (disk.failWrites && mode === 'readwrite') {
          req.error = { name: disk.failWrites };
          if (req.onerror) req.onerror({ target: req });
          // A failed request aborts its transaction in real IDB.
          tx._abortName = disk.failWrites;
          tx._pending--;
          setTimeout(finish, 0);
          return;
        }
        req.result = apply();
        if (req.onsuccess) req.onsuccess({ target: req });
        tx._pending--;
        drain();
      }, 0);
      return req;
    }

    const store = {
      add(record) {
        return request(() => {
          const id = table.nextId++;
          const copy = Object.assign({}, record, {
            id, bytes: record.bytes ? record.bytes.slice(0) : record.bytes
          });
          table.rows.set(id, copy);
          tx._undo.push(() => table.rows.delete(id));
          return id;
        });
      },
      getAll() {
        return request(() => [...table.rows.values()].map((r) =>
          Object.assign({}, r, { bytes: r.bytes ? r.bytes.slice(0) : r.bytes })));
      },
      count() { return request(() => table.rows.size); },
      delete(id) {
        return request(() => {
          const prev = table.rows.get(id);
          if (prev !== undefined) {
            table.rows.delete(id);
            tx._undo.push(() => table.rows.set(id, prev));
          }
          return undefined;
        });
      },
      clear() {
        return request(() => {
          const prev = new Map(table.rows);
          table.rows.clear();
          tx._undo.push(() => { for (const [k, v] of prev) table.rows.set(k, v); });
          return undefined;
        });
      }
    };
    tx.objectStore = () => store;
    return tx;
  }

  return {
    open(name) {
      const req = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: null };
      setTimeout(() => {
        if (disk.failOpen) {
          req.error = { name: 'InvalidStateError' };
          if (req.onerror) req.onerror({ target: req });
          return;
        }
        if (!disk.tables[name]) disk.tables[name] = {};
        const db = {
          onclose: null, onversionchange: null,
          objectStoreNames: { contains: (s) => !!disk.tables[name][s] },
          createObjectStore(s) {
            disk.tables[name][s] = { rows: new Map(), nextId: 1 };
            return makeTx(disk.tables[name][s], 'readwrite').objectStore();
          },
          transaction(s, mode) {
            if (disk.deadConnection) {
              const e = new Error('database connection is closing');
              e.name = 'InvalidStateError';
              throw e;
            }
            if (!disk.tables[name][s]) { const e = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e; }
            return makeTx(disk.tables[name][s], mode || 'readonly');
          },
          close() {}
        };
        req.result = db;
        disk.lastDb = db;
        if (!disk.tables[name][disk.storeName]) {
          if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      }, 0);
      return req;
    }
  };
}

function loadStore(disk, opts = {}) {
  const localStore = disk.localStorage;
  const sandbox = {
    console: opts.loud ? console : { warn() {}, log() {}, error() {} },
    setTimeout, clearTimeout, Promise, Blob, Object, Array, Error, Date, JSON,
    parseInt, String, Number, isNaN,
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
const UID = 'rep-alice';
function photo(over) {
  return Object.assign({ blob: jpeg(256), leadId: 'lead-x', uid: UID, timestamp: 1 }, over || {});
}
async function reason(fn) {
  try { await fn(); return null; } catch (e) { return e.reason || ('threw:' + e.message); }
}

(async function run() {
  console.log('\nphoto-queue-durability — the queue outlives the page\n');

  // ── THE HEADLINE: survives a reload ────────────────────────────────────
  {
    const disk = newDisk();
    const s1 = loadStore(disk);
    await s1.add(photo({ blob: jpeg(2048, 42), leadId: 'lead-1', tags: ['hail'], description: 'north slope', location: 'Front Slope', timestamp: 111 }));
    await s1.add(photo({ blob: jpeg(1024, 9), leadId: 'lead-2', timestamp: 222 }));
    ok('two photos queued', (await s1.count()) === 2);

    // The bfcache reload: module state gone, storage untouched.
    const s2 = loadStore(disk);
    const after = await s2.all();
    ok('BOTH photos survive a page reload', after.length === 2,
      'got ' + after.length + ' — this is the bug the change exists to fix');
    ok('the reloaded queue carries the lead id', after[0] && after[0].leadId === 'lead-1');
    ok('the reloaded queue carries the owning uid', after[0] && after[0].uid === UID);
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

  // ── resolved MEANS COMMITTED ───────────────────────────────────────────
  // Chromium/Firefox run the quota check at commit: the put fires success
  // with an id, THEN the transaction aborts. A store that resolved on the
  // request would hand back an id for a row that does not exist and tell the
  // rep the photo is safe.
  {
    const disk = newDisk();
    disk.abortAtCommit = 'QuotaExceededError';
    const s = loadStore(disk);
    ok('a commit-time quota abort rejects add() with reason "quota"',
      (await reason(() => s.add(photo()))) === 'quota',
      'resolving on request success would report a phantom save');
    ok('...and nothing was actually stored', (await s.count()) === 0);
    disk.abortAtCommit = null;
    ok('...and the localStorage counter was NOT bumped for the phantom row',
      s.lastKnownCount() === null || s.lastKnownCount() === 0,
      'lastKnown=' + s.lastKnownCount() + ' — a bumped counter makes the next boot report false loss');
  }
  {
    const disk = newDisk();
    disk.abortAtCommit = 'AbortError';
    const s = loadStore(disk);
    ok('a non-quota commit abort rejects with reason "write-failed"',
      (await reason(() => s.add(photo()))) === 'write-failed');
  }
  {
    // A request-level failure still aborts the transaction in real IDB.
    const disk = newDisk();
    disk.failWrites = 'QuotaExceededError';
    const s = loadStore(disk);
    ok('a request-level quota error also rejects with reason "quota"',
      (await reason(() => s.add(photo()))) === 'quota');
    disk.failWrites = null;
    ok('...and stored nothing', (await s.count()) === 0);
  }
  {
    // remove() must not lower the counter when its delete never commits.
    const disk = newDisk();
    const s = loadStore(disk);
    const id = await s.add(photo());
    await s.add(photo());
    ok('counter reflects two committed rows', s.lastKnownCount() === 2, 'got ' + s.lastKnownCount());
    disk.abortAtCommit = 'AbortError';
    const removed = await s.remove(id);
    disk.abortAtCommit = null;
    ok('a delete that does not commit returns false', removed === false);
    ok('...and the row is still there', (await s.count()) === 2);
    ok('...and the counter was not lowered', s.lastKnownCount() === 2, 'got ' + s.lastKnownCount());
  }

  // ── removal is the only way out ────────────────────────────────────────
  {
    const disk = newDisk();
    const s = loadStore(disk);
    const id1 = await s.add(photo({ leadId: 'a' }));
    await s.add(photo({ leadId: 'b' }));
    ok('remove() drops exactly one row', (await s.remove(id1)) === true && (await s.count()) === 1);
    const left = await s.all();
    ok('the surviving row is the one not removed', left[0].leadId === 'b');
    ok('the counter follows the committed delete', s.lastKnownCount() === 1);

    const s2 = loadStore(disk);
    ok('a removed photo stays removed across a reload', (await s2.count()) === 1);
  }

  // ── every row has an owner ─────────────────────────────────────────────
  // On a shared device the drain must never upload the previous rep's photos
  // under the next rep's account, so a row without a uid is refused outright.
  {
    const disk = newDisk();
    const s = loadStore(disk);
    ok('a record with no uid is refused', (await reason(() => s.add(photo({ uid: undefined })))) === 'bad-item');
    ok('a record with no customer is refused', (await reason(() => s.add(photo({ leadId: '' })))) === 'bad-item',
      'a photo with no leadId can never upload — holding it only ends in a silent drop');
    ok('a record with no Blob is refused', (await reason(() => s.add(photo({ blob: null })))) === 'bad-item');
    ok('none of the refused records were stored', (await s.count()) === 0);
  }

  // ── caps are sized for photos, and refuse OUT LOUD ─────────────────────
  {
    const disk = newDisk();
    const s = loadStore(disk);
    ok('the item cap is photo-sized, not the 500 of the JSON write queue',
      s.MAX_ITEMS === 80, 'MAX_ITEMS=' + s.MAX_ITEMS);
    ok('there is a byte cap at all', s.MAX_BYTES === 80 * 1024 * 1024,
      'a count-only cap cannot bound blob storage; MAX_BYTES=' + s.MAX_BYTES);
    ok('the byte cap holds a full high-res roof set (40 x 1.5MB)',
      s.MAX_BYTES >= 40 * 1.5 * 1024 * 1024);
    ok('an oversized photo is refused with reason "queue-full"',
      (await reason(() => s.add(photo({ blob: jpeg(s.MAX_BYTES + 1) })))) === 'queue-full');
    ok('the refused photo was not stored', (await s.count()) === 0);
  }

  // ── storage that is not there at all ───────────────────────────────────
  {
    const disk = newDisk();
    disk.failOpen = 'absent';
    const s = loadStore(disk);
    ok('with no IndexedDB at all, available() is false', (await s.available()) === false);
    ok('...and add() rejects with "unavailable" rather than pretending',
      (await reason(() => s.add(photo()))) === 'unavailable');
    ok('...and count() reports null (unknown), never 0',
      (await s.count()) === null,
      'a 0 here is read as "empty" and disables boot recovery for real photos');
  }

  // ── a dead connection reconnects instead of reporting an empty queue ───
  {
    const disk = newDisk();
    const s = loadStore(disk);
    await s.add(photo());
    ok('one row before the connection dies', (await s.count()) === 1);
    // WebKit closes the connection when its IDB process is torn down; every
    // transaction() then throws InvalidStateError on the cached handle.
    disk.deadConnection = true;
    const during = await s.count();
    disk.deadConnection = false;
    ok('a dead connection reports null, not 0', during === null, 'got ' + during);
    ok('the next call reconnects and sees the row again', (await s.count()) === 1,
      'caching a dead handle forever would make the drain read an empty store');
  }

  // ── the boot fast-path must not cost an IndexedDB open ─────────────────
  {
    const disk = newDisk();
    const s1 = loadStore(disk);
    ok('a never-written counter reads null, not 0', s1.lastKnownCount() === null,
      'null means "unknown, go look"; 0 would wrongly skip the check');
    await s1.add(photo());
    ok('the counter tracks an add', s1.lastKnownCount() === 1);

    const s2 = loadStore(disk);
    ok('the counter survives a reload', s2.lastKnownCount() === 1);
    const rows = await s2.all();
    await s2.remove(rows[0].id);
    ok('the counter tracks a remove', s2.lastKnownCount() === 0);

    const s3 = loadStore(disk);
    ok('an emptied queue reports 0 on the next boot', s3.lastKnownCount() === 0,
      'recovery returns here without touching IndexedDB at all');
  }
  {
    const disk = newDisk();
    const s1 = loadStore(disk);
    await s1.add(photo());
    disk.localStorage = {};
    const s2 = loadStore(disk);
    ok('a cleared counter over a surviving queue reports null, not 0',
      s2.lastKnownCount() === null,
      'a 0 here would skip recovery and strand the photo permanently');
    ok('...and the photo is still really there', (await s2.count()) === 1);
  }

  // ── eviction is reported, but a failed read is NOT an eviction ─────────
  {
    const disk = newDisk();
    const s1 = loadStore(disk);
    await s1.add(photo());
    await s1.add(photo());
    ok('no loss reported while the rows are present', (await s1.detectLoss()) === 0);

    // A PARTIAL eviction: the object store is reclaimed, the counter survives.
    disk.tables['nbd-photo-queue-db']['pending-photos'] = { rows: new Map(), nextId: 1 };
    const s2 = loadStore(disk);
    ok('a partial eviction is detected and counted', (await s2.detectLoss()) === 2,
      'silence here is how a rep learns a week later that the photos never existed');
    ok('the loss is reported once, not on every boot', (await s2.detectLoss()) === 0);
  }
  {
    // ── attributing the queue to a PERSON ────────────────────────────────
    // count() is unfiltered on purpose — the drain gate only asks "is there
    // anything here at all". Anything that files a number under someone's
    // name has to filter, or a rep signing in on a shared device inherits the
    // backlog of the rep who left photos behind, and can later be told they
    // lost photos they never took.
    const disk = newDisk();
    const s = loadStore(disk);
    await s.add(photo({ uid: 'rep-alice' }));
    await s.add(photo({ uid: 'rep-alice' }));
    await s.add(photo({ uid: 'rep-bob' }));

    ok('count() stays unfiltered — every row on the device', (await s.count()) === 3,
      'got ' + (await s.count()));
    ok('pendingForUid() counts only that rep\'s rows', (await s.pendingForUid('rep-alice')) === 2,
      'got ' + (await s.pendingForUid('rep-alice')));
    ok('...and a rep with nothing queued gets 0, not the device total',
      (await s.pendingForUid('rep-carol')) === 0,
      'got ' + (await s.pendingForUid('rep-carol')) + ' — a non-zero here accuses the wrong person');
    ok('...and no uid at all is unknown, never 0',
      (await s.pendingForUid(undefined)) === null && (await s.pendingForUid('')) === null,
      'a 0 for "not signed in yet" would clear a real marker');
  }
  {
    // A failed read is unknown, not empty — same contract as count().
    const disk = newDisk();
    const s1 = loadStore(disk);
    await s1.add(photo({ uid: 'rep-alice' }));
    disk.deadConnection = true;
    const s2 = loadStore(disk, { quiet: true });
    const n = await s2.pendingForUid('rep-alice');
    disk.deadConnection = false;
    ok('a FAILED per-user read returns null, not 0', n === null,
      'got ' + n + ' — a 0 would write "nothing owed" over a real backlog');
  }
  {
    // ── seedLastKnown: establish a baseline, never move one ──────────────
    const disk = newDisk();
    const s = loadStore(disk);
    ok('seeding works when there is no baseline', s.seedLastKnown(5) === true);
    ok('...and the baseline is readable afterwards', s.lastKnownCount() === 5);
    ok('seeding REFUSES to overwrite an existing baseline', s.seedLastKnown(99) === false,
      'overwriting would erase the very evidence detectLoss() compares against');
    ok('...leaving the original untouched', s.lastKnownCount() === 5,
      'got ' + s.lastKnownCount());
  }
  {
    const disk = newDisk();
    const s = loadStore(disk);
    const refused = [null, undefined, NaN, -1, '3'].every((v) => s.seedLastKnown(v) === false);
    ok('a nonsense seed is refused', refused && s.lastKnownCount() === null,
      'null/NaN/negative/string must not become a baseline; lastKnown=' + s.lastKnownCount());
  }
  {
    // ── THE SIGN-OUT HOLE, end to end ────────────────────────────────────
    // nbd-auth.js purgeAccountStorage() deletes our counter on EVERY logout
    // while the IndexedDB rows survive. This is the whole scenario: queue two
    // photos, sign out, sign back in, then get evicted.
    const disk = newDisk();
    const s1 = loadStore(disk);
    await s1.add(photo());
    await s1.add(photo());
    ok('two photos queued before the sign-out', s1.lastKnownCount() === 2);

    // The purge: every nbd_-prefixed key gone, the rows untouched.
    disk.localStorage = {};
    const s2 = loadStore(disk);
    ok('after a sign-out the baseline is gone but the photos are not',
      s2.lastKnownCount() === null && (await s2.count()) === 2,
      'lastKnown=' + s2.lastKnownCount());

    // What recovery does on boot.
    s2.seedLastKnown(await s2.count());
    ok('boot re-establishes the baseline from the surviving rows',
      s2.lastKnownCount() === 2, 'got ' + s2.lastKnownCount());

    // Now the eviction that used to go unreported.
    disk.tables['nbd-photo-queue-db']['pending-photos'] = { rows: new Map(), nextId: 1 };
    const s3 = loadStore(disk);
    ok('an eviction AFTER a sign-out is now reported', (await s3.detectLoss()) === 2,
      'without the re-seed this is 0 — the rep signs out Friday, is evicted '
      + 'Monday, and is never told');
  }
  {
    // The control: the same sequence WITHOUT the re-seed is silent. This is
    // the bug, reproduced, so the assertion above cannot pass by accident.
    const disk = newDisk();
    const s1 = loadStore(disk);
    await s1.add(photo());
    await s1.add(photo());
    disk.localStorage = {};
    disk.tables['nbd-photo-queue-db']['pending-photos'] = { rows: new Map(), nextId: 1 };
    const s2 = loadStore(disk);
    ok('...and skipping the re-seed reproduces the silence exactly',
      (await s2.detectLoss()) === 0,
      'if this is non-zero the scenario above is not testing what it claims');
  }
  {
    // ── the limit of what ANY device can prove about itself ──────────────
    // WebKit's real 7-day ITP purge — and "Clear History and Website Data" —
    // take every script-writable store for the origin in ONE operation. The
    // counter dies with the photos it was counting, so there is nothing left
    // here to compare against and detectLoss() cannot see the loss. That is a
    // property of the platform, not a bug to fix in this file; it is pinned
    // here so nobody reads a 0 from detectLoss() as "no photos were lost".
    // photo-queue-loss-witness.test.js covers who DOES report this.
    const disk = newDisk();
    const s1 = loadStore(disk);
    await s1.add(photo());
    await s1.add(photo());

    disk.tables['nbd-photo-queue-db']['pending-photos'] = { rows: new Map(), nextId: 1 };
    disk.localStorage = {};
    const s2 = loadStore(disk);

    ok('after a FULL wipe the counter is gone, so the queue size is unknown',
      s2.lastKnownCount() === null,
      'lastKnown=' + s2.lastKnownCount() + ' — a 0 would be a claim the device cannot support');
    ok('...and detectLoss() reports 0 because it has nothing left to compare',
      (await s2.detectLoss()) === 0,
      'this 0 means "unprovable here", NOT "nothing was lost" — the server witness covers it');
    ok('...and a missing counter is never persisted as an empty queue',
      s2.lastKnownCount() === null,
      'writing 0 here would send every later boot down the fast path forever');
  }
  {
    const disk = newDisk();
    const s1 = loadStore(disk);
    await s1.add(photo());
    await s1.add(photo());
    disk.deadConnection = true;
    const s2 = loadStore(disk);
    const lost = await s2.detectLoss();
    disk.deadConnection = false;
    ok('a FAILED count is not reported as an eviction', lost === 0,
      'reported ' + lost + ' lost — a transient read error is not evidence photos are gone');
    ok('...and the counter was not overwritten with a phantom 0',
      s2.lastKnownCount() === 2,
      'lastKnown=' + s2.lastKnownCount() + ' — a 0 here disables recovery for photos that still exist');
    ok('...and the photos are still there', (await s2.count()) === 2);
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

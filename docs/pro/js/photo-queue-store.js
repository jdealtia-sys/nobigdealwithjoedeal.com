/**
 * NBDPhotoQueueStore — durable IndexedDB backing for PhotoEngine's offline
 * photo upload queue.
 *
 * ── Why this exists as its own store ────────────────────────────────────
 * photo-engine.js queued failed uploads in `state.uploadQueue`, a plain
 * in-memory array. dashboard-sw-bootstrap.js reloads the page on every
 * `pageshow` with event.persisted — i.e. every iOS bfcache resume, which is
 * precisely what happens when a rep backgrounds the app on a roof. So the
 * memory queue was destroyed in exactly the situation it existed for.
 *
 * ── Why NOT offline-manager.js's queue ──────────────────────────────────
 * offline-manager.js already ships a complete IndexedDB write queue, and it
 * has zero callers. It was tempting. It is the wrong shape for photos, on
 * four counts, each of which is a bug and not a style preference:
 *
 *   1. Its flush path is `performFirestoreWrite(item, token)` — a Firestore
 *      REST call built from `item.url`/`item.method`/`item.data`. A photo is
 *      a Storage upload followed by a Firestore doc write. Reusing the queue
 *      means branching its flusher on item type, i.e. two unrelated
 *      protocols sharing one drain loop.
 *   2. Its cap is `MAX_QUEUE_SIZE = 500`, and its own comment states the
 *      sizing assumption: "500 items at ~2KB each ~= 1MB". A high-res photo
 *      is ~1.2MB *after* resizeImage(). 500 of those is ~600MB — the cap
 *      would never fire before the browser threw QuotaExceededError, which
 *      is the exact silent-loss failure the cap was written to prevent.
 *   3. It shares DB `nbd-offline-db` / store `pending-writes` with sw.js's
 *      `flushOfflineQueue()`, which replays every record in that store as
 *      `fetch(item.url, { method, body })` and deletes it on completion. A
 *      photo record has no meaningful `url`. That path is currently dead
 *      (sw.js:152 returns early on non-GET, and nothing registers SYNC_TAG
 *      'nbd-sync-queue'), but writing photos into a store another component
 *      believes it owns is a live grenade for whoever revives it.
 *   4. It is not loaded on dashboard.html, and loading it there would add a
 *      second `controllerchange` handler that force-reloads the page, on top
 *      of dashboard-sw-bootstrap.js's own. Two independent reload drivers
 *      with separate guard flags, on a page whose reload behaviour already
 *      has a documented history of looping.
 *
 * So: separate DB, separate store, caps sized for image blobs, and a drain
 * that belongs to PhotoEngine. offline-manager.js is left untouched.
 *
 * ── Records hold ArrayBuffers, not Blobs ────────────────────────────────
 * IndexedDB can store Blobs directly, and doing so would be less code. But
 * WebKit has a long history of Blob-in-IDB references going unreadable after
 * the browser restarts — the file is gone, the record isn't. Surviving a
 * restart is this module's entire purpose, so records hold a structured-clone
 * of the raw bytes plus a mime string, and the Blob is rebuilt on read.
 *
 * ── Durability caveats we do NOT paper over ─────────────────────────────
 * We ask for `navigator.storage.persist()`, which on WebKit exempts the
 * origin from the 7-day eviction that clears IDB for unused PWAs. It can be
 * refused. If it is refused, storage is still far more durable than a page
 * reload — which is the case that actually loses photos today.
 *
 * Exposed as window.NBDPhotoQueueStore. Every method resolves rather than
 * throws on a dead/absent IndexedDB; callers check `.available()` to decide
 * what to promise the user.
 */

(function () {
  'use strict';

  if (window.NBDPhotoQueueStore) return;

  const DB_NAME = 'nbd-photo-queue-db';
  const DB_STORE = 'pending-photos';
  const DB_VERSION = 1;

  // Sized for photos, not for JSON. resizeImage() runs before anything is
  // queued, so the blobs here are the presets' output, not camera originals:
  //   quick     640px  q0.60  ~=  40-80 KB
  //   standard  1280px q0.80  ~= 200-400 KB
  //   high-res  2048px q0.92  ~= 0.8-1.5 MB
  // 80 items / 80MB comfortably holds a full high-res roof documentation set
  // (~40 photos, ~50MB) with headroom, and refuses the 81st out loud instead
  // of letting the browser throw QuotaExceededError somewhere downstream.
  const MAX_ITEMS = 80;
  const MAX_BYTES = 80 * 1024 * 1024;

  // Written after every mutation. On boot we compare it to the real row
  // count: localStorage surviving while IndexedDB is empty is the signature
  // of a WebKit storage eviction, and the rep deserves to be told their
  // photos are gone rather than to discover it a week later.
  const LAST_KNOWN_KEY = 'nbd_photo_queue_last_known_size';

  let _db = null;
  let _openPromise = null;
  let _available = true;

  function _readLastKnown() {
    try { return parseInt(localStorage.getItem(LAST_KNOWN_KEY) || '0', 10) || 0; }
    catch (_) { return 0; }
  }

  function _writeLastKnown(n) {
    try { localStorage.setItem(LAST_KNOWN_KEY, String(n)); } catch (_) {}
  }

  function _open() {
    if (_db) return Promise.resolve(_db);
    if (_openPromise) return _openPromise;

    _openPromise = new Promise((resolve) => {
      let req;
      // Private-mode Safari and policy-disabled storage throw from open()
      // itself rather than firing onerror.
      try {
        if (!window.indexedDB) { _available = false; resolve(null); return; }
        req = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        console.warn('[PhotoQueueStore] indexedDB.open threw:', e && e.message);
        _available = false;
        resolve(null);
        return;
      }

      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(DB_STORE)) {
          database.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => {
        console.warn('[PhotoQueueStore] open failed:', req.error && req.error.name);
        _available = false;
        resolve(null);
      };
      // Another tab holding an old version open. Don't hang forever.
      req.onblocked = () => { _available = false; resolve(null); };
    });

    return _openPromise;
  }

  function _tx(mode) {
    return _open().then((db) => {
      if (!db) return null;
      try { return db.transaction(DB_STORE, mode).objectStore(DB_STORE); }
      catch (e) {
        console.warn('[PhotoQueueStore] transaction failed:', e && e.message);
        return null;
      }
    });
  }

  function _reqToPromise(makeReq, fallback) {
    return new Promise((resolve) => {
      let req;
      try { req = makeReq(); } catch (e) { resolve(fallback); return; }
      if (!req) { resolve(fallback); return; }
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn('[PhotoQueueStore] request failed:', req.error && req.error.name);
        resolve(fallback);
      };
    });
  }

  /** Row count, 0 when storage is unusable. */
  async function count() {
    const store = await _tx('readonly');
    if (!store) return 0;
    const n = await _reqToPromise(() => store.count(), 0);
    return typeof n === 'number' ? n : 0;
  }

  /** Total queued bytes, for the size cap and for diagnostics. */
  async function bytes() {
    const rows = await _rawAll();
    return rows.reduce((sum, r) => sum + ((r && r.byteLength) || 0), 0);
  }

  async function _rawAll() {
    const store = await _tx('readonly');
    if (!store) return [];
    const rows = await _reqToPromise(() => store.getAll(), []);
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Queue one photo. Resolves to the assigned id, or rejects with a reason
   * the caller can turn into honest UI copy: 'unavailable' (no IDB at all),
   * 'queue-full' (our own cap), 'quota' (the browser's), 'write-failed'.
   *
   * Rejecting matters more than it looks: the caller decides between "held
   * and will retry even if you leave" and "held only while this page stays
   * open" based on whether this resolved. A silent failure here would
   * reinstate the exact lie this whole change exists to remove.
   */
  async function add(item) {
    const store = await _tx('readwrite');
    if (!store) {
      const err = new Error('photo queue storage unavailable');
      err.reason = 'unavailable';
      throw err;
    }

    const blob = item && item.blob;
    if (!blob || typeof blob.arrayBuffer !== 'function') {
      const err = new Error('photo queue needs a Blob');
      err.reason = 'bad-item';
      throw err;
    }

    const existing = await _rawAll();
    const usedBytes = existing.reduce((sum, r) => sum + ((r && r.byteLength) || 0), 0);
    if (existing.length >= MAX_ITEMS || usedBytes + blob.size > MAX_BYTES) {
      const err = new Error('photo queue full');
      err.reason = 'queue-full';
      throw err;
    }

    let buffer;
    try { buffer = await blob.arrayBuffer(); }
    catch (e) {
      const err = new Error('could not read photo bytes');
      err.reason = 'bad-item';
      throw err;
    }

    const record = {
      bytes: buffer,
      byteLength: buffer.byteLength,
      mime: blob.type || 'image/jpeg',
      leadId: item.leadId,
      tags: Array.isArray(item.tags) ? item.tags : [],
      description: item.description || '',
      location: item.location || '',
      timestamp: item.timestamp || Date.now()
    };

    // Re-open the transaction: the awaits above (arrayBuffer, getAll) let the
    // event loop turn, and an IDB transaction auto-commits once its microtask
    // queue drains. Reusing `store` here throws TransactionInactiveError.
    const writeStore = await _tx('readwrite');
    if (!writeStore) {
      const err = new Error('photo queue storage unavailable');
      err.reason = 'unavailable';
      throw err;
    }

    const id = await new Promise((resolve, reject) => {
      let req;
      try { req = writeStore.add(record); }
      catch (e) {
        const err = new Error('photo queue write failed');
        err.reason = 'write-failed';
        reject(err);
        return;
      }
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        const name = req.error && req.error.name;
        const err = new Error('photo queue write failed: ' + name);
        err.reason = name === 'QuotaExceededError' ? 'quota' : 'write-failed';
        reject(err);
      };
    });

    _writeLastKnown(existing.length + 1);
    return id;
  }

  /**
   * Every queued photo, oldest first, each with its Blob rebuilt. Order is by
   * autoIncrement id, so a drain retries in capture order.
   */
  async function all() {
    const rows = await _rawAll();
    return rows
      .filter((r) => r && r.bytes)
      .sort((a, b) => a.id - b.id)
      .map((r) => ({
        id: r.id,
        blob: new Blob([r.bytes], { type: r.mime || 'image/jpeg' }),
        leadId: r.leadId,
        tags: Array.isArray(r.tags) ? r.tags : [],
        description: r.description || '',
        location: r.location || '',
        timestamp: r.timestamp || 0
      }));
  }

  /** Drop one record by id. Called only after a confirmed upload. */
  async function remove(id) {
    const store = await _tx('readwrite');
    if (!store) return false;
    await _reqToPromise(() => store.delete(id), null);
    _writeLastKnown(await count());
    return true;
  }

  /** Drop everything. Exposed for tests and for a deliberate user reset. */
  async function clear() {
    const store = await _tx('readwrite');
    if (!store) return false;
    await _reqToPromise(() => store.clear(), null);
    _writeLastKnown(0);
    return true;
  }

  /**
   * True once we've confirmed a usable object store. Callers must await this
   * before promising the user anything about durability — `_available`
   * starts optimistic and only turns false after a real open attempt fails.
   */
  async function available() {
    const db = await _open();
    return !!db && _available;
  }

  /**
   * Compare the surviving localStorage counter against the real row count.
   * A positive counter with an empty store means the browser evicted our
   * data. Returns the number of rows lost (0 when nothing was lost), so the
   * caller can tell the rep rather than letting it pass unnoticed.
   */
  async function detectLoss() {
    const expected = _readLastKnown();
    if (expected <= 0) return 0;
    const actual = await count();
    if (actual >= expected) {
      _writeLastKnown(actual);
      return 0;
    }
    _writeLastKnown(actual);
    return expected - actual;
  }

  // Ask the browser to exempt this origin from eviction. On WebKit this is
  // what survives the 7-day purge for an unused PWA; it may be refused, and
  // a refusal is not a failure of anything else here.
  function requestPersistence() {
    try {
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        return navigator.storage.persisted()
          .then((already) => (already ? true : navigator.storage.persist()))
          .catch(() => false);
      }
    } catch (_) {}
    return Promise.resolve(false);
  }

  window.NBDPhotoQueueStore = {
    add,
    all,
    remove,
    clear,
    count,
    bytes,
    available,
    detectLoss,
    requestPersistence,
    MAX_ITEMS,
    MAX_BYTES,
    DB_NAME,
    DB_STORE
  };
})();

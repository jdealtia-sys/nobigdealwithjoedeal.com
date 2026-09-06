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
 * ── The durability contract: resolved means COMMITTED ───────────────────
 * A resolved add()/remove()/clear() means the transaction reached
 * `oncomplete`. Not "the request fired success". The distinction is the
 * whole guarantee: in Chromium and Firefox the storage-quota check runs at
 * COMMIT, so a put near quota fires `success` with a fresh id and then the
 * transaction aborts with QuotaExceededError — a module resolving on the
 * request would report a photo as durable that was never written, and the
 * next boot's detectLoss() would then blame the browser for "clearing" it.
 * Every write here awaits the transaction, rejects on abort with the abort's
 * reason, and derives the localStorage counter from a count() issued INSIDE
 * that same transaction, so the counter can never describe rows that do not
 * exist.
 *
 * ── Records hold ArrayBuffers, not Blobs ────────────────────────────────
 * IndexedDB can store Blobs directly, and doing so would be less code. But
 * WebKit has a long history of Blob-in-IDB references going unreadable after
 * the browser restarts — the file is gone, the record isn't. Surviving a
 * restart is this module's entire purpose, so records hold a structured-clone
 * of the raw bytes plus a mime string, and the Blob is rebuilt on read.
 *
 * ── Records are owned ───────────────────────────────────────────────────
 * Every record carries the `uid` that captured it, and add() refuses a record
 * without one. The drain uploads only the signed-in user's rows. On a shared
 * device, a rep who signs out with photos still held must not have them
 * uploaded under the next rep's account and company; the rows wait for their
 * owner to sign back in.
 *
 * ── Durability caveats we do NOT paper over ─────────────────────────────
 * We ask for `navigator.storage.persist()`, which on WebKit exempts the
 * origin from the 7-day eviction that clears IDB for unused PWAs. It can be
 * refused. If it is refused, storage is still far more durable than a page
 * reload — which is the case that actually loses photos today.
 *
 * Exposed as window.NBDPhotoQueueStore. Reads resolve to `null` (not 0, not
 * []) when storage is unusable, because a 0 is a positive statement callers
 * act on; writes reject with a `reason` the caller can turn into honest copy.
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

  // Written only from a count() taken inside a COMMITTED transaction. On boot
  // we compare it to the real row count: this counter surviving while
  // IndexedDB is empty is the signature of a PARTIAL eviction — the browser
  // reclaiming our object store under storage pressure while leaving
  // localStorage alone — and the rep deserves to be told their photos are
  // gone rather than to discover it a week later.
  //
  // It is deliberately NOT a witness to a full site-data clear. WebKit's
  // 7-day ITP purge, and Safari's "Clear History and Website Data", delete
  // every script-writable store this origin owns in one go: this counter dies
  // with the photos it was counting. Nothing kept on the device can outlive
  // that, so detectLoss() reports what it can see and says so, and
  // photo-queue-recovery.js asks the one witness that does survive — the
  // server — when this counter is missing entirely.
  const LAST_KNOWN_KEY = 'nbd_photo_queue_last_known_size';

  let _db = null;
  let _openPromise = null;
  let _available = true;

  function _writeLastKnown(n) {
    try { localStorage.setItem(LAST_KNOWN_KEY, String(n)); } catch (_) {}
  }

  /**
   * Synchronous, no IndexedDB: how many photos we last recorded as queued, or
   * null when we have never written the counter (first boot, or localStorage
   * was cleared). Lets a boot path skip opening the database entirely in the
   * overwhelmingly common case of an empty queue — a `0` here is a positive
   * statement that the queue was empty as of the last committed mutation,
   * whereas `null` means "unknown, go look".
   */
  function lastKnownCount() {
    try {
      const raw = localStorage.getItem(LAST_KNOWN_KEY);
      if (raw === null) return null;
      const n = parseInt(raw, 10);
      return isNaN(n) ? null : n;
    } catch (_) { return null; }
  }

  function _forgetConnection() {
    _db = null;
    _openPromise = null;
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
      req.onsuccess = () => {
        const db = req.result;
        // The browser can close a connection underneath the page — WebKit
        // when its IndexedDB server process is torn down under memory
        // pressure, Chromium when site data is force-cleared — after which
        // every transaction() throws InvalidStateError. Caching that dead
        // handle forever would make available() true while every read
        // returned nothing, and the drain would then see an "empty" store.
        // Forget it, so the next call reconnects.
        try {
          db.onclose = () => { if (_db === db) _forgetConnection(); };
          db.onversionchange = () => {
            try { db.close(); } catch (_) {}
            if (_db === db) _forgetConnection();
          };
        } catch (_) {}
        _db = db;
        resolve(db);
      };
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

  /**
   * A transaction plus its object store. Reconnects once when the cached
   * connection turns out to be dead (see onclose above) rather than
   * returning null for a condition the next call would already recover from.
   */
  function _txPair(mode, retried) {
    return _open().then((db) => {
      if (!db) return null;
      try {
        const tx = db.transaction(DB_STORE, mode);
        return { tx, store: tx.objectStore(DB_STORE) };
      } catch (e) {
        if (e && e.name === 'InvalidStateError' && !retried) {
          _forgetConnection();
          return _txPair(mode, true);
        }
        console.warn('[PhotoQueueStore] transaction failed:', e && e.message);
        return null;
      }
    });
  }

  function _tx(mode) {
    return _txPair(mode).then((p) => (p ? p.store : null));
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

  /**
   * Resolves when the transaction COMMITS; rejects on abort with a `reason`
   * derived from the abort error — 'quota' for QuotaExceededError, otherwise
   * 'write-failed'. A request's own onerror is deliberately NOT used to
   * settle anything: a failing request aborts its transaction, and the abort
   * is the single place every failure mode (request error, commit-time quota,
   * connection loss) is guaranteed to surface.
   */
  function _commit(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => {
        const name = tx.error && tx.error.name;
        const err = new Error('photo queue transaction aborted: ' + (name || 'unknown'));
        err.reason = name === 'QuotaExceededError' ? 'quota' : 'write-failed';
        reject(err);
      };
    });
  }

  function _fail(reason, message) {
    const err = new Error(message);
    err.reason = reason;
    return err;
  }

  /** Row count, or null when storage is unusable — never 0 for a failure. */
  async function count() {
    const store = await _tx('readonly');
    if (!store) return null;
    const n = await _reqToPromise(() => store.count(), null);
    return typeof n === 'number' ? n : null;
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
   * Queue one photo. Resolves to the assigned id ONLY once the write has
   * committed, or rejects with a reason the caller can turn into honest UI
   * copy: 'unavailable' (no IDB at all), 'queue-full' (our own cap), 'quota'
   * (the browser's, surfaced at commit), 'write-failed', 'bad-item'.
   *
   * Rejecting matters more than it looks: the caller decides between "held
   * and will retry even if you leave" and "held only while this page stays
   * open" based on whether this resolved. A silent failure here would
   * reinstate the exact lie this whole change exists to remove.
   */
  async function add(item) {
    const blob = item && item.blob;
    if (!blob || typeof blob.arrayBuffer !== 'function') {
      throw _fail('bad-item', 'photo queue needs a Blob');
    }
    // A photo with no customer can never be uploaded (uploadPhotoToFirebase
    // refuses it before any network call), so holding one would only ever
    // end in it being dropped as unrecoverable — after the rep was told it
    // was safe. Refuse here too, so no caller can store one by accident.
    if (!item.leadId || typeof item.leadId !== 'string') {
      throw _fail('bad-item', 'photo queue needs a customer id');
    }
    if (!item.uid || typeof item.uid !== 'string') {
      throw _fail('bad-item', 'photo queue needs the owning user id');
    }

    const probe = await _tx('readonly');
    if (!probe) throw _fail('unavailable', 'photo queue storage unavailable');

    const existing = await _rawAll();
    const usedBytes = existing.reduce((sum, r) => sum + ((r && r.byteLength) || 0), 0);
    if (existing.length >= MAX_ITEMS || usedBytes + blob.size > MAX_BYTES) {
      throw _fail('queue-full', 'photo queue full');
    }

    let buffer;
    try { buffer = await blob.arrayBuffer(); }
    catch (e) { throw _fail('bad-item', 'could not read photo bytes'); }

    const record = {
      bytes: buffer,
      byteLength: buffer.byteLength,
      mime: blob.type || 'image/jpeg',
      uid: item.uid,
      leadId: item.leadId,
      tags: Array.isArray(item.tags) ? item.tags : [],
      description: item.description || '',
      location: item.location || '',
      timestamp: item.timestamp || Date.now()
    };

    // A fresh transaction: the awaits above let the event loop turn, and an
    // IDB transaction auto-commits once its microtask queue drains, so any
    // handle from before them is inactive by now.
    const pair = await _txPair('readwrite');
    if (!pair) throw _fail('unavailable', 'photo queue storage unavailable');

    const committed = _commit(pair.tx);
    let assignedId = null;
    let postCount = null;
    try {
      const req = pair.store.add(record);
      req.onsuccess = () => {
        assignedId = req.result;
        // Count inside the SAME transaction, after the add: the value that
        // reaches localStorage is the committed truth, not a snapshot taken
        // before a concurrent remove() could have run.
        try {
          const c = pair.store.count();
          c.onsuccess = () => { postCount = c.result; };
        } catch (_) {}
      };
    } catch (e) {
      // Synchronous throw (DataCloneError and friends). The transaction has
      // no requests and will complete on its own; nobody needs its promise.
      committed.catch(() => {});
      throw _fail('write-failed', 'photo queue write failed: ' + (e && e.name));
    }

    await committed;   // rejects with reason 'quota' / 'write-failed' on abort

    if (typeof postCount === 'number') _writeLastKnown(postCount);
    return assignedId;
  }

  /**
   * Every queued photo, oldest first, each with its Blob rebuilt. Order is by
   * autoIncrement id, so a drain retries in capture order. Rows are returned
   * for every owner; the drain filters to the signed-in user.
   */
  async function all() {
    const rows = await _rawAll();
    return rows
      .filter((r) => r && r.bytes)
      .sort((a, b) => a.id - b.id)
      .map((r) => ({
        id: r.id,
        uid: r.uid || null,
        blob: new Blob([r.bytes], { type: r.mime || 'image/jpeg' }),
        leadId: r.leadId,
        tags: Array.isArray(r.tags) ? r.tags : [],
        description: r.description || '',
        location: r.location || '',
        timestamp: r.timestamp || 0
      }));
  }

  /**
   * Drop one record by id. Called only after a confirmed upload. Resolves
   * true only once the delete has COMMITTED; the counter is derived from a
   * count() in the same transaction, so a failed delete never lowers it.
   */
  async function remove(id) {
    const pair = await _txPair('readwrite');
    if (!pair) return false;
    const committed = _commit(pair.tx);
    let postCount = null;
    try {
      pair.store.delete(id);
      const c = pair.store.count();
      c.onsuccess = () => { postCount = c.result; };
    } catch (e) {
      committed.catch(() => {});
      console.warn('[PhotoQueueStore] delete threw:', e && e.name);
      return false;
    }
    try { await committed; }
    catch (e) {
      console.warn('[PhotoQueueStore] delete did not commit:', e && e.message);
      return false;
    }
    if (typeof postCount === 'number') _writeLastKnown(postCount);
    return true;
  }

  /** Drop everything. Exposed for tests and for a deliberate user reset. */
  async function clear() {
    const pair = await _txPair('readwrite');
    if (!pair) return false;
    const committed = _commit(pair.tx);
    try { pair.store.clear(); }
    catch (e) { committed.catch(() => {}); return false; }
    try { await committed; } catch (e) { return false; }
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
   * A positive counter with an EMPTY store means the browser evicted our
   * data. Returns the number of rows lost (0 when nothing was lost), so the
   * caller can tell the rep rather than letting it pass unnoticed.
   *
   * WHAT THIS CAN AND CANNOT SEE — read before trusting a 0.
   * It sees a PARTIAL eviction, where the object store is reclaimed and the
   * counter survives. It is blind by construction to a full site-data clear
   * (WebKit's 7-day ITP purge, "Clear History and Website Data"), because
   * those take localStorage and IndexedDB together and there is then nothing
   * left on the device to compare against. A 0 from here means "no loss that
   * this device can still prove", never "no loss". photo-queue-recovery.js
   * covers the full-wipe case from the server side.
   *
   * Two readings must NOT be collapsed into "the queue was empty":
   * - an ABSENT counter (lastKnownCount() === null). This used to come back
   *   as 0 from a 0-defaulting read and return at the first line, which is
   *   exactly how the wipe above became silent.
   * - a count() that FAILED. Reporting phantom loss would be bad, but
   *   persisting the 0 it implied would be worse — every later boot would
   *   take the counter's fast path and never open the database that still
   *   holds the photos.
   */
  async function detectLoss() {
    const expected = lastKnownCount();
    if (expected === null || expected <= 0) return 0;
    const actual = await count();
    if (actual === null) return 0;
    _writeLastKnown(actual);
    return actual >= expected ? 0 : expected - actual;
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
    lastKnownCount,
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

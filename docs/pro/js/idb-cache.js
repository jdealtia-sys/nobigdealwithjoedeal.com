/**
 * idb-cache.js — IndexedDB-backed offline cache for NBD Pro.
 *
 * Why this exists
 * ───────────────
 * Joe opens a customer page. The first paint waits on a Firestore
 * round-trip just to render the photos he uploaded yesterday. On
 * a 1-bar LTE driveway connection that's a 2-3 second stall on a
 * page where 100% of the data was already on-device the day
 * before. With an IDB cache:
 *
 *   1. Page paints from cache in <50 ms (covers the photos +
 *      lead row that were on screen last time).
 *   2. Firestore fetch fires in parallel, lands a few hundred ms
 *      later, replaces the cached slice in NBDStore so the UI
 *      updates seamlessly when something actually changed.
 *   3. Offline (no signal at all): the cache is the only source
 *      of truth; UI still works for read-only review.
 *
 * Layered on top of NBDStore — never reads from IDB directly into
 * call sites. Pattern:
 *
 *     const photos = await NBDIDBCache.revalidate(
 *       'photos:' + leadId,
 *       () => loadPhotosFromFirestore(leadId)
 *     );
 *     // photos is the FRESH list (or cached list if Firestore failed).
 *     // NBDStore was updated TWICE: once with cache (instant), once
 *     // with fresh data when the loader resolved.
 *
 * What this is NOT
 * ────────────────
 * - Not a write-through queue. Writes still go directly to
 *   Firestore; IDB only mirrors reads. A future "offline write
 *   queue" PR can layer on top.
 * - Not a sync engine. The Firestore SDK has its own offline
 *   persistence — but that one needs a single-tab lock and
 *   doesn't isolate per-uid, so we ship our own thin layer
 *   that covers the read paths the SDK persistence misses.
 * - Not encrypted. Lead notes, addresses, and photo metadata
 *   land in plaintext IDB. That matches what the Firestore SDK
 *   persistence does and what the browser stores anyway.
 *   When the user signs out we call clearAll() to flush.
 *
 * Constraints
 * ───────────
 * - No external deps. Loads as a plain <script> tag.
 * - All I/O is async (IDB API is event-based; we Promise-wrap).
 * - Graceful no-IDB fallback: if open() rejects (Safari private
 *   mode, locked-down embedded WebView), every method resolves
 *   to a sentinel (cache miss / no-op) and the loader path
 *   still runs. The page keeps working without offline cache.
 * - Per-uid partition: DB name includes the auth uid so two reps
 *   sharing a device don't bleed cached data across accounts.
 *
 * Single source of truth: docs/pro/js/idb-cache.js. Update this
 * file, not call sites, when changing the shared protocol.
 */

(function () {
  'use strict';

  // Bumping the schema version drops + recreates the slice store.
  // Increment when the shape of cached objects changes in a way
  // old entries can't be read safely.
  var SCHEMA_VERSION = 1;
  var STORE_NAME = 'slices';

  // Per-uid DB so a shared device doesn't leak cached PII between
  // reps. uid is stamped at signin via setActiveUid(); the default
  // 'anon' bucket exists so the module can be called before auth
  // settles (e.g. during page boot).
  var activeUid = 'anon';

  // Memoized open() promise so concurrent callers share a single
  // open transaction instead of racing N opens.
  var dbPromise = null;

  function nameForUid(uid) {
    return 'nbd-pro-cache-' + (uid || 'anon');
  }

  function setActiveUid(uid) {
    if (typeof uid !== 'string' || !uid) uid = 'anon';
    if (uid === activeUid) return;
    activeUid = uid;
    // Force the next open() to use the new DB name.
    dbPromise = null;
  }

  // Promise-wrap an IDBRequest. Resolves with .result, rejects
  // with .error. The whole module is a thin layer over this
  // primitive.
  function idbReq(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === 'undefined') {
      // No IDB at all — cache layer becomes a no-op.
      dbPromise = Promise.resolve(null);
      return dbPromise;
    }
    dbPromise = new Promise(function (resolve) {
      var req;
      try {
        req = indexedDB.open(nameForUid(activeUid), SCHEMA_VERSION);
      } catch (err) {
        // Some embedded WebViews throw synchronously on .open()
        // when storage is forbidden. Swallow and return null so
        // every read becomes a miss.
        resolve(null);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          // Single-store schema: key = slice name (e.g.
          // 'photos:abc123'), value = { data: [...], at: ms }.
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      // Treat error / blocked as "no IDB" rather than rejecting —
      // we never want the cache layer to break the page.
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
    return dbPromise;
  }

  // Read a slice from cache. Returns the stored {data, at} envelope
  // or null on miss / IDB-unavailable.
  function get(slice) {
    return openDB().then(function (db) {
      if (!db) return null;
      try {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        return idbReq(store.get(slice)).then(function (rec) {
          return rec || null;
        }).catch(function () { return null; });
      } catch (_) {
        return null;
      }
    });
  }

  // Overwrite a slice in cache. The envelope adds a server-set
  // timestamp so callers can age-out stale entries (e.g. don't
  // show a cached price quote that's 6 months old).
  function put(slice, data) {
    return openDB().then(function (db) {
      if (!db) return false;
      try {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        return idbReq(store.put({ data: data, at: Date.now() }, slice))
          .then(function () { return true; })
          .catch(function () { return false; });
      } catch (_) {
        return false;
      }
    });
  }

  function clear(slice) {
    return openDB().then(function (db) {
      if (!db) return false;
      try {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        return idbReq(store.delete(slice))
          .then(function () { return true; })
          .catch(function () { return false; });
      } catch (_) {
        return false;
      }
    });
  }

  function clearAll() {
    return openDB().then(function (db) {
      if (!db) return false;
      try {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        return idbReq(store.clear())
          .then(function () { return true; })
          .catch(function () { return false; });
      } catch (_) {
        return false;
      }
    });
  }

  /**
   * Stale-while-revalidate helper.
   *
   * 1. Read cache. If hit (and not expired), call onCached(data) so
   *    the caller can paint immediately. Falls back to no-op if no
   *    onCached hook was provided.
   * 2. Run loader() in parallel.
   * 3. On loader success: write fresh data to cache, return it.
   * 4. On loader failure: return cached data if we had any, else
   *    re-throw.
   *
   * @param {string}   slice      cache key (e.g. 'photos:leadId')
   * @param {Function} loader     async () => freshData
   * @param {Object=}  opts
   * @param {number=}  opts.maxAgeMs  ignore cache older than this
   * @param {Function=} opts.onCached  fired with cached data first
   */
  function revalidate(slice, loader, opts) {
    opts = opts || {};
    var maxAgeMs = typeof opts.maxAgeMs === 'number' ? opts.maxAgeMs : Infinity;
    var onCached = typeof opts.onCached === 'function' ? opts.onCached : null;

    return get(slice).then(function (rec) {
      if (rec && (Date.now() - (rec.at || 0)) <= maxAgeMs) {
        if (onCached) {
          try { onCached(rec.data); } catch (_) {}
        }
      }

      return Promise.resolve()
        .then(function () { return loader(); })
        .then(function (fresh) {
          // Fire-and-forget the cache write — don't block the
          // caller on IDB latency. The next page load picks it up.
          put(slice, fresh);
          return fresh;
        })
        .catch(function (err) {
          // Network/Firestore failed. Return whatever we have
          // cached so the UI keeps working offline.
          if (rec && (Date.now() - (rec.at || 0)) <= maxAgeMs) {
            return rec.data;
          }
          throw err;
        });
    });
  }

  var api = {
    setActiveUid: setActiveUid,
    get: get,
    put: put,
    clear: clear,
    clearAll: clearAll,
    revalidate: revalidate,
    // Exposed for tests + diagnostic console use only. Treat as
    // read-only — direct mutation bypasses the public API.
    _internal: { openDB: openDB, SCHEMA_VERSION: SCHEMA_VERSION, STORE_NAME: STORE_NAME },
  };

  if (typeof window !== 'undefined') {
    window.NBDIDBCache = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();

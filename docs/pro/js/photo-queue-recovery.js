/**
 * Photo queue boot recovery.
 *
 * Persisting the offline photo queue (photo-queue-store.js) is only half a
 * fix. photo-engine.js is lazy-loaded — it arrives with ScriptLoader's
 * `photos` bundle, which loads when the rep opens a photos view. So a photo
 * that survives the reload still uploads nothing until the rep happens to
 * navigate back to photos. On a roof, after a bfcache resume, that is not a
 * safe assumption to build a promise on.
 *
 * This module closes the loop: on every dashboard boot, if the durable queue
 * has rows, it waits for Firebase auth, pulls in the photos bundle, and asks
 * PhotoEngine to drain. The rep does nothing.
 *
 * It is deliberately separate from photo-queue-store.js so that the store
 * stays a pure, side-effect-free storage module that a unit test can drive
 * without a DOM, a ScriptLoader, or a Firebase.
 *
 * SECOND JOB: be the witness that outlives the browser.
 *
 * The store's detectLoss() spots an eviction by finding its localStorage
 * counter alive next to an empty object store. That works for a partial
 * eviction and cannot work for the one the file's own comments kept naming:
 * WebKit's 7-day ITP purge (and "Clear History and Website Data") deletes
 * every script-writable store this origin owns in ONE operation, so the
 * counter dies with the photos and detectLoss() has nothing to compare —
 * it returned 0 and the rep was told nothing at all. Nothing kept on the
 * device can survive that; the only witness that can is the server.
 *
 * So while there are photos held, this module mirrors the pending count to
 * userSettings/{uid} (already owner-read/write in firestore.rules), and when
 * it boots to find the local counter GONE it asks the server whether photos
 * were owed. That branch is reached once per device install, so the read
 * costs nothing on a normal boot. The marker is written only by a device
 * that has its own local counter — a second device must never clear the
 * record of photos still sitting on the first one.
 */

(function () {
  'use strict';

  if (window.__nbdPhotoQueueRecoveryBound) return;
  window.__nbdPhotoQueueRecoveryBound = true;

  // Firebase auth resolves asynchronously after boot. uploadPhotoToFirebase()
  // throws without _storage/_db/_user, and a throw would re-queue every item
  // and burn a drain cycle, so wait for a real signal instead of racing it.
  const AUTH_POLL_MS = 500;
  const AUTH_TIMEOUT_MS = 60000;

  function firebaseReady() {
    return !!(window._storage && window._db && window._user);
  }

  function waitForFirebase() {
    if (firebaseReady()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (firebaseReady()) { clearInterval(timer); resolve(true); return; }
        if (Date.now() - started > AUTH_TIMEOUT_MS) {
          clearInterval(timer);
          // Not an error: a signed-out rep on the login screen hits this
          // every time. The rows stay in IndexedDB for the next boot.
          resolve(false);
        }
      }, AUTH_POLL_MS);
    });
  }

  function loadPhotoEngine() {
    if (window.PhotoEngine && typeof window.PhotoEngine.flushUploadQueue === 'function') {
      return Promise.resolve(true);
    }
    const loader = window.ScriptLoader;
    if (!loader || typeof loader.loadBundle !== 'function') return Promise.resolve(false);
    return loader.loadBundle('photos')
      .then(() => !!(window.PhotoEngine && typeof window.PhotoEngine.flushUploadQueue === 'function'))
      .catch((e) => {
        console.warn('[PhotoQueueRecovery] photos bundle failed to load:', e && e.message);
        return false;
      });
  }

  function toast(msg, kind) {
    if (typeof window.showToast === 'function') { window.showToast(msg, kind); return; }
    console.log('[PhotoQueueRecovery]', msg);
  }

  // ── the server-side witness ───────────────────────────────────────────────
  // One field on the doc the CRM already keeps per user. No rules change:
  // firestore.rules `match /userSettings/{uid}` is owner read/write.
  const MARKER_COLLECTION = 'userSettings';
  const MARKER_FIELD = 'photoQueuePending';
  const MARKER_AT_FIELD = 'photoQueuePendingAt';
  // What we last pushed, so a boot with an unchanged queue writes nothing.
  const MARKER_MIRROR_KEY = 'nbd_photo_queue_marker_synced';
  // Which server marker we have already told the rep about, so the warning
  // appears once and not on every boot after a wipe.
  const LOSS_REPORTED_KEY = 'nbd_photo_queue_loss_reported';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) {} }

  /**
   * The Firestore handles, or null. Both spellings of the db global are in
   * use across docs/pro/js (see analytics-kpi.js), and the modular v9 helpers
   * are re-exported onto window for the non-module IIFEs like this one.
   */
  function firestore() {
    const db = window._db || window.db;
    const uid = window._user && window._user.uid;
    const doc = window.doc;
    const getDoc = window.getDoc;
    const setDoc = window.setDoc;
    if (!db || !uid) return null;
    if (typeof doc !== 'function' || typeof getDoc !== 'function' || typeof setDoc !== 'function') return null;
    return { ref: doc(db, MARKER_COLLECTION, uid), getDoc: getDoc, setDoc: setDoc };
  }

  /** { held, at } from the server, or null when we could not read it. */
  async function readMarker() {
    const fs = firestore();
    if (!fs) return null;
    try {
      const snap = await fs.getDoc(fs.ref);
      const data = (snap && typeof snap.data === 'function' && snap.data()) || null;
      if (!data) return null;
      const held = parseInt(data[MARKER_FIELD], 10);
      return { held: isNaN(held) ? 0 : held, at: data[MARKER_AT_FIELD] || 0 };
    } catch (e) {
      console.warn('[PhotoQueueRecovery] could not read the queue marker:', e && e.message);
      return null;
    }
  }

  /**
   * Mirror a DEFINITE local count to the server. Called only from a device
   * that has its own localStorage counter: without that guard a second device
   * booting fresh would write 0 over the record of photos still held on the
   * first one, destroying the only evidence they were ever owed.
   */
  async function writeMarker(n) {
    if (typeof n !== 'number' || isNaN(n) || n < 0) return;
    const last = lsGet(MARKER_MIRROR_KEY);
    if (last !== null && parseInt(last, 10) === n) return; // unchanged, skip the write
    const fs = firestore();
    if (!fs) return;
    const payload = {};
    payload[MARKER_FIELD] = n;
    payload[MARKER_AT_FIELD] = Date.now();
    try {
      await fs.setDoc(fs.ref, payload, { merge: true });
      lsSet(MARKER_MIRROR_KEY, n);
    } catch (e) {
      console.warn('[PhotoQueueRecovery] could not write the queue marker:', e && e.message);
    }
  }

  /**
   * The local counter is gone. That is either this device's first boot, or
   * the browser deleted everything we own. Ask the server which, and tell the
   * rep if photos were owed.
   *
   * The copy has to be true in BOTH readings the server can support, because
   * they are indistinguishable from here: this device was wiped, or the rep
   * is signing in on a second device while the photos still sit on the first.
   * "not on this device" and "open the app on the phone you shot them with"
   * hold either way — and in the wipe case, looking and finding nothing is
   * exactly the discovery we want them to make now rather than in a week.
   */
  async function reportLossFromServer() {
    const marker = await readMarker();
    if (!marker || !(marker.held > 0)) return false;
    if (lsGet(LOSS_REPORTED_KEY) === String(marker.at)) return false;
    toast(
      marker.held === 1
        ? '1 photo taken offline never finished uploading and is not on this device. Open the app on the phone you shot it with, or reshoot it.'
        : marker.held + ' photos taken offline never finished uploading and are not on this device. Open the app on the phone you shot them with, or reshoot them.',
      'error'
    );
    lsSet(LOSS_REPORTED_KEY, marker.at);
    return true;
  }

  async function recover() {
    const store = window.NBDPhotoQueueStore;
    if (!store) return;

    // BOOT COST: this runs on every dashboard load, and on almost every load
    // there is nothing queued. Opening IndexedDB (and asking for storage
    // persistence) to discover that is waste, so take the synchronous
    // localStorage counter first and leave immediately when it positively
    // says the queue was empty as of the last mutation. `null` means we have
    // never written it — first boot, or localStorage was cleared out from
    // under a surviving IndexedDB — and that has to fall through to a real
    // check, or an eviction of the counter alone would strand real photos.
    const known = store.lastKnownCount();
    if (known === 0) return;

    // Keep the origin exempt from WebKit's 7-day eviction for as long as the
    // browser will allow it. Cheap, idempotent, and the thing that makes
    // "survives leaving the app" true across days rather than hours.
    try { await store.requestPersistence(); } catch (_) {}

    if (!(await store.available())) return;

    // Tell the rep if the browser threw their queue away. Silence here is how
    // a rep finds out a week later that a claim's photos never existed. This
    // only ever catches a PARTIAL eviction — see the full-wipe branch below.
    try {
      const lost = await store.detectLoss();
      if (lost > 0) {
        toast(
          lost === 1
            ? '1 photo held offline was cleared by your browser and could not be uploaded'
            : lost + ' photos held offline were cleared by your browser and could not be uploaded',
          'error'
        );
      }
    } catch (_) {}

    // count() returns null when the read FAILED, which is not the same as an
    // empty queue and must not be treated as one — `null <= 0` is true, so a
    // naive check here would skip recovery whenever IndexedDB hiccuped and
    // leave real photos sitting unsent. Only a definite 0 stops us.
    const pending = await store.count();

    if (pending === 0) {
      // FULL WIPE. `known === null` means the store's own counter is gone as
      // well, so detectLoss() above had nothing to compare and returned 0 no
      // matter what was lost — this is the case it is structurally blind to.
      // An empty store plus a missing counter is either a first boot on this
      // device or a site-data clear, and only the server can tell us which.
      // Reached once per device install, so this read is not a per-boot cost.
      //
      // Nothing is written back from here on purpose: in this state the
      // device knows nothing, and a 0 would erase the record of photos still
      // held on the rep's other phone.
      if (known === null) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        if (!(await waitForFirebase())) return;
        await reportLossFromServer();
      }
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // photo-engine re-arms its own `online` listener when it loads, and the
      // next boot runs this again. Nothing to do while there's no network.
      return;
    }

    const authed = await waitForFirebase();
    if (!authed) return;

    // Record what is owed BEFORE attempting the drain. If this drain fails,
    // or the tab dies mid-flight, or the browser wipes us next week, the
    // server still holds the count — and that record is the only thing a
    // wiped device can read on its next boot.
    await writeMarker(pending);

    const ready = await loadPhotoEngine();
    if (!ready) return;

    try {
      await window.PhotoEngine.flushUploadQueue();
    } catch (e) {
      console.warn('[PhotoQueueRecovery] drain failed:', e && e.message);
    }

    // And what is still owed after it, so a drained queue stops warning about
    // photos that did arrive. A failed count is not a 0 and writes nothing.
    const left = await store.count();
    if (typeof left === 'number') await writeMarker(left);
  }

  function start() {
    // Never let recovery break the dashboard boot.
    recover().catch((e) => console.warn('[PhotoQueueRecovery] failed:', e && e.message));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

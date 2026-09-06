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
    if (store.lastKnownCount() === 0) return;

    // Keep the origin exempt from WebKit's 7-day eviction for as long as the
    // browser will allow it. Cheap, idempotent, and the thing that makes
    // "survives leaving the app" true across days rather than hours.
    try { await store.requestPersistence(); } catch (_) {}

    if (!(await store.available())) return;

    // Tell the rep if the browser threw their queue away. Silence here is how
    // a rep finds out a week later that a claim's photos never existed.
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

    const pending = await store.count();
    if (pending <= 0) return;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // photo-engine re-arms its own `online` listener when it loads, and the
      // next boot runs this again. Nothing to do while there's no network.
      return;
    }

    const authed = await waitForFirebase();
    if (!authed) return;

    const ready = await loadPhotoEngine();
    if (!ready) return;

    try {
      await window.PhotoEngine.flushUploadQueue();
    } catch (e) {
      console.warn('[PhotoQueueRecovery] drain failed:', e && e.message);
    }
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

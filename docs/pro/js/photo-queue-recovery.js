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
 * were owed. The marker is written only by a device that has its own local
 * counter — a second device must never clear the record of photos still
 * sitting on the first one.
 *
 * THIRD JOB: keep the local counter alive, because we delete it ourselves.
 *
 * nbd-auth.js purgeAccountStorage() drops every `nbd_`-prefixed localStorage
 * key outside its KEEP set on EVERY logout and account switch, while the
 * IndexedDB rows sit there untouched. Nothing re-created the counter, so an
 * ordinary sign-out left detectLoss() with no baseline and no way back —
 * blind until the next add() or remove() happened to rewrite it. A rep who
 * signed out on Friday and was evicted on Monday was told nothing.
 *
 * The same gap made the server read above a per-BOOT cost rather than a
 * per-device one: a rep who has never queued a photo has no counter to write,
 * so every dashboard load re-opened IndexedDB, waited for auth and re-read the
 * marker. (An earlier version of this comment claimed otherwise. It was
 * wrong.) Seeding the counter on boot — only ever ESTABLISHING it, never
 * overwriting a real one — closes both.
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
  // Which marker the rep has already been told about. This lives on the
  // SERVER, not in localStorage, because nbd-auth.js purgeAccountStorage()
  // drops every `nbd_`-prefixed key that is not in its KEEP set on every
  // logout and account switch — so a local "already reported" flag is erased
  // by an ordinary sign-out and the rep gets accused a second time.
  const MARKER_ACK_FIELD = 'photoQueueLossAckAt';
  // What we last pushed, so a boot with an unchanged queue writes nothing.
  // Purged on logout too; losing it costs one redundant write, nothing more.
  const MARKER_MIRROR_KEY = 'nbd_photo_queue_marker_synced';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) {} }

  /**
   * A notice that STAYS. window.showToast removes itself after 2600 ms
   * (dashboard-ui-prefs-boot.js:44) — on a boot, which is before a rep on a
   * roof has looked at the phone. offline-manager.js:123 already made this
   * call for the strictly lower-stakes JSON queue, with the reason in a
   * comment: "a 3s toast vanishes before a contractor in the field ever
   * notices". Photos are worth at least as much. Distinct id from that
   * banner so the two can coexist.
   * No inline handlers anywhere — CSP here is script-src-attr 'none'.
   */
  function stickyNotice(message) {
    if (typeof document === 'undefined' || !document.body) return false;
    if (document.getElementById('nbd-photo-loss-banner')) return true;
    const banner = document.createElement('div');
    banner.id = 'nbd-photo-loss-banner';
    banner.setAttribute('role', 'alert');
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0',
      'padding:10px 44px 10px 16px',
      'background:#b91c1c', 'color:#fff',
      'font-size:13px', 'font-weight:600',
      'text-align:center', 'line-height:1.35',
      'z-index:99001', 'box-shadow:0 2px 10px rgba(0,0,0,.35)',
      'padding-top:calc(10px + env(safe-area-inset-top,0px))'
    ].join(';');
    const label = document.createElement('span');
    label.textContent = '⚠ ' + message;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss photo upload warning');
    close.style.cssText = 'position:absolute;top:6px;right:8px;background:transparent;'
      + 'border:0;color:#fff;font-size:22px;font-weight:700;cursor:pointer;padding:4px 10px;line-height:1;';
    close.addEventListener('click', function () { banner.remove(); });
    banner.appendChild(label);
    banner.appendChild(close);
    document.body.appendChild(banner);
    return true;
  }

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

  /** { held, at, ackAt } from the server, or null when we could not read it. */
  async function readMarker() {
    const fs = firestore();
    if (!fs) return null;
    try {
      const snap = await fs.getDoc(fs.ref);
      const data = (snap && typeof snap.data === 'function' && snap.data()) || null;
      // A doc that does not exist is a real ANSWER — "nothing was owed" — not
      // a failed read. The caller seeds the local counter off the difference,
      // so conflating the two would make every boot re-ask the server.
      if (!data) return { held: 0, at: 0, ackAt: 0 };
      const held = parseInt(data[MARKER_FIELD], 10);
      return {
        held: isNaN(held) ? 0 : held,
        at: data[MARKER_AT_FIELD] || 0,
        ackAt: data[MARKER_ACK_FIELD] || 0
      };
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
  /**
   * Returns whether we actually got an answer out of the server — NOT whether
   * we warned. The caller uses it to decide it is safe to stop asking, and
   * "the marker says nothing is owed" is just as much an answer as "three
   * photos were owed". A failed read is neither, and must keep us asking.
   */
  async function reportLossFromServer() {
    const marker = await readMarker();
    if (!marker) return false;
    if (!(marker.held > 0)) return true;
    // Acknowledged on the server, so it survives the sign-out purge that
    // erases every local flag we could have used instead. Still a successful
    // consult — we asked and the answer was "they already know".
    if (marker.ackAt && marker.ackAt === marker.at) return true;
    notify(
      marker.held === 1
        ? '1 photo taken offline never finished uploading and is not on this device. Open the app on the phone you shot it with, or reshoot it.'
        : marker.held + ' photos taken offline never finished uploading and are not on this device. Open the app on the phone you shot them with, or reshoot them.',
      'error'
    );
    // Acknowledge ONLY. The pending count is deliberately untouched: this
    // device does not know what it holds, and writing a 0 here would erase
    // the record of photos still sitting on the rep's other phone.
    await ackMarker(marker.at);
    return true;
  }

  /** Record that the rep has been told about this marker. */
  async function ackMarker(at) {
    const fs = firestore();
    if (!fs) return;
    const payload = {};
    payload[MARKER_ACK_FIELD] = at;
    try { await fs.setDoc(fs.ref, payload, { merge: true }); }
    catch (e) { console.warn('[PhotoQueueRecovery] could not acknowledge the loss:', e && e.message); }
  }

  /**
   * A loss notice must outlive the boot it appears on, so it goes to the
   * sticky banner and falls back to the toast only when there is no DOM to
   * hang it on. Everything else here still uses the toast.
   */
  function notify(msg, kind) {
    if (stickyNotice(msg)) return;
    toast(msg, kind);
  }

  function seed(store, n) {
    if (store && typeof store.seedLastKnown === 'function') store.seedLastKnown(n);
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
        notify(
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
      //
      // Nothing about the QUEUE is written back from here on purpose: in this
      // state the device knows nothing, and a pending count of 0 would erase
      // the record of photos still held on the rep's other phone.
      if (known === null) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        if (!(await waitForFirebase())) return;
        // Seeding the local counter is what makes this branch cost one server
        // read per device instead of one per BOOT — without it a rep who has
        // never queued a photo has no counter to write, so every dashboard
        // load re-opens IndexedDB, waits for auth and re-reads the marker,
        // forever. Seed only on a successful consult, though: seeding after an
        // unreachable server would send every later boot down the fast path
        // and the loss would never be reported at all.
        if (await reportLossFromServer()) seed(store, 0);
      }
      return;
    }

    // Rows exist and we have no baseline to measure them against. Establish
    // one now rather than staying blind until the next add()/remove(): our own
    // nbd-auth.js purgeAccountStorage() deletes the counter on EVERY logout
    // while leaving these rows alone, so without this a rep who signs out on
    // Friday and is evicted on Monday is never told anything. seedLastKnown()
    // refuses to overwrite an existing baseline, so this cannot mask a loss
    // the counter already had the evidence for.
    if (known === null) seed(store, pending);

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
    //
    // Counted per UID, never with store.count(). `pending` above is every row
    // on the device, which is the right question for "should we drain?" and
    // the WRONG one for a number we are about to file under one person's name:
    // on a shared device it is the previous rep's backlog, which this rep's
    // drain will never touch (photo-engine filters by uid) and which would sit
    // on their marker forever, ready to accuse them of losing photos they
    // never took.
    const uid = window._user && window._user.uid;
    const mine = await store.pendingForUid(uid);
    await writeMarker(mine);

    const ready = await loadPhotoEngine();
    if (!ready) return;

    try {
      await window.PhotoEngine.flushUploadQueue();
    } catch (e) {
      console.warn('[PhotoQueueRecovery] drain failed:', e && e.message);
    }

    // And what is still owed after it, so a drained queue stops warning about
    // photos that did arrive. A failed count is null, not 0, and writes nothing.
    const left = await store.pendingForUid(uid);
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

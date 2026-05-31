// nbd-emulator-connect.js — local-only Firebase Emulator wiring (Audit #3).
//
// PURPOSE
//   Point the client SDK at the local Firebase Emulator Suite when — and ONLY
//   when — the page is being served from localhost. In production this module
//   is a hard no-op: `isLocalEmulatorEnv()` returns false for any hostname
//   other than localhost/127.0.0.1/[::1], so `connectEmulatorsIfLocal()`
//   returns immediately without importing or touching anything. The
//   production host is nobigdealwithjoedeal.com, so this can never fire there.
//
// WHY A SHARED HELPER
//   The CRM has ~11 independent initializeApp() sites (nbd-auth, dashboard
//   bootstrap, the per-page modules, customer.html, etc.). Each must connect
//   its OWN auth/db/functions/storage instances to the emulator before first
//   use. Centralising the host/port + the guard keeps every site honest and
//   makes "is this safe in prod?" a single-file answer.
//
// PORTS — must match the `emulators` block in firebase.json:
//   auth 9099 · firestore 8080 · functions 5001 · storage 9199
//
// SAFETY
//   - Pure localhost guard (no env var, no build step) → cannot mis-fire in prod.
//   - connect*Emulator() must run BEFORE the instance is used; callers invoke
//     this immediately after getAuth()/getFirestore()/etc.
//   - Per-instance WeakSets stop a double-connect on a REUSED instance (which
//     Firestore throws on) while still allowing a FRESH instance from another
//     initializeApp() site to connect independently.

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

// Per-instance dedupe — keyed on the actual SDK object, so reused instances
// are skipped but distinct app instances each get wired.
const _connected = { auth: new WeakSet(), db: new WeakSet(), fn: new WeakSet(), st: new WeakSet() };

export function isLocalEmulatorEnv() {
  try {
    return typeof location !== 'undefined' && LOCAL_HOSTS.includes(location.hostname);
  } catch { return false; }
}

/**
 * Connect any provided SDK instances to the local emulators. No-op off-localhost.
 * @param {{auth?:object, db?:object, functions?:object, storage?:object}} svc
 * @returns {Promise<boolean>} true if running locally (whether or not any svc was passed)
 */
export async function connectEmulatorsIfLocal(svc = {}) {
  if (!isLocalEmulatorEnv()) return false;
  const { auth, db, functions, storage } = svc;
  try {
    if (auth && !_connected.auth.has(auth)) {
      const { connectAuthEmulator } = await import(`${SDK}/firebase-auth.js`);
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      _connected.auth.add(auth);
    }
    if (db && !_connected.db.has(db)) {
      const { connectFirestoreEmulator } = await import(`${SDK}/firebase-firestore.js`);
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
      _connected.db.add(db);
    }
    if (functions && !_connected.fn.has(functions)) {
      const { connectFunctionsEmulator } = await import(`${SDK}/firebase-functions.js`);
      connectFunctionsEmulator(functions, '127.0.0.1', 5001);
      _connected.fn.add(functions);
    }
    if (storage && !_connected.st.has(storage)) {
      const { connectStorageEmulator } = await import(`${SDK}/firebase-storage.js`);
      connectStorageEmulator(storage, '127.0.0.1', 9199);
      _connected.st.add(storage);
    }
    if (!window.__NBD_EMU_LOGGED) {
      window.__NBD_EMU_LOGGED = true;
      console.info('[nbd-emulator-connect] LOCAL emulator mode — client wired to 127.0.0.1 (auth/firestore/functions/storage). This NEVER runs in production.');
    }
  } catch (e) {
    // "already started"/"already connected" is harmless on re-entry.
    console.warn('[nbd-emulator-connect] connect warning:', e && e.message);
  }
  return true;
}

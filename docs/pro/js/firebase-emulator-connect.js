/**
 * firebase-emulator-connect.js — DEV-ONLY local Firebase Emulator wiring.
 * =======================================================================
 * Routes the four Firebase backends (Auth / Firestore / Functions / Storage)
 * to the local Emulator Suite **only** when the page is served from
 * localhost. On any real host it is a hard no-op, so shipping it to
 * production changes nothing.
 *
 * WHY THIS MATTERS (RULE 0 — never touch prod from a test):
 *   The app's firebaseConfig points at the live `nobigdeal-pro` project. On
 *   localhost, an *unconnected* getFirestore()/getFunctions()/getStorage()
 *   would happily read/write/CALL the live backend. Connecting every service
 *   to the emulator is therefore a SAFETY requirement, not a convenience.
 *
 * USAGE — call once, synchronously, immediately after initializeApp() and
 * BEFORE any Firestore/Functions/Storage use (connect* throws if the
 * instance has already issued a request):
 *
 *   import { connectNbdEmulators } from "/pro/js/firebase-emulator-connect.js";
 *   const app = initializeApp(FIREBASE_CONFIG);
 *   connectNbdEmulators();   // no-op unless localhost
 *
 * Because getFirestore(app)/getFunctions(app)/getStorage(app) return per-app
 * singletons, connecting them here once routes EVERY later lazy
 * `mod.getFunctions()` / `getStorage(app)` call site to the emulator too.
 *
 * Escape hatches: set window.__NBD_FORCE_PROD = true to force prod even on
 * localhost; set window.__NBD_USE_EMULATORS = true to force emulators on a
 * non-localhost host (e.g. a LAN IP used for device testing).
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getStorage, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const HOST = "127.0.0.1";
const PORTS = { auth: 9099, firestore: 8080, functions: 5001, storage: 9199 };
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/** True when the app should talk to the local Emulator Suite. */
export function isLocalEmulatorHost() {
  try {
    if (typeof window !== "undefined" && window.__NBD_FORCE_PROD === true) return false;
    if (typeof window !== "undefined" && window.__NBD_USE_EMULATORS === true) return true;
    if (typeof location === "undefined") return false;
    return LOCAL_HOSTNAMES.has(location.hostname);
  } catch (_) {
    return false;
  }
}

/**
 * Connect all four Firebase services to the local emulators. Idempotent and
 * a no-op off localhost. Returns true if connected (or already connected).
 */
export function connectNbdEmulators() {
  if (!isLocalEmulatorHost()) return false;
  if (typeof window !== "undefined" && window.__NBD_EMU_CONNECTED) return true;

  // Prevent App Check (reCAPTCHA Enterprise) from initializing on localhost —
  // the site key is bound to prod domains and would throw; the Functions
  // emulator does not enforce App Check anyway. Both client init blocks
  // (nbd-auth.js, dashboard-bootstrap.module.js) skip init when this flag is
  // already set, so setting it here short-circuits them.
  try {
    window.__NBD_APP_CHECK_INITIALIZED = true;
    window.__NBD_APP_CHECK_KEY = "";
  } catch (_) {}

  let app;
  try {
    app = getApp();
  } catch (e) {
    console.error("[NBD-emu] No Firebase app yet — connectNbdEmulators() must run AFTER initializeApp().", e);
    return false;
  }

  const connected = [];
  try {
    connectAuthEmulator(getAuth(app), `http://${HOST}:${PORTS.auth}`, { disableWarnings: true });
    connected.push("auth:" + PORTS.auth);
  } catch (e) {
    console.warn("[NBD-emu] auth connect skipped:", e && e.message);
  }
  try {
    connectFirestoreEmulator(getFirestore(app), HOST, PORTS.firestore);
    connected.push("firestore:" + PORTS.firestore);
  } catch (e) {
    console.warn("[NBD-emu] firestore connect skipped:", e && e.message);
  }
  try {
    connectFunctionsEmulator(getFunctions(app), HOST, PORTS.functions);
    connected.push("functions:" + PORTS.functions);
  } catch (e) {
    console.warn("[NBD-emu] functions connect skipped:", e && e.message);
  }
  try {
    connectStorageEmulator(getStorage(app), HOST, PORTS.storage);
    connected.push("storage:" + PORTS.storage);
  } catch (e) {
    console.warn("[NBD-emu] storage connect skipped:", e && e.message);
  }

  try {
    window.__NBD_EMU_CONNECTED = true;
    window.__NBD_EMU_SERVICES = connected;
  } catch (_) {}
  console.info(
    "%c[NBD] 🔌 Firebase EMULATORS connected → " + connected.join(", "),
    "color:#e8720c;font-weight:bold"
  );
  return true;
}

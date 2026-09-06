/**
 * photo-queue-loss-witness.test.js — the rep is told when the browser threw
 * their photos away, including the case no device can prove on its own.
 *
 * WHY THIS SUITE EXISTS
 *
 * photo-queue-store.js detects an eviction by finding its localStorage counter
 * alive next to an empty object store. That works for a partial eviction and
 * is structurally blind to the one every comment in the feature kept naming:
 * WebKit's 7-day ITP purge, and "Clear History and Website Data", delete every
 * script-writable store an origin owns in ONE operation. The counter dies with
 * the photos, detectLoss() has nothing to compare, and it returns 0 — so the
 * rep was told nothing at all in exactly the scenario the mechanism was
 * written for. Nothing kept on the device survives that. The server does.
 *
 * So this drives the REAL photo-queue-recovery.js in a vm sandbox against a
 * fake store and a fake Firestore, and asserts the behaviour that matters:
 * a wiped device reads the server marker and speaks up; a first boot with
 * nothing owed stays quiet; a device that knows nothing never overwrites the
 * record of photos still sitting on the rep's other phone; and a normal boot
 * never pays for a server read at all.
 *
 * Run: node tests/photo-queue-loss-witness.test.js   (no deps, no DOM)
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
const SRC = fs.readFileSync(path.join(ROOT, 'docs/pro/js/photo-queue-recovery.js'), 'utf8');
const wait = require('timers/promises').setTimeout;

const UID = 'rep-alice';

/**
 * The smallest NBDPhotoQueueStore recovery can be driven against. Defaults are
 * the wiped state: no counter, no rows.
 */
function makeStore(over) {
  return Object.assign({
    lastKnownCount: () => null,
    requestPersistence: async () => true,
    available: async () => true,
    detectLoss: async () => 0,
    count: async () => 0,
    all: async () => []
  }, over || {});
}

/** A Firestore stand-in that records every read and write. */
function makeFirestore(seed) {
  const state = { data: seed === undefined ? null : seed };
  const calls = { get: 0, set: 0, wrote: [] };
  return {
    calls,
    state,
    doc: (db, col, id) => ({ path: col + '/' + id }),
    getDoc: async (ref) => {
      calls.get++;
      return { ref: ref, data: () => state.data };
    },
    setDoc: async (ref, payload) => {
      calls.set++;
      calls.wrote.push(Object.assign({}, payload));
      state.data = Object.assign({}, state.data || {}, payload);
    }
  };
}

/**
 * Load photo-queue-recovery.js as a page boot. `ls` is the localStorage
 * backing object — pass the SAME one to two boots to model one device across
 * a reload, or a fresh one to model a different device.
 */
function boot(opts) {
  const o = opts || {};
  const ls = o.ls || {};
  const store = o.store || makeStore();
  const fsdb = o.firestore || makeFirestore();
  const toasts = [];
  const drained = { count: 0 };

  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    setInterval, clearInterval, setTimeout, clearTimeout,
    Promise, Object, Array, Error, Date, JSON, String, Number, parseInt, isNaN,
    navigator: { onLine: o.onLine === undefined ? true : o.onLine },
    localStorage: {
      getItem: (k) => (k in ls ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: (k) => { delete ls[k]; }
    },
    document: { readyState: 'complete', addEventListener() {} }
  };
  sandbox.window = sandbox;

  // Everything below must be in place BEFORE the module is evaluated: it runs
  // recover() on load, and the body up to its first await executes
  // synchronously inside runInContext. Mutating the sandbox afterwards tests
  // nothing.
  if (!o.noStore) sandbox.NBDPhotoQueueStore = store;
  sandbox.showToast = (msg, kind) => { toasts.push({ msg: msg, kind: kind }); };
  // Firebase, present unless the case says the rep is signed out.
  if (!o.signedOut) {
    sandbox._storage = {};
    sandbox._db = {};
    sandbox._user = { uid: UID };
  }
  sandbox.doc = fsdb.doc;
  sandbox.getDoc = o.noFirestoreHelpers ? undefined : fsdb.getDoc;
  sandbox.setDoc = fsdb.setDoc;
  sandbox.PhotoEngine = {
    flushUploadQueue: async () => { drained.count++; if (o.onDrain) o.onDrain(); return 0; }
  };

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { ls, store, fsdb, toasts, drained, sandbox };
}

/** Recovery is fire-and-forget; let its promise chain settle. */
async function settle() { for (let i = 0; i < 6; i++) await wait(0); }

const lossToast = (t) => t.toasts.filter((x) => /never finished uploading/.test(x.msg));

(async function run() {
  console.log('\nphoto-queue-loss-witness — the wipe no device can prove alone\n');

  // ── THE HEADLINE ───────────────────────────────────────────────────────
  // Site data cleared: no counter, no rows, nothing local to compare. The
  // server still knows three photos were owed.
  {
    const t = boot({
      store: makeStore({ lastKnownCount: () => null, count: async () => 0 }),
      firestore: makeFirestore({ photoQueuePending: 3, photoQueuePendingAt: 1700 })
    });
    await settle();
    const said = lossToast(t);
    ok('a full site-data wipe IS reported to the rep', said.length === 1,
      'toasts=' + JSON.stringify(t.toasts) + ' — detectLoss() cannot see this; silence here is the bug');
    ok('...naming how many photos were owed', said.length === 1 && /\b3 photos\b/.test(said[0].msg),
      said.length ? said[0].msg : '(none)');
    ok('...as an error, not a success', said.length === 1 && said[0].kind === 'error');
    ok('...after exactly one server read', t.fsdb.calls.get === 1, 'reads=' + t.fsdb.calls.get);
    ok('...and the device that knows nothing writes nothing back',
      t.fsdb.calls.set === 0,
      'a 0 written here erases the record of photos still held on the other phone');
  }

  // ── singular copy ──────────────────────────────────────────────────────
  {
    const t = boot({ firestore: makeFirestore({ photoQueuePending: 1, photoQueuePendingAt: 5 }) });
    await settle();
    const said = lossToast(t);
    ok('one lost photo reads as "1 photo", not "1 photos"',
      said.length === 1 && /\b1 photo\b/.test(said[0].msg) && !/1 photos/.test(said[0].msg),
      said.length ? said[0].msg : '(none)');
  }

  // ── a first boot is not a loss ─────────────────────────────────────────
  {
    const t = boot({ firestore: makeFirestore(null) });
    await settle();
    ok('a genuine first boot with no marker says nothing', lossToast(t).length === 0,
      'every new device install hits this path');
  }
  {
    const t = boot({ firestore: makeFirestore({ photoQueuePending: 0, photoQueuePendingAt: 9 }) });
    await settle();
    ok('a marker of 0 says nothing', lossToast(t).length === 0);
  }

  // ── reported once, not on every boot ───────────────────────────────────
  {
    const ls = {};
    const marker = { photoQueuePending: 2, photoQueuePendingAt: 4242 };
    const t1 = boot({ ls: ls, firestore: makeFirestore(marker) });
    await settle();
    const t2 = boot({ ls: ls, firestore: makeFirestore(marker) });
    await settle();
    ok('the loss is reported once, not on every boot afterwards',
      lossToast(t1).length === 1 && lossToast(t2).length === 0,
      'first=' + lossToast(t1).length + ' second=' + lossToast(t2).length);
  }
  {
    // A LATER loss is a different marker and must be reported again.
    const ls = {};
    const t1 = boot({ ls: ls, firestore: makeFirestore({ photoQueuePending: 2, photoQueuePendingAt: 100 }) });
    await settle();
    const t2 = boot({ ls: ls, firestore: makeFirestore({ photoQueuePending: 5, photoQueuePendingAt: 200 }) });
    await settle();
    ok('a second, later loss is reported again',
      lossToast(t1).length === 1 && lossToast(t2).length === 1,
      'a rep who loses photos twice must hear about it twice');
  }

  // ── the normal boot pays nothing ───────────────────────────────────────
  {
    // Counter says 0: the queue was positively empty. This is almost every
    // boot for almost every rep.
    const t = boot({ store: makeStore({ lastKnownCount: () => 0 }) });
    await settle();
    ok('an empty queue costs no server read and no toast',
      t.fsdb.calls.get === 0 && t.fsdb.calls.set === 0 && t.toasts.length === 0,
      'reads=' + t.fsdb.calls.get + ' writes=' + t.fsdb.calls.set);
  }
  {
    // Counter present and rows present: this device knows what it holds, so
    // there is nothing to ask the server about.
    const t = boot({ store: makeStore({ lastKnownCount: () => 2, count: async () => 2 }) });
    await settle();
    ok('a device that still has its counter never consults the server',
      t.fsdb.calls.get === 0, 'reads=' + t.fsdb.calls.get);
  }

  // ── the marker is maintained, so the witness has something to say ──────
  {
    let rows = 2;
    const t = boot({
      store: makeStore({ lastKnownCount: () => 2, count: async () => rows }),
      onDrain: () => { rows = 0; }
    });
    await settle();
    ok('the drain runs', t.drained.count === 1);
    ok('what is owed is recorded BEFORE the drain is attempted',
      t.fsdb.calls.wrote.length >= 1 && t.fsdb.calls.wrote[0].photoQueuePending === 2,
      'wrote=' + JSON.stringify(t.fsdb.calls.wrote)
        + ' — a tab that dies mid-drain must still leave the count on the server');
    ok('...and cleared once the photos actually arrived',
      t.fsdb.calls.wrote.length === 2 && t.fsdb.calls.wrote[1].photoQueuePending === 0,
      'wrote=' + JSON.stringify(t.fsdb.calls.wrote)
        + ' — a stale marker would warn about photos that did arrive');
    ok('every write is stamped so a later loss is distinguishable from this one',
      t.fsdb.calls.wrote.every((w) => typeof w.photoQueuePendingAt === 'number' && w.photoQueuePendingAt > 0));
  }
  {
    // A drain that FAILS must leave the count standing on the server.
    const t = boot({
      store: makeStore({ lastKnownCount: () => 3, count: async () => 3 }),
      onDrain: () => { throw new Error('still offline'); }
    });
    await settle();
    ok('a failed drain leaves the owed count on the server',
      t.fsdb.calls.wrote.length >= 1
      && t.fsdb.calls.wrote[t.fsdb.calls.wrote.length - 1].photoQueuePending === 3,
      'wrote=' + JSON.stringify(t.fsdb.calls.wrote));
  }
  {
    // An unchanged queue on the next boot must not re-write the same number.
    const ls = {};
    const t1 = boot({ ls: ls, store: makeStore({ lastKnownCount: () => 2, count: async () => 2 }) });
    await settle();
    const t2 = boot({ ls: ls, store: makeStore({ lastKnownCount: () => 2, count: async () => 2 }) });
    await settle();
    ok('an unchanged queue does not re-write the marker every boot',
      t2.fsdb.calls.set === 0,
      'first=' + t1.fsdb.calls.set + ' second=' + t2.fsdb.calls.set + ' — a write per boot per rep');
  }

  // ── degrade quietly ────────────────────────────────────────────────────
  {
    const t = boot({ onLine: false, firestore: makeFirestore({ photoQueuePending: 4, photoQueuePendingAt: 1 }) });
    await settle();
    ok('offline, the server is not consulted and nothing is claimed',
      t.fsdb.calls.get === 0 && lossToast(t).length === 0,
      'reads=' + t.fsdb.calls.get);
  }
  {
    const t = boot({ signedOut: true, firestore: makeFirestore({ photoQueuePending: 4, photoQueuePendingAt: 1 }) });
    await settle();
    ok('signed out, recovery waits instead of guessing',
      t.fsdb.calls.get === 0 && lossToast(t).length === 0,
      'the login screen must not accuse the browser of anything');
  }
  {
    // Firestore helpers absent (an older bundle, a partial load) — no crash,
    // and no accusation we cannot back up.
    const t = boot({
      noFirestoreHelpers: true,
      firestore: makeFirestore({ photoQueuePending: 4, photoQueuePendingAt: 1 })
    });
    await settle();
    ok('a missing Firestore helper degrades to silence, not a boot failure',
      lossToast(t).length === 0 && t.fsdb.calls.get === 0,
      'toasts=' + JSON.stringify(t.toasts));
  }
  {
    // The store itself is absent (an older cached dashboard.html that predates
    // photo-queue-store.js). recover() must return at its first line.
    const t = boot({
      noStore: true,
      firestore: makeFirestore({ photoQueuePending: 4, photoQueuePendingAt: 1 })
    });
    await settle();
    ok('no store at all is survivable', t.toasts.length === 0 && t.fsdb.calls.get === 0,
      'toasts=' + JSON.stringify(t.toasts));
  }

  // ── the partial eviction still works ───────────────────────────────────
  {
    const t = boot({
      store: makeStore({ lastKnownCount: () => 2, detectLoss: async () => 2, count: async () => 0 })
    });
    await settle();
    ok('a partial eviction is still reported from the local counter',
      t.toasts.some((x) => /cleared by your browser/.test(x.msg)),
      'toasts=' + JSON.stringify(t.toasts));
    ok('...without a server read, because the device could prove it alone',
      t.fsdb.calls.get === 0, 'reads=' + t.fsdb.calls.get);
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

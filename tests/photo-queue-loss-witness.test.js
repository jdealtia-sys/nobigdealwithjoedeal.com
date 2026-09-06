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
 * record of photos still sitting on the rep's other phone; a shared device
 * never files one rep's backlog under another rep's name; the notice outlives
 * the boot it appears on; and a normal boot never pays for a server read.
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
const OTHER = 'rep-bob';

/**
 * The smallest NBDPhotoQueueStore recovery can be driven against. Defaults are
 * the wiped state: no counter, no rows, nothing owed to anyone.
 */
function makeStore(over) {
  const seeds = [];
  const s = Object.assign({
    lastKnownCount: () => null,
    requestPersistence: async () => true,
    available: async () => true,
    detectLoss: async () => 0,
    count: async () => 0,
    pendingForUid: async () => 0,
    pendingStats: async () => ({ count: 0, oldestAt: 0 }),
    seedLastKnown: (n) => { seeds.push(n); return true; },
    all: async () => []
  }, over || {});
  s.seeds = seeds;
  return s;
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

/** Just enough DOM for the sticky banner, and a record of what was appended. */
function makeDom() {
  const dom = { nodes: [] };
  dom.create = function create(tag) {
    const el = {
      tagName: tag, id: '', type: '', textContent: '', children: [],
      style: { cssText: '' },
      setAttribute(k, v) { if (k === 'id') el.id = v; },
      addEventListener() {},
      appendChild(c) { el.children.push(c); return c; },
      remove() { const i = dom.nodes.indexOf(el); if (i !== -1) dom.nodes.splice(i, 1); }
    };
    return el;
  };
  return dom;
}

/**
 * Load photo-queue-recovery.js as a page boot. `ls` is the localStorage
 * backing object — pass the SAME one to two boots to model one device across
 * a reload, a FRESH one to model a different device or a sign-out purge.
 */
function boot(opts) {
  const o = opts || {};
  const ls = o.ls || {};
  const store = o.store || makeStore();
  const fsdb = o.firestore || makeFirestore();
  const dom = makeDom();
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
    document: {
      readyState: 'complete',
      addEventListener() {},
      createElement: (tag) => dom.create(tag),
      getElementById: (id) => dom.nodes.filter((n) => n.id === id)[0] || null,
      body: o.noDom ? null : { appendChild(el) { dom.nodes.push(el); return el; } }
    }
  };
  sandbox.window = sandbox;

  // Everything below must be in place BEFORE the module is evaluated: it runs
  // recover() on load, and the body up to its first await executes
  // synchronously inside runInContext. Mutating the sandbox afterwards tests
  // nothing.
  if (!o.noStore) sandbox.NBDPhotoQueueStore = store;
  sandbox.showToast = (msg, kind) => { toasts.push({ msg: msg, kind: kind }); };
  if (!o.signedOut) {
    sandbox._storage = {};
    sandbox._db = {};
    sandbox._user = { uid: o.uid || UID };
  }
  sandbox.doc = fsdb.doc;
  sandbox.getDoc = o.noFirestoreHelpers ? undefined : fsdb.getDoc;
  sandbox.setDoc = fsdb.setDoc;
  if (!o.noPhotoEngine) sandbox.PhotoEngine = {
    flushUploadQueue: async () => { drained.count++; if (o.onDrain) o.onDrain(); return 0; }
  };

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { ls, store, fsdb, dom, toasts, drained, sandbox };
}

/** Recovery is fire-and-forget; let its promise chain settle. */
async function settle() { for (let i = 0; i < 8; i++) await wait(0); }

const bannerOf = (t) => t.dom.nodes.filter((n) => n.id === 'nbd-photo-loss-banner')[0] || null;
const bannerText = (t) => {
  const b = bannerOf(t);
  return b ? b.children.map((c) => c.textContent || '').join(' ') : '';
};
/** Every surface the rep could have been warned on, banner or toast. */
const said = (t, re) => re.test(bannerText(t)) || t.toasts.some((x) => re.test(x.msg));
const LOSS = /never finished uploading/;
const STALE = /(has|have) been waiting/;
/** Writes that touch the shared pending count, as opposed to the ack. */
const countWrites = (t) => t.fsdb.calls.wrote.filter((w) => 'photoQueuePending' in w);

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
    ok('a full site-data wipe IS reported to the rep', said(t, LOSS),
      'banner=' + JSON.stringify(bannerText(t)) + ' toasts=' + JSON.stringify(t.toasts)
      + ' — detectLoss() cannot see this; silence here is the bug');
    ok('...naming how many photos were owed', /\b3 photos\b/.test(bannerText(t)), bannerText(t));
    ok('...after exactly one server read', t.fsdb.calls.get === 1, 'reads=' + t.fsdb.calls.get);
    ok('...and the device that knows nothing never writes the shared count',
      countWrites(t).length === 0,
      'wrote=' + JSON.stringify(t.fsdb.calls.wrote)
      + ' — a 0 here erases the record of photos still held on the other phone');
  }

  // ── the notice has to outlive the boot ─────────────────────────────────
  // window.showToast removes itself after 2600ms (dashboard-ui-prefs-boot.js),
  // which on a boot is before a rep on a roof has looked at the phone.
  // offline-manager.js:123 already made this call for a lower-stakes loss.
  {
    const t = boot({ firestore: makeFirestore({ photoQueuePending: 2, photoQueuePendingAt: 8 }) });
    await settle();
    ok('the loss notice is a STICKY banner, not a 2.6-second toast',
      bannerOf(t) !== null && t.toasts.length === 0,
      'banner=' + (bannerOf(t) ? 'yes' : 'no') + ' toasts=' + t.toasts.length
      + ' — a toast on boot is gone before the rep looks at the phone');
    ok('...that the rep can dismiss', (() => {
      const b = bannerOf(t);
      return !!b && b.children.some((c) => c.tagName === 'button');
    })(), 'a permanent undismissable banner is its own bug');
    ok('...and it is not duplicated by a second boot on the same page',
      (() => { const before = t.dom.nodes.length; return before === 1; })(),
      'nodes=' + t.dom.nodes.length);
  }
  {
    // No DOM to hang it on: fall back rather than swallow the warning.
    const t = boot({
      noDom: true,
      firestore: makeFirestore({ photoQueuePending: 2, photoQueuePendingAt: 8 })
    });
    await settle();
    ok('with no document body, the warning still reaches the rep via the toast',
      t.toasts.some((x) => LOSS.test(x.msg)),
      'toasts=' + JSON.stringify(t.toasts) + ' — degrading to silence loses the whole point');
  }

  // ── singular copy ──────────────────────────────────────────────────────
  {
    const t = boot({ firestore: makeFirestore({ photoQueuePending: 1, photoQueuePendingAt: 5 }) });
    await settle();
    ok('one lost photo reads as "1 photo", not "1 photos"',
      /\b1 photo\b/.test(bannerText(t)) && !/1 photos/.test(bannerText(t)), bannerText(t));
  }

  // ── a first boot is not a loss ─────────────────────────────────────────
  {
    const t = boot({ firestore: makeFirestore(null) });
    await settle();
    ok('a genuine first boot with no marker says nothing', !said(t, LOSS),
      'every new device install hits this path');
  }
  {
    const t = boot({ firestore: makeFirestore({ photoQueuePending: 0, photoQueuePendingAt: 9 }) });
    await settle();
    ok('a marker of 0 says nothing', !said(t, LOSS));
  }

  // ── told once, and the acknowledgement survives a sign-out ─────────────
  // nbd-auth.js purgeAccountStorage() drops every nbd_-prefixed key outside
  // its KEEP set on EVERY logout, so a local "already reported" flag would be
  // erased by an ordinary sign-out and the rep accused a second time. The
  // acknowledgement therefore lives on the server.
  {
    const marker = { photoQueuePending: 2, photoQueuePendingAt: 4242 };
    const shared = makeFirestore(marker);
    const t1 = boot({ ls: {}, firestore: shared });
    await settle();
    const t2 = boot({ ls: {}, firestore: shared });   // fresh ls = the purge
    await settle();
    ok('the loss is reported once, and STAYS reported through a sign-out purge',
      said(t1, LOSS) && !said(t2, LOSS),
      'first=' + said(t1, LOSS) + ' second=' + said(t2, LOSS)
      + ' — localStorage cannot hold this flag; purgeAccountStorage deletes it');
    ok('...because the acknowledgement was written to the server',
      shared.state.data.photoQueueLossAckAt === 4242,
      'ackAt=' + shared.state.data.photoQueueLossAckAt);
    ok('...without disturbing the pending count', shared.state.data.photoQueuePending === 2,
      'pending=' + shared.state.data.photoQueuePending);
  }
  {
    // A LATER loss is a different marker and must be reported again.
    const shared = makeFirestore({ photoQueuePending: 2, photoQueuePendingAt: 100 });
    const t1 = boot({ firestore: shared });
    await settle();
    shared.state.data = { photoQueuePending: 5, photoQueuePendingAt: 200, photoQueueLossAckAt: 100 };
    const t2 = boot({ firestore: shared });
    await settle();
    ok('a second, later loss is reported again',
      said(t1, LOSS) && said(t2, LOSS),
      'a rep who loses photos twice must hear about it twice');
  }

  // ── the normal boot pays nothing ───────────────────────────────────────
  {
    const t = boot({ store: makeStore({ lastKnownCount: () => 0 }) });
    await settle();
    ok('an empty queue costs no server read and no notice',
      t.fsdb.calls.get === 0 && t.fsdb.calls.set === 0 && t.toasts.length === 0 && !bannerOf(t),
      'reads=' + t.fsdb.calls.get + ' writes=' + t.fsdb.calls.set);
  }
  {
    const t = boot({
      store: makeStore({ lastKnownCount: () => 2, count: async () => 2, pendingForUid: async () => 2 })
    });
    await settle();
    ok('a device that still has its counter never consults the server',
      t.fsdb.calls.get === 0, 'reads=' + t.fsdb.calls.get);
  }

  // ── the marker is maintained, so the witness has something to say ──────
  {
    let rows = 2;
    const t = boot({
      store: makeStore({
        lastKnownCount: () => 2,
        count: async () => rows,
        pendingForUid: async () => rows,
        pendingStats: async () => ({ count: rows, oldestAt: rows ? 1 : 0 })
      }),
      onDrain: () => { rows = 0; }
    });
    await settle();
    ok('the drain runs', t.drained.count === 1);
    ok('what is owed is recorded BEFORE the drain is attempted',
      countWrites(t).length >= 1 && countWrites(t)[0].photoQueuePending === 2,
      'wrote=' + JSON.stringify(t.fsdb.calls.wrote)
      + ' — a tab that dies mid-drain must still leave the count on the server');
    ok('...and cleared once the photos actually arrived',
      countWrites(t).length === 2 && countWrites(t)[1].photoQueuePending === 0,
      'wrote=' + JSON.stringify(t.fsdb.calls.wrote)
      + ' — a stale marker would warn about photos that did arrive');
    ok('every count write is stamped so a later loss is distinguishable',
      countWrites(t).every((w) => typeof w.photoQueuePendingAt === 'number' && w.photoQueuePendingAt > 0));
  }
  {
    // THE SHARED DEVICE. store.count() sees every row on the phone; the drain
    // only ever uploads this rep's. Filing the unfiltered number under this
    // rep's name leaves them owning a backlog they never shot.
    const t = boot({
      store: makeStore({
        lastKnownCount: () => null,
        count: async () => 3,          // three rows on the device...
        pendingForUid: async () => 0   // ...none of them this rep's
      })
    });
    await settle();
    ok('another rep\'s rows are NOT filed under the signed-in rep',
      countWrites(t).every((w) => w.photoQueuePending === 0),
      'wrote=' + JSON.stringify(t.fsdb.calls.wrote)
      + ' — a 3 here waits to accuse this rep of losing photos they never took');
  }
  {
    // A drain that FAILS must leave the count standing on the server.
    const t = boot({
      store: makeStore({
        lastKnownCount: () => 3, count: async () => 3, pendingForUid: async () => 3,
        pendingStats: async () => ({ count: 3, oldestAt: 1 })
      }),
      onDrain: () => { throw new Error('still offline'); }
    });
    await settle();
    ok('a failed drain leaves the owed count on the server',
      countWrites(t).length >= 1
      && countWrites(t)[countWrites(t).length - 1].photoQueuePending === 3,
      'wrote=' + JSON.stringify(t.fsdb.calls.wrote));
  }
  {
    // A failed per-uid read is null, not 0, and must write nothing.
    const t = boot({
      store: makeStore({
        lastKnownCount: () => 2, count: async () => 2, pendingForUid: async () => null,
        pendingStats: async () => null
      })
    });
    await settle();
    ok('a failed per-user count writes no marker at all',
      countWrites(t).length === 0,
      'wrote=' + JSON.stringify(t.fsdb.calls.wrote) + ' — null is unknown, not zero');
  }
  {
    // An unchanged queue on the next boot must not re-write the same number.
    const ls = {};
    const mk = () => makeStore({
      lastKnownCount: () => 2, count: async () => 2, pendingForUid: async () => 2,
      pendingStats: async () => ({ count: 2, oldestAt: Date.now() })
    });
    const t1 = boot({ ls: ls, store: mk() });
    await settle();
    const t2 = boot({ ls: ls, store: mk() });
    await settle();
    ok('an unchanged queue does not re-write the marker every boot',
      countWrites(t2).length === 0,
      'first=' + countWrites(t1).length + ' second=' + countWrites(t2).length
      + ' — otherwise a write per boot per rep');
  }

  // ── the counter is re-seeded, because WE delete it ─────────────────────
  // nbd-auth.js purgeAccountStorage() drops nbd_photo_queue_last_known_size on
  // every logout while the IndexedDB rows survive. Without a re-seed the
  // store's partial-eviction detector stays blind until the next add()/
  // remove(), so a rep who signs out on Friday and is evicted on Monday is
  // never told anything.
  {
    const store = makeStore({
      lastKnownCount: () => null,   // purged by the sign-out
      count: async () => 4,         // ...but the rows are still here
      pendingForUid: async () => 4
    });
    const t = boot({ store: store });
    await settle();
    ok('rows with no baseline re-seed the counter from the real row count',
      store.seeds.length === 1 && store.seeds[0] === 4,
      'seeds=' + JSON.stringify(store.seeds)
      + ' — without this an ordinary sign-out blinds detectLoss() for good');
  }
  {
    const store = makeStore({
      lastKnownCount: () => 2, count: async () => 2, pendingForUid: async () => 2
    });
    const t = boot({ store: store });
    await settle();
    ok('a device that already has a baseline is not re-seeded',
      store.seeds.length === 0, 'seeds=' + JSON.stringify(store.seeds)
      + ' — re-seeding over a real baseline would mask the loss it was holding');
  }
  {
    // The empty-and-unknown branch: seeding 0 is what turns the server read
    // from a per-BOOT cost into a per-device one.
    const store = makeStore({ lastKnownCount: () => null, count: async () => 0 });
    const t = boot({
      store: store,
      firestore: makeFirestore({ photoQueuePending: 0, photoQueuePendingAt: 3 })
    });
    await settle();
    ok('an answered server consult seeds 0 so later boots stop asking',
      store.seeds.length === 1 && store.seeds[0] === 0,
      'seeds=' + JSON.stringify(store.seeds)
      + ' — a rep who never queues a photo would otherwise re-read the marker every single boot');
  }
  {
    // A doc that does not exist is an ANSWER ("nothing owed"), not a failure.
    const store = makeStore({ lastKnownCount: () => null, count: async () => 0 });
    const t = boot({ store: store, firestore: makeFirestore(null) });
    await settle();
    ok('a missing marker doc counts as an answer and seeds too',
      store.seeds.length === 1 && store.seeds[0] === 0,
      'seeds=' + JSON.stringify(store.seeds) + ' — this is every brand-new device');
  }
  {
    // An UNREACHABLE server is not an answer. Seeding here would send every
    // later boot down the fast path and the loss would never be reported.
    const store = makeStore({ lastKnownCount: () => null, count: async () => 0 });
    const fsdb = makeFirestore({ photoQueuePending: 3, photoQueuePendingAt: 7 });
    fsdb.getDoc = async () => { throw new Error('offline'); };
    const t = boot({ store: store, firestore: fsdb });
    await settle();
    ok('a FAILED server read seeds nothing, so the next boot asks again',
      store.seeds.length === 0, 'seeds=' + JSON.stringify(store.seeds)
      + ' — seeding here loses the only chance to report the wipe');
  }
  {
    const store = makeStore({ lastKnownCount: () => null, count: async () => 0 });
    const t = boot({ store: store, onLine: false });
    await settle();
    ok('offline, nothing is seeded either', store.seeds.length === 0,
      'seeds=' + JSON.stringify(store.seeds));
  }
  {
    const store = makeStore({ lastKnownCount: () => null, count: async () => 0 });
    const t = boot({ store: store, signedOut: true });
    await settle();
    ok('signed out, nothing is seeded either', store.seeds.length === 0,
      'seeds=' + JSON.stringify(store.seeds) + ' — the login screen must not settle this');
  }
  {
    // An older cached store.js paired with this recovery.js must not throw.
    const store = makeStore({ lastKnownCount: () => null, count: async () => 4 });
    delete store.seedLastKnown;
    const t = boot({ store: store });
    await settle();
    ok('a store without seedLastKnown degrades instead of breaking the boot',
      t.drained.count >= 0, 'a stale service-worker cache can pair the two versions');
  }

  // ── the ONE warning that fires while the photos still exist ────────────
  // Everything else in this feature is an autopsy: it reports a queue the
  // browser already destroyed, and the rep can only reshoot. This one is
  // actionable, so it has to fire early enough to be acted on.
  const DAY = 24 * 60 * 60 * 1000;
  const staleStore = (count, ageDays, over) => makeStore(Object.assign({
    lastKnownCount: () => count,
    count: async () => count,
    pendingForUid: async () => count,
    pendingStats: async () => ({ count: count, oldestAt: Date.now() - ageDays * DAY })
  }, over || {}));

  {
    const t = boot({ store: staleStore(3, 3) });
    await settle();
    ok('a queue sitting for days warns the rep WHILE the photos still exist',
      said(t, STALE), 'banner=' + JSON.stringify(bannerText(t))
      + ' — silence here is the whole failure mode: they find out after the purge');
    ok('...naming the count and the age', /3 photos have been waiting 3 days/.test(bannerText(t)),
      bannerText(t));
    ok('...and telling them what to actually do',
      /Connect to Wi-Fi/.test(bannerText(t)), bannerText(t));
    ok('...on the sticky banner, so it survives the boot', bannerOf(t) !== null);
  }
  {
    const t = boot({ store: staleStore(1, 1.5) });
    await settle();
    ok('a queue a few hours old does NOT nag',
      !said(t, STALE), 'banner=' + JSON.stringify(bannerText(t))
      + ' — a rep out of signal for an afternoon is not a problem');
  }
  {
    const t = boot({ store: staleStore(1, 2.2) });
    await settle();
    ok('one stale photo reads as "1 photo ... 1 day", not "1 photos ... 2 days"',
      /1 photo has been waiting 2 days/.test(bannerText(t)), bannerText(t));
  }
  {
    // OFFLINE is exactly when this matters — there is no drain to save them.
    const t = boot({ store: staleStore(4, 5), onLine: false });
    await settle();
    ok('offline, the stale warning still fires', said(t, STALE),
      'banner=' + JSON.stringify(bannerText(t))
      + ' — no network is the state that PRODUCES a stale queue');
    ok('...without inventing a server write it cannot make',
      t.fsdb.calls.set === 0, 'wrote=' + JSON.stringify(t.fsdb.calls.wrote));
  }
  {
    // A drain that clears the queue must leave the rep alone.
    let n = 3;
    const store = makeStore({
      lastKnownCount: () => 3,
      count: async () => n,
      pendingForUid: async () => n,
      pendingStats: async () => ({ count: n, oldestAt: n ? Date.now() - 9 * DAY : 0 })
    });
    const t = boot({ store: store, onDrain: () => { n = 0; } });
    await settle();
    ok('a successful drain warns about nothing', !said(t, STALE),
      'banner=' + JSON.stringify(bannerText(t)) + ' — the photos arrived');
  }
  {
    // A drain that fails leaves them stale, and the rep should hear it.
    const t = boot({
      store: staleStore(2, 6),
      onDrain: () => { throw new Error('still failing'); }
    });
    await settle();
    ok('a failed drain leaves the warning standing', said(t, STALE),
      'banner=' + JSON.stringify(bannerText(t)));
  }
  {
    // The photos bundle never arrives (lazy load failed) — still warn.
    const t = boot({ store: staleStore(2, 4), noPhotoEngine: true });
    await settle();
    ok('the warning does not depend on the photos bundle loading', said(t, STALE),
      'banner=' + JSON.stringify(bannerText(t)));
  }
  {
    // An older cached store.js has no pendingStats. Degrade to the count-only
    // path rather than throwing — and stay silent rather than guess an age.
    const store = makeStore({ lastKnownCount: () => 2, count: async () => 2, pendingForUid: async () => 2 });
    delete store.pendingStats;
    const t = boot({ store: store });
    await settle();
    ok('a store without pendingStats still drains and does not throw',
      t.drained.count === 1, 'drained=' + t.drained.count);
    ok('...and makes no age claim it cannot support', !said(t, STALE),
      'banner=' + JSON.stringify(bannerText(t)));
  }

  // ── degrade quietly ────────────────────────────────────────────────────
  {
    const t = boot({ onLine: false, firestore: makeFirestore({ photoQueuePending: 4, photoQueuePendingAt: 1 }) });
    await settle();
    ok('offline, the server is not consulted and nothing is claimed',
      t.fsdb.calls.get === 0 && !said(t, LOSS), 'reads=' + t.fsdb.calls.get);
  }
  {
    const t = boot({ signedOut: true, firestore: makeFirestore({ photoQueuePending: 4, photoQueuePendingAt: 1 }) });
    await settle();
    ok('signed out, recovery waits instead of guessing',
      t.fsdb.calls.get === 0 && !said(t, LOSS),
      'the login screen must not accuse the browser of anything');
  }
  {
    const t = boot({
      noFirestoreHelpers: true,
      firestore: makeFirestore({ photoQueuePending: 4, photoQueuePendingAt: 1 })
    });
    await settle();
    ok('a missing Firestore helper degrades to silence, not a boot failure',
      !said(t, LOSS) && t.fsdb.calls.get === 0);
  }
  {
    const t = boot({
      noStore: true,
      firestore: makeFirestore({ photoQueuePending: 4, photoQueuePendingAt: 1 })
    });
    await settle();
    ok('no store at all is survivable', !said(t, LOSS) && t.fsdb.calls.get === 0);
  }

  // ── the partial eviction still works ───────────────────────────────────
  {
    const t = boot({
      store: makeStore({ lastKnownCount: () => 2, detectLoss: async () => 2, count: async () => 0 })
    });
    await settle();
    ok('a partial eviction is still reported from the local counter',
      said(t, /cleared by your browser/), 'banner=' + JSON.stringify(bannerText(t)));
    ok('...on the sticky banner too, not a vanishing toast',
      bannerOf(t) !== null, 'the same 2.6s problem applies to this message');
    ok('...without a server read, because the device could prove it alone',
      t.fsdb.calls.get === 0, 'reads=' + t.fsdb.calls.get);
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

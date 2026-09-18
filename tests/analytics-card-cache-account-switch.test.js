/**
 * tests/analytics-card-cache-account-switch.test.js — the analytics 'board'
 * cards (Adjuster Tactics, AI Texting) must not serve a PRIOR TENANT's
 * cached data after a same-tab account switch.
 *
 * THE DEFECT (adjuster-board cross-tenant audit, 2026-09-15)
 * ──────────────────────────────────────────────────────────────────
 * adjuster-tactic-card.js and ai-texting-stats-card.js each memoize their
 * getAdjusterTacticBoard / getAiTextingStats callable response in a
 * module-scope `_cache` and serve it forever once populated
 * (`if (_cache) return _cache;`). Both export `_clearCache()` for exactly
 * this situation, but nothing in the codebase ever called it.
 *
 * dashboard-bootstrap.module.js's onAuthStateChanged handler explicitly
 * anticipates a same-tab account switch on a shared device — Firebase Auth's
 * local/session persistence propagates a second login to any already-open
 * dashboard tab without a full navigation — and calls
 * NBDAuth.purgeAccountStorage() when the uid changes. But purgeAccountStorage
 * only sweeps nbd_/nav--prefixed localStorage keys; it never touches these
 * cards' in-memory _cache. So if Company A's rep opened the board view
 * (populating _cache with Company A's carrier/adjuster or AI-texting data),
 * and Company B's rep then signs in on the SAME TAB, the very next
 * goTo('board') renders Company A's confidential data into a session now
 * authenticated as Company B — a cross-tenant leak the callable's own
 * companyId scoping cannot prevent, because the network call never happens.
 *
 * THE SECOND DEFECT — WRONG KEY (2026-09-20)
 * ──────────────────────────────────────────
 * The first fix cleared the caches from inside the shared-device purge
 * block, i.e. keyed on localStorage's `nbd_last_uid`. localStorage is shared
 * by every tab on the origin; these caches are per-module, per-tab. The
 * dashboard's own auth callback is `nbd_last_uid`'s ONLY writer, so:
 *
 *   tab 1  dashboard signed in as A, board rendered → _cache holds A
 *   tab 2  signs in as B, loads the dashboard, its callback writes
 *          nbd_last_uid = B
 *   tab 1  callback finally fires with B — Firebase restores auth state
 *          from IndexedDB and a backgrounded tab's timers are throttled,
 *          so arriving second is routine — reads nbd_last_uid, sees B,
 *          concludes nothing changed, and SKIPS the whole block.
 *   tab 1  goTo('board') renders A's data into B's session. No network call.
 *
 * A storage exception skips the block outright, with the same result.
 * So the card clear now keys on the IN-MEMORY uid this tab's own callback
 * last reported (`_bindCachesToSession`, declared immediately above
 * onAuthStateChanged and called as the callback's first statement). The
 * localStorage purge deliberately stays keyed on nbd_last_uid — that state
 * IS shared, and purging on an in-memory switch would wipe prefs the new
 * account just wrote in another tab.
 *
 * WHY THIS FILE EXECUTES INSTEAD OF GREPPING
 * ──────────────────────────────────────────
 * A /_clearCache/ regex passes today — the method exists, just uncalled.
 * This suite instead RUNS the real card modules (real _cache, real
 * fetchBoard/fetchStats memoization) and RUNS the exact account-boundary
 * code extracted verbatim out of dashboard-bootstrap.module.js — the
 * session binder, the callback's first statement, and the shared-device
 * purge block, all three char-for-char the text the browser executes
 * (indexOf anchors, not paraphrases), composed into one closure so the
 * binder's module-scope uid persists across ticks exactly as it does in the
 * real module, and wired to the SAME fake `window` the cards populated. If
 * a future edit drops the clear, re-keys it on localStorage, moves the bind
 * call after an await, or the anchors drift, this fails loudly instead of
 * silently no-op'ing.
 *
 * Pure Node, zero deps. Run: node tests/analytics-card-cache-account-switch.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }
// Drops `//` line comments so a prose mention of a keyword can't satisfy —
// or, worse, falsely fail — a check about the CODE between two anchors.
// [^\r\n]*, never .* : this file is checked out CRLF on Windows, and `.`
// does not cross a lone \r, so a `.*$` stripper silently matches nothing.
function stripLineComments(src) {
  return src.replace(/\/\/[^\r\n]*/g, '');
}
function countOf(haystack, needle) {
  let n = 0, i = 0;
  for (;;) {
    const at = haystack.indexOf(needle, i);
    if (at === -1) return n;
    n++; i = at + needle.length;
  }
}

// ── Extract the EXACT account-boundary code from the real bootstrap ───────
// Three regions, each anchored on unique substrings. If any anchor goes
// missing (the code was refactored away) the extraction section fails and
// every scenario throws, instead of silently testing nothing.
const BOOTSTRAP_SRC = read('docs/pro/js/dashboard-bootstrap.module.js');

// One binder serves BOTH in-memory caches — the card memos here and the lead
// book from #1676 — collapsed when the second landed so a later change to what
// counts as an account switch cannot update one and miss the other. The lifted
// region therefore also carries _resetLeadsCache, which is harmless in this
// harness: it only assigns to the fake `window` this suite passes in.
const BINDER_START_ANCHOR = 'let _sessionUid;';
const BINDER_END_ANCHOR = 'if (prev === undefined || prev === uid) return;';
const BIND_CALL = '_bindCachesToSession(user ? user.uid : null);';
const CALLBACK_ANCHOR = 'onAuthStateChanged(auth, async user => {';
const REDIRECT_ANCHOR = 'if (!user) { window.location.replace("/pro/login.html"); return; }';
const START_ANCHOR = "const _lastUid = localStorage.getItem('nbd_last_uid');";
const END_ANCHOR = '} catch (_) { /* best-effort; never block boot on a storage error */ }';

const binderStartIdx = BOOTSTRAP_SRC.indexOf(BINDER_START_ANCHOR);
const binderEndAnchorIdx = BOOTSTRAP_SRC.indexOf(BINDER_END_ANCHOR);
// The end anchor is the binder's own brace-free first-tick guard, and every
// statement after it is a brace-free call, so the next `}` closes
// _bindCachesToSession itself. Anchoring on the guard rather than on the last
// call keeps this extraction independent of the ORDER the two caches are
// cleared in — only on the binder still existing.
const binderCloseIdx = binderEndAnchorIdx === -1
  ? -1 : BOOTSTRAP_SRC.indexOf('}', binderEndAnchorIdx + BINDER_END_ANCHOR.length);
const bindCallIdx = BOOTSTRAP_SRC.indexOf(BIND_CALL);
const callbackIdx = BOOTSTRAP_SRC.indexOf(CALLBACK_ANCHOR);
const redirectIdx = BOOTSTRAP_SRC.indexOf(REDIRECT_ANCHOR);
const startIdx = BOOTSTRAP_SRC.indexOf(START_ANCHOR);
const tryIdx = startIdx === -1 ? -1 : BOOTSTRAP_SRC.lastIndexOf('try {', startIdx);
const endIdx = startIdx === -1 ? -1 : BOOTSTRAP_SRC.indexOf(END_ANCHOR, startIdx);

section('extraction — the account-boundary code still exists where onAuthStateChanged expects it');
ok('session-uid declaration found', binderStartIdx !== -1);
ok('binder body (in-memory prev-vs-uid compare + card clear) found', binderEndAnchorIdx !== -1);
ok('binder closing brace found', binderCloseIdx !== -1 && binderCloseIdx > binderEndAnchorIdx);
ok('onAuthStateChanged callback found', callbackIdx !== -1);
ok('the bind call is present in the callback', bindCallIdx !== -1);
ok('start anchor (nbd_last_uid read) found', startIdx !== -1);
ok('enclosing try { found immediately before it', tryIdx !== -1 && startIdx - tryIdx < 40);
ok('end anchor (best-effort catch) found after it', endIdx !== -1);

const BINDER_SRC = (binderStartIdx !== -1 && binderCloseIdx !== -1)
  ? BOOTSTRAP_SRC.slice(binderStartIdx, binderCloseIdx + 1)
  : null;
const ACCOUNT_SWITCH_BLOCK = (tryIdx !== -1 && endIdx !== -1)
  ? BOOTSTRAP_SRC.slice(tryIdx, endIdx + END_ANCHOR.length)
  : null;

ok('extracted binder is non-trivial (guards against an empty/garbage slice)',
  !!BINDER_SRC && BINDER_SRC.length > 100);
ok('extracted binder actually clears BOTH card caches',
  !!BINDER_SRC && BINDER_SRC.includes('AdjusterTacticCard') && BINDER_SRC.includes('AiTextingStatsCard'));
ok('extracted purge block is non-trivial (guards against an empty/garbage slice)',
  !!ACCOUNT_SWITCH_BLOCK && ACCOUNT_SWITCH_BLOCK.length > 100);

// ── Structural pins: WHERE the code lives is the whole fix ────────────────
// Re-keying the clear on localStorage, or arming it after the first await,
// reintroduces the exact leak this file exists for — and both mutations
// leave a passing-looking `_clearCache()` call in the file.
section('structure — the boundary is keyed on the IN-MEMORY uid, before any await');
ok('the binder is declared OUTSIDE the callback (module scope, so it remembers across ticks)',
  binderStartIdx !== -1 && callbackIdx !== -1 && binderStartIdx < callbackIdx);
ok('the bind call runs INSIDE the callback', bindCallIdx > callbackIdx);
ok('the bind call runs BEFORE the signed-out redirect (a sign-out drops the board too)',
  redirectIdx !== -1 && bindCallIdx < redirectIdx);
ok('the bind call runs BEFORE the nbd_last_uid read — it must not depend on that block',
  bindCallIdx < startIdx);
ok('nothing is awaited between the callback opening and the bind call',
  bindCallIdx > callbackIdx
  && !/\bawait\b/.test(stripLineComments(BOOTSTRAP_SRC.slice(callbackIdx, bindCallIdx))),
  'an await here reopens the leak: the board keeps serving the old tenant until the await settles');
ok('the binder is declared exactly once (a second copy would shadow/diverge)',
  countOf(BOOTSTRAP_SRC, BINDER_START_ANCHOR) === 1);
ok('the bind call appears exactly once (an added later call must not mask a moved first one)',
  countOf(BOOTSTRAP_SRC, BIND_CALL) === 1);
ok('the shared-device purge block no longer clears the card caches itself',
  !!ACCOUNT_SWITCH_BLOCK
  && !/AdjusterTacticCard\s*\.\s*_clearCache|AdjusterTacticCard\._clearCache\(\)/.test(ACCOUNT_SWITCH_BLOCK)
  && !/AiTextingStatsCard\._clearCache\(\)/.test(ACCOUNT_SWITCH_BLOCK),
  'a localStorage-keyed clear is exactly the defect — another tab rewrites nbd_last_uid and the block is skipped');
ok('the localStorage purge is still keyed on nbd_last_uid (must NOT move to the in-memory switch)',
  !!ACCOUNT_SWITCH_BLOCK
  && ACCOUNT_SWITCH_BLOCK.includes('purgeAccountStorage')
  && !!BINDER_SRC && !BINDER_SRC.includes('purgeAccountStorage'),
  'purging shared localStorage on an in-memory switch would wipe prefs the new account just wrote in another tab');

// Composes the three extracted regions into ONE closure — the binder's
// module-scope uid lives across calls exactly as it does in the real file —
// and returns a function that runs one onAuthStateChanged tick.
function makeAuthTickRunner(win, storage) {
  if (!BINDER_SRC || !ACCOUNT_SWITCH_BLOCK || bindCallIdx === -1) {
    throw new Error('bootstrap extraction failed — see the extraction section above');
  }
  const factory = new Function('window', 'localStorage',
    BINDER_SRC + '\n' +
    'return function (user) {\n' +
    BIND_CALL + '\n' +
    'if (!user) { window.location.replace("/pro/login.html"); return; }\n' +
    ACCOUNT_SWITCH_BLOCK + '\n' +
    '};');
  return factory(win, storage);
}

// ── A minimal fake DOM good enough for host()'s find-or-create dance ───────
function makeFakeDom() {
  const store = new Map();
  function makeEl(tag) {
    const el = { tagName: tag, id: '', innerHTML: '', children: [], appendChild(child) {
      this.children.push(child);
      if (child.id) store.set(child.id, child);
    } };
    return el;
  }
  const analyticsContainer = makeEl('div');
  analyticsContainer.id = 'analyticsContainer';
  store.set('analyticsContainer', analyticsContainer);
  return {
    document: {
      getElementById: (id) => store.get(id) || null,
      createElement: (tag) => makeEl(tag),
    },
    store,
  };
}

// A fake localStorage backed by a plain object, same shape browsers expose.
function makeFakeLocalStorage(seed) {
  const data = Object.assign({}, seed);
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    _dump: () => Object.assign({}, data),
  };
}

// A fake window shaped like the dashboard's: records purge calls and
// swallows the signed-out redirect.
function makeFakeWindow() {
  const win = {
    __purgeCalls: 0,
    __redirects: [],
    NBDAuth: { purgeAccountStorage: () => { win.__purgeCalls++; } },
  };
  win.location = { replace: (url) => { win.__redirects.push(url); } };
  return win;
}

// A callable stub that returns a queued response per invocation (last one
// repeats once the queue is drained) and records every call.
function makeCallableStub(responses) {
  let n = 0;
  const calls = [];
  const httpsCallable = (fns, name) => async (payload) => {
    calls.push({ name, payload });
    const data = responses[Math.min(n, responses.length - 1)];
    n++;
    return { data };
  };
  return { httpsCallable, calls };
}

// Loads one of the two real card modules into a fresh window/document.
function loadCard(fileName, globalName, win, doc) {
  const src = read(path.join('docs/pro/js', fileName).replace(/\\/g, '/'));
  new Function('window', 'document', 'console', src)(win, doc, console);
  const card = win[globalName];
  if (!card || typeof card.render !== 'function' || typeof card._clearCache !== 'function') {
    throw new Error(fileName + ' did not install the expected ' + globalName + ' global');
  }
  return card;
}

const UID_A = 'uid-company-A';
const UID_B = 'uid-company-B';

// Stands up one card module on a fresh window + localStorage, with the
// auth-tick runner wired to the same window, and returns the handles a
// scenario needs.
function stand(spec, seedStorage) {
  const { document } = makeFakeDom();
  const win = makeFakeWindow();
  const card = loadCard(spec.file, spec.global, win, document);
  const stub = makeCallableStub([spec.dataFor('A'), spec.dataFor('B'), spec.dataFor('B')]);
  win._functions = {};
  win._httpsCallable = stub.httpsCallable;
  const storage = makeFakeLocalStorage(seedStorage);
  return {
    card, win, storage, stub, document,
    tick: makeAuthTickRunner(win, storage),
    html: () => (document.getElementById(spec.hostId) || {}).innerHTML || '',
  };
}

// ── The scenarios, run once per card (both share the identical bug shape) ──
const CARDS = [
  {
    file: 'adjuster-tactic-card.js',
    global: 'AdjusterTacticCard',
    hostId: 'adjusterTacticCard',
    // Board payload shaped like functions/adjuster-board-logic.js's output.
    dataFor: (tag) => ({
      totalCalls: 3, withInsurance: 3, windowDays: 365,
      byCarrier: [{ name: 'CARRIER-' + tag, calls: 3, adjusterCount: 1, topObjections: [], topRedFlags: [] }],
    }),
    marker: (tag) => 'CARRIER-' + tag,
  },
  {
    file: 'ai-texting-stats-card.js',
    global: 'AiTextingStatsCard',
    hostId: 'aiTextingStatsCard',
    dataFor: (tag) => ({
      total: 7, windowDays: 90, acceptRate: 0.5, sent: 4, acted: 2,
      editRate: 0.1, dismissRate: 0.1, dismissed: 1, avgMinutesToAction: 12,
      pending: 1, failed: 0, // no per-tenant string field on this payload —
      // the callable-invocation count is what we vary and check for.
    }),
    marker: null, // distinguished by re-fetch count instead of a name string
  },
];

// SCENARIO 1 — the original leak: this tab sees the switch itself, so
// nbd_last_uid still holds the OLD uid when the callback reads it.
async function scenarioThisTabSeesTheSwitch(spec) {
  section(spec.global + ' — [1] cache must not survive a same-tab account switch');
  const s = stand(spec, { nbd_last_uid: UID_A });

  // Page load as Company A: the callback's first tick binds the session.
  s.tick({ uid: UID_A });
  ok('page-load tick does not purge (same account as nbd_last_uid)', s.win.__purgeCalls === 0);

  // Company A's rep opens the board — populates the cache.
  await s.card.render();
  ok('first render fetches once', s.stub.calls.length === 1);
  if (spec.marker) ok("first render shows Company A's data", s.html().includes(spec.marker('A')));

  // Re-opening the SAME session's board must NOT re-fetch (this is the
  // intended, non-buggy "cached for the session" behaviour — pinned so a
  // fix for the leak below cannot regress into clearing on every render).
  await s.card.render();
  ok('re-rendering the SAME session serves the cache (no re-fetch)', s.stub.calls.length === 1);

  // Company B signs in on the same tab (Firebase Auth propagates this
  // without a page navigation).
  s.tick({ uid: UID_B });
  ok('the shared-device purge still fires on a real uid change (unchanged behaviour)',
    s.win.__purgeCalls === 1);
  ok('nbd_last_uid is updated to the new uid', s.storage.getItem('nbd_last_uid') === UID_B);

  // Company B's rep opens the board (goTo('board') calls render() again).
  await s.card.render();
  ok('THE FIX: opening the board after an account switch re-fetches instead of reusing the stale cache',
    s.stub.calls.length === 2,
    `expected 2 callable invocations after the switch, saw ${s.stub.calls.length} — the card served the ` +
    `PRIOR TENANT's cached response into the new session`);
  if (spec.marker) {
    const after = s.html();
    ok("THE FIX: the rendered board shows Company B's data, not Company A's leaked-over data",
      after.includes(spec.marker('B')) && !after.includes(spec.marker('A')));
  }
}

// SCENARIO 2 — THE REGRESSION THIS FILE GAINED ON 2026-09-20.
// nbd_last_uid ALREADY equals the new uid because ANOTHER TAB's callback
// wrote it first; only this tab's in-memory session still says A.
// A localStorage-keyed clear reads "nothing changed" and skips entirely.
async function scenarioOtherTabWonTheRace(spec) {
  section(spec.global + ' — [2] nbd_last_uid already rewritten by the other tab');
  const s = stand(spec, { nbd_last_uid: UID_A });

  // Tab 1 (this one): loaded and bound as Company A, board rendered.
  s.tick({ uid: UID_A });
  await s.card.render();
  await s.card.render();
  ok('cache is populated and serving Company A', s.stub.calls.length === 1);

  // Tab 2 signs in as Company B and loads the dashboard. Its own callback
  // is nbd_last_uid's only writer — this is literally all that reaches
  // tab 1 through localStorage.
  s.storage.setItem('nbd_last_uid', UID_B);

  // Tab 1's callback finally fires with B (throttled background tab /
  // async IndexedDB auth restore — arriving second is routine).
  s.tick({ uid: UID_B });

  ok('the localStorage purge correctly did NOT fire (nbd_last_uid already matched)',
    s.win.__purgeCalls === 0,
    'if this fires, the scenario is not reproducing the race and the next assertion proves nothing');

  await s.card.render();
  ok('THE FIX: the card re-fetches on the IN-MEMORY uid change, with nbd_last_uid already equal',
    s.stub.calls.length === 2,
    `expected 2 callable invocations, saw ${s.stub.calls.length} — the clear is still keyed on the ` +
    `shared nbd_last_uid, so another tab's write suppressed it and Company A's board stayed in memory`);
  if (spec.marker) {
    const after = s.html();
    ok("THE FIX: the board shows Company B's data although localStorage reported no change",
      after.includes(spec.marker('B')) && !after.includes(spec.marker('A')));
  }
}

// SCENARIO 3 — localStorage throws (Safari private mode, blocked storage).
// The whole purge block is skipped by its own catch; the in-memory boundary
// sits OUTSIDE that try and must still fire.
async function scenarioStorageThrows(spec) {
  section(spec.global + ' — [3] localStorage unavailable');
  const s = stand(spec, { nbd_last_uid: UID_A });
  s.tick({ uid: UID_A });
  await s.card.render();
  ok('cache is populated and serving Company A', s.stub.calls.length === 1);

  s.storage.getItem = () => { throw new Error('SecurityError: storage disabled'); };
  s.storage.setItem = () => { throw new Error('SecurityError: storage disabled'); };

  let threw = null;
  try { s.tick({ uid: UID_B }); } catch (e) { threw = e; }
  ok('the tick does not throw when storage is unavailable', !threw, threw && threw.message);
  ok('the localStorage purge could not run', s.win.__purgeCalls === 0);

  await s.card.render();
  ok('THE FIX: the card still re-fetches with localStorage entirely unavailable',
    s.stub.calls.length === 2,
    `expected 2 callable invocations, saw ${s.stub.calls.length}`);
}

// SCENARIO 4 — sign-out drops the board too, and a repeat tick for the SAME
// uid (Firebase re-fires on token refresh) must NOT clear, or every refresh
// re-hits the callable.
async function scenarioSignOutAndIdempotence(spec) {
  section(spec.global + ' — [4] sign-out clears; a same-uid re-tick does not');
  const s = stand(spec, { nbd_last_uid: UID_A });
  s.tick({ uid: UID_A });
  await s.card.render();
  ok('cache is populated and serving Company A', s.stub.calls.length === 1);

  // Firebase re-reports the same user (token refresh, visibility change).
  s.tick({ uid: UID_A });
  await s.card.render();
  ok('a repeat tick for the SAME uid keeps the cache (no needless re-fetch)',
    s.stub.calls.length === 1,
    `expected 1 callable invocation, saw ${s.stub.calls.length} — the binder is clearing on every tick`);

  // Sign out: the callback redirects, but the binder ran first.
  s.tick(null);
  ok('the signed-out tick redirects to login (unchanged behaviour)',
    s.win.__redirects.length === 1 && s.win.__redirects[0] === '/pro/login.html');
  await s.card.render();
  ok('THE FIX: signing out drops the cached board',
    s.stub.calls.length === 2,
    `expected 2 callable invocations, saw ${s.stub.calls.length} — the board survived a sign-out`);
}

// SCENARIO 5 — a page where the card global never loaded must not throw.
function scenarioCardAbsent(spec) {
  section(spec.global + ' — [5] a page where the card never loaded');
  const bareWin = makeFakeWindow();
  const bareStorage = makeFakeLocalStorage({ nbd_last_uid: UID_A });
  const tick = makeAuthTickRunner(bareWin, bareStorage);
  let threw = null;
  try {
    tick({ uid: UID_A });
    tick({ uid: UID_B });
  } catch (e) { threw = e; }
  ok('the account-boundary code tolerates a page where ' + spec.global + ' never loaded (no throw)',
    !threw, threw && threw.message);
  ok('the shared-device purge still ran on that page', bareWin.__purgeCalls === 1);
}

// SCENARIO 6 — one card's _clearCache throwing must not leave the OTHER
// tenant's board memoized. Runs once (not per card) since it is about the
// pair, and it is why the binder guards the two calls separately.
async function scenarioOneCardThrows() {
  section('both cards — [6] one card throwing must not strand the other');
  const { document } = makeFakeDom();
  const win = makeFakeWindow();
  const adjuster = loadCard('adjuster-tactic-card.js', 'AdjusterTacticCard', win, document);
  const texting = loadCard('ai-texting-stats-card.js', 'AiTextingStatsCard', win, document);
  // Payload shapes don't matter here (nothing asserts on rendered text) —
  // reuse the real ones so render() can't trip over a missing field.
  const stub = makeCallableStub([
    CARDS[0].dataFor('A'), CARDS[1].dataFor('A'), CARDS[1].dataFor('B'), CARDS[1].dataFor('B'),
  ]);
  win._functions = {};
  win._httpsCallable = stub.httpsCallable;
  const storage = makeFakeLocalStorage({ nbd_last_uid: UID_A });
  const tick = makeAuthTickRunner(win, storage);

  tick({ uid: UID_A });
  await adjuster.render();
  await texting.render();
  ok('both caches populated', stub.calls.length === 2);

  // The first-cleared card blows up.
  win.AdjusterTacticCard._clearCache = () => { throw new Error('boom'); };

  let threw = null;
  try { tick({ uid: UID_B }); } catch (e) { threw = e; }
  ok('the tick survives a throwing _clearCache', !threw, threw && threw.message);

  await texting.render();
  ok('THE FIX: the second card was still cleared despite the first one throwing',
    stub.calls.length === 3,
    `expected 3 callable invocations, saw ${stub.calls.length} — a shared try/catch let one ` +
    `failure strand the other tenant's board in memory`);
}

// A scenario that throws (extraction failed, a card module blew up) must be
// reported as a named failure and let the REST of the run continue —
// aborting the process at the first throw hides which scenarios still cover
// the leak and which do not.
async function attempt(label, fn, arg) {
  try { await fn(arg); }
  catch (e) { ok(label + ' — scenario ran to completion', false, (e && e.message) || String(e)); }
}

(async function main() {
  for (const spec of CARDS) {
    await attempt(spec.global + ' [1] same-tab switch', scenarioThisTabSeesTheSwitch, spec);
    await attempt(spec.global + ' [2] other tab won the race', scenarioOtherTabWonTheRace, spec);
    await attempt(spec.global + ' [3] storage unavailable', scenarioStorageThrows, spec);
    await attempt(spec.global + ' [4] sign-out / idempotence', scenarioSignOutAndIdempotence, spec);
    await attempt(spec.global + ' [5] card absent', scenarioCardAbsent, spec);
  }
  await attempt('both cards [6] one card throws', scenarioOneCardThrows);

  console.log('\n──────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})().catch((e) => { console.error('\nFATAL:', e && e.stack || e); process.exit(1); });

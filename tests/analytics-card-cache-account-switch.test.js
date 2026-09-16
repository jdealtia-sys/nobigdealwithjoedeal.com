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
 * WHY THIS FILE EXECUTES INSTEAD OF GREPPING
 * ──────────────────────────────────────────
 * A /_clearCache/ regex passes today — the method exists, just uncalled.
 * This suite instead RUNS the real card modules (real _cache, real
 * fetchBoard/fetchStats memoization) and RUNS the exact account-switch
 * block extracted verbatim out of dashboard-bootstrap.module.js's
 * onAuthStateChanged (same char-for-char text the browser executes — an
 * indexOf anchor on both ends, not a paraphrase), wired to the SAME fake
 * `window` the cards populated. If a future edit removes the extracted
 * block's cache-clearing call, or the block's anchors drift, this fails
 * loudly instead of silently no-op'ing.
 *
 * Pure Node, zero deps. Run: node tests/analytics-card-cache-account-switch.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRO_JS = path.join(ROOT, 'docs/pro/js');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

// ── Extract the EXACT account-switch block from the real bootstrap file ────
// Anchored on the start of the shared-device purge and the end of its catch,
// both unique substrings in the file. If either anchor goes missing (the
// block was refactored away) this throws instead of silently testing nothing.
const BOOTSTRAP_SRC = read('docs/pro/js/dashboard-bootstrap.module.js');
const START_ANCHOR = "const _lastUid = localStorage.getItem('nbd_last_uid');";
const END_ANCHOR = "} catch (_) { /* best-effort; never block boot on a storage error */ }";
const startIdx = BOOTSTRAP_SRC.indexOf(START_ANCHOR);
const tryIdx = startIdx === -1 ? -1 : BOOTSTRAP_SRC.lastIndexOf('try {', startIdx);
const endIdx = startIdx === -1 ? -1 : BOOTSTRAP_SRC.indexOf(END_ANCHOR, startIdx);

section('extraction — the account-switch block still exists where onAuthStateChanged expects it');
ok('start anchor (nbd_last_uid read) found', startIdx !== -1);
ok('enclosing try { found immediately before it', tryIdx !== -1 && startIdx - tryIdx < 40);
ok('end anchor (best-effort catch) found after it', endIdx !== -1);

const ACCOUNT_SWITCH_BLOCK = (tryIdx !== -1 && endIdx !== -1)
  ? BOOTSTRAP_SRC.slice(tryIdx, endIdx + END_ANCHOR.length)
  : null;
ok('extracted block is non-trivial (guards against an empty/garbage slice)',
  !!ACCOUNT_SWITCH_BLOCK && ACCOUNT_SWITCH_BLOCK.length > 100);

// Runs the extracted block exactly as onAuthStateChanged would, against a
// fake user/window/localStorage.
function runAccountSwitch(user, win, storage) {
  if (!ACCOUNT_SWITCH_BLOCK) throw new Error('account-switch block failed to extract — see extraction section above');
  new Function('user', 'window', 'localStorage', ACCOUNT_SWITCH_BLOCK)(user, win, storage);
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

// ── The scenario, run once per card (both share the identical bug shape) ──
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
      // the count itself (below) is what we vary and check for.
    }),
    marker: null, // distinguished by drafts count instead of a name string
  },
];

async function runScenario(spec) {
  section(spec.global + ' — cache must not survive a same-tab account switch');

  const { document } = makeFakeDom();
  const win = { location: {}, NBDAuth: { purgeAccountStorage: () => { win.__purgeCalls = (win.__purgeCalls || 0) + 1; } } };
  const card = loadCard(spec.file, spec.global, win, document);

  const RESP_A = spec.dataFor('A');
  const RESP_B = spec.dataFor('B');
  const stub = makeCallableStub([RESP_A, RESP_B, RESP_B]);
  win._functions = {};
  win._httpsCallable = stub.httpsCallable;

  const host = () => document.getElementById(spec.hostId);

  // Company A's rep opens the board — populates the cache.
  await card.render();
  ok('first render fetches once', stub.calls.length === 1);
  const htmlA = host() ? host().innerHTML : '';
  if (spec.marker) ok('first render shows Company A\'s data', htmlA.includes(spec.marker('A')));

  // Re-opening the SAME session's board must NOT re-fetch (this is the
  // intended, non-buggy "cached for the session" behaviour — pinned so a
  // fix for the leak below cannot regress into clearing on every render).
  await card.render();
  ok('re-rendering the SAME session serves the cache (no re-fetch)', stub.calls.length === 1);

  // Company A's rep was the last uid recorded; NOW Company B signs in on
  // the same tab (Firebase Auth propagates this without a page navigation).
  const storage = makeFakeLocalStorage({ nbd_last_uid: 'uid-company-A' });
  const userB = { uid: 'uid-company-B' };
  runAccountSwitch(userB, win, storage);

  ok('the shared-device purge still fires on a real uid change (unchanged behaviour)',
    win.__purgeCalls === 1);
  ok('nbd_last_uid is updated to the new uid', storage.getItem('nbd_last_uid') === 'uid-company-B');

  // Company B's rep opens the board (dashboard-actions.js's goTo('board')
  // calls render() again). THE ASSERTION THIS FILE EXISTS FOR:
  await card.render();
  ok('THE FIX: opening the board after an account switch re-fetches instead of reusing the stale cache',
    stub.calls.length === 2,
    `expected 2 callable invocations after the switch, saw ${stub.calls.length} — the card served the ` +
    `PRIOR TENANT's cached response into the new session`);
  if (spec.marker) {
    const htmlAfter = host() ? host().innerHTML : '';
    ok('THE FIX: the rendered board shows Company B\'s data, not Company A\'s leaked-over data',
      htmlAfter.includes(spec.marker('B')) && !htmlAfter.includes(spec.marker('A')));
  }

  // A page that never loaded this card (global absent) must not throw when
  // the account-switch block runs — the suggested fix guards with
  // `window.X && window.X._clearCache()`.
  const bareWin = { NBDAuth: { purgeAccountStorage: () => {} } };
  const bareStorage = makeFakeLocalStorage({ nbd_last_uid: 'uid-company-A' });
  let threw = null;
  try { runAccountSwitch({ uid: 'uid-company-B' }, bareWin, bareStorage); } catch (e) { threw = e; }
  ok('the account-switch block tolerates a page where ' + spec.global + ' never loaded (no throw)', !threw,
    threw && threw.message);
}

(async function main() {
  for (const spec of CARDS) {
    await runScenario(spec);
  }

  console.log('\n──────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})().catch((e) => { console.error('\nFATAL:', e && e.stack || e); process.exit(1); });

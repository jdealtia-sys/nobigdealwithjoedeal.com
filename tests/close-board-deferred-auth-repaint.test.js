/**
 * Close Board: the deferred-auth poll must not repaint over the New Deal form.
 *
 * THE DEFECT (2026-09-21, found reviewing #1677)
 * ──────────────────────────────────────────────────────────────────
 * dashboard.html#closeboard runs CloseBoard.init() from DOMContentLoaded, which
 * can beat the auth callback that publishes window._user. When it does, init()
 * falls into a 250ms waitForUser poll. That poll's success branch called
 * render() UNCONDITIONALLY:
 *
 *     if (_currentUid()) { _awaitingUser = false; _dealRoomsForCurrentUser();
 *                         render(); hydrateFromFirestore(); return; }
 *
 * render() rebuilds the scroll container with innerHTML, and renderCreateForm()
 * emits fresh <input id="cb-name">/#cb-phone/#cb-better with no value attribute.
 * So a rep who tapped "+ NEW DEAL" and started typing before auth resolved had
 * every field blanked on the next tick — no toast, no warning, nothing to
 * recover. This is the window where it is MOST likely: the form is reachable
 * while the poll is still waiting.
 *
 * hydrateFromFirestore(), the only other background repaint in the file, has
 * guarded exactly this since it was written:
 *
 *     if (currentTab !== 'create') render();
 *
 * The poll simply never got the same guard.
 *
 * SECOND DEFECT, same area: _awaitingUser was only cleared INSIDE the poll, so
 * a re-entrant init() (goTo('closeboard') calls it on every navigation to the
 * board) that found a user took the fast path while the 250ms chain stayed
 * alive — the next tick hydrated a second time. Duplicate Firestore read, and
 * a second repaint.
 *
 * WHY THIS EXECUTES RATHER THAN GREPS
 * A /currentTab/ regex would pass on the broken file: the guard string exists
 * in hydrateFromFirestore 1000 lines away. This suite lifts init() and the
 * poll out of the shipped file and RUNS them against a fake clock and a fake
 * DOM, asserting on whether render() was called.
 *
 * Pure Node, zero deps. Run: node tests/close-board-deferred-auth-repaint.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'docs/pro/js/close-board.js'), 'utf8');

let passed = 0;
let failed = 0;
function ok(label, cond, hint) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (hint ? '\n      ' + hint : '')); }
}
function section(t) { console.log('\n' + t); }

function lift(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) return null;
  let depth = 0;
  let i = src.indexOf('{', start);
  if (i === -1) return null;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return i < src.length ? src.slice(start, i + 1) : null;
}

section('extraction — the real init() and its poll');

const initFn = lift(SRC, 'function init()');
const stopFn = lift(SRC, 'function _stopAwaitingUser()');
ok('init() lifted', !!initFn && initFn.includes('waitForUser'));
ok('_stopAwaitingUser() lifted', !!stopFn);
ok('init() is declared exactly once', SRC.split('function init()').length === 2);
if (!initFn || !stopFn) {
  console.log('\n' + passed + ' passed, ' + (failed + 1) + ' failed\nFATAL: extraction failed');
  process.exit(1);
}

// Compose init() + the helper into a closure with every collaborator faked, so
// we can observe exactly which calls the poll makes.
function makeRig({ uidAfterTicks, tab }) {
  const calls = { render: 0, hydrate: 0, loadDealRooms: 0, dealRoomsForUser: 0 };
  let ticks = 0;
  const timers = [];
  const factory = new Function(
    'hooks',
    `
    let currentTab = hooks.tab;
    let _awaitingUser = false;
    let _awaitTimer = null;
    const _currentUid = hooks._currentUid;
    const render = hooks.render;
    const hydrateFromFirestore = hooks.hydrateFromFirestore;
    const loadDealRooms = hooks.loadDealRooms;
    const _dealRoomsForCurrentUser = hooks._dealRoomsForCurrentUser;
    const setTimeout = hooks.setTimeout;
    const clearTimeout = hooks.clearTimeout;
    ${stopFn}
    ${initFn}
    return { init: init, setTab: (t) => { currentTab = t; } };
    `
  );
  const api = factory({
    tab,
    _currentUid: () => (ticks >= uidAfterTicks ? 'uid-A' : null),
    render: () => { calls.render++; },
    hydrateFromFirestore: () => { calls.hydrate++; },
    loadDealRooms: () => { calls.loadDealRooms++; },
    _dealRoomsForCurrentUser: () => { calls.dealRoomsForUser++; },
    setTimeout: (fn) => { const id = timers.length + 1; timers.push({ id, fn, live: true }); return id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.live = false; },
  });
  return {
    ...api,
    calls,
    tick() { ticks++; const due = timers.filter((t) => t.live); timers.length = 0; due.forEach((t) => t.fn()); },
    liveTimers: () => timers.filter((t) => t.live).length,
  };
}

section('the poll does not repaint over a half-typed New Deal form');

{
  // Rep is on the create tab, auth arrives on the 2nd poll tick.
  const rig = makeRig({ uidAfterTicks: 2, tab: 'create' });
  rig.init();
  const afterInit = rig.calls.render;
  rig.tick();
  rig.tick();
  ok('auth resolved and the account rooms were loaded', rig.calls.dealRoomsForUser === 1);
  ok('THE FIX: the poll did NOT render over the create form',
    rig.calls.render === afterInit,
    `render() was called ${rig.calls.render - afterInit} extra time(s) — every typed field is blanked`);
  ok('...but it still hydrated, so server state is not skipped', rig.calls.hydrate === 1);
}

{
  // Same race, rep NOT on the create tab — the repaint is wanted here.
  const rig = makeRig({ uidAfterTicks: 2, tab: 'active' });
  rig.init();
  const afterInit = rig.calls.render;
  rig.tick();
  rig.tick();
  ok('on the active tab the poll DOES repaint (the guard is not a blanket skip)',
    rig.calls.render === afterInit + 1);
  ok('...and hydrates', rig.calls.hydrate === 1);
}

section('a re-entrant init() does not leave a second poll chain running');

{
  const rig = makeRig({ uidAfterTicks: 3, tab: 'active' });
  rig.init();                       // no user yet -> starts the chain
  ok('a poll timer is armed', rig.liveTimers() === 1);
  rig.tick();                       // still no user -> re-arms
  ok('...still exactly one', rig.liveTimers() === 1,
    'two live chains would double every hydrate from here on');
}

{
  // init() re-entered AFTER the user appears, while the chain is alive.
  const rig = makeRig({ uidAfterTicks: 1, tab: 'active' });
  rig.init();                       // no user -> chain armed
  rig.tick();                       // ticks=1: user appears, poll completes
  const hydratesAfterPoll = rig.calls.hydrate;
  rig.init();                       // re-entry with a user -> fast path
  ok('re-entry hydrates once more (expected — it is a fresh navigation)',
    rig.calls.hydrate === hydratesAfterPoll + 1);
  ok('THE FIX: no stale poll chain survives the re-entry',
    rig.liveTimers() === 0,
    'a live chain here fires a duplicate hydrate on its next tick');
}

section('the guard matches the one hydrateFromFirestore already used');

ok('hydrateFromFirestore still guards its own repaint',
  /if \(currentTab !== 'create'\) render\(\);/.test(SRC));
ok('the guard now appears at least twice (hydrate + the poll)',
  (SRC.match(/if \(currentTab !== 'create'\) render\(\);/g) || []).length >= 2,
  'if this drops to 1 the poll lost its guard again');

console.log('\n' + '─'.repeat(30));
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);

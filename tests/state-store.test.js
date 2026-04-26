/**
 * state-store.test.js — direct unit tests for NBDStore.
 *
 * Loads docs/pro/js/state-store.js into a Node sandbox with a fake
 * `window` shim, then exercises the public API. The smoke suite
 * already grep-asserts the public surface; this file proves the
 * runtime semantics:
 *
 *   - get/set round-trip (including dotted paths)
 *   - subscribe fires on change, NOT on no-op write
 *   - identity-equality short-circuit (mutating-in-place is a no-op)
 *   - bind() mirrors window globals one-way (store → window)
 *   - subscriber throw doesn't break sibling subscribers
 *   - reset() re-emits to all subscribed paths
 *
 * Run via: node tests/state-store.test.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const STORE_PATH = path.join(__dirname, '..', 'docs', 'pro', 'js', 'state-store.js');
const src = fs.readFileSync(STORE_PATH, 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.log('  ✗ ' + name + ' — ' + (e && e.message || e));
    failed++;
  }
}
function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label || 'eq') + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}
function ok(cond, label) {
  if (!cond) throw new Error('expected truthy: ' + (label || ''));
}

function loadStore() {
  // Fresh window shim per test so tests don't leak state.
  const ctx = { window: {}, console, module: { exports: {} } };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { NBDStore: ctx.window.NBDStore, win: ctx.window };
}

console.log('\nNBDStore — pub/sub state store');

test('get returns the seeded value', () => {
  const { NBDStore } = loadStore();
  const s = NBDStore.create({ count: 7 });
  eq(s.get('count'), 7);
});

test('set updates the slice and notifies subscribers', () => {
  const { NBDStore } = loadStore();
  const s = NBDStore.create({ count: 0 });
  let calls = 0;
  let lastVal = null;
  s.subscribe('count', (v) => { calls++; lastVal = v; });
  s.set('count', 1);
  eq(calls, 1, 'subscriber called once');
  eq(lastVal, 1, 'subscriber received new value');
});

test('set is a no-op when value is identical (===)', () => {
  const { NBDStore } = loadStore();
  const s = NBDStore.create({ count: 5 });
  let calls = 0;
  s.subscribe('count', () => { calls++; });
  const changed = s.set('count', 5);
  eq(changed, false, 'set returns false on no-op');
  eq(calls, 0, 'subscriber must NOT fire on no-op');
});

test('mutate-in-place skips notify (callers must swap refs)', () => {
  const { NBDStore } = loadStore();
  const set = new Set([1, 2]);
  const s = NBDStore.create({ tags: set });
  let calls = 0;
  s.subscribe('tags', () => { calls++; });
  set.add(3);                 // mutate the existing reference
  s.set('tags', set);         // same identity → no-op
  eq(calls, 0, 'identity-equal write must not fire subscribers');
  // Swapping the ref fires correctly:
  s.set('tags', new Set(set));
  eq(calls, 1, 'fresh ref triggers subscriber');
});

test('dotted paths read and write nested slices', () => {
  const { NBDStore } = loadStore();
  const s = NBDStore.create({ photos: { selected: new Set() } });
  let calls = 0;
  s.subscribe('photos.selected', () => { calls++; });
  s.set('photos.selected', new Set(['a']));
  eq(calls, 1);
  eq(s.get('photos.selected').size, 1);
});

test('subscribe returns an unsubscribe function', () => {
  const { NBDStore } = loadStore();
  const s = NBDStore.create({ x: 0 });
  let calls = 0;
  const off = s.subscribe('x', () => { calls++; });
  s.set('x', 1);
  off();
  s.set('x', 2);
  eq(calls, 1, 'subscriber should not fire after unsubscribe');
});

test('one subscriber throwing does not break siblings', () => {
  const { NBDStore } = loadStore();
  const s = NBDStore.create({ x: 0 });
  let goodCalls = 0;
  s.subscribe('x', () => { throw new Error('boom'); });
  s.subscribe('x', () => { goodCalls++; });
  // Hide the noisy console.error from the good test output.
  const origErr = console.error;
  console.error = () => {};
  try { s.set('x', 1); } finally { console.error = origErr; }
  eq(goodCalls, 1, 'second subscriber still fired');
});

test('bind mirrors store value onto window[globalName] one-way', () => {
  const { NBDStore, win } = loadStore();
  NBDStore.set('photos.selected', new Set(['x']));
  NBDStore.bind('_photoSelected', 'photos.selected');
  // Bind seeds window with the current value.
  ok(win._photoSelected instanceof Set, '_photoSelected was seeded');
  eq(win._photoSelected.size, 1);
  // Future store.set updates window mirror.
  NBDStore.set('photos.selected', new Set(['x', 'y']));
  eq(win._photoSelected.size, 2);
  // Direct window write does NOT propagate back into the store.
  win._photoSelected = new Set(['z']);
  eq(NBDStore.get('photos.selected').size, 2, 'store unchanged by direct window write');
});

test('reset re-emits to every subscribed path', () => {
  const { NBDStore } = loadStore();
  const s = NBDStore.create({ a: 1, b: 2 });
  let aCalls = 0, bCalls = 0;
  s.subscribe('a', () => { aCalls++; });
  s.subscribe('b', () => { bCalls++; });
  s.reset({ a: 10, b: 20 });
  eq(aCalls, 1);
  eq(bCalls, 1);
  eq(s.get('a'), 10);
  eq(s.get('b'), 20);
});

test('singleton create + module-level get share the same store', () => {
  const { NBDStore } = loadStore();
  NBDStore.set('x', 1);
  eq(NBDStore.get('x'), 1, 'module-level set/get hits the singleton');
  eq(NBDStore._singleton.get('x'), 1, '_singleton exposes the same store');
});

console.log('\n─'.repeat(50));
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

/**
 * photo-offline-queue.test.js — "Photo queued (offline)" used to be a lie.
 *
 * photo-engine.js pushed every failed upload into state.uploadQueue and
 * toasted "Photo queued (offline) — will upload when connected". That push
 * was the ONLY reference to state.uploadQueue in the entire repo: never
 * drained, never retried, never persisted. Every one of those photos was
 * discarded when the tab went away, and the rep was told the opposite — on a
 * roof, in bad signal, which is precisely when it mattered.
 *
 * Two things are locked here:
 *   1. the queue is actually drained (on `online`, and after the next
 *      successful upload — better evidence than an event that may never fire
 *      on a flaky connection that never fully dropped), and failures are
 *      left queued rather than dropped;
 *   2. the message matches what the code can actually back.
 *
 * ── 2026-09-06: the promise got STRONGER, and that is the point ─────────
 * This suite used to assert the toast did NOT say "will upload when
 * connected", because the queue was memory-only and dashboard-sw-bootstrap
 * reloads the page on every bfcache resume — exactly when a rep backgrounds
 * the app — so the photo did not survive leaving the page. The honest copy
 * was "Keep this page open."
 *
 * The queue is now persisted in IndexedDB (docs/pro/js/photo-queue-store.js,
 * proven to survive a reload by tests/photo-queue-durability.test.js) and
 * drained on boot by photo-queue-recovery.js. So the strong promise is now
 * TRUE and the copy says so. The assertion below is not deleted — it is
 * inverted and tied to the persistence that earns it: the durable wording is
 * only allowed to appear alongside a real call into the durable store, so
 * this can never drift back into a claim the code does not implement.
 *
 * The weak "Keep this page open" copy still has to exist, because it is what
 * a rep gets when IndexedDB is genuinely unavailable (private mode, disabled
 * storage). Both branches are asserted.
 *
 * The dataURL→Blob converter is extracted and exercised for real, because a
 * silent failure there would drop the photo just as effectively as the
 * original bug.
 *
 * Run: node tests/photo-offline-queue.test.js   (no deps, no DOM)
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
const src = fs.readFileSync(path.join(ROOT, 'docs/pro/js/photo-engine.js'), 'utf8');

console.log('\nphoto-offline-queue — the queue is real now\n');

// ── the drain exists and is wired ───────────────────────────────────────
ok('flushUploadQueue is defined', /async function flushUploadQueue\(\)/.test(src));

ok('it is triggered by the `online` event',
  /addEventListener\('online',\s*function \(\) \{ flushUploadQueue\(\); \}\)/.test(src));

ok('the online listener is bound once', /__nbdPhotoQueueBound/.test(src),
  'a second binding would double-upload every queued photo');

ok('it also drains after a successful upload',
  /showToast\(`Photo \$\{state\.sessionPhotoCount\} saved`[\s\S]{0,400}?flushUploadQueue\(\)/.test(src),
  'an `online` event may never fire on a connection that never fully dropped');

ok('the drain is re-entrancy guarded', /_draining\s*=\s*true/.test(src) && /if \(_draining\) return/.test(src));

// A failing item must stay queued. The drain no longer splices the batch out
// up front — items leave storage one at a time, and only after a confirmed
// upload — so the old `state.uploadQueue.push(item)` re-queue is gone by
// design. What replaced it is stricter: nothing is removed before it succeeds.
ok('an item is removed ONLY after a confirmed upload',
  /await uploadPhotoToFirebase\([^)]*\);\s*\n\s*await _dropItem\(item\);/.test(src),
  'dropping before the await would lose the photo on a mid-drain failure');

ok('the drain does NOT splice the whole queue out up front',
  !/splice\(0,\s*state\.uploadQueue\.length\)/.test(src),
  'that pattern destroyed every not-yet-attempted item when one upload threw');

ok('the drain stops on the first failure instead of spinning',
  /catch \(e\) \{[\s\S]{0,300}?\n\s*break;/.test(src));

ok('an unrecoverable item is dropped rather than retried forever',
  /if \(!blob \|\| !item\.leadId\) \{ await _dropItem\(item\); continue; \}/.test(src),
  'a photo that cannot be decoded would otherwise block the queue behind it');

ok('the queue is exposed on the public API', /\bflushUploadQueue,/.test(src) && /queuedPhotoCount:/.test(src));

// ── the message is honest ───────────────────────────────────────────────
// The durable promise is now allowed — because it is now implemented. Both
// halves are asserted together so the copy cannot outrun the code again.
// photo-engine.js writes the apostrophe escaped inside a single-quoted
// string literal (you\'re), so the backslash is optional here.
const DURABLE_COPY = /it will upload when you\\?'re back online, even if you close the app/;

ok('the toast makes the durable promise', DURABLE_COPY.test(src),
  'the queue persists now — under-promising would be its own kind of dishonest');

ok('...and that promise is backed by a real write to the durable store',
  /await store\.add\(item\)/.test(src) && /window\.NBDPhotoQueueStore/.test(src),
  'the strong copy is only earned by actually persisting the photo');

ok('...and it is only shown when the write SUCCEEDED',
  /if \(outcome\.durable\) \{[\s\S]{0,300}?even if you close the app/.test(src),
  'showing it unconditionally would reinstate the original lie');

ok('the memory-only fallback still under-promises',
  /Keep this page open/.test(src),
  'when IndexedDB is unavailable the photo really does die with the page');

ok('...and that fallback is the non-durable branch',
  /outcome\.queued\) \{[\s\S]{0,800}?Keep this page open/.test(src));

ok('a refused photo is not reported as held',
  /outcome\.message/.test(src) && /saveBtn\.disabled = false/.test(src),
  'a full queue must stop the rep, not silently discard the shot');

// ── the converter actually works ────────────────────────────────────────
const at = src.indexOf('function _dataUrlToBlob(');
ok('_dataUrlToBlob is present', at >= 0);
if (at >= 0) {
  const open = src.indexOf('{', at);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const sandbox = { atob, Uint8Array, Blob, console };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(at, end) + '\nthis.__f = _dataUrlToBlob;', sandbox);
  const f = sandbox.__f;

  // A 1x1 PNG, as a data URL — the shape the queue actually stores.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const blob = f(PNG);
  ok('converts a data URL to a Blob', blob && typeof blob.size === 'number' && blob.size > 0,
    'size=' + (blob && blob.size));
  ok('preserves the MIME type', blob && blob.type === 'image/png', blob && blob.type);
  ok('byte length matches the decoded base64',
    blob && blob.size === Buffer.from(PNG.split(',')[1], 'base64').length,
    (blob && blob.size) + ' vs ' + Buffer.from(PNG.split(',')[1], 'base64').length);

  ok('a JPEG data URL keeps its type',
    f('data:image/jpeg;base64,/9j/4AAQSkZJRg==').type === 'image/jpeg');

  ok('malformed input returns null instead of throwing',
    f('') === null && f(null) === null && f('not-a-data-url') === null);
}

// ── BEHAVIOURAL: the drain must not destroy the items it did not attempt ──
//
// Ported from #1417 and re-targeted at the store-backed drain. Every assertion
// above this block is a regex over the source, and that is exactly why the
// original bug shipped: `state.uploadQueue.push(item)` and `break` both matched
// while the code destroyed photos. So run the function. The property is now
// stronger than #1417's: an item leaves the STORE only after its upload
// resolved, so a mid-drain failure leaves the failing photo and everything
// behind it in storage — not merely back on an array. The memory-only
// fallback (no IndexedDB) is exercised too, because #1417's property still has
// to hold there.
function extractFn(name) {
  const at = src.indexOf(name);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return null;
}

const flushSrc = extractFn('async function flushUploadQueue(');
const blobSrc = extractFn('function _dataUrlToBlob(');
const storeSrc = extractFn('function _store(');
const pendingSrc = extractFn('async function _pendingItems(');
const dropSrc = extractFn('async function _dropItem(');
ok('the drain and its helpers are extractable for a real run',
  !!(flushSrc && blobSrc && storeSrc && pendingSrc && dropSrc));

if (flushSrc && blobSrc && storeSrc && pendingSrc && dropSrc) {
  // The smallest NBDPhotoQueueStore the drain can be run against.
  function fakeStore(rows) {
    const map = new Map();
    let next = 1;
    for (const r of rows) { map.set(next, Object.assign({ id: next }, r)); next++; }
    return {
      map,
      available: async () => true,
      all: async () => [...map.values()].sort((a, b) => a.id - b.id).map((r) => Object.assign({}, r)),
      remove: async (id) => { map.delete(id); return true; },
      count: async () => map.size,
      leftIds: () => [...map.keys()].sort((a, b) => a - b).join(',')
    };
  }
  const jpeg = () => new Blob([new Uint8Array(16)], { type: 'image/jpeg' });
  const row = (n, over) => Object.assign(
    { blob: jpeg(), leadId: 'lead-' + n, tags: [], description: '', location: '' }, over || {});
  const PNG1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const memItem = (n, dataUrl) => ({ dataUrl: dataUrl || PNG1x1, leadId: 'lead-' + n, tags: [], description: '', location: '' });

  function run(store, queue, uploader) {
    const sandbox = {
      atob, Uint8Array, Blob,
      console: { warn() {}, log() {}, error() {} },
      navigator: { onLine: true },
      _draining: false,
      state: { uploadQueue: queue },
      showToast: function () {},
      uploadPhotoToFirebase: uploader,
      window: store ? { NBDPhotoQueueStore: store } : {}
    };
    vm.createContext(sandbox);
    vm.runInContext([blobSrc, storeSrc, pendingSrc, dropSrc, flushSrc].join('\n')
      + '\nthis.__flush = flushUploadQueue;', sandbox);
    return { flush: () => sandbox.__flush(), sandbox };
  }

  const results = [];
  const done = (async () => {
    // 1. STORE-BACKED. Five in storage, the THIRD upload fails: 1 and 2 are
    //    sent and gone from storage; 3, 4, 5 must all still be IN STORAGE, in
    //    order, and 4 and 5 must never have been attempted.
    let n1 = 0;
    const s1 = fakeStore([row(1), row(2), row(3), row(4), row(5)]);
    const sent1 = await run(s1, [], async () => { n1++; if (n1 === 3) throw new Error('offline again'); }).flush();
    results.push(['store: two upload before the failure', sent1 === 2, 'sent=' + sent1]);
    results.push(['store: the failing photo AND the untried remainder stay in storage, in order',
      s1.leftIds() === '3,4,5', 'left=' + s1.leftIds()]);
    results.push(['store: the two that uploaded were removed from storage',
      !s1.map.has(1) && !s1.map.has(2)]);
    results.push(['store: nothing behind the failure was attempted', n1 === 3, 'uploader calls=' + n1]);

    // 2. STORE-BACKED. An unrecoverable row (no bytes) is dropped and does NOT
    //    block the healthy photo behind it.
    let n2 = 0;
    const s2 = fakeStore([row(1, { blob: null }), row(2)]);
    const sent2 = await run(s2, [], async () => { n2++; }).flush();
    results.push(['store: an unrecoverable photo is dropped and does not block the queue',
      s2.leftIds() === '', 'left=' + s2.leftIds()]);
    results.push(['store: the healthy photo behind it still uploads', sent2 === 1 && n2 === 1,
      'sent=' + sent2 + ' calls=' + n2]);

    // 3. STORE-BACKED. A total outage leaves storage exactly as it was.
    const s3 = fakeStore([row(1), row(2)]);
    const sent3 = await run(s3, [], async () => { throw new Error('offline'); }).flush();
    results.push(['store: a total outage loses nothing', s3.leftIds() === '1,2' && sent3 === 0,
      'left=' + s3.leftIds() + ' sent=' + sent3]);

    // 4. STORE-BACKED. Two drains at once: the re-entrancy guard makes the
    //    second a no-op, so no photo is uploaded twice.
    const s4 = fakeStore([row(1), row(2), row(3)]);
    const seen = [];
    const r4 = run(s4, [], async (_b, leadId) => { seen.push(leadId); await new Promise((r) => setTimeout(r, 1)); });
    const [a4, b4] = await Promise.all([r4.flush(), r4.flush()]);
    results.push(['store: a concurrent second drain is a no-op — no double upload',
      seen.length === 3 && new Set(seen).size === 3 && a4 + b4 === 3,
      'uploads=' + seen.join(',') + ' returns=' + a4 + '/' + b4]);

    // 5. MEMORY FALLBACK (no IndexedDB). #1417's original property must still
    //    hold on the array: the failing item and the remainder survive in order.
    let n5 = 0;
    const r5 = run(null, [memItem(1), memItem(2), memItem(3), memItem(4), memItem(5)],
      async () => { n5++; if (n5 === 3) throw new Error('offline again'); });
    const sent5 = await r5.flush();
    const left5 = r5.sandbox.state.uploadQueue.map((i) => i.leadId).join(',');
    results.push(['memory: two upload before the failure', sent5 === 2, 'sent=' + sent5]);
    results.push(['memory: the failing item AND the untried remainder survive, in order',
      left5 === 'lead-3,lead-4,lead-5', left5]);

    // 6. MEMORY FALLBACK. A truncated base64 makes atob throw; that must be
    //    caught outside the retry path so the item is dropped, not re-queued
    //    to head every future drain forever.
    const r6 = run(null, [memItem(1, 'data:image/png;base64,!!!not-base64!!!'), memItem(2)], async () => {});
    const sent6 = await r6.flush();
    results.push(['memory: an undecodable photo does not block the queue',
      r6.sandbox.state.uploadQueue.length === 0 && sent6 === 1,
      'left=' + r6.sandbox.state.uploadQueue.length + ' sent=' + sent6]);
  })();

  const wait = require('timers/promises').setTimeout;
  // The file is sync-tailed; drain the microtask/IO queue before scoring.
  const sync = (async () => { await done; await wait(0); })();
  sync.then(() => {
    for (const [name, cond, extra] of results) ok(name, cond, extra);
    console.log(`\n  ${passed} passed, ${failed} failed`);
    if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
    process.exit(0);
  }).catch((e) => { console.log('  ✗ behavioural drain harness threw: ' + e.message); process.exit(1); });
  return;
}

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
process.exit(0);

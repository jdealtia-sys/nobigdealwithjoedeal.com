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

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
process.exit(0);

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
 *      re-queued rather than dropped;
 *   2. the message no longer promises what the code cannot do. The queue is
 *      memory-only, and dashboard-sw-bootstrap reloads the page on every
 *      bfcache resume — exactly when a rep backgrounds the app — so a queued
 *      photo does NOT survive leaving the page. Persisting it is the real fix
 *      and a larger one; until then the toast must not claim otherwise.
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

ok('a failed item is put BACK on the queue',
  /catch \(e\) \{\s*state\.uploadQueue\.push\(item\);/.test(src),
  'dropping it would reproduce the original bug with extra steps');

ok('the drain stops on the first failure instead of spinning',
  /state\.uploadQueue\.push\(item\);\s*\n\s*break;/.test(src));

ok('an unrecoverable item is dropped rather than retried forever',
  /if \(!blob \|\| !item\.leadId\) continue;/.test(src));

ok('the queue is exposed on the public API', /\bflushUploadQueue,/.test(src) && /queuedPhotoCount:/.test(src));

// ── the message is honest ───────────────────────────────────────────────
ok('the toast no longer claims "will upload when connected"',
  !/will upload when connected/.test(src),
  'nothing implemented that promise; it must not be made again without persistence');

ok('the toast tells the rep what keeps the photo',
  /Keep this page open/.test(src),
  'the queue is memory-only — say so rather than implying durability');

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

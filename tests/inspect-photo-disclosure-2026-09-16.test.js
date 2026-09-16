/**
 * tests/inspect-photo-disclosure-2026-09-16.test.js
 *
 * docs/inspect.html's photo input (docs/assets/js/inspect-form.js's
 * gatherFormData) never actually sends the chosen files — only their count
 * and filenames as text fields (`if (k === 'photos') return; // files
 * handled separately`), and public-lead-submit.js has no separate upload
 * path either. A homeowner who attached photos and saw the success message
 * had no way to know Joe never received them — the message said nothing
 * about photos at all, so "Got it — thanks!" reads as if everything they
 * submitted, including the pictures, went through.
 *
 * Fix: a disclosure line in the success panel, shown ONLY when the
 * homeowner actually attached at least one photo, telling them to text the
 * photos separately. Gated on photoCount so a submission with zero photos
 * (the common case) never shows an irrelevant note.
 *
 * Zero deps. Run: node tests/inspect-photo-disclosure-2026-09-16.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

console.log('inspect.html — photo-not-actually-sent disclosure\n');

const HTML = read('docs/inspect.html');
const JS = read('docs/assets/js/inspect-form.js');

group('the confirmed bug still holds: photos are never actually transmitted', () => {
  const decommented = JS.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ok('gatherFormData explicitly drops the photos field from the payload',
    /if \(k === 'photos'\) return;/.test(decommented));
  ok('only photoCount/photoNames (text) are sent, never file bytes',
    /out\.photoCount = String\(photoFiles\)/.test(decommented) && /out\.photoNames = /.test(decommented));
  const PUBLIC_SUBMIT = read('docs/assets/js/public-lead-submit.js');
  ok('public-lead-submit.js has no separate photo upload path (Storage, FormData with files, etc.)',
    !/photo/i.test(PUBLIC_SUBMIT) && !/Storage/i.test(PUBLIC_SUBMIT));
});

function group(name, fn) { console.log('\n' + name); fn(); }

group('markup: the disclosure exists, starts hidden, mentions the contact number already on the page', () => {
  ok('#inspectPhotoNote exists inside #inspectSuccess',
    /id="inspectSuccess"[\s\S]{0,400}id="inspectPhotoNote"/.test(HTML));
  ok('starts hidden — must not show for the common no-photo submission', /id="inspectPhotoNote"[^>]*\bhidden\b/.test(HTML));
  ok('tells the homeowner photos were not sent (not vague marketing copy)',
    /id="inspectPhotoNote"[^>]*>[^<]*doesn(?:&rsquo;|')t send photo attachments/i.test(HTML));
  ok('points to the SAME phone number already used elsewhere on this page for direct contact',
    /id="inspectPhotoNote"[\s\S]{0,200}\(859\) 420-7382/.test(HTML));
});

group('logic: showSuccess() only reveals the note when photos were actually attached', () => {
  const start = JS.indexOf('function showSuccess(');
  ok('showSuccess is present', start >= 0);
  const bodyStart = JS.indexOf('{', start);
  let depth = 0, i = bodyStart;
  for (; i < JS.length; i++) { if (JS[i] === '{') depth++; else if (JS[i] === '}') { depth--; if (depth === 0) break; } }
  const fnSrc = JS.slice(start, i + 1);

  const made = (id) => ({ hidden: undefined, style: {}, classList: { add() {} }, scrollIntoView() {}, id });
  function run(photoCount) {
    const els = { inspectForm: made('inspectForm'), inspectSuccess: made('inspectSuccess'), inspectPhotoNote: made('inspectPhotoNote') };
    const ctx = { document: { getElementById: (id) => els[id] || null }, Number };
    vm.createContext(ctx);
    vm.runInContext(fnSrc + '\nthis.__showSuccess = showSuccess;', ctx);
    ctx.__showSuccess(photoCount);
    return els.inspectPhotoNote.hidden;
  }

  ok('photoCount "0" (no photos attached) -> note stays hidden', run('0') === true);
  ok('photoCount undefined (defensive) -> note stays hidden', run(undefined) === true);
  ok('photoCount "1" -> note is revealed', run('1') === false);
  ok('photoCount "3" -> note is revealed', run('3') === false);
});

group('wiring: showSuccess is actually called WITH the submission\'s photoCount, not bare', () => {
  const decommented = JS.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ok('the success callback passes data.photoCount through', /showSuccess\(data\.photoCount\)/.test(decommented));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }

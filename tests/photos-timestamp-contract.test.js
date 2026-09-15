/**
 * photos-timestamp-contract.test.js — guards the canonical /photos timestamp
 *
 * Proves the field-coverage contract that keeps chronological photo views
 * complete:
 *   1. EVERY /photos create path stamps `createdAt` (serverTimestamp).
 *   2. Both ordering queries (Recent feed + per-lead gallery) orderBy
 *      `createdAt` — and no longer orderBy the partial fields uploadedAt /
 *      capturedAt that only one writer set.
 *   3. firestore.indexes.json carries the composite indexes those two
 *      queries need.
 *   4. The photo report's comparator survives the docs that DON'T have a
 *      createdAt yet — asserted by sorting, not by grepping.
 *
 * Dependency-free — runs with: node tests/photos-timestamp-contract.test.js
 *
 * Why this exists:
 *   /photos was written by paths that set DIFFERENT timestamp fields
 *   (createdAt vs uploadedAt vs capturedAt vs none). The Recent feed ordered
 *   by uploadedAt and the gallery by capturedAt, so quick-upload and
 *   annotation photos — which lacked those fields — were SILENTLY excluded
 *   (Firestore orderBy drops docs missing the field). We standardized on
 *   `createdAt`. This test is the guard so a new write path or a re-pointed
 *   orderBy can't quietly reopen the gap. Static CI can't catch a missing
 *   write-field or a missing index any other way.
 *
 * 2026-09-08 — §1 said "EVERY create path" and enumerated four, but /photos
 *   has SIX. The two it never named were the two still missing the field:
 *   the customer page's uploadSinglePhoto (date + uploadedAt) and the portal's
 *   uploadHomeownerPhoto (uploadedAt). Both are stamped now and both are
 *   asserted below; the count in this header is load-bearing, so if you add a
 *   seventh writer, add a case for it here.
 *
 *   That gap is also why §4 exists. A missing write-field is not only an
 *   ordering nuisance — for these two paths it meant the photo never appeared
 *   in the rep's gallery or Recent feed at all. Fixing the writers does
 *   nothing for the docs already in Firestore (scripts/backfill-photos-
 *   createdAt.js is the remedy — check its run-once marker first, since a
 *   catch-up pass over a recorded run needs --force), so the comparator has to
 *   cope with the shapes actually present rather than assume the canonical one.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Strip comments before matching. This repo quotes the defect verbatim when it
// explains a fix — the comments added alongside these writers name `createdAt`
// and `orderBy('createdAt')` repeatedly — so a regex over raw source can be
// satisfied by the prose describing the bug rather than by the code.
//
// Deliberately applied to a SLICE, never to a whole file. Both orderings of
// the naive whole-file version run away on this repo's sources:
//   • block-comments-then-lines: `// … 'image/*' …` at
//     customer-bootstrap.module.js:2336 opens a match that runs 46k chars to
//     the next `*/` and swallows the photoDoc literal this file asserts on.
//   • lines-then-block-comments: filtering `*`-prefixed lines removes each
//     JSDoc's closing `*/` and leaves its `/**` to run away instead.
// Sliced first, the region is small enough to be checked by eye.
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

// Lift a contiguous run of functions out of a browser IIFE and execute it.
// Asserting on behaviour is the whole point: a regex like /createdAt/ matches
// the comparator that had the bug just as happily as the one that doesn't.
function endOfFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('function ' + name + ' not found');
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces reading ' + name);
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✘ ' + name); console.error('    ' + (e.stack || e.message)); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('');
console.log('photos-timestamp-contract.test.js');

// ── 1. write paths all stamp createdAt ──────────────────────────────────

test('photo-engine.js upload stamps createdAt: serverTimestamp()', () => {
  const src = read('docs/pro/js/photo-engine.js');
  assert(/createdAt:\s*serverTimestamp\(\)/.test(src),
    'photo-engine photoData must include createdAt: serverTimestamp()');
});

test('dashboard-bootstrap _uploadPhoto stamps createdAt', () => {
  const src = read('docs/pro/js/dashboard-bootstrap.module.js');
  // The quick-upload addDoc to /photos.
  assert(/collection\(db,\s*['"]photos['"]\)[^;]*createdAt:\s*serverTimestamp\(\)/.test(src),
    '_uploadPhoto addDoc(photos, ...) must include createdAt: serverTimestamp()');
});

test('photo-editor.js annotated-copy create stamps createdAt', () => {
  const src = read('docs/pro/js/photo-editor.js');
  assert(/addDoc\(\s*window\.collection\(window\.db,\s*['"]photos['"]\)[^;]*createdAt:\s*window\.serverTimestamp\(\)/.test(src),
    'photo-editor addDoc(photos, ...) create must include createdAt: window.serverTimestamp()');
});

test('repos.js stampCreate stamps createdAt (covers photos.create)', () => {
  const src = read('docs/pro/js/repos.js');
  assert(/function stampCreate[\s\S]*?createdAt:\s*st/.test(src),
    'repos.stampCreate must set createdAt');
});

test('customer-bootstrap uploadSinglePhoto stamps createdAt', () => {
  // The photoDoc literal only, read from `const photoDoc = {` to the addDoc
  // that writes it — narrow enough that a createdAt elsewhere in this
  // 3000-line module (leads, estimates and notes all have one) cannot satisfy
  // the assertion.
  const src = read('docs/pro/js/customer-bootstrap.module.js');
  const from = src.indexOf('const photoDoc = {');
  assert(from !== -1, 'uploadSinglePhoto photoDoc literal not found — did it get renamed?');
  const to = src.indexOf('addDoc(window.collection(window.db, \'photos\')', from);
  assert(to !== -1, 'addDoc(photos) not found after the photoDoc literal');
  const block = stripComments(src.slice(from, to));
  assert(/createdAt:\s*window\.serverTimestamp\(\)/.test(block),
    'photoDoc must include createdAt: window.serverTimestamp() — without it the '
    + 'photo is dropped outright by every orderBy(createdAt) reader');
});

test('portal.js uploadHomeownerPhoto stamps createdAt', () => {
  const src = read('functions/portal.js');
  const from = src.indexOf('db.collection(\'photos\').add({');
  assert(from !== -1, 'uploadHomeownerPhoto photo add() not found');
  const block = stripComments(src.slice(from, from + 1200));
  assert(/createdAt:\s*FieldValue\.serverTimestamp\(\)/.test(block),
    'homeowner upload must include createdAt: FieldValue.serverTimestamp()');
});

// ── 2. ordering queries use the canonical field ─────────────────────────

test('Recent feed orders by createdAt (not uploadedAt)', () => {
  const src = read('docs/pro/js/dashboard-widgets.js');
  assert(/orderBy\(\s*['"]createdAt['"]\s*,\s*['"]desc['"]\s*\)/.test(src),
    'renderRecentPhotoFeed must orderBy(createdAt, desc)');
  assert(!/orderBy\(\s*['"]uploadedAt['"]/.test(src),
    'recent feed must no longer orderBy(uploadedAt) — legacy partial field');
});

test('per-lead gallery orders by createdAt (not capturedAt)', () => {
  const src = read('docs/pro/js/photo-engine.js');
  assert(/orderBy\(\s*['"]createdAt['"]\s*,\s*['"]desc['"]\s*\)/.test(src),
    'getPhotosForLead must orderBy(createdAt, desc)');
  assert(!/orderBy\(\s*['"]capturedAt['"]/.test(src),
    'gallery query must no longer orderBy(capturedAt) — photo-engine-only field');
});

// ── 3. composite indexes exist for both queries ─────────────────────────

test('firestore.indexes.json covers both photos createdAt queries', () => {
  const idx = JSON.parse(read('firestore.indexes.json'));
  const photos = (idx.indexes || []).filter(i => i.collectionGroup === 'photos');
  const sig = i => i.fields.map(f => f.fieldPath + ':' + (f.order || f.arrayConfig || '')).join('|');
  const has = s => photos.some(i => sig(i) === s);

  assert(has('userId:ASCENDING|createdAt:DESCENDING'),
    'missing index photos [userId ASC, createdAt DESC] (Recent feed)');
  assert(has('leadId:ASCENDING|userId:ASCENDING|createdAt:DESCENDING'),
    'missing index photos [leadId ASC, userId ASC, createdAt DESC] (per-lead gallery)');
});

// ── 4. the report comparator, executed against the real shapes ──────────
//
// The writers above are fixed going forward, but Firestore is full of docs
// written before they were. These sort REAL arrays through the REAL
// comparator, lifted out of photo-report.js and run.

const SORT = (() => {
  const src = read('docs/pro/js/photo-report.js');
  const sandbox = {};
  vm.createContext(sandbox);
  // _comparePhotoReportOrder and _photoTimestampMs are adjacent; _dateLabel
  // lives ~1000 lines further down and is lifted separately into the same
  // context, where it resolves _photoTimestampMs from the first slice.
  const from = src.indexOf('function _comparePhotoReportOrder(');
  vm.runInContext(src.slice(from, endOfFn(src, '_photoTimestampMs')), sandbox);
  const dFrom = src.indexOf('function _dateLabel(');
  vm.runInContext(src.slice(dFrom, endOfFn(src, '_dateLabel')), sandbox);
  vm.runInContext('this.cmp = _comparePhotoReportOrder;'
    + ' this.ms = _photoTimestampMs; this.label = _dateLabel;', sandbox);
  return sandbox;
})();

// A Firestore Timestamp as the SDK hands it back live: toMillis(), no
// enumerable `seconds`. The old comparator read `.seconds` only and scored
// every one of these 0.
const liveTs = ms => ({ toMillis: () => ms });
// The same value after a JSON round-trip — plain {seconds}.
const jsonTs = ms => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 });

const T = { jan: Date.UTC(2026, 0, 10), feb: Date.UTC(2026, 1, 10), mar: Date.UTC(2026, 2, 10) };
const ids = arr => arr.slice().sort(SORT.cmp).map(p => p.id).join(',');

test('the rep drag order still wins over every timestamp', () => {
  const photos = [
    { id: 'c', order: 2, createdAt: jsonTs(T.jan) },
    { id: 'a', order: 0, createdAt: jsonTs(T.mar) },
    { id: 'b', order: 1, createdAt: jsonTs(T.feb) },
  ];
  assert(ids(photos) === 'a,b,c', 'ordered photos must sort by `order`, got ' + ids(photos));
});

test('an ordered photo still sorts ahead of an unordered one', () => {
  const photos = [{ id: 'loose', createdAt: jsonTs(T.jan) }, { id: 'dragged', order: 5 }];
  assert(ids(photos) === 'dragged,loose', 'got ' + ids(photos));
});

test('customer-page shape (date + uploadedAt, no createdAt) sorts chronologically', () => {
  // The exact doc uploadSinglePhoto used to write. Every one of these scored 0
  // before, so the array came back in whatever order Firestore returned.
  const photos = [
    { id: 'mar', date: jsonTs(T.mar), uploadedAt: jsonTs(T.mar) },
    { id: 'jan', date: jsonTs(T.jan), uploadedAt: jsonTs(T.jan) },
    { id: 'feb', date: jsonTs(T.feb), uploadedAt: jsonTs(T.feb) },
  ];
  assert(ids(photos) === 'jan,feb,mar', 'got ' + ids(photos));
});

test('portal homeowner shape (uploadedAt only) sorts chronologically', () => {
  const photos = [
    { id: 'later', uploadedAt: jsonTs(T.mar) },
    { id: 'earlier', uploadedAt: jsonTs(T.jan) },
  ];
  assert(ids(photos) === 'earlier,later', 'got ' + ids(photos));
});

test('a live Timestamp with toMillis() but no .seconds is not scored 0', () => {
  assert(SORT.ms({ createdAt: liveTs(T.feb) }) === T.feb,
    'toMillis() Timestamp must resolve to its millis');
  const photos = [{ id: 'b', createdAt: liveTs(T.mar) }, { id: 'a', createdAt: liveTs(T.jan) }];
  assert(ids(photos) === 'a,b', 'got ' + ids(photos));
});

test('mixed writers interleave by time rather than clustering by shape', () => {
  // One photo from each writer, deliberately shuffled. This is the case the
  // report actually hits, and the one the `.seconds`-only fallback could not
  // do at all: the three non-createdAt shapes all tied at 0.
  const photos = [
    { id: 'portal-mar', uploadedAt: jsonTs(T.mar) },
    { id: 'engine-jan', capturedAt: T.jan, createdAt: liveTs(T.jan) },
    { id: 'dash-feb', createdAt: jsonTs(T.feb) },
  ];
  assert(ids(photos) === 'engine-jan,dash-feb,portal-mar', 'got ' + ids(photos));
});

test('EXIF capture time outranks write time, so the caption and the position agree', () => {
  // A photo taken in January but uploaded in March sorts as January — which is
  // what _dateLabel has always PRINTED on it. When the comparator read
  // createdAt alone the two disagreed, and the PDF showed a frame captioned
  // "Jan 10, 2026" sitting after one captioned "Feb 10, 2026".
  const shot = { id: 'shot-jan', exif: { takenAt: T.jan }, createdAt: jsonTs(T.mar) };
  const other = { id: 'shot-feb', exif: { takenAt: T.feb }, createdAt: jsonTs(T.mar) };
  assert(ids([other, shot]) === 'shot-jan,shot-feb', 'got ' + ids([other, shot]));

  // The comparator and the caption must read the same field — one helper, so
  // this holds by construction, and this is the assertion that says so.
  [shot, other].forEach(p => {
    assert(SORT.label(p) === new Date(SORT.ms(p)).toLocaleDateString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric' }),
      'caption and sort key disagree for ' + p.id);
  });
});

test('a photo with no usable timestamp scores 0 instead of throwing', () => {
  assert(SORT.ms(null) === 0, 'null photo');
  assert(SORT.ms({}) === 0, 'no timestamp fields');
  assert(SORT.ms({ createdAt: 'not a date' }) === 0, 'unparseable string must not become NaN');
  assert(SORT.label({}) === '', 'no timestamp must print no date');
  // NaN would poison the comparator: every comparison returns false and the
  // sort silently leaves the array in input order.
  const photos = [{ id: 'b', createdAt: jsonTs(T.feb) }, { id: 'a' }, { id: 'c', createdAt: jsonTs(T.mar) }];
  assert(ids(photos) === 'a,b,c', 'undated sorts first, then chronological; got ' + ids(photos));
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);

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
 *
 * Dependency-free — runs with: node tests/photos-timestamp-contract.test.js
 *
 * Why this exists:
 *   /photos was written by 4 paths that set DIFFERENT timestamp fields
 *   (createdAt vs uploadedAt vs capturedAt vs none). The Recent feed ordered
 *   by uploadedAt and the gallery by capturedAt, so quick-upload and
 *   annotation photos — which lacked those fields — were SILENTLY excluded
 *   (Firestore orderBy drops docs missing the field). We standardized on
 *   `createdAt`. This test is the guard so a new write path or a re-pointed
 *   orderBy can't quietly reopen the gap. Static CI can't catch a missing
 *   write-field or a missing index any other way.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

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

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);

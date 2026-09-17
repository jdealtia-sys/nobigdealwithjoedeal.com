/**
 * tests/customer-photos-by-phase-team-scope-2026-09-16.test.js
 *
 * docs/pro/js/customer-tasks-ui.js's loadPhotosByPhase() (feeds #photosByPhase)
 * hard-scoped its Firestore query to where('leadId')+where('userId'==caller),
 * a THIRD hand-rolled copy of the exact query customer-bootstrap.module.js's
 * loadPhotos() (feeds #photoList) used to run before it was fixed to drop the
 * userId filter for team readers — company_admin/manager/viewer opening a
 * TEAMMATE's lead. photo-report.js was the second hand-rolled copy and was
 * fixed the same way (tests/photo-report-builder.test.js section 6). Without
 * this fix, a manager opening a rep's customer page saw the #photoList
 * gallery populated (team-scoped) while the #photosByPhase grid right next to
 * it — driven by phase, the section a rep actually works from day to day —
 * silently rendered "No photos yet", exactly the "duplicate dataset, only one
 * copy fixed" bug class this repo has hit before.
 *
 * Fix: loadPhotosByPhase's query spread window._photoQueryScopes(leadId) —
 * the SAME shared, exported helper customer-bootstrap.module.js already
 * built and photo-report.js already reuses — instead of a fourth inline copy.
 *
 * 2026-09-17 update: the larger "one shared fetch feeding both grids"
 * refactor this note originally said was its own, bigger effort landed —
 * loadPhotosByPhase's fetchFresh now calls the shared, in-flight-deduped
 * window._fetchPhotosRaw(leadId) instead of calling _photoQueryScopes
 * directly; _fetchPhotosRaw is what calls _photoQueryScopes now. The
 * team-scoping property this test exists to protect is unchanged — it's
 * just one level further down the call chain — so the assertions below
 * follow that chain instead of asserting a direct call.
 *
 * Zero deps. Run: node tests/customer-photos-by-phase-team-scope-2026-09-16.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

// Strip comments so prose describing the bug cannot satisfy — or trip — an
// assertion about the code (same guard as tests/photo-report-builder.test.js).
const decommentJs = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

const TASKS_UI = read('docs/pro/js/customer-tasks-ui.js');
const BOOT = read('docs/pro/js/customer-bootstrap.module.js');

console.log('customer-photos-by-phase — team-scope-aware query\n');

const fnStart = TASKS_UI.indexOf('window.loadPhotosByPhase = async function');
ok('loadPhotosByPhase is present', fnStart >= 0);
const fnSrc = fnStart >= 0 ? decommentJs(TASKS_UI.slice(fnStart, fnStart + 1200)) : '';

ok('the query goes through the shared fetch, which is itself team-scope-aware (see below)',
  /window\._fetchPhotosRaw\(leadId\)/.test(fnSrc), fnSrc);
ok('no more inline where(userId) hard-scope left alongside it (the pre-fix bug shape)',
  !/window\.where\('userId'/.test(fnSrc), fnSrc);
ok('the helper is actually exported for non-module scripts to reuse',
  /window\._photoQueryScopes\s*=\s*_photoQueryScopes/.test(decommentJs(BOOT)));

// Bridges the gap the assertion above deliberately doesn't check directly:
// loadPhotosByPhase -> window._fetchPhotosRaw -> _photoQueryScopes. If this
// call disappears from _fetchPhotosRaw, BOTH #photoList and #photosByPhase
// would silently lose team-scoping at once (the shared-fetch refactor's own
// point), so it's worth pinning here too, not just trusting the name.
const fetchRawSrc = (() => {
  const start = BOOT.indexOf('function _fetchPhotosRaw(leadId) {');
  if (start < 0) return '';
  const bodyStart = BOOT.indexOf('{', start);
  let depth = 0, i = bodyStart;
  for (; i < BOOT.length; i++) {
    if (BOOT[i] === '{') depth++;
    else if (BOOT[i] === '}') { depth--; if (depth === 0) break; }
  }
  return i < BOOT.length ? BOOT.slice(start, i + 1) : '';
})();
ok('_fetchPhotosRaw is present and liftable', fetchRawSrc.length > 0);
ok('_fetchPhotosRaw itself calls _photoQueryScopes(leadId) — the actual bridge',
  /\._photoQueryScopes\(leadId\)/.test(decommentJs(fetchRawSrc)), fetchRawSrc);

// The helper itself: confirm it still drops the userId filter for a team
// reader viewing a teammate's lead (loadPhotosByPhase now inherits this for
// free — if this ever regresses, both #photoList and #photosByPhase break
// the same way, which is itself the point of sharing one helper).
const helperSrc = (() => {
  const start = BOOT.indexOf('function _photoQueryScopes(leadId) {');
  if (start < 0) return '';
  const bodyStart = BOOT.indexOf('{', start);
  let depth = 0, i = bodyStart;
  for (; i < BOOT.length; i++) {
    if (BOOT[i] === '{') depth++;
    else if (BOOT[i] === '}') { depth--; if (depth === 0) break; }
  }
  return i < BOOT.length ? BOOT.slice(start, i + 1) : '';
})();
ok('_photoQueryScopes is present and liftable', helperSrc.length > 0);
ok('a team reader (company_admin/manager/viewer) on a teammate\'s lead drops the userId filter',
  /teamReader\s*\?\s*\[where\('leadId', '==', leadId\)\]/.test(helperSrc), helperSrc);
ok('everyone else keeps the owner-scoped pair',
  /where\('leadId', '==', leadId\), where\('userId', '==', auth\.currentUser\?\.uid\)/.test(helperSrc));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }

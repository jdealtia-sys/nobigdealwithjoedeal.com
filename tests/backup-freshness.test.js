/**
 * tests/backup-freshness.test.js
 *
 * WHY THIS EXISTS
 * ───────────────
 * On 2026-09-03 it emerged that this project's Firestore database had NEVER
 * been backed up. Three functions — dailyFirestoreBackup, nightlyFirestoreBackup
 * and firestoreBackupRetention — were deployed, ACTIVE and scheduled, and had
 * failed every night since they shipped: the destination buckets had never been
 * created, and the runtime service account holds roles/editor, which
 * deliberately excludes datastore.databases.export.
 *
 * Nothing checked the outcome. functions/backup-freshness.js is the thing that
 * checks it now, and this pins its decision — because an alarm that is itself
 * wrong is worse than no alarm: it converts "nobody is watching" into "someone
 * is watching, and they say it's fine".
 *
 * The cases below are therefore weighted toward the FAILURE-TO-KNOW states —
 * no marker, unreadable timestamp, future-dated marker — because those are the
 * ones where a naive implementation silently returns "fresh".
 *
 * Pure-Node, no emulator, no firebase. Run: node tests/backup-freshness.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const {
  assessBackupFreshness,
  isExportMarker,
  DEFAULT_MAX_AGE_HOURS,
} = require(path.join(ROOT, 'functions', 'backup-freshness-logic.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else {
    console.log('  ✗ ' + label + (detail ? ' — ' + detail : ''));
    failed++; fails.push(label);
  }
}

const NOW = Date.parse('2026-09-04T10:00:00Z'); // fixed clock — no Date.now()
const hoursAgo = (h) => NOW - h * 3600000;

console.log('\nTHE STATE THIS PROJECT WAS ACTUALLY IN — no marker at all');
{
  // Not a degenerate edge case: this was production from day one until
  // 2026-09-03, behind three green-looking scheduled functions.
  const v = assessBackupFreshness({ newestMarkerMs: null, nowMs: NOW });
  ok('null marker is stale', v.stale === true);
  ok('...and critical', v.severity === 'critical');
  ok('...and says there is no restorable copy', /no restorable copy/i.test(v.reason));
  ok('undefined marker is stale too',
     assessBackupFreshness({ newestMarkerMs: undefined, nowMs: NOW }).stale === true);
  // The bug class: an absent value read as a passing check.
  ok('a missing marker is NEVER reported fresh',
     assessBackupFreshness({ newestMarkerMs: null, nowMs: NOW }).severity !== 'ok');
}

console.log('\nFRESH vs STALE — one missed night must trip it');
{
  ok('2h old is fresh', assessBackupFreshness({ newestMarkerMs: hoursAgo(2), nowMs: NOW }).stale === false);
  ok('25h old is still fresh (yesterday ran)',
     assessBackupFreshness({ newestMarkerMs: hoursAgo(25), nowMs: NOW }).stale === false);
  // 06:00 ET check, exports at 03:15/04:00. If the newest is >26h old, today's
  // export did not finish. This is the case that had to be caught.
  ok('27h old is STALE — exactly one missed night',
     assessBackupFreshness({ newestMarkerMs: hoursAgo(27), nowMs: NOW }).stale === true);
  ok('...and is critical', assessBackupFreshness({ newestMarkerMs: hoursAgo(27), nowMs: NOW }).severity === 'critical');
  ok('a week old is stale', assessBackupFreshness({ newestMarkerMs: hoursAgo(168), nowMs: NOW }).stale === true);
  ok('the reason names the actual age',
     /27\.0 hours old/.test(assessBackupFreshness({ newestMarkerMs: hoursAgo(27), nowMs: NOW }).reason));
  ok('default threshold is 26h', DEFAULT_MAX_AGE_HOURS === 26);
  ok('the threshold is overridable',
     assessBackupFreshness({ newestMarkerMs: hoursAgo(27), nowMs: NOW, maxAgeHours: 48 }).stale === false);
  // A bad override must not disable the alarm.
  ok('a zero/garbage threshold falls back to the default, not to "never stale"',
     assessBackupFreshness({ newestMarkerMs: hoursAgo(27), nowMs: NOW, maxAgeHours: 0 }).stale === true);
}

console.log('\n"CANNOT TELL" MUST NEVER RENDER AS "FINE"');
{
  // Each of these is an input a naive implementation returns fresh for.
  ok('a NaN timestamp is stale',
     assessBackupFreshness({ newestMarkerMs: NaN, nowMs: NOW }).stale === true);
  ok('a non-numeric timestamp is stale',
     assessBackupFreshness({ newestMarkerMs: 'yesterday', nowMs: NOW }).stale === true);
  ok('Infinity is stale',
     assessBackupFreshness({ newestMarkerMs: Infinity, nowMs: NOW }).stale === true);
  ok('...and it says freshness could not be established',
     /cannot be established/i.test(assessBackupFreshness({ newestMarkerMs: NaN, nowMs: NOW }).reason));
  // THE DANGEROUS ONE: a future-dated marker makes `now - then` negative, so a
  // naive age check reads it as brand new — and it would then silence the
  // alarm forever, which is precisely this function's failure mode.
  const future = assessBackupFreshness({ newestMarkerMs: NOW + 72 * 3600000, nowMs: NOW });
  ok('a future-dated marker does NOT silence the alarm', future.stale === true);
  ok('...and is called out as a clock/metadata problem', /clock or metadata/i.test(future.reason));
  ok('no-args does not throw and is stale',
     assessBackupFreshness().stale === true);
}

console.log('\nONLY A COMPLETION MARKER COUNTS');
{
  // A failed export can still leave output-* files behind. Counting those as a
  // backup is how a partial export would read as success.
  ok('the overall_export_metadata marker counts',
     isExportMarker('2026-09-03/2026-09-03.overall_export_metadata') === true);
  ok('a nested marker counts',
     isExportMarker('a/b/c/2026-09-03.overall_export_metadata') === true);
  ok('output shards do NOT count',
     isExportMarker('2026-09-03/all_namespaces/all_kinds/output-0') === false);
  ok('the per-kind export_metadata does NOT count',
     isExportMarker('2026-09-03/all_namespaces/all_kinds/all_namespaces_all_kinds.export_metadata') === false);
  ok('a lookalike suffix does not count',
     isExportMarker('x.overall_export_metadata.tmp') === false);
  ok('non-strings do not count', isExportMarker(null) === false && isExportMarker(42) === false);
}

console.log('\nTHE ALARM MUST NOT BE SILENCEABLE OR SELF-DEPENDENT');
{
  const src = fs.readFileSync(path.join(ROOT, 'functions', 'backup-freshness.js'), 'utf8');

  // The reason this is a separate function rather than a health-digest section.
  // Match a real env READ, not the identifier: the docblock names
  // HEALTH_DIGEST_ENABLED in prose while explaining why this has no gate, and
  // the first cut of this assertion flagged that explanation as the thing it
  // was warning against.
  const codeOnly = src.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');
  ok('has NO *_ENABLED gate in code', !/process\.env\.[A-Z_]*ENABLED/.test(codeOnly));
  ok('does not require firestore-backup.js (stays independent of what it checks)',
     !/require\(['"]\.\/firestore-backup/.test(src));

  // The trap health-digest.js documents: a row without status:'pending' is
  // never claimed by emailQueueWorker, so the alert silently never sends.
  ok('queues to email_queue', /collection\('email_queue'\)/.test(src));
  ok("...with status: 'pending' so the worker actually claims it",
     /status:\s*'pending'/.test(src));

  // A listing failure is the exact state that hid this — it must alarm.
  ok('a bucket-listing failure raises the alarm rather than skipping',
     /listFailed/.test(src) && /stale:\s*true/.test(src));

  // Bucket name must stay in step with firestore-backup.js's own derivation;
  // the two are deliberately duplicated for independence, so pin them.
  const backupSrc = fs.readFileSync(path.join(ROOT, 'functions', 'firestore-backup.js'), 'utf8');
  ok('firestore-backup derives BUCKET as ${PROJECT_ID}-firestore-backups',
     /-firestore-backups`/.test(backupSrc));
  ok('...and the checker points at the same bucket',
     /-firestore-backups`/.test(src));
}

console.log('\nREGISTERED, OR IT NEVER RUNS');
{
  const idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
  ok('index.js mounts backup-freshness', /require\('\.\/backup-freshness'\)/.test(idx));
  // functions/index.js Object.assigns each module, and a smoke assertion fails
  // on any exported name absent from FUNCTIONS_INDEX.md.
  const md = fs.readFileSync(path.join(ROOT, 'functions', 'FUNCTIONS_INDEX.md'), 'utf8');
  ok('backupFreshnessCron is documented in FUNCTIONS_INDEX.md',
     /backupFreshnessCron/.test(md));
}

console.log('\n──────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }

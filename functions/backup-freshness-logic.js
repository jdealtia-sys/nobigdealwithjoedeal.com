/**
 * functions/backup-freshness-logic.js — the pure decision behind the
 * backup-freshness alarm. No imports on purpose.
 *
 * WHY THIS IS ITS OWN MODULE
 * ──────────────────────────
 * The alarm it serves exists because nobody was watching. An alarm nobody can
 * unit-test is the same species of thing, so the decision lives here, free of
 * firebase-functions, and `tests/backup-freshness.test.js` drives it directly.
 * (Same reasoning as functions/lead-artifact-paths.js.)
 *
 * WHAT IT DECIDES
 * ───────────────
 * `overall_export_metadata` is written by Firestore ONLY when an export
 * finishes. firestore-backup.js's own comment says so — "Success/failure of
 * the export itself lands in the GCS bucket as `*.overall_export_metadata`
 * files; operator checks there." No operator ever did, for the entire life of
 * the project, and three scheduled backup functions failed every night
 * unnoticed (see the 2026-09-03 session note). So the marker's presence and
 * age is the signal, and this decides when its absence is an alarm.
 */

'use strict';

// Run at 06:00 ET, after the 03:15 and 04:00 exports. 26 hours means a SINGLE
// missed night trips the alarm: at 06:00 the newest healthy marker is ~2h old,
// and yesterday's is ~26h. Anything older means today's export did not finish.
// Deliberately not 48h — "we lost two nights before anyone heard" is the bug,
// not the tolerance.
const DEFAULT_MAX_AGE_HOURS = 26;

/**
 * @param {object} opts
 * @param {number|null} opts.newestMarkerMs epoch ms of the newest
 *        overall_export_metadata, or null/undefined when none exists at all
 * @param {number} opts.nowMs
 * @param {number} [opts.maxAgeHours]
 * @returns {{stale: boolean, ageHours: number|null, reason: string, severity: string}}
 */
function assessBackupFreshness(opts) {
  const o = opts || {};
  const maxAgeHours = typeof o.maxAgeHours === 'number' && o.maxAgeHours > 0
    ? o.maxAgeHours
    : DEFAULT_MAX_AGE_HOURS;
  const nowMs = typeof o.nowMs === 'number' ? o.nowMs : 0;
  const newest = o.newestMarkerMs;

  // NO MARKER AT ALL. This is not a degenerate case to shrug at — it is
  // literally the state this project sat in from day one until 2026-09-03,
  // with three green-looking scheduled functions implying otherwise. It is
  // the loudest thing this function can say.
  if (newest === null || newest === undefined) {
    return {
      stale: true,
      ageHours: null,
      severity: 'critical',
      reason: 'No completed Firestore export has EVER been found in the backup '
        + 'bucket. Either the exports are failing or the bucket is wrong — '
        + 'there is currently no restorable copy of the database.',
    };
  }

  if (typeof newest !== 'number' || !isFinite(newest)) {
    return {
      stale: true,
      ageHours: null,
      severity: 'critical',
      reason: 'The newest export marker has an unreadable timestamp, so backup '
        + 'freshness cannot be established. Treated as a failure on purpose: '
        + '"cannot tell" must never read as "fine".',
    };
  }

  // A marker dated in the future is a clock or metadata problem. Do NOT let it
  // suppress the alarm — that would be the one input that silences the alarm
  // forever, which is exactly the shape of bug this whole function exists for.
  if (newest > nowMs + 60 * 60 * 1000) {
    return {
      stale: true,
      ageHours: 0,
      severity: 'warn',
      reason: 'The newest export marker is dated in the future, which points at '
        + 'a clock or metadata problem rather than a real backup. Flagged '
        + 'rather than trusted.',
    };
  }

  const ageHours = (nowMs - newest) / 3600000;
  if (ageHours > maxAgeHours) {
    return {
      stale: true,
      ageHours,
      severity: 'critical',
      reason: 'The most recent completed Firestore export is '
        + ageHours.toFixed(1) + ' hours old, past the ' + maxAgeHours
        + '-hour threshold. At least one nightly export has failed.',
    };
  }

  return {
    stale: false,
    ageHours,
    severity: 'ok',
    reason: 'Most recent completed export is ' + ageHours.toFixed(1)
      + ' hours old.',
  };
}

/** Only the completion marker counts — a partial export leaves output-* files
 *  behind with no marker, and those must NOT read as a successful backup. */
function isExportMarker(objectName) {
  return typeof objectName === 'string'
    && /\.overall_export_metadata$/.test(objectName);
}

module.exports = { assessBackupFreshness, isExportMarker, DEFAULT_MAX_AGE_HOURS };

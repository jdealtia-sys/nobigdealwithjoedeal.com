/**
 * functions/pdf-render-retention.js — age out server-rendered PDFs.
 *
 * THE PROBLEM THIS CLOSES (measured 2026-09-08)
 * ─────────────────────────────────────────────
 * `render-pdf.js` uploads every rendered document to
 * `pdf-renders/{uid}/{ts}-{filename}.pdf` and nothing has ever deleted one.
 * There was no lifecycle rule, no reaper, and no rule block on the prefix —
 * so the set only ever grew, and every object in it was a customer document:
 * invoices, contracts, change orders, warranties, inspection and photo
 * reports.
 *
 * Worse, they were not merely stored, they were *reachable*. Until the
 * companion change in render-pdf.js, the uploader stamped a
 * `firebaseStorageDownloadTokens` value on EVERY object unconditionally —
 * including on the happy path where `getSignedUrl()` succeeded and the token
 * was never used. A download token bypasses `storage.rules` completely: no
 * auth, no expiry, no revocation short of rotating it. A prod survey on
 * 2026-09-08 found 19 of 21 objects carrying one (the 2 exceptions predate
 * the fallback), and an unauthenticated HEAD on a customer roofing contract
 * returned `200 OK, application/pdf`. The same URL with the token stripped
 * returned `403` — the token was precisely what granted public access.
 *
 * Deleting the object is the only revocation path that actually works, which
 * is why this job exists rather than a token-rotation sweep.
 *
 * WHY A SCHEDULED REAPER AND NOT A BUCKET LIFECYCLE RULE
 * ─────────────────────────────────────────────────────
 * A GCS lifecycle rule (`matchesPrefix: ["pdf-renders/"]`, `age: 30`) would do
 * the same deletion for free, with no function to cold-start. It was the first
 * choice and was rejected for two repo-specific reasons:
 *
 *   1. Lifecycle config is bucket state, not repo state. Nothing in `docs/`,
 *      `firebase.json` or CI would record that the policy exists, no review
 *      would see it change, and a console edit could silently disable it. This
 *      repo's whole convention is that what ships is what is committed. The
 *      one-time-operator-setup pattern in firestore-backup.js is exactly what
 *      bit us before: that setup had never been run, and all three backup
 *      functions failed nightly from the day they shipped (see its header).
 *   2. A lifecycle rule cannot log, and cannot be reasoned about after the
 *      fact. This one emits a per-run count and, when nothing matches, still
 *      reports that it ran — which is how you tell "no old renders" apart from
 *      "the job is dead".
 *
 * The cost argument does not bite: one 256MiB invocation a day.
 *
 * WHY 30 DAYS
 * ───────────
 * The callable hands back a signed URL with a 7-day expiry, so an object older
 * than 7 days is already unreachable through the intended path. 30 gives a
 * wide margin for support ("resend me that invoice") and for a rep who
 * bookmarked a link, while bounding how long a leaked token URL stays live.
 * Renders are derived artifacts — every one can be rebuilt from the Firestore
 * row it was rendered from, so this deletes nothing that is a system of record.
 *
 * ON THE FIRST RUN it will delete every object currently under the prefix: on
 * 2026-09-08 the newest was 2026-06-21, ~11 weeks old. That is the intended
 * outcome — those are the 19 tokened, publicly-fetchable ones.
 */

'use strict';

const { onSchedule } = require('./integrations/heartbeat'); // heartbeat-wrapped drop-in for firebase-functions/v2/scheduler
const { logger } = require('firebase-functions/v2');
const { getStorage } = require('firebase-admin/storage');

// The prefix this job owns. Every delete is checked against it again at the
// point of deletion — see the guard in the loop.
const PREFIX = 'pdf-renders/';
const RETENTION_DAYS = 30;

// Ceiling on deletions per run. A runaway or mis-dated set should bleed off
// over several days with a visible `capped: true` in the logs rather than
// empty the prefix inside one invocation that nobody reviews. At one render
// per document this is far above any real day's output.
const MAX_DELETES_PER_RUN = 2000;

// Page size for the listing. Keeps memory flat on a large prefix.
const PAGE_SIZE = 500;

/**
 * True when `name` really sits under PREFIX.
 *
 * Belt and braces: `getFiles({prefix})` already scopes the listing, but this
 * job deletes from the MAIN application bucket — the one holding photos/,
 * docs/, esign/ and every other customer artifact. A future edit that widens
 * the listing (or a prefix accidentally set to '') would otherwise hand this
 * loop the whole bucket. The cost of the check is a string compare.
 */
function isReapablePath(name) {
  return typeof name === 'string'
    && name.startsWith(PREFIX)
    // Reject traversal-ish shapes outright rather than reasoning about
    // whether GCS can produce them.
    && !name.includes('..')
    // pdf-renders/{uid}/{file} — a bare `pdf-renders/x` with no uid segment
    // is not a shape this system writes, so leave it for a human.
    && name.split('/').length >= 3;
}

/**
 * Age in whole milliseconds from the object's own creation time.
 *
 * Uses `timeCreated` from GCS metadata rather than the `{ts}-` prefix in the
 * filename or the `renderedAtMs` custom field: both are supplied by the
 * uploader, and a clock-skewed or malformed one would make an object either
 * immortal or instantly reapable. `timeCreated` is set by the storage service.
 * Returns null when it is missing or unparseable, and the caller keeps the
 * object — never delete on the strength of a date you could not read.
 */
function ageMsOf(file) {
  const raw = file && file.metadata && file.metadata.timeCreated;
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return Date.now() - t;
}

// ═══════════════════════════════════════════════════════════
// pdfRenderRetention — prunes rendered PDFs past RETENTION_DAYS
// ═══════════════════════════════════════════════════════════
// 04:20 America/New_York: after the 03:15 Firestore export and its 03:45
// retention pass, so the three storage-heavy jobs do not overlap.
exports.pdfRenderRetention = onSchedule(
  {
    schedule: '20 4 * * *',
    timeZone: 'America/New_York',
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '256MiB',
  },
  async () => {
    const bucket = getStorage().bucket();
    const cutoffMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;

    let scanned = 0;
    let deleted = 0;
    let kept = 0;
    let undated = 0;
    let capped = false;
    const failures = [];

    try {
      let pageToken;
      do {
        const [files, nextQuery] = await bucket.getFiles({
          prefix: PREFIX,
          maxResults: PAGE_SIZE,
          pageToken,
          autoPaginate: false,
        });

        for (const file of files) {
          scanned++;

          if (!isReapablePath(file.name)) {
            kept++;
            // Loud: the listing was supposed to be scoped to PREFIX, so this
            // means an assumption above is wrong.
            logger.warn('pdfRenderRetention.outsidePrefix', { name: file.name });
            continue;
          }

          const age = ageMsOf(file);
          if (age === null) {
            undated++;
            kept++;
            logger.warn('pdfRenderRetention.noTimeCreated', { name: file.name });
            continue;
          }
          if (age <= cutoffMs) { kept++; continue; }

          if (deleted >= MAX_DELETES_PER_RUN) { capped = true; kept++; continue; }

          try {
            await file.delete({ ignoreNotFound: true });
            deleted++;
          } catch (e) {
            // One unreachable object must not abandon the rest of the sweep —
            // the whole point is that these age out without supervision.
            failures.push(`${file.name}: ${e.message}`);
          }
        }

        pageToken = nextQuery && nextQuery.pageToken;
        if (capped) break;
      } while (pageToken);

      // Always log, including the all-zero run. A job that reports nothing is
      // indistinguishable from a job that stopped running.
      logger.info('pdfRenderRetention.done', {
        retentionDays: RETENTION_DAYS,
        scanned,
        deleted,
        kept,
        undated,
        capped,
        failures: failures.length,
      });
      if (failures.length) {
        logger.warn('pdfRenderRetention.failures', { failures: failures.slice(0, 20) });
      }
    } catch (err) {
      // Swallow rather than throw: the scheduler would otherwise retry a
      // listing failure repeatedly, and the next daily run covers the same
      // ground anyway. Logged at error so the health digest can see it.
      logger.error('pdfRenderRetention.failed', {
        err: err.message,
        code: err.code,
        scanned,
        deleted,
      });
    }
  }
);

// Exported for tests — the pure predicates carry the safety properties worth
// asserting without standing up a bucket.
exports._internal = { isReapablePath, ageMsOf, PREFIX, RETENTION_DAYS, MAX_DELETES_PER_RUN };

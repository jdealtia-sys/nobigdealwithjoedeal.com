/**
 * functions/firestore-backup.js — automated daily Firestore export to GCS
 *
 * Runs once a day at 03:15 America/New_York, exports the entire
 * Firestore database to gs://${project}-firestore-backups/YYYY-MM-DD/.
 * A companion retention job prunes anything older than 30 days so the
 * bucket doesn't grow unbounded.
 *
 * Why this exists: Firestore has no native point-in-time restore on
 * the free tier / default setup. Without this, a bad migration or
 * accidental `db.collection(...).deleteAll()` is unrecoverable. With
 * this, we have a 30-day rolling window of daily snapshots that can
 * be restored into the same or a different project via:
 *   gcloud firestore import gs://BUCKET/YYYY-MM-DD/
 *
 * One-time setup (operator runs once):
 *   # 1. Create the bucket (same region as Firestore for cheap restores)
 *   gsutil mb -l us-central1 gs://nobigdeal-pro-firestore-backups/
 *
 *   # 2. Grant the Cloud Functions service account export + write perms
 *   PROJECT=nobigdeal-pro
 *   SA="${PROJECT}@appspot.gserviceaccount.com"
 *   gcloud projects add-iam-policy-binding $PROJECT \
 *     --member "serviceAccount:${SA}" \
 *     --role "roles/datastore.importExportAdmin"
 *   gsutil iam ch serviceAccount:${SA}:roles/storage.admin \
 *     gs://${PROJECT}-firestore-backups/
 *
 * Both deploy from firebase.json's functions codebase — no separate
 * infra to manage.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const firestore = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');

// Initialise lazily — index.js already calls admin.initializeApp() before
// it `require`s us, so we can safely reach into admin.firestore() here.
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'nobigdeal-pro';
const BUCKET = `${PROJECT_ID}-firestore-backups`;
const RETENTION_DAYS = 30;

function todayStamp() {
  // YYYY-MM-DD in UTC so the path is sortable regardless of where the
  // function runs. The schedule is NY-local but the path is UTC to
  // avoid collisions around DST.
  return new Date().toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════
// dailyFirestoreBackup — scheduled export
// ═══════════════════════════════════════════════════════════
exports.dailyFirestoreBackup = onSchedule(
  {
    schedule: '15 3 * * *',
    timeZone: 'America/New_York',
    maxInstances: 1,
    timeoutSeconds: 540,  // 9 min — export is async, this just kicks it off
    memory: '256MiB',
  },
  async () => {
    const stamp = todayStamp();
    const outputUriPrefix = `gs://${BUCKET}/${stamp}`;
    const client = new firestore.v1.FirestoreAdminClient();
    const databaseName = client.databasePath(PROJECT_ID, '(default)');

    try {
      const [operation] = await client.exportDocuments({
        name: databaseName,
        outputUriPrefix,
        // Empty array = export all collection groups.
        collectionIds: [],
      });
      logger.info('dailyFirestoreBackup.started', {
        stamp,
        operation: operation.name,
        outputUriPrefix,
      });
      // We don't await completion — exports can take minutes and the
      // operation continues server-side after this function returns.
      // Success/failure of the export itself lands in the GCS bucket
      // as `*.overall_export_metadata` files; operator checks there.
    } catch (err) {
      logger.error('dailyFirestoreBackup.failed', {
        stamp,
        err: err.message,
        code: err.code,
      });
      throw err;  // retry via scheduler's built-in retry policy
    }
  }
);

// ═══════════════════════════════════════════════════════════
// firestoreBackupRetention — prunes old backups
// ═══════════════════════════════════════════════════════════
// Runs 30 min after the backup so we don't race the new export's
// upload. Deletes every object in the bucket whose top-level
// directory is older than RETENTION_DAYS days. Skips the folder
// that was just written — defence-in-depth against a clock skew
// scenario where "today" gets pruned along with "30 days ago".
exports.firestoreBackupRetention = onSchedule(
  {
    schedule: '45 3 * * *',
    timeZone: 'America/New_York',
    maxInstances: 1,
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async () => {
    const storage = new Storage();
    const bucket = storage.bucket(BUCKET);
    const today = todayStamp();

    // Cut-off date (RETENTION_DAYS ago, UTC).
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
    const cutoffStamp = cutoff.toISOString().slice(0, 10);

    try {
      const [files] = await bucket.getFiles();
      let deleted = 0;
      let kept = 0;
      for (const file of files) {
        // First path segment = the date stamp.
        const topDir = file.name.split('/')[0];
        // Only touch objects whose top dir looks like YYYY-MM-DD.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(topDir)) { kept++; continue; }
        if (topDir === today) { kept++; continue; }
        if (topDir >= cutoffStamp) { kept++; continue; }
        await file.delete({ ignoreNotFound: true });
        deleted++;
      }
      logger.info('firestoreBackupRetention.done', {
        cutoffStamp,
        deleted,
        kept,
      });
    } catch (err) {
      // Bucket may not exist yet on first deploy — log and swallow so
      // the scheduler doesn't retry forever. The backup itself will
      // create the paths; operator just needs to provision the bucket.
      logger.warn('firestoreBackupRetention.failed', {
        err: err.message,
        code: err.code,
      });
    }
  }
);

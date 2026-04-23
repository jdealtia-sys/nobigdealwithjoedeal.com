# 08 — Firestore Automated Backup (10 min)

Goal: daily snapshots of the entire Firestore database to a GCS bucket, retained for 30 days. Gives you a point-in-time restore for any bad migration, accidental delete, or compromise.

## What the code does

Two Cloud Functions ship in `functions/firestore-backup.js`:

- **`dailyFirestoreBackup`** — runs 03:15 America/New_York, calls the Firestore Admin `exportDocuments` API, writes to `gs://${PROJECT}-firestore-backups/YYYY-MM-DD/`.
- **`firestoreBackupRetention`** — runs 03:45 America/New_York, prunes any top-level `YYYY-MM-DD/` folder older than 30 days. Never touches today's folder.

Both are wired into `functions/index.js` and deploy with the normal `firebase deploy --only functions` flow — no separate infra config.

## One-time setup (runs once, ever)

You need to provision the destination bucket + grant the Cloud Functions service account permission to export + write to it.

```bash
PROJECT=nobigdeal-pro
SA="${PROJECT}@appspot.gserviceaccount.com"

# 1. Create the backup bucket (same region as Firestore — cheap restores)
gsutil mb -l us-central1 "gs://${PROJECT}-firestore-backups/"

# 2. Grant the Cloud Functions service account export + write perms
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:${SA}" \
  --role "roles/datastore.importExportAdmin"

gsutil iam ch "serviceAccount:${SA}:roles/storage.admin" \
  "gs://${PROJECT}-firestore-backups/"
```

## Verify it worked

After the first scheduled run (next 03:15 ET), check the bucket:

```bash
gsutil ls "gs://nobigdeal-pro-firestore-backups/"
# Expected: YYYY-MM-DD/ folder
gsutil ls "gs://nobigdeal-pro-firestore-backups/YYYY-MM-DD/"
# Expected: all_namespaces/ + overall_export_metadata file
```

Force a manual run for the impatient:

```bash
# From Firebase Console → Functions → dailyFirestoreBackup → run
# or:
gcloud scheduler jobs run firebase-schedule-dailyFirestoreBackup-us-central1 --location=us-central1
```

## Restore procedure

If the day comes:

```bash
# Dry-run first — lists what would import, doesn't mutate
gcloud firestore import gs://nobigdeal-pro-firestore-backups/2026-04-22/ \
  --async --project nobigdeal-pro

# For a subset (e.g. just `leads`)
gcloud firestore import gs://nobigdeal-pro-firestore-backups/2026-04-22/ \
  --collection-ids=leads --project nobigdeal-pro
```

Imports **merge into the live database** — they don't wipe first. If you need a clean restore, either delete the target collections first or import into a different project.

## Cost

GCS standard storage in us-central1 is $0.020/GB/month. A small-to-midsize Firestore (say 500 MB total) × 30 daily snapshots (900 MB with some compression) ≈ **$0.02/month**. Egress on restore is a few cents.

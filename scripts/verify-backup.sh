#!/usr/bin/env bash
# scripts/verify-backup.sh — confirm nightly Firestore backups are running
#
# Q2 (security audit): the nightlyFirestoreBackup scheduled function
# (functions/integrations/compliance.js:85) writes a full Firestore
# export to gs://$BACKUP_BUCKET/<YYYY-MM-DD>/ every day at 04:00 CT.
# Until this script confirms artefacts are landing, "we have backups"
# is a claim without evidence.
#
# Run after deploy, or on a weekly cadence in ops's calendar. Fails
# loudly if:
#   - the bucket doesn't exist
#   - no export folder exists for any of the last 7 calendar days
#   - the deploy service account lacks Storage Object Viewer on the bucket
#
# SETUP:
#   export BACKUP_BUCKET=nobigdeal-pro-backups  # default; override per env
#   gcloud auth activate-service-account --key-file=/path/to/sa.json
#   ./scripts/verify-backup.sh
#
# Exit codes:
#   0  — at least one export from the last 7 days present + readable
#   1  — bucket missing, empty, or no recent export (backup cron broken)
#   2  — auth/permission error

set -uo pipefail

BUCKET="${BACKUP_BUCKET:-nobigdeal-pro-backups}"
DAYS="${BACKUP_MIN_DAYS:-7}"  # look back this many days
PROJECT="${GCP_PROJECT:-nobigdeal-pro}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   Firestore backup verification"
echo "   Bucket:  gs://$BUCKET"
echo "   Project: $PROJECT"
echo "   Window:  last $DAYS days"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "✗ gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"
  exit 2
fi

# 1. Bucket exists + we have permission to read.
if ! gcloud storage ls "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
  echo "✗ Cannot access gs://$BUCKET"
  echo "  - Does the bucket exist? If not, create it with:"
  echo "      gcloud storage buckets create gs://$BUCKET --project $PROJECT --location us-central1"
  echo "  - Does the caller have roles/storage.objectViewer (or admin) on the bucket?"
  exit 2
fi
echo "✓ Bucket reachable"

# 2. Look for any day-prefixed folder within the last $DAYS days.
#
# nightlyFirestoreBackup exports to gs://<bucket>/YYYY-MM-DD/ so a
# simple prefix list gives us a date-sorted set of export roots.
found=0
missing=()
for i in $(seq 0 "$DAYS"); do
  # GNU date on Linux + BSD date on macOS — try both.
  day=$(date -u -d "-$i day" '+%Y-%m-%d' 2>/dev/null \
        || date -u -v "-${i}d" '+%Y-%m-%d' 2>/dev/null \
        || echo "")
  [ -z "$day" ] && { echo "✗ date utility unusable"; exit 2; }

  if gcloud storage ls "gs://$BUCKET/$day/" --project "$PROJECT" >/dev/null 2>&1; then
    # Verify the export actually contains metadata (not an empty folder
    # from a failed run). Every Firestore export writes a
    # <timestamp>.overall_export_metadata file at the root.
    if gcloud storage ls "gs://$BUCKET/$day/**overall_export_metadata" \
         --project "$PROJECT" >/dev/null 2>&1; then
      echo "✓ $day — export present + metadata readable"
      found=$((found + 1))
    else
      echo "⚠ $day — folder exists but no metadata file (failed/partial export)"
      missing+=("$day(partial)")
    fi
  else
    missing+=("$day")
  fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $found -eq 0 ]; then
  echo "✗ NO backups found in the last $DAYS days"
  echo "  nightlyFirestoreBackup is broken. Check:"
  echo "  1. gcloud functions logs read nightlyFirestoreBackup --project $PROJECT --limit 50"
  echo "  2. Does the function's SA have roles/datastore.importExportAdmin?"
  echo "  3. Does the function's SA have roles/storage.objectAdmin on gs://$BUCKET?"
  echo "  4. Is Cloud Scheduler enabled? (firestore-deploy.yml enables it on deploy)"
  exit 1
fi

today=$(date -u '+%Y-%m-%d')
if [[ ! " ${missing[*]} " =~ " $today " ]] || [ $found -ge 2 ]; then
  echo "✓ $found of $((DAYS + 1)) days had exports (acceptable)"
  [ ${#missing[@]} -gt 0 ] && echo "  missing: ${missing[*]}"
  exit 0
else
  echo "⚠ Today's export ($today) is missing — cron may have just run yet, or broke this morning."
  echo "  $found of $((DAYS + 1)) days present. Re-run in a few hours if today was the gap."
  exit 1
fi

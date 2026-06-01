#!/usr/bin/env bash
# scripts/restore-drill.sh — EMULATOR-ONLY disaster-recovery dry run.
#
# Audit #4 (Phase 1). Proves the Firestore export → import round-trip
# mechanic end-to-end against the Firebase Emulator Suite and prints a
# rough RTO. This NEVER touches production: it runs entirely inside the
# emulator (RULE 0). It is a confidence check on the *mechanic* — the
# production restore path uses the managed export format and `gcloud
# firestore import` (see documentation/runbooks/RESTORE_FROM_BACKUP.md),
# which can only be drilled for real in a disposable scratch GCP project.
#
# What it does:
#   1. Boots auth+firestore emulators, seeds a tenant (scripts/seed-emulator.js),
#      counts docs, and exports emulator state to a temp dir   = "the backup".
#   2. Boots a FRESH emulator and confirms it is empty          = "data lost".
#   3. Boots the emulator with --import=<backup> and re-counts  = "restore".
#   4. Asserts post-restore counts == pre-backup counts and prints RTO.
#
# Usage:
#   ./scripts/restore-drill.sh
#
# Exit 0 = round-trip verified. Non-zero = mechanic broken (investigate
# before trusting prod restore).

set -uo pipefail

PROJECT="nobigdeal-pro"
BACKUP_DIR="$(mktemp -d /tmp/nbd-restore-drill.XXXXXX)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COUNT_JS="$ROOT/scripts/_drill-count.js"

cleanup() { rm -rf "$BACKUP_DIR" 2>/dev/null || true; }
trap cleanup EXIT

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   NBD Pro — restore drill (EMULATOR ONLY)"
echo "   Backup staging: $BACKUP_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1: seed + export (= take a backup) ──
echo ""
echo "[1/3] Seed tenant, count docs, export emulator state (simulated backup)…"
firebase emulators:exec --only auth,firestore --project "$PROJECT" \
  --export-on-exit="$BACKUP_DIR" \
  "node '$ROOT/scripts/seed-emulator.js' >/dev/null && node '$COUNT_JS' before" \
  || { echo "✗ seed/export step failed"; exit 1; }

if [ ! -f /tmp/nbd-drill-before.json ]; then
  echo "✗ no before-counts produced"; exit 1
fi
echo "  ✓ backup written to $BACKUP_DIR"

# ── Step 2: fresh boot proves the data is gone without --import ──
echo ""
echo "[2/3] Boot FRESH emulator (no import) — confirm data is absent…"
firebase emulators:exec --only auth,firestore --project "$PROJECT" \
  "node '$COUNT_JS' empty" \
  || { echo "✗ empty-check step failed"; exit 1; }

# ── Step 3: restore from the backup + verify + time it ──
echo ""
echo "[3/3] Boot emulator with --import (simulated restore) — verify counts…"
START=$(date +%s)
firebase emulators:exec --only auth,firestore --project "$PROJECT" \
  --import="$BACKUP_DIR" \
  "node '$COUNT_JS' after" \
  || { echo "✗ restore step failed"; exit 1; }
END=$(date +%s)
RTO=$((END - START))

# ── Compare ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
node "$COUNT_JS" --compare || { echo "✗ RESTORE MISMATCH — round-trip NOT verified"; exit 1; }
echo "  ⏱  emulator restore (boot+import+verify) took ~${RTO}s"
echo "✓ Restore round-trip VERIFIED in the emulator."
echo ""
echo "NOTE: this validates the export/import *mechanic* only. The"
echo "production restore uses the managed GCS export format and"
echo "\`gcloud firestore import\` — drill that in a scratch project per"
echo "documentation/runbooks/RESTORE_FROM_BACKUP.md before trusting it."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

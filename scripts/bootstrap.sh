#!/usr/bin/env bash
# scripts/bootstrap.sh — first-time go-live bootstrap
#
# Chains every local step needed to bring the hardened site live:
#
#   1. Prompt for confirmation that App Check is already registered and
#      reCAPTCHA site keys are pasted into the two client files
#   2. Rotate all shared secrets interactively (or skip if already done)
#   3. Grant Joe the admin custom claim
#   4. Seed the access_codes collection
#   5. Delete the 4 users with leaked deterministic passwords
#   6. Deploy to Firebase (if no GitHub Actions is wired up)
#   7. Run post-deploy smoke tests
#
# Safe to re-run — every step is idempotent.
#
# PRECONDITIONS:
#   - firebase CLI logged in: `firebase login`
#   - GOOGLE_APPLICATION_CREDENTIALS set to a service account JSON path
#   - You've already done the manual console work described in
#     GO_LIVE.md Steps 2 and 4
#
# RUN:
#   ./scripts/bootstrap.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PROJECT="${FIREBASE_PROJECT:-nobigdeal-pro}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "NBD Pro bootstrap — full go-live sequence"
echo "Project: $PROJECT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# ── preflight ────────────────────────────────────────────────

if ! command -v firebase >/dev/null 2>&1; then
  echo "✗ firebase CLI is not installed. Install with:"
  echo "   npm install -g firebase-tools"
  exit 1
fi

if [ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]; then
  echo "✗ GOOGLE_APPLICATION_CREDENTIALS is not set."
  echo "  Download a service account JSON from the Firebase Console and:"
  echo "   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json"
  exit 1
fi

if [ ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
  echo "✗ service account file not found: $GOOGLE_APPLICATION_CREDENTIALS"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "✗ node is not installed."
  exit 1
fi

if [ ! -d functions/node_modules ]; then
  echo "▶ Installing Cloud Functions dependencies (for Admin SDK)..."
  (cd functions && npm install)
  echo "✓ installed"
fi

export NODE_PATH="$REPO_ROOT/functions/node_modules"

# ── Step 0: App Check confirmation ───────────────────────────

echo
echo "──────────────────────────────────────────────────────────"
echo "Step 0 / 7 — App Check & reCAPTCHA site key confirmation"
echo "──────────────────────────────────────────────────────────"
echo
echo "Before this script deploys Cloud Functions, confirm that you've:"
echo
echo "  1. Registered the web app for App Check (reCAPTCHA Enterprise)"
echo "     in Firebase Console → Project Settings → App Check"
echo "  2. Copied the site key"
echo "  3. Pasted it into BOTH of these files:"
echo "       docs/visualizer.html                (window.__NBD_RECAPTCHA_KEY__)"
echo "       docs/sites/js/marketing-firebase.js (MARKETING_RECAPTCHA_SITE_KEY)"
echo "  4. Committed and pushed those changes"
echo
read -r -p "Have you done all 4? (y/N) " ack
if [[ ! "$ack" =~ ^[Yy] ]]; then
  echo "Stopping. Do the App Check steps, then re-run bootstrap."
  exit 1
fi

# ── Step 1: rotate secrets ───────────────────────────────────

echo
echo "──────────────────────────────────────────────────────────"
echo "Step 1 / 7 — Rotate shared secrets"
echo "──────────────────────────────────────────────────────────"
echo
read -r -p "Run interactive secret rotation now? (y/N/skip) " choice
if [[ "$choice" =~ ^[Yy] ]]; then
  "$SCRIPT_DIR/rotate-secrets.sh"
else
  echo "⊘ skipped — assuming you rotated secrets earlier or will handle this separately"
fi

# ── Step 2: grant admin claim ────────────────────────────────

echo
echo "──────────────────────────────────────────────────────────"
echo "Step 2 / 7 — Grant admin custom claim to Joe"
echo "──────────────────────────────────────────────────────────"
node "$SCRIPT_DIR/grant-admin-claim.js"

# ── Step 3: seed access codes ────────────────────────────────

echo
echo "──────────────────────────────────────────────────────────"
echo "Step 3 / 7 — Seed the access_codes Firestore collection"
echo "──────────────────────────────────────────────────────────"
node "$SCRIPT_DIR/seed-access-codes.js"

# ── Step 4: delete compromised users ─────────────────────────

echo
echo "──────────────────────────────────────────────────────────"
echo "Step 4 / 7 — Delete the 4 users with leaked passwords"
echo "──────────────────────────────────────────────────────────"
node "$SCRIPT_DIR/delete-compromised-users.js"

# ── Step 5: deploy ───────────────────────────────────────────

echo
echo "──────────────────────────────────────────────────────────"
echo "Step 5 / 7 — Deploy to Firebase"
echo "──────────────────────────────────────────────────────────"
echo
echo "If GitHub Actions auto-deploy is set up, you can skip this step"
echo "and just \`git push\` instead. Otherwise, deploy locally now."
echo
read -r -p "Run firebase deploy now? (y/N) " choice
if [[ "$choice" =~ ^[Yy] ]]; then
  "$SCRIPT_DIR/deploy.sh"
else
  echo "⊘ skipped — assuming auto-deploy or manual deploy later"
fi

# ── Step 6: verify ───────────────────────────────────────────

echo
echo "──────────────────────────────────────────────────────────"
echo "Step 6 / 7 — Post-deploy smoke tests"
echo "──────────────────────────────────────────────────────────"
echo
read -r -p "Run smoke tests against the live site now? (y/N) " choice
if [[ "$choice" =~ ^[Yy] ]]; then
  "$SCRIPT_DIR/verify-deploy.sh"
else
  echo "⊘ skipped — re-run with './scripts/verify-deploy.sh' anytime"
fi

# ── Step 7: Cloudflare reminder ──────────────────────────────

echo
echo "──────────────────────────────────────────────────────────"
echo "Step 7 / 7 — Manual cleanup: Cloudflare + monitoring policies"
echo "──────────────────────────────────────────────────────────"
echo
echo "Two things you still have to do by hand (no CLI covers them cleanly):"
echo
echo "  1. Cloudflare Dashboard → Workers & Pages → Delete the"
echo "     'nbd-ai-proxy' worker. The repo has a 410-Gone stub as a"
echo "     safety net but the clean end state is no worker at all."
echo
echo "  2. Cloud Monitoring alert policies:"
echo "       gcloud alpha monitoring channels list --project=$PROJECT"
echo "       # copy the notification channel ID you want to alert"
echo "       # edit each file in monitoring/alert-*.json, replace"
echo "       # NOTIFICATION_CHANNEL_ID with the full path"
echo "       for f in monitoring/alert-*.json; do"
echo "         gcloud alpha monitoring policies create \\"
echo "           --policy-from-file=\"\$f\" --project=$PROJECT"
echo "       done"
echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ bootstrap complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "Watch Cloud Billing + Twilio + Anthropic dashboards for 24 hours."
echo "If anything spikes, rotate the affected secret and investigate."
echo

#!/usr/bin/env bash
# scripts/deploy.sh — NBD Pro production deploy
#
# This script runs `firebase deploy` in the correct order:
#   1. Firestore rules   (lock the schema BEFORE functions roll out)
#   2. Storage rules
#   3. Cloud Functions   (picks up secrets + App Check enforcement)
#   4. Hosting           (static site + strict CSP headers)
#   5. Marketing-site Firestore rules (SEPARATE project)
#
# PRECONDITIONS — do these ONCE before the first deploy:
#   1. Rotate every secret per SECRET_ROTATION.md and run
#      `firebase functions:secrets:set <NAME>` for each one.
#   2. `node scripts/grant-admin-claim.js`
#   3. `node scripts/seed-access-codes.js`
#   4. `node scripts/delete-compromised-users.js`
#   5. Register the web app for App Check (reCAPTCHA Enterprise) in the
#      Firebase Console and paste the site key into:
#        - docs/visualizer.html (search for __NBD_RECAPTCHA_KEY__)
#        - docs/sites/js/marketing-firebase.js (MARKETING_RECAPTCHA_SITE_KEY)
#   6. In Twilio: set messaging geo-permissions to US & Canada only.
#   7. In Stripe: rotate the webhook endpoint + signing secret.
#   8. firebase login  (if you haven't already)
#
# USAGE:
#   ./scripts/deploy.sh
#
# If any step fails, the script stops immediately. Re-run after fixing.

set -euo pipefail

PRO=nobigdeal-pro
MKT=nobigdealwithjoedeal
PRO_RULES=firestore.rules
MKT_RULES=marketing-site-firestore.rules

if ! command -v firebase >/dev/null 2>&1; then
  echo "ERROR: firebase CLI is not installed."
  echo "Install with: npm install -g firebase-tools"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "NBD Pro production deploy"
echo "Project: $PRO (marketing: $MKT)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

echo "▶ Step 1/5: deploying Firestore rules to $PRO..."
firebase deploy --only firestore:rules --project "$PRO"
echo "✓ Firestore rules deployed"
echo

echo "▶ Step 2/5: deploying Storage rules to $PRO..."
firebase deploy --only storage --project "$PRO"
echo "✓ Storage rules deployed"
echo

echo "▶ Step 3/5: deploying Cloud Functions to $PRO..."
firebase deploy --only functions --project "$PRO"
echo "✓ Functions deployed"
echo

echo "▶ Step 4/5: deploying Hosting to $PRO..."
firebase deploy --only hosting --project "$PRO"
echo "✓ Hosting deployed"
echo

echo "▶ Step 5/5: deploying marketing-site Firestore rules to $MKT..."
if [ ! -f "$MKT_RULES" ]; then
  echo "! $MKT_RULES not found — skipping marketing project"
else
  # Firebase CLI reads `firestore.rules` per the firebase.json config.
  # Swap in the marketing rules file temporarily, deploy against the
  # marketing project, then restore. No history is lost because the pro
  # rules still live in git.
  TMP=/tmp/firestore.rules.bak.$$
  cp "$PRO_RULES" "$TMP"
  cp "$MKT_RULES" "$PRO_RULES"
  # Always restore on exit (even on error).
  trap 'cp "$TMP" "$PRO_RULES"; rm -f "$TMP"' EXIT
  firebase deploy --only firestore:rules --project "$MKT"
  trap - EXIT
  cp "$TMP" "$PRO_RULES"
  rm -f "$TMP"
  echo "✓ Marketing rules deployed, pro rules restored"
fi
echo

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ ALL DEPLOYS COMPLETE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "Smoke tests — run these now:"
echo
echo "  1. curl -X POST https://us-central1-nobigdeal-pro.cloudfunctions.net/validateAccessCode \\"
echo "        -H 'Content-Type: application/json' \\"
echo "        -d '{\"data\":{\"code\":\"NBD-ADMIN\"}}'"
echo "     → should return a 403 (App Check missing) or 'not-found'. NOT a success."
echo
echo "  2. curl -X POST https://us-central1-nobigdeal-pro.cloudfunctions.net/seedDemoData"
echo "     → should return 404 (function is deleted)."
echo
echo "  3. Sign in to /pro/dashboard.html as Joe, then open /admin/vault.html."
echo "     → should load without bouncing."
echo
echo "  4. Register a fresh free account, open devtools, and run:"
echo "     setDoc(doc(db,'users',auth.currentUser.uid),{role:'admin'},{merge:true})"
echo "     → must throw PERMISSION_DENIED."
echo
echo "Watch Cloud Billing + Twilio + Anthropic dashboards for 24 hours."
echo "If anything spikes, revoke the affected secret and re-rotate."

#!/usr/bin/env bash
# scripts/verify-deploy.sh — post-deploy smoke tests
#
# Runs the attack-payload curls from the security audit against the live
# site. Every one should FAIL (return 4xx or "not-found"). If any of
# them succeed, STOP — something didn't deploy correctly and the site
# is still vulnerable.
#
# Safe to run anytime after deploy. Does not modify anything — only
# sends read-style probes.
#
# Exit code:
#   0  — all tests passed (site is hardened)
#   1  — at least one test failed (site still has a hole)

set -uo pipefail

FN_BASE="https://us-central1-nobigdeal-pro.cloudfunctions.net"
SITE="https://www.nobigdealwithjoedeal.com"

fail=0
pass=0

check() {
  local label="$1"; local expected="$2"; shift 2
  local out
  out="$("$@" 2>&1 || true)"
  if echo "$out" | grep -qE "$expected"; then
    echo "  ✓ $label"
    pass=$((pass + 1))
  else
    echo "  ✗ $label"
    echo "     expected pattern: $expected"
    echo "     got:"
    echo "$out" | sed 's/^/     /' | head -8
    fail=$((fail + 1))
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "NBD Pro post-deploy verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

echo "── Cloud Function attack surface ──"

# 1. validateAccessCode must refuse NBD-ADMIN.
#    With App Check enforced, we should see a 403 or
#    'unauthenticated' / 'not-found' error. We should NOT see
#    'email' / 'password' / 'customToken' in the response.
check \
  "validateAccessCode('NBD-ADMIN') — should not return success" \
  "(Unauthenticated|unauthenticated|not-found|failed-precondition|403|Code not recognized|app-check)" \
  curl -sS -X POST "$FN_BASE/validateAccessCode" \
    -H "Content-Type: application/json" \
    -d '{"data":{"code":"NBD-ADMIN"}}'

# 2. seedDemoData must be deleted.
check \
  "seedDemoData is deleted" \
  "(404|not.found|NOT_FOUND)" \
  curl -sS -o /dev/null -w "%{http_code}" -X POST "$FN_BASE/seedDemoData"

# 3. publicVisualizerAI without App Check must 403.
check \
  "publicVisualizerAI without App Check — should 403" \
  "(403|401|unauthenticated|app.check)" \
  curl -sS -X POST "$FN_BASE/publicVisualizerAI" \
    -H "Content-Type: application/json" \
    -d '{}'

# 4. claudeProxy without auth must 401.
check \
  "claudeProxy without auth — should 401" \
  "(401|Missing|unauthenticated)" \
  curl -sS -X POST "$FN_BASE/claudeProxy" \
    -H "Content-Type: application/json" \
    -d '{"messages":[]}'

# 5. incomingSMS without Twilio signature must 403.
check \
  "incomingSMS without Twilio signature — should 403" \
  "(403|signature|verification failed)" \
  curl -sS -X POST "$FN_BASE/incomingSMS" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "From=%2B15555555555&Body=test&MessageSid=fake"

echo
echo "── Hosting security headers ──"

headers="$(curl -sS -I "$SITE/pro/dashboard.html" 2>&1 || true)"

check \
  "Strict-Transport-Security header present" \
  "(?i)^strict-transport-security:" \
  bash -c "echo \"$headers\" | grep -iE '^strict-transport-security'"

check \
  "Content-Security-Policy header present" \
  "(?i)^content-security-policy:" \
  bash -c "echo \"$headers\" | grep -iE '^content-security-policy'"

check \
  "X-Frame-Options: DENY" \
  "DENY" \
  bash -c "echo \"$headers\" | grep -iE '^x-frame-options'"

check \
  "Cross-Origin-Opener-Policy: same-origin" \
  "same-origin" \
  bash -c "echo \"$headers\" | grep -iE '^cross-origin-opener-policy'"

check \
  "Cache-Control: no-store on /pro/dashboard.html" \
  "no-store" \
  bash -c "echo \"$headers\" | grep -iE '^cache-control'"

echo
echo "── Oaks preview hiding ──"

oaks_headers="$(curl -sS -I "$SITE/sites/oaks/" 2>&1 || true)"
check \
  "X-Robots-Tag: noindex on /sites/oaks/" \
  "noindex" \
  bash -c "echo \"$oaks_headers\" | grep -iE '^x-robots-tag'"

robots="$(curl -sS "$SITE/robots.txt" 2>&1 || true)"
check \
  "robots.txt disallows /sites/oaks/" \
  "^Disallow: /sites/oaks/" \
  bash -c "echo \"$robots\""

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$pass passed, $fail failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$fail" -gt 0 ]; then
  echo
  echo "✗ Smoke tests detected holes in the deployed site."
  echo "  Do NOT advertise or share the link until these are fixed."
  echo "  See POST_DEPLOY_CHECKLIST.md §10 for debugging each test."
  exit 1
fi

echo
echo "✓ All smoke tests passed. Site is hardened."
echo
echo "Next:"
echo "  • Delete the Cloudflare nbd-ai-proxy worker (if not already done)"
echo "  • Watch Cloud Billing + Twilio + Anthropic for 24 hours"
echo "  • Remove the transitional shim in docs/pro/js/pages/login.js"
echo "    (search 'Transitional compat shim')"
exit 0

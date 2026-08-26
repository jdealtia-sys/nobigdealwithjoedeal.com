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
echo "── Oaks cutover + tenant microsite hiding ──"

# Oaks microsite (Jo, 2026-08-19). Direction of travel REVERSED from the
# 2026-07-04 Pillar 5 cutover: the hand-authored 11-page site at /sites/oaks is
# now the real site, and the one-page tenant stub at /sites/t/oaks 301s TO it.
# These assertions were still testing the old arrangement and would have failed
# the first post-deploy run after the rebuild.
t_headers="$(curl -sS -I "$SITE/sites/t/oaks" 2>&1 || true)"
check \
  "/sites/t/oaks 301s to the real site (tenant stub retired)" \
  "301" \
  bash -c "echo \"$t_headers\" | head -1"
check \
  "301 Location is /sites/oaks" \
  "/sites/oaks" \
  bash -c "echo \"$t_headers\" | grep -iE '^location'"

# The homepage is reached at the SLASHLESS /sites/oaks, where relative paths
# would resolve one segment too shallow; the 301 to /sites/oaks/home (a rewrite,
# so the address bar keeps the /sites/oaks/ base) is what keeps the portable
# relative-path build working here. If this stops redirecting, every link and
# asset on the Oaks homepage silently 404s.
home_headers="$(curl -sS -I "$SITE/sites/oaks" 2>&1 || true)"
check \
  "/sites/oaks 301s to /sites/oaks/home (relative-path base fix)" \
  "/sites/oaks/home" \
  bash -c "echo \"$home_headers\" | grep -iE '^location'"

# The assertion that actually matters, and whose absence let a redirect LOOP
# reach production on 2026-08-19: the first attempt pointed /sites/oaks at
# /sites/oaks/index, but cleanUrls canonicalises the "index" segment of a
# directory index straight back off, so Hosting bounced between the two forever.
# Every header check above still passed — only FOLLOWING the redirects catches
# it. curl exits non-zero on too-many-redirects, so a loop reports LOOP here.
check \
  "/sites/oaks resolves to a real page (no redirect loop)" \
  "200" \
  bash -c "curl -sS -o /dev/null -L --max-redirs 5 -w '%{http_code}' \"$SITE/sites/oaks\" 2>/dev/null || echo LOOP"

# The trailing-slash form of the homepage. trailingSlash:false strips the slash
# off a real file, but the homepage is served by a REWRITE and a rewrite source
# matches the slashed form AND skips that normalisation — so this url answered
# 200 with the page while every relative asset 404'd (no css, no js, 11 of 11
# images broken). Found on live production, 2026-08-19. Following the redirect
# is the only way to see it; a header check passes either way.
check \
  "/sites/oaks/home/ normalises instead of serving an asset-less page" \
  "200" \
  bash -c "curl -sS -o /dev/null -L --max-redirs 5 -w '%{http_code}' \"$SITE/sites/oaks/home/\" 2>/dev/null || echo LOOP"
check \
  "  ...and lands on the canonical slashless url" \
  "/sites/oaks/home" \
  bash -c "curl -sS -o /dev/null -L --max-redirs 5 -w '%{url_effective}' \"$SITE/sites/oaks/home/\" 2>/dev/null"

# A miss anywhere under the client's url space must render the CLIENT's 404, not
# NBD's — it is the one cross-brand surface reachable from /sites/oaks/.
oaks_404="$(curl -sS "$SITE/sites/oaks/this-page-does-not-exist" 2>&1 || true)"
check \
  "a missed Oaks url renders the Oaks 404, not the NBD one" \
  "Oaks Roofing" \
  bash -c "echo \"$oaks_404\" | grep -o '<title>[^<]*</title>'"
check \
  "the Oaks 404 carries no NBD branding" \
  "0" \
  bash -c "echo \"$oaks_404\" | grep -ci 'no big deal' || true"

oaks_page="$(curl -sS -I "$SITE/sites/oaks/about" 2>&1 || true)"
check \
  "an interior Oaks page serves 200" \
  "200" \
  bash -c "echo \"$oaks_page\" | head -1"
check \
  "X-Robots-Tag: noindex on the Oaks pages (unlaunched client site)" \
  "noindex" \
  bash -c "echo \"$oaks_page\" | grep -iE '^x-robots-tag'"

logo_headers="$(curl -sS -I "$SITE/sites/oaks/logo-orange.svg" 2>&1 || true)"
check \
  "logo-orange.svg still serves (200, not redirected)" \
  "200" \
  bash -c "echo \"$logo_headers\" | head -1"

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

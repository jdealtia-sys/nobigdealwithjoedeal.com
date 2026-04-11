#!/usr/bin/env bash
# scripts/rotate-secrets.sh — interactive secret rotation helper
#
# Walks through every Firebase Cloud Functions secret the hardened code
# depends on, prompts you for the new value, and pushes it via
# `firebase functions:secrets:set`.
#
# This is the one script where you still have to do the manual step
# of getting the actual key from Anthropic/Stripe/Twilio/Resend dashboards
# — there's no API I can use to rotate a vendor's API key for you.
# But the actual Firebase-side push is automated, and the script tells
# you exactly what to paste.
#
# Safe to re-run: setting a secret that already exists just creates a
# new version.
#
# PRECONDITIONS:
#   - firebase CLI installed + logged in: `firebase login`
#   - you know which Firebase project to target
#
# RUN:
#   ./scripts/rotate-secrets.sh

set -euo pipefail

PROJECT="${FIREBASE_PROJECT:-nobigdeal-pro}"

if ! command -v firebase >/dev/null 2>&1; then
  echo "ERROR: firebase CLI is not installed."
  echo "Install with: npm install -g firebase-tools"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "NBD Pro secret rotation"
echo "Target project: $PROJECT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "For each secret below, the script will open the relevant vendor"
echo "dashboard URL in your default browser (if available), wait for"
echo "you to paste the new value, and then push it to Firebase secrets."
echo
echo "If you want to skip a secret (already rotated earlier), hit ENTER"
echo "at the prompt without typing anything and the script will move on."
echo

open_url() {
  local url="$1"
  # macOS, Linux, WSL — try the best available command, fall back to print.
  if command -v open >/dev/null 2>&1; then open "$url" 2>/dev/null || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" 2>/dev/null || true
  elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "$url" 2>/dev/null || true
  fi
}

rotate() {
  local name="$1"; local label="$2"; local url="$3"; local instructions="$4"
  echo "──────────────────────────────────────────────────────────"
  echo "▶ $label"
  echo "──────────────────────────────────────────────────────────"
  echo "  Where: $url"
  echo "  What:  $instructions"
  echo
  open_url "$url"
  # -s suppresses echo so the key doesn't show up in terminal history
  read -r -s -p "Paste the new $label value (or press ENTER to skip): " value
  echo
  if [ -z "$value" ]; then
    echo "  ⊘ skipped $name"
    return 0
  fi
  # Push to Firebase secrets by piping stdin.
  printf '%s' "$value" | firebase functions:secrets:set "$name" \
    --project "$PROJECT" --data-file - >/dev/null
  echo "  ✓ $name rotated"
  echo
}

# ── 1. Anthropic ─────────────────────────────────────────────
rotate \
  "ANTHROPIC_API_KEY" \
  "Anthropic API key" \
  "https://console.anthropic.com/settings/keys" \
  "Create a new key (sk-ant-...), copy it, and DELETE the old key immediately."

# ── 2. Stripe secret key ─────────────────────────────────────
rotate \
  "STRIPE_SECRET_KEY" \
  "Stripe secret key" \
  "https://dashboard.stripe.com/apikeys" \
  "Create a new restricted key with checkout.sessions, billing_portal.sessions, payment_links, webhook_endpoints, subscriptions, invoices, customers, payment_intents scopes. Revoke the old one."

# ── 3. Stripe webhook signing secret ─────────────────────────
rotate \
  "STRIPE_WEBHOOK_SECRET" \
  "Stripe webhook signing secret" \
  "https://dashboard.stripe.com/webhooks" \
  "Delete the old webhook endpoint, add new ones for /stripeWebhook + /invoiceWebhook, copy the signing secret from the new endpoint page."

# ── 4. Stripe price IDs ──────────────────────────────────────
rotate \
  "STRIPE_PRICE_FOUNDATION" \
  "Stripe price id (Foundation plan)" \
  "https://dashboard.stripe.com/products" \
  "Click the Foundation product, click its price, copy the price_... id."

rotate \
  "STRIPE_PRICE_PROFESSIONAL" \
  "Stripe price id (Professional plan)" \
  "https://dashboard.stripe.com/products" \
  "Click the Professional product, click its price, copy the price_... id."

# ── 5. Twilio ────────────────────────────────────────────────
rotate \
  "TWILIO_ACCOUNT_SID" \
  "Twilio Account SID" \
  "https://console.twilio.com/" \
  "Copy the Account SID from the dashboard (starts with AC...)."

rotate \
  "TWILIO_AUTH_TOKEN" \
  "Twilio Auth Token" \
  "https://console.twilio.com/" \
  "Settings → API Keys → Roll the primary Auth Token, copy the new value."

rotate \
  "TWILIO_PHONE_NUMBER" \
  "Twilio phone number" \
  "https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" \
  "Copy the E.164 phone number (e.g. +18594207382)."

rotate \
  "TWILIO_VERIFY_SID" \
  "Twilio Verify service SID" \
  "https://console.twilio.com/us1/develop/verify/services" \
  "Copy the Verify service SID (starts with VA...)."

# ── 6. Resend ────────────────────────────────────────────────
rotate \
  "RESEND_API_KEY" \
  "Resend API key" \
  "https://resend.com/api-keys" \
  "Create a new API key named nbd-pro-$(date +%Y-%m-%d), delete the old one."

rotate \
  "EMAIL_FROM" \
  "Email sender address" \
  "https://resend.com/domains" \
  "The verified sender address (e.g. noreply@nobigdealwithjoedeal.com)."

# ── 7. Joe notification secrets (new) ────────────────────────
rotate \
  "JOE_NOTIFY_PHONE" \
  "Joe's notify phone (lead SMS destination)" \
  "" \
  "E.164 phone number that lead notifications get texted to, e.g. +18594207382."

rotate \
  "JOE_NOTIFY_EMAIL" \
  "Joe's notify email (lead email destination)" \
  "" \
  "Email address lead notifications get sent to, e.g. jonathandeal459@gmail.com."

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Secret rotation complete."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "Next: redeploy functions so they pick up the new secret versions."
echo "      git push (if you've set up GitHub Actions auto-deploy), or:"
echo "      ./scripts/deploy.sh"
echo

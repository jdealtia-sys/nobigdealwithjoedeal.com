# 02 — Required secrets (15 min)

Goal: set the 5 secrets the app cannot run without.

## What a "secret" is

A secret is an API key (or password) that Firebase stores server-side.
Cloud Functions ask Firebase for the value at runtime.
**Secrets NEVER go in the repo** — that's why we use `firebase functions:secrets:set` instead.

## The 5 required secrets

Each one is a command. When you paste it, the terminal will prompt for the value. Paste the value (it won't show on screen — that's normal), press Enter.

### 1. `ANTHROPIC_API_KEY`

What it's for: the "Ask Joe AI" + property intel features call Claude. This is Joe's Anthropic key.

Where to get it: https://console.anthropic.com/settings/keys → **Create Key** → copy the `sk-ant-...` value.

Set it:

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY --project nobigdeal-pro
```

### 2. `STRIPE_SECRET_KEY`

What it's for: subscription billing + invoice generation.

Where to get it: https://dashboard.stripe.com/apikeys → **Standard keys** → click the "Secret key" eyeball icon → copy the `sk_live_...` value (or `sk_test_...` if you're still in test mode).

Set it:

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY --project nobigdeal-pro
```

### 3. `STRIPE_WEBHOOK_SECRET`

What it's for: proves incoming Stripe webhooks are really from Stripe.

Where to get it: https://dashboard.stripe.com/webhooks → find the NBD webhook endpoint → click it → "Signing secret" → **Reveal** → copy the `whsec_...` value.

If there's no webhook registered yet, create one:
- **Endpoint URL:** `https://us-central1-nobigdeal-pro.cloudfunctions.net/stripeWebhook`
- **Events:** `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`, `invoice.paid`
- Save, then copy the signing secret.

Set it:

```bash
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project nobigdeal-pro
```

### 4. `RESEND_API_KEY`

What it's for: transactional email (estimate confirmations, GDPR confirms, dunning, invite emails).

Where to get it: https://resend.com/api-keys → **Create API Key** → pick "Full access" → copy the `re_...` value.

Set it:

```bash
firebase functions:secrets:set RESEND_API_KEY --project nobigdeal-pro
```

### 5. `EMAIL_FROM`

What it's for: the "From:" address on every email the app sends.

No signup — just decide what address to use. Example: `Joe Deal <joe@nobigdealwithjoedeal.com>`.

The sending domain (`nobigdealwithjoedeal.com`) must be verified in Resend. Verify it at https://resend.com/domains if it isn't already. This is a 5-minute DNS record process.

Set it:

```bash
firebase functions:secrets:set EMAIL_FROM --project nobigdeal-pro
```

When prompted, paste the full "Name <email@domain>" string.

## Verify all 5 are set

```bash
firebase functions:secrets:access ANTHROPIC_API_KEY --project nobigdeal-pro
firebase functions:secrets:access STRIPE_SECRET_KEY --project nobigdeal-pro
firebase functions:secrets:access STRIPE_WEBHOOK_SECRET --project nobigdeal-pro
firebase functions:secrets:access RESEND_API_KEY --project nobigdeal-pro
firebase functions:secrets:access EMAIL_FROM --project nobigdeal-pro
```

Each should print a value. If one says "secret not found" → set it again.

## Twilio (if you use SMS)

The app has SMS features (`sendSMS`, `sendD2DSMS`, TCPA opt-out handling).
If you're using those, also set:

```bash
firebase functions:secrets:set TWILIO_ACCOUNT_SID --project nobigdeal-pro
firebase functions:secrets:set TWILIO_AUTH_TOKEN  --project nobigdeal-pro
firebase functions:secrets:set TWILIO_PHONE_NUMBER --project nobigdeal-pro
```

Get values from https://console.twilio.com/ → your project → **Account Info**.

## Done when

```bash
scripts/deploy-runbook.sh --dry-run
```

...now shows green checks next to every `required:` line. Optional ones still warn; that's fine.

---

Next: [`03-app-check.md`](03-app-check.md) — the single most important post-deploy step.

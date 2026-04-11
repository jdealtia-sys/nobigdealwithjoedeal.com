# Secret Rotation Runbook (2026-04-11)

Assume that every secret in the nobigdeal-pro project was already exfiltrated. Rotate every one. Do these **before** you deploy the new code so the old surface stops burning budget the moment the deploy lands.

Order matters. Do them top to bottom.

---

## 1. Anthropic API key

1. Go to https://console.anthropic.com/settings/keys
2. Create a NEW key named `nbd-pro-2026-04-11`.
3. Delete every other key under the NBD Pro workspace.
4. Set it as a Firebase secret:
   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY
   # paste the new key when prompted
   ```
5. Also remove it from the Cloudflare Worker (the worker is being retired anyway — delete it in step 6).

## 2. Stripe secret key + webhook secret + price IDs

1. Go to https://dashboard.stripe.com/apikeys
2. Create a NEW restricted key with only the scopes the app uses:
   - `checkout.sessions` — write
   - `billing_portal.sessions` — write
   - `payment_links` — write
   - `webhook_endpoints` — read
   - `subscriptions`, `invoices`, `customers`, `payment_intents` — read
3. Revoke the old secret key.
4. Rotate the webhook endpoint signing secret:
   - Go to https://dashboard.stripe.com/webhooks
   - Delete the old endpoint for `/stripeWebhook` and `/invoiceWebhook`
   - Create new endpoints pointing at the cloud function URLs, subscribe only the events the code handles:
     `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `payment_intent.succeeded`
   - Copy the new signing secrets.
5. Set the Firebase secrets:
   ```bash
   firebase functions:secrets:set STRIPE_SECRET_KEY
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   firebase functions:secrets:set STRIPE_PRICE_FOUNDATION
   firebase functions:secrets:set STRIPE_PRICE_PROFESSIONAL
   ```

## 3. Twilio auth token + verify service

1. Go to https://console.twilio.com/
2. Account → API keys & tokens → Roll the primary Auth Token.
3. Set in Firebase:
   ```bash
   firebase functions:secrets:set TWILIO_ACCOUNT_SID
   firebase functions:secrets:set TWILIO_AUTH_TOKEN
   firebase functions:secrets:set TWILIO_PHONE_NUMBER
   firebase functions:secrets:set TWILIO_VERIFY_SID
   ```
4. In the Twilio Console, update the SMS webhook URL for your number to `https://us-central1-nobigdeal-pro.cloudfunctions.net/incomingSMS` (the signature verification bug is fixed in this branch).
5. Set Twilio geo-permissions to **US & Canada only** so SMS pumping to international numbers is blocked at the Twilio side as well as in the Cloud Function.

## 4. Resend API key

1. https://resend.com/api-keys → create a new one named `nbd-pro-2026-04-11`
2. Delete the old one.
3. Set:
   ```bash
   firebase functions:secrets:set RESEND_API_KEY
   firebase functions:secrets:set EMAIL_FROM
   ```

## 5. Joe's notification targets

Move Joe's personal phone and email out of `verify-functions.js` hardcoded constants into secrets so they can be rotated if Joe is being spammed.
```bash
firebase functions:secrets:set JOE_NOTIFY_PHONE      # +18594207382 (for now)
firebase functions:secrets:set JOE_NOTIFY_EMAIL      # jonathandeal459@gmail.com (for now)
```
If Joe wants a dedicated alerts phone/email (recommended), set those instead.

## 6. Cloudflare Worker

**Delete the `nbd-ai-proxy` worker entirely** in the Cloudflare dashboard. The file in `workers/nbd-ai-proxy.js` has been replaced with a 410 Gone stub; pushing it will leave a safe placeholder, but the correct end state is *no worker at all*.

## 7. Firebase service account (Admin SDK)

If any Admin SDK service account credentials ever lived outside Google (local dev, CI, laptop, gist, etc.), rotate them now:
1. https://console.cloud.google.com/iam-admin/serviceaccounts?project=nobigdeal-pro
2. Find `firebase-adminsdk-*@nobigdeal-pro.iam.gserviceaccount.com`
3. Delete every key under it.
4. If you need a new one for local dev, create it and store it outside the repo.

## 8. Firebase API web key

The web `apiKey: "AIzaSy..."` embedded in every HTML page is NOT a secret — it's an identifier. Do not rotate it. Instead, restrict it:
1. https://console.cloud.google.com/apis/credentials?project=nobigdeal-pro
2. Find the `Browser key (auto created by Firebase)` entry.
3. Add HTTP referrer restrictions:
   - `https://nobigdealwithjoedeal.com/*`
   - `https://www.nobigdealwithjoedeal.com/*`
   - `https://nobigdeal-pro.web.app/*`
4. Save.

---

## After rotation

- Run `firebase deploy --only functions,firestore:rules,storage,hosting`.
- Smoke test: login flow, Stripe checkout, `/claudeProxy` call from the dashboard, a lead submission, an OTP cycle.
- Monitor billing for 24 hours — if you see any unusual Twilio or Anthropic spend, revoke keys again and investigate.

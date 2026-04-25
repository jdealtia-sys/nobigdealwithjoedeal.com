# GO LIVE — the final checklist

Everything on this list is something only **you** can do from your own
machine, because it requires credentials or console access that no
automation running inside the repo has.

**Two paths to live:**

- **Fast path (recommended):** set up GitHub Actions auto-deploy once
  (15 min), then every `git push` to main automatically deploys Firebase.
  You do Steps 0–4 once, ever, and skip Step 5 forever.
- **Manual path:** run `./scripts/deploy.sh` or `./scripts/bootstrap.sh`
  from your laptop each time. See Step 5.

Do these in order. You can stop and resume between steps. If anything
breaks, the long-form explanation is in `POST_DEPLOY_CHECKLIST.md` and
`SECRET_ROTATION.md`.

Estimated total time: **2–3 hours**. You can break it into two sessions.

> **💡 Shortcut:** after Step 0–2, you can run `./scripts/bootstrap.sh`
> which chains Steps 3 → 5 → 8 interactively (prompts you at each stage).
> The script is fully re-runnable.

---

## What's already live — no action needed

When the security branch was merged into `main`, the static half of
every improvement started serving immediately from GitHub Pages at
`www.nobigdealwithjoedeal.com`. These are ALREADY working right now:

- V2 Estimate Builder collapsible sections (catch-up section is no longer cramped)
- Chrome/Brave touch responsiveness fix (single-finger scroll works)
- New NBD Pro favicon (black + white NBD + orange PRO)
- Oaks preview hidden (noindex meta, no public links, sitemap stripped)
- Marketing site on modular Firebase SDK (ready for App Check)
- XSS sweep across dashboard/customer/vault/crm.js (escaped everywhere)
- Admin gate on the HTML side reads custom claims
- Strict-CSP-ready pages (no inline scripts on 12 small auth pages)
- Service worker v6 (auth-gated HTML never served from cache)
- Access code flow has a transitional shim so it keeps working until the
  new Cloud Function is deployed — see Step 5 below for when to remove it

## What's NOT yet live — the rest of the work

These live in the Firebase project, not GitHub Pages. You deploy them
via the Firebase CLI from your laptop.

---

## Step 0 — Prep (5 min, once)

- [ ] Install Firebase CLI and log in:
      ```bash
      npm install -g firebase-tools
      firebase login
      ```
- [ ] Pull the latest from `main`:
      ```bash
      git checkout main && git pull
      ```
- [ ] Download a service account JSON:
      Firebase Console → Project Settings → Service Accounts →
      "Generate new private key". Save it to `~/.nbd/nobigdeal-pro-sa.json`.
      **Never commit this file.**
- [ ] Set the env var (add to your shell rc if you want it persistent):
      ```bash
      export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
      ```

## Step 1 — Rotate every shared secret (30 min)

**Automated version (recommended):**

```bash
./scripts/rotate-secrets.sh
```

The script walks you through every secret one at a time. For each one it
opens the vendor dashboard URL in your browser, waits for you to paste
the new value, and pushes it to Firebase via `firebase functions:secrets:set`.
Hit ENTER to skip any secret you've already rotated.

**Manual version:** follow `SECRET_ROTATION.md` step-by-step. Assume every
secret in git history was exfiltrated during the pre-audit window and
rotate them all:

- [ ] **Anthropic**: new key at console.anthropic.com → delete old →
      `firebase functions:secrets:set ANTHROPIC_API_KEY`
- [ ] **Stripe**: new restricted API key + new webhook endpoint +
      new signing secret →
      `firebase functions:secrets:set STRIPE_SECRET_KEY`,
      `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_FOUNDATION`,
      `STRIPE_PRICE_PROFESSIONAL`
- [ ] **Twilio**: roll auth token + copy Account SID + Phone Number + Verify SID →
      `firebase functions:secrets:set TWILIO_AUTH_TOKEN`
      (plus `TWILIO_ACCOUNT_SID`, `TWILIO_PHONE_NUMBER`, `TWILIO_VERIFY_SID`)
- [ ] **Resend**: new API key →
      `firebase functions:secrets:set RESEND_API_KEY`, `EMAIL_FROM`
- [ ] **Joe contact secrets** (new since audit):
      `firebase functions:secrets:set JOE_NOTIFY_PHONE`,
      `firebase functions:secrets:set JOE_NOTIFY_EMAIL`

## Step 2 — Register Firebase App Check (15 min)

The hardened Cloud Functions all require App Check tokens from the
browser. Without this step, every call from the dashboard will return
403 after Step 5 deploys.

- [ ] Firebase Console → Project Settings → **App Check** → register
      the web app with the **reCAPTCHA Enterprise** provider.
- [ ] Copy the site key.
- [ ] Paste it into these two files and save:
  - `docs/visualizer.html` — search for `window.__NBD_RECAPTCHA_KEY__`
  - `docs/sites/js/marketing-firebase.js` — constant
    `MARKETING_RECAPTCHA_SITE_KEY`
- [ ] Commit and push the update:
      ```bash
      git add docs/visualizer.html docs/sites/js/marketing-firebase.js
      git commit -m "chore: set reCAPTCHA Enterprise site key"
      git push
      ```

## Step 3 — Run the 3 ops scripts (5 min)

```bash
node scripts/grant-admin-claim.js         # grants role:admin to Joe
node scripts/seed-access-codes.js         # seeds DEMO/NBD-2026/etc codes
node scripts/delete-compromised-users.js  # deletes 4 users with leaked passwords
```

Full docs on each script: `scripts/README.md`.

## Step 4 — Flip the console switches (10 min)

- [ ] **Firebase Auth → Settings → User actions → Email enumeration protection: ON**
- [ ] **Twilio Console → Messaging → Geo Permissions: US & Canada only**
- [ ] **Stripe → Webhooks**: delete the old webhook endpoint, create new ones
      pointing at
      `https://us-central1-nobigdeal-pro.cloudfunctions.net/stripeWebhook`
      and
      `https://us-central1-nobigdeal-pro.cloudfunctions.net/invoiceWebhook`.
      Copy the NEW signing secrets into Firebase secrets (if you haven't
      already in Step 1).
- [ ] **Google Cloud Console → APIs & Credentials → Browser API key**:
      add HTTP referrer restrictions for `nobigdealwithjoedeal.com`,
      `www.nobigdealwithjoedeal.com`, `nobigdeal-pro.web.app`.
- [ ] **Cloud Billing → Budgets**: set a $50/day budget on the project
      with email alert to you.

## Step 5 — Deploy (10 min)

**Automated path — set up GitHub Actions once, then every push deploys:**

1. Firebase Console → Project Settings → Service accounts → "Generate
   new private key" → download the JSON.
2. GitHub repo → Settings → Secrets and variables → Actions → "New
   repository secret":
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: paste the ENTIRE JSON file contents (open it in a text
     editor and copy all of it).
3. Delete the downloaded JSON from your laptop — it's safely in
   GitHub Secrets now.
4. Push to main to trigger the first deploy, OR go to
   GitHub → Actions → "Firebase deploy" → "Run workflow" for a
   manual trigger. Either way, the ordered firebase-deploy sequence
   runs in GitHub's infrastructure, not your laptop.

After this one-time setup, every `git push` to main auto-deploys. You
never need to run `firebase deploy` by hand again.

**Manual path:** From the repo root:

```bash
./scripts/deploy.sh
```

This runs, in order:
1. `firebase deploy --only firestore:rules`
2. `firebase deploy --only storage`
3. `firebase deploy --only functions`
4. `firebase deploy --only hosting` (pushes the `firebase.json` header
    rules so strict CSP / HSTS / X-Robots-Tag / CORS actually take effect)
5. `firebase deploy --only firestore:rules --project nobigdealwithjoedeal`
    (the marketing project — separate from the pro project)

**After the deploy succeeds (either path), the transitional shim in
`docs/pro/js/pages/login.js` should be removed.** Search for the big
`Transitional compat shim` comment block inside `doCodeLogin` and
`doDemoLogin` and delete the `data.email && data.password` branches.
Commit + push + it auto-deploys. This is optional — the shim is harmless
once the new function is live, but it's dead code.

## Step 6 — Delete the Cloudflare Worker (2 min)

Cloudflare Dashboard → Workers & Pages → `nbd-ai-proxy` → Delete.

The repo has a 410-Gone stub committed as a safety net, but the clean
end state is no worker at all.

## Step 7 — Import monitoring alert policies (10 min)

Find your Cloud Monitoring notification channel ID:

```bash
gcloud alpha monitoring channels list --project=nobigdeal-pro
```

Copy the ID (looks like `projects/nobigdeal-pro/notificationChannels/12345...`).
Edit each file in `monitoring/*.json` and replace `NOTIFICATION_CHANNEL_ID`
with that full path. Then:

```bash
for policy in monitoring/alert-*.json; do
  gcloud alpha monitoring policies create \
    --policy-from-file="$policy" --project=nobigdeal-pro
done
```

Four policies will be created (brute force, function errors, Claude
budget, rate-limit denial spike).

## Step 8 — Smoke tests on production (15 min)

**Automated path:**

```bash
./scripts/verify-deploy.sh
```

Runs all the Cloud-Function + hosting-header + oaks-hiding probes for
you and prints pass/fail with exit code. Safe to run anytime, read-only.

**Manual path:** run these by hand. Every one should FAIL — if any of
them succeed, stop and investigate before going further.

- [ ] **Admin takeover attempt**:
      ```bash
      curl -X POST https://us-central1-nobigdeal-pro.cloudfunctions.net/validateAccessCode \
        -H 'Content-Type: application/json' \
        -d '{"data":{"code":"NBD-ADMIN"}}'
      ```
      → should return 403 (App Check missing) or `not-found`. NOT a success.

- [ ] **seedDemoData deleted**:
      ```bash
      curl -X POST https://us-central1-nobigdeal-pro.cloudfunctions.net/seedDemoData
      ```
      → 404.

- [ ] **Self-promote to admin blocked**: register a free account, open
      devtools, run:
      ```js
      setDoc(doc(db,'users',auth.currentUser.uid),{role:'admin'},{merge:true})
      ```
      → PERMISSION_DENIED.

- [ ] **Self-grant Pro subscription blocked**:
      ```js
      setDoc(doc(db,'subscriptions',auth.currentUser.uid),{plan:'professional',status:'active'})
      ```
      → PERMISSION_DENIED.

- [ ] **Cross-tenant lead read blocked**:
      ```js
      getDocs(collection(db,'access_codes'))
      ```
      → PERMISSION_DENIED.

- [ ] **Auth gate works**: log in as you, open `/admin/vault.html` → loads.

- [ ] **Offline shell blocked**: sign out, go offline, reload
      `/pro/dashboard.html` → offline page, NOT a cached dashboard.

- [ ] **Stripe checkout end-to-end**: fresh account → pick a plan →
      complete Stripe test checkout → webhook activates subscription →
      success page flips to "done".

## Step 9 — Watch for 24 hours

- [ ] Cloud Billing usage hourly
- [ ] Twilio usage dashboard
- [ ] Anthropic usage dashboard
- [ ] Cloud Logging filtered to `severity>=WARNING`
- [ ] Cloud Monitoring alert policies (should stay green)

If anything spikes, rotate the affected secret immediately and
investigate in logs.

---

## Done.

Once all 9 steps are checked and the 24h watch period is clean, the
site is fully hardened end-to-end. From here, normal hygiene applies:
rotate secrets every 90 days, bump dependencies monthly, pen-test once
a year, keep an eye on the Cloud Monitoring alerts.

All long-term follow-ups live in `POST_DEPLOY_CHECKLIST.md §14`. None of
them are vulnerabilities — just polish.

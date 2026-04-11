# Post-Deploy Checklist — NBD Pro Security Fixes

Ship this checklist end-to-end on the day of deploy. Do not merge to `main` until every box is checked.

## 1. Pre-deploy

- [ ] Read `SECURITY_BATTLE_PLAN.md` end to end.
- [ ] Read `SECRET_ROTATION.md` and rotate every secret listed there.
- [ ] `cd functions && npm install` (picks up any new dependencies).
- [ ] `cd tests && npm install && npm test` — firestore rules unit tests must pass. Do NOT deploy if they fail.

## 2. Grant yourself (Joe) the admin custom claim

Admin access is no longer a Firestore field. It is a custom claim set via the Admin SDK. Run this ONCE from your dev machine (needs a service-account key):

```bash
node -e "
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault() });
(async () => {
  const user = await admin.auth().getUserByEmail('jd@nobigdealwithjoedeal.com');
  await admin.auth().setCustomUserClaims(user.uid, { role: 'admin' });
  console.log('admin claim set for', user.uid);
  process.exit(0);
})();
"
```

Then sign out and back in on `admin/login.html` to pick up the claim.

## 3. Seed `access_codes` in Firestore

The hardcoded access code list in the old `validateAccessCode` is gone. The new function reads codes from the `access_codes` collection. Bootstrap the ones you want to keep:

```bash
node -e "
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();
const codes = {
  'NBD-DEMO':  { active: true, email: 'demo@nobigdeal.pro', role: 'member', plan: 'foundation', trialDays: 14,  displayName: 'Demo User' },
  'DEMO':      { active: true, email: 'demo@nobigdeal.pro', role: 'member', plan: 'foundation', trialDays: 14,  displayName: 'Demo User' },
  'NBD-2026':  { active: true, email: 'invite.2026@nobigdeal.pro', role: 'member', plan: 'foundation', trialDays: 90, displayName: 'Beta Member' },
  'ROOFCON26': { active: true, email: 'invite.2026@nobigdeal.pro', role: 'member', plan: 'foundation', trialDays: 90, displayName: 'Beta Member' }
};
(async () => {
  for (const [code, data] of Object.entries(codes)) {
    await db.doc('access_codes/' + code).set(data);
    console.log('seeded', code);
  }
  process.exit(0);
})();
"
```

The old `NBD-ADMIN` and `NBD-JOE` codes are intentionally NOT seeded. Admin access must go through `setCustomUserClaims` above.

## 4. Deploy in this order

```bash
# 1. Rules first so the client can't exploit anything while functions roll out.
firebase deploy --only firestore:rules
firebase deploy --only storage

# 2. Functions (picks up the new secrets)
firebase deploy --only functions

# 3. Hosting (static site + new CSP headers)
firebase deploy --only hosting
```

## 5. Delete the old stuff

- [ ] In Firebase Console → Functions, delete any lingering `seedDemoData` if the deploy missed it.
- [ ] In Cloudflare → Workers, delete the `nbd-ai-proxy` worker entirely (the repo stub returns 410 as a safety net).
- [ ] In Firebase Console → Authentication → Users, **delete the following service users** created by the old `validateAccessCode`: `demo@nobigdeal.pro`, `vip@nobigdeal.pro`, `admin@nobigdeal.pro`, `invite.2026@nobigdeal.pro`. They were created with a stable leaked password and anyone who has the hash can still sign in. Let them be recreated on demand by the new flow.
- [ ] Force-expire all existing Firebase sessions: `admin.auth().revokeRefreshTokens(uid)` for every existing user, or flip the project's password-reset requirement.

## 6. Turn on the Firebase Console switches

- [ ] **App Check** — Project Settings → App Check → register the web app with **reCAPTCHA Enterprise**. Enforce App Check on every Cloud Function. Enable debug token on localhost for dev.
- [ ] **Authentication → Settings → User actions → Email enumeration protection**: ON.
- [ ] **Authentication → Settings → Authorized domains**: remove any domains you don't control.
- [ ] **Firestore → Usage → Budgets**: set budget alert at $25/day.
- [ ] **Cloud Billing → Budgets**: add a $50/day project-wide budget alert (email + SMS to Joe).
- [ ] **Google Cloud Console → APIs & Services → Credentials → Browser API key**: add HTTP referrer restriction to the three domains (see SECRET_ROTATION.md #8).

## 7. Twilio A2P 10DLC + geo-permissions

- [ ] Verify A2P 10DLC campaign is still active.
- [ ] Messaging Geo Permissions → allow **US & Canada only**. Deny everything else.

## 8. Smoke tests (on production, after deploy)

Run these as a freshly-registered free user, a paid user, and an admin:

- [ ] Free register → dashboard loads → `subscriptions/{uid}` is NOT writable from devtools.
- [ ] Free register → `setDoc(doc(db,'users',uid),{role:'admin'})` → PERMISSION_DENIED.
- [ ] Free register → `getDocs(collection(db,'access_codes'))` → PERMISSION_DENIED.
- [ ] `curl POST /seedDemoData` → 404.
- [ ] `curl POST /validateAccessCode '{"data":{"code":"NBD-ADMIN"}}'` → 403 (App Check missing) or `not-found`.
- [ ] `curl POST /incomingSMS` with an invalid signature → 403.
- [ ] `curl GET /imageProxy?path=photos/<someone_else>/x.jpg` with your ID token → 403.
- [ ] `curl GET https://nbd-ai-proxy.<acct>.workers.dev` → 410 (or 404 if you deleted the worker).
- [ ] Ask-Joe AI works for a paid user → `api_usage` doc appears → 30 calls in 1 min → 429.
- [ ] Stripe checkout works for a paid user → webhook creates `subscriptions/{uid}` → audit_log entry exists.
- [ ] Public estimate form submits → contact_leads doc is created → cannot be read by a free user.
- [ ] Admin vault loads only after setting custom claim.

## 9. 24-hour monitoring

- [ ] Watch Cloud Billing hourly for 24h.
- [ ] Watch Cloud Logging for the functions — filter by `severity=ERROR`.
- [ ] Watch Twilio spend dashboard for 24h.
- [ ] Watch Anthropic usage dashboard for 24h.
- [ ] If any spend spike > $25/hour, revoke keys again and investigate.

## 10. Phase-2 items (landed in the same branch)

- **innerHTML sweep** — every stored-XSS-reachable sink in `dashboard.html`, `customer.html`, `pro/vault.html`, and `docs/pro/js/crm.js` (notifications list = the incoming-SMS pivot) is now escaped via `window.nbdEsc`. Inline `onclick` handlers replaced with `addEventListener` so strict CSP can drop `'unsafe-inline'` in a future follow-up.
- **visualizer.html rebuild** — now calls a new `publicVisualizerAI` Cloud Function protected by App Check + per-IP rate limit (5/hour), model locked to Haiku, max_tokens 800, system prompt server-owned. Set `window.__NBD_RECAPTCHA_KEY__` in a script before the App Check bootstrap (or hard-code it in the `<head>`) to enable the endpoint. Until the key is set, the visualizer falls through to the canned fallback assessment.
- **sw.js** — now refuses to cache or serve auth-gated HTML (`/pro/dashboard.html`, `customer.html`, `vault.html`, `login.html`, `register.html`, `admin/**`, etc). A logged-out user can no longer see a stale cached dashboard. Cache versions bumped to `v5`.
- **Marketing site (`nobigdealwithjoedeal` project)** — a separate `marketing-site-firestore.rules` file has been added at the repo root. Deploy it against the marketing project with `firebase deploy --only firestore:rules --project nobigdealwithjoedeal`. This only allows `create` on `leads` with strict shape + size checks, and denies everything else.

### Phase-2 deploy steps

After completing sections 1–9 above, also do:

- [ ] `firebase deploy --only firestore:rules --project nobigdealwithjoedeal` from a directory pointing at `marketing-site-firestore.rules`.
- [ ] Register App Check with reCAPTCHA Enterprise for the `nobigdeal-pro` project and get the site key.
- [ ] Edit `docs/visualizer.html` and hard-code the reCAPTCHA site key in the `window.__NBD_RECAPTCHA_KEY__` script tag (or add it as a separate script before the module bootstrap), then redeploy hosting. Until this is done, the visualizer AI will silently fall back to the canned assessment.
- [ ] `firebase deploy --only functions:publicVisualizerAI` to ship the new public visualizer endpoint.
- [ ] Test the visualizer end-to-end: upload a photo, confirm the AI text comes back. Confirm 6th call from the same IP in an hour returns a 429.
- [ ] Test logging out of the dashboard, reloading `/pro/dashboard.html` with the tab offline → should get the offline page, NOT a stale cached dashboard.
- [ ] Re-run the XSS smoke tests on the dashboard and customer pages: create a lead with `firstName` = `"<img src=x onerror=alert(1)>"`, create a note with the same payload, add a contact_lead via the public form with `firstName` containing HTML → none should execute.

## 11. Phase-3 items (landed after phase-2)

- **SW kill-switch upgrade** — `docs/pro/sw.js` now actively deletes any auth-gated HTML cached in surviving cache versions on activate, claims all clients, and posts `SW_UPDATE_AVAILABLE` with the version. `docs/pro/js/offline-manager.js` catches the message and force-reloads any open tab sitting on an auth-gated path (once per activation, via a `sessionStorage` flag so you don't get a reload loop). On rollout, every existing tab will do one clean reload and pick up the new shell.

- **Admin-page innerHTML sweep** — `admin/analytics.html` and `admin/project-codex.html` now escape every rendered field. The search `highlight()` function in project-codex.html is the one I want you to look at — it escapes the raw text first, then re-inserts highlight spans via sentinel tokens. Can't be smuggled.

- **Offline page** — `docs/offline.html` rewritten to match the new SW behaviour (auth-gated HTML is never served from cache, auto-reload on reconnect).

- **Rate-limit tests** — `tests/rate-limit.test.js` runs against the emulator. Covers per-key / per-namespace isolation, window reset, burst enforcement, and deterministic hashing. Run with `cd tests && npm run test:ratelimit`.

- **Structured logging sweep** — `email-functions.js` / `sms-functions.js` / `verify-functions.js` no longer use `console.log`/`warn`/`error`; every event goes through `firebase-functions/v2` logger with a stable event name (`otp_sent`, `rate_limit_denied`, `claudeProxy error`, etc). Cloud Logging can now filter by `jsonPayload.message`.

- **Cloud Monitoring alert policies** — `monitoring/*.json` + `monitoring/README.md`. Four policies ready to import:
  1. `alert-validateAccessCode-bruteforce.json` — fires on `access_code_invalid` spikes
  2. `alert-functions-error-rate.json` — fires on Cloud Function ERROR log spikes
  3. `alert-claude-budget-exceeded.json` — fires when a user trips the daily token budget
  4. `alert-rate-limit-spike.json` — fires on `rate_limit_denied` spikes (the rate-limit helper now emits this event name)
  Replace `NOTIFICATION_CHANNEL_ID` in each JSON with Joe's channel ID, then `gcloud alpha monitoring policies create --policy-from-file=monitoring/<file>.json`.

- **Stray empty file removed** — `functions/{const` deleted.

- **Report-only strict CSP** — added a `Content-Security-Policy-Report-Only` header alongside the enforced CSP. The report-only version drops `'unsafe-inline'` from `script-src`, adds `script-src-attr 'none'`, and drops `'unsafe-inline'` from `style-src`. Browsers will log a console violation for every inline handler / inline script that still needs migration, **without blocking anything**. Use this to triage what's left before flipping it to the enforced CSP in a future follow-up.

### Phase-3 deploy steps

After completing sections 1–10:

- [ ] `cd tests && npm install && npm run test:ratelimit` — both rate-limit and rules tests should pass before deploy.
- [ ] `firebase deploy --only functions,hosting` to ship the sw.js upgrade + structured logs.
- [ ] For each Cloud Monitoring alert policy: list notification channels (`gcloud alpha monitoring channels list --project=nobigdeal-pro`), edit the JSON to replace `NOTIFICATION_CHANNEL_ID`, then `gcloud alpha monitoring policies create --policy-from-file=monitoring/<file>.json`.
- [ ] Open the dashboard in a real browser with devtools open → watch for CSP-Report-Only violations. Each one is a remaining inline script/handler that needs to be migrated before flipping the enforced CSP to strict. Track them in a follow-up ticket.
- [ ] Smoke test the SW upgrade: on an already-signed-in browser, deploy, then reload. Should do one automatic reload and land on the new shell.

## 12. Still open (documented, not blocking this deploy)

- **Rate limits on Firestore** — the rate-limit helper still reads/writes `_rate_limits_ip/*` in Firestore. Under 10k users/hour this will cost a few extra ms per call. Migrate to Upstash Redis or Memorystore when you have bandwidth.
- **Full inline-script removal** — the CSP enforces `'unsafe-inline'` today. The new Report-Only CSP header will give you a full list of violations in devtools console. Next follow-up: move every inline `<script>` block + `onclick=` attribute to external files with per-deploy nonces, then flip the Report-Only directive into the enforced one and delete the enforced `'unsafe-inline'`. ~375 onclick handlers remain in dashboard.html alone; plan for a focused half-day sprint.
- **Populate `functions/data/zip-to-county.json`** with the full zip→county map for every service area before re-enabling storm alerts.
- **`docs/pro/js/_archive/` directory** — 33 legacy JS files, ~1.1 MB, not loaded by any current HTML. Can be deleted once you're confident nothing references them.
- **Marketing site modular SDK migration** — `docs/sites/**` still uses the `compat` Firebase SDK. Migrate to the modular SDK so App Check can be attached to marketing-site form submissions.

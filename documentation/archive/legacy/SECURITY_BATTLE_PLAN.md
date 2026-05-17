# NBD Pro — Security Battle Plan

**Status:** Waves 0–7 shipped. Second audit sweep (2026-04-14)
landed F-01..F-10 + Q1/Q4/Q5/Q6 + M2/M3/M4 + Q2/Q3 on branch
`claude/security-infrastructure-review-5GRpD` — see
[SECURITY_SWEEP_2026-04-14.md](SECURITY_SWEEP_2026-04-14.md) for
the delta summary. This file is retained as the original Wave
0–7 plan; new findings are tracked in the sweep doc.

**Scope:** P0 + P1 + P2 from the 2026-04-10 audit, across three projects
 - `nobigdeal-pro` (the `/pro` SaaS app + Cloud Functions)
 - `nobigdealwithjoedeal` (the marketing site in `docs/sites/`, `docs/index.html`)
 - `nbd-ai-proxy` Cloudflare Worker

**Ground rules**
 - "Cut first, patch after" — we break validateAccessCode / seedDemoData / the CF worker immediately, then ship hardened replacements.
 - Joe (`jd@nobigdealwithjoedeal.com`) is the only admin. Nothing else gets the admin role.
 - Every fix must land in code on this branch; anything that can only be done in the Firebase/Stripe/Twilio/Cloudflare consoles goes into `POST_DEPLOY_CHECKLIST.md` for Joe.
 - We rotate every shared secret at the end of Wave 7 and assume everything was already exfiltrated.

---

## Wave 0 — Freeze & inventory (in progress, tracked in todos)

- Create SECURITY_BATTLE_PLAN.md (this file).
- Open TodoWrite list mirroring the waves below.
- Create two runbooks that Joe has to execute manually:
  - `SECRET_ROTATION.md` — every secret that needs to be rotated + console steps.
  - `POST_DEPLOY_CHECKLIST.md` — Firebase Console switches, App Check registration, Cloudflare Worker deletion, admin custom-claim assignment.

## Wave 1 — Stop the admin takeover (CRITICAL — ship first)

**Goal:** no unauthenticated or low-privilege client can become admin or paid, and no free user can read other tenants' data.

1. `functions/index.js`
   - **Delete** `exports.validateAccessCode`. Replace with a hardened version that
     - looks codes up in `access_codes/{CODE}` via admin SDK (no hardcoded list),
     - rate-limits per-IP in `rate_limits_ip/{hashedIp}` (admin-only collection),
     - issues a custom token with `admin.auth().createCustomToken(uid, { role })` — never returns a password,
     - never grants `role: 'admin'` via access code. Admin is hand-set via CLI only.
   - **Delete** `exports.seedDemoData`.
   - Harden `exports.setStorageCors` — require `request.auth.token.role === 'admin'` via custom claims.
   - Remove the `bypassEmails` list in `claudeProxy`. Use `request.auth.token.role` instead.
2. `firestore.rules` — full rewrite
   - `users/{uid}`: `allow update: if isOwner(uid) && !diff.affectedKeys().hasAny(['role','plan','accessCode'])`; create defaults `role: 'member'` enforced.
   - `subscriptions/{uid}`: read only; `allow write: if false` (only admin SDK via webhook writes).
   - `rate_limits/{uid}`: `allow read, write: if false;`
   - `access_codes/{id}`: `allow read, write: if false;`
   - Broad-read collections (`reps`, `companies`, `territories`, `email_log`, `sms_log`, `drip_log`, `drip_queue`, `reports`, `referrals`, `review_requests`, `leaderboard`, `contact_leads`, `guide_leads`, `estimate_leads`, `storm_alert_subscribers`) get scoped to the caller's `userId`/`companyId`.
   - `companies/{id}/members/{m}`: writable only by the company `ownerId`.
   - Public write collections (`contact_leads`, `guide_leads`, `estimate_leads`, `storm_alert_subscribers`) keep `allow create` with tight shape checks, `allow read/update/delete: if false`.
   - Default deny at the bottom stays.
3. `storage.rules` — full rewrite
   - `portals/`, `deal_rooms/`, `galleries/`, `reports/`, `shared_docs/` lose `allow read;`. Reads happen via signed download URLs (Cloud Function or client SDK with a token).
   - `photos/{uid}/{allPaths=**}` — read only if caller owns the path or is in the same company.
   - Remove the generic `docs/{allPaths=**}` wildcard.
4. `docs/admin/vault.html` + `docs/admin/login.html` + `docs/admin/analytics.html` + `docs/admin/project-codex.html`
   - Switch the admin gate to `await user.getIdTokenResult(true)` and check `result.claims.role === 'admin'`.
   - Remove `user.email === 'demo@nobigdeal.pro'` escape hatch.
   - Fix `docs/admin/login.html` broken password field — use a real email+password pair.
5. `docs/pro/register.html`
   - Stop writing `subscriptions/*` from the client entirely. Sign-up creates the auth user + a profile doc with `role: 'member'` only; the subscription is written by a new `onCreate` trigger or by the Stripe webhook.
   - Stop reading `access_codes` from the client. Validate codes by calling the new `validateAccessCode` (hardened) which returns a custom token.
   - Same treatment for the Google sign-up flow.

**Verification for Wave 1**
 - `curl` the deployed `validateAccessCode` with `{"data":{"code":"NBD-ADMIN"}}` → returns `success:false, error:'Code not recognized'`.
 - From a brand-new Firebase account, `setDoc(doc(db,'users',uid),{role:'admin'})` throws `PERMISSION_DENIED`.
 - From a brand-new account, `setDoc(doc(db,'subscriptions',uid),{plan:'professional',status:'active'})` throws `PERMISSION_DENIED`.
 - From a brand-new account, `getDocs(collection(db,'access_codes'))` throws.
 - `POST /seedDemoData` → 404.
 - Cloud Function logs show `validateAccessCode` calls are rate-limited per IP after 5 tries/min.

## Wave 2 — Plug the data-extraction and RCE pivots

1. `functions/sms-functions.js`
   - Replace `twilio.webhook(authToken, sig, url, params.toString())` with `twilio.validateRequest(authToken, sig, url, params)` (boolean) at `incomingSMS:376`.
   - Parse with `req.rawBody` + `express.urlencoded({ extended: false })` and feed the same object to `validateRequest`.
   - Escape incoming `Body`/`From` before storing — but do NOT rely on server escaping; the dashboard must also render via `textContent`.
2. `functions/index.js` `imageProxy`
   - Require `filePath` to begin with `photos/{decoded.uid}/` OR, for team paths, look up the owning Firestore doc and check caller's `companyId`.
   - Reject any `%2e`, `..`, `//`, `;`, `\0` in the path.
3. Add a shared `rateLimit(ip, fnName, limit, windowMs)` helper in a new `functions/rate-limit.js` and call it at the top of every `onRequest`/`onCall`.
4. Enable `enforceAppCheck: true` on every callable and public HTTP function (`validateAccessCode`, `claudeProxy`, `sendVerificationCode`, `verifyCode`, `notifyNewLead`, `sendEmail`, `sendEstimateEmail`, `sendSMS`, `sendD2DSMS`, `sendTeamInviteEmail`, `imageProxy`, `createCheckoutSession`, `createCustomerPortalSession`, `getSubscriptionStatus`, `createStripePaymentLink`).
   - `stripeWebhook` and `invoiceWebhook` stay App-Check-off; they are Stripe → server.
   - `incomingSMS` stays App-Check-off; it is Twilio → server (with validated signature now).

**Verification for Wave 2**
 - Forged `incomingSMS` POST without a valid Twilio signature → 403.
 - `imageProxy` with someone else's `photos/<otheruid>/...` path → 403.
 - Call any AI function from `curl` without App Check token → 403.

## Wave 3 — Kill the cost bombs

1. `workers/nbd-ai-proxy.js`
   - Option A (preferred): delete the worker entirely and point every caller at `claudeProxy`.
   - Option B: require `Authorization: Bearer <Firebase ID token>`, verify via Firebase Admin JWKs inside the worker, subscription-gate in the same way, exact-match origin allowlist (no `startsWith`, no empty-origin bypass), per-uid rate limit in Cloudflare KV.
   - For this branch: ship Option A and leave a stub worker that returns 410 Gone.
2. `functions/verify-functions.js` + `functions/sms-functions.js` + `functions/email-functions.js`
   - Add per-IP and per-uid rate limit (shared helper).
   - `notifyNewLead` → require `verified === true` (OTP-verified phone) before sending SMS to Joe; otherwise just email.
   - Move `JOE_PHONE`/`JOE_EMAIL` to secrets.
   - `sendVerificationCode`: allowlist to US numbers only (block +44, +234, and every known SMS-pumping prefix) — SMS-pumping prevention.
3. `functions/sms-functions.js` `checkStormAlerts`
   - Implement actual NWS zip-to-area matching. Build a map of `{zip → county/city name}` (static JSON in `functions/data/zip-to-county.json`) and only send to subscribers whose county/city matches `alert.properties.areaDesc`.
   - Move Twilio sends into Cloud Tasks / `p-limit` with concurrency 1 req/sec per number to respect Twilio rate limits.
4. `claudeProxy` — drop Opus from `ALLOWED_MODELS`, cap `max_tokens` at 1024 (not 4096), hard cost-cap per uid per day (`api_usage` sum, writable via admin SDK only).

**Verification for Wave 3**
 - `curl` the new Cloudflare Worker → 410.
 - `notifyNewLead` without `verified:true` → no SMS to Joe, email only.
 - Spam 10 `sendVerificationCode` calls from the same IP → 429 after N.
 - Load the storm alert function with a non-matching zip → no SMS sent.

## Wave 4 — XSS, CSP, headers

1. `docs/pro/js/dom-safe.js` (new)
   - Exports `esc(s)`, `safeHTML(strings, ...values)`, `setText(el, s)`.
2. `docs/pro/dashboard.html` (51 innerHTML sinks), `docs/pro/customer.html` (49), `docs/pro/vault.html` (35), `docs/pro/ai-tool-finder.html`, `docs/pro/ai-tree.html`, `docs/pro/analytics.html`, `docs/pro/leaderboard.html`, `docs/pro/project-codex.html`, `docs/pro/understand.html`, `docs/pro/ask-joe.html`, `docs/pro/diagnostic.html`
   - Audit each sink. If the value is user-controlled (lead, photo, note, SMS body, address, name, template), route it through `esc()` or use `textContent` / `createElement`.
   - Add unit-style smoke test: create a lead with name `"<img src=x onerror=alert(1)>"` and load the dashboard — no alert should fire.
3. `firebase.json` headers
   - Add CSP (strict, self + gstatic + firebase + stripe + googleapis + recaptcha; `object-src 'none'; base-uri 'none'; frame-ancestors 'none'`).
   - Add `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`.
   - Override cache to `no-store` for `pro/dashboard.html`, `pro/vault.html`, `admin/**/*.html`, `pro/login.html`, `pro/register.html`.
4. `docs/pro/sw.js`
   - Do not cache authenticated HTML pages. Bump version so stale shells are purged.

**Verification for Wave 4**
 - Inject `<img onerror=alert(1)>` into a lead name → dashboard renders it literally.
 - `curl -I https://nobigdealwithjoedeal.com/pro/dashboard.html` shows CSP + HSTS + COOP + no-store.

## Wave 5 — Stripe / webhook hardening

1. `functions/index.js`
   - `createStripePaymentLink`: recompute totals from a server-side `products/{productId}` lookup. Attach `payment_intent.metadata.invoiceId` + `userId`.
   - `createCheckoutSession`: require `decoded.email_verified === true`. Persist `stripeCustomerId` before checkout (so race conditions don't lose it).
   - `invoiceWebhook`: verify `metadata.invoiceId` matches an existing invoice + `metadata.userId` matches the invoice's `createdBy` before marking paid.
2. `docs/pro/stripe-success.html`
   - Never trust the `session_id` query param — verify via `getSubscriptionStatus` Cloud Function, and only show success if Firestore shows `status: 'active'`.

**Verification for Wave 5**
 - Create an invoice with a manipulated `items[0].total`, call `createStripePaymentLink` → function ignores the client value and charges the server-side catalog price.

## Wave 6 — Observability, audit, load scaling

1. `functions/audit-log.js` (new)
   - Firestore triggers on `subscriptions/{uid}`, `users/{uid}`, `invoices/{id}`, `companies/{id}`, `access_codes/{id}` → writes an immutable `audit_log/{autoId}` record.
   - Rule: `audit_log` is `allow read: if isAuth() && request.auth.token.role == 'admin'; allow write: if false;`
2. `functions/index.js` and siblings
   - Add `minInstances: 1`, `concurrency: 80`, raise `maxInstances: 100` on `claudeProxy`, `createCheckoutSession`, `imageProxy`.
   - Structured logs via `functions.logger` with `{ route, uid, ip, status }` fields.
3. `functions/package.json`
   - Add `@google-cloud/logging`, `express-rate-limit` (if we end up with an Express shim), `helmet` (for the Express shim on onRequest routes).

**Verification for Wave 6**
 - Update a subscription via Stripe webhook → new row in `audit_log`.
 - Load test: 100 concurrent `claudeProxy` calls → no cold-start 429.

## Wave 7 — Rules tests, secret rotation, runbooks

1. `tests/firestore-rules.test.js` (new, Node)
   - Uses `@firebase/rules-unit-testing`.
   - Covers: user cannot self-promote to admin, cannot self-write subscription, cannot read other tenant's `reps`/`leads`/`email_log`, public create on `contact_leads` works, public create on `estimate_leads` requires size limits, `rate_limits` not writable by client.
2. `tests/storage-rules.test.js` (new)
   - Covers: public read on `portals/*` denied; signed URL path works; cross-uid photo read denied.
3. `SECRET_ROTATION.md` (new)
   - Exact steps to rotate Anthropic, Stripe (secret + webhook), Twilio (auth token + verify SID), Resend, Firebase service account.
4. `POST_DEPLOY_CHECKLIST.md` (new)
   - `firebase deploy --only firestore:rules,storage,functions,hosting`
   - Delete the Cloudflare worker in the Cloudflare dashboard.
   - Run `gcloud auth set-custom-claims` (or a one-off Node script) to grant `role: admin` to Joe's uid.
   - Enable Firebase Auth email-enumeration protection.
   - Register App Check providers (reCAPTCHA Enterprise for web).
   - Set Cloud Billing budget alert at $50/day.

**Verification for Wave 7**
 - `npm test --prefix functions` runs firestore-rules unit tests green.
 - Joe checks off each item in POST_DEPLOY_CHECKLIST.md.

---

## Post-wave: commit + push

Everything above lands in one branch (`claude/security-audit-stress-test-EuTga`) as a series of commits, one per wave. Push with `git push -u origin claude/security-audit-stress-test-EuTga`. Do NOT open a PR — Joe has to review and merge.

## Out of scope for this branch (flag for a follow-up)

 - Migrate the marketing site (`nobigdealwithjoedeal` project) off its own Firebase config. Currently it uses a separate API key with unknown rules. The marketing site has public forms and the same hardening rules should apply, but it has its own `firebase.json` + rules we didn't find in this repo.
 - Replace the `rate_limits` Firestore counter with Upstash Redis or Memorystore.
 - Migrate the PWA (`docs/pro/sw.js`) to a proper service worker with auth-aware caching.
 - Real WAF (Cloudflare in front of all Cloud Function endpoints).

---

## Execution log

We append to this section as work lands. Each entry: `YYYY-MM-DD HH:MM — wave N — what changed — what files`.

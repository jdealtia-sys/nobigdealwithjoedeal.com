# Security Policy

We take security seriously. Find a bug before an attacker does and we'll fix it fast.

## Reporting a vulnerability

**Preferred:** email `security@nobigdealwithjoedeal.com` with the subject line `[NBD Pro Security]`.
Include a description, reproduction steps, and your assessment of impact.

**For GitHub users:** if the repo is public, you can open a private vulnerability report
via `Security → Report a vulnerability`. Do NOT open a regular Issue — those are public.

**Response SLA:**

| Severity                  | First response | Fix target                 |
| ------------------------- | -------------- | -------------------------- |
| Critical (RCE, auth bypass, data breach) | 24 hours  | ≤ 7 days            |
| High (privilege escalation, PII leak)    | 3 days    | ≤ 30 days           |
| Medium / Low              | 1 week         | Best-effort                |

We do not currently run a paid bounty program but we will publicly credit
responsible reporters in the release notes for the fix (with permission).

## In scope

- **Firebase project:** `nobigdeal-pro`
- **Production domains:** `nobigdealwithjoedeal.com`, `www.nobigdealwithjoedeal.com`, `nbd-pro.web.app`
- **Cloud Functions:** everything under `functions/` — public endpoints and callables
- **Firestore rules:** `firestore.rules`
- **Storage rules:** `storage.rules`
- **Client auth + role handling:** `docs/pro/js/nbd-auth.js`, `docs/pro/js/admin-manager.js`
- **Homeowner portal:** `docs/pro/portal.html` + `getHomeownerPortalView` / `createPortalToken`
- **Webhooks:** `stripeWebhook`, `invoiceWebhook`, `esignWebhook`, `calcomWebhook`,
  `measurementWebhook`, `incomingSMS`

## Out of scope

- Theoretical attacks that require physical access to a signed-in device
- DoS that requires 10k+ concurrent clients (we rely on Firebase quota + Upstash rate limits)
- Third-party vendor vulnerabilities (report directly to HOVER / BoldSign / Regrid / etc.
  — we'll coordinate if their issue affects us)
- Social engineering the on-call engineer
- Missing security headers on third-party iframes we embed (Cal.com, BoldSign)

## Current security posture (for researchers)

- **Auth:** Firebase Auth + custom-claim roles (`admin`, `company_admin`, `manager`, `sales_rep`, `viewer`).
  `admin` is platform-global and NEVER grantable through any UI path — only via
  `scripts/grant-admin-claim.js` run manually.
- **App Check:** every callable + onRequest function declares `enforceAppCheck: true`.
  Site key is set in `window.__NBD_APP_CHECK_KEY`.
- **Firestore rules:** default-deny, explicit per-collection allowlists. Rules tests in
  `tests/firestore-rules.test.js` run on every PR.
- **Storage rules:** content-type + size + owner enforcement per path.
- **Rate limiting:** Upstash-first adapter with Firestore fallback. Every mutation callable
  has a per-uid cap (`callableRateLimit`).
- **Audit log:** every write to `users/`, `leads/`, `companies/`, `access_codes/`,
  `subscriptions/` triggers a redacted entry in `audit_log/`. Platform-admin-read only.
- **GDPR:** Article 20 export (`exportMyData`) + Article 17 two-step erasure
  (`requestAccountErasure` + `confirmAccountErasure`).
- **Session hygiene:** new-device sign-in fires a Slack alert via
  `registerDeviceFingerprint` + `user_devices/{uid}/seen/{hash}`.
- **Secrets:** all API keys live in Firebase Secret Manager. Never in the repo.
  Secret inventory in `scripts/deploy-runbook.sh`.

## Key rotation

### Routine (every 90 days)

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase deploy --only functions
```

After deploy, revoke the old key on the vendor dashboard (Stripe, Anthropic, etc.).

### Under suspected compromise (any secret)

1. Rotate the secret immediately via the vendor dashboard.
2. Run `scripts/deploy-runbook.sh` with the new value.
3. From an admin session, call `rotateAccessCodes` to kill any dependent code.
4. Run `SELECT * FROM audit_log WHERE ts > <incident-time>` — look for unusual
   role grants, portal-token mints, or deletion patterns.
5. Post a short incident note in `#nbd-ops` Slack.

## Reviewer checklist (in every PR)

The template at `.github/pull_request_template.md` enforces this — not optional on
security-sensitive diffs (see `.github/CODEOWNERS` for the list).

- [ ] New Cloud Functions have `enforceAppCheck: true` + rate limit + tenant scoping.
- [ ] New Firestore collections have explicit default-deny rules + a test.
- [ ] New sub-processors are disclosed in `docs/privacy.html`.
- [ ] New PII fields are handled by the redactor in `functions/audit-triggers.js`.
- [ ] No new inline `onclick=` handlers (migrate to delegated `data-action=`).

## Retired surfaces

These endpoints are intentionally no longer part of the platform.
Listed here so an auditor / future dev doesn't resurrect one by
accident:

- **Cloudflare Worker `nbd-ai-proxy`** (retired 2026-04-11, repo
  files removed 2026-04-15). The worker forwarded Anthropic calls
  guarded only by an Origin header, which was bypassed when the
  header was absent. All AI traffic now flows through Firebase
  `claudeProxy` which enforces App Check + Firebase ID token +
  subscription gate + per-uid rate limit + daily token budget.

  **Ops action still required**: delete the `nbd-ai-proxy` worker
  in the Cloudflare dashboard (removing the repo files stops new
  deploys but doesn't revoke the live endpoint). The deployed
  worker returns 410 Gone today, so the attack surface is zero,
  but leaving it live costs a named DNS entry + pollutes the
  Cloudflare console.

- **`imageProxy` Cloud Function** (retired 2026-04-15, R-03). The
  function streamed Storage bytes through Cloud Functions, which
  doubled egress cost and starved the instance pool at scale. It
  also echoed attacker-chosen Content-Types from Storage metadata
  to the client (stored-XSS vector, H-01). Replacement is
  `signImageUrl` + the `NBDSignedUrl` client helper — clients get
  a 15-minute v4-signed Storage URL and fetch bytes directly from
  `storage.googleapis.com`. A 410 Gone stub remains at the
  `imageProxy` endpoint for stale clients; deletable after 7+ days
  of zero calls in Cloud Logging.

## Version history

- **2026-04** — v1.0 policy published.
- **2026-04-15** — retired-surfaces section added (nbd-ai-proxy
  Worker files removed; imageProxy function replaced with 410 stub).

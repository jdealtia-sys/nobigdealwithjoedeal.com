# NBD Pro — Security Sweep 2026-04-14

Second-pass adversarial audit + remediation executed on branch
`claude/security-infrastructure-review-5GRpD`. Ground covered:

- Full-spectrum re-audit against the state as of commit `1ff182f`.
- 15 findings filed (F-01..F-10 + 5 follow-ups, documented below).
- Every finding with a verifiable code change was shipped.
- 441 smoke-test assertions passing, emulator rules tests extended,
  gitleaks + moderate-level npm audit gated in CI.

---

## 72-hour fix plan — status: **all shipped**

| ID | Title | Severity | Status | Commit |
|----|-------|----------|--------|--------|
| F-01 | `confirmAccountErasure` GET deletes | Critical | ✅ shipped | `f47ad54` |
| F-02 | `measurementWebhook` unsigned | High | ✅ shipped | `6111b0d` |
| F-03 | Admin analytics email gate | High → mock-data-only | ✅ shipped | `86665c9` |
| F-04 | Hardcoded admin emails in JS | Medium | ✅ shipped | `86665c9` |
| F-05 | Activity rule allows fake webhook entries | Medium | ✅ shipped | `f9a3262` |
| F-06 | `getHomeownerPortalView` GET leaks tokens | Medium | ✅ shipped | `2c4ac78` |
| F-07 | Stripe idempotency check-then-write | Low-Medium | ✅ shipped | `2c4ac78` |
| F-08 | Stripe plan from `price.metadata` | Low | ✅ shipped | `2c4ac78` |
| F-09 | CSP Report-Only had no reporter | Medium amplifier | ✅ shipped | `2c4ac78`, `2a384f5` |
| F-10 | CI `set +e` hid rules/functions failures | Low ops | ✅ shipped | `ab78201` |

Regression guards: `40d895b` (31 smoke tests pinning every one).

---

## Quick-win wave — status: **all shipped**

| ID | Title | Status | Commit |
|----|-------|--------|--------|
| Q1 | `clientIp` XFF spoofing on Google LB | ✅ shipped | `9b7873f` |
| Q4 | Turnstile fetch 5s AbortSignal | ✅ shipped | `9560d73` |
| Q5 | gitleaks full-history CI scan | ✅ shipped | `5fa867a` |
| Q6 | Exclude seed/verify scripts from deploy | ✅ shipped | `0ed6274` |
| Q2 | Backup verification + restore runbook | ✅ shipped | `51cfe43` |
| Q3 | Admin MFA (TOTP, feature-flag gated) | ✅ shipped | `545ce31` |

---

## Medium-effort wave — status: **all shipped**

| ID | Title | Status | Commit |
|----|-------|--------|--------|
| M2 | `claudeProxy` materialized daily counters | ✅ shipped | `4df6c51` |
| M3 | Webhook-signature regression guards | ✅ shipped | `ebbeb81` |
| M4 | F-05 emulator rules tests | ✅ shipped | `72d284d` |

Dep refresh + moderate-level npm audit gate: `c914729`.

---

## Ops tasks required BEFORE or AT deploy

These can't be shipped in code — they're console / CLI actions:

1. **`HOVER_WEBHOOK_SECRET` + `EAGLEVIEW_WEBHOOK_SECRET`** — required
   for F-02. Until provisioned, `measurementWebhook` fails closed
   with 503. Configure via `firebase functions:secrets:set`, then
   paste the matching shared-secret into each vendor's webhook
   dashboard.
2. **GCS bucket for backups** — `gs://nobigdeal-pro-backups` must
   exist with `roles/storage.objectAdmin` granted to the function
   service account + `roles/datastore.importExportAdmin`. Run
   `./scripts/verify-backup.sh` after the first nightly run.
3. **Admin MFA enrollment** — each admin must visit
   `/admin/mfa-enroll.html` and enroll a TOTP factor BEFORE the
   `admin_mfa_required` feature flag is flipped. See
   `POST_DEPLOY_CHECKLIST.md` §14.
4. **Cloud Monitoring alert policy** — apply
   `monitoring/alert-backup-cron-stale.json` and wire it to a
   notification channel.
5. **CI secrets** — `FIREBASE_SERVICE_ACCOUNT` for the deploy job
   (already documented in `firebase-deploy.yml` header).

---

## Still open (documented, not blocking this deploy)

| ID | Item | Effort | Rationale |
|----|------|--------|-----------|
| M1 | Drop `'unsafe-inline'` from enforced CSP | 3-4 days batched | Need 48h of Report-Only data first |
| B1 | Regional failover (us-east1) | 1-2 days | Defer until live traffic data informs region choice |
| B2 | Centralized `authorize()` helper | 2-3 days | Copy-paste authz drift is a 90-day concern, not 30 |
| B3 | External pentest | 1 week + $3-8k | Schedule before the next pricing-tier change |
| F-12 | Quarterly backup-restore drill | 1h/qtr | Runbook shipped; first drill still owed |

All 9 npm-audit LOW advisories are accepted with justification in
`functions/NPM_AUDIT_ACCEPTED.md`.

---

## Verification pipeline

Every item above has a smoke-test or emulator-test assertion that
fails CI if the fix regresses. The CI matrix is:

- `smoke-tests` (node, no emulator) — 441 assertions
- `syntax-check` (node --check) — every .js under `functions/` and
  `docs/**/js/` and `docs/admin/**`
- `firestore-rules` (emulator) — firestore + storage rule evaluation
  tests (including F-05 activity-rule behaviours)
- `functions-parse` — integration modules require cleanly + npm
  audit moderate-level gate
- `secret-scan` — legacy grep patterns + gitleaks full-history

No deploy ships without all five green.

# Phase C (finish) + Phase D — Session Status

> Run date: **2026-06-08**. Owner: Jo Deal. NBD = tenant zero (byte-identical). Oaks = beta tenant.
> Mission brief: Phase C (per-tenant lead routing + intake unification), HARD CHECKPOINT, then Phase D (company billing + seats).
> Trackers in this dir: `STATUS.md` (this), `MIGRATION-PLAN.md` (Phase D re-key + backups), `CLEANUP.md` (ZZ_QA manifest).

---

## PHASE 0 — Ground truth (DONE, verified against live code 2026-06-08)

### What recent commits already landed (do NOT redo)
- `b1e8c07f` **Phase C lead-alert routing** — `functions/lead-alert.js` `resolveAlertTarget(companyId)` reads
  `companyProfile/{companyId}.brand.contact.{alertEmail,alertSms}` and routes the alert there; falls back to NBD's
  `ALERT_EMAILS`/`ALERT_SMS` (Joe) when companyId absent or tenant contact unset → **byte-identical for NBD**.
  Triggers on `contact_leads`, `estimate_leads`, `inspect_leads`, `free_roof_entries`.
- `8e1d3f82` **submitPublicLead companyId tagging** — `functions/handlers/integrations.js` validates a supplied
  `companyId` against `companies/{cid}` and stamps it; NBD's main forms pass none (→ Joe fallback).
- `6c3f51f7` review-harden (lead-alert L2 + estimate escaping L3).
- Phase A backbone (`befe757f`): client `window._tenant()` / `window._brand()` in `docs/pro/js/company-profile.js`
  reading `companyProfile/{companyId}` (deep-merged over NBD defaults). **No server-side `functions/lib/tenant.js`**
  exists — server tenant resolution is inlined per-handler (e.g. lead-alert's `resolveAlertTarget`).

### Phase C step status
| Step | State |
|------|-------|
| 1. tenant `contact{}` + `integrations{}` on tenant doc | **DONE (this session)** — added `contact.slackWebhook` + `brand.integrations{twilioNumber,resendDomain,reviewUrl,calLink}` to NBD defaults (`company-profile.js`) + Oaks backfill (`scripts/backfill-oaks-brand.js`). Empty/public-value fall-through → NBD byte-identical. |
| 2. lead-alert routes by companyId | **DONE** (b1e8c07f). |
| 3a. bridge public leads → CRM `leads` (the H-1 within-project fix) | **BUILT + UNIT-TESTED (this session)** — `functions/lead-bridge.js` (4 onCreate triggers) + `functions/lead-bridge-logic.js` (pure) + wired in `index.js`. Tenant-aware owner resolution, idempotent (deterministic id), best-effort. **Emulator end-to-end + live verify pending** Jo's provisioning/backups. |
| 3b. Oaks cross-project cutover | **NOT YET BUILT** — repoint `docs/sites/oaks/shared.js` to `submitPublicLead` w/ `companyId:'oaks'`; add Oaks domain to `CORS_ORIGINS`; relax `submitPublicLead` `contact` schema to accept the Oaks form's fields. Live-enable needs: CORS, App-Check for the Oaks origin (console), `companies/oaks.ownerId`, **Scott's OK**. |
| 4. SMS routing + flag A2P | routing done in lead-alert; per-tenant Twilio A2P remains an external gate (each tenant needs its own campaign). |
| 3b. Oaks cross-project cutover | **BUILT + PROVEN (this session)** — `docs/sites/oaks/shared.js` now posts to `submitPublicLead` (`companyId:'oaks'`, gateway URL on `*.cloudfunctions.net`) instead of the marketing project; inline `onsubmit` → programmatic `addEventListener` (CSP `script-src-attr 'none'`-safe); `submitPublicLead` `contact` schema relaxed to accept `lastName/email/zip/service/message`. Same-origin (`/sites/oaks`) ⇒ **no CORS/CSP/App-Check change needed**. |
| 4. SMS routing + flag A2P | routing done in lead-alert; per-tenant Twilio A2P remains an external gate (each tenant needs its own campaign). |
| 5. extend tenant test suite | bridge unit (`tests/lead-bridge.test.js`, 43) + **emulator integration (`tests/lead-bridge.integration.test.js`, 20)** + smoke guard + tenant-brand schema assertions. |
| 6. verify ZZ_QA on NBD + Oaks | emulator-proven (NBD + Oaks-like + gateway path). Live ZZ_QA + checkpoint pending Jo's provisioning/backups. |

### Build results (2026-06-08) — all green
- `node tests/lead-bridge.test.js` → **43/43** (unit). `tests/lead-bridge.integration.test.js` under emulator → **20/20** (NBD + tenant + skip + idempotency + full Oaks gateway→bridge). `node tests/smoke.test.js` → **1819/0** (+11). `node tests/tenant-brand.test.js` → **30/0** (+4). All edited modules `node --check` clean.
- **Finding:** `submitPublicLead` sanitizes `companyId` via `.toLowerCase().replace(/[^a-z0-9-]/g,'')` before validating against `companies/{id}`. **Tenant companyIds must be lowercase `[a-z0-9-]`** (real `'oaks'` is fine; an underscore/uppercase id is silently stripped → falls back to NBD). Document this in any tenant-provisioning runbook.
- **Observation (pre-existing, emulator-only, NOT my code):** `audit-triggers.js` + `audit-log.js` use the namespaced `admin.firestore.FieldValue` → `undefined` under the emulator → audit_log writes fail. Prod unaffected. Spawned a background task to switch them to the modular import (the pattern my bridge uses).
- Changes uncommitted in the working tree (NOT pushed/deployed — auto-deploy gate + checkpoint). Files: `functions/lead-bridge.js`, `functions/lead-bridge-logic.js`, `functions/index.js`, `functions/handlers/integrations.js`, `docs/pro/js/company-profile.js`, `docs/sites/oaks/shared.js`, `scripts/backfill-oaks-brand.js`, `tests/lead-bridge.test.js`, `tests/lead-bridge.integration.test.js`, `tests/tenant-brand.test.js`, `tests/smoke/functions.test.js`.

### Oaks cutover (3b) — live-enablement prerequisites (Jo / Scott)
- **`companies/oaks.ownerId` = Scott's uid** — required for the bridge to mirror Oaks leads into a pipeline Scott can see. Until set: Oaks lead still alerts Scott (via `companyProfile/oaks.brand.contact`) + sits in `contact_leads`, but the bridge **skips** the pipeline mirror (graceful — no data loss, matches NBD's pre-bridge state).
- **Scott's OK** — the Oaks form UX is unchanged; only the backend project changes (a strict improvement: leads now reach the CRM). Inform Scott before deploy.
- Optional follow-up cleanup: remove the now-unused `marketing-firebase-init.js` include from the Oaks pages + retire the marketing-project `leads` collection.

### H-1 / intake — the exact problem (two parts)
1. **Within `nobigdeal-pro`:** `submitPublicLead` writes to per-kind collections
   (`guide_leads`, `contact_leads`, `estimate_leads`, `storm_alert_subscribers`, `free_roof_entries`, `inspect_leads`).
   The CRM pipeline reads the **`leads`** collection, scoped by `firestore.rules` to `isOwner(resource.data.userId)`.
   **Nothing copies public leads into `leads`** → they never appear in the pipeline (H-1). Lead-alert email fires, so
   data is not lost, but the owner must manually re-enter.
2. **Cross-project:** the Oaks microsite (`docs/sites/...`) uses `docs/sites/js/marketing-firebase.js` →
   writes to the **separate `nobigdealwithjoedeal` marketing project's** `leads` collection. Those leads are invisible
   to both `lead-alert` (deployed in `nobigdeal-pro`) and the CRM. (integrations.js already flags: "migrate the Oaks
   microsite off the separate marketing project.")

### Key constraints discovered
- A `leads` doc **create requires `userId == auth.uid`** and is **read-scoped to its `userId`**. Public submits have
  **no authenticated user** → any bridge into `leads` **must run server-side via admin SDK** and must resolve
  `companyId → owner uid`.
- **No reliable `companyId → owner uid` map exists today.** `functions/seed-companies.js` (the stale source the
  architecture doc says to retire) sets `owner: 'Joe Deal' / 'Scott Oaks'` as **display names, not uids**, and has
  **no `ownerId`** — yet `firestore.rules` keys company access on `resource.data.ownerId`. So `companies/oaks.ownerId`
  is effectively unset. **The bridge needs `companies/{cid}.ownerId` per tenant** (a provisioning prerequisite; ties to
  Pillar 1). For NBD the owner is the tenant-zero uid `1phDvAVXHSg82wDLegAbQFq14Ci1` (from `set-jd-claims.js`).
- Canonical CRM `leads` shape (from `_saveLead`, `dashboard-bootstrap.module.js:2353`):
  `{userId, companyId, firstName, lastName, address, phone, email, stage:'New', source, createdAt, stageStartedAt, ...}`.
  First pipeline column = stage `'New'`. `customerId` (NBD-####) is assigned best-effort, optional.

### Phase D surface (confirmed for after the checkpoint)
- `subscriptions/{uid}` (firestore.rules:371-374, read-only to owner, writes admin-SDK only).
- `docs/pro/js/billing-gate.js` `loadSubscription()` reads `subscriptions/{uid}` vs per-tier limits + hardcoded owner-email bypass. (Deep-read deferred to Phase D start.)
- `functions/stripe.js` is the webhook (client_reference_id = uid). `companies/{cid}.subscription` is denormalized metadata only.
- NBD sub is solo (companyId == uid) → re-key is a no-op → low migration risk.

---

## DESIGN — H-1 bridge (proposed, additive, NOT yet built)
New Firestore onCreate trigger (own module `functions/lead-bridge.js`, same pattern/collections as lead-alert):
1. On create in a high-intent public collection, read `companyId`.
2. Resolve owner uid: `companies/{companyId}.ownerId` if companyId present; else NBD default uid (`1phDvA…`).
   If unresolvable → **skip + log** (never lose data; alert already fired).
3. Write a `leads` doc (admin SDK) with the canonical shape, `stage:'New'`, `source:'Website — <label>'`,
   provenance fields (`publicLeadKind`, `publicLeadCollection`, `publicLeadId`, `webLead:true`).
4. **Idempotent** via deterministic doc id `<collection>__<sourceId>` (re-delivery cannot duplicate).
5. Best-effort try/catch — never blocks intake or alert.

Open design calls (see chat / AskUserQuestion):
- **Which kinds bridge** → default: the 4 high-intent (`contact`, `estimate`, `inspect`, `free_roof`), matching
  lead-alert. `guide` (download) + `storm` (subscriber) excluded as list-builders, not pipeline leads.
- **Oaks cross-project** → migrate Oaks microsite to call `submitPublicLead` w/ `companyId:'oaks'` (recommended,
  unifies to one project) — but touches a LIVE partner site (needs Scott's OK) + CORS/App-Check wiring. Propose
  separately, do not apply blind.

---

## BLOCKED / NEEDS JO (RULE 6 — Claude never types creds or touches console)
- **Phase 0.2** provision ZZ_QA test tenant(s) + ZZ_QA leads; **set `companies/<ZZ_QA>.ownerId`**.
- **Phase 0.3** export/back up `leads` + `subscriptions` collections before any migration (Phase D).
- Confirm **Stripe TEST-mode** access (Phase D).
- Set **`companies/oaks.ownerId`** = Scott's uid once Scott has an account (bridge prerequisite for Oaks).

---

## PRE-DEPLOY ADVERSARIAL REVIEW + DEPLOY (2026-06-08)
Phase C merged to `main` (cherry-picked onto the parallel session's FieldValue migration + brand
hardening). Before the irreversible prod deploy, ran a multi-lens adversarial review (18 agents, 13
findings, **2 confirmed blockers**, 11 verified non-blockers, 0 dismissed). Both blockers FIXED:

- **C-1 (FIXED, commit `400432fd`):** the bridge triggers were exported via `= makeTrigger(...)`, which the
  CI deploy enumeration (`firebase-deploy.yml` greps `^exports.X = (onRequest|onDocumentCreated|…)`) does
  NOT match → a push would have silently NOT deployed them (H-1 inert; same latent gap as lead-alert.js's
  makeTrigger exports, which only ship via a manual full deploy). Fix: assign `onDocumentCreated(...)`
  directly per export; smoke guard now replicates the CI regex. Verified: CI enumeration lists all 4
  `leadBridge*`.
- **OAKS-1 (HARDENED, commit `46ad55fb`):** if `companies/oaks` is ABSENT in prod, `submitPublicLead` strips
  `companyId:'oaks'` → the Oaks lead becomes untagged → alert goes to Joe (Scott loses it) AND the bridge
  mirrors Oaks PII into Joe's NBD pipeline (cross-tenant misroute). Safe only if `companies/oaks` EXISTS
  (then graceful: alert→Scott, pipeline-mirror no-ops until ownerId set). Mitigations: `scripts/
  provision-oaks-company.js` (verify/ensure the doc) + `address` added to the contact allowlist (so NBD
  contact leads aren't blank in the pipeline).

Non-blockers (verified safe): NBD byte-identical holds; relaxed contact schema = no injection/XSS/DoS;
forged companyId can't exfiltrate cross-tenant; Oaks graceful-skip until ownerId; sourceId-undefined not
triggerable; pre-existing inspect-form.js `res.error` vs `res.reason` mismatch (untouched code, FYI).

**Verified green on merged main:** smoke 1819/0 · tenant-brand 30/0 · tenant-hardening 51/0 · bridge unit
43/43 · emulator integration 20/20 · CI enumeration includes leadBridge* · syntax clean.

### DEPLOY GATE (chosen: ensure companies/oaks, then push all)
1. **Jo runs** (prod creds): `node scripts/provision-oaks-company.js --ensure` → guarantees `companies/oaks`
   exists (eliminates OAKS-1). (Add `--owner <Scott uid>` later to light up Oaks pipeline mirroring.)
2. **Then push `main`** → Firebase auto-deploy (~9 min). NBD H-1 fix live; Oaks alerts route to Scott;
   Oaks pipeline mirror deferred until Scott has an account.
3. **Post-deploy checkpoint (Jo verifies):** submit an NBD public form → lead appears in the CRM pipeline;
   an Oaks-tagged lead alerts the Oaks contact (joe@oaksrfc.com), not jd@. → then Phase D.

## NEXT
Awaiting Jo: confirm bridge design defaults + provisioning/backup handoff → then build bridge + tests on an isolated
branch/worktree, run emulator suite, deliver for the **HARD CHECKPOINT** (Jo verifies leads land in CRM + Oaks alerts Scott).

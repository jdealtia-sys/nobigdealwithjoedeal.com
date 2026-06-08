# Pillar 1 — Tenant provisioning & auth (the next pillar)

> Scoping doc, 2026-06-07. Companion to [MULTI-TENANT-ARCHITECTURE.md](MULTI-TENANT-ARCHITECTURE.md).
> Pillar 2 (brand) is now ~done (6 phases shipped). The gateway to *self-serve*
> N-tenant SaaS is **provisioning**: any roofer signs up → gets a company + a
> branded CRM, without Jo hand-seeding Firestore. This is the next pillar.
>
> **Why this one next:** today's demo work surfaced that the **auth/access-code
> layer is fragile** (access-code login broken on a missing IAM role; `onRepSignup`
> GCIP-blocked). Provisioning *is* that layer — fixing + building it unblocks
> self-serve and hardens what's already shaky.

## Current state (grounded)
- **Tenant registry:** `companies/{companyId}` (`functions/seed-companies.js`) — hand-seeded today (NBD, Oaks). Stale colors/phone (the brand sweep retired them as source of truth).
- **Per-tenant config:** `companyProfile/{companyId}` — now the brand source of truth (Pillar 2). Per-tenant, rules-scoped.
- **Identity:** `companyId` custom claim; solo-op convention `companyId == uid`. Read ad-hoc (the `_tenant()` resolver from Pillar A is the start of a single read path).
- **Invited-rep signup:** `onRepSignup` (beforeUserCreated **blocking** trigger, `functions/handlers/auth.js`) — **can't deploy until GCIP upgrade** (in `NBD_DEPLOY_SKIP_LIST`). `activateInvitedRep` finalizes invites.
- **Access-code login:** `validateAccessCode` (`functions/handlers/portal.js`) mints a custom token. **Currently BROKEN in prod** — the function's compute SA lacks `roles/iam.serviceAccountTokenCreator`, so `createCustomToken` fails (affects demo + all member access codes). See `access-code-login-iam-gap` memory / task #15.

## Two blockers to clear first (Phase 0)
1. **IAM (do now):** grant `roles/iam.serviceAccountTokenCreator` to `717435841570-compute@developer.gserviceaccount.com` → fixes all access-code logins. *(Jo/devops — access-control change; not Claude.)*
2. **GCIP decision:** blocking auth triggers (`onRepSignup`) need Google Cloud Identity Platform. Either **(a) upgrade to GCIP** (enables `beforeUserCreated`, ~modest cost) or **(b) refactor `onRepSignup` to a non-blocking Firestore/Auth trigger** (no GCIP, but a brief window where a new user has no claim until the trigger runs). Recommend **(b)** for now — avoids the GCIP dependency; the claim-on-first-write pattern is fine for a roofing CRM. *(Jo decides.)*

## Phased plan (each independently shippable; NBD unchanged)

### Phase 1 — Foundation (unblock)
- Clear Phase-0 blockers (IAM grant; pick GCIP path).
- Generalize the `_tenant()` resolver into the single server+client tenant-context read path (started in Pillar A). Retire the stale `seed-companies.js` as a source of truth.

### Phase 2 — Self-serve company creation (the core)
- `createCompany` callable: a new owner signs up (email/pw or Google) → creates `companies/{newId}` + seeds `companyProfile/{newId}` (with NBD-default brand to start) → sets their `companyId` claim (= new id) + `role: owner`.
- Replace the manual seed flow. New tenant is live end-to-end with NBD-default branding (they customize via Settings → Pillar 2).
- **Verify:** a fresh signup creates an isolated tenant; its docs/leads are scoped to it (cross-tenant rules test already guards this).

### Phase 3 — Team invites
- Owner invites reps by email → `companies/{id}/members/{email}` (status: invited) → invite link → on first login, `activateInvitedRep` stamps `companyId`+`role` claim. (Reuse the existing invite scaffolding, de-GCIP'd per Phase 0.)

### Phase 4 — Onboarding wizard
- Post-signup flow: set brand (logo/colors/name — Pillar 2 schema), contact, service area, plan. Writes `companyProfile`. Makes the tenant "real" without touching code.

## Sequencing for the rest of the SaaS
Pillar 1 (this) → **Pillar 4 (company-level billing:** `subscriptions/{uid}` → per-company + seats; gate signup behind a plan) → **Pillar 5 (custom domains + templated tenant sites:** replace hand-authored `docs/sites/oaks/` with a data-driven generator + per-tenant domain routing). Billing (4) pairs naturally with Phase 2 here (charge at company creation).

## Open decisions for Jo
- **GCIP vs Firestore-trigger refactor** for `onRepSignup` (Phase 0).
- **Signup gating:** open self-serve (anyone) vs invite/approval-only (curated) — affects abuse surface + whether Phase 2 needs a plan/paywall up front.
- **Owner auth method:** email+password, Google SSO, or both.

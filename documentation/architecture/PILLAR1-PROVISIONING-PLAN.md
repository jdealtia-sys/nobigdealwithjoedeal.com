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

### Phase 2 — Self-serve company creation (the core) — ✅ SHIPPED 2026-07-03
> `functions/handlers/provisioning.js` createCompany. Deviations from the sketch
> below, on purpose: the seed is NEUTRAL (tenant's own name/email), NOT
> NBD-default brand — the Pillar-2 M1 "NBD bleed" review is why; and the claim
> role is `company_admin` (the rules' canonical top role — 'owner' was never in
> the vocabulary). Register page initializes App Check (enforceAppCheck).
- `createCompany` callable: a new owner signs up (email/pw or Google) → creates `companies/{newId}` + seeds `companyProfile/{newId}` (with NBD-default brand to start) → sets their `companyId` claim (= new id) + `role: owner`.
- Replace the manual seed flow. New tenant is live end-to-end with NBD-default branding (they customize via Settings → Pillar 2).
- **Verify:** a fresh signup creates an isolated tenant; its docs/leads are scoped to it (cross-tenant rules test already guards this).

### Phase 3 — Team invites — ✅ SHIPPED 2026-07-03 (de-GCIP'd, option b)
- Owner invites reps by email → `companies/{id}/members/{email}` (status: invited) → invite link → on first login, `activateInvitedRep` stamps `companyId`+`role` claim. (Reuse the existing invite scaffolding, de-GCIP'd per Phase 0.)
> `functions/handlers/invites.js`. The Phase-0 GCIP question is RESOLVED by
> refactor — no GCIP needed, `onRepSignup` stays in the skip list forever:
> - `teamInviteEmail` (onDocumentCreated on the members subcollection) sends
>   the invite email the team tab always claimed to send (Resend, platform-
>   branded, reply-to the owner).
> - `claimInvite` (onCall) replaces the blocking trigger: on first dashboard
>   load a user with no team claim (or only the Phase-2 solo default
>   companyId==uid) looks up their pending invite by VERIFIED email and gets
>   `{companyId, role, plan}` merged + the member doc activated. Role
>   allowlist re-checked server-side; platform admins refused; a self-serve
>   solo tenant being absorbed is marked `superseded-by-invite`, not deleted.
> - Composite index `members(email, status)` COLLECTION_GROUP added.
> - The "brief window with no claim" trade-off from Phase 0(b) is narrower
>   than feared: Phase 2 gives every signup `companyId==uid` immediately, so
>   there is no claim-less window at all — just solo-scope until the claim.

### Phase 4 — Onboarding wizard — ✅ SHIPPED 2026-07-03
- Post-signup flow: set brand (logo/colors/name — Pillar 2 schema), contact, service area, plan. Writes `companyProfile`. Makes the tenant "real" without touching code.
> `docs/pro/onboarding.html` + `js/pages/onboarding.js`. 3 steps (basics →
> brand → review); writes letterhead top-levels + `brand` with unset fields
> OMITTED (M1 raw-override semantics); rejects seal 'NBD'; skippable; owner
> accounts + invited reps bounce to dashboard; retries createCompany on finish
> when the companyId claim is missing (self-heal). `users.onboarded` (written
> since forever, read by nothing) now gates the redirect. Plan selection
> deliberately left out — Stripe checkout on /pro/landing covers it.

## Sequencing for the rest of the SaaS
Pillar 1 (this) → **Pillar 4 (company-level billing:** `subscriptions/{uid}` → per-company + seats; gate signup behind a plan) → **Pillar 5 (custom domains + templated tenant sites:** replace hand-authored `docs/sites/oaks/` with a data-driven generator + per-tenant domain routing). Billing (4) pairs naturally with Phase 2 here (charge at company creation).

> **Pillar 5 phase 1 — ✅ SHIPPED 2026-07-03.** Universal tenant microsite:
> `/sites/t/<companyId-or-slug>` serves ONE static template
> (`docs/sites/t/`) rendered at runtime from `getPublicSiteConfig`
> (`functions/handlers/public-site.js`) — a server-side, strictly
> whitelisted read of companies/{id} + companyProfile/{id} (never
> alert*/integrations/pricing/legal; raw-override semantics mean nothing
> NBD-branded can bleed). Quote form posts through submitPublicLead with
> the tenant's companyId → their pipeline + their alert inbox. Slug via
> companies/{id}.siteSlug (equality query). Superseded/disabled tenants
> stop resolving. noindex like /sites/oaks. NOT yet done: per-tenant
> custom DOMAINS (needs multi-site Hosting + DNS — console work), retiring
> the hand-authored oaks pages onto this template (Scott's call), and a
> Settings surface for siteSlug.
>
> **Pillar 4 phase 1 — ✅ SHIPPED 2026-07-03.** Billing now resolves at the
> COMPANY: every subscription reader (nbd-auth, billing-gate, dashboard boot)
> keys `subscriptions/{companyId claim || uid}`; rules let same-company
> members READ their company's subscription; `trackUsage` pools usage on the
> company doc (5 reps share one Growth allowance). Seat enforcement:
> member CREATE is rules-denied client-side and moved into the
> `createTeamInvite` callable (`functions/handlers/invites.js`) — seats =
> PLAN_LIMITS[plan].reps (free/starter 0, growth 5, enterprise ∞), pending
> invite re-sends don't take a new seat, owner update/delete flows keep
> working. NOT yet done from the Pillar-4 sketch: plan-gated signup and
> charge-at-company-creation (product decisions for Jo).

## Open decisions for Jo
- **GCIP vs Firestore-trigger refactor** for `onRepSignup` (Phase 0).
- **Signup gating:** open self-serve (anyone) vs invite/approval-only (curated) — affects abuse surface + whether Phase 2 needs a plan/paywall up front.
  > **DECIDED (Jo, 2026-07-04):** stay open self-serve — free tier with soft limits; no plan-gate/paywall at company creation.
- **Owner auth method:** email+password, Google SSO, or both.

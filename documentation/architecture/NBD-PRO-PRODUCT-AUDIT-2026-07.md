# NBD PRO — Product Audit (2026-07-03, read-only)

**Verdict up front:** The daily-use app is rich and largely real; the
money-and-onboarding plumbing is where it's still a single-tenant tool wearing
a SaaS costume. Stripe is genuinely wired. But **no stranger can
self-provision a usable tenant today** — the "second contractor" path requires
Joe to hand-seed Firestore, and the access-code path the signup UI advertises
is broken in prod.

## 1. The funnel (and where it breaks)

- **Discover:** pro/landing.html + pricing.html; the free-guide magnet
  (sites/free-guide) captures contractor emails into the marketing project and
  **dead-ends** — no handoff to /pro/register. **Break #1.**
- **Sign up:** register.html. No-code branch works (Free tier, users/{uid}
  onboarded:false). Access-code branch (hint "NBD-PRO") calls
  validateAccessCode, which is **broken in prod** — compute SA lacks
  roles/iam.serviceAccountTokenCreator so createCustomToken throws (per
  PILLAR1-PROVISIONING-PLAN.md:18). **Break #2.**
- **Trial confusion:** "Free forever" tier vs "14-day trial" (Stripe-side,
  growth only, stripe.js:156) — not reconciled in the register flow.
- **Pay:** createCheckoutSession/stripeWebhook are production-shaped (hosted
  checkout, signature verify, idempotency via stripe_events). BUT it 403s
  unverified emails (stripe.js:106) — **fresh signups can't pay until they
  find the verification email. Break #3.**
- **Onboard:** 5-step spotlight tour exists, but **no company-creation
  wizard** — nothing writes companies/{id} or companyProfile; new users fall
  to companyId==uid with NBD's brand defaults showing through.
- **Daily use:** dashboard CRM, D2D tracker, estimates, AI tools, portal —
  the deep, working part.

## 2. Sellable vs NBD-only

- **Production-grade:** server-authoritative usage tracking (billing.js),
  Stripe checkout+webhook, tenant brand resolver (company-profile.js with the
  M1 NBD-bleed fixes), tenant-aware lead routing (lead-bridge/lead-alert
  resolveAlertTarget).
- **Half-built:** createCompany does not exist (PILLAR1 Phase 2); tenants are
  hand-seeded (seed-companies.js: only NBD + Oaks). Team invites blocked
  upstream (onRepSignup needs a GCIP upgrade; in NBD_DEPLOY_SKIP_LIST).
- **Hardcoded to Joe:** alert fallbacks (email/SMS/from), owner-bypass emails
  in billing-gate.js:49 + billing.js:52, NBD defaults (KY cancellation
  statute, Improvifi, service area) in company-profile.js:23-175.
- **Second contractor tomorrow, unbabysat? No.** No companies/{uid} doc means
  their public-site leads won't route; access codes broken; Joe must
  hand-seed + set claims.

## 3. The Oaks template

One-off hand-build, NOT a product: all copy/colors/logo hardcoded per page;
only the lead form is tenant-aware (companyId:'oaks' -> submitPublicLead ->
routes to Scott). Making it repeatable = data-driven generator reading
companyProfile.brand (schema already has everything) + per-tenant domain
routing. Effort L (~2-4 wk). (PILLAR1 Pillar 5.)

## 4. Pricing/billing reality

- Canonical plans: free (10 leads) / starter $99 (50) / growth $299 (500, inf
  reports+AI, 5 reps) / enterprise (mailto). Legacy aliases foundation/
  professional still mapped.
- **Divergence:** landing.html buttons use foundation/blueprint/professional —
  "blueprint" maps to NO price anywhere (landing.html:1467). Pricing UI says
  growth $299; stripe.js:129 comment says $249 — truth lives in the
  STRIPE_PRICE_PROFESSIONAL secret.
- Gates are SOFT only (warn at 80%, modal at 100%, never lock out). Owner
  emails bypass entirely. Only 2 prices wired (starter, growth).
- Stripe: live-wired integration shape; key values live in Secret Manager
  (live-vs-test not readable from code — by design).

## 5. Top 5 gaps to "stranger signs up, pays, gets value in 30 min"

| # | Gap | Fix | Effort |
|---|-----|-----|--------|
| 1 | No self-serve provisioning (createCompany unbuilt; tenants hand-seeded) | createCompany callable + post-signup brand wizard writing companyProfile (PILLAR1 Phase 2) | M (1-2 wk) |
| 2 | Access-code login broken in prod (IAM) | Grant roles/iam.serviceAccountTokenCreator to the compute SA — console, not code | XS (minutes) |
| 3 | Funnel handoffs broken (free-guide dead-end; "blueprint" plan maps to nothing) | Register CTA on free-guide success; unify plan names free/starter/growth everywhere | S (hours-1 day) |
| 4 | Email-verify wall blocks first payment | Allow trial/checkout pre-verify, or fold verification into pay flow | S (<1 day) |
| 5 | Oaks white-label not templated | companyProfile-driven site generator + domain routing (PILLAR1 Pillar 5) | L (2-4 wk) |

**Bottom line:** Gaps 2-4 turn the existing funnel from "leaky demo" into "a
stranger can actually pay" for roughly two days of work + one console flip.
Gap 1 is the real unlock for contractor #2 without Joe in the loop — and the
repo's own PILLAR1-PROVISIONING-PLAN.md already scopes it. Gap 5 is the
upsell and can wait.

Key files: pro/register.html + js/pages/register.js, pro/pricing.html +
js/pricing-page.module.js, pro/js/billing-gate.js, functions/billing.js,
functions/stripe.js, functions/handlers/portal.js, functions/handlers/auth.js,
functions/lead-alert.js, functions/lead-bridge.js, pro/js/company-profile.js,
sites/oaks/shared.js, sites/free-guide/index.html,
documentation/architecture/PILLAR1-PROVISIONING-PLAN.md.

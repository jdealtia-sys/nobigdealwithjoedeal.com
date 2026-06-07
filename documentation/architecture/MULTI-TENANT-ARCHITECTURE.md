# Multi-Tenant Architecture — current state, target, and roadmap

> Goal (Jo, 2026-06-07): a **self-serve, N-tenant SaaS** — any roofer signs up and gets an
> auto-provisioned, branded site + CRM. This doc maps the **current** state (grounded in the
> code, not the stale `ARCHITECTURE.md`), the **target**, and a **backbone-first, shippable**
> roadmap. Companion to [the brand plan](../qa/brand-sweep-2026-06-07/TENANT-BRAND-PLAN.md)
> (brand is Pillar 2 / roadmap phase B here).
>
> **Non-negotiable through every phase:** NBD (tenant zero) stays byte-identical — every change
> falls through to today's NBD values when a tenant hasn't set a field. Smoke gates each deploy.

---

## TL;DR — what's actually missing, and where to start

The **data model is already solid** for N tenants (per-company Firestore rules, `companyId`
invariant on leads, per-tenant `companyProfile`, a cross-tenant rules test). The gaps are in
**everything around the data**: brand, integrations/routing, billing, provisioning, and domains
are **hardcoded to NBD or keyed per-user instead of per-company**.

**Recommended first three moves (each independently shippable, NBD unchanged):**
1. **Backbone** — a `TenantContext` resolver (companyId → brand + integrations + plan + domain). Everything else reads from it.
2. **Brand** (the 5-step plan) — first visible win; proves the backbone.
3. **Lead routing + alerts per tenant** — fixes the most embarrassing gap (every tenant's leads currently text *Joe's personal cell*).

Provisioning, company-level billing, and custom domains come after, once the backbone + per-tenant config exist to provision *into*.

---

## The backbone — `TenantContext` (build first)

Today `companyId` is read **ad-hoc** in rules, functions, and client JS — there's no single
resolver. Every pillar below needs "who is the active tenant and what's their config." Build
**one** resolver, server + client:

```
resolveTenant(uid|companyId) → {
  companyId,                 // claim, or uid for solo operators
  brand,                     // logo, colors, name, seal, fonts        (Pillar 2)
  contact,                   // alert email/SMS, sender domain          (Pillar 3)
  integrations,              // twilioNumber, resendDomain, reviewUrl…  (Pillar 3)
  plan, entitlements,        // tier + feature flags                    (Pillar 4)
  domain                     // custom host → tenant                    (Pillar 5)
}
```
- **Server:** a `functions/lib/tenant.js` that loads `companies/{companyId}` + `companyProfile/{companyId}` once per request and hands the merged context to handlers (renderPdf, lead-alert, stripe, etc.).
- **Client:** generalize the planned `_brand()` into `window._tenant()` reading the same docs.
- **Source of truth:** `companyProfile/{companyId}` (already per-tenant + already loaded). Fold the
  authoritative bits of `companies/{companyId}` into it or reference it; **retire the stale
  `seed-companies.js` colors/phone**. Decide one source — don't keep two.

> Once this exists, every pillar is "make surface X read from `TenantContext` instead of a hardcoded NBD literal."

---

## Pillars — current state → gap → build

### Pillar 1 — Tenant identity & auth · **PARTIAL**
- **Now:** `onRepSignup` (beforeUserCreated blocking trigger, `functions/handlers/auth.js`) sets
  `{companyId, role, plan}` on invited reps via a collectionGroup query on `companies/{companyId}/members`;
  `activateInvitedRep` flips the invite to active. Solo-op convention: **`companyId == uid`**
  (`set-jd-claims.js`). No single tenant resolver.
- **⚠ Blocker:** `onRepSignup` is the **GCIP-blocked trigger** — it can't deploy until the project
  is upgraded to GCIP or it's refactored to a Firestore trigger (it's in `NBD_DEPLOY_SKIP_LIST`).
  Self-serve signup is gated on resolving this.
- **Build:** GCIP upgrade (or Firestore-trigger refactor) → self-serve **company creation** (not just
  invited-rep): new owner signs up → creates `companies/{newId}` → gets `companyId` claim → seeds
  `companyProfile`. Per-tenant invite/magic-link URLs.

### Pillar 2 — Brand resolution · **HARDCODED-NBD** → see [TENANT-BRAND-PLAN.md](../qa/brand-sweep-2026-06-07/TENANT-BRAND-PLAN.md)
- 3+ doc generators, the customer portal, SMS/email copy, and `NBD-` doc-number prefixes all hardcode NBD; `companyProfile` carries letterhead text only (no color/logo). The 5-step brand plan converts these to `TenantContext`.

### Pillar 3 — Lead routing & integrations · **HARDCODED-NBD (worst gap)**
- **Now:** `functions/lead-alert.js` hardcodes `ALERT_EMAILS = ['jd@…','jonathandeal459@gmail.com']`
  and `ALERT_SMS = '+18594207382'` (**Joe's personal cell**). Every public lead for *every* tenant
  alerts Joe, regardless of `companyId`. All integrations (Twilio, Resend, Stripe, Slack, Cal.com)
  are **global secrets**, no per-tenant override.
- **⚠ Two-pipeline surprise:** public leads land in **two different Firebase projects** — the Oaks
  microsite writes to the **marketing project** (`nobigdealwithjoedeal`) via
  `docs/sites/js/marketing-firebase.js`, while the main CRM forms write to **`nobigdeal-pro`**.
  No unified intake. (Cross-refs the live-QA H-1 "public-leads-not-in-CRM" finding.)
- **Build:** per-tenant `contact{alertEmail, alertSms, slackWebhook}` + `integrations{twilioNumber,
  resendDomain, reviewUrl, calLink}` on the tenant doc; `lead-alert.js` reads the lead's `companyId`
  → routes to that tenant. **Unify the two intake pipelines** into one `submitPublicLead` that stamps
  `companyId` and lands in one project. (SMS still blocked on per-tenant **Twilio A2P** approval.)

### Pillar 4 — Billing & entitlements · **PER-USER, not per-company**
- **Now:** subscriptions live at **`subscriptions/{uid}`** (Stripe webhook writes by
  `client_reference_id = uid`); `companies/{companyId}.subscription` is just denormalized metadata.
  Feature-gating (`billing-gate.js`) reads `subscriptions/{uid}` against per-tier limits; owner-email
  hardcoded bypass. Team members inherit the owner's plan; **no seats**.
- **Build:** move the authoritative subscription to **`companies/{companyId}`** (or a
  `subscriptions/{companyId}` keyed by company); per-seat pricing; checkout success/cancel URLs that
  aren't hardcoded to the NBD domain; entitlements resolved via `TenantContext.plan`.

### Pillar 5 — Hosting & domains · **PARTIAL (hand-authored, single project)**
- **Now:** one Firebase Hosting target (`nobigdeal-pro`, serving `docs/`) with path rewrites. Oaks is a
  **hand-authored static folder** (`docs/sites/oaks/`) served at `/sites/oaks/`. **Firebase Hosting has
  no Host-header rewrites** → custom per-tenant domains aren't natively supported.
- **Build (two sub-problems):**
  1. **Templated tenant sites** — replace hand-authored microsites with a data-driven generator
     (your city-page template system is the model): one template + `TenantContext` → N branded sites.
  2. **Per-tenant custom domains** — either separate Hosting sites per tenant (Firebase multi-site
     targets, IaC'd) **or** a hostname-routing reverse proxy / Cloud Run in front. Pick one; it's the
     single biggest infra decision for self-serve.

---

## Roadmap — backbone-first, each phase ships + verifies on its own

| # | Phase | Pillar | Ship gate | Customer-visible |
|---|-------|--------|-----------|------------------|
| **A** | `TenantContext` resolver (server + client), source-of-truth = `companyProfile`; retire stale seed | Backbone | `_tenant()` returns correct config per tenant | no |
| **B** | Brand resolution (the 5-step brand plan) | 2 | NBD-unchanged + Oaks-correct render | **yes** |
| **C** | Per-tenant lead routing + alerts; unify the two intake pipelines | 3 | Oaks lead alerts Scott, not Joe; lands in CRM | yes (ops) |
| **D** | Company-level billing + seats; entitlements via TenantContext | 4 | owner pays once, seats add; gating by company plan | yes |
| **E** | Self-serve provisioning (resolve GCIP block; company creation + onboarding) | 1 | new tenant self-creates end-to-end | yes |
| **F** | Templated tenant sites + custom-domain routing | 5 | a 3rd tenant spun up from template on its own domain | **yes** |

**Why this order:** A unblocks everything. B is the visible proof + quick win. C kills the most
embarrassing gap (leads → Joe's cell). D/E make it *sellable* self-serve. F makes it *scale* past
hand-authoring. A–C are the "make NBD+Oaks truly clean" core; D–F are the "open the doors" SaaS layer.

---

## Cross-cutting blockers & decisions (settle before/within the relevant phase)
- **GCIP upgrade** (blocks Pillar 1 self-serve signup). Decide: upgrade to GCIP, or refactor `onRepSignup` to a Firestore trigger. *(Phase E)*
- **One Firebase project or two?** Today public leads split across `nobigdealwithjoedeal` (marketing) and `nobigdeal-pro` (SaaS). Unify intake. *(Phase C)*
- **Single brand/config source = `companyProfile`** (recommended) vs reviving `companies`. *(Phase A)*
- **Per-tenant doc prefixes** (e.g. `OAK-` customer IDs / cert numbers). *(Phase B)*
- **Domain strategy:** multi-site Firebase targets vs hostname reverse-proxy. *(Phase F — biggest infra call)*
- **Twilio A2P per tenant** — each tenant needs its own A2P campaign for SMS. *(Phase C, external dependency)*
- **Per-seat pricing model** — define tiers + seat math. *(Phase D)*

## Already solid (don't rebuild)
Per-company Firestore rules (`sameCompanyAsResource`), the `leads.companyId` invariant + backfill,
per-tenant `companyProfile` (the old global-`main` cross-tenant corruption vuln is fixed), and the
cross-tenant rules test. The foundation holds for N tenants — the work is the surfaces above.

## Verify-before-building caveats
This map is from a focused code read on 2026-06-07; confirm against live before each phase
(esp. exact Stripe key paths, the marketing-project intake, and current `onRepSignup` deploy status).

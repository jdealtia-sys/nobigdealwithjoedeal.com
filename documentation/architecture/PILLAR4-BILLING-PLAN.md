# Pillar 4 — Company-level billing & seats

> Scoping doc, 2026-06-07. Companion to [MULTI-TENANT-ARCHITECTURE.md](MULTI-TENANT-ARCHITECTURE.md)
> and [PILLAR1-PROVISIONING-PLAN.md](PILLAR1-PROVISIONING-PLAN.md). Pairs with
> Pillar 1 Phase 2 (charge at company creation). Goal: **one subscription per
> tenant (company), with seats** — not per individual user.

## Current state (grounded)
- **Per-USER, not per-company:** subscriptions live at `subscriptions/{uid}` (firestore.rules:371-374). The Stripe webhook (`functions/.../stripe`) writes by `client_reference_id = uid`; `customer.subscription.updated` finds the uid by `stripeCustomerId`.
- **Feature gating:** `docs/pro/js/billing-gate.js` `loadSubscription()` reads `subscriptions/{uid}` and checks the plan vs per-tier limits (free 10 leads/mo, starter 50, growth 500, enterprise ∞). There's a **hardcoded owner-email bypass**. Usage via a `trackUsage` callable → `subscriptions/{uid}.usage`.
- **`companies/{companyId}.subscription`** exists (`seed-companies.js`) but is **denormalized metadata, not the source of truth.**
- **Net:** team members all inherit the owner's plan only by accident (each user has their own `subscriptions/{uid}`); there's no seat model and no company-level billing.

## Target
- Authoritative subscription keyed to the **company**: `subscriptions/{companyId}` (or `companies/{companyId}.billing`). Pick one — recommend `subscriptions/{companyId}` to reuse the existing doc shape + rules.
- Team members resolve entitlements from their **company's** subscription (via the `_tenant().companyId` resolver from Pillar A).
- Plans carry a **seat count**; adding a member consumes a seat.

## Phased plan (each shippable; NBD unchanged via gated fallback)

### Phase 1 — Read-path unification (invisible)
- `billing-gate.js` resolves the **company's** subscription: read `subscriptions/{companyId}` (companyId from `_tenant()`), falling back to `subscriptions/{uid}` when absent. For NBD/solo (companyId == uid) the two keys are the same doc → **byte-identical**.
- One-time backfill: for multi-member companies, copy the owner's `subscriptions/{ownerUid}` → `subscriptions/{companyId}`. (Solo ops already match.)
- Retire the hardcoded owner-email bypass → drive off the company plan.

### Phase 2 — Stripe → company
- Checkout `client_reference_id = companyId` (not uid); success/cancel URLs not hardcoded to NBD's domain.
- Webhook writes `subscriptions/{companyId}`; map `stripeCustomerId → companyId` (store `companies/{companyId}.stripeCustomerId`).
- **Migration:** re-key existing `subscriptions/{uid}` → `{companyId}`; don't double-charge (reuse the existing Stripe customer/subscription, just re-point the Firestore key).

### Phase 3 — Seats
- Plan defines `seats`; `companies/{companyId}/members` count is checked on invite (Pillar 1 Phase 3). Per-seat pricing = a quantity on the Stripe subscription item (or metered). Downgrade below member count → block or prompt to remove members.

### Phase 4 — Signup paywall (with Pillar 1 Phase 2)
- New-company creation selects a plan → Stripe checkout → company is live. Free/trial tier allowed per business choice.

## Open decisions for Jo
- **Subscription key:** `subscriptions/{companyId}` (recommended) vs `companies/{companyId}.billing`.
- **Pricing model:** flat per-plan, or per-seat (e.g. "Growth $249/mo incl. 5 seats, +$49/seat"). Defines the Stripe product setup.
- **Trial / free tier** for new self-serve companies, and whether signup is paywalled up front (ties to Pillar 1's open/curated decision).
- **Migration window:** existing per-uid subs are NBD-only today (solo) → low-risk; confirm before re-keying.

## Risk notes
- Stripe is the one place real money moves — every change here is **propose-and-verify**, never auto-applied to live billing. The Firestore re-key (Phase 1/2) is safe (no charge change); the Stripe product/seat changes (Phase 3) touch pricing and need explicit sign-off + test-mode validation first.

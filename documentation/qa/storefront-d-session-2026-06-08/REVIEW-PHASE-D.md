# Sub-mission 2 — Phase D Review (read-only, NO money) — 2026-06-08

Independent 5-agent review of the existing Phase D build on `phase-d-build` (verified against live code, not memory). **Verdict: the build is fundamentally SOUND.** The payoff of pairing — code entitlements now match the canonical pricing page — is **confirmed green**. Money-validation + per-seat + the migration run remain gated on Jo's Stripe prereqs (no money actions taken).

## 1. Entitlement reconciliation (code ↔ canonical pricing) — ✅ GREEN
The brief's core requirement: the billing code must enforce what the page advertises.

| Tier | Page / PRICING.md | billing-gate.js | plan-limits.js | Match |
|------|-------------------|-----------------|----------------|-------|
| Free | $0 / 1 seat / 10 leads | $0 / 1 / 10 | 1 / 10 | ✅ |
| Solo (starter) | $99 / 1 / 50 | $99 / 1 / 50 | 1 / 50 | ✅ |
| **Crew (growth)** | **$299 / 3 seats / 500** | **$299 / 3 / 500** | **3 / 500** | ✅ |
| Scale (enterprise) | from $599 / ∞ | null / ∞ | ∞ | ✅ |

- **Crew = 3 seats / $299 everywhere.** (Memory's "$249 / 5 seats" was stale — the parallel session already corrected billing-gate.) **No code↔page mismatch.**
- Minor: `functions/stripe.js` line ~99 **comment** still says "$249" (cosmetic — the real Price is a deploy-time secret, not in code). → trivial 1-line comment fix recommended.
- Plan-vocabulary aliases (`starter`↔`foundation`, `growth`↔`professional`) are messy but functionally correct via normalization at each read. Latent footgun: `nbd-auth.PLAN_LEVELS['growth']` is `undefined` (mitigated today by `_normalizePlan()`; a future refactor could reintroduce the old upgrade-wall bug). → unify vocab in a future cleanup.

## 2. D-1 read-path + NBD byte-identical — ✅ PASS
- All 3 gates (billing-gate.js, nbd-auth.js, billing.js) resolve `companyId = claim.companyId || uid`, read `subscriptions/{companyId}` with fallback to `{uid}`. Solo/NBD (`companyId==uid`) collapses to a single read → **byte-identical**.
- **Owner-email bypass INTACT** in all 3 modules (identical email sets) — correctly KEPT (NBD's real sub is `professional`/500-cap, so the bypass is what gives Joe ∞; removing it would break byte-identical).
- No downgrade/self-lock vectors. Firestore subscriptions read matches the caller's OWN companyId claim (not `resource.data`) → no cross-tenant leak.

## 3. D-2 Stripe money-path — ✅ SOUND (concerns are moot/defense-in-depth)
Core subscription path is solid: checkout `client_reference_id=companyId`; webhook resolves owner uid via `companies/{cid}.ownerId` BEFORE `setCustomUserClaims` (slug-safe); **merges** existing claims (no role/companyId wipe); plan derived from immutable Price ID (not editable metadata); idempotency via atomic `stripe_events` create; signature verification with rawBody guards. `subscriptions` write stays admin-only.
- ✅ **RESOLVED — invoice payment-link "downgrade" concern is MOOT:** `firestore.rules` invoices allow `update` only `if isOwner(resource.data.createdBy)` — the paying homeowner cannot edit the invoice, so the line-item fallback isn't exploitable by the payer.
- Defense-in-depth (optional, not blocking): add a `companyId` check alongside the `createdBy` uid check in `createStripePaymentLink` + `invoice.paid`; make checkout success/cancel URLs tenant-aware for multi-domain (currently hardcoded to nobigdealwithjoedeal.com — a phishing-UX nit, not financial).

## 4. D-3 seats + rules — ✅ PASS (2 tracked gaps)
- **Seats = 3 for Crew** (matches page). `createTeamMember` seat-gate is load-bearing: runs BEFORE the member write (no orphan Auth accounts), hard-blocks at limit, owner-gated, platform-admin bypass, **seat-neutral re-invite** (re-inviting an existing member costs 0 seats).
- Rules widening safe: subscriptions READ → same-company members via caller's claim; WRITE stays false; **11 new cross-tenant test cases green (67/0)**.
- **Gap A — per-seat Stripe quantity NOT wired** (quantity hardcoded to 1, documented TODO; needs `STRIPE_PRICE_SEAT` + Jo's Stripe setup). Intentional so checkout can't mis-charge.
- **Gap B — silent downgrade-below-members:** on `customer.subscription.deleted`, the webhook downgrades to `free` even with >1 active member, with NO flag/notify. Spec said "flag + notify, don't auto-remove." → **Jo decision: implement the guard now, or accept as a post-launch refinement.**

## 5. Migration (`scripts/migrate-subscription-keys.js`) — ✅ REVERSIBLE + NO-CHARGE
- **Firestore-only** — zero `stripe.*` calls, no `require('stripe')`; reuses the existing Stripe customer/subscription verbatim. **A charge is impossible.**
- NBD/solo (`companyId==uid`) = **no-op**. Clears source `stripeCustomerId` after copy (kills dual-doc webhook ambiguity); source doc retained (reversible). Drift detection flags pre-existing targets.
- Dry-run by default; `--apply` requires `--i-have-a-fresh-backup` (flag enforced — but does NOT verify the file exists; Jo must confirm). Scope: only slug tenants with a source sub write (today: `oaks`).

---

## DECISIONS FOR JO
1. **Silent downgrade-below-members (Gap B):** implement "flag + notify" now, or accept silent → free as post-launch? (Propose-and-approve.)
2. (trivial, low-risk) approve the `stripe.js` `$249`→`$299` comment fix + the vocab-unify cleanup (future).
3. (optional hardening) the invoice `companyId` belt-and-suspenders + tenant-aware success URLs.

## PREREQS before the money-validation + migration (Jo provides; Claude does not touch credentials)
- [ ] Stripe **TEST-mode** keys (`sk_test_…`) in `functions/.env.local`.
- [ ] Re-point `STRIPE_PRICE_PROFESSIONAL` **$249 → $299** (test mode) — so the charge matches the page.
- [ ] Create `STRIPE_PRICE_SEAT` ($39/mo) for the per-seat add-on.
- [ ] Fresh backup: `node scripts/backup-collections.js` (subscriptions + leads + companies); **manually verify the file**.
- [ ] `node scripts/backup-collections.js --verify-only` → confirm NBD sub is paid (not free/absent) + Oaks state (ownerId set, source sub exists, target `subscriptions/oaks` absent).

## THEN (test-mode validation plan, vs the Oaks test tenant)
1. Checkout as Oaks owner (test card) → webhook writes `subscriptions/oaks` → gating follows the company plan.
2. Add a 4th seat → per-seat quantity bills (once `STRIPE_PRICE_SEAT` wired) → seat-gate blocks the 4th if not paid.
3. Confirm **NBD billing unchanged** (owner bypass + solo no-op).
4. Run `migrate-subscription-keys.js --apply --i-have-a-fresh-backup` (re-keys `oaks`; NBD no-op); verify reversibility.

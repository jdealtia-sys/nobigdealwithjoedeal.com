# Phase D — company billing + per-seat — BUILD STATUS (2026-06-08)

Branch: `phase-d-build` (pushed to origin). **Not merged, not deployed.** Built in an
isolated worktree to survive parallel-session clone resets. Grounded by a parallel
read-only edit-map workflow; reviewed by an adversarial multi-lens workflow.

## What shipped on the branch

### D-1 read-path + D-3 seats/gate/rules — MONEY-FREE, NBD byte-identical, TESTED ✅
Deployable on its own. Every billing gate resolves `companyId = (claim.companyId || uid)`
and reads `subscriptions/{companyId}` first, falling back to `subscriptions/{uid}`.

- `functions/plan-limits.js` (new) — single source of truth for `PLAN_LIMITS` (incl. `seats`),
  imported by `billing.js` + `handlers/admin.js` so the usage meter and the seat gate agree.
- `functions/billing.js` `trackUsage` — companyId from the **verified token only** (never
  `request.data`); reads+writes whichever doc is authoritative (no partial-doc/plan-loss seed).
- `docs/pro/js/billing-gate.js` + `docs/pro/js/nbd-auth.js` — company-first/uid-fallback reads.
- `functions/handlers/admin.js` `createTeamMember` — per-company **seat count-gate** before the
  Auth-user create (hard-block; company owner gated, platform-admin bypass; seat-neutral re-invite).
- `firestore.rules` — `subscriptions` READ widened to same-company members, matched on the
  caller's **own** `companyId` claim (never `resource.data`); `allow write: if false` unchanged.
- Tests added to `tests/firestore-rules.cross-tenant.test.js` + `tests/firestore-rules.test.js`.

**Test results:** cross-tenant rules **67/0** (11 new subscription cases), canonical rules pass,
billing 16/0, team-roles 16/0, smoke 1819/0, webhooks 13/0.

### D-2 money-path — AUTHORED ONLY, not deployed/run, gated on Jo ⚠️
- `functions/stripe.js` — checkout `client_reference_id` + `metadata.companyId = companyId`;
  base line item **stays `quantity: 1`** (the $39/seat add-on is a documented TODO needing a
  `STRIPE_PRICE_SEAT` price id — intentionally NOT wired so checkout can't mis-charge). Webhook
  writes `subscriptions/{companyId}` across all branches, resolves the **owner uid**
  (`companies/{companyId}.ownerId`, uid-heuristic fallback) before every `setCustomUserClaims`/
  `getUser` (a slug companyId would otherwise throw), **merges existing claims** (fixes a latent
  role/companyId wipe), reverse-maps `customerId → companyId`. Price-ID-trusted plan derivation
  (Audit G / F-08) preserved verbatim. Portal/status reads + `shared.requirePaidSubscription`
  are company-first with uid fallback. `stripe-success.js` refreshes the token and watches both
  the `{uid}` and `{companyId}` docs.
- `scripts/migrate-subscription-keys.js` — Firestore-only re-key (reuses the same Stripe customer,
  **never calls Stripe**), dry-run by default, `--apply` requires `--i-have-a-fresh-backup`.
  Dry-run validated against prod: **only `oaks` migrates** (1 doc, no Stripe customer).

### /pro landing rework — branch only, deploys WITH the Stripe price update
`docs/pro/index.html`: Free / Solo $99 / Crew $299 (+$39/seat) / Scale $599+ ladder with correct
`data-plan` keys (fixes the dead `blueprint`); removed the off-strategy "one-third price" line,
fabricated social-proof stats + 3 fake testimonials (honest reframe), and the uncertified
"SOC 2" claim; SMS reframed to "coming soon"; added Homeowner Portal + Voice pillars; JSON-LD
offers updated. **Must not deploy before Jo updates the Stripe prices** or the displayed prices
will disagree with the actual charge.

## Safe prod ops already done (read-only)
- Verified NBD `subscriptions/{uid}`.plan = **professional** (not enterprise) → the owner-email
  bypass is **kept** (removing it would cap NBD at 500 leads = not byte-identical).
- Backups of subscriptions/leads/companies/companyProfile → `C:/Users/jonat/nbd-backups` (outside repo).

## What needs Jo (the ONLY blockers — never via chat)
1. **Stripe TEST-mode key** in `functions/.env.local` + create products/prices incl. the **$39/seat**
   add-on price, and confirm exact $ amounts (reconcile the `$249` Stripe comment vs `$299` display).
2. **Hard-vs-soft seat gate** decision (current = hard block at invite; recommended).
3. **Billing visibility scope** — narrow the rules read to company-staff-only if billing shouldn't be
   rep-visible; decide whether to move `stripeCustomerId` to an owner-only sibling doc.
4. **Deploy go-ahead** for the money-free D-1+D-3 (auto-deploys on merge; gated on cross-tenant test + smoke).
5. **Deploy go-ahead** for D-2 (webhook/checkout) after Stripe test-mode validation.
6. **Migration go-ahead** — fresh backup, then `node scripts/migrate-subscription-keys.js --apply
   --i-have-a-fresh-backup` (only `oaks`, zero charge). NBD solo = no-op.

## Recommended sequence
Ship **D-1 + D-3 together** first (money-free, byte-identical, fully tested). Hold **D-2 + /pro**
until the Stripe step, then deploy them in one coherent change so displayed prices always match charges.

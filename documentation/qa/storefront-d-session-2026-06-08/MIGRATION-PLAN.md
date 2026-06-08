# Phase D Migration Plan — subscriptions re-key (uid → companyId)

**Status: DRAFT skeleton — finalized after Jo answers the subscription-key decision and confirms Stripe test-mode + backup.**
Do not run any step until Jo signs off (RULE 0 / RULE 1). NBD solo (`companyId == uid`) → re-key is a **no-op**.

---

## 0. Preconditions (Jo)
- [ ] Stripe **TEST-mode** access confirmed.
- [ ] **Back up `subscriptions` collection** (and `leads`) before any write. Export command:
  ```bash
  # Admin-SDK export — Jo runs. Reversible snapshot to JSON.
  node scripts/export-collection.js subscriptions > backups/subscriptions-2026-06-08.json   # (script TBD if absent)
  ```
- [ ] Decisions answered: sub-key location, pricing model, trial/free tier, Crew price.

## 1. Current state (verified)
- `subscriptions/{uid}` keyed by Firebase uid. Written by `functions/stripe.js` webhook (client_reference_id = uid) + `scripts/provision-tenant.js`.
- NBD = solo, `companyId == uid` → the only real sub today is NBD's (per PILLAR4 "existing per-uid subs are NBD-only → low risk").
- Oaks: `subscriptions/VuXj6x…` (owner uid), `companyId:'oaks'` denormalized on the doc.

## 2. Target state (pending sub-key decision)
- **If `subscriptions/{companyId}` (recommended):** read path resolves `subscriptions/{companyId}` with fallback to `subscriptions/{uid}`. Solo/NBD → same doc → byte-identical.
- Multi-member backfill: copy owner's `subscriptions/{ownerUid}` → `subscriptions/{companyId}`.

## 3. Re-key steps (D-2, propose-and-approve — TBD after decision)
1. Backup (step 0).
2. D-1 read-path unification deploys first (invisible; fallback keeps NBD identical). Smoke + tenant tests gate.
3. For each real tenant sub (today: Oaks): copy `subscriptions/{ownerUid}` → `subscriptions/{companyId}`, set `companies/{cid}.stripeCustomerId` map. **Reuse existing Stripe customer/subscription — no new charge.**
4. NBD: no-op (companyId == uid → same key).
5. Update `functions/stripe.js`: checkout `client_reference_id = companyId`; per-tenant success/cancel URLs; webhook writes `subscriptions/{companyId}`; map `stripeCustomerId → companyId`.
6. Validate in Stripe **TEST mode** against Oaks before any prod data change.

## 4. Rollback
- Re-key is additive (copy, not move) until verified → fallback read keeps old key live. Revert = point reads back to `{uid}` and delete the `{companyId}` copies.

## 5. Evidence log (test-mode validation)
- _(to be filled with Stripe test-mode results: checkout → webhook → subscriptions/{companyId} written → gating follows company plan → seats add → NBD unchanged)_

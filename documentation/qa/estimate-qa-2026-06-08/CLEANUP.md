# Cleanup Manifest — estimate-qa-2026-06-08

Every `ZZ_QA_`-prefixed record created during this run. **Purge on Jo's OK.**

| Type | Identifier | Firestore | Created | Purged? |
|---|---|---|---|---|
| V2 estimate | id `nJ7IU7zKJfvul74kaoeM` · owner "ZZ_QA_ Estimate Test 2026-06-08" · addr "1 QA Test Way, Cincinnati, OH 45202" · grandTotal $17,000 | `users/1phDvAVXHSg82wDLegAbQFq14Ci1/estimates/nJ7IU7zKJfvul74kaoeM` (estimateVersion v2) | 2026-06-08 (run) | ✅ PURGED 2026-06-08 via `_deleteEstimate` (count 6→5) |

## How to purge
- In NBD Pro → Estimates, find "1 QA Test Way, Cincinnati, OH 45202" (owner ZZ_QA_ Estimate Test 2026-06-08) → delete (trash icon). No linked lead created (`leadId: null`), so no CRM lead to remove.

## Notes / boundaries honored
- Only this one ZZ_QA_ estimate was persisted (via `EstimateV2UI.save()` → `_saveEstimate`). No real-customer estimate was edited/recalculated/regenerated.
- No e-sign/email/print SENT. No invoicing / Stripe.
- Retail-quote doc was generated for inspection only (client-side render).
- Service worker `/pro/sw.js` was unregistered to recover the wedged dashboard boot (reversible; it re-registered on reload).

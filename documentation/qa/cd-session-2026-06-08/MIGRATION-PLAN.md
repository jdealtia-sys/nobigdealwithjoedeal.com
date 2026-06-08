# Migration Plan — backups + Phase D re-key

> Owns the reversible, propose-and-approve data migrations for this session. Nothing here runs without Jo's explicit
> OK + (for Stripe) test-mode validation first. RULE 0/5: back up before any destructive/migration step.

## Backups (run BEFORE any migration — Jo, prod creds)
Export the at-risk collections from `nobigdeal-pro` so every step is reversible:
```
# Jo runs (gcloud auth on nobigdeal-pro). Adjust bucket as needed.
gcloud firestore export gs://<nbd-backup-bucket>/cd-2026-06-08/leads          --collection-ids=leads
gcloud firestore export gs://<nbd-backup-bucket>/cd-2026-06-08/subscriptions  --collection-ids=subscriptions
# (also recommended: companies, companyProfile — small, cheap insurance)
```
Record the export path + timestamp here once done:
- leads export: _pending_
- subscriptions export: _pending_

## Phase C — intake bridge (NOT a destructive migration)
The H-1 bridge is **additive** (new `leads` docs from public submits; deterministic ids = idempotent). No existing
data is mutated. Reversal = delete the bridged `leads` docs (filter `webLead == true`) + remove the trigger. No backup
strictly required, but the `leads` export above covers it.

## Phase D — subscription re-key (DESTRUCTIVE-ish; propose + sign-off + test-mode first)
**Do NOT run until the Phase C checkpoint is signed off AND Jo OKs.** NBD is solo (companyId == uid) → re-key is a
**no-op for NBD** (same doc id). Real risk only for multi-member companies (none today besides test tenants).

Steps (to be detailed at Phase D start, after a fresh read of `stripe.js` + `billing-gate.js`):
1. Backup `subscriptions` (above).
2. D-1 read-path: `billing-gate.js` reads `subscriptions/{companyId}` then falls back to `subscriptions/{uid}`.
   NBD → same doc → byte-identical. (Invisible; safe to proceed without re-key.)
3. D-2 Stripe → company: checkout `client_reference_id = companyId`; webhook writes `subscriptions/{companyId}`;
   map `stripeCustomerId → companyId` on `companies/{cid}`. **Re-key** existing `subscriptions/{uid}` → `{companyId}`
   **reusing the same Stripe customer/subscription — NO new charge.** For NBD: no-op.
4. Validate in **Stripe TEST mode** with a ZZ_QA tenant before any real-data action.

Re-key script (to be authored at Phase D, dry-run first):
- read each `subscriptions/{uid}`, resolve `uid → companyId` (claim or companies owner), `set` at
  `subscriptions/{companyId}` (skip if uid == companyId), leave the old doc until verified, then clean up.
- **Reversal:** the `{uid}` docs are left in place until post-verify; restore = point reads back / delete the
  `{companyId}` copies.

## Open decisions feeding the Stripe product setup (Jo)
- Subscription key: `subscriptions/{companyId}` (recommended) vs `companies/{companyId}.billing`.
- Pricing: flat per-plan vs per-seat (e.g. Growth $249/mo incl. 5 seats, +$49/seat).
- Trial / free tier for new companies.

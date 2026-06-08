# Cleanup Manifest — Storefront-finish + Phase D review session (2026-06-08)

No `ZZ_QA_` data artifacts were created this session (no new test tenants — the review was read-only and reused the existing **Oaks** test tenant). The artifacts below are tooling/branches, not prod data.

## Branches / worktrees created (deliverables — do NOT purge until merged to main + launched)
- Branch **`storefront-legal-on-phased`** (off `phase-d-build`) — the storefront+legal+pricing unification. Fast-forward-merged into `phase-d-build`. Redundant once `phase-d-build` is pushed; safe to delete the branch + its worktree AFTER that.
  - Worktree: `C:/Users/jonat/nbd-storefront-on-phased` — remove with `git worktree remove C:/Users/jonat/nbd-storefront-on-phased` when done.
  - node_modules junctions created in that worktree (`functions/node_modules`, `tests/node_modules` → main clone) — removed automatically with the worktree.

## Ephemeral (stop when done)
- Preview server `nbd-http` (port 8090) — used to verify privacy.html render. Stop via preview_stop when finished.

## Reusable existing test artifacts (do NOT purge — Phase C provisioned these)
- `companyId:'oaks'` — `companies/oaks`, `companyProfile/oaks`. Owner `zz-qa-oaks-owner@nobigdealwithjoedeal.com` (uid `VuXj6xUYoEVYwL7mhl1hFSN1XRx1`), plan `professional`, active. Reuse for the Stripe test-mode validation. (The `zz-qa-oaks-owner` account is a stand-in to purge when the real Scott takes over; brand/company docs stay.)

## Stripe TEST-mode artifacts (to be logged when the money-validation runs)
- _(none yet — test products/prices/customers/subscriptions will be logged here once Jo provides test-mode access)_

## Backups (when the migration runs)
- `node scripts/backup-collections.js` writes to `C:/Users/jonat/nbd-backups` (OUTSIDE the repo). Keep until the migration is verified in prod.

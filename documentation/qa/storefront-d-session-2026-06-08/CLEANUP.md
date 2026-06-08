# Cleanup Manifest — Storefront-finish + Phase D review session (2026-06-08)

No `ZZ_QA_` data artifacts were created this session (no new test tenants — the review was read-only and reused the existing **Oaks** test tenant). The artifacts below are tooling/branches, not prod data.

## Session wrap-up (2026-06-08) — repo left clean + ready for the next agent
- ✅ **`phase-d-build` pushed to origin** (HEAD `b70ae7e9`) — the canonical trunk with all storefront + legal + Phase D review + seat-overage work + these trackers + `HANDOFF.md`. `origin/phase-d-build == local`.
- ✅ **Temp worktree `C:/Users/jonat/nbd-storefront-on-phased` removed** + branch **`storefront-legal-on-phased`** deleted (it was fully contained in `phase-d-build`; its node_modules junctions went with it).
- ✅ **Main clone (`C:/Users/jonat/nobigdealwithjoedeal.com`) cleaned** — my superseded Sub-mission-1 working-tree edits on `feat/pro-terms-page` were discarded (the canonical versions live on `phase-d-build`). Left untouched: other sessions' untracked files (`documentation/qa/live-qa-2026-06-07/`, `theme-sweep-2026-06-07/`, `functions/set-jd-claims.js`, `scripts/seed-demo-access.js`) and `nbd-phase-c-worktree`.
- ✅ Preview server `nbd-http` (port 8090) stopped.
- Note: `feat/pro-terms-page` is now an **obsolete** feeder branch (superseded by `phase-d-build`); not deleted (it's pushed + has its own history). The next agent should branch off **`phase-d-build`**.

## Reusable existing test artifacts (do NOT purge — Phase C provisioned these)
- `companyId:'oaks'` — `companies/oaks`, `companyProfile/oaks`. Owner `zz-qa-oaks-owner@nobigdealwithjoedeal.com` (uid `VuXj6xUYoEVYwL7mhl1hFSN1XRx1`), plan `professional`, active. Reuse for the Stripe test-mode validation. (The `zz-qa-oaks-owner` account is a stand-in to purge when the real Scott takes over; brand/company docs stay.)

## Stripe TEST-mode artifacts (to be logged when the money-validation runs)
- _(none yet — test products/prices/customers/subscriptions will be logged here once Jo provides test-mode access)_

## Backups (when the migration runs)
- `node scripts/backup-collections.js` writes to `C:/Users/jonat/nbd-backups` (OUTSIDE the repo). Keep until the migration is verified in prod.

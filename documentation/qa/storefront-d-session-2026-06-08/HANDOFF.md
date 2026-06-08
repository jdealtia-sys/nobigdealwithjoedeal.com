# Launch-Runway Handoff — after Storefront-finish + Phase D review (2026-06-08)

## What shipped this session
- **Storefront finalized + unified onto `phase-d-build`** (the canonical trunk): SaaS **Privacy Policy** + **Terms** (phase-d-build had neither), pricing reconciled to `documentation/PRICING.md` (Crew **3 seats** / $299 / $599 Scale / ~30% annual), **early-access CTA honesty** (self-serve signup is Phase E and doesn't grant a working trial yet), dead Terms footer link wired, `/pro/landing` stale masterclass page **retired via 302 redirect**. Merged into `phase-d-build` (HEAD `60ffbda8`+, local-only — **not pushed/deployed**; only `main` auto-deploys).
- **Phase D reviewed (read-only, no money)** — see `REVIEW-PHASE-D.md`. The existing build (D-1 read-path, D-2 Stripe, D-3 seats, migration) is **sound**; **code entitlements match the canonical page (3 seats/$299)**; **NBD byte-identical confirmed**; migration is **reversible + no-charge**.

## Answered decisions (this session + carried)
| Decision | Answer |
|----------|--------|
| Subscription key | `subscriptions/{companyId}` (NBD solo = same doc) |
| Pricing model | **Per-seat** — Crew base incl. **3 seats** + $39/extra |
| Crew price | **$299** canonical (Stripe Price must be re-pointed $249→$299) |
| Trial / free tier | Free tier + 14-day Crew trial; no signup paywall (paywall = Phase E) |
| Storefront branch | **`phase-d-build` is the trunk**; storefront/legal merged in |
| landing.html | **Retire via 302 redirect** to `/pro/` (reversible if later reconciled) |
| Owner-email bypass | **KEEP** (NBD's real sub is `professional`/500-cap; bypass = Joe's ∞) |

## Still pending / open
- **Silent downgrade-below-members (D-3 Gap B):** webhook downgrades to free with >1 member, no flag/notify. **Jo to decide:** implement the guard, or accept post-launch.
- **Per-seat add-on not wired:** needs `STRIPE_PRICE_SEAT` + Jo's Stripe test-mode setup.
- **GCIP decision (Phase E):** self-serve signup needs the GCIP-vs-Firestore-trigger call (`onRepSignup` blocking trigger can't deploy until the project is on GCIP — see memory `onrepsignup-gcip-gap` + `access-code-login-iam-gap`).

## The runway order (do NOT skip the audit)
1. **(this session's remainder)** Jo provides Stripe prereqs (test-mode keys, $249→$299 Price, `STRIPE_PRICE_SEAT`, fresh `subscriptions` backup) → then: wire per-seat, validate checkout→webhook→seats vs the **Oaks** test tenant in TEST mode, run the migration (re-keys `oaks`; NBD no-op), confirm NBD unchanged.
2. **Security / isolation audit** — the brief already on the shelf. **This is the gate BEFORE signup.**
3. **Phase E — self-serve signup** (GCIP decision + onboarding) + the **D-4 signup paywall**.

## Where things live
- Trunk: branch `phase-d-build` (worktree `C:/Users/jonat/nbd-phase-d-worktree`). Storefront+legal merged in.
- This session's working branch: `storefront-legal-on-phased` (worktree `C:/Users/jonat/nbd-storefront-on-phased`) — fast-forward-merged into phase-d-build; redundant once phase-d-build is pushed.
- Trackers: `documentation/qa/storefront-d-session-2026-06-08/` (STATUS, REVIEW-PHASE-D, MIGRATION-PLAN, HANDOFF, CLEANUP).
- Phase D build tracker (parallel session): `documentation/qa/phase-d-build-2026-06-08/STATUS.md`. Canonical pricing: `documentation/PRICING.md`. Plan: `documentation/architecture/PILLAR4-BILLING-PLAN.md`.

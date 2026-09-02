# Next session — brief as of 2026-09-02

> Supersedes [NEXT_SESSION-2026-09-01](NEXT_SESSION-2026-09-01.md), whose
> actionable lanes are all closed. Session record:
> [SESSION-2026-09-02-t3-slices-and-copycat](SESSION-2026-09-02-t3-slices-and-copycat.md).

## State of the world

- **Rock 4 Tranche 3: the T3-M freed 15 are ALL converted** (#1338 dashboard-ui
  band of 8, #1339 maps-routing band of 6, #1340 crm-portal-bridge singleton),
  each evidence-first (70-agent derive/prove/refute workflow) with differential
  emulator snapshots and graduate smoke pins. 17 of the dispatch maps' 36
  entries resolve registry-only. The plan carries a fresh §UPDATE 2026-09-02 —
  read it before the next slice.
- **Copycat watch fixed** (#1337): its first fire's "6 signals" were 100% API
  noise; signal/infra split shipped, code search is now a declared PAT-gated
  channel, proof run green. Monthly greens are trustworthy again.
- **Dependabot lane closed**: #1323/#1324 rebased clean and merged; all four
  from the 09-01 handoff are in.
- Peer-session coordination note: the audit-script migration chip resolved
  as verify-don't-rebuild; #1336 closed the last stale docstring.

## Lanes, in priority order

1. ~~**T3: the eight bonus map-only convertibles**~~ — **DONE same evening
   (#1342)**: all eight registry-only across six owner files, both test-side
   reads rewired to the registry, crm.js's dead W93 twin deleted and its
   auto-global converted to a const. Differential-proven (8/8 off window,
   8 map probes flipped to registry, zero drift). 25 of the maps' 36
   entries resolve registry-only now; what remains blocked is the
   genuinely-entangled 11 (bare cross-file calls / twin implementations) —
   see T3-B and the twin-ownership warning below.
2. **T3-B and beyond** per the plan — with the twin-ownership warning: three
   blocked names (closeTaskModal, closeShortcutsPanel, closeCmdPalette) have
   two DISTINCT implementations racing for the window slot; resolving
   ownership is its own decision before any conversion.
3. **Rock 2**: nothing to do but the weekly Sentry glance
   (`estimates.js DEPRECATED` filter); the 30-day clock runs to ~2026-09-30.
4. **Marketing** per POSTING-LOG: photos out-reach posts; the joe-hero face
   photo is the standing highest-leverage gap.

## Jo's queue (unchanged unless noted)

- **Copycat PAT (optional, ~3 min or decide to skip)** — WEEKLY_CADENCE
  one-off queue, top item. Skipping is legitimate; the summary names the
  channel OFF each month.
- Stripe test-mode verify for the parked `chore/stripe-pin-harden` (or drop
  it) — carried since June.
- The standing weekly content loop (GBP post, photos, review replies).

## Watch-outs (carried + new)

- `main` is held by the `nbd-wt-ledger-recon` worktree — branch from
  `origin/main`, never check out `main` in the primary checkout.
- The snapshot harness now takes `GLOBALS_SNAPSHOT_EXTRA` (comma-separated
  names) — BEFORE/AFTER runs of a conversion slice share one list without
  editing the spec mid-measurement. It remains deliberately unwired in CI
  (differential tool; a lone run has nothing to compare against).
- A **resumed** Workflow's re-run agents see the LIVE tree, not the original
  run's tree — verdicts written after your edits land can "refute" a proof as
  stale while actually confirming the landed state. Read with the tree's
  motion in mind.
- Cache busters: `crm-portal-bridge.js` is referenced by BOTH a script tag
  and a `<link rel="preload">` in each dashboard HTML — bump both or ship
  skew.

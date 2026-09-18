# Session handoff — 2026-09-18 (part 3)

## Status: nothing queued, nothing in-flight

Continuing straight on from [part 2](NEXT_SESSION-2026-09-18-part2.md)'s
#1644–#1648: four more Globals Tranche 3 T3-C PRs shipped and merged
(#1650–#1653), plus the separately-flagged Assign-button bug was fixed in
its own session (#1649, merged in between). Nine T3-C PRs total today
across both sessions (#1644–#1647, #1649 [not T3-C, the bug fix],
#1650–#1653). No open PR, no uncommitted changes, no background task
running.

## What shipped since part 2 — four more T3-C edges (22 names converted today, session-wide)

- **#1650 — `warranty-claim.js` edge**: `missingClaimFields`, `subTypeLabel`,
  `subTypeOptionsFor` — the first edge whose names are **imported
  bindings from `crm-stages.js`**, not local declarations, re-exported
  onto `window` purely as a module→classic-script bridge. Corrected a
  stale "exposed for crm.js" comment in passing (crm.js reads none of
  that 14-name block; `warranty-claim.js` is the real, sole consumer of
  the 3 converted here). One self-reference guard removed entirely
  (ES-import bindings are live before any module code runs, so the old
  defensive `window.X ? window.X() : ...` check was unnecessary).
  `warranty-claim.js` also loads on `customer.html`, where these 3 were
  already unavailable before this PR too — already gracefully guarded,
  unchanged.
- **#1651 — `pipeline-builder.js` edge**: `applyPipelineConfig` (a NAMED
  function expression), `resolvePipelineConfig` (another `crm-stages.js`
  import), `STAGE_ROLE` (a genuine **rename-on-export** — imported as
  `ROLE`, registered as `STAGE_ROLE`, key differs from value, first time
  in this migration). Consumed by Settings → Pipelines, a real
  tenant-facing feature (owner/company_admin customize kanban
  stages/views/semantic roles). Two independent reviewers traced all 4
  real user flows end to end (open Settings, change a stage role, the
  bug-fix-sensitive Reset-to-defaults ordering, save→live-board-update) —
  clean. One reviewer additionally discovered a more precise load-order
  mechanism than assumed: `pipeline-builder.js`'s `<script>` sits inside
  an inert `<template>` that only executes on an explicit
  `goTo('settings')`, so the registry is guaranteed populated well before
  it can even be fetched.
- **#1652 — `dashboard-widgets.js` photo modal edge**: `_uploadPhoto`,
  `_getPhotos` — the dashboard's lead-detail photo modal (distinct from
  the customer.html photo pipeline in #1644). **Surfaced a structural gap
  in the migration's own tooling**: `globals-xref.js`'s census only scans
  `docs/pro/**`, so `tests/e2e/pro-authed.spec.js` (a Playwright spec
  reading `window._uploadPhoto` directly in two places — a readiness gate
  and the actual upload call) was invisible to it. Caught by adversarial
  review, not the census. Fixed both spec call sites; recorded
  **permanently** in the plan doc's blind-spots list and per-name-proof
  checklist — grep `tests/e2e/` too, not just `docs/`, before trusting
  "single consumer" on any future slice. CI's Authed E2E shards (all 6)
  passed on the fixed spec — the real proof, not just local static checks.
- **#1653 — `dashboard-actions.js` realtime-teardown edge**:
  `_mJdTeardownRealtimeTabs` only, 1 of 4 census candidates. First edge
  whose owner file wasn't a `*-bootstrap.module.js`. Re-derived
  `dashboard-actions.js`'s real IIFE boundaries from scratch (the file has
  SEVERAL separate IIFEs, not one) — the declaration and the registry
  block it joins both sit in the same IIFE (1310–2355). **The other 3
  candidates (`absoluteDeleteProspect`, `toggleProspectHidden`,
  `viewProspectOnMap`) do NOT convert the same way** — they sit in a
  genuine top-level gap between IIFEs (2355–2519), so converting to plain
  declarations wouldn't take them off `window` (same auto-global trap as
  the reverse customer-tasks-ui.js edge from #1644). Needs T3-A-style
  IIFE-wrapping first — flagged, not attempted.

Full per-edge detail, exact reasoning, and every "found but not fixed/not
attempted" item are in
[globals-tranche3-plan.md](../../docs/dev/globals-tranche3-plan.md)'s
2026-09-18 update blocks — read those before touching T3-C again.

**T3-C long tail is now ~127 names** (down from ~145 at the start of
today's work — 22 names converted across 8 PRs this session,
`documentation/projects/WEEKLY_CADENCE.md` item 12 and the plan doc's
table both current as of this handoff).

## Two more dead ends found and permanently recorded this round

- **`dashboard-api.js`** has no IIFE anywhere in its 523 lines —
  `_revokePortalLink`/`_sharePortalLink` can't convert via the simple
  pattern (same auto-global trap). Not attempted.
- **`dashboard-load-status-banner.js`'s `__nbdGstaticTest`/
  `__nbdHardReset`** are deliberate devtools-console recovery tools — the
  file's own header comment says "Self-recovery globals stay on window so
  the user can fire them from devtools if the on-page UI isn't
  reachable." Added to the plan doc's permanent **Keep-as-API** list —
  never convert these, regardless of what the census says.

## If you're picking this up cold

Nothing is blocked, nothing is waiting on Jo. The T3-C long tail's
remaining easy wins (single safe owner file, no IIFE gymnastics needed)
are largely exhausted — every edge investigated this round needed either
a harder IIFE-wrapping fix first, or was ruled out entirely. Options,
ranked by readiness:

1. **T3-A-style IIFE-wrapping** for the 3 `dashboard-actions.js` names
   flagged above (`absoluteDeleteProspect`, `toggleProspectHidden`,
   `viewProspectOnMap`) or the `customer-tasks-ui.js` reverse edge from
   #1644 (5 names) — genuinely bigger, different-risk work; read the
   T3-A correction section in the plan doc first (multiple past sessions
   found "mechanically safe" was not).
2. **More T3-C long tail** (~127 names) — re-derive each edge from a
   fresh census; the proven-safe pattern (module-owned or already-IIFE'd
   names) still has candidates, they just take more digging now that the
   obvious ones are done. **Always check**: (a) is the owner file
   actually IIFE-wrapped at that exact line, not just "IIFE-wrapped
   somewhere" (re-derive column-0 boundaries, don't brace-count across a
   large file — unreliable, bit this session twice); (b) grep
   `tests/e2e/*.spec.js` in addition to `docs/`; (c) read the surrounding
   comments for a "deliberately on window" note before assuming
   convertibility.
3. **Inline-CSS dedup phase 2, slice 3** (WEEKLY_CADENCE item 10) — 3 more
   small no-conflict blocks, untouched this session, a genuinely
   different lane if T3-C's returns feel too diminished for now.
4. Whatever Jo asks for next.

This session ended by choice, not because anything was blocked — the
T3-C long tail's remaining candidates now cluster into the harder,
different-risk-profile work (T3-A IIFE-wrapping) rather than more quick
wins, which is a natural place to check in rather than pushing forward
on momentum alone.

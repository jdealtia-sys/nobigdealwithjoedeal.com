# CRM / dashboard responsive & cascade map

Reverse-engineered during the 2026-07 CRM mobile-layout work. This is the
reference for finishing the Phase 2 consolidation **without** blind
regressions — it records where every header/kanban/CRM rule lives, which
file wins, and which breakpoints are canonical vs intentional-micro vs
accidental.

> **Why this doc exists:** the same layout bug kept getting "fixed" in a new
> place, spawning a file literally named `kanban-force.css`. The fix is one
> source of truth per component + canonical breakpoints — but the aggressive
> version can only be verified on a real device (headless CI has no notch and
> can't judge intermediate-width column widths), so it must be done with the
> user in the loop. This map makes that safe and incremental.

## Stylesheet load order (dashboard.html)

Later = stronger at equal specificity.

| # | File | Role | !important |
|---|------|------|-----------|
| 1 | `css/theme-system.css` | theme tokens | 0 |
| 2 | `css/mobile-polish.css` | **early/weak** mobile tweaks | 5 |
| 7 | `css/dashboard-app.css` | **base app + global header + page-hdr** (4.5k lines) | 326 |
| 8 | `css/kanban-force.css` | **kanban + crm-header** (owns, wins) | 54 |
| 9 | `css/theme-bridge.css` | theme var bridge | 3 |
| 10 | `/assets/css/nbd-mobile.css` | **late/strong** shared mobile | — |
| 11 | `css/dashboard-nav.css` | universal nav (`#nbd-pro-nav`, hidden on dashboard) | 13 |

Plus **4 inline `<style>` blocks** in dashboard.html (highest priority in
document order). *(Corrected from 7 on 2026-08-07 — recount: 4 blocks,
2,662 chars, 2 `@media`.)*

## Component ownership (target state)

| Component | Selectors | Canonical owner | Currently also in |
|-----------|-----------|-----------------|-------------------|
| Global header | `header`, `.logo`, `.logo-mark`, `.brand-wrap`, `.hright`, `.hdr-tool` | dashboard-app.css | — (clean) |
| Per-view title | `.page-hdr`, `.page-title`, `.page-sub` | dashboard-app.css | — (clean) |
| CRM pipeline chrome | `.crm-header`, `.crm-hdr-label/title/stat/search/actions/views` | kanban-force.css | **dashboard-app.css @768 (split — retire)** |
| Kanban board/cols/cards | `#kanbanBoard`, `.kanban-col`, `.kcol-*`, `.k-card`, `.kc-*` | kanban-force.css | — (clean) |

**The one real split to retire:** `.crm-header` mobile rules live in both
`kanban-force.css` (@768 block, ~line 1195) and `dashboard-app.css` (@768
block, `.crm-header{...!important}` + `.crm-hdr-*` overrides). Since
kanban-force loads later, its non-`!important` rules already win, but
dashboard-app's `!important` ones override back — the confusing part.
Consolidation: move the effective values INTO kanban-force, delete the
dashboard-app duplicates, verify on device at 390 + 480.

## Breakpoints

**Canonical (use for all NEW header/kanban/CRM rules):**
- `768px` — tablet↔phone (sidebar drops, layout goes single-column)
- `480px` — phone

**Intentional micro-breakpoints — KEEP, do not collapse:**
- Kanban column width steps: `600 / 430 / 360px` (`kanban-force.css`) — narrow
  the column progressively so ~1.5 columns stay visible on smaller phones.
  These are tuned to device widths; collapsing them changes column sizing at
  real widths and is **not** headless-verifiable.

**Accidental / to migrate onto canonical during consolidation:**
- `dashboard-app.css` header/CRM rules scattered at `400 / 430 / 640 / 900px`
  — audit each; most can move to 768/480, but only with device verification.

## Load-bearing invariants (smoke- or geometry-guarded)

1. **Mobile header height** = `min-height:calc(48px + env(safe-area-inset-top))`.
   A bare `height:48px` + the notch `padding-top` spills content out below the
   black bar. Guarded: `tests/smoke/dashboard.test.js` (static) — the E2E
   geometry tests can NOT catch it (headless has `safe-area-inset-top:0`).
2. **`.k-card { flex-shrink:0 }`** — the `.kcol-body` is a bounded flex column;
   without it, full columns squash cards below content height and clip the
   phone/footer row. Guarded: geometry E2E (`kc-phone-row`/`kc-footer` within
   card bounds), 390 + 480.
3. **`will-change:box-shadow` only on `.k-card:hover`** — persistent promotion
   tears the rightmost column during horizontal scroll.
4. **Header logo-mark / wordmark non-overlap**, **title/stat non-overlap +
   contained in `.crm-header`**, **no document horizontal overflow** — geometry
   E2E, 390 + 480.

## Doing the aggressive consolidation later (checklist)

1. One PR per component (crm-header first — it's the only real split).
2. Compute the effective mobile values (title/stat/label/search/actions) from
   both files; put them ONCE in kanban-force's @768 block.
3. Delete the dashboard-app `.crm-header*` mobile duplicates.
4. Keep the geometry net green (390 + 480) — necessary, not sufficient.
5. Deploy to a preview or main, **user confirms on device** at a couple widths
   + both themes, BEFORE moving to the next component.
6. Never merge a header/CRM layout change on green CI alone — the notch and
   intermediate widths are invisible to headless.

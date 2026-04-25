# `dashboard.html` Decomposition Plan — Rock 4 Phase 1 Inventory

> **Status:** Phase 1 (inventory only). **Zero code changes** in this PR.
> The numbers below are a snapshot of `docs/pro/dashboard.html` at HEAD on
> branch `claude/rock4-phase1-dashboard-inventory`. Re-run the awk
> commands in [Methodology](#methodology) to refresh.

## Why this exists

`docs/pro/dashboard.html` is the daily driver and the largest single file
in the repo. Per [BIG_ROCKS.md](../../BIG_ROCKS.md) Rock 4, it must come
apart over 5+ phases. This document is the manifest Phase 2+ work uses to
plan each extraction. **No view should be extracted without first
verifying its entry against this manifest** — the inline-handler / global
counts are how risk gets scoped.

---

## File-level stats

| Metric | Value |
|---|---|
| Total lines | **14,978** |
| File size | **855 KB** uncompressed |
| Top-level views (`<div class="view">`) | **25** |
| Top-level modals | **15** |
| Inline `<style>` blocks | **8** (~4,491 lines, ~30% of file) |
| Inline `<script>` blocks | **18** (~6,516 lines, ~44% of file) |
| Inline `onclick="…"` handlers | **416** |
| External `<script src=…>` references | **~70** |
| Distinct `window.*` global references | **221+** |

**74% of the file is inline JS/CSS.** Extracting markup alone reclaims
little — the leverage is in moving the inline asset blocks out and
delegating the 416 `onclick` handlers.

---

## Top-level structure map

| Lines | Block | Notes |
|---|---|---|
| 1–4 | `<!doctype>` + `<html>` + `<head>` open | |
| 5–84 | `<style id="theme-system">` | **80 lines.** 147-theme palette CSS. **Phase 2 target.** Already has destination at `docs/pro/css/theme-system.css`. |
| 85–122 | `<head>` meta/links | |
| 123 | Inline boot: `__NBD_APP_CHECK_KEY` | App Check site key (1 line). |
| 128 | Inline boot: `__NBD_SENTRY_DSN` | Sentry DSN (currently empty string). |
| 130–147 | Static `<script src>` boot | standalone-compat, dom-safe, console-quiet, sentry-init, script-loader, leaflet+plugins. |
| 148–195 | `<script type="module">` (48 lines) | Firebase + App Check init module. |
| 196–2454 | `<script type="module">` (**2,259 lines**) | **Massive head boot.** Auth + Firestore wire-up + provisioning. |
| 2455–2456 | `</head>` `<body>` | |
| 2457–5620 | `<style>` (**3,164 lines**) | **Main app CSS.** Largest single inline block. |
| 5621–5958 | `<style id="kanban-force-css">` (338 lines) | Kanban-specific overrides. |
| 5959–6563 | `<style id="nbd-theme-bridge">` (605 lines) | Theme-variable bridge. |
| 6565–6568 | `<style id="crm-var-bridge">` (4 lines) | CRM CSS-var bridge. |
| 6579 | `<style>` (1-line keyframes) | `nbd-load-bar` keyframes. |
| 6581–6589 | inline `<script>` (9 lines) | |
| 6590–6720 | inline `<script>` (131 lines) | |
| 6726–6998 | `<style>` (273 lines) | |
| 7001 | `<nav id="nbd-pro-nav">` | App nav. |
| 7047–7139 | inline `<script>` (93 lines) | |
| 7143 | `<header>` opens | |
| 7489–7502 | inline `<script>` (14 lines) | |
| 7504 | `<div class="app-body">` opens | |
| 7507 | `<nav class="sidebar">` opens | |
| 7580 | `<nav id="breadcrumb-nav">` | Breadcrumb container. |
| 7584–10774 | **The 25 views** | See [Per-view manifest](#per-view-manifest). |
| 10776 | `</div><!-- /content -->` | |
| 10777 | `</div><!-- /app-body -->` | |
| 10781–14739 | **The 15 modals + giant body script** | See [Per-modal manifest](#per-modal-manifest) + body script note below. |
| 11246–14425 | inline `<script>` (**3,180 lines**) | **Main app body script.** Wedged between `tipsModal` and `docViewerModal`. Largest single script block. |
| 14445 | `<nav id="mobile-nav">` | |
| 14741–14807 | External `<script src>` defers | jspdf, html2pdf, apexcharts + ~30 in-repo modules. |
| 14808–14960 | inline `<script>` (153 lines) | Final boot wiring. |
| 14961–14978 | External `<script src>` defers (continued) | mobile-nav-customizer, connection-status-btn, admin-manager, integrations-client, signed-image-url, voice-memo, feature-flags. |

---

## Per-view manifest

`L` = body line range. `Δ` = total lines (rough; close markers verified
where `<!-- /view-* -->` comments exist). `Click` = inline `onclick="…"`
count. `Globals` = distinct `window.*` references. `InlineAsset` =
`<style>`/`<script>` lines inside the view.

Sorted by **decreasing extraction risk** (size × dependencies × inline
handlers).

| # | View id | L (start–end) | Δ lines | Click | Globals | InlineAsset | Notes / extraction risk |
|---|---|---|---:|---:|---:|---:|---|
| 1 | **view-settings** | 9141–10471 | **1,331** | 43 | 27 | **332** | **HIGHEST RISK.** 9 sub-tabs (`stab-panel-profile/appearance/estimates/daily/company/team/access/billing/notifications/help`). 4 inline `<script>` blocks (lines 9399, 9500, 9960, 10195). Don't touch until Phase 4+. |
| 2 | **view-docs** | 8705–9023 | 319 | 40 | 1 | 0 | Templates/document library UI. Many inline handlers but few globals — could be a mid-phase target. |
| 3 | **view-est** | 8110–8397 | 288 | 18 | 1 | 9 | Classic estimate builder shell. **Coupled to Rock 2** — wait until estimate engine consolidation (Rock 2 PR 5) lands before touching. |
| 4 | **view-draw** | 7884–8109 | 226 | 51 | 0 | 18 | Damage-area drawing (Leaflet). High onclick count but scoped to drawing toolbar. **Contains nested `comparisonModal` at line 8092** — extract together. |
| 5 | **view-crm** | 8398–8580 | 183 | 31 | 1 | 0 | Kanban pipeline — the most-used screen. **Don't go early**: regressions hit Joe in the field. |
| 6 | **view-map** | 7717–7883 | 167 | 42 | 0 | 0 | Leaflet damage-pin map. Tightly tied to map markers / autocomplete code in body script. |
| 7 | **view-admin** | 10474–10564 | 91 | 12 | 1 | 0 | **Contains nested `adminCreateModal` (10567–10606) + `adminEditModal` (10607–10641)** that sit OUTSIDE the view's closing `</div>` but logically belong to it. Extract together. Owner-only surface. |
| 8 | **view-dash** | 7601–7716 | 116 | 18 | 3 | 35 | Home dashboard widgets. Contains a small inline `<style>` (lines 7610–7635) + `<script>` (7639–7647). |
| 9 | **view-schedule** | 10700–10774 | 75 | ~6¹ | low¹ | 0 | Cal.com booking embed. Self-contained. ¹**See caveat:** the awk pass over-attributed everything past line 10780 (modals + main body script) to this view because there is no following `view-*` to bound it. Real schedule view is ~75 lines + handful of `cal*()` handlers. **Good early Phase 3 candidate.** |
| 10 | **view-joe** | 9024–9083 | 60 | 10 | 1 | 0 | "Ask Joe" AI chat surface. Self-contained, depends on `window.DecisionEngine`. |
| 11 | **view-photos** | 8583–8632 | 50 | 5 | 4 | 0 | Photo grid. Depends on `window.PhotoEngine` + `window._currentPhotoLeadId` + `window._photosOnlyWithPhotos`. |
| 12 | **view-reports** | 9106–9140 | 35 | 2 | 1 | 0 | Reports surface. Depends on `window.NBDReports`. **Strong Phase 3 candidate.** |
| 13 | **view-board** | 9084–9105 | 22 | 0 | 0 | 0 | Stub — empty container, populated by external JS. **Strongest Phase 3 candidate.** |
| 14 | **view-repos** | 8669–8690 | 22 | 1 | 0 | 0 | "Rep OS" stub: header + `<div id="repOSContainer">` empty state. **Strong Phase 3 candidate.** |
| 15 | **view-storm** | 8633–8650 | 18 | 1 | 0 | 0 | "Storm Center" stub: header + `<div id="stormCenterContainer">`. **Handoff-recommended Phase 3 candidate.** |
| 16 | **view-closeboard** | 8651–8668 | 18 | 1 | 0 | 0 | "Close Board" stub. **Strong Phase 3 candidate.** |
| 17 | **view-products** | 10642–10659 | 18 | 1 | 0 | 0 | Products library shell. Stub. |
| 18 | **view-home** | 7584–7600 | 17 | 2 | 0 | 0 | Home tile screen. Default-active view (`class="view active"`). |
| 19 | **view-training** | 10668–10683 | 16 | 1 | 0 | 0 | Sales training stub. |
| 20 | **view-academy** | 10684–10699 | 16 | 1 | 0 | 0 | Real Deal Academy stub. |
| 21 | **view-d2d** | 10660–10667 | 8 | 0 | 0 | 0 | D2D Tracker iframe-style stub. |
| 22 | **view-aiusage** | 8700–8702 | 3 | 0 | 0 | 0 | **Pure iframe** wrapping `/pro/analytics.html`. Trivial extract. |
| 23 | **view-aitree** | 8691–8693 | 3 | 0 | 0 | 0 | **Pure iframe** wrapping `/pro/ai-tree.html`. **Handoff-recommended Phase 3 candidate.** |
| 24 | **view-understand** | 8694–8696 | 3 | 0 | 0 | 0 | **Pure iframe** wrapping `/pro/understand.html`. Trivial extract. |
| 25 | **view-projectcodex** | 8697–8699 | 3 | 0 | 0 | 0 | **Pure iframe** wrapping `/pro/project-codex.html`. Trivial extract. |

¹ The awk heuristic that produced 86 onclicks / 221 globals / 3,333 inline-asset lines for `view-schedule` over-counted because no `view-*` tag follows it. Real numbers shown above.

---

## Per-modal manifest

All top-level modals start after the `</div><!-- /app-body -->` close at
line 10777, except where noted. Two modals (`adminCreateModal`,
`adminEditModal`) are nested inside `view-admin`'s scroll wrapper and one
(`comparisonModal`) is nested inside `view-draw`.

| # | Modal id | Line range | Δ | Notes |
|---|---|---|---:|---|
| 1 | `comparisonModal` | 8092–~8109 | ~18 | **Nested in view-draw.** |
| 2 | `adminCreateModal` | 10567–10606 | 40 | **Nested in view-admin scope.** Class `modal-overlay`. |
| 3 | `adminEditModal` | 10607–10641 | 35 | **Nested in view-admin scope.** Class `modal-overlay`. |
| 4 | `quickAddModal` | 10781–10839 | 59 | Top-level. Class `modal-bg`. |
| 5 | `leadModal` | 10840–11034 | 195 | Top-level. **Largest modal.** Add/edit lead form + property-intel result panel. |
| 6 | `warrantyCertModal` | 11035–11076 | 42 | Top-level. |
| 7 | `propertyIntelModal` | 11077–11162 | 86 | Top-level. |
| 8 | `propertyIntelConfirmModal` | 11163–11191 | 29 | Top-level. |
| 9 | `taskModal` | 11192–11211 | 20 | Top-level. |
| 10 | `photoModal` | 11212–11229 | 18 | Top-level. |
| 11 | `tipsModal` | 11230–~11245 | ~16 | Top-level. **Followed by the 3,180-line main app body script** (lines 11246–14425), which is why awk's range heuristic mis-reads tipsModal as 3,198 lines long. |
| 12 | `docViewerModal` | 14428–14552 | 125 | Top-level. |
| 13 | `nbd-picker-modal` | 14553–14608 | 56 | Top-level. Theme picker. |
| 14 | `nbd-howto-modal` | 14609–14639 | 31 | Top-level. |
| 15 | `cardDetailModal` | 14640–~14739 | ~100 | Top-level. Lead-card detail drawer. |

---

## Inline asset blocks (the actual leverage)

### `<style>` blocks — 4,491 lines total

| Lines | Id / context | Δ | Phase target |
|---|---|---:|---|
| 5–84 | `theme-system` | 80 | **Phase 2** → `docs/pro/css/theme-system.css` (the file already exists). 147 themes inline; ~80 KB on every page load. |
| 2457–5620 | (anonymous, main app CSS) | 3,164 | Phase 2b candidate → `docs/pro/css/dashboard-app.css`. |
| 5621–5958 | `kanban-force-css` | 338 | Phase 2c → `docs/pro/css/kanban-force.css`. |
| 5959–6563 | `nbd-theme-bridge` | 605 | Phase 2d → `docs/pro/css/theme-bridge.css`. |
| 6565–6568 | `crm-var-bridge` | 4 | Merge into theme-bridge. |
| 6579 | (keyframes) | 1 | Merge into app CSS. |
| 6726–6998 | (anonymous) | 273 | Identify usage; likely view-specific. |
| 7610–7635 | (inside view-dash) | 26 | Move with view-dash extraction. |

### `<script>` blocks — 6,516 lines total

| Lines | Context | Δ | Phase target |
|---|---|---:|---|
| 123 | App Check site key | 1 | **Keep inline** (boot config). |
| 128 | Sentry DSN | 1 | **Keep inline** (boot config). |
| 148–195 | Firebase init (module) | 48 | Could move to `docs/pro/js/boot/firebase-init.js`. |
| 196–2454 | **Head boot module** | **2,259** | Phase 5 target — split into `boot/auth.js`, `boot/provisioning.js`, etc. |
| 6581–6589 | (anonymous) | 9 | Investigate. |
| 6590–6720 | (anonymous) | 131 | Investigate. |
| 7047–7139 | (anonymous) | 93 | Investigate (likely nav setup). |
| 7489–7502 | (anonymous) | 14 | Investigate. |
| 7639–7647 | (inside view-dash) | 9 | Move with view-dash. |
| 8009–8026 | (inside view-est) | 18 | Move with view-est. |
| 8320–8328 | (inside view-est) | 9 | Move with view-est. |
| 9399–9461 | (inside view-settings) | 63 | Move with view-settings. |
| 9500–9585 | (inside view-settings) | 86 | Move with view-settings. |
| 9960–10032 | (inside view-settings) | 73 | Move with view-settings. |
| 10195–10268 | (inside view-settings) | 74 | Move with view-settings. |
| 10396–10431 | (inside view-settings) | 36 | Move with view-settings. |
| **11246–14425** | **Main app body script** | **3,180** | Phase 5 target — the biggest leverage point. Likely splits into `dashboard-shell.js`, `dashboard-events.js`, `dashboard-modals.js`. |
| 14808–14960 | Final boot wiring | 153 | Could move to `docs/pro/js/boot/dashboard-init.js`. |

---

## Recommended extraction order

Each phase = one PR. Verify on iPhone Safari (PWA + browser) and run
`cd tests && npm test` green before opening.

### Phase 2 — Theme CSS extract (1 session, 1 PR)

Already covered in BIG_ROCKS Rock 4. Move `<style id="theme-system">`
(lines 5–84, 80 lines) to `docs/pro/css/theme-system.css` and link it via
`<link>` in `<head>`. Verify theme picker still cycles through all 147
themes.

### Phase 3 — First view extraction (1 session, 1 PR)

**Recommended pick: `view-storm`** (lines 8633–8650, 18 lines, 1 click,
0 globals, 0 inline assets). It is a pure header + empty container that
external JS (`window.StormCenter`) populates. Risk floor.

Concrete steps:
1. Move `view-storm` HTML to `docs/pro/views/storm.html` (template
   fragment).
2. Replace inline `onclick="goTo('dash')"` with `data-action="goTo"
   data-args="dash"` and confirm the body-level delegate already in place
   handles it (or add a single delegate if not).
3. Use `<template id="tpl-view-storm">` in `dashboard.html`, clone-on-show
   when the user navigates to the view.
4. Verify Storm Center still loads its weather data.

If this proves out, **the next 4 stub views** in increasing complexity
order are:

| Order | View | Why |
|---|---|---|
| 1 | view-aitree | Pure iframe, 3 lines, 0 onclicks. Trivial. |
| 2 | view-understand | Pure iframe, 3 lines. Same pattern as aitree. |
| 3 | view-projectcodex | Pure iframe, 3 lines. |
| 4 | view-aiusage | Pure iframe, 3 lines. |
| 5 | view-board | Stub container, 0 onclicks. |
| 6 | view-repos | Stub container, 1 onclick. |
| 7 | view-closeboard | Stub container, 1 onclick. |
| 8 | view-products | Stub, 1 onclick. |
| 9 | view-training | Stub, 1 onclick. |
| 10 | view-academy | Stub, 1 onclick. |
| 11 | view-d2d | Stub, 0 onclicks. |
| 12 | view-home | Tile screen, 2 onclicks, default-active. |

That batch removes 12 views and ~140 lines from the monolith with near-zero
risk. After that, the remaining 13 views are all "real" (≥30 lines or ≥10
onclicks) and need view-by-view care.

### Phase 4 — Real view extractions (3+ PRs)

In risk order from least → most painful:

1. **view-reports** (35 lines, 2 onclicks)
2. **view-photos** (50 lines, 5 onclicks)
3. **view-joe** (60 lines, 10 onclicks)
4. **view-schedule** (75 lines, ~6 onclicks)
5. **view-dash** (116 lines, 18 onclicks, contains inline style+script)
6. **view-admin** (91 lines + 75 lines of nested modals; needs careful
   modal handling)
7. **view-map** (167 lines, 42 onclicks, tightly coupled to body script
   map code)
8. **view-crm** (183 lines, 31 onclicks — **daily driver**, do near the
   end)
9. **view-draw** (226 lines, 51 onclicks, contains nested modal)
10. **view-est** (288 lines, 18 onclicks — **wait for Rock 2 PR 5**
    consolidation first, otherwise you'll be moving code that's already
    on the chopping block)
11. **view-docs** (319 lines, 40 onclicks)
12. **view-settings** (1,331 lines, 43 onclicks, 4 inline scripts —
    **biggest single fish**, save for last; consider splitting by sub-tab)

### Phase 5 — Inline `onclick` migration (1+ PRs)

416 inline handlers → body-level event delegate via `data-action` /
`data-args`. Can be done incrementally per view as Phase 4 progresses, OR
as a single sweep after all views are in template fragments.

### Phase 6 — Tighten CSP (after DNS cutover lands; Rock 1)

Once handlers are gone, drop `'unsafe-inline'` from `script-src` in
`firebase.json`. Requires Hosting to be authoritative — that's blocked on
Rock 1 (DNS swap on Joe).

---

## Caveats and open questions

1. **The "schedule" awk over-count.** As noted, my heuristic for
   per-view metrics attributed everything past line 10780 to
   `view-schedule` because there's no following `view-*` tag. The real
   per-view numbers for view-schedule are in the row above; the
   "schedule = 86 onclicks / 221 globals / 3,333 inline asset lines"
   figures from raw awk output are noise.

2. **`tipsModal` Δ-line measurement is wrong** for the same reason —
   the 3,180-line body script sits between `tipsModal` and
   `docViewerModal`. Real `tipsModal` size is ~16 lines.

3. **Nested modals.** Three modals are inside view scopes:
   `comparisonModal` (in view-draw), `adminCreateModal` and
   `adminEditModal` (in view-admin). They must be extracted together
   with their parent view OR moved out to top-level first as a prep PR.

4. **Globals leakage.** The inventory counted 173+ uses of the core
   globals (`_leads`, `_estimates`, `_user`, `_db`, `_photoCache`,
   `_taskCache`, `_storage`, `_subscription`, `_userPlan`,
   `_userSettings`, `_filteredLeads`). Extracting markup doesn't reduce
   global surface — that's a separate refactor (eventually a per-view
   module pattern with explicit imports).

5. **External-script load order.** The 70+ `<script src>` defers at
   lines 14741+ have implicit ordering. Don't move them around without
   tracing each one's `window.*` exports.

6. **Theme system pre-existing destination.** `docs/pro/css/theme-system.css`
   already exists (per BIG_ROCKS) — verify what's already there before
   pasting the inline block on top of it.

7. **The `?legacy=1` query-string fallback** mentioned in BIG_ROCKS
   Phase rollback plan does **not** exist yet. If we want emergency
   rollback per phase, that needs to be wired in early (probably Phase 2
   or as a small standalone prep PR).

---

## Methodology

All numbers above were produced from awk passes over the source. Re-run
to refresh:

```bash
# Total lines + size
wc -l docs/pro/dashboard.html
ls -la docs/pro/dashboard.html

# View ranges
awk '
  /<div class="view( active)?"[^>]+id="view-/ {
    if (start) print start"\t"prev"\t"NR-1
    match($0, /id="view-[a-z0-9-]+"/)
    prev = substr($0, RSTART+9, RLENGTH-10)
    start = NR
  }
  END { if (start) print start"\t"prev"\tEOF" }
' docs/pro/dashboard.html

# Onclicks per view
awk '
  /<div class="view( active)?"[^>]+id="view-/ {
    if (cur) print cur"\t"count
    match($0, /id="view-[a-z0-9-]+"/)
    cur = substr($0, RSTART+9, RLENGTH-10); count = 0
  }
  cur { count += gsub(/onclick="/, "&") }
  END { if (cur) print cur"\t"count }
' docs/pro/dashboard.html | sort -k2 -nr

# Inline style block sizes
awk '/<style/ { sstart = NR } /<\/style>/ { print sstart"\t"NR"\t"(NR-sstart+1) }' docs/pro/dashboard.html

# Inline script block sizes
awk '/<script[^>]*>/ && !/src=/ { in_s = 1; sstart = NR } in_s && /<\/script>/ { print sstart"\t"NR"\t"(NR-sstart+1); in_s = 0 }' docs/pro/dashboard.html

# Modal start lines
grep -nE '<div[^>]+class="modal-bg"[^>]*id="[^"]+"|id="(comparisonModal|adminCreateModal|adminEditModal|nbd-picker-modal|nbd-howto-modal)"' docs/pro/dashboard.html
```

---

## Definition of done — Phase 1

- [x] Manifest of all 25 views with line ranges + onclick counts
- [x] Manifest of all 15 modals with line ranges
- [x] Inline `<style>` and `<script>` block sizes
- [x] Per-view distinct `window.*` reference count
- [x] Risk-stratified extraction order with concrete next pick
- [x] Caveats and methodology documented
- [ ] **Joe review** ← awaiting

**No code changes.** Phase 2 (theme CSS extract) opens after Joe signs
off on this manifest.

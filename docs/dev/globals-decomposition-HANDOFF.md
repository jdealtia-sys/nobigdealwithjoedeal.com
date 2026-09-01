# Globals decomposition — session handoff (2026-07-08)

> **STATUS: FULLY EXECUTED (verified against git 2026-07-14).** Everything
> this handoff scoped is merged to main: #899 (2c-4a…e), #901 (2c-4f),
> #902 (2c-4g), #903 (2c-4h Slice H1), #904/#905 (2c-4h Slice H2 parts 1–2,
> incl. the property-intel twin dedup). The "Open PRs" and "Recommended
> next-session order" sections below are historical. What actually remains
> in the registry lane: the shim-blocked residual (zone-draw — blocked on
> the `maps.js:464-468` unguarded shims; `damagNearMe` — dedup vs
> `maps-overlays.js`; the `goTo` router — never converts), then Tranche 3
> (the 2–5-consumer middle band) per the decomposition plan.
>
> **Update 2026-08-31 — the registry lane is CLOSED.** `damagNearMe` was
> deduped and the maps.js shim block guarded on 2026-08-07 (PR #1194); the
> zone-draw residual converted on 2026-08-31 as Tranche 3 slice **T3-0**
> (6 names). Only `goTo` remains, and it never converts. The
> `maps.js:464-468` reference above has pointed at comment text since
> 2026-08-07 — don't chase it. Next work is Tranche 3 slice T3-A per
> [globals-tranche3-plan](globals-tranche3-plan.md).

> Where the "move markup-dispatched globals off `window` into
> `__NBD_CALL_REGISTRY`" effort stands, and exactly what's left. Self-contained
> so a fresh agent can pick up cold. Canonical tracker:
> `dashboard-decomposition-plan.md`; the pattern reference is
> `dashboard-actions-globals-audit.md`.

## The pattern (recap)

Markup dispatches `data-action="call" data-fn="X"` through `dashboard-ui.js`
`_nbdResolveCall`, which checks `window.__NBD_CALL_REGISTRY` **first**, then
`window[X]` gated by `_NBD_CALL_ALLOWLIST` (`dashboard-state.js`). Converting a
name = take it off `window`, register it in `__NBD_CALL_REGISTRY`, drop its
allowlist entry. Mechanism depends on the file:
- **ES module** (e.g. `dashboard-bootstrap.module.js`): names are already
  module-scoped; just change `window.X = …` → a registry entry. No wrap.
- **Classic script, `window.X = function`**: same — no wrap.
- **Classic script, `function X(){}` (auto-global)**: a top-level `function`
  attaches to `window`. Convert via `function X` → `const X = function` (a
  top-level `const` does NOT attach to `window`) **if** it has no forward/hoisted
  caller (TDZ), OR IIFE-wrap the cluster. If another file also assigns
  `window.X` (twin) or a forward-ref shim re-exports it, that line must be
  removed in the same slice → **coordinated, not conservative**.

Every slice must keep the smoke **off-window `T1_NAMES` walk** and the **`data-fn`
wiring audit** green (both in `tests/smoke/dashboard.test.js`). Watch for
`window.X` appearing in a **comment** — the walk scans comments too (bit us at
`dashboard-bootstrap.module.js:3883`).

## Status by file

| File | Owned allowlisted globals | Status |
|---|---|---|
| `dashboard-actions.js` | ~67 | ✅ **DONE** — Tranches 2c-4a…2c-4e (~57 off window across 5 in-file IIFEs). PR **#899** (draft, awaiting review). Residual deferred: zone-draw (blocked on `maps.js:464-468` unguarded shims), `damagNearMe` (dedup vs `maps-overlays.js`), `goTo` router (never converts). **All resolved: `damagNearMe` 2026-08-07, zone-draw + `damageNearMePhotos` 2026-08-31 (Tranche 3 T3-0, 6 names). Only `goTo` remains, permanently.** |
| `dashboard-bootstrap.module.js` | 21 | ✅ **DONE** — Tranche 2c-4f: 15 settings/debug/export handlers → registry (ES module, no wrap). PR **#901** (draft). MUST-STAY: `_saveEstimateDefaultsV2` (self-read), `_loadCompanySettings`/`_loadCompanyProfileSettings` (ui.js cross-file), `loadSampleData` (dashboard-actions.js:913 twin), plus `startNewEstimate`/`openEstimateV2Builder` (not owned there). |
| `dashboard-ui.js` | ~26 | ✅ **DONE** — Tranche 2c-4g (#902) + 2c-4h Slice H1 (#903, the 9 clean-needs-wrap) + Slice H2 (#904/#905, the 10 entangled twins/shims). This is the dispatcher file; `_nbdResolveCall` + delegates live here — never touch them. |
| `maps-routing.js`, `dashboard-ui-prefs-boot.js`, `crm-portal-bridge.js` | 22 / 22 / 12 | ✅ done earlier (Tranches 2c-1/2/3, merged). |

## `dashboard-ui.js` — the 19 remaining (next-session scope)

Proven by a 21-agent audit (2026-07-08). Split into two independent slices:

### Slice H1 — CLEAN_NEEDS_WRAP (9) — one IIFE, no coordination
Each is a bare `function X(){}` auto-global living **only** in `dashboard-ui.js`
with zero cross-file callers. Convert by wrapping the cluster in one in-file IIFE
(or `function`→`const` each, TDZ permitting) + register + drop allowlist entries.

`tlFilterCat` (L1425), `tlToggleCat` (L1421), `shareCalViaSMS` (L809),
`shareCalViaEmail` (L816), `saveCalSettings` (L693), `copyCalLink` (L801),
`filterPhotoLeads` (L879), `handleDocUpload` (L1516), `updateCalEmbed` (L706).

> Note: these are scattered, not contiguous — a single IIFE means relocating
> them together (like the 2c-4a `cda*` relocation), or `function`→`const`
> in place after a per-name TDZ check (safer; mirrors 2c-4g). Prefer the latter.

### Slice H2 — ENTANGLED (10) — coordinated cross-file, do NOT convert alone
Twin-defined or re-exported by forward-ref shims in other files; converting from
`dashboard-ui.js` alone leaves the other `window.X` live → fails the off-window
walk (the `loadSampleData` trap, wider).

- **property-intel.js twins (4):** `confirmPropertyIntelPull` (property-intel.js:554 + dashboard-actions.js:1017 shim), `executePullPropertyIntel` (property-intel.js:583/747 + dashboard-actions.js:1016), `pullIntelForModal` (property-intel.js:498 + dashboard-actions.js:946), `updatePropertyIntelCost` (property-intel.js:524). Body-defined in BOTH files — reconcile ownership first.
- **maps-family forward-ref shims (4):** `spyglassSearch`, `spyglassGoToLocation`, `quickStormCheck`, `fabToggle` — single-defined in dashboard-ui.js but re-window-assigned by `maps.js:459-462` **and** `dashboard-actions.js:903-906` `if(typeof X!=='undefined')window.X=X` shims. Convert only by removing those shim lines in the same slice.
- **dashboard-actions.js shims (2):** `openUploadDoc` (dashboard-actions.js:977), `printDoc` (dashboard-actions.js:981).

### MUST-STAY (from 2c-4g, keep window + allowlist)
`setKanbanDensity` (auto-global backing), `setPhotoMode` (dashboard-widgets.js:1266 + crm.test.js pin), `nbdComfortSet` (dashboard-ui-prefs-boot.js:327-330), `goTo` (router).

## Open PRs at handoff

| PR | What | State |
|---|---|---|
| #899 | dashboard-actions.js — audit + 5 slices | draft, awaiting review. Before merge: re-run the flaky `@stranger` E2E job (or rebase onto latest `main`, which drops the duplicate FAB commit). |
| #901 | dashboard-bootstrap.module.js — 2c-4f | draft, awaiting review. |
| (this) | dashboard-ui.js — 2c-4g + this handoff | draft. |
| #900 | mobile FAB overlap fix | ✅ merged + deployed. |

## Recommended next-session order

1. Review/merge #899, #901, and this PR (globals are behavior-preserving; the
   E2E matrix is the gate — merge on green, not smoke alone).
2. `dashboard-ui.js` Slice **H1** (9 clean-needs-wrap) — self-contained, low risk.
3. `dashboard-ui.js` Slice **H2** (entangled) — only after deciding cross-file
   ownership (property-intel.js, and unwinding the maps.js / dashboard-actions.js
   forward-ref shims). This is real multi-file coordination, not a quick win.
4. Then the tranche's long tail (the 2–5-consumer middle band) per the
   decomposition plan — its own dependency-ordered effort.

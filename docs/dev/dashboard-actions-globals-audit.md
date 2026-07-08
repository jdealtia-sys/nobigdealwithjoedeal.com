# `dashboard-actions.js` globals audit — Tranche 2c-4 execution plan

> Audit pass, 2026-07-07. Written after `dashboard-decomposition-plan.md`
> flagged the `dashboard-actions.js` 87-name cluster as "its own
> multi-session effort" (tranche table row `2c-4+`). This is **PR 1 of that
> effort: analysis only, no code changes** — the same discipline Rock 2 used
> (audit before touching pricing math). Every owned global carries a
> three-way-proof verdict, and the conversion is broken into ordered,
> one-PR-each slices (`2c-4a … 2c-4e`) with a deferred residual. A fresh
> agent can pick up any slice cold.

## TL;DR

- The "87-name cluster" figure **conflates two different things**. Of the
  192 `window.X =` assignments in the file, most are the **forward-reference
  block** (`if (typeof X !== 'undefined') window.X = X`) that *re-surfaces
  other modules'* globals defensively. Those are **not this cluster's job** —
  they belong to their defining modules' tranches.
- `dashboard-actions.js` **truly owns ~67 names** (28 top-level `function`
  decls + ~40 `window.X = function` assignments; `goTo` appears in both as
  the def + a re-wrap).
- Of the owned names, **~46 are CONVERTIBLE** (move into an IIFE + register in
  `__NBD_CALL_REGISTRY`, drop from `_NBD_CALL_ALLOWLIST`) and **14 are
  MUST-STAY** (bare/`window.` cross-file callers, dynamic `window[fn]`
  dispatch, or unguarded `maps.js` re-statement shims that would
  `ReferenceError` at load).
- The file does **not** need extraction. The registry pattern works with
  **multiple in-file IIFEs**, one cohesive cluster per PR — lower risk than a
  single 1,634-line wrap, and it keeps the load-chain position unchanged
  (5th: state→api→widgets→ui→actions→main).

## The three-way proof (protocol used)

A name is safely CONVERTIBLE only if it passes all three (per hard-won lesson
#2 in the decomposition plan):

1. **No external bare/`window.` caller.** No file under `docs/` or `tests/`
   (excluding `dashboard-actions.js` itself) calls it as bare `NAME(` or reads
   `window.NAME` — those refs break the instant it goes module-local. A hit
   inside `data-fn="NAME"` / `data-action` **markup** is fine (it routes
   through the registry-first delegate); a hit as a JS call is a MUST-STAY
   signal.
2. **No self-breaking in-string ref.** No dynamic `'NAME'` lookup inside
   `dashboard-actions.js` that would dangle.
3. **Immune to dynamic dispatch.** Not a member of `_NBD_TOGGLE_FNS` or
   `_NBD_MODAL_CLOSE_FNS` (dispatched as `window[fnName]` at
   `dashboard-ui.js` outside the registry-first path).

Dispatch confirmed at `dashboard-ui.js` `_nbdResolveCall` (~L173-180):
`window.__NBD_CALL_REGISTRY` is checked FIRST, then `window[name]` gated by
`_NBD_CALL_ALLOWLIST`. Registration replaces the allowlist entry as the
security opt-in.

## Owned-name categorization

### MUST-STAY (14) — do not convert in 2c-4

| name | blocker (file:line) | kind |
|---|---|---|
| `goTo` | ~27 dashboard `.js` files call it (billing-gate, whats-new, ai.js, maps-routing, command-palette, decision-engine, storm-center…); re-wrapped on `window` at `dashboard-actions.js:1145` AND `ai.js:374` | main view router — **never convert** |
| `_mJdSwitchTab` | `dashboard-widgets.js:1176` bare `_mJdSwitchTab('activity')` | cross-file call |
| `openLeadDetail` | `crm-pipeline.js:1267` bare `openLeadDetail(id)` | cross-file call |
| `viewProspectOnMap` | `dashboard-widgets.js:1248` `window.viewProspectOnMap(lead.id)` | cross-file call |
| `_stashLeadForCustomerPage` | 7 callers: `activity-feed.js:449`, `almost-there-widget.js:312`, `global-search.js:576`, `hot-leads-widget.js:312`, `dashboard-bootstrap.module.js:1673`, `smart-followup-briefing.js:205`, `stale-shares-widget.js:271` | cross-file call |
| `closeMobileInspection` | `_NBD_MODAL_CLOSE_FNS` (`dashboard-state.js:116` key `mobileInspection`) → `window[fnName]` at `dashboard-ui.js:624` | dynamic dispatch |
| `closeMobileCreatePopover` | `_NBD_MODAL_CLOSE_FNS` (`dashboard-state.js:117` key `mobileCreatePopover`) | dynamic dispatch |
| `selectZoneColor` | `dashboard-ui.js:357` bare call (dedicated `zoneColor` action path) + `maps.js:468` unguarded `window.selectZoneColor = selectZoneColor` | bare call + shim |
| `startZoneDraw` | `maps.js:464` **unguarded** `window.startZoneDraw = startZoneDraw` | shim (ReferenceError at maps load) |
| `cancelZoneDraw` | `maps.js:465` unguarded | shim |
| `saveZone` | `maps.js:466` unguarded | shim |
| `deleteZone` | `dashboard-widgets.js:847` bare `deleteZone(Number(...))` + `maps.js:467` unguarded | bare call + shim |
| `dsRemoveFloor` | `dashboard-ui.js:2208` bare `dsRemoveFloor(i)` | cross-file call |
| `damagNearMe` | competing defs: `dashboard-actions.js:776/900` wrappers + `maps.js:476` unguarded + **independent `function damagNearMe()` in `maps-overlays.js:460`** — current winner is load-order-dependent | duplicate defs; reconcile first |

**The zone-draw shims are the key finding.** `maps.js:464-468` re-states the
zone globals with **unguarded** RHS (bare `startZoneDraw`, not
`typeof`-guarded). If those names go module-local, `maps.js` throws
`ReferenceError` at load and takes the whole map surface down. This is the
exact "shim" shape that pinned `goToMyLocation` (2c-2) and `clearBulkSelection`
(2c-3) on `window`. Zone-draw is deferred until the `maps.js` shim block is
unwound (see Residual).

### CONVERTIBLE (owned, allowlisted/markup-wired)

Grouped by cohesive cluster (= the slice boundaries below). All passed the
three-way proof: no external JS caller, not in a dynamic-dispatch set, markup
routes through the registry-first delegate.

**Card-detail wrappers + chip pickers + photo picker (18):**
`cdaConfirmPromote`, `cdaEditLead`, `cdaEnrich`, `cdaInspection`,
`cdaInspectionDeep`, `cdaInvoice`, `cdaMjdAct`, `cdaOpenMobileInspection`,
`cdaOpenTaskModal`, `cdaOpenVoicemail`, `cdaPhotos`, `cdaReport`,
`cdaRevokePortalLink`, `cdaSharePortalLink`, `cdaVoiceMemo`, `cdPickStage`,
`cdPickType`, `_mCreatePhotoPicked`.

**Mobile create/job-detail handlers (8):**
`_mCreate`, `_mJdAct`, `_mJdShare`, `openMobileInspection`,
`openMobileCreatePopover`, `toggleMobileCreatePopover`, `mCreateFabRoute`,
`mQuickAddRoute`.

**Compound-rewrite one-offs + report/photo/settings openers (18):**
`clearAccentTheme`, `closeInspectionBuilder`, `enrichReportData`,
`goToD2DFromMaps`, `gstaticTest`, `hardResetTest`, `hideFollowUpAlerts`,
`modeLineDraw`, `openCalBookingUrl`, `openD2DOrGo`, `openDailyProgramFromMore`,
`openDecisionPicker`, `openInspectionBuilderCurrentLead`,
`openPhotoEngineCurrentLead`, `openPhotoEngineOrClickProxy`,
`openReportGenerator`, `openSettingsTab`, `restartOnboardingTour`.

**Customer-page handoff (4):**
`openPhotosForLead`, `openDocsForLead`, `openFullCustomerDetails`,
`editCardDetails`.

**Daily-program config (3 allowlisted + 3 internal helpers):**
`dsAddFloor`, `dsSaveConfig`, `dsResetDefaults` (allowlisted); `dsGetConfig`,
`dsLoadConfig`, `dsDefaultFloors` (internal helpers, not allowlisted — no
external ref, safe to move with the cluster).

**Borderline (1):** `damageNearMePhotos` — its only external ref
(`maps.js:457`) is `typeof`-**guarded**, so it will NOT `ReferenceError` when
module-local (the guard just evaluates false). Convertible **iff** the stale
`maps.js:456-457` shim (whose comment wrongly says "defined in dashboard.html")
is deleted in the same PR; otherwise leave it and treat as MUST-STAY.

### Forwarded, NOT owned — out of scope for 2c-4

The typeof-guard block (`dashboard-actions.js` ~L789-956) re-exports names that
**other modules define** — e.g. `handleCardClick` ("Exposed by crm.js"),
`searchMap`, `selectPin`, `deletePin`, `clearAllPins`, `spyglassSearch`,
`toggleOverlay`, `makeLeadFromSearch`, `fetchPropertyIntel`, `pullIntelForModal`.
These are defensive surfacing, not this file's globals. They convert with
**their** module's tranche, not here. When `dashboard-actions.js` is fully
wrapped, this block still works (typeof checks global scope) but should be
audited for dead entries at that point.

## Cross-cluster call dependencies (ordering constraints)

Some CONVERTIBLE names call other CONVERTIBLE names in a *different* slice.
Once both are module-local in *separate* IIFEs, a bare cross-IIFE call breaks.
Reconcile by routing the call through `window.NAME?.()` (the callee stays on
`window` until its own slice) or by keeping caller+callee in the same slice:

- `cdaMjdAct` → `_mJdAct` (2c-4a caller, 2c-4b callee)
- `cdaOpenMobileInspection` → `openMobileInspection` (2c-4a → 2c-4b)
- `mCreateFabRoute` → `openMobileCreatePopover` / `toggleMobileCreatePopover` (within 2c-4b — safe if co-slotted)

**Rule for every slice:** any call from inside the new IIFE to a name defined
*outside* it must resolve via `window.` (or the registry), never as a bare
lexical global — because the callee may itself be IIFE-local now or later.

## File-wrap constraints (hard-won lessons applied)

1. **`let` at brace-depth 0.** Lesson #1: mis-anchored `let`s inside nested
   IIFEs caused strict-mode `ReferenceError`s that killed boot and were caught
   **only by the E2E shards, no static check**. The file's top-level
   `let _NBD_DA_DELEGATE` (~L44) and `const _origGoTo` (~L1144) are internal —
   keep them where the code that reads them can see them. Prefer **one IIFE
   per cluster** over nesting.
2. **Classic-script auto-globaling stops inside an IIFE.** Top-level
   `function goTo(){}` currently auto-creates `window.goTo`. Any name moved
   into an IIFE loses that — MUST-STAY names pulled into a wrapped cluster need
   an explicit `window.NAME = NAME` re-export from inside the IIFE (the
   `goToMyLocation` precedent in 2c-2).
3. **Smoke guardrail is two-sided.** `tests/smoke/dashboard.test.js:1354`
   asserts 34 names exist as `window.NAME = function` (blocks conversion of
   those). On conversion each name **moves** from that list to (a) the
   "Globals Tranches 0+1: converted names stay off window" section (~L2560) and
   (b) the "Globals Tranche 2c: `__NBD_CALL_REGISTRY`" registration assertion
   (~L2752). The wiring-audit invariant ("every `data-fn` allowlisted OR
   registered") is what catches a half-done conversion.

## Execution plan — one PR per slice

| Slice | Cluster | Names | Risk | Notes |
|---|---|---|---|---|
| **2c-4a** ✅ | Card-detail (`cda*`) + chip pickers + `_mCreatePhotoPicked` | 18 | LOW | **SHIPPED 2026-07-07 (full E2E matrix green).** Consolidated the scattered defs into one IIFE; registered 18; routed `cdaMjdAct`→`window._mJdAct`, `cdaOpenMobileInspection`→`window.openMobileInspection`; migrated 14 guardrail entries. |
| **2c-4b** ✅ | Mobile create/job-detail | 3 reg + 7 window + 1 private | MED | **SHIPPED 2026-07-07.** Wrapped the contiguous L1030-1260 block in one IIFE. Registered `_mJdSwitchTab`/`_mJdShare`/`_mCreate`; kept 7 window re-exports (`_mJdSwitchTab`, `_mJdAct`, `openMobileInspection`, `closeMobileInspection`, `closeMobileCreatePopover`, `toggleMobileCreatePopover`, `openLeadDetail`) each pinned to its consumer; `openMobileCreatePopover` is private. `mCreateFabRoute`/`mQuickAddRoute`/`viewProspectOnMap` are outside the block → deferred to a micro-slice. **Landmine fixed:** two registry blocks now exist, so the smoke `daRegBlock` extraction was switched to `matchAll` (first-match would have silently broken 2c-4a's asserts). |
| **2c-4c** ✅ | One-off compound rewrites + openers (+ the `mCreateFabRoute`/`mQuickAddRoute` mobile-route tail) | 20 | LOW | **SHIPPED 2026-07-07.** All 20 REGISTER_ONLY — one IIFE over the contiguous L48-195 run, registered, de-allowlisted, none window-re-exported. Absorbed the two 2c-4b tail names. `hardResetTest`/`gstaticTest` dispatch from generated banner markup (invisible to the wiring audit) → their registry assertions are the only guard. |
| **2c-4d** ✅ | Daily-program config (`ds*`) | 7 | LOW | **SHIPPED 2026-07-07.** Wrapped the cluster + its two callers (goTo hook + DOMContentLoaded). `dsAddFloor`/`dsSaveConfig`/`dsResetDefaults` registered; 3 helpers private; `dsRemoveFloor` window-re-export relocated inside the IIFE (dashboard-ui.js:2208 bare call). Deleted the load-time typeof-guarded re-export block (would read undefined post-wrap). |
| **2c-4e** ✅ | Customer-page handoff | 5 | LOW | **SHIPPED 2026-07-07.** `openPhotosForLead`/`openDocsForLead`/`openFullCustomerDetails`/`editCardDetails` registered + off window; `_stashLeadForCustomerPage` MUST-STAY (7 widget callers) keeps its export inside the wrap. |
| **Residual / Tranche 3** | shim-blocked clusters | — | — | `goTo` (router — never convert). Zone-draw (`startZoneDraw`/`cancelZoneDraw`/`saveZone`/`deleteZone`/`selectZoneColor`) — blocked on unwinding `maps.js:464-468` unguarded shims. `damagNearMe` — blocked on de-duping vs `maps-overlays.js:460`. `damageNearMePhotos` — convert only alongside deleting the stale `maps.js:456-457` shim. |

### Per-slice mechanical checklist

For each slice PR:

1. Wrap the cluster's functions in a single IIFE (or extend the file's
   existing bottom `__NBD_CALL_REGISTRY` block). Convert `window.X = function`
   → module-local `function X`.
2. `Object.assign(window.__NBD_CALL_REGISTRY, { … })` for every convertible
   name in the slice.
3. Delete those names from `_NBD_CALL_ALLOWLIST` in `dashboard-state.js` (leave
   a dated comment, matching the 2c-2/2c-3 style).
4. Re-export any MUST-STAY name pulled into the IIFE: `window.NAME = NAME`.
5. Route every cross-IIFE call through `window.NAME?.()`.
6. Migrate smoke guardrail entries: remove from the `:1354` on-window
   spot-check; add to the off-window (~L2560) + registry-registration (~L2752)
   assertions.
7. Verify: full non-emulator battery (`cd tests && npm test`) green, **and**
   the authed E2E emulator matrix green (the `@stranger` + advisory shards) —
   the boot-break class from lesson #1 is invisible to static checks. Manually
   exercise the converted buttons on a phone viewport before merge.

## Verification baseline (this audit)

Docs-only PR — no runtime surface touched. `node tests/smoke.test.js`:
**2205 passed, 4 failed**, where all 4 failures are the environmental
`functions/node_modules` gap (`Cannot find module 'firebase-functions/v2/https'`
from `photo-vision.js` / `receipt-vision.js`), unrelated to this change. The
globals-tranche assertions are among the 2205 passing.

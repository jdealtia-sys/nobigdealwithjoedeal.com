# Kanban Rebuild + Customers-on-the-Map — Status & Next Steps

> Planning brief, 2026-07-08. Self-contained: a fresh agent can pick this up
> cold. Companion to `BIG_ROCKS.md` / `NEXT_SESSION.md`. Covers two linked
> tracks — the freeform-pipeline kanban rebuild (Phases 0–3 shipped) and the
> new Customers map layer that rides on it.

---

## Track A — Freeform-pipeline kanban rebuild

### What shipped (Phases 0–3, PRs #917–#920)

| Phase | What landed | Key files |
|---|---|---|
| **0 — Semantic-role foundation** | Every stage carries a `role` (`new`/`active`/`job`/`won`/`lost`). KPIs, revenue, referrals, portal, and server classify a lead by ROLE, not by a hardcoded stage-key list — so a tenant-invented stage counts correctly once it declares a role. | `docs/pro/js/crm-stages.js` (`ROLE`, `stageRole`, `isWonStage`) |
| **1 — Config resolver** | `resolvePipelineConfig(raw)` merges a per-tenant config (`companyProfile.pipelines`) over the built-in defaults → `{ stageMeta, views, roleOf }`. Fail-safe: any malformed piece is ignored, defaults kept; custom stages MUST declare a valid role. | `crm-stages.js:778`, `dashboard-bootstrap.module.js` `applyPipelineConfig()` |
| **2 — Builder UI** | Settings → Pipelines. Owner/admin reorders, renames, recolors, re-roles, adds custom stages, removes-from-view. Writes config + live-applies. Strict-CSP-safe (delegated `data-pb-action`). | `docs/pro/js/pipeline-builder.js` |
| **3 — Server + portal** | `functions/stage-roles.js` mirrors roles server-side. A lead's **persisted `stageRole`** wins (stamped on every `moveCard`); the key map is the legacy fallback. | `functions/stage-roles.js`, `functions/portal.js`, `functions/referral-rewards.js` |

### Phase 4+ — remaining freeform-pipeline work (NOT yet done)

1. ~~**Drag-to-reorder in the builder.**~~ ✅ **DONE (2026-07-08).**
   `pipeline-builder.js` now renders a draggable grip (⠿) per stage row and
   reorders via HTML5 drag-and-drop (delegated dragstart/dragover/drop on the
   root — CSP-safe, no inline handlers), constrained to a single pipeline, with
   a before/after drop indicator. The ▲/▼ buttons stay as a touch / a11y
   fallback. Smoke-covered in `tests/smoke/crm.test.js`.
2. ~~**`stageRole` migration/backfill for existing leads.**~~ ✅ **DONE
   (2026-07-08).** `scripts/backfill-lead-stageRole.js` — dry-run-by-default
   (`--apply --yes` to write), idempotent (only fills a MISSING/invalid role;
   a persisted role is authoritative and never overwritten). Resolves each
   lead's role from the tenant's own `companyProfile.pipelines.stages[key].role`
   when the stage is custom/overridden, else the shared key map
   (`functions/stage-roles.roleFromKey`) — the exact runtime precedence, so no
   drift. Smoke-covered in `tests/smoke/crm.test.js`. Run it after Phase 3 is
   live on prod (`node scripts/backfill-lead-stageRole.js` to preview).
3. ~~**Per-view stage visibility / `hidden` flag.**~~ ✅ **DONE (2026-07-08).**
   The builder now has a per-stage hide/show eye toggle (👁/🙈) that writes the
   `hidden` flag; `buildKanbanColumns` drops hidden stages from the board while
   they stay in config + dropdowns.
4. ~~**Board reads the resolved config…**~~ ✅ **DONE (2026-07-08) — and this
   was a real bug, not just a verify.** `buildKanbanColumns` read the
   *module-local* `KANBAN_VIEWS` / `STAGE_META` consts, so a tenant's custom
   views, renamed / custom / reordered / hidden stages were written by the
   Phase-2 builder but NEVER rendered on the board. Fixed: it now reads the
   `window.*` overrides (falling back to the consts pre-config), and
   `applyPipelineConfig` rebuilds the columns so edits show live. Verified with
   `resolvePipelineConfig` (custom view + custom stage + hidden → correct
   columns). This makes the whole Phase-0→2 builder actually take effect.
5. **Tests:** extend `tests/crm-stages-roles.test.js` / `tests/stage-roles.test.js`
   to cover a custom-stage round-trip (config → resolve → persist role → server
   classify).

---

## Track B — Customers on the map (shipped this branch)

**Goal (Jo, 2026-07-08):** "make all our customers show up on the map with
leads." Before this, a customer appeared on the map only if someone dropped a
D2D pin for them or they were a geocodeable active *job* — most of the book was
invisible.

### What shipped

- **New `docs/pro/js/maps-customers.js`** — a dedicated **Customers** map layer
  built from `window._leads` (already company-scoped, so the whole team's book
  shows), colour-coded by the Phase-0 **semantic role** via `window.STAGE_META`
  / `window.stageRole` — so it reads like the kanban AND honours custom stages.
  Loaded in the locked order `core → overlays → customers → routing → maps`.
- **Rolling geocode-backfill.** New leads already persist `lat`/`lng` at save
  (`_saveLead`). Leads that predate that — or whose address changed — are lazily
  geocoded on layer open (fair-use capped at 12/build, 1.1s spacing, matching
  the Jobs overlay) and the result is **persisted** via the new
  `window._saveLeadCoords(id, lat, lng)`, so each address geocodes once.
- **Geocode-on-edit.** `_saveLead`'s edit branch now re-geocodes when the
  address changes (or coords are missing), keeping the layer + Jobs overlay
  accurate. Best-effort; a miss keeps prior coords and never blocks the save.
- **Fixed stale customer-pin colour.** `addPinMarker` coloured `type:'customer'`
  pins from the dead static `STAGE_COLORS` map (legacy display names only) —
  now resolves via `window.STAGE_META` → `window.stageRole`, with the static
  map as last-resort fallback.
- **UI:** a "All Customers" overlay-row toggle + a `fab-customers` map FAB, wired
  through the existing generic `mapOverlay` / `fabToggle` / `toggleOverlay` path.
- **Tests:** `tests/smoke/maps.test.js` — new "Customers map layer" sections
  (layer source, colour resolution, capped+persisted backfill, toggle wiring,
  dashboard.html wiring). `maps-customers.js` added to `MAPS_SPLIT` + the
  syntax-check list; `mapOverlay` count assertion bumped 5→6.

### Deferred follow-ups (own PRs)

1. ~~**Pin scoping → `companyId`.**~~ ✅ **DONE (2026-07-08).** `_savePin` now
   stamps `companyId` (claim, or uid for solo — same convention as leads/
   reports), `loadPins` uses the same team dual-scope as `loadLeads`
   (company_admin/manager/viewer fetch the tenant's pins + their own; sales_rep/
   solo stay own-only), and the `/pins` rule mirrors `/reports`: same-company
   read via `sameCompanyAsResource()`, owner/same-company-admin write, companyId
   pinned on create. Rules-test coverage added in `firestore-rules.test.js`
   (team read, cross-tenant deny, legacy owner-only, create-tenant-pin,
   update/delete boundary). **Remaining sub-item:** a one-off
   `scripts/backfill-pins-companyId.js` for pins created before this — until
   backfilled, a teammate's LEGACY pins (no companyId) stay owner-only, so the
   manager's shared map fills in only as new pins are dropped. Cheap to add
   (same shape as `backfill-lead-stageRole.js`).
2. **Batch coord backfill script.** The in-layer backfill is capped per open;
   for a large existing book a `scripts/backfill-lead-coords.js` (admin SDK,
   dry-run-by-default) would fill everything in one pass. Nice-to-have — the
   rolling backfill converges on its own as reps open the layer.
3. ~~**Role legend + filter on the map.**~~ ✅ **DONE + expanded (2026-07-08).**
   Grew into a full control panel (see "Map control panel" below).
4. ~~**Cluster the Customers layer.**~~ ✅ **DONE (2026-07-08)** —
   `L.markerClusterGroup` with a `layerGroup` fallback.

### Map control panel (2026-07-08 deep-dive)

Both layers are now operational surfaces (two-layer design — leads vs pins):

- **Customers layer (`maps-customers.js`)** — a floating control panel:
  - **Color by** Stage/Role · Damage Type · Deal Value (data-driven
    `_CUST_DIMENSIONS`; stage → `window.stageRole` so custom stages are safe,
    damage → normalised peril buckets, value → deal-size tiers).
  - **Cross-dimension filters** — legend chips filter the active dimension; a
    "＋ Filters" section exposes the others. Filters compose with **AND**
    (`_custPasses`), e.g. color by Stage while showing only Hail + $25k+.
  - **Zoom-gated $ labels** — past z≥16 a dot blooms into a `💰 $value` pill
    (rebuilt on `zoomend`); clean dots + clustering when zoomed out.
- **D2D pins layer (`maps-overlays.js`)** — a disposition legend/filter panel
  (bottom-right): per-disposition show/hide over `PIN_LABELS`, hiding markers
  via the cluster group; status-less (customer/legacy) pins always pass. Wired
  into the pins overlay toggle + initial load.

**Shipped since (2026-07-08, deep-dive round 2):**
- **Value-range slider**, **team-shared saved views** (companyProfile.mapViews,
  owner/admin-managed), **Rep / Owner** color-by dimension, a **field-ready
  route** (GPS start + Google Maps turn-by-turn hand-off), and **territory
  zones shaded by rep** (assign a rep when drawing a zone → the polygon takes
  their palette colour + label; reuses `window.nbdRepList`).
- Backfills: `backfill-lead-stageRole.js`, `backfill-pins-companyId.js`.

**Shipped since (deep-dive round 3):**
- **Zone insights** — clicking a territory shows the leads inside it
  (point-in-polygon): count, pipeline $, won/active/job/new/lost breakdown, top
  damage type (recomputed each open).
- **Value-weighted heatmap** — the heat layer weights each point by the linked
  lead's deal-$ tier (money) or the knock disposition (intent), not a flat 0.5.
- **Pins toggle bug fixed** — `showAllPins`/`hideAllPins` now add/remove the
  `pinClusterGroup` as a whole (they operated per-marker on `mainMap`, so with
  clustering the "Pins" toggle was a silent no-op).
- **Mobile** — the floating map panels (customers control panel + pins
  disposition) constrain to ≈46vw / 46vh on ≤640px viewports.

**Adversarial audit (2026-07-08) — 6 confirmed bugs found + fixed.** A
multi-agent review of the whole branch diff (correctness / integration /
security / data dimensions, each finding double-verified by independent
skeptics) surfaced and we fixed:
1. **HIGH / security** — `/pins` + `/zones` UPDATE rules didn't freeze
   `companyId`, so an owner could `updateDoc` their doc's companyId to a victim
   tenant and inject a spoofed pin/zone into that team's shared map. Added
   `didNotChange(['userId','companyId'])` to both update rules (mirrors
   `/leads`) + rules tests.
2. **MED** — the "Open in Google Maps" hand-off silently dropped a stop when a
   route had 25 (Google holds origin + 23 waypoints + 1 dest = 24 stops); route
   cap lowered to 24 so map pins == URL stops.
3. **MED** — zone color reverted to blue on reload (picker emitted `var(--x)`;
   `safeColor` only accepts hex) → swatches + default now emit hex.
4. **MED** — `deleteZone` removed a zone from the UI even when the Firestore
   delete was denied (team reader deleting a teammate's zone), silently
   reappearing on reload → now awaits `_deleteZone` (returns bool) and only
   removes locally on success.
5. **LOW** — value-range MAX slider dragged to $0 snapped to "no cap"
   (`parseInt||CAP` falsy-zero) → NaN-guard.
6. **LOW** — the "＋ Filters" toggle re-rendered the legend with stale counts
   (closed-over first-render `counts`) → uses the fresh `_custLastCounts`.

**Adversarial audit — round 2 (2026-07-09) — 8 more bugs found + fixed.** A
second multi-agent pass (verify the round-1 fixes are regression-free — they
were, 0 findings — + sweep perf/UX, the backfill scripts, and the kanban path,
plus a completeness critic) found + fixed:
1. **"Reset to defaults" didn't reset** the board/builder until a page reload —
   the empty-config write is deep-merged in memory (overrides preserved) and
   `applyPipelineConfig` early-returned instead of restoring defaults. Now it
   resolves-with-null (restores defaults) on an empty config, and the reset
   branch force-clears the in-memory config + re-applies.
2. **`buildCustomersLayer` had no re-entrancy guard** — a filter/color/zoom fired
   mid-geocode-backfill duplicated pins. Added a build-token that aborts a
   superseded build after its await.
3. **Repeated ~13s geocode batches** on every filter/color/zoom re-render →
   gated the backfill behind `doGeocode` (show/refresh only).
4. **Pins backfill** could assign a leadless pin to the wrong tenant for a
   multi-company user → now skips ambiguous users (logs them).
5. **Hiding every stage** in a view blanked the board (leads vanish) → never-blank
   fallback in `buildKanbanColumns`.
6. **Zone rep label persisted as the viewer-relative "Me"** into the shared doc →
   store a real name + resolve the label per-viewer at render.
7. **stageRole backfill** missed tenant overrides for legacy alias stages →
   checks `cfg.stages[normKey(stage)]` too.
8. **`_saveLeadCoords` bumped `updatedAt`** on teammate leads during the passive
   map backfill → writes only lat/lng now.

**Follow-ups worth noting:**
- ~~**Territory zones are session-only.**~~ ✅ **DONE (2026-07-08).** Zones now
  persist to a Firestore `/zones` collection (team-shared, same rule shape as
  `/pins`): `loadZones`/`_saveZone`/`_deleteZone` in dashboard-bootstrap
  (companyId dual-scope + stamping), `renderSavedZones()` draws them on map init
  and after load, and the rep assignment (colour + label) round-trips. Points
  serialize to plain `{lat,lng}`. Registered in `FLAT_USER_COLLECTIONS`
  (erase/export) and rules-tested. Territories now survive reload + sync across
  the team.

### Files touched (both tracks)

- `docs/pro/js/maps-customers.js` (new — Customers layer + control panel)
- `docs/pro/js/maps-core.js` (`overlayState.customers`, `toggleOverlay` branches, pins-panel hooks)
- `docs/pro/js/maps-overlays.js` (`addPinMarker` role-colour fix + disposition filter panel)
- `docs/pro/js/dashboard-bootstrap.module.js` (`_saveLeadCoords`, geocode-on-edit, `refreshCustomersLayer` hook, pins `companyId` scoping)
- `docs/pro/js/pipeline-builder.js` (drag-to-reorder)
- `firestore.rules` (`/pins` team-shared rule)
- `scripts/backfill-lead-stageRole.js` (new)
- `docs/pro/dashboard.html` (overlay row + FAB + script tags + cache bumps)
- `tests/smoke/_shared.js`, `tests/smoke/dashboard.test.js`, `tests/smoke/crm.test.js`, `tests/smoke/maps.test.js`, `tests/firestore-rules.test.js`

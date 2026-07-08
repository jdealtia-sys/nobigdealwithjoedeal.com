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

1. **Drag-to-reorder in the builder.** Today reordering is ▲/▼ buttons
   (`pipeline-builder.js`). Native drag-and-drop of stage rows would match the
   kanban's own DnD and is the top UX gap Jo will notice.
2. **`stageRole` migration/backfill for existing leads.** Phase 3's design says
   the *persisted* `stageRole` wins, but leads created before Phase 0 have none —
   they fall back to the key map, which BREAKS for a tenant's custom stages
   (the server can't classify `custom_walkthru`). Add a one-off backfill
   (`scripts/backfill-lead-stageRole.js`, dry-run-by-default like
   `backfill-leads-phoneDigits.js`) that stamps `stageRole` from the resolved
   config per tenant. **This is the highest-correctness item.**
3. **Per-view stage visibility / `hidden` flag.** `resolvePipelineConfig`
   already honours `existing.hidden = true` but the builder has no toggle for it.
4. **Board reads the resolved config, not just `applyPipelineConfig` on boot.**
   Verify the kanban view switcher + column builder pick up custom views end to
   end (the resolver returns `views`, but confirm `buildKanbanColumns` renders a
   tenant's custom view key).
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

1. **Pin scoping → `companyId`.** `loadPins` queries `where('userId','==',uid)`
   (`dashboard-bootstrap.module.js:3060`) and the `/pins` Firestore rule is
   owner-only. So D2D pins are NOT team-shared, unlike leads. The Customers
   layer sidesteps this (it reads company-scoped `_leads`), but the door-knock
   `_pins` + heat layer still show only the current user's. Migrating pins to
   `companyId` touches `firestore.rules`, `loadPins`, `_savePin`, and the
   cross-tenant rules tests — a self-contained PR.
2. **Batch coord backfill script.** The in-layer backfill is capped per open;
   for a large existing book a `scripts/backfill-lead-coords.js` (admin SDK,
   dry-run-by-default) would fill everything in one pass. Nice-to-have — the
   rolling backfill converges on its own as reps open the layer.
3. **Role legend + filter on the map.** A small legend (new/active/job/won/lost
   swatches) and per-role show/hide would make a big book readable. Optional.
4. **Cluster the Customers layer** at low zoom (it uses a plain `layerGroup`;
   the D2D pins already cluster via `pinClusterGroup`). Consider if books grow
   past a few hundred mapped leads.

### Files touched (Track B)

- `docs/pro/js/maps-customers.js` (new)
- `docs/pro/js/maps-core.js` (`overlayState.customers`, `toggleOverlay` branch)
- `docs/pro/js/maps-overlays.js` (`addPinMarker` role-colour fix)
- `docs/pro/js/dashboard-bootstrap.module.js` (`_saveLeadCoords`, geocode-on-edit, `refreshCustomersLayer` hook)
- `docs/pro/dashboard.html` (overlay row + FAB + script tag + cache bumps)
- `tests/smoke/_shared.js`, `tests/smoke/dashboard.test.js`, `tests/smoke/maps.test.js`

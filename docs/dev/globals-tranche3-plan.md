# Globals Tranche 3 — dependency-ordered plan (2026-08-31)

> **STATUS: PLAN — no code changes yet.** This is the "dependency-ordered
> plan of its own" that [dashboard-decomposition-plan.md](dashboard-decomposition-plan.md)'s
> Tranche 3+ row and [globals-decomposition-HANDOFF.md](globals-decomposition-HANDOFF.md)
> both defer to. Canonical tracker stays `dashboard-decomposition-plan.md`;
> the conversion mechanics recap (registry pattern, auto-global → `const`,
> twin coordination, TDZ trap) lives in the HANDOFF and is not repeated here.
>
> Census reproducible with `node scripts/globals-xref.js docs/pro out.json`
> (committed alongside this doc). Numbers below are from the 2026-08-31 run.

## Update 2026-08-31 (execution session) — T3-0 SHIPPED; its stated blockers were already gone

**T3-0 is done.** See
[SESSION-2026-08-31-t3-0-zone-draw-unwind](../../documentation/projects/SESSION-2026-08-31-t3-0-zone-draw-unwind.md).
Two corrections a later session should not have to re-derive:

1. **T3-0's blockers had been resolved 24 days before this plan was
   written.** The slice below describes "the `maps.js:464-468` unguarded
   window shims" and a "`damagNearMe` 4-way dedup" as open work. Both closed
   on **2026-08-07** (commit `caab17ec`, PR #1194 — recorded in
   [SYSTEM-STABILITY-PERF-2026-08-07](../../documentation/audit/SYSTEM-STABILITY-PERF-2026-08-07.md)):
   the maps.js re-export block became `typeof`-guarded AND try/catch-fenced,
   and `damagNearMe` was deduped to one implementation in `maps-overlays.js`
   with registry registration and smoke pins. This plan inherited the
   July wording verbatim from `dashboard-actions-globals-audit.md` and
   `globals-decomposition-HANDOFF.md` without re-checking it.
2. **`maps.js:464-468` has pointed at comment text, not code, since
   2026-08-07.** The line reference is repeated in four docs. Chasing it is a
   dead end — the block it names now begins at `maps.js:475`.

So T3-0's real content was never the blockers; it was **the conversion the
blockers had deferred**: the zone-draw cluster (`selectZoneColor`,
`startZoneDraw`, `cancelZoneDraw`, `saveZone`, `deleteZone`) plus the
"borderline" `damageNearMePhotos` — 6 names, now IIFE-scoped in
`dashboard-actions.js` and dispatched through `__NBD_CALL_REGISTRY`.
`renderSavedZones` stays on `window` deliberately (real cross-file API:
`maps-core.js` + `dashboard-bootstrap.module.js` both call it).

**Census re-run confirms the table below**, with one correction: the
`withHtmlHits` figure is **231**, not 233. Bands (454 / 176 / 131 / 66), the
827 total and the single bracket-dispatch name all reproduce exactly.

**The lesson worth carrying:** the "~515 → 131" correction that prompted this
plan was a *count* being stale. This one was a *status* being stale, which is
worse — it makes finished work look blocked and buys a session's worth of
re-verification. Both came from copying a prior doc's framing forward instead
of re-measuring. Re-run the census AND re-read the cited lines before
starting any slice below.

## Fresh census — the middle band shrank

The 2026-07-05 inventory estimated **~515 globals** in the 2–5-consumer
middle band. After Tranches 0–2c-4h shipped, the real 2026-08-31 numbers:

| Band (external consumer FILES) | Names | Note |
|---|---|---|
| 0 (self-contained) | **454** | 277 of them mechanically safe (single assigner, no HTML hit, no bracket dispatch) |
| 1 | **176** | clusters into a handful of file→file edges |
| 2–5 (Tranche 3 proper) | **131** | was "~515" — the estimate conflated rows with names |
| 6+ (the spine) | **66** | mostly keep-as-API — see below |
| **Total assigned `window.*`** | **827** | across `docs/pro/**/*.js` |

233 of the 827 have word-boundary hits in `docs/pro/**/*.html` (conservative
match — includes false positives like `open` and `collection`); only 1 name
uses literal `window['name']` bracket dispatch.

## Static-analysis blind spots (why every slice still needs the three-way proof)

- `window[fnName]` **variable** dispatch is invisible to the census —
  `waitForMapFn` polling and `_NBD_TOGGLE_FNS`/`_NBD_MODAL_CLOSE_FNS`
  resolution bit Tranche 2c-2 exactly this way (`goToMyLocation` failed late).
- Inline handler strings **generated at runtime** (`ontouchstart="window._ncm…"`)
  count as consumers only if the generating string literal greps; template
  concatenation can hide them.
- The smoke `T1_NAMES` off-window walk **scans comments** — a stale
  `window.X` in a comment fails the walk (bit us at
  `dashboard-bootstrap.module.js:3883`).

Per-name proof before converting, unchanged from Tranche 2: (1) file-grep JS,
(2) grep HTML + generated-markup string literals, (3) registry/allowlist +
`window[…]` dispatch-path check.

## Keep-as-API — the spine is mostly DONE or NEVER, not TODO

Do **not** burn sessions converting these 6+-consumer names:

- **Firebase compat re-exports** from the two bootstrap modules (`db`, `doc`,
  `collection`, `auth`, `query`, `where`, `orderBy`, `getDoc`, `getDocs`,
  `updateDoc`, `addDoc`, `serverTimestamp`, `runTransaction`, `_db`, `_auth`,
  `_storage`): one deliberate compat surface, ~30–60 consumers each.
  Converting means touching every CRM file for zero behavior gain. KEEP;
  revisit only if the bootstrap ever goes fully ESM.
- **Shared state spine**: `_leads` (81 consumers), `_user` (67),
  `_userClaims` (37), `_estimates` (33), `_customerId`, `_currentLead`,
  `_brand`. These are the "Why this is HARD" globals from the Rock 4 brief;
  they need a state-store migration (NBDStore exists — `state-store.js`),
  which is its own rock-sized effort, not a tranche slice.
- **Router + UX primitives**: `goTo` (never converts — per the HANDOFF),
  `showToast` (68 consumers, already a stable API).
- **Already-namespaced house singletons** — these ARE the target convention:
  `LeadSnooze`, `ScriptLoader`, `nbdModal`, `PortalLinkHelpers`, `D2D`,
  `nbdEsc`, `nbdConfirm`, `callClaude`, `NBDStore`. Done-equivalent.
- **`standalone-compat.js` shims** (`open`, `confirm`, `nbdConfirm` twin):
  deliberate built-in wrappers. KEEP.

After subtracting keep-as-API, the genuine 6+ TODO residue is near zero —
the spine is a state-store question, not a globals-hygiene question.

## Ordered slices

**T3-0 — the shim-blocked residual (precondition, 1 short session).**
✅ **SHIPPED 2026-08-31** — see the update section at the top of this doc.
6 names off window (zone-draw cluster + `damageNearMePhotos`), 2 cross-file
bare calls rewired, 32 smoke pins added. ~~Zone-draw unwind (the
`maps.js:464-468` unguarded window shims), `damagNearMe` 4-way dedup vs
`maps-overlays.js`.~~ Both of those blockers had in fact closed on 2026-08-07;
the residual was the deferred conversion itself. Blocks nothing below
mechanically, but it was the last open item of Tranche 2 and touches the same
files as T3-C/D slices — landed first so later slices rebase cleanly.

**T3-A — mechanically-safe zero-external names (277, ~3 mechanical PRs).**
Single assigner + zero external consumer files + zero HTML hits + zero
bracket dispatch. Largest owner clusters:
`dashboard-actions.js` (33), `customer-tasks-ui.js` (31 safe of 49),
`dashboard-ui.js` (24 of 27), `dashboard-bootstrap.module.js` (23 of 25),
`ui.js` (17 of 18), `customer-bootstrap.module.js` (15),
`crm-portal-bridge.js` (11), `estimates.js` (10 of 13),
`maps-routing.js` (8), `dashboard-connect-tab.js` (7). Chunk by file,
one PR per 2–3 files, three-way proof per name, smoke + advisory E2E green.
This is the same shape as Tranche 0/1 and can be background work in any
session.

> ### ⚠ CORRECTION 2026-08-31 — "mechanically safe" is NOT safe. Read this before touching T3-A.
>
> Slice 1 (`dashboard-actions.js`, "33") was executed and the premise did not
> survive contact. **Of its 34 names — the count is 34, not 33, post-T3-0 —
> exactly zero were mechanically safe.** Full record:
> [SESSION-2026-08-31-t3-a-slice1](../../documentation/projects/SESSION-2026-08-31-t3-a-slice1.md).
>
> **Two independent defects, both in the filter, not in the data.**
>
> **1. The filter is blind to the two commonest cross-file paths.**
> `scripts/globals-xref.js` detects consumers only by matching the literal text
> `window.<name>`. It cannot see:
> - a **bare identifier call** — `foo(x)` in another classic script. 21 of the
>   34 had at least one.
> - **`window[fnName]` map dispatch** — a name that appears as a *value* in
>   `_NBD_TOGGLE_FNS` / `_NBD_MODAL_CLOSE_FNS` (`dashboard-state.js`), resolved
>   in `dashboard-ui.js`. 10 of the 34 were in those maps, all modal-close
>   handlers. This is blind spot #1 named at the top of this doc — but the
>   T3-A slice definition then contradicts it by calling the filter's output
>   "mechanically safe" and "background work in any session". **It is neither.**
>
> Scoping any of those names produces a *silent* failure: the map lookup or the
> `typeof` probe returns undefined, the delegate returns early, and nothing
> throws. A modal Joe cannot close mid-job is the failure mode.
>
> **2. The filter mis-attributes ownership, and that is where the "33" came from.**
> `dashboard-actions.js` carried **86 inert forward-reference re-exports**
> (`if (typeof X !== 'undefined') window.X = X;`) left from the monolith split.
> The census read each one as "dashboard-actions.js assigns X". **26 of the 34
> were phantoms** — names defined in `dashboard-ui.js`, `dashboard-widgets.js`,
> `dashboard-api.js`, `maps-routing.js`, `maps.js`, `ui.js`, or nowhere at all.
> Slice 1 deleted the block (proved inert by a live before/after snapshot); all
> 26 vanished from the census.
>
> **What is actually left in this file: 8 names, and every one needs real work.**
>
> *(Status refreshed 2026-09-01. Two are now converted by T3-M — 6 remain. The
> `toggleMobileMore` and `confirmPromoteProspect` rows were re-derived from the
> tree the same day and both understated the work; the corrected reasons are in
> the rows themselves. Treat this table as the per-name source of truth and keep
> it in step with the slice entries below — a stale row here is exactly the
> failure mode this whole correction block exists to document.)*
>
> | Name | Why it is not mechanical |
> |---|---|
> | ~~`closeMobileCreatePopover`~~ ✅ | ~~`_NBD_MODAL_CLOSE_FNS` → `window[fnName]`~~ **CONVERTED by T3-M, 2026-09-01** (see the T3-M entry below) — registry-only, off `window`. The map blocker was the dispatcher, never the handler. |
> | ~~`closeMobileInspection`~~ ✅ | ~~`_NBD_MODAL_CLOSE_FNS`~~ **CONVERTED by T3-M, 2026-09-01** — registry-only, off `window`. |
> | `closeMobileMore` | `_NBD_MODAL_CLOSE_FNS` + bare calls in `dashboard-ui.js:478`, `mobile-nav-customizer.js:388` *(line ref re-derived 2026-09-02; was :436)* |
> | `toggleMobileMore` | `_NBD_TOGGLE_FNS` + bare call `mobile-nav-customizer.js:800`. **Re-derived 2026-09-01 — the map is only HALF its dispatch.** `renderBottomNav()` does `nav.innerHTML = html` (`mobile-nav-customizer.js:337`), replacing the static More tile (`dashboard.html:5511`, `data-action="toggle" data-target="mobileMore"`) with one carrying `data-mnc-action="toggleMore"` (`:332`). So the map path is live only until a user customizes their tab bar; after that, dispatch goes through the mnc delegate's bare `toggleMobileMore()` at `:800` — behind `typeof … === 'function'`, so a scoped name **no-ops silently** on the customized nav while every static-markup audit stays green. Fix shape is already in that file: the `mCreateFabRoute` case at `:795-798` resolves registry-first. Same applies to its `mobileNav` case. |
> | `dsRemoveFloor` | bare call `dashboard-ui.js:2165` (already a known MUST-STAY from 2c-4d) |
> | `_mJdOpenEstimate` | ⚠ **ordering trap — read the code comment before touching it.** Already IIFE-scoped, so its `window._mJdOpenEstimate = …` line reads as a vestigial self-export. It is not: the `__NBD_CALL_REGISTRY` entry for it lives in a **different IIFE**, where the bare identifier is not lexically in scope and resolves through the global object instead. Deleting the export alone makes that registry line throw at load, aborting its whole IIFE and silently killing **all 19 registry entries in it** — the entire customer-detail action bar. Move the registry entry into the defining IIFE **first**. Smoke-pinned. |
> | `confirmPromoteProspect` | ~~allowlisted + read via `window.` in-file; the only genuine registry candidate~~ **Re-derived 2026-09-01 — not the freebie this row implies.** It is `window.confirmPromoteProspect = async function(leadId)` at `dashboard-actions.js:1745`: an anonymous function **expression**, at file top level (between the IIFEs closing at 1718 and opening at 1880), so **no lexical binding exists at all** — the name lives only as a window property. Its two reads (`:2151-2152`, inside `cdaConfirmPromote`) sit in the **1982-2207 IIFE**, a different scope, and are `window.`-qualified. Converting therefore needs three changes, not one: give it a real binding, register it, and rewrite both reads. Still allowlisted at `dashboard-state.js:282`. |
> | `openMobileInspection` | deliberate `window` export (2c-4b) + smoke-pinned → **MUST STAY** |
>
> **3. And the census undercounts the surface by ~40%.** It only sees explicit
> `window.X =`. A classic script's top-level `function foo(){}` is *also* a
> window property with no such text: **355 auto-globals exist that the census
> has never counted.** Top owners: `dashboard-ui.js` (64), `maps-customers.js`
> (45), `vault-page.js` (40), `ai-tool-finder-page-2.js` (39), `ui.js` (35).
> Every band figure in the table at the top of this doc is a floor, not a total.
>
> **Before running any further T3-A slice**, re-derive its name list with a
> filter that also checks bare cross-file calls and the two dispatch maps — the
> naive filter has a **100% false-positive rate** on the one file tested. The
> per-name script used for slice 1 is described in the session note.

**T3-M — make the two name-string dispatch maps registry-aware (SHIPPED 2026-09-01).**
Not in the original plan; added because T3-A slice 1 found it gating ~10 names
and the shape recurs. `_NBD_TOGGLE_FNS` and `_NBD_MODAL_CLOSE_FNS`
(`dashboard-state.js`) hold handler names as **strings**, and `dashboard-ui.js`
resolved them with a bare `window[fnName]`. A module-scoped function is
invisible to a string lookup on the global object, so any handler reachable
only through one of those maps could **never** leave `window` — no amount of
per-name proof helps. `_nbdResolveMapped()` now checks `__NBD_CALL_REGISTRY`
first, exactly as `_nbdResolveCall()` already did for `data-fn` markup.

Deliberately **no `_NBD_CALL_ALLOWLIST` gate** on the new resolver: there the
name arrives from markup and the allowlist is the security boundary; here it
came from a curated in-code map, which *is* the boundary. None of the 36 map
names are in `_NBD_CALL_ALLOWLIST`, so adding the gate would kill every toggle
and modal-close button at once.

Shipped as a strict no-op — the intersection of {36 map names} and {154
registry keys} was empty, so every pre-existing name still fell through to
`window`. Proof: the real resolver was called for all 36 entries against the
live emulator-backed dashboard.

**Two conversions landed on top**, both previously MUST-STAY *only* because of
the map: `closeMobileInspection` and `closeMobileCreatePopover` are
registry-only now. The remaining map-blocked names (`closeMobileMore`,
`toggleMobileMore`, and the wider band) also need their **bare cross-file
callers** rewired — the map was necessary but not sufficient for those.

> ### ✅ UPDATE 2026-09-02 — the freed 15 are ALL CONVERTED (#1338, #1339, #1340)
>
> The three slices landed in one evening, each evidence-first: a 70-agent
> derive→prove→refute workflow re-derived the freed list from the ground and
> adversarially proved every name's reach before any edit; each slice shipped
> with a BEFORE/AFTER differential emulator snapshot (all names `typeof
> undefined` on window, every map key flipped resolved-via-window →
> resolved-via-registry, zero drift elsewhere) and graduate smoke pins
> (registered + off-window + map-entry-stays). 17 of the maps' 36 entries now
> resolve registry-only. Corrections the workflow forced, recorded so the next
> session inherits measurements rather than folklore:
>
> - **The "IIFE-wrapping regions of large files" framing was true only for the
>   dashboard-ui.js 8** (depth-0 auto-globals → top-level consts). The
>   maps-routing 6 and closeDeletedDrawer were already IIFE-scoped with
>   explicit exports — their conversion was registry-entry + export-line-delete.
> - **The property-intel twins**: `closePropertyIntelModal` /
>   `closePropertyIntelConfirmModal` were OWNED by `property-intel.js`
>   (byte-identical dashboard-ui twins, property-intel winning the window slot
>   by load order). Both dashboard-ui copies are deleted; converting only the
>   table's attributed owner would have left a silent window fallback.
> - **Refuters killed two edit plans before they shipped a red**: a new
>   registry block ahead of dashboard-ui's existing one would have broken the
>   smoke `duRegBlock` first-match extraction (18 pinned names), and adding
>   map-dispatched names to `T2C2_NAMES` trips its allowlist-absence pin on
>   the map VALUES in dashboard-state.js — graduates get the bespoke pin
>   block, never the T2C2 list.
> - **Eight MORE map names look map-only-convertible** and are absent from the
>   17-freed ledger: `toggleDebugConsole`, `toggleRecentDropdown`,
>   `toggleDismissedNotifications`, `toggleNotificationDropdown`,
>   `toggleNeedsAttention`, `toggleShowSnoozed`, `toggleStaleShares`,
>   `toggleEngagementSort` (owners: dashboard-bootstrap.module.js, notif-bell,
>   crm.js, needs-attention-filter, lead-snooze, stale-shares-filter). Each
>   was individually proven map-only by the same workflow (two have test-side
>   reads to update; toggleEngagementSort has an in-file double-assignment,
>   crm.js:65 vs :133/:160). The "still blocked (19)" claim in the T3-M
>   session note overcounts — a measured next slice, not folklore.
>   **DONE same evening (2026-09-02, #1342): all eight converted** —
>   registry-only across six owner files, test-side reads rewired to the
>   registry, crm.js's dead W93 twin deleted and its auto-global made a
>   const. 25 of the maps' 36 entries now resolve registry-only; the
>   window fallback carries only the genuinely-blocked 11.
> - **Undocumented twin assigners among the genuinely blocked names**:
>   `closeTaskModal` (customer-tasks-ui.js:184 vs tasks.js — DISTINCT
>   implementations), `closeShortcutsPanel` (shortcuts-help.js:188 vs
>   ui.js:460) and `closeCmdPalette` (global-search.js:698 vs ui.js:27) each
>   have two implementations racing for the window slot — resolve ownership
>   before converting any of them.

**T3-B — zero-external names with HTML hits or twin assigners (177).**
Each needs either delegate-then-scope (the H-1 house pattern — migrate the
generated inline handler to `data-action`, THEN scope the global) or a
coordinated twin removal (e.g. the 14 `dashboard-actions.js`+`maps.js`
twins, 8 `dashboard-actions.js`+`maps-routing.js`). Slower per name; order
inside the band by cluster size, biggest first.

> ### Update 2026-09-17 — 12-name slice shipped (PR #1637)
>
> `maps.js`'s `/* EXPOSE MAP FUNCTIONS TO WINDOW */` try/catch block
> (`searchMap`, `selectPin`, `deletePin`, `clearAllPins`, `goToLeadFromPin`,
> `deleteLeadFromPin`, `makeLeadFromPin`, `deletePinOnly`, `toggleMapSidebar`,
> `updatePinStats`, `toggleOverlay`, `goToMyLocation`) was exactly this
> band's "twin assigner" shape: each name is a top-level `function`/`async
> function` declaration in its real owner file (`maps-overlays.js`,
> `dashboard-ui.js`, `dashboard-widgets.js`, `maps-core.js`,
> `maps-routing.js`), which a classic script already puts on `window` the
> moment that file parses. The `typeof`-guarded re-export here was a second,
> redundant assigner — pure `window.X = window.X` — not a safety net. Deleted
> whole; ~171 names remain in the band.

**Correction 2026-09-17 — `goToMyLocation` needed the three-way proof
re-run, not the deletion above.** The T3-M section (below) still describes
it as blocked because "the maps.js shim still re-states it on window." That
was true only of the redundant re-export just deleted; `goToMyLocation`
itself is still dispatched from markup via `data-fn="goToMyLocation"` and is
**not yet registered** in `__NBD_CALL_REGISTRY`, so it correctly stays
allowlisted in `dashboard-state.js` — a genuine T3-C/T3-B candidate on its
own merits, independent of the shim that used to also be in the way.

**T3-C — one-consumer names by edge (176, ~5–6 PRs).**
Convert edge-by-edge; each edge is one natural PR:

| Edge (assigner → consumer) | Names |
|---|---|
| dashboard-bootstrap.module.js → ui.js | 7 — **6 shipped 2026-09-17 (PR #1637)** |
| customer-tasks-ui.js → customer-bootstrap.module.js | 6 — **re-derived to 5, NOT a safe T3-C shape; see note below** |
| customer-bootstrap.module.js → customer-tasks-ui.js | 5 — **re-derived to 8, 4 shipped 2026-09-18; see note below** |
| dashboard-bootstrap.module.js → crm-portal-bridge.js | 5 — **shipped 2026-09-18 (PR #1642)** |
| dashboard-bootstrap.module.js → rep-report-generator.js | 4 — **3 shipped 2026-09-18 (PR #1642); see note below** |
| dashboard-bootstrap.module.js → crm-pipeline.js | 4 — **re-derived to 0, see note below; not attempted** |
| dashboard-bootstrap.module.js → maps-overlays.js (pins) | 2 — **shipped 2026-09-18 (PR #1645); see note below** |
| dashboard-bootstrap.module.js → dashboard-actions.js (zones) | 2 — **shipped 2026-09-18 (PR #1645); see note below** |
| dashboard-bootstrap.module.js → estimate-crm-ops.js | 3 — **shipped 2026-09-18 (PR #1646); see note below** |
| dashboard-bootstrap.module.js → crm-leads.js | 2 — **shipped 2026-09-18 (PR #1647); see note below** |
| long tail (1–3-name edges) | ~136 |

> ### Update 2026-09-18 — crm-portal-bridge.js + rep-report-generator.js edges (PR #1642)
>
> **`crm-portal-bridge.js` (5 of 5):** `toggleInsuranceFields`,
> `refreshSubTypeAndTrades`, `setSelectedTrades`, `_deleteLead`,
> `_loadDeletedLeads` — all anonymous function/arrow expressions assigned
> directly to `window.X` with no local binding, converted clean. Two
> self-references (an internal call inside `toggleInsuranceFields`, and two
> `addEventListener('change', window.toggleInsuranceFields)` registrations)
> rewired to bare calls — safe because `dashboard-bootstrap.module.js` has no
> IIFE wrapping any of the 8 names this PR touched (it does have 3 unrelated
> `(async () => {})()` IIFEs for URL-param bootstrapping, confirmed by AST
> walk; none contains or is referenced by these declarations).
>
> **`rep-report-generator.js` (3 of the listed 4):** `_saveReport`,
> `_deleteReport`, `_loadReports` converted the same way. **The 4th,
> `_reports`, does NOT convert** — it's a data cache, not a callable, so it
> can't go through a call registry. The table's "4" was counting a cache
> alongside 3 real functions; `rep-report-generator.js` now keeps its own
> local `_reportsCache` (populated from `_loadReports()`'s return value)
> instead of reading `window._reports` directly. `window._reports` itself is
> left in place in `dashboard-bootstrap.module.js` as harmless, now-unread
> internal state.
>
> **`crm-pipeline.js` edge (listed as 4) re-derived to zero and NOT
> attempted.** A dedicated investigation agent found the candidate names are
> actually re-exports of `crm-stages.js` constants with many real consumers
> elsewhere — misattributed ownership; they belong to T3-D's long tail, not
> this T3-C edge. Worse, `crm-pipeline.js` also has a `_dragId` landmine:
> shared drag-and-drop state read/written as a **bare implicit global**
> (that file's own header comment documents this as deliberate). Scoping it
> without a coordinated cross-file fix first would silently split-brain
> drag state. Flagged for its own future slice — don't fold it into a T3-C
> edge PR again without reading this note first.
>
> Verification: two independent adversarial-review agents re-read every
> changed line in both consumer files plus the `dashboard-bootstrap.module.js`
> declarations (one per file-group) and found zero bugs in the migration
> itself. They did catch a real CI failure from a *third* file —
> `tests/customer-page-claims.test.js` anchored `_saveReport`'s extraction on
> the literal string `'window._saveReport'`, which this conversion deleted;
> fixed by re-anchoring to `'async function _saveReport'`. Also flagged but
> deliberately NOT fixed here (pre-existing, not introduced by this PR):
> `dashboard-bootstrap.module.js`'s `_loadDeletedLeads` does a bare `return;`
> on its early-out instead of `return [];` (unlike its sibling
> `_loadReports`), so a caller doing `.length` on it can throw before claims
> resolve — `renderDeletedDrawer` has no try/catch around that call, so
> opening the Deleted drawer early could throw and strand the "Loading..."
> placeholder. One-line fix (`return [];`) whenever someone's next in that
> file.

> ### Update 2026-09-18 — customer-bootstrap.module.js ↔ customer-tasks-ui.js, both edges re-derived; only one direction shipped
>
> `customer.html` loads `customer-bootstrap.module.js` (`type="module"`) and
> `customer-tasks-ui.js` (classic `defer` script) — the same module/classic-
> script shape as the dashboard-side edges above, but this was the first
> time either direction of this specific pair was attempted. Both directions
> turned out to need re-deriving from a fresh `globals-xref.js` run rather
> than trusting the table's original "6"/"5" counts.
>
> **`customer-bootstrap.module.js` → `customer-tasks-ui.js` (re-derived to 8,
> 4 shipped, PR #1644):** `_fetchPhotosRaw`, `loadPhotos`, `setLightboxSource`,
> `_nbdTsToDate` converted — all genuine callables with a single external
> consumer file, same conversion shape as the dashboard-side edges
> (`window.X = function(){}` → real `function X(){}` declaration +
> `__NBD_CALL_REGISTRY` entry; `window.X = someLocalFn` → drop the window
> line, register the existing binding). This is the FIRST use of
> `__NBD_CALL_REGISTRY` on `customer.html` — that page never loads
> `dashboard-bootstrap.module.js`, so a fresh
> `window.__NBD_CALL_REGISTRY = window.__NBD_CALL_REGISTRY || Object.create(null);`
> guard was added rather than assuming the dashboard one already exists.
> `_nbdTsToDate`'s underlying function (`tsToDate`) is declared INSIDE a
> nested render function, not at module top level, so it registers itself
> inline at its own definition instead of joining the file-end
> `Object.assign` block the other three use — same shape as the
> `_mJdOpenEstimate` ordering trap documented in the T3-A correction above,
> caught here BEFORE shipping rather than after.
>
> **The other 4 census hits for this direction — `_bookingAsk`,
> `_bookingCustomerName`, `_bookingUrl`, `_currentStage` — are shared DATA
> (strings/a stage id set by one code path, read by another), not
> callables, and were left on window.** Same reasoning as `_reports` in the
> prior update: a call registry dispatches functions, not values. Converting
> these for real would mean a small state-store migration, which T3-E
> explicitly scopes OUT of Tranche 3 (it's the spine-migration question, not
> a globals-hygiene one) — don't re-attempt them as a quick T3-C add-on.
>
> **`customer-tasks-ui.js` → `customer-bootstrap.module.js` (re-derived to
> 5, NOT attempted — this is NOT a safe T3-C shape).** The table listed this
> as symmetric to the module-owned direction, but it isn't: the assigner
> here (`customer-tasks-ui.js`) is a **classic script with no IIFE wrapping**
> for any of the 5 candidates (`loadNewPortalSections`, `loadPhotosByPhase`,
> `renderCoverHero`, `setupContactTab`, plus `_uploadPhase` — a data value,
> same as the other direction's four). Unlike a real ES module, a classic
> script's top-level `function X(){}` declaration IS already
> `window.X` — auto-global, not explicit. Converting
> `window.X = function(){}` to a bare `function X(){}` here would only make
> the window assignment *implicit* instead of explicit; it would NOT
> actually remove `X` from `window` at runtime, and would silently fail the
> T1_NAMES off-window walk's entire premise. Genuinely taking these off
> window needs IIFE-wrapping the relevant region of `customer-tasks-ui.js`
> first — the same class of work T3-A's correction found "mechanically
> safe" was not, not a quick follow-on to the direction that shipped in this
> same PR. Flagged for its own future slice.
>
> Verification: two independent adversarial-review agents traced every
> consumer call site and all four real user-facing flows (lightbox array
> handoff, bulk/single photo-delete refresh, the `_fetchPhotosRaw`
> in-flight-dedupe sharing between `loadPhotos` and `loadPhotosByPhase`, and
> `_nbdTsToDate`'s first-render-before-registration timing) end to end and
> found zero bugs. Both independently confirmed via repo-wide grep that zero
> `window.<name>` references (including comments) survive anywhere under
> `docs/` for the four converted names, and independently reran
> `check-js-syntax`, the full `tests/smoke.test.js` (4096/4096), and
> `run-test-manifest.js --bucket smoke` (68/68) green. One test's fixed
> string-slice window (`+1700` chars in
> `tests/customer-photo-fetch-unification-2026-09-17.test.js`) needed
> widening to `+1900` after the call site grew a few characters longer
> (`window.X(` → `window.__NBD_CALL_REGISTRY.X(`) — a reminder that these
> fixed-offset test slices are brittle to any length change nearby, not just
> to the specific line being asserted on.

> ### Update 2026-09-18 — the pins + zones CRUD edges (PR #1645)
>
> Two more one-consumer edges off `dashboard-bootstrap.module.js`, found via
> the same fresh-census pass that turned up the customer.html edge above:
> `_savePin`/`_deletePin` (consumed by `maps-overlays.js`) and
> `_saveZone`/`_deleteZone` (consumed by `dashboard-actions.js`) — all 4 were
> anonymous arrow expressions assigned directly to `window.X`, converted to
> real `async function X(){}` declarations + `__NBD_CALL_REGISTRY` entries,
> same shape as the crm-portal-bridge.js edge. `_savePin` had 3 in-module
> self-references (all inside one D2D-knock-to-lead conversion flow, two
> sibling branches — geocoded and fallback — each linking a pending pin to
> the new lead), all rewired to bare calls; `_deletePin`/`_saveZone`/
> `_deleteZone` had none. `_zones` (a Firestore-loaded array cache) and
> `_DASH_DOC_PREREQUISITES` (a static doc-type config object) were also
> census candidates for these two edges but are DATA, not callables — same
> `_reports`-style treatment, left on window.
>
> **Pre-existing quirk found, NOT fixed here (not introduced by this PR):**
> `deleteZone` (`dashboard-actions.js`) initializes `let ok = true;` BEFORE
> its `typeof`/registry guard, so if the guard ever fails (function missing)
> `ok` stays `true` — fail-OPEN. `deletePin` (`maps-overlays.js`) does the
> opposite: its ternary defaults to `false` when the guard fails — fail-
> CLOSED. Both delete calls are guarded against a genuinely missing function
> (defensive code, not a live bug today — the function is always present in
> normal operation), so this asymmetry has never fired in practice, but it's
> a real inconsistency between two access-controlled delete paths worth a
> one-line fix (`let ok = false;`) whenever someone's next in
> `dashboard-actions.js`'s `deleteZone`.
>
> Verification: two independent adversarial-review agents — one general
> correctness pass, one specifically on the security/access-control angle
> (fail-open vs fail-closed defaults, the `/pins`+`/zones` Firestore rules
> boundary, `deleteZone`'s concurrent-delete stale-index guard) — traced
> every consumer call site and the real user flows (drop pin, delete pin,
> save zone, delete zone, both D2D-conversion branches) end to end and found
> zero bugs; the fail-open/fail-closed asymmetry above is the one thing
> either flagged, and both independently confirmed it predates this diff
> (the ternary/init shapes are unchanged, only what they guard changed from
> `typeof window.X` to `_nbdReg && typeof _nbdReg.X`). Both reran
> `check-js-syntax`, `tests/smoke.test.js` (4111/4111), and
> `run-test-manifest.js --bucket smoke` (68/68) green; one also did a
> byte-level EOL/CRLF scan on all 5 changed files per this repo's own
> Windows-editing hazards (see CLAUDE.md) — clean, no lone-CR bytes, no
> binary-flagged files.

> ### Update 2026-09-18 — the estimate CRUD edge (PR #1646)
>
> A third long-tail edge off `dashboard-bootstrap.module.js`, same session:
> `_deleteEstimate`, `_renameEstimate`, `_assignEstimateToLead` — consumed by
> `estimate-crm-ops.js` (lazy-loaded via the `ScriptLoader.loadBundle('estimates')`
> bundle on BOTH `dashboard.html` and `customer.html`). All 3 were anonymous
> arrow expressions assigned directly to `window.X` with zero in-module
> self-references, converted clean — same shape as the pins/zones edge above.
> `_duplicateEstimate`, defined right alongside these three, was NOT a
> candidate — it has multiple consumers, out of scope for a one-consumer
> T3-C slice.
>
> `_assignEstimateToLead` is the money/pipeline-sensitive one: it links an
> estimate to a lead and, on that lead's first estimate, stamps
> `jobValue`/`primaryEstimateId`/`stage` (feeding Pipeline/KPI/Leaderboard),
> guarded by `_canStampJobValue()` against a documented past bug ("zeroed a
> live deal across every money surface"), plus an un-dangle pass that clears
> the PREVIOUS lead's `primaryEstimateId` pointer on re-assign. This is a
> **pure move** — only the function's opening/closing lines changed; the
> ~96-line body (stamp-back branches, the jobValue guard, the un-dangle
> condition) is byte-identical pre/post, verified independently by two
> reviewers via zero-context diffs.
>
> **Deliberately NOT changed**: `_assignEstimateToLead`'s two consumer call
> sites (an "Unassign" button and a lead-row click, both inside
> `estimate-crm-ops.js`'s lead-picker modal) had — and keep — NO existence
> guard, unlike `_deleteEstimate`/`_renameEstimate`'s
> `typeof X !== 'function'` fallback-to-toast pattern. Adding a guard here
> would be a real behavior change riding along on a "pure mechanical"
> migration PR, so it wasn't done. This surfaced a genuine, PRE-EXISTING,
> separately-flagged bug (not fixed in this PR, not caused by it): because
> `_assignEstimateToLead` is only ever defined in
> `dashboard-bootstrap.module.js`, which `customer.html` never loads, the
> live "👤 Assign" button on `customer-estimate-hub.js`'s per-customer
> estimate rows (line ~289) silently fails there today — click Unassign or
> pick a lead, the modal closes, nothing happens, no error shown. Spawned as
> its own background task (title: "Fix broken 'Assign' on customer-page
> estimate hub") rather than folded into this migration PR.
>
> Verification: two independent adversarial-review agents — one general
> correctness pass, one specifically on the money/data-integrity angle
> (byte-for-byte body comparison via `git diff -U0`/`-U100`, the
> `_canStampJobValue` guard in both stamp branches, the un-dangle condition)
> — found zero bugs in either pass. Both reran `check-js-syntax`,
> `tests/smoke.test.js` (4121/4121), `tests/estimate-hub-controls.test.js`
> (12/12), and `run-test-manifest.js --bucket smoke` (68/68) green.
>
> **RESOLVED 2026-09-18, PR #1649** — the background task spawned above.
> Both `_assignEstimateToLead` call sites in `showAssignLeadPicker` now
> `typeof`-guard the registry entry before calling it, matching
> `_deleteEstimate`/`_renameEstimate`'s pattern exactly, and toast "Assign
> not available on this page" instead of throwing. Deliberately did NOT
> attempt to make Assign actually work on `customer.html` — that would mean
> duplicating the stamp-back logic onto a second page (a "twin assigner"
> that WILL drift, the exact failure shape this doc warns about elsewhere —
> see the `closeTaskModal`/`closeShortcutsPanel`/`closeCmdPalette` note under
> T3-M) or loading `dashboard-bootstrap.module.js` on `customer.html` (which
> would re-run its own `initializeApp()` + auth-listener bootstrap — not
> attempted, likely a duplicate-Firebase-app-instance error). **New finding
> while fixing this: `_duplicateEstimate` (the Copy button, via
> `doDuplicate` in `customer-estimate-hub.js`) is equally
> `dashboard-bootstrap.module.js`-only and unreachable from `customer.html`
> today** — confirmed by grep, it is not part of the lazy `estimates`
> ScriptLoader bundle either. Unlike Assign it already degrades gracefully
> (its own `typeof window._duplicateEstimate !== 'function'` guard predates
> this PR), so it was left alone; Assign now fails the same way. **All four
> per-row estimate actions on the customer-page hub (Duplicate/Delete/
> Rename/Assign) are therefore CRUD-dead on `customer.html` today** — every
> one either toasts "not available" or (before this PR) silently failed.
> Making any of them actually write from that page is a real feature slice
> (shared-module extraction, most likely), not a quick follow-on; flagged
> here rather than folded into a "fix a bug" PR. Verification: `node
> scripts/check-js-syntax.js` (513 files), `node
> tests/estimate-hub-controls.test.js` (17/17 — break-tested against the
> pre-fix code, which correctly reddened only the 3 assign-related
> assertions), `node tests/smoke.test.js` (4130/4130 — updated one pinned
> assertion in `tests/smoke/dashboard.test.js` that had checked the old
> unguarded call shape), `node scripts/run-test-manifest.js --bucket smoke`
> (68/68), plus `check-site-integrity`/`check-inline-html-scripts` clean and
> an EOL/CRLF byte-level check on all touched files (clean, no lone-CR, no
> binary-flagged files).

> ### Update 2026-09-18 — the crm-leads.js edge (PR #1647)
>
> A fourth long-tail edge off `dashboard-bootstrap.module.js`, same
> session: `filterStageDropdownByJobType`, `getSelectedTrades` — consumed
> by `crm-leads.js`. The cleanest slice of the day: zero HTML/markup hits,
> zero prior test coverage on either name anywhere in the repo, both
> anonymous function expressions assigned directly to `window.X`. One
> self-reference (`filterStageDropdownByJobType` called from inside
> `toggleInsuranceFields`) went from a defensive `window.X && window.X(jt)`
> guard to a bare `filterStageDropdownByJobType(jt)` call — safe because
> `toggleInsuranceFields` only ever fires from a `change` listener wired up
> inside `DOMContentLoaded` (or via the registry from
> `crm-portal-bridge.js`'s `setTimeout`), both long after the module has
> fully parsed, so the hoisted function declaration is always available by
> then.
>
> Verification: one adversarial-review agent (proportionate to the size —
> a 2-name, zero-test-coverage slice doesn't need the two-reviewer
> treatment the money-sensitive edges got) traced every consumer/self-
> reference call site via independent grep, specifically verified the
> guard-removal's safety by tracing every `toggleInsuranceFields` call site
> back to confirm none can fire before module parse completes, and reran
> `check-js-syntax`, `tests/smoke.test.js` (4129/4129), and
> `run-test-manifest.js --bucket smoke` (68/68) green — plus an EOL/CRLF
> hygiene check on the touched files (clean).

Resolution per name: registry-dispatch if markup-driven, otherwise pass the
value/function through an existing module seam (or NBD-prefixed singleton if
the edge is a real API).

> ### Update 2026-09-17 — the ui.js edge, 6 of 7 (PR #1637)
>
> `_loadCompanySettings`, `_loadCompanyProfileSettings`, `_loadAccessInfo`,
> `_loadBillingInfo`, `_loadNotifSettings`, `_loadProfileSettings` all moved
> off `window` into `dashboard-bootstrap.module.js`'s `__NBD_CALL_REGISTRY`.
> The first two were 2c-4f's only MUST-STAY leftovers, kept window-exported
> specifically because `switchSettingsTab` (`ui.js`) read them as bare
> `window.X()` calls; rewiring that one consumer to read the registry
> unblocked all six — the other four loaders were never in any prior
> tranche's ledger at all (not MUST-STAY, just never audited) and turned out
> to have the identical single-owner/single-consumer shape.
>
> **The 7th name in the edge, `_loadEstimateDefaultsV2`, is excluded on
> purpose.** It looked like the same shape but isn't: 3 internal
> self-references inside `dashboard-bootstrap.module.js` itself (not just the
> one the file's own comment names) plus a derived
> `window._loadEstimateDefaults = function() { return
> window._loadEstimateDefaultsV2(); }` alias. Converting it needs its own
> slice — rewiring the self-references too, not just the `ui.js` edge.

**T3-D — the 2–5 band proper (131 names → NBD-prefixed singleton APIs).**
Owner-cluster order, biggest coherent API first:

1. **`dashboard-bootstrap.module.js` (26)** — this is a de-facto
   **lead/estimate data API**: `loadLeads`, `_saveLead`, `_saveEstimate`,
   `_loadEstimates`, `_duplicateEstimate`, `_restoreLead`,
   `_permanentDeleteLead`, `STAGES`, `_stageKeys`, `stageLabel`,
   `isWonStage`, `buildKanbanColumns`, `KANBAN_VIEWS`, `JOB_TYPE_META`,
   `inferJobType`, `missingRequiredFields`, `shouldFireNotif`, … Candidate:
   consolidate under one `NBDLeadAPI` (or fold into `NBDStore`). Biggest
   single win in the band; 2–3 PRs (stage/kanban constants first — pure
   data, lowest risk).
2. **`company-profile.js` (9)** — a coherent company-profile API
   (`_loadCompanyProfile`, `_saveCompanyProfile`, `_resolveCompanyKey`,
   `_formatCustomerId`, `_custCounterId`, `NBD_COMPANY_PROFILE_DEFAULTS`,
   `_legal`, `nbdRetryOffline` — note `nbdRetryOffline` may belong in a
   generic net-util instead). One PR.
3. Long tail: `crm-portal-bridge.js` (4), `nbd-auth.js` (3),
   `customer-tasks-ui.js` (3), `crm.js` (3), then the 25-file `2`-consumer
   scatter (each name individually tiny — batch by consumer pattern).

**T3-E — spine disposition note (0.5 session, docs only).** Record the
keep-as-API list above INTO `dashboard-decomposition-plan.md` as the closing
state of the globals lane, so no future session re-audits `db`/`_leads`
"opportunities." The state-store migration for `_leads`/`_user`/`_estimates`
gets a BIG_ROCKS entry of its own if Jo ever wants it — it is not Tranche 3.

## Verification per slice (unchanged from Tranche 2)

Full smoke battery (`T1_NAMES` walk + `data-fn` wiring audit) + sharded
authed E2E matrix green at job level + manual click-through of touched views.
One module (or edge) per PR. Merge on E2E green, not smoke alone.

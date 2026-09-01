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
> | `closeMobileMore` | `_NBD_MODAL_CLOSE_FNS` + bare calls in `dashboard-ui.js:436`, `mobile-nav-customizer.js:388` |
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

**T3-B — zero-external names with HTML hits or twin assigners (177).**
Each needs either delegate-then-scope (the H-1 house pattern — migrate the
generated inline handler to `data-action`, THEN scope the global) or a
coordinated twin removal (e.g. the 14 `dashboard-actions.js`+`maps.js`
twins, 8 `dashboard-actions.js`+`maps-routing.js`). Slower per name; order
inside the band by cluster size, biggest first.

**T3-C — one-consumer names by edge (176, ~5–6 PRs).**
Convert edge-by-edge; each edge is one natural PR:

| Edge (assigner → consumer) | Names |
|---|---|
| dashboard-bootstrap.module.js → ui.js | 7 |
| customer-tasks-ui.js → customer-bootstrap.module.js | 6 |
| customer-bootstrap.module.js → customer-tasks-ui.js | 5 |
| dashboard-bootstrap.module.js → crm-portal-bridge.js | 5 |
| dashboard-bootstrap.module.js → rep-report-generator.js | 4 |
| dashboard-bootstrap.module.js → crm-pipeline.js | 4 |
| long tail (1–3-name edges) | ~145 |

Resolution per name: registry-dispatch if markup-driven, otherwise pass the
value/function through an existing module seam (or NBD-prefixed singleton if
the edge is a real API).

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

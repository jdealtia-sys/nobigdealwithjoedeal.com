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
Zone-draw unwind (the `maps.js:464-468` unguarded window shims),
`damagNearMe` 4-way dedup vs `maps-overlays.js`. Blocks nothing below
mechanically, but it is the last open item of Tranche 2 and touches the same
files as T3-C/D slices — land it first so later slices rebase cleanly.

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

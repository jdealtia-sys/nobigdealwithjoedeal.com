# Session 2026-08-31 — Rock 4 / Tranche 3 slice T3-A part 1 (dashboard-actions.js)

> Second lane of the day, after
> [T3-0](SESSION-2026-08-31-t3-0-zone-draw-unwind.md). The task was "convert
> `dashboard-actions.js`'s 33 mechanically-safe names." **None of them were
> mechanically safe.** What shipped instead is the fix that had to come first:
> deleting the 86 inert forward-reference re-exports that were fabricating the
> "33" in the first place.

## Headline

The T3-A slice definition in
[globals-tranche3-plan](../../docs/dev/globals-tranche3-plan.md) calls its 277
names "mechanically-safe" and says the slice "can be background work in any
session." Tested against the first file, that is wrong in three independent ways.

| Claim | Reality on `dashboard-actions.js` |
|---|---|
| 33 mechanically-safe names | **34** names, **0** mechanically safe |
| the file owns them | **26 of 34** are defined in other files entirely |
| the census measures the surface | it misses **355** auto-globals repo-wide |

## Defect 1 — the filter cannot see the two commonest cross-file paths

`scripts/globals-xref.js` finds consumers by matching the literal string
`window.<name>`. Two very common ways a name is reached are invisible to it:

- **Bare identifier calls.** `docs/pro/js/*.js` are *classic* scripts, so
  `foo(x)` in one file resolves to a top-level `function foo` in another with no
  `window.` anywhere. **21 of the 34** had at least one — e.g. `dsRemoveFloor`
  ← `dashboard-ui.js:2165`, `openPinConfirm` ← `maps-core.js:109` and
  `maps-overlays.js:173`, `renderPhotoGrid` ← six sites in `customer-tasks-ui.js`.
- **`window[fnName]` map dispatch.** `_NBD_TOGGLE_FNS` and
  `_NBD_MODAL_CLOSE_FNS` in `dashboard-state.js` hold handler names as *strings*,
  which `dashboard-ui.js` resolves as `window[fnName]`. **10 of the 34** are
  values in those maps — `closeDocViewer`, `closeMobileCreatePopover`,
  `closeMobileInspection`, `closeMobileMore`, `closePhotoModal`,
  `closePropertyIntelModal`, `closePropertyIntelConfirmModal`, `closeTips`,
  `closeUploadDoc`, `toggleMobileMore`.

Both failures are **silent**: the lookup returns `undefined`, the delegate
returns early, nothing throws. Nine of the ten map entries are modal-*close*
handlers, so the realistic failure is Joe opening a modal in the field and not
being able to close it.

This is blind spot #1 at the top of the plan document. The plan names it and
then, forty lines later, describes the filter's raw output as mechanically safe.
**The two statements were never reconciled.**

## Defect 2 — the census mis-attributes ownership, and that manufactured the "33"

`dashboard-actions.js` carried **86** guarded re-exports left over from the
original monolith split:

```js
if (typeof searchMap !== 'undefined') window.searchMap = searchMap;
```

The census reads each as "dashboard-actions.js assigns `searchMap`". It does
not. **Every one of the 86 was inert:**

- **62 DEAD.** The subject is defined in a script that loads *after* this one
  (`maps-overlays`, `maps-routing`, `maps`, `ai`, `ui`, `crm`,
  `crm-portal-bridge`, `tasks`), or — for the `estimates.js` names — in a file
  that is never a static `<script>` at all and only arrives through the lazy
  `ScriptLoader` bundle. The `typeof` read happens at *this* file's execution
  time, so it always saw `'undefined'` and the assignment never ran. Four names
  (`drop`, `saveJoeKey`, `markAllNotificationsRead`, `markNotificationRead`)
  have no definition anywhere in the tree.
- **24 REDUNDANT.** The subject is a top-level `function` declaration in an
  *earlier* classic script — already a window property — so `window.X = X`
  assigned a name the value it already held.

The block's own comments had drifted into fiction: a banner reading "ALL FORWARD
REFERENCES BELOW COMMENTED OUT — FUNCTIONS NOT DEFINED YET" sat directly above
60 lines of live code; "Photos — defined later in this file" labelled functions
that live in `dashboard-widgets.js`; "exposed by maps.js after it loads (line
8217)" referred to a file that is now ~500 lines. One earlier session had already
found the dead-guard pattern (there is a correct comment about
`crm-portal-bridge.js` loading later) but then kept two dead guards immediately
below it under the mistaken note "their guards stay below."

**Deleting the block re-attributed 26 of the 34 names away from this file.** All
26 vanished from the census — they were never explicitly assigned by anyone.

## Defect 3 — the census undercounts the surface by ~40%

Since the census only matches `window.X =`, it has never counted auto-globals at
all. Measured this session across `docs/pro/js`:

- 625 names explicitly assigned via `window.X =`
- 542 top-level auto-globals in classic scripts
- **355 auto-globals the census has never seen**

Biggest unseen owners: `dashboard-ui.js` (64), `maps-customers.js` (45),
`vault-page.js` (40), `ai-tool-finder-page-2.js` (39), `ui.js` (35). Every band
figure in the plan is a floor, not a total.

## What shipped

**86 inert forward-reference re-exports deleted** from `dashboard-actions.js`
(−127 lines, +86 of explanation), plus the ~16 stale section comments that
existed only to label them.

Kept deliberately: the `if (typeof startNewEstimate === 'function') { … } else
{ … }` block only *looks* like one of these. Its else-branch installs the
load-then-run stubs for the lazy estimates bundle, and that branch is the one
that always runs.

**Smoke pins added** so the block cannot grow back — in this file and in
`dashboard-ui.js` / `dashboard-widgets.js` / `dashboard-state.js`. The pin regex
uses `[ \t]` rather than `\s` deliberately: `\s` matches newlines, and the first
version swallowed the legitimate multi-line `startNewEstimate` stub installer as
a false positive.

## Verification — a purpose-built before/after harness

Static reasoning about classic-script load order is exactly the sort of claim
that deserves an empirical check, so this session added one:
**`tests/e2e/globals-surface-snapshot.spec.js`** (opt-in, `@globals`, not in the
CI matrix). It logs into the emulator-backed dashboard and records, for each
name, `typeof window[name]` plus a hash of the function's source text — so a
name silently rebound to a *different* function is caught, not just a missing one.

Run before the change, run after, diff:

| Run | Result |
|---|---|
| baseline (86 guards present) | 75 names, **75 present, 0 missing** |
| after deleting 79 | **byte-identical to baseline** |
| before deleting the last 7 | 85 names, 85 present |
| after deleting all 86 | **byte-identical** |

Two controlled experiments, both empty diffs. That is the proof the deletion is
behaviour-neutral.

Other gates: `check-js-syntax` (471 clean), `check-inline-html-scripts`,
`check-site-integrity` (235 pages, 0 failures), **smoke 3478 passed / 0 failed**.
Census: 821 → 782 rows, zero-external band 448 → 410.

**That census drop is not a real reduction** and must not be reported as one.
The 39 names remain auto-globals in their own files; the census simply stopped
crediting them to a file that never owned them. The number got *more honest*,
not smaller.

Reproduce the snapshot harness (needs Java + `tests/node_modules`; scrub the
proxy env per CLAUDE.md):

```bash
cd tests && PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 PLAYWRIGHT_TEST_USER_EMAIL=playwright-e2e@nbd.test PLAYWRIGHT_TEST_USER_PASSWORD=nbd-e2e-password-1 GLOBALS_SNAPSHOT_OUT=.globals-BEFORE.json env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy npx firebase emulators:exec --only auth,firestore,storage,hosting --project nobigdeal-pro "node ./e2e/fixtures/seed-emulator.js && npx playwright test globals-surface-snapshot.spec.js --reporter=line"
```

## What is actually left in this file — 8 names, all needing real work

| Name | Blocker | Shape of the fix |
|---|---|---|
| `closeMobileCreatePopover` | `_NBD_MODAL_CLOSE_FNS` | map must resolve registry-first |
| `closeMobileInspection` | `_NBD_MODAL_CLOSE_FNS` | same |
| `closeMobileMore` | map + bare calls (`dashboard-ui.js:436`, `mobile-nav-customizer.js:388`) | same + rewire 2 call sites |
| `toggleMobileMore` | `_NBD_TOGGLE_FNS` + `mobile-nav-customizer.js:800` | same |
| `dsRemoveFloor` | bare call `dashboard-ui.js:2165` | known MUST-STAY from 2c-4d |
| `_mJdOpenEstimate` | 2 generated `data-fn` hits | register + de-allowlist |
| `confirmPromoteProspect` | allowlisted, read via `window.` in-file | the one genuine registry candidate |
| `openMobileInspection` | deliberate `window` export (2c-4b) + smoke-pinned | **MUST STAY** |

**The obvious next slice is not more T3-A — it is making the two dispatch maps
registry-aware.** `_NBD_TOGGLE_FNS` / `_NBD_MODAL_CLOSE_FNS` resolve through
`window[fnName]`; if their lookup tried `__NBD_CALL_REGISTRY` first, the same way
`_nbdResolveCall` already does for markup dispatch, then 10 of these 8-plus names
and a large share of the wider 277 band would become convertible in bulk. That is
one small change to `dashboard-ui.js` that unblocks the rest of the tranche.

## Method note — what actually caught this

The instruction to re-run the census before trusting the plan was necessary but
**not sufficient**: the census reproduces the plan's numbers exactly. What broke
it open was writing a *second, independent* checker (~40 lines: bare-call grep
excluding the defining file, membership test against the two dispatch maps,
markup grep across `.html` *and* JS template literals) and comparing the two
lists. The disagreement was the finding.

Same lesson as T3-0, one level deeper. There, a stale *status* was copied forward
between docs. Here, a *measurement instrument* was trusted because its output
looked precise. Precision is not accuracy. **When a plan's slice is defined by a
tool's output, audit the tool before executing the slice.**

## Docs corrected in place

- [globals-tranche3-plan](../../docs/dev/globals-tranche3-plan.md) — a
  ⚠ CORRECTION block on the T3-A slice with all three defects, the surviving
  8-name table, and the instruction to re-derive every future slice list with a
  filter that checks bare calls and the dispatch maps.

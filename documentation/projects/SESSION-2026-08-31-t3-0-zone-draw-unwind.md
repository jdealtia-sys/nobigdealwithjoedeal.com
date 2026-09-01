# Session 2026-08-31 — Rock 4 / Tranche 3 slice T3-0 (the shim-blocked residual)

> One-lane session. Executed T3-0 from
> [globals-tranche3-plan](../../docs/dev/globals-tranche3-plan.md), the last
> open item of Tranche 2. **6 globals off `window`**, 2 cross-file bare calls
> rewired, 32 smoke pins added, 4 stale docs corrected in place.
>
> Prior handoff: [NEXT_SESSION-2026-08-31](NEXT_SESSION-2026-08-31.md).

## The headline finding: T3-0's blockers were already gone

The plan (written 2026-08-31, PR #1304) defines T3-0 as *"Zone-draw unwind
(the `maps.js:464-468` unguarded window shims), `damagNearMe` 4-way dedup vs
`maps-overlays.js`."*

**Both of those closed on 2026-08-07** — 24 days before the plan was written —
in the system-stability power session (commit `caab17ec`, PR #1194, recorded in
[SYSTEM-STABILITY-PERF-2026-08-07](../audit/SYSTEM-STABILITY-PERF-2026-08-07.md)):

- the `maps.js` re-export block became `typeof`-guarded **and**
  try/catch-fenced, which is exactly the condition the audit said zone-draw
  was waiting on;
- `damagNearMe` was deduped to one implementation in `maps-overlays.js`, with
  registry registration and smoke pins already in `dashboard.test.js:3349`.

The plan inherited the July wording verbatim from
`dashboard-actions-globals-audit.md` and `globals-decomposition-HANDOFF.md`
without re-checking it. **`maps.js:464-468` has pointed at comment text, not
code, since 2026-08-07** — the block it names now starts at `maps.js:475`. That
dead line reference was repeated across four docs.

So the residual was never the blockers. It was **the conversion the blockers
had deferred** — which is what this session actually did.

### Why this one is worth recording

The 08-31 planning session already caught one stale number (the "~515 middle
band" that measured 131). This is the same failure mode one level worse: a
stale **status** rather than a stale **count**. A stale count makes you
mis-size the work; a stale status makes finished work look blocked and hands
the next session a phantom precondition to re-derive. Both came from copying a
prior doc's framing forward instead of re-measuring.

**Method that caught it:** the task instruction to re-run
`node scripts/globals-xref.js` before trusting the plan — then, crucially,
opening `maps.js:464-468` itself rather than trusting the citation. The census
alone would not have caught it; the census reproduces the plan's table.

## What shipped

Six names off `window`, IIFE-scoped in `dashboard-actions.js` and dispatched
through `__NBD_CALL_REGISTRY`:

| Name | How it was reached | Disposition |
|---|---|---|
| `startZoneDraw` | `dashboard.html` ×2 `data-fn` + allowlist | registry; de-allowlisted |
| `cancelZoneDraw` | `dashboard.html` `data-fn` + allowlist | registry; de-allowlisted |
| `saveZone` | `dashboard.html` `data-fn` + allowlist | registry; de-allowlisted |
| `deleteZone` | **bare cross-file call** `dashboard-widgets.js:907` | registry + call site rewired |
| `selectZoneColor` | **bare cross-file call** `dashboard-ui.js:357` | registry + call site rewired |
| `damageNearMePhotos` | `dashboard.html` `data-fn` + allowlist | own IIFE; registry; de-allowlisted |

Plus: the six `maps.js` re-export lines deleted (the actual "shim unwind"),
and eight zone helpers (`_populateZoneReps`, `_pointInPolygon`,
`_zoneInsights`, `_zoneRepLabel`, `_zonePopupHTML`, `_bindZoneInsights`, …)
became genuinely private — they had no external caller and were only
auto-global by accident of top-level declaration.

**`renderSavedZones` is the deliberate MUST-STAY.** It is a real cross-file
API: `maps-core.js:113` redraws zones 400 ms after map init and
`dashboard-bootstrap.module.js:3987` redraws them when the `/zones` read
resolves — both off `window`, from outside the file. Its export moved *inside*
the IIFE rather than being deleted. (`tests/e2e/screenshot-demo.spec.js` also
drives it off `window`.) `goTo` still never converts.

### The two rewired call sites — the part that could have gone silently wrong

Registry registration alone does **not** fix a bare cross-file identifier. Two
call sites had to change first, and both fail *silently* if missed — the
delegate returns early, the probe evaluates false, and nothing throws:

1. **`dashboard-widgets.js` `renderZoneList`** generated a delete button and
   then re-bound `addEventListener('click', () => deleteZone(...))` per row —
   a bare call. Migrated to `data-action="call" data-fn="deleteZone"
   data-arg="${esc(z.id)}"` (the **H-1 pattern**: move the generated handler to
   `data-action`, *then* scope the global). The document-level `call` delegate
   pushes `data-arg` as the first argument, so `deleteZone(id)` still gets its
   id.
2. **`dashboard-ui.js`'s `zoneColor` action** probed
   `typeof selectZoneColor === 'function'` — a bare lexical read that would
   quietly evaluate false once the name was scoped, killing the D2D zone-colour
   swatches. Now resolves through `_nbdResolveCall('selectZoneColor')`, the
   same registry-first path every other converted handler uses.

## Blind-spot checks (the three-way proof, plus the dynamic ones)

The plan lists three static-analysis blind spots. All were checked explicitly:

- **`window[fnName]` variable dispatch** — the trap that bit `goToMyLocation`
  in 2c-2. Checked all four dispatch sites: `_NBD_TOGGLE_FNS` and
  `_NBD_MODAL_CLOSE_FNS` (neither carries a zone/damage name), `waitForMapFn`
  (polls only `initMainMap` / `initDrawMap`), and the lazy-estimate stub
  installer (estimate names only). Clean.
- **Runtime-generated inline handler strings** — grepped all six names inside
  string literals across `docs/pro/js/`. Only two hits, both `console` log text
  in `dashboard-bootstrap.module.js` for the `window._saveZone` /
  `window._deleteZone` Firestore layer. Not dispatch.
- **The comment-scanning `T1_NAMES` walk** — the walk greps `window.<Name>` in
  raw source *including comments*. Every comment added this session names the
  functions bare, never as `window.X`. Walk is green.
- **`dashboard.legacy.html`** (the read-only pre-V2 snapshot) loads the same
  four scripts plus `maps.js`, so its zone controls resolve through the same
  registry. Verified.

## Verification

- `node scripts/check-js-syntax.js` — 471 files clean
- `node scripts/check-inline-html-scripts.js` — 0 inline scripts / 220 files
- `node scripts/check-site-integrity.js --quiet` — 235 pages, 0 failures
- `node tests/smoke.test.js` — **3474 passed, 0 failed** (32 of them new)
- **E2E `dashboard-actions-audit.spec.js` run for real** against the
  `auth,firestore,storage,hosting` emulator suite with the seeded test user —
  **2 passed, 419 controls audited, `pageErrors: []`, zero `DEAD`.** The 8
  reported "problems" are all pre-existing `UNKNOWN_ACTION` entries for
  view-scoped delegates audited elsewhere (`preview`, `snooze`,
  `crmFiltersMenu`, `card-click`, `toggle-select`, `open-tasks`, `move-card`,
  `card-overflow`) — none touches this change.

That empty `pageErrors` is the load-time proof that mattered: it means
`maps.js` parsed and ran with its six re-exports deleted, and the newly
IIFE-wrapped `dashboard-actions.js` executed without a `ReferenceError` — the
exact failure the audit feared. The zone controls (`zoneColor`, and the
`data-fn` buttons for `startZoneDraw` / `cancelZoneDraw` / `saveZone` /
`damageNearMePhotos`) are absent from `problems`, i.e. they resolved against
the **live** `__NBD_CALL_REGISTRY` in a real browser.

**Not covered by that run:** the generated `deleteZone` button only exists once
a zone is rendered, and the emulator fixture seeds none — so its dispatch is
pinned by the two paired smoke assertions (registry registration + generated
`data-action` markup) rather than by a live tap. Worth a manual click on the
map view's zone list after deploy.

Reproduce the E2E run (needs Java + `tests/node_modules`; scrub the proxy env
per CLAUDE.md):

```bash
cd tests && PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 PLAYWRIGHT_TEST_USER_EMAIL=playwright-e2e@nbd.test PLAYWRIGHT_TEST_USER_PASSWORD=nbd-e2e-password-1 env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy npx firebase emulators:exec --only auth,firestore,storage,hosting --project nobigdeal-pro "node ./e2e/fixtures/seed-emulator.js && npx playwright test dashboard-actions-audit.spec.js --reporter=line"
```

(`build-sitemap.js` / `build-projects.mjs --check` were skipped — known
Windows-CRLF local false-fail, green on CI, per the standing note.)

**One E2E fix was required and is easy to miss:** that spec's `zoneColor` case
called `fnCheck('selectZoneColor')`, which tests `typeof window[name]`. The
spec's own header comment already warned that non-registry-aware checks make
"every converted name audit as a false DEAD" — but only the generic `call`
branch had been made registry-first. The dedicated-action branches had not.
Fixed for `zoneColor`; **the other dedicated-action branches
(`kanbanView`, `filterByStage`, `mapSidebar`, `tradeChip`, `selLineType`,
`settingsTab`, `navSection`, `crmToolsMenu`, `mapOverlay`, `selectPin`) carry
the same latent trap** and will each need the same one-line change the first
time their target is converted. Worth knowing before T3-A.

## Gap found, not closed (deliberate)

**Generated `data-fn` markup is not covered by any wiring audit.** The smoke
"FULL wiring audit" scans `dashboard.html` only; `data-fn` attributes emitted
from JS template literals are invisible to it. Today there are **20 such names
across `docs/pro/js/`, all resolvable** (measured this session) — including the
`deleteZone` button this slice created. The 2c-4c note in the audit doc flags
the same hole for `hardResetTest`/`gstaticTest`.

Not closed here because the obvious implementation trips over five
placeholder names (`setFoo`, `setBar`, `setBaz`, `handleUpload`, `fnName`) that
live in `dashboard-ui.js` **doc comments**, so a naive gate needs
comment-stripping — exactly the kind of heuristic that becomes a flaky gate for
a later session. Scoped out rather than rushed; T3-0's own assertions pin the
`deleteZone` pair directly.

## Where Rock 4 stands now

The **registry lane is closed.** `goTo` is the only name left in it and never
converts. Everything remaining is Tranche 3 proper:

- **T3-A next** — 277 mechanically-safe zero-external names, largest cluster
  `dashboard-actions.js` (33). Same shape as Tranche 0/1; background work.
- T3-B (177 with HTML hits or twin assigners), T3-C (176 one-consumer edges),
  T3-D (the 131-name 2–5 band → NBD-prefixed singletons), T3-E (docs).

Census re-run this session reproduces the plan's table exactly — 827 total,
bands 454 / 176 / 131 / 66, 1 bracket-dispatch name — with one correction:
`withHtmlHits` is **231**, not 233. Corrected in the plan.

## Docs corrected in place

Per the standing vault rule, the four docs carrying the dead
`maps.js:464-468` reference and the "blocked" status were fixed rather than
appended to:

- [globals-tranche3-plan](../../docs/dev/globals-tranche3-plan.md) — dated
  update section at the top; T3-0 slice marked shipped
- [dashboard-actions-globals-audit](../../docs/dev/dashboard-actions-globals-audit.md)
  — the "key finding" paragraph and the Residual row
- [globals-decomposition-HANDOFF](../../docs/dev/globals-decomposition-HANDOFF.md)
  — status blockquote + the `dashboard-actions.js` row
- [dashboard-decomposition-plan](../../docs/dev/dashboard-decomposition-plan.md)
  — the 2c-4+ tracker row

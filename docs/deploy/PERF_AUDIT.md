# NBD Pro — Perf Audit Findings (2026-04-23)

Static audit of the CRM surface. No Lighthouse run (requires local server + headless chrome); these are the findings I can verify from the source tree.

## Highlights

| Area | Status | Action |
|------|--------|--------|
| Lazy-load architecture | ✅ Good | ScriptLoader already covers academy, training, storm, close-board, rep-os, decision-engine, reports, warranty — the right 8 bundles. |
| `loading="lazy"` coverage | ✅ Good | 77 anchor points across `/docs`. Added 2 missing ones on `customer.html` photo grids. |
| dashboard.html size | ⚠️ 814 KB raw | Biggest single asset. Largely inline CSS + HTML — real fix is V3's component split. |
| Oversized images | 🔴 10.8 MB single PNG | `docs/assets/roofivent/ivent-roto.png` is 10.8 MB. Lazy-loaded so not blocking render, but costs mobile users data. |
| Regression guard | ✅ Added | `tests/smoke.test.js` now fails CI if a new image > 1 MB lands outside the whitelist. |

## Top JS bundles (still eager on dashboard.html)

Could move to `ScriptLoader` bundles in a future pass — each needs per-view testing before the move:

| File | Size | Views that actually need it |
|------|------|-----------------------------|
| `product-data.js` | 111 KB | Estimates |
| `document-generator-templates.js` | 105 KB | Docs |
| `estimate-catalog-xactimate.js` | 96 KB | Estimates |
| `template-suite.js` | 82 KB | Templates |
| `estimate-v2-ui.js` | 81 KB | Estimates v2 |
| `document-generator.js` | 76 KB | Docs |
| `photo-editor.js` | 76 KB | Photo editing (rare) |
| `theme-engine.js` | 117 KB | Every view (theming is persistent — harder to defer) |

Combined lazy-movable: **~625 KB**. Worth doing once the V3 migration is done so we don't invest in code that's being replaced.

## Image compression queue

Drop into a `sharp` or `cwebp` script when someone takes a dedicated perf pass:

1. `docs/assets/roofivent/ivent-roto.png` — 10.8 MB → target 150 KB WebP (~98% reduction)
2. `docs/assets/roofivent/ivent-eco.png` — 1.3 MB → target 80 KB WebP
3. `docs/assets/roofivent/ivent-pipe-flashing.png` — 334 KB → target 50 KB WebP
4. `docs/assets/images/drone-*.jpg` — 320–552 KB each → target 80–120 KB WebP
5. `docs/assets/images/roofing-1..4.jpg` — 320–395 KB each → target 80–100 KB WebP

All of these are already `loading="lazy"` with explicit dimensions so the critical path isn't blocked — compression just saves mobile users data + improves LCP on their second+ page view.

## What's *not* measurable from static audit

Would need a headless Lighthouse run (or Sentry Browser Performance) for:

- LCP / INP / CLS real numbers
- Third-party script cost (Stripe, reCAPTCHA, Cal.com, GA4)
- Font loading blocking (Barlow Condensed is used heavily; is it FOUT or FOIT?)
- Long tasks during initial render of dashboard.html

**Suggested next step:** add a Lighthouse CI job that runs against the live URL post-deploy and tracks the metrics over time. Out of scope for this audit pass.

---

# Measured baseline + remediation log (2026-06-06)

Re-grounded the audit with real numbers and began the lazy-load remediation
ladder. This section supersedes the 2026-04-23 estimates where they conflict.

## Method

- **Static analysis** of `docs/pro/dashboard.html` + the eager `<script src>`
  graph (PowerShell byte sums of the resolved files).
- **Live asset waterfall** via the Firebase **hosting emulator on a demo
  project** — `firebase emulators:start --only hosting --project demo-nbd`
  (Rule-0 safe; production project never touched) — captured with `curl.exe`
  conditional requests.
- **Firestore read count** derived from the boot code path
  (`docs/pro/js/dashboard-bootstrap.module.js`), not a live authenticated run.
- **Caveat:** the hosting emulator (superstatic) does **not** apply
  `firebase.json`'s `headers` block — `Cache-Control` comes back empty and
  `If-None-Match` returns `200`, not `304`. So JS/CSS cache behavior was read
  from **live prod headers** instead (see the baseline row + correction below).
  Authenticated INP/LCP/long-tasks still require the full emulator + seed +
  login stand-up.

## Baseline (dashboard, pre-remediation)

| Metric | Value |
|---|---|
| `/pro/dashboard` HTML | 740 KB raw / 151 KB gzip; route is `no-store` (re-sent every load) |
| `<script src>` tags | 151 (144 local + 7 CDN) |
| Eager JS/CSS over the wire | ~4.09 MB decoded / ~1.13 MB compressed (147 requests) |
| Inline `<style>` in the HTML | ~340 KB (uncacheable on the `no-store` route) |
| JS/CSS cache (live-measured 2026-06-06) | `public, max-age=300` — **not** the `max-age=0, must-revalidate` that `firebase.json` sets for `**/*.@(js\|css)`. The later `**` rule overrides it (last-match-wins, confirmed on prod). So there is **no** per-load 304 tax today; files cache for 5 min. The original "kill the revalidation tax" item (#1) is really 5 min → 1 yr `immutable`, and the `**/*.@(js\|css)` rule must be moved **after** `**` in `firebase.json` to win. |
| Dashboard Firestore reads (cold) | ~7–9 (leads pages + photos + estimates + pins + subscription + user) |
| Lead-list render | one DOM node per card, no windowing (`crm-pipeline.js`) |

## Corrections to the 2026-04-23 findings (the repo wins)

- **Oversized images — DONE.** `ivent-roto.png` is now **109 KB** (was
  10.8 MB) and `ivent-eco.png` is **81 KB** (was 1.3 MB); the whole
  compression queue ran. Largest remaining image is a 553 KB JPEG; total
  `docs/assets` is 7.3 MB. The "98% / 10.8 MB" win no longer exists.
- **Fonts — already FOUT.** Barlow + Barlow Condensed load with
  `display=swap` (FOUT, not FOIT), `preconnect` present, and 14 theme fonts
  deferred via the media-swap trick. Font work is a minor residual, not a
  headline.

## Remediation ladder (defer view-only JS into ScriptLoader)

Ordered smallest-blast-radius first. Each rung = one reviewable, revertable
change, smoke-green + emulator-verified.

| PR | Slice | Eager bytes removed | Status |
|---|---|---|---|
| **2a** | ApexCharts → `reports` bundle | ~524 KB raw / 137 KB gz | **shipped** (`perf/2a-apexcharts-defer`) |
| **2b** | doc-gen cluster (4 modules) | ~419 KB | **shipped** |
| **2b2** | jsPDF + html2pdf (doc-viewer PDF export) | ~1.1 MB | **shipped** |
| 2b3 | customer.html doc-gen parity (load-then-run) | ~419 KB on that page | planned (review-flagged) |
| **2c** | estimate engine (12 modules) | ~530 KB | **shipped** (harness-verified) |
| **2d** | photo + inspection cluster (3 modules) | ~200 KB | **shipped** |
| **2e** | D2D tracker (3 modules) | ~180 KB | **shipped** (runtime-verified) |
| 2e-maps | maps engine (core/overlays/routing/maps.js) | ~300 KB | **blocked** — `maps.js` is also the theme engine (needs untangling) |

**Cumulative shipped (2a + 2b + 2b2 + 2c + 2d + 2e): ~2.95 MB decoded off
every dashboard load; dashboard `<script src>` 151 → 126.**

### PR 2a — ApexCharts → lazy `reports` bundle

Moved `apexcharts@3.54.0` from an eager `<script defer>` in `dashboard.html`
into the `reports` ScriptLoader bundle, ahead of `rep-report-generator.js`
(the only dashboard consumer of the `ApexCharts` global; `loadBundle()` runs
entries sequentially, so the global is defined before the generator runs).

- **Before:** ApexCharts downloaded + executed on **every** dashboard load.
- **After:** loads only when the Rep Report view opens (`goTo('reports')` →
  `ScriptLoader.preloadForView('reports')`).
- **Delta (measured):** −524 KB raw / −137 KB gzipped per dashboard load;
  dashboard `<script src>` 151 → 150; zero `apexcharts` refs in the served
  HTML.
- **Files:** `docs/pro/js/script-loader.js`, `docs/pro/dashboard.html`,
  `tests/smoke/dashboard.test.js` (added 2 regression guards: ApexCharts is
  not eager in `dashboard.html` and *is* in the `reports` bundle).
- **Verification:** smoke suite **1704 passed / 0 failed**; 4-lens adversarial
  review (reachability / CSP+load-order / degradation / completeness) → all
  clear. Degradation is strictly *better* than before — a CDN failure now
  shows a graceful "chart library loading" fallback instead of needing a
  refresh. Not runtime-verified in a live authenticated reports view (needs
  the seed + login stand-up); covered instead by the load-order proof, the
  `typeof ApexCharts === 'undefined'` guards, and the adversarial review.
- **Rollback:** `git revert` of the three files. The `?legacy=1` snapshot
  (`dashboard.legacy.html`) is intentionally left at its pre-2a state.

### PR 2b — doc-generation cluster → lazy `docgen` bundle

Moved 4 modules (`nbd-logo-asset`, `document-generator`,
`document-generator-templates`, `doc-preflight`) from eager `<script defer>`
in `dashboard.html` into a lazy `docgen` ScriptLoader bundle.
`company-profile.js` and `nbd-doc-viewer.js` stay eager (the latter is the
shared doc renderer; the former supplies `data.companyProfile` at generate
time).

- **Triggers wired load-then-run** (so a click before the bundle loads still
  works on slow LTE in the field): the lead-card doc chips
  (`_generateDocWithPreflight` in `dashboard-bootstrap.module.js`) and the two
  Docs-view triggers (the `data-action="docgen"` delegate + the injected
  "Blank" buttons in `dashboard-ui.js`). The `docs`/`documents` views also
  preload the bundle.
- **Delta (measured):** −419 KB decoded per dashboard load; dashboard
  `<script src>` 150 → 146. Cumulative with 2a: ~943 KB off the boot path.
- **Files:** `docs/pro/js/script-loader.js`, `docs/pro/dashboard.html`,
  `docs/pro/js/dashboard-bootstrap.module.js`, `docs/pro/js/dashboard-ui.js`,
  `tests/smoke/dashboard.test.js` (+9 regression guards).
- **Verification:** smoke **1713 passed / 0 failed**; 4-lens adversarial review
  (coverage / load-order / wrapper-correctness / completeness) → all pass.
  Coverage found no uncovered dashboard trigger; load order confirmed
  (`document-generator-templates.js` reads `window.NBDDocGen` at load, and
  `document-generator.js` precedes it in the bundle); degradation is
  equal-or-better (graceful "still loading" toast on the rare race). Not
  runtime-verified in a live authenticated Docs view (needs seed + login).
- **Out of scope / follow-ups:** `customer.html` keeps its own eager copies
  (separate page, on its own module versions — review flagged a parity PR,
  2b3). `jsPDF`/`html2pdf` stay eager (the doc-viewer PDF export is a different
  trigger surface — 2b2).
- **Rollback:** `git revert` of the five code/test files.

### PR 2c — estimate engine → lazy `estimates` bundle

The revenue-critical estimate builder + its product/catalog data. Deferred 12
modules (`product-data`, `roofivent-catalog`, `product-library`,
`estimate-labor-catalog`, `estimate-builder-v2`, `estimate-catalog-xactimate`,
`estimate-logic-engine`, `estimates`, `estimate-finalization`,
`estimate-v2-ui`, `estimate-supplement`, `supplement-ui`) into a lazy
`estimates` ScriptLoader bundle. `estimate-config` (prerequisite),
`review-engine` (boot-called), and `property-intel` stay eager. Full
14-module trace + the bundle/load-order rationale are in
[ESTIMATE_DEFER_PLAN.md](ESTIMATE_DEFER_PLAN.md).

- **Self-loading stubs** (transparent to all call sites): `startNewEstimate` +
  `openEstimateV2Builder` (`dashboard-actions.js`) load-then-run the bundle and
  re-dispatch; the `est`/`products` views preload it; the Settings →
  Estimate-defaults tab (`ui.js`) loads it before reading config/counts.
- **Delta (measured):** −~530 KB decoded per dashboard load; dashboard
  `<script src>` 146 → 134. Cumulative 2a+2b+2c: ~1.47 MB off the boot path.
- **Files:** `script-loader.js`, `dashboard.html`, `dashboard-actions.js`,
  `ui.js`, `tests/smoke/dashboard.test.js` (+ the e2e harness/spec).
- **Verification (the strong part):** the **login+seed Playwright harness**
  (`tests/e2e/estimate-engine.spec.js`) proves the engine assembles
  **identically** after deferral — 222 products / 298 merged catalog keys
  (the xactimate→builder merge ran) / 270 xactimate / rates 545·595·660 — and
  the V2 builder modal opens via the lazy stub. Smoke **1728/0** (+15 guards,
  incl. a builder-v2-before-xactimate order check).
- **Out of scope:** `customer.html` keeps its own eager estimate copies
  (separate page). `property-intel` left eager (distinct feature).
- **Rollback:** `git revert` of the code/test files.

### PR 2d — photo + inspection engine → lazy `photos` bundle

Deferred 3 leaf modules (`photo-engine`, `inspection-report-engine`,
`photo-report`) into a lazy `photos` ScriptLoader bundle. `photo-ai.js` and
the rest stay eager.

- **Self-loading object stubs** (dashboard-actions.js): at boot, install stub
  `window.PhotoEngine` (method-stubs for openCamera/openGallery/uploadOne/
  uploadFromFile/renderGallery/openLightbox), `window.InspectionReportEngine`
  (openBuilder), and `window.generatePhotoReport`. Each entry method
  load-then-runs the bundle and re-dispatches to the real global (which the 3
  modules overwrite unconditionally on load); downstream methods
  (`_openLightbox`, `_bulkAnalyze`, …) only fire after an entry opened the
  bundle, and are guarded. On load failure each stub shows a "still loading"
  toast instead of a silent no-op. The `photos` view also preloads the bundle.
- **Delta (measured):** −~200 KB decoded per dashboard load; dashboard
  `<script src>` 134 → 131. Cumulative 2a–2d: ~1.67 MB off boot.
- **Files:** `script-loader.js`, `dashboard.html`, `dashboard-actions.js`,
  `tests/smoke/dashboard.test.js`.
- **Verification:** smoke **1735/0** (+7 guards); 4-lens adversarial review all
  pass (coverage / stub mechanics / load-independence / completeness).
- **Out of scope:** `customer.html` keeps its own eager photo copies.
- **Rollback:** `git revert` of the code/test files.

### PR 2e — D2D tracker → lazy `d2d` bundle (maps engine deferred to a follow-up)

Deferred the 3 D2D-tracker modules (`d2d-tracker-core/ui/2026b`, ~180 KB) into
a lazy `d2d` bundle. No new stubs needed: `goTo('d2d')` preloads the bundle
(VIEW_BUNDLES.d2d) and the existing `waitForD2D()` poller catches `window.D2D`
when it lands; the one other consumer (`crm-pipeline.js`) is guarded.

- **Delta (measured):** −~180 KB decoded per dashboard load; dashboard
  `<script src>` 131 → 128. Cumulative 2a–2e: ~1.85 MB off boot.
- **Verification:** smoke **1743/0** (+8 guards, incl. a "maps.js stays eager"
  guard); **runtime-proven** by `tests/e2e/d2d-engine.spec.js` (`window.D2D`
  is `undefined` at boot, becomes a real object after opening the D2D view);
  4-lens adversarial review.
- **The maps engine stays eager (2e-maps, blocked):** `maps.js` is not just a
  map shim — its `nbdBoot()` ([maps.js:444](../pro/js/maps.js)) **applies the
  saved theme + font at page load**, and it powers the Settings theme picker
  (`window.toggleThemeMenu = nbdPickerOpen`). The 4 map modules also share
  global scope (sibling pattern), so they can't be split. Deferring them would
  defer app-wide theming. **Follow-up:** untangle the theme/font appearance
  engine out of `maps.js` into its own eager module (or prove `theme-engine.js`
  makes `nbdBoot` redundant), then the map engine (~300 KB) can defer behind the
  map/draw views via the existing `waitForMapFn()`. Leaflet itself stays eager
  too (home dashboard widgets render raw Leaflet maps).
- **Rollback:** `git revert` of the code/test files.

### PR 2b2 — jsPDF + html2pdf → lazy `pdfexport` bundle

The two PDF-export CDN libs were eager `<script defer>` (html2pdf alone is
~800 KB; jsPDF ~350 KB) despite a comment claiming they were "loaded on
demand." The **only** dashboard consumer is the doc-viewer's Download-PDF
handler (`nbd-doc-viewer.js` `handlePdf`, already `async`), so they move into a
lazy `pdfexport` bundle that `handlePdf` `await`s on first export. (Standalone
jsPDF turned out to be **unused on the dashboard** — only `customer.html`
instantiates `jsPDF` — but it's kept in the bundle for safety.)

- **Delta (measured):** −~1.1 MB decoded off the boot path — the single
  biggest rung; dashboard `<script src>` 128 → 126. Cumulative 2a–2e + 2b2:
  ~2.95 MB off boot.
- **Files:** `script-loader.js`, `dashboard.html`, `nbd-doc-viewer.js`,
  `tests/smoke/dashboard.test.js`. Smoke **1747/0** (+4 guards).
- **Also (cleanup):** guarded the 4 pre-existing unguarded `window.D2D` button
  refs in `d2d-tracker-core-2026b.js` (surfaced by the 2e review; safe but the
  only unguarded refs in the file) and bumped that module to `?v=4` in the
  `d2d` bundle.
- **Rollback:** `git revert` of the code/test files.

## Still open (documented follow-ups)

- **2e-maps** (~300 KB) — blocked on untangling the theme/font engine out of
  `maps.js` (see PR 2e above).
- **2b3** — defer `customer.html`'s own eager doc-gen + PDF libs. Bigger than a
  cleanup: `customer.html` does **not** load `script-loader.js` today, so it
  needs the ScriptLoader infra added before its doc-gen/PDF can defer.

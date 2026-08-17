# System stability / performance / accuracy / ease-of-use audit — 2026-08-07

One-branch power session (`claude/system-stability-performance-muhs1l`, single
PR, 16 commits). Three parallel recon passes (gates/CI, CRM + functions,
marketing surface) followed by a dependency-ordered fix wave. This note is the
durable record: what was found, what shipped, what the recon got wrong, and
what stayed parked.

> **2026-08-17 correction:** the nbd-icons.css extraction below shipped a
> visual regression — the end-of-head `<link>` out-cascades the per-page
> "trust-icon fix" blocks, turning the homepage `.cm-icon`/`.wc-phone-icon`
> icons orange-on-orange (invisible). Root cause + fix:
> [ICON-CASCADE-REGRESSION-2026-08-17](ICON-CASCADE-REGRESSION-2026-08-17.md).

## Headline findings → fixes (all shipped this PR)

| Finding | Fix |
|---|---|
| **Daily CI time-bomb**: `build-projects.mjs` baked today's date into generated output that its own `--check` gate diffs — CI went red at every UTC midnight on untouched code | Stamp derives from the newest `published` value in projects.json; date-independent forever |
| **36 orphaned test suites** (incl. every money/pricing suite — `estimate-pricing` is BIG_ROCKS' "canonical reference" for Rock 2) never ran in CI; `tests/package.json`'s npm-test aggregate is invoked nowhere | `tests/ci-manifest.json` single registry + `scripts/run-test-manifest.js` with a completeness tripwire (unclassified suite ⇒ CI fails); 32 node suites in a new job, 4 emulator suites wired; all verified green first, quarantine bucket ships empty |
| **maps.js unguarded cross-file re-exports**: 14 bare identifiers from 5 sibling files; any sibling load failure threw at top level and killed `nbdBoot()` — the theme/font engine — silently | Every re-export typeof-guarded + block fenced in try/catch; `nbdBoot` can no longer be starved |
| **damagNearMe 4-way duplicate**: the winning alias shadowed the only implementation with per-PositionError messaging | Single owner in maps-overlays.js, registry-registered; three aliases deleted; allowlist entry dropped per Tranche 2c-2 rule; smoke battery re-pinned. Closes 2026-08-06 deferred item 5's shim-blocked half |
| **V2 estimate engine (the default) did float money math** while the *deprecated* engine had cents discipline; un-rounded tax/subtotal/deposit floats were persisted and read by portal/invoice/Stripe | Both paths now integer-cents internally, exact 2-dp dollars at the return boundary; stored schema stays dollar-denominated (compat). All 17 money suites pass with **zero expectation changes**; new D-6 parity fixtures fail 13 assertions against the old engine |
| **Turnstile fail-closed landmine**: empty sitekey ships on all 4 lead-form pages while the server 403s every tokenless submission the moment `TURNSTILE_SECRET` (or `TURNSTILE_REQUIRED=true`) is set | `tests/turnstile-contract.test.js` pins every half-wired state; client attaches the token only when obtained; deployment-order warning lives in the sitekey stub itself. **Jo's sequence: populate sitekey → deploy → THEN set secret** |
| **CRM boot weight**: theme-engine (162 KB) + 4 companions and Leaflet (~225 KB) eager on every dashboard open | Lazy `theme` + `mapvendor` bundles (~390 KB off boot); saved-theme users get an early kick + deterministic init (replaces the 500 ms setTimeout lottery); map-drawing home widgets load-then-run |
| **functions cold start**: index.js pulls every module, so all 170 functions parsed the stripe (20 MB) + twilio (21 MB) SDKs | Lazy requires inside the existing memoized getters; index.js untouched (export discovery is sacred); 188 exports before/after; full require 884 → 695 ms |
| **Anthropic calls unbounded**: 4 fetches with no AbortSignal on minInstances services | `AbortSignal.timeout` sized under each `timeoutSeconds` + timeout-vs-crash distinguished (504) |
| **No process-level rejection handler** in functions | `unhandledRejection` → structured log + Sentry (no `uncaughtException` on purpose — crash-and-replace is safer) |
| **Homepage form**: `alert()` validation; 5 fields starred, 2 enforced | Inline `role=alert` + `aria-invalid` + focus management; first name + phone enforced and starred, rest visibly optional (Jo-approved policy) |
| **~200 KB duplicated icon CSS** stamped into 197 pages (12,078 identical lines) inside `max-age=300` HTML | Shared `docs/assets/css/nbd-icons.css`; `ensure-icon-css.js` became the assert-mode linker (CI-wired); swap-emojis.js updated to match |
| GA `async` script was the FIRST head resource on the homepage, beating the LCP hero preload to bandwidth | Moved below viewport/title/preloads |
| Blog structured-data defects: `mainEntityOfPage` pointing at a different article; 4 posts with byline ≠ JSON-LD ≠ POSTS dates | Self-URL fixed; dates aligned to the reader-visible byline everywhere (all 4 files were created 2026-07-29 — every date is editorial, so internal consistency is the fix); blog index restamped |
| Mobile nav had no Escape path; carousel thumbs were click-only divs; lightbox had no focus trap; 404 was a dead end | All fixed (nav partial JS reaches 147+ pages; thumbs are real buttons with labels; counter is aria-live; 404 recovery row 3 → 7 links) |
| Deferred items 1 + 3 from 2026-08-06 | Closed (see the corrections stamped into that handoff) |

## Recon corrections (what the fan-out got wrong — recorded so it isn't re-learned)

- **"27 render-blocking scripts" on dashboard.html was wrong.** 10 of the
  candidates sit inside `<template>` elements and only execute at view
  hydration via the `_hydrateViewTemplate` clone-script swap — they were never
  parse-blocking. The genuinely blocking 18 are boot-critical config/preboot
  files. The planned "defer demotions" were unnecessary; the real wins were
  the two lazy bundles.
- **"206 images missing `loading=lazy`" was ~free of real cases.** 184 are
  above-fold nav logos inside generator-owned partial regions (must NOT be
  lazied or hand-edited), 17 are logo/fetchpriority tags, and the rest are
  JS-driven `data:,`-src placeholders where the attribute is inert.
- **The hail-footer "46 lines adrift" was one line** (diffLines offset
  artifact) — see the correction in NEXT_SESSION-2026-08-06.
- **puppeteer/sharp/esign-stripe were already lazy** — the functions
  cold-start problem was narrower (stripe/twilio) than the recon implied.

## Verification record

- Full gate battery green at every commit; closeout run green (syntax,
  site-integrity, partials 549 regions, sitemap zero-WARN zero-diff,
  build-projects, inline-scripts, polish contract 46, smoke 3,278).
- Money battery (17 suites) green against the cents engine with zero
  expectation edits; D-6 drift fixtures proven to fail on the float engine.
- Emulator suites green post-change: public-intake 41, portal-token 8,
  lead-bridge 20, rate-limit, auth-access 25, lead-lifecycle 14.
- Brand-tokens 9/9; marketing e2e 5/5 local.
- **Sandbox limits (CI is the arbiter):** the authed `@audit` shard fails at
  LOGIN in this container — proven pre-existing by an identical failure at
  the pre-change baseline commit (mismatched local Chromium + TLS-proxy
  environment); two pro-public tests fail only on the sandbox's
  cert-intercepting proxy. Neither is a product regression signal.

## CI cost note

Three new runners per push (unit-manifest is seconds; emulator-orphans ~4 min;
public-e2e ~5 min; brand-tokens ~4 min; visual-regression ~6 min; @engines
rides the existing matrix as a 6th leg). All new e2e/visual jobs are
**advisory** with the repo's documented promotion bar.

## Parked (deliberate, with reasons)

- **Classic-wizard deletion + dashboard.legacy.html** — still gated on Jo's
  prod deprecation-log check + the pre-V2 stored-doc decision. New input from
  this session: the legacy page is 562 diff-lines adrift while riding the
  LIVE js/ directory, so the wizard deletion silently breaks `?legacy=1`
  unless the snapshot is refreshed or retired first.
- **Firestore offline persistence** (CRM has no offline READ path) — needs a
  deliberate PII-in-IndexedDB decision + sign-out cache clearing; design
  brief in the handoff.
- **rate-limit-policy.js adopt-vs-delete** — zero consumers today; vestigial
  keys fixed this session; wiring `guardCallable` into live handlers was
  deliberately NOT stacked on top of the cold-start changes. Pilot
  candidates if adopted: `claudeProxy`, `submitPublicLead`,
  `validateAccessCode`.
- **404 full chrome conversion** — needs a bespoke-CSS design pass (the page
  is a self-contained centered card; dropping partials in requires nav core
  CSS + body-layout restructure that no gate can verify).
- **.crm-header split, functions-emulator widening to all shards, cspReport
  sink read (STEP 0 of the CSP generated-docs audit), the broader 2.96 MB
  inline-CSS dedup** — unchanged from prior sessions.
- **screenshot-demo.spec.js** — stays unwired on purpose (manual eyeball
  tool, zero assertions, external network).

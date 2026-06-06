# Estimate-engine lazy-deferral plan (PR 2c) + verification harness

The estimate engine is the **revenue-critical** core (how every job is quoted),
so unlike the clean leaf-defers (2a ApexCharts, 2b doc-gen) it gets a full
14-module dependency trace **and** a real login+seed Playwright harness that
proves the engine assembles identically before/after deferral.

## Verification harness (Rule-0 safe, fully local)

```bash
# 1. Emulators (auth + firestore + hosting; NO functions → no prod-secret ADC pull).
#    --only is QUOTED so PowerShell doesn't split the comma list into separate args.
firebase emulators:start --only "auth,firestore,hosting" --project nobigdeal-pro

# 2. Seed a tenancy-correct demo tenant into the emulator (5 users, company,
#    active subscription, leads, estimates). Needs the emulator host env vars set
#    (the script refuses to run otherwise — Rule-0 guard).
#    PowerShell: $env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'; $env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'; $env:GCLOUD_PROJECT='nobigdeal-pro'
node scripts/seed-emulator.js
#    → login: companyadmin@demo.test / Test123!  (company_admin, active sub)

# 3. The estimate-engine integrity spec (login → open builder → snapshot).
cd tests
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 \
PLAYWRIGHT_TEST_USER_EMAIL=companyadmin@demo.test \
PLAYWRIGHT_TEST_USER_PASSWORD=Test123! \
npx playwright test estimate-engine.spec.js
```

The client auto-wires to the emulators on localhost via
`docs/pro/js/nbd-emulator-connect.js` (hard no-op in prod). The hosting
emulator's `cleanUrls` serves `/pro/dashboard` (no `.html`) and the dashboard
lands on the **home** view — the harness login waits on a view-agnostic
hydration signal (`window.goTo` + an authed user), not the kanban.

### Baseline (engine eager, captured 2026-06-06)

```json
{ "products": 222, "catalogKeys": 298, "xactCount": 270,
  "tierRates": { "good": 545, "better": 595, "best": 660 } }
```

Pass it back as `ESTIMATE_BASELINE='{...}'` on the post-2c run; the spec then
asserts product count, merged catalog size, xactimate count, tier rates, and
config are byte-identical. **298 catalog keys = the xactimate→builder merge
worked** (base ~28 + 270 xactimate). If the lazy load order regresses, this
number drops and the test fails.

## Dependency trace verdict (15-agent sweep)

**Keep eager (hard):**
- `estimate-config.js` (4 KB) — `NBD_ESTIMATE_CONFIG`, read at load by estimates.js + estimate-builder-v2.js.
- `review-engine.js` (12 KB) — `ReviewEngine.checkAutoReviews()` runs ~3 s after boot.

**One load-time merge chain (forces order):** `estimate-catalog-xactimate`
merges 250+ items into `EstimateBuilderV2.CATALOG` at load → builder-v2 MUST
precede xactimate in the bundle.

**`window.R` is NOT a display dependency:** the estimate list view renders via
`viewEstimate` in `dashboard-widgets.js` (eager), which doesn't read
`window.R`. `window.R` is only the classic-builder rate table; the default V2
flow uses `EstimateBuilderV2`. `estimates.js`'s load-time rate sync reads
`window._productLib` (from `product-library.js`), so product-library must
precede estimates.js in the bundle.

## Recommended bundle + order (`estimates` ScriptLoader bundle)

Sequential load order (justified by the at-load edges above):
1. `product-data.js` — `NBD_PRODUCTS/CATEGORIES/UNITS` (read at load by 2 & 3)
2. `roofivent-catalog.js` — merges into `NBD_PRODUCTS` (after product-data)
3. `product-library.js` — reads `NBD_*` at load; defines `_productLib`
4. `estimate-labor-catalog.js` — `NBD_LABOR` (independent)
5. `estimate-builder-v2.js` — `EstimateBuilderV2` (before xactimate)
6. `estimate-catalog-xactimate.js` — merges into `EstimateBuilderV2.CATALOG`
7. `estimate-logic-engine.js` — `EstimateLogic`
8. `estimates.js` — `window.R`, `startNewEstimate` (after product-library)
9. `estimate-finalization.js` — `EstimateFinalization`
10. `estimate-v2-ui.js` — `EstimateV2UI`, `openEstimateV2Builder` (last)
11. `estimate-supplement.js` + 12. `supplement-ui.js` — customer.html supplement (no-op on dashboard)

`property-intel.js` stays eager for now (distinct parcel-lookup feature; reads
`window.R` lazily with a safe fallback).

**Self-loading stubs / preloads needed** (transparent to all call sites):
- `window.startNewEstimate` — replace the stub at `dashboard-actions.js:739` with load-then-run (covers all 4 New-Estimate call sites).
- `window.openEstimateV2Builder` — add a load-then-run stub (covers maps-routing, shortcuts).
- `VIEW_BUNDLES['est'] += 'estimates'` — preload on the estimates view.
- Settings **Products** tab (`renderProductLibrary`) and **Estimate-defaults** tab (`_loadEstimateDefaultsV2`, reads `NBD_PRODUCTS`/`NBD_XACT_CATALOG`) — load-then-run.

Expected boot-path saving: **~530 KB** (the 12 modules) decoded.

## Residual risks to runtime-verify (via the harness)

1. Engine assembles identically — the integrity snapshot (above).
2. Open builder from a lead-card doc chip / shortcut before the bundle loads — load-then-run stub fires.
3. Settings → Products and Settings → Estimate-defaults render correct counts after the lazy load.
4. customer.html supplement flow unaffected (it loads its own eager copies).

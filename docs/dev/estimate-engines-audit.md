# Estimate Engines Audit — 2026-04-25

**Status:** Phase 1 of BIG_ROCKS Rock 2. Pure investigation, no code changes.

## TL;DR

Deleting `estimates.js` tomorrow breaks the classic 4-step estimate builder
that's still wired to multiple dashboard buttons + `close-board.js`. The
modern V2 stack (`estimate-builder-v2.js` + `estimate-v2-ui.js` +
`estimate-logic-engine.js`) is feature-overlapping but not a drop-in
replacement — it lacks add-on pricing, deposit calculation, and the classic
4-step wizard UI.

The three engines coexist without runtime collision (no shared mutable
state), but they each carry independent copies of the same business config:
**TIER_RATES, COUNTY_TAX, PERMIT_COSTS, JOB_MINIMUM, and waste-factor
tables.** Drift between those copies is the real risk, not the engines
themselves.

The migration path is to (1) unify the config tables behind a single source,
(2) port classic-only logic (add-ons + deposit) into V2, then (3) replace
the classic UI entry points and retire `estimates.js`. Five PRs, one per
phase.

---

## Engine 1: `docs/pro/js/estimates.js` (1,292 lines)

### Public surface (window-attached)

| Function | Purpose |
|---|---|
| `startNewEstimate()` | Init V2 wizard via classic UI shell |
| `startNewEstimateOriginal()` | Launch classic 4-step builder |
| `cancelEstimate()` | Tear down estimate form |
| `showEstStep(n)` | Route to steps 1–4 (measurements, roof type, tier, review) |
| `estNext(from)` / `estBack(from)` | Step navigation |
| `updateEstCalc()` | Recalc on DOM measurement input |
| `calcTierPrices()` | Compute Good/Better/Best |
| `selectTier(tier, el)` | Tier card click handler |
| `exportEstimate()` | Export to PDF via `estimate-finalization.js` |
| `buildReview()` | Render final review step |
| `getLineItems()` | Itemized cost breakdown (Internal View) |
| `syncRatesFromProductLibrary(tier)` | Sync rates from `NBD_PRODUCTS` catalog |
| `getProductName(mapKey, fallback)` | Product display-name lookup |
| `showEstimateTypeSelector()` | UI selector for classic vs V2 flow |
| `saveEstimate()` | Persist to Firestore |
| `duplicateEstimateAction()` | CRM op |
| `renameEstimateAction()` | CRM op |
| `assignEstimateAction()` | CRM op |
| `deleteEstimateAction()` | CRM op |

### Call sites

| Function | Caller | File:line | Purpose |
|---|---|---|---|
| `updateEstCalc()` | `oninput` on 6 measurement fields | dashboard.html:8132–8187 | Live recalc |
| `updateEstCalc()` | `startNewEstimate()` init | estimates.js:157 | Wizard launch |
| `updateEstCalc()` | `estNext(1)` / `estNext(2)` | estimates.js:184, 189 | Step transition |
| `updateEstCalc()` | `showEstStep(4)` review | dashboard.html:11904 | Init review |
| `updateEstCalc()` | `selectAddOn()` | estimates.js:648 | Add-on toggle |
| `updateEstCalc()` | `maps.js` polygon handler | maps.js:1750 | Recalc on shape draw |
| `updateEstCalc()` | `tools.js` form input | tools.js:268 | Recalc from external tool |
| `calcTierPrices()` | `estNext(2)` | estimates.js:189 | Compute tiers |
| `buildReview()` | `estNext(3)` | estimates.js:193 | Render review |
| `buildReview()` | `setDepositOverride()` | estimates.js:583 | Refresh totals |
| `buildReview()` | `toggleInternalView()` | estimates.js:1287 | Toggle internal view |
| `buildReview()` | `createEstimateRevision()` | estimates.js:1287 | After version bump |
| `getLineItems()` | `buildReview()` | estimates.js:450 | Line table |
| `getLineItems()` | `close-board.js` | close-board.js:220 | Deal mini-UI (defensive `typeof` guard) |
| `selectTier()` | Tier-card `onclick` | dashboard.html:8309–8321 | Tier select |
| `selectTier()` | `close-board.js` inline handler | close-board.js:334, 340 | Deal tier choice |
| `exportEstimate()` | Export-button `onclick` | dashboard.html:8341, 8350 | PDF export |
| `startNewEstimate()` | New Estimate buttons | dashboard.html:773, 847, 7552, 7564 | Launch V2 wizard |
| `startNewEstimateOriginal()` | "+ Classic" button | dashboard.html:772, 8084 | Launch classic |
| `cancelEstimate()` | Cancel button | dashboard.html:8106 | Close form |
| `estNext(1..3)` / `estBack(2..4)` | Wizard buttons | dashboard.html:8140, 8298–8348 | Step nav |
| `syncRatesFromProductLibrary()` | `startNewEstimate()` | estimates.js:132 | Init sync |
| `syncRatesFromProductLibrary()` | `calcTierPrices()` | estimates.js:309 | Sync before tier calc |
| `syncRatesFromProductLibrary()` | `buildReview()` | estimates.js:383, 417 | Sync before review |
| `syncRatesFromProductLibrary()` | `getInternalCostBasis()` | estimates.js:417 | Sync for internal view |
| `saveEstimate()` | Save button / autosave | dashboard.html:11922 | Persist |
| `calcEstimateTotalCents()` | `calcTierPrices()` | estimates.js:329–331 | Core pricing math (3 tiers) |

### Status: **LIVE** with heavy DOM coupling

`<script src="js/estimates.js">` referenced at dashboard.html:14735.
Module exports defensively at lines 1193–1212 with three fallback guards
in dashboard.html:13907–13914. Cannot be deleted without losing the
classic builder.

---

## Engine 2: `docs/pro/js/estimate-builder-v2.js` (953 lines)

### Public surface (`window.EstimateBuilderV2`)

| Member | Purpose |
|---|---|
| `calculateEstimate(input)` | Compute one tier |
| `calculateAllTiers(input)` | Good/Better/Best from one input |
| `calculatePerSq(input)` | Per-SQ formula wrapper |
| `calculateLineItem(item, measurements, opts)` | Line-item resolver (called internally by `calculateEstimate` at line 797) |
| `generateLineItemsFromMeasurements(measurements)` | Auto-generate catalog scope |
| `loadSettings()` / `saveSettings()` / `updateSettings()` / `getDefaultSettings()` | Settings I/O (localStorage) |
| `CATALOG` | Xactimate-style material/labor table |
| `wasteFactorForPitch(pitch)` | Waste multiplier lookup |
| `roundToNearest(value, step)` | Rounding helper |
| `parsePitch(str)` | Parse `"8/12"` |
| `window.calculateEstimateV2` | Convenience alias → `calculateEstimate` |
| `module.exports = EstimateBuilderV2` | Node/test consumer |

### Call sites

| Function | Caller | File:line | Purpose |
|---|---|---|---|
| `EstimateBuilderV2.calculateAllTiers()` | `estimate-v2-ui.js` | estimate-v2-ui.js:1474 | Tier preview render |
| `EstimateBuilderV2.CATALOG` | `estimate-catalog-xactimate.js` | estimate-catalog-xactimate.js:1234 | Register entries at runtime |
| `EstimateBuilderV2.loadSettings()` | `estimate-logic-engine.js` | estimate-logic-engine.js:791 | Fetch tax overrides |
| `EstimateBuilderV2.loadSettings()` | `estimate-supplement.js` | estimate-supplement.js:95, 236 | Settings snapshot for supplement |
| `EstimateBuilderV2` (typeof guard) | `dashboard.html` | dashboard.html:1977, 1983, 2130 | Conditional settings flow |
| `calculateLineItem` | Internal, `calculateEstimate` | estimate-builder-v2.js:797 | Line-item path within engine |
| `module.exports` | `tests/estimate-pricing.test.js` | (entire test suite) | 23 unit tests |

### Status: **LIVE** — pure JS, no DOM, the canonical pricing engine

`<script src="js/estimate-builder-v2.js">` at dashboard.html:14749.
Locked by 23 unit tests in `tests/estimate-pricing.test.js`. Safe to import
anywhere; checks `typeof window` + `typeof module`.

---

## Engine 3: `docs/pro/js/estimate-logic-engine.js` (898 lines)

### Public surface (`window.EstimateLogic`)

| Member | Purpose |
|---|---|
| `resolveLineItem(item, measurements, opts)` | Compute cost + qty for one catalog line |
| `resolveEstimate(lineItems, measurements, settings)` | Full estimate resolver |
| `calcQuantity(formula, context)` | Whitelisted formula evaluator |
| `resolveMaterial(materialId)` | NBD_PRODUCTS lookup |
| `resolveLabor(laborId, measurements)` | NBD_LABOR lookup |
| `inferLaborId(item)` | Guess labor code from item code (called internally at line 694) |
| `inferQtyFormula(item)` | Guess qty formula from item code (called internally at line 663) |
| `convertToOrderingUnit(item, quantity)` | Convert to vendor packaging |
| `buildContext(input)` | Build measurement variable scope |
| Constants: `MEASUREMENT_VARS`, `LABOR_BY_SUB`, `LABOR_BY_CODE`, `QTY_BY_SUB`, `QTY_BY_CODE` | Lookup tables |

### Call sites

| Function | Caller | File:line | Purpose |
|---|---|---|---|
| `window.EstimateLogic.resolveEstimate()` | `estimate-v2-ui.js` | estimate-v2-ui.js:1092 | Resolve catalog scope |
| `window.EstimateLogic.resolveEstimate()` | `estimate-v2-ui.js` (fallback) | estimate-v2-ui.js:1481–1483 | Tier-fallback line-item calc |
| `window.EstimateLogic.convertToOrderingUnit()` | `estimate-finalization.js` | estimate-finalization.js:659 | Convert qty for invoice |
| `window.EstimateLogic` (typeof guard) | `estimate-v2-ui.js` | estimate-v2-ui.js:1079 | Availability check |
| `inferLaborId` | Internal, `resolveLineItem` | estimate-logic-engine.js:694 | When `item.laborId` absent |
| `inferQtyFormula` | Internal, `resolveLineItem` | estimate-logic-engine.js:663 | When `item.qtyFormula` absent |

### Status: **LIVE** — formula evaluator, only path to V2 line-item math

`<script src="js/estimate-logic-engine.js">` at dashboard.html:14752.
Whitelisted-context `Function()` evaluator is sound (no eval of arbitrary
strings; only catalog-defined formulas).

---

## Cross-engine drift risks

These are the actual ways a customer could see two different prices for the
same job depending on which path executed.

### Drift 1: Per-SQ tier rates (highest impact)
- Classic: `TIER_RATES = {good: 545, better: 595, best: 660}` at `estimates.js:19`
- V2: `TIER_RATES = {good: 545, better: 595, best: 660}` at `estimate-builder-v2.js:25–29`
- Two literals. Update one without the other and tier prices diverge.

### Drift 2: County tax tables
- Classic: `COUNTY_TAX_RATES` at `estimates.js:25–29` (7 OH/KY counties, 7.0% fallback)
- V2: `COUNTY_TAX` at `estimate-builder-v2.js:56–65` (same 7 counties, 7.0% fallback)
- Independent literals. A rate change in one engine quietly diverges.

### Drift 3: Permit cost tables
- Classic: `PERMIT_COSTS` at `estimates.js:33–38` (7 cities, keyed by city name)
- V2: `PERMIT_COSTS` at `estimate-builder-v2.js:45–53` (7 counties, keyed by `"hamilton-oh"` etc.)
- Different KEY SHAPE — not just different values. A naive merge will silently miss matches.

### Drift 4: Waste factor by pitch
- Classic: `recommendedWasteForPitch()` at `estimates.js:202–207` (lookup table)
- V2: `wasteFactorForPitch()` in `estimate-builder-v2.js` (different shape)
- Different functions, identically-purposed. Easy to update one and forget the other.

### Drift 5: Job minimum unit mismatch
- Classic: `JOB_MINIMUM_CENTS = 250000` ($2,500 in cents) at `estimates.js:20`
- V2: `MIN_JOB_CHARGE = 2500` ($2,500 in dollars) at `estimate-builder-v2.js:38`
- Same value, different unit. A future engineer copying from one to the other could introduce a 100x bug.

### Drift 6: Add-on pricing is classic-only
- `ADDON_PRICES` (chimneys, skylights, valleys, gutters, extra pipe boots) lives only in `estimates.js:40–41`
- An estimate built with add-ons in classic CANNOT be reproduced exactly in V2 today

### Drift 7: Deposit logic is classic-only
- `calcDeposit()` at `estimates.js:1248–1257` implements spec deposit rules (cash 50/50, insurance 0%)
- V2 has no equivalent. `estimate-finalization.js` references the classic helper for deposit display

---

## Migration order

Five PRs, in this order. Each must run `cd tests && npm test` (23 pricing
tests, 8 address-match tests, 31 smoke tests — total 62 must pass green
before opening any PR).

### PR 2 — Mark legacy paths `@deprecated`
- Add `console.warn('[estimates.js DEPRECATED] use EstimateBuilderV2.<name> instead')` at the top of every classic-engine function that has a V2 equivalent
- Add JSDoc `@deprecated` tags
- No behavior changes, just instrumentation
- Let it bake for 14–30 days; the warning logs reveal which classic paths are still hot

### PR 3 — Unify config tables behind a single source
- Create `docs/pro/js/estimate-config.js` with the canonical `TIER_RATES`, `COUNTY_TAX`, `PERMIT_COSTS`, `JOB_MINIMUM`, waste table
- Both `estimates.js` and `estimate-builder-v2.js` import from there (or reference `window.NBD_ESTIMATE_CONFIG`)
- This kills drifts 1–5 in one PR even if classic stays
- Lowest risk + highest reward; run all 23 pricing tests against the merged config

### PR 4 — Port add-on + deposit logic to V2
- Move `ADDON_PRICES` and `collectAddOns()` into `estimate-builder-v2.js`
- Move `calcDeposit()` into V2
- Update `estimate-v2-ui.js` to expose add-on checkboxes
- After this lands, V2 is feature-complete

### PR 5 — Migrate the menu-item entry point
- `startNewEstimateOriginal()` (classic launcher) → re-route to V2 flow OR delete if PR 2's warning logs show it's truly unused for 30 days
- Keep `<script src="js/estimates.js">` loaded for `close-board.js` legacy `selectTier`/`getLineItems` callers, but route classic UI buttons to V2

### PR 6 — Final consolidation
- Remove `<script src="js/estimates.js">` from dashboard.html
- Delete or stub `estimates.js` — keep only the four CRM ops (`duplicateEstimate`, `renameEstimate`, etc.) if they're not yet ported, otherwise delete entirely
- Update `tests/estimate-pricing.test.js` to import EBv2 directly with no aliases
- All 62 tests still green; verify 5 distinct estimate scenarios produce identical totals before/after via live UI

---

## What is NOT dead today

The audit agent flagged `calculateLineItem`, `inferLaborId`, and
`inferQtyFormula` as potentially dead. Re-grep'd to confirm — all three
have internal callers within their own engine:

- `estimate-builder-v2.js:797` — `calculateEstimate` calls `calculateLineItem` when `method === 'line-item'`
- `estimate-logic-engine.js:663` — `resolveLineItem` calls `inferQtyFormula` when `item.qtyFormula` is absent
- `estimate-logic-engine.js:694` — `resolveLineItem` calls `inferLaborId` when `item.laborId` is absent

**No functions in the three engines are safe to delete on call-graph
analysis alone.** Anything called only from one of the engines themselves
goes when the engine goes — not before.

---

## Appendix: search patterns used

```bash
# Classic engine surface
grep -rn "calcEstimateTotalCents\|updateEstCalc\|getLineItems\|buildReview" docs/pro/

# V2 surface
grep -rn "calculateEstimate\|calculateAllTiers\|EstimateBuilderV2\." docs/pro/

# Logic engine surface
grep -rn "resolveLineItem\|resolveEstimate\|EstimateLogic\." docs/pro/

# Script tag references in HTML
grep -rn "estimates\.js\|estimate-builder-v2\.js\|estimate-logic-engine\.js" docs/pro/dashboard.html docs/pro/customer.html
```

Re-run these before each migration PR to catch new call sites added since
this audit.

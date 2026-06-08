# NBD Estimate Engine — Canonical Rate Sheet (code-extracted)

**Run:** estimate-qa-2026-06-08 · **Tenant:** NBD (tenant zero) · **Status:** ✅ code-extracted AND verified live (`NBD_ESTIMATE_CONFIG._version 2026-04-25` running in prod, not fallback). Jo greenlit the run; the 8 locked values are confirmed live = code. Open: explicit per-value sign-off on the *divergent* items (permit defaults, pipe boots, valley, chimney $425-vs-stale-$285) — all flagged in BUG-LOG.

This is deliverable #6. Every value below was read directly from the live
source files (paths + line numbers given). The **Intent** column is what Jo
needs to confirm against his real-world business rules — that closes the
3-way baseline (UI = code = intent).

---

## A. Locked single-source config — `docs/pro/js/estimate-config.js`
`window.NBD_ESTIMATE_CONFIG` (frozen). `_version: '2026-04-25'`.

| Constant | Code value | Intent (Jo confirms) |
|---|---|---|
| TIER_RATES.good | **$545 / SQ** | ? |
| TIER_RATES.better | **$595 / SQ** | ? |
| TIER_RATES.best | **$660 / SQ** | ? |
| JOB_MINIMUM_DOLLARS / _CENTS | **$2,500** / 250000¢ | ? |
| ROUND_TO_DOLLARS / _CENTS | **$25** / 2500¢ | ? |
| TEAR_OFF_EXTRA_PER_SQ | **$50 / SQ** per extra layer (layers>1) | ? |
| DEFAULT_DUMP_FEE | **$550** (editable per-estimate) | ? |
| CUT_UP_ROOF_WASTE_BONUS | **+0.03 (+3%)** waste | ? |
| ADDON_CHIMNEY_FLASH | **$425** | ? |
| ADDON_SKYLIGHT_FLASH | **$350** | ? |

**Formula (cash mode):** `price = SQ × TIER_RATE + add-ons + tax`, then job
minimum $2,500 floor, then round to nearest $25.

## B. Per-SQ price model — both engines

| Step | Classic `estimates.js` | EBv2 `estimate-builder-v2.js` |
|---|---|---|
| SQ from raw | `sq = raw × pitchFactor × waste ÷ 100` | `sq = rawSqft × waste ÷ 100` (**no pitch mult**) |
| Base | `sq × rate` | `sq × rate` |
| Tax base | base + add-ons | base + add-ons |
| Tax (cash) | county rate, else 7% | county rate, else 7% |
| Tax (insurance) | 0 | 0 |
| Job min | `max(subtotal+tax, $2,500)` **then** round25 | round25 **then** floor to $2,500 |
| Units | cents internally | dollars internally |

> ⚠ The two engines use a **different `rawSqft` contract** (Classic = flat
> footprint, needs pitch multiplier → roof area; EBv2 = already roof area).
> See ENGINE-AGREEMENT.md.

## C. Pitch → waste (the divergent table)

| Classic `recommendedWasteForPitch(pitchFACTOR)` | EBv2 `wasteFactorForPitch(pitchRATIO = rise/run)` |
|---|---|
| ≤1.054 (≤4/12) → **1.10** | ≤0.33 (≤4/12) → **1.12** |
| ≤1.118 (5–6/12) → **1.12** | ≤0.50 (≤6/12) → **1.15** |
| ≤1.202 (7–8/12) → **1.15** | ≤0.75 (≤9/12) → **1.17** |
| ≤1.302 (9–10/12) → **1.18** | ≤1.00 (≤12/12) → **1.20** |
| else (11/12+) → **1.22** | else (>12/12) → **1.25** |

Different input units, cutoffs, AND outputs. `+3%` cut-up bonus added on top in both.

## D. County sales tax (cash mode)

| County | Classic key | Classic | EBv2 key | EBv2 |
|---|---|---|---|---|
| Hamilton OH | `Hamilton` | 7.80% | `hamilton-oh` | 7.80% |
| Butler OH | `Butler` | 7.25% | `butler-oh` | 7.25% |
| Warren OH | `Warren` | 6.75% | `warren-oh` | 6.75% |
| Clermont OH | `Clermont` | 7.25% | `clermont-oh` | 7.25% |
| Kenton KY | `Kenton` | 6.00% | `kenton-ky` | 6.00% |
| Boone KY | `Boone` | 6.00% | `boone-ky` | 6.00% |
| Campbell KY | `Campbell` | 6.00% | `campbell-ky` | 6.00% |
| (unknown) | fallback | **7.00%** | fallback | **7.00%** |

Values identical; **key shapes differ** ("Hamilton" vs "hamilton-oh"). Wrong-shape key → silent 7% fallback.

## E. Permit cost — diverges in value AND granularity

| Classic (keyed by CITY) | EBv2 (keyed by COUNTY-slug) |
|---|---|
| Cincinnati 175, Hamilton 150, Fairfield 140, Mason 160, West Chester 165, Milford 150, Loveland 150, Fort Thomas 135, Covington 140, Florence 140, Newport 135 | hamilton-oh 185, butler-oh 150, warren-oh 165, clermont-oh 170, kenton-ky 125, boone-ky 135, campbell-ky 130 |
| unknown city → **$150 default** | unknown key → **$0 (silent)** |

## F. Other add-ons

| Add-on | Classic | EBv2 |
|---|---|---|
| Chimney flash | $425 (config) | $425 (config) ✓ |
| Skylight flash | $350 (config) | $350 (config) ✓ |
| Gutters | $8.50/LF | $8.50/LF ✓ |
| Valley | `eave × 0.25 × $12/LF` | `valleyMetalLf × $8.50/LF` (different input) |
| Extra pipe boot (>4) | `(pipes-4) × $45` (`window.R.pipe`) | `(pipes-4) × $85` |
| Deposit (cash) | 50% | 50% |
| Deposit (insurance) | $0 | $0 |

## G. Third path — line-item engine `estimate-logic-engine.js`
`resolveEstimate()` does **not** read `window.NBD_ESTIMATE_CONFIG`; it hardcodes
defaults `minJobCharge=2500`, `roundTo=25`, `fallbackTaxRate=0.07`,
`overheadPct=0.10`, `profitPct=0.10`, `materialMarkupPct=0.25`. Config edits do
**not** propagate here. This is the internal cost-basis / catalog path, not the
customer GBB tier price — but worth confirming it's never the customer total.

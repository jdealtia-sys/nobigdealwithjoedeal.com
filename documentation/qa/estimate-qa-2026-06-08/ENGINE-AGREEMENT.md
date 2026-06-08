# Engine-Agreement Report — Classic vs EBv2 (LIVE-CONFIRMED)

**Run:** estimate-qa-2026-06-08 · Deliverable #3 · Verified live in prod, both engines loaded in-page (`estimates.js?v=6` + `estimate-builder-v2.js?v=2`), exact-input invocation.

**Verdict:** The **core per-SQ formula AGREES exactly**. All divergence is in the
**inputs each engine derives** from the same physical job: waste-from-pitch,
permit lookup, and tax-key matching. So two engines on the *same roof* can quote
different prices — driven by pitch/jurisdiction, not by the pricing math itself.

## 1. Core formula — ✅ AGREES
Fed identical `sq + add-ons$ + taxRate`, the two engines return the same grand total:

| sq | tier | add-ons | tax | Classic `calcEstimateTotalCents` | V2 `calculatePerSq` |
|---|---|---|---|---|---|
| 28.75 | better | $550 | 7% | **$18,900** | **$18,900** ✓ |
| 3 | good | $0 | 7% | **$2,500** (job-min) | **$2,500** ✓ |

Both apply `base + add-ons + tax → max($2,500) → round $25` identically. ✅

## 2. Waste-from-pitch — 🔴 DIVERGES (7 of 8 pitches)
Classic keys on pitch **factor** (slope multiplier); V2 keys on pitch **ratio** (rise/run). Same physical pitch → different waste:

| Pitch | Classic waste | V2 waste | Agree? |
|---|---|---|---|
| 2/12 | 1.10 | 1.12 | ❌ |
| 4/12 | 1.12 | 1.15 | ❌ |
| 6/12 | 1.15 | 1.15 | ✅ (coincidence) |
| 8/12 | 1.15 | 1.17 | ❌ |
| 9/12 | **1.18** | 1.17 | ❌ (classic higher) |
| 10/12 | 1.18 | 1.20 | ❌ |
| 12/12 | **1.22** | 1.20 | ❌ (classic higher) |
| 16/12 | 1.22 | 1.25 | ❌ |

Impact: identical measurements priced through the two engines yield different SQ
counts and therefore different totals. Direction is inconsistent (sometimes
classic higher, sometimes V2).

## 3. County tax — 🟠 values agree, key-shape sensitive (silent 7% on wrong shape)
| County | classic `'Hamilton'` | classic `'hamilton-oh'` | V2 `'hamilton-oh'` | V2 `'Hamilton'` |
|---|---|---|---|---|
| Hamilton | **7.8%** ✓ | 7.0% ✗ fallback | **7.8%** ✓ | 7.0% ✗ fallback |
| Boone | 6.0% ✓ | 7.0% ✗ | 6.0% ✓ | 7.0% ✗ |
| Warren | 6.75% ✓ | 7.0% ✗ | 6.75% ✓ | 7.0% ✗ |

Each engine only recognizes ITS key shape; the other shape silently falls back to
7%. **Open risk to confirm in UI:** which shape does the county selector emit, and
which engine consumes it? If a mismatch reaches production, customers are silently
taxed at 7% instead of their county rate.

## 4. Permit — 🟠 fully divergent (different table, different unknown default)
| Lookup | Classic | V2 |
|---|---|---|
| Cincinnati | $175 | $0 (not a V2 key) |
| Hamilton | $150 (city) | — |
| hamilton-oh | — | $185 (county) |
| unknown jurisdiction | **$150 default** | **$0 silent** |

V2 silently charges **$0 permit** for any key not in its 7-county table — an
under-charge risk (BUG-LOG C-1, live-confirmed).

## Latent vs active
Core math agrees, so the engines only produce different customer prices when the
SAME job is routed through BOTH (e.g. close-board=classic vs dashboard wizard=V2).
Whether that happens in practice is the Phase-1 UI question (which engine the live
"New Estimate" flow uses, and which key shape the dropdowns emit).

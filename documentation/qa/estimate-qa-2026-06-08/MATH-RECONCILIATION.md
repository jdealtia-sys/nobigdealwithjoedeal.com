# Math Reconciliation — UI vs Code vs Intent

**Run:** estimate-qa-2026-06-08 · Deliverable #2
UI = live (rendered/persisted) · Code = file:fn · Intent = locked spec / Jo's rules.

| Value | UI (live) | Code | Intent | Verdict |
|---|---|---|---|---|
| Tier rate Good | $545/SQ | $545 (config) | $545 | **PASS** |
| Tier rate Better | $595/SQ | $595 (config) | $595 | **PASS** |
| Tier rate Best | $660/SQ | $660 (config) | $660 | **PASS** |
| Tier ordering | Good<Better<Best on quote | monotonic | yes | **PASS** |
| SQ×rate+addons+tax (engine) | 93/93 oracle match | calculatePerSq | yes | **PASS** |
| Job minimum $2,500 | floors @ $2,500 | MIN_JOB_CHARGE | yes | **PASS** (V2 per-SQ); not applied to `type:"advanced"` manual (intentional) |
| $25 rounding | 0 violations in sweep | roundToNearest | yes | **PASS** (current engine; legacy records un-rounded) |
| Tear-off +$50/SQ (layers>1) | correct | TEAR_OFF_EXTRA | yes | **PASS** |
| Dump fee $550 | $550 (auto-added every estimate) | DEFAULT_DUMP_FEE | yes | **PASS** (confirm "always add" is intended) |
| Cut-up +3% | +0.03 | CUT_UP_ROOF_WASTE_BONUS | yes | **PASS** |
| Chimney $425 | **$285 live** | 425 (config) | 425 | **MATH-FAIL / DRIFT (L-1)** — stale localStorage |
| Skylight $350 | $350 | 350 (config) | 350 | **PASS** |
| **Pitch→waste (retail tiers)** | **always 1.25** | wasteFactorForPitch(parsePitch(rise)) | per table (1.15/1.17/1.20) | **MATH-FAIL (V2-1)** — over-quote 4–8% |
| **Pitch→waste (line-item/stored)** | **1.17 (stale)** | reads state.measurements.waste | per table (1.15) | **MATH-FAIL (V2-7)** — waste not recomputed on pitch change |
| County tax (known, each engine's key) | correct (7.8% Hamilton etc.) | COUNTY_TAX[slug]/RATES[name] | yes | **PASS** |
| County tax (unknown → 7%) | 7% fallback | fallback | yes | **PASS** |
| County tax (cross-engine key) | silent 7% | key-shape mismatch | n/a | **DRIFT (D-3, latent)** — each UI feeds its own engine the right shape |
| Permit (known) | classic $150–175 / V2 $125–185 | divergent tables | one source | **DRIFT (D-1)** |
| Permit (unknown jurisdiction) | V2 **$0 silent** / classic $150 | C-1 | non-zero | **GUARDRAIL-MISSING (C-1)** |
| Persisted/CRM deal total | **$17,000 line-item** | grandTotal = line-item | per-SQ tier ($22,925) | **DRIFT (V2-pkb)** |
| Config loaded (not fallback) | `_version 2026-04-25` live | — | — | **PASS** |
| Classic == V2 core formula | identical sq+addons+tax → identical | — | — | **PASS** |

## 3-way verdict
- **Engine core math = code = intent: PASS.** The per-SQ calculator is faithful to the locked spec (93/93, 0 inversions/rounding/unit errors).
- **Where UI ≠ intent:** the **inputs/settings feeding** the engine are wrong in production — pitch units (V2-1), stale waste (V2-7), stale localStorage add-on price (L-1), and the wrong total persisted/shown (V2-pkb, line-item vs per-SQ). The math engine is right; what's handed to it (and which of its outputs is surfaced) is not.
- **Classic vs V2:** core formula agrees; waste-from-pitch and permit tables diverge (latent unless one job runs through both engines).

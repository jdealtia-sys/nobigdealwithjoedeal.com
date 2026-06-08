# Estimate Builder — "Best of Both Worlds" Build Plan
**Run:** estimate-qa-2026-06-08 · Jo-confirmed direction (2026-06-08). Phased so each step ships + earns its keep before the next.

## Goal
Per-square base pricing (reliable for standard jobs) **+ mix-priced add-ons** for everything per-SQ misses, surfaced through **4 output formats**. Jo: *"standard per-sq pricing is reliable with exceptions + add-ons (cut-up, pitch, steep, access, chimneys, crickets, specialty, framing, redeck). Make the best of both worlds."*

## Confirmed decisions
- **4 formats:** Good/Better/Best comparison · Single per-SQ estimate · Line-item Xactimate scope · Internal cost+margin view.
- **Add-on buckets (all):** Roof complexity · Penetrations & details · Structural · Pass-through fees.
- **Add-on pricing:** **mix by type** — flat $ (chimney), per-SQ surcharge (steep), per-unit ($/sheet redeck, $/each cricket).
- **Sequence:** canonical-total fix first (done — feat/estimate-canonical-total), then this.

## What already exists (reuse, don't rebuild)
- **Per-SQ engine:** `EstimateBuilderV2.calculatePerSq / calculateAllTiers` — base rate × SQ + add-ons + tax + $25 round + $2,500 floor. Tier rates 545/595/660 (config-locked).
- **Existing per-SQ add-ons (wired):** dump $550, tear-off extra $50/SQ (layers>1), chimney $425, skylight $350, valley $8.50/LF, gutters $8.50/LF, extra pipe boot $85 (>4), permit (by jurisdiction), cut-up +3% waste.
- **Existing complexity adders in the line-item catalog (NOT yet surfaced in per-SQ):** `LAB ADR-SS` steep (pitch≥8), `LAB ADR-2S` two-story, `LAB ADR-CU` cut-up, `LAB ADR-VS` very-steep (pitch≥12), deck-replacement % (`deckReplacePct` default 0.15), redeck codes (`RFG OSB*`, `RFG PLY*`), hurricane clips, etc.
- **3 doc formats:** insurance-scope, retail-quote (GBB), internal-view (in `estimate-finalization.js` / `document-generator*`).

So most building blocks exist — the work is **surfacing + wiring + a format picker**, not greenfield.

## Add-on catalog (proposed — $ defaults are Jo's to set)
| Bucket | Add-on | Pricing | Exists? | Default (Jo to confirm) |
|---|---|---|---|---|
| Roof complexity | Cut-up roof | +% waste | ✅ +3% | +3% |
| | Steep (8/12–11/12) | $/SQ surcharge | adder in catalog | $? /SQ |
| | Very steep (12/12+) | $/SQ surcharge | adder in catalog | $? /SQ |
| | Difficult/limited access (2-story, tight lot) | $/SQ or flat | 2-story adder exists | $? |
| Penetrations & details | Chimney flashing | flat $/each | ✅ $425 | $425 |
| | Cricket / saddle | flat $/each | new | $? /each |
| | Skylight flashing | flat $/each | ✅ $350 | $350 |
| | Specialty flashing / metal accents | manual $ or flat | partial | $? |
| Structural | Framing / rafter repair | $/hr or manual $ | hourly labor exists | $? |
| | Re-decking | $/sheet | deck % exists | $? /sheet |
| Pass-through | Permit | by jurisdiction | ✅ (fix C-1: default $150 unknown) | table |
| | Dump / disposal | flat $ | ✅ $550 | $550 |
| | Aerial measurement report | flat $ (pass-through) | ✅ ~$75 | $75 |

## Phases
**Phase 1 — Surface existing complexity adders into the per-SQ flow. ✅ SHIPPED 2026-06-08 (branch `feat/persq-complexity-addons`).**
Locked, config-backed rates (`estimate-config.js`), wired into `calculatePerSq` + the per-SQ builder UI:
- Pitch (STACK): steep 8/12+ **$25/SQ**, very-steep 12/12+ **+$45** ($70), extreme 16/12+ **+$75** ($145).
- Stories (TIERED): 2-story **$15/SQ**, 3-story **$30/SQ** (not additive).
- Cut-up: **+3% waste AND +$15/SQ** cutting labor.
- Access (TIERED): standard $0 / moderate **$15** / difficult **$35**; crane/boom = real equipment line items.
- Defaults to 6/12 (non-steep) so steep is opt-in; pitch dropdown now 3/12–18/12 (extreme reachable, odd imports land).
- 6 new pricing tests; adversarially reviewed (blocker fixed: extreme tier had been UI-unreachable).
Open follow-ups: dynamic $ labels (currently hardcoded, match config); maps-import pitch snap for >18/12; line-item LAB ADR-* rates intentionally left per-mode (insurance scope) vs the new per-SQ cash rates.

**Phase 2 — Add the missing add-ons + a settings editor.** Crickets ($/each), re-deck ($/sheet), framing, specialty — with mix pricing. Add a Settings → Estimate Add-ons editor so Jo sets the $ defaults (this also fixes the L-1 class of problem: defaults live in config, not stale localStorage). Wire into per-SQ + carry into the GBB tiers.

**Phase 3 — The 4 output formats + format-aware canonical total.** Add a "Single per-SQ" format (one tier, one number) alongside GBB / line-item scope / internal. A format picker per estimate. Canonical total becomes **format-aware** (extends the Phase-0 mode-aware logic): GBB → selected tier; single per-SQ → that tier; line-item scope → scope total; internal → n/a.

**Phase 4 — Doc polish + parity.** Per-format doc templates, ensure classic↔V2 parity on the shared add-on table (the PR-3b the config file anticipates: unify waste table, permit table, pipe-boot price behind `estimate-config.js`).

## Open decisions (next multiple-choice round)
The **$ defaults** for each new/per-SQ add-on: steep $/SQ, very-steep $/SQ, access charge, cricket $/each, redeck $/sheet, framing rate, specialty. I'll bring these as a pick/enter round when we start Phase 1–2.

## Related fixes folded in along the way
- **C-1** (V2 $0 permit unknown jurisdiction) → fix in Phase 2 (default $150 + settings).
- **B-4 / L-1** (stale localStorage overriding config) → resolved by the Phase-2 config-backed settings editor.
- **V2-5** (CSP blocks line-item formula evaluator) → separate; needed for the line-item Xactimate format to compute formula quantities. Schedule before/with Phase 3's line-item format.
- **V2-4** (server PDF render INTERNAL) → investigate independently (affects PDF on all formats).

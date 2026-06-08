# Canonical-Total Design (V2-2 / V2-pkb) — investigation + fix design
**Run:** estimate-qa-2026-06-08 · Source: 6-reader code-map + design synthesis (workflow wf_e11cb4b9-070). **Nothing applied — design awaiting Jo's sign-off.**

## Root cause (confirmed in code)
The V2 retail-quote doc is fed by **two independent engines off different inputs, never reconciled**:
- **Headline "Your Investment" / PROJECT TOTAL** = `estimate.total` ([estimate-finalization.js:636](docs/pro/js/estimate-finalization.js:636) / :608) = the **line-item cost-plus** sum from `getCurrentEstimate()` → `EstimateLogic.resolveEstimate(scope, measurements, {tier})` ([estimate-v2-ui.js:1277](docs/pro/js/estimate-v2-ui.js:1277)). ≈ $17,000.
- **Good/Better/Best cards** = `meta.tiers[k].total` ([estimate-finalization.js:579](docs/pro/js/estimate-finalization.js:579)) = the **per-SQ flat-rate** calc `EstimateBuilderV2.calculateAllTiers(perSqInput)` ([estimate-v2-ui.js:1852](docs/pro/js/estimate-v2-ui.js:1852)), $545/$595/$660 × SQ → $22,825–$27,475.
- A code comment at [estimate-v2-ui.js:1821-1826](docs/pro/js/estimate-v2-ui.js:1821) shows the per-SQ cards were *deliberately* swapped in "to show real tier differentiation" — but the headline was left on the line-item total. **Never reconciled.**
- Symptom: the **"Selected" badge never fires** — [estimate-finalization.js:566](docs/pro/js/estimate-finalization.js:566) marks a card selected via `tierEst.total === estimate.total`, which per-SQ vs line-item can't satisfy.

**V2-pkb:** `save()` persists `grandTotal = estimate.total` ([estimate-v2-ui.js:2010](docs/pro/js/estimate-v2-ui.js:2010)) — the line-item sum. The per-SQ tiers are **never persisted**. So the CRM stores a number the customer never agreed to.

## Spec intent + parity target
Locked spec (estimates.js:7-18 header): customer price = `SQ × TIER_RATE + add-ons + tax`; the line-item sum is the **internal cost basis** and "no longer drives the customer-facing grand total." **Classic already complies** — [estimates.js:522-528](docs/pro/js/estimates.js:522) locks `grandTotal = prices[selectedTier]` with the comment *"NOT the sum of display line items."* **V2 is the lone non-compliant engine.**

## Recommendation: Option A
Drive **both** the headline and the persisted `grandTotal` from the **selected tier's per-SQ total**, with the tier cards reading the same source (so highlighted card == headline == saved record). Mark "selected" by **tier key** (`state.tier`), not float-equality. Persist the `prices{good,better,best}` object too (matches classic shape that `close-board.js` already reads).

| Option | Headline shows | Verdict |
|---|---|---|
| **A (rec)** | selected tier's per-SQ total | ✅ matches spec + classic; fixes contradiction + Selected badge + V2-pkb with one source |
| B | (remove headline; cards only) | ❌ still must pick a tier for save/deposit — doesn't solve V2-pkb |
| C | "starting at" Good | ❌ headline ≠ persisted total → new mismatch |
| D | recommended (Better), ignore rep's tier | ❌ understates if rep closed at Best |

## Fix sites (Option A — pseudo-diffs, NOT applied)
1. **[estimate-v2-ui.js](docs/pro/js/estimate-v2-ui.js)** — factor the perSqInput (1828-1850) into a `buildPerSqInput()` helper. In `getCurrentEstimate()` (1244-1305), when `rawSqft > 0`, compute `calculateAllTiers(buildPerSqInput())`, set `estimate.total/subtotal/tax/taxRate/deposit` = the **chosen tier**, keep the line-item sum as `estimate.internalLineItemTotal`, set `estimate.prices = {good,better,best}`. Guard keeps line-item total for pass-through/no-measurement estimates.
2. **[estimate-v2-ui.js:2010](docs/pro/js/estimate-v2-ui.js:2010)** — `grandTotal` now correct (=tier total); ADD `prices` + `selectedTier` to the save payload.
3. **[estimate-finalization.js:566](docs/pro/js/estimate-finalization.js:566)** — Selected badge by tier key (`t.key === meta.tiers.recommended`).
4. **[doc-preflight.js:1864-1870](docs/pro/js/doc-preflight.js:1864)** — RECONCILE: stop writing `grandTotal` from `sum(lineItems)` (write `lineItemsTotal` instead), else line-item edits re-clobber V2-pkb.
5. **[invoice-pipeline.js:104-120](docs/pro/js/invoice-pipeline.js:104)** — RECONCILE: invoice `total = est.grandTotal` (honor the locked tier total) and `deposit = est.deposit` (honor insurance 0%), instead of recomputing from rows + hardcoded 50%.

## Blast radius / risks (Jo must accept)
1. **CRM/analytics deal values jump UP** (~$17k line-item → ~$23–25k per-SQ tier) — the *correct, per-spec* numbers. Consumers that auto-follow: dashboard-widgets, estimate-analytics, reports-dashboard/trends, customer-portal, supplement-ui, smart-followup, notif-bell. Pipeline `$` rollups use `lead.jobValue` (unaffected).
2. **Signed-contract dollar figure changes** — `getCurrentEstimate()` feeds save, preview, AND `sendForSignature`/BoldSign envelope ([document-generator.js:362](docs/pro/js/document-generator.js:362)). The e-signed amount becomes the tier total. **Confirm this is the intended signed price.**
3. **Legacy drift toast** — [dashboard-widgets.js:330-340](docs/pro/js/dashboard-widgets.js:330) compares saved vs recomputed total; every existing V2 estimate (stored at line-item $17k) will show a "recomputed from $X to $Y" toast on open. Mitigate: suppress for `builder==='v2'` / pre-fix records.
4. **Two competing writers** (doc-preflight, invoice-pipeline) MUST ship in the same change or they re-introduce V2-pkb.
5. **Analytics vs pipeline divergence** widens (estimate totals up; lead.jobValue unchanged; rep accuracy = jobValue/grandTotal reads low until jobValue re-entered). Pre-existing, but more visible.

## Scope
~4 files, medium risk (touches signed-contract total + invoicing + analytics + legacy data). Not a quick fix — warrants its own PR + a live re-test of save→doc→sign + a legacy-estimate open check.

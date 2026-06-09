# Proposed Fixes — estimate-qa-2026-06-08

Deliverable #7. **Nothing here is applied.** Diffs are against live source.
Group A = trivial UI (safe to land on Jo's OK, deploy-gated). Group B = pricing/calc/config (locked-spec area — **do NOT apply without Jo's explicit sign-off**).

---

## GROUP A — trivial (ready to land on your OK)

### A-1 (V2-3) — define/alias `scheduleDraftSave`
`docs/pro/js/estimate-v2-ui.js` — 4 dead references (lines 736, 805, 815, 825) to a function renamed to `saveDraftDebounced` (def L1524). Pick ONE:

**Option 1 (minimal alias, recommended):** add immediately after `function saveDraftDebounced()` (≈L1524):
```js
// Back-compat: field handlers still call the old name.
function scheduleDraftSave() { return saveDraftDebounced(); }
```
**Option 2 (replace call sites):** at lines 736, 805, 815, 825 change `scheduleDraftSave();` → `saveDraftDebounced();`

Effect: stops the per-edit `ReferenceError`, restores draft auto-save. No math impact. Add a smoke assertion that editing a customer field doesn't throw.

---

## GROUP B — pricing / calc / config (PROPOSE ONLY — needs Jo sign-off)

### B-1 (V2-1, HIGH) — retail-quote pitch passed as rise, read as ratio → waste always 1.25
`docs/pro/js/estimate-v2-ui.js` ~L1830, inside `perSqInput`:
```diff
-        pitch:            state.measurements.pitch,
+        // state.measurements.pitch is the RISE integer (e.g. 8 for 8/12).
+        // parsePitch() treats a bare number as the rise/run RATIO, so any
+        // rise (4–14) > 1.0 fell into the steepest waste bucket (1.25).
+        // Pass "<rise>/12" so parsePitch yields the correct ratio.
+        pitch:            (Number(state.measurements.pitch) || 8) + '/12',
```
Verify: 6/12 Better @3000SF Hamilton cash → $22,925 (not $24,850). Add unit tests pinning waste per pitch (4/12→1.15 … 12/12→1.20).

### B-2 (V2-7, HIGH) — stored `measurements.waste` not recomputed when pitch changes
`docs/pro/js/estimate-v2-ui.js` `updateMeasurement()` (~L1042). When pitch (or cutUpRoof) changes, recompute waste from the engine so the line-item/stored path matches:
```js
if (field === 'pitch' || field === 'cutUpRoof') {
  const ratio = EstimateBuilderV2.parsePitch(next.pitch + '/12');
  let w = EstimateBuilderV2.wasteFactorForPitch(ratio);
  if (state.measurements.cutUpRoof) w += 0.03;
  next.waste = w;
}
```
(Coordinate with B-1 so tier path and line-item path use the SAME waste.)

### B-3 (V2-pkb / V2-2, HIGH) — decide the single source-of-truth customer total
The saved `grandTotal` and the retail-quote headline use the **line-item cost-plus** total ($17,000), but the spec says the customer price is the **per-SQ tier**. Decide intent, then make the persisted total + the doc "YOUR INVESTMENT" both read the **selected per-SQ tier** (not the line-item sum). Touches `estimate-v2-ui.js` finalize/save payload + retail-quote template. **Design decision — needs Jo.**

### B-4 (L-1, HIGH) — stale localStorage overrides unified config
`docs/pro/js/estimate-builder-v2.js` `loadSettings()` (~L410). Saved `nbd_est_settings_v2` snapshot overrides config (e.g. chimney $285 vs $425). Options:
- **B-4a (fast, per-machine):** clear `localStorage['nbd_est_settings_v2']` so config defaults ($425) apply. (Fixes Jo's machine now; doesn't fix the design.)
- **B-4b (durable):** bump `SETTINGS_KEY` → `nbd_est_settings_v3` so old snapshots are ignored once.
- **B-4c (correct):** only persist fields the user *explicitly* overrode; always re-seed config-derived defaults (tier rates, add-on prices, tax, permits, dump) from `NBD_ESTIMATE_CONFIG` on load.

### B-5 (C-1, MED) — V2 permit $0 for unknown jurisdiction
`docs/pro/js/estimate-builder-v2.js` `calculatePerSq()` ~L493:
```diff
-    addOns.permit = permitInfo ? Number(permitInfo.cost) : 0;
+    addOns.permit = permitInfo ? Number(permitInfo.cost) : Number(s.defaultPermitCost || 150);
```
(Add `defaultPermitCost: 150` to settings; mirrors classic's `DEFAULT_PERMIT_COST`.) Or surface a "permit not set" warning.

### ✅ B-6 (V2-5, MED-HIGH) — CSP blocks `new Function()` formula evaluator — **SHIPPED** (branch `feat/estimate-csp-formula-eval`)
`docs/pro/js/estimate-logic-engine.js` `calcQuantity` used `new Function()`, blocked by prod CSP (`unsafe-eval` absent) → formula-qty line items resolved to 0. **Done:** replaced Layer 2 with `safeEvalFormula` — a CSP-safe recursive-descent evaluator over the same bounded grammar (`+ - * / %`, unary `+ - !`, comparisons, `&& ||`, ternary, parens, whitelisted vars, the 8 Math helpers bare or as `Math.*`), JS-faithful semantics, numbers/booleans only. Layer 1 whitelist unchanged. Proven identical to the old path by `tests/estimate-formula-eval.test.js` (513 differential comparisons + value pins + escape-rejection), wired into `npm test` as `test:formulaeval`.

### ✅ B-8 (V2-6, MED) — line-item Xactimate scope: visible line totals don't reconcile to the summary — **SHIPPED, Option A (Jo-approved 2026-06-08)**
**Resolution (Option A — line items at retail, Xactimate-standard):** `formatInsuranceScope` now prices each scope line at RETAIL (`material × (1+markup)`, labor as-is), so category subtotals sum to a grand **"Line Item Total (before O&P)"** = the engine's `retailBeforeOHP`. The Financial Summary was rebuilt as a reconciling ladder: Line Item Total → Overhead → Profit → Subtotal → (Tax) → RCV, replacing the old Material/Labor aggregate rows that showed retailed material yet didn't match the cost-basis line totals. Pass-through lines (e.g. the $75 measurement report) render at FACE and stay in the Line Item Total (markup/O&P don't apply to a flat fee), and a "Minimum Job Charge Adjustment" row now explains any min-job RCV bump. Internal-view keeps its cost basis; retail/single-quote (bullets, no per-line price) are untouched. Tested in `estimate-render.test.js` (B-8 block: retail line totals, ladder reconciliation, pass-through face-value, min-job adjustment). **Latent caveat (not on live path):** the scope reads `estimate.materialMarkupPct ?? 0.25`; the live engine always persists it, but if a future saved/round-tripped insurance estimate strips it, a non-default-markup scope would fall back to 25% and disagree with the engine total — carry `materialMarkupPct` through any insurance-estimate persistence.

<details><summary>Original finding (for history)</summary>

### B-8 (V2-6, MED) — line-item Xactimate scope: visible line totals don't reconcile to the summary ⚠ NEEDS JO SIGN-OFF (money presentation)
Found while polishing the line-item format (2e). In `estimate-finalization.js formatInsuranceScope`, each scope line shows **cost-basis** numbers: `Material = materialCostPerUnit`, `Labor = laborCostPerUnit`, `Line Total = qty × (matCost + labCost)`. So the category subtotals sum to **`hardCost`** (`materialCost + laborCost`). But the **Financial Summary**'s first row, "Material Cost", shows **`materialRetail` = materialCost × 1.25** (the 25% material markup). Result: an adjuster who adds up the visible scope lines gets `hardCost`, then the summary jumps to a higher material figure — the line items and the summary **don't reconcile**, and there is no per-line retail price computed anywhere (markup is applied only in aggregate in `resolveEstimate`).

This is a presentation/credibility issue on an insurance scope, not a total error (RCV/`total` is correct either way). Three ways to resolve — **Jo's call** (RULE 0 #3):
- **(A) Line items at RETAIL (Xactimate-standard, recommended for insurance):** thread a per-line retail (`materialCostPerUnit × (1+markup)`, labor as-is) through `resolveLineItem`; line totals then sum to `retailBeforeOHP`, with O&P (10/10) and tax shown separately → RCV. Matches how adjusters read an Xactimate scope. Larger change (per-line retail through the engine + the table columns).
- **(B) Keep cost-basis lines, make the summary reconcile:** add a "Total Direct Cost (= Σ line items)" row = `hardCost`, then a single "Overhead, Profit & Markup" row = `subtotal − hardCost`, then Subtotal → Tax → RCV. Honest and self-reconciling, smaller change, but bundles the material markup into the margin line (less itemized).
- **(C) Leave as-is** — not recommended; the scope and summary won't add up for a careful reader.

Shipped alongside this finding (safe, no number change): the **never-drop-a-line catch-all** — a line whose `category` isn't in `CAT_ORDER` (custom/future-catalog) now renders under a titleized section instead of being silently dropped from the table while still counting in RCV. Tested in `estimate-render.test.js`.

</details>

### ✅ B-7 (V2-4, MED) — server-side doc render returns INTERNAL — **FIXED** (branch `feat/estimate-server-render-and-persistence`)
Root cause (code-provable, confirmed by 4-agent map + review): `renderPdf` (`functions/render-pdf.js`) succeeded through render+upload, then `file.getSignedUrl()` threw because the function's compute SA lacks `roles/iam.serviceAccountTokenCreator` (signBlob) — the SAME IAM gap that breaks `createCustomToken` ([[access-code-login-iam-gap]]). `onCall` flattened the raw throw to a bare `INTERNAL`, and the whole server-render path silently fell back to html2canvas. **Fixes (no IAM change needed):**
1. **URL self-heal:** try the 7-day signed URL → fall back to a Firebase download-token URL (`firebaseStorageDownloadTokens` + `?alt=media&token=`, the pattern `image-pipeline.js` already uses). Works with OR without the IAM grant; self-heals to signed/expiring once the role is granted.
2. **Diagnosability:** stage-tracked (`launch|setContent|fonts|pdf|upload`) try/catch that `logger.error`s the real cause + re-throws `HttpsError('internal', …, {stage})` (and passes through any already-typed `HttpsError`). The next failure self-identifies instead of opaque INTERNAL.
3. **Hardening:** explicit 25s timeouts on `setContent`/`pdf` + a 4s race on `document.fonts.ready` so a stalled remote asset can't burn the 60s budget.
- **Residual (needs live, post-deploy):** confirm the download-token URL resolves against deployed Storage + which stage (if any) still fails (Chromium launch / font timeout) via `gcloud functions logs read renderPdf`. **Punchlist:** once `roles/iam.serviceAccountTokenCreator` is granted (devops/Jo — Claude must not), drop or TTL the never-expiring download-token branch for `pdf-renders/` (N2). The non-expiring token URL is an accepted *degraded-fallback* posture, same exposure class as image-pipeline photo variants.

### ✅ 2f — Single Quote server-render parity — **SHIPPED** (same branch)
Server render was gated to `retail-quote`/`internal-view` only. Added `single-quote` to the finalize gate; `_buildEstimatePayload` now branches on `format` to emit a clean one-number payload (`lines:[]` → estimate.hbs suppresses the Scope table, `tiers:false`/`tierList:null` forced even if `meta.tiers` is passed, single-quote cover/summary copy). No `estimate.hbs` change (the headline-total block was already unconditional). Tested in `estimate-v2-payload.test.js`.

### ✅ 3A — persist `materialMarkupPct` through save — **SHIPPED** (same branch); 3B (V2 reopen) = follow-up
Extracted `_buildSavePayload(estimate,state)` (pure, byte-faithful to the old inline payload — verified field-by-field) and added top-level `materialMarkupPct` + the O&P-ladder inputs (`retailBeforeOHP`/`overhead`/`overheadPct`/`profit`/`profitPct`) + per-line `rows` splits (`materialTotal`/`laborTotal`/`materialCostPerUnit`/`laborCostPerUnit`/`quantity`/`unit`/`category`/`unitPrice`). Additive — classic reopen + close-board + invoice ignore the extra keys. Round-trip test proves a reconstructed insurance estimate honors the persisted markup (40% → $1,900 line, not the 0.25-default $1,750) and the O&P ladder reconciles. **3B (the V2 reopen path that READS these fields) is deferred** — saved estimates currently reopen into the Classic builder, so 3A is inert-but-correct until 3B is built (separate, larger PR; the round-trip test is its gate). Latent flag (out of scope): `getCurrentEstimate` never threads a rep-configured markup into `settings`, so the engine default 0.25 is used live regardless — only matters if a markup-edit UI ships.

### Drift cleanups (D-1..D-4) — unify classic↔V2 waste table, permit table, extra-pipe-boot price behind `estimate-config.js` (the PR 3b the config file's own header anticipates). Propose as a batch once B-1/B-2 land.

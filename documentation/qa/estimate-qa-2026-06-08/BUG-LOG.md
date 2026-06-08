# Bug Log — Estimate Engine QA (live-confirmed)

**Run:** estimate-qa-2026-06-08 · Deliverable #4 · NBD prod, both engines invoked in-page with exact inputs.

Ranked. Each: wrong value · expected value · file/function · status.
**No pricing/calc/config change applied — all proposed for Jo's sign-off (RULE 1).**

---

## 🔴 V2-1 — V2 retail-quote tiers use 1.25 waste for EVERY pitch (pitch passed as rise, engine reads it as ratio) — **LIVE / MATH-FAIL / HIGH**
- **Observed (live, exact UI code path):** the V2 builder's retail-quote Good/Better/Best tier prices apply **waste 1.25 regardless of pitch**. A 3,000 SF Better quote shows **$24,850** at every pitch 4/12–12/12; correct values are $22,925 (4/12) … $23,875 (12/12) → **over-quoted by $975–$1,925 (4.1%–8.4%)**.
- **Expected:** waste per the V2 pitch table (4/12→1.15, 8/12→1.17, 12/12→1.20).
- **Root cause:** `estimate-v2-ui.js:1042–1046` stores the pitch dropdown value as the **rise integer** (`"12/12"`→`12`); `estimate-v2-ui.js:1830` passes `pitch: state.measurements.pitch` (=12) to `calculateAllTiers`; `estimate-builder-v2.js parsePitch(12)` returns `12` **as the rise/run ratio**; `wasteFactorForPitch(12)` → `1.25` (steepest bucket) because every dropdown rise (4–14) is > 1.0. No `wasteFactorOverride` is passed, so the stored (correct) `measurements.waste` is ignored on this path.
- **Scope:** the retail-quote tier comparison uses this per-SQ path **even in line-item mode** (it's how the customer-facing GBB prices are generated). Direction is **over-quote** (not money-losing for the roofer, but wrong vs spec and inflates the customer price 4–8%).
- **Proposed fix (do NOT auto-apply — pricing/locked-spec):** at `estimate-v2-ui.js:1830` pass `pitch: state.measurements.pitch + '/12'` so `parsePitch` sees `"12/12"`→ratio 1.0; OR convert rise→ratio (`/12`) before passing; OR pass `wasteFactorOverride: state.measurements.waste`. Add a unit test pinning waste per pitch. ⚠ Also fix the default `state.measurements.pitch: 8` (L29) which has the same rise-vs-ratio ambiguity.
- **Caveat to confirm:** read the GBB prices off an actually-rendered retail quote to confirm the on-screen number == $24,850 (the code path is proven; the on-screen render is the last mile — pending in the save→generate flow).

## 🔴 V2-2 — Retail quote headline "YOUR INVESTMENT $17,000" contradicts its own tier cards ($22,825–$27,475) — **LIVE / DOC-MISMATCH / HIGH**
- **Observed (live retail-quote doc, ZZ_QA_ test):** the generated customer "ESTIMATE" shows headline **YOUR INVESTMENT $17,000** (the line-item cost-plus grand total) while the Good/Better/Best cards below show **$22,825 / $24,850 / $27,475** (per-SQ flat-rate). The cheapest tier (Good $22,825) is **$5,825 MORE** than the stated investment.
- **Expected/intent:** per estimates.js header + audit doc, the line-item sum is the *internal cost basis* and "no longer drives the customer-facing grand total" — the customer price should be the per-SQ tier. The doc headline is pulling the wrong (internal) number.
- **Impact:** customer sees two conflicting prices on one page; anchors on $17,000 then every selectable tier is higher. Confusing + undermines the quote.
- **File:** `estimate-v2-ui.js` finalize/retail-quote template (the "YOUR INVESTMENT" field source) vs the per-SQ `meta.tiers`. Confirm intended headline (selected tier? Better?) with Jo.
- **Confirms V2-1 on-screen:** the Better card renders exactly **$24,850** (the 1.25-waste over-quote), proving V2-1 reaches the customer document.

### Doc-fidelity notes (retail quote)
- ✅ Customer name/address/phone/email all flow correctly; NBD branding + `NBD-V2-…` numbering present; scope items listed.
- 🟡 Minor: doc body dated **"June 7, 2026"** but filename `NBD-Retail-Quote-2026-06-08.pdf` and today = 2026-06-08 — off-by-one (likely UTC vs local date render).

## 🔴 V2-7 — One estimate, THREE different waste factors (none correct) — **LIVE / MATH-FAIL / HIGH**
- **Observed (persisted ZZ_QA_ estimate `nJ7IU7zKJfvul74kaoeM`, 6/12 pitch):**
  - Stored/line-item path: **waste 1.17** → `adj 3510`, `sq 35.1`, `grandTotal $17,000` (this is what persists to Firestore / shows in CRM).
  - Retail-quote tier path: **waste 1.25** → sq 37.5 → tiers $22,825/$24,850/$27,475 (what the customer sees).
  - **Correct for 6/12: waste 1.15** → sq 34.5.
- **Root cause:** (a) line-item path reads `state.measurements.waste`, which is **not recomputed when the pitch dropdown changes** — it stays at the initial default (1.17 = the 8/12 value); (b) tier path recomputes from pitch but via the V2-1 mis-parse (→1.25). So three code paths, three wastes, none matching the spec table.
- **Impact:** internal cost basis, stored deal total, and customer quote all disagree on the roof's size.

## 🔴 V2-pkb — Persisted/CRM total is the line-item `$17,000`, not the per-SQ tier — **LIVE / DRIFT / HIGH**
- The saved estimate stores `grandTotal: 17000` (line-item cost-plus) and **does not persist the GBB tiers** (`tiers: none`). Per the locked spec + estimates.js header, the customer price is the **per-SQ tier** ($22,925 correct Better) — so the CRM/pipeline/reporting value ($17,000) understates the intended sell price by ~$5–8k. Ties to V2-2 (doc headline) and V2-5 (line-item understated by dead formulas).

## 🟠 V2-5 — CSP blocks the line-item formula evaluator → formula-qty items resolve to $0 — **LIVE / FUNCTION/MATH / MED-HIGH**
- **Observed (console, on quote generation):** `[EstimateLogic] Formula compile error: max(sq*0.10, eaveLf*3/100) … 'unsafe-eval' is not an allowed source` (and `eaveLf + rakeLf`, `sq>15 && sq<=25 ? 1 : 0`, etc.). The two-layer sandbox in `estimate-logic-engine.js calcQuantity` uses `new Function()`, which the prod CSP (`script-src` without `unsafe-eval`) **blocks** → each such formula throws → `return 0` quantity.
- **Impact:** any line item whose quantity is a *formula* (drip-edge `eaveLf+rakeLf`, IWS, dumpster sizing `DSP *`, ridge/vent ceilings) silently gets **qty 0 → $0**, understating the line-item total (the $17,000). Plain-variable (`sq`,`eaveLf`) and numeric quantities are unaffected (handled by shortcuts before `new Function`).
- **Proposed:** replace `new Function()` with a CSP-safe expression parser (or precompute quantities), OR (worse) relax CSP. Pricing-adjacent → propose, don't apply.

## 🟠 V2-3 — `scheduleDraftSave is not defined` → ReferenceError on every customer/claim/county edit; draft-save dead — **LIVE / FUNCTION-FAIL / MED**
- **Observed:** editing customer/claim fields or the county throws `ReferenceError: scheduleDraftSave is not defined` (`estimate-v2-ui.js:805/815/825`, also referenced at :736). State is set *before* the throw so in-session data survives, but **draft auto-save never runs** and an uncaught error fires per edit.
- **Root cause:** the debounced draft-save was renamed to `saveDraftDebounced` (defined :1524) but 4 call sites still reference the old name `scheduleDraftSave`.
- **Proposed (trivial, ready):** rename the 4 references to `saveDraftDebounced` (or add `const scheduleDraftSave = saveDraftDebounced;`). Pure ReferenceError fix, no math impact — flagged for batch deploy on Jo's OK.

## 🟠 V2-4 — Server-side doc render fails (INTERNAL), silently falls back to client render — **LIVE / FUNCTION / MED**
- **Observed (console):** `[V2 finalize] server render failed, falling back: INTERNAL` when generating the retail quote. The doc shown was the client-side fallback. Server PDF path (puppeteer/chromium cloud fn) returns INTERNAL.
- **Impact:** to confirm — if the EMAIL/DOWNLOAD PDF path relies on the server render, customer PDFs may fail or differ from preview. Investigate the cloud function error.

## 🟡 V2-6 — Retail-quote preview "Save to Customer" button click did not persist — **LIVE / FUNCTION / verify**
- Clicking the preview's "💾 Save to Customer" left `_estimates` at 5 (no record, no status). Calling `EstimateV2UI.save()` directly persisted (count → 6, "✓ Estimate saved to Firestore"). Either the preview button is a no-op/mis-wired or my click missed — **needs a clean re-test** before confirming (the underlying save path works).

## 🔴 L-1 — Chimney flash quotes $285, spec says $425 (stale localStorage defeats config unification) — **LIVE / MATH+DRIFT / HIGH**
- **Observed (live):** `EstimateBuilderV2.calculatePerSq({hasChimneyFlash:true})` adds **$285**. Confirmed: a 23-SQ Better job with chimney = **$15,525** vs spec-correct **$15,675** → **$140 under** per chimney.
- **Expected:** $425 (`NBD_ESTIMATE_CONFIG.ADDON_CHIMNEY_FLASH`, the Joe-confirmed unified value, 2026-04-25).
- **Root cause:** `loadSettings()` (estimate-builder-v2.js L410–431) merges a saved `localStorage['nbd_est_settings_v2']` snapshot **over** the config defaults: `addonPrices: Object.assign({}, defaults.addonPrices, saved.addonPrices)`. Jo's saved snapshot still carries the pre-unification `chimneyFlash: 285`, so the config's $425 never reaches him. `calculatePerSq` L506 reads `s.addonPrices.chimneyFlash`.
- **Bigger implication:** the whole config-unification ("one edit propagates to both engines", Rock 2 PR 3/4b) is **silently defeated for any user who has ever saved estimate settings** — their localStorage snapshot wins forever for tier rates, add-on prices, dump fee, permits, tax tables, etc. Currently only `chimneyFlash` is actually divergent for Jo (the rest of his snapshot happens to match), but every future config change is at risk of not propagating.
- **Proposed fix (do NOT auto-apply):** options — (a) stop snapshotting config-derived defaults into localStorage; persist only fields the user *explicitly* overrode; (b) on load, re-seed config-backed values and let saved settings override only user-touched keys; (c) one-time migration that drops stale config-derived keys (e.g. bump SETTINGS_KEY to `nbd_est_settings_v3` so old snapshots are ignored). Needs Jo's call — pricing logic + locked-spec area.
- **Interim (per-machine):** clearing `localStorage['nbd_est_settings_v2']` makes Jo's chimney read $425 immediately. (Not applied — Jo's decision.)

## 🟠 C-1 — V2 permit silently $0 for unknown jurisdiction — **LIVE / GUARDRAIL-MISSING / MED**
- **Observed:** `permits['Cincinnati']` and any non-county key → **$0** permit added silently (`calculatePerSq` L491–493: `permitInfo ? cost : 0`).
- **Expected/intent:** classic falls back to **$150** (`DEFAULT_PERMIT_COST`). A $0 permit means the roofer eats the permit cost.
- **Proposed:** add a V2 permit default (e.g. $150) and/or warn when the jurisdiction key isn't found.

## 🟠 D-1 — Permit table divergence classic↔V2 — **LIVE / DRIFT / MED**
- classic `PERMIT_COSTS` city-keyed (Cincinnati $175, Hamilton $150) vs V2 county-slug-keyed (hamilton-oh $185). Same job → different permit by engine. Audit drift #3. See ENGINE-AGREEMENT §4.

## 🟠 D-2 — Waste-from-pitch divergence classic↔V2 — **LIVE / DRIFT / MED-HIGH**
- 7 of 8 pitches differ (ENGINE-AGREEMENT §2). Same measurements → different SQ → different total depending on engine. Direction inconsistent. Audit drift #4.

## 🟡 D-3 — County-tax key-shape mismatch → silent 7% fallback — **LIVE / DRIFT / watch**
- Each engine recognizes only its own key shape ("Hamilton" vs "hamilton-oh"); wrong shape → silent 7% (ENGINE-AGREEMENT §3). **Must confirm in UI** which shape the selector emits / which engine consumes — a mismatch in prod = customers silently taxed at 7%.

## 🟡 D-4 — Extra-pipe-boot $45 (classic) vs $85 (V2) — **LIVE / DRIFT / low**
- `lookupPermitCost`-adjacent add-on: classic `window.R.pipe||45` vs V2 `extraPipeBoot:85`. $40/pipe beyond 4.

## 🟢 N-1 — No upper-bound sanity guard on absurd inputs — **LIVE / GUARDRAIL-MISSING / low**
- 1,000,000 sqft → $7.32M; 1e9 sqft → $7.32B, silently. No NaN/overflow (math is correct), but no validation warning. Negative/zero sqft clamp to $2,500 floor silently; zero/negative layers clamp to 1.

## ℹ️ N-2 — Line-item engine ignores config — **CODE / note**
- `estimate-logic-engine.js` `resolveEstimate()` hardcodes `minJob=2500/round=25/tax=0.07/OH&P` defaults, does not read `NBD_ESTIMATE_CONFIG`. Confirm in UI it never drives the customer total (it's the internal cost-basis path).

---
## ✅ What's SOLID (live-verified, V2 canonical engine)
- Per-SQ math **93/93 PASS** vs independent spec oracle (tiers, pitch buckets, job-min, rounding, layers, cut-up, add-ons, county tax, permit, insurance, edges) with config-default settings.
- 160-point sweep: **0 tier-inversions** (Best ≥ Better ≥ Good always), **0 rounding violations** (all totals multiples of $25), **0 out-of-range** (no 100× cents/dollars error).
- Job minimum floors at **$2,500** (reads as dollars). Insurance mode tax = 0. Config loaded live (`_version 2026-04-25`, not fallback).
- Tier rates live = **545 / 595 / 660** (match spec). Core formula classic==V2 on identical inputs.

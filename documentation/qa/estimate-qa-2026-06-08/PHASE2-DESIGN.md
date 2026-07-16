# Phase 2 Design — settings editor + single-per-SQ + Xactimate formats
**Run:** estimate-qa-2026-06-08 · From the Phase-2 investigation (wf_f183fe0f). **Nothing applied — design + decisions for Jo.**

## Two things the investigation surfaced (beyond the literal ask)
1. **A Settings → 📋 Estimates tab already exists** (edits tier rates, cost basis, min job, round-to, OH&P, dump, tear-off, 7 permits, 7 county taxes). The add-on rates are in the data model but have **no editor** — so Phase 2's "settings editor" is mostly *adding a panel*, not building from scratch. ([dashboard.html:10187](docs/pro/dashboard.html))
2. **The right home for editable rates is `companyProfile` (Firestore shop singleton), not localStorage.** The current rates live per-user/per-device in `localStorage nbd_est_settings_v2` + a write-only Firestore mirror (no read-back → cross-device is broken today). And that localStorage-merge-over-config **is the L-1 bug mechanism**. `companyProfile` deep-merges defaults *under* the remote doc on every load — the exact inverse of L-1 — and is already per-tenant keyed, cross-device, with a proven save path. So moving rates there **kills L-1 by design** AND makes the whole team estimate consistently.

## Also found: the Xactimate format needs V2-5 fixed first — and that's a real deal-value bug
The line-item/insurance-scope doc (`formatInsuranceScope`) is already ~complete (grouped lines, codes, qty, mat/labor split, RCV/ACV/depreciation). But **~half its line quantities compute to $0** because prod CSP blocks the `new Function()` formula evaluator (V2-5): drip-edge, ventilation, decking, IWS, dumpster sizing — exactly what an adjuster scrutinizes. **Worse: that line-item total is also the persisted CRM grandTotal**, so formula-qty $0 understates saved deal values, not just the doc. The fix is a CSP-safe arithmetic evaluator (recursive-descent over the already-whitelisted grammar) — drop-in for `calcQuantity` Layer-2; the finalizer needs zero changes once quantities compute.

## Recommended sub-PR sequence
- **2a — Foundation (no UI):** resolve rates at calc time as `companyProfile.pricing → NBD_ESTIMATE_CONFIG → fallback` (window-guarded for Node); remove addonPrices/tierRates from the localStorage merge; bump `SETTINGS_KEY → v3`. **Kills L-1 for good.** Tests prove config-default / companyProfile-override / Node-path.
- **2b — Settings editor:** add the Add-on Rates panel to the existing Estimates tab, writing to `companyProfile.pricing.addonPrices`; fix the hardcoded `+$425/+$275` checkbox labels (skylight already wrong: says $275, config is $350).
- **2c — Single Quote format:** new "📄 Single Quote" button + `formatSingleQuote` (clone retail-quote, drop the GBB cards, keep the one headline). Independent of 2a/2b.
- **2d — V2-5 CSP-safe formula evaluator:** replaces `new Function`; unblocks real line-item quantities (and fixes the understated CRM deal value).
- **2e — Xactimate polish:** with quantities real, label category subtotals "Direct Cost" / add O&P reconciliation so they foot to RCV; include pass-through 'Services' in CAT_ORDER.
- **2f (optional):** server-render (Puppeteer) parity for the single quote.

## Decisions for Jo
| # | Decision | Recommendation |
|---|---|---|
| 1 | Rates **shop-wide** (companyProfile) or **per-rep** (current)? | **Shop-wide** — consistent team pricing, cross-device, kills L-1 by design |
| 2 | Migrate stale saved settings: **bump key** (reset to defaults) or **prune**? | **Bump key** (rates moving shop-wide; one line; guarantees no L-1 relapse) |
| 3 | Single Quote: **new HTML formatter** or **server hbs**? | **New HTML** first; server parity later (2f) if wanted |
| 4 | Build order | **2a foundation first**, then 2c + 2d in parallel; if forced, **V2-5 sooner** (it's a real deal-value bug) |
| 5 | Fix hardcoded checkbox labels in the editor PR? | **Yes** (fold into 2b; skylight label already wrong) |

# Estimate Engine Deep QA — Summary & Verdicts
**Run:** estimate-qa-2026-06-08 · Tenant: NBD (tenant zero) · Mode: LIVE prod, hands-on + direct engine invocation · Nothing pricing/calc/config changed.

## Headline
The **pricing math engine is correct.** What's broken is **everything around it** — the inputs handed to it, the per-user settings layered over the config, and which of its outputs gets shown/saved. Five of the seven significant findings are HIGH severity and customer-facing.

## Two verdicts

### Math-integrity verdict: ⚠️ ENGINE SOUND, PIPELINE BROKEN
- **Engine (code vs spec): PASS.** V2 per-SQ calculator = 93/93 vs an independent spec oracle. 160-point sweep: **0 tier-inversions, 0 rounding violations, 0 unit (100×) errors.** Job-min floors at $2,500; insurance tax = 0; config loads live (`_version 2026-04-25`, not fallback); classic and V2 agree on the core formula.
- **But UI/settings ≠ intent (live):**
  - **V2-1 (HIGH):** retail-quote tiers use **waste 1.25 for every pitch** (pitch passed as rise, read as ratio) → customer **over-quoted 4–8%** ($24,850 vs correct $22,925 on a 6/12, 3000 SF Better).
  - **V2-7 (HIGH):** the *same* estimate's line-item/stored path uses a **different, stale waste (1.17)** that never recomputes on pitch change. One estimate → three waste factors (1.17 stored / 1.25 quoted / 1.15 correct).
  - **V2-pkb (HIGH):** the **persisted/CRM total is the line-item $17,000**, not the per-SQ tier — understates the intended sell price ~$5–8k and contradicts the spec.
  - **L-1 (HIGH):** chimney flash quotes **$285, not $425** — a stale `localStorage` settings snapshot overrides the unified config (and silently defeats config-propagation for any user who's saved settings).
  - **C-1 (MED):** V2 charges **$0 permit** for unknown jurisdictions; **D-1/D-2/D-3 (latent):** classic↔V2 permit & waste tables diverge.

### Doc-fidelity verdict: ⚠️ FAIL (self-contradictory customer document)
- **V2-2 (HIGH):** the generated retail quote shows headline **"YOUR INVESTMENT $17,000"** (line-item) while its own Good/Better/Best cards read **$22,825 / $24,850 / $27,475** (per-SQ). The cheapest tier is $5,825 *more* than the stated investment — one document, two irreconcilable prices.
- **V2-5 (MED-HIGH):** prod **CSP blocks the line-item formula evaluator** (`new Function()`) → formula-qty items (drip-edge, IWS, dumpster sizing…) resolve to **$0**, understating that $17,000 line-item total further.
- **V2-4 (MED):** server-side doc render returns **INTERNAL**, silently falls back to client render — confirm EMAIL/DOWNLOAD-PDF isn't broken for customers.
- ✅ Positive: customer name/address/phone/email flow correctly to the doc; NBD navy/orange branding + `NBD-V2-…` numbering present; scope items listed. Minor: doc body date "June 7" vs filename 2026-06-08.

## Functional (Axis B) — what worked
Build (ZZ_QA_) → on-screen GBB render → **save (✓ Firestore)** → **reopen/persistence (✓ survived full reload round-trip)**. Save path works via `EstimateV2UI.save()`; the retail-quote preview's "Save to Customer" button click did not persist (V2-6, needs re-test). Separate doc types (work order / warranty / receipt) not individually generated — the heavy builder modal froze the renderer twice (see INFRA); retail-quote covers doc fidelity.

## Engines & paths discovered
Three estimate paths coexist and are all reachable: **V2** (per-SQ + line-item, canonical), **classic** (4-step wizard), **"advanced"** (manual line items — the $642 record). Both V2 and classic are customer-facing (estimates carry V2/CLASSIC badges).

## Anomalies cleared (NOT bugs)
- **$642 estimate** = manual `type:"advanced"` test ("test"), $600 hand-entered + 7% tax; $2,500 min intentionally not applied to manual entry.
- **Un-rounded classic totals** ($10,263.32, $15,366.25) = legacy pre-per-SQ records; current engine rounds correctly.

## Infra (not the engine, but blocked QA)
- **INFRA-1:** the live dashboard **wouldn't boot** — a stale `/pro/sw.js` service worker wedged navigation (only the first ~5.6 KB of a 327 KB head streamed). A cache-busting *fetch* returned the full 718 KB doc, proving the server is healthy. **Unregistering the SW** recovered it (reversible; re-registers on reload). Worth checking whether real users hit this. The heavy estimate modal also froze the renderer twice mid-session (recovered by reload).

## Severity-ranked fix list → see PROPOSED-FIXES.md
- **A-1 (V2-3):** trivial — `scheduleDraftSave` undefined → ReferenceError on every field edit; ready to land on your OK.
- **B-1 (V2-1), B-2 (V2-7), B-3 (V2-pkb/V2-2), B-4 (L-1):** HIGH pricing/doc — diffs provided, **propose only.**
- **B-5 (C-1), B-6 (V2-5), B-7 (V2-4):** MED — propose only.

## Deliverables in this folder
RATE-SHEET.md · MATH-RECONCILIATION.md · ENGINE-AGREEMENT.md · BUG-LOG.md · STATUS-MATRIX.md · PROPOSED-FIXES.md · CLEANUP.md · SUMMARY.md (this)

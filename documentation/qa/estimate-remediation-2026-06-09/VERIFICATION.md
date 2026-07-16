# Estimate-Engine Remediation — Live Verification (2026-06-09)

**Tenant:** NBD (tenant zero) · **Mode:** live prod, hands-on (Chrome) + direct engine/state inspection · **ZZ_QA_ jobs only.**

## Premise correction
The mission brief described fixes to *implement*. Ground-truth check showed **all of them were already
built, merged to `origin/main`, and auto-deployed** as PRs **#580–#591** during the same
`estimate-qa-2026-06-08` session that authored the brief. This session therefore **verified the
deployed fixes** rather than re-applying them (re-applying would re-change live signed-contract numbers
— forbidden by RULE 0). Mapping:

| Brief item | Shipped as |
|---|---|
| A-1 / V2-3 `scheduleDraftSave` ReferenceError | #580 |
| V2-1 / V2-7 pitch→waste wiring | #580 |
| V2-2 / V2-pkb canonical total (Option A) | #581 |
| L-1 stale localStorage → companyProfile rates | #583 |
| V2-5 CSP-safe formula evaluator | #586 |
| V2-4 / B-7 server-PDF INTERNAL | #589 |
| D-1/D-2/D-4 classic↔V2 divergence (incl. permit) | #591 + parity test |

## What was verified live (prod, config `_version 2026-06-08`)

### 1. Waste fix (V2-1 / V2-7) — CONFIRMED
- `EstimateBuilderV2.wasteFactorForPitch(ratio)` is pitch-driven: 0.25→1.12, **0.50 (6/12)→1.15**,
  0.75→1.17, 1.0→1.20, 1.33→1.25.
- Live builder state for a 6/12 job derives `measurements.waste = 1.15` (was the constant 1.25 bug).
- Net effect on a 3000 SF / 6/12 Better job: tier = **$22,925** = the QA's predicted *correct* value,
  not the 1.25-inflated $24,850.

### 2. Canonical total (V2-2 / V2-pkb) — CONFIRMED (code + persisted + doc + reopen)
Built a ZZ_QA_ per-SQ retail estimate (3000 SF, 6/12, Hamilton-OH, tier Better) and saved it.

**Persisted Firestore record** (`estimates/CAU2i76um2FnnMorettv`):
| field | value |
|---|---|
| grandTotal (customer headline) | **$22,925** |
| prices | good $21,050 · **better $22,925** · best $25,350 |
| selectedTier | better |
| priceMode | per-sq |
| internalLineItemTotal (cost basis) | $11,650 |
| deposit (50%, $25-round) | $11,475 |

- `grandTotal === prices[selectedTier]` → **TRUE** (headline == selected card).
- `internalLineItemTotal !== grandTotal` → **TRUE** (line-item sum is now the *internal* basis, not the
  customer number).

**Rendered retail-quote doc** (through `EstimateFinalization.formatEstimate`): big-dollar figures present =
`[$11,450, $11,475, $21,050, $22,925, $25,350]`. "YOUR INVESTMENT $22,925" headline == the **Better card
($22,925, ✓ SELECTED)**. The internal cost basis ($11,650) appears **nowhere** as a customer-facing number.
Screenshot captured (builder doc-preview, srcdoc-rendered to bypass the cross-origin iframe block).

**Reopen round-trip (3B):** `openEstimateV2Builder({estimateId})` replays the saved doc faithfully —
total $22,925, prices {21050/22925/25350}, waste 1.15, scope 6, all restored. `roundTripMatches: TRUE`.

### 3. Config / engine integrity — CONFIRMED
- Live config `_version 2026-06-08` (post-fix), not fallback.
- Shipped `getCurrentEstimate()` (estimate-v2-ui.js:1332+) reads exactly per design:
  `internalLineItemTotal = line-item sum; total = selected tier total; prices = {good,better,best};
  priceMode='per-sq'; deposit = 50% of all-in tier total`.

## Not re-verified live (CI-covered at merge; offered as a deeper pass)
- **Classic 4-step wizard** and **advanced manual line-item** builders: unchanged by the headline fixes
  except #591 (classic↔V2 config unification), which shipped with `estimate-engine-parity.test.js`
  (D-1 permit defaults realigned, classic==V2 core formula). Both types remain reachable/preserved.
- Downstream consumers (dashboard-widgets, estimate-analytics, reports, portal, invoicing): the persisted
  shape now carries `grandTotal/prices/selectedTier/priceMode/internalLineItemTotal` (classic shape that
  `close-board.js` already reads), so consumers read the canonical tier total going forward.

## Full live pass — all reachable paths (2026-06-09)

### V2 doc-type variants — all coherent
- **Retail quote:** headline $22,925 == ✓SELECTED Better card == saved grandTotal (money-shot).
- **Single quote (#585):** one number $22,925 (= selected tier), **no GBB cards** (gbbCards:false); doc dollars [11450, 11475, 22925] only.
- **Internal view:** per-line cost breakdown + the $22,925 customer total (margin reference).
- **Insurance scope:** total **$10,800** = approved scope total, `priceMode:'line-item'` — correctly **NOT** the
  $22,925 retail tier (V2-2 overlay properly gated off for insurance); claim header renders (FU-1).

### Pricing guardrails
- **L-1 — FIXED:** resolved `chimneyFlash:425` (Jo's configured value, not stale $285), `skylightFlash:350`,
  from the companyProfile→config layer; stale `nbd_est_settings_v2` localStorage no longer authoritative.
- **V2-5 — FIXED:** all formula-qty line items resolve **non-zero** under prod (drip-edge 200=eave+rake,
  starter 120, ridge 40, IWS 3.6, underlayment/shingle 34.5 sq); `anyZeroQty:[]`. safeEvalFormula works.
- **C-1 — NOT reachable via the V2 UI (corrected); engine guardrail added defensively:** the V2 permit code
  is `permitInfo ? cost : 0` (a blank/off-list county → $0). **Correction:** the active V2 dropdown
  (`v2county`) has **no blank option** and defaults to `hamilton-oh` (confirmed live: `v2_matches_state:true`),
  so a V2-UI estimate always carries a valid county — C-1 is **not** UI-reachable. (My earlier "blank option"
  note was the *inactive classic* `estCounty` select coexisting in the DOM.) The engine can still receive a
  blank county via a **reopened legacy estimate** or a **programmatic** `calculateEstimate()` call → silent $0.
  Classic already defaults those to $150. Fix shipped in **PR #593** (defensive: blank/off-list → $150,
  matching classic; verified blank→150, off-list→150, hamilton→185). Blast radius ≈ nil for live UI estimates.

### Server-PDF render (V2-4) — works
- Retail quote lands as a **storage-hosted PDF** (`storage.googleapis.com/...firebasestorage`), the server-render
  upload path; no console render errors. Consistent with PR #589's documented `renderPdf` ok:true live-verify.

### Classic + advanced types — preserved & coherent (regression clean)
- Type selector offers all three: **Per-SQ (V2), Classic, Custom Builder (advanced)**.
- Live estimates list holds all three with coherent totals (allCoherent:true, zero NaN/null/negative):
  v2 ×3 ($22,925/$7,575/$8,575), classic ×2 ($10,263.32/$15,366.25 — legacy un-rounded pre-per-SQ, not bugs),
  advanced ×1 ($642 manual test).
- **D-1 (permit):** classic `lookupPermitCost` realigned to county values (Cincinnati→185=Hamilton Co, Mason→165)
  with $150 default for unknowns.
- **D-2 (waste):** classic `recommendedWasteForPitch(slopeFactor)` delegates to V2's `wasteFactorForPitch`
  (4/12 & 9/12 match exactly; 6/12 & 12/12 differ ≤0.05 — float round-trip at exact bracket boundaries, not a
  pricing divergence). CI `estimate-engine-parity.test.js` (22) green.

### Doc-preview renderer freeze + "blocked by Chrome" → FIXED (PR #594)
- The estimate doc-preview embedded a cross-origin Firebase-Storage PDF in an iframe → Chrome/Brave blocked it
  ("This page has been blocked") and it **froze the renderer** twice mid-session. Root-caused in
  `NBDDocViewer.open()`: a server-PDF `url` was set as `iframe.src`. **PR #594** previews the same-origin
  HTML (srcdoc, never blocked) and routes the server PDF to Download (new tab). The "heavy modal freezes
  renderer" symptom was this cross-origin PDF embed.

## Verdict
The shipped estimate fixes **hold in production** across every reachable path. The self-contradictory quote
($17k headline vs $22–27k cards) is resolved to a single coherent number ($22,925 headline == selected Better
card == saved grandTotal). Waste correct & pitch-driven; L-1/V2-5 fixed; insurance/single/internal/retail docs
each internally coherent; server-PDF works; all three estimate types preserved & coherent.

**Follow-ups from the live pass (all addressed):**
- **Doc-preview block/freeze** → **PR #594** (preview same-origin HTML, download = server PDF).
- **C-1 permit guardrail** → **PR #593** (defensive: blank/off-list county → $150, matching classic; NOT
  UI-reachable in V2, so ~nil blast radius on live estimates).
- **C-1 county UI desync** → **non-issue**: the V2 `v2county` dropdown has no blank option and defaults to
  hamilton-oh (the blank/desync was the inactive *classic* `estCounty` select in the DOM).
- **IAM grant** ([IAM-RUNBOOK.md](IAM-RUNBOOK.md)) and **launch blockers** ([LAUNCH-BLOCKERS.md](LAUNCH-BLOCKERS.md))
  written up for Jo/devops.

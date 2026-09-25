# Deposit rule — one function, every surface (2026-09-25)

**Branch:** `fix/deposit-rule` · **Suite:** `tests/deposit-rule.test.js` (node bucket)

## The rule (Jo, 2026-09-25 — authoritative)

- **Cash, under $2,000 total:** no deposit — payment due on completion.
- **Cash, $2,000 and up:** 50% deposit at signing, balance on completion.
- **Insurance claim:** the homeowner's **deductible** plus the insurance **ACV
  payment** (the carrier's first check), both up front when possible; the
  minimum is the deductible. The deductible is always collected — never
  waived, reduced, rebated or absorbed (illegal in OH/KY). ACV not known yet →
  the deposit shown is the deductible and the copy says the ACV payment is due
  when the carrier releases it.

## What the app said before

Five different answers were live at once, and they contradicted each other on
the same job:

| Surface | Said |
|---|---|
| V2 on-screen Retail / Single Quote | its own 50/50 fallback; insurance `$0` |
| Server Retail Quote PDF | hard-coded `depositPct: 25` → "25% at contract signing" |
| Invoice from estimate | the saved deposit, else `total * 0.5`; terms "50% deposit due upon scheduling" |
| Job Templates | saved `deposit: null` → invoice fell back to 50% (a $555 repair asked $277.50) |
| Contract (pre-flight + server) | `jobValue × 0.5`, "Typically 50%", and a "Fifty percent (50%)" literal |
| Company profile defaults | "Fifty percent (50%) due upon contract execution…" |
| Document Library blank contract | "50% due at material delivery" |
| Close Board deal page | no deposit; insurance box "you typically only pay your deductible" |
| Rep training / playbook | "Zero deposit. Your insurance pays us after completion"; "50/50 deposit structure" on an insurance job |

## Design

- **`docs/pro/js/deposit-rule.js`** (`window.NBDDepositRule`, also
  `module.exports`) is the only place a deposit is computed. `compute()` takes
  the total, mode, deductible, ACV and an optional rep override;
  `fromEstimate()` reads any saved estimate shape (classic / V2 / Job Template)
  and falls back to the lead's deductible. Integer cents throughout;
  `deposit + balance === total` by construction.
- **Thresholds** live in `NBD_ESTIMATE_CONFIG.DEPOSIT_RULE`
  (`estimate-config.js`). `customer.html` loads no config, so the module
  carries the same `DEFAULTS`; the suite pins the two equal.
- **Rounding:** the 50% rounds to the nearest $25 (the grand-total step the
  engines already used, spec D-5) — $6,988.13 → $3,500 / $3,488.13. Insurance
  figures are exact: rounding a deductible would reduce it.
- **ACV** means the carrier scope's ACV line (RCV − depreciation, before the
  deductible) — the `acv` field the classic builder, V2's claim block and the
  insurance scope already carried. The first check is ACV − deductible, so
  "deductible + ACV check" is the ACV itself whenever it exceeds the deductible.
- **Server surfaces don't run the rule.** V2, classic and Job Templates stamp
  a display-only `depositPlan` (strings + cents, no cost, no rep note) on the
  saved estimate; `functions/deposit-plan-view.js` validates it (cents foot,
  total still matches the estimate — a stale stamp prints nothing) before the
  portal and `/pro/estimate-view` show it.
- **Invoices never trust a saved deposit amount** — they recompute from the
  rule on the invoice total (which folds in supplements). Only a stored rep
  override is honored. An estimate saved under the old 50/50 / 0% logic gets
  the rule, not its stale number.
- **Rep overrides kept and labelled:** the classic builder's "Override %"
  (now "Rep override %", blank = back to the rule) and doc pre-flight's
  editable Deposit Amount. The rep surfaces print "Rep override — the deposit
  rule would ask $X". On a claim an override can never go below the deductible
  (it is raised to it), and a $0 override on a claim with no deductible entered
  is ignored.
- **V2's $2,500 placeholder deductible is gone.** Once the deductible drives
  the deposit, that placeholder would have printed "Your $2,500 deductible is
  due at signing" on a homeowner's quote nobody entered a deductible for.
  Unset now prints "Your insurance deductible is due at signing" (no number)
  and the builder warns the rep. V2 also gained an ACV input.

## Inventory — every site, before → after

| Site (after this change) | Before | After |
|---|---|---|
| `docs/pro/js/deposit-rule.js` (new) | — | THE rule: `compute` / `fromEstimate` / `toStored` / `policyText` |
| `docs/pro/js/estimate-config.js` `DEPOSIT_RULE` | — | thresholds: $2,000 / 50% / $25 step |
| `docs/pro/js/estimate-builder-v2.js:509` `calcDeposit` | own copy: cash 50%, insurance $0 | thin adapter over the rule (engine results + classic) |
| `docs/pro/js/estimates.js:513,1176` classic builder | "Cash 50/50, Insurance 0%"; cent-rounding fallback copy | rule with claim figures; "Rep override %" (blank = rule); saves `depositPlan` |
| `docs/pro/js/estimate-v2-ui.js:2656-2700` `_stampDeposit` | per-SQ only: `insurance ? 0 : round(total*0.5/25)*25`; line-item: none | every estimate stamped from the rule + live claim; builder deposit line |
| `docs/pro/js/estimate-v2-ui.js:3783` server payload | `depositPct: 25` | `terms.deposit` = the plan (label, value, sentence) |
| `docs/pro/js/estimate-v2-ui.js:3961` save payload | `deposit` (old logic) | `deposit` + `depositPlan` |
| `docs/pro/js/estimate-v2-ui.js:146,4171,4293` claim | `deductible: 2500` placeholder; no ACV input; reopen kept the saved deposit | `null`; ACV input; reopen re-stamps |
| `functions/print/templates/estimate.hbs:153,178` | "{{depositPct}}% at contract signing" | the plan's label / value + "Payment terms:" sentence |
| `docs/pro/js/estimate-finalization.js:886` Retail / Single Quote | 50/50 fallback, "Deposit (NN% — Upon signing)" | the plan's stages + sentence |
| `docs/pro/js/invoice-pipeline.js:571,610` | saved deposit else `total*0.5`; "50% deposit due upon scheduling" | rule on the invoice total (lead deductible fallback); terms = the sentence |
| `docs/pro/js/job-templates.js:1138,1222` | `deposit: meta.deposit` (always null) | rule; `depositPlan` saved |
| `docs/pro/js/doc-preflight.js:290,296,476,2405` contract | `jobValue*0.5`; "Typically 50%"; 50% literal | rule prefill + sentence; edited amount = override; retired prefills not revived |
| `docs/pro/js/document-generator.js:960,992` server contract | "Fifty percent (50%)…" default; no schedule table | Payment Schedule rows from the plan; terms = sentence |
| `docs/pro/js/document-generator.js:2211` proposal | company-profile text | the job's sentence when priced |
| `functions/print/templates/contract.hbs:59` | amounts only | prints `amountText` for a stage with no fixed amount |
| `docs/pro/js/company-profile.js:107` defaults | "Fifty percent (50%)…" | the rule's `policyText()` |
| `docs/pro/js/dashboard-ui.js:1380` blank contract | "50% due at material delivery" | the rule's `policyText()` |
| `docs/pro/js/close-board.js:645,740,766` | no deposit; "you typically only pay your deductible" | per-tier "Due at signing: $X"; insurance box = the rule's terms |
| `functions/deposit-plan-view.js` (new) + `functions/portal.js:1017,2547` | no deposit on portal / estimate-view | validated stamp whitelisted |
| `docs/pro/js/portal.js:756`, `docs/pro/js/estimate-view.js:297` | nothing | "Due at signing" + sentence; stage list |
| `docs/pro/js/sales-training-engine.js:1191` | "Zero deposit. Your insurance pays us… after completion" | nothing due before a signed contract; deductible the only out-of-pocket on a claim |
| `docs/pro/js/decision-engine.js:150` | "50/50 deposit structure" (insurance playbook) | deductible at signing, ACV check when released, balance on completion |
| `functions/stripe.js:1273` comment | "50% deposit due upon scheduling" | points at the rule |
| `docs/pro/js/sandbox-demo.js:141` | "50% deposit" on $8,450–$15,900 demo tiers | **unchanged** — already the rule for cash ≥ $2,000 |

## Tests

`tests/deposit-rule.test.js` — a table (cash $1,999.99 / $2,000.00 / $6,988.13;
insurance deductible only; deductible + ACV; deductible above the total;
deductible blank; deductible 0) run through the REAL code: V2 rehydrate →
`effectiveEstimate()` stamping, the on-screen Retail + Single Quote, the server
payload compiled through the real `estimate.hbs` with `render-pdf.js`'s
helpers, V2's save payload, `createInvoiceFromEstimate` (fresh doc AND a
pre-rule doc carrying a stale 50/50 deposit), the portal whitelist →
`estimate-view.js` → portal card, doc pre-flight → server contract payload →
real `contract.hbs`, the Close Board page, the Job Templates payload and the
engine adapter. Expected figures are hand-written, never computed by the rule.

Break-tested (each mutation restored byte-for-byte): reverting the rule to the
old 50/50 + $0 → 163 reds across every surface; the config threshold → 34;
the server payload back to `depositPct: 25` → 26 (D); the on-screen 50/50 → 24
(C); the invoice's "saved else 50%" → 7 (F, via the pre-rule doc — the fresh
doc alone could not see it, which is why that case exists); the portal
whitelist → 40 (G); the contract prefill → 20 (H); V2 re-stamping → 10 (B);
Close Board → 8 (I); `estimate.hbs` → 17 (D); Job Templates → 8 (J);
estimate-view → 16 (G).

## Open for Jo

- **Company Profile overrides.** If Settings → Company Profile ever saved the
  old "Fifty percent (50%)…" text as an explicit override (possible only
  before the diff-against-default save fix), it still wins over the new
  default. Worth one look at the Payment Terms fields.
- **Estimates saved before this change** show no deposit line in the portal /
  estimate-view until re-saved (the server can only print a stamp the builder
  wrote). Invoices, quotes and contracts recompute and are correct either way.
- **The 50% rounds to the nearest $25** ($5,275 → $2,650, i.e. 50.2%) —
  kept from the D-5 spec for continuity. Say the word if it should round to
  the dollar, or always down.
- **Close Board deals carry no ACV field**, so their cards show the
  deductible (the rule's ACV-not-known-yet answer).
- The rep-filled **Payment Agreement** document still defaults its first
  installment's due text to "Upon contract signing" even when the rule's
  deposit is $0.

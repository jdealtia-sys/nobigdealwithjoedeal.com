# SESSION 2026-08-17 — Financing benefits messaging ("don't shrink the project")

Jo saw an Improvifi post ("sell the outcome, not just the price" — a $12,000
fence at $104/mo vs. the $5,500 fence you settle for with cash) and asked to
make sure the site really lands the *benefit* of financing, not just the
mechanics. This session audited every financing surface and shipped the
outcome-framing where it was missing.

## Audit — where financing messaging stood

| Surface | Before |
|---|---|
| `/services/financing` | Strong on **mechanics** (soft pull, marketplace, no home equity, payment estimator, FAQ, compliance small print) — but no outcome argument: *why* a payment beats sizing the project to this month's cash. |
| `/estimate` results card | The price-shock moment. Showed `$13,300 – $14,900` with **zero** payment framing and no financing link. Biggest gap. |
| Homepage | Acorn partner card + financing FAQ — fine, untouched. |
| `/services/roof-replacement` | "Financing Available" trust chip; the cost FAQ answered honestly but stopped short of the payment option. |
| Blog | The two financing posts (July 2026, PR #1224 restamp) are excellent and set the tone rules: never quote "your" rate, "my price is my price," no streaming-subscription-payment sleaze. |

## What shipped

1. **`/services/financing` — "Don't Shrink the Project. Shrink the Payment."**
   New comparison section (scoped `oc-*` styles) between the mid-page CTA and
   the payment estimator: settle-card ("sized to today's cash," $350–$2,500
   per patch on a dying roof, ✕ bullets) **vs** want-card ("sized to what the
   house needs," the typical $14,000 architectural replacement at
   **$197–$270/mo illustrative**, ✓ bullets), pull-quote ("the most expensive
   roof is the one you pay for twice"), bridge into the estimator, full
   disclosure line. Plus one new FAQ (visible + FAQPage JSON-LD, kept in
   sync): "Wouldn't a cheap repair now be smarter than financing a
   replacement?" — which also honors the repair-when-it's-right promise.
2. **`/estimate` results card — monthly line under the price.**
   `or about $187 – $288 per month with financing*` + link
   ("Don't shrink the project — see how financing works →") + small-print
   disclosure. Rendered by `renderMonthlyLine()` in
   `docs/assets/js/inline/4053149b2f.js`; updates on tier switch; **hidden**
   for storm-damage (that range is a deductible, keeps its own framing) and
   for sub-$3k projects (financing-page FAQ floor). The emailed estimate
   summary mirrors the same line + hide rules.
3. **`/services/roof-replacement` cost FAQ** — appended the financing
   sentence to both the visible answer and its JSON-LD mirror.

## Honest-numbers rules (keep these on future financing copy)

- **One APR truth site-wide:** Acorn's published 11.49–19.99% band, 2–15 yr.
  The Improvifi post's 6.4%/15yr math is NOT usable here — never borrow a
  competitor graphic's rate. All monthly figures shown use the identical
  amortization formula as `financing-estimator.js`, so the on-page estimator
  reproduces every advertised number exactly ($14,000 / 10 yr → $197–$270).
- Example figures come from the estimate tool's own PRICING table (20 sq ×
  $665–745 better tier ≈ $13,300–$14,900; repairs $350–$2,500) — retail
  prices, fine to publish; never cost/margin keys.
- Every payment figure carries not-an-offer/lender-decides disclosure within
  eyeshot, and repair-when-it's-right stays in the same breath as any
  replace-vs-patch argument (blog tone contract).

## Verification

- All gates green: `check-js-syntax` (466 files), `check-site-integrity`
  (0 failures), `apply-partials --check` (clean), `check-inline-html-scripts`
  (0 inline), `marketing-polish-contract` (51/51), `build-sitemap` (no drift).
- Playwright render check (desktop + 390px mobile + results card): grid,
  VS chip, ✕/✓ bullets, monthly line `$187 – $288` (matches hand calc), and
  the sub-$3k hide rule all confirmed in a real browser.

## Follow-ups (small, deliberately not done here)

- **Measure it:** the results-card financing link and the comparison-section
  pre-qualify CTA have no GA event; add `trackEvent`/`data-action` wiring in
  a future pass so Jo can see whether the framing moves clicks.
- City-clone service pages (~100 files) still carry only the nav/footer
  financing link — fine for now; revisit only if the hub-page framing proves
  itself in GA.
- Blog cross-link: the two financing posts could link the new comparison
  section as their "see the math" anchor.

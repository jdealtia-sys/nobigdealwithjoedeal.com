# NEXT SESSION — 2026-08-19

Standing handoff. Supersedes [NEXT_SESSION-2026-08-17](NEXT_SESSION-2026-08-17.md)
for the cost lane; the backlinks/AEO lanes in that note are untouched and still open.

---

## 0. Read this first — the branch is not in a PR

`qc/site-sweep-2026-08-18` carries **42 commits that are not on `main` and not in
any open pull request** (25 dated 08-18, 17 dated 08-19). Everything below is on
that branch and nowhere else. Opening the PR is the first action of the next
session unless Jo has done it.

---

## 1. What shipped today

### The cost-leak lane closed out

- **PR-C** — in-product job-template cost editor, gated.
- **Rotation ledger** replaced `KNOWN_UNMIGRATED`: one row per catalog, keyed off
  `functions/cost-basis-registry.js`, printing `ROTATION OUTSTANDING` on every
  green run until a signed human paste says otherwise (`tests/cost-basis-ledger.js`).
- **`scripts/import-cost-rotation.js --correction`** — fix a drifted cost line
  without claiming a rotation. A rotation-stamped seed is refused under
  `--correction`; an unstamped seed is still refused on the normal path.
- **CI**: the `qc-render-sweep` gate had never actually run — playwright was
  installed unpinned, colliding with `@playwright/test`. Fixed to the house pattern.

### A finding in the opposite direction — and its fix

[CATALOG-UNDER-COST-2026-08-19](../audit/CATALOG-UNDER-COST-2026-08-19.md) is the
note to read. Four published lines are priced BELOW supplier cost, one at negative
margin after markup. Correction seed is written and waiting (§3).

### Three money fixes in the estimator

| what | commit | effect |
|---|---|---|
| `MAT DEL` line + wired into 16 reroof templates | `ef32d59a`, `4e84cedf` | +1.8–3.2% per reroof — delivery the shop was paying and not recovering |
| Per-SQ add-on cost was a blanket 40% of charge | `bf6f6ffc` | margin was overstated by several hundred dollars/job; permit and dump fee are pass-throughs, not 60%-margin items |
| Per-SQ bills material delivery | `d853f0b1`, `14fe528c` | $412.50 flat/job, matching line-item to the cent |

---

## 2. Two things worth knowing before touching this code

**Per-SQ add-on prices are the FINAL charged figure.** `overheadPct`, `profitPct`
and `materialMarkupPct` are read only inside `calculateLineItem` — `calculatePerSq`
applies none of them. So anything that exists in BOTH modes must be priced in
per-SQ at the already-marked-up number, not at catalog cost, or the two modes
quote the same job differently. This is why delivery is $412.50 and not $275.

**Tier rates exclude delivery — Jo confirmed, 2026-08-19.** `TIER_RATES`
(545/595/660 per SQ) cover materials + labour + OH&P and assume delivery is billed
separately. Nothing in the code records this and the natural reading of a retail
per-square rate is the opposite. Ask the same question of anything else flat and
per-job before billing it in per-SQ.

**A cost RATIO on an editable charge is a trap.** The add-on reducer scales the
ratio by the CHARGED cents, and add-on prices are shop-editable via
`companyProfile.pricing.addonPrices`. Any fixed fraction lets a shop that
discounted the job silently book less cost than the supplier invoices. Delivery's
cost is therefore pinned to its baseline and the ratio derived per call.

---

## 3. Jo's queue — none of this is Claude's to run

1. **Rotation. Still the blocking prerequisite for all of Phase 2.** 974 cells
   across three worksheets. The mechanism ships with every refusal path asserted;
   the numbers are Jo's and cannot be invented. See
   [PHASE2-PUBLISHED-COST-BASIS-BRIEF-2026-08-18](PHASE2-PUBLISHED-COST-BASIS-BRIEF-2026-08-18.md) §8.
2. **Import the correction seed** — `.local/correction-xact.seed.json` via
   `scripts/import-cost-rotation.js --correction`. Fixes the four under-cost
   lines. Basis is sales tax only (Jo's call); delivery is carried at job level
   by `MAT DEL` instead of loaded into unit cost.
3. **Refresh the supplier quotes** — both expired 2026-06-10. The mapping file
   makes it a re-run rather than a re-derivation.
4. **One call to SRS/ABC** closes the three unconvertible lines: LF-per-bundle for
   Seal-A-Ridge ridge cap, and nails-per-square for the two nail lines.
5. **Sanity-check the delivery charge against one recent job** before a per-SQ
   quote goes out. It is on a branch, not deployed.

---

## 4. Known-open, not started

- **Only 17 of 276 xactimate lines could be price-checked.** There may be more
  under-cost lines among the 259 unchecked. No conclusion here should be read as
  "only four".
- **No labor rate source exists anywhere in Drive** — searched. Whether labor is
  similarly drifted is unknown and uncheckable today.
- **Classic (`docs/pro/js/estimates.js`) bills no delivery at all.** Only per-SQ
  and line-item were brought into line; classic is deprecated but still reachable.
- The `addonCostRatios` map has no editor UI. It is settable programmatically and
  merges through `loadSettings`, but a shop cannot type into it.

---

## 5. Session-mechanics notes

- The `qc-render-sweep` gate now runs for the first time. Watch its first few runs
  — it has no baseline history.
- `build-sitemap` still exits 1 on a clean Windows checkout for EOL reasons alone.
  Green on CI. Don't chase it.
- Three guards this week were defeated by their own allowlists. Layer 3 of
  `catalog-cost-privacy.test.js` now scans by default over all 608 published
  files instead. Prefer scan-by-default with narrow, non-vacuous exemptions.

# SESSION 2026-08-19 — closing the cost lane, and the money it was hiding

Archive of the day the two-day cost-migration lane finished: PR-C, the rotation
ledger, a correction path, and then three money bugs that only became visible
once the leak work forced someone to read the pricing code closely. Ends with
[#1264](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1264)
merged (`ebd673b8`, 44 commits) and verified live.

Forward brief: [NEXT_SESSION-2026-08-19](NEXT_SESSION-2026-08-19.md).
The money findings and their fixes: [CATALOG-UNDER-COST-2026-08-19](../audit/CATALOG-UNDER-COST-2026-08-19.md).

---

## 1. What shipped

**Finishing the leak lane** — PR-C (in-product job-template cost editor, gated);
`tests/cost-basis-ledger.js` replacing `KNOWN_UNMIGRATED` with a per-catalog
ledger that prints `ROTATION OUTSTANDING` on every green run; and
`import-cost-rotation.js --correction`, a path to fix a drifted cost line
*without* claiming a rotation — a rotation-stamped seed is refused under
`--correction`, and an unstamped seed is still refused on the normal path.

**A finding pointing the other way.** Mapping supplier prices into the rotation
worksheets showed four published lines priced **below** supplier cost, one at
negative margin after markup. Implied load factors span 4.7× with four under 1.0,
which no waste-and-delivery load can produce — so the published catalog is a
drifted generic baseline, not NBD's cost basis. That corroborates the Phase-2
brief from the opposite direction and is *reassuring* for the leak.

**Three money bugs**, each found by pulling the thread of the one before it:

| bug | fix |
|---|---|
| Nothing billed supplier delivery at all | `MAT DEL` catalog line + wired into 16 reroof templates as a singleton |
| Per-SQ costed every add-on at a blanket 40% of charge | Per-add-on ratios; the permit is remitted to the county in full and the dump fee is the hauler's invoice |
| Per-SQ billed no delivery | $412.50 flat per job, matching line-item to the cent |

---

## 2. The three things worth carrying forward

### Per-SQ and line-item apply markup differently, and nothing said so

`overheadPct`, `profitPct` and `materialMarkupPct` are read **only** inside
`calculateLineItem`. `calculatePerSq` applies none of them — its add-on prices
ARE the charged figure. So anything existing in both modes must be priced in
per-SQ at the already-marked-up number or the two modes quote the same job
differently. This is the whole reason delivery is $412.50 and not $275, and it
was not written down anywhere before this session.

### A cost RATIO on an editable charge is a trap

The natural fix for delivery's cost was a fixed ratio (275/412.50 = 0.6667). It
is wrong. The add-on reducer scales the ratio by the **charged** cents, and
add-on prices are shop-editable via `companyProfile.pricing.addonPrices` — so any
fixed fraction lets a shop that discounted the job silently book *less* cost than
the supplier invoices. That is the same overstate-margin defect the 40% fix had
just removed, recreated on a new key. Cost is pinned to the baseline instead and
the ratio derived per call. **This was caught by an adversarial review pass, not
by writing the code carefully.**

### `Number('')` and `Number(null)` are both `0`

The first override reader accepted any finite number, so a blank ratio field
would have read as "this add-on costs nothing" — understating cost, the exact
defect being fixed. Caught by a test written in the same commit. The codebase
already had this rule (`applyCompanyPricing`'s `sane()`, the L-1 kill); the fix
was to mirror it rather than invent a new one.

---

## 3. Process notes

**A gate that had never run.** `qc-render-sweep` installed playwright unpinned,
colliding with `@playwright/test`; the job "passed" while doing nothing. Fixed to
the house pattern — it now renders 218 pages at 1280px + 390px. That is the
fourth guard in three days defeated by its own configuration, after the three
allowlist failures logged on 08-18.

**Verify deploys against production, not the check mark.** The deploy went green;
the leak closure was confirmed by fetching `job-templates-data.js` from
`nobigdealwithjoedeal.com` and counting zero `materialCost` / zero `laborCost`.
Given three documented false-green deploy modes, the green check is a prompt to
verify, not a substitute for it.

**Mutation-test money fixes.** Every fix here was reverted deliberately to watch
the new assertions fail — 8/9/1 for the 40% fix, 2/1/3/6/2 for delivery. Twice
the mutation run found the guard was weaker than it looked.

**A harness can lie about the product.** A bare `{code:'MAT DEL', qty:1}`
resolved to quantity **0**, which looked like a shipped bug billing nothing. It
was the harness: `qty` is not the override field, and `job-templates.js` maps it
to `qtyOverride`. Hydrate from the catalog before measuring, or you measure zero
and blame the code.

---

## 4. Left open, deliberately

- **Rotation.** 974 cells; the mechanism ships with every refusal path asserted,
  the numbers are Jo's. Blocking prerequisite for all of Phase 2.
- **`.local/correction-xact.seed.json`** — the four under-cost lines, waiting for
  `--correction` against prod.
- **Supplier quotes expired 2026-06-10**; three lines unconvertible without one
  call to SRS/ABC (LF-per-bundle for ridge cap, nails-per-square).
- **Only 17 of 276 xactimate lines were price-checkable.** There may be more
  under-cost lines among the 259 unchecked — "only four" is not a finding.
- **No labor rate source exists anywhere in Drive.** Whether labor has drifted
  the same way is unknown and uncheckable today.
- **Classic (`docs/pro/js/estimates.js`) still bills no delivery.** Only per-SQ
  and line-item were brought into line.
- **`addonCostRatios` has no editor UI** — settable programmatically, merges
  through `loadSettings`, but a shop cannot type into it.

# Published catalog costs have drifted BELOW supplier cost — 2026-08-19

Found while trying to transcribe real figures into the Phase-2 rotation
worksheets ([PHASE2-PUBLISHED-COST-BASIS-BRIEF-2026-08-18](../projects/PHASE2-PUBLISHED-COST-BASIS-BRIEF-2026-08-18.md)).
It is not a leak and not a privacy finding — it is the opposite failure, and it
costs money on every estimate.

> **The figures are deliberately not reproduced here.** `documentation/` sits in
> the same public repo as `docs/`, so an audit that quotes supplier pricing
> republishes it — the rule established when the cost-leak notes were redacted
> (`c8793e2f`, 2026-08-18) and extended to test fixtures a day later. The
> numbers, the per-line pack math and the per-job impact are in
> `.local/UNDER-COST-LINES.md` and `.local/PROPOSED-material-mapping.csv`, both
> gitignored. The method below re-derives all of it.

## What was found

Four line items in `docs/pro/js/estimate-catalog-xactimate.js` publish a
material cost **lower than the supplier currently charges**:

| code | item | consequence |
|---|---|---|
| `RFG BOX-STD` | Box / turtle vent | **quoted below cost** — the 25% material markup does not cover the gap, so the line loses money before overhead |
| `RFG RIDG-VNT` | Ridge vent | effectively zero margin per LF |
| `RFG 240-GAF-HD` | Standard-tier architectural shingle | margin intact but materially eroded, and it is the largest line on a Standard reroof |
| `RFG 240-GAF-HDZ` | Preferred-tier shingle | margin eroded |

On one typical-house reroof at the engine's default context, the under-costed
material runs to roughly **a few hundred dollars on a Standard-tier job** and
about a third of that on Preferred. The two shingle lines are alternatives — one
per job — so they do not both apply.

`RFG BOX-STD` is the one that matters most in kind rather than size: it is not
thin margin, it is **negative** margin. Every estimate carrying box vents
charges the homeowner less than NBD pays.

## Why this surfaced now, and what it says about the catalog

The rotation work needed the published figures mapped back to their real
supplier prices. Doing that produced an implied "load factor" per line
(published ÷ bare supplier price). If the published catalog were supplier cost
plus waste and delivery — the stated basis — those factors would cluster
somewhere around 1.1–1.3.

**They do not.** Across the 17 lines that could be checked the factors span a
**4.7× range**, with four of them **below 1.0**, which no waste-and-delivery
load can produce. Starter strip and gutter apron sit at the top of the range;
the four above sit under it.

So the published figures are not a transformation of NBD's supplier pricing at
all. They are a **generic regional baseline** that has drifted — which is
exactly what the Phase-2 brief concluded independently, and what
`tests/cost-basis-ledger.js` now states on every green run. This finding is
corroboration from the opposite direction: the catalog cannot be NBD's live
cost basis, because parts of it are below what NBD pays.

That is reassuring for the leak (the published figures are less sensitive than
feared) and expensive for the business (they are also less correct).

## Scope and limits — read before acting

- **Only 17 of 276 xactimate lines could be checked.** The supplier sheet
  covers GAF / CertainTeed / Lomanco / Roofivent; the catalog also carries
  TAMKO, Owens Corning, IKO, cedar and copper lines it never quotes. **There may
  be more under-cost lines among the 259 unchecked**, and no conclusion here
  should be read as "only four".
- The supplier quotes **expired 2026-06-10**. They were current in May; refresh
  before repricing off them.
- Material only. **No labor rate source exists anywhere in Drive** — searched
  for rate cards, per-man-hour, crew and production rates; the only hits are
  per-customer margin sheets and individual estimates. Whether labor is
  similarly drifted is unknown and uncheckable today.
- One mapping is unconfirmed: the catalog's Standard-tier shingle is labelled
  "HD" while the supplier sheet quotes "NS". Assumed the same line.

## Method

1. `node scripts/cost-rotation.js --catalog xact --worksheet` — current published figures
2. Map catalog code → supplier product using the supplier sheet's own
   **Buying Strategy** tab, which names the product bought per role and tier.
   This is the bridge: the catalog is brand-generic, the sheet brand-specific.
3. Convert pack units to catalog units (roll→SQ, 10-foot piece→LF, 100/bundle→EA)
4. Resolve each line through `EstimateLogic.resolveEstimate` at the default
   context for quantity, then compare published × markup against actual spend

## Recommended

Independent of rotation, and cheaper than it:

1. **Reprice the four**, `RFG BOX-STD` first — it is the only one currently
   losing money per unit.
2. **Refresh the supplier quotes** (both expired 06/10) and re-run the
   comparison; the mapping file makes it a re-run rather than a re-derivation.
3. **Widen the check** to the 259 unchecked lines as quotes become available
   for those brands.
4. Three lines could not be converted at all from what the sheet states — ridge
   cap (bundles-per-pallet given, not LF-per-bundle) and the two nail lines
   (priced per box, catalog per SQ). One call to the SRS/ABC contacts closes
   those.

## Update 2026-08-19 — corrections prepared, and a delivery line added

**Correction path built.** `scripts/import-cost-rotation.js --correction` writes
named keys to the tenant book and deliberately does NOT touch
`tests/cost-basis-ledger.js`. A rotation-stamped seed is refused under
`--correction`, and an unstamped seed is still refused on the normal path.

**Basis: sales tax only.** Jo's call. Corrected value = bare supplier price x
1.06. Delivery and fuel are excluded from the unit cost and carried at job level
instead; waste stays excluded because the engine applies it to QUANTITY.
All four lines now clear cost — the box vent goes from a per-unit loss to a
healthy margin.

**New line: `MAT DEL` — Material Delivery & Fuel Surcharge (JOB).** Taking
delivery out of the unit load only works if it is billed somewhere, and it was
not: `LAB MOB` is CREW mobilization and the `DSP *` lines are waste going OUT.
There was no line for materials coming IN, so supplier delivery came straight
out of margin on every job. It carries the material markup, consistent with how
dumpsters and permits already behave in this catalog.

Its figure is a BASELINE like every other cost in this file — a plausible
regional two-supplier trip, not any company's negotiated rate. A tenant's real
delivery cost belongs in `catalogCosts/{companyId}.xactCosts`, where
`NBD_XACT_CATALOG.find()` overlays it.

**Wired into the reroof templates** (same day, Jo's call): the 10
`roof_replacement` entries plus the 6 `specialty_roofing` replacements, 16 in
all. Measured impact +1.8% to +3.2% per reroof — delivery the shop was already
paying and not recovering. It is a SINGLETON, so merging two reroofs into one
estimate bills one trip rather than two; the dedupe is asserted against two
reroofs specifically, because the generic multi-select check uses two repairs
which carry no `MAT DEL` and would have passed vacuously.

It is APPENDED at the end of each `items[]`, never inserted mid-array. Cost keys
are `jt-<slug>-<INDEX>`, so shifting an existing index re-keys that item and
orphans the tenant's cost-book entry — the first attempt inserted after
`LAB MOB` and orphaned 7 keys across the specialty reroofs, caught by the frozen
key-set assertion in `tests/job-template-cost-seed.test.js`. Appending moves
nothing.

## Update 2026-08-19 — the per-SQ path has the same gap, and a bigger one beside it

`MAT DEL` covers line-item mode only. Checking the per-SQ path
(`EstimateBuilderV2.calculatePerSq`) found two things.

**1. Per-SQ bills no delivery either, and folding it into the cost basis cannot
work.** Per-SQ already bills flat per-job add-ons — permit and dump fee — so the
shape exists; delivery simply is not one of them. The only cost input is
`costBasis[tier]`, a single **per-SQ** number, and delivery is a **flat per-job**
charge. Amortising a flat charge over a per-SQ basis is right at exactly one job
size and wrong either side of it: sized for a 20-SQ job it under-recovers by half
on a 10-SQ roof and over-recovers by the full amount again on a 40-SQ one.

So delivery belongs in per-SQ as a flat add-on beside permit and dump fee, not
inside the per-SQ cost basis. That is a settings-UI change (a new add-on price,
its form field and save path), not a constant, which is why it is recorded here
rather than done.

**2. Add-on COST is hardcoded at 40% of add-on PRICE**, and that is the larger
error. `calculatePerSq` computes `addOnCostCents = addOnsTotalCents * 0.4` — a
flat assumption that every add-on carries a 60% margin. It does not hold for the
two biggest ones, which are near pass-throughs:

| add-on | charged | catalog cost | implied cost ratio | model assumes |
|---|---|---|---|---|
| permit `PRM RES-OH` | ~165 | 210 | **>100%** | 40% |
| dump fee `DSP 20YD` | 550 | 425 | ~77% | 40% |

On a job carrying both, the model assumes roughly 286 of add-on cost against
something closer to 635 — **margin overstated by several hundred dollars per
job**, in the internal view the shop prices against.

This only bites a tenant who has configured a per-SQ cost basis
(`DEFAULT_COST_BASIS` ships as zeros and renders margin as null until set), so
it affects NBD and not a fresh tenant. It is a margin-DISPLAY error rather than
a charging error — the homeowner is billed correctly; the shop is told it made
more than it did.

### Both findings are now FIXED (same day, Jo's call)

`docs/pro/js/estimate-builder-v2.js`. The blanket ratio is replaced by a
per-add-on one: the two pass-throughs cost **face value**, the other twelve keep
**0.4 unchanged**. Nothing the homeowner is charged moves — the change is
entirely inside `internal`, which `estimate-v2-ui.js` renders.

Costing the permit and the dump fee at face value is not a new estimate of
anything. It is what LINE-ITEM mode has always done:
`generateLineItemsFromMeasurements` sets the permit line's `materialCost` to the
permit fee itself, and the v2 `CATALOG` entries for `dump-fee` and `permit-fee`
both carry a `cost` equal to the fee. Per-SQ was the lone outlier; the two modes
now agree.

The remaining 0.4 is still an **assumption and is labelled as one in the code**.
No measured cost basis for per-SQ add-on work exists anywhere in the repo, and
none was invented — a shop that knows better sets `addonCostRatios` in settings,
per key, alongside `costBasis` and private for the same reason. Nothing
sensitive is published by the change: that a permit is remitted in full is a
fact about permits, not about NBD.

**A bug was caught by its own test while writing this.** The first override
reader accepted any finite number, and `Number('')` and `Number(null)` are both
`0` — so a blank ratio field would have read as "this add-on costs nothing",
understating cost, which is the very defect being fixed. It now drops blanks and
honours a literal `0`, mirroring `applyCompanyPricing`'s `sane()` and the same
L-1 rule that exists for add-on prices. Guarded by
`tests/estimate-pricing.test.js` (13 new assertions; the three mutations —
restore the blanket 0.4, empty the pass-through list, drop the blank guard —
fail 8, 9 and 1 assertion respectively).

### Finding 1 is fixed too — `matDelivery`

Shipped as a flat per-job add-on, **not** folded into `costBasis[tier]`, for the
reason stated above: amortising a flat charge over a per-SQ basis is right at
exactly one job size.

**Charged $412.50** — `ADDON_MAT_DELIVERY` in `estimate-config.js`, mirrored as
`ADDON_PRICES.matDelivery`. That figure is the line-item `MAT DEL` line carried
through the same chain `calculateLineItem` applies (material markup 25%, then
overhead 10% + profit 10%), measured through the real engine at 11.5 / 23 / 46 SQ
with no size dependence. Per-SQ applies no markup of its own — its add-on prices
ARE the charged figure — so the price has to be the already-marked-up number, not
the catalog cost. The two modes now quote the same delivery money at the subtotal.

Always on and unconditional: per-SQ is the reroof model and every reroof draws
material. `input.matDeliveryOverride` zeroes it per estimate for the waived-trip
and customer-hauls-their-own cases, using the same `!= null` rule as
`dumpFeeOverride` so a literal 0 is honoured and `undefined` is not.

**Costed at the published baseline itself, PINNED** — neither a pass-through
(1.0) nor the 0.4 work-adder default. Delivery is charged at a marked-up figure,
so it is not "charged at cost"; but a fixed FRACTION would have been worse. The
add-on reducer scales the ratio by the CHARGED cents and the charge is
shop-editable, so a fraction would let a shop that discounted the job silently
book less cost than the supplier invoices — the same overstate-margin defect
finding 2 removed, re-created on a new key. The ratio is therefore derived per
call as `baseline / charge`, which books the baseline at any price (verified at
412.50 / 300 / 500 / 275 / 1000; a charge of 0 books 0).

Settings field `v2addonMatDelivery` on both dashboards, in the Flat Add-ons row.
Guarded by 13 assertions in `tests/estimate-pricing.test.js`; five mutations —
make it a pass-through, use a fixed ratio, scale it by SQ, fall to the 0.4
default, drop the override — fail 2 / 1 / 3 / 6 / 2 assertions respectively.

**One consequence worth knowing:** the `$25` grid and the `$2,500` minimum-job
clamp both run AFTER add-ons, so on a sub-floor job the customer total does not
move even though the trip is real. The subtotal moves; the total cannot. That is
asserted rather than left to be discovered.

**Premise CONFIRMED by Jo, 2026-08-19: the tier rates do not include delivery —
it is billed on top.** This had been shipped as a stated assumption, because
nothing in the repo records it either way and the opposite reading (a retail
per-square rate is all-in) is the natural one. Had it gone the other way the
add-on would have double-billed the homeowner and the charge would have needed
reverting, keeping only the cost-side work. It did not; no change is required.

Worth keeping visible, because it is the kind of fact that is invisible in code
and expensive to re-derive: `TIER_RATES` (good 545 / better 595 / best 660 per
SQ) cover materials + labour + OH&P and **assume delivery is billed separately**.
Anything else flat and per-job that reaches per-SQ pricing should be checked the
same way before it is billed — ask whether the tier rate already absorbs it.

Fixing these is **not** a rotation and must not be recorded as one in
`tests/cost-basis-ledger.js` — correcting a drifted baseline toward current
supplier pricing moves the published figures *closer* to NBD's actuals, which is
the opposite of what rotation is for.

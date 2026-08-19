# Phase 2 — the cost basis still published (brief, 2026-08-18)

Follows [SESSION-2026-08-18-job-template-cost-migration-prb](SESSION-2026-08-18-job-template-cost-migration-prb.md) ·
Leak context: [JOB-TEMPLATE-COST-LEAK-2026-08-18](../audit/JOB-TEMPLATE-COST-LEAK-2026-08-18.md)

PR-B closed the job-template surface. Three published files still carry a cost
basis. This brief exists because **the PR-B design does not transfer to them**,
and I would rather say that with measurements than discover it mid-migration.

Every figure below I ran against the real bundle. Nothing here is transcribed.

**Nothing in this brief is built. It needs one product decision from Jo (§5)
before any of it should be.**

> ## Revision 2026-08-18 (same day) — Jo approved §5, then three measurements changed the plan
>
> Jo answered §5 **yes** (a public de-identified starter price book is
> acceptable). Implementation started on that basis and stopped again, three
> times, before writing code. Each correction is below in full; §4 and §5 are
> superseded where they conflict.
>
> **(1) De-identifying the baseline by transforming the leaked figures is
> theatre, and it invalidates my own §4 recommendation.**
> The proposed de-identification — round to a coarse per-magnitude grid —
> measured well on its face: 66 labor rates, **67% of values moved, median
> drift 3.4%, max 20%**, still usable for onboarding. But the pre-transform
> values are in git history forever, so *any* deterministic transform is
> invertible by anyone with a clone. Rounding does not hide a number whose
> original is one `git show` away. (It is also only 67% — the other 22 values
> sit on the grid already and would publish unchanged, indistinguishably.)
>
> **What actually makes a published baseline safe is the same thing that makes
> the git history harmless: NBD's CURRENT figures having moved on.** The
> historical set is already public and cannot be recalled. So the baseline does
> not need to be secret — it needs to be *stale*.
>
> That simplifies P2-c considerably and re-couples it to work already planned:
> - publish the historical figures as the labelled starter baseline, rounded
>   for looks rather than for concealment — they are already public, so this
>   costs nothing;
> - put NBD's **rotated, current** figures in their tenant book.
>
> The leak closes because NBD's actuals are no longer the published ones — not
> because the published ones are obscured. **This makes rotation a hard
> prerequisite for P2-c rather than a parallel nicety**, exactly as it already
> is for PR-B, and it means no elaborate de-identification machinery is needed.
>
> **(2) P2-a cannot ship alone — it blinds the guard added today.**
> `COST_BASIS_LABOR_RE` matches `rate:` **paired with** `hoursPerUnit:`. P2-a
> removes `hoursPerUnit` while leaving 66 `rate:` values published — still a
> labor cost basis, now matching nothing. The `KNOWN_UNMIGRATED` non-vacuity
> assertion would then fail, and the obvious "fix" is to delete the entry,
> leaving the remaining leak untracked. That is the pairing design's one
> weakness, and it is worth naming: **pairing is precise, but removing the
> partner makes it blind.** So the labor catalog migrates as ONE unit, with a
> file-scoped assertion replacing the shape-based one at the same commit.
>
> **(3) P2-b is not worth doing, and I am withdrawing it.** §4 called it "the
> biggest ratio of exposure closed to risk taken". Checking it properly says
> otherwise:
> - The homeowner path is **already clean** — verified: `portal.js:683-700`
>   emits an explicit allowlist (id, builder, grandTotal, tierName, signature
>   fields, lineCount, createdAt) with no markup and no cost split, and the
>   shared-estimate view goes through `buildDisplayRows`, which returns
>   `{code, desc, qty, rate, total}` at retail only. The 2026-08-02 audit
>   closed this. The flagged verification in §4 resolves **negative**.
> - 25% material markup and 10/10 OH&P are industry-typical round numbers. A
>   competitor does not need to read them off our JS.
> - Any change to a pricing default is a live-money change for every tenant
>   relying on it, across at least three sites
>   (`estimate-logic-engine.js:877-879`, `estimate-builder-v2.js:469`,
>   `dashboard-bootstrap.module.js:4247`).
>
> Real risk, negligible benefit. **The margin derivation is closed by removing
> the cost basis, not by hiding a standard markup.** Dropped.
>
> **Revised sequence:** rotate NBD's figures (already required, now blocking) →
> labor catalog as one unit → xactimate + estimate-builder-v2 together. P2-b is
> withdrawn. Nothing should start until rotation has, because (1) makes it the
> dependency for all of it.
>
> **The rotation tooling is now built** (2026-08-19) — see §8. That was the
> only part of the blocking step that did not need Jo's figures, so it is done
> and rotation is now data entry rather than a project.

---

## 8. Rotation — built, and how to run it

Rotation went from "a parallel nicety" to **the prerequisite for all of Phase 2**
per revision (1). Everything that could be built without Jo's actual figures
now is:

- `functions/cost-basis-registry.js` — one description of every catalog that
  publishes a cost basis, so the third and fourth migrations are a config entry
  rather than another hand-written script. It also states the rotation
  rationale once, in the place the tooling reads from.
- `scripts/cost-rotation.js` — worksheets and application.
- `scripts/import-cost-rotation.js` — one company, one catalog, dry-run default.
- `tests/cost-basis-registry.test.js` — 25 assertions, wired into CI.

| catalog | rows | values | book field |
|---|---|---|---|
| `labor` — NBD_LABOR | 66 | 198 | `laborOps` |
| `xact` — NBD_XACT_CATALOG | 276 | 552 | `xactCosts` |
| `v2` — EstimateBuilderV2.CATALOG (native only) | 28 | 56 | `v2Costs` |

806 values across three worksheets. Each map lands on the tenant's **existing**
`catalogCosts/{companyId}` document beside `costs` and `jtCosts`, so — as with
PR-B — **no `firestore.rules` change is needed**.

```bash
node scripts/cost-rotation.js --catalog all --worksheet
```

Writes `.local/rotation-<catalog>.json` and a `.csv` beside it, each row
carrying the key, item name, unit and current figures with a blank column per
field. Fill in the blanks; leave a cell blank to keep the current value and be
told how many you kept.

```bash
node scripts/cost-rotation.js --catalog labor --apply .local/rotation-labor.json
```

```bash
node scripts/import-cost-rotation.js --catalog labor --company <NBD companyId>
```

Dry run is the default; add `--yes` to write.

**What it refuses**, all exercised end to end and asserted in the suite:

| | |
|---|---|
| an untouched worksheet | refused — 0% coverage against a 50% floor |
| a partial fill | refused, with the exact coverage reported (measured: 3.0%) |
| a non-numeric or negative cell | refused, listed by row and key, never coerced |
| a sheet applied to the wrong catalog | refused — the seed is stamped with its catalog |
| importing an unrotated seed | refused unless `--unrotated` is passed deliberately |
| importing over an existing book | refused unless `--force` — Firestore deep-merges nested maps, so a re-import silently reverts tenant edits |

The v2 adapter **excludes** the `xact-` and `jt-` bridge rows that
`estimate-catalog-xactimate.js` and `job-templates.js` write into
`EstimateBuilderV2.CATALOG` at load. Rotating them there would double-count and
produce two books that disagree about the same line; there is a test for it.

---

## 9. Labor catalog — MIGRATED 2026-08-19

The first of the three, and this codebase's first *partial* migration.

**What left:** crew productivity — `hoursPerUnit` per entry plus the `crewSize`
and `ratePerManHour` the `L()` helper injected. **198 values**, gone from the
published tree, now tenant-owned at `catalogCosts/{companyId}.laborOps`. They
were read at exactly two sites, both a pass-through in `resolveLabor`, so
removing them costs a tenant nothing — and the file's own header instructs
authors not to disclose the source of the productivity figures, a rule it had
been breaking by publishing the figures themselves.

**What deliberately stayed:** all **66 `rate:` values**, as a labelled starter
baseline. Stripping them turns the estimator off rather than degrading it. What
makes them safe is staleness, not secrecy — and `NBD_LABOR.get()` now overlays
the tenant book on read, so a company's own rate wins at the one place pricing
consults (`estimate-logic-engine.js:resolveLabor`). Verified end to end: with a
book the engine prices off the tenant's figure, without one off the baseline,
and with a *throwing* book off the baseline rather than crashing.

`updateRate()` now writes to the company book as well as localStorage, and
`adoptLocalOverrides()` lifts pre-existing per-device overrides into it once —
the same drift fix `adoptLocal()` did for products, with the same caveat: a
`sales_rep` cannot write the book, so their edits stay local.

**Three things this turned up that are worth keeping:**

1. **The paired regex went blind, exactly as revision (2) predicted.**
   `COST_BASIS_LABOR_RE` matches `rate:` beside `hoursPerUnit:`; removing one
   half left 66 published rates matching nothing. So
   `estimate-labor-catalog.js` is **off** `KNOWN_UNMIGRATED` and covered
   instead by four file-scoped assertions — productivity absent (structural
   *and* textual), no orphaned constant, the baseline still **present** so
   nobody strips it and breaks onboarding, and the override path wired. A shape
   list cannot express "this half is closed and that half is deliberately open".

2. **A CRLF bug nearly shipped a silent partial strip.** The codemod removed the
   per-entry fields but left `const CREW = 4` and `const RATE_PER_MH = 35`,
   because a `.*` tail never matches across a `\r\n` line ending — no error, no
   diff, just a leftover published figure that parses clean and is invisible to
   a structural check. Fixed, and the verification pass now asserts textual
   absence too rather than trusting the replace to have fired.

3. **A migrated field is unreachable from the working tree**, so
   `cost-rotation.js` gained `--from <git-ref>`. Without it NBD's real
   productivity data would have been stranded in history with no tool to
   recover it. Measured: `--worksheet` yields 66 values from the working tree,
   198 from a pre-strip ref.

**Still open here:** the 66 published rates are NBD's actual rates until
rotation lands. This migration closed the productivity half outright and built
the override path for the other half. It did not close the rate half, and no
code can — that part is data entry.

---

## 10. Xactimate + EstimateBuilderV2 — override paths built 2026-08-19

**Nothing was stripped, and nothing could be.** Unlike the labor catalog's crew
productivity, neither of these has a field that can leave: the 276 `mat`/`lab`
pairs and the 28 `cost`/`labor` pairs **are** the pricing, with no public retail
half to fall back on. §2's measurement stands — strip them and a full reroof
drops to the minimum-job floor with every line at 0.

What shipped is the other half of the labor pattern: **the override path**.

| catalog | pricing choke point | book map |
|---|---|---|
| xactimate | `NBD_XACT_CATALOG.find(code)` | `xactCosts` |
| EstimateBuilderV2 | `calculateLineItem` / `calculateEstimate` via `_withTenantCosts` | `v2Costs` |

Both overlay **on read**, never mutating the shared catalog — otherwise one
tenant's costs would survive an account switch on a shared device. Verified:
with a book the engine prices off the tenant's figure; without one, off the
baseline; `byCode` stays intact underneath.

This closes **no values today**. It is the prerequisite that makes rotation
land: without it, importing a rotated book would change nothing. They close
when the published baseline is no longer anyone's actual cost, which is
rotation, not deletion.

> **Correction 2026-08-19 (later the same day).** This paragraph said "both
> files stay on `KNOWN_UNMIGRATED` with rewritten reasons". **`KNOWN_UNMIGRATED`
> is gone**, and rewriting its reasons was the wrong fix. That map asked one
> question of two different things: "does this file publish a cost basis"
> (observable, and for these files permanent) and "is that basis still the
> shop's real cost" (not observable — it changes in Firestore). Its non-vacuity
> assertion only ever checked the first while its label claimed the second, so
> the day rotation lands the file is byte-identical, the sweep still finds 276
> pairs, the assertion still passes, and the guard goes on printing "still
> leaking, keep tracking it" about figures nobody uses. Green, wrong, and
> nothing prompts a revisit.
>
> Replaced by `tests/cost-basis-ledger.js` — one row per catalog, keyed off
> `functions/cost-basis-registry.js`, carrying `rotation: null` or a signed
> record `{ at, by, company, coverage, basisAt }`. Nothing detects rotation;
> `scripts/import-cost-rotation.js` prints the block to paste **after** a
> successful write. `basisAt` is the commit the claim was made against, and the
> guard re-reads it every run: if a line item is later REPRICED, the claim no
> longer covers what is published. Measured over the full history of all three
> catalogs, that check has a false-positive rate of zero (9 additions, 3
> removals, **0** repricings). The labor catalog is a ledger row too, so the
> half-migrated case lives in the same table instead of a bespoke section.

**Three things this turned up:**

1. **Both overlays trusted the book's shape.** A corrupt entry wrote `NaN`
   straight over a good baseline — i.e. priced a line at `NaN` rather than
   falling back. Found with a deliberate corrupt-book probe. Both now validate
   at the point of **use** as well as in `catalog-costs.js`: this is the last
   step before a number becomes a customer total. The labor overlay had the
   same hole and got the same fix, and it drops a *bad field* rather than the
   whole entry, so a book with a broken rate still delivers its good
   productivity value.

2. **`loadSettings()` is contractually PURE and I broke it.**
   `tests/custom-jurisdictions.test.js` pins that the county overlay is applied
   at calc time, not baked into `loadSettings` — so a late-arriving
   companyProfile is honoured. I had wired the cost overlay into `loadSettings`
   and an existing suite caught it immediately. The cost overlay now rides
   exactly the same rule, at the same two pricing entry points, for exactly the
   same reason: a cost book that lands after boot must still reach the next
   price.

3. **A new tripwire: the override paths are asserted to exist.** Every
   "deliberately published baseline" argument in this codebase depends on the
   tenant book actually winning. If an override path is removed or renamed, the
   baseline silently goes back to being simply the price — the leak restored,
   with a reassuring comment on top. Three static assertions in
   `catalog-cost-privacy.test.js` now guard that.

**What remains for these two:** rotation. Nothing else.

---

**It will not generate a number, and that is deliberate.** A blanket "scale
everything by 7%" would devalue the leaked copies and simultaneously put the
shop on fabricated money for live quoting — a worse failure than the leak. The
tooling's job is to make supplying real figures cheap, to prove the rotation
happened, and to refuse to let a no-op pass as one.

---

## 1. What is exposed

| file | entries | shape | guard status |
|---|---|---|---|
| `docs/pro/js/estimate-catalog-xactimate.js` | **276** items — 238 with material > 0, 254 with labor > 0 | `mat:`/`lab:` | `KNOWN_UNMIGRATED`, asserted still leaking |
| `docs/pro/js/estimate-labor-catalog.js` | **66** entries | `rate:` + `hoursPerUnit` | `KNOWN_UNMIGRATED` since today |
| `docs/pro/js/estimate-builder-v2.js` | **28** native CATALOG entries, all priced | `cost:`/`labor:` | `KNOWN_UNMIGRATED` |

370 entries. All three feed one object — `NBD_XACT_CATALOG.byCode` — which
after PR-B also holds tenant-owned job-template costs. **Public and private
cost data now sit side by side in the same map.** That is the strongest
argument for doing all three together rather than one at a time.

Thirteen client files read at least one of the three (`dashboard-bootstrap`,
`estimate-finalization`, `estimate-supplement`, `estimate-v2-ui`,
`supplement-ui`, `job-templates*`, `catalog-costs`, `script-loader`, and the
catalogs themselves).

---

## 2. The finding that changes the design

**A naive strip does not degrade the estimator. It turns it off.**

Measured on a representative full-reroof scope of nine real codes (`LAB MOB`,
`LAB TO1`, `RFG 240-GAF-HDZ`, `RFG IWS`, `RFG SYN`, `RFG RIDG`, `RFG DRIP-AL`,
`RFG PIPE-STD`, `LAB CLN-M`, `DSP HAUL`) at the typical-house context:

| | total |
|---|---|
| today | **$12,425.00** |
| after a PR-B-style strip, tenant with no book | **$2,500.00** — and that is purely the minimum-job floor binding; every line resolved at 0 |

Two measurements explain why, and both were surprises:

**(a) The already-migrated product book never governs a coded line.**
`estimate-catalog-xactimate.js:1206-1207` assigns `item.materialCost = item.mat`
on every item, and `resolveLineItem` prefers an explicit cost over a
`materialId` lookup. Measured: **0 of 276** xact items carry a `materialId` or
a `laborId` at all. So the July product migration — which did move
`NBD_PRODUCTS` costs to the tenant book (measured: **0 of 276** products carry
a cost in-tree, that migration held) — has no effect on estimate pricing
whatsoever. The 276 explicit pairs are the sole source.

**(b) There is no public retail half to fall back on.**
This is the whole reason the July design worked. `product-data.js` kept a
public retail `sell` on **276 of 276** products, so stripping cost cost the
tenant nothing they could see. The xact catalog has a public retail field on
**0 of 276** items — retail there is *derived* (`cost × markup`), not stored.

So: job templates could lose their costs and stay useful, because a template's
value is the scope of work and the price columns could honestly read `—`. The
estimator has no equivalent — an estimate with no prices is not an estimate.
A new tenant would face **370 numbers to enter before producing anything**,
which is not an onboarding path, it is a wall.

---

## 3. Why "publish retail, hide cost" also fails here

The obvious repair — publish a retail price per line, keep cost private — works
for products only because `sell` is an *independently set* number that reveals
nothing about cost.

For xact items, retail **is** cost × markup, and the markup defaults are public
literals at `estimate-logic-engine.js:877-879` (`materialMarkupPct` 0.25,
`overheadPct` 0.10, `profitPct` 0.10). Publish per-line retail beside a public
markup and you have published the cost. **You cannot have both**, and any
design that assumes otherwise is arithmetic away from the leak it closes.

---

## 4. Three separable pieces, in increasing order of product risk

Splitting these is the point of the brief. Two of them need no product decision
at all and can ship whenever; only the third is genuinely hard.

### P2-a — the labor productivity block. No product risk. Do it first.

`hoursPerUnit` and `crewSize` are read at exactly **two sites**, both inside
`resolveLabor`'s pass-through at `estimate-logic-engine.js:396-397`. Nothing
customer-facing, nothing in pricing, nothing in the payload consumes them —
they are scheduling data.

`functions/catalog-cost-logic.js` already makes precisely this argument for the
product catalog: *"hoursPerUnit and crewSize ride the private half for that
reason alone; they are scheduling data, not price, and nothing public-facing
reads them."* The same sentence applies here unchanged.

This also removes the "in-house productivity data" that the xact catalog's own
header instructs authors not to disclose — a rule the file has been quietly
breaking by publishing the productivity figures themselves.

**Cost to a tenant with no book: zero.** Pricing is unaffected; `rate:` stays.

### P2-b — the margin, not the cost basis. Small change, biggest ratio.

Worth being precise about what is actually damaging here. "A tear-off costs
about this much per square" is close to industry-general — Xactimate, RSMeans
and every competitor publish comparable figures commercially. **"NBD makes Y on
this job" is not**, and that is what the current tree discloses, because cost
is public *and* the markup defaults are public.

Moving those three defaults out of the public engine into tenant config breaks
the derivation for anyone who does not know a specific tenant's settings. They
are already tenant-overridable (`settings.materialMarkupPct`, wired through
`dashboard-bootstrap.module.js:4247/4477`); only the fallbacks are public. This
is a small, low-risk change that closes the sharper half of the exposure
without touching onboarding.

> **Verify before claiming this closes the derivation.** Saved estimate
> documents persist `materialMarkupPct` — `customer-estimate-rows.js:51` reads
> it off the doc, and that file is served on `docs/pro/customer.html`. That is
> the authenticated CRM view, but whether the same doc reaches a *homeowner*
> surface (portal, emailed PDF, signed copy) needs checking before P2-b is
> called done. If it does, the markup is disclosed per-estimate regardless of
> what the public JS carries, and that is a separate and more urgent finding
> than anything else in this brief.

### P2-c — the cost baseline itself. Needs a product decision.

Four options considered; three disqualify on measurement.

| option | verdict |
|---|---|
| **Strip to nothing, tenant book only** (the PR-B shape) | **No.** Measured §2: the estimator goes inert, 370 values to onboard. |
| **Publish retail, hide cost** (the July shape) | **No.** §3: retail = cost × public markup. Publishing retail publishes cost. |
| **Seed every tenant with NBD's book** | **No.** Closes the URL, leaves the second leak — one company's supplier terms as everyone's starting pricing — fully intact, just relocated into private docs. This is the exact failure `import-catalog-costs.js` was written to avoid. |
| **Rotate, then publish the rotated figures as a platform BASELINE; NBD's actuals live in their tenant book** | **Recommended.** |

The recommendation resolves the tension the original audit named but did not
settle: *"these figures are platform seed data, while `catalogCosts` is
deliberately tenant-owned."* For 84 NBD-specific job-template lines, that
tension resolves toward tenant-owned — which is what PR-B did. For a 276-item
industry estimating catalog, **the starter price book is the product**. A
contractor who signs up and finds an empty catalog has not been sold anything.

So the split is not public-vs-private, it is **generic-vs-actual**:

- **Public:** a de-identified regional baseline. Rounded, normalised, and
  explicitly labelled a starting point to edit — not NBD's negotiated terms.
  Same rotation machinery PR-B already ships (`rotate-job-template-costs.js`
  generalises to a worksheet over any of the three files).
- **Private (`catalogCosts/{companyId}`):** NBD's actual figures, and every
  other tenant's, via the book that already exists.

What that buys: onboarding survives, NBD's real numbers stop being public, and
the historical copies in git are devalued by the same rotation that PR-B needs
anyway. What it costs: the baseline is public, so a competitor can read a
plausible regional cost structure — but not *yours*.

---

## 5. The decision I need from Jo

**Is a public, de-identified starter price book acceptable as a product
feature?**

- **Yes** → P2-c is the rotate-and-publish-baseline design above, and it can be
  scoped properly. This is my recommendation.
- **No, all cost data must leave the tree** → then the estimator needs a
  *different* onboarding story before Phase 2 can ship at all (a guided setup,
  a per-trade template pack, an import). That is a product project, not a leak
  fix, and it should be scheduled as one rather than discovered halfway
  through a migration.

Either way, **P2-a and P2-b do not depend on this answer** and can ship first.

---

## 6. What I am not recommending

- **A history rewrite.** Unchanged from the original assessment: one commit,
  235 to rewrite, 10 live worktrees, incomplete against forks. Rotation is the
  durable answer. If the decision ever flips, do it once, covering all four
  files, with the fork-network GC request.
- **Migrating the three files separately.** They share
  `NBD_XACT_CATALOG.byCode`. Doing one at a time leaves that map half-private
  for longer and triples the regression surface.
- **Starting to cut before §5 is answered.** Three designs were killed by the
  adversarial pass last time, both times on silent money-math data loss. The
  measurement in §2 is the same class of finding, caught before implementation
  rather than after.

---

## 7. Verification plan when it does ship

The proof-of-work checks that mattered in PR-B, adapted:

1. **The guard must go RED first.** `catalog-cost-privacy.test.js` already
   asserts all three files are still leaking. When one is migrated its
   `KNOWN_UNMIGRATED` assertion fails by design and the entry gets deleted —
   that is the signal, not a nuisance.

   > **Correction 2026-08-19.** Wrong for these three files, and the mistake is
   > worth keeping visible: **the entry is never deleted.** Deleting it is what
   > revision (2) above warned about — it leaves a real, still-published leak
   > untracked, and it would additionally fail layer 4 outright, because the
   > ledger *is* that layer's exemption list. A published starter price book is
   > a permanent product feature, not debt with a deletion date. What changes on
   > rotation is the row's `rotation` field in `tests/cost-basis-ledger.js`,
   > from `null` to a signed record — and the guard's green line changes with
   > it, from "these published figures ARE the shop's cost basis today" to
   > "ROTATED &lt;date&gt; by &lt;who&gt; for company &lt;id&gt;". Nothing here can prove the
   > rotation happened; that limit is stated in the guard's own output rather
   > than papered over.
2. **A no-book tenant must never see a fabricated price.** The PR-B rule
   applies unchanged and for the same measured reason: emit explicit zeros,
   never omit keys, because `inferLaborId` resolves before the `!= null` gate.
   With `estimate-labor-catalog.js` migrated, the inference target itself moves
   — re-measure, do not assume the 14-item figure still holds.
3. **`Σ retailTotal == retailBeforeOHP`** must still hold, and no downstream
   consumer (`estimate-finalization`, `estimate-supplement`, `invoice-pipeline`,
   `profit-tracker`) may see a shape change.
4. **The reopen contract from PR-A must survive** — a saved estimate must not
   re-price itself when the catalog it was priced from moves.
   `tests/estimate-reopen-cost-basis.test.js` is the pin.
5. **`tests/catalog-cost-privacy.test.js` layer 2b** (added today) reports zero
   real cost pairs outside `docs/`. Its real-pair set shrinks as each file
   migrates; when it reaches zero the layer is obsolete and should be removed
   deliberately, not left to pass vacuously.

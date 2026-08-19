# Job-template contractor costs are published — 2026-08-18

> **Update 2026-08-18 (end of day): CLOSED at HEAD.** PR-A and PR-B both
> landed. `docs/pro/js/job-templates-data.js` now carries zero cost keys, the
> figures live at `catalogCosts/{companyId}.jtCosts`, and the privacy guard
> scans by default instead of by allowlist. **Two things remain, both
> deliberate:** the cost figures are not yet rotated (mechanism shipped, the
> numbers are Jo's — see "The rotation" below), and three other published files
> still carry a cost basis (see "What this does NOT close").
>
> **Follow-up the same day:** the fourth cost spelling
> (`rate:`/`hoursPerUnit`, `estimate-labor-catalog.js`) now has a regex and is
> on `KNOWN_UNMIGRATED`. Phase 2's exposure is therefore **measured**:
> 28 + 276 + 66 = **370 cost-basis entries across three published files**, all
> asserted still-leaking so each one fails the guard the day it is fixed.
> Nothing was migrated — but nothing is invisible any more.
>
> Everything below the fold is the original finding, unedited — it is what the
> fix was built against.

`docs/pro/js/job-templates-data.js` ships **84 contractor cost pairs** to the
public internet. Found while assessing an unrelated demo-route idea; it is a
live leak of the exact class `CLAUDE.md` names a hard invariant, and the guard
that exists to catch it has never looked at the file.

Related: [SITE-QC-SWEEP-2026-08-18](SITE-QC-SWEEP-2026-08-18.md) ·
the `product-data.js` precedent in `functions/catalog-cost-logic.js`.

## What is exposed

Measured directly, not inferred:

| | |
|---|---|
| File | `docs/pro/js/job-templates-data.js` — 200 OK, ~188 KB, unauthenticated |
| `custom` blocks | **84**, each with `materialCost` **and** `laborCost` |
| Non-zero cost values | **146** |
| Shape | every `custom` block is `{name, desc, unit, qty, materialCost, laborCost, category}` — e.g. a siding-patch line, a masonry-sealer line, a tuckpointing line, each carrying both a material and a labor figure |

> **The actual figures are deliberately not reproduced here.** `documentation/`
> is in the same public repo as `docs/`, so pasting the values into the audit
> that exists to protect them would republish them in a *more* legible form than
> the minified data file. Read them from
> `docs/pro/js/job-templates-data.js` while they are still there; after the
> migration they live in `catalogCosts/{companyId}`, which is what this note is
> for. Same rule applies to any follow-up note.
>
> **Extended 2026-08-18, because the rule as prose was not enough — it failed
> again within hours, in the PR that implements this fix.** The follow-up work
> reproduced real cost pairs in TEST FIXTURES: a legacy-fork case built on a
> real item's figures, and four mutation strings in the privacy suite itself
> carrying real pairs lifted from `estimate-builder-v2.js` and
> `estimate-catalog-xactimate.js`. All replaced with synthetic values; none was
> ever load-bearing, since those assertions test a regex SHAPE and never a
> value.
>
> **The rule is now enforced, not written down** — `catalog-cost-privacy.test.js`
> gained a value-based layer that loads the still-published catalogs, collects
> every cost pair they actually contain (185 today), and refuses to find any of
> them quoted anywhere in the tracked tree outside `docs/` (597 files). It
> reports the file:line only and never the figure, because CI logs on a public
> repo are public too. Validated against a real injected pair.
>
> A SHAPE scan was measured first and rejected: it flags 12 files whose fixtures
> are legitimately synthetic round numbers. "Is this number real?" is the only
> question worth asking and shape cannot answer it. **The limit is that it can
> only see values still in the tree** — it would not have caught the
> job-template pairs, which had already left. It covers exactly what Phase 2 is
> about to move, and starts earning its keep the moment those files are
> stripped.

The file's own header says it plainly: *"custom items carry explicit contractor
costs (markup/OH&P applied downstream)."* This was documented behaviour, just
never checked against the publishing invariant.

**The second half is what makes it exploitable.**
`docs/pro/js/estimate-logic-engine.js` is also public and carries the markup
math — `materialMarkupPct` 0.25, `overheadPct` 0.10, `profitPct` 0.10
(estimate-logic-engine.js:868-870). Cost basis *and* margin model are both
readable, so a competitor can reconstruct the quote for any of these items, and
a homeowner can compute the margin on their own estimate.

## Why the guard passes 48/48

`tests/catalog-cost-privacy.test.js` scans a **`STRICT_FILES` allowlist** —
`product-data.js`, `roofivent-catalog.js`, `catalog-costs.js`,
`product-library.js` — plus a short documented-exception list for
`estimate-builder-v2.js` and `estimate-catalog-xactimate.js`.

`job-templates-data.js` appears **zero times** in that test. It has never been
scanned, so the suite is green and always has been.

> This is the second guard defeated by its own list in a single day. The
> morning's `svg.ico` bug got through because `ensure-icon-css.js` skipped
> `sites`/`pro`/a stale `free-guide` entry. Same failure shape: **a guard with
> an inclusion or exclusion list is only as strong as that list, and a hole in
> it is indistinguishable from a pass.**
>
> The privacy test's own comments show it has been bitten this way before — it
> records a SECOND parallel catalog that leaked "because it was not on the
> STRICT_FILES list". The fix that time was to add that one file. Adding one
> more file is not the durable answer; scanning by default and exempting
> explicitly is.

## Why the cheap fix is wrong

Baking a static retail price into the public file and deleting the costs looks
attractive and is **not viable**: markup is per-tenant configurable
(`settings.materialMarkupPct` / `overheadPct` / `profitPct`,
estimate-logic-engine.js:868-870). Baking retail would freeze NBD's own markup
into every other tenant's pricing — which is precisely the *second* problem the
`product-data.js` fix was written to solve.

Jo's call (2026-08-18): move the costs server-side properly, following the
existing precedent.

## The precedent to follow

This exact problem was solved once already, and the machinery still exists:

- `functions/catalog-cost-logic.js` — the public/private split; pure functions
  so the extract script, import script and tests share one definition of "which
  fields are cost data".
- `docs/pro/js/catalog-costs.js` — the runtime tenant cost-book fetcher. Its
  header states the governing principle: **"A TENANT WITH NO COST BOOK HAS NO
  COSTS"** — render "Cost not set", never invent a margin.
- `firestore.rules:1043-1066` — `catalogCosts/{companyId}`, readable by that
  tenant's members, writable by owner/company_admin, **never distributed**.
- `scripts/extract-catalog-costs.js` · `scripts/import-catalog-costs.js`.

One genuine tension a migration must resolve explicitly: these 84 figures are
*platform seed data* (NBD's own numbers shipped as everyone's defaults), while
`catalogCosts/{companyId}` is deliberately tenant-owned with "no platform-wide
copy".

`tests/job-templates.test.js:364` currently asserts custom items have
"costs >= 0, at least one > 0" — it **requires** the costs to be in the public
file, so it changes as part of any fix.

## Git history — assessed, rewrite NOT recommended

The repo is public (`functions/catalog-cost-logic.js` says so outright, and
notes `raw.githubusercontent.com` served the earlier leak's bytes), so the
values exist in history as well as on the live site.

The good news: they entered in **exactly one commit** — `5b747d0b`
(2026-07-20, "Job Templates library: 107 pre-built quote templates…") — and the
file has **never been modified since**. One commit, one blob.

The cost of erasing it anyway:

- **235 commits** sit between `5b747d0b` and HEAD; all would be rewritten.
- **10 active worktrees** on this machine, including `main` and several live
  feature branches with other sessions working in them right now. A rewrite
  invalidates every one.
- GitHub retains orphaned blobs addressable by SHA after a force-push unless
  Support is asked to garbage-collect, so a rewrite does not by itself
  guarantee removal.
- The values have been served from the live site for roughly a month
  regardless, so scrubbing git closes only one of the two surfaces.

**Recommendation: forward fix, and rotate the numbers.** Leaked cost figures
are only worth anything while they are *accurate*. Revising the actual cost
basis as part of the migration devalues every historical copy — on GitHub, in
forks, in anyone's clone — far more reliably than trying to delete copies. That
is the durable answer; a history rewrite is high-collateral and incomplete.

Do not execute any history rewrite without Jo's explicit instruction.

## The migration is designed — and it is NOT a one-line strip

Full plan:
[JOB-TEMPLATE-COST-MIGRATION-PLAN-2026-08-18](../projects/JOB-TEMPLATE-COST-MIGRATION-PLAN-2026-08-18.md).

Three independent designs were produced and **an adversarial pass killed all
three**, twice on silent money-math data loss. Two findings there are
counter-intuitive enough that anyone attempting this fix will otherwise repeat
them:

**1. Omitting a cost key is WORSE than emitting an explicit zero.** The obvious
design — leave `materialCost`/`laborCost` absent when a tenant has no cost book,
so nothing reads as "$0" — silently activates a dormant inference path.
`estimate-logic-engine.js:803` computes `laborId = item.laborId || inferLaborId(item)`
*before* the `!= null` gate, and `inferLaborId` resolves against
`estimate-labor-catalog.js`, **which is still public**. Measured on the real
stack: 14 of the 84 items land on live `LABOR_BY_SUB` keys and reprice
themselves — "Attic insulation baffles" goes from retail 142.50 to **500.00**,
"Bath exhaust roof cap" from 117.50 to 25.00. A confidently wrong number wearing
a "Cost not set" badge, re-derived from a file we did not close. **Emit explicit
`materialCost: 0, laborCost: 0`** and carry the unknown state in a separate
`costUnset: true` flag that presentation reads and the engine ignores.

**2. Reopening a saved estimate already re-prices it — today, before any of
this.** `estimate-v2-ui.js:3013-3018` rebuilds scope from **codes only**,
discarding the persisted `materialCostPerUnit`/`laborCostPerUnit`;
`getCurrentEstimate()` then re-resolves against the live catalog, and
`_reopenedClean` is flipped false at 17 different sites (any measurement edit,
county change, tier click). With `window._editingEstimateId` set, the next save
overwrites the same customer doc. This is a **pre-existing hole** — a rep
editing a forked template's costs hits it now — but stripping the costs turns it
from rare into universal. So the leak fix has a prerequisite.

**Shape: two PRs, in order.**
- **PR-A** — make reopen carry the saved cost basis. Contains no leak change, is
  independently correct, fixes a real existing bug, and is what makes PR-B safe.
- **PR-B** — the strip: `jtCosts` on the existing `catalogCosts/{companyId}` doc,
  keyed by the `jt-<slug>-<index>` that `job-templates.js:384` already computes.
  Reuses the existing rules (`firestore.rules:1061-1066` already governs every
  field of that doc, so **zero rules changes** — a rules typo being the failure
  mode that locks tenants out of their own money data), and the existing
  `catalog-costs.js` load order (`script-loader.js:146`, fourteen entries ahead
  of `job-templates-data.js` at `:170`).

## Status

- [x] Leak identified, measured, and root-caused
- [x] Git-history exposure assessed — forward-fix + rotate, no rewrite
- [x] Migration designed and adversarially verified (3 designs, all killed, plan corrected)
- [x] **PR-A — LANDED 2026-08-18** (`d8afd7e3`). `state.scope[].savedCost` +
      a single `withSavedCost()` helper on both paths feeding `resolveEstimate`.
      New `tests/estimate-reopen-cost-basis.test.js` (10 assertions) drives the
      real `estimate-v2-ui.js` and `estimate-logic-engine.js` in a vm — and was
      validated against the defect itself: with the fix reverted, 7 of 10 fail.
      Two corrections to the design brief while implementing: `triTierTotals`
      delegates to `getCurrentEstimate()` so it inherits the fix rather than
      needing its own overlay, and the row-preview map at `:2153` is display-only
      (catalog used for name/unit fallback, saved line preferred for money) so it
      was left alone.
- [x] **PR-B — LANDED 2026-08-18.** 84 `custom` blocks stripped (168 keys, 49
      of 179 lines); `jtCosts` on the existing `catalogCosts/{companyId}` doc,
      **zero rules changes**. See "What PR-B shipped" below.
- [x] `job-templates-data.js` brought under the privacy guard — and the guard
      itself proved to fail on the un-stripped file first (49 line hits) before
      it was allowed to go green.
- [x] Guard changed from allowlist to scan-by-default — layer 3 now sweeps all
      608 published files; 7 explicit, reasoned, non-vacuity-asserted exemptions.
- [ ] **Cost figures rotated** — the mechanism shipped and the import script
      REFUSES an unrotated seed, but the figures themselves are Jo's to supply.
      See "The rotation, and why this box is still open".

Jo runs the extract/import scripts; a production Firestore migration is not
something to execute unattended.

---

## What PR-B shipped (2026-08-18)

**The strip.** `docs/pro/js/job-templates-data.js` — 84 `custom` blocks, 168
cost keys, 146 non-zero values, 49 of 179 lines. Remaining custom key set is
exactly `{name, desc, unit, qty, category}`. Done by a codemod
(`scripts/strip-job-template-costs.js`) that is textual so the diff stays one
line per template, but which then re-loads its own output and asserts, template
by template, that the result is exactly `stripJtCosts(original)` by
`JSON.stringify` equality — key order included. `--check` is now a pre-push and
CI gate.

**Where the costs went.** `catalogCosts/{companyId}.jtCosts`, keyed
`jt-<slug(templateId)>-<index>` — the key `job-templates.js` had already been
computing for its `EstimateBuilderV2.CATALOG` bridge since v1, so no new
identifier was minted anywhere and the data diff is pure deletion.
`firestore.rules` gained a COMMENT ONLY: `match /catalogCosts/{companyId}`
already governs every field of that document.

**The explicit-zero rule, re-measured on the real stack before implementing.**
The plan's counter-intuitive finding reproduces exactly. With the cost keys
OMITTED, **14 of the 84** items resolve a labor rate through
`inferLaborId → LABOR_BY_SUB[category]` against the still-public
`estimate-labor-catalog.js`:

| item | category | omitted-key retail | via |
|---|---|---|---|
| Attic insulation baffles (×2 templates) | ventilation | **500.00** | `LAB INST-BV` |
| Exterior Trim Paint — Soffit & Fascia | trim | **390.00** | `LAB INST-FSC` |
| Pest Exclusion Vent Screening | soffit | 114.00 | `LAB INST-SFT` |
| Blank off existing box/gable vents | ventilation | 50.00 | `LAB INST-BV` |
| Downspout elbows & straps | downspout | 38.70 | `LAB INST-DSP` |
| Gutter seam & miter reseal | gutters | 36.50 | `LAB INST-GTR5` |
| Bath exhaust roof cap 4" | ventilation | 25.00 | `LAB INST-BV` |
| …7 more (gutters ×4, ventilation ×1, downspout/trim) | | 3.65 – 21.90 | |

With an **explicit 0**, all 84 resolve `matSource`/`labSource` `'explicit'` at
retail 0. The unknown state rides a separate `costUnset: true` flag that
presentation reads and the engine ignores. `tests/job-templates.test.js` locks
this across the whole population, not one sample: *"no book ⇒ ALL 84 JT custom
lines resolve explicit/0/unset — no labor inference anywhere."*

**The guard, rebuilt.** Layer 3 was a four-entry `STRICT_FILES` allowlist —
which is *how this leak survived*, and the reason "just add the file" was the
wrong fix twice over: measured, adding `job-templates-data.js` to that list
would have caught **zero**, because `STRICT_RES[0]` is
`/(?<![.\w])["']?cost["']?…/` and the lookbehind that makes `p.pricing[t].cost`
safe also rejects the `l` of `materialCost`. Two changes, both needed:

1. a named-cost pattern (`materialCost:`/`laborCost:`) in `STRICT_RES`, and a
   third cost-basis shape `COST_BASIS_NAMED_RE` in the layer-4 tree sweep;
2. layer 3 now **scans by default** — all 608 published js/json/html files —
   with 7 explicit exemptions, each carrying a `why`, each narrowed by an
   `allow` regex matched against the source line (so a real cost basis on an
   un-allowed line of an exempt file still fails), and each asserted
   **non-vacuous** so a dead exemption fails the suite and tells you to delete
   it. Exempted: permit fees by county, four AI-usage accumulators, a
   canvassing budget, and one blog sentence ("certified contractor: 20-year").

The suite went 48 → 72 assertions, and it was **proved to fail first**: run
against the un-stripped file it reported 49 line hits in
`job-templates-data.js` and 3 red assertions.

**Behaviour for a tenant with no book.** A complete scope of work — name, qty,
unit, description — with no price on the affected lines: no card price band
(rather than a plausible-looking total computed from missing costs), `—` in the
proposal's rate/total columns, a "Cost not set" chip, and a banner naming how
many items are excluded from the total. Never `$0.00`. The rep prices each line
with the existing `$ / unit` override, which already sets `materialCost = 0`
explicitly and so neither leaks nor trips inference.

**Files:** `functions/job-template-cost-logic.js` (new, pure),
`scripts/{extract,rotate,import,strip}-job-template-costs.js` (new),
`tests/job-template-cost-seed.test.js` (new, 35 assertions),
`docs/pro/js/{job-templates-data,job-templates,job-templates-ui,catalog-costs,estimate-logic-engine,script-loader}.js`,
`tests/{job-templates,catalog-cost-privacy,ci-manifest}`, `.github/workflows/ci.yml`,
`firestore.rules` (comment).

**One fix that is not cosmetic and is easy to miss.** `catalog-costs.js` called
`adoptLocal()` inside hydrate's `else` branch. Once `readBook()` started
accepting a `jtCosts`-only document, a tenant holding job-template costs but no
product costs would take the `if (remote)` branch and **permanently skip** the
one-time upgrade that lifts product costs out of per-device localStorage —
silent, unrecoverable data loss. `adoptLocal` now runs on both branches; its
own guard already made the already-adopted case a no-op. Pinned by
*"THE adoptLocal FIX: a jtCosts-ONLY document still triggers the product-cost
upgrade."*

**Verification run:** `check-js-syntax` (467 files) · `job-templates.test.js`
127 → **141** · `catalog-cost-privacy.test.js` 48 → **72** ·
`job-template-cost-seed.test.js` **35** (new) · `estimate-reopen-cost-basis`
10 (PR-A, still green) · `estimate-v2-payload` 90 · `estimate-profit` 54 ·
`estimate-pricing` 52 · `estimate-render` 74 · `invoice-pipeline` 33 ·
`money-display-consumers` 8 · `money-field-contract` 7 ·
`public-surface-leak-tripwire` 10 · `catalog-cost-seed` 56 · `product-data` 22 ·
the whole node bucket 35/35 · `run-test-manifest --check` ·
`check-site-integrity` · `check-inline-html-scripts` ·
`apply-partials --check`. `grep -c '"materialCost"' docs/pro/js/job-templates-data.js`
→ **0**, and the file still parses to 107 templates / 11 categories.

*(Pre-existing on the base branch, untouched by this PR: `build-sitemap.js` and
`build-projects.mjs --check` both report drift on a clean tree too — that
belongs to the `qc/site-sweep-2026-08-18` lane.)*

---

## The rotation, and why this box is still open

Rotation is the half of this fix that actually addresses the copies already
out there. The strip stops NEW exposure; it does not un-publish a blob that has
been readable at a fixed commit for a month, in every clone and every fork.
Making the figures inaccurate is what devalues those copies, and it is the only
remedy fully within Jo's control.

What shipped is the **mechanism**, wired so a no-op cannot pass as a rotation:

```bash
node scripts/extract-job-template-costs.js --from <pre-strip-sha>
node scripts/rotate-job-template-costs.js --worksheet     # 84 rows, JSON + CSV
# fill in current real figures
node scripts/rotate-job-template-costs.js --overrides .local/jt-cost-rotation.json
node scripts/import-job-template-costs.js --company <NBD companyId>        # dry run
node scripts/import-job-template-costs.js --company <NBD companyId> --yes
```

- the worksheet carries each key's template, item name, unit and current
  figures, so filling it in is data entry rather than archaeology;
- applying it **refuses below 50% coverage** — a rotation that leaves most
  values at their leaked numbers has devalued nothing, and the floor is only
  movable with an explicit `--min-coverage` you then have to record here;
- the rotated seed is stamped `rotatedAt` + `rotationCoverage`, and
  `import-job-template-costs.js` **refuses an unstamped seed** unless you pass
  `--unrotated`. "We meant to rotate and forgot" cannot quietly become the
  outcome.

**What Claude deliberately did not do: invent the numbers.** A blanket "scale
everything by 7%" would devalue the leaked copies and simultaneously put NBD on
fabricated money for live quoting — a worse failure than the leak. The figures
are Jo's. The box stays unticked until the worksheet is filled and imported.

`.local/jt-cost-seed.json` was extracted on this machine before the strip
(84 entries / 146 non-zero values, validated) and is the rollback insurance;
`.local/` is gitignored and the privacy suite asserts no extracted book is ever
tracked. After merge the same extract works from history with
`--from <pre-strip-sha>`.

---

## What this does NOT close

Stated plainly, because each of these is a decision rather than an oversight:

- **`docs/pro/js/estimate-builder-v2.js`** — 28 CATALOG entries with
  `cost:`/`labor:`. Already on `KNOWN_UNMIGRATED`, still leaking, still
  asserted to be leaking.
- **`docs/pro/js/estimate-catalog-xactimate.js`** — 276 `mat:`/`lab:` unit-cost
  line items. Same list, same status.
- **`docs/pro/js/estimate-labor-catalog.js`** — **66** entries carrying
  `rate: <$/unit>` beside `hoursPerUnit`: this shop's labor cost basis and the
  crew productivity that produces it. It is the file `inferLaborId()` resolves
  against, which is exactly why unpriced job-template items must emit an
  explicit 0 rather than omit the keys.

  > **Corrected 2026-08-18 (later same day).** This entry originally read "a
  > fourth spelling, on no list, invisible to all four regexes… deliberately
  > NOT added to `KNOWN_UNMIGRATED`, because that list carries a still-leaking
  > non-vacuity assertion and a file the sweep cannot see would fail it on
  > merge." That reasoning was circular and it has been closed:
  > **`COST_BASIS_LABOR_RE` now sees it (66 lines) and it IS on
  > `KNOWN_UNMIGRATED`.** The file still leaks — nothing was migrated — but the
  > leak is now measured, tracked, and asserted, so the day it is fixed the
  > guard fails and tells you to delete the line.
  >
  > The pattern is `rate: N` **paired with** `hoursPerUnit: N`, not a bare
  > `rate:`. Measured across all 608 published files: paired hits exactly one
  > file with zero false positives; bare hits five, including sales-tax rates
  > in `estimate-config.js` and close rates in `close-board.js`. A percentage
  > is not a cost basis. **Pairing is what has made every pattern in this suite
  > precise enough to run tree-wide — reach for it first the next time this
  > list grows.**
- **The margin derivation is still open.** `estimate-logic-engine.js` remains
  public with `materialMarkupPct` 0.25 / `overheadPct` 0.10 / `profitPct` 0.10.
  Git history plus the current tree still yields a full derivation for the
  three files above, and will until Phase 2 lands. Those three share
  `NBD_XACT_CATALOG.byCode` with JT custom items, so after this PR that one
  object holds tenant-owned and still-public costs side by side. **Migrate them
  together**, and add the `rate:`-shaped regex with a non-vacuity partner in
  the same PR.
- **Git history** — deliberately intact. One commit (`5b747d0b`), 235 commits
  to rewrite, 10 active worktrees. Rotation instead. Do not rewrite without
  Jo's explicit instruction; if it ever happens, do it once, covering all four
  files, and file the fork-network GC request.
- ~~**No in-app cost editor.**~~ **SHIPPED as PR-C, 2026-08-19.** The per-item
  editor row now carries Material and Labor $/unit fields, so "enter your own
  costs" is an action a tenant can take in-product. Three properties hold it
  together: **gated** behind `canEditCosts()`, which mirrors
  `firestore.rules` — a viewer or `sales_rep` sees no field at all, because the
  rule would refuse their write and they would find out at quote time rather
  than at edit time; **staged** until Save, because these are company-wide
  values, so Cancel means cancel and a half-typed number never briefly becomes
  every rep's cost; and **never written onto the template**, which is
  uid-scoped — re-embedding cost there is exactly the leak this migration
  removed, and keying by `jt-<slug>-<index>` means setting a cost on a default
  template does not force a fork.

  The gate is an affordance, not the boundary. The rule is the boundary, and
  the write path reports a refusal honestly rather than showing a success it
  cannot back up — claims go stale, and a client check can always be wrong.

  The test that used to assert *no* cost input exists inverted rather than
  being deleted: it now asserts the fields exist AND sit inside the gate,
  measured by source offset rather than a character window (a window is a magic
  number that stops proving anything the moment the markup grows past it).

  Worth recording: the privacy guard caught this PR's own
  `{ materialCost: 0, laborCost: 0 }` placeholder on the first run. It is a
  default, not a cost basis — but the guard is shape-based and cannot tell the
  difference, so the code changed rather than the guard learning an exception.
- **A rep's forks never migrate.** `adoptLegacyCosts()` writes to
  `catalogCosts/{companyId}`, which rules restrict to owner/company_admin. A
  tenant whose pre-strip forks live on a `sales_rep`'s device keeps pricing
  from the embedded legacy costs, per-device, forever. Not "automatic for
  everyone".
- **Floats, not cents.** This path is float dollars end to end (24 of the 84
  items carry sub-dollar decimals, minimum 0.12), diverging from the CLAUDE.md
  money-in-cents invariant the same way `estimate-logic-engine.js` already
  does. Converting inside a leak fix would multiply the blast radius against
  live pricing. Recorded, not done.

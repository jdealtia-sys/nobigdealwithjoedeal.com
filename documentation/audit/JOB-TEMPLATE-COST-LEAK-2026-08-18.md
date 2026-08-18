# Job-template contractor costs are published — 2026-08-18

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
| Examples | `Siding patch at kickout` mat 40 / lab 120 · `Masonry water repellent` mat 35 / lab 65 · `Minor tuckpointing` mat 4 / lab 18 |

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
- [ ] **PR-A** — reopen preserves saved cost basis (prerequisite; ships first)
- [ ] **PR-B** — strip the 146 values, `jtCosts` on the tenant cost book
- [ ] `job-templates-data.js` brought under the privacy guard
- [ ] Guard changed from allowlist to scan-by-default
- [ ] Cost figures rotated (this is what actually devalues the historical copies)

Jo runs the extract/import scripts; a production Firestore migration is not
something to execute unattended.

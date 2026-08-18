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

## Status

- [x] Leak identified, measured, and root-caused
- [x] Git-history exposure assessed
- [ ] Migration implemented (design in progress at time of writing)
- [ ] `job-templates-data.js` brought under the privacy guard
- [ ] Guard changed from allowlist to scan-by-default
- [ ] Cost figures rotated

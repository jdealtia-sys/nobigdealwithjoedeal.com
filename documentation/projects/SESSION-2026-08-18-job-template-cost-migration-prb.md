# PR-B — the job-template cost strip, landed (2026-08-18)

The leak: [JOB-TEMPLATE-COST-LEAK-2026-08-18](../audit/JOB-TEMPLATE-COST-LEAK-2026-08-18.md) ·
The brief: [JOB-TEMPLATE-COST-MIGRATION-PLAN-2026-08-18](JOB-TEMPLATE-COST-MIGRATION-PLAN-2026-08-18.md) ·
The precedent this mirrors: `functions/catalog-cost-logic.js` (2026-07-30)

`docs/pro/js/job-templates-data.js` published 84 contractor cost pairs — 146
non-zero values — unauthenticated, beside a public `estimate-logic-engine.js`
carrying the markup math, so cost basis *and* margin were derivable. PR-A
(`d8afd7e3`) made reopening a saved estimate stop re-pricing it. This is PR-B:
the strip.

**At HEAD: `grep -c '"materialCost"' docs/pro/js/job-templates-data.js` → 0.**
The file still parses to 107 templates / 11 categories and still drives the
library. The costs live at `catalogCosts/{companyId}.jtCosts` with **zero
firestore.rules changes**.

Full record of what shipped, what was measured, and what is still open is in
the audit note under "What PR-B shipped". This note is the part Jo needs: the
runbook, and where the implementation deviated from the brief.

---

## Jo's runbook — in this order, nothing skipped

Claude does not write prod. Every step below is yours.

**Step 0 — the seed already exists on this machine.** `.local/jt-cost-seed.json`
was extracted before the strip: 84 entries, 146 non-zero values, validated.
`.local/` is gitignored and the privacy suite asserts no extracted book is ever
tracked. If you need it again after merge:

```bash
node scripts/extract-job-template-costs.js --from <pre-strip-sha>
```

**Step 1 — rotate. Do not skip this; it is the half of the fix that addresses
the copies already out there.**

```bash
node scripts/rotate-job-template-costs.js --worksheet
```

Writes `.local/jt-cost-rotation.json` and a `.csv` alongside it — 84 rows, each
carrying the template, item name, unit and current figures. Put your current
real material/labor cost on each line. Leave a row blank to keep the existing
(leaked) figure; you will be told how many you kept.

```bash
node scripts/rotate-job-template-costs.js --overrides .local/jt-cost-rotation.json
```

It refuses below 50% coverage and stamps `rotatedAt` on the output. Claude did
**not** invent numbers for you: a blanket percentage would devalue the leaked
copies and simultaneously put you on fabricated money for live quoting, which
is worse than the leak. The figures are yours.

**Step 2 — write NBD's book to production BEFORE PR-B deploys.** `jtCosts` is
inert to the currently-deployed client, so this is safe and it means NBD never
sees a "Cost not set" state at all.

```bash
node scripts/import-job-template-costs.js --company <NBD companyId>
```

```bash
node scripts/import-job-template-costs.js --company <NBD companyId> --yes
```

Dry run is the default. It refuses an unrotated seed (`--unrotated` overrides,
deliberately), refuses to run over an existing `jtCosts` map (`--force`
overrides), and touches only `jtCosts` — this company's *product* cost book on
the same document is provably untouched. One document. Zero other tenants.

**Step 3 — merge and deploy PR-B.**

**Step 4 — read back as that tenant.** Estimates → Job Templates, insert a
template with a known custom item, confirm it prices at your figure with no
"Cost not set" chip. Then reopen a saved estimate containing a `JT *` row,
nudge one measurement, and confirm the grand total does not move (that is PR-A
still holding). **This step is manual on purpose — the tests drive the real
engine in a vm, but nothing here has been clicked in the real app.**

---

## The consequence, stated plainly

**Every tenant except the one you import loses job-template pricing.** That is
the same call `import-catalog-costs.js` made in July and for the same reason:
these are NBD's Cincinnati numbers that leaked into a platform artifact, and
seeding them to everyone would close the public-URL surface while leaving the
second leak — one company's supplier terms becoming everyone's starting pricing
— fully intact, just relocated into private documents.

What an unpriced tenant sees: a **complete scope of work** — name, qty, unit,
description — with no card price band, `—` in the proposal's rate/total
columns, a "Cost not set" chip, and a banner naming how many items are excluded
from the total. Never `$0.00`, never a fabricated margin. They quote by typing
a `$ / unit` per line, which prices the line exactly on the typed number.

~~**Until an in-app cost editor ships, "enter your own costs" is not an action a
non-NBD tenant can take in-product.**~~ **PR-C shipped 2026-08-19.** An owner or
`company_admin` can now enter Material and Labor $/unit per item in the template
editor, writing the company cost book directly. A viewer or `sales_rep` sees no
cost field at all, because `firestore.rules` would refuse their write and they
would find out at quote time rather than at edit time. Anyone still quotes an
unpriced item with the per-line `$ / unit` override.

That removes the blocker on comms: a second live tenant using job templates can
now price them without an owner running an import.

**Also new, and worth knowing before a support ticket arrives:** template
*definitions* stay uid-scoped, template *costs* are now company-scoped. Two
reps in one company who each forked the same default template now share one
cost entry. That is correct — a company has one buy price for "Masonry water
repellent" — but it is a change from the per-device drift that preceded it.
And a tenant whose pre-strip forks live on a `sales_rep`'s device never
migrates to the company book at all: rules restrict that write to
owner/company_admin, so their templates keep pricing from the embedded legacy
costs, per-device.

---

## Where the implementation deviated from the brief

Three substantive deviations, all in the direction of the brief's own
reasoning:

**1. The strip codemod self-verifies structurally.** §B4 asked for a textual
codemod plus a `--check` gate. It got both, plus a verification pass: after
rewriting, it re-loads its own output and asserts template-by-template that the
result is exactly `stripJtCosts(original)` by `JSON.stringify` equality, key
order included, and refuses to write on any mismatch. A textual edit to 49
minified lines of money data deserved more than a diff review.

**2. Layer 3 of the privacy guard became scan-by-default.** §"test changes"
proposed adding `job-templates-data.js` to `STRICT_FILES`. The brief itself
measured that this catches *zero* (the `cost` pattern's lookbehind rejects the
`l` of `materialCost`), which the named-cost regex fixes — but adding a fifth
allowlist entry would have left the allowlist. It now sweeps all 608 published
files with 7 explicit exemptions, each carrying a reason, each narrowed by an
`allow` regex matched against the source line, each asserted non-vacuous so a
dead exemption fails the suite. This was the audit note's own recommendation
and it is the second allowlist-shaped guard failure in a day.

**3. Rotation grew a real toolchain.** The brief and the audit both said
"rotate the numbers" without saying how. It is now three commands with a
worksheet, a **50% coverage floor** that refuses a no-op rotation, a
`rotatedAt` stamp, and an import that refuses an unstamped seed. What it
deliberately does not do is invent figures.

Smaller notes: `applyJtCostSeed()` also runs `adoptLegacyCosts()`, because that
is the one moment both the book and the template store are known to exist;
`duplicate()` carries the source's book entries onto the new keys (a new
template id re-keys everything, so the copy would otherwise be silently
unpriced); and `saveCustom()` lifts costs out of the template clone *before*
`persistCustoms`, so forking no longer re-embeds the data the strip removed.

---

## The one non-obvious fix in here

`catalog-costs.js` called `adoptLocal()` inside hydrate's `else` branch. That
was correct while `costs` was the only map on the document. The moment
`readBook()` started accepting a `jtCosts`-only book, a tenant holding
job-template costs but no product costs would take the `if (remote)` branch and
**permanently skip** the one-time upgrade that lifts product costs out of
per-device localStorage — silent, unrecoverable. It now runs on both branches;
its own guard already made the already-adopted case a no-op.

Pinned by `tests/job-template-cost-seed.test.js`: *"THE adoptLocal FIX: a
jtCosts-ONLY document still triggers the product-cost upgrade."*

---

## Guard status

`tests/job-templates.test.js` 127 → **141** · `tests/catalog-cost-privacy.test.js`
48 → **72** · `tests/job-template-cost-seed.test.js` **35** (new) ·
`tests/estimate-reopen-cost-basis.test.js` 10 (PR-A, still green).

Two proof-of-work checks worth repeating if anyone touches this:

1. **The privacy guard was made to fail first.** Run against the un-stripped
   file it reported 49 line hits in `job-templates-data.js` and 3 red
   assertions. A guard nobody has watched fail is not a guard.
2. **The inference lock.** `tests/job-templates.test.js` asserts that with no
   cost book, *all 84* JT custom lines resolve `matSource`/`labSource`
   `'explicit'` at retail 0. If anyone changes `materialCost: 0` back to an
   omitted key, 14 items start pricing off the still-public labor catalog and
   this fails. That is its whole job.

Registered in `tests/ci-manifest.json` (`wired-individually`) with named
`ci.yml` steps, including `scripts/strip-job-template-costs.js --check` as a
cheap second spelling of the gate — independent of the privacy suite's regexes,
because that suite is exactly what failed to look at this file for a month.

---

## Still open

The cost figures are **not yet rotated** — that is the open item that needs Jo.

**Phase 2's exposure is now measured rather than estimated**, which was the
follow-up to this PR: `estimate-builder-v2.js` **28** · 
`estimate-catalog-xactimate.js` **276** · `estimate-labor-catalog.js` **66** =
**370 cost-basis entries across three published files**, every one on
`KNOWN_UNMIGRATED` and asserted still-leaking, so each fails the guard the day
it is fixed. Nothing was migrated; nothing is invisible any more.

That last file was the point of the follow-up. It was a fourth spelling —
`rate: <$/unit>` beside `hoursPerUnit` — matching none of the three existing
patterns, so it was simultaneously unswept *and* unlisted. The original note
here said it could not be listed because `KNOWN_UNMIGRATED` asserts each entry
is still detectably leaking; that was circular, and the way out was to write
the regex first. `COST_BASIS_LABOR_RE` does that.

**The transferable bit: pair the number with its partner.** Measured across all
608 published files, `rate:` + `hoursPerUnit` hits one file with zero false
positives; a bare `rate:\s*\d` hits five, including sales-tax rates and close
rates. Every pattern in that suite that survives tree-wide scanning is a
pairing — cost/labor, mat/lab, materialCost/laborCost, rate/hoursPerUnit.
Reach for a pairing, not a keyword, when this list grows again.

The three files share `NBD_XACT_CATALOG.byCode` with JT custom items, so
migrate them **together**. Full reasoning under "What this does NOT close" in
the audit note.

Git history is deliberately intact (one commit, 235 to rewrite, 10 live
worktrees). Rotation instead. Do not rewrite without Jo's explicit instruction.

*(Unrelated and pre-existing on this base branch: `build-sitemap.js` and
`build-projects.mjs --check` both report drift on a clean tree. That belongs to
the `qc/site-sweep-2026-08-18` lane, not to this PR.)*

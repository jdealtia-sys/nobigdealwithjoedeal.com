# Runbook — Cost-basis rotation (labor / xact / v2 catalogs)

**When:** closing the Grok Pro/CRM audit's decision 3 (cost basis) — the
worksheets are prepared; you fill in real figures and run the apply/import
steps yourself. This is a **Jo-only** runbook: `import-cost-rotation.js`
writes to prod Firestore and refuses to run without `--yes`. The
2026-09-13 audit evaluation's decision 3 scoped it that way on purpose —
Claude prepares the worksheets and this runbook, you fill in and run
against real figures in a live session.

## Why this exists

`tests/catalog-cost-privacy.test.js` and the [Grok Pro/CRM audit
evaluation](../audit/GROK-CRM-AUDIT-EVALUATION-2026-09-13.md) (verdict row
7) confirmed the finding this closes: the Xactimate-style catalog's
material + labor unit costs are readable on a public URL (lazy-loaded, but
still a public URL). The repo stays public this quarter
(`SECURITY.md`'s dated decision), so the fix isn't hiding the file — it's
making the **published figures stale**. `scripts/cost-rotation.js`'s own
header explains the reasoning in full: any deterministic transform of a
leaked number is invertible by anyone with a clone, so de-identifying it is
theatre. What actually closes the leak is your **real, current** figures
living in `catalogCosts/{companyId}` in Firestore, where they win over the
published starter book for every tenant that enters them — starting with
NBD's own.

Prior cost-lane work this closes the loop on:
[NEXT_SESSION-2026-08-19](../projects/NEXT_SESSION-2026-08-19.md) §0 and
[SESSION-2026-08-19-cost-lane-close](../projects/SESSION-2026-08-19-cost-lane-close.md)
(the 2026-08-19 session that closed the *client-side* leak — no
`materialCost`/`laborCost` served to the browser anymore — and built this
rotation tooling, unrun since).

## The three catalogs

| catalog | rows | what it holds |
|---|---|---|
| `labor` | 66 | labor actions — rate, hoursPerUnit, crewSize |
| `xact` | 277 | Xactimate-style line items — materialCost, laborCost |
| `v2` | 28 | package entries — cost, labor |

`tests/cost-basis-ledger.js` is the standing guard: it prints
`ROTATION OUTSTANDING — 3 of 3` until all three catalogs have a rotation
record pasted into it (see the last step below). It does not fail CI on
its own — it's a loud, honest status line, not a gate — but it is the one
place "has this actually been done" is answered without re-deriving it.

## Sequence

### 0. Worksheets — already generated for you

This session ran `node scripts/cost-rotation.js --catalog all --worksheet`
and the three worksheets are sitting in `.local/` (gitignored — never
committed, per the script's own design: writing a rotation worksheet back
into the repo would recreate the leak it's fixing):

```
.local/rotation-labor.json   (+ .csv)
.local/rotation-xact.json    (+ .csv)
.local/rotation-v2.json      (+ .csv)
```

Each `.csv` has the published figure in a `current_*` column next to blank
columns for the real value (`rate`, `hoursPerUnit`, `crewSize` for labor;
`materialCost`, `laborCost` for xact; `cost`, `labor` for v2). Open the CSV
in a spreadsheet, fill the blanks with NBD's actual current cost basis, and
save — the `.json` alongside it is what `--apply` actually reads, so either
fill the JSON directly or keep the CSV and JSON in sync yourself (the
script does not read the CSV back).

**Labor first if time is short** — 66 rows is the smallest catalog and the
apply/import/ledger-paste sequence below is identical for all three, so
finishing one end-to-end before starting the next two proves the whole
pipeline works.

### 1. Apply — turn a filled worksheet into a rotation record

One catalog at a time, from the repo root:

```bash
node scripts/cost-rotation.js --catalog labor --apply .local/rotation-labor.json
node scripts/cost-rotation.js --catalog xact  --apply .local/rotation-xact.json
node scripts/cost-rotation.js --catalog v2    --apply .local/rotation-v2.json
```

This validates the filled sheet (every row must have a real value — it
refuses a still-blank column) and prints a rotation record: a hash of the
old published figures, a hash of the new ones, and a timestamp. **Copy
that printed record** — it's what step 3 asks you to paste.

### 2. Import — write NBD's rotated figures into Firestore

```bash
# dry run first (default — no write happens without --yes)
node scripts/import-cost-rotation.js --catalog labor --company <NBD companyId>
# then for real
node scripts/import-cost-rotation.js --catalog labor --company <NBD companyId> --yes
```

Repeat for `xact` and `v2`. `<NBD companyId>` is your own tenant id — for
a solo/NBD-shaped account this is the same as your Firebase Auth uid
(`companyId == uid`; see
[PILLAR4-BILLING-PLAN.md](../architecture/PILLAR4-BILLING-PLAN.md)'s note
on why the two keys are byte-identical for NBD). Needs
`GOOGLE_APPLICATION_CREDENTIALS` set, same as the other backfill scripts.

The import writes only to **NBD's** `catalogCosts/{companyId}` doc —
`laborOps`, `xactCosts`, `v2Costs` fields alongside the `costs`/`jtCosts`
already there. Every other tenant keeps seeing the published (now stale)
starter baseline until they enter their own figures, which is deliberate:
that baseline can't be un-published, so what actually closes the leak for
each tenant is their own actuals no longer matching it.

It refuses to run a second time over a catalog NBD already holds (add
`--force` only if you're deliberately re-importing — Firestore's
`{merge:true}` deep-merges nested maps, so a careless re-import would
silently revert any hand-edit you've made in the dashboard since).

### 3. Paste the record into the ledger

Open `tests/cost-basis-ledger.js` and replace the matching catalog's
`rotation: null` (there are three — one per catalog, see the comment above
each) with the record step 1 printed. This is what flips the guard's
`ROTATION OUTSTANDING — 3 of 3` line down as each catalog closes, and it's
the durable, checked-in proof the rotation happened (the record is a hash
pair, not the figures themselves — nothing sensitive lands in git).

### 4. Confirm

```bash
node tests/cost-basis-ledger.js
```

Should report `0 of 3 outstanding` once all three catalogs are done, or
the correct remaining count if you're doing this in stages (labor first is
fine — see above).

## What this does NOT do

- It does not change what's already committed at old commits — those
  figures stay readable forever at their pre-strip SHAs, in every existing
  clone. That's accepted (see `scripts/cost-rotation.js`'s header for why
  a history rewrite was assessed and declined).
- It does not touch any OTHER tenant's cost book. Only NBD's.
- It is not a substitute for deciding whether the catalog repo should stay
  public — that's the separate, already-recorded decision in `SECURITY.md`
  (repo stays public this quarter).

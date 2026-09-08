# /photos `createdAt` — the two writers the "every writer" test never named

**2026-09-08** · closes open item 5 of
[SESSION-2026-09-08-photo-report-builder](../projects/SESSION-2026-09-08-photo-report-builder.md)
· stacked on PR #1483

## The reported bug, and what it actually was

The report was: `uploadSinglePhoto` (`docs/pro/js/customer-bootstrap.module.js`)
stamps `date` + `uploadedAt` but no `createdAt`, so `_comparePhotoReportOrder`
in `docs/pro/js/photo-report.js` scores those photos `0` and the PDF comes out
in arbitrary order.

That is true, and it is the smaller half. `createdAt` is not just the report's
sort key — it is the **ordering field of two Firestore queries**:

- `photo-engine.js` `getPhotosForLead` → `orderBy('createdAt', 'desc')`
- `dashboard-widgets.js` Recent photo feed → `orderBy('createdAt', 'desc')`

Firestore's `orderBy` **silently excludes documents that lack the ordered
field**. So a photo uploaded from the customer page was not mis-sorted in those
two views — it was **absent from them**. The report's arbitrary ordering was
the visible symptom of a doc that several readers could not see at all.

## Enumerating the writers first

The task asked for the sibling paths rather than the reported one. `/photos`
has **six** create paths:

| # | Writer | Stamped | Status |
|---|--------|---------|--------|
| 1 | `photo-engine.js` upload | `createdAt` + `capturedAt` + `uploadedAt` | ok |
| 2 | `dashboard-bootstrap.module.js` `_uploadPhoto` | `createdAt` | ok |
| 3 | `photo-editor.js` annotated copy | `createdAt` | ok |
| 4 | `repos.js` `photos.create` via `stampCreate` | `createdAt` | ok, and **no callers** — only a JSDoc example and a test reference it |
| 5 | `customer-bootstrap.module.js` `uploadSinglePhoto` | `date` + `uploadedAt` | **missing** — the reported one |
| 6 | `functions/portal.js` `uploadHomeownerPhoto` | `uploadedAt` | **missing** — not previously known |

Writer 6 is the find. The homeowner portal upload has the same gap, server-side,
and it is worse in one specific way: the same handler fires a "homeowner
uploaded a photo" notification into the rep's bell — pointing them at a gallery
the photo is not in.

Both now stamp `createdAt`. `date` and `uploadedAt` stay, because other readers
still name them (`customer-bootstrap`'s own timeline reads `uploadedAt`).

## Why the existing guard was green

`tests/photos-timestamp-contract.test.js` opens with:

> 1. EVERY /photos create path stamps `createdAt` (serverTimestamp).

…and then asserts on four of the six. The two it never enumerated were exactly
the two that were broken. Nothing failed, because nothing looked.

This is the `ask-which-sibling-path-is-uncovered` shape again, at the level of
the *test* rather than the fix: the claim was universal, the coverage was a
list, and the list was written when the list was complete. **A test whose
headline says "every" needs a mechanism or a count, not an enumeration.** The
header now carries the count and says explicitly that adding a seventh writer
means adding a case.

## The comparator, and one chain instead of two

Fixing the writers does nothing for the documents already in Firestore, so
`_comparePhotoReportOrder`'s fallback was broadened. It read
`createdAt.seconds` and nothing else, which scored `0` for:

- writer 5's shape (`date` + `uploadedAt`),
- writer 6's shape (`uploadedAt`),
- writer 1's pre-cutover docs (`capturedAt`),
- **and any `createdAt` arriving as a live Firestore `Timestamp`** — those
  expose `toMillis()`, not an enumerable `seconds`.

All of them tied at `0` and came back in Firestore's return order.

Field resolution and shape coercion moved into `_photoTimestampMs`.
`_dateLabel` — which already implemented that exact chain — now calls it too,
rather than the two carrying separate copies. That is not only de-duplication:
while the comparator read `createdAt` and the caption read EXIF `takenAt`, a
frame captioned "Jan 10" could sort **after** one captioned "Feb 10" in the
same PDF. One helper makes that unrepresentable, and there is an assertion
that says so.

The fallback *direction* is unchanged (ascending). Only the field set widened.

## Backfill

`scripts/backfill-photos-createdAt.js` already exists and needed **no change to
its derivation** — both missing shapes carry `uploadedAt`, which is its first
branch, and `snap.createTime` backstops everything else.

It does need a **second pass**, for the docs writers 5 and 6 wrote since its
first run. Dry-run is read-only and always allowed:

```bash
node scripts/backfill-photos-createdAt.js
```

If the earlier run recorded a marker in `system/script_migrations` the `--apply`
refuses with exit 3 and the catch-up needs `--force`; if it ran before
`_migration-guard.js` existed there is no marker and `--apply` proceeds. It is
idempotent either way. **Not run from this session** — that is a prod write and
was not asked for.

## A trap worth keeping: whole-file de-commenting runs away here

The new write-path assertions strip comments before matching, because this repo
quotes the defect verbatim when explaining a fix — so a raw-source regex can be
satisfied by the prose *describing* the bug. The obvious helper is the one in
`tests/photo-report-builder.test.js`. **Both orderings of it break on this
repo's sources:**

- **block comments, then `//` lines** (the existing helper): a `//` comment
  containing `'image/*'` at `customer-bootstrap.module.js:2336` opens a
  `/*`…`*/` match that runs **46,262 characters** to the next `/* ignore */`
  and swallows the `photoDoc` literal. The file goes 178,051 → 89,828 chars.
- **`//` lines, then block comments**: filtering `*`-prefixed lines removes
  every JSDoc's closing `*/` and leaves its `/**` to run away instead.

The fix used here is to **slice the region out of raw source first and strip
comments from the slice only** — small enough to check by eye. Note that
`photo-report-builder.test.js` still uses the whole-file form; it is not wrong
today (its assertions survive the mangling) but it is one stray `'image/*'`
away from being quietly wrong. Left alone rather than widened into #1483's
file; flagged here.

## Verification

- `tests/photos-timestamp-contract.test.js` — 17 assertions. §4 is behavioural:
  real arrays through the real comparator, `vm`-lifted out of `photo-report.js`,
  not regexes over source.
- **Break-tested, checking which assertion reddens.** Reverting the comparator
  to `.seconds`-only reddens the five shape/ordering assertions and leaves the
  two drag-order ones green (correct — `order` still wins). Removing either
  `createdAt` reddens only that writer's assertion. Making `_dateLabel` stop
  sharing the helper reddens the caption/sort-agreement assertion specifically.
- `photo-report-builder.test.js` needed a fix: its sandbox lifts `_dateLabel`
  in a slice that does not contain `_photoTimestampMs`, so every `_dateLabel`
  assertion died on a `ReferenceError`. It now lifts the helper first — 94
  assertions pass.
- Full local run: node bucket 98/98, smoke bucket 65/65 (this suite is in the
  **smoke** bucket and genuinely executes there), `tests/smoke.test.js` 3641/0,
  site-integrity clean, `apply-partials --check` clean, 496 JS files parse.

## Related

- [SESSION-2026-09-08-photo-report-builder](../projects/SESSION-2026-09-08-photo-report-builder.md) — open item 5, now closed
- [STABILITY-AUDIT-2026-09-04](STABILITY-AUDIT-2026-09-04.md) — the storage-token findings on the same collection
- [SUITE-COUNT-FLOORS-2026-09-08](SUITE-COUNT-FLOORS-2026-09-08.md) — the sibling "a green gate proving nothing" thread

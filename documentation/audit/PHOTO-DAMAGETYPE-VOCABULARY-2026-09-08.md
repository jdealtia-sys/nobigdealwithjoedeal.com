# /photos.damageType — four vocabularies in one field (2026-09-08)

**Status:** fixed at HEAD of `claude/infallible-herschel-8de678`.
**Related:** PR #1483 (photo-report builder), [SESSION-2026-09-03-photo-reaping-and-phone-truth](../projects/SESSION-2026-09-03-photo-reaping-and-phone-truth.md).

---

## 1. What was actually wrong

`/photos.damageType` carried **four** vocabularies simultaneously, not two.
Enumerated by grepping every writer and reader (the field name is shared with
an unrelated `lead.damageType`, so the raw grep is misleading — see §2).

| # | Surface | Shape | Values |
|---|---|---|---|
| 1 | `docs/pro/js/photo-editor.js` `DAMAGE_TYPES` | Title Case, 13 | `Hail` `Wind` `Leak` `Missing Shingle` `Cracked Tile` `Flashing Damage` `Gutter Damage` `Soffit/Fascia` `Tree Damage` `Algae/Moss` `Ice Dam` `Ponding Water` `Other` |
| 2 | `docs/pro/js/customer-tasks-ui.js` quick-edit popup | Title Case, 10 | as above **minus** Algae/Moss, Ice Dam, Ponding Water, and with `Flashing` / `Gutter` instead of `Flashing Damage` / `Gutter Damage` |
| 3 | `docs/pro/customer.html:1661` bulk bar | kebab-case, 7 | `hail` `wind` `missing-shingles` `leak` `granule-loss` `lifted-shingles` `other` |
| 4 | `docs/pro/js/pages/photo-review.js` + `functions/photo-vision.js` | snake_case, 7 | `hail` `wind` `wear` `granular_loss` `leak` `none` `other` |

Vocabularies 1 and 2 disagree **with each other**, and 3 uses a different word
(`granule` vs `granular`) *and* a different separator *and* a different number
(`missing-shingles` vs `Missing Shingle`) from every other list.

## 2. Correcting the brief

The task brief for this session was right that the field is polluted and right
about which form to canonicalise on, but three of its specifics did not survive
verification. Recording them because acting on them would have produced a
narrower fix and a test suite that proved nothing.

**a. "A 'Hail' before-photo will never pair with a 'hail' after-photo" — false.**
`_buildPairs` tier 2 does not key on the raw string. It keys on
`normKey(dmgOf(p))`, and `normKey` has always lowercased, trimmed and collapsed
whitespace. Case-only differences paired correctly before this session's change.
Proven by reverting the fix and re-running: the `'Hail'`/`'hail'` fixture stays
**green**, while the six separator/wording fixtures go red.

The real break is **separator and wording drift**, which lowercasing does not
touch:

```
'granule-loss'    (bulk bar) vs 'granular_loss'    (AI)          -> no pair
'Missing Shingle' (editor)   vs 'missing-shingles' (bulk bar)    -> no pair
'Flashing Damage' (editor)   vs 'Flashing'         (quick-edit)  -> no pair
'Gutter Damage'   (editor)   vs 'Gutter'           (quick-edit)  -> no pair
```

**b. "The rep sees fewer pairs than the data supports, with no indication why"
— understated.** A missed tier-2 pair is not a silently absent pair. When tiers
1 and 2 both come back empty, **tier 3 fires** (`if (out.length === 0)`) and
emits a chronological pair labeled **"Project overview"**. So two photos of one
peril are shown to an adjuster under a generic label rather than
"Damage: granular loss" — wrong output, not missing output. Every new pairing
fixture therefore asserts the **label**, not just `out.length === 1`; a
length-only assertion passes with the bug present.

**c. My own error: "the named files do not exist" was wrong.**
Mid-session I reported that
`documentation/projects/SESSION-2026-09-08-photo-report-builder.md`,
`tests/photo-report-output-contract.test.js` and
`tests/photo-report-builder.test.js` were absent from the repo, and that no
document tracked a damageType open item. **All four exist.** They arrived in
PR #1483 (`ac8f7e69`), which landed on `main` *after* this worktree's base —
the branch was five commits behind, and I checked the working tree instead of
`origin/main`. Open item 4 of that session note is exactly this defect; it says
**three** vocabularies, and the fourth (the kebab bulk bar) is the addition
here.

This is the same misread recorded in
[REMOTE-BRANCH-CLEANUP](REMOTE-BRANCH-CLEANUP-2026-09-05.md)-adjacent notes and
in the standing lesson about diffing against a moved `main`, inverted: there the
error was calling a moved-forward `main` a stale copy; here it was calling a
stale base the whole repo. **`git fetch` and check `HEAD..origin/main` before
asserting anything is absent.**

## 3. A second, quieter consequence

`docs/pro/js/pages/photo-review.js` `chipState()` decides accepted vs overridden
with `manual === ai`. A rep who opened photo-editor.js and picked **`Hail`**
over an AI suggestion of **`hail`** was scored `overridden` — the UI told them
they had disagreed with the AI at the moment they agreed with it. Same root
cause, different surface; it does not show up in the report at all.

## 4. Why this stayed invisible

`_damageLabel` humanised only the seven lowercase values and returned the raw
value otherwise. `'Hail'` → `'Hail'`, `'Missing Shingle'` → `'Missing Shingle'`:
the Title Case vocabularies rendered *correctly by accident*, because they were
already human-readable. Only the kebab bulk bar leaked visibly
(`'granule-loss'` printed literally in the adjuster PDF), and that is the
newest and least-used of the four surfaces.

## 5. The fix

`docs/pro/js/photo-damage-types.js` — one canonical vocabulary
(`window.NBD_PHOTO_DAMAGE`), lowercase snake_case, the **union** of all four
lists (17 ids) so adopting it loses no value any surface could previously
record. Labels for the seven ids `_damageLabel` already knew are reproduced
exactly, so no existing report changes wording.

`normalize()` slugifies (lowercase → non-alphanumeric runs to `_` → trim `_`)
then applies an alias table (`granule_loss`→`granular_loss`,
`flashing_damage`→`flashing`, `missing_shingles`→`missing_shingle`, …).

Two deliberate non-collapses:

- **Unknown values pass through slugified, never folded to `other`.** A rep's
  free-text peril still groups with itself in tier 2, and nothing is destroyed
  on write — an unrecognised value can be aliased later without a re-backfill.
- **`none` stays distinct from `''`.** `none` is the AI saying "I looked, there
  is no damage"; `''` is an untagged photo, and `chipState` must keep telling
  them apart.

Normalised **on write and again on read**, so legacy docs behave correctly with
no backfill dependency:

| File | Change |
|---|---|
| `photo-damage-types.js` | new — the canon |
| `photo-report.js` | `_damageLabel`, `_buildPairs` `dmgOf` |
| `pages/photo-review.js` | `damageOf`, `chipState` (both sides), `chipValue`, `FIELD_OPTIONS`, both write paths, accept-toast |
| `photo-editor.js` | option list, both `saveTagsOnly`/annotate writes, both load paths, `refreshPanelFields` |
| `customer-tasks-ui.js` | badge label, `photoDocToView`, quick-edit select + save, `applyBulkPhotoUpdate` |
| `customer.html` | bulk-bar `<option value>`s → canonical ids |
| `photo-engine.js` | AI chip renders the label, not the raw enum |
| `dashboard.html`, `photo-review.html` | load the canon |

The canon is a **classic script, not an ES module**, on purpose:
`photo-report.js` is loaded into a Node `vm` sandbox by its test with a bare
`{ window: {} }` context, and `export` syntax would not run there. The ES-module
consumer (`pages/photo-review.js`) reads the same global.

One thing the rebase onto #1483 caught: that PR changed `shapePhoto` to send
`_damageLabel(p)` — the **label** — to the server, and
`functions/print/templates/photoReport.hbs:176,216` prints it verbatim into the
PDF. My pre-rebase version sent the canonical **id**, which would have printed a
literal `granular_loss` to an adjuster. The conflict was resolved in favour of
#1483's line, which now folds through the shared canon for free. Had the two
changes landed in the other order, nothing would have flagged it.

`functions/photo-vision.js` needed **no change** — its `ALLOWED_DAMAGE` set is
already canonical. That is now an asserted cross-file contract rather than a
coincidence.

## 6. Coverage

Behavioural, not regex-over-source — the same posture as the
[booking multi-event session](../projects/SESSION-2026-09-07-booking-multi-event.md)
("vm-sandboxed so the real branching runs rather than a regex over source") and
the [Instant Roofer field wiring](INSTANTROOFER-SURFACE-REVIEW-2026-09-07.md).

- `tests/smoke/photo-report-pairs.test.js` — drives the real
  `window._buildPhotoReportPairs` with photo objects spelled across surfaces:
  eight cross-vocabulary rows, a negative control (`hail` before + `wind` after
  must **not** pair — otherwise "fold everything to `other`" would pass), and a
  grouping fixture proving several spellings of one peril build **one** tier-2
  key. Its loader now runs `photo-damage-types.js` into the same sandbox first,
  mirroring the browser's load order.
- `tests/smoke/photo-damage-canon.test.js` — new, 115 assertions. Calls the real
  `normalize`/`label`/`same`/`options` (103), and drives the AI contract through
  the real `sanitizeSuggestion` from `functions/photo-vision.js` rather than a
  copy of its enum. 6 cover the backfill's safety properties, and 6 lock the
  **page load order** — every consumer resolves the global per call with a
  literal fallback, so a bad order only degrades labels, *except*
  `pages/photo-review.js`, which builds `FIELD_OPTIONS.damageType` at module
  scope. Break-tested by swapping the two tags in `photo-review.html`.

**Break-tested.** Reverting `dmgOf` to its pre-fix form reddens exactly the six
separator/wording fixtures and the one grouping assertion — and **two fixtures
stay green**, which is the finding: they are case-only, so they never exercised
the fold. They are kept, and commented, as guards that case folding does not
regress. One grouping fixture had to be rewritten after the break-test: its
four photos included two sharing a spelling, which let tier 2 fire pre-fix on
that key, and it went green with the fix reverted.

`tests/smoke/crm.test.js`'s `applyBulkPhotoUpdate uses writeBatch` needed its
character-distance bound widened 500 → 900 — the normalize-on-write guard
landed between the signature and the batch. Same adjustment the sibling delete
assertion already carries; the claim under test is unchanged.

## 7. Backfill

`scripts/backfill-photos-damageType.js` — dry-run by default, `--apply --yes`,
run-once migration guard, idempotent, never clears or invents a value. Mirrors
`backfill-photos-createdAt.js`.

It **loads the fold from `docs/pro/js/photo-damage-types.js` via `vm`** rather
than re-declaring the alias table. A second copy of that mapping is precisely
the drift that caused this bug.

**It is optional.** Read-side normalisation means the app already behaves
correctly. Run it so the stored data matches what the app computes — which is
what a raw Firestore export, a future aggregate, or a
`where('damageType','==',…)` filter would need. Dry-run prints a fold map
(`stored spelling → canonical id`, with counts) so the real shape of production
data is visible before anything is written. **Not yet run against prod.**

## 8. A process hazard worth knowing

The first application of these edits rewrote `customer-tasks-ui.js` **entirely**
— 2429 insertions, 2402 deletions for a six-site change. The edit script built
its inserted block by joining lines with `\r\n`, and then the generic
"`\n` → `\r\n` if the file is CRLF" pass ran over it too, producing `\r\r\n`.
The 21 resulting **lone CR** bytes make git classify the working file as binary
(`git ls-files --eol` flips `w/crlf` → `w/-text`), which disables EOL
normalisation, so every line reads as changed. `git diff` looked catastrophic
while the content was almost right.

This is a different failure from the `sed -i` one already in CLAUDE.md (that one
makes files LF-only and *byte-identical*, showing as phantom ` M` with an empty
diff). Diagnosis: count bytes where `0x0D` is not followed by `0x0A`. The edit
scripts now assert `lone CR === 0` before exiting.

## 9. Deliberately not changed

- **The tier-2 pair label stays lowercase** (`'Damage: ' + k.replace(/_/g,' ')`
  → "Damage: granular loss"). `normKey` always lowercased, so this is not a
  regression, and changing it would force an edit to an existing assertion for
  cosmetic reasons.
- **`lead.damageType` is a different field** and was left alone. It shares the
  name but carries free text (`'Roof - Hail'`, `'Full Exterior'`,
  `'Siding - Hail'`) written by `crm-leads.js`, `customer-edit-modal.js`,
  `data-import.js`, `tools.js`, `d2d-tracker-core-2026b.js` and the demo/seed
  fixtures, and read by ~25 more files including `crm-pipeline.js`'s
  `_damageToChip` and `maps-customers.js`'s peril bucketer. Normalising it is a
  separate job with a separate blast radius.
- **`functions/portal.js`** explicitly redacts `damageType` from the homeowner
  view — it is not a reader, and that redaction was left intact.
- **`inspection-report-engine.js`** writes `damageAssessment.type` on a
  different collection from a free-text input; not this field.

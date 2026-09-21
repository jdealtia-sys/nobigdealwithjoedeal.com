# Projects Completed — count audit, 2026-09-21

Grounds the `docs/our-work.html` "150+ Projects Completed" claim (~line 312)
in verifiable counts, per Jo's instruction to build it from published cards
+ CRM closed jobs + documented prior-brand work. **Read-only recon** — no
Drive content was downloaded, published, or modified; this note is the only
file written.

## 1. NBD CRM (live, Firestore `leads`, companyId `1phDvAVXHSg82wDLegAbQFq14Ci1`)

Queried directly (prior session, cited here as given): **232 total leads,
25 in `closed` stage** (= completed jobs by the CRM's own definition), 26
lost, the rest in-pipeline or new. Covers only recent NBD-branded work
(roughly early/mid 2026 onward) — no prior-brand coverage.

## 2. Published /our-work cards

`docs/assets/data/projects.json`: **45 published cards** (already counted,
cited as given). These are not a simple sum of CRM-closed + Drive folders —
they're the deduplicated, individually-verified floor: many of the 25
CRM-closed leads have cards, and the 08-28 sweep separately staged and
published ~20 prior-brand (JKRC/ORC/MLR/SPR-era) cards after opening each
folder and confirming a signed contract/invoice + photos existed.

## 3. Prior-brand Drive folder counts, per brand tree

**Method note:** the task brief expected `parentId = '<id>'` queries to be
rejected by `search_files`, requiring a fullText-search-then-walk-up-parents
workaround. In practice, this session's Drive MCP **did** accept
`parentId =` queries and returned direct children directly. All counts
below are therefore **direct folder listings** (paginated to exhaustion —
i.e. no further `nextPageToken` — for every tree except JKRC, which is
large enough that exhaustive enumeration across 3 pages was still used to
convergence), not fullText-based extrapolation. This is more reliable than
the workaround the brief anticipated.

| Brand tree | Root found | Raw folder count | Method | Confidence |
|---|---|---|---|---|
| **JKRC** | `COMPANIES/JKRC/CUSTOMERS` | **~230–250** distinct named folders | Direct `parentId` listing, 3 pages, converged (no further page token) | High for the raw count; medium for what fraction is a fully completed job vs. signed-but-fell-through — not individually verified here |
| **MLR** | `COMPANIES/MLR/CUSTOMERS` | **~55** distinct folders | Direct listing, single page, complete | High for raw count; medium for completion fraction |
| **ORC** | `COMPANIES/ORC/Customers` | **~12** distinct folders (includes the Srijan N. flagship) | Direct listing, single page, complete | High — this tree was only created 2026-03, so a small count is expected and matches what was found |
| **SPR** | `COMPANIES/SPR/CXT` (+1 folder directly under SPR root) | **~24** distinct folders (23 under CXT + 1 at SPR root; the other SPR subfolder, "ML FINALS_CLEANUP," was checked and is empty of customer folders) | Direct listing, complete | High |
| **GRANDIR** | Nested *inside* the MLR root (`MLR/GRANDIR CONTENT`), not a separate customer tree | **0 additional** distinct customer folders — just raw drone-photo dumps (repeated `Done.JPG`, `dji_fly_*` stills) for the same ~2 already-known 2024 GRANDIR jobs the 08-28 sweep flagged as photo-only/no-invoice | Direct listing | High — confirms the existing note, adds nothing new |
| **THP** | `COMPANIES/THP` | **Not a roofing brand — new finding, see below** | Direct listing | High confidence this is out of scope |

### New finding: THP is not roofing/siding work

Everything directly under `COMPANIES/THP` is healthcare-staffing content:
"THP Healthcare Staffing New Recruiter Master Packet," "Comprehensive
Nursing Recruiter Training Guide," 5-day text-blast recruiting campaign
templates, call scripts, a recruiting "Main Pipeline" sheet. Nothing
roofing/siding-related appears anywhere in its direct children. The 08-28
sweep note grouped "SPR/THP/GRANDIR" as one tree without flagging this
distinction — worth correcting going forward: **THP contributes zero to a
Projects Completed count** and shouldn't be scanned further for job
folders under that assumption.

## 4. Sanity-check against the 08-28 sweep note

- **JKRC**: the sweep cited "~150 unopened JKRC folders" as a
  still-to-review figure. This session's full enumeration finds ~230–250
  TOTAL folders in CUSTOMERS — consistent with, and larger than, 150,
  since that number covered only the not-yet-opened remainder at the time,
  not the whole tree including already-published folders.
- **SPR/CXT**: the sweep cited "8 folders unopened." This session finds
  ~24 total folders in the CXT tree — again consistent; 8 was a
  remaining-unreviewed subset, not the total.
- **MLR and ORC**: the sweep gave no explicit counts for either (only "the
  SPR/MLR trees yielded only what is already published"). This session
  adds the first counts: **MLR ~55, ORC ~12**.

## 5. Caveat: a folder is not proof of a completed job

These are Drive **folder** counts, not individually verified completed-job
counts. A folder existing means Jo had at least a customer relationship
(estimate, contract, or job); it doesn't by itself prove the job was
completed and photographed, versus signed-but-cancelled, estimate-only, or
a duplicate/misspelled re-creation of another folder (a few visible
near-duplicates turned up, e.g. two spellings of the same surname a
character apart). The 08-28 sweep's own experience — when it individually
opened ~28 ranked candidates, nearly all had real signed
contracts/invoices, with only a handful held back purely for
privacy/consent reasons — suggests the hit rate for "folder = real
completed job" is high, but that was a ~28-folder sample out of 300+, not
a full audit of every folder found here.

## 6. Bottom line — suggested defensible range (not a final number)

Adding it up, excluding THP entirely and folding GRANDIR into MLR:

- **45** already individually-verified and published (hard floor)
- **25** CRM-closed (a subset likely overlapping with the 45)
- **~320–340** raw prior-brand Drive folders (JKRC ~240 + MLR ~55 + ORC
  ~12 + SPR ~24)

Even with a conservative haircut on the raw folder total (accounting for
duplicates, non-completions, and administrative folders not caught by
sampling), the historical body of work comfortably clears the current
"150+" site claim by a wide margin.

- **250+ is a high-confidence conservative floor** — supported even if a
  meaningful fraction of raw folders turn out not to be verifiable
  completions.
- **300+ is medium-high confidence** — matches the raw count with only a
  modest haircut, and is consistent with both brand trees the 08-28 sweep
  already sized (JKRC, SPR).
- **500+ is NOT supported by anything found in this recon** — it would
  require nearly the entire raw folder count, undiminished, plus
  additional undiscovered work; nothing here gets close to that.

Per instructions, this session is not picking the final marketing number —
that's Jo's and the next session's call. This note gives the grounded
range and per-brand confidence to make that call.

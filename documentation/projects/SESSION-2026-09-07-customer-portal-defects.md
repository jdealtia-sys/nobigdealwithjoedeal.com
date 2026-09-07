# Session 2026-09-07 (evening) — the customer page and portal, by defect rather than by restyle

Branch: `feat/customer-portal-overhaul` → PR #1459 · plus hotfix PR #1462 (merged)
Companion note: [SESSION-2026-09-07-booking-multi-event](SESSION-2026-09-07-booking-multi-event.md)

Jo asked for an overhaul of the CRM customer page and the homeowner portal.
A 20-agent recon produced 21 ranked problems and a design panel — and the
panel independently ranked **visual/design-system work LAST on both pages**
(12/30 and 13/30) behind risk-first incremental (21, 24) and
job-to-be-done (20, 20). Three judges, separate lenses, same verdict twice.
So this lane fixed defects in independently-revertible slices instead.

---

## The method that mattered: verify, then attack

Every finding was verified by hand or by an agent *and then adversarially
attacked by a second agent* briefed to hunt for **sibling paths the verifier
missed** — this repo's documented failure mode.

That pass **knocked down 3 of 8** findings in the second batch and materially
corrected several others. It was worth more than the original recon:

| Finding | Verified | After attack |
|---|---|---|
| `_estimates` fork | CONFIRMED | stands — **fix missed the `catch` path** |
| photo-queue `x` button | CONFIRMED | stands — **plus an unguarded sibling deref** |
| dead lead-score panel | CONFIRMED | stands — **but the naive fix creates harm** |
| photo metadata | PARTLY | stands |
| panels don't repaint after save | PARTLY | **"Part A: none. All three repaint today."** |
| portal poll wipes work | PARTLY | **knocked down — real bug is elsewhere** |
| Presentation Mode 1.03:1 | PARTLY | **knocked down — Presentation Mode was the FINE one** |
| portal CTA contrast | PARTLY | **knocked down — half the fix was unsound** |

Two corrections worth carrying forward:

- **The recon's "no panel repaints after save" was wrong.** All three panels
  repaint today. The only live cost is documentation rot — BUG-LOG's NEW-D17
  is stale. Nothing was changed.
- **"Presentation Mode renders Voice Intel at 1.03:1"** was wrong. Presentation
  Mode measures 6.44–8.69:1; it was the one mode that was fine. The damage was
  in the *dark* themes (1.46–1.97:1).

## What shipped

Thirteen slices, each its own commit. Slices 1-10 below; 11-13 follow the
regression note.

1. **Contact panel logged calls it never made.** The panel dials the
   *contractor's* number (brand-resolved), while handlers logged
   "Called <customer> at <lead.phone>" — a fabricated conversation at a number
   that was not dialled, feeding the timeline pill and the follow-up signals.
   The agent's proposed fix ("make them dial the customer") was **wrong** and
   was not taken: that duplicates the header buttons and guts the panel.
2. **The portal published estimates nobody shared.** `estimates[0]`, no filter,
   and estimates are created with no status/`sentAt`/share flag at all. The
   rep's existing Share button now stamps `sharedWithHomeowner`; the portal
   gates on that, the signature lifecycle, or `sentAt`. Not grandfathered, on
   Jo's call.
3. **Refer-a-friend claimed work that had not happened** — gated on
   `customerId` (stamped early), so a homeowner got *"They did a great job for
   me"* the afternoon the rep knocked. Now gated on the same
   `progressKey === 'complete'` the rating card already used.
4. **The action bar could not stick and ate half a phone.** `position:sticky`
   on the *last child* of `.customer-header` is clipped to that box; the
   "always visible" comment was false. 334–388px on a 390px screen. Removed
   the false sticky; collapses behind "More (n)" on phones.
5. **`window._estimates` was never populated here**, so smart-followup told
   the rep the estimate was **"never opened"** — an assertion that is false —
   on the leads whose homeowner *had* opened it, while the kanban said "Hot"
   for the same lead. Proven by running the real engine in a vm: 47/Lukewarm
   → 68/Warm, `later` → `urgent`. Fixed on all three exit paths *including the
   `catch`*, which the refuter caught missing.
6. **The staged-photo `x` always removed the FIRST photo** —
   `data-arg=" + i + "`, concatenation trapped inside the literal, `splice`
   coerced to 0. Plus the sibling guard.
7. **A lead-score panel that could never render** — exported as `renderPanel`,
   called as `renderScorePanel`. **Removed, not renamed**: renaming would put
   two disagreeing 0-100 scores on one screen.
8. **Inspection reports shipped with no photo evidence.**
   `PhotoEngine.getPhotosForLead` is not an export key (it is aliased to
   `getPhotosForReport`), so the guard was always false, both pools were
   always `[]`, and the builder told the rep "No photos found" on leads that
   have photos. **The obvious rename is worse than the bug** — the alias is an
   `AsyncFunction` and both call sites are synchronous, so `slice()` would
   throw on a Promise; it also queries userId-only and would drop teammates'
   photos. Fixed to `window._photoCache[leadId]`.
9. **A stylesheet reading tokens nothing defines.** `voice-intelligence.css`
   read `--text2`/`--text3`/`--border2` — admin-palette names, zero
   definitions on this page — so it painted hardcoded literals in every theme.
   Now `--m`. The `--border2 → --br` half was **refused**: `--br` is a
   translucent hairline that composites to 1.03–1.37:1, *worse* than what it
   replaced. Also repointed the portal's `--accent` at the AA-safe
   `--nbd-orange-cta` (3.07:1 → 4.88:1), fixing every generated CTA at once.
10. **The 30s poll destroyed signatures in progress.** `innerHTML` replace
    tears down the BoldSign iframe, and it is *self-triggering* — opening the
    embed flips `signatureStatus` to `viewed`, which is what the diff detects.
    The rejected fix ("defer while unsent work exists") was unbounded and
    would freeze the view forever; what shipped defers only while a signature
    is in flight, bounded three ways, and never advances `_lastView` so the
    update is not lost.

## A regression I shipped, and how it was caught

#1458 added the booking `<script>` tag to `portal.html` but **not** to
`customer.html`: my edit helper's substitution closure read the outer source
string, so a second substitution recomputed from the original and discarded
the first. The markup landed; the script did not.

Live consequence: `window.NBDBooking` undefined → `bookingOptions` `[]` → the
SMS booking link, copy-booking-link and the picker **did not render at all**.
Verified against production, hotfixed as #1462, deploy verified.

Nothing errored. So slice 4's suite carries a **dependency check for the
class**: any `/pro` page loading a consumer of a shared global must load the
module defining it. Deleting the tag reddens it.

**Lesson for the next session:** a substitution helper must mutate one binding
sequentially. The form that bit is a `sub()` closure reading an outer `src`
while the caller does `src = sub(...)`.

## Testing

Twelve new suites, ~237 assertions, all in the `node` bucket (manifest 92).
Every guard was **broken to check WHICH assertion reddens** — 16 break-tests,
each hitting only the expected assertions.

Preferred shape throughout: **run the real code in a vm** rather than regex
over source. The `_estimates` suite runs smart-followup and asserts the
headline/priority/action flip; the PhotoEngine suite reads the real export
surface and proves the alias is `AsyncFunction`; the quick-actions suite
drives the module against a DOM stub including owner-hidden controls.

**Suites caught themselves being wrong five times** — four assertions matched
the *explanatory comments* of the very code they guarded, and two windows were
tens of characters too short. Each fix carries the reason inline. If you write
an assertion about code you just commented, strip comments first.

One gate was deliberately **not** loosened: `smoke/crm.test.js:332` requires
`updateUploadPreviewItem(index)` within 400 chars of the upload handler. A
three-line guard pushed it to 456. The guard was compressed to one line and
the rationale moved above the handler, rather than widening the window.

## Batch 3 (slices 11–13)

11. **Every uploaded photo claimed to be already sorted.** The upload path
    stamped `phase: 'During'` when nothing could set it (both selectors had
    zero callers; the four DOM ids they drive were never written in *any*
    commit). That is not cosmetic: `pages/photo-review.js` reads
    `isReviewed = !!photo.phase` (:150), filters unsorted on `!phaseOf(p)`
    (:229), and only falls back to `aiSuggestion.phase` when phase is falsy
    (:132) — so **Review & Sort was blind to everything uploaded from the
    customer page**, and the classifier's suggestion never surfaced. Now
    writes `null`. Also fixed the sibling that would have re-poisoned it
    within a day: `quickSaveMeta` re-stamped a phase on *any* metadata edit,
    because `photoDocToView` coerces so `photo.phase` is never falsy.
    **NOT done:** the verifier's third edit (aligning `renderPhotoGrid`'s
    filter) — proven unreachable, since that array is only ever built through
    `photoDocToView` and `dashboard.html` does not load `customer-tasks-ui.js`.
12. **The jump-nav highlight bounced.** Link order was
    `overview, photos, documents, voice, messages, timeline, contact` while
    the DOM is `overview, timeline, photos, documents, messages, voice,
    contact`, so the scroll-spy lit pills 1, 6, 2, 3, 5, 4, 7 as the rep
    scrolled one way. Also moved the **"Open tasks" badge off the Timeline
    pill** — that section renders stage milestones; the task list
    (`#timelineList`) is inside Overview.
13. **25 controls were mouse-only** — all 15 doc-template cards, all 8
    timeline pills, both drop zones. Fixed at the dispatcher (one keydown
    listener beside the click delegate) rather than sprinkled, so future
    `data-action` elements are keyboard-operable by construction. Native
    controls are skipped **deliberately**: a `<button>` already turns Enter
    into a click, so handling it twice would generate two documents.

## A false-green risk in the new suites themselves

Five suites written earlier in the session stripped comments with
`/\/\*[\s\S]*?\*\//g`. **That cannot be used on these files** — they contain
comment-looking sequences inside regex literals and strings, so the pass
destroyed **10–48% of the file**. Caught only when an assertion failed
against code that plainly existed.

Positive assertions self-protect (they fail when the region vanishes), but
**absence** assertions could have passed against a corpus missing the very
region they guard. All five now strip line-wise; all still pass, so none were
vacuous — and the one absence assertion never break-tested was confirmed to
redden. If you write an assertion about code you just commented, strip
comments first *and* check the stripper is not eating the code.

Related: `git checkout --` during a break-test discarded uncommitted work in
the same file. Commit first, every time.

## Left open

- **Duplicated datasets** — photos, documents and the timeline each render two
  or three times, and the duplicate is usually the copy WITH the tools. This is
  the one remaining recon finding that is a genuine refactor rather than a
  defect fix, and it deserves its own session and its own recon.
- **Remaining a11y on the customer page**: no <main>/<nav>/<h1> landmarks, 11
  <label> elements with no for=, 6 of 7 modals without dialog semantics or a
  focus trap. Slice 13 fixed operability; these are structure and naming.
- Mobile stacking order (the Overview right column stacks below the entire left
  column at <=900px) — untouched.
- The tenant-safe CTA token (derive by darkening until AA, don't copy the
  accent) — its own change.
- BUG-LOG's NEW-D17 should be retired: the behaviour it describes no longer
  reproduces.

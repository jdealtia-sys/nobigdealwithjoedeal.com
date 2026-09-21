# Session handoff — 2026-09-21

## Status: 8 PRs merged and live. One open, blocked on a review that was still running.

Started as "kick off a power session, I'm thinking CRM." Ended up mostly on the
public site, because Jo disclosed mid-session that the site's most-repeated
factual claim was false.

---

## 0. THE THING THAT MATTERS MOST — read this first

**Jo subcontracts. The site said, on 124 pages, that he does not.**

His words, 2026-09-20:

> "I most definitely subcontract. The whole company is truthfully me — I run the
> whole company. I don't have any salespeople. I've got crews: a roofing crew,
> both residential and commercial; a gutter crew; a siding crew; an interior and
> drywall crew. They are NOT all employees on W-2 payroll. They are fellow
> subcontractors that I can get a good rate with and have done work with in the
> past."

Fixed in #1688. Full audit: [SUBCONTRACTING-CLAIMS-2026-09-20](../audit/SUBCONTRACTING-CLAIMS-2026-09-20.md).

**Three answers he gave that are now load-bearing — do NOT relitigate:**

| Question | Answer | Consequence |
|---|---|---|
| On every job / every roof? | **"Absolutely every time"** | `inspect.html`'s "Joe gets on every roof himself" and the homepage's "Joe shows up himself — every time" are TRUE. Kept, and they are the anchor claim that replaced the lie. |
| Crews' insurance — his or theirs? | **"Their own"** | The two area pages now say so explicitly. Corroborated by `partners.html:626`, which already demanded "current GL and workers' comp certificates, no exceptions" of crews. |
| Same crew start to finish? | **"Same crew per trade, every time"** | A multi-trade job involves different people. Homepage compare row became "the same crews, job after job". |

**The badge wording is Jo's pick**, from three options: **"You deal with me,
start to finish"**. He chose it over "No salespeople — you get the owner" and
"I'm on every roof myself".

### Do not "fix" partners.html

`partners.html`'s **Crews & Subcontractors** track is the one page that was
always honest. Seven reviewers flagged it as "the contradiction"; **every flag
was rejected on verification**, because it is the correct half. The foreseeable
accident on any future cleanup pass is deleting the only honest public statement
while denials creep back. `tests/subcontracting-honesty.test.js` guards it by
name — if that assertion reddens, someone is about to do exactly that.

### Separately, and more serious: the job posting

`careers.html` advertised a part-time helper on **W2 terms** — "taxes withheld
properly, workers' comp coverage from your first hour" — in body copy AND in
`JobPosting` structured data Google Jobs surfaces, including *"A lot of roofing
labor in this area gets paid as 1099 or cash... I'm not doing that."*

That is not marketing overstatement. It promised a **person** their tax
treatment and injury coverage. Jo confirmed the terms were not accurate.

**Taken down in #1687, not reworded** — replacement employment terms are Jo's
decision, not a copy edit. Page is PARKED: still resolves (219 pages link to
`/careers` from the footer partial), `robots noindex`, pulled from the sitemap,
says "Nothing Open Right Now", routes crews to `/partners`.
`tests/careers-posting-parked.test.js` reddening does **not** mean breakage — it
means someone restored a posting, which is allowed, as long as the terms are
true and a human confirmed them.

---

## 1. Merged this session (all live)

| PR | What |
|---|---|
| #1682 | a real `/favicon.ico` instead of SVG-mislabeled-as-ico |
| #1676 | `_leadsLoaded` reset on a same-tab account switch — **collapsed the two in-memory account binders into one**, per #1679's own instruction |
| #1686 | say "Xactimate" where a human can read it |
| #1684 | homepage reviews summary hydrates from the live payload + **made the visual gate deterministic** |
| #1685 | homepage photo wall clickable, tagged, and given a door to `/our-work` |
| #1687 | roofing-helper job posting taken down |
| #1690 | Close Board per-account cache + **stopped the auth poll wiping a half-typed New Deal form** |
| #1688 | stop denying subcontracting (126 pages) |
| #1689 | Google sign-in popup survives COOP + **the test rig now actually tests it** |

---

## 2. CLOSED LATE — offline SMS outbox shipped as #1692

**This section said "STILL OPEN" when it was first written.** The review landed
before the session actually ended, its blocker was fixed, and the lane merged.
Corrected in place rather than left to mislead — see the UPDATE at the end of
this section for what changed. The history below is kept because the *reasoning*
still matters to anyone touching this code.

The branch `feat/sms-offline-outbox-v2` (worktree `C:/Users/jonat/nbd-wt-sms`)
now contains, as ONE commit:

1. **The round-3 work**, which existed only as *uncommitted changes in a
   workflow worktree* (`wf_97b52162-fb3-4`) and which **no review had ever
   covered** — 1259 insertions across 10 files. Jo explicitly chose to adopt it
   rather than discard it. A patch copy is at
   `%TEMP%/claude/.../scratchpad/round3-sms-outbox.patch` if it is ever needed.
2. **Required fix 2**, which round-3 did NOT contain.

**Round-3 closes the clock-skew hole differently from what round 2 proposed.**
Round 2 said: keep `FUTURE_SKEW_MS` at 5 minutes, clamp downstream with
`effQueuedAt = min(queuedAt, now)`. Round-3 instead sets
`FUTURE_SKEW_MS = ACTIVITY_SKEW_MS` (60s), rejecting a skewed timestamp at the
boundary. Both close it; round-3's is the smaller surface. **Whoever picks this
up must not layer the round-2 clamp on top — they conflict.**

**Required fix 2 (added, proven):** `sendInvoice` awaited the lock-acquire
Firestore write before ever calling `NBDComms.sendSMS`. This app runs Firestore
with **no local persistence**, so offline that write does not reject — it never
settles. The offline queue was unreachable in exactly the state it exists for.
Now raced against a 4s timer, overridable via `window.__nbdInvoiceLockTimeoutMs`
(the `photo-queue-recovery.js` idiom). The existing test stubbed `updateDoc` as
immediately-resolving, **which is why the bug shipped green**; the new case makes
it never settle, and reverting the `Promise.race` turns it red with `"HUNG"`.

Suites green: **client 197, server 208.**

A 4-lens adversarial review of the adopted delta ran as run `wf_047d7d37-b5a`
(journal at `.claude/projects/.../subagents/workflows/wf_047d7d37-b5a/journal.jsonl`),
covering clock-skew/TCPA, double-send, money/invoice, and deploy sequencing.

### UPDATE — merged as #1692, 2026-09-21

**Verdict: "MERGE AFTER FIXES — one required. Adopting the round-3 delta was
sound. Nothing in the delta should be backed out."** 5 findings, 3 survived
3-refuter verification: 1 blocker, 2 nits.

**The blocker was money-visible.** `_releaseSendLock` prefers
`window.runTransaction`, and both CRM pages define it — but a Firestore
transaction **cannot run offline**, and the queued path only ever executes
*because* we are offline. So `sendingPriorStatus` was wired correctly at every
write path and the one restore that mattered was routed through the one
primitive guaranteed not to work there. A **paid** invoice whose queued text was
later discarded sat at `status:'sending'` with nothing to clear it (`discard()`
and `lead_gone` emit no receipt); `money-dashboard.js:149` skips only
`status === 'paid'` and then promotes a zero `balanceDue` to full total, so it
re-entered Outstanding A/R and the Collections queue and re-offered "Mark Paid".
Fixed with a `preferLocal` flag taking the non-transactional arm.

**Not a regression, and the review was careful to say so:** at `HEAD~1` the
acquire was an unbounded `await` with no `sendingPriorStatus` at all, and the
same phantom A/R hit **100%** of offline paid-invoice texts. The delta narrowed
it; this closed the residue. The catch-path release was bounded in the same pass
for the same reason.

**The rebase also caught a cross-branch break nobody could have seen:** the
client suite crashed with `ReferenceError: _findDeal is not defined`, because
#1690's Close Board per-account cache refactored `sendViaSMS` to go through
`_findDeal` / `_dealRoomsForCurrentUser`. Two branches developed in parallel
cannot see that until one rebases. The lift now supplies it as a named
collaborator.

**Logged, deliberately NOT fixed** (both survived verification as nits):
`sms-functions.js:414` skips the unrouted-inbound scan when there is no
`leadId` — a documented privacy boundary, rep-overridable, and the reply lands
in `unmatched_sms` either way; and `sms-outbox-guard.js:358`'s `ownEarlierQueued`
is scoped by `uid` alone, so a same-uid second device's copy is exempted rather
than held. The latter is **byte-identical in `0c26734a`**, which round 2's
refuters already passed — pre-existing, one duplicate text, no opt-out bypass,
and unfixable without minting a per-outbox id. Backlog.

**STILL TRUE AND STILL THE THING TO WATCH:** the `{toDigits, date}` composite
index must finish BUILDING before the functions serve traffic. If functions land
first every queued text parks in the tray until it completes. It **fails closed**
(`FAILED_PRECONDITION` → 503 → client retries), so nothing is lost — but a first
test in that window will look broken when it is not.

---

## 3. For Jo — things only he can do

- **Google sign-in still will not work until he enables the provider.** #1689
  removed the *second* blocker (COOP severing the popup). The first is a console
  step: Firebase → Authentication → Sign-in method → Add provider → Google →
  Enable → support email → Save. Then GCP → APIs & Services → OAuth consent
  screen: External, **In production** (not Testing). Proof afterwards:
  admin/v2 `defaultSupportedIdpConfigs/google.com` shows `enabled:true` (NOT the
  public `getProjectConfig`, which omits providers).
  - Linking note: with one-account-per-email, an existing **unverified** password
    account loses its password credential on first Google sign-in (same uid, same
    data). At least one gmail customer is currently unverified.
- **`careers.html`**: decide whether the helper role is W2, 1099, or not open.
  Page is parked until then.
- **The "Meet Joe" video is the best remaining marketing win and is one attribute
  away.** `docs/index.html:1334` is a complete, styled, finished section — "60
  Seconds With Joe / Meet the Guy Who Answers the Phone" — shipping `hidden` with
  `data-yt=""`. The reveal script is already loaded and already works. The entire
  code change is putting a YouTube ID in that attribute. Needs a 60-second phone
  video and a YouTube channel (there is none; footer social is Facebook +
  Instagram only). Add the channel to the `sameAs` block at `index.html:482`.
- **The estimate PDF says "same crew"** above the signature block
  (`estimate-v2-ui.js:3010`, 32pt hero; `functions/print/templates/estimate.hbs:68`).
  True for a single-trade estimate given "same crew per trade"; **not** true for
  a multi-trade job. Jo said **"leave it, that's fine"** on 2026-09-21 — recorded
  so it is not re-raised.
- **Commercial roofing and interior/drywall crews may not be advertised anywhere
  on the site.** Jo named both. Not audited. If true, that is work he can do and
  is not asking for.

---

## 4. Smaller, still open

- **Dark win #15**: `services/fire-water-smoke-damage.html` is the only 1 of 139
  service pages with **no FAQ** — no accordion AND no `FAQPage` schema. The page
  already ships the FAQ CSS and already loads `nav-faq.js`. **Markup + JSON-LD
  only.** Blocked on Jo for five truthful Q&As about that service.
- **The crew-word sweep beyond subcontracting.** ~15 surfaces use "crew"
  language that is now consistent, but `careers.html` is the only W2/employee
  language left on the site; once it is unparked it becomes the lone data point
  a reader could generalise from.
- `docs/sites/oaks/**` has three "our crew" lines. Treated as a **different
  company's** microsite (noindex + Disallow'd) and excluded. If it is actually
  NBD-operated, those need a pass.

---

## 5. Lessons worth keeping (all cost real time today)

- **`git checkout --` reverts the WHOLE file.** Undoing a break-test on
  `invoice-pipeline.js` wiped both the round-3 changes *and* the new fix, because
  round-3 was applied as **uncommitted** changes. Commit before break-testing.
  This is already in the vault and was walked into anyway.
- **A cache-bust query string is a different URL.** Verifying the photo-wall
  deploy, `fetch('/assets/js/x.js?cb=1')` proved the origin was correct while
  leaving the real cached entry untouched — the page kept executing stale JS and
  it briefly looked like a failed deploy. Revalidate the *exact* path.
- **The visual gate was never deterministic.** `tests/e2e/visual-regression.spec.js`
  injected `animation: none`, but the homepage announcement bar rotates every 4s
  via a bare `setInterval`, and **CSS cannot stop a setInterval**. Two captures of
  the same commit differed by whichever slide was showing. Caught because a
  re-bless script refused to bless a snapshot that was byte-stable in only 3 of 4
  attempts. Fixed in #1684 by clearing page timers before the capture and parking
  the rotator on slide 0 — timers cleared rather than `.ann-bar` masked, so the
  bar stays inside the comparison.
- **"Visual regression (public pro pages)" also captures `/`.** Its `PAGES` array
  includes `{ path: '/', name: 'landing' }`. Any homepage copy change reddens a
  check whose name says it only covers `/pro`. Re-blessing is one PR at a time,
  in merge order, since each bless is against one specific homepage.
- **`FLOORS` collided FIVE times in one session** (collisions 11–15). Every one
  was the same shape: two branches cut from the same base, both correctly reading
  the same literal, and the only correct value being the one measured *after* the
  other merged. That file's own ledger already says "a matching number is not
  evidence." It is right.
- **Adding a spec to a shard can redden an unrelated spec.** The `@stranger`
  shard runs `--workers=1` against ONE shared emulator, and `stranger.spec.js`
  counts users and companies to assert tenant isolation. The new Google spec
  signed up users and provisioned `companies/{uid}` and left them behind,
  reddening `stranger.spec.js:346` on a shard green on main. Any new spec added
  to a shared-emulator shard needs teardown.
- **`check-js-syntax` deliberately excludes `scripts/**`.** A stray conflict
  marker left in `run-test-manifest.js` sailed past it; the manifest check itself
  crashed on it, which is the real backstop.
- **Backslashes and backticks do not survive the Bash tool.** A patch applied
  through `bash -c` turned `[\s\S]` into `[sS]`; an INDEX.md entry written the
  same way had four backticked filenames eaten by command substitution. Write the
  file with the Write tool, or edit with the Edit tool.

---

## 6. Corrections to earlier notes

- **"The Google reviews are blank on every marketing page"** (INDEX.md's 09-05
  prior-handoff summary) has been FALSE since 2026-09-13 (#1545). Re-verified
  live on 09-20: `/api/google-reviews` returns rating 5.0 / 29 reviews, and all
  17 widget pages render, desktop and mobile. The INDEX line is annotated in
  place. **The live gap is different**: the Places API hard-caps at 5 of the 29,
  and `syncGbpReviews` exists to pull them all but is dormant pending Google
  Business Profile API approval.
- **Do NOT add `aggregateRating` to the homepage.** Google's review-snippet docs
  are explicit that when the reviewed entity controls the reviews about itself,
  `LocalBusiness`/`Organization` pages are ineligible for the star feature —
  *including* "an embedded third-party widget (for example, Google Business
  reviews)". The homepage having none is **correct and deliberate**; the repo
  already documents that decision in four places. Verified against Google's live
  docs 2026-09-20, not from memory.

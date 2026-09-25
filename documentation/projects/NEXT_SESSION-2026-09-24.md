# NEXT SESSION — 2026-09-24

Mostly an **ops session, not a code session**. Jo built out a Grok Bot agent
team in the Grok Bot desktop app. Three small code PRs came out of what the
team hit along the way. Read §0 before trusting any lead export for storm
work.

## §0 — NBD Pro leads carry NO date of loss

Verified live in the dashboard on 2026-09-24:

- Date of loss is filled on **0 of 216** active leads. The key exists on 49
  of them, but every value is empty.
- Storm jobs are logged mostly as `damageType: "Storm Damage"` (56 leads).
  Only 2 are hail-specific.
- `lat`/`lng` are present on 109 of the 216.
- Estimates carry no date of loss either (`claim.dateOfLoss`: 0 of 12).

What that blocks:

- **Date-matched backtest:** Theo's "storm-response lead alerts" backtest
  (NOAA hail swaths vs NBD's actual storm jobs) cannot match on date.
- **Jo's decision:** run a **location-only** backtest now (swaths vs storm
  leads with coordinates), and start entering date of loss on new storm
  jobs so a date-matched test is possible by spring.

Do not tell anyone the export "has the dates". It has the *column*.

## §1 — What merged

| PR | What | Proof |
|---|---|---|
| #1730 | Both lead exports (Export panel CSV + Sheets copy, and the Settings > Data Retention CSV) now carry `Date of Loss`, `Latitude`, `Longitude`. A 0 coordinate is kept, and a negative longitude stays a bare number. `data-export.js?v=3`, `dashboard-bootstrap.module.js?v=16`. | Deploy green. The live `data-export.js?v=3` has all 3 labels and the live bootstrap has `dateOfLoss: l.dateOfLoss`. Break-tested: reverting fails 7 + 2 assertions. |
| #1731 | `/pro/pricing` meta description + og:description no longer say Starter gets the 14-day trial. `functions/stripe.js:354` grants `trial_period_days:14` to **team + growth only**, and the FAQ and Terms already said so. Pinned in `tests/pro-claims-honesty-2026-09-13.test.js`. | Deploy green. `curl` of the live page shows the new description. |
| #1732 | "Leads/Estimates → Google Sheets" copied **nothing** on desktop. See §2. | See the PR, and read `tests/data-export.test.js` (86/0). |

## §2 — The Sheets-copy bug (#1732)

- **Old order:** `openInSheets` did `window.open` first (for the iOS
  same-task popup rule), then an async `navigator.clipboard.writeText`.
- **Why that failed:** on desktop the new tab takes focus, so `writeText`
  rejects ("Document is not focused"). The `execCommand` fallback then ran in
  a promise callback with no focus and no user activation. `_execCopy` also
  returned a hard-coded `true`.
- **What the user saw:** the rep pasted whatever was already on their
  clipboard. It happened live while exporting for the backtest.
- **Fix:** a synchronous `_execCopy(tsv)` runs *before* `window.open` (it
  awaits nothing, so the iOS rule still holds). The async API is now only a
  fallback, and `_execCopy` returns the real result.
- **Tests:** the test sandbox models `execCommand` as ok, refusing, or
  missing. Five assertions fail against the old file.

## §3 — The Grok Bot team (outside the repo, but it drives repo work)

**Roster:** eight bots in the Grok Bot desktop app. Each is named with a
human name plus a title, and each has a Description brief with the same
GREEN/YELLOW/RED autonomy tiers:

- **Chief of Staff:** runs the approval queue and the morning digest. The
  digest is a routine on weekdays at 7:11 AM ET, approved by Jo.
- **Marcus · NBD Ops**
- **Priya · NBD Pro**
- **Nova · Eromify Studio:** Jo's AI-persona business, walled off from the
  NBD brands.
- **Dana · Marketing:** NBD + Pro only.
- **Frank · Finance**
- **Quinn · Fact-Checker:** every factual report routes through Quinn.
- **Theo · Venture Scout**

**Trust posture.** It is the same as
[GROKBOT-BRIEF-VERIFICATION-2026-09-13](../audit/GROKBOT-BRIEF-VERIFICATION-2026-09-13.md):
bot claims are leads, not facts. Two examples from today:

- Marcus told Theo the lead export carried coordinates; it did not until
  #1730.
- Claude told Jo there was "no NBD Lexington listing"; wrong, because the
  Lexington-area pages shipped 2026-08-25 (`8644dd14`).

**Repo-relevant outputs waiting on the next session:**

- **Town pages (Jo approved: Dana drafts, Claude reviews and builds).**
  Verified against `projects.json`:
  - 12 towns have finished projects but no `docs/areas/` page: Montgomery,
    Franklin, Sycamore Township, Madeira, Norwood, Sharonville, Bethel,
    Newtown, New Richmond (OH); Newport, Union (KY); West Liberty (KY).
  - **Miamisburg OH** was missed by the bot and has 2 projects.
  - Skip West Liberty: it is out of area, and its 2 projects are one
    apartment complex.
  - Area pages are hand-authored. To build one: clone an existing page with
    truly local copy, add the town to `COORDS` in
    `scripts/add-location-interlinks.js`, keep the cert bar
    (`marketing-polish-contract` checks it), hand-edit `areas/index.html`
    counts and `areaServed`, run `apply-partials.js`, then regenerate the
    sitemap. `build-sitemap.js` globs `docs/areas/`, so there is no
    `CORE_PAGES` row, but the sitemap must be recommitted.
  - Commit `8644dd14` is the worked example.
- **Priya's fact-checked NBD Pro roadmap:**
  - Jo parked #1 (tenant attribution) until a second contractor signs up.
  - #2 (SMS A2P registration) is the next thing to scope.
- **Dana's SEO audit:** besides the town pages, it found meta descriptions
  over 160 chars (gutter-cleaning 202, shed roof 198, wood-siding 170–190,
  /book 164), `/our-work` titles over 60 chars once the suffix is counted,
  no pricing markup on `/pro/pricing`, and Yelp still linked in the
  homepage's hidden business info.

## §4 — Open items for Jo (not code)

- **Stripe key:** a restricted read-only key for Frank, Priya and Quinn. Jo
  is holding it for now.
- **Gmail + Calendar:** a read-only connect to Grok Bot. Jo will sign in
  himself.
- **Goon Trap plan:** paste the Claude.ai project "operation goon trap" into
  Nova's chat. Mia (Eromify character `miasable`) is priority #1.
- **Eromify account state:** all four Eromify characters are untrained, and
  0 trainings are left. Three use shared template faces.
- **Jojo:** SFW only, unless she is restyled to read clearly adult. Jo
  pushed back; the line was held.
- **Business phone:** a Straight Talk cell with Cloaked call screening. No
  connector exists, so phone-only leads are invisible unless logged in NBD
  Pro.

## §5 — Process notes

- **Line endings:** `sed -i` on `docs/pro/dashboard.html` flipped it to
  `w/lf` (the CLAUDE.md warning). It was caught before commit by
  `git ls-files --eol` and restored with `git checkout --`. Use the Edit
  tool.
- **Merging:** auto-merge is disabled on this repo (`enablePullRequestAutoMerge`
  fails). Poll checks, then `gh pr merge --match-head-commit <sha>`.

## §6 — Later the same day: SEO, town pages, and a CRM phone lane (all merged and live)

| PR | What |
|---|---|
| #1734 | 8 meta descriptions trimmed under 160 characters; 3 service titles shortened; the `/our-work` generator suffix changed to `\| NBD` (52 of 53 titles had overflowed). |
| #1735 | 12 new `docs/areas/` town pages built on real `/our-work` jobs: Montgomery, Sycamore Twp, Madeira, Norwood, Sharonville, Newtown, Franklin, Miamisburg, Bethel, New Richmond, Newport KY, Union KY. The index shows 43 cities. |
| #1736 | The dark seat add-on stepper is hidden until `window.NBD_SEAT_ADDON_ENABLED === true`. Set it only after the Stripe price, the `STRIPE_PRICE_SEAT` secret and a functions deploy. |
| #1737 | Needs Attention now also flags `unpaid-final` (final_payment is no longer terminal), `proxy-phone` (Thumbtack 669 numbers) and `missing-date-of-loss` (storm jobs past 'new'). |
| #1738 | Phone usability pass (see below), plus **`tests/e2e/phone-fit.spec.js`**. |
| #1739 | Settings → Default Pipeline View: Auto / Board / List (per device). |
| #1740 | **Phone field cards**: the list renders as cards on phones, with Call/Text/Map/Open buttons; swipe right to call, swipe left for the next stage. |
| #1741 | Pipeline ••• Tools → **Find duplicates**. Review only; trash goes through the existing deleteLead flow. |

**Jo's standing rule (2026-09-24): everything must fit and work at phone
scale.** He works from an Android at about 412px.
- `phone-fit.spec.js` (`@audit @phonefit`, in `test:e2e:authed:emu`) walks
  22 views at 412px and 360px. It fails on sideways scroll, an element past
  the edge outside an intentional scroller, or a view that never mounts.
  Its first run caught the Ask Joe header at 360px.
- Every CRM UI change also gets a *visual* 412px screenshot check.
- Local runs on Windows: export the `PLAYWRIGHT_*` env vars **outside**
  `emulators:exec`.

**Phone behaviour now:**
- Phones open **List** (`crm-list-view.js`: no saved choice and ≤768px).
- A saved Board or List choice wins, and it survives logout (`KEEP`).
- The floating `#addLeadFab` is hidden on phones.
- Any test of *board* geometry at phone width must pin
  `nbd-crm-view-mode=board` with addInitScript (see pro-authed.spec.js).

**Known flake:** `@stranger`'s provision test timed out once on #1740 with
emulator "Failed to authenticate" noise. A re-run of the failed job
passed. Main had passed the same shard just before.

**Thursday (Grok team receptionist) is live on Bland,** outside the repo:
- Number: **(513) 940-5589**.
- Agent: "Thursday - NBD Reception", voice Allie, prod v0.0.2, 5-minute
  cap, no transfer.
- Jo's cell forwards busy, unanswered and unreachable calls to it; Cloaked
  Call Guard is paused.
- Starter credit was about $1.72; Jo needs to add a card.
- Details are in the memory note `grokbot-team-roster`.

**Next candidates:**
- the lead detail page (`/pro/customer`) at phone scale;
- estimates on a phone;
- duplicate *merge* (v1 is review-only).

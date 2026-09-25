# NBD Pro phone-scale audit + fix campaign (2026-09-25)

Jo asked for a thorough run through the CRM at phone scale. His standing rule, from 2026-09-24: NBD Pro must fit and work flawlessly on his Android, at about 412px.

**Result:** 72 findings. Every finding was independently reproduced, then fixed in 9 parallel lanes, each PR independently reviewed. **9 PRs merged**, plus two riders (#1743 Date of Loss, #1751 privacy) and a spec-registration PR (#1744). CI on the combined main (`df9a575d`) was green.

## Method

1. **Audit** (workflow `crm-phone-audit`):
   - 5 surface auditors: the customer page, estimate build+view, pipeline+lead capture, the remaining dashboard views+chrome, and homeowner-facing pages.
   - They drove real Playwright sessions at 412 and 360 against the local emulator rig.
   - They used real taps and `elementFromPoint` hit-tests, and looked at their own screenshots.
   - A skeptic independently reproduced **every** finding with its own script. 72 of 72 were confirmed, with several owners corrected. The two most surprising findings were spot-checked by hand as well.
2. **Fix** (workflow `crm-phone-fix-lanes`):
   - Findings were grouped into 9 lanes by owning surface.
   - Each lane got its own worktree and a static server that mirrors cleanUrls on its own port, against the shared emulators.
   - Every lane had to fix at the root and check 412, 360 **and 1280**.
   - Every lane had to add a `tests/e2e/phone-<lane>.spec.js`. The names were pre-registered in #1744, so no lane touched `tests/package.json`.
   - Every lane had to break-test: revert each fix and confirm the intended assertion goes red.
3. **Review:**
   - An independent reviewer per PR: re-verified on the branch, hunted desktop regressions at 1280, and checked collateral consumers.
   - A fix-up pass ran where the review blocked (signing, estdata).

## PRs

| PR | Lane | Highlights |
|---|---|---|
| #1748 | portal | Estimate-page Back works from the portal. Homeowner-friendly error states with retry. Before/After sliders no longer trap vertical scroll. Embeds capped. Inputs at 16px (no iOS zoom). The Live pill no longer blocks taps. |
| #1747 | dashnav | The '+' sheet: Task gets a customer picker, Knock opens the knock form, Quick Note opens Quick Capture. The greeting no longer says "Jonathan" to everyone. The Draw map is no longer 0px tall. Reports / Talk Tank / Referrals are in the phone More drawer. Schedule leads with Today. |
| #1746 | signing | **Fixed LIVE remote signing** (see below). sign.html is readable on a phone; the printed record is byte-identical. Clear/Undo are 44px. esign "Next" no longer silently ticks a required checkbox. Photo Review and sandbox targets enlarged. |
| #1745 | customer | Share panel no longer widens the page. Uploaded-file rows. Bulk bar below the jump-nav. Jump-nav keeps the active chip in view. Claim "+ Add" opens at its section. Panel headers wrap. Tap targets 36–40px on touch. Header at 360. |
| #1750 | chrome | The bottom CALL/TEXT/EMAIL/TASK bar was at z 99985, **above every overlay**: a tap on "Save to Customer" dialled the homeowner. It now sits at `--z-fab`. Toasts lifted. The photo editor is usable. The speed-dial replaces 3 permanent FABs. The dictation pill no longer covers ⏹. |
| #1752 | views | Settings rows stack, and the Team invite box is usable. The notification bell is readable. The Pipelines editor has a sticky save. Light-mode contrast in the chrome. Hot Leads and Next Best Actions show names. Products collapsed on phones. |
| #1753 | pipeline | **The Tools ⋯ and Filters menus were invisible at every width, desktop included** (clipped by a scroll box). Find duplicates, Deleted leads, Bulk select and the filters were unreachable, while CI stayed green because the test checked only `.open`. List cards now show the true stage. Stage picker scrolls. Chip contrast. Follow-ups hide during search. Board cards. Add Lead gutter. |
| #1754 | estbuilder | V2 builder: steps open, adders tappable, 12px labels, 40px chips, and an in-row editor with Undo for a removed line. **Reopening a saved estimate no longer blanks the customer's phone and email**, and a new estimate no longer inherits the reopened one's customer. |
| #1749 | estdata | **The Estimates view said "No estimates yet" under a KPI band counting them** (production too). **Logged estimates reopened in Classic, which re-priced them to the $2,500 minimum and saved over the real price.** Invoice "Bill To: Customer" now shows the real name. Doc previews fit. |

## Notable bugs that were not phone-only

- **Live remote signing was broken since about April.** The global `Cross-Origin-Resource-Policy: same-origin` header blocked `/pro/js/signature-widget.js` inside the sandboxed (opaque-origin) signing frame, so no signature pad initialised on `/pro/sign.html` or in the doc viewer.
  - It was proved on production with a real browser.
  - It was fixed with an exact-path CORP rule in #1746 and verified live after deploy: the widget returns 200 and initialises.
  - It passed locally for months because the **Windows** hosting emulator applies no firebase.json headers (a superstatic `path.join` glob bug). CI's Linux emulator does apply them.
- **The Tools/Filters menus were invisible on desktop too** (#1753).
- **The Estimates list was empty on first open, with money overwrites on edit** (#1749).
- **A contractor cost figure was published in the catalog** ("Contractor cost $75/box", RFG NAIL-LUMA), which the privacy test's prose layer could not see. Fixed in #1751, which widened the sweep to catalog and template prose.
- **Add Lead inherited the last edited lead's** damage type, claim status, source, sub-type, policy number and date of loss (#1743).

## Follow-ups (not done; ranked)

1. **Data repair (money):** audit production logged estimates that Classic already overwrote. The signature is `builder:'classic'` with amount ≠ grandTotal; the original price survives in `amount`. Read-only first; a task chip was raised by the estdata lane.
2. **The signing contract is still print-size in its two sibling views:** the rep doc viewer's in-person signing, and the portal's Your Documents → View modal.
3. **Invoices show the raw doc id,** not an invoice number (needs per-tenant numbering).
4. **Pipeline:** *Update 2026-09-25: all three fixed in #1769.*
   - A second tap on ⋯ doesn't close the Tools menu (the handler compares `e.target.id` but the tap lands on the `<svg>`).
   - The menu doesn't re-place on rotate.
   - The Tools menu z 200 sits under the FAB stack.
5. **Toasts still over chrome:** `.nbd-voice-toast` over the quick-action bar, and toasts vs the upload widget sharing an offset. *Update 2026-09-25: both fixed in #1767; phone-chrome pins them at 412 and 360 (and the upload widget at 1280).*
6. **Tap targets under 44px:** the phone Settings pill (38×36 after the bell moved out) and the task picker's "Change customer" (32px). *Update 2026-09-25: both fixed in #1767; phone-dashnav pins them at 412 and 360.*
7. **Specs:**
   - Several specs run phone checks at 412 only; add 360. *Update 2026-09-25 (branch `fix/phone-followups-tests`): done for phone-chrome, phone-dashnav and phone-views, including the tests #1767 added (toasts stacking over the upload indicator, the Settings pill and "Change customer", the Pipelines leave guard).*
   - Some leave seeded leads/estimates in the shard (chrome, estdata before its fix-up, dashnav on a beforeAll timeout). *Update 2026-09-25: chrome and dashnav tag their seeds and delete them by tag in afterAll (`tests/e2e/fixtures/seeded-run.js`), which also covers a hook that died mid-seed. Rows the doc viewer files under `leads/{id}/documents` stay behind: `documentStatusWriteOk()` in firestore.rules reads `request.resource`, which is null on a delete, so no client can delete those rows (403 for the owner on the emulator).*
   - The dashnav create-sheet test is flaky about 1 in 6 (the sheet's overshoot animation); wait for animations to finish before tapping. *Update 2026-09-25: fixed. `openCreateSheet` waits until the sheet is at rest; 20 of 20 runs passed.*
8. **Smaller items:**
   - The estbuilder Undo bar survives a scope replace.
   - The claim "Advance" double-tap guard works only while the write is in flight.
   - Cache-buster skew: `claim-core.js`/`customer-checklist.js` at `?v=3` on customer.html but `?v=2` on dashboard.html.
   - The bulk-bar labels are clipped at 360.
   - Tablet (641–768px) share row.
   - Light-theme chip contrast is still under 4.5:1 on 2 themes.
   - Cal.com settings never reach the lazily-hydrated Schedule view (pre-existing).
   - A cold double-tap can open two knock overlays. *Fixed in #1767.*
   - The Pipelines editor has no leave-with-unsaved-changes guard. *Fixed in #1767; phone-views pins it at 412 and 360.*

## Rig lessons (read before the next big parallel run)

- **The shared Firestore emulator fills up under parallel E2E load.** It hit about 5.7GB with the default heap and 8GB with `JAVA_TOOL_OPTIONS=-Xmx8g`, then went unresponsive (once for about 40 min, unnoticed). The log shows `too many pending messagings in the back channel (10001)`: listener channels whose browsers closed without disconnecting keep queuing messages. Run a health monitor (responsiveness, not just memory) and restart + reseed the moment it stops answering.
- **Lanes must not run private emulators.** The storage emulators share `%TEMP%\firebase\storage\blobs`, and one restarting deleted blobs another still needed. The shared CLI then crashed with `ENOENT`.
- **Don't SendMessage running workflow agents.** A mid-run message "resumes" the agent into the parent session. Afterwards, lanes repeatedly reported "a second agent in my worktree", and some of it was their own lost-context work (verified against transcripts). Rig news belongs in a file the lanes read, or in later-stage prompts.
- **`JAVA_TOOL_OPTIONS` makes firebase-tools log an "Unexpected rules runtime error"** (the JVM's "Picked up…" notice). It is harmless: storage rules still evaluate (an unauthenticated write gets 403).

Scratch evidence (local only): `%TEMP%/claude/phone-audit/` holds findings.json, fix-results.json, per-lane scripts and screenshots.

Related:
- [NEXT_SESSION-2026-09-25](../projects/NEXT_SESSION-2026-09-25.md)
- [UPGRADES-ADDONS-DESIGN-2026-09-25](../projects/UPGRADES-ADDONS-DESIGN-2026-09-25.md)

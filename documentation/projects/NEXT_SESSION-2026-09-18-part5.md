# Session handoff — 2026-09-18 (part 5)

## Status: ended early on the usage limit — 3 things in flight, all parked safely

A "power session" working five lanes at once through multi-agent workflows
(every PR: isolated worktree → tests + mutation checks → independent
adversarial review → fix pass → CI 22/22 incl. all 6 authed E2E shards →
squash-merge). **15 PRs merged and deployed.** Stopped at Jo's request
before the limit; nothing half-merged, nothing running.

## Merged this session (all live)

| Lane | PRs |
|---|---|
| Fail-open sweep fixes | #1660 (D2D reopened Messages after an opt-out refusal — TCPA; template re-entry auto-send; share double-send guard) · #1661 (sample data / CSV import / seat picker on an unloaded cache) · #1663 (destructive actions reporting false success) · #1665 (tenant-wide profile writes from an unhydrated profile) · #1667 (server: opt-out check before every 402/429, bounded read → 503, Twilio 21610) |
| Globals Tranche 3 | #1672 (dashboard-ui.js explicit exports, zero behaviour) · **#1673 (dashboard-ui.js whole-file IIFE wrap — Jo approved, live-verified)** · T3-C long tail #1662 #1664 #1666 #1668 #1669 #1670 (22 names) |
| Inline-CSS dedup | #1671 (slice 3a: 204 redundant blocks stripped) · #1674 (slice 3b: readability block → `/assets/css/nbd-readability.css` on 186 pages; live-verified) |

Full records: [FAIL-OPEN-SWEEP-2026-09-18](../audit/FAIL-OPEN-SWEEP-2026-09-18.md),
the part-5 update block in [globals-tranche3-plan.md](../../docs/dev/globals-tranche3-plan.md),
WEEKLY_CADENCE items 1 / 10 / 12.

## 1. TOP PRIORITY — Google sign-in has NEVER worked (not a regression)

Jo reported new users "auto-blocked and bounced to login". Root cause
(5-angle investigation incl. read-only prod evidence + emulator repro,
2 skeptics could not refute; data: `.recon` of the session's w7.json):

1. **The Google provider was never enabled** on Firebase Auth `nobigdeal-pro`
   (admin/v2 `defaultSupportedIdpConfigs/google.com` → 404; 0 google.com
   users ever; Cloud Monitoring shows real `CreateAuthUri` 400s on 08-30 and
   09-14). **Jo, in the console** (Claude must not change prod config):
   Firebase → Authentication → Sign-in method → Add provider → Google →
   Enable → support email → Save. Then GCP → APIs & Services → OAuth consent
   screen: External, **In production** (not Testing), name + support email.
   Proof after: admin/v2 `defaultSupportedIdpConfigs/google.com` enabled:true
   (NOT public getProjectConfig — it omits providers).
2. **`firebase.json` COOP `same-origin` on `**`** (since abb577b1, 2026-04-11)
   severs the signInWithPopup popup → "Sign-in cancelled." even after (1).
   Fix = `same-origin-allow-popups` on the existing `/pro/register` header
   block only. **WIP branch pushed, NO PR: `fix/google-signin-coop-popup`**
   (commit 752cea73 — interrupted mid-implementation, UNREVIEWED, full suite
   not confirmed). Contains the header change, clearer register.js error copy,
   `tests/google-signin-popup.test.js` + `tests/lib/hosting-headers.js`
   (effective-header contract test), `tests/e2e/google-signin-popup.spec.js`.
   Finish: run `cd tests && npm test`, mutation-verify the contract test
   (delete override / weaken `**` / add signInWithPopup to login.js without
   an override → all RED), verify the reviewer's App Check popup-blocked
   concern (SDK may await an App Check token between click and window.open —
   Safari popup blocker), review, PR, merge, then
   `curl -sI https://nobigdealwithjoedeal.com/pro/register | grep -i cross-origin-opener`.
   - Account-linking note for Jo: with one-account-per-email, an existing
     UNVERIFIED password account loses its password credential on first
     Google sign-in (same uid/data). At least one gmail customer is unverified.
3. **Jo said YES: add a Google button to `/pro/login`** (it has none today).
   Build AFTER (2) merges, sharing its sign-in helper/error copy; needs its
   own COOP override on `/pro/login` (the contract test auto-covers it);
   `additionalUserInfo.isNewUser` → run the same account provisioning as the
   register page, else normal login redirect honouring `?redirect` / `?plan`.

## 2. Offline SMS outbox — PR #1675 OPEN, do NOT merge yet

Jo approved the design: offline texts queue on the device instead of opening
Messages; on reconnect the server re-checks opt-out FIRST, idempotency
(`sms_client_ids` claim), quiet hours 08:00–21:00 America/New_York, 15-min
staleness, competing activity (other outbound / homeowner reply / lead
changed); held texts go to a "Pending texts" tray. Round-1 review found 4
blockers (stale-verdict "Open in Messages" TCPA hole; live+replay double
send; ambiguous-Twilio claim release; edit double-send) + should-fixes — ALL
fixed in 0c26734a, tests green (client 189 / server 149 assertions). A
**round-2 re-review was started and stopped at wrap-up before reporting** —
it must be re-run before merge (3 lenses: verify each of the 11 round-1
fixes; fresh TCPA/double-send hunt; integration + money status). Known
should-fix to include: the queued-lock release (and pre-existing catch path
~invoice-pipeline.js:886) writes status `draft` regardless of prior status,
so a PAID invoice re-sent by SMS offline drops to draft — restore the prior
status. Deploy note: the new `sms_log {toDigits, date}` index must finish
building; until then queued sends 503 and stay queued (safe).

## 3. Decisions / console items for Jo

- Google provider + OAuth consent screen (above) — **blocks all Google signups**.
- Booking/review-link ownership: switch "is this NBD?" from the brand-name
  string to account identity (uid/companyId === owner). Jo confirmed he does
  not text from jdeal.tia@gmail.com / demo@nobigdeal.pro, so it costs
  nothing; deferred until sign-in works (no outside tenant can sign up yet).
  Details in the fail-open audit doc.
- Cost rotation: worksheets generated in `.local/rotation-{labor,xact,v2}.csv`
  (66/277/28 rows) — fill the blank columns, then the apply/import commands
  in WEEKLY_CADENCE item 1.
- TAMKO placeholder pricing (8 SKUs listed in WEEKLY_CADENCE), Lexington
  (GBP edit unconfirmed, permit call 859-258-3770, text the caller).
- Optional: GitHub branch protection "Include administrators"
  (enforce_admins is off — that is how admin pushes bypass the PR gate).

## 4. Smaller follow-ups (not started)

- `?v=` cache-bust sweep for the ~37 JS files changed today (low urgency: JS
  is `max-age=0, must-revalidate` + network-first SW; it only guards the SW
  offline-fallback version skew). Check for ES-module `import ... ?v=`
  specifiers before bumping HTML refs (a mismatch loads a module twice).
- Readability CSS: nothing asserts a migrated page KEEPS its
  `nbd-readability.css` link (review nit on #1674); `ensure-readability-css.js`
  eol detection treats a mixed-EOL file as all-CRLF.
- dashboard-ui.js post-wrap cleanup: dead spyglass `initAllAutocomplete`
  wrapper (now reads undefined), stale comments (~2632/~1921/~2609,
  dashboard-actions.js:957-975/:1139, dashboard-main.js:31), dead
  `toastQueue`/`toastActive` in dashboard-state.js.
- Confirm-less `loadSampleData` twin in dashboard-bootstrap.module.js (shadowed; delete with its MUST-STAY pins).
- Close Board brand gate (`_dealBrand`) pre-hydration — unreachable with one tenant.
- Smoke-pin weaknesses shared by every tranche: FWD_GUARD misses a
  typeof-guarded re-export with a trailing comment; the T1 walk misses
  bracket-notation / `Object.assign(window, …)` re-exports.
- Open PRs from spawned sessions (not this session's): #1676
  (`_leadsLoaded` reset on account switch), #1677 (Close Board per-user storage).

## Process notes worth keeping

- Auto mode blocks `gh pr merge` ("Merge Without Review"); Jo switched to
  bypass-permissions for the merge loop.
- Parallel PRs off the same base all conflict on `scripts/run-test-manifest.js`
  FLOORS (exact ratchet) + `tests/ci-manifest.json` — resolve by union +
  `node scripts/run-test-manifest.js --check`. Parallel T3 PRs also collide in
  `tests/smoke/dashboard.test.js` (T1_NAMES + appended assertion blocks);
  git factors the shared closing brace out of the hunk, so a union needs an
  explicit block close — always `node --check` + full smoke after resolving.
- A merge that resolves cleanly can still disagree semantically (#1660 vs
  #1667 on the D2D handoff contract) — run the touched suites locally before
  pushing a resolution.
- Worktrees without `functions/node_modules` fail ~7 suites; a junction to
  the main checkout's copy works — **remove the junction (rmdir / non-recursive
  delete) BEFORE `git worktree remove`**, or the target gets deleted.

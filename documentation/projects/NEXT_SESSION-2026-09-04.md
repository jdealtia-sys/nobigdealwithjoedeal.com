# Next session — brief as of the end of 2026-09-03

> Supersedes [NEXT_SESSION-2026-09-03](NEXT_SESSION-2026-09-03.md).
> Session record:
> [SESSION-2026-09-03-photo-reaping-and-phone-truth](SESSION-2026-09-03-photo-reaping-and-phone-truth.md).
>
> **Rewritten in place at 2026-09-03 close.** Every lane and every queue item
> the previous version carried was executed during that session, so the list
> that used to be here was entirely struck through. What survives below is
> what is still live — plus, at the top, the claims from that session that did
> NOT survive an adversarial re-check. Read §Do not rebuild on these first.

## Start here

**The single most useful fact about this session: it shipped 25 PRs, and a
verification sweep at the end refuted several of its own claims.** The pattern
it kept finding — things that look green and are not — showed up in its own
work three times (a CI gate that deadlocked merges, a confirm guard blind to a
whole subtree, a test-count ratchet protecting nothing it had added). Assume
the same is true of anything below that is not marked as measured.

**Nothing is losing data or money right now.** For the first time in this
project's history the database has a real, byte-verified backup, in two
separate Google Cloud projects.

## Do not rebuild on these — refuted 2026-09-03

These were written into commits, docs and workflow comments as fact during the
session, then disproved the same night. They are corrected at source; listed
here because a wrong number that sounds precise is the kind that gets reused.

1. **"The deploy could never have fit under the old CPU quota."** FALSE.
   Deploy run 33792001186 (18:41–19:12Z) finished 13 minutes BEFORE the quota
   was raised (19:25Z) and SUCCEEDED — 169 updates plus 1 create, peak 175
   concurrent instances against the 200 ceiling. Complete deploys fit, twice,
   that afternoon.
2. **"179 services × 1 vCPU = 179 vCPU at rest, ~90% of the limit; a rollout
   needs ~358."** FALSE on both counts. 175 of the 179 services carry no
   `minScale` and scale to ZERO; only 4 set it, totalling 8 instances.
   Measured quiet concurrency is 9–14 — about **5–7%** of the old ceiling. The
   quota meters **peak concurrent running-instance CPU**, not provisioned CPU
   (proved by the real 2026-08-18 failure landing exactly as concurrency hit
   208 vs 200). All-time peak here is 208; nothing supports 358.
   The raise to 600,000 is still defensible — "~88% of ceiling at deploy peak
   with no margin, and the fleet grows" — but the arithmetic that justified it
   was fiction and the right answer was reached by coincidence.
   **Trap:** the two `allowable CPU per project per region` strings in the
   deploy logs are the workflow's own echoed comment, not error output. They
   read exactly like evidence for the wrong version.
3. **"The daily Firestore backup now runs."** The SCHEDULED path has never
   once succeeded. Today's 03:15 ET fire failed with `PERMISSION_DENIED`; a
   manual run at 18:06Z failed the same way even after the bucket existed (IAM
   propagation); only the hand-triggered 18:17Z run produced the export.
   Exactly one successful export exists and a human caused it.
4. **"The backup system is fixed end to end."** `firestoreBackupRetention` has
   still **never succeeded, ever**. Its only run today logged
   `firestoreBackupRetention.failed` and its scheduler `lastAttemptTime` has
   not moved since 07:45:16Z. `functions/firestore-backup.js` catches every
   error and logs at **WARNING** ("swallow so the scheduler doesn't retry
   forever") — below the `severity>=ERROR` filter any operator uses, with zero
   alert policies to catch it, and `backupFreshnessCron` only checks marker
   age, never that pruning happened. A permanently broken retention job is
   silent forever while the bucket grows ~94 objects/day.

## The three dates that matter

- **2026-09-04 07:15Z** — `dailyFirestoreBackup` runs unattended for the first
  time ever. Nothing has proved the scheduled path works.
- **2026-09-04 10:00Z** — `backupFreshnessCron` fires and **will report `ok`
  whether that export succeeded, failed, or never ran.** The only marker in
  the bucket was written 18:18Z by a manual run; at 10:00Z it is 15.7h old
  against a 26h threshold. **Do not read tomorrow's green as proof.**
- **2026-09-05 10:00Z** — the first honest verdict from the alarm.

## Top of the list

1. **Confirm the scheduled backup actually ran** (see the dates above). If
   2026-09-04's 07:15Z tick failed, the alarm will not tell you until the 5th.
   `gcloud storage ls gs://nobigdeal-pro-firestore-backups/` — a `2026-09-04/`
   folder with an `overall_export_metadata` inside is the proof.
2. **Fix `firestoreBackupRetention`, or delete it.** It has never worked, it
   fails silently at WARNING, and nothing watches it. Deciding it is not worth
   fixing is a perfectly good outcome — leaving it as-is is not.
3. **Deploy the ten monitoring policies that already exist.** `monitoring/`
   contains ten alert-policy JSON files — including
   `alert-backup-cron-stale.json` and `alert-functions-error-rate.json` — and
   **the project has ZERO live alert policies** (`alertPolicies` returns `{}`).
   Two notification channels (email + SMS) are enabled and wired to nothing.
   Pre-existing, not caused by this session, but it is the same species: a
   directory that looks like monitoring. `backupFreshnessCron` is currently
   the **only** functioning alarm in the project.
4. **Eight functions are three weeks stale.** `sendEstimateEmail`,
   `migratePinsToKnocks`, `sendDripEmail`, `auditCustomerDataIntegrity`,
   `triggerProcessRecording`, `reprocessRecording`, `backfillCustomerData`,
   `sendTeamInviteEmail` all carry `updateTime 2026-08-11` and appear in none
   of the three deploy logs from 2026-09-03. Their live code is behind `main`
   and a green deploy says nothing about them. (`onRepSignup` is a known
   skip-list entry and did land via the tolerant path.)
5. **Nothing watches the off-project copy.** `grep -rniE
   'nobigdeal-offsite|nobigdeal-backups' functions/ scripts/` returns zero.
   `backup-freshness.js` watches only the in-project bucket and runs inside
   `nobigdeal-pro`, where it cannot see the backups project. Neither transfer
   job has a `notificationConfig`. Both have run exactly once — the immediate
   run at creation. **"Repeats daily" is configuration, not observed
   behaviour**; proof is a second operation appearing after ~2026-09-04 19:34Z.
6. **The DR runbook has a hole.** In a real restore its first command
   (`scripts/verify-backup.sh`) fails against a dead bucket, and the runbook
   never mentions the offsite copy — the only copy that survives losing the
   project. Documentation fix, cheap.

## Also true, lower priority

- **12 of the 19 CI checks are advisory** and can go red while a PR merges:
  all six Authed E2E shards, Public-surface E2E, the emulator suites, Referral
  triggers, both visual jobs, and Rendered QC sweep. That last one actually
  concluded FAILURE on real content in PR #1373 — the only job all session to
  catch a live defect — and it does not block. The required seven are the six
  fastest jobs plus Firestore rules; essentially the whole behavioural test
  surface sits outside the gate.
- **Branch protection binds nobody who currently merges.** With
  `enforce_admins: false` and required reviews 0, the one account that merges
  everything can bypass. That was deliberate (a solo operator must not be
  locked out) — just do not mistake it for enforcement.
- **`nightlyFirestoreBackup` errors nightly at 09:00Z on purpose**, against a
  bucket deliberately not created (it has no retention job; creating it would
  grow unbounded). Harmless, but it is exactly the standing red that trains
  people to ignore logs. Retiring it is the clean end state.
- **`crm-audit.js` has never gone red in real CI.** Proved capable of exit 1
  locally against fixtures; every CI run on main since it merged is green, so
  the exit-code-to-red-check wiring is untested in anger.
- **The 600,000 mCPU quota is not load-bearing yet.** Peak during the
  post-quota deploy was 177 — inside the old ceiling too.
- **The export is not proven RESTORABLE.** The 98-byte completion marker and
  92 output shards exist; nobody decoded the protobuf or attempted
  `gcloud firestore import`. Marker presence proves the export reported
  completion, not that a restore works.
- **`getgooglereviews` has been erroring at a steady rate for 7 days**
  (45 entries in a 3h window), unchanged before and after every deploy today.
  Pre-existing; an invalid Places API key produces rejected requests, not
  billed ones.

## Corrections — briefed claims that are FALSE

A 17-agent recon (each lane reconned, then handed to an adversarial verifier
told to refute it) proved fourteen briefed or reconned claims wrong. **Read
this before picking up any lane below.** Each cost a session otherwise.

1. **The invoice pipeline is not under `functions/` and does not honour a cents
   invariant.** It is `docs/pro/js/invoice-pipeline.js` — 1643 lines of float
   dollars with an inline `round2` and no cents helper. "Money math stays in
   cents" holds only for the classic/per-SQ estimate engines and at the Stripe
   boundary; the V2 line-item engine that produces invoice numbers is float too.
2. **`adjuster-board.js:55` and `ai-texting-stats.js:52` are not unbounded
   reads.** Both carry a tenant/user equality plus a clamped date range. Only a
   hard `.limit()` ceiling is missing — much smaller than briefed.
3. **The dictation lane has no provider seam to flip.** `functions/dictate.js`
   hardcodes one Deepgram helper. This is "build the seam", not "switch a
   default". (The briefed path `docs/pro/js/dictate.js` does not exist; the
   audit doc's own citation was already correct — do not "fix" it.)
4. **No API keys are exposed to the browser on the dictation path.**
   `DEEPGRAM_API_KEY` and `GROQ_API_KEY` are Secret Manager bindings read inside
   the function; all four client call sites go through `httpsCallable`.
5. **There is no `windGust` field to remove.** Zero occurrences repo-wide
   outside two docs that both record its absence.
6. **`{static: true}` does not fix the lead-modal backdrop wipe.**
   `crm-leads.js:165` installs a *second*, direct backdrop listener on the
   element that bypasses nbd-modal's static guard entirely.
7. **`openSettingsTab('billing')` is not the billing-CTA fix.** Its first line
   calls `nbdPickerOpen` (a real global from `maps.js:255`), so it always opens
   the theme picker. #1355 used `goTo('settings')` + `switchSettingsTab('billing')`.
8. **`tests/stripe-payment-link-tax.test.js` is not silently green.** It has
   eight fixtures and S2/S5/S7/S8 assert a *refusal*. The real gap is narrower:
   no fixture proves the guard PASSES on a corrected invoice. Number any new
   fixtures S9+ — S7/S8 already exist.
9. **`crm-audit.js --severity=error` gates nothing** (`totErr` counts over
   findings, not the filtered list), and `docs/pro` carries **zero** executable
   inline scripts, not five — its `node --check` spawn loop never runs.
10. **push-functions' `d2dKnocks != null` index is not missing.** A single-field
    inequality uses Firestore's automatic index, which is never declared in
    `firestore.indexes.json`. The full-collection fallback is likely dormant.
11. **Querying on `autoFollowUp` with a composite index is impossible.** It
    lives inside the `d2dKnocks` *array of maps*; no index can range-filter
    that. It needs a denormalized top-level field — far more than the "M" it
    was sized at.
12. **`OfflineManager.queueWrite` is dead code**, not a live bug — zero callers
    repo-wide. (Still a product question: the UI implies an offline queue that
    does not exist.)
13. **`tests/smoke/portal.test.js:168` and `crm.test.js:400` do assert query
    bounds** — the claim that nothing does was wrong.
14. **The audit doc's `~:78` for `fetchNoaaHail` is an insertion-point
    citation**, not drift. "Correcting" it to `:38` makes the doc worse.


## Blocked on a Cloud Functions deploy window

Sequenced separately on a quiet evening; **do not bundle any of these with a
client-only PR.**

- **Five billable AI endpoints ignore the emergency kill switch** —
  `dictate.js` (Deepgram + Anthropic), `ai-texting.js`, `voice-memo.js`,
  `voice-intelligence.js`, `handlers/photo.js`. `killswitch.js`'s own docstring
  promises "all billable AI endpoints fail closed" and only four call sites
  honour it, so pulling the switch during a spend incident stops about half the
  bleeding. The coverage *test* is cheap and can land any time — but a
  host-string scan structurally cannot see `handlers/ai-texting-preview.js`
  (it reaches Anthropic via `callClaudeForDraft` with no host string), so build
  the scan from entry points or follow transitive requires.
- **`storm-watch.js` writes the dedupe record BEFORE sending the alert.** If the
  subscriber query throws or the 300s timeout fires mid-run, the hail event is
  permanently marked handled and Jo silently never hears about the storm. A
  static ordering guard can land now; the reorder needs the deploy. Siblings:
  the cooldown stamp is fire-and-forget while `texted++` runs anyway (TCPA
  exposure on a consent list), and unlisted 452xx/410xx zips all collapse to one
  downtown point, so someone 29 miles away is told a storm "hit your zip code".
- **Unbounded / mis-bounded reads in `functions/`** — `health-digest`'s
  full-collection `api_usage_daily` read, two silent-truncation bugs,
  `admin.js`'s four cross-tenant 30-day scans, calcom's lifetime lead-book scan.
  Carry these corrections or the fixes ship broken: the documentId prefix range
  needs a high sentinel (`endAt(dayKey + '')`) or it returns **zero** rows
  and the digest reports zero tokens daily; a `processedAt` range on
  `stripe_events` silently excludes every Connect-webhook event because
  `stripe-connect.js:449` writes `receivedAt`; and `admin.js` can take the clean
  composite path for leads but needs the chunked `userId in` path for
  estimates/measurements/portal_tokens.
- **`depositAmount` half-cent write + the exact-zero fully-paid check** — a
  3-way split leaves 1 cent stuck in Outstanding forever. The paid check exists
  at `docs/pro/js/invoice-pipeline.js:877` **and** `functions/stripe.js:1643`;
  they must change together or client and webhook disagree about "paid".

## Needs a decision, a fixture, or prod access

- **Invoice footing gap — row-based invoices cannot mint a Stripe payment
  link.** Real and load-bearing: the engine snaps `grandTotal` to the nearest
  $25 while items and subtotal stay unrounded, so Σ(items)+tax misses total by
  dollars and `functions/stripe.js` refuses with HTTP 400. **The obvious fix
  does not work** — a "Contract adjustment" line hits `MIN_CENTS=100` at
  `stripe.js:1184`, and the rounding is symmetric so ~half of all deltas are
  *negative* (down to −$12.49), which Stripe rejects outright. Needs a fix
  design, plus one prod log query on `payment_link_total_mismatch`
  (`stripe.js:1247`) to size how much of Jo's traffic is row-based. Per-SQ
  reconciles exactly across 5,505 swept combinations.
- **Firestore audit: estimates with a cost split but `materialMarkupPct`
  missing or zero.** `estimate-logic-engine.js:880` turns an empty-string
  settings field into markup 0 — retail == cost. The damage is written at SAVE
  time (`estimate-v2-ui.js:2823-2837` persists `retailTotal` computed with mk),
  so `invoice-pipeline.js:301` is neither where it is caught nor where it is
  fixed. Needs prod Firestore read access.
- **Wayback historical-imagery slider** (the 🕐 History button on the drawing
  tool) has **three** independent defects, not the two briefed: invented string
  release ids, a missing CSP `img-src` grant, **and** `setZIndex(-1)` stacking
  the historical tiles underneath the opaque Google base. Fixing two of three
  still shows a blank panel. Needs the real numeric release ids from Esri's
  `waybackconfig.json` (hardcode a curated table — do not add a runtime fetch)
  and a preview channel to verify, because the hosting emulator sends no
  custom headers.
- **NCEI SWDI hail + KyFromAbove aerials** need a live response captured as a
  committed fixture first — field names, units (inches vs mm vs a size code)
  and coordinate ordering are all guesses, and `sizeInches` mis-stamps
  *immutable* `storm_proofs` docs if wrong. Non-obvious trap: registering an
  `swdi` fetcher without also adding a **keyless branch** to
  `preferredHailProvider()` makes the env var fall through to `noaa` — the
  feature looks wired and is silently dead. Shares the `firebase.json` `img-src`
  line with the Wayback fix, so sequence them.
- **NWS rain-day chip**: needs no CSP change (`api.weather.gov` is already
  granted, two shipped modules call it) — but the brief asks for a chip on
  "day cells" and `smart-calendar.js` renders **today only**. Placement is Jo's
  call: a chip per appointment row, or one tile in the 3-tile summary header.


## Watch-outs (carried + new)

- `main` is held by the `nbd-wt-ledger-recon` worktree — branch from
  `origin/main`, never check out `main` here. **`gh pr merge --delete-branch`
  will print `fatal: 'main' is already used by worktree…`; the merge itself
  still succeeded** — check `gh pr view --json state` before believing it.
- **The hosting emulator applies neither redirects nor headers.** Any
  `firebase.json` hosting change: preview channel, Node probe, delete the
  channel.
- **Visual-regression compares for real now.** A PR touching login, register,
  pricing or the landing page must delete
  `tests/e2e/visual-regression.spec.js-snapshots/` in the same PR.
- **A new `tests/*.test.js` must be registered in `tests/ci-manifest.json`** or
  the completeness tripwire fails CI. Node bucket is a plain array; the smoke
  bucket needs per-suite documentation.
- **NEW — `perl -0pi -e "s/…\n//"` silently no-ops on this checkout.** Files are
  CRLF, so `\n` never matches at a line end. It reports success and changes
  nothing — which briefly looked like a gate that could not fail. Match `\r?\n`.
- **NEW — the shell's cwd persists across Bash calls.** A `cd tests && node …`
  leaves every later call in `tests/`, where `functions/` "does not exist".
  Use absolute paths.
- **NEW — `gh pr checks <n>` returns empty for the first seconds after a push**,
  so `until [ "$(… | grep -c pending)" = "0" ]` exits immediately on a false
  green. Guard on non-empty output too.
- **Workflow runs can be wiped by an API capacity outage** — the first recon
  lost all 10 agents to 529s on their *final* structured-output call, after the
  reading was done. Wrap `agent()` in a retry loop; the retry run lost nothing.
- Two PRs inserting a section before the same `section(...)` line will
  merge-conflict; anchor new sections on distinct neighbours.
- **Per the shared-checkout lesson: whole slices have been rebuilt three times
  here, and a precise task prompt can itself be stale.** Check open PRs and
  worktree branches before starting any named slice — including one from this
  brief.

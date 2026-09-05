# Next session — brief as of the end of 2026-09-04

> Supersedes [NEXT_SESSION-2026-09-04](NEXT_SESSION-2026-09-04.md).
> Session record: [STABILITY-AUDIT-2026-09-04](../audit/STABILITY-AUDIT-2026-09-04.md)
> — the audit note carries the full finding lists, the corrections, and the
> two dated UPDATE sections; this brief carries only what is still live.

## Start here

**Seven PRs merged and deployed, all verified live rather than trusted green.**
Nothing is mid-flight. Every branch is squash-merged (their SHAs will not show
as ancestors of `main` — verify by content, not ancestry). The only open PR is
#1373 (wood siding pages), which predates this session.

**Nothing is losing data or money.** The SMS subsystem has never processed a
real message (`sms_opt_outs`, `sms_log`, `sms_inbound_seen`,
`storm_alert_subscribers` are all empty in prod), so the two TCPA fixes below
landed *before* the feature goes live, which is the best possible order.

## What shipped (2026-09-04)

| PR | | |
|---|---|---|
| #1377 | TCPA consent persisted at intake AND checked at send time; both `/estimate` submit paths carry it | deployed |
| #1378 | 216-page SEO gate (`scripts/check-seo-surface.js`), 6 fixes incl. an indexable 404 and a 117 KB JPEG hero | deployed |
| #1379 | Audit record | — |
| #1380 | `sms_opt_outs` stored and looked up under ONE key (`functions/sms-optout.js`) + backfill | deployed |
| #1381 | Corrected the deploy comment that claimed `--force` deletes orphans | — |
| #1382 | Orphan detector — a deploy now FAILS if the fleet stops matching the code | live on every deploy |
| #1383 | `hailMatchCron` scores real leads for the first time; `/storm-check` CSP; ten deployable alert policies | deployed |

Plus **eight orphaned Cloud Functions deleted** by hand (fleet 179 → 171), and
**all 77 audit findings that had been mis-filed as refuted were adjudicated**:
39 true, 36 partly, 1 false, 0 left unverified.

## Do not rebuild on these — refuted 2026-09-04

1. **"Eight functions are three weeks stale, live code behind main."** FALSE.
   They were deliberately retired from source on 08-06/08-11 and never
   undeployed. Their code was not behind main; it did not exist in main. All
   eight are now deleted. *Retiring an export does not undeploy it.*
2. **"`--force` auto-confirms deletion of orphan functions."** FALSE. Firebase
   only detects orphans on an unfiltered functions deploy; this workflow names
   every target. #1382 is the detector that now catches it.
3. **"The CRM mic buttons are dead — `DEEPGRAM_API_KEY` was never set."** FALSE.
   It is set and bound to both callables.
4. **The 77 "refuted" findings were never refuted.** Their verifiers died on
   the session limit and the workflow scored zero votes as a refutation. The
   real split is in the audit note. Severities were badly inflated: 3 critical
   + 18 high arrived; 2 high and 0 critical survived a real read.
5. **"The sms_opt_outs key mismatch is harming homeowners right now."** FALSE
   as impact — the register is empty, no inbound SMS has ever arrived. The
   defect was real; the damage was not.

## Top of the list

1. **The Google reviews are blank on every marketing page.** Both
   `GOOGLE_PLACES_API_KEY` and `NBD_PLACE_ID` are the literal `__unset__` deploy
   stub, so `/api/google-reviews` returns `{"rating":0,"total":0,"empty":true}`
   with HTTP **200** — which is why nothing ever alerted. Verified live. Needs
   real credentials; only Jo can supply them.
   `firebase functions:secrets:set GOOGLE_PLACES_API_KEY` then `NBD_PLACE_ID`.
2. **Turn on alerting — Jo's call.** All ten `monitoring/alert-*.json` are now
   proven to create (each was created in prod and deleted again). The project
   still has **zero live policies**. One loop deploys nine of them; skip
   `alert-migrations-tick-stale.json`, which is disabled on purpose.
3. **Three more `__unset__` stubs pass as configured** because `'__unset__'` is a
   truthy string and four functions test truthiness instead of `hasSecret()`:
   Sentry DSN (`SENTRY_DSN_FUNCTIONS`), Turnstile, Stripe Connect webhook.
   Route them through the registry. S each.
4. **`migrationsTick` has not fired since 2026-08-31** and *cannot* be alerted
   on as an absence — Google caps `conditionAbsent` at 23h30m, shorter than a
   daily cadence. Fix is code: a heartbeat-age check that logs an ERROR, then
   alert on that line, the way `backup-freshness.js:120` already does.
5. **GA4 is absent from all 163 service/area landing pages.** Not merely
   missing at conversion time — the tag is never loaded. Every lead from those
   pages is invisible to analytics. M, markup only, CSP already permits it.
6. **Three more public forms discard TCPA consent** the same way `/estimate`
   did: `/storm-check`, `/roof-score`, `/storm-report`. Same fix as #1377 —
   but the adjudicator's sequencing note matters: persistence must ship before
   any collection is added to `CONSENT_COLLECTIONS`, or the ack goes dark.

## Watch tomorrow

- **`hailMatchCron` runs at 09:00 America/Chicago and scores real leads for
  the first time ever.** Expect hail hits on Jo's pipeline that were never
  there before. That is the fix working, not a bug.

## Watch-outs (new this session)

- **Cloud Run service names are lowercase.** `onAudioUploaded` matches nothing
  in a Monitoring filter; `onaudiouploaded` does.
- **`conditionAbsent` caps at 23h30m.** "A daily cron stopped" is not
  expressible as an absence condition; it false-fires daily.
- **`gcloud ... create --format="value(name)"` still prints the `Created alert
  policy [...]` banner.** Capturing stdout for the resource name gives you the
  banner. A cleanup loop built on it silently no-ops — assert the live count
  afterward, never trust the loop.
- **Squash merges discard the branch SHA.** `git merge-base --is-ancestor
  <branch-sha> main` is guaranteed false after a squash. Verify a deploy by
  reading the file out of `origin/main`, not by ancestry.
- **`JSON.parse` + `stringify` on `firebase.json` reformats the whole file** —
  484-line diff for a two-token change. Edit it line-wise.
- **A source-contract test that greps raw text matches comments.** Twice today
  an assertion passed (or failed) on prose rather than code. Strip comments
  first.
- **`onboarding tour anchors` in the `@audit` E2E shard is flaky** — proven by
  re-run on the identical commit. Advisory, so it will not block, but it will
  keep producing false reds.
- **The two `cancelled` deploy runs from 09-03 are unexplained.** Today's
  rapid merges QUEUED rather than cancelling, which contradicts the "superseded
  by concurrency" guess. Open question.
- **Workflow scripts: `survives` must distinguish `unverified` from `refuted`.**
  An agent that dies is not a refutation. Three outcomes, never two.
- `r2.json` and `runs30.json` are untracked junk in the repo root — not from
  this session, never committed. Delete or gitignore.
- ~20 stale local branches are all squash-merged and safe to delete; the
  `nbd-wt-ledger-recon` worktree still holds `main`.

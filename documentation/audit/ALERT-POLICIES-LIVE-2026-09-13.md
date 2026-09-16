# Cloud Monitoring alert policies go live — 2026-09-13

> Jo, 2026-09-13: "apply the other 10 monitoring policies too" (after the
> Turnstile token alert became the project's first live policy). Nine of the
> eleven files in `monitoring/` are now live in `nobigdeal-pro`; two are held
> with reasons. Every condition was **replayed against the previous 7 days of
> production logs and metrics before it was created**, and that replay found
> three defects the 2026-09-04 "all ten now create successfully" pass could not
> see — creating a policy proves Google accepts it, not that it fires on what it
> claims. Corrects [STABILITY-AUDIT-2026-09-04](STABILITY-AUDIT-2026-09-04.md)'s
> "zero live policies" in place.

## What was found

- **Zero alert policies were live** until the Turnstile policy an hour earlier.
  Not trusted from an empty listing alone: `gcloud alpha monitoring policies
  list --format=json` returned `[]` while the *same* command surface listed the
  two notification channels (email + SMS, both "Joe - Primary").
- All 16 Cloud Run services the policies name exist (`gcloud run services
  list`, 184 services), all lowercase.
- Every log string the matched-log policies key on exists in `functions/` with
  the expected severity (`rate_limit_denied` warn, `access_code_invalid` warn,
  `getPublicSiteConfig failed` error, `voice: pipeline failed` error,
  `backup_freshness.stale` error) — **except the Claude budget text**, which is
  never logged (below).

## The 7-day replay

Read-only. Log conditions via `gcloud logging read … --freshness=7d`; metric
conditions via the Monitoring REST `timeSeries.list` with each policy's exact
filter and aggregation. A positive control accompanied each empty result (a
WARNING query returning rows; an `emailqueueworker` series returning data).

| policy | 7-day result | verdict |
|---|---|---|
| backup-cron-stale | 0 `backup_freshness.stale`; the service logged 526 entries | quiet — created as-is |
| email-queue-worker-stale | **192 series across 49 revisions, 184 already stale** | **would page after every deploy — fixed** |
| function-latency | p95 max 9,513 ms (claudeproxy), 2,070 (renderpdf), 1,169 (gethomeownerportalview) vs 30,000 | quiet — created as-is |
| functions-error-rate | as written max **0.02** vs threshold 50; as a count, worst 5-min window **6** (renderpdf) | **could never fire — fixed** |
| rate-limit-spike | 0 denials | quiet — created, renamed |
| tenant-microsite-errors | 0 | quiet — created, renamed |
| validateAccessCode-bruteforce | 0 | quiet — created, renamed |
| voice-processing-failures | 0 | quiet — created, renamed |
| claude-budget-exceeded | 0 as written, 0 for any budget text on `claudeproxy` | **cannot fire as intended — held** |
| migrations-tick-stale | — | disabled by design since 2026-09-04 — held |

## The three defects

1. **`functions-error-rate` could never fire.** Its aligner was `ALIGN_RATE`,
   which turns a 5-minute `log_entry_count` into a *per-second* rate, so a
   threshold of 50 meant more than 15,000 ERROR entries in five minutes. Now
   `ALIGN_DELTA`: the threshold is a count per 5-minute window, which is what
   the name always said.
2. **`email-queue-worker-stale` would have paged after every deploy.** Without
   a cross-series reducer, `log_entry_count` arrives as one series per
   revision × severity × log, and an absence condition judges **each series**.
   Every functions deploy retires a revision, so its series "go absent". Now
   `crossSeriesReducer: REDUCE_SUM`: one series — 2,016 five-minute points over
   168 h with no gap — that goes absent only when the worker stops. Duration
   also 900 s → 1,800 s, to match the "> 30m" in its name, condition and README.
3. **`claude-budget-exceeded` cannot fire as intended.** "Daily AI budget
   exceeded" exists only in the HTTP response body at
   `functions/handlers/ai.js:201`. The other clause is the catch-all
   `logger.error('claudeProxy error')` (`ai.js:292`) under `service_name=
   "claudeProxy"`, which matches nothing — and lowercasing it would alert on
   *every* claudeProxy error, not budgets. (The Logging query language also
   binds `OR` tighter than `AND`, so the unparenthesised filter never meant
   what it reads as.) Marked `[NOT DEPLOYABLE]`, `enabled: false`, like
   migrations-tick. **Real fix is code:** log a distinct line where the 429 is
   returned, deploy, point a `conditionMatchedLog` at it.

Plus four honest renames: `conditionMatchedLog` cannot count, so a condition
named "> 20 in 5 min" fires on the first occurrence. Tenant, voice, rate-limit
and access-code names now say "any occurrence" and state the notification rate
limit instead of a threshold they never had.

## What is live now

Created through the REST API (`POST …/alertPolicies`, UTF-8), one at a time,
skipping any existing display name; each then GET-compared field-for-field
against its file (display name, enabled, condition type and name, filter,
threshold/duration/comparison, aggregation, channels, rate limit, auto-close,
documentation) — **all nine match**. All route to both "Joe - Primary"
channels.

| policy id | display name |
|---|---|
| 15802792625691337472 | Turnstile token arrived on a real lead (created earlier the same day) |
| 4583991940756031706 | Firestore backup stale (backupFreshnessCron error) |
| 13778878090024007435 | emailQueueWorker stale > 30m |
| 10772729232835340080 | user-facing function latency p95 high |
| 9423454652957568708 | Cloud Functions error rate spike |
| 13778878090024008942 | Rate-limit denial (any; notifies at most every 10 min) |
| 14764694890411614899 | Tenant microsite config errors (getPublicSiteConfig 500s) |
| 5276308824995125595 | validateAccessCode brute force |
| 4594628795274947618 | Voice Intel pipeline failure |

**Rollback** (one policy): `gcloud alpha monitoring policies delete
projects/nobigdeal-pro/alertPolicies/<id> --project=nobigdeal-pro`, or disable
it in Cloud Monitoring → Alerting. Pass the full resource name — the 09-04 pass
left 7 orphans by parsing `gcloud`'s `Created alert policy [...]` banner.

## Not verified

- **No policy was fired end-to-end.** Doing so means writing a synthetic
  matching log line or a real error into production, which texts Joe and, for
  the Turnstile policy, pollutes the exact log an enforcement decision reads.
  The evidence is: Google accepted each policy, the read-back matches, and the
  replay shows what each would have done over the last week.
- **Seven days is a short window.** Rate-limit denials and invalid access codes
  were zero this week; a burst (or CI traffic — CI E2E calls production
  functions) would text at most every 10 and 5 minutes respectively.
- `function-latency` and `functions-error-rate` watch fixed service lists.
  `getgooglereviews`, which logged most of the project's ~1,770 ERROR entries
  that week, is in neither — #1518 (deployed the same evening) reclassifies its
  not-configured state as a deploy state rather than an error.

## Traps recorded

- `gcloud` on a Windows console prints non-ASCII as `?`: the em dash in every
  display name *looked* corrupted while stored correctly. Read back over REST.
  The same substitution can defeat `scripts/ops-setup.sh`'s skip-if-exists
  `grep` and create **duplicates** — list policies before running it from
  Windows.
- "Creates successfully" is not "works". Replay a policy's condition against
  real data before trusting it; two of eight created policies here would have
  been silent or noisy.

Related: [monitoring/README.md](../../monitoring/README.md) ·
[TURNSTILE-SETUP](../runbooks/TURNSTILE-SETUP.md) ·
[HEALTHCHECKS-SETUP](../runbooks/HEALTHCHECKS-SETUP.md) (the answer for daily
crons, which an absence condition cannot express).

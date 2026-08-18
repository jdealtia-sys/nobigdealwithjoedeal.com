# NEXT SESSION — handoff 2026-08-18 (auth-surface scare → deploy-pipeline honesty pass)

**Previous handoff:** [NEXT_SESSION-2026-08-17](NEXT_SESSION-2026-08-17.md)

Started as a single alarming question — `beforeAdminSignIn` had been `FAILED`
in prod for six days on an auth surface — and ended as a pass over how much of
this repo's deploy tooling was reporting conditions that had already stopped
existing. Six PRs, all merged: #1233, #1235, #1242, #1245, #1247, #1251.

## The short answer to the thing that started it

**Admin sign-in was never impaired.** The FAILED function was an inert orphan:
Identity Platform's `blockingFunctions` config is `{}`, so nothing was ever
registered and nothing could invoke it. It had no backing Cloud Run service and
was not in the source tree. Created 2026-04-14T19:34:59Z by the deploy that
first tried to register it; the export was reverted 7 minutes later
(`d8dee687`). The 2026-08-11 timestamp in the alert was a control-plane state
refresh with no API caller — a red herring. Record deleted; the non-`ACTIVE`
sweep is clean.

Full analysis:
[BLOCKING-TRIGGERS-NOT-GCIP-2026-08-17](../audit/BLOCKING-TRIGGERS-NOT-GCIP-2026-08-17.md).

## The load-bearing finding — read this before touching auth

**Blocking auth triggers have never worked in this project, and cannot until
it is upgraded to GCIP.** Every deploy fires an `identitytoolkit`
`UpdateConfig` that fails with

```
OPERATION_NOT_ALLOWED : Blocking Functions may only be configured for GCIP projects.
```

162 consecutive failures in 30 days. `nobigdeal-pro` is subtype
`FIREBASE_AUTH`. Consequences that are easy to get wrong:

- **`onRepSignup` is `ACTIVE` but has never been invoked** — zero Cloud Run
  requests in 30 days. The callable fallbacks (`claimInvite`,
  `activateInvitedRep`, `mintOwnerClaims`) are not a safety net; they are the
  **only** claim-minting path that runs.
- **`mfa.state` is `DISABLED`** for the same reason, so `/admin/mfa-enroll.html`
  is guidance only — admins cannot actually enrol a second factor today.
- **The deploy SA already holds `roles/identityplatform.admin` AND
  `roles/cloudscheduler.admin`**, granted 2026-04-14T22:02. Do not grant auth
  roles here expecting a fix; check the policy first, the answer is
  "already there".

## The pattern worth naming

Four independent instances this session of the same failure:

> **A warning describing a condition that stopped existing, left up long enough
> to read as evidence.**

| The warning | Reality | Cost |
| --- | --- | --- |
| `identityplatform.admin` missing (comments in 3 files) | Granted 2026-04-14 | Two sessions |
| `gcloud services enable` "Manually enable in Cloud Console" | All 7 APIs already enabled; SA simply cannot enable, so it exits 1 forever | Named `identitytoolkit`, so it read as corroboration for an unrelated auth bug |
| `Scheduled/blocking functions deferred` annotation | Only ever covered `onRepSignup`, a blocking trigger — no scheduled function has failed since 2026-04-14 | Made "scheduled functions still fail" look true from the logs |
| `POST_DEPLOY_CHECKLIST` §16 | Origin of the whole misdiagnosis; still linked from the live workflow | Seeded all of the above |

Each was fixed by the same move: **assert the end state you care about, not the
signal the tool volunteers.** That is also exactly what #1233's completion
accounting does for deploys. If you find yourself reading a CI warning as
evidence, check whether the condition it describes is still true.

## What shipped

| PR | What |
| --- | --- |
| #1233 | Completion accounting — every targeted function must print a terminal line (3rd false-green mode) |
| #1235 | GCIP root cause, orphan deleted, `auth.js` + workflow comment corrections |
| #1242 | API-enable step verifies outcome not exit code; recorded that the auth roles were already granted |
| #1245 | Cloud Scheduler IAM story retired; `POST_DEPLOY_CHECKLIST` §16 superseded |
| #1247 | CPU-quota mode documented + proof chunking does not blind the mode-3 guard |
| #1251 | `timeout-minutes` on all 13 CI jobs (they had none) |

Completion accounting earned itself immediately: it caught **22** and **28**
silently-dropped functions on its first two production runs — deploys that
would previously have gone green with prod running stale code.

## Open items

### 1. GCIP upgrade — Jo's call, blocks two features

The only thing that makes blocking triggers work, and it turns on MFA at the
same time. Paid-tier product decision, not an ops task. `onRepSignup` is now the
sole `NBD_DEPLOY_SKIP_LIST` entry and GCIP is the only thing that clears it.
**If the answer is "not now", say so in the code comments** — the absence of a
recorded decision is what let the IAM misdiagnosis survive three years.

### 2. Cloud Run CPU quota increase — Jo action, drafted and ready

Full request kit, including paste-ready justification and the numbers behind
it: [CLOUD-RUN-CPU-QUOTA-REQUEST](../runbooks/CLOUD-RUN-CPU-QUOTA-REQUEST.md).
Ask 200,000 → 500,000. When it lands, set `NBD_DEPLOY_WAVE1_MAX` back to `"0"`.

### 3. Playwright installs are wedging — capped, not fixed

`Install Playwright chromium` hung **three times in one evening** across three
different jobs (`@shard1`, `visual-regression`, `visual-brand-tokens`). #1251's
timeouts bound the damage; they do not fix the cause. Likely candidates:
cache the browser binaries, or drop `--with-deps` (the `apt-get` half is what
hangs). **Confirm the pattern holds beyond 2026-08-17/18 before prescribing a
fix** — one bad evening may not be a trend.

Note when auditing: **four** jobs install Playwright, not three.
`visual-brand-tokens` does it via `npm run install:browsers`, which a grep for
`playwright install` misses. Match on the step name.

### 4. Un-diagnosable, recorded so nobody re-chases it

`recordingRetentionCron` was added to the deploy skip list 2026-04-15 blaming a
Cloud Scheduler IAM gap that had been fixed the day before. Whatever actually
broke it is **unrecoverable** — those logs are months past retention. If that
function misbehaves, there is no history to lean on.

## Gotchas banked this session

- **`gcloud functions list | grep -v ACTIVE` is the only way to find orphans.**
  A green deploy cannot see them and neither can completion accounting — both
  only cover functions that are in the `--only` list. An orphaned function is
  invisible to the pipeline by construction. Worth adding as a post-deploy
  sweep; not implemented.
- **`timeout-minutes` counts execution, not queue time** — runner starvation
  cannot trip the new CI caps.
- **`gh run view --log` returns nothing while a run is in progress**, and once
  complete it echoes the `run:` block source with ANSI colour. Filter
  `\033[36;1m` to get actual stdout.
- **Concurrency groups keep one running + one pending run.** A third queued run
  cancels the middle one — that is why some deploys this session show
  `cancelled` without anyone touching them.

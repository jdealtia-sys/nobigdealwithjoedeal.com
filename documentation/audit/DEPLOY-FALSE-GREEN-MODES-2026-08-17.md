# Deploy pipeline — the three false-green modes (2026-08-17)

**Scope:** the `Deploy Cloud Functions (strict …)` step in
[.github/workflows/firebase-deploy.yml](../../.github/workflows/firebase-deploy.yml).

A "false green" here means: the workflow run is GREEN, and one or more Cloud
Functions are running **older code than main**. This step has now produced
**three structurally distinct** versions of that, found weeks apart, each
invisible to the guard written for the previous one. This note inventories all
three in one place, because the pattern — not any single bug — is the finding.

**The pattern:** every guard so far has been written against *the shape of the
last failure* (a log string, an exit code). Both are things firebase-tools emits
**voluntarily**. A guard built on a voluntary signal cannot detect the case
where the tool says nothing at all. Mode 3 is that case, and the fix
(reconciliation against the requested set) is the first guard here that does not
depend on the CLI choosing to report a problem.

## The inventory

| # | Mode | Found | Signal that was missing | Guard |
|---|---|---|---|---|
| 1 | **Discovery-list drift** — the `--only` list never contained the function | 2026-08-17, PR #1210 | the function is absent from the deploy *request*; everything it does deploy succeeds | `onObjectFinalized` added to the wrapper alternation |
| 2 | **Wholesale failure** — deploy died before per-function rollout | 2026-08-10 audit | nonzero exit, but **zero** `Failed to …` lines to parse | nonzero exit + no parsed failures ⇒ fatal |
| 3 | **Quota-dropped update** — function targeted, started, never finished | 2026-08-17, run 32074172766 | **no line at all**: no success, no failure, exit 0 | completion accounting (this PR) |

Modes 1 and 2 are written up in
[SESSION-2026-08-17-deploy-list-drift-and-verification](../projects/SESSION-2026-08-17-deploy-list-drift-and-verification.md)
and [SITE-AUDIT-LOOSE-ENDS-2026-08-10](SITE-AUDIT-LOOSE-ENDS-2026-08-10.md)
respectively.

## Mode 3 — the 2026-08-17 quota-dropped update

**Run 32074172766** (repo `jdealtia-sys/nobigdealwithjoedeal.com`, commit
`ad78a3af`). Forensics are on the PR #1229 comment thread; the shape:

1. A change to `functions/.env.nobigdeal-pro` meant **all 167 functions needed
   updates in one pass**.
2. The mutation burst tripped the **`Per project mutation requests per minute`**
   quota (HTTP 429).
3. **~17 functions** — `healthDigestCron` among them — printed
   `functions: updating … function NAME(us-central1)...` and then **nothing**.
   No `Successful update operation`, no `Failed to update function NAME`.
4. firebase-tools exited **0**. The step printed `✓ All functions deployed`.

Both existing guards passed *correctly by their own logic*: there were no
`Failed to …` lines to parse (mode-2 guard needs a nonzero exit; exit was 0),
and the deploy list was complete (mode-1 guard). `healthDigestCron` was fixed by
hand afterwards with a targeted `--only` deploy.

### Why a function can vanish mid-deploy

Read from the firebase-tools source (`src/deploy/functions/release/`), v15 line
of development:

- `fabricator.ts` `applyPlan()` collects per-region changesets with
  `Promise.allSettled`, then reduces the results — and a **rejected** changeset
  is dropped with only a `logger.debug(…)`, i.e. **visible only under
  `--debug`**. Its endpoints contribute *no* results at all, so they are neither
  successes nor errors. With `summary.results` empty of errors, `hasFailures` is
  false, `printErrors` prints nothing, and the command exits 0.
- `logOpStart` ("updating…") fires in a synchronous loop *before* the operations
  run, which is why the dropped functions still announced themselves.

That path is a source-confirmed way to reach exactly the observed symptom. It is
**not** proven to be the specific path taken by run 32074172766 — the log was not
captured with `--debug`, and the reducer's `logger.debug` is the only trace it
would have left. **The fix deliberately does not depend on the mechanism**: it
asserts an outcome (every requested function reported a terminal result) rather
than pattern-matching a failure.

Related sharp edge found in the same source: `reporter.ts` defines **15**
`OperationType`s, and the error text is `Failed to ${op} function …`. Our parse
only matches `create|update`, so `Failed to upsert schedule function X`,
`Failed to set invoker function X`, `Failed to register blocking trigger
function X`, etc. are **not** matched. Those cases exit nonzero, so they were
never green — but they were misreported as "wholesale". Completion accounting now
catches them properly, because such a function gets no success line either.

## The fix

Per pass, reconcile the set of functions **asked for** against the set that
reported a **terminal** per-function line:

```
targeted   = names parsed out of the --only argument
accounted  = functions[NAME(region)] Successful (create|update) operation
           ∪ functions[NAME(region)] Skipped (No changes detected)
missing    = targeted − accounted
```

`missing` is appended to the same `FAILED_FILE` the CPU-quota straggler logic
already drains, so the existing batched-retry rounds pick it up unchanged, and a
gap surviving all rounds fails the job with the residual list.

Four details that are load-bearing and easy to break:

- **The reconciliation is exact, not heuristic.** firebase-tools skips unchanged
  functions (`planner.ts` `toSkipPredicate`) **only** when `!targetedByOnly` —
  "Don't skip the function if its `--only` targeted." We name every function
  explicitly (`--only functions:NAME,…`), so nothing here is skip-eligible and
  every target owes us a create/update line. The `Skipped` line is accepted as
  terminal anyway, so the guard stays correct if that ever changes.
- **ANSI must be stripped first.** colorette enables color when `CI` is in the
  environment — TTY or not — so every parsed line arrives wrapped in escapes in
  Actions. An unstripped parse matches nothing, which would make all 167 look
  missing and trigger a retry storm (a false RED, but still broken).
- **`Successful delete operation` must not count.** Orphan cleanup would
  otherwise paper over a missing update.
- **A wholesale failure short-circuits before accounting.** Otherwise an auth
  failure (nothing deployed ⇒ everything "missing") burns three batched
  re-deploys of all 167 functions before failing.

### On capping deploy concurrency

The root cause is the 167-simultaneous-mutation burst, so the obvious mitigation
is a concurrency cap. **firebase-tools has no such knob** — verified against the
source rather than assumed:

- `src/deploy/functions/release/index.ts` hardcodes the deploy queue at
  `concurrency: 40`; there is **no** `process.env` override anywhere in the
  release path.
- `src/commands/deploy.ts` defines six options — `--public`, `--message`,
  `--only`, `--except`, `--dry-run`, `--force`. No concurrency flag.

So the only lever we control is **how many functions one invocation is asked to
mutate**, which is also precisely what firebase-tools' own 429 handler
recommends ("please deploy your functions in batches by using the `--only`
flag", `reporter.ts` `printQuotaErrors`). Added as `NBD_DEPLOY_WAVE1_MAX`,
**default `0` = today's single bulk pass**: chunking costs a full re-package and
re-discovery per chunk (~1 min each) on *every* deploy, and the straggler
retries already drop to batches of 20 automatically when a burst goes wrong.
Set it to ~60 if the 429 mode recurs often enough to be worth paying up front.

The durable fix remains a **quota increase** (Cloud Run CPU for `us-central1`,
and the Cloud Functions per-project mutation rate).

## Verification

The step is shell embedded in YAML, so it was tested by extracting the real
`run:` block and running it against a stand-in `npx` that reproduces the CLI's
line shapes (ANSI included). 30 assertions across 8 scenarios, all passing:
clean deploy · mode 3 self-healing on retry · mode 3 persisting ⇒ job RED with
the residual named · wholesale still fatal and *not* retry-storming · classic
per-function failure still parsed and retried · delete lines not counting ·
`Skipped` counting · `NBD_DEPLOY_WAVE1_MAX` chunking while still targeting all
167.

Pinned in `tests/smoke/functions.test.js` §`F-10b` so all three guards have to
be deleted deliberately, not by accident.

### First production run — and the diagnostic bug it exposed

Run **32079768048** (merge of PR #1233) was the first deploy carrying this step.
It went green, correctly, and the log is worth reading precisely:

- wave 1: 167 `updating…` starts → **145** `Successful update operation`, **22**
  `Failed to update function …`
- 2 straggler-retry rounds → the 22 succeeded, **167/167** accounted for
- final line: `✓ All 167 targeted function(s) accounted for by a completion
  line (after 2 straggler-retry round(s))`

**Completion accounting caught nothing here that the old parse would have
missed.** All 22 announced themselves as failures; this was the ordinary
CPU-quota straggler mode, and the pre-existing parse would have retried them
identically. Mode 3 has not recurred since 32074172766.

It did expose a bug in the new code, though. `missing = targeted − accounted`
**also contains every function that reported a failure** — a failed function has
no success line either — so the step announced all 22 as *"printed NO completion
line (no success, no failure)"*, which was flatly untrue. Behavior was right
(they were retried either way); the **diagnosis** was wrong. On a step whose
entire purpose is telling failure modes apart, a warning that fires on the
~5-10% that fail loudly on every deploy would have been trained out as noise
within a week — and the one time it meant something, nobody would have looked.

Fixed by subtracting the parsed failures as well, so `MISSING` means only the
silent case: targeted, and no line of any kind. Two regression scenarios were
added to the harness (a reported failure must not be labeled unaccounted-for;
silent drops and reported failures in the same pass must be separated but both
retried), bringing it to **37 assertions across 9 scenarios**.

Lesson, and it rhymes with the rest of this note: the guard was verified against
*reproduced* failure shapes, and the shape it got wrong was the **common** one —
the ordinary straggler that shows up on almost every deploy and that no scenario
had asserted the absence of a warning for.

## Open items found alongside

- ~~**`beforeAdminSignIn` has been in state `FAILED` in prod since
  2026-08-11T01:32Z**~~ — **RESOLVED 2026-08-17**, and the hypothesis recorded
  here was wrong on both counts. Full investigation:
  [BLOCKING-TRIGGERS-NOT-GCIP-2026-08-17](BLOCKING-TRIGGERS-NOT-GCIP-2026-08-17.md)
  (lands with PR #1235, so the link resolves once both merge). Summary:
  - **Admin sign-in was never impaired.** The project's Identity Platform
    `blockingFunctions` config is `{}` — no blocker was ever registered, so
    there was no path from a sign-in to the failed function. It also had no
    backing Cloud Run service and is not in the source tree (it is a private
    `const`, not an `export`). Inert orphan from a 2026-04-14 registration
    attempt that was reverted 7 minutes later in `d8dee687`; the 2026-08-11
    timestamp is a control-plane state refresh with no API caller. Record
    deleted; the non-`ACTIVE` sweep is clean.
  - **"The strict step has been targeting it" was false.** The `--only` list is
    built by grepping `^exports\.NAME = <wrapper>`, and a private const never
    enters the candidate list — `NBD_DEPLOY_SKIP_LIST` is irrelevant to it.
    That is why six days of deploys said nothing, *not* the narrow failure
    parse. See the accounting caveat below.
  - **The real find was larger:** blocking triggers have never worked in this
    project at all. Every deploy's `identitytoolkit` `UpdateConfig` fails with
    `OPERATION_NOT_ALLOWED : Blocking Functions may only be configured for GCIP
    projects` (162 consecutive failures in 30 days) because `nobigdeal-pro` is
    subtype `FIREBASE_AUTH`. So `onRepSignup` is `ACTIVE` but has **never been
    invoked**, and the `roles/identityplatform.admin` story in the workflow and
    `auth.js` comments — which is also the stated reason `onRepSignup` sits on
    `NBD_DEPLOY_SKIP_LIST` — was a misdiagnosis. Corrected in place by #1235.
- **Completion accounting has a blind spot this episode exposed.** It verifies
  that every *targeted* function printed a terminal line, so it cannot see a
  function that is missing from the `--only` list in the first place — exactly
  the failure mode above, and the same shape as the `onObjectFinalized` drift
  in [SESSION-2026-08-17-deploy-list-drift-and-verification](../projects/SESSION-2026-08-17-deploy-list-drift-and-verification.md).
  Catching that class needs a state sweep
  (`gcloud functions list | grep -v ACTIVE`) as a post-deploy step, not
  deploy-log parsing. Not implemented here.
- The `--only` failure parse still misses 13 of the 15 `OperationType`s (above).
  Now benign for targeted functions, because completion accounting covers them,
  but a failure to *delete* an orphan still surfaces as "wholesale" rather than
  as what it is. Note `Failed to register blocking trigger function NAME` is one
  of the unmatched shapes — it did not bite here (nothing targeted the
  function), but it would if a blocking trigger were ever re-exported.

## Incident note — an accidental prod deploy during this work

While building the test harness, a `PATH` entry was written in Windows form
(`C:/…`). `:` is the PATH separator, so the entry split and the **real** `npx`
stayed first on the path: the harness ran `firebase-tools deploy --only
functions:…(×167) --project nobigdeal-pro --force` against **production** at
~22:42Z on 2026-08-17, and was killed by its 100s timeout mid-rollout.

Assessed blast radius:

- The uploaded source was **byte-identical to `origin/main`** (`git diff
  origin/main -- functions/` empty), so this redeployed the code prod already
  ran. No code change reached prod.
- **No deletes**: deletions are phase 2, after all upserts; the CLI never got
  there. `functions:list` confirms the full set still present.
- All 167 update operations were *issued* server-side and completed
  asynchronously after the CLI died (139 ACTIVE / 37 DEPLOYING when checked;
  the 1 FAILED is `beforeAdminSignIn`, dated 08-11 — pre-existing, above).

The harness now converts paths with `cygpath`, **proves** `npx` resolves inside
the fake bin before running, and points `PRO_PROJECT` at a nonexistent project so
a future leak cannot target prod.

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

The step is shell embedded in YAML, so nothing in the repo could execute it —
which is why two of the three modes were found by deploying to prod and noticing
afterwards. It now has a harness, **committed at
[tests/deploy-step/](../../tests/deploy-step/)** (PR #1254):

```bash
bash tests/deploy-step/run.sh    # 46 assertions, 11 scenarios, ~6s
```

It **extracts the real `run:` block** from the workflow rather than copying a
fixture — a fixture drifts silently, which is the same class of bug this step
exists to catch — and drives it against a stand-in `npx` reproducing the CLI's
line shapes, ANSI included. Wired into the `Unit suites (manifest)` CI job, so
it runs on every PR.

Two layers, and they catch different things. Neither substitutes for the other:

| | `tests/smoke/functions.test.js` §`F-10b` | `tests/deploy-step/` |
|---|---|---|
| checks | the guard strings **exist** | the guards **behave** |
| catches | a guard being deleted | a guard's logic being broken |

F-10b caught neither of the two bugs the harness caught (the `MISSING`
mislabeling below, and the chunked-drop case being untestable).

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
identically.

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

### Second production run — mode 3 recurred, and the guard caught it

Run **32080455395** (merge of PR #1235), the very next deploy. This is the one
that justifies the change, and it corrects a claim made an hour earlier in this
same note ("mode 3 has not recurred since 32074172766" — **wrong**, it recurred
within the hour):

- wave 1: 167 `updating…` starts → **139** `Successful update operation`,
  **0** `Failed to …` lines anywhere in the run
- **28 functions printed nothing at all** — no success, no failure
- firebase-tools exited **0**; the wholesale guard did not fire (it had no
  reason to — the exit code was clean)
- 1 straggler-retry round recovered all 28 → **167/167**, job green

**Under the pre-2026-08-17 logic this deploy goes GREEN with 28 functions
running stale code**, because there was nothing for the failure parse to find
and nothing for the wholesale guard to trip on. That is precisely mode 3, and it
is now confirmed as **recurring**, not a one-off: 32074172766 (~17 functions) and
32080455395 (28 functions), eight days apart in wall-clock but one deploy apart
in practice.

The 28 included `healthDigestCron` — the same function hand-fixed after the
original incident — plus `thumbtackWebhook` and `swathWebhook` (live lead
ingest), `sendEmail`, `submitSignature`, `onAudioUploaded`, `analyzeRoofPhoto`,
`createPortalToken`, and `weeklyDigest`. Not a tail of unimportant crons.

Note the two runs together are the complete argument for the #1238 fix: in
32079768048 every straggler was **loud** (22 failure lines) and the warning was
wrong; in 32080455395 every straggler was **silent** (0 failure lines) and the
warning was right. Only subtracting the parsed failures distinguishes them — and
without that distinction the true positive here would have been indistinguishable
from the false alarm one run earlier.

**`NBD_DEPLOY_WAVE1_MAX` raised 0 → 60** (Jo's call, 2026-08-17). The burst cap
was left off while the mode had been seen once; two occurrences in consecutive
deploys — 17 and 28 functions — changed that. The retries do recover, but every
occurrence is a window in which prod runs stale code, and the recovery depends
on a guard that is one regex away from breaking. 167 functions now deploy as
chunks of 60/60/47.

Two costs were accepted knowingly. **The first one turned out to be backwards**
— see the measurement below — and the second is still live:

- ~~**~2-3 min added to every deploy**~~ — **wrong; it is FASTER.** Kept here
  because the reasoning failed in an instructive way.
- **3 invocations instead of 1 triples the exposure to a wholesale failure.**
  A transient auth flake in any chunk is fatal by design. If deploys start
  going red on auth rather than on real problems, this is the cause, and
  setting the knob back to `0` restores the previous behavior. Unrealized so
  far (8 clean invocations across both chunked runs), but unproven.

### Measured: chunking is cheaper, not more expensive

Five consecutive deploys, same 167 functions, split cleanly on one variable —
strict-step wall clock:

| Run | Config | Stragglers | Strict step |
|---|---|---|---|
| 32079768048 | unchunked | 22 loud | 15m36s |
| 32080455395 | unchunked | **28 silent** | 13m44s |
| 32082377217 | unchunked | 24 loud | 16m07s |
| **32085658469** | **chunked 60** | **0** | **11m26s** |
| **32088029222** | **chunked 60** | **0** | **10m34s** |

Both chunked runs: `Deploying 167 function(s) in chunks of 60 (mutation-burst
cap)` → 167 `Successful update operation`, zero failure lines, zero silent
drops, **zero retry rounds** — the verdict line carried no `(after N
straggler-retry round(s))` suffix, which had never happened before the cap.

**Every unchunked run lost functions; neither chunked run lost any.**

**3-5½ min FASTER, not the 2-3 min slower first estimated here.** The estimate
missed because it counted the cost of chunking and ignored the cost of *not*
chunking: `NBD_DEPLOY_RETRY_PAUSE` is 45s, batch pauses are 20s, and every retry
round re-invokes the CLI anyway — so the retry machinery was itself the
expensive path. Not tripping the quota is cheaper than recovering from it. Three
clean chunks beat one burst plus two rounds of cleanup. Both chunked runs beat
all three unchunked ones, so the speed result reproduced too.

Caveat on how much this proves: **two observations** (was one when this section
was first written), and they are usefully independent — the first chunked run
followed three deploys that had been churning revisions, so its quota headroom
could be argued as incidental; the second ran from a different starting state
and came back identical. Against that, the mode was intermittent (22 / 28 / 24
stragglers across three consecutive unchunked runs, differing in kind as well as
count), and 2-for-2 is not proof. Read it as: the mechanism is well supported
and no longer a single lucky run, but mode 3 is not *proven* eliminated.
Completion accounting remains the detector if it returns.

The tripled wholesale-auth-flake exposure stayed unrealized across both chunked
runs — 8 clean CLI invocations. Unproven rather than disproven, and still the
first thing to suspect if a deploy goes red on auth.

The durable fix remains the quota increase, which would make the cap
unnecessary rather than merely tolerable.

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

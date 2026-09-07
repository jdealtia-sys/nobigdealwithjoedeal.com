# Deploy audit 2026-09-07 — one unparseable name took the whole retry down

**Lane:** CI / release engineering
**Trigger:** the production Cloud Functions deploy for #1445 failed wholesale
(run `34067976148`, 2026-09-06 23:49 UTC) and left four functions on stale code.
**Fix:** PR #1452.

---

## The one-sentence version

Nothing was wrong with the code being deployed: a transient GCP error made four
functions fail, the workflow's straggler parser misread their names, and the
retry it built was rejected outright — so the recovery path that exists to heal
exactly this failure is what turned it into a red deploy.

## What actually happened

Four functions failed to update with a transient Cloud Run 500:

> `Could not update Cloud Run service projects/nobigdeal-pro/locations/us-central1/services/getestimateforview.`
> `Unable to read due to concurrent lock contention.`

That is precisely the straggler class the strict step's retry rounds were built
for, and it should have healed on the next round. It did not, because
firebase-tools reports failures in **two different shapes** and the parser only
knew one:

```
Failed to update function onAiDraftApproved                                    ← the shape it knew
Failed to update function projects/nobigdeal-pro/locations/.../functions/getEstimateForView   ← the 500 path
```

The parse was:

```bash
grep -oE "Failed to (create|update) function [A-Za-z_][A-Za-z0-9_]*" | sed -E 's/.*function //'
```

`[A-Za-z0-9_]*` stops at the first `/`, so on the qualified form it captured the
literal string **`projects`**. The retry round then ran:

```
firebase deploy --only functions:getEstimateForView,...,functions:projects
```

and firebase rejected it:

```
Error: No function matches the filter: default:projects
```

**`--only` is all-or-nothing.** One name that does not resolve does not fail that
one target — it invalidates the entire filter. So the batch never ran, the step
exited nonzero, the wholesale guard fired ("nothing or almost nothing was
deployed"), and the four real stragglers were never retried. Production kept
serving the previous revision for those four until the next merge's deploy
healed them ~20 minutes later.

Worth being precise about the blast radius: an *update* that loses this race
leaves the prior revision serving, so nothing broke for a rep. The same failure
on a **create** leaves nothing at all — and this workflow's own comments record
that a create losing the quota race is how `backupFreshnessCron` silently did
not exist after a green "Deploy complete!".

## Why it survived until now

The qualified form only appears on the HTTP-500 Cloud Run path, which is rare.
Every previously-observed failure mode — CPU-quota healthcheck failures, the
mutation-rate 429 silent drops, the operation-poll timeouts — prints the bare
name, and each of those already has a dedicated parse and a comment block
explaining it. The parser had been extended three times for new shapes and was
correct for all of them.

## The fix (#1452)

**1. Read the name, not the first path segment.** Widen the class to accept `/`
and take the last segment, which is correct for both shapes:

```bash
grep -oE "Failed to (create|update) function [A-Za-z0-9_/-]+" | sed -E 's/.*function //; s#.*/##'
```

**2. A parse failure must not be able to poison a `--only`.** This is the part
worth keeping. The parser is a regex over human-facing output that
firebase-tools is free to reword; it has now been wrong four times, and it will
be wrong again. So names produced by the parse are validated against the
discovered function list before any of them reaches a `--only`. An unknown name
is dropped with a loud `::warning::` that says the parse needs updating, and
completion accounting still catches the real straggler through the silent path.

The failure mode degrades from *"the entire retry cannot run"* to *"we logged
that we could not name one straggler"*.

**3. Wholesale still means wholesale.** The guard now requires that there were
no per-function failure lines *at all*, rather than none that survived
validation — otherwise a future parse gap would skip completion accounting and
lose the stragglers it was meant to catch.

## Gate

`tests/deploy-failure-parse.test.js` — **new**, node bucket, 13 assertions. It
extracts the real `_deploy_only` function out of the workflow YAML and runs it
in bash against captured firebase output, with `npx` stubbed. Extracting the
real thing matters: a copied-out regex in the test would drift from the one that
actually runs, and the drift would be invisible.

Proven able to fail — three regressions, each reddening its own assertions:

| regression | reddens |
|---|---|
| restore the old character class | *"read from the failure line itself, not rescued by accounting"* + the parser-warning assertion |
| remove the unknown-name validation | *"a name that is not a discovered function is dropped from the retry"* |
| let a failed validation count as wholesale | *"the real straggler is still caught"* + *"this is NOT reported as a wholesale failure"* |

### Two false greens caught while writing it

Both are recorded because the pattern keeps recurring.

1. The headline assertion — *"NOT the literal `projects`"* — **could not fail.**
   With the old parser the bogus name is dropped by fix 2, and the two real
   names still reach the retry list through completion accounting, so the
   observable result is identical either way. Isolating the parser needed a
   different signal: whether the names arrived *parsed* or were *rescued*
   (`MISSING` is empty in the first case, populated in the second).
2. The *"no parser warning"* assertion could not fail either — `::warning::`
   goes to **stdout**, and the harness was capturing only stderr.

## Still open

- ~~The `Enable required Google APIs` step is decorative.~~ **Wrong — corrected
  2026-09-07.** That claim was made from the `ERROR: (gcloud.services.enable)
  ... Permission denied` line without reading the step. The step already knows
  the SA lacks `roles/serviceusage.serviceUsageAdmin` (a 2026-08-17 pass),
  ignores the exit code, and **asserts the end state instead** — the same run
  printed `✓ All 7 required APIs already enabled` two lines later. It worked.

  This is the failure the step’s own comment predicted: *“that false alarm sat
  in the log long enough to be mistaken for the cause of a real incident.”*
  It was, by me, while triaging the genuinely failed deploy in the same run.

  What was real is smaller, and is fixed in the follow-up PR that added this
  correction: gcloud’s failure text was
  still **streamed** on every healthy deploy, so a red-looking ERROR sat two
  lines above a ✓. It is now captured and printed only where it is evidence —
  when the end-state check finds an API genuinely off, or cannot read the list.
  Gated by `tests/deploy-api-enable-step.test.js`, which extracts the real step
  body and runs it against a stubbed gcloud.
- The root transient itself (`concurrent lock contention`) is a GCP-side 500 and
  is not fixable here. The retry rounds are the mitigation; this PR is about
  making them able to run.

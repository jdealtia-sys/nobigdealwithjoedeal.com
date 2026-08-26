# `tests/deploy-step` — behavioral tests for the strict functions-deploy step

```bash
bash tests/deploy-step/run.sh
```

No dependencies, no network, no credentials. Runs in seconds.

## What this covers, and why it isn't the smoke suite

The step under test is the `Deploy Cloud Functions (strict …)` block in
[.github/workflows/firebase-deploy.yml](../../.github/workflows/firebase-deploy.yml).
It is ~150 lines of shell embedded in YAML, and it is the only thing standing
between a Google-side quota hiccup and production silently running stale code.

Three structurally different **false-green** modes have shipped from that step —
runs that went green while functions ran older code than `main`. The full
inventory is in
[DEPLOY-FALSE-GREEN-MODES-2026-08-17](../../documentation/audit/DEPLOY-FALSE-GREEN-MODES-2026-08-17.md).
Two of the three were discovered *by deploying to production and noticing
afterwards*, which is the worst available test method and the reason this
harness exists.

`tests/smoke/functions.test.js` §`F-10b` already pins that the guards' **text**
is present. That is worth having, but it is not the same thing: it caught
neither of the two real bugs this harness caught.

| | smoke §F-10b | this harness |
|---|---|---|
| checks | the guard strings exist | the guard actually behaves |
| catches | someone deleting a guard | someone breaking a guard's logic |

## How it works

`run.sh` **extracts the real `run:` block** from the workflow (via
`extract-step.js`) and executes it against `fake-bin/npx`, a stand-in that
reproduces firebase-tools' actual line shapes — ANSI escapes included, because
colorette colorizes whenever `CI` is set and the step must strip them before
parsing.

Extraction rather than a copied fixture is deliberate: a fixture drifts from the
workflow silently, which is the same class of bug the step exists to catch. If
the step is renamed or its indentation changes, extraction fails loudly.

## Scenarios

| # | Scenario | Asserts |
|---|---|---|
| 1 | clean deploy | green, single pass, no false stragglers |
| 2 | quota-drop mode, self-heals | gap detected, named, retried with only the stragglers |
| 3 | gap persists all rounds | job RED, residual named, summary reports the knob as OFF |
| 3b | same, cap already ON | summary cites the **live** knob value, not stale advice |
| 4 | wholesale failure | fatal, and does **not** retry-storm all 167 |
| 5 | ordinary reported failure | parsed + retried, **not** labeled a silent drop |
| 6 | `Successful delete operation` | never accounts for a targeted function |
| 7 | `Skipped (No changes detected)` | counts as terminal |
| 8 | `NBD_DEPLOY_WAVE1_MAX` | chunks wave 1, still targets everything |
| 9 | silent + reported in one pass | diagnosed separately, both retried |
| 10 | prod config: chunked + silent drop | drop still detected across chunks |

Cases 5, 9 and 10 are regressions from bugs that reached `main`:

- **5 and 9** — `missing = targeted − accounted` also contains every function
  that *reported* a failure, so the first production run announced 22 ordinary
  stragglers as *"printed NO completion line (no success, no failure)"*. Retry
  behavior was right; the diagnosis was wrong, and a warning that fires on the
  common loud failure gets trained out as noise. Every scenario had asserted
  that the right things **appear**; none asserted a warning was **absent**.
- **10** — the fake's "heal on retry" originally keyed on invocation count, so
  with a chunked wave 1 the 2nd and 3rd chunks counted as retries and healed,
  making the chunked-plus-drop case silently untestable. It now keys on batch
  size, which actually separates a wave-1 chunk (47-60) from a retry batch (≤20).

## Safety

An earlier version of this harness put a Windows-style `C:/…` path on `PATH`.
`:` is the PATH separator, so the entry split, the **real** `npx` stayed first,
and the harness fired an actual deploy against `nobigdeal-pro`.

Two guards now, and neither should be removed:

1. `run.sh` **proves** `npx` resolves inside `fake-bin` before running anything.
2. `PRO_PROJECT` is set to a nonexistent project, so even a defeated guard 1
   cannot reach production.

## When you change the deploy step

Run this. If you add a guard, add a scenario — and assert both that it fires
when it should **and that it stays silent when it shouldn't**. The second half
is what was missing the first time.

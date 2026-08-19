# Next session — 2026-08-18

Previous: [NEXT_SESSION-2026-08-17](NEXT_SESSION-2026-08-17.md).

This handoff covers one lane: **the deploy pipeline's third false-green mode**,
found, fixed, and verified in production overnight. Full technical writeup lives
in [DEPLOY-FALSE-GREEN-MODES-2026-08-17](../audit/DEPLOY-FALSE-GREEN-MODES-2026-08-17.md)
— read that first if you are touching the deploy step. This note is the state
of play and the open decisions.

## What shipped

| PR | What |
|---|---|
| #1233 | Completion accounting — reconcile functions *asked for* against functions that reported a terminal line |
| #1238 | `MISSING` means **silent** only; a reported failure is an ordinary straggler |
| #1243 | `NBD_DEPLOY_WAVE1_MAX` 0 → 60 (chunks of 60/60/47) |
| #1246 | Failure summary reports the **live** knob value, not fixed advice |
| #1249, #1252 | Measurements: chunking is faster, and the second clean run |
| #1254 | The verification harness, committed at `tests/deploy-step/` + wired into CI |

Also resolved in a parallel session: **#1235** — `beforeAdminSignIn` was an inert
orphan, and blocking auth triggers are GCIP-only. See
[BLOCKING-TRIGGERS-NOT-GCIP-2026-08-17](../audit/BLOCKING-TRIGGERS-NOT-GCIP-2026-08-17.md).

## State of the deploy pipeline

Five consecutive deploys, same 167 functions, split cleanly on one variable:

| Run | Config | Stragglers | Strict step |
|---|---|---|---|
| 32079768048 | unchunked | 22 loud | 15m36s |
| 32080455395 | unchunked | **28 silent** | 13m44s |
| 32082377217 | unchunked | 24 loud | 16m07s |
| 32085658469 | chunked 60 | **0** | 11m26s |
| 32088029222 | chunked 60 | **0** | 10m34s |

Every unchunked run lost functions; neither chunked run lost any — and chunking
is 3-5½ min **faster**, because the retry machinery it avoids (45s round pauses,
20s batch pauses, a fresh CLI invocation per round) cost more than the extra
chunks do.

**Do not "optimize" `NBD_DEPLOY_WAVE1_MAX` back to `0`** on the intuition that
one bulk pass must be faster. It measurably isn't.

## Open decisions for Jo

1. **Quota increase** — the durable fix, and still not requested. Everything
   above is compensation for two Google-side limits: Cloud Functions
   *per-project mutation requests per minute*, and Cloud Run CPU for
   `us-central1`. Raising them makes the burst cap unnecessary rather than
   merely effective.
2. **GCIP upgrade — yes or no?** Blocking auth triggers and MFA are both
   GCIP-only; `nobigdeal-pro` is subtype `FIREBASE_AUTH`. Consequence today:
   `onRepSignup` has never fired, and the claim-minting callables are the only
   live path (working, but not the designed one). Paid-tier product decision.
   If the answer is "not now", say so in the comments so the next session does
   not re-derive it — this misdiagnosis has already cost two sessions.

## Watch items (not problems yet)

- **Tripled wholesale-auth exposure.** Chunking means 3 CLI invocations, and a
  transient auth flake in any one is fatal by design. Unrealized so far (8 clean
  invocations across both chunked runs). If deploys start going red on *auth*
  rather than on real problems, that is this tradeoff — set the knob to `0`.
- **Only 2 of 15 firebase-tools `OperationType`s are parsed.** `Failed to
  register blocking trigger function X`, `Failed to upsert schedule function X`
  etc. are not matched. Benign for targeted functions (completion accounting
  covers them), but a failed orphan *delete* still surfaces as "wholesale".
- **Two chunked observations, not proof.** The mode was intermittent. If it
  returns, completion accounting is the detector, and chunk size 40 is the next
  step down.

## If you touch the deploy step

```bash
bash tests/deploy-step/run.sh
```

46 assertions, 11 scenarios, ~6s, no deps or credentials. It extracts the real
`run:` block — so it fails loudly if the step is renamed or re-indented rather
than drifting silently. **Add a scenario for any guard you add, and assert both
that it fires when it should and that it stays silent when it shouldn't.** The
second half is what was missing the first time, and it is how a warning that
fired on every ordinary deploy reached `main`.

Do not remove either safety guard in `run.sh` (npx-resolution proof;
`PRO_PROJECT` pointed at a nonexistent project). An earlier version of that
harness put a Windows-style `C:/…` path on `PATH`, the `:` split it, the real
`npx` stayed first, and it fired an actual deploy at `nobigdeal-pro`.

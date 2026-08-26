#!/usr/bin/env bash
# Behavioral tests for the strict Cloud Functions deploy step in
# .github/workflows/firebase-deploy.yml.
#
#   bash tests/deploy-step/run.sh
#
# WHY THIS EXISTS. That step is shell embedded in YAML, and it is the only thing
# standing between a quota hiccup and prod silently running stale code. Three
# separate false-green modes have shipped from it (see
# documentation/audit/DEPLOY-FALSE-GREEN-MODES-2026-08-17.md). Its guards cannot
# be verified by reading, and "deploy to prod and see" is how two of the three
# were found. So: extract the REAL run: block and run it against a stand-in
# firebase-tools that reproduces each failure shape.
#
# The smoke suite (tests/smoke/functions.test.js §F-10b) pins that the guards'
# text is PRESENT. This pins that they BEHAVE. Both matter — F-10b caught none of
# the two bugs this harness caught.
#
# SAFETY. Two hard guards, because an earlier version of this harness put a
# Windows-style path on PATH, the ':' split it, the REAL npx stayed first, and it
# fired an actual deploy at nobigdeal-pro:
#   1. prove npx resolves inside fake-bin before running anything;
#   2. point PRO_PROJECT at a nonexistent project, so a future leak cannot reach
#      production even if guard 1 is defeated.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
WF="$REPO/.github/workflows/firebase-deploy.yml"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# The exec bit does not survive every checkout (core.filemode=false on Windows).
chmod +x "$HERE/fake-bin/npx" 2>/dev/null || true

export PATH="$HERE/fake-bin:$PATH"
RESOLVED=$(command -v npx || true)
if [ "$RESOLVED" != "$HERE/fake-bin/npx" ]; then
  echo "ABORT: npx resolves to '$RESOLVED', not the harness shim." >&2
  echo "       Refusing to run — this is the guard that stops a real deploy." >&2
  exit 1
fi
export PRO_PROJECT="harness-not-a-real-project"

# Match the workflow's env, except the pauses (zeroed so the suite runs in
# seconds rather than minutes).
export NBD_DEPLOY_SKIP_LIST="onRepSignup"
export NBD_DEPLOY_RETRY_ROUNDS="3"
export NBD_DEPLOY_RETRY_PAUSE="0"
export NBD_DEPLOY_BATCH_SIZE="20"
export NBD_DEPLOY_BATCH_PAUSE="0"
export CI=true

node "$HERE/extract-step.js" "$WF" "$WORK/strict-step.sh" || exit 1

pass=0; fail=0
check() { # check <label> <0-if-ok>
  if [ "$2" = "0" ]; then echo "  PASS  $1"; pass=$((pass+1));
  else echo "  FAIL  $1"; fail=$((fail+1)); fi
}

RC=0; CALLS=0; TOTAL=0
run_case() { # run_case <mode> <drop-names> [wave1max]
  export FAKE_MODE="$1"; export DROP_NAMES="$2"
  export NBD_DEPLOY_WAVE1_MAX="${3:-0}"
  export CALLS_FILE="$WORK/calls.txt";     : > "$CALLS_FILE"
  export TARGETS_LOG="$WORK/targets.txt";  : > "$TARGETS_LOG"
  export GITHUB_STEP_SUMMARY="$WORK/summary.md"; : > "$GITHUB_STEP_SUMMARY"
  ( cd "$REPO" && bash "$WORK/strict-step.sh" ) > "$WORK/out.txt" 2>&1
  RC=$?
  CALLS=$(cat "$CALLS_FILE")
}

echo "── case 1: clean deploy (all targets report success) ──"
run_case ok ""
check "exit 0" "$([ $RC -eq 0 ] && echo 0 || echo 1)"
check "one bulk pass only (no retry rounds)" "$([ "$CALLS" = "1" ] && echo 0 || echo 1)"
check "reports accounted-for count" "$(grep -q 'targeted function(s) accounted for' "$WORK/out.txt" && echo 0 || echo 1)"
check "no unaccounted warning" "$(grep -q 'unaccounted-for:' "$WORK/out.txt" && echo 1 || echo 0)"
TOTAL=$(grep -oE 'Deploying [0-9]+ function' "$WORK/out.txt" | grep -oE '[0-9]+')
echo "      (discovered $TOTAL functions)"

echo "── case 2: THE QUOTA-DROP MODE — 3 targets silent, exit 0, self-heals on retry ──"
run_case drop "healthDigestCron onPhotoUploaded stripeWebhook"
check "exit 0 after the straggler retry fixed them" "$([ $RC -eq 0 ] && echo 0 || echo 1)"
check "detected the gap (warned)" "$(grep -q 'printed NO completion line' "$WORK/out.txt" && echo 0 || echo 1)"
check "named healthDigestCron as unaccounted-for" "$(grep -q 'unaccounted-for: healthDigestCron' "$WORK/out.txt" && echo 0 || echo 1)"
check "named all 3" "$([ "$(grep -c 'unaccounted-for:' "$WORK/out.txt")" = "3" ] && echo 0 || echo 1)"
check "exactly 2 CLI calls (bulk + one retry)" "$([ "$CALLS" = "2" ] && echo 0 || echo 1)"
check "the retry targeted ONLY the 3 stragglers" \
  "$([ "$(tail -3 "$WORK/targets.txt" | sort | paste -sd, -)" = "healthDigestCron,onPhotoUploaded,stripeWebhook" ] && echo 0 || echo 1)"

echo "── case 3: gap PERSISTS through every retry round -> job must go RED ──"
run_case persistdrop "healthDigestCron onPhotoUploaded"
check "exit 1" "$([ $RC -eq 1 ] && echo 0 || echo 1)"
check "error annotation emitted" "$(grep -q '::error::Cloud Functions still failing' "$WORK/out.txt" && echo 0 || echo 1)"
check "summary explains the quota-dropped mode" "$(grep -q 'quota-dropped update' "$WORK/summary.md" && echo 0 || echo 1)"
check "summary lists healthDigestCron" "$(grep -q '^  - healthDigestCron' "$WORK/summary.md" && echo 0 || echo 1)"
check "summary gives a copy-pasteable manual deploy" "$(grep -q 'functions:healthDigestCron' "$WORK/summary.md" && echo 0 || echo 1)"
check "ran all 3 retry rounds" "$([ "$CALLS" = "4" ] && echo 0 || echo 1)"
# The summary must report the LIVE knob, not hardcoded advice that goes stale
# the moment the knob changes (it did, the day it was set to 60).
check "summary reports the knob as OFF when it is 0" \
  "$(grep -q 'Wave 1 is NOT chunked' "$WORK/summary.md" && echo 0 || echo 1)"
check "…and does not tell the operator to set it to a value it already has" \
  "$(grep -q 'Wave 1 was ALREADY chunked' "$WORK/summary.md" && echo 1 || echo 0)"

echo "── case 3b: same failure, but with the cap already ON (60) ──"
run_case persistdrop "healthDigestCron onPhotoUploaded" 60
check "exit 1" "$([ $RC -eq 1 ] && echo 0 || echo 1)"
check "summary says the cap was already on, at its live value" \
  "$(grep -q 'NBD_DEPLOY_WAVE1_MAX` = 60' "$WORK/summary.md" && echo 0 || echo 1)"
check "…and does not repeat the now-wrong 'set it to 60' advice" \
  "$(grep -q 'Set it to ~60' "$WORK/summary.md" && echo 1 || echo 0)"

echo "── case 4: wholesale failure (exit 1, no per-function lines) fatal, NO retry storm ──"
run_case wholesale ""
check "exit 1" "$([ $RC -eq 1 ] && echo 0 || echo 1)"
check "wholesale error annotation" "$(grep -q 'failed WHOLESALE' "$WORK/out.txt" && echo 0 || echo 1)"
check "did NOT burn retry rounds" "$([ "$CALLS" = "1" ] && echo 0 || echo 1)"

echo "── case 5: classic per-function failure still parsed + retried ──"
run_case parsefail "healthDigestCron"
check "exit 0 once the retry succeeds" "$([ $RC -eq 0 ] && echo 0 || echo 1)"
check "retried" "$([ "$CALLS" -gt 1 ] && echo 0 || echo 1)"
check "not misreported as wholesale" "$(grep -q 'WHOLESALE' "$WORK/out.txt" && echo 1 || echo 0)"
# Regression: run 32079768048 announced all 22 REPORTED failures as "printed NO
# completion line". A reported failure is an ordinary straggler, not the silent
# drop mode — mislabeling it makes the warning meaningless on a normal deploy.
check "a REPORTED failure is not labeled unaccounted-for" \
  "$(grep -q 'unaccounted-for: healthDigestCron' "$WORK/out.txt" && echo 1 || echo 0)"
check "…and no silent-drop warning fires at all" \
  "$(grep -q 'printed NO completion line' "$WORK/out.txt" && echo 1 || echo 0)"

echo "── case 6: 'Successful delete operation' must NOT account for a target ──"
run_case deleteonly ""
check "exit 1 (deletes don't count as deploys)" "$([ $RC -eq 1 ] && echo 0 || echo 1)"

echo "── case 7: Skipped (No changes detected) IS terminal ──"
run_case skipall ""
check "exit 0" "$([ $RC -eq 0 ] && echo 0 || echo 1)"
check "no false stragglers" "$(grep -q 'unaccounted-for:' "$WORK/out.txt" && echo 1 || echo 0)"

echo "── case 8: NBD_DEPLOY_WAVE1_MAX chunks wave 1 ──"
run_case ok "" 60
check "exit 0" "$([ $RC -eq 0 ] && echo 0 || echo 1)"
check "chunked into multiple CLI calls" "$([ "$CALLS" -gt 1 ] && echo 0 || echo 1)"
check "announced the burst cap" "$(grep -q 'mutation-burst cap' "$WORK/out.txt" && echo 0 || echo 1)"
check "every discovered function still targeted" "$([ "$(sort -u "$WORK/targets.txt" | grep -c .)" = "$TOTAL" ] && echo 0 || echo 1)"

echo "── case 9: silent drops AND reported failures in ONE pass must not be conflated ──"
export FAIL_NAMES="stripeWebhook trackUsage"
run_case mixed "healthDigestCron onPhotoUploaded"
check "exit 0 once round 2 fixes both kinds" "$([ $RC -eq 0 ] && echo 0 || echo 1)"
check "the 2 SILENT ones are named unaccounted-for" \
  "$([ "$(grep -c 'unaccounted-for:' "$WORK/out.txt")" = "2" ] && echo 0 || echo 1)"
check "silent list = exactly the dropped pair" \
  "$(grep -q 'unaccounted-for: healthDigestCron' "$WORK/out.txt" && grep -q 'unaccounted-for: onPhotoUploaded' "$WORK/out.txt" && echo 0 || echo 1)"
check "the REPORTED pair is excluded from the silent list" \
  "$(grep -qE 'unaccounted-for: (stripeWebhook|trackUsage)' "$WORK/out.txt" && echo 1 || echo 0)"
check "but all 4 are retried as stragglers" \
  "$([ "$(grep -c 'straggler:' "$WORK/out.txt")" = "4" ] && echo 0 || echo 1)"
unset FAIL_NAMES

echo "── case 10: THE PROD CONFIG — chunked wave 1 (60) with a silent drop ──"
run_case drop "healthDigestCron onPhotoUploaded stripeWebhook" 60
check "exit 0 after the straggler retry" "$([ $RC -eq 0 ] && echo 0 || echo 1)"
check "chunking still announced" "$(grep -q 'mutation-burst cap' "$WORK/out.txt" && echo 0 || echo 1)"
check "silent drop still detected across chunks" \
  "$(grep -q 'printed NO completion line' "$WORK/out.txt" && echo 0 || echo 1)"
check "all 3 named" "$([ "$(grep -c 'unaccounted-for:' "$WORK/out.txt")" = "3" ] && echo 0 || echo 1)"
check "every discovered function still targeted" \
  "$([ "$(sort -u "$WORK/targets.txt" | grep -c .)" = "$TOTAL" ] && echo 0 || echo 1)"

echo ""
echo "═══ $pass passed, $fail failed ═══"
[ "$fail" -eq 0 ]

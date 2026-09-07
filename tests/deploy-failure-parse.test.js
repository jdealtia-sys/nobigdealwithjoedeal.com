/**
 * deploy-failure-parse.test.js — the deploy's straggler parser, run for real.
 *
 * WHY THIS EXISTS
 *
 * On 2026-09-06 a production Cloud Functions deploy failed WHOLESALE and left
 * four functions on stale code (run 34067976148, merge #1445). Nothing was
 * wrong with the code being deployed. firebase-tools reported its per-function
 * failures in a shape the workflow's parser did not expect:
 *
 *   Failed to update function projects/nobigdeal-pro/locations/us-central1/functions/getEstimateForView
 *
 * — the fully-qualified resource name, which it uses when the Cloud Run update
 * comes back HTTP 500 ("Unable to read due to concurrent lock contention").
 * The parser's character class stopped at the first `/`, so it extracted the
 * literal string `projects` as a function name. The retry round then ran
 * `--only functions:projects`, firebase rejected the WHOLE filter with "No
 * function matches the filter: default:projects", and every real straggler in
 * that batch went unretried.
 *
 * The parser is a regex over human-facing output that firebase-tools is free
 * to reword, so it will fall behind again. This suite runs the REAL
 * `_deploy_only` function — extracted from the workflow file itself, not a
 * copy — against captured output in both shapes, and pins the invariant that
 * matters more than any single shape: **a name the parser cannot resolve must
 * never reach a `--only`.**
 *
 * Run: node tests/deploy-failure-parse.test.js   (needs bash; no deps)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

const ROOT = path.join(__dirname, '..');
const WF = path.join(ROOT, '.github/workflows/firebase-deploy.yml');
const yml = fs.readFileSync(WF, 'utf8').replace(/\r\n/g, '\n');

/**
 * Pull `_deploy_only()` out of the workflow and dedent it. Extracting the real
 * thing is the whole point: a copied-out regex in this file would drift from
 * the one that actually runs, and the drift would be invisible.
 */
function extractShellFn(name) {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l.trim().startsWith(name + '() {'));
  if (start < 0) return null;
  const indent = lines[start].match(/^(\s*)/)[1];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === indent + '}') {
      return lines.slice(start, i + 1).map((l) => l.slice(indent.length)).join('\n');
    }
  }
  return null;
}

const fn = extractShellFn('_deploy_only');
ok('_deploy_only is extractable from the workflow', !!fn,
  'the test must run the REAL parser, not a copy of it');

if (!fn) {
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(1);
}

// The real function names this deploy would have discovered. Anything the
// parser emits outside this set is, by definition, not deployable.
const ALL = [
  'getEstimateForView', 'incomingSMS', 'getSwathUsage', 'getHailHistory',
  'onAiDraftApproved', 'claudeProxy', 'stripeWebhook'
];

/**
 * Run the extracted function against a canned firebase-tools output.
 * `npx` is replaced by a stub so nothing touches the network.
 */
function runDeployOnly(out, rc, targets) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbd-deploy-parse-'));
  const outFile = path.join(dir, 'out.txt');
  fs.writeFileSync(outFile, out);
  fs.writeFileSync(path.join(dir, 'all.txt'), ALL.join('\n') + '\n');

  const harness = `
set +e
ESC=$(printf '\\033')
_strip_ansi() { sed -E "s/\${ESC}\\[[0-9;]*[a-zA-Z]//g"; }
# Stub the deploy: emit the fixture, return the fixture's exit code.
npx() { cat "${outFile.replace(/\\/g, '/')}"; return ${rc}; }
FAILED_FILE=$(mktemp); WHOLESALE_FILE=$(mktemp); MISSING_FILE=$(mktemp)
ACCOUNTED_FILE=$(mktemp); PARSED_FILE=$(mktemp)
ALL_FILE="${path.join(dir, 'all.txt').replace(/\\/g, '/')}"
PRO_PROJECT=nobigdeal-pro

${fn}

# Both streams: ::warning:: annotations are written to STDOUT, so capturing
# only stderr here made the "no warning" assertion unable to fail.
_deploy_only "${targets}" > "${path.join(dir, 'warn.txt').replace(/\\/g, '/')}" 2>&1
echo "---FAILED---";    sort -u "$FAILED_FILE"
echo "---MISSING---";   sort -u "$MISSING_FILE"
echo "---WHOLESALE---"; cat "$WHOLESALE_FILE"
echo "---WARN---";      cat "${path.join(dir, 'warn.txt').replace(/\\/g, '/')}"
`;
  const script = path.join(dir, 'run.sh');
  fs.writeFileSync(script, harness);
  const res = execFileSync('bash', [script], { encoding: 'utf8' });
  const cut = (a, b) => res.split(a)[1].split(b)[0];
  const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  return {
    failed: lines(cut('---FAILED---', '---MISSING---')),
    // MISSING = "targeted, but printed no line of ANY kind". A failure the
    // parser RESOLVED lands in FAILED via the parse and is explicitly
    // subtracted from MISSING — so MISSING is the discriminator between
    // "we read the failure line" and "we could not, and completion
    // accounting rescued it". FAILED alone cannot tell those apart.
    missing: lines(cut('---MISSING---', '---WHOLESALE---')),
    wholesale: cut('---WHOLESALE---', '---WARN---').trim(),
    // Only our own guard's annotation, not the echoed firebase fixture.
    warn: lines(res.split('---WARN---')[1] || '')
      .filter((l) => l.includes('::warning::') && l.includes('not deployable functions'))
      .join('\n')
  };
}

const ANSI = '[33m[1m';

(function run() {
  console.log('\ndeploy-failure-parse — the straggler parser, on real output\n');

  // ── THE 2026-09-06 SHAPE ───────────────────────────────────────────────
  {
    const out = [
      `${ANSI}⚠  functions:[22m[39m Request to https://cloudfunctions.googleapis.com/v2/projects/nobigdeal-pro/locations/us-central1/functions/getEstimateForView?updateMask=name had HTTP Error: 500, Could not update Cloud Run service projects/nobigdeal-pro/locations/us-central1/services/getestimateforview. Unable to read due to concurrent lock contention.`,
      'Failed to update function projects/nobigdeal-pro/locations/us-central1/functions/getEstimateForView',
      'Failed to update function projects/nobigdeal-pro/locations/us-central1/functions/incomingSMS',
      'functions[claudeProxy(us-central1)] Successful update operation.',
      'functions[stripeWebhook(us-central1)] Skipped (No changes detected)'
    ].join('\n');
    const r = runDeployOnly(out, 1,
      'functions:getEstimateForView,functions:incomingSMS,functions:claudeProxy,functions:stripeWebhook');

    ok('a fully-qualified failure resolves to the real function name',
      r.failed.includes('getEstimateForView') && r.failed.includes('incomingSMS'),
      'FAILED=' + JSON.stringify(r.failed));
    ok('...and NOT to the literal "projects"',
      !r.failed.includes('projects'),
      'FAILED=' + JSON.stringify(r.failed)
      + ' — "functions:projects" makes firebase reject the entire retry filter');
    // These two isolate the PARSER. The assertions above cannot: with the old
    // parser the bogus "projects" is dropped by the validation guard, and the
    // two real names still reach FAILED through completion accounting — so
    // FAILED looks identical either way. What differs is HOW they got there.
    ok('...read from the failure line itself, not rescued by accounting',
      r.missing.length === 0,
      'MISSING=' + JSON.stringify(r.missing)
      + ' — a name in MISSING was never parsed; it is reported as "printed NO'
      + ' completion line", which is the crying-wolf diagnosis this step exists to avoid');
    ok('...with no "parser produced a non-function" warning',
      r.warn === '',
      'warn=' + JSON.stringify(r.warn)
      + ' — the guard firing here means the parse failed and was papered over');
    ok('...so the retry list contains only deployable names',
      r.failed.every((n) => ALL.includes(n)), 'FAILED=' + JSON.stringify(r.failed));
    ok('...and successfully-deployed functions are not retried',
      !r.failed.includes('claudeProxy') && !r.failed.includes('stripeWebhook'),
      'FAILED=' + JSON.stringify(r.failed));
  }

  // ── the plain shape still works ────────────────────────────────────────
  {
    const out = [
      'Failed to update function onAiDraftApproved',
      'functions[claudeProxy(us-central1)] Successful update operation.'
    ].join('\n');
    const r = runDeployOnly(out, 1, 'functions:onAiDraftApproved,functions:claudeProxy');
    ok('the bare failure shape is unchanged',
      r.failed.length === 1 && r.failed[0] === 'onAiDraftApproved',
      'FAILED=' + JSON.stringify(r.failed));
  }

  // ── the trailing summary block still works ────────────────────────────
  {
    const out = [
      'functions[claudeProxy(us-central1)] Successful update operation.',
      'Functions deploy had errors with the following functions:',
      '\tonAiDraftApproved(us-central1)',
      'To try redeploying those functions, run:'
    ].join('\n');
    const r = runDeployOnly(out, 1, 'functions:onAiDraftApproved,functions:claudeProxy');
    ok('the summary-block shape is unchanged',
      r.failed.includes('onAiDraftApproved'), 'FAILED=' + JSON.stringify(r.failed));
  }

  // ── THE INVARIANT: an unresolvable name never reaches --only ───────────
  {
    // A message shape nobody has seen yet. The parse yields something that is
    // not a function; it must be dropped rather than poisoning the batch.
    const out = [
      'Failed to update function some_future_wrapper_shape',
      'functions[claudeProxy(us-central1)] Successful update operation.'
    ].join('\n');
    const r = runDeployOnly(out, 1, 'functions:getEstimateForView,functions:claudeProxy');
    ok('a name that is not a discovered function is dropped from the retry',
      !r.failed.includes('some_future_wrapper_shape'),
      'FAILED=' + JSON.stringify(r.failed)
      + ' — one bad name makes firebase reject the whole --only, losing every real straggler with it');
    ok('...and the real straggler is still caught, via completion accounting',
      r.failed.includes('getEstimateForView'),
      'FAILED=' + JSON.stringify(r.failed)
      + ' — targeted, no completion line: it must not be lost when the parse fails');
    ok('...and this is NOT reported as a wholesale failure',
      r.wholesale === '',
      'wholesale=' + JSON.stringify(r.wholesale)
      + ' — wholesale skips completion accounting, which would lose the straggler');
  }

  // ── a genuine wholesale failure is still wholesale ─────────────────────
  {
    const out = 'Error: HTTP Error: 401, Request had invalid authentication credentials.';
    const r = runDeployOnly(out, 1, 'functions:getEstimateForView,functions:claudeProxy');
    ok('a deploy that died before per-function rollout is still wholesale',
      r.wholesale !== '',
      'wholesale=' + JSON.stringify(r.wholesale)
      + ' — this mode reported "All functions deployed" and went green until 2026-08-10');
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
  process.exit(0);
})();

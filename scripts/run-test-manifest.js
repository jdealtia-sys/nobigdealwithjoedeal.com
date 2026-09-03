#!/usr/bin/env node
/*
 * run-test-manifest.js — manifest-driven suite runner + orphan tripwire.
 *
 * Why: ci.yml hand-listed suites, and 35 of them — including every money/
 * pricing suite BIG_ROCKS calls "the canonical reference" for Rock 2 — were
 * never listed, so they existed without ever gating a merge (found in the
 * 2026-08-07 stability audit). Hand-listing reproduces the failure mode this
 * fixes, so the manifest is the single registry:
 *
 *   tests/ci-manifest.json buckets:
 *     node                — RUNNABLE. 44 suites, unit-suite-manifest job.
 *     smoke               — RUNNABLE. 65 suites, smoke-tests job. Object-valued:
 *                           each suite carries its step documentation.
 *     emulator            — run as individual emulators:exec steps in ci.yml
 *     wired-individually  — suites a workflow runs by name (unchanged)
 *     quarantined         — known-red, skipped, dated reason required
 *
 * COMPLETENESS: every tests/*.test.js on disk must appear in exactly one
 * bucket, else exit 1. Adding a test file without classifying it fails CI —
 * a new suite can never be silently orphaned again.
 *
 * 2026-08-23: the smoke-tests job's 65 hand-written `node tests/X.test.js`
 * steps collapsed into one `--bucket smoke` invocation, because a red step
 * aborted the job and hid the other 64 results. Two consequences drove most
 * of the hardening below:
 *   - One aggregated step is now the single point where 65 suites can be
 *     de-gated by a one-line JSON edit, so the workflow-presence check had to
 *     stop being "the suite name appears somewhere in YAML" (satisfiable by a
 *     COMMENT) and become "the step that runs the bucket exists, is not
 *     neutered, and the bucket has not shrunk" — see checkRunnableWiring().
 *   - Aggregating means a suite can now fail without the job stopping, so the
 *     runner must not be able to report green while running fewer suites than
 *     it classified. Hence the ran/queued reconciliation and the output scan.
 *
 * Run: node scripts/run-test-manifest.js                  (completeness + node bucket)
 *      node scripts/run-test-manifest.js --bucket smoke   (completeness + smoke bucket)
 *      node scripts/run-test-manifest.js --check          (completeness only, fast)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TESTS = path.join(ROOT, 'tests');
const manifest = JSON.parse(fs.readFileSync(path.join(TESTS, 'ci-manifest.json'), 'utf8'));

// Buckets this script executes. Anything else is a classification-only bucket.
const RUNNABLE = ['node', 'smoke'];

// Ratchet. A bucket may grow but never silently shrink: these floors are the
// measured sizes at the 2026-08-23 collapse. They live in the script rather
// than the manifest on purpose — a one-line JSON edit must not be able to
// lower the bar it is being measured against. Raise them when a bucket grows.
const FLOORS = { node: 44, smoke: 65, disk: 122 };

// ── Argument parsing ───────────────────────────────────────────────
const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes('--check');
let bucketArg = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--bucket') bucketArg = argv[i + 1] || '';
  else if (argv[i].startsWith('--bucket=')) bucketArg = argv[i].slice('--bucket='.length);
}
const die = (msg) => { console.error(msg); process.exit(1); };

// A workflow passing both flags would silently run nothing: --check exits
// before the run loop. Make the combination an error, not a no-op.
if (CHECK_ONLY && bucketArg !== null) {
  die('ARG ERROR: --check and --bucket are mutually exclusive (--check would exit before running the bucket).');
}
// A typo'd bucket would resolve to [] and exit 0 — green over zero suites.
if (bucketArg !== null && !RUNNABLE.includes(bucketArg)) {
  die('ARG ERROR: --bucket ' + JSON.stringify(bucketArg) + ' is not runnable. Runnable buckets: ' + RUNNABLE.join(', '));
}
const RUN_BUCKET = bucketArg === null ? 'node' : bucketArg;

// ── Bucket normalisation ───────────────────────────────────────────
// node + wired-individually are arrays; smoke, emulator and quarantined are
// objects (a suite's value carries its docs / npm script / quarantine reason).
const namesOf = (v) => (Array.isArray(v) ? v : Object.keys(v || {}));
const buckets = {
  node: namesOf(manifest.node),
  smoke: namesOf(manifest.smoke),
  emulator: namesOf(manifest.emulator),
  'wired-individually': namesOf(manifest['wired-individually']),
  quarantined: namesOf(manifest.quarantined),
};

// ── Completeness tripwire ──────────────────────────────────────────
const disk = fs.readdirSync(TESTS).filter((f) => f.endsWith('.test.js')).sort();
const seen = new Map();
for (const [bucket, files] of Object.entries(buckets)) {
  for (const f of files) {
    if (seen.has(f)) die('MANIFEST ERROR: ' + f + ' appears in both "' + seen.get(f) + '" and "' + bucket + '"');
    seen.set(f, bucket);
    if (!disk.includes(f)) die('MANIFEST ERROR: ' + f + ' is listed under "' + bucket + '" but does not exist on disk');
  }
}
const unlisted = disk.filter((f) => !seen.has(f));
if (unlisted.length) {
  console.error('MANIFEST ERROR: test file(s) not classified in tests/ci-manifest.json:');
  for (const f of unlisted) console.error('  - ' + f);
  console.error('Add each to a bucket (node / smoke / emulator / wired-individually / quarantined).');
  process.exit(1);
}

// ── Subdirectory + workflow coverage (2026-08-10 audit) ────────────
// The scan above is top-level *.test.js only, and the buckets are
// self-attesting — both gaps re-open the exact orphaning class this file
// exists to close. Five extra checks:
//
//   (a) every tests/smoke/*.test.js must be required by tests/smoke.test.js;
//   (b) every tests/e2e/*.spec.js must be named in tests/package.json or a
//       workflow file, or carry a dated entry in UNWIRED_SPECS below;
//   (c) every spec in the authed-emu file list must carry at least one @tag
//       that some ci.yml PLAYWRIGHT_GREP selects;
//   (d) every 'wired-individually' / 'emulator' suite name must appear on an
//       EXECUTABLE (non-comment) workflow line, and every runnable bucket must
//       have a live, un-neutered step invoking it;
//   (e) every suite in the smoke bucket must carry non-empty documentation.
const UNWIRED_SPECS = {
  'screenshot-demo.spec.js': 'manual demo-capture tool — deliberately unwired (2026-08-07 audit)',
  // A DIFFERENTIAL harness, not an assertion suite: it records typeof
  // window[name] + a source-hash for a name list and writes a JSON file. It
  // proves nothing on its own — the signal is diffing a run from BEFORE a
  // globals refactor against one from AFTER, which no single CI job can do
  // (one job, one tree). Wiring it into a shard would just produce a snapshot
  // nobody compares. Run it by hand around a globals change; the invocation is
  // in its header and in the T3-A slice-1 session note (2026-08-31).
  'globals-surface-snapshot.spec.js': 'manual before/after differential harness for globals refactors — a single unattended run has nothing to compare against (2026-08-31, Tranche 3 T3-A slice 1)',
};
const problems = [];
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const smokeAgg = readIf(path.join(TESTS, 'smoke.test.js'));
for (const f of fs.readdirSync(path.join(TESTS, 'smoke')).filter((f) => f.endsWith('.test.js')).sort()) {
  if (!smokeAgg.includes('smoke/' + f)) problems.push('tests/smoke/' + f + ' is not required by tests/smoke.test.js — it runs nowhere');
}
const wfDir = path.join(ROOT, '.github', 'workflows');
const wfFiles = fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
const wfText = wfFiles.map((f) => readIf(path.join(wfDir, f))).join('\n');
// (d) haystack: executable lines only. A YAML COMMENT mentioning a suite name
// must not satisfy "this suite is wired" — measured 2026-08-23, exactly that
// would have kept catalog-cost-privacy.test.js green over a step that no
// longer ran it.
const wfExec = wfText.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
const pkgJson = readIf(path.join(TESTS, 'package.json'));
const greps = [...wfText.matchAll(/PLAYWRIGHT_GREP[^'"\n]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
const shardTags = [...new Set(greps.flatMap((g) => g.match(/@[a-z0-9]+/gi) || []))];
const authedList = (pkgJson.match(/"test:e2e:authed:emu":\s*"([^"]+)"/) || ['', ''])[1];
for (const f of fs.readdirSync(path.join(TESTS, 'e2e')).filter((f) => f.endsWith('.spec.js')).sort()) {
  if (UNWIRED_SPECS[f]) continue;
  if (!pkgJson.includes(f) && !wfText.includes(f)) {
    problems.push('tests/e2e/' + f + ' appears in no tests/package.json script and no workflow — it runs nowhere (or add it to UNWIRED_SPECS with a dated reason)');
    continue;
  }
  if (authedList.includes(f) && shardTags.length) {
    const src = readIf(path.join(TESTS, 'e2e', f));
    if (!shardTags.some((t) => src.includes(t))) {
      problems.push('tests/e2e/' + f + ' is in the authed-emu file list but carries none of the CI shard tags (' + shardTags.join(' ') + ') — no shard\'s grep ever selects it');
    }
  }
}
for (const f of [...buckets['wired-individually'], ...buckets.emulator]) {
  if (!wfExec.includes(f)) problems.push(f + ' is classified "' + seen.get(f) + '" but appears on no executable workflow line — the classification is self-attesting and the suite gates nothing');
}

// (d) continued — a runnable bucket is wired by ONE step, so that step is now
// load-bearing for every suite in it. Assert it exists and still fails the job.
function checkRunnableWiring(bucket) {
  const needle = new RegExp('run-test-manifest\\.js[^\\r\\n]*--bucket[= ]' + bucket + '\\b');
  for (const file of wfFiles) {
    const lines = readIf(path.join(wfDir, file)).split(/\r?\n/);
    const idx = lines.findIndex((l) => !/^\s*#/.test(l) && needle.test(l));
    if (idx === -1) continue;
    // Walk back to the owning "- name:" and forward to the next step at the
    // same indent, then assert nothing in the block neuters the exit code.
    let s = idx;
    while (s > 0 && !/^\s*-\s+name:/.test(lines[s])) s--;
    const indent = (lines[s].match(/^(\s*)-\s+name:/) || ['', ''])[1];
    let e = s + 1;
    while (e < lines.length
           && !new RegExp('^' + indent + '-\\s+name:').test(lines[e])
           && !new RegExp('^' + indent.slice(0, -2) + '\\S').test(lines[e])) e++;
    const block = lines.slice(s, e).filter((l) => !/^\s*#/.test(l)).join('\n');
    const n = buckets[bucket].length;
    if (/^\s*if:/m.test(block)) problems.push('the --bucket ' + bucket + ' step in ' + file + ' carries an "if:" — ' + n + ' suites would stop gating whenever it evaluates false');
    if (/continue-on-error:\s*true/.test(block)) problems.push('the --bucket ' + bucket + ' step in ' + file + ' is continue-on-error: true — ' + n + ' suites would stop gating merges');
    if (/\|\|\s*true/.test(block)) problems.push('the --bucket ' + bucket + ' step in ' + file + ' swallows its exit code with "|| true" — ' + n + ' suites would stop gating merges');
    return;
  }
  problems.push('no workflow has an executable step running "run-test-manifest.js --bucket ' + bucket + '" — all ' + buckets[bucket].length + ' suites in that bucket gate nothing');
}
for (const b of RUNNABLE) checkRunnableWiring(b);

// (e) documentation is a gated asset. The 23 KB of rationale that used to sit
// above each ci.yml step is the reason a reader can tell what a red suite
// protects; migrating it into the manifest only helps if it cannot rot away.
for (const [f, doc] of Object.entries(manifest.smoke || {})) {
  const lines = Array.isArray(doc) ? doc.filter((l) => String(l).trim()) : [];
  if (!lines.length) problems.push(f + ' is in the smoke bucket with no documentation — record why it gates merges (migrated verbatim from its former ci.yml comment)');
}

// Ratchet: a bucket may grow, never silently shrink.
for (const [b, floor] of Object.entries(FLOORS)) {
  const n = b === 'disk' ? disk.length : buckets[b].length;
  if (n < floor) problems.push(b + ' holds ' + n + ' suites but the gating floor is ' + floor + ' — suites were removed. Raise the floor deliberately in scripts/run-test-manifest.js if this is intended.');
}

if (problems.length) {
  console.error('MANIFEST ERROR: coverage tripwire(s):');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

console.log('manifest: ' + disk.length + ' suites classified — node:' + buckets.node.length
  + ' smoke:' + buckets.smoke.length + ' emulator:' + buckets.emulator.length
  + ' wired-individually:' + buckets['wired-individually'].length
  + ' quarantined:' + buckets.quarantined.length + '; smoke/e2e/workflow coverage clean');
for (const [f, reason] of Object.entries(manifest.quarantined || {})) {
  console.log('  QUARANTINED ' + f + ' — ' + reason);
}
if (CHECK_ONLY) process.exit(0);

// ── Run the requested bucket ───────────────────────────────────────
const queue = buckets[RUN_BUCKET];
// Green over zero suites is the failure mode this whole file exists to stop.
if (!queue.length) die('RUNNER ERROR: bucket "' + RUN_BUCKET + '" is empty — refusing to report success over zero suites.');

const PER_SUITE_TIMEOUT_MS = 60000;    // slowest measured suite is 18.7s
const BUCKET_BUDGET_MS = 8 * 60000;    // job cap is 10 min; fail with a report, not a kill
const MAX_BUFFER = 32 * 1024 * 1024;   // default 1 MiB turns a chatty PASS into ENOBUFS

const gh = !!process.env.GITHUB_ACTIONS;
const results = [];
const started = Date.now();
let budgetExhausted = false;

// A suite that prints failures but exits 0 would be invisible. Cheap belt to
// the exit-code braces: scan captured output for a failure summary.
function outputLooksFailed(out) {
  const m = /\b(\d+)\s+fail(?:ed|ures?)\b/i.exec(out);
  if (m && Number(m[1]) > 0) return 'output reports "' + m[0] + '"';
  const line = /^[ \t]*(FAIL\b|not ok\b|AssertionError\b|✗)/m.exec(out);
  if (line) return 'output contains a failure marker (' + line[1] + ')';
  return null;
}

for (const f of queue) {
  if (Date.now() - started > BUCKET_BUDGET_MS) { budgetExhausted = true; break; }
  const t0 = Date.now();
  const res = spawnSync(process.execPath, [path.join(TESTS, f)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    timeout: PER_SUITE_TIMEOUT_MS, maxBuffer: MAX_BUFFER,
  });
  const secs = (Date.now() - t0) / 1000;
  const out = String(res.stdout || '') + String(res.stderr || '');
  let why = null;
  if (res.status !== 0) {
    // ETIMEDOUT and ENOBUFS both arrive as status=null; naming them turns an
    // unreadable empty-output red into a diagnosis.
    why = res.error
      ? (res.error.code || res.error.message) + (res.signal ? ' (signal ' + res.signal + ')' : '')
      : 'exit ' + res.status + (res.signal ? ' (signal ' + res.signal + ')' : '');
  } else {
    why = outputLooksFailed(out);
  }
  results.push({ f: f, ok: !why, why: why, secs: secs, out: out });
  if (gh) {
    console.log('::group::' + (why ? '✗' : '✓') + ' tests/' + f + ' (' + secs.toFixed(1) + 's)' + (why ? ' — ' + why : ''));
    if (out) console.log(out.trimEnd());
    console.log('::endgroup::');
  } else {
    console.log((why ? '  ✗' : '  ✓') + ' ' + f + ' (' + secs.toFixed(1) + 's)' + (why ? ' — ' + why : ''));
    if (why) console.error(out.split('\n').slice(-25).join('\n'));
  }
}

const failures = results.filter((r) => !r.ok);

// Reconciliation: the runner must never report on fewer suites than it queued.
if (!budgetExhausted && results.length !== queue.length) {
  die('RUNNER ERROR: queued ' + queue.length + ' suites but produced ' + results.length + ' results — refusing to report a partial run as complete.');
}

if (gh) {
  for (const r of failures) {
    const first = (r.out.split('\n').find((l) => /FAIL|not ok|AssertionError|✗|Error/.test(l)) || r.why || 'failed').trim().slice(0, 300);
    console.log('::error file=tests/' + r.f + '::' + first.replace(/\r/g, ''));
  }
  const sum = process.env.GITHUB_STEP_SUMMARY;
  if (sum) {
    const rows = results.map((r) => '| `' + r.f + '` | ' + (r.ok ? '✅ pass' : '❌ **fail**') + ' | ' + r.secs.toFixed(1) + ' |').join('\n');
    fs.appendFileSync(sum,
      '\n### Bucket `' + RUN_BUCKET + '` — ' + (results.length - failures.length) + '/' + results.length + ' passed\n\n'
      + '| suite | verdict | secs |\n|---|---|---|\n' + rows + '\n'
      + (failures.length ? '\n**Failed:** ' + failures.map((r) => '`' + r.f + '`').join(', ') + '\n' : '')
      + (budgetExhausted ? '\n> ⚠️ wall-clock budget exhausted after ' + results.length + '/' + queue.length + ' suites\n' : ''), 'utf8');
  }
}

console.log('\n' + (results.length - failures.length) + '/' + results.length + ' ' + RUN_BUCKET
  + ' suites passed (' + ((Date.now() - started) / 1000).toFixed(1) + 's)');
if (budgetExhausted) die('RUNNER ERROR: wall-clock budget (' + (BUCKET_BUDGET_MS / 1000) + 's) exhausted after ' + results.length + '/' + queue.length + ' suites — a suite is hanging.');
if (failures.length) die('FAILED: ' + failures.map((r) => r.f).join(', '));

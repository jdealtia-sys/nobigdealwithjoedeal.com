#!/usr/bin/env node
/*
 * run-test-manifest.js — manifest-driven unit-suite runner + orphan tripwire.
 *
 * Why: ci.yml hand-lists suites, and 35 of them — including every money/
 * pricing suite BIG_ROCKS calls "the canonical reference" for Rock 2 — were
 * never listed, so they existed without ever gating a merge (found in the
 * 2026-08-07 stability audit). Hand-listing reproduces the failure mode this
 * fixes, so the manifest is the single registry:
 *
 *   tests/ci-manifest.json buckets:
 *     node                — run here, sequentially, aggregated report
 *     emulator            — run as individual emulators:exec steps in ci.yml
 *     wired-individually  — suites ci.yml already runs by name (unchanged)
 *     quarantined         — known-red, skipped, dated reason required
 *
 * COMPLETENESS: every tests/*.test.js on disk must appear in exactly one
 * bucket, else exit 1. Adding a test file without classifying it fails CI —
 * a new suite can never be silently orphaned again.
 *
 * Run: node scripts/run-test-manifest.js          (completeness + node bucket)
 *      node scripts/run-test-manifest.js --check  (completeness only, fast)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TESTS = path.join(ROOT, 'tests');
const manifest = JSON.parse(fs.readFileSync(path.join(TESTS, 'ci-manifest.json'), 'utf8'));
const CHECK_ONLY = process.argv.includes('--check');

// ── Completeness tripwire ──────────────────────────────────────────
const disk = fs.readdirSync(TESTS).filter((f) => f.endsWith('.test.js')).sort();
const buckets = {
  node: manifest.node || [],
  emulator: Object.keys(manifest.emulator || {}),
  'wired-individually': manifest['wired-individually'] || [],
  quarantined: Object.keys(manifest.quarantined || {}),
};
const seen = new Map();
for (const [bucket, files] of Object.entries(buckets)) {
  for (const f of files) {
    if (seen.has(f)) {
      console.error(`MANIFEST ERROR: ${f} appears in both "${seen.get(f)}" and "${bucket}"`);
      process.exit(1);
    }
    seen.set(f, bucket);
    if (!disk.includes(f)) {
      console.error(`MANIFEST ERROR: ${f} is listed under "${bucket}" but does not exist on disk`);
      process.exit(1);
    }
  }
}
const unlisted = disk.filter((f) => !seen.has(f));
if (unlisted.length) {
  console.error('MANIFEST ERROR: test file(s) not classified in tests/ci-manifest.json:');
  for (const f of unlisted) console.error('  - ' + f);
  console.error('Add each to a bucket (node / emulator / wired-individually / quarantined).');
  process.exit(1);
}

// ── Subdirectory + workflow coverage (2026-08-10 audit) ────────────
// The scan above is top-level *.test.js only, and the buckets are
// self-attesting — both gaps re-open the exact orphaning class this file
// exists to close. Four extra checks:
//
//   (a) every tests/smoke/*.test.js must be required by tests/smoke.test.js
//       (that aggregator is how the smoke domains run at all);
//   (b) every tests/e2e/*.spec.js must be named in tests/package.json or a
//       workflow file, or carry a dated entry in UNWIRED_SPECS below;
//   (c) every spec in the authed-emu file list must carry at least one @tag
//       that some ci.yml PLAYWRIGHT_GREP selects — a listed-but-untagged
//       spec matches no shard's grep and silently never runs;
//   (d) every 'wired-individually' / 'emulator' suite name must actually
//       appear in a workflow file — otherwise deleting a ci.yml step
//       de-gates the suite while this tripwire stays green.
const UNWIRED_SPECS = {
  'screenshot-demo.spec.js': 'manual demo-capture tool — deliberately unwired (2026-08-07 audit)',
};
const problems = [];
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const smokeAgg = readIf(path.join(TESTS, 'smoke.test.js'));
for (const f of fs.readdirSync(path.join(TESTS, 'smoke')).filter((f) => f.endsWith('.test.js')).sort()) {
  if (!smokeAgg.includes(`smoke/${f}`)) problems.push(`tests/smoke/${f} is not required by tests/smoke.test.js — it runs nowhere`);
}
const wfDir = path.join(ROOT, '.github', 'workflows');
const workflows = fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).map((f) => readIf(path.join(wfDir, f))).join('\n');
const pkgJson = readIf(path.join(TESTS, 'package.json'));
const greps = [...workflows.matchAll(/PLAYWRIGHT_GREP[^'"\n]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
const shardTags = [...new Set(greps.flatMap((g) => g.match(/@[a-z0-9]+/gi) || []))];
const authedList = (pkgJson.match(/"test:e2e:authed:emu":\s*"([^"]+)"/) || ['', ''])[1];
for (const f of fs.readdirSync(path.join(TESTS, 'e2e')).filter((f) => f.endsWith('.spec.js')).sort()) {
  if (UNWIRED_SPECS[f]) continue;
  if (!pkgJson.includes(f) && !workflows.includes(f)) {
    problems.push(`tests/e2e/${f} appears in no tests/package.json script and no workflow — it runs nowhere (or add it to UNWIRED_SPECS with a dated reason)`);
    continue;
  }
  if (authedList.includes(f) && shardTags.length) {
    const src = readIf(path.join(TESTS, 'e2e', f));
    if (!shardTags.some((t) => src.includes(t))) {
      problems.push(`tests/e2e/${f} is in the authed-emu file list but carries none of the CI shard tags (${shardTags.join(' ')}) — no shard's grep ever selects it`);
    }
  }
}
for (const f of [...buckets['wired-individually'], ...buckets.emulator]) {
  if (!workflows.includes(f)) problems.push(`${f} is classified "${seen.get(f)}" but appears in no workflow file — the classification is self-attesting and the suite gates nothing`);
}
if (problems.length) {
  console.error('MANIFEST ERROR: coverage tripwire(s):');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

console.log(`manifest: ${disk.length} suites classified — node:${buckets.node.length} emulator:${buckets.emulator.length} wired-individually:${buckets['wired-individually'].length} quarantined:${buckets.quarantined.length}; smoke/e2e/workflow coverage clean`);
for (const [f, reason] of Object.entries(manifest.quarantined || {})) {
  console.log(`  QUARANTINED ${f} — ${reason}`);
}
if (CHECK_ONLY) process.exit(0);

// ── Run the node bucket ────────────────────────────────────────────
const failures = [];
for (const f of buckets.node) {
  const t0 = Date.now();
  const res = spawnSync(process.execPath, [path.join(TESTS, f)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
  });
  const ok = res.status === 0;
  console.log(`${ok ? '  ✓' : '  ✗'} ${f} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (!ok) {
    failures.push(f);
    const out = (res.stdout || '') + (res.stderr || '');
    console.error(String(out).split('\n').slice(-25).join('\n'));
  }
}
console.log(`\n${buckets.node.length - failures.length}/${buckets.node.length} node suites passed`);
if (failures.length) {
  console.error('FAILED: ' + failures.join(', '));
  process.exit(1);
}

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
console.log(`manifest: ${disk.length} suites classified — node:${buckets.node.length} emulator:${buckets.emulator.length} wired-individually:${buckets['wired-individually'].length} quarantined:${buckets.quarantined.length}`);
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

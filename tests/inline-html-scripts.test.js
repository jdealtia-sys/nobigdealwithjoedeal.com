/**
 * inline-html-scripts.test.js — regression tests for the inline-script checker
 *
 * Proves scripts/check-inline-html-scripts.js:
 *   1. Catches a deliberately broken inline <script> in a fixture
 *   2. Passes cleanly on a valid minimal HTML file
 *   3. Exits 0 / 1 appropriately
 *
 * Dependency-free — runs with: node tests/inline-html-scripts.test.js
 *
 * Why this exists:
 *   On 2026-04-18 we shipped a broken /estimate funnel for weeks because
 *   an inline <script> had an unclosed brace. Browsers silently logged
 *   the error to console; no test caught it. The checker script is the
 *   guard. This test is the guard on the guard.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHECKER = path.join(ROOT, 'scripts/check-inline-html-scripts.js');
const BROKEN_FIXTURE = path.join(__dirname, 'fixtures/broken-inline-script.html');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✘ ' + name);
    console.error('    ' + (e.stack || e.message));
    failed++;
  }
}

function runChecker(args) {
  try {
    const stdout = execFileSync(process.execPath, [CHECKER, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status == null ? 2 : err.status,
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString(),
    };
  }
}

console.log('');
console.log('inline-html-scripts.test.js');

test('checker script file exists', () => {
  if (!fs.existsSync(CHECKER)) throw new Error('missing: ' + CHECKER);
});

test('catches broken inline <script> fixture (exit 1)', () => {
  const r = runChecker([BROKEN_FIXTURE]);
  if (r.exitCode !== 1) {
    throw new Error(`expected exit 1, got ${r.exitCode}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  }
  if (!/SyntaxError/.test(r.stderr) && !/Unexpected/.test(r.stderr)) {
    throw new Error('expected stderr to mention SyntaxError/Unexpected, got:\n' + r.stderr);
  }
  if (!/broken-inline-script\.html/.test(r.stderr)) {
    throw new Error('expected stderr to reference the failing HTML file, got:\n' + r.stderr);
  }
});

test('passes on a valid minimal HTML file', () => {
  const tmp = path.join(os.tmpdir(), 'nbd-valid-' + Date.now() + '.html');
  fs.writeFileSync(
    tmp,
    '<!DOCTYPE html><html><body><script>var x = 1; function ok(){ return x + 1; }</script></body></html>',
    'utf8'
  );
  try {
    const r = runChecker([tmp]);
    if (r.exitCode !== 0) {
      throw new Error(`expected exit 0, got ${r.exitCode}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* noop */ }
  }
});

test('skips src\'d scripts (no false positive from external files)', () => {
  const tmp = path.join(os.tmpdir(), 'nbd-src-' + Date.now() + '.html');
  fs.writeFileSync(
    tmp,
    '<!DOCTYPE html><html><body><script src="/nonsense-path.js"></script></body></html>',
    'utf8'
  );
  try {
    const r = runChecker([tmp]);
    if (r.exitCode !== 0) {
      throw new Error(`expected exit 0 (src scripts skipped), got ${r.exitCode}`);
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* noop */ }
  }
});

test('skips application/ld+json data blocks', () => {
  const tmp = path.join(os.tmpdir(), 'nbd-jsonld-' + Date.now() + '.html');
  fs.writeFileSync(
    tmp,
    '<!DOCTYPE html><html><body>' +
      '<script type="application/ld+json">{ "malformed": "this is JSON not JS" missing brace here</script>' +
      '</body></html>',
    'utf8'
  );
  try {
    const r = runChecker([tmp]);
    if (r.exitCode !== 0) {
      throw new Error(`expected exit 0 (JSON-LD skipped), got ${r.exitCode}\nstderr: ${r.stderr}`);
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* noop */ }
  }
});

test('passes on the live docs/ tree (no broken inline scripts in production)', () => {
  // No args = default to walking docs/
  const r = runChecker([]);
  if (r.exitCode !== 0) {
    throw new Error(
      'docs/ has broken inline <script>!\n' +
      'stdout: ' + r.stdout + '\n' +
      'stderr: ' + r.stderr
    );
  }
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);

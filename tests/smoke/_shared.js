/**
 * tests/smoke/_shared.js — shared scaffold for domain-split smoke tests
 *
 * Exports:
 *   - ROOT, PRO_JS, FUNCTIONS: canonical project paths
 *   - read(file): readFileSync as utf8
 *   - readDashboard(): concatenation of docs/pro/dashboard.html
 *                      and docs/pro/js/dashboard-main.js (audit batch 10:
 *                      so smoke tests grepping for inline handlers find
 *                      them regardless of which file the handler lives in)
 *   - syntaxCheck(file): { ok, err } via `node --check`
 *   - makeContext(): returns a fresh { assert, section, getResults } triple
 *                    bound to its own pass/fail counters. Used by the
 *                    orchestrator to thread one shared counter through
 *                    every domain file's run(ctx) entry point.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PRO_JS = path.join(ROOT, 'docs/pro/js');
const FUNCTIONS = path.join(ROOT, 'functions');

function read(file) { return fs.readFileSync(file, 'utf8'); }

// Audit batch 10: dashboard.html's 3986-line inline <script> got
// extracted to docs/pro/js/dashboard-main.js. Existing smoke tests
// that read dashboard.html and grep for code patterns now need to
// see BOTH files. readDashboard() returns the concatenation so the
// assertions don't care where a given handler lives.
function readDashboard() {
  const html  = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = fs.existsSync(path.join(ROOT, 'docs/pro/js/dashboard-main.js'))
    ? read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'))
    : '';
  return html + '\n' + mainJs;
}

function syntaxCheck(file) {
  try {
    execSync(`node --check "${file}"`, { stdio: 'pipe' });
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e.stderr ? e.stderr.toString() : e.message };
  }
}

function makeContext() {
  let passed = 0;
  let failed = 0;
  const failures = [];

  function assert(label, cond, detail) {
    if (cond) {
      passed++;
      console.log('  ✓ ' + label);
    } else {
      failed++;
      failures.push(label + (detail ? ' — ' + detail : ''));
      console.log('  ✗ ' + label + (detail ? ' — ' + detail : ''));
    }
  }

  function section(name) { console.log('\n' + name); }

  function getResults() {
    return { passed, failed, failures, bumpPassed, bumpFailed };
  }

  // Hooks for orchestrator-level adjustments (e.g. the inline-html-scripts
  // execSync block in dashboard.test.js that increments counters directly).
  function bumpPassed() { passed++; }
  function bumpFailed(msg) { failed++; failures.push(msg); }

  return { assert, section, getResults, bumpPassed, bumpFailed };
}

module.exports = {
  ROOT,
  PRO_JS,
  FUNCTIONS,
  read,
  readDashboard,
  syntaxCheck,
  makeContext,
};

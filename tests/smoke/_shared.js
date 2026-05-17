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
// extracted to docs/pro/js/dashboard-main.js. CSP hotfix (2026-05-16)
// extracted the remaining inline <script> blocks to a fleet of
// dashboard-*.js shards. Step 4a (2026-05-16) further split the
// 5408-line dashboard-main.js into five sibling modules + a thin
// main shim. readDashboard() returns the concatenation of
// dashboard.html + every shard so existing assertions keep finding
// patterns regardless of which file the handler ended up in.
const DASHBOARD_EXTRACTED_SHARDS = [
  'dashboard-main.js',
  // Step 4a split — load order: state → api → widgets → ui → actions → main
  'dashboard-state.js',
  'dashboard-api.js',
  'dashboard-widgets.js',
  'dashboard-ui.js',
  'dashboard-actions.js',
  'dashboard-legacy-redirect.js',
  'dashboard-appcheck-config.js',
  'dashboard-auth-gate.module.js',
  'dashboard-bootstrap.module.js',
  'dashboard-loader-fadeout.js',
  'dashboard-ui-prefs-boot.js',
  'dashboard-nav-init.js',
  'dashboard-shortcuts-tabs.js',
  'dashboard-crew-calendar-toggle.js',
  'dashboard-accessory-panel-init.js',
  'dashboard-insurance-overlay-toggle.js',
  'dashboard-custom-theme.js',
  'dashboard-sidebar-customizer.js',
  'dashboard-team-tab.js',
  'dashboard-billing-tab.js',
  'dashboard-hotkey-toggles.js',
  'dashboard-sw-bootstrap.js',
  'dashboard-load-status-banner.js',
];
function readDashboard() {
  const html = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const parts = [html];
  for (const shard of DASHBOARD_EXTRACTED_SHARDS) {
    const p = path.join(ROOT, 'docs/pro/js', shard);
    if (fs.existsSync(p)) parts.push(read(p));
  }
  return parts.join('\n');
}

// Step 4a (2026-05-16): dashboard-main.js got split into 5 sibling
// modules + a thin shim. Assertions that historically grep'd a single
// dashboard-main.js for delegate branches, allowlist entries, window
// exports, etc. now need the concatenated post-split surface.
// readDashboardMain() returns dashboard-main.js plus the 5 split
// modules joined in load order, so the existing `read(...
// dashboard-main.js)` call sites can switch to this helper with no
// regex changes.
const DASHBOARD_MAIN_SPLIT = [
  'dashboard-state.js',
  'dashboard-api.js',
  'dashboard-widgets.js',
  'dashboard-ui.js',
  'dashboard-actions.js',
  'dashboard-main.js',
];
function readDashboardMain() {
  const parts = [];
  for (const shard of DASHBOARD_MAIN_SPLIT) {
    const p = path.join(ROOT, 'docs/pro/js', shard);
    if (fs.existsSync(p)) parts.push(read(p));
  }
  return parts.join('\n');
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
  readDashboardMain,
  syntaxCheck,
  makeContext,
};

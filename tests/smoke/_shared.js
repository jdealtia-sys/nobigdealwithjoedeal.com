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
 *   - jsSegments(src): partition JS source into code/string/comment/regex
 *                      segments, so a scan can tell markup that SHIPS from
 *                      markup that only appears in a doc comment
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

// Rock 4 Phase 2b-d (2026-07-04): dashboard.html's three big inline
// <style> blocks (main app CSS, kanban-force-css, nbd-theme-bridge —
// ~6,600 lines) moved to docs/pro/css/*.css, following theme-system.css
// (Phase 2). Assertions that grep dashboard.html for CSS rules need the
// concatenated style surface, same pattern as readDashboard() above.
// Keep this list in load order (matches the <link> order in <head>).
const DASHBOARD_EXTRACTED_CSS = [
  'theme-system.css',
  'dashboard-app.css',
  'kanban-force.css',
  'theme-bridge.css',
];
function readDashboardStyles() {
  const html = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const parts = [html];
  for (const sheet of DASHBOARD_EXTRACTED_CSS) {
    const p = path.join(ROOT, 'docs/pro/css', sheet);
    if (fs.existsSync(p)) parts.push(read(p));
  }
  return parts.join('\n');
}

// CSP extraction (2026-07-02): customer.html's 11 inline <script>
// blocks (~6.5k lines incl. the critical Firebase bootstrap module)
// moved to docs/pro/js/customer-*.js, mirroring the dashboard #398
// work above, so the /pro/customer unsafe-inline CSP carve-out could
// be retired. readCustomer() concatenates customer.html + the
// extracted files in document load order so existing assertions keep
// finding patterns regardless of which file the code ended up in.
const CUSTOMER_EXTRACTED_SHARDS = [
  'customer-presentation-theme.js',
  'customer-photo-review-links.js',
  'customer-photo-report-generator.js',
  'customer-bootstrap.module.js',
  'customer-tasks-ui.js',
  'customer-gallery-share.js',
  'customer-signed-doc-upload.js',
  'customer-photo-report-picker.js',
  'customer-edit-modal.js',
  'customer-voice-intelligence.module.js',
  'customer-realtime.module.js',
];
function readCustomer() {
  const html = read(path.join(ROOT, 'docs/pro/customer.html'));
  const parts = [html];
  for (const shard of CUSTOMER_EXTRACTED_SHARDS) {
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

// Step 4b (2026-05-16): the 3552-line crm.js got split into four
// sibling modules + a thin shim using the same pattern as Step 4a.
// Assertions that historically grep'd a single crm.js for the lead
// modal / kanban / notifications / bulk surface now need the
// concatenated post-split source. readCrm() returns crm-leads.js +
// crm-pipeline.js + crm-snooze.js + crm-portal-bridge.js + crm.js
// joined in load order, so existing `read(...crm.js)` call sites
// can switch to this helper with no regex changes.
const CRM_SPLIT = [
  'crm-leads.js',
  'crm-pipeline.js',
  'crm-snooze.js',
  'crm-portal-bridge.js',
  'crm.js',
];
function readCrm() {
  const parts = [];
  for (const shard of CRM_SPLIT) {
    const p = path.join(ROOT, 'docs/pro/js', shard);
    if (fs.existsSync(p)) parts.push(read(p));
  }
  return parts.join('\n');
}

// Step 4d (2026-05-16): the 4254-line maps.js got split into three
// sibling modules + a thin shim using the same pattern as Steps
// 4a/4b. Assertions that historically grep'd a single maps.js for
// pin-popup / draw-tool / overlay logic now need the concatenated
// post-split source. readMaps() returns maps-core.js +
// maps-overlays.js + maps-routing.js + maps.js joined in load
// order, so existing `read(...maps.js)` call sites can switch to
// this helper with no regex changes.
const MAPS_SPLIT = [
  'maps-core.js',
  'maps-overlays.js',
  'maps-customers.js',
  'maps-routing.js',
  'maps.js',
];
function readMaps() {
  const parts = [];
  for (const shard of MAPS_SPLIT) {
    const p = path.join(ROOT, 'docs/pro/js', shard);
    if (fs.existsSync(p)) parts.push(read(p));
  }
  return parts.join('\n');
}

// Step 4f (2026-05-17): the 3539-line d2d-tracker-2026b.js (the LIVE
// d2d-tracker, loaded by dashboard.html) got split into a core module
// + a ui module + a thin shim. Assertions that grep d2d-tracker-2026b.js
// for orange-rgba use, render markup, etc. now need the concatenated
// post-split source. readD2DLive() returns core + ui + shim joined in
// load order, so existing read(... d2d-tracker-2026b.js) call sites
// can switch to this helper with no regex changes.
const D2D_LIVE_SPLIT = [
  'd2d-tracker-core-2026b.js',
  'd2d-tracker-ui-2026b.js',
  'd2d-tracker-2026b.js',
];
function readD2DLive() {
  const parts = [];
  for (const shard of D2D_LIVE_SPLIT) {
    const p = path.join(ROOT, 'docs/pro/js', shard);
    if (fs.existsSync(p)) parts.push(read(p));
  }
  return parts.join('\n');
}

// Step 4c (2026-05-16): functions/index.js (147KB) got split into a
// thin aggregator shim + 9 handler modules under functions/handlers/.
// Existing smoke assertions that grep'd a single functions/index.js
// for inline handler code (claudeProxy, signImageUrl, integrationStatus,
// onRepSignup, etc.) now need the concatenated post-split surface.
// readFunctionsIndex() returns functions/index.js + handlers/*.js
// joined together, so existing `read(...index.js)` call sites can
// switch to this helper with no regex changes.
const FUNCTIONS_INDEX_SPLIT = [
  'index.js',
  'handlers/_shared.js',
  'handlers/ai.js',
  'handlers/photo.js',
  'handlers/admin.js',
  'handlers/auth.js',
  'handlers/migrations.js',
  'handlers/integrations.js',
  'handlers/portal.js',
  'handlers/monitoring.js',
];
function readFunctionsIndex() {
  const parts = [];
  for (const shard of FUNCTIONS_INDEX_SPLIT) {
    const p = path.join(FUNCTIONS, shard);
    if (fs.existsSync(p)) parts.push(read(p));
  }
  return parts.join('\n');
}

// CSP extraction (2026-06-10): portal.html's end-of-body inline <script>
// IIFE got extracted to docs/pro/js/portal.js so the route can drop the
// 'unsafe-inline' CSP exception added as the #619 interim fix.
// readPortal() returns portal.html + js/portal.js joined, so existing
// assertions keep finding patterns regardless of which file the code
// lives in (same pattern as readDashboard above).
function readPortal() {
  const parts = [read(path.join(ROOT, 'docs/pro/portal.html'))];
  const p = path.join(ROOT, 'docs/pro/js/portal.js');
  if (fs.existsSync(p)) parts.push(read(p));
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

// ── jsSegments: split JS source into code / string / comment / regex ──────
//
// Why this exists
// ───────────────
// The wiring audit in dashboard.test.js has to tell markup that SHIPS
// (`el.innerHTML = '<button data-fn="deleteZone">'`) apart from markup that
// only DOCUMENTS the delegate (`// <input data-on-change="setFoo" ...>` in
// dashboard-ui.js's header comment). A plain grep over the file conflates
// them, which is why the generated-markup half of the audit sat unwritten:
// a naive scan reports five doc-comment placeholders (setFoo/setBar/setBaz/
// handleUpload/fnName) as dead controls. Excluding them by name would be a
// gate that lies the moment someone renames a placeholder — so we classify
// by POSITION instead, and the exclusion falls out of the classification.
//
// Returns a contiguous, gapless partition of `src`:
//   [{ kind: 'code'|'string'|'comment'|'regex', start, end }, ...]
// Delimiters belong to their own segment (the quotes are part of the string,
// `//` is part of the comment). Callers can therefore assert
// `sum(end - start) === src.length` as a cheap scanner-drift canary.
// `string` covers '…', "…" and `…` template literals; the `${ }` holes inside
// a template are re-classified as `code` (with brace nesting tracked), so a
// dispatch name in an interpolated sub-expression's own string still counts.
//
// The one genuine ambiguity in JS lexing is `/`: regex literal or division.
// It is resolved the standard way — `/` is division when the previous
// significant character is a value ender (`\w`, `$`, `)`, `]`, or the end of
// a string/regex) UNLESS the identifier before it is a keyword that can only
// be followed by an expression (`return /re/.test(x)`). Two things keep a
// wrong call from going anywhere: single-quoted, double-quoted and regex
// modes all bail at a newline (none of them may legally span one), so a
// misread is contained to a single line and can never eat a real markup
// string further down the file; and multi-line modes — template literals and
// block comments — are entered unambiguously by ` and /*, never by `/`.
const REGEX_ONLY_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of',
  'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const SEGMENT_KIND = { code: 'code', line: 'comment', block: 'comment',
  "'": 'string', '"': 'string', '`': 'string', regex: 'regex' };

function jsSegments(src) {
  const segs = [];
  const n = src.length;
  let i = 0;
  let start = 0;
  let mode = 'code';
  let depth = 0;          // brace depth inside the current `${ }` hole
  let inClass = false;    // inside a regex [...] character class
  const frames = [];      // brace depth saved on entry to each `${ }`
  let prevChar = '';      // last non-space character seen in code
  let prevWord = '';      // identifier ending at prevChar ('' if not a word)
  const cut = (kind, end) => { if (end > start) segs.push({ kind, start, end }); start = end; };

  while (i < n) {
    const c = src[i];
    if (mode === 'code') {
      if (c === '/' && src[i + 1] === '/') { cut('code', i); mode = 'line'; i += 2; continue; }
      if (c === '/' && src[i + 1] === '*') { cut('code', i); mode = 'block'; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { cut('code', i); mode = c; i++; continue; }
      if (c === '/' && !(/[\w$)\]]/.test(prevChar) && !REGEX_ONLY_AFTER.has(prevWord))) {
        cut('code', i); mode = 'regex'; inClass = false; i++; continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        // A `}` that closes a `${ }` hole hands control back to the template.
        if (frames.length && depth === 0) { cut('code', i); mode = '`'; depth = frames.pop(); i++; continue; }
        depth--;
      }
      if (!/\s/.test(c)) { prevChar = c; prevWord = /[\w$]/.test(c) ? prevWord + c : ''; }
      i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { cut('comment', i); mode = 'code'; } else i++; continue; }
    if (mode === 'block') {
      if (c === '*' && src[i + 1] === '/') { i += 2; cut('comment', i); mode = 'code'; } else i++;
      continue;
    }
    if (mode === "'" || mode === '"') {
      if (c === '\\') { i += 2; continue; }
      if (c === mode) { i++; cut('string', i); mode = 'code'; prevChar = '0'; prevWord = ''; continue; }
      if (c === '\n') { cut('string', i); mode = 'code'; continue; }  // malformed — stop the bleed
      i++; continue;
    }
    if (mode === '`') {
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && src[i + 1] === '{') { cut('string', i); frames.push(depth); depth = 0; mode = 'code'; i += 2; continue; }
      if (c === '`') { i++; cut('string', i); mode = 'code'; prevChar = '0'; prevWord = ''; continue; }
      i++; continue;
    }
    // regex
    if (c === '\\') { i += 2; continue; }
    if (c === '\n') { cut('regex', i); mode = 'code'; continue; }   // not a regex after all
    if (inClass) { if (c === ']') inClass = false; i++; continue; }
    if (c === '[') { inClass = true; i++; continue; }
    if (c === '/') { i++; cut('regex', i); mode = 'code'; prevChar = '0'; prevWord = ''; continue; }
    i++;
  }
  cut(SEGMENT_KIND[mode], n);
  return segs;
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
  readDashboardStyles,
  readCustomer,
  readDashboardMain,
  readPortal,
  readCrm,
  readMaps,
  readD2DLive,
  readFunctionsIndex,
  syntaxCheck,
  jsSegments,
  makeContext,
};

/**
 * tests/empty-is-not-failed.test.js — a zero-lead account is not a broken one.
 *
 * Third and final pass of the same root cause. #1118 fixed the load-status
 * banner; these are the two remaining surfaces that read `count === 0` as a
 * failure signal instead of reading _loadLeadsLastError:
 *
 *  1. dashboard-actions.js — the CRM entry block was gated on
 *     `window._leads?.length`, so a tenant with zero leads got neither
 *     buildKanbanColumns() nor renderLeads(). Pipeline — his primary nav item —
 *     painted its header ("0 leads · $0 pipeline") and then literally nothing:
 *     no columns, no drop targets, no message. The per-column "No leads" empty
 *     state was already written and simply never ran.
 *
 *  2. crm-pipeline.js — the diagnostic gate was
 *     `loadCompleted && all.length === 0`, which every new account satisfies
 *     permanently. Clicking a track tab, toggling Board/List, clearing a search
 *     or reloading on #/crm raised "⚠️ CRM Diagnostic — Your kanban isn't
 *     loading" over a dump of the user's email and Firebase UID, with
 *     "Firestore rules blocking reads (check Firebase Console)" as cause #2.
 *     Nothing was wrong. Dismiss isn't persisted, so it recurred all session.
 *
 * Verified live against a tenant registered through the real signup flow:
 * before, 0 columns + the alarming panel; after, 7 columns + "👋 Your pipeline
 * is ready", with the diagnostic still returning in full for a simulated
 * permission-denied.
 *
 * Zero deps.  Run: node tests/empty-is-not-failed.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PRO_JS = path.join(ROOT, 'docs/pro/js');
const read = (p) => fs.readFileSync(path.join(PRO_JS, p), 'utf8');
const decomment = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('EMPTY IS NOT FAILED — kanban columns render, diagnostic keys off the error');

// ── 1. The board renders for a zero-lead tenant ───────────────────────
{
  const acts = decomment(read('dashboard-actions.js'));
  const crmBlock = acts.slice(acts.indexOf("if(name==='crm')"), acts.indexOf("if(name==='crm')") + 900);
  ok('CRM entry is no longer gated on the lead COUNT',
    !/window\._leads\?\.length/.test(crmBlock),
    'that gate skipped buildKanbanColumns AND renderLeads for an empty account');
  ok('renderLeads is called with a safe empty array',
    /renderLeads\(window\._leads \|\| \[\], window\._filteredLeads\)/.test(crmBlock));
  ok('buildKanbanColumns still runs when the board has no children',
    /buildKanbanColumns\(window\._currentViewKey \|\| 'insurance'\)/.test(crmBlock));
}

// ── 2. The diagnostic discriminates on the ERROR, not the count ───────
{
  const pipe = decomment(read('crm-pipeline.js'));
  ok('the diagnostic branches on _loadLeadsLastError',
    /const loadErr = window\._loadLeadsLastError \|\| null;/.test(pipe)
    && /if \(loadErr\) \{/.test(pipe),
    'count === 0 is true forever on a new account');

  // Scope to the diagnostic block FIRST — a bare indexOf('} else {') matches
  // the first one in the whole 2000-line file, nowhere near this code.
  const blockStart = pipe.indexOf('const loadErr = window._loadLeadsLastError');
  const blockEnd = pipe.indexOf("diagnostic.style.display = 'block'");
  const block = pipe.slice(blockStart, blockEnd);
  const elseAt = block.indexOf('} else {');

  // The friendly branch must not leak diagnostics at a first-time user.
  const emptyBranch = block.slice(elseAt);
  ok('the empty branch shows an invitation, not an error',
    /Your pipeline is ready/.test(emptyBranch) && /No leads yet/.test(emptyBranch));
  ok('the empty branch hides the debug tools', /_setDebugVisible\(false\)/.test(emptyBranch));
  ok('the empty branch never prints the Firebase UID',
    !/window\._user\.uid/.test(emptyBranch),
    'dumping a UID at a first-time user reads as a crash report');
  ok('the empty branch never blames Firestore rules',
    !/Firestore rules blocking/.test(emptyBranch));

  // ...and the failure branch must keep everything that made it useful.
  const errBranch = block.slice(block.indexOf('if (loadErr) {'), elseAt);
  ok('the failure branch keeps the diagnostic title',
    /CRM Diagnostic/.test(errBranch));
  ok('the failure branch keeps the debug tools', /_setDebugVisible\(true\)/.test(errBranch));
  ok('the failure branch still lists the rules cause', /Firestore rules blocking/.test(errBranch));
  ok('the failure branch now surfaces the ACTUAL error too',
    /Last error/.test(errBranch),
    'the old panel never showed what actually failed');
}

// ── 3. The dashboard carries the IDs the shared JS drives ─────────────
// (This used to pin both dashboard twins; the legacy twin was retired
// 2026-09-02.) If the page lacks these, it keeps the alarming heading
// with its details hidden — worse than before.
{
  for (const page of ['docs/pro/dashboard.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    for (const id of ['crmDiagnosticTitle', 'crmDiagnosticLede', 'crmDiagnosticDebugTools', 'crmDiagnosticDebugToggle']) {
      ok(`${page} has #${id}`, html.includes('id="' + id + '"'));
    }
    ok(`${page} keeps Load Sample Data OUT of the debug-only group`,
      /loadSampleData"[^]{0,120}<span id="crmDiagnosticDebugTools"/.test(html),
      'an empty account is exactly who wants to see a populated board');
  }
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

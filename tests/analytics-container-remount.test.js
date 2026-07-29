/**
 * tests/analytics-container-remount.test.js — cards that live inside
 * #analyticsContainer must survive the analytics re-render, and must be loaded
 * on every dashboard that renders them.
 *
 * ROOT CAUSE (QA 2026-07-29). The adjuster-tactic board was fully built —
 * pure aggregation (functions/adjuster-board-logic.js), a deployed callable
 * (getAdjusterTacticBoard), a client card (adjuster-tactic-card.js), and a
 * render call in goTo('board') — and still showed nothing, for two reasons:
 *
 *  1. analytics-kpi.js owns #analyticsContainer and writes innerHTML TWICE per
 *     render (a loading spinner, then the dashboard once its fetch resolves).
 *     The sibling cards append themselves INTO that container, so the second
 *     write destroys them. Only AiTextingStatsCard was re-appended afterwards,
 *     so the Adjuster Tactics card was wiped on every visit to the board view.
 *  2. adjuster-tactic-card.js was never loaded on dashboard.legacy.html, while
 *     dashboard-actions.js — shared by BOTH dashboards — calls
 *     AdjusterTacticCard.render() behind a truthiness guard. Classic
 *     page-scoped-helper silence: no error, just a missing feature.
 *
 * These assertions are deliberately GENERIC: they discover the cards by
 * scanning for the container lookup, so a future card added to
 * #analyticsContainer is covered automatically instead of quietly repeating
 * this bug.
 *
 * Zero deps. Run: node tests/analytics-container-remount.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const ROOT = path.join(__dirname, '..');
const PRO_JS = path.join(ROOT, 'docs/pro/js');
const CONTAINER = 'analyticsContainer';
const OWNER = 'analytics-kpi.js';

const KPI = fs.readFileSync(path.join(PRO_JS, OWNER), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'docs/pro/dashboard.html'), 'utf8');
const LEGACY = fs.readFileSync(path.join(ROOT, 'docs/pro/dashboard.legacy.html'), 'utf8');
const ACTIONS = fs.readFileSync(path.join(PRO_JS, 'dashboard-actions.js'), 'utf8');

console.log('ANALYTICS CONTAINER — card re-mount + page parity');

// ── Discover every card that injects into the container ───────────────────
const cards = [];
for (const file of fs.readdirSync(PRO_JS)) {
  if (!file.endsWith('.js') || file === OWNER) continue;
  const src = fs.readFileSync(path.join(PRO_JS, file), 'utf8');
  if (!src.includes(`getElementById('${CONTAINER}')`) && !src.includes(`getElementById("${CONTAINER}")`)) continue;
  const m = src.match(/window\.([A-Za-z0-9_]+)\s*=\s*\{/g) || [];
  const globals = m.map(x => x.replace(/window\.| *=.*/g, '').trim())
    .filter(n => /Card$/.test(n) || new RegExp(n, 'i').test(file.replace(/[-.]/g, '')));
  cards.push({ file, globals: [...new Set(globals)] });
}

ok('found the cards that inject into #' + CONTAINER, cards.length >= 2,
  'discovered: ' + JSON.stringify(cards.map(c => c.file)));
ok('the adjuster-tactic board is one of them (the card this test exists for)',
  cards.some(c => c.file === 'adjuster-tactic-card.js'));

// ── 1. The owner must re-mount every one of them, on BOTH paths ───────────
{
  // The re-mount must happen after the success render AND after the error
  // render — both write innerHTML.
  // Slice the two branches apart so each is asserted on its OWN text. (A
  // whole-file regex is not enough: the helper's DEFINITION sits right after
  // the catch block, so a loose pattern matches the definition and passes even
  // when the branch itself stopped re-mounting — verified by mutation.)
  const thenIdx = KPI.indexOf('renderDashboardHTML(el, m);');
  const catchIdx = KPI.indexOf('.catch(function (err)');
  const defIdx = KPI.indexOf('function remountContainerCards()');
  ok('the module has both branches and a named helper', thenIdx !== -1 && catchIdx !== -1 && defIdx !== -1);

  const thenBlock = KPI.slice(thenIdx, catchIdx);
  const catchBlock = KPI.slice(catchIdx, defIdx === -1 ? KPI.length : defIdx);

  ok('the SUCCESS branch re-mounts AFTER rendering the dashboard',
    /renderDashboardHTML\(el, m\);[\s\S]*remountContainerCards\(\);/.test(thenBlock),
    'a re-mount before the innerHTML write is wiped by it — order is the whole point');
  ok('the ERROR branch re-mounts too (it also wipes the container)',
    /remountContainerCards\(\);/.test(catchBlock),
    'a failed analytics fetch would otherwise take the sibling cards down with it');
  ok('there are at least two real re-mount CALLS, not just the definition',
    (KPI.match(/remountContainerCards\(\);/g) || []).length >= 2,
    'counting calls (with the semicolon) rather than the bare identifier');
  ok('there is a single named re-mount helper (not copy-pasted call sites)',
    /function remountContainerCards\(\)/.test(KPI));

  for (const c of cards) {
    for (const g of c.globals) {
      ok(`${OWNER} re-mounts window.${g} (from ${c.file})`,
        new RegExp("'" + g + "'").test(KPI) || new RegExp('window\\.' + g + '\\b').test(KPI),
        `${g} injects into #${CONTAINER} but is not in the re-mount list — it is destroyed on every analytics render`);
    }
  }

  ok('re-mount tolerates a card that is absent on this page',
    /typeof card\.render === 'function'/.test(KPI) || /typeof window\[name\]/.test(KPI),
    'cards are page-scoped; a missing global must not throw');
  ok('a throwing card cannot break the analytics render',
    /try \{ card\.render\(\); \} catch/.test(KPI));
}

// ── 2. Page parity: every card rendered by the shared dispatcher must load ─
{
  // dashboard-actions.js is shared by both dashboards, so any card it renders
  // must be present on both or it is silently missing on one.
  for (const c of cards) {
    for (const g of c.globals) {
      if (!new RegExp('window\\.' + g + '\\b').test(ACTIONS)) continue; // not dispatcher-driven
      ok(`dashboard.html loads ${c.file} (dispatcher calls window.${g})`,
        new RegExp(c.file.replace('.', '\\.')).test(DASH));
      ok(`dashboard.legacy.html ALSO loads ${c.file} (shared dispatcher, guarded call)`,
        new RegExp(c.file.replace('.', '\\.')).test(LEGACY),
        'the guard makes the omission silent — no error, just no card');
    }
  }
  ok('#' + CONTAINER + ' exists on both dashboards',
    DASH.includes('id="' + CONTAINER + '"') && LEGACY.includes('id="' + CONTAINER + '"'));
}

// ── 3. The card render must be safe to call repeatedly ────────────────────
{
  const CARD = fs.readFileSync(path.join(PRO_JS, 'adjuster-tactic-card.js'), 'utf8');
  ok('the card find-or-creates its own host (re-mount is idempotent)',
    /getElementById\('adjusterTacticCard'\)/.test(CARD) && /createElement\('div'\)/.test(CARD),
    'a card that blindly appends would stack duplicates on every re-mount');
  ok('the card caches its callable result (re-mount must not re-fetch every time)',
    /_cache/.test(CARD) && /_inflight/.test(CARD));
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

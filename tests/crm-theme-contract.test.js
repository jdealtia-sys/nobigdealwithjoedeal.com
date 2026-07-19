/**
 * tests/crm-theme-contract.test.js — CRM theme-defect batch 1 invariants
 * (2026-07-19 visual audit).
 *
 * Root cause of the audit's hard defects: JS-rendered views guessing token
 * names that don't exist (--h) or hardcoding dark-tuned pastels/surfaces
 * that break in the 186-theme system's light variants. These guards pin the
 * fixes:
 *
 *  1. --h is defined (47 var(--h,#fff) sites rendered white-on-white in
 *     light mode before the alias).
 *  2. Toast collision: the legacy singleton .toast block is scoped to
 *     #toast so container toasts (the live ui.js system) keep their
 *     opacity/pointer-events. Verified live: before = opacity 0 +
 *     pointer-events none at t+1.2s; after = 1/auto.
 *  3. No dark-tuned pastel text literals on themed surfaces (the light-mode
 *     killers: #cab8ff, #5eead4, #a890e8, #a5b4fc).
 *  4. RAF rule (d2d-map-raf-fix): goTo() never wraps map/draw view-inits in
 *     requestAnimationFrame.
 *  5. Invoice modals tokenized (no #14161a panels, no z-index:100000 above
 *     the toast layer).
 *  6. Estimate Builder v2 + command palette follow theme tokens.
 *  7. prefers-reduced-motion blanket gate + focus-visible vocabulary +
 *     desktop pressed states exist in dashboard-app.css.
 *  8. portal.html aliases --green/--orange (portal.js references were
 *     silently invalid); close-board generated page defines --orange so its
 *     color-mix glow renders.
 *
 * Zero deps. Run: node tests/crm-theme-contract.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const P = (rel) => path.join(__dirname, '..', rel);
const read = (rel) => fs.readFileSync(P(rel), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('CRM THEME CONTRACT — batch 1 invariants');

// 1. --h alias
ok('theme-system defines --h (heading dialect alias)',
  /--h:\s*var\(--t\)/.test(read('docs/pro/css/theme-system.css')));

// 2. toast scoping
{
  const s = read('docs/pro/css/dashboard-app.css');
  ok('legacy singleton toast block is scoped to #toast',
    /#toast\.toast\{position:fixed/.test(s));
  const bare = s.match(/(^|\n)\.toast\{position:fixed/g) || [];
  ok('no bare .toast{position:fixed} rule remains', bare.length === 0);
  ok('container toasts have a warning border color',
    /\.toast\.toast-warning\{border-left-color:var\(--gold\)/.test(s));
  ok('mobile toast offset targets the container (not all .toast)',
    /\.toast-container, #toast\.toast \{ bottom:calc\(72px/.test(s));
}

// 3. pastel literals gone from the themed CRM surfaces
{
  const surfaces = [
    'docs/pro/js/crm-pipeline.js', 'docs/pro/customer.html',
    'docs/pro/js/notif-bell.js', 'docs/pro/js/activity-feed.js',
    'docs/pro/js/customer-ai-drafts-panel.js', 'docs/pro/js/customer-smart-followup-panel.js',
  ];
  const bad = [];
  for (const rel of surfaces) {
    const s = read(rel);
    for (const hex of ['#cab8ff', '#5eead4', '#a890e8', '#a5b4fc']) {
      if (s.includes(hex)) bad.push(rel + ':' + hex);
    }
  }
  ok('no dark-tuned pastel text literals on themed surfaces', bad.length === 0, bad.slice(0, 3).join(', '));
}

// 4. RAF rule
{
  const s = read('docs/pro/js/dashboard-actions.js');
  ok('goTo() does not wrap initMainMap/initDrawMap in requestAnimationFrame',
    !/requestAnimationFrame\(\(\)=>\{ initMainMap\(\)/.test(s)
    && !/requestAnimationFrame\(\(\)=>\{ initDrawMap\(\)/.test(s));
}

// 5. invoice modals
{
  const s = read('docs/pro/js/invoice-pipeline.js');
  ok('invoice modals use surface tokens (no #14161a panels)', !s.includes('#14161a') || /var\(--s,#14161a\)/.test(s));
  ok('invoice overlays stay below the toast layer (no z-index:100000+)',
    !/z-index:10000[01]/.test(s));
}

// 6. estimate-v2 + command palette tokenized
ok('estimate-v2 UI surfaces are tokenized',
  /var\(--s,#111418\)/.test(read('docs/pro/js/estimate-v2-ui.js'))
  && /var\(--orange,#e8720c\)/.test(read('docs/pro/js/estimate-v2-ui.js')));
ok('command palette surfaces are tokenized',
  /var\(--s,#0f1729\)/.test(read('docs/pro/js/command-palette.js')));

// 7. interaction polish block
{
  const s = read('docs/pro/css/dashboard-app.css');
  ok('prefers-reduced-motion blanket gate present',
    /@media \(prefers-reduced-motion: reduce\)\{\s*\*,\*::before,\*::after\{animation-duration:\.001ms/.test(s));
  ok('shared focus-visible vocabulary present',
    /:where\(\.btn,\.crm-sec-btn,\.kview-btn/.test(s) && /toggle-switch input:focus-visible/.test(s));
  ok('desktop pressed-state rule present',
    /:where\(\.btn,\.hdr-tool,[^)]*\):active\{transform:scale\(\.97\)\}/.test(s));
}

// 8. portal aliases + close-board token
ok('portal.html aliases --green/--orange to nbd-brand tokens',
  /--green: var\(--nbd-success\)/.test(read('docs/pro/portal.html'))
  && /--orange: var\(--nbd-orange\)/.test(read('docs/pro/portal.html')));
// #1005 upgraded the literal to the tenant-brand accent (NBD default kept
// as the _dealBrand fallback) — the invariant is that the generated page
// still DEFINES --orange so its color-mix glow resolves.
ok('close-board generated page defines --orange for its color-mix glow',
  /:root\{--orange:\$\{BRAND\.accent\};\}/.test(read('docs/pro/js/close-board.js'))
  && /accent = [^;]*'#e8720c'/.test(read('docs/pro/js/close-board.js')));
ok('portal Cal.com embed uses light theme', /embed=true&theme=light/.test(read('docs/pro/js/portal.js')));

// 9. misc regressions
ok('photo empty state uses an emoji icon, not the word "Camera"',
  !/pe-empty-icon">Camera</.test(read('docs/pro/js/photo-engine.js')));
ok('search placeholder uses the muted token',
  /\.search-row input::placeholder\{color:var\(--m/.test(read('docs/pro/css/dashboard-app.css')));
ok('collapsed sidebar rail is scrollable',
  /body\.sidebar-collapsed \.sidebar\{[^}]*overflow-y:auto/.test(read('docs/pro/css/kanban-force.css').replace(/\n/g, '')));

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

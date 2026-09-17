/**
 * tests/admin-project-codex-duplicate-ids-2026-09-16.test.js
 *
 * docs/admin/project-codex.html had two unrelated UI groups sharing the same
 * `sf-` prefix by coincidence: the search-filter buttons ("Search Filter":
 * id="sf-decisions"/"sf-loops"/"sf-files"/"sf-directives") and the Add
 * Session modal's form fields ("Session Form": the SAME four ids, plus
 * sf-title/sf-shipped which didn't collide). A page with duplicate ids means
 * getElementById() and any `for=`/`aria-*` reference resolves to whichever
 * element the browser happens to return first — here, the Session Form's
 * save-session handler (project-codex-app.js:475-478) reads
 * document.getElementById('sf-decisions') etc. expecting the FORM textarea,
 * which happened to still work only because the form fields are LATER in
 * document order (later same-id elements don't override getElementById's
 * first-match behavior in most engines, but relying on element ORDER for
 * correctness is exactly the kind of thing that silently breaks on any
 * markup reshuffle).
 *
 * Fix: the search-filter buttons (a self-contained group of 5, none of them
 * read by id anywhere except sf-all for the "on" reset) were renamed to
 * flt-* instead — the actively-read Session Form fields were left untouched
 * to minimize blast radius.
 *
 * Zero deps. Run: node tests/admin-project-codex-duplicate-ids-2026-09-16.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

const HTML = read('docs/admin/project-codex.html');
const APP_JS = read('docs/admin/js/project-codex-app.js');

console.log('admin/project-codex.html — no duplicate element ids\n');

group('the page as a whole has zero duplicate ids (not just the four reported)', () => {
  const ids = [...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const counts = new Map();
  ids.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
  const dupes = [...counts.entries()].filter(([, n]) => n > 1);
  ok('no id appears more than once', dupes.length === 0, dupes.map(([id, n]) => id + ' x' + n).join(', '));
});

group('the search-filter button group now uses flt-, not sf-', () => {
  ['flt-all', 'flt-decisions', 'flt-loops', 'flt-files', 'flt-directives'].forEach((id) => {
    ok('button ' + id + ' exists with data-action="toggle-search-filter"',
      new RegExp('class="search-filter[^"]*" id="' + id + '" data-action="toggle-search-filter"').test(HTML));
  });
  ['sf-decisions', 'sf-loops', 'sf-files', 'sf-directives'].forEach((id) => {
    ok('no search-filter button still carries the old id="' + id + '"',
      !new RegExp('class="search-filter[^"]*" id="' + id + '"').test(HTML));
  });
});

group('the Session Form fields keep their original sf- ids (untouched, minimal blast radius)', () => {
  ['sf-title', 'sf-shipped', 'sf-decisions', 'sf-loops', 'sf-files', 'sf-directives'].forEach((id) => {
    ok('form field id="' + id + '" is still present', new RegExp('id="' + id + '"').test(HTML));
  });
});

group('project-codex-app.js reads the FORM fields by their original sf- ids', () => {
  ok('save-session handler still reads sf-decisions/sf-loops/sf-files/sf-directives',
    /getElementById\('sf-decisions'\)/.test(APP_JS)
    && /getElementById\('sf-loops'\)/.test(APP_JS)
    && /getElementById\('sf-files'\)/.test(APP_JS)
    && /getElementById\('sf-directives'\)/.test(APP_JS));
  ok('the "all filters cleared" reset now reads the renamed flt-all, not sf-all',
    /getElementById\('flt-all'\)/.test(APP_JS));
  ok('no leftover getElementById(\'sf-all\') reference', !/getElementById\('sf-all'\)/.test(APP_JS));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }

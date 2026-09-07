/* customer-a11y-structure.test.js
 *
 * docs/pro/customer.html had no document outline and no labelled fields:
 *   - 0 <main>, 0 <nav>, 0 <h1>. The only headings were 5 <h3>, all inside
 *     modals — so a screen-reader user could not skip between the seven
 *     sections at all.
 *   - 11 <label> elements, ZERO with for=, and none of them WRAPPING their
 *     control either (each is a standalone `<label>Text</label>` followed by
 *     a sibling input), so implicit labelling did not save them. The fields
 *     were genuinely unnamed.
 *   - 8 .modal-bg dialogs, only 1 carrying role="dialog".
 *
 * The load-bearing assertion here is not "for= exists" but "for= points at an
 * id that exists" — a label pointing at nothing is worse than no label,
 * because it looks fixed.
 *
 * Deliberately NOT asserted: a focus trap. aria-modal advertises modality
 * that nbd-modal.js does not yet enforce. The role makes dialogs announce
 * correctly, which is strictly better than before, but trapping focus is a
 * separate change and pretending otherwise here would be a false green.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const HTML = read('docs/pro/customer.html');

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

group('The page has a document outline', () => {
  assert('a main landmark exists', /class="container" role="main"/.test(HTML),
    'added as a role on the existing .container rather than a new <main>, so DOM nesting — which the CSS is written against — is unchanged');
  assert('a navigation landmark exists',
    /<nav class="jump-nav" id="tabBar"[^>]*aria-label="/.test(HTML),
    'the section bar was a <div>, so the page had no nav landmark');
  assert('exactly one <h1>', (HTML.match(/<h1\b/g) || []).length === 1);
  assert('the h1 is the customer name',
    /<h1 class="customer-name" id="customerName">/.test(HTML));
  assert('and it closes as an h1', /<\/h1>/.test(HTML));
});

group('Every label names a control that exists', () => {
  const labels = [...HTML.matchAll(/<label\b([^>]*)>/g)].map((m) => m[1]);
  assert('labels found (fixture sanity)', labels.length >= 11, 'got ' + labels.length);

  const without = labels.filter((a) => !/\bfor="/.test(a));
  assert('no label is left unassociated', without.length === 0,
    without.length + ' label(s) without for=');

  // The real check: a for= pointing at nothing looks fixed and is not.
  const ids = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const dangling = labels
    .map((a) => (/\bfor="([^"]+)"/.exec(a) || [])[1])
    .filter(Boolean)
    .filter((f) => !ids.has(f));
  assert('every for= points at an id that exists', dangling.length === 0,
    dangling.length ? 'dangling: ' + dangling.join(', ') : '');

  // And that the target is actually a form control, not any old element.
  const badTarget = labels
    .map((a) => (/\bfor="([^"]+)"/.exec(a) || [])[1])
    .filter(Boolean)
    .filter((f) => !new RegExp('<(input|select|textarea)\\b[^>]*id="' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(HTML));
  assert('every for= targets a form control', badTarget.length === 0,
    badTarget.length ? 'not a control: ' + badTarget.join(', ') : '');
});

group('Modals announce themselves as dialogs', () => {
  const modals = [...HTML.matchAll(/<div([^>]*\bclass="modal-bg"[^>]*)>/g)].map((m) => m[1]);
  assert('modals found (fixture sanity)', modals.length >= 8, 'got ' + modals.length);

  const noRole = modals.filter((a) => !/role="dialog"/.test(a));
  assert('every .modal-bg carries role="dialog"', noRole.length === 0,
    noRole.length + ' without role');

  const noModal = modals.filter((a) => !/aria-modal="true"/.test(a));
  assert('every .modal-bg carries aria-modal', noModal.length === 0,
    noModal.length + ' without aria-modal');
});

group('Honest about what is still missing', () => {
  // If a focus trap ever lands, this assertion should be REPLACED by one that
  // pins it — not deleted. Failing here means someone added trapping and did
  // not update the suite, which is a good failure.
  const modal = read('docs/pro/js/nbd-modal.js');
  assert('nbd-modal still has no focus trap (aria-modal is a promise the code does not keep)',
    !/inert|focus-trap|focusTrap/.test(modal),
    'if trapping landed, replace this assertion with one that pins it');
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

/* portal-doc-modal-a11y-2026-09-16.test.js
 *
 * A 2026-09-07 recon flagged a focus trap gap on customer.html's modals
 * (aria-modal advertised, nothing enforcing it — tests/customer-a11y-
 * structure.test.js deliberately asserts the trap is STILL ABSENT there,
 * so fixing that one requires replacing that assertion in the same PR,
 * left for a separate session). Re-checking against CURRENT code found a
 * second, worse instance: the sandboxed document-viewer modal added to
 * docs/pro/portal.html the same day (2026-09-16, documents shelf) had NO
 * role, no aria-modal, and no focus trap at all — new code with the exact
 * same underlying defect, unblocked by any existing test.
 *
 * Fixed with the full treatment: role="dialog" + aria-modal + aria-
 * labelledby on the dialog box, focus moved in on open and restored to
 * the trigger on close, and a real Tab-key trap.
 *
 * The trap itself hit a genuine platform wall during manual verification
 * (live in the Browser pane, not assumed): once keyboard focus moves
 * INSIDE the sandboxed srcdoc iframe (no allow-same-origin, by design —
 * see the sandbox comment in portal.js), its keydown events fire in THAT
 * document, not the parent's, so a parent-level trap handler structurally
 * cannot observe Tab presses that happen while focus is inside it. First
 * implementation attempt included the iframe as a managed tab stop and
 * silently leaked focus to the page behind the backdrop the moment a user
 * tabbed into it — caught only by actually pressing Tab in a real browser
 * and checking document.activeElement, not by reading the code. Fixed by
 * excluding the iframe from the trap's tab stops (tabindex="-1") — a
 * provably-correct trap around one element beats an attempted trap that
 * silently fails at a boundary this repo can't control.
 *
 * This suite is source-shape assertions (the logic is DOM-interaction-
 * heavy, not a clean pure function to vm-lift) — the actual trap
 * correctness was verified live: opened the modal, pressed Tab three
 * times in a row, confirmed focus stayed on the close button every time
 * (not the naive "did it match a length-2 list" version, which escaped on
 * the very first Tab); pressed Escape and confirmed focus returned to the
 * "View" button that opened it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const PORTAL = read('docs/pro/js/portal.js');

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

const modalBlock = PORTAL.slice(PORTAL.indexOf('function _openDocModal'), PORTAL.indexOf('function _openDocModal') + 4500);

group('The doc-modal block is present and large enough to contain the whole feature', () => {
  assert('found _openDocModal', modalBlock.length > 100,
    'if this moved or shrank, update the slice range — do NOT delete the suite');
});

group('Accessible-modal semantics on the dialog box, not the backdrop', () => {
  assert('role="dialog" on .doc-modal', /class="doc-modal" role="dialog"/.test(modalBlock), modalBlock);
  assert('aria-modal="true"', /aria-modal="true"/.test(modalBlock), modalBlock);
  assert('aria-labelledby points at a real id on the title element',
    /aria-labelledby="docModalTitle"/.test(modalBlock) && /id="docModalTitle"/.test(modalBlock), modalBlock);
});

group('The iframe is deliberately excluded from the tab sequence, not accidentally', () => {
  assert('iframe has tabindex="-1"', /<iframe class="doc-modal-iframe" tabindex="-1"/.test(modalBlock), modalBlock);
  assert('the focusable() query does not independently match bare "iframe" (would re-include it despite tabindex=-1)',
    !/querySelectorAll\(\s*\n?\s*'button, \[href\], iframe,/.test(modalBlock), modalBlock);
});

group('Focus moves in on open and is restored to the trigger on close', () => {
  assert('captures document.activeElement as the trigger before opening',
    /_docModalTriggerEl = document\.activeElement/.test(modalBlock), modalBlock);
  assert('close() restores focus to the trigger',
    /_docModalTriggerEl[\s\S]{0,80}\.focus\(\)/.test(modalBlock), modalBlock);
  assert('opening moves focus to the close button',
    /doc-modal-close'\)\.focus\(\)/.test(modalBlock), modalBlock);
});

group('The trap always manages Tab itself — no boundary-only interception', () => {
  // The FIRST implementation only called e.preventDefault() inside an
  // if/else-if checking document.activeElement against first/last — that
  // version is exactly what silently failed against the sandboxed iframe.
  // Assert the CURRENT shape: an unconditional preventDefault on every Tab.
  const trapFn = modalBlock.slice(modalBlock.indexOf('_docModalTrapHandler = (e) => {'));
  assert('found the trap handler', trapFn.length > 50);
  assert('Escape closes the modal', /if \(e\.key === 'Escape'\)/.test(trapFn), trapFn.slice(0, 300));
  assert('every Tab press is preventDefault()-ed unconditionally (not only at a detected boundary)',
    /if \(e\.key !== 'Tab'\) return;\s*\n\s*const items = focusable\(\);\s*\n\s*if \(!items\.length\) return;\s*\n\s*e\.preventDefault\(\);/.test(trapFn),
    trapFn.slice(0, 400));
  assert('cycles by INDEX within the tracked list (not by comparing activeElement to a first/last reference)',
    /items\.indexOf\(document\.activeElement\)/.test(trapFn), trapFn.slice(0, 400));
});

group('The trap listener is re-armed on every open, not just the first build', () => {
  // A listener added only inside the `if (!_docModal)` first-build guard,
  // removed by close(), would silently stop working on a second open —
  // the modal DOM is a singleton reused across opens.
  const addIdx = modalBlock.indexOf("document.addEventListener('keydown', _docModalTrapHandler)");
  const firstBuildGuardEnd = modalBlock.indexOf('_docModal = overlay;');
  assert('the keydown listener is added AFTER the first-build guard closes, not inside it',
    addIdx > -1 && firstBuildGuardEnd > -1 && addIdx > firstBuildGuardEnd,
    'addEventListener at ' + addIdx + ', first-build guard ends at ' + firstBuildGuardEnd);
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

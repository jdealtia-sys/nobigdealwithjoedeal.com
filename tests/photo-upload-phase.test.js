/* photo-upload-phase.test.js
 *
 * Every photo uploaded from the customer page claimed to be already sorted.
 *
 * The upload path stamped `phase: window._uploadPhase || 'During'`, and
 * nothing could ever set _uploadPhase: its two selectors had zero callers,
 * and the four DOM ids they drove (#uploadPhaseButtons, #uploadMetaSection,
 * #uploadDamageType, #uploadLocation) were never written in ANY commit. So
 * the default WAS the value.
 *
 * That fabricated phase is not inert — it is read by the triage surface:
 *   pages/photo-review.js isReviewed()  ->  !!photo.phase
 *   its "unsorted" filter               ->  !phaseOf(p)
 *   phaseOf()                           ->  falls back to aiSuggestion.phase
 * so Review & Sort saw every one of those photos as already reviewed, and
 * the classifier's suggestion never surfaced. Photo phase is the insurance
 * supplement product.
 *
 * This suite runs the REAL photo-review predicates rather than asserting the
 * write in isolation — the write only matters because of what reads it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const BOOT = read('docs/pro/js/customer-bootstrap.module.js');
const TASKS = read('docs/pro/js/customer-tasks-ui.js');
const REVIEW = read('docs/pro/js/pages/photo-review.js');

/* Line-wise, deliberately.
 *
 * The obvious /\/\*[\s\S]*?\*\//g + line-comment pair CANNOT be used on these
 * files: they contain `/*`-looking sequences inside regex literals and
 * strings, so the block-comment pass swallowed thousands of lines of real
 * code. The first draft of this suite reported 24/25 with most assertions
 * passing VACUOUSLY against a near-empty string. Dropping whole
 * comment-only lines cannot over-delete; a trailing `// ...` left on a code
 * line is harmless here because every assertion below looks for code, not
 * for the absence of prose. */
const stripComments = (s) => s
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  })
  .join('\n');

const BOOT_CODE = stripComments(BOOT);
const TASKS_CODE = stripComments(TASKS);

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

/* ── why it matters: run the real triage predicates ── */
const preds = /function phaseOf\(photo\) \{[\s\S]*?\n\}/.exec(REVIEW);
const rev = /function isReviewed\(photo\) \{[\s\S]*?\n\}/.exec(REVIEW);

group('The triage surface really does key on a truthy phase', () => {
  assert('phaseOf found in pages/photo-review.js', !!preds);
  assert('isReviewed found', !!rev);
  if (!preds || !rev) return;

  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(preds[0] + '\n' + rev[0] + '\nthis.__phaseOf = phaseOf; this.__isReviewed = isReviewed;', sandbox);
  const phaseOf = sandbox.__phaseOf, isReviewed = sandbox.__isReviewed;

  const ai = { aiSuggestion: { phase: 'After' } };

  // The old behaviour, spelled out.
  assert('a fabricated "During" marks the photo reviewed',
    isReviewed({ phase: 'During' }) === true,
    'this is why the default was harmful, not cosmetic');
  assert('and it masks the AI suggestion',
    phaseOf(Object.assign({ phase: 'During' }, ai)) === 'During');
  assert('and it hides the photo from the unsorted filter',
    !phaseOf({ phase: 'During' }) === false);

  // The new behaviour.
  assert('a null phase is NOT reviewed', isReviewed({ phase: null }) === false);
  assert('a null phase lets the AI suggestion through',
    phaseOf(Object.assign({ phase: null }, ai)) === 'After');
  assert('a null phase appears in the unsorted filter',
    !phaseOf({ phase: null }) === true);
  assert('a rep-chosen phase still counts as reviewed',
    isReviewed({ phase: 'Before' }) === true);
});

group('Upload writes absence, not a fabricated phase', () => {
  assert('the upload payload writes phase: null',
    /phase: window\._uploadPhase \|\| null,/.test(BOOT_CODE));
  assert("it no longer defaults to 'During'",
    !/phase: window\._uploadPhase \|\| 'During'/.test(BOOT_CODE));
  assert("_uploadPhase itself defaults to '' (nothing can set it)",
    /window\._uploadPhase = '';/.test(TASKS_CODE));
});

group('The dead capture UI is gone rather than left looking functional', () => {
  for (const name of ['selectUploadPhase', 'selectUploadSeverity', '_uploadSeverity']) {
    assert('no ' + name + ' remains in code', !new RegExp('window\\.' + name + '\\b').test(TASKS_CODE + BOOT_CODE));
  }
  for (const id of ['uploadPhaseButtons', 'uploadMetaSection', 'uploadDamageType', 'uploadLocation']) {
    assert('no read of #' + id + ' remains',
      !new RegExp("['\"]#?" + id + "['\"]").test(TASKS_CODE + BOOT_CODE),
      'these ids were never written in any commit — reading them made dead code look alive');
  }
});

group('Editing a photo no longer re-stamps a phase the rep never chose', () => {
  const i = TASKS_CODE.indexOf('window.quickSaveMeta');
  const region = i === -1 ? '' : TASKS_CODE.slice(i, i + 1600);
  assert('quickSaveMeta found', i !== -1);

  assert('phase is omitted from updates unless the rep set it',
    /if \(phaseTouched\) updates\.phase = photo\.phase;/.test(region),
    'photoDocToView coerces d.phase || "During", so photo.phase is never falsy here');
  assert("the unconditional stamp is gone",
    !/phase: photo\.phase \|\| 'During'/.test(TASKS_CODE));
  assert('quickSetPhase is what sets the flag',
    /photo\._phaseTouched = true;/.test(TASKS_CODE));
  assert('and it records the previous value for the re-render decision',
    /photo\._phaseWas = photo\.phase;/.test(TASKS_CODE));
  assert('the flag is cleared after a save so the next edit starts clean',
    /photo\._phaseTouched = false;/.test(region));
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

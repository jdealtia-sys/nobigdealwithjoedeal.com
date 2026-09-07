/* photo-queue-remove-index.test.js
 *
 * The staged-photo remove button emitted its index as a trapped string:
 *
 *   data-arg=" + i + "        <- concatenation INSIDE the literal
 *
 * so every button carried the literal text ` + i + `. The data-action
 * delegate handed that to window.removeFromQueue, splice() coerced it to 0,
 * and tapping x on ANY staged photo removed the FIRST one. The correct
 * data-upload-idx="' + i + '" sat on the same line, which is what made it
 * survive review.
 *
 * This suite EXTRACTS the real emitting line from the module and runs it, so
 * it fails if the interpolation is ever re-trapped — rather than matching a
 * string that happens to look right.
 *
 * It also pins the sibling: the progress callback dereferences
 * window._uploadQueue[index] with a captured index while its own callee one
 * line below guards the identical read. Anything that shortens the queue
 * mid-upload made that throw inside Firebase's state_changed handler, killing
 * progress for an upload that was still running.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const BOOT = read('docs/pro/js/customer-bootstrap.module.js');
const HTML = read('docs/pro/customer.html');
const LEADSCORING = read('docs/pro/js/lead-scoring.js');

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

group('The remove button carries the real index', () => {
  const line = BOOT.split('\n').filter((l) => /data-action="removeFromQueue"/.test(l))[0];
  assert('found the emitting line', !!line);
  if (!line) return;

  // Run the actual expression for a few indices.
  const emit = (i) => {
    const sandbox = { html: '', i };
    vm.createContext(sandbox);
    vm.runInContext(line.trim(), sandbox);
    return sandbox.html;
  };

  for (const i of [0, 2, 7]) {
    const out = emit(i);
    const m = /data-arg="([^"]*)"/.exec(out);
    assert('index ' + i + ' emits data-arg="' + i + '"', !!m && m[1] === String(i),
      m ? 'got data-arg="' + m[1] + '"' : 'no data-arg in: ' + out);
  }

  // The specific historical failure: a literal, unexpanded ` + i + `.
  assert('the index is never emitted as a trapped literal',
    !/\+ i \+/.test(emit(3)),
    'got: ' + emit(3));

  // And prove the consequence is gone: splice() on the emitted value must
  // remove the tapped item, not item 0.
  const arg = /data-arg="([^"]*)"/.exec(emit(2))[1];
  const queue = ['a', 'b', 'c', 'd'];
  queue.splice(arg, 1);
  assert('splice(emitted, 1) removes the tapped photo, not the first',
    queue.join('') === 'abd', 'got ' + queue.join(''));
});

group('The progress callback no longer dereferences a stale index', () => {
  const i = BOOT.indexOf('bytesTransferred / snapshot.totalBytes');
  const region = i === -1 ? '' : BOOT.slice(i, i + 900);
  assert('found the progress callback', i !== -1);
  assert('the queue slot is guarded before write',
    /if \(window\._uploadQueue\?\.\[index\]\) window\._uploadQueue\[index\]\.progress = progress;/.test(region),
    'kept to ONE line deliberately — smoke/crm.test.js:332 needs updateUploadPreviewItem(index) within 400 chars of the handler, and a three-line guard put it at 456');
  // The guarded line legitimately CONTAINS the old text as its consequent, so
  // a whole-file "substring absent" check can never pass. Assert per line
  // instead: every write to that slot must sit behind the guard on its line.
  const writes = BOOT.split('\n').filter((l) => /_uploadQueue\[index\]\.progress\s*=/.test(l));
  assert('at least one write exists (fixture sanity)', writes.length > 0);
  assert('every write to the slot is guarded on its own line',
    writes.every((l) => /if \(window\._uploadQueue\?\.\[index\]\)/.test(l)),
    'unguarded: ' + writes.filter((l) => !/if \(window\._uploadQueue\?\.\[index\]\)/.test(l)).map((l) => l.trim()).join(' | '));
});

group('The dead lead-scoring panel is gone, and the trap is documented', () => {
  assert('no #leadScoringPanel container in the markup',
    !/id="leadScoringPanel"/.test(HTML));
  // Strip comments: the replacement note names the removed call verbatim so
  // the next reader knows what used to be here, and matching that would make
  // this assertion permanently red.
  const bootCode = BOOT
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  assert('no call to LeadScoring.renderScorePanel anywhere',
    !/LeadScoring[?.]*\.renderScorePanel\s*\(/.test(bootCode));
  // Removing the call site without a note would make the trap HARDER to find:
  // a fully-armed 50-line renderer stays loaded, inviting a future session to
  // "mount the missing panel" and ship two disagreeing lead scores.
  assert('lead-scoring.js explains why its panel is unmounted',
    /NOT MOUNTED ANYWHERE, on purpose/.test(LEADSCORING));
  assert('the note names the two-scores hazard',
    /two disagreeing 0-100/.test(LEADSCORING));
  // LeadScoring itself must survive — hot-leads-widget calls scoreAll().
  assert('window.LeadScoring is still exported', /window\.LeadScoring\s*=/.test(LEADSCORING));
  assert('scoreAll is still exported (hot-leads-widget depends on it)',
    /scoreAll/.test(LEADSCORING));
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

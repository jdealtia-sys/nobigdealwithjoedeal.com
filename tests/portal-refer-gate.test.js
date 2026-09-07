/* portal-refer-gate.test.js
 *
 * Refer-a-friend must not claim work that has not happened.
 *
 * The card was gated on `customerId` alone. customerId is stamped early in
 * the lead lifecycle, so a homeowner who opened the portal the same
 * afternoon the rep knocked was handed SMS copy reading "They did a great
 * job for me" and email copy reading "the guys who did mine were great",
 * addressed to their friends. It is the one card designed to leave the
 * property, so it is the most embarrassing thing on the page if forwarded
 * before anything happened — and it poisons the referral channel it exists
 * to grow.
 *
 * The correct gate already existed for the rating card: the server computes
 * progressKey and sets rating.canRate = (progressKey === 'complete'),
 * re-enforced when a rating is submitted. Both cards assert the work is
 * done, so both wait until it is.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const PORTAL_JS = read('docs/pro/js/portal.js');
const PORTAL_FN = read('functions/portal.js');

// Comments quote the old copy to explain the fix; assert against code.
const CODE = PORTAL_JS
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

group('The card still exists and still says what it says', () => {
  // If this copy ever softens, the gate could legitimately relax — so pin
  // the premise rather than silently guarding a card that no longer claims
  // completed work.
  assert('SMS copy still asserts completed work',
    /They did a great job for me/.test(CODE),
    'if the copy changed, re-derive the correct gate before touching this suite');
  assert('email copy still asserts completed work',
    /the guys who did mine were great/.test(CODE));
  assert('the referral card is still rendered here', /Refer a friend/.test(CODE));
});

group('It renders only when the job is complete', () => {
  assert('a jobComplete flag is derived from progress.currentKey',
    /const jobComplete = !!\(view\.progress && view\.progress\.currentKey === 'complete'\);/.test(CODE));
  assert('the gate requires BOTH a referral code and completion',
    /if \(customerId && jobComplete\) \{/.test(CODE));
  assert('customerId alone no longer gates it',
    !/const customerId = view\.homeowner && view\.homeowner\.customerId;\s*if \(customerId\) \{/.test(CODE),
    'this is the exact shape that shipped the bug');
});

group("'complete' is a real progress key, not a guess", () => {
  assert('the server defines a complete milestone', /key: 'complete'/.test(PORTAL_FN));
  assert('and computes progressKey', /progressKey/.test(PORTAL_FN));
  assert('the rating card uses the same completion notion',
    /canRate: progressKey === 'complete'/.test(PORTAL_FN),
    'refer + rate should agree; if this moves, move the referral gate with it');
  assert('progress.currentKey is what the client receives',
    /currentKey:\s*progressKey/.test(PORTAL_FN));
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

/* customer-estimates-global.test.js
 *
 * docs/pro/customer.html writes window._customerEstimates. The follow-up
 * engines — customer-viewed-chip, customer-engagement-score, lead-score-panel
 * (via NBDLeadScore) and smart-followup — all read window._estimates, which
 * ONLY dashboard-bootstrap.module.js writes, and customer.html does not load
 * that file. So on the customer record the global was undefined and every
 * engine silently read [].
 *
 * The damage is not merely a lost signal. smart-followup falls through to its
 * stale-share branch and tells the rep the estimate link was "never opened" —
 * an assertion that is false — on exactly the leads whose homeowner has been
 * reading it. This suite runs the REAL engine in a vm to prove the headline
 * flips, rather than matching source strings.
 *
 * Three write sites must all be covered, because a miss on any one silently
 * restores the bug:
 *   • the success path (the alias)
 *   • the empty-result early return (or a lead with no estimates inherits the
 *     previous lead's array — loadEstimates is re-invoked by setPrimaryEstimate)
 *   • the catch (a rules denial on the company-scope query for
 *     company_admin/manager/viewer throws the whole function)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const BOOT = read('docs/pro/js/customer-bootstrap.module.js');
const SF = read('docs/pro/js/smart-followup.js');

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

/* ── behaviour: run the real smart-followup engine ── */
function suggest(estimates) {
  const window = {};
  if (estimates !== undefined) window._estimates = estimates;
  const sandbox = { window, console, Date, Math, JSON, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SF, sandbox);

  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const lead = {
    id: 'lead-1',
    firstName: 'Sarah',
    stage: 'Estimate Sent',
    lastSharedAt: new Date(now - 6 * DAY).toISOString(),
    updatedAt: new Date(now - 3 * DAY).toISOString(),
    createdAt: new Date(now - 20 * DAY).toISOString(),
  };
  return window.SmartFollowup.computeSuggestion(lead);
}

const DAY = 24 * 60 * 60 * 1000;
const VIEWED = [
  { id: 'e1', leadId: 'lead-1', viewedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() },
  { id: 'e2', leadId: 'lead-1', viewedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString() },
];

group('The engine is genuinely sensitive to window._estimates', () => {
  const blind = suggest(undefined);   // today's customer.html
  const seeing = suggest(VIEWED);     // with the alias in place

  assert('blind engine returns a suggestion at all', !!blind && !!blind.headline,
    'if this is null the fixture no longer reaches a branch — fix the fixture, not the assertion');
  assert('seeing engine returns a suggestion at all', !!seeing && !!seeing.headline);

  assert('WITHOUT the global the engine asserts the link was never opened',
    !!blind && /never opened/.test(blind.headline),
    blind ? 'got: ' + blind.headline : '');
  assert('WITH the global it reports the views instead',
    !!seeing && /viewed your estimate/.test(seeing.headline),
    seeing ? 'got: ' + seeing.headline : '');
  assert('the two headlines actually differ',
    !!blind && !!seeing && blind.headline !== seeing.headline);
  // The field is `priority` (smart-followup.js:263), not `urgency`.
  assert('and the priority rises rather than staying flat',
    !!blind && !!seeing && blind.priority !== seeing.priority && seeing.priority === 'urgent',
    blind && seeing ? blind.priority + ' -> ' + seeing.priority : '');
  assert('the recommended action changes too',
    !!blind && !!seeing && blind.action !== seeing.action,
    blind && seeing ? blind.action + ' -> ' + seeing.action : '');
});

/* ── the three write sites ── */
group('customer.html populates the global on every exit path', () => {
  // Slice to the function's real end rather than a fixed window: the body is
  // ~9,185 chars and a 9,000-char window silently missed the catch block,
  // which is exactly the exit path most likely to be forgotten.
  const i = BOOT.indexOf('async function loadEstimates(');
  const end = BOOT.indexOf('// ── W146: Share estimate view link', i);
  assert('loadEstimates found', i !== -1);
  assert('and its end marker found (slice is not silently truncated)', end > i);
  const fn = i === -1 ? '' : BOOT.slice(i, end > i ? end : i + 20000);

  assert('success path aliases _customerEstimates onto _estimates',
    /window\._estimates = window\._customerEstimates;/.test(fn));

  assert('empty-result early return clears BOTH globals',
    /No estimates yet[\s\S]{0,400}window\._customerEstimates = \[\];\s*\n\s*window\._estimates = \[\];\s*\n\s*return;/.test(fn),
    'otherwise a lead with no estimates inherits the previous lead(s) array');

  // Window is generous on purpose: the explanatory comment between the catch
  // and the assignment is ~400 chars on its own, and a tight window failed
  // here while the code was correct.
  assert('the catch sets it too',
    /catch \(e\) \{[\s\S]{0,1200}window\._estimates = window\._customerEstimates \|\| \[\];/.test(fn),
    'a rules denial on the company-scope query throws the whole function');

  assert('a recompute is dispatched so the panels do not sit on their first empty read',
    /nbd:data-refreshed/.test(fn),
    'lead-score-panel attaches on _customerId, set long before estimates resolve');
});

group('The fix is one file, not four consumers', () => {
  // Editing the four engines to read (_customerEstimates || _estimates) would
  // also change modules dashboard.html loads, and still leaves the customer
  // page with no recompute trigger after the fetch lands.
  for (const rel of [
    'docs/pro/js/customer-viewed-chip.js',
    'docs/pro/js/customer-engagement-score.js',
    'docs/pro/js/smart-followup.js',
  ]) {
    assert(path.basename(rel) + ' still reads window._estimates (unchanged)',
      /window\._estimates/.test(read(rel)));
  }
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

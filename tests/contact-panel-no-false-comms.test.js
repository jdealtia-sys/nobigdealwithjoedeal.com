/* contact-panel-no-false-comms.test.js
 *
 * The customer page's "CONTRACTOR INFO & QUICK CONTACT" panel
 * (docs/pro/customer.html) dials the TENANT'S OWN number — setupContactTab()
 * stamps #contactCallBtn / #contactTextBtn / #contactEmailBtn from the brand
 * phone/email, never from the lead.
 *
 * Those three anchors used to carry onclick handlers writing
 * "Called <customer> at <lead.phone>" into the communications collection: an
 * outbound customer conversation that never happened, at a number that was
 * not the one dialled. The rows are not inert — they surface in the Overview
 * timeline's Calls & Texts pill and feed the follow-up signals, so the CRM's
 * "when did we last reach this customer" drifted every time the page was used.
 *
 * Two things must hold, and they fail in opposite directions:
 *   1. No dedicated handler may log for these three ids.
 *   2. They must KEEP data-nbd-log-skip="1" — without it the capture-phase
 *      delegate in crm-snooze.js matches any <a href="tel:"> and writes its
 *      own "Contacted customer" row instead. Deleting the handlers without
 *      the flag swaps one false row for another.
 *
 * The customer-facing buttons (#callLink / #emailLink, resolved from
 * lead.phone / lead.email) SHOULD still log, so this suite also pins that —
 * otherwise "remove all the logging" would read as a fix.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const BOOT = read('docs/pro/js/customer-bootstrap.module.js');
const TASKS = read('docs/pro/js/customer-tasks-ui.js');
const SNOOZE = read('docs/pro/js/crm-snooze.js');
const HTML = read('docs/pro/customer.html');

const CONTRACTOR_IDS = ['contactCallBtn', 'contactTextBtn', 'contactEmailBtn'];
const CUSTOMER_IDS = ['callLink', 'emailLink'];

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

/* Strip block + line comments so a comment that merely NAMES an id and
 * mentions logCommunication can't satisfy or trip these assertions. */
function stripComments(src) {
  return src
    // Line-wise: a /\*...\*/ regex swallows real code in these files (they
    // contain comment-looking sequences inside regex literals and strings —
    // measured 10-48% of the file destroyed), which makes ABSENCE assertions
    // pass against a corpus that no longer holds the region they guard.
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}
const BOOT_CODE = stripComments(BOOT);
const TASKS_CODE = stripComments(TASKS);

group('The contractor buttons exist and are brand-resolved (premise of the whole suite)', () => {
  for (const id of CONTRACTOR_IDS) {
    assert('markup hosts #' + id, HTML.includes('id="' + id + '"'));
  }
  assert('setupContactTab resolves them from the brand phone, not the lead',
    /const phone = _isNbd \? '\(859\) 420-7382' : \(\(_b\.contact && _b\.contact\.phone\) \|\| ''\)/.test(TASKS_CODE),
    'if this changed, re-check whether these buttons still dial the contractor');
  assert('no lead.phone / lead.email anywhere in setupContactTab',
    !/setupContactTab[\s\S]{0,1600}lead\.(phone|email)/.test(TASKS_CODE));
});

group('No dedicated handler logs a customer communication for a contractor button', () => {
  // Key on getElementById('<id>') rather than the bare id. The three ids also
  // appear as strings in the nbdLogSkip array literal, and a naive window
  // forward from THAT runs straight into the header (#callLink) handlers,
  // which legitimately log — the first draft of this suite failed six
  // assertions for exactly that reason.
  for (const id of CONTRACTOR_IDS) {
    const lookup = "getElementById('" + id + "')";
    const sites = [];
    let from = 0, i;
    while ((i = BOOT_CODE.indexOf(lookup, from)) !== -1) { sites.push(i); from = i + 1; }

    let offender = null, bound = null;
    for (const at of sites) {
      const region = BOOT_CODE.slice(at, at + 500);
      if (!offender && /logCommunication\s*\(/.test(region)) offender = region.slice(0, 220);
      if (!bound && /\.onclick\s*=|addEventListener\s*\(\s*['"]click/.test(region)) bound = region.slice(0, 200);
    }

    assert('#' + id + ' is never looked up to attach behaviour in customer-bootstrap',
      sites.length === 0,
      sites.length ? sites.length + ' getElementById site(s) — a handler may have been re-added' : '');
    assert('#' + id + ' never reaches logCommunication()', offender === null,
      offender ? 'found: ' + offender.replace(/\s+/g, ' ') : '');
    assert('#' + id + ' has no click handler bound in customer-bootstrap', bound === null,
      bound ? 'found: ' + bound.replace(/\s+/g, ' ') : '');
  }
});

group('They keep the delegate opt-out (or the delegate logs its own false row)', () => {
  const arr = BOOT_CODE.match(/\[([^\]]*?)\]\.forEach\(i => \{[\s\S]{0,180}nbdLogSkip/);
  assert('the nbdLogSkip list exists', !!arr);
  for (const id of CONTRACTOR_IDS) {
    assert('#' + id + " is in the nbdLogSkip list", !!arr && arr[1].includes("'" + id + "'"));
  }
  assert('crm-snooze delegate still honours the flag',
    /dataset\.nbdLogSkip === '1'\) return;/.test(SNOOZE));
  assert('crm-snooze delegate still matches tel: links (so the flag is load-bearing)',
    /typeFromHref/.test(SNOOZE) && /a\[href\]/.test(SNOOZE));
});

group('The customer-facing header buttons still log (the fix must not be "log nothing")', () => {
  for (const id of CUSTOMER_IDS) {
    const i = BOOT_CODE.indexOf("getElementById('" + id + "')");
    const region = i === -1 ? '' : BOOT_CODE.slice(i, i + 600);
    assert('#' + id + ' still logs a communication', /logCommunication\s*\(/.test(region));
  }
  assert('header buttons resolve from the lead, not the brand',
    /getElementById\('callLink'\)\.href = `tel:\$\{String\(lead\.phone\)/.test(BOOT_CODE));
});

group('The buttons say who they call', () => {
  assert('setupContactTab sets an aria-label naming the company',
    /setAttribute\('aria-label', verb \+ ' ' \+ _who\)/.test(TASKS_CODE));
  assert('and a title disambiguating from the customer',
    /not the customer/.test(TASKS));
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

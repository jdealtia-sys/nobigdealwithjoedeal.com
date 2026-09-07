/* customer-jump-nav-order.test.js
 *
 * The jump-nav on docs/pro/customer.html listed its sections in one order
 * while the markup laid them out in another:
 *
 *   nav: overview, photos, documents, voice, messages, timeline, contact
 *   DOM: overview, timeline, photos, documents, messages, voice, contact
 *
 * The scroll-spy in customer-tasks-ui.js maps each section id to its link and
 * toggles .active on intersection, so scrolling in a straight line lit the
 * pills 1, 6, 2, 3, 5, 4, 7 — the highlight bounced around the bar.
 *
 * Separately, #navCountTasks ("Open tasks") sat on the Timeline pill. The
 * Timeline SECTION renders stage milestones (#projectTimeline); the
 * interactive list that holds tasks is #timelineList, inside OVERVIEW. The
 * badge counted work living behind a different pill.
 *
 * This suite derives BOTH orders from the file and compares them, rather than
 * hardcoding a list that would rot the moment a section is added.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const HTML = read('docs/pro/customer.html');
const TASKS = read('docs/pro/js/customer-tasks-ui.js');

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

/* nav link order */
const navBlock = /<div class="jump-nav" id="tabBar">([\s\S]*?)<\/div>/.exec(HTML);
const navOrder = navBlock
  ? [...navBlock[1].matchAll(/href="#([a-zA-Z]+Tab)"/g)].map((m) => m[1])
  : [];

/* section order, in the order the markup declares them */
const domOrder = [...HTML.matchAll(/id="([a-zA-Z]+Tab)"/g)]
  .map((m) => m[1])
  .filter((id, i, a) => a.indexOf(id) === i)   // first declaration wins
  .filter((id) => navOrder.includes(id));      // ignore ids the nav doesn't link

group('Both orders are derivable (fixture sanity)', () => {
  assert('jump-nav block found', !!navBlock);
  assert('nav links found', navOrder.length >= 7, 'got ' + navOrder.length);
  assert('sections found', domOrder.length === navOrder.length,
    'nav=' + navOrder.length + ' dom=' + domOrder.length +
    ' — a nav link with no section (or vice versa) is its own bug');
});

group('The nav lists sections in the order the page shows them', () => {
  assert('nav order === DOM order',
    navOrder.join(',') === domOrder.join(','),
    'nav: ' + navOrder.join(' ') + '\n      dom: ' + domOrder.join(' ') +
    '\n      the scroll-spy highlights by section id, so a mismatch makes the ' +
    'active pill jump around while the rep scrolls one way');
});

group('The scroll-spy really does key on these links', () => {
  // If the spy stops mapping ids to links, the ordering constraint above
  // becomes cosmetic — so fail loudly rather than guarding a dead rule.
  assert('spy reads the jump-nav', /querySelector\('\.jump-nav'\)/.test(TASKS));
  assert('spy maps section ids to links', /document\.getElementById\(id\)/.test(TASKS));
  assert('spy toggles .active on intersection',
    /classList\.remove\('active'\)/.test(TASKS) && /IntersectionObserver/.test(TASKS));
});

group('The open-task badge sits on the pill that holds the tasks', () => {
  const overviewLink = /<a href="#overviewTab">[\s\S]*?<\/a>/.exec(navBlock ? navBlock[1] : '');
  const timelineLink = /<a href="#timelineTab">[\s\S]*?<\/a>/.exec(navBlock ? navBlock[1] : '');
  assert('overview link found', !!overviewLink);
  assert('timeline link found', !!timelineLink);

  assert('navCountTasks is on the Overview pill',
    !!overviewLink && /id="navCountTasks"/.test(overviewLink[0]));
  assert('and not on the Timeline pill',
    !!timelineLink && !/id="navCountTasks"/.test(timelineLink[0]),
    'the Timeline section renders stage milestones, not tasks');

  // The premise: tasks really do render inside Overview.
  const overviewStart = HTML.indexOf('id="overviewTab"');
  const timelineStart = HTML.indexOf('id="timelineTab"');
  const timelineListAt = HTML.indexOf('id="timelineList"');
  assert('#timelineList (the task list) is inside the Overview section',
    overviewStart !== -1 && timelineListAt > overviewStart &&
    (timelineStart === -1 || timelineListAt < timelineStart),
    'if tasks move, move the badge with them');
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

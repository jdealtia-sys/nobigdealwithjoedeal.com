/**
 * tests/push-notification-actions.test.js
 *
 * WHY THIS EXISTS
 * ───────────────
 * Two bugs, both silent, both found on 2026-09-05 while adding action buttons:
 *
 * 1. docs/pro/firebase-messaging-sw.js's notificationclick handler never
 *    looked at `event.action`. getNotificationActions had been declaring a
 *    "Dismiss" button since it shipped, and pressing it NAVIGATED, exactly
 *    like tapping the notification body.
 *
 * 2. The same handler called `client.navigate(clickUrl)`. This worker is
 *    registered at scope '/pro/firebase-cloud-messaging-push-scope' —
 *    deliberately NOT '/pro/', which sw.js owns (push-registration.js:11,46).
 *    A worker may only navigate clients its own registration controls, so the
 *    call ALWAYS rejected: with the CRM already open, tapping a push did
 *    nothing whatsoever, and the rejection died inside waitUntil where nobody
 *    would ever see it.
 *
 * Neither had a test, and neither produces an error a user could report — the
 * notification just sits there. So the decision is now a pure function and
 * every branch is pinned here, along with the invariant that the worker's
 * button list and the server's stay identical (they are rendered by different
 * things depending on the push, and drift means the same alert shows different
 * buttons).
 *
 * Pure Node — the worker is loaded in a vm with stubbed service-worker
 * globals. Run: node tests/push-notification-actions.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
// Strip LINE comments FIRST, then block comments — not the other way round.
// push-functions.js contains the line comment "// /pro/images/* does NOT
// exist"; that `/*` opens a fake block comment for the usual
// block-then-line stripper, which then swallows ~20 lines of real code up to
// the next `*/`. Assertions over the result silently pass or fail on text that
// was never a comment. (Found 2026-09-05 while writing this file.)
const codeOnly = (s) => s.replace(/^\s*\/\/.*$/mg, '').replace(/\/\*[\s\S]*?\*\//g, '');

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); failed++; fails.push(label); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Load the service worker with service-worker globals stubbed ──────────
const SW_PATH = path.join(ROOT, 'docs', 'pro', 'firebase-messaging-sw.js');
const swSrc = fs.readFileSync(SW_PATH, 'utf8');

const listeners = {};
const sandbox = {
  importScripts() {},                       // gstatic imports — no network in a test
  firebase: {
    initializeApp() {},
    messaging: () => ({ onBackgroundMessage() {} }),
  },
  console: { log() {}, warn() {}, error() {} },
  clients: {},                              // replaced per-case below
  JSON, String, Object, Array, Promise, Date, RegExp, Error,
};
sandbox.self = {
  addEventListener: (ev, fn) => { listeners[ev] = fn; },
  registration: { showNotification() {} },
  skipWaiting() {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(swSrc, sandbox, { filename: 'firebase-messaging-sw.js' });

const resolve = sandbox.resolveNotificationAction;
const swActions = sandbox.getNotificationActions;

console.log('\nLOADS');
ok('the worker evaluates outside a service-worker runtime', typeof resolve === 'function');
ok('it registered a notificationclick handler', typeof listeners.notificationclick === 'function');
ok('getNotificationActions is present', typeof swActions === 'function');

console.log('\nTHE DECISION — every branch of a notification tap');
{
  const data = { clickUrl: '/pro/dashboard.html?tab=leads&leadId=L1', leadId: 'L1', phone: '(513) 555-1234' };

  ok('tapping the BODY navigates to the click URL',
     same(resolve('', data), { kind: 'navigate', url: data.clickUrl }));
  ok('"view" navigates the same way',
     same(resolve('view', data), { kind: 'navigate', url: data.clickUrl }));

  // Bug 1. Before this fix, "Dismiss" navigated.
  ok('"dismiss" closes and does NOTHING else', same(resolve('dismiss', data), { kind: 'close' }));

  const call = resolve('call', data);
  ok('"call" dials the lead', call.kind === 'call');
  ok('...with punctuation stripped from the number', call.phone === '5135551234');
  ok('...and keeps the lead URL as its fallback', call.url === data.clickUrl);
  ok('"call" with no phone on the payload opens the lead rather than doing nothing',
     same(resolve('call', { clickUrl: '/pro/x' }), { kind: 'navigate', url: '/pro/x' }));
  ok('a phone in +E.164 form survives', resolve('call', { phone: '+15135551234' }).phone === '+15135551234');

  const snooze = resolve('snooze', data);
  ok('"snooze" carries the lead id (the worker has no auth session to write with)',
     snooze.kind === 'snooze' && snooze.leadId === 'L1');

  ok('an unknown action falls back to navigating, never to nothing',
     same(resolve('somethingNew', data), { kind: 'navigate', url: data.clickUrl }));
  ok('missing data still yields a usable default',
     same(resolve('', undefined), { kind: 'navigate', url: '/pro/dashboard.html' }));
}

(async () => {
console.log('\nTHE HANDLER — never client.navigate(), because it always rejects here');
{
  const src = codeOnly(swSrc);
  // Bug 2, pinned at the source: this worker's scope is not the app's scope,
  // so navigate() on an app window can only ever reject.
  ok('client.navigate is gone from the worker entirely', !/\.navigate\s*\(/.test(src));
  ok('an open window is asked to route itself by postMessage', /postMessage\(\{/.test(src) && /NBD_PUSH_ACTION/.test(src));
  ok('a closed app is handled with openWindow (which is scope-safe)', /clients\.openWindow\(/.test(src));

  // Drive the real handler with a fake clients registry.
  async function click(action, data, windows) {
    const calls = { opened: [], posted: [], focused: 0 };
    sandbox.clients = {
      matchAll: async () => (windows || []).map((url) => ({
        url,
        focus: async () => { calls.focused++; },
        postMessage: (m) => calls.posted.push(m),
      })),
      openWindow: async (u) => { calls.opened.push(u); return { url: u }; },
    };
    let waited = null;
    await listeners.notificationclick({
      action,
      notification: { data, close() { calls.closed = true; } },
      waitUntil: (p) => { waited = p; },
    });
    if (waited) await waited;
    return calls;
  }

  const D = { clickUrl: '/pro/dashboard.html?leadId=L1', leadId: 'L1', phone: '5135551234' };

  const openApp = await click('', D, ['https://x/pro/dashboard.html']);
  ok('the notification is always closed first', openApp.closed === true);
  ok('with the app open: it focuses and posts, and opens no new window',
     openApp.focused === 1 && openApp.opened.length === 0 && openApp.posted.length === 1);
  ok('...the message tells the page where to go',
     openApp.posted[0].type === 'NBD_PUSH_ACTION' && openApp.posted[0].action === 'navigate'
     && openApp.posted[0].url === D.clickUrl);

  const closedApp = await click('', D, []);
  ok('with nothing open: it opens the lead', same(closedApp.opened, [D.clickUrl]));

  const dismissed = await click('dismiss', D, ['https://x/pro/dashboard.html']);
  ok('"dismiss" opens nothing and posts nothing',
     dismissed.opened.length === 0 && dismissed.posted.length === 0 && dismissed.closed === true);

  const called = await click('call', D, ['https://x/pro/dashboard.html']);
  ok('"call" opens a tel: URL even when the app is already open',
     called.opened[0] === 'tel:5135551234');

  const snoozedOpen = await click('snooze', D, ['https://x/pro/dashboard.html']);
  ok('"snooze" with the app open hands the lead id to the page',
     snoozedOpen.posted[0].action === 'snooze' && snoozedOpen.posted[0].leadId === 'L1');
  const snoozedClosed = await click('snooze', D, []);
  ok('"snooze" with nothing open carries the intent in the URL',
     /pushAction=snooze/.test(snoozedClosed.opened[0]));
  ok('...appended with & when the URL already has a query',
     snoozedClosed.opened[0].indexOf('?leadId=L1&pushAction=snooze') > 0);

  // A window that is not the CRM must not be hijacked.
  const otherSite = await click('', D, ['https://example.com/other']);
  ok('a non-/pro/ window is ignored, and a new one is opened instead',
     otherSite.posted.length === 0 && same(otherSite.opened, [D.clickUrl]));

  // focus() rejecting must not swallow the whole click.
  sandbox.clients = {
    matchAll: async () => [{
      url: 'https://x/pro/dashboard.html',
      focus: async () => { throw new Error('not allowed'); },
      postMessage: (m) => { sandbox.__posted = m; },
    }],
    openWindow: async () => null,
  };
  let waited2 = null;
  await listeners.notificationclick({
    action: '', notification: { data: D, close() {} }, waitUntil: (p) => { waited2 = p; },
  });
  await waited2;
  ok('a rejected focus() still delivers the message (it is advisory)',
     sandbox.__posted && sandbox.__posted.action === 'navigate');
}

console.log('\nBUTTON LISTS — worker and server must not drift');
{
  // Requiring push-functions runs getFirestore() at module load.
  // push-functions.js calls getFirestore() at module load, so an app must
  // exist first. `admin.apps` was REMOVED in firebase-admin v12+ (the same
  // accessor removal that broke two scripts on 2026-09-01), so initialize
  // defensively rather than probing for it.
  const admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  try { admin.initializeApp({ projectId: 'demo-nbd' }); }
  catch (e) { /* already initialized — fine */ }
  const push = require(path.join(ROOT, 'functions', 'push-functions.js'));
  const serverActions = push.notificationActionsFor;
  ok('the server exports its action list', typeof serverActions === 'function');

  for (const type of ['newLead', 'appointmentReminder', 'followUpDue', 'claimUpdate', 'teamActivity', undefined]) {
    ok('worker and server agree for ' + (type || '(default)'),
       same(swActions(type), serverActions(type)),
       JSON.stringify({ sw: swActions(type), server: serverActions(type) }));
  }

  const nl = serverActions('newLead');
  ok('a new lead offers Call first — the roofer\'s actual first move',
     nl[0].action === 'call' && nl[0].title === 'Call');
  ok('every action has both an id and a visible title',
     [].concat(nl, serverActions('followUpDue'), serverActions('x'))
       .every((a) => a.action && a.title));
  // Chrome renders at most two on most surfaces, but declaring three is legal
  // and degrades by truncation rather than by breaking.
  ok('no list exceeds three buttons',
     [nl, serverActions('followUpDue'), serverActions('x')].every((l) => l.length <= 3));
}

console.log('\nSERVER PAYLOAD — the parts a wrong value makes silently fail');
{
  const src = codeOnly(fs.readFileSync(path.join(ROOT, 'functions', 'push-functions.js'), 'utf8'));
  ok('actions ride on the webpush notification, not only in the worker',
     /actions: notificationActionsFor\(data\.type\)/.test(src));
  // FCM rejects the ENTIRE send if any data value is not a string, so a lead
  // with no name would otherwise mean no push at all.
  ok('every data value is coerced to a string before sending',
     /stringData\[k\] = String\(v\)/.test(src));
  ok('null and undefined are dropped rather than stringified to "undefined"',
     /if \(v === undefined \|\| v === null\) continue;/.test(src));
  ok('the coerced object is what actually gets sent (both data blocks)',
     (src.match(/\.\.\.stringData/g) || []).length === 2);
  ok('a new lead carries the phone number the Call button needs',
     /phone: String\(leadData\.phone/.test(src));

  const reg = fs.readFileSync(path.join(ROOT, 'docs', 'pro', 'js', 'push-registration.js'), 'utf8');
  ok('the worker is still registered off the app scope (the reason navigate() fails)',
     /SW_SCOPE = '\/pro\/firebase-cloud-messaging-push-scope'/.test(reg));

  const bridge = codeOnly(fs.readFileSync(path.join(ROOT, 'docs', 'pro', 'js', 'push-actions.js'), 'utf8'));
  ok('a page-side bridge exists to receive the worker messages',
     /NBD_PUSH_ACTION/.test(bridge) && /addEventListener\('message'/.test(bridge));
  ok('the bridge refuses to navigate anywhere but this origin',
     /location\.origin/.test(bridge) || /^\s*\/pro\//m.test(bridge) || /startsWith\('\/pro\/'\)/.test(bridge));
  const dash = fs.readFileSync(path.join(ROOT, 'docs', 'pro', 'dashboard.html'), 'utf8');
  ok('the bridge is loaded by the dashboard with defer',
     /<script defer src="js\/push-actions\.js/.test(dash));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });

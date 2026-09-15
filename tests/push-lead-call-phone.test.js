/**
 * tests/push-lead-call-phone.test.js
 *
 * WHY THIS EXISTS
 * ───────────────
 * onNewLead in functions/push-functions.js cleaned the lead's phone for the
 * notification's Call button with
 *
 *     .replace(/[^d+]/g, '')
 *
 * — a character class that lost its backslash. It keeps only the LETTER "d"
 * and "+", so every digit was deleted:
 *
 *     '(513) 555-0100'   →  ''   → the worker treats Call as "no number" and
 *                                  quietly opens the lead instead of dialing
 *     '+1 513-555-0100'  →  '+'  → truthy, so the worker dials `tel:+`
 *
 * Nothing errors in either case; the button just never places a call.
 *
 * push-notification-actions.test.js already had an assertion on this line —
 * /phone: String\(leadData\.phone/ — and it PASSED with the bug present,
 * because it matches the source text, not what the source does. So this file
 * does not read the source at all. It runs the real onNewLead handler (with
 * Firestore and FCM stubbed in the require cache), captures the message that
 * would have gone to FCM, and hands that payload to the real service worker's
 * resolveNotificationAction('call', …) — the same two functions production
 * chains together.
 *
 * The same was true of the rest of that file's "SERVER PAYLOAD" regexes, so
 * the payload SHAPE is pinned here too, by executing it (2026-09-13):
 *   - a lead with no name (undefined) or a null address still delivers, and
 *     neither data block carries the text "undefined" or "null";
 *   - a number or boolean handed to sendCustomNotification arrives as a string
 *     in both data blocks;
 *   - the action buttons ride on webpush.notification, where a browser-drawn
 *     notification reads them.
 * "Delivers" is decided by firebase-admin's OWN validateMessage — the check
 * sendEachForMulticast runs on every message before it touches the network —
 * not by a hand-written imitation of FCM's rules.
 *
 * Pure Node. Run: node tests/push-lead-call-phone.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const FUNCTIONS = path.join(ROOT, 'functions');

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); failed++; fails.push(label); }
}

// ── Stub firebase-admin BEFORE push-functions.js loads ──────────────────
// push-functions.js calls getFirestore() and getMessaging() at module load and
// keeps the results, so the stubs must already be in the require cache under
// the exact paths ITS require() resolves to.
const sent = [];
const fakeDb = {
  collection(name) {
    return {
      doc(id) {
        return {
          // isNotificationEnabled: no user doc means "enabled".
          get: async () => ({ exists: false, data: () => ({}) }),
          collection(sub) {
            return {
              // getUserFCMTokens: one registered device.
              get: async () => ({
                forEach: (cb) => (sub === 'fcmTokens'
                  ? [{ id: 'dev-1', data: () => ({ token: 'tok-1' }) }].forEach(cb)
                  : undefined),
              }),
              add: async () => ({ id: 'log-1' }),       // logNotificationSent
              doc: () => ({ delete: async () => {} }),  // token pruning
            };
          },
        };
      },
    };
  },
};
// The payload validator firebase-admin runs inside sendEachForMulticast. It is
// not a public export, so it is loaded by file path; if a firebase-admin bump
// moves it, this require throws and the suite crashes — loudly, not green.
const { validateMessage } = require(path.join(
  path.dirname(require.resolve('firebase-admin', { paths: [FUNCTIONS] })),
  'messaging', 'messaging-internal.js'));
const fcmResults = [];
const fakeMessaging = {
  // Mirrors the SDK (lib/messaging/messaging.js): one message per token, each
  // validated, and an invalid one comes back as a per-token FAILURE in the
  // response — the call itself resolves. structuredClone, not JSON: a JSON
  // round-trip would drop exactly the `undefined` values under test.
  sendEachForMulticast: async (msg) => {
    sent.push(msg);
    const { tokens, ...base } = structuredClone(msg);
    const responses = tokens.map((token) => {
      try { validateMessage({ ...base, token }); return { success: true, messageId: 'm-' + token }; }
      catch (error) { return { success: false, error }; }
    });
    const result = {
      successCount: responses.filter((r) => r.success).length,
      failureCount: responses.filter((r) => !r.success).length,
      responses,
    };
    fcmResults.push(result);
    return result;
  },
};
// The last send was delivered: every token accepted, none refused.
const fcmAccepted = () => {
  const r = fcmResults[fcmResults.length - 1];
  return !!r && r.failureCount === 0 && r.successCount === 1;
};
const fcmDetail = () => {
  const r = fcmResults[fcmResults.length - 1];
  return r ? r.responses.map((x) => (x.success ? 'accepted' : x.error.message)).join('; ') : 'no send';
};

function stub(request, exportsObj) {
  const resolved = require.resolve(request, { paths: [FUNCTIONS] });
  const m = new Module(resolved);
  m.filename = resolved;
  m.loaded = true;
  m.exports = exportsObj;
  require.cache[resolved] = m;
}
stub('firebase-admin/firestore', {
  getFirestore: () => fakeDb,
  Timestamp: { fromDate: (d) => ({ toDate: () => d }), now: () => ({ toDate: () => new Date() }) },
  FieldValue: { serverTimestamp: () => '__ts__' },
});
stub('firebase-admin/messaging', { getMessaging: () => fakeMessaging });

const push = require(path.join(FUNCTIONS, 'push-functions.js'));

// Capture the handler's log lines instead of letting them reach stdout.
// sendPushNotification logs "[Push] Sent: 1 Failed: 0", and
// scripts/run-test-manifest.js scans every suite's output for /(\d+) failed/i —
// so a fully green run was reported as `output reports "1 Failed"` in CI
// (PR #1541, first push). Running this file directly never showed it. The
// firebase-functions logger object is documented as mockable, and
// push-functions.js looks its methods up on every call.
const fnLogger = require(require.resolve('firebase-functions/v2', { paths: [FUNCTIONS] })).logger;
const captured = [];
for (const level of ['debug', 'log', 'info', 'warn', 'error']) {
  fnLogger[level] = (...args) => { captured.push(level); };
}

// ── Load the real service worker in a vm ────────────────────────────────
const sandbox = {
  importScripts() {},
  firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage() {} }) },
  console: { log() {}, warn() {}, error() {} },
  clients: {},
  JSON, String, Object, Array, Promise, Date, RegExp, Error,
};
sandbox.self = { addEventListener() {}, registration: { showNotification() {} }, skipWaiting() {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'docs', 'pro', 'firebase-messaging-sw.js'), 'utf8'),
  sandbox, { filename: 'firebase-messaging-sw.js' });
const resolveAction = sandbox.resolveNotificationAction;

// Run onNewLead exactly as the Firestore trigger would, and return the one
// FCM message it produced (or null).
async function fireNewLead(lead) {
  sent.length = 0;
  fcmResults.length = 0;
  await push.onNewLead.run({
    params: { leadId: 'L1' },
    data: { data: () => Object.assign({ assignedTo: 'rep-1', name: 'Pat', address: '1 Main St' }, lead) },
  });
  return sent.length === 1 ? sent[0] : null;
}

(async () => {
  console.log('\nHARNESS');
  ok('onNewLead exposes its raw handler', push.onNewLead && typeof push.onNewLead.run === 'function');
  ok('the worker\'s click resolver loaded', typeof resolveAction === 'function');
  // Positive control: the "FCM accepts it" checks below mean nothing unless
  // the fake can refuse. A number in `data` is exactly what the SDK rejects.
  {
    await fakeMessaging.sendEachForMulticast({ tokens: ['t'], data: { n: 1 } });
    ok('the fake FCM refuses a non-string data value, as the SDK does', !fcmAccepted(), fcmDetail());
    sent.length = 0;
    fcmResults.length = 0;
  }

  const CASES = [
    // [label, lead fields, digits the Call button must receive]
    ['a US-formatted number', { phone: '(513) 555-0100' }, '5135550100'],
    ['a +1 number with dashes', { phone: '+1 513-555-0100' }, '+15135550100'],
    ['the phoneNumber fallback field', { phoneNumber: '513.555.0100' }, '5135550100'],
    ['a number stored as a Number', { phone: 5135550100 }, '5135550100'],
  ];

  for (const [label, lead, digits] of CASES) {
    console.log('\nNEW LEAD — ' + label + ' ' + JSON.stringify(lead));
    const msg = await fireNewLead(lead);
    ok('exactly one FCM send happened', msg !== null, 'sends=' + sent.length);
    if (!msg) continue;
    ok('FCM accepts it', fcmAccepted(), fcmDetail());

    // Both copies: `data` feeds onBackgroundMessage, `webpush.data` becomes the
    // browser-drawn notification's data. Either can be the one clicked.
    ok('data.phone is ' + JSON.stringify(digits),
       msg.data.phone === digits, 'got ' + JSON.stringify(msg.data.phone));
    ok('webpush.data.phone is ' + JSON.stringify(digits),
       msg.webpush.data.phone === digits, 'got ' + JSON.stringify(msg.webpush.data.phone));

    // The end the rep actually experiences.
    const plan = resolveAction('call', msg.webpush.data);
    ok('tapping Call dials tel:' + digits,
       plan.kind === 'call' && plan.phone === digits,
       'worker plan ' + JSON.stringify(plan));
  }

  console.log('\nNEW LEAD — no phone on file');
  {
    const msg = await fireNewLead({});
    ok('the push still sends', msg !== null);
    const plan = msg && resolveAction('call', msg.webpush.data);
    ok('Call falls back to opening the lead rather than dialing nothing',
       plan && plan.kind === 'navigate' && plan.url === '/pro/dashboard.html?tab=leads&leadId=L1',
       JSON.stringify(plan));
  }

  console.log('\nSEND PAYLOAD — a lead with no name and a null address');
  {
    // Firestore omits an unset field, so onNewLead hands sendPushNotification
    // `name: undefined`; a form that wrote null gives `address: null`. The SDK
    // refuses a whole message over one non-string data value, so without the
    // coercion this lead produces no push at all — and with a coercion that
    // stringifies instead of dropping, the payload carries "undefined".
    const msg = await fireNewLead({ name: undefined, address: null, phone: '(513) 555-0100' });
    ok('the push is sent and FCM accepts it', msg !== null && fcmAccepted(), fcmDetail());
    for (const block of ['data', 'webpush.data']) {
      const obj = msg ? (block === 'data' ? msg.data : msg.webpush.data) : null;
      const vals = obj ? Object.values(obj) : [];
      ok(block + ' holds only strings',
         !!obj && vals.every((v) => typeof v === 'string'), JSON.stringify(obj));
      ok(block + ' drops the missing fields rather than sending "undefined" or "null"',
         !!obj && !('name' in obj) && !('address' in obj)
           && !vals.some((v) => v === 'undefined' || v === 'null'),
         JSON.stringify(obj));
    }
  }

  console.log('\nSEND PAYLOAD — a caller passing a number and a boolean');
  {
    // sendCustomNotification passes its caller's data straight through (and
    // sendTeamNotification spreads it in). Numbers and booleans are ordinary JS
    // there and illegal to FCM.
    sent.length = 0;
    fcmResults.length = 0;
    await push.sendCustomNotification('rep-1', 'Heads up', 'Three jobs need you',
      { type: 'custom', count: 3, urgent: false, clickUrl: '/pro/dashboard.html' });
    const msg = sent.length === 1 ? sent[0] : null;
    ok('the push is sent and FCM accepts it', msg !== null && fcmAccepted(), fcmDetail());
    ok('a number arrives as its string form in both data blocks',
       !!msg && msg.data.count === '3' && msg.webpush.data.count === '3',
       msg && JSON.stringify({ data: msg.data.count, webpush: msg.webpush.data.count }));
    ok('...and a boolean false arrives as "false", not dropped as if missing',
       !!msg && msg.data.urgent === 'false' && msg.webpush.data.urgent === 'false',
       msg && JSON.stringify({ data: msg.data.urgent, webpush: msg.webpush.data.urgent }));
  }

  console.log('\nSEND PAYLOAD — the buttons ride on the browser-drawn notification');
  {
    // A push with a `notification` block can be drawn by the browser without
    // waking the worker; that notification shows only the buttons declared on
    // webpush.notification. Compared against the worker's own list, which
    // push-notification-actions.test.js holds equal to the server's.
    const msg = await fireNewLead({ phone: '(513) 555-0100' });
    const actions = msg && msg.webpush && msg.webpush.notification
      ? msg.webpush.notification.actions : undefined;
    ok('webpush.notification.actions is the worker\'s newLead list',
       JSON.stringify(actions) === JSON.stringify(sandbox.getNotificationActions('newLead')),
       JSON.stringify(actions));
    ok('...so the Call button the phone is for is actually on the notification',
       Array.isArray(actions) && actions.some((a) => a.action === 'call'));
  }

  console.log('\nOUTPUT HYGIENE');
  // If this ever reads 0, the capture above stopped reaching the handler's
  // logger and the runner's failure scan will trip on its log lines again.
  ok('the handler\'s log lines were captured, not printed', captured.length > 0,
     'captured=' + captured.length);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });

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
const fakeMessaging = {
  sendEachForMulticast: async (msg) => {
    sent.push(msg);
    return { successCount: 1, failureCount: 0, responses: [{ success: true }] };
  },
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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });

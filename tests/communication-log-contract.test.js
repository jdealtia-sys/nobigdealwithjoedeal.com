/**
 * Communication Log schema-contract regression test.
 *
 * Guards the producer → index → consumer contract behind the customer-page
 * Communication Log (docs/pro/js/customer-tasks-ui.js loadCommunicationLog).
 * It silently broke once (QA 2026-07-07): the consumer queried
 * {leadId, uid, orderBy(date)} while the server producers wrote neither
 * `leadId` (email) nor `date` (both), and the SMS render read `data.message`
 * while the producer wrote `body` — so the log was PERMANENTLY empty.
 *
 * Two layers:
 *   1. Behavioral — under the real firestore.rules, an admin-SDK-shaped write
 *      (the ONLY allowed writer; both logs are `allow write: if false`) must be
 *      readable by the owning rep via the exact consumer query + render.
 *   2. Source guards — the producers must stamp leadId + date; the consumer
 *      must orderBy('date') and read the SMS `body`. Catches source drift even
 *      though layer 1 replicates the query inline.
 *
 * RUN (from tests/):
 *   firebase emulators:exec --only firestore --project nbd-commlog-test 'node communication-log-contract.test.js'
 */
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  collection, query, where, orderBy, limit, getDocs, setDoc, doc, Timestamp,
} = require('firebase/firestore');

const PROJECT_ID = 'nbd-commlog-test';
const LEAD = 'leadA';
const REP = 'alice';
const ROOT = path.resolve(__dirname, '..');

// The exact consumer query + render mapping from
// docs/pro/js/customer-tasks-ui.js loadCommunicationLog().
async function loadCommunicationLog(db, leadId, uid) {
  const emailQ = query(collection(db, 'email_log'),
    where('leadId', '==', leadId), where('uid', '==', uid),
    orderBy('date', 'desc'), limit(20));
  const smsQ = query(collection(db, 'sms_log'),
    where('leadId', '==', leadId), where('uid', '==', uid),
    orderBy('date', 'desc'), limit(20));
  const [emailSnap, smsSnap] = [await getDocs(emailQ), await getDocs(smsQ)];
  const comms = [];
  emailSnap.forEach(d => {
    const data = d.data();
    comms.push({ type: 'email', subject: data.subject || 'Email',
      preview: data.body?.substring(0, 100) || '', status: data.status || 'sent' });
  });
  smsSnap.forEach(d => {
    const data = d.data();
    const smsText = data.body || data.message || '';
    comms.push({ type: 'sms', subject: smsText || 'Text Message',
      preview: smsText.substring(0, 100), status: data.status || 'sent' });
  });
  return comms;
}

// ── Layer 2: source-contract guards (no emulator needed) ─────────────────
function assertSourceContract() {
  const consumer = fs.readFileSync(path.join(ROOT, 'docs/pro/js/customer-tasks-ui.js'), 'utf8');
  const emailFns = fs.readFileSync(path.join(ROOT, 'functions/email-functions.js'), 'utf8');
  const smsFns   = fs.readFileSync(path.join(ROOT, 'functions/sms-functions.js'), 'utf8');

  // Consumer orders by `date` for BOTH logs and renders the SMS `body`.
  const orderByDateCount = (consumer.match(/orderBy\(\s*['"]date['"]/g) || []).length;
  assert.ok(orderByDateCount >= 2,
    `consumer must orderBy('date') for both email_log & sms_log (found ${orderByDateCount})`);
  assert.ok(/data\.body\s*\|\|\s*data\.message|data\.body/.test(consumer),
    "consumer SMS render must read data.body (producer field), not only data.message");

  // Email producer stamps leadId + date so rows join a customer thread and sort.
  assert.ok(/logEmailToFirestore\([^)]*leadId/.test(emailFns),
    'logEmailToFirestore must accept a leadId argument');
  assert.ok(/leadId:\s*leadId/.test(emailFns) && /\bdate:\s*ts\b/.test(emailFns),
    'email_log write must stamp leadId + date');

  // SMS producer stamps date (leadId already present).
  assert.ok(/\bdate:\s*ts\b/.test(smsFns), 'sms_log write must stamp date');
}

async function run() {
  assertSourceContract();

  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8'),
      host: '127.0.0.1', port: 8080,
    },
  });

  const now = Date.now();
  // Server (admin SDK) is the ONLY allowed writer — both logs are
  // `allow write: if false`. Seed exactly what the producers now write.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'email_log/e_new'), {
      to: 'home@owner.com', subject: 'Your Estimate is Ready', uid: REP,
      leadId: LEAD, date: Timestamp.fromMillis(now), sentAt: Timestamp.fromMillis(now), status: 'sent',
    });
    await setDoc(doc(db, 'sms_log/s_new'), {
      to: '+15551234567', body: 'Hi! Your roof estimate is attached.', uid: REP,
      leadId: LEAD, date: Timestamp.fromMillis(now + 1), sentAt: Timestamp.fromMillis(now + 1),
      status: 'sent', twilioSid: 'SM123',
    });
    // CONTROL — the OLD (pre-fix) schema. These MUST NOT appear: reproduces the
    // original bug (email missing leadId, both missing the date orderBy field).
    await setDoc(doc(db, 'email_log/e_old'), {
      to: 'home@owner.com', subject: 'Old email (no leadId/date)', uid: REP,
      sentAt: Timestamp.fromMillis(now), status: 'sent',
    });
    await setDoc(doc(db, 'sms_log/s_old'), {
      to: '+15551234567', body: 'Old sms (no date)', uid: REP, leadId: LEAD,
      sentAt: Timestamp.fromMillis(now), status: 'sent',
    });
  });

  // The owning rep reads their own thread under security rules.
  const rep = env.authenticatedContext(REP, { role: 'sales_rep', companyId: 'co-a' }).firestore();
  const comms = await loadCommunicationLog(rep, LEAD, REP);
  const byType = t => comms.filter(c => c.type === t);

  assert.strictEqual(comms.length, 2, `expected 2 comms, got ${comms.length}: ${JSON.stringify(comms)}`);
  assert.strictEqual(byType('email')[0].subject, 'Your Estimate is Ready', 'email subject renders');
  assert.strictEqual(byType('sms')[0].subject, 'Hi! Your roof estimate is attached.', 'sms body renders');
  assert.ok(byType('sms')[0].preview.length > 0, 'sms preview non-empty');
  assert.ok(!comms.some(c => /Old /.test(c.subject)), 'old-schema rows must be excluded');

  // Read rule: a different user cannot see the rep's rows (isOwner(uid)).
  const bob = env.authenticatedContext('bob', { role: 'sales_rep', companyId: 'co-b' }).firestore();
  let bobDenied = false;
  try {
    await getDocs(query(collection(bob, 'email_log'),
      where('leadId', '==', LEAD), where('uid', '==', REP), orderBy('date', 'desc'), limit(20)));
  } catch (e) { bobDenied = true; }
  assert.ok(bobDenied, "cross-user read of another rep's log must be denied by rules");

  await env.cleanup();
  console.log('✅ communication-log contract: source guards pass; 2 rows shown, SMS body rendered, old schema excluded, cross-user read denied');
}

run().catch(e => { console.error('❌ communication-log contract FAILED:', e && e.message ? e.message : e); process.exit(1); });

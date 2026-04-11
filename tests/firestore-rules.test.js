/**
 * Firestore + Storage rules unit tests for NBD Pro.
 *
 * RUN:
 *   cd tests && npm install
 *   firebase emulators:exec --only firestore,storage --project nbd-test 'node firestore-rules.test.js'
 *
 * These tests assert the exact privilege-escalation and data-leak paths we
 * just closed. If any of them fail, DO NOT deploy.
 */

const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PROJECT_ID = 'nbd-rules-test';

async function run() {
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  const alice = env.authenticatedContext('alice',  { role: 'member' }).firestore();
  const bob   = env.authenticatedContext('bob',    { role: 'member' }).firestore();
  const admin = env.authenticatedContext('joe',    { role: 'admin'  }).firestore();
  const anon  = env.unauthenticatedContext().firestore();

  const { setDoc, doc, getDoc } = require('firebase/firestore');

  // Seed some state via admin context bypass.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/alice'), { firstName: 'Alice', role: 'member' });
    await setDoc(doc(db, 'subscriptions/alice'), { plan: 'free', status: 'inactive' });
    await setDoc(doc(db, 'leads/leadA'), { userId: 'alice', name: 'Alice Lead' });
    await setDoc(doc(db, 'leads/leadB'), { userId: 'bob',   name: 'Bob Lead' });
    await setDoc(doc(db, 'access_codes/NBD-ADMIN'), { code: 'NBD-ADMIN', active: true, email: 'admin@nobigdeal.pro' });
    await setDoc(doc(db, 'email_log/log1'), { uid: 'alice', to: 'x@y.com' });
    await setDoc(doc(db, 'reps/alice'), { companyId: 'co-a', role: 'rep' });
    await setDoc(doc(db, 'reps/bob'),   { companyId: 'co-b', role: 'rep' });
  });

  // 1. user cannot self-promote to admin via users/{uid}.role
  await assertFails(setDoc(doc(alice, 'users/alice'), { role: 'admin' }, { merge: true }));

  // 2. user cannot self-write subscriptions/<uid>
  await assertFails(setDoc(doc(alice, 'subscriptions/alice'), { plan: 'professional', status: 'active' }));

  // 3. user cannot read access_codes
  await assertFails(getDoc(doc(alice, 'access_codes/NBD-ADMIN')));

  // 4. user cannot read another tenant's lead
  await assertFails(getDoc(doc(alice, 'leads/leadB')));

  // 5. user CAN read their own lead
  await assertSucceeds(getDoc(doc(alice, 'leads/leadA')));

  // 6. user cannot write rate_limits/*
  await assertFails(setDoc(doc(alice, 'rate_limits/alice'), { count: 0, windowStart: 0 }));

  // 7. user cannot read another user's email_log row
  await assertFails(getDoc(doc(bob, 'email_log/log1')));

  // 8. user CAN read their own email_log row
  await assertSucceeds(getDoc(doc(alice, 'email_log/log1')));

  // 9. user cannot read another rep in a different company
  await assertFails(getDoc(doc(alice, 'reps/bob')));

  // 10. admin CAN read access_codes (via getDoc)
  await assertSucceeds(getDoc(doc(admin, 'access_codes/NBD-ADMIN')));

  // 11. unauthenticated client CAN create a contact_leads doc with correct shape
  await assertSucceeds(setDoc(doc(anon, 'contact_leads/x'), {
    firstName: 'Test',
    phone: '+15551230000',
    source: 'unit-test',
  }));

  // 12. unauthenticated client CANNOT read contact_leads
  await assertFails(getDoc(doc(anon, 'contact_leads/x')));

  // 13. admin CAN read contact_leads
  await assertSucceeds(getDoc(doc(admin, 'contact_leads/x')));

  console.log('✓ All firestore rules tests passed');
  await env.cleanup();
}

run().catch((e) => {
  console.error('✗ firestore rules tests failed:', e);
  process.exit(1);
});

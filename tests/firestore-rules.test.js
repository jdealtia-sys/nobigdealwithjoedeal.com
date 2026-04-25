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

  // Test contexts span every role we use in the new security model.
  const alice = env.authenticatedContext('alice',  { role: 'sales_rep',  companyId: 'co-a' }).firestore();
  const bob   = env.authenticatedContext('bob',    { role: 'sales_rep',  companyId: 'co-b' }).firestore();
  const admin = env.authenticatedContext('joe',    { role: 'admin' }).firestore();
  const coAdmin = env.authenticatedContext('carol', { role: 'company_admin', companyId: 'co-a' }).firestore();
  const anon  = env.unauthenticatedContext().firestore();

  const { setDoc, doc, getDoc } = require('firebase/firestore');

  // ─── Seed ALL state in a single withSecurityRulesDisabled call.
  // Multiple calls conflict on Firestore settings in v10+ of the
  // firebase SDK, so we batch here. Tests below never call
  // withSecurityRulesDisabled again.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Original fixture
    await setDoc(doc(db, 'users/alice'), { firstName: 'Alice', role: 'member' });
    await setDoc(doc(db, 'subscriptions/alice'), { plan: 'free', status: 'inactive' });
    await setDoc(doc(db, 'leads/leadA'), { userId: 'alice', name: 'Alice Lead' });
    await setDoc(doc(db, 'leads/leadB'), { userId: 'bob',   name: 'Bob Lead' });
    await setDoc(doc(db, 'access_codes/NBD-ADMIN'), { code: 'NBD-ADMIN', active: true, email: 'admin@nobigdeal.pro' });
    await setDoc(doc(db, 'email_log/log1'), { uid: 'alice', to: 'x@y.com' });
    await setDoc(doc(db, 'reps/alice'), { companyId: 'co-a', role: 'rep' });
    await setDoc(doc(db, 'reps/bob'),   { companyId: 'co-b', role: 'rep' });
    // Contact lead fixture for test 13
    await setDoc(doc(db, 'contact_leads/seed-a'), {
      firstName: 'Test', phone: '+15551230000', source: 'unit-test'
    });
    // Portal tokens + parcel cache — used to assert admin-SDK-only reads
    await setDoc(doc(db, 'portal_tokens/TOKEN123'), {
      leadId: 'leadA', ownerUid: 'alice', uses: 0, maxUses: 100
    });
    await setDoc(doc(db, 'parcel_cache/abc'), { parcel: { owner: 'Smith' } });
    // Measurements — owner read tests
    await setDoc(doc(db, 'measurements/job-alice'), {
      ownerId: 'alice', leadId: 'leadA', status: 'pending'
    });
    await setDoc(doc(db, 'measurements/job-bob'), {
      ownerId: 'bob', leadId: 'leadB', status: 'pending'
    });
    // Appointments
    await setDoc(doc(db, 'appointments/bk-alice'),
      { userId: 'alice', bookingId: 'bk-alice', status: 'booked' });
    await setDoc(doc(db, 'appointments/bk-bob'),
      { userId: 'bob', bookingId: 'bk-bob', status: 'booked' });
    // Audit log
    await setDoc(doc(db, 'audit_log/evt1'), { type: 'x' });
    // Company for members-rule test
    await setDoc(doc(db, 'companies/co-a'),
      { ownerId: 'alice', name: 'Alice Roofing' });
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

  // 10. access_codes is admin-SDK only — even platform admin
  //     cannot read from the client (tightened in the security
  //     sprint; previously admin-readable).
  await assertFails(getDoc(doc(admin, 'access_codes/NBD-ADMIN')));

  // 11. POST-C-3: unauthenticated client CANNOT create contact_leads
  //     directly (submissions must go through submitPublicLead).
  await assertFails(setDoc(doc(anon, 'contact_leads/x'), {
    firstName: 'Test',
    phone: '+15551230000',
    source: 'unit-test',
  }));

  // 12. ...same for the other three public collections.
  await assertFails(setDoc(doc(anon, 'guide_leads/x'),
    { name: 'Test', email: 'a@b.com', source: 'u' }));
  await assertFails(setDoc(doc(anon, 'estimate_leads/x'),
    { address: '123 Test', source: 'u' }));
  await assertFails(setDoc(doc(anon, 'storm_alert_subscribers/x'),
    { name: 'T', phone: '5551112222', zip: '45202', source: 'u' }));

  // 13. admin CAN still read contact_leads (fixture seeded above).
  await assertSucceeds(getDoc(doc(admin, 'contact_leads/seed-a')));

  // ─── NEW COLLECTIONS (Wave B + integrations) ─────────────
  //
  // 14. portal_tokens — admin-SDK only. Fixture seeded above.
  await assertFails(getDoc(doc(anon,    'portal_tokens/TOKEN123')));
  await assertFails(getDoc(doc(alice,   'portal_tokens/TOKEN123')));
  await assertFails(getDoc(doc(admin,   'portal_tokens/TOKEN123')));
  await assertFails(setDoc(doc(alice,   'portal_tokens/NEW'), { leadId: 'x' }));
  await assertFails(setDoc(doc(coAdmin, 'portal_tokens/NEW'), { leadId: 'x' }));

  // 15. parcel_cache — admin-SDK only (fixture seeded above).
  await assertFails(getDoc(doc(alice, 'parcel_cache/abc')));
  await assertFails(getDoc(doc(admin, 'parcel_cache/abc')));

  // 16. measurements — owner READ succeeds, cross-tenant + client
  //     writes denied. Fixtures seeded above.
  await assertSucceeds(getDoc(doc(alice, 'measurements/job-alice')));
  await assertFails(getDoc(doc(alice,    'measurements/job-bob')));
  await assertFails(setDoc(doc(alice,    'measurements/job-alice'),
    { status: 'ready' }, { merge: true }));
  // Platform admin can read any measurement (support context).
  await assertSucceeds(getDoc(doc(admin, 'measurements/job-bob')));

  // 17. appointments — owner read succeeds (fixtures seeded above).
  await assertSucceeds(getDoc(doc(alice, 'appointments/bk-alice')));
  await assertFails(getDoc(doc(alice,    'appointments/bk-bob')));
  await assertFails(setDoc(doc(alice,    'appointments/bk-alice'),
    { status: 'cancelled' }, { merge: true }));

  // 18. audit_log — admin-only reads; writes denied (fixture seeded).
  await assertFails(getDoc(doc(alice, 'audit_log/evt1')));
  await assertSucceeds(getDoc(doc(admin, 'audit_log/evt1')));
  await assertFails(setDoc(doc(admin, 'audit_log/evt2'), { type: 'y' }));

  // 19. companies/*/members — company_admin context (carol, co-a)
  //     should NOT be able to write without being the company owner
  //     OR platform admin. Owner check is via companies/{id}.ownerId.
  //     Fixture for companies/co-a seeded above.
  // Carol has role: company_admin but isn't the ownerId — should fail.
  await assertFails(setDoc(doc(coAdmin, 'companies/co-a/members/new@x.com'),
    { email: 'new@x.com', role: 'sales_rep', status: 'invited' }));
  // Alice IS the owner — should succeed.
  await assertSucceeds(setDoc(doc(alice, 'companies/co-a/members/new@x.com'),
    { email: 'new@x.com', role: 'sales_rep', status: 'invited' }));

  // 20. F-05: leads/{leadId}/activity rep-write shape guards.
  //
  // Rep owns leadA (seeded with userId: 'alice' at line 47). A rep
  // must be able to log ordinary activity but NOT forge webhook-
  // shaped entries that downstream automation (audit log, dunning,
  // commission) keys on.
  const nowTs = new Date().toISOString();

  // ✅ ordinary human-action activity with source:'rep' + whitelisted type
  await assertSucceeds(setDoc(
    doc(alice, 'leads/leadA/activity/ok-note'),
    { userId: 'alice', source: 'rep', type: 'note',
      note: 'spoke with homeowner', createdAt: nowTs }));

  // ❌ missing source field → blocked
  await assertFails(setDoc(
    doc(alice, 'leads/leadA/activity/no-source'),
    { userId: 'alice', type: 'note', note: 'x', createdAt: nowTs }));

  // ❌ source:'webhook' claim by a rep → blocked (webhooks use admin SDK)
  await assertFails(setDoc(
    doc(alice, 'leads/leadA/activity/claim-webhook'),
    { userId: 'alice', source: 'webhook', type: 'note',
      note: 'x', createdAt: nowTs }));

  // ❌ type not in allowlist → blocked (payment_received)
  await assertFails(setDoc(
    doc(alice, 'leads/leadA/activity/fake-type'),
    { userId: 'alice', source: 'rep', type: 'payment_received',
      createdAt: nowTs }));

  // ❌ type not in allowlist → blocked (stripe_payment_failed)
  await assertFails(setDoc(
    doc(alice, 'leads/leadA/activity/forge-stripe-type'),
    { userId: 'alice', source: 'rep', type: 'stripe_payment_failed',
      createdAt: nowTs }));

  // ❌ stripe/financial fields on a client write → blocked even with
  //    a whitelisted type
  await assertFails(setDoc(
    doc(alice, 'leads/leadA/activity/stripe-fields'),
    { userId: 'alice', source: 'rep', type: 'note',
      stripeInvoiceId: 'in_X', amountCents: 50000, createdAt: nowTs }));

  // ❌ measurement-webhook fields on a client write → blocked
  await assertFails(setDoc(
    doc(alice, 'leads/leadA/activity/forge-measurement'),
    { userId: 'alice', source: 'rep', type: 'note',
      externalJobId: 'hv-1', measurements: { rawSqft: 4200 },
      createdAt: nowTs }));

  // ❌ signature-webhook fields on a client write → blocked
  await assertFails(setDoc(
    doc(alice, 'leads/leadA/activity/forge-signature'),
    { userId: 'alice', source: 'rep', type: 'note',
      signatureDocumentId: 'doc-1', signatureProvider: 'boldsign',
      createdAt: nowTs }));

  // ❌ activity against a lead the rep does NOT own → blocked
  await assertFails(setDoc(
    doc(alice, 'leads/leadB/activity/cross-tenant'),
    { userId: 'alice', source: 'rep', type: 'note',
      note: 'x', createdAt: nowTs }));

  // ❌ update + delete still locked to admin SDK
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'leads/leadA/activity/preexisting'),
      { userId: 'alice', source: 'webhook', type: 'stripe_payment_failed',
        createdAt: nowTs });
  });
  await assertFails(setDoc(
    doc(alice, 'leads/leadA/activity/preexisting'),
    { userId: 'alice', source: 'rep', type: 'note', createdAt: nowTs }));

  // 21. Leads require companyId on create (Rock 3 follow-up).
  //
  // ❌ create without companyId → blocked.
  await assertFails(setDoc(
    doc(alice, 'leads/no-companyid'),
    { userId: 'alice', name: 'Lead with no companyId' }));

  // ❌ create with empty-string companyId → blocked (size > 0 guard).
  await assertFails(setDoc(
    doc(alice, 'leads/empty-companyid'),
    { userId: 'alice', name: 'Lead with empty companyId', companyId: '' }));

  // ❌ create with non-string companyId → blocked (`is string` guard).
  await assertFails(setDoc(
    doc(alice, 'leads/numeric-companyid'),
    { userId: 'alice', name: 'Lead with numeric companyId', companyId: 42 }));

  // ✅ create with non-empty string companyId → succeeds.
  await assertSucceeds(setDoc(
    doc(alice, 'leads/with-companyid'),
    { userId: 'alice', name: 'Lead with companyId', companyId: 'co-a' }));

  console.log('✓ All firestore rules tests passed');
  await env.cleanup();
}

run().catch((e) => {
  console.error('✗ firestore rules tests failed:', e);
  process.exit(1);
});

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
  // NEW-5 regression: a solo operator with NO role claim (the most common
  // real case — exactly Joe's account) and a 'viewer' (read-only).
  const dave   = env.authenticatedContext('dave',   { companyId: 'co-d' }).firestore();
  const viewer = env.authenticatedContext('vic',    { role: 'viewer', companyId: 'co-v' }).firestore();
  // TRUE solo: no role AND no companyId claim — the only case allowed to pin an
  // expense companyId to its own uid (the #12 fallback).
  const solo   = env.authenticatedContext('solo1',  {}).firestore();
  const anon  = env.unauthenticatedContext().firestore();

  const { setDoc, doc, getDoc, updateDoc, deleteDoc } = require('firebase/firestore');

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
    // NEW-5 fixtures: a no-role owner's lead + a viewer's lead.
    await setDoc(doc(db, 'leads/leadD'), { userId: 'dave', name: 'Dave Lead', companyId: 'co-d' });
    await setDoc(doc(db, 'leads/leadV'), { userId: 'vic',  name: 'Vic Lead',  companyId: 'co-v' });
    await setDoc(doc(db, 'leads/leadCar'), { userId: 'carol', name: 'Carol Lead', companyId: 'co-a' });
    // Referral-freeze fixture: dave owns an 'owed' bonus lead in co-d.
    await setDoc(doc(db, 'leads/leadRef'), { userId: 'dave', companyId: 'co-d', name: 'Ref Lead', referralRewardStatus: 'owed', referralRewardAmount: 200, referralDocId: 'refdoc1', referrerLeadId: 'someref', referredBy: 'JOHN-AB12' });
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
    // Remote-signing tokens (Signatures PR4) — admin-SDK only, same as portal_tokens.
    await setDoc(doc(db, 'doc_sign_tokens/SIGNTOK1'), {
      leadId: 'leadA', ownerUid: 'alice', docId: 'docA', status: 'pending'
    });
    // Report-share tokens (this session) — admin-SDK only, same lockdown.
    await setDoc(doc(db, 'report_share_tokens/RPTTOK1'), {
      reportId: 'report-alice', ownerUid: 'alice', status: 'active'
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
    // Pillar 4 fixtures: an existing member (update/delete stay owner-
    // writable after create moved server-side) + the company subscription
    // (team members read their own company's plan; cross-tenant denied).
    await setDoc(doc(db, 'companies/co-a/members/exist@x.com'),
      { email: 'exist@x.com', role: 'sales_rep', status: 'active' });
    await setDoc(doc(db, 'companies/alice/members/m1'),
      { email: 'm1@x.com', role: 'sales_rep', status: 'invited' });
    await setDoc(doc(db, 'subscriptions/co-a'),
      { plan: 'growth', status: 'active' });
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

  // 6b. catalogCosts/{companyId} is a tenant's OWN wholesale cost + labor/
  //     margin model — the half that used to ship inside
  //     docs/pro/js/product-data.js, where it was readable by anyone with a
  //     URL AND handed to every other tenant as their seed. It is now
  //     tenant-scoped like companyProfile: same-tenant read, owner/
  //     company_admin write. The cross-tenant read is the assertion that
  //     matters — one company's buy prices must never reach another.
  await assertFails(getDoc(doc(alice, 'catalogCosts/co-b')));
  await assertFails(setDoc(doc(alice, 'catalogCosts/co-b'), { costs: {} }));
  await assertFails(getDoc(doc(bob, 'catalogCosts/co-a')));
  //     Non-vacuity + the read/write split: alice (sales_rep in co-a) CAN read
  //     her own company's book — a rep needs the margin readout — but must not
  //     rewrite tenant-wide, money-bearing config. Same split companyProfile
  //     uses. Platform admin can write.
  await assertSucceeds(getDoc(doc(alice, 'catalogCosts/co-a')));
  await assertFails(setDoc(doc(alice, 'catalogCosts/co-a'), { costs: {} }));
  await assertSucceeds(setDoc(doc(admin, 'catalogCosts/co-a'), { costs: {} }));

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

  // 14b. doc_sign_tokens (Signatures PR4) — admin-SDK only. No client may
  // read a token (would leak the doc) or forge one (would mint a sign link).
  await assertFails(getDoc(doc(anon,    'doc_sign_tokens/SIGNTOK1')));
  await assertFails(getDoc(doc(alice,   'doc_sign_tokens/SIGNTOK1')));
  await assertFails(getDoc(doc(admin,   'doc_sign_tokens/SIGNTOK1')));
  await assertFails(setDoc(doc(alice,   'doc_sign_tokens/FORGED'), { leadId: 'x', status: 'pending' }));
  await assertFails(setDoc(doc(alice,   'doc_sign_tokens/SIGNTOK1'), { status: 'signed' }, { merge: true }));

  // 14c. report_share_tokens (this session) — admin-SDK only. No client may
  // read a token (would let anyone enumerate shared reports) or forge one.
  await assertFails(getDoc(doc(anon,    'report_share_tokens/RPTTOK1')));
  await assertFails(getDoc(doc(alice,   'report_share_tokens/RPTTOK1')));
  await assertFails(getDoc(doc(admin,   'report_share_tokens/RPTTOK1')));
  await assertFails(setDoc(doc(alice,   'report_share_tokens/FORGED'), { reportId: 'x', status: 'active' }));

  // 14d. sms_client_ids (offline SMS outbox idempotency claims, sendSMS) —
  // admin-SDK only. A client that could write here could pre-claim its own
  // queued texts' ids so they answer "duplicate" (reported sent, never sent);
  // one that could read would see recipients' canonical phone keys.
  await assertFails(getDoc(doc(alice,   'sms_client_ids/alice_3f2b8c1e-5d6a-4b7c-9e8f-0a1b2c3d4e5f')));
  await assertFails(getDoc(doc(admin,   'sms_client_ids/alice_3f2b8c1e-5d6a-4b7c-9e8f-0a1b2c3d4e5f')));
  await assertFails(setDoc(doc(alice,   'sms_client_ids/alice_3f2b8c1e-5d6a-4b7c-9e8f-0a1b2c3d4e5f'), { status: 'sent' }));
  await assertFails(setDoc(doc(coAdmin, 'sms_client_ids/alice_anything-else-0000000000'), { status: 'claimed' }));

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
  // Member writes are FULLY server-mediated now — create/update/delete all
  // go through callables (createTeamInvite / deactivateUser / removeMember)
  // so seat limits hold AND removal strips claims + revokes tokens. Even the
  // owner cannot client-write member docs; only a platform admin can.
  await assertFails(setDoc(doc(alice, 'companies/co-a/members/new@x.com'),
    { email: 'new@x.com', role: 'sales_rep', status: 'invited' }));
  await assertFails(setDoc(doc(alice, 'companies/co-a/members/exist@x.com'),
    { status: 'disabled' }, { merge: true }));
  await assertFails(deleteDoc(doc(alice, 'companies/co-a/members/exist@x.com')));
  await assertFails(setDoc(doc(coAdmin, 'companies/co-a/members/exist@x.com'),
    { status: 'disabled' }, { merge: true }));
  // Platform admin retains client access (admin-SDK callables also bypass).
  await assertSucceeds(setDoc(doc(admin, 'companies/co-a/members/exist@x.com'),
    { status: 'disabled' }, { merge: true }));
  // Pillar 4: same-company members read the company subscription (billing
  // is company-level; the doc is keyed by owner uid == companyId claim).
  await assertSucceeds(getDoc(doc(coAdmin, 'subscriptions/co-a')));
  await assertSucceeds(getDoc(doc(alice, 'subscriptions/co-a')));
  await assertFails(getDoc(doc(bob, 'subscriptions/co-a')));

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

  // ✅ first-party rep activity types added 2026-06-23 — voicemail /
  //    supplement-created / quick-add lead-created timeline entries. These
  //    were silently permission-denied before the allowlist was widened.
  await assertSucceeds(setDoc(
    doc(alice, 'leads/leadA/activity/ok-voicemail'),
    { userId: 'alice', source: 'rep', type: 'voicemail',
      label: 'Voicemail recording', mediaSource: 'recorded', createdAt: nowTs }));
  await assertSucceeds(setDoc(
    doc(alice, 'leads/leadA/activity/ok-supplement'),
    { userId: 'alice', source: 'rep', type: 'supplement_created',
      label: 'Supplement #1', createdAt: nowTs }));
  await assertSucceeds(setDoc(
    doc(alice, 'leads/leadA/activity/ok-leadcreated'),
    { userId: 'alice', source: 'rep', type: 'lead_created',
      leadSource: 'Door Knock', createdAt: nowTs }));

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

  // 24. Referral money-field freeze (QA sweep 2026-07-08). Server-owned referral
  //     fields are admin-SDK-only (onReferralLeadWrite); the client's ONLY writes
  //     are the rep's Mark Paid / Mark Unpaid toggle + entering redeemReferralCode.
  //     leadRef is dave-owned in co-d with a seeded 'owed' bonus.
  // ✅ a normal owner edit (unrelated field) still succeeds — the freeze is absence-safe
  await assertSucceeds(updateDoc(doc(dave, 'leads/leadRef'), { stage: 'contacted' }));
  // ✅ the rep may enter/correct a referral code (redeemReferralCode is not frozen)
  await assertSucceeds(updateDoc(doc(dave, 'leads/leadRef'), { redeemReferralCode: 'JOHN-AB12' }));
  // ✅ Mark Paid: owed -> paid (+ paidAt) is the carved-out client transition
  await assertSucceeds(updateDoc(doc(dave, 'leads/leadRef'), { referralRewardStatus: 'paid', referralRewardPaidAt: nowTs }));
  // ✅ Mark Unpaid: paid -> owed reverses it
  await assertSucceeds(updateDoc(doc(dave, 'leads/leadRef'), { referralRewardStatus: 'owed' }));
  // ❌ forging the reward amount / attribution pointers is denied (admin-SDK only)
  await assertFails(updateDoc(doc(dave, 'leads/leadRef'), { referralRewardAmount: 999999 }));
  await assertFails(updateDoc(doc(dave, 'leads/leadRef'), { referrerLeadId: 'someoneElse' }));
  await assertFails(updateDoc(doc(dave, 'leads/leadRef'), { referralDocId: 'otherDoc' }));
  // ❌ fabricating an 'owed' bonus on a plain lead (no prior status) is denied
  await assertFails(updateDoc(doc(dave, 'leads/leadD'), { referralRewardStatus: 'owed', referralRewardAmount: 200 }));
  // ❌ resetting owed -> pending to replay the Phase-B credit is denied
  await assertFails(updateDoc(doc(dave, 'leads/leadRef'), { referralRewardStatus: 'pending' }));
  // ❌ re-tenanting your own lead (change userId / companyId) is denied
  await assertFails(updateDoc(doc(dave, 'leads/leadRef'), { userId: 'someoneElse' }));
  await assertFails(updateDoc(doc(dave, 'leads/leadRef'), { companyId: 'co-x' }));

  // 25. stageWriteOk() (2026-09-15) — stageRole is the field every server
  //     classifier (weekly-digest, dormant-leads, money-dashboard,
  //     analytics-kpi, leaderboard, portal.js) trusts via
  //     functions/stage-roles.js's roleFor(). Nothing previously stopped an
  //     authorized writer from forging it to an arbitrary string. leadD is
  //     dave-owned in co-d with no prior stage/stageRole (plain fixture).
  // ✅ a real stage-write.js-shaped write (stage + a valid role) succeeds
  await assertSucceeds(updateDoc(doc(dave, 'leads/leadD'), { stage: 'contract_signed', stageRole: 'job' }));
  // ✅ each of the 5 real roles is individually accepted
  for (const role of ['new', 'active', 'job', 'won', 'lost']) {
    await assertSucceeds(updateDoc(doc(dave, 'leads/leadD'), { stageRole: role }));
  }
  // ✅ a stage-only edit with no stageRole in the payload still succeeds —
  //    the guard is absence-safe (the Edit-modal path omits `stage` entirely
  //    when the dropdown has no matching option, per the comment above it;
  //    stageWriteOk must not turn that omission into a denial).
  await assertSucceeds(updateDoc(doc(dave, 'leads/leadD'), { firstName: 'Dave Renamed' }));
  // ❌ a forged/garbage stageRole — not one of the 5 real roles — is denied.
  //    This is the exact gap: a bug or a malicious client writing this
  //    today would silently misclassify the lead in every server-side
  //    won/lost/digest/nudge surface with no error anywhere.
  await assertFails(updateDoc(doc(dave, 'leads/leadD'), { stageRole: 'super-won' }));
  await assertFails(updateDoc(doc(dave, 'leads/leadD'), { stageRole: '' }));
  await assertFails(updateDoc(doc(dave, 'leads/leadD'), { stageRole: 'Won' })); // case-sensitive — the real enum is lowercase
  // ❌ a non-string / absurd stage value is denied
  await assertFails(updateDoc(doc(dave, 'leads/leadD'), { stage: 123 }));
  await assertFails(updateDoc(doc(dave, 'leads/leadD'), { stage: 'x'.repeat(200) }));
  // ✅ a normal, real custom-stage key (the exact shape Settings > Pipelines
  //    produces, per pipeline-builder.js's slug generator) with role 'won'
  //    is accepted — this is the actual freeform-pipeline scenario the rule
  //    must not regress: tenants can and do invent their own stage strings.
  await assertSucceeds(updateDoc(doc(dave, 'leads/leadD'), { stage: 'custom_collections_closed', stageRole: 'won' }));

  // 25b. paperworkFieldsOk() (2026-09-15 Paperwork Filing) — five flat
  //      *FiledAt scalars gate REQUIRED_FIELDS_BY_TYPE's stage-advance hard
  //      block client-side; this closes the same class of forgery gap
  //      stageWriteOk() closes for stage/stageRole, at the same trust bar
  //      (an owner/same-company-staff writer, not a stranger).
  // ✅ a real ISO timestamp on each of the 5 fields succeeds.
  for (const f of ['contractFiledAt', 'permitFiledAt', 'aobFiledAt', 'warrantyCertFiledAt', 'cocFiledAt']) {
    await assertSucceeds(updateDoc(doc(dave, 'leads/leadD'), { [f]: new Date().toISOString() }));
  }
  // ✅ unsetting (the checkbox toggled off) writes '' and still succeeds.
  await assertSucceeds(updateDoc(doc(dave, 'leads/leadD'), { permitFiledAt: '' }));
  // ✅ an edit that never touches any of these fields still succeeds — the
  //    guard is absence-safe (mirrors stageWriteOk's own absence-safety test).
  await assertSucceeds(updateDoc(doc(dave, 'leads/leadD'), { lastName: 'Renamed Again' }));
  // ❌ a non-string value on any of the 5 fields is denied.
  await assertFails(updateDoc(doc(dave, 'leads/leadD'), { contractFiledAt: true }));
  await assertFails(updateDoc(doc(dave, 'leads/leadD'), { permitFiledAt: 123 }));
  await assertFails(updateDoc(doc(dave, 'leads/leadD'), { aobFiledAt: { forged: true } }));
  // ❌ an oversized string (garbage payload, not a real ISO timestamp — a
  //    real one is ~24 chars, well under the 40-char cap) is denied.
  await assertFails(updateDoc(doc(dave, 'leads/leadD'), { warrantyCertFiledAt: 'x'.repeat(200) }));
  await assertFails(updateDoc(doc(dave, 'leads/leadD'), { cocFiledAt: 'x'.repeat(41) }));
  // ✅ exactly at the 40-char boundary still succeeds (off-by-one guard).
  await assertSucceeds(updateDoc(doc(dave, 'leads/leadD'), { cocFiledAt: 'x'.repeat(40) }));

  // 22. /system/migrations is admin-SDK only — no client read/write.
  //     The runner in functions/migrations/runner.js owns this doc.
  await assertFails(getDoc(doc(alice, 'system/migrations')));
  await assertFails(setDoc(doc(alice, 'system/migrations'), { appliedVersion: 999 }));
  // Even platform admins can't reach it from the client — only the
  // server-side runner (admin SDK) bypasses rules.
  await assertFails(getDoc(doc(admin, 'system/migrations')));
  await assertFails(setDoc(doc(admin, 'system/migrations'), { appliedVersion: 999 }));

  // 23. NEW-5: a solo owner with NO role claim can mutate (soft-delete,
  //     stage-move, hard-delete) their OWN leads. The old rule used
  //     `request.auth.token.role != 'viewer'`, which THROWS when the role
  //     claim is absent → PERMISSION_DENIED for every no-role owner (so the
  //     soft-delete silently failed and bridged/web leads reappeared). The
  //     fix uses `request.auth.token.get('role','') != 'viewer'`.
  await assertSucceeds(updateDoc(doc(dave, 'leads/leadD'), { deleted: true }));      // soft-delete
  await assertSucceeds(updateDoc(doc(dave, 'leads/leadD'), { stage: 'contacted' })); // stage move
  await assertSucceeds(deleteDoc(doc(dave, 'leads/leadD')));                         // hard delete
  // A 'viewer' who owns a lead is still read-only at the rules layer.
  await assertFails(updateDoc(doc(viewer, 'leads/leadV'), { deleted: true }));
  await assertFails(deleteDoc(doc(viewer, 'leads/leadV')));
  // 23b. QA 2026-06-21 #4: a company_admin who OWNS a lead can permanent-delete
  //      it too (same isOwner branch; 'company_admin' != 'viewer'). Prod was
  //      denying this (stale/divergent deployed rule) while soft-delete worked,
  //      so Deleted-bin "Remove" failed and leads could never be purged. The
  //      committed rule already allows it — this locks it against regression
  //      and forces the redeploy that ships the correct rule.
  await assertSucceeds(deleteDoc(doc(coAdmin, 'leads/leadCar')));

  // 23c. QA 2026-06-21 #2: academy_progress/{uid} — owner reads+writes their
  //      OWN progress; a different user is denied. No rule existed before, so
  //      every Academy save/load was PERMISSION_DENIED (silent localStorage-only).
  await assertSucceeds(setDoc(doc(alice, 'academy_progress/alice'), { completedNodes: ['n1'] }));
  await assertSucceeds(getDoc(doc(alice, 'academy_progress/alice')));
  await assertFails(getDoc(doc(bob, 'academy_progress/alice')));
  await assertFails(setDoc(doc(bob, 'academy_progress/alice'), { completedNodes: ['x'] }));

  // 23d. QA 2026-06-21 #10: companies/{uid}/members keyed under the caller's
  //      OWN uid is READABLE even when no /companies/{uid} doc exists (the
  //      live Team tab queries /companies/{_user.uid}/members). Cross-uid
  //      reads stay denied. Member WRITES are fully server-mediated now
  //      (create/update/delete via callables) — even under the caller's own
  //      uid, a client write is denied; only removeMember/deactivateUser
  //      (admin SDK) touch these docs.
  await assertSucceeds(getDoc(doc(alice, 'companies/alice/members/m1')));
  await assertFails(setDoc(doc(alice, 'companies/alice/members/rep1'), { email: 'r@x.com', role: 'sales_rep', status: 'invited' }));
  await assertFails(setDoc(doc(alice, 'companies/alice/members/m1'), { status: 'disabled' }, { merge: true }));
  await assertFails(deleteDoc(doc(alice, 'companies/alice/members/m1')));
  await assertFails(getDoc(doc(bob, 'companies/alice/members/m1')));
  await assertFails(setDoc(doc(bob, 'companies/alice/members/rep2'), { email: 'x@x.com', role: 'sales_rep' }));
  // 23d-2 (gauntlet 2026-07-16): SAME-COMPANY CLAIM members read. The Team
  // tab resolves its tenant from claims.companyId so non-owner
  // company_admins/managers work — but the rule only granted owner-keyed
  // reads, so every non-owner admin got a silently empty roster. Same-company
  // claim holders (any role) may READ the roster; writes stay server-only;
  // cross-tenant claims stay denied.
  await assertSucceeds(getDoc(doc(coAdmin, 'companies/co-a/members/exist@x.com'))); // carol (company_admin, co-a claim)
  await assertSucceeds(getDoc(doc(alice, 'companies/co-a/members/exist@x.com')));   // alice (sales_rep, co-a claim) reads own roster
  await assertFails(getDoc(doc(bob, 'companies/co-a/members/exist@x.com')));        // bob (co-b claim) cross-tenant denied
  await assertFails(setDoc(doc(coAdmin, 'companies/co-a/members/exist@x.com'), { status: 'disabled' }, { merge: true })); // claim grants READ only

  // 23e. companies DOC: create pinned to caller uid + plan/ownerId frozen
  //      (Settings sweep). alice owns companies/co-a (ownerId==alice.uid).
  await assertSucceeds(updateDoc(doc(alice, 'companies/co-a'), { name: 'Alice Roofing LLC' })); // benign owner edit OK
  await assertFails(updateDoc(doc(alice, 'companies/co-a'), { plan: 'enterprise' }));           // ❌ seat-paywall bypass frozen
  await assertFails(updateDoc(doc(alice, 'companies/co-a'), { ownerId: 'bob' }));               // ❌ provenance frozen
  await assertSucceeds(setDoc(doc(admin, 'companies/co-a'), { plan: 'growth' }, { merge: true })); // ✅ admin/webhook can set plan
  await assertFails(setDoc(doc(alice, 'companies/squatUid'), { ownerId: 'alice', name: 'squat' })); // ❌ create pinned to own uid
  await assertSucceeds(setDoc(doc(alice, 'companies/alice'), { ownerId: 'alice', name: 'Alice solo co' })); // ✅ own-uid create

  // 23f. CRITICAL (audit 2026-09-15): the create branch pinned ownerId but
  //      never checked `plan` — the didNotChange(['plan','ownerId']) freeze
  //      right above only guards UPDATE, so a self-serve owner could squat
  //      their OWN companies/{uid} doc with plan:'enterprise' at CREATE
  //      time and keep it forever: createCompany's idempotent branch
  //      (existing.exists) only checks ownerId, never re-validates plan on
  //      re-call. createTeamInvite/assignSeats fall back to companies.plan
  //      whenever the tenant's own subscriptions doc isn't
  //      active/trialing/past_due — and createCompany seeds every self-serve
  //      tenant's subscriptions doc with status:'none' forever — so this was
  //      the PERMANENT seat-gate bypass for every free tenant, not a race.
  //      bob/dave have no companies/{uid} doc yet.
  await assertFails(setDoc(doc(bob, 'companies/bob'), { ownerId: 'bob', name: 'Bob Roofing', plan: 'enterprise' })); // ❌ plan escalation at create
  await assertSucceeds(setDoc(doc(bob, 'companies/bob'), { ownerId: 'bob', name: 'Bob Roofing', plan: 'free' }));    // ✅ explicit free create still allowed
  await assertSucceeds(setDoc(doc(dave, 'companies/dave'), { ownerId: 'dave', name: 'Dave Co' }));                  // ✅ plan-absent create (admin-SDK shape) still allowed

  // 24. NEW-D11: saved reports — owners delete their OWN reports. The old
  //     rule was `allow update, delete: if isAdmin()`, so the My Reports
  //     delete button silently failed for every non-admin owner. Update
  //     stays admin-only (no client edit flow); cross-owner + anon delete
  //     stay blocked.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'reports/report-alice'), { userId: 'alice', name: 'Alice report', template: 'pipeline-health' });
    await setDoc(doc(db, 'reports/report-bob'),   { userId: 'bob',   name: 'Bob report',   template: 'rep-monthly' });
    // Team-visibility fixtures: alice's report carries her companyId (co-a); a
    // legacy report has no companyId.
    await setDoc(doc(db, 'reports/report-alice-co'),     { userId: 'alice', companyId: 'co-a', name: 'Alice co-a report', template: 'inspection' });
    await setDoc(doc(db, 'reports/report-alice-legacy'), { userId: 'alice', name: 'Alice legacy report', template: 'inspection' });
  });
  await assertFails(updateDoc(doc(alice, 'reports/report-alice'), { name: 'renamed' })); // update still admin-only
  await assertFails(deleteDoc(doc(alice, 'reports/report-bob')));                        // cross-owner delete blocked
  await assertFails(deleteDoc(doc(anon, 'reports/report-alice')));                       // anon delete blocked
  await assertSucceeds(deleteDoc(doc(alice, 'reports/report-alice')));                   // owner deletes own report
  // Team report visibility (this session): same-company members read a colleague's
  // report; cross-company denied; legacy (no companyId) stays owner-only.
  await assertSucceeds(getDoc(doc(coAdmin, 'reports/report-alice-co')));                   // carol (company_admin, co-a) reads alice's co-a report
  await assertSucceeds(getDoc(doc(alice, 'reports/report-alice-co')));                   // owner still reads own
  await assertFails(getDoc(doc(bob, 'reports/report-alice-co')));                        // bob (co-b) — different company, denied
  await assertSucceeds(getDoc(doc(alice, 'reports/report-alice-legacy')));               // owner reads own legacy report
  await assertFails(getDoc(doc(coAdmin, 'reports/report-alice-legacy')));                  // legacy has no companyId → not team-visible
  await assertSucceeds(setDoc(doc(alice, 'reports/report-new'), { userId: 'alice', companyId: 'co-a', name: 'New', template: 'inspection' })); // create with companyId

  // 24b. PINS — team territory map (2026-07-08). Pins carry the creator's
  //      companyId so same-company members see ONE shared map (mirrors
  //      /reports). Legacy pins (no companyId) stay owner-only; create must
  //      pin companyId to the caller's own tenant.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'pins/pin-alice-co'),     { userId: 'alice', companyId: 'co-a', lat: 39.1, lng: -84.1, status: 'signed' });
    await setDoc(doc(db, 'pins/pin-alice-legacy'), { userId: 'alice', lat: 39.2, lng: -84.2, status: 'interested' });
    await setDoc(doc(db, 'pins/pin-bob-co'),       { userId: 'bob',   companyId: 'co-b', lat: 40.0, lng: -85.0, status: 'not-home' });
  });
  // Read: same-company sees a colleague's pin; cross-company denied; legacy owner-only.
  await assertSucceeds(getDoc(doc(coAdmin, 'pins/pin-alice-co')));   // carol (company_admin, co-a) sees alice's co-a pin
  await assertSucceeds(getDoc(doc(alice,   'pins/pin-alice-co')));   // owner reads own
  await assertFails(getDoc(doc(bob,        'pins/pin-alice-co')));   // bob (co-b) — different company, denied
  await assertSucceeds(getDoc(doc(alice,   'pins/pin-alice-legacy')));// owner reads own legacy pin
  await assertFails(getDoc(doc(coAdmin,    'pins/pin-alice-legacy')));// legacy has no companyId → not team-visible
  // Create: companyId must be present AND the caller's own tenant.
  await assertSucceeds(setDoc(doc(alice, 'pins/pin-new-ok'),    { userId: 'alice', companyId: 'co-a', lat: 39.3, lng: -84.3, status: 'callback' })); // own tenant
  await assertFails(setDoc(doc(alice,    'pins/pin-new-noco'),  { userId: 'alice', lat: 39.4, lng: -84.4, status: 'callback' }));                    // missing companyId
  await assertFails(setDoc(doc(alice,    'pins/pin-new-xco'),   { userId: 'alice', companyId: 'co-b', lat: 39.5, lng: -84.5, status: 'callback' })); // foreign tenant
  // Update / delete: owner or same-company admin; cross-company blocked.
  await assertSucceeds(updateDoc(doc(coAdmin, 'pins/pin-alice-co'), { status: 'do-not-knock' })); // company_admin curates shared territory
  await assertFails(updateDoc(doc(bob,        'pins/pin-alice-co'), { status: 'signed' }));        // cross-company update blocked
  await assertFails(updateDoc(doc(alice,      'pins/pin-alice-co'), { companyId: 'co-b' }));       // provenance frozen: owner can't repoint companyId to a victim tenant
  await assertFails(deleteDoc(doc(bob,        'pins/pin-alice-co')));                              // cross-company delete blocked
  await assertSucceeds(deleteDoc(doc(alice,   'pins/pin-alice-co')));                              // owner deletes own pin

  // 24c. TERRITORY ZONES — persisted, team-shared canvassing areas (2026-07-08).
  //      Same shape as /pins: same-company read, owner/same-company-admin write,
  //      companyId pinned to the caller's tenant on create.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'zones/zone-alice-co'), { userId: 'alice', companyId: 'co-a', name: 'North', color: '#4A9EFF', points: [{ lat: 39, lng: -84 }, { lat: 39.1, lng: -84 }, { lat: 39, lng: -84.1 }] });
    await setDoc(doc(db, 'zones/zone-bob-co'),   { userId: 'bob',   companyId: 'co-b', name: 'South', color: '#22C55E', points: [{ lat: 40, lng: -85 }, { lat: 40.1, lng: -85 }, { lat: 40, lng: -85.1 }] });
  });
  await assertSucceeds(getDoc(doc(coAdmin, 'zones/zone-alice-co')));   // same-company admin sees the tenant's territory
  await assertSucceeds(getDoc(doc(alice,   'zones/zone-alice-co')));   // owner reads own
  await assertFails(getDoc(doc(bob,        'zones/zone-alice-co')));   // cross-company denied
  await assertSucceeds(setDoc(doc(alice, 'zones/zone-new-ok'), { userId: 'alice', companyId: 'co-a', name: 'East', color: '#D4A017', points: [{ lat: 39, lng: -84 }, { lat: 39.1, lng: -84 }, { lat: 39, lng: -84.1 }] })); // own tenant
  await assertFails(setDoc(doc(alice,    'zones/zone-new-noco'), { userId: 'alice', name: 'NoCo', color: '#D4A017', points: [] }));                    // missing companyId
  await assertFails(setDoc(doc(alice,    'zones/zone-new-xco'),  { userId: 'alice', companyId: 'co-b', name: 'X', color: '#D4A017', points: [] }));    // foreign tenant
  await assertSucceeds(updateDoc(doc(coAdmin, 'zones/zone-alice-co'), { name: 'North (reassigned)' })); // admin curates
  await assertFails(updateDoc(doc(bob,        'zones/zone-alice-co'), { name: 'hijack' }));              // cross-company update blocked
  await assertFails(updateDoc(doc(alice,      'zones/zone-alice-co'), { companyId: 'co-b' }));           // provenance frozen: owner can't repoint companyId
  await assertSucceeds(deleteDoc(doc(alice,   'zones/zone-alice-co')));                                  // owner deletes own zone

  // 25. NEW-D40a: drawings. The lead-linked subcollection
  //     (leads/{leadId}/drawings) has long had owner rules, but the
  //     top-level /drawings collection — the draw tool's fallback for
  //     drawings saved with no matching lead — had NO block, so
  //     default-deny failed every unlinked save and load. Exercise the
  //     exact client query shapes from maps-routing.js.
  const { collection, query, where, orderBy, limit, getDocs, addDoc } = require('firebase/firestore');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'drawings/draw-alice'),
      { userId: 'alice', leadId: '_unlinked_alice', version: 1, address: '1 Test St' });
    await setDoc(doc(db, 'drawings/draw-bob'),
      { userId: 'bob', leadId: '_unlinked_bob', version: 1, address: '2 Test St' });
    await setDoc(doc(db, 'leads/leadA/drawings/d1'),
      { userId: 'alice', leadId: 'leadA', version: 1, address: '3 Test St' });
  });
  // ✅ unlinked load: owner-filtered query (loadDrawingFromCustomer shape)
  await assertSucceeds(getDocs(query(collection(alice, 'drawings'),
    where('userId', '==', 'alice'), orderBy('version', 'desc'), limit(1))));
  // ✅ unlinked save: create with self-stamped userId (saveDrawingToCustomer shape)
  await assertSucceeds(addDoc(collection(alice, 'drawings'),
    { userId: 'alice', leadId: '_unlinked_alice', version: 2, address: '1 Test St' }));
  // ❌ create stamped with someone else's userId → blocked
  await assertFails(addDoc(collection(alice, 'drawings'),
    { userId: 'bob', leadId: '_unlinked_bob', version: 9, address: 'forged' }));
  // ❌ cross-owner direct read + unfiltered collection scan → blocked
  await assertFails(getDoc(doc(alice, 'drawings/draw-bob')));
  await assertFails(getDocs(query(collection(alice, 'drawings'),
    orderBy('version', 'desc'), limit(1))));
  // ❌ anon read → blocked
  await assertFails(getDoc(doc(anon, 'drawings/draw-alice')));
  // ✅ owner deletes their own unlinked drawing
  await assertSucceeds(deleteDoc(doc(alice, 'drawings/draw-alice')));
  // ✅ lead-linked load regression: owner queries the subcollection with
  //    orderBy(version) — no userId clause; ownership proves via the
  //    parent-lead get() in the existing rule.
  await assertSucceeds(getDocs(query(collection(alice, 'leads/leadA/drawings'),
    orderBy('version', 'desc'), limit(1))));
  // ❌ same query from a non-owner of the lead → blocked
  await assertFails(getDocs(query(collection(bob, 'leads/leadA/drawings'),
    orderBy('version', 'desc'), limit(1))));

  // 26. EXPENSES (company-shared spend ledger). Feeds per-job margin +
  //     supplier-spend reports. Ownership pins to the caller's own tenant
  //     (like /leads); reads follow the recordings/leaderboard precedent
  //     (owner + same-company staff + platform admin); audit fields are
  //     immutable. Seed via the rule-respecting create path so the rules
  //     themselves are exercised end-to-end.
  function expDoc(uid, companyId, leadId, supplier) {
    return {
      userId: uid, companyId: companyId, leadId: leadId, category: 'materials',
      costType: 'direct', supplier: supplier, amountCents: 12345, currency: 'USD',
      date: new Date(), note: '', receiptStoragePath: null, receiptDocRef: null,
      source: 'manual', needsReview: false,
      createdAt: new Date(), createdBy: uid, updatedAt: new Date()
    };
  }
  // ✅ rep creates her own expense, pinned to her tenant
  await assertSucceeds(setDoc(doc(alice, 'expenses/exp-alice'), expDoc('alice', 'co-a', 'leadA', 'ABC Supply')));
  // ✅ bob creates his own (co-b) — used for cross-tenant read assertions
  await assertSucceeds(setDoc(doc(bob, 'expenses/exp-bob'), expDoc('bob', 'co-b', 'leadB', 'Beacon')));
  // ❌ create stamped with someone else's userId → blocked
  await assertFails(setDoc(doc(alice, 'expenses/forge-uid'), expDoc('bob', 'co-a', 'leadA', 'forged')));
  // ❌ create pinned to a FOREIGN tenant → blocked (can't pollute co-b rollups)
  await assertFails(setDoc(doc(alice, 'expenses/forge-co'), expDoc('alice', 'co-b', 'leadA', 'forged')));
  // ❌ create with no companyId → blocked (companyId is an invariant)
  await assertFails(setDoc(doc(alice, 'expenses/no-co'),
    { userId: 'alice', category: 'materials', costType: 'direct', amountCents: 100, date: new Date() }));
  // ── validExpenseMoney(): the ledger can't be forged with junk money ──
  // ❌ negative amountCents → blocked (floor at 0)
  await assertFails(setDoc(doc(alice, 'expenses/bad-neg'),
    Object.assign(expDoc('alice', 'co-a', 'leadA', 'ABC Supply'), { amountCents: -500 })));
  // ❌ non-integer amountCents (dollars mistaken for cents) → blocked
  await assertFails(setDoc(doc(alice, 'expenses/bad-float'),
    Object.assign(expDoc('alice', 'co-a', 'leadA', 'ABC Supply'), { amountCents: 12.5 })));
  // ❌ forged costType (only 'direct'|'overhead' feed the job-cost/overhead rollups) → blocked
  await assertFails(setDoc(doc(alice, 'expenses/bad-ct'),
    Object.assign(expDoc('alice', 'co-a', 'leadA', 'ABC Supply'), { costType: 'refund' })));
  // ❌ negative taxCents → blocked
  await assertFails(setDoc(doc(alice, 'expenses/bad-tax'),
    Object.assign(expDoc('alice', 'co-a', 'leadA', 'ABC Supply'), { taxCents: -1 })));
  // ✅ a valid taxCents is accepted (proves the guard isn't over-broad)
  await assertSucceeds(setDoc(doc(alice, 'expenses/ok-tax'),
    Object.assign(expDoc('alice', 'co-a', 'leadA', 'ABC Supply'), { taxCents: 825 })));
  // ── #12: a MEMBER (companyId claim co-a) cannot stamp companyId = own uid ──
  // The `== uid` fallback is solo-only; else a rep could hide the expense from
  // the company_admin/manager rollup + the overhead cron (both filter by tenant).
  await assertFails(setDoc(doc(alice, 'expenses/hide-uid'),
    expDoc('alice', 'alice', 'leadA', 'hidden')));
  // ✅ a TRUE solo (no companyId claim) CAN pin companyId to its own uid
  await assertSucceeds(setDoc(doc(solo, 'expenses/exp-solo'),
    expDoc('solo1', 'solo1', null, 'Home Depot')));
  // ❌ but a solo still cannot pin to a FOREIGN companyId
  await assertFails(setDoc(doc(solo, 'expenses/solo-forge'),
    expDoc('solo1', 'co-a', null, 'forged')));
  // ✅ owner reads her own
  await assertSucceeds(getDoc(doc(alice, 'expenses/exp-alice')));
  // ✅ company_admin in the SAME tenant reads a rep's expense (team rollup)
  await assertSucceeds(getDoc(doc(coAdmin, 'expenses/exp-alice')));
  // ❌ a rep in ANOTHER tenant cannot read it
  await assertFails(getDoc(doc(bob, 'expenses/exp-alice')));
  // ❌ company_admin cannot reach across tenants (carol co-a → bob co-b)
  await assertFails(getDoc(doc(coAdmin, 'expenses/exp-bob')));
  // ✅ platform admin reads anything
  await assertSucceeds(getDoc(doc(admin, 'expenses/exp-bob')));
  // ❌ anon read blocked
  await assertFails(getDoc(doc(anon, 'expenses/exp-alice')));
  // ✅ owner edits a mutable field (amount correction)
  await assertSucceeds(updateDoc(doc(alice, 'expenses/exp-alice'), { amountCents: 20000 }));
  // ❌ owner cannot correct an amount to a negative value (validExpenseMoney on update too)
  await assertFails(updateDoc(doc(alice, 'expenses/exp-alice'), { amountCents: -1 }));
  // ❌ owner cannot flip costType to a forged value on update
  await assertFails(updateDoc(doc(alice, 'expenses/exp-alice'), { costType: 'refund' }));
  // ❌ owner cannot mutate immutable audit fields
  await assertFails(updateDoc(doc(alice, 'expenses/exp-alice'), { companyId: 'co-b' }));
  await assertFails(updateDoc(doc(alice, 'expenses/exp-alice'), { userId: 'bob' }));
  await assertFails(updateDoc(doc(alice, 'expenses/exp-alice'), { createdBy: 'bob' }));
  // ✅ company-wide spend query (supplier report shape): staff + companyId filter
  await assertSucceeds(getDocs(query(collection(coAdmin, 'expenses'),
    where('companyId', '==', 'co-a'), orderBy('date', 'desc'), limit(50))));
  // ✅ rep queries her OWN spend (userId-scoped list)
  await assertSucceeds(getDocs(query(collection(alice, 'expenses'),
    where('userId', '==', 'alice'), orderBy('date', 'desc'), limit(50))));
  // ❌ unfiltered scan by a rep → blocked
  await assertFails(getDocs(query(collection(alice, 'expenses'),
    orderBy('date', 'desc'), limit(50))));
  // ❌ a rep cannot scan another tenant's spend
  await assertFails(getDocs(query(collection(bob, 'expenses'),
    where('companyId', '==', 'co-a'), orderBy('date', 'desc'), limit(50))));
  // viewer can create (matches /leads) but is read-only thereafter
  await assertSucceeds(setDoc(doc(viewer, 'expenses/exp-vic'), expDoc('vic', 'co-v', null, 'Lowes')));
  // ❌ a viewer cannot mutate or delete (read-only role)
  await assertFails(updateDoc(doc(viewer, 'expenses/exp-vic'), { amountCents: 999 }));
  await assertFails(deleteDoc(doc(viewer, 'expenses/exp-vic')));
  // ✅ solo operator (NO role claim — Joe's case) can create + edit + delete own
  await assertSucceeds(setDoc(doc(dave, 'expenses/exp-dave'), expDoc('dave', 'co-d', null, 'Home Depot')));
  await assertSucceeds(updateDoc(doc(dave, 'expenses/exp-dave'), { amountCents: 800 }));
  await assertSucceeds(deleteDoc(doc(dave, 'expenses/exp-dave')));

  // 27. RECURRING EXPENSES (templates) — same owner/company-shared shape.
  function recDoc(uid, companyId) {
    return { userId: uid, companyId: companyId, name: 'Liability Insurance', amountCents: 20000,
      category: 'insurance', costType: 'overhead', frequency: 'monthly', status: 'active',
      nextDueDate: new Date(), createdAt: new Date(), createdBy: uid, updatedAt: new Date() };
  }
  await assertSucceeds(setDoc(doc(alice, 'recurringExpenses/rec-a'), recDoc('alice', 'co-a')));
  await assertSucceeds(getDoc(doc(coAdmin, 'recurringExpenses/rec-a')));    // same-company staff read
  await assertFails(getDoc(doc(bob, 'recurringExpenses/rec-a')));           // cross-tenant denied
  await assertFails(setDoc(doc(alice, 'recurringExpenses/rec-forge'), recDoc('bob', 'co-a'))); // forged userId
  await assertSucceeds(updateDoc(doc(alice, 'recurringExpenses/rec-a'), { status: 'paused' }));
  await assertFails(updateDoc(doc(alice, 'recurringExpenses/rec-a'), { companyId: 'co-b' })); // immutable

  // 28. SUPPLIERS (1099 tracking) — NO tin field allowed; private subtree locked.
  function supDoc(uid, companyId) {
    return { userId: uid, companyId: companyId, displayName: 'Crew Co', legalName: 'Crew Co LLC',
      taxClassification: 'sole_prop', is1099Eligible: true, w9Status: 'received',
      createdAt: new Date(), createdBy: uid, updatedAt: new Date() };
  }
  await assertSucceeds(setDoc(doc(alice, 'suppliers/sup-a'), supDoc('alice', 'co-a')));
  await assertSucceeds(getDoc(doc(coAdmin, 'suppliers/sup-a')));            // same-company staff read
  await assertFails(getDoc(doc(bob, 'suppliers/sup-a')));                   // cross-tenant denied
  // ❌ a client write carrying a raw TIN/SSN/EIN is HARD-REJECTED
  await assertFails(setDoc(doc(alice, 'suppliers/sup-tin'),
    Object.assign(supDoc('alice', 'co-a'), { tin: '123-45-6789' })));
  await assertFails(updateDoc(doc(alice, 'suppliers/sup-a'), { ssn: '123456789' }));
  // ✅ a normal field update works
  await assertSucceeds(updateDoc(doc(alice, 'suppliers/sup-a'), { w9Status: 'verified' }));
  // ❌ the server-only private TIN subtree denies ALL client read/write
  await assertFails(getDoc(doc(alice, 'suppliers/sup-a/private/tin')));
  await assertFails(setDoc(doc(alice, 'suppliers/sup-a/private/tin'), { enc: 'x' }));

  // ── TEAM PIPELINE VISIBILITY (2026-07-06) ─────────────────────
  // Leads reads are company-scoped for company_admin/manager/viewer
  // (the /expenses shape); sales_rep stays own-only and writes are NOT
  // widened. Fresh contexts + fixtures here because earlier tests
  // hard-delete leadCar and the legacy leadA/leadB deliberately carry
  // NO companyId (they now double as the legacy-doc protection probe).
  const mgrA     = env.authenticatedContext('mia',  { role: 'manager', companyId: 'co-a' }).firestore();
  const viewerA  = env.authenticatedContext('vera', { role: 'viewer',  companyId: 'co-a' }).firestore();
  const mgrB     = env.authenticatedContext('mob',  { role: 'manager', companyId: 'co-b' }).firestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'leads/leadA2'), { userId: 'alice', name: 'Alice Team Lead', companyId: 'co-a' });
    await setDoc(doc(db, 'leads/leadCar2'), { userId: 'carol', name: 'Carol Lead 2', companyId: 'co-a' });
    await setDoc(doc(db, 'leads/leadA2/activity/act1'),
      { userId: 'alice', type: 'note', source: 'rep', note: 'seeded' });
    await setDoc(doc(db, 'leads/leadA2/tasks/task1'),
      { userId: 'alice', title: 'call back', done: false });
    await setDoc(doc(db, 'leads/leadA2/notes/note1'),
      { userId: 'alice', text: 'roof notes' });
    await setDoc(doc(db, 'leads/leadDel'), { userId: 'alice', name: 'Delete Me', companyId: 'co-a' });
    await setDoc(doc(db, 'photos/photoA2'), { userId: 'alice', leadId: 'leadA2', url: 'p/a2.jpg' });
    await setDoc(doc(db, 'photos/photoNoLead'), { userId: 'alice', url: 'p/orphan.jpg' });
    // Stamped photos (migration 004 / post-2026-07 clients): companyId on
    // the doc, deliberately NO leadId — isolates the companyId read clause
    // from the docLeadInMyCompany fallback.
    await setDoc(doc(db, 'photos/photoStamped'), { userId: 'alice', companyId: 'co-a', url: 'p/stamped.jpg' });
    await setDoc(doc(db, 'photos/photoStampedB'), { userId: 'bob', companyId: 'co-b', url: 'p/stamped-b.jpg' });
    // Alert-outbox ledger (admin-SDK-written; see functions/lead-alert.js)
    await setDoc(doc(db, 'alert_outbox/obxA'), { kind: 'lead-alert', collection: 'contact_leads', companyId: 'co-a', target: { emails: ['a@co-a.test'], sms: null }, emailStatus: 'sent', smsStatus: 'skipped:no-target' });
    await setDoc(doc(db, 'alert_outbox/obxNbd'), { kind: 'lead-alert', collection: 'contact_leads', companyId: null, target: { emails: ['jd@x.test'], sms: null }, emailStatus: 'sent', smsStatus: 'sent' });
    await setDoc(doc(db, 'leads/leadA/activity/legacy-act'),
      { userId: 'alice', type: 'note', source: 'rep', note: 'legacy parent' });
  });

  // ✅ company_admin / manager / viewer read a teammate's lead in THEIR company
  await assertSucceeds(getDoc(doc(coAdmin, 'leads/leadA2')));
  await assertSucceeds(getDoc(doc(mgrA, 'leads/leadA2')));
  await assertSucceeds(getDoc(doc(viewerA, 'leads/leadA2')));
  // ❌ sales_rep does NOT read a teammate's lead (own-only — Wave 110)
  await assertFails(getDoc(doc(alice, 'leads/leadCar2')));
  // ❌ cross-tenant stays dead for every role
  await assertFails(getDoc(doc(bob, 'leads/leadA2')));
  await assertFails(getDoc(doc(viewer, 'leads/leadA2'))); // viewer of co-v
  // ❌ LEGACY doc without companyId: company clause must NOT widen it —
  // owner-only forever (absent-key access errors to deny).
  await assertFails(getDoc(doc(coAdmin, 'leads/leadA')));
  await assertFails(getDoc(doc(mgrA, 'leads/leadA')));

  // ✅ the team kanban LIST query is provable: where('companyId','==',claim)
  await assertSucceeds(getDocs(query(collection(mgrA, 'leads'), where('companyId', '==', 'co-a'))));
  await assertSucceeds(getDocs(query(collection(viewerA, 'leads'), where('companyId', '==', 'co-a'))));
  // ❌ …but not for sales_rep (rule excludes the role) nor cross-tenant
  await assertFails(getDocs(query(collection(alice, 'leads'), where('companyId', '==', 'co-a'))));
  await assertFails(getDocs(query(collection(bob, 'leads'), where('companyId', '==', 'co-a'))));
  // ✅ the classic own-leads query stays provable for everyone
  await assertSucceeds(getDocs(query(collection(alice, 'leads'), where('userId', '==', 'alice'))));

  // ── MANAGER EDIT RIGHTS (2026-07-06, Jo's product call) ────────
  // Same-company staff UPDATE any tenant lead (kanban fully workable)…
  await assertSucceeds(updateDoc(doc(mgrA, 'leads/leadA2'), { stage: 'contacted' }));
  await assertSucceeds(updateDoc(doc(coAdmin, 'leads/leadA2'), { stage: 'inspected' }));
  // …but provenance is FROZEN: no reassigning ownership or re-tenanting.
  await assertFails(updateDoc(doc(mgrA, 'leads/leadA2'), { userId: 'mia' }));
  await assertFails(updateDoc(doc(mgrA, 'leads/leadA2'), { companyId: 'co-b' }));
  // Viewer stays read-only; cross-tenant staff stays dead; legacy
  // no-companyId docs stay owner-only for writes too.
  await assertFails(updateDoc(doc(viewerA, 'leads/leadA2'), { stage: 'x' }));
  await assertFails(updateDoc(doc(mgrB, 'leads/leadA2'), { stage: 'x' }));
  await assertFails(updateDoc(doc(mgrA, 'leads/leadA'), { stage: 'x' }));
  // DELETE: managers manage the board but don't destroy data — only the
  // lead owner or the tenant's company_admin can delete.
  await assertFails(deleteDoc(doc(viewerA, 'leads/leadA2')));
  await assertFails(deleteDoc(doc(mgrA, 'leads/leadDel')));
  await assertFails(deleteDoc(doc(mgrB, 'leads/leadDel')));
  await assertSucceeds(deleteDoc(doc(coAdmin, 'leads/leadDel')));

  // ❌ the review's load-bearing probe: a STAFF role in the WRONG tenant
  // must not make the company LIST query provable — role alone never
  // crosses the companyId wall.
  await assertFails(getDocs(query(collection(mgrB, 'leads'), where('companyId', '==', 'co-a'))));
  await assertFails(getDoc(doc(mgrB, 'leads/leadA2')));

  // ✅ subcollections follow the parent: staff/viewer read a teammate
  // lead's activity AND tasks/notes (the two blocks a whitespace-variant
  // edit initially missed — pinned here so they can't drift apart again);
  // cross-tenant + legacy-parent stay denied.
  await assertSucceeds(getDoc(doc(mgrA, 'leads/leadA2/activity/act1')));
  await assertSucceeds(getDoc(doc(viewerA, 'leads/leadA2/activity/act1')));
  await assertSucceeds(getDoc(doc(mgrA, 'leads/leadA2/tasks/task1')));
  await assertSucceeds(getDoc(doc(viewerA, 'leads/leadA2/notes/note1')));
  await assertFails(getDoc(doc(bob, 'leads/leadA2/activity/act1')));
  await assertFails(getDoc(doc(mgrB, 'leads/leadA2/tasks/task1')));
  await assertFails(getDoc(doc(mgrA, 'leads/leadA/activity/legacy-act')));
  // ✅ …and the UNFILTERED subcollection LIST the customer page actually
  // issues (tasks.js orderBy-only getDocs) is provable for same-company
  // staff — the parent get() is constant across the whole query — and
  // stays dead cross-tenant.
  await assertSucceeds(getDocs(collection(mgrA, 'leads/leadA2/tasks')));
  await assertSucceeds(getDocs(collection(viewerA, 'leads/leadA2/notes')));
  await assertFails(getDocs(collection(mgrB, 'leads/leadA2/tasks')));

  // ✅ PHOTOS follow the referenced lead (docLeadInMyCompany): company
  // readers see a tenant lead's gallery — including the leadId-only LIST
  // query the customer page issues for teammate leads — while writes and
  // orphan photos (no leadId) stay owner-only, and cross-tenant stays dead.
  await assertSucceeds(getDoc(doc(mgrA, 'photos/photoA2')));
  await assertSucceeds(getDoc(doc(viewerA, 'photos/photoA2')));
  await assertSucceeds(getDocs(query(collection(mgrA, 'photos'), where('leadId', '==', 'leadA2'))));
  await assertFails(getDoc(doc(mgrB, 'photos/photoA2')));
  await assertFails(getDocs(query(collection(mgrB, 'photos'), where('leadId', '==', 'leadA2'))));
  await assertFails(getDoc(doc(bob, 'photos/photoA2')));
  await assertFails(getDoc(doc(mgrA, 'photos/photoNoLead')));
  await assertFails(updateDoc(doc(mgrA, 'photos/photoA2'), { phase: 'After' }));
  await assertSucceeds(getDoc(doc(alice, 'photos/photoNoLead')));

  // ✅ STAMPED photos (companyId on the doc — migration 004 + new clients):
  // company readers get them WITHOUT a leadId, and the dashboard
  // thumbnail-cache LIST query where('companyId','==',claim) is provable.
  await assertSucceeds(getDoc(doc(alice, 'photos/photoStamped')));   // owner first
  await assertSucceeds(getDoc(doc(mgrA, 'photos/photoStamped')));
  await assertSucceeds(getDoc(doc(viewerA, 'photos/photoStamped')));
  await assertSucceeds(getDocs(query(collection(mgrA, 'photos'), where('companyId', '==', 'co-a'))));
  await assertSucceeds(getDocs(query(collection(viewerA, 'photos'), where('companyId', '==', 'co-a'))));
  await assertSucceeds(getDocs(query(collection(mgrB, 'photos'), where('companyId', '==', 'co-b'))));
  // ❌ sales_rep is excluded from company reads; staff never cross tenants;
  // stamping doesn't widen writes.
  await assertFails(getDocs(query(collection(bob, 'photos'), where('companyId', '==', 'co-b'))));
  await assertFails(getDocs(query(collection(mgrB, 'photos'), where('companyId', '==', 'co-a'))));
  await assertFails(getDoc(doc(mgrB, 'photos/photoStamped')));
  await assertFails(updateDoc(doc(mgrA, 'photos/photoStamped'), { phase: 'After' }));
  await assertFails(updateDoc(doc(viewerA, 'photos/photoStamped'), { caption: 'x' }));

  // ✅ ALERT OUTBOX: tenant readers see their OWN company's alert ledger
  // (incl. the provable companyId LIST query); NBD-fallback (companyId
  // null) docs are platform-admin only; nothing is client-writable.
  await assertSucceeds(getDoc(doc(coAdmin, 'alert_outbox/obxA')));
  await assertSucceeds(getDoc(doc(mgrA, 'alert_outbox/obxA')));
  await assertSucceeds(getDocs(query(collection(mgrA, 'alert_outbox'), where('companyId', '==', 'co-a'))));
  await assertSucceeds(getDoc(doc(admin, 'alert_outbox/obxNbd')));
  await assertFails(getDoc(doc(mgrB, 'alert_outbox/obxA')));
  await assertFails(getDoc(doc(bob, 'alert_outbox/obxA')));
  await assertFails(getDoc(doc(coAdmin, 'alert_outbox/obxNbd')));
  await assertFails(setDoc(doc(coAdmin, 'alert_outbox/forged'),
    { kind: 'lead-alert', companyId: 'co-a', target: { emails: ['x@y.z'] } }));
  await assertFails(updateDoc(doc(coAdmin, 'alert_outbox/obxA'), { emailStatus: 'scrubbed' }));

  // ✅ CREATE pins companyId to the caller's tenant but still accepts its
  // absence (cached pre-stamp bundles keep uploading). #12 guard extended
  // 2026-08-10: uid-as-companyId is now legal ONLY for true solos (no
  // companyId claim) — a claim-carrying member stamping their own uid would
  // hide the photo from the company gallery/rollup (the expenses threat
  // model applied to every rollup-feeding create).
  await assertSucceeds(setDoc(doc(alice, 'photos/newStamped'),
    { userId: 'alice', companyId: 'co-a', url: 'p/n1.jpg' }));
  await assertFails(setDoc(doc(alice, 'photos/newSoloKey'),
    { userId: 'alice', companyId: 'alice', url: 'p/n2.jpg' }));
  await assertSucceeds(setDoc(doc(solo, 'photos/newTrueSolo'),
    { userId: 'solo1', companyId: 'solo1', url: 'p/n2b.jpg' }));
  await assertSucceeds(setDoc(doc(alice, 'photos/newLegacy'),
    { userId: 'alice', url: 'p/n3.jpg' }));
  await assertFails(setDoc(doc(alice, 'photos/newForeign'),
    { userId: 'alice', companyId: 'co-b', url: 'p/n4.jpg' }));
  // ✅ collaboration writes follow the parent for same-company staff:
  // a well-shaped timeline note, a task, a note — all F-05 constraints
  // still bind (source/type/denylist proven by the earlier F-05 block).
  await assertSucceeds(setDoc(doc(mgrA, 'leads/leadA2/activity/mgr-note'),
    { userId: 'mia', type: 'note', source: 'rep', note: 'manager follow-up' }));
  await assertSucceeds(setDoc(doc(mgrA, 'leads/leadA2/tasks/mgr-task'),
    { userId: 'mia', title: 'call back', done: false }));
  await assertSucceeds(setDoc(doc(coAdmin, 'leads/leadA2/notes/ca-note'),
    { userId: 'carol', text: 'owner note' }));
  // ✅ documents + drawings, completing that same 2026-07 pass. Both kept the
  // pre-pass owner-only WRITE clause while their READ already admitted a
  // company reader, so a manager could see every document on a teammate's
  // lead and attach none — no signed doc, no generated contract, and no
  // photo-report row once photo-report.js started filing one.
  await assertSucceeds(setDoc(doc(mgrA, 'leads/leadA2/documents/mgr-doc'),
    { name: 'HomeownerPhotos.pdf', url: 'https://x/y.pdf', uploadedBy: 'mia', source: 'photo_report' }));
  await assertSucceeds(setDoc(doc(coAdmin, 'leads/leadA2/drawings/ca-draw'),
    { userId: 'carol', shapes: [] }));
  // …and the owner still writes their own, unchanged.
  await assertSucceeds(setDoc(doc(alice, 'leads/leadA2/documents/owner-doc'),
    { name: 'signed.pdf', url: 'https://x/s.pdf', uploadedBy: 'alice' }));
  // ❌ …but never cross-tenant, never viewer, and never with a forged shape.
  await assertFails(setDoc(doc(mgrB, 'leads/leadA2/activity/xt-forge'),
    { userId: 'mob', type: 'note', source: 'rep', note: 'nope' }));
  await assertFails(setDoc(doc(viewerA, 'leads/leadA2/tasks/viewer-task'),
    { userId: 'vera', title: 'nope', done: false }));
  // viewer is read-only on the two collections just widened — isCompanyStaff()
  // is company_admin|manager only, and this is the assertion that proves the
  // widening did not reach for isCompanyReader() by mistake.
  await assertFails(setDoc(doc(viewerA, 'leads/leadA2/documents/viewer-doc'),
    { name: 'nope.pdf', url: 'https://x/n.pdf', uploadedBy: 'vera' }));
  await assertFails(setDoc(doc(viewerA, 'leads/leadA2/drawings/viewer-draw'),
    { userId: 'vera', shapes: [] }));
  // …and a manager in ANOTHER tenant still cannot touch either.
  await assertFails(setDoc(doc(mgrB, 'leads/leadA2/documents/xt-doc'),
    { name: 'nope.pdf', url: 'https://x/n.pdf', uploadedBy: 'mob' }));
  await assertFails(setDoc(doc(mgrB, 'leads/leadA2/drawings/xt-draw'),
    { userId: 'mob', shapes: [] }));
  await assertFails(setDoc(doc(mgrA, 'leads/leadA2/activity/mgr-webhook-forge'),
    { userId: 'mia', type: 'note', source: 'rep', note: 'x', stripeInvoiceId: 'in_123' }));

  // 28a2. DOCUMENT STATUS (2026-09-17 lifecycle field) — documentStatusWriteOk()
  // is shape-only (draft/sent/signed), NOT access-tier gating. onPersistFinalized
  // (in-person signing, document-generator.js) sets 'signed' via a plain client
  // updateDoc, same trust bar signedAt/signedSigners have always had — there is
  // no Cloud Function in that path to defer to, so 'signed' has to stay reachable
  // by the same owner-or-same-company-staff writers as every other field here.
  await assertSucceeds(setDoc(doc(alice, 'leads/leadA2/documents/status-draft'),
    { name: 'contract.html', status: 'draft' }));
  await assertSucceeds(setDoc(doc(mgrA, 'leads/leadA2/documents/status-sent'),
    { name: 'contract.html', status: 'sent' }));
  await assertSucceeds(setDoc(doc(alice, 'leads/leadA2/documents/status-signed'),
    { name: 'contract.html', status: 'signed' }));
  await assertFails(setDoc(doc(alice, 'leads/leadA2/documents/status-bogus'),
    { name: 'contract.html', status: 'made_up_status' }));
  // absence-safe — a write that never touches status still succeeds (e.g.
  // the homeowner-share toggle on an already-created row).
  await assertSucceeds(updateDoc(doc(alice, 'leads/leadA2/documents/status-draft'),
    { sharedWithHomeowner: true }));

  // 28b. WARRANTY CLAIMS (2026-09-15 Warranty Claim lane) — same
  // owner-or-same-company-staff shape as documents/drawings just above,
  // plus warrantyClaimWriteOk()'s enum gate on status/reason.
  await assertSucceeds(setDoc(doc(alice, 'leads/leadA2/warrantyClaims/claim-owner'),
    { status: 'open', reason: 'workmanship', issueDescription: 'leak at chimney' }));
  await assertSucceeds(setDoc(doc(mgrA, 'leads/leadA2/warrantyClaims/claim-mgr'),
    { status: 'scheduled', reason: 'material', scheduledDate: '2026-10-01' }));
  await assertSucceeds(getDoc(doc(viewerA, 'leads/leadA2/warrantyClaims/claim-owner')));
  // ❌ viewer read-only, cross-tenant staff dead, forged status/reason denied.
  await assertFails(setDoc(doc(viewerA, 'leads/leadA2/warrantyClaims/viewer-claim'),
    { status: 'open', reason: 'workmanship' }));
  await assertFails(setDoc(doc(mgrB, 'leads/leadA2/warrantyClaims/xt-claim'),
    { status: 'open', reason: 'workmanship' }));
  await assertFails(getDoc(doc(mgrB, 'leads/leadA2/warrantyClaims/claim-owner')));
  await assertFails(setDoc(doc(alice, 'leads/leadA2/warrantyClaims/bad-status'),
    { status: 'made_up_status', reason: 'workmanship' }));
  await assertFails(setDoc(doc(alice, 'leads/leadA2/warrantyClaims/bad-reason'),
    { status: 'open', reason: 'made_up_reason' }));
  // ✅ absence-safe — a claim update that never touches status/reason
  // (e.g. just diagnosisNotes) still succeeds.
  await assertSucceeds(updateDoc(doc(alice, 'leads/leadA2/warrantyClaims/claim-owner'),
    { diagnosisNotes: 'found a gap in the flashing' }));

  // 28c. openClaimIdOk() — the LEAD's own denormalized pointer field.
  // leadD (used by the stageWriteOk/paperworkFieldsOk blocks above) is
  // hard-deleted by section 23, so this reuses leadA2/alice like the
  // documents/drawings block just above instead.
  await assertSucceeds(updateDoc(doc(alice, 'leads/leadA2'), { openWarrantyClaimId: 'claim-owner' }));
  await assertSucceeds(updateDoc(doc(alice, 'leads/leadA2'), { openWarrantyClaimId: null }));
  await assertFails(updateDoc(doc(alice, 'leads/leadA2'), { openWarrantyClaimId: 123 }));
  await assertFails(updateDoc(doc(alice, 'leads/leadA2'), { openWarrantyClaimId: 'x'.repeat(61) }));
  await assertSucceeds(updateDoc(doc(alice, 'leads/leadA2'), { openWarrantyClaimId: 'x'.repeat(60) }));

  // 29. USER TEMPLATE-SYNC SUBCOLLECTIONS (feat/template-sync).
  //     job-templates.js mirrors + hydrates custom job templates at
  //     users/{uid}/jobTemplates/{tplId} — including the single '_usage'
  //     rollup doc — and template-suite.js mirrors at
  //     users/{uid}/templates/{tplId}. Contract: owner full read/write
  //     (create/update/delete — remove() deletes the mirror doc), platform
  //     admin may read (support context), stranger + anon fully denied.
  //     These pin the EXPLICIT subcollection matches added under
  //     /users/{uid} so the sync can't silently 403 again.
  const jtTpl = { id: 'jt_custom_deck_x1', name: 'Deck repair custom', custom: true,
    updatedAt: new Date().toISOString(), items: [] };
  // ✅ owner create / read / update
  await assertSucceeds(setDoc(doc(alice, 'users/alice/jobTemplates/jt_custom_deck_x1'), jtTpl));
  await assertSucceeds(getDoc(doc(alice, 'users/alice/jobTemplates/jt_custom_deck_x1')));
  await assertSucceeds(updateDoc(doc(alice, 'users/alice/jobTemplates/jt_custom_deck_x1'),
    { name: 'Deck repair custom v2', updatedAt: new Date().toISOString() }));
  // ✅ the '_usage' rollup doc rides the same rule (owner read/write)
  await assertSucceeds(setDoc(doc(alice, 'users/alice/jobTemplates/_usage'),
    { kind: 'usage', usage: { jt_custom_deck_x1: { n: 2, last: 1752900000000 } },
      updatedAt: new Date().toISOString() }));
  await assertSucceeds(getDoc(doc(alice, 'users/alice/jobTemplates/_usage')));
  // ❌ stranger read/write denied; anon denied
  await assertFails(getDoc(doc(bob, 'users/alice/jobTemplates/jt_custom_deck_x1')));
  await assertFails(setDoc(doc(bob, 'users/alice/jobTemplates/forged'), { id: 'forged', name: 'x' }));
  await assertFails(updateDoc(doc(bob, 'users/alice/jobTemplates/jt_custom_deck_x1'), { name: 'hijack' }));
  await assertFails(deleteDoc(doc(bob, 'users/alice/jobTemplates/jt_custom_deck_x1')));
  await assertFails(getDoc(doc(anon, 'users/alice/jobTemplates/jt_custom_deck_x1')));
  await assertFails(getDoc(doc(bob, 'users/alice/jobTemplates/_usage')));
  // ✅ platform admin reads (support context)
  await assertSucceeds(getDoc(doc(admin, 'users/alice/jobTemplates/jt_custom_deck_x1')));
  // ✅ owner delete (JobTemplates.remove() cloud cleanup path)
  await assertSucceeds(deleteDoc(doc(alice, 'users/alice/jobTemplates/jt_custom_deck_x1')));
  // …and the /templates twin (template-suite mirror — writes there were
  // silently denied by the same missing-match class of bug):
  await assertSucceeds(setDoc(doc(alice, 'users/alice/templates/tpl1'),
    { name: 'Email template', updatedAt: new Date().toISOString() }));
  await assertSucceeds(getDoc(doc(alice, 'users/alice/templates/tpl1')));
  await assertSucceeds(updateDoc(doc(alice, 'users/alice/templates/tpl1'), { name: 'Email template v2' }));
  await assertFails(getDoc(doc(bob, 'users/alice/templates/tpl1')));
  await assertFails(setDoc(doc(bob, 'users/alice/templates/forged'), { name: 'x' }));
  await assertFails(getDoc(doc(anon, 'users/alice/templates/tpl1')));
  await assertSucceeds(getDoc(doc(admin, 'users/alice/templates/tpl1')));
  await assertSucceeds(deleteDoc(doc(alice, 'users/alice/templates/tpl1')));

  // 30. TEAM VISIBILITY: estimates (managers/admins) + top-level notes.
  //     Estimates carry pricing → company_admin + manager read the tenant's
  //     estimates so estCount/pipeline reflect the team; viewer is EXCLUDED
  //     (mirrors recordings/storm_proofs, not the broader isCompanyReader).
  //     Top-level /notes are activity log → the PARENT LEAD's owner sees a
  //     teammate's note on their lead (the manager stage-change fix) and any
  //     same-company member sees the timeline; author-only was the old bug.
  //     Reuses collection/query/where/getDocs (declared at the drawings block)
  //     + contexts alice/bob/coAdmin/mgrA/viewerA.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'leads/leadTeamA'), { userId: 'alice', name: 'Team Lead A', companyId: 'co-a' });
    await setDoc(doc(db, 'estimates/est-teamA'), { userId: 'alice', companyId: 'co-a', grandTotal: 5000, name: 'Alice est' });
    await setDoc(doc(db, 'estimates/est-legacy'), { userId: 'alice', name: 'Legacy est (no companyId)' });
    await setDoc(doc(db, 'notes/note-mgr'), { leadId: 'leadTeamA', userId: 'mia', text: 'Stage moved to Inspected' });
  });
  // Estimates: owner + EVERY same-company reader (admin/manager/viewer) read;
  // cross-tenant denied. viewer is now included (isCompanyReader) by owner call.
  await assertSucceeds(getDoc(doc(alice,   'estimates/est-teamA')));   // owner
  await assertSucceeds(getDoc(doc(coAdmin, 'estimates/est-teamA')));   // company_admin, co-a
  await assertSucceeds(getDoc(doc(mgrA,    'estimates/est-teamA')));   // manager, co-a
  await assertSucceeds(getDoc(doc(viewerA, 'estimates/est-teamA')));   // viewer, co-a (now included)
  await assertFails(getDoc(doc(bob,        'estimates/est-teamA')));   // cross-tenant
  // Legacy estimate (no companyId) stays owner-only — sameCompany needs both non-null.
  await assertSucceeds(getDoc(doc(alice,   'estimates/est-legacy')));
  await assertFails(getDoc(doc(coAdmin,    'estimates/est-legacy')));
  // The customer-page two-scope LIST query (audit 2026-08-02 fix): a company
  // reader's {leadId, companyId} pair is provable under the rule; the same
  // shape aimed at a foreign tenant is denied outright.
  await assertSucceeds(getDocs(query(collection(coAdmin, 'estimates'),
    where('leadId', '==', 'leadTeamA'), where('companyId', '==', 'co-a'))));
  await assertSucceeds(getDocs(query(collection(viewerA, 'estimates'),
    where('leadId', '==', 'leadTeamA'), where('companyId', '==', 'co-a'))));
  await assertFails(getDocs(query(collection(bob, 'estimates'),
    where('leadId', '==', 'leadTeamA'), where('companyId', '==', 'co-a'))));
  // Create pins companyId to the caller's tenant — can't inject into a victim tenant.
  await assertFails(setDoc(doc(alice, 'estimates/est-forge'), { userId: 'alice', companyId: 'co-b', grandTotal: 1 }));
  await assertSucceeds(setDoc(doc(alice, 'estimates/est-ok'),  { userId: 'alice', companyId: 'co-a', grandTotal: 1 }));
  // Notes: the lead OWNER reads a manager-authored note on their lead (#6 fix),
  // same-company staff read it, cross-tenant denied. Both getDoc AND the
  // leadId-scoped list query (the timeline's real query) must pass.
  await assertSucceeds(getDoc(doc(alice,   'notes/note-mgr')));        // owner of parent lead
  await assertSucceeds(getDoc(doc(mgrA,    'notes/note-mgr')));        // same-company manager
  await assertSucceeds(getDoc(doc(coAdmin, 'notes/note-mgr')));        // same-company admin
  await assertFails(getDoc(doc(bob,        'notes/note-mgr')));        // cross-tenant
  await assertSucceeds(getDocs(query(collection(alice, 'notes'), where('leadId', '==', 'leadTeamA'))));
  await assertFails(getDocs(query(collection(bob,   'notes'), where('leadId', '==', 'leadTeamA'))));


  // 31. UNTESTED-FOR-A-MONTH COLLECTIONS (2026-09-02). Four rule blocks had
  //     ZERO assertions in either rules suite — /invoices, /supplements,
  //     /connectAccounts and leads/{id}/portal_messages — so a regression in
  //     any of them (a money doc re-tenanted, a homeowner thread readable
  //     cross-tenant, a company_admin flipping chargesEnabled from devtools)
  //     would have shipped unnoticed. Reuses contexts alice/bob/admin/coAdmin/
  //     mgrA/viewerA/viewer/solo/anon and leadTeamA (alice, co-a) from test 30.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'leads/leadTeamA/portal_messages/pm1'), { from: 'homeowner', text: 'When can you start?', createdAt: 1 });
    await setDoc(doc(db, 'supplements/sup-a'), { userId: 'alice', leadId: 'leadTeamA', parentEstimateId: 'est-ok', version: 1, status: 'draft' });
    await setDoc(doc(db, 'connectAccounts/co-a'),  { accountId: 'acct_a', chargesEnabled: true });
    await setDoc(doc(db, 'connectAccounts/co-b'),  { accountId: 'acct_b', chargesEnabled: false });
    await setDoc(doc(db, 'connectAccounts/solo1'), { accountId: 'acct_s', chargesEnabled: true });
    await setDoc(doc(db, 'connectAccountIds/acct_a'), { companyId: 'co-a' });
    await setDoc(doc(db, 'invoices/inv-a'), { createdBy: 'alice', companyId: 'co-a', estimateId: 'est-ok', createdAt: 1, balanceDue: 10000, status: 'sent' });
    await setDoc(doc(db, 'invoices/inv-v'), { createdBy: 'vic',   companyId: 'co-v', estimateId: 'est-v',  createdAt: 1, balanceDue: 500,   status: 'sent' });
  });
  // portal_messages: parent-lead owner + same-company readers (admin/manager/
  // viewer) read; cross-tenant + anon denied; NO client writes — not even
  // platform admin (homeowner threads are written by the portal functions).
  await assertSucceeds(getDoc(doc(alice,   'leads/leadTeamA/portal_messages/pm1')));
  await assertSucceeds(getDoc(doc(coAdmin, 'leads/leadTeamA/portal_messages/pm1')));
  await assertSucceeds(getDoc(doc(mgrA,    'leads/leadTeamA/portal_messages/pm1')));
  await assertSucceeds(getDoc(doc(viewerA, 'leads/leadTeamA/portal_messages/pm1')));
  await assertSucceeds(getDoc(doc(admin,   'leads/leadTeamA/portal_messages/pm1')));
  await assertFails(getDoc(doc(bob,        'leads/leadTeamA/portal_messages/pm1')));
  await assertFails(getDoc(doc(anon,       'leads/leadTeamA/portal_messages/pm1')));
  await assertFails(setDoc(doc(alice,  'leads/leadTeamA/portal_messages/pm2'), { from: 'rep', text: 'forged' }));
  await assertFails(updateDoc(doc(alice, 'leads/leadTeamA/portal_messages/pm1'), { text: 'edited' }));
  await assertFails(setDoc(doc(admin,  'leads/leadTeamA/portal_messages/pm3'), { from: 'rep', text: 'even admin' }));
  // supplements: owner-only read/delete (+ platform admin) — CURRENT contract,
  // company staff are NOT granted; create must carry the caller's uid; update
  // may neither re-own nor re-point parentEstimateId; cross-tenant denied.
  await assertSucceeds(getDoc(doc(alice,   'supplements/sup-a')));
  await assertSucceeds(getDoc(doc(admin,   'supplements/sup-a')));
  await assertFails(getDoc(doc(bob,        'supplements/sup-a')));
  await assertFails(getDoc(doc(coAdmin,    'supplements/sup-a')));
  await assertSucceeds(setDoc(doc(alice, 'supplements/sup-new'),   { userId: 'alice', leadId: 'leadTeamA', parentEstimateId: 'est-ok', version: 2, status: 'draft' }));
  await assertFails(setDoc(doc(alice,    'supplements/sup-forge'), { userId: 'bob',   leadId: 'leadB',     parentEstimateId: 'est-x',  version: 1 }));
  await assertFails(setDoc(doc(anon,     'supplements/sup-anon'),  { userId: 'alice', parentEstimateId: 'est-ok' }));
  await assertSucceeds(updateDoc(doc(alice, 'supplements/sup-a'), { status: 'sent' }));
  await assertFails(updateDoc(doc(alice,    'supplements/sup-a'), { parentEstimateId: 'est-other' }));
  await assertFails(updateDoc(doc(alice,    'supplements/sup-a'), { userId: 'bob' }));
  await assertFails(updateDoc(doc(bob,      'supplements/sup-a'), { status: 'void' }));
  await assertFails(deleteDoc(doc(bob,      'supplements/sup-a')));
  await assertSucceeds(deleteDoc(doc(alice, 'supplements/sup-new')));
  // connectAccounts: same-tenant read (a rep must resolve the collect-online
  // capability), solo uid==companyId read, cross-tenant + anon denied, and
  // NO client write of any kind — flipping chargesEnabled from devtools would
  // self-authorize money collection. connectAccountIds: nobody reads.
  await assertSucceeds(getDoc(doc(alice,   'connectAccounts/co-a')));
  await assertSucceeds(getDoc(doc(coAdmin, 'connectAccounts/co-a')));
  await assertSucceeds(getDoc(doc(solo,    'connectAccounts/solo1')));
  await assertSucceeds(getDoc(doc(admin,   'connectAccounts/co-b')));
  await assertFails(getDoc(doc(bob,        'connectAccounts/co-a')));
  await assertFails(getDoc(doc(anon,       'connectAccounts/co-a')));
  await assertFails(updateDoc(doc(coAdmin, 'connectAccounts/co-a'), { chargesEnabled: false }));
  await assertFails(setDoc(doc(coAdmin,    'connectAccounts/co-a'), { chargesEnabled: true, accountId: 'acct_evil' }));
  await assertFails(setDoc(doc(admin,      'connectAccounts/co-c'), { chargesEnabled: true }));
  await assertFails(getDoc(doc(alice,      'connectAccountIds/acct_a')));
  await assertFails(getDoc(doc(admin,      'connectAccountIds/acct_a')));
  // invoices: owner + same-company STAFF (company_admin/manager) read — viewer is
  // NOT staff; cross-tenant + anon denied. Create pins companyId to the caller's
  // tenant (or to the uid for a claim-less solo, the /expenses #12 fallback).
  // Update freezes createdBy/companyId/estimateId/createdAt but leaves money
  // fields mutable (markPaid). A viewer-role owner can neither update nor delete.
  await assertSucceeds(getDoc(doc(alice,   'invoices/inv-a')));
  await assertSucceeds(getDoc(doc(coAdmin, 'invoices/inv-a')));
  await assertSucceeds(getDoc(doc(mgrA,    'invoices/inv-a')));
  await assertSucceeds(getDoc(doc(admin,   'invoices/inv-a')));
  await assertFails(getDoc(doc(viewerA,    'invoices/inv-a')));
  await assertFails(getDoc(doc(bob,        'invoices/inv-a')));
  await assertFails(getDoc(doc(anon,       'invoices/inv-a')));
  await assertSucceeds(setDoc(doc(alice, 'invoices/inv-new'),    { createdBy: 'alice', companyId: 'co-a', estimateId: 'est-ok', createdAt: 2, balanceDue: 1 }));
  await assertFails(setDoc(doc(alice,    'invoices/inv-forge'),  { createdBy: 'alice', companyId: 'co-b', estimateId: 'est-ok', createdAt: 2, balanceDue: 1 }));
  await assertFails(setDoc(doc(alice,    'invoices/inv-forge2'), { createdBy: 'bob',   companyId: 'co-a', estimateId: 'est-ok', createdAt: 2, balanceDue: 1 }));
  await assertFails(setDoc(doc(alice,    'invoices/inv-forge3'), { createdBy: 'alice', companyId: '',     estimateId: 'est-ok', createdAt: 2, balanceDue: 1 }));
  await assertSucceeds(setDoc(doc(solo,  'invoices/inv-solo'),   { createdBy: 'solo1', companyId: 'solo1', estimateId: 'est-s', createdAt: 2, balanceDue: 1 }));
  await assertFails(setDoc(doc(solo,     'invoices/inv-solo2'),  { createdBy: 'solo1', companyId: 'co-a',  estimateId: 'est-s', createdAt: 2, balanceDue: 1 }));
  await assertSucceeds(updateDoc(doc(alice, 'invoices/inv-a'), { balanceDue: 0, amountPaid: 10000, status: 'paid' }));
  await assertFails(updateDoc(doc(alice,    'invoices/inv-a'), { companyId: 'co-b' }));
  await assertFails(updateDoc(doc(alice,    'invoices/inv-a'), { createdBy: 'bob' }));
  await assertFails(updateDoc(doc(alice,    'invoices/inv-a'), { estimateId: 'est-other' }));
  await assertFails(updateDoc(doc(bob,      'invoices/inv-a'), { status: 'void' }));
  await assertFails(updateDoc(doc(viewer,   'invoices/inv-v'), { status: 'paid' }));
  await assertFails(deleteDoc(doc(viewer,   'invoices/inv-v')));
  await assertFails(deleteDoc(doc(bob,      'invoices/inv-a')));
  await assertSucceeds(deleteDoc(doc(alice, 'invoices/inv-new')));

  // 32. invoices: same-company STAFF update (2026-09-15, Collections
  //     foundation). UPDATE used to be createdBy-only even though READ
  //     already granted the whole team company-scoped access — a manager
  //     could SEE a teammate's outstanding invoice in a shared Collections
  //     queue but got PERMISSION_DENIED trying to Mark Paid it. Mirrors the
  //     /leads isCompanyStaff-update precedent. DELETE stays narrower —
  //     owner or company_admin only, NOT manager — same split /leads makes.
  // ✅ a manager (not the creator) can now update a teammate's invoice —
  //    the exact "whoever's free works the queue" capability this exists for
  await assertSucceeds(updateDoc(doc(mgrA, 'invoices/inv-a'), { status: 'paid', balanceDue: 0 }));
  // ✅ so can the tenant owner (company_admin), also not the creator
  await assertSucceeds(updateDoc(doc(coAdmin, 'invoices/inv-a'), { status: 'sent' }));
  // ✅ staff update still can't re-tenant / re-own / re-point the invoice —
  //    the SAME provenance freeze the owner path is already held to
  await assertFails(updateDoc(doc(mgrA, 'invoices/inv-a'), { companyId: 'co-b' }));
  await assertFails(updateDoc(doc(mgrA, 'invoices/inv-a'), { createdBy: 'mia' }));
  // ❌ a manager from a DIFFERENT tenant (mgrB, co-b) still can't touch a
  //    co-a invoice — the company-scope check, not just the role check, is
  //    what's actually gating this
  await assertFails(updateDoc(doc(mgrB, 'invoices/inv-a'), { status: 'void' }));
  // ✅ a company_admin (not the creator) can delete a teammate's invoice —
  //    the tenant owner destroying a billing record, same as /leads
  await assertSucceeds(deleteDoc(doc(coAdmin, 'invoices/inv-a')));
  // ❌ but a manager — staff, just not the owner — still cannot delete;
  //    only UPDATE was widened to staff, DELETE deliberately was not
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'invoices/inv-mgr-del'), { createdBy: 'alice', companyId: 'co-a', estimateId: 'est-ok', createdAt: 3, balanceDue: 200, status: 'sent' });
  });
  await assertFails(deleteDoc(doc(mgrA, 'invoices/inv-mgr-del')));

  // 33. email_suppressions + email_unsub_tokens (2026-09-22, CAN-SPAM email
  //     unsubscribe — functions/email-suppression.js). Suppressions are
  //     server-write only; a GET is allowed to a member of the tenant named in
  //     the doc-id PREFIX (companyId claim, or uid for a claim-less solo), so
  //     the customer page can show an "Unsubscribed" badge. Missing doc in my
  //     tenant → readable (badge off). Other tenant → denied whether or not the
  //     doc exists (no existence probe). No list. Tokens: no client access.
  //     Writes are tested as BOTH create and update (rules-testing rule).
  const SUPH = 'a'.repeat(64);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const sdb = ctx.firestore();
    await setDoc(doc(sdb, 'email_suppressions/co-a__' + SUPH), { companyId: 'co-a', emailHash: SUPH, email: 'h@x.test', source: 'link', createdAt: 1 });
    await setDoc(doc(sdb, 'email_suppressions/solo1__' + SUPH), { companyId: 'solo1', emailHash: SUPH, email: 'h@x.test', source: 'rep', createdAt: 1 });
    // A doc filed under co-a's prefix but claiming another tenant — must not be readable.
    await setDoc(doc(sdb, 'email_suppressions/co-a__' + 'b'.repeat(64)), { companyId: 'co-b', emailHash: 'b', email: 'x@x.test', source: 'link', createdAt: 1 });
    await setDoc(doc(sdb, 'email_unsub_tokens/TOKEN_A'), { companyId: 'co-a', email: 'h@x.test', emailHash: SUPH, createdAt: 1 });
  });
  // ✅ same-tenant members (rep, company_admin) read the badge doc
  await assertSucceeds(getDoc(doc(alice,   'email_suppressions/co-a__' + SUPH)));
  await assertSucceeds(getDoc(doc(coAdmin, 'email_suppressions/co-a__' + SUPH)));
  // ✅ a missing doc in MY tenant reads as not-found (badge off), not denied
  await assertSucceeds(getDoc(doc(alice,   'email_suppressions/co-a__' + 'c'.repeat(64))));
  // ✅ claim-less solo operator: tenant key is the uid
  await assertSucceeds(getDoc(doc(solo,    'email_suppressions/solo1__' + SUPH)));
  // ❌ another tenant — existing AND missing docs both denied (no probe)
  await assertFails(getDoc(doc(bob,        'email_suppressions/co-a__' + SUPH)));
  await assertFails(getDoc(doc(bob,        'email_suppressions/co-a__' + 'c'.repeat(64))));
  await assertFails(getDoc(doc(dave,       'email_suppressions/co-a__' + SUPH)));
  await assertFails(getDoc(doc(solo,       'email_suppressions/co-a__' + SUPH)));
  await assertFails(getDoc(doc(anon,       'email_suppressions/co-a__' + SUPH)));
  // ❌ a doc whose companyId disagrees with its prefix is not readable by the prefix tenant
  await assertFails(getDoc(doc(alice,      'email_suppressions/co-a__' + 'b'.repeat(64))));
  // ❌ no list, even filtered to my own tenant
  await assertFails(getDocs(query(collection(alice, 'email_suppressions'), where('companyId', '==', 'co-a'))));
  // ❌ no client write — create (forge an opt-out) ...
  await assertFails(setDoc(doc(alice,   'email_suppressions/co-a__' + 'd'.repeat(64)), { companyId: 'co-a', emailHash: 'd', email: 'n@x.test', source: 'rep', createdAt: 1 }));
  await assertFails(setDoc(doc(coAdmin, 'email_suppressions/co-a__' + 'd'.repeat(64)), { companyId: 'co-a', emailHash: 'd', email: 'n@x.test', source: 'rep', createdAt: 1 }));
  await assertFails(setDoc(doc(admin,   'email_suppressions/co-a__' + 'd'.repeat(64)), { companyId: 'co-a', emailHash: 'd', email: 'n@x.test', source: 'rep', createdAt: 1 }));
  // ... update / delete (un-suppress someone who opted out)
  await assertFails(updateDoc(doc(alice,   'email_suppressions/co-a__' + SUPH), { source: 'rep' }));
  await assertFails(updateDoc(doc(coAdmin, 'email_suppressions/co-a__' + SUPH), { companyId: 'co-z' }));
  await assertFails(deleteDoc(doc(coAdmin, 'email_suppressions/co-a__' + SUPH)));
  await assertFails(deleteDoc(doc(solo,    'email_suppressions/solo1__' + SUPH)));
  // ❌ tokens: no client access at all — read, list, create, update, delete
  await assertFails(getDoc(doc(alice,   'email_unsub_tokens/TOKEN_A')));
  await assertFails(getDoc(doc(coAdmin, 'email_unsub_tokens/TOKEN_A')));
  await assertFails(getDoc(doc(admin,   'email_unsub_tokens/TOKEN_A')));
  await assertFails(getDoc(doc(anon,    'email_unsub_tokens/TOKEN_A')));
  await assertFails(getDocs(query(collection(alice, 'email_unsub_tokens'), where('companyId', '==', 'co-a'))));
  await assertFails(setDoc(doc(alice,   'email_unsub_tokens/FORGED'), { companyId: 'co-a', email: 'v@x.test', createdAt: 1 }));
  await assertFails(updateDoc(doc(coAdmin, 'email_unsub_tokens/TOKEN_A'), { email: 'other@x.test' }));
  await assertFails(deleteDoc(doc(coAdmin, 'email_unsub_tokens/TOKEN_A')));

  // ══ #12 GUARD, the 12 collections the 2026-08-10 audit extended it to ══
  //
  // The defect (SITE-AUDIT-LOOSE-ENDS-2026-08-10 item 12): a MEMBER holding a
  // companyId claim could stamp `companyId = own-uid` on create. The doc then
  // belongs to a "tenant" nobody else is in, so it vanishes from every
  // company_admin/manager rollup and from the crons that filter by tenant —
  // while still looking perfectly normal to the rep who wrote it. It is a
  // hide-from-your-boss primitive, not a cross-tenant read.
  //
  // The guard shipped on all 12, but only /expenses (which already had it)
  // ever got assertions — see the #12 block in the expenses section above.
  // That is the gap this closes; it was carried in WEEKLY_CADENCE's agent
  // backlog as "#12-guard cases for the 12 newly guarded creates".
  //
  // FOUR assertions per collection, and the two ✅ ones are why this is not
  // theatre: a `assertFails` passes just as happily when the doc shape is
  // wrong (missing a required field, a hasOnly violation) as when the guard
  // fires. The "member stamps the CORRECT companyId succeeds" control proves
  // the payload is otherwise valid, so the ❌ above it can only be the guard.
  const guardDoc = {
    // { userId, companyId } unless the rule wants something else.
    leads:              (uid, cid) => ({ userId: uid, companyId: cid, name: 'Guard Lead' }),
    estimates:          (uid, cid) => ({ userId: uid, companyId: cid, total: 1000 }),
    recurringExpenses:  (uid, cid) => ({ userId: uid, companyId: cid, amountCents: 5000, costType: 'overhead' }),
    // hasOnly: extra keys are refused, so keep to the allowlist.
    suppliers:          (uid, cid) => ({ userId: uid, companyId: cid, displayName: 'Guard Supply' }),
    photos:             (uid, cid) => ({ userId: uid, companyId: cid, url: 'p/guard.jpg' }),
    pins:               (uid, cid) => ({ userId: uid, companyId: cid, lat: 39.1, lng: -84.5 }),
    zones:              (uid, cid) => ({ userId: uid, companyId: cid, name: 'Guard Zone' }),
    knocks:             (uid, cid) => ({ userId: uid, companyId: cid, outcome: 'not_home' }),
    territories:        (uid, cid) => ({ userId: uid, companyId: cid, name: 'Guard Terr' }),
    training_sessions:  (uid, cid) => ({ userId: uid, companyId: cid, score: 7 }),
    // invoices key off createdBy, not userId.
    invoices:           (uid, cid) => ({ createdBy: uid, companyId: cid, totalCents: 1000 }),
    reports:            (uid, cid) => ({ userId: uid, companyId: cid, kind: 'summary' }),
  };
  const GUARDED = Object.keys(guardDoc);
  if (GUARDED.length !== 12) throw new Error('#12 guard table should cover 12 collections, has ' + GUARDED.length);

  for (const coll of GUARDED) {
    const mk = guardDoc[coll];
    // /reps is keyed by the rep's own uid (isOwner(repId)), so its doc id is
    // not free-form like the others; it is covered separately below.
    // ❌ THE DEFECT: member with claim co-a stamps companyId = her own uid.
    await assertFails(setDoc(doc(alice, coll + '/g12-hide'), mk('alice', 'alice')));
    // ✅ CONTROL: same writer, same shape, correct tenant — proves the payload
    //    is valid and the ❌ above fired on the guard, not on a bad field.
    await assertSucceeds(setDoc(doc(alice, coll + '/g12-ok'), mk('alice', 'co-a')));
    // ✅ a TRUE solo (no companyId claim) may pin companyId to its own uid.
    await assertSucceeds(setDoc(doc(solo, coll + '/g12-solo'), mk('solo1', 'solo1')));
    // ❌ but a solo still cannot pin to a FOREIGN tenant.
    await assertFails(setDoc(doc(solo, coll + '/g12-solo-forge'), mk('solo1', 'co-a')));
  }

  // /reps: same guard, but create is gated on the doc id BEING the writer's
  // uid (isOwner(repId)), so every case has exactly one legal path and the
  // ORDER matters — once the doc exists, setDoc is an UPDATE against a
  // different rule. Denials first, the create last.
  //
  // `dave`, not `alice`: the rules-disabled setup at the top of this file
  // seeds reps/alice and reps/bob, so a setDoc there is an update that also
  // drops the seeded `role` and trips didNotChange — a denial for the wrong
  // reason. dave carries a companyId claim (co-d) and no seeded rep doc.
  // ❌ THE DEFECT on the reps path: claim-carrying member stamps own uid
  await assertFails(setDoc(doc(dave, 'reps/dave'), { companyId: 'dave', name: 'Rep D' }));
  // ❌ the pre-existing role-escalation guard still holds alongside it
  await assertFails(setDoc(doc(dave, 'reps/dave'), { companyId: 'co-d', role: 'admin' }));
  // ❌ a solo cannot pin to a foreign tenant (checked BEFORE the doc exists)
  await assertFails(setDoc(doc(solo, 'reps/solo1'), { companyId: 'co-a', name: 'Solo' }));
  // ✅ CONTROL: same writer and shape, correct tenant → the create lands
  await assertSucceeds(setDoc(doc(dave, 'reps/dave'), { companyId: 'co-d', name: 'Rep D' }));
  // ✅ a TRUE solo may pin companyId to its own uid
  await assertSucceeds(setDoc(doc(solo, 'reps/solo1'), { companyId: 'solo1', name: 'Solo' }));

  // The rollup this protects, stated as an assertion rather than a comment:
  // a company_admin's tenant query sees the correctly-stamped doc…
  await assertSucceeds(getDocs(query(collection(coAdmin, 'leads'), where('companyId', '==', 'co-a'))));
  // …and a member cannot write a lead into ANOTHER tenant either (the same
  // clause, failing in the other direction).
  await assertFails(setDoc(doc(alice, 'leads/g12-foreign'), guardDoc.leads('alice', 'co-b')));

  console.log('✓ All firestore rules tests passed');
  await env.cleanup();
}

run().catch((e) => {
  console.error('✗ firestore rules tests failed:', e);
  process.exit(1);
});

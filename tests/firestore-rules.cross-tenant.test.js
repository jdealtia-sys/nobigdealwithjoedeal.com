/**
 * PHASE 1 PROOF — cross-tenant isolation attack matrix for NBD Pro.
 *
 * Companion to firestore-rules.test.js. This file does NOT replace it;
 * it adds explicit "Company B token attacks Company A data" cases across
 * every meaningful collection, plus same-tenant positive controls so we
 * prove the company-scoped reads are correctly permissive *within* a
 * tenant and restrictive *across* tenants.
 *
 * RUN:
 *   cd tests && npm install
 *   firebase emulators:exec --only firestore --project nbd-xtenant-test \
 *     'node ./firestore-rules.cross-tenant.test.js'
 *
 * SEMANTICS: every check below encodes the DESIRED secure behaviour.
 *   - "deny" cases assert the action is rejected.
 *   - "allow" cases assert the action succeeds (same-tenant positive control).
 * A check that does not match the desired behaviour is printed as FAIL and
 * the process exits non-zero. Against the CURRENT rules we EXPECT the
 * companyProfile/* and counters/* cross-tenant checks to FAIL — that is the
 * proof of the two `allow read, write: if isAuth()` footguns. After the
 * proposed fix lands, this file should exit 0.
 */

const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'nbd-xtenant-test';

const results = [];
// opts.knownGap=true → a mismatch is recorded as WARN (tracked-but-unfixed,
// e.g. the P3 counters footgun) and does NOT fail the process exit code.
async function check(label, expect, promise, opts = {}) {
  try {
    if (expect === 'deny') {
      await assertFails(promise);
      results.push({ label, expect, outcome: 'PASS', note: 'correctly denied' });
    } else {
      await assertSucceeds(promise);
      results.push({ label, expect, outcome: 'PASS', note: 'correctly allowed' });
    }
  } catch (e) {
    results.push({
      label, expect,
      outcome: opts.knownGap ? 'WARN' : 'FAIL',
      note: (opts.knownGap ? '(known P3, tracked) ' : '>>> ') +
        (expect === 'deny' ? 'WAS ALLOWED (cross-tenant hole)' : 'was unexpectedly denied')
    });
  }
}

async function run() {
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  // ── Contexts across the tenancy model ──────────────────────
  const alice  = env.authenticatedContext('alice',  { role: 'sales_rep',     companyId: 'co-a' }).firestore(); // victim/owner
  const dave   = env.authenticatedContext('dave',   { role: 'sales_rep',     companyId: 'co-a' }).firestore(); // same-tenant peer
  const eveMgr = env.authenticatedContext('eve',    { role: 'manager',       companyId: 'co-a' }).firestore(); // same-tenant manager
  const bob    = env.authenticatedContext('bob',    { role: 'sales_rep',     companyId: 'co-b' }).firestore(); // ATTACKER (other tenant)
  const bobMgr = env.authenticatedContext('bobm',   { role: 'manager',       companyId: 'co-b' }).firestore(); // attacker w/ manager role
  const bobCA  = env.authenticatedContext('bobca',  { role: 'company_admin', companyId: 'co-b' }).firestore(); // attacker w/ co_admin role
  const noClaim= env.authenticatedContext('nc',     {}).firestore();                                            // authed, NO companyId/role
  const solo   = env.authenticatedContext('solo1',  {}).firestore();                                            // solo operator (keys companyProfile by uid)
  const anon   = env.unauthenticatedContext().firestore();

  const { setDoc, doc, getDoc, updateDoc, deleteDoc } = require('firebase/firestore');

  // ── Seed Company A data with rules disabled (single call) ───
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'companyProfile/co-a'),        { legalName: 'NBD Home Solutions', financing: { apr: 0.0 }, _seed: true }); // per-tenant key
    await setDoc(doc(db, 'companyProfile/solo1'),       { legalName: 'Solo Op', _seed: true });                                      // solo operator (uid key)
    await setDoc(doc(db, 'counters/customerIds'),      { next: 42 });
    await setDoc(doc(db, 'leads/leadA'),               { userId: 'alice', companyId: 'co-a', name: 'Alice Homeowner', phone: '+15555550100' });
    await setDoc(doc(db, 'estimates/estA'),            { userId: 'alice', companyId: 'co-a', total: 28500 });
    await setDoc(doc(db, 'photos/photoA'),             { userId: 'alice', url: 'photos/alice/roof.jpg' });
    await setDoc(doc(db, 'subscriptions/alice'),       { plan: 'professional', status: 'active' });
    await setDoc(doc(db, 'subscriptions/co-a'),        { plan: 'professional', status: 'active', seats: 3 }); // Phase D company-keyed
    await setDoc(doc(db, 'subscriptions/solo1'),       { plan: 'starter', status: 'active' });                // solo: uid == companyId
    await setDoc(doc(db, 'users/alice'),               { firstName: 'Alice', companyId: 'co-a' });
    await setDoc(doc(db, 'leaderboard/alice'),         { companyId: 'co-a', closedDeals: 12, revenue: 480000 });
    await setDoc(doc(db, 'knocks/knockA'),             { userId: 'alice', companyId: 'co-a', address: '1 Secret St' });
    await setDoc(doc(db, 'reps/alice'),                { userId: 'alice', companyId: 'co-a', role: 'sales_rep' });
    await setDoc(doc(db, 'territories/terrA'),         { userId: 'alice', companyId: 'co-a', name: 'North Zone' });
    await setDoc(doc(db, 'training_sessions/tsA'),     { userId: 'alice', companyId: 'co-a' });
    await setDoc(doc(db, 'leads/leadA/recordings/recA'),{ userId: 'alice', companyId: 'co-a', transcript: 'confidential call notes' });
    await setDoc(doc(db, 'leads/leadA/documents/docA'), { userId: 'alice', name: 'Signed Contract.pdf' });
    await setDoc(doc(db, 'leads/leadA/ai_drafts/draftA'),{ userId: 'alice', companyId: 'co-a', status: 'pending', draftText: 'Joe handles pricing personally — want a free inspection?', customerPhone: '+15555550100' });
    await setDoc(doc(db, 'leads/leadA/signatures/Homeowner'),{ userId: 'alice', role: 'Homeowner', png: 'data:image/png;base64,iVBORw0KGgo=' });
    await setDoc(doc(db, 'measurements/measA'),        { ownerId: 'alice', leadId: 'leadA', status: 'ready' });
  });

  // ═══════════════════════════════════════════════════════════
  // A. PER-USER-OWNED COLLECTIONS — cross-tenant read/write must DENY
  //    (these prove the dominant isOwner(userId) model isolates tenants)
  // ═══════════════════════════════════════════════════════════
  await check('leads: B reads A lead',                'deny',  getDoc(doc(bob, 'leads/leadA')));
  await check('leads: B updates A lead',              'deny',  updateDoc(doc(bob, 'leads/leadA'), { name: 'hijacked' }));
  await check('leads: B deletes A lead',              'deny',  deleteDoc(doc(bob, 'leads/leadA')));
  await check('estimates: B reads A estimate',        'deny',  getDoc(doc(bob, 'estimates/estA')));
  await check('photos: B reads A photo',              'deny',  getDoc(doc(bob, 'photos/photoA')));
  await check('subscriptions: B reads A subscription','deny',  getDoc(doc(bob, 'subscriptions/alice')));
  await check('users: B reads A user profile',        'deny',  getDoc(doc(bob, 'users/alice')));
  await check('recordings: B reads A call transcript','deny',  getDoc(doc(bob, 'leads/leadA/recordings/recA')));
  await check('lead documents: B reads A contract',   'deny',  getDoc(doc(bob, 'leads/leadA/documents/docA')));
  await check('measurements: B reads A measurement',  'deny',  getDoc(doc(bob, 'measurements/measA')));
  // T-2 AI texting drafts — owner-scoped (isOwner(resource.data.userId)).
  await check('ai_drafts: B reads A draft',            'deny',  getDoc(doc(bob,    'leads/leadA/ai_drafts/draftA')));
  await check('ai_drafts: B approves A draft',         'deny',  updateDoc(doc(bob, 'leads/leadA/ai_drafts/draftA'), { status: 'approved' }));
  await check('ai_drafts: A owner reads own draft',    'allow', getDoc(doc(alice,  'leads/leadA/ai_drafts/draftA')));
  await check('ai_drafts: rep cannot forge sent',      'deny',  updateDoc(doc(alice, 'leads/leadA/ai_drafts/draftA'), { status: 'sent' }));
  await check('ai_drafts: rep cannot create a draft',  'deny',  setDoc(doc(alice,  'leads/leadA/ai_drafts/forged'), { userId: 'alice', status: 'pending' }));
  await check('ai_drafts: A owner approves own draft', 'allow', updateDoc(doc(alice, 'leads/leadA/ai_drafts/draftA'), { status: 'approved', draftText: 'edited reply', approvedBy: 'alice' }));
  // PR3a saved-signature reuse store — owner-scoped (get(lead).userId).
  await check('signatures: B reads A saved sig',       'deny',  getDoc(doc(bob,   'leads/leadA/signatures/Homeowner')));
  await check('signatures: B writes A saved sig',      'deny',  setDoc(doc(bob,   'leads/leadA/signatures/Homeowner'), { png: 'x' }));
  await check('signatures: A owner reads own sig',     'allow', getDoc(doc(alice, 'leads/leadA/signatures/Homeowner')));
  await check('signatures: A owner writes own sig',    'allow', setDoc(doc(alice, 'leads/leadA/signatures/Rep'), { userId: 'alice', role: 'Rep', png: 'data:image/png;base64,iVBORw0KGgo=' }));

  // ═══════════════════════════════════════════════════════════
  // B. COMPANY-SCOPED COLLECTIONS — cross-tenant DENY, same-tenant ALLOW
  // ═══════════════════════════════════════════════════════════
  await check('leaderboard: B(co-b) reads A(co-a)',   'deny',  getDoc(doc(bob,  'leaderboard/alice')));
  await check('leaderboard: peer dave(co-a) reads A', 'allow', getDoc(doc(dave, 'leaderboard/alice')));
  await check('reps: B(co-b) reads A(co-a) rep',      'deny',  getDoc(doc(bob,  'reps/alice')));
  await check('reps: peer dave(co-a) reads A rep',    'allow', getDoc(doc(dave, 'reps/alice')));
  await check('knocks: B(co-b) reads A(co-a) knock',  'deny',  getDoc(doc(bobMgr, 'knocks/knockA')));
  await check('territories: B(co-b) reads A(co-a)',   'deny',  getDoc(doc(bob,  'territories/terrA')));
  await check('recordings: B-mgr(co-b) reads A rec',  'deny',  getDoc(doc(bobMgr, 'leads/leadA/recordings/recA')));
  await check('recordings: A-mgr eve(co-a) reads A',  'allow', getDoc(doc(eveMgr, 'leads/leadA/recordings/recA')));
  await check('training_sessions: B(co-b) reads A',   'deny',  getDoc(doc(bobMgr, 'training_sessions/tsA')));

  // subscriptions — Phase D: re-keyed per-USER → per-COMPANY (doc id = uid OR
  // companyId). Same-tenant members ALLOW on the company key; cross-tenant +
  // claimless + anon DENY; uid-keyed owner/solo reads still ALLOW. Isolation is
  // on the DOC ID vs the caller's own companyId claim, never resource.data.
  await check('subs(company key): peer dave(co-a) reads co-a', 'allow', getDoc(doc(dave,   'subscriptions/co-a')));
  await check('subs(company key): mgr eve(co-a) reads co-a',   'allow', getDoc(doc(eveMgr, 'subscriptions/co-a')));
  await check('subs(company key): B(co-b) reads co-a',         'deny',  getDoc(doc(bob,    'subscriptions/co-a')));
  await check('subs(company key): B-mgr reads co-a',           'deny',  getDoc(doc(bobMgr, 'subscriptions/co-a')));
  await check('subs(company key): B-co_admin reads co-a',      'deny',  getDoc(doc(bobCA,  'subscriptions/co-a')));
  await check('subs(company key): claimless reads co-a',       'deny',  getDoc(doc(noClaim,'subscriptions/co-a')));
  await check('subs(company key): anon reads co-a',            'deny',  getDoc(doc(anon,   'subscriptions/co-a')));
  await check('subs(uid key): owner alice reads own',          'allow', getDoc(doc(alice,  'subscriptions/alice')));
  await check('subs(uid key): solo reads own (uid==companyId)','allow', getDoc(doc(solo,   'subscriptions/solo1')));

  // ═══════════════════════════════════════════════════════════
  // C. companyProfile — Phase-1 fix: per-tenant key companyProfile/{companyId}.
  //    Same-tenant ALLOW, cross-tenant + claimless + anon DENY.
  // ═══════════════════════════════════════════════════════════
  await check('companyProfile: A(co-a) READS own config',      'allow', getDoc(doc(alice, 'companyProfile/co-a')));
  await check('companyProfile: A(co-a) WRITES own config',     'allow', setDoc(doc(alice, 'companyProfile/co-a'), { tagline: 'edited by owner' }, { merge: true }));
  await check('companyProfile: B(co-b) READS co-a config',     'deny',  getDoc(doc(bob, 'companyProfile/co-a')));
  await check('companyProfile: B(co-b) OVERWRITES co-a config','deny',  setDoc(doc(bob, 'companyProfile/co-a'), { legalName: 'PWNED', financing: { apr: 99 } }, { merge: true }));
  await check('companyProfile: claimless READS co-a config',   'deny',  getDoc(doc(noClaim, 'companyProfile/co-a')));
  await check('companyProfile: anon READS co-a config',        'deny',  getDoc(doc(anon, 'companyProfile/co-a')));
  await check('companyProfile: solo op READS own (uid key)',   'allow', getDoc(doc(solo, 'companyProfile/solo1')));
  await check('companyProfile: solo op WRITES own (uid key)',  'allow', setDoc(doc(solo, 'companyProfile/solo1'), { tagline: 'solo edit' }, { merge: true }));
  await check('companyProfile: B reads solo op config',        'deny',  getDoc(doc(bob, 'companyProfile/solo1')));

  // counters #1.2 — writes are now monotonic (+1 only). Overwrite/garble
  // DENIED; the legit +1 increment ALLOWED; read intentionally open (the
  // client mint transaction must read to compute next+1 — accepted P3).
  // Seeded at next:42. Order: overwrite-deny (stays 42) → +1 (42→43).
  await check('counters: overwrite to garbage DENIED',        'deny',  setDoc(doc(bob, 'counters/customerIds'), { next: 999999 }));
  await check('counters: legit +1 increment ALLOWED',         'allow', setDoc(doc(bob, 'counters/customerIds'), { next: 43 }));
  await check('counters: read intentionally open (mint txn)', 'allow', getDoc(doc(bob, 'counters/customerIds')));

  // ═══════════════════════════════════════════════════════════
  // D. PRIVILEGE / ESCALATION — must DENY
  // ═══════════════════════════════════════════════════════════
  await check('leaderboard: rep self-writes own stats',      'deny', setDoc(doc(alice, 'leaderboard/alice'), { closedDeals: 9999 }, { merge: true }));
  await check('users: rep changes own companyId claim-doc',  'deny', updateDoc(doc(bob, 'users/alice'), { companyId: 'co-b' })); // also cross-tenant
  await check('subscriptions: rep self-upgrades plan',       'deny', setDoc(doc(bob, 'subscriptions/bob'), { plan: 'professional', status: 'active' }));
  await check('subscriptions: member self-writes company key','deny', setDoc(doc(dave, 'subscriptions/co-a'), { plan: 'enterprise' }, { merge: true })); // read widened, write still false
  await check('subscriptions: foreign writes co-a company key','deny',setDoc(doc(bob,  'subscriptions/co-a'), { plan: 'enterprise' }, { merge: true }));
  await check('company_admin(co-b) reads co-a leaderboard',  'deny', getDoc(doc(bobCA, 'leaderboard/alice')));

  // ═══════════════════════════════════════════════════════════
  // E. CREATE-PIN ENFORCEMENT (Phase-1.5) — companyId pinned to the
  //    caller's own tenant on create. Foreign id rejected; own claim/uid OK.
  //    leads REQUIRE companyId; the company-scoped collections pin-if-present.
  // ═══════════════════════════════════════════════════════════
  await check('leads create: foreign companyId (co-a)',       'deny',  setDoc(doc(bob, 'leads/x-foreign'),       { userId: 'bob', companyId: 'co-a', name: 'x' }));
  await check('leads create: own claim companyId (co-b)',     'allow', setDoc(doc(bob, 'leads/x-own'),           { userId: 'bob', companyId: 'co-b', name: 'x' }));
  await check('leads create: own uid as companyId',           'allow', setDoc(doc(bob, 'leads/x-uid'),           { userId: 'bob', companyId: 'bob',  name: 'x' }));
  await check('leads create: missing companyId (required)',   'deny',  setDoc(doc(bob, 'leads/x-none'),          { userId: 'bob', name: 'x' }));
  await check('knocks create: foreign companyId (co-a)',      'deny',  setDoc(doc(bob, 'knocks/k-foreign'),      { userId: 'bob', companyId: 'co-a' }));
  await check('knocks create: own companyId (co-b)',          'allow', setDoc(doc(bob, 'knocks/k-own'),          { userId: 'bob', companyId: 'co-b' }));
  await check('knocks create: companyId omitted (degrades)',  'allow', setDoc(doc(bob, 'knocks/k-none'),         { userId: 'bob' }));
  await check('territories create: foreign companyId',        'deny',  setDoc(doc(bob, 'territories/t-foreign'), { userId: 'bob', companyId: 'co-a' }));
  await check('training_sessions create: foreign companyId',  'deny',  setDoc(doc(bob, 'training_sessions/ts-f'),{ userId: 'bob', companyId: 'co-a' }));
  await check('reps create: foreign companyId',               'deny',  setDoc(doc(bob, 'reps/bob'),              { userId: 'bob', companyId: 'co-a' }));
  await check('reps create: own companyId (co-b)',            'allow', setDoc(doc(bob, 'reps/bob'),              { userId: 'bob', companyId: 'co-b' }));

  // ── Summary ────────────────────────────────────────────────
  const pass = results.filter(r => r.outcome === 'PASS').length;
  const fail = results.filter(r => r.outcome === 'FAIL').length;
  const warn = results.filter(r => r.outcome === 'WARN').length;
  console.log('\n──────── CROSS-TENANT ISOLATION MATRIX ────────');
  for (const r of results) {
    const tag = r.outcome === 'PASS' ? '  ✓' : (r.outcome === 'WARN' ? '  ⚠' : '✗✗');
    console.log(`${tag} [${r.expect.toUpperCase().padEnd(5)}] ${r.label.padEnd(46)} ${r.note}`);
  }
  console.log('────────────────────────────────────────────────');
  console.log(`${pass} passed, ${fail} failed, ${warn} warn-known-gap (of ${results.length})`);
  if (fail > 0) {
    console.log('\nFAILS above marked "WAS ALLOWED" are live cross-tenant holes in firestore.rules.');
  }
  if (warn > 0) {
    console.log('WARN = tracked P3 (counters #1.2) — not part of this fix; see punch list.');
  }
  await env.cleanup();
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('✗ cross-tenant test harness error:', e);
  process.exit(2);
});

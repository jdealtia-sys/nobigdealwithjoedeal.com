/**
 * tests/invite-claim-path.integration.test.js: claimInvite and onRepSignup
 * accept only a REAL team invite (2026-09-25, invite-claim path check).
 *
 * THE DEFECT
 * ──────────
 * Both handlers found an invite with collectionGroup('members'), which matches
 * a `members` collection under ANY parent, and took the tenant from
 * ref.parent.parent.id without checking that parent. firestore.rules let a
 * signed-in user write any subcollection under their own users/{uid}, so a
 * users/{uid}/members/{email} doc was accepted as a team invite for that
 * email: the tenant was the writer's uid and the role was whatever the doc
 * said, with none of createTeamInvite's checks (seat cap, role allowlist, who
 * may invite). The same doc also made a REAL invite for that email come back
 * as ambiguous_invite, so the real one could not be claimed.
 *
 * THE FIX (defence in depth)
 *   - functions/handlers/invite-lookup.js: one resolver for both handlers. A
 *     hit is an invite only at exactly companies/{companyId}/members/{email},
 *     with an issuable role and an existing company doc; everything else is
 *     dropped BEFORE the ambiguity check, and the page is INVITE_SCAN_LIMIT so
 *     dropped docs cannot crowd a real invite out of it.
 *   - firestore.rules: users/{uid} subcollection WRITES are an allowlist
 *     (pinned by tests/firestore-rules.test.js section 35).
 * This file drives the REAL handlers in-process (claimInvite.run /
 * onRepSignup.run) against the Firestore + Auth emulators. Stray docs are
 * seeded with the admin SDK on purpose: the handler must hold even if one
 * exists (a leftover, or a path some future rule opens).
 *
 * RUN (CI, throwaway emulators):
 *   cd tests && firebase emulators:exec --only auth,firestore --project demo-nbd-invite \
 *     'node ./invite-claim-path.integration.test.js'
 * RUN (a shared local emulator on 127.0.0.1): give it its own project id:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   INVITE_TEST_PROJECT_ID=demo-invite-<n> node tests/invite-claim-path.integration.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('✗ FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must both be set (emulators only)');
  process.exit(1);
}
const PROJECT = process.env.INVITE_TEST_PROJECT_ID || process.env.GCLOUD_PROJECT || 'demo-nbd-invite';
{
  const rc = JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8'));
  if (Object.values(rc.projects || {}).includes(PROJECT)) {
    console.error('✗ refusing to run against the app project "' + PROJECT + '"');
    process.exit(1);
  }
}
process.env.GCLOUD_PROJECT = PROJECT;
// onRepSignup no-ops when the emulator rig skip-lists it; this suite calls it.
delete process.env.NBD_DEPLOY_SKIP_LIST;

// The handlers resolve firebase-admin from functions/node_modules; initialise
// THAT copy so getFirestore()/getAuth() inside them see this app.
const freq = createRequire(path.join(ROOT, 'functions', 'package.json'));
freq('firebase-admin/app').initializeApp({ projectId: PROJECT });
const db = freq('firebase-admin/firestore').getFirestore();
const auth = freq('firebase-admin/auth').getAuth();
const { FieldValue } = freq('firebase-admin/firestore');

const { claimInvite } = require(path.join(ROOT, 'functions/handlers/invites.js'));
const { onRepSignup } = require(path.join(ROOT, 'functions/handlers/auth.js'));

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

const RUN = 'zzinv' + Date.now().toString(36);
const createdUids = [];
let seq = 0;

async function makeUser(tag, extraClaims) {
  seq++;
  const uid = `${RUN}-${tag}-${seq}`;
  const email = `${RUN}-${tag}-${seq}@invite.test`;
  await auth.createUser({ uid, email, emailVerified: true });
  if (extraClaims) await auth.setCustomUserClaims(uid, extraClaims);
  createdUids.push(uid);
  return { uid, email };
}
async function makeCompany(tag) {
  const owner = await makeUser(tag);
  await db.doc(`companies/${owner.uid}`).set({ ownerId: owner.uid, name: 'Co ' + tag, status: 'active', plan: 'growth' });
  return owner.uid;
}
function inviteDoc(email, role, invitedBy) {
  return { email, role, status: 'invited', invitedAt: FieldValue.serverTimestamp(), invitedBy: invitedBy || 'x' };
}
// Exactly the request shape the callable wrapper hands the handler.
async function claim(user, tokenExtra) {
  const token = Object.assign({ email: user.email, email_verified: true }, tokenExtra || {});
  try {
    return await claimInvite.run({ auth: { uid: user.uid, token }, data: {} });
  } catch (e) {
    return { threw: e.code || e.message };
  }
}
async function signup(user) {
  return onRepSignup.run({ data: { uid: user.uid, email: user.email } });
}
async function claimsOf(uid) { return (await auth.getUser(uid)).customClaims || {}; }
async function statusOf(p) { const s = await db.doc(p).get(); return s.exists ? s.data().status : null; }

async function run() {
  console.log('INVITE-CLAIM PATH CHECK — project ' + PROJECT + ', run ' + RUN);

  // ── 1. A members doc under users/{uid} is not an invite ─────────────────
  section('1. a users/{uid}/members doc is ignored');
  {
    // The writer is an ordinary self-serve account WITH its own
    // companies/{uid} doc (createCompany gives every signup one), so the
    // company-exists check cannot be what stops this; the path check must.
    const writer = { uid: await makeCompany('writer') };
    const victim = await makeUser('victim');
    const stray = `users/${writer.uid}/members/${victim.email}`;
    await db.doc(stray).set(inviteDoc(victim.email, 'company_admin', writer.uid));

    const out = await claim(victim);
    ok('claimInvite: users/{uid}/members doc → no_invite', out.claimed === false && out.reason === 'no_invite',
      JSON.stringify(out));
    const c = await claimsOf(victim.uid);
    ok('claimInvite: no companyId/role claim stamped from it', !c.companyId && !c.role, JSON.stringify(c));
    ok('claimInvite: the stray doc is not activated', (await statusOf(stray)) === 'invited');
    const prof = await db.doc(`users/${victim.uid}`).get();
    ok('claimInvite: no users/{victim} profile pointing at the writer', !prof.exists || prof.data().companyId !== writer.uid);

    // A solo owner (companyId claim == own uid) is allowed to claim a real
    // invite, so the guard must hold on that branch too.
    const solo = await makeUser('solo');
    await auth.setCustomUserClaims(solo.uid, { companyId: solo.uid });
    await db.doc(`users/${writer.uid}/members/${solo.email}`).set(inviteDoc(solo.email, 'manager', writer.uid));
    const outSolo = await claim(solo, { companyId: solo.uid });
    ok('claimInvite: solo owner (companyId == uid) → no_invite for a users/{uid}/members doc',
      outSolo.claimed === false && outSolo.reason === 'no_invite', JSON.stringify(outSolo));
    ok('claimInvite: solo owner keeps companyId == own uid', (await claimsOf(solo.uid)).companyId === solo.uid);

    const sOut = await signup(victim);
    ok('onRepSignup: users/{uid}/members doc → no claims', !sOut || !sOut.customClaims, JSON.stringify(sOut));
  }

  // ── 2. A real invite still claims ────────────────────────────────────────
  section('2. a real companies/{id}/members invite still claims');
  {
    const co = await makeCompany('owner2');
    const rep = await makeUser('rep2');
    const real = `companies/${co}/members/${rep.email}`;
    await db.doc(real).set(inviteDoc(rep.email, 'manager', co));

    const out = await claim(rep);
    ok('claimInvite: claimed into the inviting company', out.claimed === true && out.companyId === co, JSON.stringify(out));
    ok('claimInvite: role from the invite', out.role === 'manager');
    ok('claimInvite: companyName from the company doc', out.companyName === 'Co owner2');
    const c = await claimsOf(rep.uid);
    ok('claimInvite: claims stamped { companyId, role }', c.companyId === co && c.role === 'manager', JSON.stringify(c));
    const m = (await db.doc(real).get()).data();
    ok('claimInvite: member doc activated with the rep uid', m.status === 'active' && m.uid === rep.uid);

    const rep2 = await makeUser('rep2b');
    await db.doc(`companies/${co}/members/${rep2.email}`).set(inviteDoc(rep2.email, 'sales_rep', co));
    const sOut = await signup(rep2);
    ok('onRepSignup: real invite → { companyId, role } claims',
      sOut && sOut.customClaims && sOut.customClaims.companyId === co && sOut.customClaims.role === 'sales_rep',
      JSON.stringify(sOut));
  }

  // ── 3. A stray doc next to a real invite no longer blocks it ────────────
  section('3. a stray doc alongside a real invite: real one claims, no ambiguous_invite');
  {
    const co = await makeCompany('owner3');
    const writer = { uid: await makeCompany('writer3') }; // has its own company doc, as in 1
    const rep = await makeUser('rep3');
    const stray = `users/${writer.uid}/members/${rep.email}`;
    await db.doc(`companies/${co}/members/${rep.email}`).set(inviteDoc(rep.email, 'sales_rep', co));
    await db.doc(stray).set(inviteDoc(rep.email, 'company_admin', writer.uid));

    const out = await claim(rep);
    ok('claimInvite: not ambiguous_invite', out.reason !== 'ambiguous_invite', JSON.stringify(out));
    ok('claimInvite: claims the REAL company', out.claimed === true && out.companyId === co, JSON.stringify(out));
    ok('claimInvite: role from the real invite, not the stray doc', out.role === 'sales_rep');
    ok('claimInvite: the stray doc is left untouched', (await statusOf(stray)) === 'invited');

    const rep2 = await makeUser('rep3b');
    await db.doc(`companies/${co}/members/${rep2.email}`).set(inviteDoc(rep2.email, 'viewer', co));
    await db.doc(`users/${writer.uid}/members/${rep2.email}`).set(inviteDoc(rep2.email, 'company_admin', writer.uid));
    const sOut = await signup(rep2);
    ok('onRepSignup: stray doc + real invite → the real company and role',
      sOut && sOut.customClaims && sOut.customClaims.companyId === co && sOut.customClaims.role === 'viewer',
      JSON.stringify(sOut));
  }

  // ── 4. Stray docs that sort AHEAD of companies/ cannot crowd it out ──────
  // Results come back in full-path order; 'aaa…' sorts before 'companies'.
  // The old reads (claimInvite limit(2), onRepSignup limit(1)) only ever saw
  // the stray docs here.
  section('4. stray docs sorting ahead of the real invite do not use up the page');
  {
    const co = await makeCompany('owner4');
    const rep = await makeUser('rep4');
    await db.doc(`companies/${co}/members/${rep.email}`).set(inviteDoc(rep.email, 'manager', co));
    for (let i = 0; i < 5; i++) {
      await db.doc(`aaa_${RUN}/s${i}/members/${rep.email}`).set(inviteDoc(rep.email, 'company_admin', 'x'));
    }
    const out = await claim(rep);
    ok('claimInvite: 5 stray docs ahead of the real invite → still claims the real company',
      out.claimed === true && out.companyId === co, JSON.stringify(out));

    const rep2 = await makeUser('rep4b');
    await db.doc(`companies/${co}/members/${rep2.email}`).set(inviteDoc(rep2.email, 'sales_rep', co));
    for (let i = 0; i < 5; i++) {
      await db.doc(`aaa_${RUN}/t${i}/members/${rep2.email}`).set(inviteDoc(rep2.email, 'company_admin', 'x'));
    }
    const sOut = await signup(rep2);
    ok('onRepSignup: 5 stray docs ahead of the real invite → still the real company',
      sOut && sOut.customClaims && sOut.customClaims.companyId === co, JSON.stringify(sOut));
  }

  // ── 5. Two REAL invites are still ambiguous (control) ────────────────────
  section('5. two real invites from different companies stay ambiguous');
  {
    const coA = await makeCompany('owner5a');
    const coB = await makeCompany('owner5b');
    const rep = await makeUser('rep5');
    await db.doc(`companies/${coA}/members/${rep.email}`).set(inviteDoc(rep.email, 'sales_rep', coA));
    await db.doc(`companies/${coB}/members/${rep.email}`).set(inviteDoc(rep.email, 'sales_rep', coB));
    const out = await claim(rep);
    ok('claimInvite: two real companies → ambiguous_invite', out.claimed === false && out.reason === 'ambiguous_invite',
      JSON.stringify(out));
    ok('claimInvite: nothing stamped on ambiguity', !(await claimsOf(rep.uid)).companyId);
    const sOut = await signup(rep);
    ok('onRepSignup: two real companies → no claims (claimInvite reports it later)', !sOut || !sOut.customClaims,
      JSON.stringify(sOut));
  }

  // ── 6-9. Right collection name, wrong shape or content ────────────────────
  section('6-9. docs that are not something createTeamInvite could have written');
  {
    // 6. company doc missing
    const rep6 = await makeUser('rep6');
    const ghost = `${RUN}-nocompany`;
    await db.doc(`companies/${ghost}/members/${rep6.email}`).set(inviteDoc(rep6.email, 'sales_rep', ghost));
    const o6 = await claim(rep6);
    ok('6 claimInvite: invite under a companies/{id} with no company doc → no_invite',
      o6.claimed === false && o6.reason === 'no_invite', JSON.stringify(o6));
    const s6 = await signup(rep6);
    ok('6 onRepSignup: no company doc → no claims', !s6 || !s6.customClaims, JSON.stringify(s6));

    // 7. role createTeamInvite never issues
    const co7 = await makeCompany('owner7');
    const rep7 = await makeUser('rep7');
    await db.doc(`companies/${co7}/members/${rep7.email}`).set(inviteDoc(rep7.email, 'admin', co7));
    const o7 = await claim(rep7);
    ok('7 claimInvite: role outside the invite allowlist → no_invite',
      o7.claimed === false && o7.reason === 'no_invite', JSON.stringify(o7));
    ok('7 claimInvite: no claims stamped', !(await claimsOf(rep7.uid)).companyId);

    // 8. doc id is not the email it carries
    const co8 = await makeCompany('owner8');
    const rep8 = await makeUser('rep8');
    await db.doc(`companies/${co8}/members/someone-else-${RUN}@invite.test`).set(inviteDoc(rep8.email, 'sales_rep', co8));
    const o8 = await claim(rep8);
    ok('8 claimInvite: member doc id != its email → no_invite',
      o8.claimed === false && o8.reason === 'no_invite', JSON.stringify(o8));

    // 9. a members collection nested deeper under a company. The middle id is
    //    itself a real company id, so reading the tenant off
    //    ref.parent.parent.id would land on an EXISTING company here; only the
    //    exact-shape path check refuses it.
    const co9 = await makeCompany('owner9');
    const rep9 = await makeUser('rep9');
    await db.doc(`companies/${co9}/teams/${co9}/members/${rep9.email}`).set(inviteDoc(rep9.email, 'sales_rep', co9));
    const o9 = await claim(rep9);
    ok('9 claimInvite: companies/{id}/teams/{t}/members doc → no_invite',
      o9.claimed === false && o9.reason === 'no_invite', JSON.stringify(o9));
    const s9 = await signup(rep9);
    ok('9 onRepSignup: nested members doc → no claims', !s9 || !s9.customClaims, JSON.stringify(s9));
  }
}

run()
  .catch((e) => { failed++; fails.push('uncaught: ' + (e && e.stack || e)); console.error(e); })
  .finally(async () => {
    // Best-effort tidy of this run's Auth users; Firestore rows live under a
    // dedicated project id and unique RUN-prefixed ids.
    try { if (createdUids.length) await auth.deleteUsers(createdUids); } catch (_) { /* ignore */ }
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed) {
      console.log('FAILED:\n  ' + fails.join('\n  '));
      process.exit(1);
    }
    process.exit(0);
  });

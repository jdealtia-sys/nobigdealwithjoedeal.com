/**
 * scripts/audit-claim-escalation.js
 *
 * Post-incident audit + remediation for the requireTeamAdmin() solo-owner
 * fallback escalation (fixed in functions/handlers/_shared.js + the
 * admin.js cross-company guards).
 *
 * THE BUG (now patched): an access-code login (portal.js validateAccessCode)
 * mints a bare custom claim { role: 'member' | 'manager' } with NO companyId
 * and NO companies/{uid} doc. The old requireTeamAdmin treated such a caller
 * as owner of companies/{uid}, so they could call createTeamMember with their
 * OWN email + role:'company_admin' and self-escalate. The resulting claim
 * shape is the tell:
 *
 *     { role: 'company_admin', companyId: <their own uid> }        // self-keyed
 *
 * A legitimate team member is NEVER keyed to their own uid (they live under
 * someone else's companyId); a legitimate solo owner carries NO role claim and
 * is not access-code-sourced. So `companyId === uid` on a role-bearing,
 * access-code-sourced account is a high-confidence escalation signature.
 *
 * WHAT THIS SCRIPT DOES
 *   1. Reads subscriptions/* where source == 'access_code' → the set of
 *      access-code uids and the role each SHOULD hold (resolved via the
 *      access_codes/{CODE} doc; default 'member').
 *   2. Scans every Firebase Auth user and classifies custom claims:
 *        CRITICAL  role-bearing AND companyId === uid (self-keyed phantom
 *                  company — the exploit signature)
 *        REVIEW    access-code-sourced AND has any companyId != uid, OR role
 *                  escalated beyond member/manager (could be a legit team add;
 *                  needs a human)
 *        OK        bare { role: 'member'|'manager' } w/ no companyId, or a
 *                  normal owner/admin
 *   3. Lists PHANTOM companies: companies/{id} whose id is itself an
 *      access-code uid (created by the exploit's createTeamMember path), plus
 *      any members docs an access-code uid invited.
 *
 * It is REPORT-ONLY by default. Pass --apply to remediate the CRITICAL tier
 * that is ALSO access-code-sourced: reset claims to { role: <intended> } and
 * revoke refresh tokens (kills escalated sessions). REVIEW-tier and phantom
 * companies are never auto-touched — they are listed for a human decision.
 *
 * SETUP (run by Jo / devops with prod admin credentials — see memory
 * "access-code-login-iam-gap": Claude must not run access-control changes):
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *
 * RUN:
 *   node scripts/audit-claim-escalation.js                 # dry-run report
 *   node scripts/audit-claim-escalation.js --apply --yes   # remediate CRITICAL
 *
 * Safe to re-run. After --apply, affected users must sign out + sign in again.
 */

'use strict';

// Resolve firebase-admin from functions/ (no node_modules in scripts/ or repo
// root) — mirrors scripts/grant-admin-claim.js.
let admin;
try { admin = require(require.resolve('firebase-admin', { paths: [require('path').join(__dirname, '..', 'functions')] })); }
catch (_) { admin = require('firebase-admin'); }

const APPLY = process.argv.includes('--apply');
const CONFIRMED = process.argv.includes('--yes');
const SUBORDINATE = new Set(['member', 'manager', 'sales_rep', 'viewer']);

function init() {
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } catch (e) {
    if (!String(e.message || '').includes('already exists')) throw e;
  }
}

// Build uid → { intendedRole } for every access-code-sourced subscription.
async function loadAccessCodeUsers(db) {
  const map = new Map();
  const snap = await db.collection('subscriptions').where('source', '==', 'access_code').get();
  // Cache access_codes/{CODE} role lookups.
  const codeRoleCache = new Map();
  for (const doc of snap.docs) {
    const uid = doc.id;
    const code = (doc.data() || {}).accessCode;
    let intendedRole = 'member';
    if (code) {
      if (!codeRoleCache.has(code)) {
        try {
          const cs = await db.doc(`access_codes/${code}`).get();
          codeRoleCache.set(code, cs.exists && cs.data().role === 'manager' ? 'manager' : 'member');
        } catch (_) { codeRoleCache.set(code, 'member'); }
      }
      intendedRole = codeRoleCache.get(code);
    }
    map.set(uid, { intendedRole, accessCode: code || null });
  }
  return map;
}

// Find companies/{id} whose id is an access-code uid (phantom workspaces the
// exploit could have created), and any members an access-code uid invited.
async function findPhantomCompanies(db, accessCodeUids) {
  const phantoms = [];
  for (const uid of accessCodeUids) {
    try {
      const cs = await db.doc(`companies/${uid}`).get();
      if (!cs.exists) continue;
      const data = cs.data() || {};
      let members = [];
      try {
        const ms = await db.collection(`companies/${uid}/members`).get();
        members = ms.docs.map(d => ({ id: d.id, role: (d.data() || {}).role, invitedBy: (d.data() || {}).invitedBy }));
      } catch (_) {}
      phantoms.push({ companyId: uid, ownerId: data.ownerId || null, name: data.name || null, members });
    } catch (_) {}
  }
  return phantoms;
}

async function main() {
  init();
  const db = admin.firestore();
  const projectId = (admin.app().options.credential && admin.app().options.projectId)
    || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '(default ADC project)';

  console.log('═══════════════════════════════════════════════════════════');
  console.log(' Claim-escalation audit  —  project:', projectId);
  console.log(' mode:', APPLY ? (CONFIRMED ? 'APPLY (will modify claims)' : 'APPLY requested but --yes missing → DRY RUN') : 'DRY RUN (report only)');
  console.log('═══════════════════════════════════════════════════════════\n');

  const acUsers = await loadAccessCodeUsers(db);
  console.log(`access-code-sourced subscriptions: ${acUsers.size}\n`);

  const critical = [];   // role-bearing, companyId === uid
  const review = [];     // access-code-sourced w/ unexpected companyId/role
  let scanned = 0;

  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    for (const u of page.users) {
      scanned++;
      const claims = u.customClaims || {};
      const role = typeof claims.role === 'string' ? claims.role.trim().toLowerCase() : null;
      const cid = claims.companyId || null;
      const isAccessCode = acUsers.has(u.uid);

      // CRITICAL — self-keyed phantom company (the exploit signature).
      if (role && role !== 'admin' && cid && cid === u.uid) {
        critical.push({ uid: u.uid, email: u.email || null, role, companyId: cid, isAccessCode });
        continue;
      }
      // REVIEW — access-code user that drifted off the expected bare {role}.
      if (isAccessCode) {
        const expected = acUsers.get(u.uid).intendedRole;
        const drifted = cid || (role && role !== expected);
        if (drifted) review.push({ uid: u.uid, email: u.email || null, role, companyId: cid, expectedRole: expected });
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  const phantoms = await findPhantomCompanies(db, [...acUsers.keys()]);

  // ── Report ──
  console.log(`Scanned ${scanned} auth users.\n`);

  console.log(`CRITICAL — self-keyed escalation (companyId === uid): ${critical.length}`);
  for (const c of critical) {
    console.log(`  • ${c.email || '(no email)'}  uid=${c.uid}  role=${c.role}  companyId=${c.companyId}  ${c.isAccessCode ? '[access-code]' : '[NOT access-code — manual review]'}`);
  }
  console.log('');

  console.log(`REVIEW — access-code users with unexpected claims: ${review.length}`);
  for (const r of review) {
    console.log(`  • ${r.email || '(no email)'}  uid=${r.uid}  role=${r.role}  companyId=${r.companyId || '(none)'}  expected=${r.expectedRole}`);
  }
  console.log('');

  console.log(`PHANTOM companies (companies/{access-code-uid}): ${phantoms.length}`);
  for (const p of phantoms) {
    console.log(`  • companies/${p.companyId}  ownerId=${p.ownerId}  members=${p.members.length}`);
    for (const m of p.members) console.log(`      ↳ member ${m.id}  role=${m.role}  invitedBy=${m.invitedBy}`);
  }
  console.log('');

  // ── Remediation (CRITICAL + access-code only) ──
  const remediable = critical.filter(c => c.isAccessCode);
  if (!APPLY || !CONFIRMED) {
    console.log('No changes made (dry run).');
    console.log(`Would reset ${remediable.length} access-code CRITICAL account(s) to their intended bare role and revoke sessions.`);
    if (remediable.length) console.log('Re-run with  --apply --yes  to remediate. Review the REVIEW / PHANTOM lists by hand.');
    process.exit(0);
  }

  console.log('Applying remediation to access-code CRITICAL accounts…\n');
  let fixed = 0, failed = 0;
  for (const c of remediable) {
    const intended = acUsers.get(c.uid).intendedRole;
    try {
      await admin.auth().setCustomUserClaims(c.uid, { role: intended });
      await admin.auth().revokeRefreshTokens(c.uid);
      console.log(`  ✓ reset uid=${c.uid} → { role: '${intended}' }, sessions revoked`);
      fixed++;
    } catch (e) {
      console.error(`  ! failed uid=${c.uid} — ${e.message || e.code}`);
      failed++;
    }
  }
  console.log(`\nReset ${fixed}, failed ${failed}.`);
  console.log('NOTE: REVIEW-tier accounts and PHANTOM companies were NOT touched — handle by hand.');
  console.log('Affected users must sign out and sign in again.');
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('FAILED:', e.message || e);
  console.error(e.stack);
  process.exit(1);
});

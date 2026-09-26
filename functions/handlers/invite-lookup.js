/**
 * functions/handlers/invite-lookup.js: the one pending-invite resolver,
 * shared by claimInvite (handlers/invites.js) and onRepSignup
 * (handlers/auth.js).
 *
 * THE DEFECT THIS CLOSES (2026-09-25, found in #1776's review)
 * ────────────────────────────────────────────────────────────
 * Both callers looked an invite up with
 *   collectionGroup('members').where('email','==',e).where('status','==','invited')
 * and took the tenant from ref.parent.parent.id. A collection-group query
 * matches a `members` collection under ANY parent, and firestore.rules let a
 * signed-in user write any subcollection under their own users/{uid} doc
 * (the /users/{uid}/{subcol}/{docId} wildcard). So a doc at
 * users/{someUid}/members/{email} was accepted as an invite: the tenant it
 * named was that user's uid, and the role was whatever the doc said. That
 * skipped every check createTeamInvite makes (plan seat cap, role
 * allowlist, who may invite), and because the doc also matched the email, a
 * real invite for the same address came back as ambiguous_invite and could
 * not be claimed.
 *
 * Invites are only ever written at companies/{companyId}/members/{email},
 * by createTeamInvite and createTeamMember (admin SDK); firestore.rules
 * deny client writes there. So an invite here is a doc that:
 *   1. sits at EXACTLY companies/{companyId}/members/{memberId};
 *   2. has memberId === its own email field === the email being claimed
 *      (every writer keys the doc by the normalized email);
 *   3. carries a role createTeamInvite could have issued
 *      (INVITE_ALLOWED_ROLES). claimInvite/onRepSignup still clamp the role
 *      afterwards, so this is a second layer, not the only one;
 *   4. belongs to a companies/{companyId} doc that exists.
 * Everything else the query returns is counted and dropped BEFORE the
 * ambiguity check, so a stray doc can neither be claimed nor block a real
 * invite. firestore.rules now also stops the stray doc being written in
 * the first place (users/{uid} subcollection writes are an allowlist).
 * Either change alone closes the hole; both are kept on purpose.
 *
 * The lookup never logs or returns an email; callers get counts.
 */
'use strict';

const { matchDocPath } = require('../collection-group-paths');
const { INVITE_ALLOWED_ROLES } = require('./_shared');

const INVITE_PATH = 'companies/{companyId}/members/{memberId}';

// How many collection-group hits one lookup reads. Was limit(2) (claimInvite)
// and limit(1) (onRepSignup): enough when every hit was a real invite, not
// once stray docs are dropped after the read, because the dropped ones used
// up the page. Default order is by full document path, so companies/... sorts
// ahead of users/..., and the rules change means no new stray doc can be
// written; 50 is headroom on top of both, far above the number of tenants
// that will ever invite one address. A full page is reported as `truncated`
// so the caller can log it.
const INVITE_SCAN_LIMIT = 50;

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} email already lower-cased and trimmed by the caller
 * @returns {Promise<{
 *   status: 'none'|'ambiguous'|'found',
 *   nonCanonical: number,  // hits not at companies/{id}/members/{email}
 *   invalid: number,       // right path, but role not issuable
 *   orphaned: number,      // right path, but companies/{id} doc missing
 *   truncated: boolean,
 *   companyIds?: string[], // status 'ambiguous'
 *   ref?: FirebaseFirestore.DocumentReference, data?: object,
 *   companyId?: string, company?: object,       // status 'found'
 * }>}
 */
async function findPendingInvite(db, email) {
  const snap = await db.collectionGroup('members')
    .where('email', '==', email)
    .where('status', '==', 'invited')
    .limit(INVITE_SCAN_LIMIT)
    .get();

  let nonCanonical = 0;
  let invalid = 0;
  const candidates = [];
  for (const doc of snap.docs) {
    const at = matchDocPath(INVITE_PATH, doc.ref.path);
    const data = doc.data() || {};
    const docEmail = String(data.email || '').trim().toLowerCase();
    if (!at || at.memberId !== email || docEmail !== email) { nonCanonical++; continue; }
    if (typeof data.role !== 'string' || !INVITE_ALLOWED_ROLES.has(data.role)) { invalid++; continue; }
    candidates.push({ ref: doc.ref, data, companyId: at.companyId });
  }

  // The inviting company must exist. One batched read for all of them.
  const companyIds = Array.from(new Set(candidates.map((c) => c.companyId)));
  const companies = new Map();
  if (companyIds.length) {
    const snaps = await db.getAll(...companyIds.map((id) => db.doc(`companies/${id}`)));
    snaps.forEach((s, i) => { if (s.exists) companies.set(companyIds[i], s.data() || {}); });
  }
  let orphaned = 0;
  const valid = candidates.filter((c) => {
    if (companies.has(c.companyId)) return true;
    orphaned++;
    return false;
  });

  const base = { nonCanonical, invalid, orphaned, truncated: snap.size >= INVITE_SCAN_LIMIT };
  if (!valid.length) return Object.assign(base, { status: 'none' });

  // Two DIFFERENT companies invited the same email. Refuse rather than pick
  // one (see claimInvite). Doc id == email, so each company contributes at
  // most one row; >1 valid row always means >1 company.
  const tenantIds = Array.from(new Set(valid.map((c) => c.companyId)));
  if (tenantIds.length > 1) return Object.assign(base, { status: 'ambiguous', companyIds: tenantIds });

  const pick = valid[0];
  return Object.assign(base, {
    status: 'found',
    ref: pick.ref,
    data: pick.data,
    companyId: pick.companyId,
    company: companies.get(pick.companyId),
  });
}

module.exports = { findPendingInvite, INVITE_SCAN_LIMIT, INVITE_PATH };

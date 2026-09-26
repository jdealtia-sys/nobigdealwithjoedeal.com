/**
 * functions/collection-group-paths.js: pin a collection-group hit to the
 * parent path it is supposed to live under.
 *
 * WHY THIS EXISTS (2026-09-25, invite-claim path check)
 * ─────────────────────────────────────────────────────
 * db.collectionGroup('members') matches EVERY collection named `members`,
 * under any parent at any depth: companies/{id}/members, but equally
 * users/{uid}/members or a/{x}/b/{y}/members. A handler that then reads
 * the tenant straight off doc.ref.parent.parent.id trusts whoever managed
 * to write a doc into ANY collection of that name. firestore.rules decides
 * who can write where, so the safety of such a handler depended on no rule
 * anywhere granting a writable subcollection of that name. That did not
 * hold: /users/{uid}/{subcol}/{docId} let a signed-in user write any
 * subcollection name under their own uid, and claimInvite / onRepSignup
 * accepted a `members` doc found there as a real team invite.
 *
 * matchDocPath() is the check those handlers were missing: it accepts a
 * document path only when it has exactly the shape of the template, and
 * returns the template's {placeholders} bound to the path's ids. Anything
 * with a different depth, or a different collection name at any level,
 * returns null. Pure; no firebase imports, so it unit-tests without deps.
 *
 *   matchDocPath('companies/{companyId}/members/{memberId}',
 *                'companies/c1/members/a@b.co')
 *     → { companyId: 'c1', memberId: 'a@b.co' }
 *   matchDocPath('companies/{companyId}/members/{memberId}',
 *                'users/u1/members/a@b.co')
 *     → null
 */
'use strict';

const PLACEHOLDER = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

/**
 * @param {string} template e.g. 'companies/{companyId}/members/{memberId}'
 * @param {string} docPath  a DocumentReference.path (relative, no leading /)
 * @returns {Object<string,string>|null} the bound ids, or null when the path
 *   does not have exactly the template's shape.
 */
function matchDocPath(template, docPath) {
  if (typeof template !== 'string' || typeof docPath !== 'string') return null;
  const want = template.split('/');
  const got = docPath.split('/');
  if (want.length !== got.length) return null;
  const out = {};
  for (let i = 0; i < want.length; i++) {
    const seg = got[i];
    if (!seg) return null;
    const ph = PLACEHOLDER.exec(want[i]);
    if (ph) out[ph[1]] = seg;
    else if (want[i] !== seg) return null;
  }
  return out;
}

module.exports = { matchDocPath };

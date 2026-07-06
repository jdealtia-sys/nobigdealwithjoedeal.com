/**
 * Migration 004 — stamp companyId on /photos.
 *
 * Team visibility follow-up (2026-07-06 punch list, NEXT_SESSION.md
 * item 5). The customer page reads a teammate lead's photos through a
 * per-doc leadId → parent-lead lookup (docLeadInMyCompany), but the
 * dashboard's kanban-thumbnail cache is one collection-wide LIST query
 * and can't take that path — a company-scoped query needs companyId ON
 * the photo doc, the same way Phase-1.5 put it on /leads, /knocks,
 * /reps, /territories and /training_sessions.
 *
 * Keying rule — identical to migrate-companyid-backfill.js (PR #56):
 *   companyId := (owner's companyId claim) || (photo.userId)
 * For a solo operator that's their uid, which is exactly the companyId
 * their invited members carry, so the whole tenant lands on one key.
 * We key by the OWNER, not the linked lead: it also covers orphan
 * photos (no leadId), and for linked photos the two agree — the lead's
 * own companyId was backfilled with the same rule.
 *
 * Photos with no userId at all are skipped (backfillField drops null
 * values); they're unreadable by any client query today and stay that
 * way — nothing to widen.
 *
 * Rollout order (all in the same PR, safe in any deploy order):
 *   - rules ACCEPT companyId on create (pinned to the caller's tenant)
 *     but don't require it — cached pre-stamp bundles keep working;
 *   - clients stamp claims.companyId || uid on every new photo;
 *   - this migration stamps the backlog; the daily migrationsTick (or
 *     an admin runMigrations call) applies it after deploy.
 *
 * Idempotent: backfillField skips docs where companyId is already set,
 * and the auth lookups are read-only. Interrupted runs resume cleanly.
 */

'use strict';

const { getAuth } = require('firebase-admin/auth');

exports.version = 4;
exports.name    = 'stamp-photo-companyid';
exports.up = async (ctx) => {
  // uid → tenant key, memoized: photo counts are much larger than the
  // distinct-owner count, and getUser() is the slow call here.
  const keyCache = new Map();
  async function keyForUid(uid) {
    if (!uid) return null;
    if (keyCache.has(uid)) return keyCache.get(uid);
    let key = uid; // solo-operator default
    try {
      const u = await getAuth().getUser(uid);
      if (u.customClaims && u.customClaims.companyId) key = u.customClaims.companyId;
    } catch (_) { /* user deleted → uid fallback keeps the doc owner-scoped */ }
    keyCache.set(uid, key);
    return key;
  }

  const r = await ctx.backfillField('photos', 'companyId', (doc) => keyForUid(doc.data().userId));
  return {
    docsRead: r.docsRead,
    docsWritten: r.docsWritten,
    note: 'distinct owners resolved: ' + keyCache.size,
  };
};

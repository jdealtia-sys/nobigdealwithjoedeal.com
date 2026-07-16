/**
 * lapse-enforcement.js — pause team seats after a subscription lapses.
 *
 * Product decision (gauntlet batch 2, 2026-07-16): "grace period then
 * eventual pause or deactivation (make reactivation possible — we can't
 * delete on nonpayment)."
 *
 * Lifecycle:
 *   1. customer.subscription.deleted (stripe.js) stamps
 *      subscriptions/{companyId} { status:'cancelled', cancelledAt,
 *      lapseEnforced:false }. Nothing else changes — the whole team keeps
 *      working through the grace period.
 *   2. This daily cron finds cancelled subs whose cancelledAt is older
 *      than LAPSE_GRACE_DAYS and PAUSES the tenant's non-owner seats:
 *      Auth account disabled + tokens revoked + member doc flipped to
 *      'deactivated' with deactivatedReason:'lapse'. The OWNER is never
 *      touched — they keep their (now free-tier) CRM and all data.
 *   3. Reactivation: checkout.session.completed (stripe.js) re-enables
 *      every member this cron paused (deactivatedReason ping-pongs back
 *      to active) and clears lapseEnforced. Owner-deactivated members
 *      stay off — only lapse pauses are auto-reversed.
 *
 * NOTHING is ever deleted here: data, leads, docs, and accounts all
 * survive indefinitely; a lapsed tenant can come back months later.
 */

'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const LAPSE_GRACE_DAYS = 14;

// Pause one lapsed tenant's non-owner seats. Exported for the test rig.
async function enforceLapseForCompany(db, subDoc) {
  const companyId = subDoc.id;
  const membersSnap = await db.collection(`companies/${companyId}/members`).get();
  const active = membersSnap.docs.filter((m) => (m.data() || {}).status === 'active');

  let paused = 0;
  for (const m of active) {
    const md = m.data() || {};
    if (!md.uid) continue; // never-claimed rows have no account to pause
    try {
      await getAuth().updateUser(md.uid, { disabled: true });
      await getAuth().revokeRefreshTokens(md.uid);
      await m.ref.set({
        status: 'deactivated',
        active: false,
        deactivatedAt: FieldValue.serverTimestamp(),
        deactivatedBy: 'lapse-cron',
        deactivatedReason: 'lapse',
      }, { merge: true });
      paused++;
    } catch (e) {
      // One bad member must not block the rest (or the whole scan).
      logger.warn('lapse.pause_member_failed', { companyId, member: m.id, err: e.message });
    }
  }

  await subDoc.ref.set({
    lapseEnforced: true,
    lapseEnforcedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  logger.info('lapse.enforced', { companyId, paused, totalActive: active.length });
  return paused;
}

exports.enforceLapsedSeats = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every day 09:00',
    timeZone: 'America/New_York',
    timeoutSeconds: 300,
    memory: '256MiB',
    maxInstances: 1,
  },
  async () => {
    const db = getFirestore();
    const cutoff = new Date(Date.now() - LAPSE_GRACE_DAYS * 24 * 3600 * 1000);

    // status=='cancelled' + past-grace + not yet enforced. lapseEnforced is
    // only stamped (false) by the deleted-webhook from batch 2 onward, so
    // '== false' also naturally skips legacy cancelled docs from before
    // this feature existed — those tenants were never promised a pause.
    const lapsed = await db.collection('subscriptions')
      .where('status', '==', 'cancelled')
      .where('lapseEnforced', '==', false)
      .where('cancelledAt', '<=', cutoff)
      .get();

    if (lapsed.empty) {
      logger.info('lapse.scan_clean', { cutoff: cutoff.toISOString() });
      return;
    }

    let companies = 0;
    let seats = 0;
    for (const subDoc of lapsed.docs) {
      companies++;
      seats += await enforceLapseForCompany(db, subDoc);
    }
    logger.info('lapse.scan_done', { companies, seats });
  }
);

// Reactivation helper — called from stripe.js checkout.session.completed:
// re-enable every member the lapse cron paused (and ONLY those; members an
// owner deactivated on purpose stay off).
async function reactivateLapsedSeats(db, companyId) {
  const pausedSnap = await db.collection(`companies/${companyId}/members`)
    .where('deactivatedReason', '==', 'lapse')
    .get();

  let restored = 0;
  for (const m of pausedSnap.docs) {
    const md = m.data() || {};
    if (!md.uid) continue;
    try {
      await getAuth().updateUser(md.uid, { disabled: false });
      await m.ref.set({
        status: 'active',
        active: true,
        deactivatedAt: null,
        deactivatedBy: null,
        deactivatedReason: null,
        reactivatedAt: FieldValue.serverTimestamp(),
        reactivatedBy: 'lapse-recovery',
      }, { merge: true });
      restored++;
    } catch (e) {
      logger.warn('lapse.reactivate_member_failed', { companyId, member: m.id, err: e.message });
    }
  }
  if (restored) logger.info('lapse.reactivated', { companyId, restored });
  return restored;
}

exports.reactivateLapsedSeats = reactivateLapsedSeats;
exports._test = { LAPSE_GRACE_DAYS, enforceLapseForCompany, reactivateLapsedSeats };

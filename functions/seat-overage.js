'use strict';
// ═══════════════════════════════════════════════════════════════
// NBD Pro — Seat-overage flag + notify (Phase D, D-3)
//
// When a company drops below its seat limit (a Crew with extra seats
// cancels → Free/1 seat, or downgrades to a lower tier), we DO NOT
// remove anyone — that matches the app's soft-gate philosophy. Instead
// we FLAG the overage on the company's subscription doc + (on a genuine
// new overage) email the owner. The dashboard surfaces a banner off the
// flag (billing-gate.js). Removing members or upgrading clears it.
//
// Solo/NBD (1 seat, no team members) is never over → no-op, so tenant
// zero stays byte-identical.
// ═══════════════════════════════════════════════════════════════

const { FieldValue } = require('firebase-admin/firestore'); // modular: admin.firestore.FieldValue is undefined in the emulator
const { PLAN_LIMITS } = require('./plan-limits');

// Resolve the owner uid for a companyId (mirrors stripe.js resolveOwnerUid):
// prefer companies/{companyId}.ownerId; else treat a uid-shaped companyId as the uid.
async function resolveOwnerUid(db, companyId) {
  try {
    const c = await db.doc(`companies/${companyId}`).get();
    if (c.exists && c.data() && c.data().ownerId) return c.data().ownerId;
  } catch (_) { /* fall through */ }
  return /^[A-Za-z0-9]{20,}$/.test(String(companyId)) ? companyId : null;
}

// Count active seats: the owner occupies a seat (not necessarily a members doc)
// + every active members doc that isn't the owner's own. Mirrors the
// createTeamMember seat-gate so the two never disagree.
async function countActiveSeats(db, companyId, ownerId) {
  const snap = await db.collection(`companies/${companyId}/members`).where('active', '==', true).get();
  let seats = 1; // owner
  snap.forEach((d) => { if ((d.data() || {}).uid !== ownerId) seats += 1; });
  return seats;
}

/**
 * Recompute the seat-overage state for a company and persist it to the
 * authoritative subscription doc's `seatOverage` field. Never removes members.
 *
 * @param {{db:FirebaseFirestore.Firestore, admin:object, logger?:object}} deps
 * @param {string} companyId   slug tenant id, or uid for solo/NBD
 * @param {{plan?:string, ownerId?:string, notify?:boolean}} [opts]
 *        plan    — the new plan (webhook passes it); omit to read the current plan
 *        ownerId — pre-resolved owner uid (optional)
 *        notify  — email the owner on a genuinely NEW overage (webhook downgrade)
 * @returns {Promise<{over:boolean, activeSeats?:number, seatLimit:number, plan:string}>}
 */
async function applySeatOverage(deps, companyId, opts = {}) {
  const { db, admin, logger } = deps;
  const ownerId = opts.ownerId || (await resolveOwnerUid(db, companyId));

  // Resolve the authoritative subscription doc (Phase D: company-keyed, with
  // legacy uid fallback for pre-migration tenants) — write the flag where the
  // gate reads it.
  let subRef = db.doc(`subscriptions/${companyId}`);
  let curSnap = await subRef.get();
  if (!curSnap.exists && ownerId && ownerId !== companyId) {
    const alt = db.doc(`subscriptions/${ownerId}`);
    const altSnap = await alt.get();
    if (altSnap.exists) { subRef = alt; curSnap = altSnap; }
  }
  const cur = curSnap.exists ? (curSnap.data() || {}) : null;
  const plan = opts.plan || (cur && cur.plan) || 'free';
  const seatLimit = (PLAN_LIMITS[plan] || PLAN_LIMITS.free).seats;

  // Unlimited-seat plans can never be over — clear any stale flag and return.
  if (seatLimit === Infinity) {
    if (cur && cur.seatOverage) {
      await subRef.set({ seatOverage: FieldValue.delete() }, { merge: true }).catch(() => {});
    }
    return { over: false, seatLimit: Infinity, plan };
  }

  const activeSeats = await countActiveSeats(db, companyId, ownerId);
  const over = activeSeats > seatLimit;
  const alreadyOver = !!(cur && cur.seatOverage && cur.seatOverage.over && cur.seatOverage.plan === plan);

  if (over) {
    await subRef.set({
      seatOverage: { over: true, activeSeats, seatLimit, plan, detectedAt: FieldValue.serverTimestamp() }
    }, { merge: true });

    // Notify the owner once per (plan) overage transition — never on every
    // repeat webhook event, and never on the silent member-change recompute.
    if (opts.notify && !alreadyOver) {
      try {
        const email = ownerId ? (await admin.auth().getUser(ownerId)).email : null;
        if (email) {
          await db.collection('email_queue').add({
            to: email,
            subject: `Action needed: your team is over the seat limit — NBD Pro`,
            bodyPlain:
              `Your NBD Pro plan now includes ${seatLimit} seat${seatLimit === 1 ? '' : 's'}, ` +
              `but your team currently has ${activeSeats} active member${activeSeats === 1 ? '' : 's'}.\n\n` +
              `Nobody has been removed — everyone still has access. To get back within your plan:\n` +
              `  - Remove team members down to ${seatLimit}, or\n` +
              `  - Upgrade your plan to add more seats.\n\n` +
              `Manage your team: https://nobigdealwithjoedeal.com/pro/dashboard.html\n`,
            status: 'pending',   // the email worker filters on this
            createdAt: FieldValue.serverTimestamp(),
            source: 'stripe_seat_overage'
          });
        }
      } catch (e) { if (logger) logger.warn('seat_overage_email_failed', { companyId, err: e.message }); }
    }
  } else if (cur && cur.seatOverage) {
    // Back within limit (members removed / upgraded) — clear the flag.
    await subRef.set({ seatOverage: FieldValue.delete() }, { merge: true });
  }

  return { over, activeSeats, seatLimit, plan };
}

module.exports = { applySeatOverage, resolveOwnerUid, countActiveSeats };

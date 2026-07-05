/**
 * integrations/calcom.js — Cal.com booking webhook receiver
 *
 * When a homeowner books an inspection slot via a rep's Cal.com
 * link, Cal.com POSTs to our webhook. We:
 *   1. Verify HMAC signature.
 *   2. Look up the rep (by calcom username → mapped via
 *      users/{uid}.calcomUsername or reps/{uid}.calcomUsername).
 *   3. Create an `appointments/{id}` doc scoped to that rep.
 *   4. Create a `tasks/{id}` reminder 1 hour before.
 *
 * SETUP:
 *   cal.com → Settings → Developer → Webhooks → new
 *     URL:    https://us-central1-nobigdeal-pro.cloudfunctions.net/calcomWebhook
 *     Events: BOOKING_CREATED, BOOKING_CANCELLED, BOOKING_RESCHEDULED
 *     Secret: generate random (32 bytes) → paste into CALCOM_WEBHOOK_SECRET
 *   firebase functions:secrets:set CALCOM_WEBHOOK_SECRET
 *
 * Reps set their Cal.com username in Settings → Profile → it's
 * saved to users/{uid}.calcomUsername.
 */

'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { Timestamp, getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');
const { getSecret, hasSecret, SECRETS } = require('./_shared');

exports.calcomWebhook = onRequest(
  {
    region: 'us-central1',
    maxInstances: 10,
    timeoutSeconds: 15,
    memory: '256MiB',
    secrets: [SECRETS.CALCOM_WEBHOOK_SECRET]
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }

    // F2: fail closed when the secret isn't configured. Accepting
    // unsigned Cal.com calls means an attacker who knows the URL
    // can create appointment rows + tasks in any rep's calendar.
    if (!hasSecret('CALCOM_WEBHOOK_SECRET')) {
      logger.error('calcomWebhook: CALCOM_WEBHOOK_SECRET not set — rejecting unsigned request');
      res.status(503).json({ error: 'Webhook not configured' });
      return;
    }
    const sig = req.headers['x-cal-signature-256'];
    if (!sig || !req.rawBody || !Buffer.isBuffer(req.rawBody)) {
      res.status(400).json({ error: 'Missing signature' });
      return;
    }
    const computed = crypto
      .createHmac('sha256', getSecret('CALCOM_WEBHOOK_SECRET'))
      .update(req.rawBody)
      .digest('hex');
    if (!safeEqual(computed, String(sig))) {
      res.status(403).json({ error: 'Bad signature' });
      return;
    }

    const body = req.body || {};
    const trigger = String(body.triggerEvent || '').toUpperCase();
    const payload = body.payload || {};

    // Organizer is the rep. Cal.com includes their email + username.
    const organizerEmail = (payload.organizer && payload.organizer.email) || null;
    const organizerUsername = (payload.organizer && payload.organizer.username) || null;
    const attendee = Array.isArray(payload.attendees) ? payload.attendees[0] : null;

    // Resolve rep uid by username or email.
    const db = getFirestore();
    let repUid = null;
    if (organizerUsername) {
      const q = await db.collection('users').where('calcomUsername', '==', organizerUsername).limit(1).get();
      if (!q.empty) repUid = q.docs[0].id;
    }
    if (!repUid && organizerEmail) {
      try {
        const u = await getAuth().getUserByEmail(organizerEmail);
        repUid = u.uid;
      } catch (e) { /* no matching user */ }
    }
    if (!repUid) {
      // Return 200 so Cal.com doesn't retry-storm an unmappable booking, but
      // log loudly with the booking context so a missing/typo'd calcomUsername
      // is diagnosable (the booking is otherwise dropped on the floor — the
      // rep needs to set Settings → Profile → Cal.com username).
      logger.warn('calcomWebhook: no matching rep — booking dropped', {
        organizerUsername,
        organizerEmail,
        trigger,
        bookingId: payload.uid || payload.id || payload.bookingId || null,
        attendeeEmail: attendee && attendee.email,
      });
      res.status(200).json({ ok: true, matched: false });
      return;
    }

    const bookingId = payload.uid || payload.id || payload.bookingId;
    if (!bookingId) { res.status(400).json({ error: 'Missing booking id' }); return; }

    try {
      const apptRef = db.doc(`appointments/${bookingId}`);

      if (trigger === 'BOOKING_CREATED' || trigger === 'BOOKING_RESCHEDULED') {
        const startTime = payload.startTime ? new Date(payload.startTime) : null;
        const endTime   = payload.endTime   ? new Date(payload.endTime)   : null;
        // M-1: link the booking to its CRM lead so it isn't an orphan — the
        // rep's card / smart-calendar can resolve it authoritatively instead of
        // fuzzy attendee-NAME matching (which breaks on nicknames/typos). Best-
        // effort: match attendee email or last-10 phone within the rep's leads.
        let leadId = null;
        try {
          const email = (attendee && attendee.email || '').toLowerCase().trim();
          const phone = (attendee && attendee.phoneNumber || '').replace(/\D/g, '');
          if (email || phone.length >= 10) {
            const mine = await db.collection('leads').where('userId', '==', repUid).get();
            const hit = mine.docs.find(d => {
              const L = d.data() || {};
              if (email && (L.email || '').toLowerCase().trim() === email) return true;
              if (phone.length >= 10 && (L.phone || '').replace(/\D/g, '').endsWith(phone.slice(-10))) return true;
              return false;
            });
            if (hit) leadId = hit.id;
          }
        } catch (e) { logger.warn('calcomWebhook: lead-link lookup failed', { err: e && e.message }); }
        await apptRef.set({
          bookingId,
          userId: repUid,                 // owner scope for Firestore rules
          repUid,
          leadId,                         // M-1: CRM lead linkage (null if no confident match)
          calcomUsername: organizerUsername,
          attendeeName:   attendee && attendee.name,
          attendeeEmail:  attendee && attendee.email,
          attendeePhone:  attendee && attendee.phoneNumber,
          title:          payload.title,
          location:       payload.location,
          description:    payload.additionalNotes || payload.description,
          startTime:      startTime ? Timestamp.fromDate(startTime) : null,
          endTime:        endTime   ? Timestamp.fromDate(endTime)   : null,
          status:         trigger === 'BOOKING_RESCHEDULED' ? 'rescheduled' : 'booked',
          source:         'calcom',
          createdAt:      FieldValue.serverTimestamp(),
          updatedAt:      FieldValue.serverTimestamp(),
          // On reschedule, clear any reminder marker so the NEW start time
          // re-reminds. Cal.com may reuse the same booking uid, in which case
          // this merge would otherwise keep a stale reminderSentAt and suppress
          // the reminder for the new slot. (See push-functions.js dedup.)
          ...(trigger === 'BOOKING_RESCHEDULED' ? { reminderSentAt: FieldValue.delete() } : {})
        }, { merge: true });

        // A reschedule that mints a NEW booking uid leaves the ORIGINAL
        // appointment doc live → a ghost reminder fires for the stale slot.
        // Cal.com references the prior booking via rescheduleUid/rescheduleId;
        // cancel it. (No-op when the uid is reused — priorUid === bookingId —
        // since that path is handled by the marker clear above.)
        if (trigger === 'BOOKING_RESCHEDULED') {
          const priorUid = payload.rescheduleUid || payload.rescheduleId || payload.fromReschedule || null;
          if (priorUid && String(priorUid) !== String(bookingId)) {
            await db.doc(`appointments/${priorUid}`).update({
              status:       'cancelled',
              cancelledReason: 'rescheduled',
              supersededBy: String(bookingId),
              cancelledAt:  FieldValue.serverTimestamp(),
              updatedAt:    FieldValue.serverTimestamp(),
            }).catch(e => logger.warn('calcomWebhook: prior-appt cancel skipped', { priorUid, err: e && e.message }));
          }
        }

        // (Removed a dead "remind 1hr before" tasks/{id} write: its dueAt had
        // ZERO readers and the doc landed in the top-level `tasks` collection,
        // which no task UI (they read leads/{id}/tasks) or cron consumes. The
        // appointment-reminder cron — push-functions.js onAppointmentReminder —
        // now reminds off the `appointments` doc written just above, which
        // already covers this cal.com booking.)
      } else if (trigger === 'BOOKING_CANCELLED') {
        await apptRef.set({
          status: 'cancelled',
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          userId: repUid
        }, { merge: true });
      }

      res.status(200).json({ ok: true, matched: true, repUid, trigger });
    } catch (e) {
      logger.error('calcomWebhook write failed:', e.message);
      res.status(500).json({ error: 'write failed' });
    }
  }
);

function safeEqual(a, b) {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = exports;

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
const admin = require('firebase-admin');
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
    const db = admin.firestore();
    let repUid = null;
    if (organizerUsername) {
      const q = await db.collection('users').where('calcomUsername', '==', organizerUsername).limit(1).get();
      if (!q.empty) repUid = q.docs[0].id;
    }
    if (!repUid && organizerEmail) {
      try {
        const u = await admin.auth().getUserByEmail(organizerEmail);
        repUid = u.uid;
      } catch (e) { /* no matching user */ }
    }
    if (!repUid) {
      logger.warn('calcomWebhook: no matching rep', { organizerUsername, organizerEmail });
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
        await apptRef.set({
          bookingId,
          userId: repUid,                 // owner scope for Firestore rules
          repUid,
          calcomUsername: organizerUsername,
          attendeeName:   attendee && attendee.name,
          attendeeEmail:  attendee && attendee.email,
          attendeePhone:  attendee && attendee.phoneNumber,
          title:          payload.title,
          location:       payload.location,
          description:    payload.additionalNotes || payload.description,
          startTime:      startTime ? admin.firestore.Timestamp.fromDate(startTime) : null,
          endTime:        endTime   ? admin.firestore.Timestamp.fromDate(endTime)   : null,
          status:         trigger === 'BOOKING_RESCHEDULED' ? 'rescheduled' : 'booked',
          source:         'calcom',
          createdAt:      admin.firestore.FieldValue.serverTimestamp(),
          updatedAt:      admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Create a reminder task 1hr before.
        if (startTime) {
          const remindAt = new Date(startTime.getTime() - 60 * 60 * 1000);
          await db.collection('tasks').add({
            userId: repUid,
            title: 'Inspection: ' + (attendee && attendee.name || 'Homeowner'),
            description: (payload.location || 'Cal.com booking') + ' — ' + (payload.title || ''),
            dueAt: admin.firestore.Timestamp.fromDate(remindAt),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'calcom',
            bookingId,
            done: false
          });
        }
      } else if (trigger === 'BOOKING_CANCELLED') {
        await apptRef.set({
          status: 'cancelled',
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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

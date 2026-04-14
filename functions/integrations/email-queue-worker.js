/**
 * integrations/email-queue-worker.js — F1
 *
 * Polls email_queue/{id} every minute and hands each pending row to
 * Resend. Keeps the existing direct-send paths (sendEmail etc.) in
 * place for latency-sensitive flows; this worker is for the fire-
 * and-forget emails enqueued by D7 (GDPR erasure confirmation) and
 * E1 (Stripe dunning). Queueing means:
 *
 *   - Both flows are resilient to transient Resend outages (retries).
 *   - We can bulk-audit email traffic by inspecting the collection.
 *   - The sending domain rate limit is one choke point, not two.
 *
 * State machine on each row:
 *   (no status)           → picked up, marked 'sending'
 *   sending  + success    → 'sent' + sentAt
 *   sending  + failure    → attempts++, returns to queue until max
 *   sending  + max tries  → 'failed'
 *
 * Idempotent under the Firestore scheduler: if two ticks overlap
 * the worker uses a transaction to claim each doc.
 */

'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const EMAIL_FROM = defineSecret('EMAIL_FROM');

const MAX_ATTEMPTS = 5;

exports.emailQueueWorker = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 1 minutes',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 240,
    memory: '256MiB',
    secrets: [RESEND_API_KEY, EMAIL_FROM]
  },
  async () => {
    let resendKey = '';
    let fromAddr = '';
    try { resendKey = RESEND_API_KEY.value(); } catch (e) {}
    try { fromAddr  = EMAIL_FROM.value();    } catch (e) {}
    if (!resendKey || !fromAddr) {
      logger.info('emailQueueWorker: Resend not configured, skipping');
      return;
    }

    const { Resend } = require('resend');
    const resend = new Resend(resendKey);
    const db = admin.firestore();

    // Claim up to 25 pending rows per tick. Anything that needs
    // faster delivery should go through the direct-send functions.
    const snap = await db.collection('email_queue')
      .where('status', 'in', ['pending', null])
      .orderBy('createdAt')
      .limit(25)
      .get();

    let sent = 0, failed = 0;
    for (const doc of snap.docs) {
      // Transactional claim so overlapping ticks don't double-send.
      try {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          if (!fresh.exists) throw new Error('missing');
          const d = fresh.data();
          if (d.status && d.status !== 'pending') throw new Error('not-pending');
          tx.update(doc.ref, {
            status: 'sending',
            claimedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });
      } catch (e) {
        continue; // someone else has it
      }

      const data = doc.data();
      const to = data.to;
      if (typeof to !== 'string' || !to.includes('@')) {
        await doc.ref.update({
          status: 'failed',
          failedReason: 'bad recipient',
          failedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        failed++;
        continue;
      }

      try {
        await resend.emails.send({
          from: fromAddr,
          to,
          subject: String(data.subject || '(no subject)').slice(0, 200),
          text: String(data.bodyPlain || '').slice(0, 50_000),
          html: data.bodyHtml ? String(data.bodyHtml).slice(0, 100_000) : undefined,
          reply_to: data.replyTo || undefined
        });
        await doc.ref.update({
          status: 'sent',
          sentAt: admin.firestore.FieldValue.serverTimestamp()
        });
        sent++;
      } catch (e) {
        const attempts = (data.attempts || 0) + 1;
        const shouldRetry = attempts < MAX_ATTEMPTS;
        await doc.ref.update({
          status: shouldRetry ? 'pending' : 'failed',
          attempts,
          lastError: (e && e.message || 'unknown').slice(0, 400),
          lastAttemptAt: admin.firestore.FieldValue.serverTimestamp()
        });
        if (!shouldRetry) failed++;
        logger.warn('emailQueueWorker send error', { docId: doc.id, attempts, err: e.message });
      }
    }

    if (snap.size) logger.info('emailQueueWorker', { picked: snap.size, sent, failed });
  }
);

module.exports = exports;

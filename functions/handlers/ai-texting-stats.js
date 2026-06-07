/**
 * functions/handlers/ai-texting-stats.js — T-3: AI texting analytics
 * ═══════════════════════════════════════════════════════════════
 *
 * Per-rep analytics on how they act on the AI reply drafts that
 * incomingSMS generates (handlers/ai-texting.js writes them to
 * leads/{leadId}/ai_drafts; the customer-page panel + the
 * onAiDraftApproved trigger move each draft pending → sent / dismissed).
 *
 * Aggregation is SERVER-SIDE via a collectionGroup scan scoped to the
 * caller's own userId. Doing it server-side (admin SDK) means:
 *   - no client-side collectionGroup rule surface to get wrong
 *   - the rep never has to read every draft doc to the browser
 *   - tenancy is enforced by the uid filter, not client trust
 * Windowed to the last N days (default 90, max 365) to bound the scan.
 *
 * Surfaced by docs/pro/js/ai-texting-stats-card.js on the analytics
 * ('board') view.
 */
'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { callableRateLimit } = require('../shared');
const { CORS_ORIGINS } = require('./_shared');

exports.getAiTextingStats = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    // The scan is scoped to the caller's own drafts (bounded by their
    // own volume), but still rate-limit so a tight refresh loop can't
    // hammer the collectionGroup index. 30/hour is generous for a
    // dashboard view.
    await callableRateLimit(request, 'getAiTextingStats', 30, 3_600_000);

    const windowDays = Math.min(Math.max(Number(request.data && request.data.windowDays) || 90, 1), 365);
    const since = admin.firestore.Timestamp.fromMillis(Date.now() - windowDays * 86_400_000);
    const db = admin.firestore();

    let docs = [];
    try {
      const snap = await db.collectionGroup('ai_drafts')
        .where('userId', '==', uid)
        .where('generatedAt', '>=', since)
        .get();
      docs = snap.docs.map((d) => d.data());
    } catch (e) {
      logger.warn('[getAiTextingStats] collectionGroup query failed', { uid, err: e.message });
      throw new HttpsError('internal', 'Could not load AI texting stats');
    }

    let total = 0, sent = 0, dismissed = 0, pending = 0, failed = 0, approved = 0, edited = 0;
    let actionMsSum = 0, actionMsCount = 0;
    const toMs = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null);

    for (const d of docs) {
      total++;
      switch (d.status || 'pending') {
        case 'sent':      sent++; break;
        case 'dismissed': dismissed++; break;
        case 'failed':    failed++; break;
        case 'approved':  approved++; break;  // transient (trigger flips to sent/failed)
        default:          pending++;          // 'pending'
      }
      if (d.editedByRep) edited++;
      // Generated → acted latency (approvedAt preferred, else sentAt).
      const gen = toMs(d.generatedAt);
      const act = toMs(d.approvedAt) || toMs(d.sentAt);
      if (gen && act && act >= gen) { actionMsSum += (act - gen); actionMsCount++; }
    }

    // "Acted" = the rep made a decision (sent or dismissed). Accept rate
    // = of acted drafts, how many were actually sent.
    const acted = sent + dismissed;
    const round = (n) => Math.round(n * 1000) / 1000;

    return {
      windowDays,
      total, sent, dismissed, pending, failed, approved, edited,
      acted,
      acceptRate:  acted ? round(sent / acted) : null,        // sent / (sent + dismissed)
      editRate:    sent ? round(edited / sent) : null,        // of sent, share the rep tweaked
      dismissRate: acted ? round(dismissed / acted) : null,
      avgMinutesToAction: actionMsCount ? round(actionMsSum / actionMsCount / 60000) : null,
      generatedAt: Date.now(),
    };
  }
);

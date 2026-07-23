/**
 * functions/handlers/adjuster-board.js — idea #2 follow-up
 * ═══════════════════════════════════════════════════════════════════
 *
 * `getAdjusterTacticBoard` — a company-wide rollup over call recordings that
 * shows, by insurance carrier and by adjuster, what tactics/objections recur.
 * voiceConsumer (#1051) denormalized each call's signals onto the lead but
 * dropped the carrier/adjuster association; this reads the recording-level
 * summaries back and correlates them.
 *
 * Aggregation is SERVER-SIDE via a collectionGroup scan scoped to the caller's
 * companyId — the same architecture as getAiTextingStats:
 *   - no client-side collectionGroup rule surface to get wrong
 *   - the browser never reads every recording (transcript-heavy) doc
 *   - tenancy is enforced by the companyId filter, not client trust
 * Windowed (default 365 days, max 730) to bound the scan.
 */
'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { Timestamp, getFirestore } = require('firebase-admin/firestore');
const { callableRateLimit } = require('../shared');
const { CORS_ORIGINS } = require('./_shared');
const { aggregateAdjusterBoard } = require('../adjuster-board-logic');

exports.getAdjusterTacticBoard = onCall(
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
    await callableRateLimit(request, 'getAdjusterTacticBoard', 30, 3_600_000);

    // Company scope: the caller's companyId claim, or their uid for solo owners
    // (recordings carry companyId = ctx.companyId, which is claims.companyId||uid).
    const claims = request.auth.token || {};
    const companyId = claims.companyId || uid;

    const windowDays = Math.min(Math.max(Number(request.data && request.data.windowDays) || 365, 7), 730);
    const since = Timestamp.fromMillis(Date.now() - windowDays * 86_400_000);
    const db = getFirestore();

    let recordings = [];
    try {
      // Equality (companyId) + range (recordedAt) → the [companyId, recordedAt]
      // COLLECTION_GROUP index in firestore.indexes.json. status is filtered
      // in-memory (only 'complete' recordings carry a usable summary) to keep
      // the index to two fields.
      const snap = await db.collectionGroup('recordings')
        .where('companyId', '==', companyId)
        .where('recordedAt', '>=', since)
        .get();
      recordings = snap.docs
        .map((d) => d.data())
        .filter((r) => r && r.status === 'complete' && r.summary);
    } catch (e) {
      logger.warn('[getAdjusterTacticBoard] collectionGroup query failed', { companyId, err: e.message });
      throw new HttpsError('internal', 'Could not load the adjuster board');
    }

    const board = aggregateAdjusterBoard(recordings);
    return Object.assign({ windowDays, generatedAt: Date.now() }, board);
  }
);

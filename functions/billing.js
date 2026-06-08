/**
 * billing.js — server-side usage tracking for plan limits.
 *
 * Closes the Audit A KNOWN GAP: firestore.rules locks
 * subscriptions/{uid} writes (`allow write: if false`) so the
 * client-side billing-gate.js used to silently 403 on every
 * trackUsage call. Local-session counters worked, but cross-
 * session / cross-device usage was lost. Reps could refresh and
 * "get" their lead allowance back.
 *
 * Now: trackUsage is a callable that atomically increments
 * subscriptions/{uid}.usage[feature] via the admin SDK and
 * returns the post-increment state plus the plan limit, so the
 * client can render an accurate "X of Y leads this month" gauge.
 *
 * Rate limit: 200/min/uid — generous enough that a rep logging
 * a busy day's leads never hits it, tight enough to block a
 * pathological loop.
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const { callableRateLimit } = require('./shared');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nbd-pro.web.app',
];

// PLAN_LIMITS is the single server-side source of truth for caps, shared with
// handlers/admin.js (the invite-time seat gate) so meter and gate read the same
// seat numbers. Mirrors PLANS in docs/pro/js/billing-gate.js (client display).
const { PLAN_LIMITS } = require('./plan-limits');

const ALLOWED_FEATURES = new Set(['leads', 'reports', 'aiCalls']);

// Owner-email allowlist mirrors billing-gate.js OWNER_EMAILS — owner
// accounts bypass plan caps entirely. Keep the lists in sync.
const OWNER_EMAILS = new Set([
  'jd@nobigdealwithjoedeal.com',
  'jonathandeal459@gmail.com',
]);

exports.trackUsage = onCall({
  region: 'us-central1',
  cors: CORS_ORIGINS,
  enforceAppCheck: true,
  timeoutSeconds: 10,
  memory: '256MiB',
  maxInstances: 50,
  concurrency: 80,
}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

  // Rate-limit per uid. 200/min handles bulk imports + busy days.
  await callableRateLimit(request, 'trackUsage', 200, 60_000);

  const feature = typeof request.data?.feature === 'string' ? request.data.feature : null;
  if (!feature || !ALLOWED_FEATURES.has(feature)) {
    throw new HttpsError('invalid-argument', 'feature must be one of: leads, reports, aiCalls');
  }

  const db = admin.firestore();
  // Phase D: bill per-COMPANY. Resolve companyId from the VERIFIED token only
  // (never request.data) and fall back to the legacy {uid} doc for solo/legacy.
  // NBD is solo (no companyId claim) → companyId === uid → legacyRef is null and
  // this is byte-identical to the pre-Phase-D path.
  const companyId = (request.auth.token && request.auth.token.companyId) || uid;
  const subRef = db.doc(`subscriptions/${companyId}`);
  const legacyRef = (companyId !== uid) ? db.doc(`subscriptions/${uid}`) : null;

  // Atomically increment + read back. Transaction so concurrent
  // increments (e.g. bulk-import 50 leads in parallel) tally correctly.
  const result = await db.runTransaction(async (tx) => {
    let snap = await tx.get(subRef);
    let writeRef = subRef;
    if (!snap.exists && legacyRef) {
      // Company billing doc not created yet (pre re-key migration). The
      // authoritative doc is still the legacy {uid} doc — read AND write it so
      // the meter stays consistent with the gate (billing-gate.js also reads
      // company-first, uid-fallback). The migration moves usage to the company
      // doc at cutover, so usage is never lost or reset. All reads happen
      // before the write (Firestore transaction rule).
      const legacySnap = await tx.get(legacyRef);
      if (legacySnap.exists) { snap = legacySnap; writeRef = legacyRef; }
    }
    const data = snap.exists ? snap.data() : {};
    const plan = data.plan || 'free';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    const cap = limits[feature];

    const prevUsage = (data.usage && typeof data.usage[feature] === 'number')
      ? data.usage[feature]
      : 0;
    const nextUsage = prevUsage + 1;

    // Server-side cap check. Owner accounts bypass entirely.
    const email = (request.auth.token && request.auth.token.email) || '';
    const isOwner = OWNER_EMAILS.has(email.toLowerCase());
    const isAdmin = request.auth.token && request.auth.token.role === 'admin';
    const overage = !isOwner && !isAdmin && cap !== Infinity && nextUsage > cap;

    // Even on overage, increment. The product decision is "soft gate" —
    // the UI shows an upgrade modal but the action still proceeds. We
    // still want the meter to read accurately so dunning / nudges can
    // fire on real usage.
    tx.set(writeRef, {
      usage: {
        ...(data.usage || {}),
        [feature]: nextUsage,
      },
      lastUsageAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      feature,
      plan,
      usage: nextUsage,
      limit: cap === Infinity ? null : cap,
      overage,
    };
  });

  logger.info('trackUsage.ok', { uid, companyId, feature: result.feature, usage: result.usage, plan: result.plan, overage: result.overage });
  return result;
});

// Test-only export for unit checks.
exports._test = { PLAN_LIMITS, ALLOWED_FEATURES };

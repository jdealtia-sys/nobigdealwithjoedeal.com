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

const { callableRateLimit } = require('./shared');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nbd-pro.web.app',
];

// Mirrors PLANS in docs/pro/js/billing-gate.js. Server is the source
// of truth for caps. Update both when adding a new tier.
const PLAN_LIMITS = {
  free:         { leads: 10,        reports: 0,        aiCalls: 0,        reps: 1 },
  starter:      { leads: 50,        reports: 2,        aiCalls: 20,       reps: 1 },
  foundation:   { leads: 50,        reports: 2,        aiCalls: 20,       reps: 1 },
  growth:       { leads: 500,       reports: Infinity, aiCalls: Infinity, reps: 5 },
  professional: { leads: 500,       reports: Infinity, aiCalls: Infinity, reps: 5 },
  enterprise:   { leads: Infinity,  reports: Infinity, aiCalls: Infinity, reps: Infinity },
};

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
  const subRef = db.doc(`subscriptions/${uid}`);

  // Atomically increment + read back. Transaction so concurrent
  // increments (e.g. bulk-import 50 leads in parallel) tally correctly.
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(subRef);
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
    tx.set(subRef, {
      usage: {
        ...(data.usage || {}),
        [feature]: nextUsage,
      },
      lastUsageAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      feature,
      plan,
      usage: nextUsage,
      limit: cap === Infinity ? null : cap,
      overage,
    };
  });

  logger.info('trackUsage.ok', { uid, feature: result.feature, usage: result.usage, plan: result.plan, overage: result.overage });
  return result;
});

// Test-only export for unit checks.
exports._test = { PLAN_LIMITS, ALLOWED_FEATURES };

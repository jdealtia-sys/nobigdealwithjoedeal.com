/**
 * functions/shared.js — authorization + rate-limit helpers shared
 * across index.js, portal.js, stripe.js (incoming), and the
 * integration modules.
 *
 * Before this module landed, two patterns had silently drifted into
 * duplicate copies:
 *
 *   - `callableRateLimit`: inlined in functions/index.js (L45-57)
 *     AND functions/portal.js (L55-67). L-03 created the second
 *     copy when portal.js peeled off — a deliberate short-term
 *     duplication flagged in that commit's body. This module
 *     closes the loop.
 *
 *   - `requirePaidSubscription`: defined in functions/sms-functions.js
 *     (L149-172) as part of C-02, with a parallel ad-hoc version
 *     inlined in `claudeProxy` (index.js:152-159). Any future
 *     endpoint that bills the caller should read from one place.
 *
 * Design rules:
 *   1. Zero side effects at module load — all helpers are pure or
 *      lazy. This module is safe to require from the smoke-test
 *      harness with no Firebase runtime.
 *   2. Accepts BOTH shapes. onCall callers pass `request.auth.token`
 *      as the claims object; onRequest callers pass the decoded
 *      Bearer token (`await admin.auth().verifyIdToken()`). The
 *      fields we consult (`role`, `companyId`, `email_verified`,
 *      `uid`) exist on both — accept either.
 *   3. Never throw `HttpsError` from a helper used by onRequest
 *      handlers; those callers need a `{status, error}` return so
 *      they can `res.status().json()`. Helpers used exclusively
 *      from onCall can throw HttpsError directly.
 */

'use strict';

// ─── Rate-limit adapter (Upstash → Firestore fallback) ──────
// R-01 adapter; no-op when Upstash isn't configured.
const { enforceRateLimit } = require('./integrations/upstash-ratelimit');

// ─── HttpsError lazy-loaded ─────────────────────────────────
// Avoid forcing the full firebase-functions runtime on callers that
// only need requirePaidSubscription (an onRequest helper).
let _HttpsError;
function HttpsError() {
  if (_HttpsError) return _HttpsError;
  _HttpsError = require('firebase-functions/v2/https').HttpsError;
  return _HttpsError;
}

// ═════════════════════════════════════════════════════════════
// callableRateLimit — per-uid bucket for onCall handlers.
//
// Throws HttpsError('resource-exhausted') on overrun. Silently
// no-ops for unauthenticated callers (they can't have hit a
// callable anyway; the handler's own auth check will reject them).
//
// Usage:
//   await callableRateLimit(request, 'createPortalToken', 30, 60_000);
//
// Canonical key shape: `callable:<name>:uid` — matches the Upstash
// + Firestore limiter namespaces already in use, so rollouts don't
// reset in-flight counters.
// ═════════════════════════════════════════════════════════════
async function callableRateLimit(request, name, limit, windowMs) {
  const uid = request.auth && request.auth.uid;
  if (!uid) return;
  try {
    await enforceRateLimit('callable:' + name + ':uid', uid, limit, windowMs);
  } catch (e) {
    if (e.rateLimited) {
      throw new (HttpsError())('resource-exhausted',
        'Rate limit exceeded — try again in ' + Math.ceil(windowMs / 1000) + 's');
    }
    throw e;
  }
}

// ═════════════════════════════════════════════════════════════
// requirePaidSubscription — billing gate for billable endpoints.
//
// Accepts the decoded Bearer-token shape (onRequest) OR an onCall
// `request.auth.token` object — both carry `role`, `email_verified`,
// and `uid` (on the token directly in onRequest; on the parent
// `request.auth.uid` in onCall — callers pass `{uid, role,
// email_verified}` explicitly if they prefer).
//
// Returns `{ok: true, plan}` on success or
// `{ok: false, status, error}` on any failure. The onRequest caller
// writes `res.status(status).json({error})`. The onCall caller can
// translate to HttpsError (not done automatically — status codes
// don't map cleanly).
//
// Admin is exempt. Fresh email_verified signal is required before
// any billable action (so email-squatters on legitimate addresses
// can't spend budget on those addresses' behalf).
// ═════════════════════════════════════════════════════════════
async function requirePaidSubscription(db, decoded) {
  if (!decoded || typeof decoded !== 'object') {
    return { ok: false, status: 401, error: 'Sign in required.' };
  }
  if (decoded.role === 'admin') return { ok: true, plan: 'admin' };
  if (decoded.email_verified !== true) {
    return {
      ok: false,
      status: 403,
      error: 'Verify your email before using billable features.',
    };
  }
  const uid = decoded.uid;
  if (!uid) return { ok: false, status: 401, error: 'Sign in required.' };
  const snap = await db.doc('subscriptions/' + uid).get();
  const sub = snap.exists ? snap.data() : null;
  const active = sub
    && sub.status === 'active'
    && sub.plan
    && sub.plan !== 'free';
  if (!active) {
    return {
      ok: false,
      status: 402,
      error: 'An active paid subscription is required.',
    };
  }
  return { ok: true, plan: sub.plan };
}

module.exports = {
  callableRateLimit,
  requirePaidSubscription,
};

/**
 * functions/rate-limit-policy.js — declarative per-route rate-limit policy.
 *
 * Why this exists
 * ───────────────
 * Each Cloud Function used to call enforceRateLimit('scope', key, N,
 * window) inline at the top of its handler — sometimes per-uid only,
 * sometimes per-IP only, sometimes neither, occasionally with copy-
 * pasted limits that drifted from sibling endpoints. Net result was
 * a defense-in-depth gap: a handler with only per-uid limiting was
 * defenseless against a refresh-bot using fresh anonymous tokens; a
 * handler with only per-IP limiting let one corp NAT throttle every
 * legit user behind it.
 *
 * This module:
 *   1. Declares a single ROUTES table with the canonical limits for
 *      every onCall + onRequest function (per-uid AND per-IP for each).
 *   2. Exports two middleware wrappers:
 *        guardCallable(name)   — onCall handler wrapper
 *        guardHttp(name)       — onRequest handler wrapper
 *      Each enforces both per-uid (when authed) AND per-IP automatically,
 *      using the limits from ROUTES. Handlers stop hand-rolling the
 *      enforceRateLimit calls.
 *   3. Surfaces the ROUTES table to ops via getRateLimitMatrix() — used
 *      by integrationStatus + the smoke-test that pins limits.
 *
 * If a handler is missing from ROUTES, the wrapper applies a SAFE
 * DEFAULT (60 req/min per IP, 300 req/min per uid) and logs a warning
 * so the gap shows up in Cloud Logging instead of going un-policed.
 *
 * Per-uid limits sit ABOVE per-IP limits on purpose: a single user
 * making heavy legit use shouldn't burn the IP budget for the rest of
 * an office or PWA cluster.
 */

'use strict';

const { enforceRateLimit, clientIp, hashKey } = require('./rate-limit');
let _logger;
function logger() {
  if (_logger) return _logger;
  try { _logger = require('firebase-functions/v2').logger; }
  catch (_) { _logger = { warn: (...a) => console.warn(...a), info: (...a) => console.log(...a), error: (...a) => console.error(...a) }; }
  return _logger;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR   = 60 * MINUTE;

/**
 * Per-route policy. Tune these by watching the rate_limit_denied
 * structured logs (the Cloud Monitoring alert in
 * monitoring/alert-rate-limit-spike.json fires when any single
 * namespace exceeds the baseline).
 *
 * Limits are intentionally generous — the goal is "drop a bot, not
 * a customer." A real signed-in user almost never hits these.
 */
const ROUTES = {
  // ── AI / token-burning surfaces (lowest ceilings, highest abuse risk).
  claudeProxy:        { uid:  60 / MINUTE * MINUTE, ip:  20, uidLimit:  60, uidWindow: MINUTE, ipLimit:  30, ipWindow: MINUTE },
  publicVisualizerAI: { uidLimit:   0, uidWindow: MINUTE, ipLimit:   3, ipWindow: MINUTE },

  // ── Auth / billing — fraud-adjacent, low burst legit need.
  validateAccessCode: { uidLimit:  10, uidWindow: HOUR,    ipLimit:  20, ipWindow: HOUR    },
  resetSubscriptionByEmail: { uidLimit: 20, uidWindow: HOUR, ipLimit: 30, ipWindow: HOUR  },

  // ── Public lead intake — stripped of auth, gate hard on IP.
  submitPublicLead:   { uidLimit:   0, uidWindow: MINUTE, ipLimit:  10, ipWindow: 10*MINUTE },
  cspReport:          { uidLimit:   0, uidWindow: MINUTE, ipLimit: 100, ipWindow: MINUTE },

  // ── Authenticated CRM — generous; legit reps make hundreds of writes/day.
  signImageUrl:       { uidLimit: 600, uidWindow: HOUR,   ipLimit: 1500, ipWindow: HOUR    },
  imageProxy:         { uidLimit: 1500, uidWindow: HOUR,  ipLimit: 3000, ipWindow: HOUR    },
  setStorageCors:     { uidLimit:  10, uidWindow: HOUR,   ipLimit:  20, ipWindow: HOUR    },
  integrationStatus:  { uidLimit: 120, uidWindow: HOUR,   ipLimit: 300, ipWindow: HOUR    },
  getAdminAnalytics:  { uidLimit:  60, uidWindow: HOUR,   ipLimit: 120, ipWindow: HOUR    },
  getGoogleReviews:   { uidLimit: 120, uidWindow: HOUR,   ipLimit: 300, ipWindow: HOUR    },

  // ── Migration runner — admin-only, runs rarely.
  runMigrations:      { uidLimit:  10, uidWindow: HOUR,   ipLimit:  10, ipWindow: HOUR    },
};

const DEFAULT_POLICY = { uidLimit: 300, uidWindow: MINUTE, ipLimit: 60, ipWindow: MINUTE };

function policyFor(name) {
  if (ROUTES[name]) return ROUTES[name];
  logger().warn('rate_limit_no_policy', { route: name, applying: 'default' });
  return DEFAULT_POLICY;
}

/**
 * Wrap an onCall handler. Reads uid from req.auth and IP from the
 * forwarded headers via clientIp(); enforces both ceilings before
 * the wrapped handler runs. Throws HttpsError('resource-exhausted')
 * with retry hint when over limit.
 *
 * Handlers using this no longer need to call enforceRateLimit
 * themselves. The Cloud Function code shrinks AND gains uniform
 * per-IP defense in depth.
 *
 * @param {string} name     Route name (must match a key in ROUTES).
 * @param {Function} handler Original onCall handler (req) => result.
 */
function guardCallable(name, handler) {
  const policy = policyFor(name);
  return async function (req) {
    // Per-IP first — cheaper to deny obviously bad traffic without
    // touching auth.
    if (policy.ipLimit > 0) {
      try {
        await enforceRateLimit(name + ':ip', clientIp(req.rawRequest || {}) || 'unknown', policy.ipLimit, policy.ipWindow);
      } catch (e) {
        if (e.rateLimited) {
          const HttpsError = require('firebase-functions/v2/https').HttpsError;
          throw new HttpsError('resource-exhausted', 'rate_limited:ip', { retryAfterMs: e.retryAfterMs });
        }
        throw e;
      }
    }
    // Per-uid second. Anonymous callers (no req.auth.uid) skip this.
    if (policy.uidLimit > 0 && req.auth?.uid) {
      try {
        await enforceRateLimit(name + ':uid', req.auth.uid, policy.uidLimit, policy.uidWindow);
      } catch (e) {
        if (e.rateLimited) {
          const HttpsError = require('firebase-functions/v2/https').HttpsError;
          throw new HttpsError('resource-exhausted', 'rate_limited:uid', { retryAfterMs: e.retryAfterMs });
        }
        throw e;
      }
    }
    return handler(req);
  };
}

/**
 * Wrap an onRequest handler. Reads uid from a verified Firebase
 * ID token in the Authorization header (if present) and IP via
 * clientIp(req); enforces both ceilings before calling the wrapped
 * handler. On limit, responds 429 with Retry-After.
 *
 * If verifyIdToken fails (no token / bad token), only the per-IP
 * limit applies — anonymous traffic still gets throttled but doesn't
 * silently bypass uid limits because the user lied about their token.
 */
function guardHttp(name, handler) {
  const policy = policyFor(name);
  return async function (req, res) {
    // Per-IP
    if (policy.ipLimit > 0) {
      try {
        await enforceRateLimit(name + ':ip', clientIp(req) || 'unknown', policy.ipLimit, policy.ipWindow);
      } catch (e) {
        if (e.rateLimited) {
          res.set('Retry-After', Math.ceil((e.retryAfterMs || policy.ipWindow) / 1000));
          res.status(429).json({ error: 'rate_limited:ip', retryAfterMs: e.retryAfterMs });
          return;
        }
        throw e;
      }
    }
    // Per-uid (best-effort — if token verify fails we don't bail,
    // just skip the uid clamp).
    const authHeader = req.headers?.authorization || '';
    const m = /^Bearer (.+)$/.exec(authHeader);
    if (policy.uidLimit > 0 && m) {
      try {
        const admin = require('firebase-admin');
        if (!admin.apps.length) admin.initializeApp();
        const decoded = await admin.auth().verifyIdToken(m[1]).catch(() => null);
        if (decoded?.uid) {
          await enforceRateLimit(name + ':uid', decoded.uid, policy.uidLimit, policy.uidWindow);
        }
      } catch (e) {
        if (e.rateLimited) {
          res.set('Retry-After', Math.ceil((e.retryAfterMs || policy.uidWindow) / 1000));
          res.status(429).json({ error: 'rate_limited:uid', retryAfterMs: e.retryAfterMs });
          return;
        }
        // Token verification errors are non-fatal — just skip uid clamp.
      }
    }
    return handler(req, res);
  };
}

/**
 * Surface the policy matrix to ops paths (e.g. integrationStatus
 * could echo this back). Frozen so callers can't mutate live policy.
 */
function getRateLimitMatrix() {
  const out = {};
  for (const [k, v] of Object.entries(ROUTES)) {
    out[k] = Object.freeze({
      uidLimit:  v.uidLimit,
      uidWindow: v.uidWindow,
      ipLimit:   v.ipLimit,
      ipWindow:  v.ipWindow,
    });
  }
  return Object.freeze(out);
}

module.exports = {
  ROUTES,
  DEFAULT_POLICY,
  guardCallable,
  guardHttp,
  policyFor,
  getRateLimitMatrix,
  // Time constants exported for test parity.
  SECOND,
  MINUTE,
  HOUR,
};

/**
 * integrations/sentry.js — Cloud Functions error reporter
 *
 * Wraps any handler in a try/catch that ships to Sentry with user
 * context (uid, companyId, plan) stripped of PII. Use it for every
 * onCall / onRequest function that isn't already trivially safe.
 *
 * SETUP (once):
 *   firebase functions:secrets:set SENTRY_DSN_FUNCTIONS
 *   (paste the DSN from sentry.io → Settings → Client Keys)
 *
 * USAGE:
 *   const { withSentry } = require('./integrations/sentry');
 *   exports.myCallable = onCall({ ... }, withSentry('myCallable', async (req) => {
 *     ...handler...
 *   }));
 *
 * If the DSN is unset, withSentry is a no-op — handler runs as-is.
 */

'use strict';

const { getSecret, hasSecret } = require('./_shared');
const { logger } = require('firebase-functions/v2');

let sentry = null;
let initialized = false;
let initAttempted = false;

function ensureInit() {
  if (initAttempted) return !!sentry;
  initAttempted = true;
  if (!hasSecret('SENTRY_DSN_FUNCTIONS')) return false;
  try {
    // Lazy require so projects without @sentry/node installed still boot.
    // Install via: cd functions && npm i @sentry/node
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn: getSecret('SENTRY_DSN_FUNCTIONS'),
      // Cloud Functions spin up fresh instances frequently — 1.0 is
      // fine, we can't oversample a short-lived worker.
      tracesSampleRate: 0.1,
      environment: process.env.FUNCTIONS_EMULATOR ? 'emulator' : 'production',
      // Tag the release so "regression in v1.2.3" alerts are actionable.
      release: process.env.K_REVISION || 'unknown',
      // PII redaction — NBD user emails/phones must never end up in
      // Sentry. Strip on the way out of every event.
      beforeSend(event) {
        if (event.user) {
          // Keep uid (internal ID, non-PII) + companyId. Drop email
          // and other contact fields — Sentry adds them by default.
          event.user = {
            id: event.user.id || event.user.uid,
            segment: event.user.segment
          };
        }
        if (event.extra) {
          for (const k of Object.keys(event.extra)) {
            if (/email|phone|address/i.test(k)) event.extra[k] = '[redacted]';
          }
        }
        return event;
      }
    });
    sentry = Sentry;
    initialized = true;
    logger.info('Sentry initialized for Cloud Functions');
    return true;
  } catch (e) {
    // @sentry/node not installed or init failed — log and move on.
    logger.warn('Sentry init skipped:', e.message);
    return false;
  }
}

function captureException(err, context) {
  if (!ensureInit()) return;
  try {
    sentry.withScope((scope) => {
      if (context && context.uid)       scope.setUser({ id: context.uid });
      if (context && context.companyId) scope.setTag('companyId', context.companyId);
      if (context && context.plan)      scope.setTag('plan', context.plan);
      if (context && context.op)        scope.setTag('op', context.op);
      sentry.captureException(err);
    });
  } catch (e) { /* swallow — Sentry failure must not break the app */ }
}

/**
 * Wrap an onCall or onRequest handler with error reporting. The
 * original handler's return value / response is untouched; we just
 * tee exceptions to Sentry on the way out.
 */
function withSentry(opName, handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      // Pull the callable request shape if it looks like one.
      const req = args[0] || {};
      const ctx = {
        op: opName,
        uid: req.auth && req.auth.uid,
        companyId: req.auth && req.auth.token && req.auth.token.companyId,
        plan: req.auth && req.auth.token && req.auth.token.plan
      };
      captureException(err, ctx);
      throw err;
    }
  };
}

module.exports = { withSentry, captureException, ensureInit };

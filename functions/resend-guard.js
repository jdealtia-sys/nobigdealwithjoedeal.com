/**
 * resend-guard.js — shared helper for every functions/*.js call site that
 * calls `resend.emails.send()`.
 *
 * The Resend SDK (v6.24.0) does NOT throw on an API-level rejection (bad
 * or expired key, suspended account, invalid sender domain, 429 rate
 * limit, 5xx) — it resolves normally to `{ data: null, error: {...} }`.
 * Any call site that only wraps the send in try/catch and never inspects
 * `.error` treats that rejection as a genuine delivery. Found first in
 * `sendEmail` (functions/email-functions.js) while live-testing invoicing
 * 2026-09-08 — see documentation/audit/STRIPE-INVOICING-STATUS-2026-09-08.md
 * — and confirmed at the same call shape in ~18 more places across
 * functions/ (documentation/audit/RESEND-ERROR-SURFACING-SWEEP-2026-09-08.md
 * has the file-by-file disposition).
 *
 * Usage at a call site:
 *   const response = await resend.emails.send({ ... });
 *   if (resendRejected(response)) {
 *     const msg = resendErrorMessage(response);
 *     // ...mark the record/ledger/return value failed, using `msg`...
 *     return; // or continue/skip, matching the surrounding loop
 *   }
 *   // ...existing success path...
 */
'use strict';

/**
 * @param {{data?: any, error?: any}|null|undefined} response
 * @returns {boolean} true when Resend rejected the send at the API level.
 */
function resendRejected(response) {
  return !!(response && response.error);
}

/**
 * @param {{error?: any}|null|undefined} response
 * @param {string} [fallback]
 * @returns {string} a short human-readable rejection reason.
 */
function resendErrorMessage(response, fallback) {
  const err = response && response.error;
  if (!err) return fallback || 'unknown';
  if (typeof err === 'string') return err;
  return err.message || fallback || 'Email provider rejected the request';
}

module.exports = { resendRejected, resendErrorMessage };
// Real-fn-call test hook (same convention as photo-vision.js's exports._test).
module.exports._test = { resendRejected, resendErrorMessage };

/**
 * integrations/turnstile.js — Cloudflare Turnstile verification
 *
 * Humans fill public lead forms; bots fill them with SQLi-looking
 * junk. Turnstile is a free, privacy-friendly CAPTCHA — easier UX
 * than reCAPTCHA and no Google cookies. Drop the widget in the
 * form, pass the token to submitPublicLead, we verify server-side.
 *
 * SETUP:
 *   1. cloudflare.com → Turnstile → new site → grab site + secret key.
 *   2. Set site key in docs/free-guide/... as data-sitekey attr.
 *   3. firebase functions:secrets:set TURNSTILE_SECRET
 *
 * If TURNSTILE_SECRET is unset, verifyTurnstile returns
 * { configured: false } and submitPublicLead falls back to App
 * Check + honeypot + rate limit (still strong — Turnstile is
 * defense in depth).
 */

'use strict';

const { logger } = require('firebase-functions/v2');
const { getSecret, hasSecret, notConfigured } = require('./_shared');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verify a Turnstile token server-side.
 *
 * @param {string} token      cf-turnstile-response from the widget
 * @param {string} remoteip   caller IP (for Turnstile's risk model)
 * @returns {Promise<{ok:boolean, configured:boolean, score?:number, reason?:string}>}
 */
async function verifyTurnstile(token, remoteip) {
  if (!hasSecret('TURNSTILE_SECRET')) {
    return { ok: true, configured: false };  // allow when not configured
  }
  if (typeof token !== 'string' || token.length < 10 || token.length > 2048) {
    return { ok: false, configured: true, reason: 'missing-token' };
  }
  try {
    const body = new URLSearchParams();
    body.set('secret', getSecret('TURNSTILE_SECRET'));
    body.set('response', token);
    if (remoteip) body.set('remoteip', remoteip);
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const data = await res.json();
    // Turnstile returns { success: true|false, "error-codes": [...] }
    if (data && data.success === true) {
      return { ok: true, configured: true };
    }
    logger.warn('Turnstile verify rejected', { codes: data['error-codes'] });
    return { ok: false, configured: true, reason: (data['error-codes'] || []).join(',') || 'rejected' };
  } catch (e) {
    // Fail CLOSED on verifier error — an attacker who can 500 the
    // Turnstile API shouldn't get past the gate.
    logger.error('Turnstile verify error:', e.message);
    return { ok: false, configured: true, reason: 'verify-error' };
  }
}

module.exports = { verifyTurnstile };

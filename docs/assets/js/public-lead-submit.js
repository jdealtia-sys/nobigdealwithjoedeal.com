/**
 * public-lead-submit.js — tiny client for the submitPublicLead gateway.
 *
 * The four public-facing lead forms (free guide, contact homepage,
 * storm alert subscribe, estimate request) used to write directly to
 * Firestore. Post-C-3 those collections deny client writes — every
 * submission must go through the rate-limited, App-Checked,
 * Turnstile-verified Cloud Function.
 *
 * Usage (drop in a <script> tag on each page):
 *   <script src="/assets/js/public-lead-submit.js"></script>
 *   ...
 *   const out = await window.submitPublicLead('guide', {
 *     name, email, source: 'free-guide',
 *     turnstileToken  // optional if Turnstile widget wired on the page
 *   });
 *   if (out.ok) { ...thank-you path... }
 *
 * Return shape:
 *   { ok: true, id: 'firestore-doc-id' }
 *   { ok: false, reason: '...', status: <http status> }
 *
 * The function URL comes from window.__NBD_FUNCTIONS_BASE so each
 * host page can override for staging/prod without touching this file.
 */

(function () {
  'use strict';

  if (typeof window.submitPublicLead === 'function') return;

  const DEFAULT_BASE = 'https://us-central1-nobigdeal-pro.cloudfunctions.net';
  function baseUrl() {
    return (window.__NBD_FUNCTIONS_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  }

  async function submitPublicLead(kind, fields) {
    if (!kind || typeof kind !== 'string') {
      return { ok: false, reason: 'Missing kind' };
    }
    const payload = Object.assign({ kind }, fields || {});
    try {
      const res = await fetch(baseUrl() + '/submitPublicLead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        // We don't ship credentials — the endpoint is unauth'd and
        // gated by App Check + Turnstile + per-IP rate limit.
        credentials: 'omit',
        mode: 'cors'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, reason: data.error || 'Submission failed', status: res.status };
      }
      return { ok: true, id: data.id || null };
    } catch (e) {
      return { ok: false, reason: 'Network error: ' + (e.message || 'unknown') };
    }
  }

  window.submitPublicLead = submitPublicLead;
})();

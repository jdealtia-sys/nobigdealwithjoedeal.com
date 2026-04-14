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

  // ─── Turnstile auto-wiring ─────────────────────────────
  // A page can opt in by setting window.__NBD_TURNSTILE_SITEKEY before
  // this script loads (or by just placing a <div class="cf-turnstile"
  // data-sitekey="..."></div> element). We:
  //   1. Lazy-load https://challenges.cloudflare.com/turnstile/v0/api.js
  //      once, the first time submitPublicLead() is called.
  //   2. Expose nbdTurnstileExecute(container) → Promise<token> that
  //      either uses the widget's latest response OR forces a fresh
  //      challenge when no token is cached.
  // If no site key and no widget, we resolve '' and the server decides
  // whether to allow (unconfigured server = pass; configured = 403).
  let _turnstileLoadingPromise = null;
  function ensureTurnstileLoaded() {
    if (typeof window.turnstile === 'object' && window.turnstile) return Promise.resolve(true);
    if (_turnstileLoadingPromise) return _turnstileLoadingPromise;
    _turnstileLoadingPromise = new Promise((resolve) => {
      // Skip load if no site key + no widget element.
      const hasKey    = !!(window.__NBD_TURNSTILE_SITEKEY || '').trim();
      const hasWidget = !!document.querySelector('.cf-turnstile, .cf-turnstile-auto');
      if (!hasKey && !hasWidget) return resolve(false);
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return _turnstileLoadingPromise;
  }

  // Returns a Promise<string> — empty string means "no token was
  // obtained" which is safe when the server isn't enforcing.
  async function nbdTurnstileExecute() {
    const siteKey = (window.__NBD_TURNSTILE_SITEKEY || '').trim();
    const loaded = await ensureTurnstileLoaded();
    if (!loaded || !window.turnstile) return '';
    // Find (or create) the container.
    let box = document.querySelector('.cf-turnstile-auto');
    if (!box && siteKey) {
      box = document.createElement('div');
      box.className = 'cf-turnstile-auto';
      box.style.cssText = 'display:flex;justify-content:center;margin:12px 0;';
      document.body.appendChild(box);
    }
    if (!box) return '';
    // If a widgetId already exists, force a reset to ensure a fresh
    // token — cached tokens expire in 5 minutes.
    return new Promise((resolve) => {
      try {
        const id = window.turnstile.render(box, {
          sitekey: siteKey || box.dataset.sitekey || '',
          size: 'invisible',
          callback: (token) => resolve(token || ''),
          'error-callback': () => resolve(''),
          'timeout-callback': () => resolve('')
        });
        // Invisible widgets fire callback automatically; managed/visible
        // ones are triggered by the user. 8-sec safety timeout.
        setTimeout(() => resolve(''), 8000);
        // If this is a managed widget, explicitly execute.
        try { window.turnstile.execute(id); } catch (e) {}
      } catch (e) { resolve(''); }
    });
  }
  window.nbdTurnstileExecute = nbdTurnstileExecute;

  async function submitPublicLead(kind, fields) {
    if (!kind || typeof kind !== 'string') {
      return { ok: false, reason: 'Missing kind' };
    }
    // Pull a Turnstile token if we can. Pages that don't wire it
    // get an empty string — the server falls through to App Check
    // + rate limit + honeypot.
    let turnstileToken = '';
    try { turnstileToken = await nbdTurnstileExecute(); } catch (e) {}

    const payload = Object.assign({ kind, turnstileToken }, fields || {});
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

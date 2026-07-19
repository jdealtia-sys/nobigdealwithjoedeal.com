/**
 * nbd-comms.js — platform messaging with graceful handoff fallback
 *
 * Three modules call `window.NBDComms.sendEmail` / `sendSMS`:
 *   - invoice-pipeline.js (object-shape signature)
 *   - email_system.js     (positional + options-object signature)
 *   - d2d-tracker.js      (positional with knockId signature)
 *
 * Preferred path: POST to Cloud Functions sendEmail / sendSMS
 * (Resend + Twilio). Server writes email_log / sms_log with leadId+uid+date
 * so the Communication Log query works. Client MUST NOT write those
 * collections (Firestore rules: allow write: if false).
 *
 * Fallback: mailto: / sms: protocol handoff when:
 *   - not signed in / no token
 *   - App Check / network / rate-limit / paid-gate / opt-out failures
 *   - caller passes { forceHandoff: true }
 *
 * Returns { success, mode: 'platform'|'mailto'|'sms', id?, sid?, error? }.
 * Callers that mark invoices "sent" should treat mode:'platform' as delivered
 * and mode:'mailto'|'sms' as "rep initiated client handoff".
 *
 * Also defines window.EmailDrip — stage-change toast (opt-in review, no auto-send).
 *
 * Loaded on dashboard.html + customer.html as a defer-script before
 * crm.js / email_system.js so window.NBDComms / window.EmailDrip exist early.
 */
let _NBD_NC_DELEGATE; // module-local (globals Tranche 1 — was window.*)
(function () {
  'use strict';

  const FUNCTIONS_BASE = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(
    (typeof location !== 'undefined' && location.hostname) || ''
  )
    ? 'http://127.0.0.1:5001/nobigdeal-pro/us-central1'
    : 'https://us-central1-nobigdeal-pro.cloudfunctions.net';

  // ── Helpers ─────────────────────────────────────────────────────
  const escHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  function toMailtoBody(html) {
    if (!html) return '';
    return String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ── Argument normalization ──────────────────────────────────────
  function normalizeEmailArgs(a, b, c, d) {
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      return {
        to: a.to || '',
        subject: a.subject || '',
        body: a.body || a.text || (a.html ? toMailtoBody(a.html) : ''),
        html: a.html || null,
        leadId: a.leadId || null,
        replyTo: a.replyTo || null,
        forceHandoff: !!a.forceHandoff,
      };
    }
    return {
      to: a || '',
      subject: b || '',
      body: c || '',
      html: (d && d.html) || null,
      leadId: (d && d.leadId) || null,
      replyTo: (d && d.replyTo) || null,
      forceHandoff: !!(d && d.forceHandoff),
    };
  }

  function normalizeSmsArgs(a, b, c) {
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      return {
        to: a.to || a.phone || '',
        body: a.message || a.body || a.text || '',
        knockId: a.knockId || null,
        leadId: a.leadId || null,
        forceHandoff: !!a.forceHandoff,
      };
    }
    return {
      to: a || '',
      body: b || '',
      knockId: c || null,
      leadId: null,
      forceHandoff: false,
    };
  }

  function _openHandoff(href) {
    if (!href) return;
    try {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { a.remove(); } catch (_) {} }, 0);
    } catch (e) {
      try { window.location.href = href; } catch (_) {}
    }
  }

  async function _authHeaders() {
    const user = window._user
      || (window.auth && window.auth.currentUser)
      || (window._auth && window._auth.currentUser);
    if (!user || typeof user.getIdToken !== 'function') return null;
    const idToken = await user.getIdToken();
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + idToken,
    };
    // App Check: sendEmail/sendSMS declare enforceAppCheck:true.
    try {
      const ac = window.__NBD_APP_CHECK;
      if (ac) {
        const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js');
        if (mod && typeof mod.getToken === 'function') {
          const tok = await mod.getToken(ac, /* forceRefresh */ false);
          if (tok && tok.token) headers['X-Firebase-AppCheck'] = tok.token;
        }
      }
    } catch (_) { /* proceed; server may still accept in soft-fail envs */ }
    return headers;
  }

  async function _platformPost(fnName, body) {
    const headers = await _authHeaders();
    if (!headers) return { ok: false, status: 401, error: 'not-authenticated' };
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 25000) : null;
    try {
      const res = await fetch(FUNCTIONS_BASE + '/' + fnName, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
      if (timeout) clearTimeout(timeout);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: data.error || ('HTTP ' + res.status),
        };
      }
      return { ok: true, status: res.status, data: data };
    } catch (e) {
      if (timeout) clearTimeout(timeout);
      return { ok: false, status: 0, error: (e && e.message) || 'network-error' };
    }
  }

  // ── NBDComms ────────────────────────────────────────────────────
  window.NBDComms = {
    /**
     * Send email via platform (Resend) with mailto: fallback.
     * @returns {Promise<{success:boolean, mode:string, id?:string, error?:string}>}
     */
    async sendEmail() {
      const { to, subject, body, html, leadId, replyTo, forceHandoff } = normalizeEmailArgs.apply(null, arguments);
      if (!to) {
        const msg = 'No recipient — add an email to the customer record first.';
        if (window.showToast) window.showToast(msg, 'error');
        return { success: false, mode: 'mailto', error: 'no-recipient' };
      }
      const plainBody = body || (html ? toMailtoBody(html) : '');
      if (!subject || !String(subject).trim()) {
        if (window.showToast) window.showToast('Email subject is required.', 'error');
        return { success: false, mode: 'mailto', error: 'no-subject' };
      }
      if (!plainBody && !html) {
        if (window.showToast) window.showToast('Email body is empty.', 'error');
        return { success: false, mode: 'mailto', error: 'no-body' };
      }

      if (!forceHandoff) {
        const plat = await _platformPost('sendEmail', {
          to: to,
          subject: subject,
          body: plainBody || undefined,
          html: html || undefined,
          replyTo: replyTo || undefined,
          leadId: leadId || undefined,
        });
        if (plat.ok) {
          if (window.showToast) window.showToast('Email sent', 'success');
          return {
            success: true,
            mode: 'platform',
            id: (plat.data && (plat.data.id || plat.data.messageId)) || null,
          };
        }
        // Hard role/auth errors: don't silently open mailto (rep would think
        // they sent). Surface and stop.
        if (plat.status === 403 || plat.status === 401) {
          const msg = plat.error || 'Not allowed to send email from this account.';
          if (window.showToast) window.showToast(msg, 'error');
          return { success: false, mode: 'platform', error: plat.error || 'forbidden' };
        }
        // Rate limit: tell the rep; fall through to mailto so work continues.
        if (plat.status === 429 && window.showToast) {
          window.showToast((plat.error || 'Email limit reached') + ' — opening your mail app instead.', 'warning');
        } else if (plat.error && window.showToast) {
          window.showToast('Platform email failed — opening your mail app.', 'warning');
        }
      }

      // Handoff fallback (no client audit write — rules deny it and it lies).
      const link = 'mailto:' + encodeURIComponent(to)
        + '?subject=' + encodeURIComponent(subject || '')
        + '&body=' + encodeURIComponent(plainBody);
      _openHandoff(link);
      return { success: true, mode: 'mailto' };
    },

    /**
     * Send SMS via platform (Twilio) with sms: protocol fallback.
     * @returns {Promise<{success:boolean, mode:string, sid?:string, error?:string}>}
     */
    async sendSMS() {
      const { to, body, knockId, leadId, forceHandoff } = normalizeSmsArgs.apply(null, arguments);
      if (!to) {
        const msg = 'No phone number — add one to the customer record first.';
        if (window.showToast) window.showToast(msg, 'error');
        return { success: false, mode: 'sms', error: 'no-recipient' };
      }
      if (!body || !String(body).trim()) {
        if (window.showToast) window.showToast('Message body is empty.', 'error');
        return { success: false, mode: 'sms', error: 'no-body' };
      }

      if (!forceHandoff) {
        const plat = await _platformPost('sendSMS', {
          to: to,
          body: body,
          leadId: leadId || undefined,
          knockId: knockId || undefined,
        });
        if (plat.ok) {
          if (window.showToast) window.showToast('Text sent', 'success');
          return {
            success: true,
            mode: 'platform',
            sid: (plat.data && plat.data.sid) || null,
          };
        }
        // Opt-out / forbidden: do not open device Messages (would still text).
        if (plat.status === 403) {
          const msg = plat.error || 'Cannot text this number (opted out or not allowed).';
          if (window.showToast) window.showToast(msg, 'error');
          return { success: false, mode: 'platform', error: plat.error || 'forbidden' };
        }
        if (plat.status === 401) {
          if (window.showToast) window.showToast('Sign in again to send texts.', 'error');
          return { success: false, mode: 'platform', error: 'not-authenticated' };
        }
        if (plat.status === 429 && window.showToast) {
          window.showToast((plat.error || 'SMS limit reached') + ' — opening Messages instead.', 'warning');
        } else if (plat.error && window.showToast) {
          // Paid-gate / Twilio trial / network — hand off so field work continues.
          window.showToast('Platform SMS unavailable — opening Messages.', 'warning');
        }
      }

      const link = 'sms:' + encodeURIComponent(to) + '?body=' + encodeURIComponent(body || '');
      _openHandoff(link);
      return { success: true, mode: 'sms' };
    },
  };

  // ── EmailDrip ──────────────────────────────────────────────────
  window.EmailDrip = {
    async onStageChange(leadId, oldStageKey, newStageKey) {
      if (!leadId || !newStageKey) return;
      if (oldStageKey === newStageKey) return;
      if (newStageKey === 'lost' || newStageKey === 'closed') return;
      try {
        const hasTemplate = !!(window.emailSystem
          && window.emailSystem.stageTemplates
          && window.emailSystem.stageTemplates[newStageKey]);
        let lead = (window._leads || []).find(l => l.id === leadId);
        if (!lead && window.db && window.getDoc && window.doc) {
          try {
            const snap = await window.getDoc(window.doc(window.db, 'leads', leadId));
            if (snap.exists()) lead = { id: leadId, ...snap.data() };
          } catch (_) {}
        }
        if (!lead || !lead.email) return;
        const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim() || 'this customer';
        const safeId = String(leadId).replace(/[^a-zA-Z0-9_-]/g, '');
        const safeName = escHtml(name);
        const ncAction = (typeof window.emailByStage === 'function') ? 'emailByStage' : 'gotoCustomerEmail';
        const msg = `📧 Stage email ready for <strong>${safeName}</strong>`
          + ` <button data-nc-action="${ncAction}" data-nc-id="${safeId}" style="margin-left:8px;padding:3px 10px;`
          + `border:1px solid var(--orange);background:var(--orange);color:#fff;`
          + `border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;">`
          + `Review &amp; send</button>`;
        if (typeof window.showToast === 'function') {
          window.showToast(msg, hasTemplate ? 'success' : 'info');
        }
      } catch (e) {
        console.warn('EmailDrip.onStageChange failed:', e && e.message);
      }
    }
  };
})();


(function(){if(_NBD_NC_DELEGATE)return;_NBD_NC_DELEGATE=true;document.addEventListener('click',function(ev){var t=ev.target.closest&&ev.target.closest('[data-nc-action]');if(!t)return;var a=t.dataset.ncAction;var id=t.dataset.ncId;if(a==='emailByStage'&&typeof window.emailByStage==='function')window.emailByStage(id);else if(a==='gotoCustomerEmail')window.location.href='/pro/customer.html?id='+id+'&action=email-stage';});})();

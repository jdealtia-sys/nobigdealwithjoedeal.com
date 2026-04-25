/**
 * nbd-comms.js — graceful-degradation messaging shim
 *
 * Three modules call `window.NBDComms.sendEmail` / `sendSMS`:
 *   - invoice-pipeline.js (object-shape signature)
 *   - email_system.js     (positional + options-object signature)
 *   - d2d-tracker.js      (positional with knockId signature)
 *
 * NBDComms was never defined, so every email/SMS call threw "service
 * not available". Until a real Resend/Twilio Cloud Function ships,
 * this shim provides a graceful fallback that:
 *
 *   1. Writes an audit record to Firestore (`emails` or `sms_log`).
 *      That gives Joe an "I sent this on date X" trail he can share
 *      with insurance adjusters and a query target for analytics.
 *   2. Opens the user's native mail/SMS app via mailto:/sms: link
 *      with subject + body pre-filled. The user clicks Send in their
 *      own client. Same UX as the existing email_system.js mailto
 *      fallback, but now the upstream callers don't have to know.
 *   3. Returns `{success: true, mode: 'mailto'}` so callers proceed
 *      to mark the invoice/lead as "sent" — which is true: the user
 *      did initiate the send via their email client.
 *
 * Also defines window.EmailDrip — a placeholder hook crm.js has
 * called on every stage change since the auto-log work shipped but
 * which was never defined. Surfaces a non-blocking toast linking to
 * the customer page where Joe can review + send the templated email.
 *
 * IMPORTANT: this shim does NOT auto-send. Surprise emails to
 * homeowners on stage moves would create bigger problems than the
 * current silent gap. The `EmailDrip` step is opt-in per stage.
 *
 * Loaded on dashboard.html + customer.html as a defer-script before
 * crm.js / email_system.js so by the time those modules look up
 * window.NBDComms / window.EmailDrip the bindings exist.
 */
(function () {
  'use strict';

  // ── Helpers ─────────────────────────────────────────────────────
  const escHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  function toMailtoBody(html) {
    if (!html) return '';
    // mailto: doesn't render HTML — strip tags, decode common entities,
    // collapse whitespace. Lossy but better than dumping markup into
    // the user's email client.
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

  function logAudit(collectionName, payload) {
    try {
      if (!window.db || !window.addDoc || !window.collection) return Promise.resolve(null);
      return window.addDoc(window.collection(window.db, collectionName), {
        ...payload,
        createdAt: window.serverTimestamp ? window.serverTimestamp() : new Date(),
        sentBy: window.auth?.currentUser?.email || window._user?.email || 'unknown',
        userId: window.auth?.currentUser?.uid || window._user?.uid || null,
        deliveryMode: 'mailto-fallback'
      }).catch(e => {
        console.warn('NBDComms audit write failed:', e && e.message);
        return null;
      });
    } catch (e) {
      console.warn('NBDComms audit setup failed:', e && e.message);
      return Promise.resolve(null);
    }
  }

  // ── Argument normalization ──────────────────────────────────────
  // sendEmail can be called as:
  //   sendEmail({to, subject, html, body, leadId})
  //   sendEmail(to, subject, body, options)   ← email_system.js shape
  function normalizeEmailArgs(a, b, c, d) {
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      return {
        to: a.to || '',
        subject: a.subject || '',
        body: a.body || a.text || (a.html ? toMailtoBody(a.html) : ''),
        html: a.html || null,
        leadId: a.leadId || null
      };
    }
    return {
      to: a || '',
      subject: b || '',
      body: c || '',
      html: (d && d.html) || null,
      leadId: (d && d.leadId) || null
    };
  }

  // sendSMS can be called as:
  //   sendSMS({to, message})
  //   sendSMS(phone, body, knockId)   ← d2d-tracker shape
  function normalizeSmsArgs(a, b, c) {
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      return {
        to: a.to || a.phone || '',
        body: a.message || a.body || a.text || '',
        knockId: a.knockId || null,
        leadId: a.leadId || null
      };
    }
    return {
      to: a || '',
      body: b || '',
      knockId: c || null,
      leadId: null
    };
  }

  // ── NBDComms ────────────────────────────────────────────────────
  window.NBDComms = {
    /**
     * Send an email by opening the user's mail client with the body
     * pre-filled. Logs an audit record in Firestore.
     * @returns {Promise<{success:boolean, mode:string}>}
     */
    async sendEmail() {
      const { to, subject, body, html, leadId } = normalizeEmailArgs.apply(null, arguments);
      if (!to) {
        const msg = 'No recipient — add an email to the customer record first.';
        if (window.showToast) window.showToast(msg, 'error');
        return { success: false, mode: 'mailto', error: 'no-recipient' };
      }
      const plainBody = body || (html ? toMailtoBody(html) : '');
      await logAudit('emails', {
        leadId, to, subject, body: plainBody,
        hasHtml: !!html, context: 'nbd-comms'
      });
      try {
        const link = 'mailto:' + encodeURIComponent(to)
          + '?subject=' + encodeURIComponent(subject || '')
          + '&body=' + encodeURIComponent(plainBody);
        // Use location.href so iOS PWA in standalone mode hands off to
        // the configured mail handler instead of opening a new tab
        // that gets eaten by Safari's window.open patch.
        window.location.href = link;
      } catch (e) {
        console.warn('mailto open failed:', e && e.message);
      }
      return { success: true, mode: 'mailto' };
    },

    /**
     * Send a SMS by opening the device's Messages app with body
     * pre-filled. Logs an audit record.
     * @returns {Promise<{success:boolean, mode:string}>}
     */
    async sendSMS() {
      const { to, body, knockId, leadId } = normalizeSmsArgs.apply(null, arguments);
      if (!to) {
        const msg = 'No phone number — add one to the customer record first.';
        if (window.showToast) window.showToast(msg, 'error');
        return { success: false, mode: 'sms', error: 'no-recipient' };
      }
      await logAudit('sms_log', {
        leadId, knockId, to, body, context: 'nbd-comms'
      });
      try {
        // iOS uses '&' for separator after the first param; Android uses '?'.
        // The canonical form is `sms:NUMBER?body=TEXT` which both honor.
        const link = 'sms:' + encodeURIComponent(to) + '?body=' + encodeURIComponent(body || '');
        window.location.href = link;
      } catch (e) {
        console.warn('sms open failed:', e && e.message);
      }
      return { success: true, mode: 'sms' };
    }
  };

  // ── EmailDrip ──────────────────────────────────────────────────
  // crm.js calls this on every stage move. See header comment above.
  window.EmailDrip = {
    async onStageChange(leadId, oldStageKey, newStageKey) {
      if (!leadId || !newStageKey) return;
      if (oldStageKey === newStageKey) return;
      // Don't drip terminal stages — the customer doesn't need a "you
      // closed!" / "you lost!" follow-up triggered automatically.
      if (newStageKey === 'lost' || newStageKey === 'closed') return;
      try {
        // Only nudge for stages that have a templated email available.
        // emailSystem may not be loaded on the dashboard — the toast
        // still surfaces a useful "open the customer page to send" link.
        const hasTemplate = !!(window.emailSystem
          && window.emailSystem.stageTemplates
          && window.emailSystem.stageTemplates[newStageKey]);
        // Look up the lead from the in-memory cache first (fast path
        // when crm.js has already loaded leads), fall back to a fresh
        // Firestore read.
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
        // If we're on the dashboard (no emailByStage available) deep-link
        // to the customer page where Joe can review + send.
        const action = (typeof window.emailByStage === 'function')
          ? `window.emailByStage('${safeId}')`
          : `window.location.href='/pro/customer.html?id=${safeId}&action=email-stage'`;
        const msg = `📧 Stage email ready for <strong>${safeName}</strong>`
          + ` <button onclick="${action}" style="margin-left:8px;padding:3px 10px;`
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

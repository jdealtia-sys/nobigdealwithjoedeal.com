/**
 * portal-link-helpers.js — Wave 42 (Shared portal-link helpers)
 *
 * Waves 40 + 41 introduced one-click "Copy Portal Link" and one-tap
 * "Text Portal Link" buttons on the customer detail page. This wave
 * extracts the resolve / copy / SMS logic into a shared module so
 * the same helpers can be invoked from any surface that has a lead
 * — most importantly the kanban context menu (Wave 26), where reps
 * want to grab the link without opening the customer page.
 *
 * The customer.html buttons (W40/W41) keep their existing handlers
 * but delegate here for the actual work — single source of truth
 * for the resolve flow + clipboard fallbacks + SMS body template.
 *
 * Exposes: window.PortalLinkHelpers
 *   .resolveUrl(leadId)         → Promise<string>
 *   .copyForLead(lead)          → Promise<void>  (toast on success/fail)
 *   .smsForLead(lead)           → Promise<void>  (toast + sms: handoff)
 */
(function () {
  'use strict';

  if (window.PortalLinkHelpers
      && window.PortalLinkHelpers.__sentinel === 'nbd-portal-link-helpers-v1') return;

  // ─── Helpers ─────────────────────────────────────────────────────
  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  function leadFromIdOrObj(leadOrId) {
    if (!leadOrId) return null;
    if (typeof leadOrId === 'string') {
      if (Array.isArray(window._leads)) {
        return window._leads.find(l => l && l.id === leadOrId) || { id: leadOrId };
      }
      return { id: leadOrId };
    }
    return leadOrId;
  }

  // ─── Share tracking ──────────────────────────────────────────────
  // Wave 44: stamp lead.lastSharedAt + lastSharedVia after each
  // share. Best-effort — fires AFTER the share itself succeeds so a
  // tracking failure can't block the rep from sharing. The in-memory
  // cache is patched first (immediate visual feedback on the kanban
  // + customer page) and the Firestore write is fire-and-forget.
  function _recordShare(leadId, via) {
    if (!leadId || !via) return;
    const now = new Date();

    // Patch in-memory caches so widgets see fresh state without
    // waiting on the Firestore round-trip.
    if (Array.isArray(window._leads)) {
      const i = window._leads.findIndex(l => l && l.id === leadId);
      if (i >= 0) {
        window._leads[i] = {
          ...window._leads[i],
          lastSharedAt: now,
          lastSharedVia: via,
        };
      }
    }
    if (window._currentLead && window._currentLead.id === leadId) {
      window._currentLead = {
        ...window._currentLead,
        lastSharedAt: now,
        lastSharedVia: via,
      };
    }
    try {
      window.dispatchEvent(new CustomEvent('nbd:data-refreshed', {
        detail: { source: 'share-recorded', leadId, via },
      }));
    } catch (_) {}

    // Best-effort Firestore write. Failures are logged but never
    // surface to the user — the share itself already succeeded.
    if (!window.db || !window.doc || !window.updateDoc) return;
    const ref = window.doc(window.db, 'leads', leadId);
    const ts = window.serverTimestamp ? window.serverTimestamp() : now;
    window.updateDoc(ref, { lastSharedAt: ts, lastSharedVia: via })
      .catch(e => console.warn('[PortalLinkHelpers._recordShare] write failed', e.message));
  }

  // ─── Resolve URL ────────────────────────────────────────────────
  // Firestore-first / generate-on-demand. Same flow Waves 40 + 41
  // already implemented inline in customer.html — extracted here so
  // the kanban context menu can reuse it without duplicating.
  async function resolveUrl(leadId) {
    if (!leadId) throw new Error('leadId required');
    if (typeof window.CustomerPortal === 'undefined') {
      throw new Error('Portal module not loaded');
    }
    if (!window.db || !window.doc || !window.getDoc) {
      throw new Error('Firestore not loaded');
    }
    // Try existing URL first.
    let url = null;
    try {
      const snap = await window.getDoc(window.doc(window.db, 'leads', leadId));
      const data = snap.exists() ? snap.data() : {};
      if (typeof data.portalUrl === 'string' && /^https?:\/\//.test(data.portalUrl)) {
        url = data.portalUrl;
      }
    } catch (_) { /* fall through to generate */ }
    if (!url) url = await window.CustomerPortal.generate(leadId);
    if (!url) throw new Error('Generation failed');
    return url;
  }

  // ─── Copy ───────────────────────────────────────────────────────
  // Mirror of Wave 40's clipboard-with-fallbacks logic. Three layers:
  //   1. navigator.clipboard.writeText (modern, requires user gesture)
  //   2. document.execCommand('copy') via temp textarea (legacy)
  //   3. Open share panel + select URL (only available on customer.html)
  async function copyForLead(leadOrId) {
    const lead = leadFromIdOrObj(leadOrId);
    if (!lead || !lead.id) {
      _toast('No customer selected', 'error');
      return;
    }
    try {
      const url = await resolveUrl(lead.id);

      // Try modern clipboard API.
      let copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(url);
          copied = true;
        } catch (_) { /* fall through */ }
      }
      // execCommand fallback for older WebKit / non-secure contexts.
      if (!copied) {
        try {
          const ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          copied = document.execCommand('copy');
          document.body.removeChild(ta);
        } catch (_) {}
      }

      if (copied) {
        _toast('Portal link copied — paste anywhere', 'success');
        _recordShare(lead.id, 'copy');
      } else {
        // On the customer page we can fall back to opening the
        // share panel + selecting the URL. From the kanban context
        // we don't have a panel; just surface the URL in the toast
        // so the rep at least sees what was generated.
        if (typeof window.openGallerySharePanel === 'function') {
          await window.openGallerySharePanel();
          const input = document.getElementById('fullPortalUrl');
          if (input) {
            input.value = url;
            input.select();
          }
          _toast('Couldn\'t auto-copy — link is selected, press Ctrl/Cmd+C', 'info');
        } else {
          _toast('Couldn\'t copy — URL: ' + url, 'info');
        }
      }
    } catch (e) {
      console.warn('[PortalLinkHelpers.copyForLead] failed', e);
      _toast('Couldn\'t copy link: ' + (e.message || 'unknown'), 'error');
    }
  }

  // ─── SMS ────────────────────────────────────────────────────────
  // Mirror of Wave 41's prefilled-body + sms: handoff. Bails with a
  // toast when the lead has no phone (since there's no phone on the
  // kanban context call site to fall back to).
  async function smsForLead(leadOrId) {
    const lead = leadFromIdOrObj(leadOrId);
    if (!lead || !lead.id) {
      _toast('No customer selected', 'error');
      return;
    }
    const phone = String(lead.phone || '').replace(/\D+/g, '');
    if (!phone) {
      _toast('No phone number on this customer', 'error');
      return;
    }
    try {
      const url = await resolveUrl(lead.id);
      const firstName = String(lead.firstName || '').trim();
      const greeting = firstName ? `Hi ${firstName}, ` : 'Hi, ';

      // Wave 98: template picker integration. When the rep has 2+
      // SMS templates saved, open the picker. With 1 template,
      // apply it directly. With 0 templates or "Use built-in
      // default" pick, fall through to the W41 hardcoded body.
      // Cancelled picker (Esc / × / outside click) returns
      // undefined and aborts the send.
      let body;
      if (window.TemplatesLibrary && typeof window.TemplatesLibrary.pickAndRender === 'function') {
        const picked = await window.TemplatesLibrary.pickAndRender('sms', { lead, url });
        if (picked === undefined) {
          // Rep cancelled — abort silently.
          return;
        }
        if (picked && picked.body) {
          body = picked.body;
        }
      }
      if (!body) {
        body = `${greeting}here's your project portal — photos, status updates, and what's coming next: ${url}`;
      }

      const smsUrl = `sms:${phone}?body=${encodeURIComponent(body)}`;
      window.location.href = smsUrl;
      _toast(firstName ? `Opening SMS to ${firstName}…` : 'Opening SMS…', 'success');
      _recordShare(lead.id, 'sms');
    } catch (e) {
      console.warn('[PortalLinkHelpers.smsForLead] failed', e);
      _toast('Couldn\'t prepare SMS: ' + (e.message || 'unknown'), 'error');
    }
  }

  // ─── Email ──────────────────────────────────────────────────────
  // Wave 43: mailto: composer with prefilled subject + body. Same
  // shape as smsForLead but on the email channel. Common ask: rep
  // wants to email the portal link to a homeowner who prefers
  // email over text, or who's sharing with their spouse.
  //
  // mailto: line breaks: per RFC 6068 use %0D%0A (CRLF). encodeURI
  // doesn't escape %0A but encodeURIComponent does, so we
  // pre-encode the body manually as a multi-line plaintext.
  async function emailForLead(leadOrId) {
    const lead = leadFromIdOrObj(leadOrId);
    if (!lead || !lead.id) {
      _toast('No customer selected', 'error');
      return;
    }
    const email = String(lead.email || '').trim();
    if (!email) {
      _toast('No email on this customer', 'error');
      return;
    }
    try {
      const url = await resolveUrl(lead.id);
      const firstName = String(lead.firstName || '').trim();
      const greeting = firstName ? `Hi ${firstName},` : 'Hi,';

      // Wave 98: same template picker integration as smsForLead.
      // Returns { body, subject } when picked, null on "Use
      // default", undefined on cancel.
      let subject;
      let body;
      if (window.TemplatesLibrary && typeof window.TemplatesLibrary.pickAndRender === 'function') {
        const picked = await window.TemplatesLibrary.pickAndRender('email', { lead, url });
        if (picked === undefined) return; // cancelled
        if (picked) {
          if (picked.subject) subject = picked.subject;
          if (picked.body)    body    = picked.body;
        }
      }
      if (!subject) subject = 'Your project portal — photos, status, and next steps';
      if (!body) body =
`${greeting}

Here's your project portal — photos from your inspection / install, status updates, and what's coming next:

${url}

Bookmark it; the link stays live as we work through the project.

— No Big Deal Home Solutions`;
      const mailUrl =
        'mailto:' + encodeURIComponent(email) +
        '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);
      window.location.href = mailUrl;
      _toast(firstName ? `Opening email to ${firstName}…` : 'Opening email…', 'success');
      _recordShare(lead.id, 'email');
    } catch (e) {
      console.warn('[PortalLinkHelpers.emailForLead] failed', e);
      _toast('Couldn\'t prepare email: ' + (e.message || 'unknown'), 'error');
    }
  }

  // ─── Preview ────────────────────────────────────────────────────
  // Wave 56: open the portal in an iframe modal so the rep sees
  // exactly what the homeowner will see before sharing the link.
  // Real concern from the field: reps wonder "did I update that
  // photo gallery yet?" or "does the timeline show the right
  // status?" before they fire off an SMS. Preview gives them a
  // quick visual check.
  //
  // Modal pattern matches the W36 customer-snooze-banner overlay
  // and W23 data-import dialog — fixed inset overlay with one
  // dismissable backdrop click + Esc key + X button.
  async function previewForLead(leadOrId) {
    const lead = leadFromIdOrObj(leadOrId);
    if (!lead || !lead.id) {
      _toast('No customer selected', 'error');
      return;
    }
    let url;
    try {
      url = await resolveUrl(lead.id);
    } catch (e) {
      _toast('Couldn\'t prepare preview: ' + (e.message || 'unknown'), 'error');
      return;
    }
    _openPreviewModal(url, lead);
  }

  function _openPreviewModal(url, lead) {
    _closePreviewModal(); // be defensive about double-opens
    const overlay = document.createElement('div');
    overlay.id = 'nbd-portal-preview-overlay';
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:99997;
      background:rgba(0,0,0,0.65);
      display:flex; align-items:center; justify-content:center;
      padding:20px;
      font-family:'Barlow',-apple-system,system-ui,sans-serif;`;
    const name = leadFromIdOrObj(lead) ?
      (`${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'customer') : 'customer';
    overlay.innerHTML = `
      <div style="
        background:var(--s,#1a1f2a); color:var(--t,#e8eaf0);
        border:1px solid var(--br,#2a3344); border-radius:14px;
        width:100%; max-width:500px; height:min(85vh, 800px);
        display:flex; flex-direction:column;
        box-shadow:0 12px 40px rgba(0,0,0,0.5);
        overflow:hidden;">
        <div style="
          display:flex; align-items:center; justify-content:space-between;
          gap:8px; padding:14px 18px;
          border-bottom:1px solid var(--br,#2a3344);">
          <div style="min-width:0;">
            <div style="font-size:14px; font-weight:700; color:var(--t,#e8eaf0); line-height:1.2;">
              🔍 Portal preview
            </div>
            <div style="font-size:11px; color:var(--m,#9aa3b2); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              What ${escapeText(name)} will see
            </div>
          </div>
          <div style="display:flex; gap:6px; flex-shrink:0;">
            <a href="${escapeAttr(url)}" target="_blank" rel="noopener"
              title="Open in a new tab"
              style="
                display:flex; align-items:center; justify-content:center;
                width:32px; height:32px; border-radius:7px;
                background:var(--s2,#0f1419); color:var(--t,#e8eaf0);
                text-decoration:none; font-size:14px;
                border:1px solid var(--br,#2a3344);
                -webkit-tap-highlight-color:transparent;">↗</a>
            <button id="nbd-portal-preview-close" type="button" aria-label="Close"
              style="
                display:flex; align-items:center; justify-content:center;
                width:32px; height:32px; border-radius:7px;
                background:var(--s2,#0f1419); color:var(--t,#e8eaf0);
                border:1px solid var(--br,#2a3344); cursor:pointer;
                font-size:16px; line-height:1;
                -webkit-tap-highlight-color:transparent;">×</button>
          </div>
        </div>
        <iframe src="${escapeAttr(url)}"
          style="flex:1; width:100%; border:none; background:#fff;"
          referrerpolicy="no-referrer"
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        ></iframe>
      </div>`;
    document.body.appendChild(overlay);

    // Backdrop click dismisses (but not clicks inside the modal).
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) _closePreviewModal();
    });
    overlay.querySelector('#nbd-portal-preview-close')
      .addEventListener('click', _closePreviewModal);

    // Esc key dismisses. Single-use listener removed on close.
    document.addEventListener('keydown', _onPreviewKeydown);
  }

  function _onPreviewKeydown(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      _closePreviewModal();
    }
  }

  function _closePreviewModal() {
    const el = document.getElementById('nbd-portal-preview-overlay');
    if (el) el.remove();
    document.removeEventListener('keydown', _onPreviewKeydown);
  }

  function escapeText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function escapeAttr(s) { return escapeText(s); }

  window.PortalLinkHelpers = {
    __sentinel: 'nbd-portal-link-helpers-v1',
    resolveUrl,
    copyForLead,
    smsForLead,
    emailForLead,
    previewForLead,
    // Audit E: exposed so dashboard.html's _sharePortalLink (which uses
    // a different URL scheme via the createPortalToken callable) can
    // still participate in W44 share tracking. Every share entry point
    // must reach this function or downstream features (W57 fresh
    // pulse, W58 viewed badge, W92 engagement tier, W112 smart
    // followup, stale-shares filter) silently see zero signal.
    recordShare: _recordShare,
  };
})();

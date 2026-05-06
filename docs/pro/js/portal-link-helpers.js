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
      const body = `${greeting}here's your project portal — photos, status updates, and what's coming next: ${url}`;
      const smsUrl = `sms:${phone}?body=${encodeURIComponent(body)}`;
      window.location.href = smsUrl;
      _toast(firstName ? `Opening SMS to ${firstName}…` : 'Opening SMS…', 'success');
    } catch (e) {
      console.warn('[PortalLinkHelpers.smsForLead] failed', e);
      _toast('Couldn\'t prepare SMS: ' + (e.message || 'unknown'), 'error');
    }
  }

  window.PortalLinkHelpers = {
    __sentinel: 'nbd-portal-link-helpers-v1',
    resolveUrl,
    copyForLead,
    smsForLead,
  };
})();

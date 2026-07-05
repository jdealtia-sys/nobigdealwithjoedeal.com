
// ── Gallery Share Panel Functions ──
// Manages the persistent gallery share URL for a customer.
// Uses the CustomerPortal module to generate/delete portal links.
// The URL is stored on the lead doc as 'portalUrl' for instant
// retrieval on next page load (no re-generation needed).


// ── Dual Portal Functions (April 2026) ──
// Supports both Photo Gallery (photos-only) and Full Project Portal.

async function openGallerySharePanel() {
  const panel = document.getElementById('gallerySharePanel');
  if (!panel) return;
  panel.style.display = 'block';

  // Load existing URLs from the lead doc
  try {
    const leadSnap = await window.getDoc(window.doc(window.db, 'leads', window._customerId));
    const data = leadSnap.exists() ? leadSnap.data() : {};
    const photoInput = document.getElementById('photoPortalUrl');
    const fullInput = document.getElementById('fullPortalUrl');
    if (photoInput && data.photoPortalUrl) photoInput.value = data.photoPortalUrl;
    if (fullInput && data.portalUrl) fullInput.value = data.portalUrl;
  } catch (e) { /* will generate on demand */ }
}

async function generatePhotoPortalLink() {
  const input = document.getElementById('photoPortalUrl');
  if (input) input.value = 'Generating...';
  try {
    if (typeof CustomerPortal === 'undefined') throw new Error('Portal module not loaded');
    const url = await CustomerPortal.generatePhotoPortal(window._customerId);
    if (url && input) input.value = url;
    else if (input) input.value = 'Failed — try again';
  } catch (e) {
    if (input) input.value = 'Error: ' + (e.message || '').substring(0, 50);
  }
}

async function generateFullPortalLink() {
  const input = document.getElementById('fullPortalUrl');
  if (input) input.value = 'Generating...';
  try {
    if (typeof CustomerPortal === 'undefined') throw new Error('Portal module not loaded');
    const url = await CustomerPortal.generate(window._customerId);
    if (url && input) input.value = url;
    else if (input) input.value = 'Failed — try again';
  } catch (e) {
    if (input) input.value = 'Error: ' + (e.message || '').substring(0, 50);
  }
}

function copyPortalUrl(inputId) {
  const input = document.getElementById(inputId);
  if (!input || !input.value || input.value.startsWith('Error') || input.value.startsWith('Gen') || input.value.startsWith('Click')) return;
  navigator.clipboard.writeText(input.value).then(() => {
    if (typeof showToast === 'function') showToast('Link copied to clipboard', 'success');
  }).catch(() => {
    input.select();
    if (typeof showToast === 'function') showToast('Press Ctrl+C to copy', 'info');
  });
}

// Wave 40 + 41 + 42: portal link helpers.
//
// Wave 42 extracted the resolve / copy / SMS logic into a shared
// portal-link-helpers.js module so the same flow works from any
// surface (kanban context menu, recent dropdown, etc.) — not just
// the customer.html buttons. The Wave 40 + 41 button handlers below
// now delegate to that shared API; the button-specific UI bits
// (label restoration, "⏳ Preparing…" state) stay here.
//
// _resolvePortalUrl is kept as a thin local wrapper for any inline
// usage that still references it directly.
async function _resolvePortalUrl() {
  if (!window._customerId) throw new Error('No customer selected');
  if (window.PortalLinkHelpers) {
    return window.PortalLinkHelpers.resolveUrl(window._customerId);
  }
  // Defensive fallback if the shared module hasn't loaded yet —
  // matches the original Wave 40 implementation.
  if (typeof CustomerPortal === 'undefined') throw new Error('Portal module not loaded');
  let url = null;
  try {
    const leadSnap = await window.getDoc(window.doc(window.db, 'leads', window._customerId));
    const data = leadSnap.exists() ? leadSnap.data() : {};
    if (typeof data.portalUrl === 'string' && /^https?:\/\//.test(data.portalUrl)) {
      url = data.portalUrl;
    }
  } catch (_) {}
  if (!url) url = await CustomerPortal.generate(window._customerId);
  if (!url) throw new Error('Generation failed');
  return url;
}
window.quickCopyPortalLink = async function () {
  const button = document.getElementById('quickCopyPortalBtn');
  const restoreLabel = button ? button.innerHTML : null;
  if (button) {
    button.disabled = true;
    button.style.opacity = '0.7';
    button.style.cursor = 'wait';
    button.innerHTML = '⏳ Copying…';
  }
  try {
    const url = await _resolvePortalUrl();

    // Copy. The async clipboard API requires a user-gesture
    // origin; this function IS called from a click handler so it
    // qualifies. On failure (Safari permission, etc.) we fall back
    // to the share panel so the rep has a visible URL to copy
    // manually.
    let copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch (_) { /* fall through */ }
    }
    if (!copied) {
      // execCommand fallback for older WebKit / non-secure contexts.
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
      if (typeof showToast === 'function') showToast('Portal link copied — paste anywhere', 'success');
    } else {
      // Last resort: open the share panel so the rep can copy
      // manually + see exactly what was generated.
      if (typeof openGallerySharePanel === 'function') {
        await openGallerySharePanel();
        const input = document.getElementById('fullPortalUrl');
        if (input) {
          input.value = url;
          input.select();
        }
      }
      if (typeof showToast === 'function') showToast('Couldn\'t auto-copy — link is selected, press Ctrl/Cmd+C', 'info');
    }
  } catch (e) {
    console.warn('[quickCopyPortalLink] failed', e);
    if (typeof showToast === 'function') showToast('Couldn\'t copy link: ' + (e.message || 'unknown'), 'error');
    // Open the share panel so the rep can troubleshoot manually.
    if (typeof openGallerySharePanel === 'function') {
      try { openGallerySharePanel(); } catch (_) {}
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.style.opacity = '';
      button.style.cursor = '';
      if (restoreLabel != null) button.innerHTML = restoreLabel;
    }
  }
};

// Wave 56: open the portal in an iframe modal so the rep can
// preview exactly what the customer will see before sharing.
// Delegates to PortalLinkHelpers.previewForLead.
window.quickPreviewPortalLink = async function () {
  const button = document.getElementById('quickPreviewPortalBtn');
  const restoreLabel = button ? button.innerHTML : null;
  if (button) {
    button.disabled = true;
    button.style.opacity = '0.7';
    button.style.cursor = 'wait';
    button.innerHTML = '⏳ Loading…';
  }
  try {
    if (!window.PortalLinkHelpers) {
      if (typeof showToast === 'function') showToast('Portal helpers not loaded', 'error');
      return;
    }
    await window.PortalLinkHelpers.previewForLead(window._currentLead || { id: window._customerId });
  } finally {
    if (button) {
      button.disabled = false;
      button.style.opacity = '';
      button.style.cursor = '';
      if (restoreLabel != null) button.innerHTML = restoreLabel;
    }
  }
};

// Wave 43: same flow on the email channel. Delegates to
// PortalLinkHelpers.emailForLead for the resolve + mailto: build.
// The button-specific UI bits (label restoration, "⏳ Preparing…"
// state) stay here so the click still feels responsive even when
// the Firestore round-trip takes a beat.
window.quickEmailPortalLink = async function () {
  const button = document.getElementById('quickEmailPortalBtn');
  const restoreLabel = button ? button.innerHTML : null;
  if (button) {
    button.disabled = true;
    button.style.opacity = '0.7';
    button.style.cursor = 'wait';
    button.innerHTML = '⏳ Preparing…';
  }
  try {
    if (!window.PortalLinkHelpers) {
      if (typeof showToast === 'function') showToast('Portal helpers not loaded', 'error');
      return;
    }
    await window.PortalLinkHelpers.emailForLead(window._currentLead || { id: window._customerId });
  } finally {
    if (button) {
      button.disabled = false;
      button.style.opacity = '';
      button.style.cursor = '';
      if (restoreLabel != null) button.innerHTML = restoreLabel;
    }
  }
};

// Wave 41: same generate-or-fetch flow but hand off to the device
// SMS composer with prefilled body. Mid-customer-call use case:
// rep wants to text the portal link to the homeowner with one tap.
window.quickSmsPortalLink = async function () {
  const button = document.getElementById('quickSmsPortalBtn');
  const restoreLabel = button ? button.innerHTML : null;
  if (button) {
    button.disabled = true;
    button.style.opacity = '0.7';
    button.style.cursor = 'wait';
    button.innerHTML = '⏳ Preparing…';
  }
  try {
    const lead = window._currentLead || {};
    const phone = String(lead.phone || '').replace(/\D+/g, '');
    if (!phone) {
      if (typeof showToast === 'function') showToast('No phone number on this customer', 'error');
      return;
    }

    const url = await _resolvePortalUrl();

    // Friendly prefilled body — uses the customer's first name
    // when available so the SMS feels personal. Encoded for the
    // sms: URI scheme. Both ?body= and &body= work depending on
    // platform; we use the more universal ?body= format.
    const firstName = String(lead.firstName || '').trim();
    const greeting = firstName ? `Hi ${firstName}, ` : 'Hi, ';
    const body = `${greeting}here's your project portal — photos, status updates, and what's coming next: ${url}`;

    // Build the sms: URL. Per spec the body parameter goes after
    // the phone, separated by ?body= on iOS and &body= on Android.
    // The platforms tolerate both reasonably; ?body= is the safer
    // default. encodeURIComponent handles spaces + special chars.
    const smsUrl = `sms:${phone}?body=${encodeURIComponent(body)}`;

    // Hand off to the OS. On desktop browsers without an SMS
    // handler this no-ops or prompts the user — the toast
    // confirms what we tried so the rep isn't confused by silent
    // failure.
    window.location.href = smsUrl;
    if (typeof showToast === 'function') {
      showToast(firstName
        ? `Opening SMS to ${firstName}…`
        : 'Opening SMS…', 'success');
    }
  } catch (e) {
    console.warn('[quickSmsPortalLink] failed', e);
    if (typeof showToast === 'function') showToast('Couldn\'t prepare SMS: ' + (e.message || 'unknown'), 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.style.opacity = '';
      button.style.cursor = '';
      if (restoreLabel != null) button.innerHTML = restoreLabel;
    }
  }
};

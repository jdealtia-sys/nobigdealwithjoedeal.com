/**
 * customer-snooze-banner.js — Wave 36 (Snooze status on customer page)
 *
 * Closes the loop on Wave 35. The kanban hides snoozed leads by
 * default — but reps can still land on a snoozed lead via:
 *   - Cmd+K global search (Wave 18)
 *   - Activity feed click-through (Wave 24)
 *   - Recent customers dropdown
 *   - Direct URL / bookmark
 *   - Notification bell (estimate-stale signals still fire)
 *
 * Without a visible "this lead is snoozed" indicator on the
 * customer page, reps could be confused why the lead isn't
 * appearing in their kanban. This wave shows a banner at the top
 * of the customer page when the lead has an active snooze, with
 * a one-tap "Wake up now" button so they don't have to bounce
 * back to the kanban context menu to clear it.
 *
 * Activates only on /pro/customer.html. Updates on init + on
 * 'nbd:data-refreshed' so Wave 14's background revalidate, the
 * snooze/unsnooze actions, and the auto-expire path all keep the
 * banner accurate without a manual refresh.
 *
 * Auto-removes when the snooze expires while the page is open
 * (60s polling backstops the event-driven path).
 */
(function () {
  'use strict';

  if (window.CustomerSnoozeBanner
      && window.CustomerSnoozeBanner.__sentinel === 'nbd-customer-snooze-banner-v1') return;

  const PATH = window.location.pathname || '';
  if (!/\/pro\/customer\.html$/.test(PATH)) return;

  let bannerEl = null;

  // ─── Helpers ─────────────────────────────────────────────────────
  function getCurrentLead() {
    return window._currentLead || null;
  }

  function snoozeAvailable() {
    return !!(window.LeadSnooze && typeof window.LeadSnooze.isSnoozed === 'function');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function fullSnoozeLabel(date) {
    if (!date) return '';
    // Drop the "tomorrow" / "next Monday" relative form here — the
    // banner sits on the page for a while and absolute dates age
    // better than relative ones. Format: "Mon, Apr 23 · 9:00 AM".
    const dayPart = date.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    const timePart = date.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit',
    });
    return `${dayPart} · ${timePart}`;
  }

  // ─── Banner build / teardown ────────────────────────────────────
  function buildBanner(lead) {
    const date = window.LeadSnooze.snoozedUntilDate(lead);
    const label = fullSnoozeLabel(date);
    // W73: surface the snooze reason next to the title pill if the
    // rep tagged one when snoozing. Helps reps remember why each
    // lead is parked when they revisit it later.
    const reason = (lead && typeof lead.snoozedReason === 'string' && lead.snoozedReason.trim())
      ? lead.snoozedReason.trim()
      : '';
    const reasonPill = reason
      ? `<span style="display:inline-flex; align-items:center; gap:3px; margin-left:8px; padding:1px 8px; background:rgba(155,109,255,0.18); color:#cab8ff; border:1px solid rgba(155,109,255,0.45); border-radius:10px; font-size:10px; font-weight:600; letter-spacing:0.02em;">${escapeHtml(reason)}</span>`
      : '';
    // W74: stale-snooze indicator. When this lead has been snoozed
    // 3+ times (cumulative across unsnooze/re-snooze cycles) the
    // rep is "indecisive-snoozing" — different action needed.
    // Amber warning pill in addition to the normal banner.
    const staleSnooze = (window.LeadSnooze && typeof window.LeadSnooze.isStaleSnooze === 'function')
      ? window.LeadSnooze.isStaleSnooze(lead)
      : false;
    const stalePill = staleSnooze
      ? `<span title="This lead has been snoozed ${lead.snoozeCount}+ times — consider a different action." style="display:inline-flex; align-items:center; gap:3px; margin-left:6px; padding:1px 8px; background:rgba(245,158,11,0.18); color:#fcd34d; border:1px solid rgba(245,158,11,0.45); border-radius:10px; font-size:10px; font-weight:600; letter-spacing:0.02em;">⚠️ Snoozed ${escapeHtml(String(lead.snoozeCount || 0))}×</span>`
      : '';
    const banner = document.createElement('div');
    banner.id = 'nbd-snooze-banner';
    banner.setAttribute('role', 'status');
    banner.style.cssText = `
      position:sticky; top:0; left:0; right:0; z-index:9500;
      background:linear-gradient(135deg, rgba(155,109,255,0.18) 0%, rgba(155,109,255,0.10) 100%);
      border-bottom:1px solid rgba(155,109,255,0.45);
      color:var(--t,#e8eaf0);
      padding:10px 16px;
      display:flex; align-items:center; gap:12px; flex-wrap:wrap;
      font-family:'Barlow',-apple-system,system-ui,sans-serif;
      font-size:13px;
      animation:nbd-snooze-banner-slide .25s ease-out;`;
    banner.innerHTML = `
      <span style="font-size:18px; line-height:1;">💤</span>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; color:#cab8ff; margin-bottom:1px; display:flex; align-items:center; flex-wrap:wrap;">Snoozed lead${reasonPill}${stalePill}</div>
        <div style="font-size:11px; color:var(--m,#9aa3b2);">
          Hidden from the kanban + Hot Leads + Needs Attention until
          <strong style="color:var(--t,#e8eaf0); font-weight:600;">${escapeHtml(label)}</strong>.
        </div>
      </div>
      <button id="nbd-snooze-banner-wake" type="button" style="
        background:linear-gradient(135deg,#9b6dff 0%,#7c3aed 100%);
        color:#fff; border:none; padding:7px 14px; border-radius:6px;
        font: inherit; font-size:12px; font-weight:700;
        cursor:pointer; -webkit-tap-highlight-color:transparent;
        white-space:nowrap;">⏰ Wake up now</button>
      <button id="nbd-snooze-banner-resched" type="button" style="
        background:transparent; color:#cab8ff;
        border:1px solid rgba(155,109,255,0.45);
        padding:6px 12px; border-radius:6px;
        font: inherit; font-size:11px; font-weight:600;
        cursor:pointer; -webkit-tap-highlight-color:transparent;
        white-space:nowrap;">Reschedule</button>
    `;
    if (!document.getElementById('nbd-snooze-banner-style')) {
      const style = document.createElement('style');
      style.id = 'nbd-snooze-banner-style';
      style.textContent = `
        @keyframes nbd-snooze-banner-slide {
          from { transform:translateY(-100%); opacity:0; }
          to   { transform:translateY(0); opacity:1; }
        }
      `;
      document.head.appendChild(style);
    }
    return banner;
  }

  function attachBanner(lead) {
    if (bannerEl) return; // already attached
    const banner = buildBanner(lead);
    // Insert as the very first body child so it sticks above all
    // other page content (auth guards, opacity:0 overlay, etc.).
    document.body.insertBefore(banner, document.body.firstChild);
    bannerEl = banner;

    banner.querySelector('#nbd-snooze-banner-wake').addEventListener('click', async () => {
      const id = lead.id;
      // Visual feedback while the write is in flight — the banner
      // will be torn down via the data-refreshed event after success.
      const btn = banner.querySelector('#nbd-snooze-banner-wake');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Waking…';
        btn.style.opacity = '0.7';
      }
      try {
        await window.LeadSnooze.unsnooze(id);
      } catch (e) {
        console.error('[snooze-banner] unsnooze failed', e);
        if (typeof window.showToast === 'function') {
          window.showToast('Wake failed: ' + (e.message || 'unknown'), 'error');
        }
        if (btn) {
          btn.disabled = false;
          btn.textContent = '⏰ Wake up now';
          btn.style.opacity = '';
        }
      }
    });

    banner.querySelector('#nbd-snooze-banner-resched').addEventListener('click', () => {
      const name = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
      // Open the snooze modal — picking a new date overwrites the
      // existing snoozedUntil field; no need to unsnooze first.
      try { window.LeadSnooze.prompt(lead.id, name); }
      catch (e) { console.warn('[snooze-banner] reschedule failed', e); }
    });
  }

  function removeBanner() {
    if (!bannerEl) return;
    bannerEl.remove();
    bannerEl = null;
  }

  // ─── Render decision ────────────────────────────────────────────
  function update() {
    if (!snoozeAvailable()) {
      removeBanner();
      return;
    }
    const lead = getCurrentLead();
    if (!lead) {
      removeBanner();
      return;
    }
    if (window.LeadSnooze.isSnoozed(lead)) {
      // If the banner already exists for THIS lead with the SAME
      // snoozedUntil we don't need to rebuild — but the simplest
      // correct path is to tear down + rebuild on every refresh
      // signal; the animation's only on attach so successive updates
      // are silent.
      removeBanner();
      attachBanner(lead);
    } else {
      removeBanner();
    }
  }

  // ─── Init ────────────────────────────────────────────────────────
  // Wave 109: track interval handle so we can clear it on
  // pagehide / beforeunload / explicit destroy. Without this, SPA
  // navigation + script re-run would accumulate intervals (the
  // module guard returns early for the second run, so the FIRST
  // module's interval keeps firing forever with a stale closure).
  let _intervalId = null;

  function init() {
    // Defer initial check so loadCustomerData has set _currentLead.
    setTimeout(update, 1500);
    window.addEventListener('nbd:data-refreshed', update);
    // Backstop: poll every 60s so an in-page snooze expiry while
    // the rep is staring at the page auto-removes the banner
    // without needing a data-refresh event.
    if (_intervalId) clearInterval(_intervalId);
    _intervalId = setInterval(update, 60_000);
  }

  function destroy() {
    if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
    window.removeEventListener('nbd:data-refreshed', update);
  }

  // Auto-teardown on page hide so a long-lived browser tab + SPA
  // routes don't leak intervals. pagehide fires reliably across
  // navigations + tab close on every modern browser (where
  // beforeunload sometimes doesn't on mobile).
  window.addEventListener('pagehide', destroy);

  window.CustomerSnoozeBanner = {
    __sentinel: 'nbd-customer-snooze-banner-v1',
    update,
    destroy,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

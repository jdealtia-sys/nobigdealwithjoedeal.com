/**
 * customer-last-shared-chip.js — Wave 52 (Last-shared chip on customer detail header)
 *
 * Wave 44 surfaces a "📤 SMS 3d ago" pill on the kanban card when
 * the rep has shared the portal link with a customer. Customer
 * detail page didn't have the same affordance — reps wondered "did
 * I send the link to this person already?" and had to either
 * remember or check the kanban. Visual inconsistency.
 *
 * This wave mirrors the kanban badge to the customer detail
 * header so both surfaces show the same cue. Same time bucketing,
 * same friendly channel labels, same purple tint.
 *
 * Path-gated to /pro/customer.html. Updates on:
 *   - DOMContentLoaded + 1.5s defer (so loadCustomerData has set
 *     window._currentLead first)
 *   - 'nbd:data-refreshed' event (Wave 14 background revalidate +
 *     W44 _recordShare both fire this)
 *   - 60s polling backstop so relative-time labels tick over
 *     when the page sits open
 */
(function () {
  'use strict';

  if (window.CustomerLastSharedChip
      && window.CustomerLastSharedChip.__sentinel === 'nbd-customer-last-shared-chip-v1') return;

  const PATH = window.location.pathname || '';
  if (!/\/pro\/customer\.html$/.test(PATH)) return;

  // ─── Helpers ─────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function toMillis(v) {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function')   return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? 0 : d.getTime(); }
    return 0;
  }

  // Same time bucketing as the W44 kanban badge for visual parity.
  function timeLabel(ms) {
    const days = Math.floor((Date.now() - ms) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  function viaLabel(via) {
    return ({ copy: 'copied', sms: 'SMS', email: 'email' })[via] || 'shared';
  }

  // ─── Render ──────────────────────────────────────────────────────
  function update() {
    const chip = document.getElementById('lastSharedChip');
    if (!chip) return;
    const lead = window._currentLead;
    if (!lead) {
      chip.style.display = 'none';
      return;
    }
    const ms = toMillis(lead.lastSharedAt);
    if (!ms) {
      chip.style.display = 'none';
      return;
    }
    const via = viaLabel(lead.lastSharedVia);
    const when = timeLabel(ms);
    chip.textContent = `📤 ${via} ${when}`;
    chip.title = `Portal link last shared via ${via} — ${when}`;
    chip.style.display = '';
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    setTimeout(update, 1500);
    window.addEventListener('nbd:data-refreshed', update);
    setInterval(update, 60_000);
  }

  window.CustomerLastSharedChip = {
    __sentinel: 'nbd-customer-last-shared-chip-v1',
    update,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

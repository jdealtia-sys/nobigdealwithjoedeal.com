/**
 * customer-viewed-chip.js — Wave 59 (Viewed chip on customer detail header)
 *
 * Mirrors the W58 kanban "👁 viewed today" pill to the customer
 * detail header so reps see the same customer-engagement cue on
 * both surfaces. Visual symmetry continues:
 *
 *   W44 (kanban) + W52 (customer detail) = share-tracking chips
 *   W58 (kanban) + W59 (customer detail) = view-tracking chips
 *
 * Reads window._estimates the same way W58 does and applies the
 * same skip-conditions: hide when any estimate already responded
 * (signed/declined/replied — past viewing state), lead in
 * terminal stage, no viewed estimates exist.
 *
 * Path-gated to /pro/customer.html. Updates on:
 *   - DOMContentLoaded + 1.5s defer (so caches populate)
 *   - 'nbd:data-refreshed' event (W14 background revalidate)
 *   - 60s polling backstop so relative-time labels tick over
 */
(function () {
  'use strict';

  if (window.CustomerViewedChip
      && window.CustomerViewedChip.__sentinel === 'nbd-customer-viewed-chip-v1') return;

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

  // Same time bucketing as the W58 kanban badge for visual parity.
  function timeLabel(ms) {
    const days = Math.floor((Date.now() - ms) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  // Mirror of the W58 buildViewedBadge logic — keep them in lockstep.
  function computeViewSignal() {
    const lead = window._currentLead;
    if (!lead) return null;
    const sk = (lead._stageKey || lead.stage || 'new').toString();
    if (sk === 'closed' || sk === 'lost' || sk === 'Lost' || sk === 'Complete') return null;

    const estimates = Array.isArray(window._estimates) ? window._estimates : [];
    if (estimates.length === 0) return null;

    let latestViewMs = 0;
    let anyResponded = false;
    for (const e of estimates) {
      if (!e || e.leadId !== lead.id) continue;
      if (e.respondedAt) { anyResponded = true; break; }
      const ms = toMillis(e.viewedAt);
      if (ms > latestViewMs) latestViewMs = ms;
    }
    if (anyResponded || latestViewMs === 0) return null;
    return latestViewMs;
  }

  // ─── Render ──────────────────────────────────────────────────────
  function update() {
    const chip = document.getElementById('viewedChip');
    if (!chip) return;
    const viewedMs = computeViewSignal();
    if (!viewedMs) {
      chip.style.display = 'none';
      return;
    }
    const when = timeLabel(viewedMs);
    chip.textContent = `👁 viewed ${when}`;
    chip.title = `Customer opened the portal — ${when}`;
    chip.style.display = '';
  }

  // ─── Init ────────────────────────────────────────────────────────
  // W109: track interval + auto-teardown on pagehide.
  let _intervalId = null;
  function init() {
    setTimeout(update, 1500);
    window.addEventListener('nbd:data-refreshed', update);
    if (_intervalId) clearInterval(_intervalId);
    _intervalId = setInterval(update, 60_000);
  }
  function destroy() {
    if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
    window.removeEventListener('nbd:data-refreshed', update);
  }
  window.addEventListener('pagehide', destroy);

  window.CustomerViewedChip = {
    __sentinel: 'nbd-customer-viewed-chip-v1',
    update,
    computeViewSignal,
    destroy,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/**
 * stale-shares-widget.js — Wave 55 (Stale shares on dashboard home)
 *
 * Companion to Wave 54's kanban filter. Same data, second surface:
 * the home page widget shows the top 5 oldest stale-share leads
 * with inline 📞/💬/📧 reshare buttons so the rep can clear
 * ghosted shares without leaving the dashboard.
 *
 * Mirrors W45 Almost There exactly so the dashboard home reads as
 * a coherent recovery surface:
 *
 *   W29 Hot Leads      — who do I call FIRST?
 *   W45 Almost There   — who almost said YES?
 *   W55 Stale Shares   — who never opened the link?  ← THIS WAVE
 *   W19 Bottlenecks    — where am I stuck?
 *   W24 Activity feed  — what just happened?
 *
 * Almost There is high-engagement recovery (close-call posture).
 * Stale Shares is no-engagement recovery (re-nudge posture).
 * Together they cover both ends of the customer-engagement
 * spectrum.
 */
(function () {
  'use strict';

  if (window.StaleSharesWidget
      && window.StaleSharesWidget.__sentinel === 'nbd-stale-shares-widget-v1') return;

  const TOP_N = 5;

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

  function leadName(l) {
    if (!l) return '';
    const n = `${l.firstName || ''} ${l.lastName || ''}`.trim();
    return n || l.address || 'Unnamed lead';
  }

  function relativeTime(ms) {
    if (!ms) return '';
    const days = Math.floor((Date.now() - ms) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7)   return `${days}d ago`;
    if (days < 30)  return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  function viaLabel(via) {
    return ({ copy: 'copied', sms: 'SMS', email: 'email' })[via] || 'shared';
  }

  // ─── Compute ─────────────────────────────────────────────────────
  // Reuses the W54 isStaleShare logic from StaleShares.compute() so
  // both surfaces stay in lockstep on the match criteria. Sorted
  // oldest-share first since those are the most urgent to recover.
  function compute() {
    if (!window.StaleShares || typeof window.StaleShares.compute !== 'function') return [];
    const leads = window.StaleShares.compute();
    return [...leads]
      .sort((a, b) => toMillis(a.lastSharedAt) - toMillis(b.lastSharedAt))
      .slice(0, TOP_N);
  }

  // ─── Render ──────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('stale-shares-body');
    if (!container) return;
    const rows = compute();

    if (rows.length === 0) {
      container.innerHTML = `
        <div style="padding:22px 18px; text-align:center; color:var(--m,#9aa3b2); font-size:12px;">
          <div style="font-size:24px; margin-bottom:6px; opacity:0.6;">📤</div>
          <div style="font-weight:600; color:var(--t,#e8eaf0); margin-bottom:3px;">No stale shares.</div>
          <div>Every shared link has either been opened or is fresh.</div>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${rows.map(lead => {
          const name = leadName(lead);
          const sharedMs = toMillis(lead.lastSharedAt);
          const via = viaLabel(lead.lastSharedVia);
          const subParts = [`Shared ${relativeTime(sharedMs)} · ${via}`];
          const phoneDigits = String(lead.phone || '').replace(/\D+/g, '');
          const email = String(lead.email || '').trim();

          // Wave 55: inline reshare buttons, mirrors W46 Almost
          // There + W47 Hot Leads + W48 Bell + W49 Activity feed.
          const buttons = [];
          if (phoneDigits) {
            buttons.push(`
              <a class="ss-action" data-action="call" data-lead-id="${escapeHtml(lead.id)}" href="tel:${escapeHtml(phoneDigits)}"
                title="Call ${escapeHtml(lead.phone)}"
                style="
                  display:flex; align-items:center; justify-content:center;
                  width:30px; height:30px; border-radius:6px;
                  background:rgba(16,185,129,0.14); color:#10b981;
                  text-decoration:none; font-size:14px;
                  -webkit-tap-highlight-color:transparent;
                  transition:transform .12s;">📞</a>`);
            buttons.push(`
              <button class="ss-action" data-action="sms" data-lead-id="${escapeHtml(lead.id)}" type="button"
                title="Text portal link to ${escapeHtml(lead.phone)}"
                style="
                  display:flex; align-items:center; justify-content:center;
                  width:30px; height:30px; border-radius:6px;
                  background:rgba(59,130,246,0.14); color:#3b82f6;
                  border:none; font-size:14px; cursor:pointer;
                  -webkit-tap-highlight-color:transparent;
                  transition:transform .12s;">💬</button>`);
          }
          if (email) {
            buttons.push(`
              <button class="ss-action" data-action="email" data-lead-id="${escapeHtml(lead.id)}" type="button"
                title="Email portal link to ${escapeHtml(email)}"
                style="
                  display:flex; align-items:center; justify-content:center;
                  width:30px; height:30px; border-radius:6px;
                  background:rgba(139,92,246,0.14); color:#8b5cf6;
                  border:none; font-size:14px; cursor:pointer;
                  -webkit-tap-highlight-color:transparent;
                  transition:transform .12s;">📧</button>`);
          }
          // Wave 66: preview action — always available, no contact
          // gate. Mirrors W64/W65 home-widget pattern. Especially
          // valuable on this widget — a stale share means the
          // customer was sent a link but never responded. Before
          // re-nudging, the rep peeks at the portal to verify the
          // link is still valid + see what the customer would have
          // seen 5+ days ago.
          if (window.PortalLinkHelpers
              && typeof window.PortalLinkHelpers.previewForLead === 'function') {
            buttons.push(`
              <button class="ss-action" data-action="preview" data-lead-id="${escapeHtml(lead.id)}" type="button"
                title="Preview the portal — verify the link the customer received"
                style="
                  display:flex; align-items:center; justify-content:center;
                  width:30px; height:30px; border-radius:6px;
                  background:rgba(245,158,11,0.14); color:#f59e0b;
                  border:none; font-size:14px; cursor:pointer;
                  -webkit-tap-highlight-color:transparent;
                  transition:transform .12s;">🔍</button>`);
          }
          // Wave 66: snooze action. StaleShares.compute() (W54)
          // already filters snoozed leads at stale-shares-filter.js
          // line 67, so this widget only shows fresh stale shares
          // — render snooze variant only. After snooze, the lead
          // drops out of compute() on nbd:data-refreshed.
          if (window.LeadSnooze) {
            buttons.push(`
              <button class="ss-action" data-action="snooze" data-lead-id="${escapeHtml(lead.id)}" type="button"
                title="Snooze this lead"
                style="
                  display:flex; align-items:center; justify-content:center;
                  width:30px; height:30px; border-radius:6px;
                  background:rgba(155,109,255,0.10); color:#a890e8;
                  border:none; font-size:14px; cursor:pointer;
                  -webkit-tap-highlight-color:transparent;
                  transition:transform .12s;">💤</button>`);
          }
          const reshareHTML = buttons.length
            ? `<div class="ss-actions" style="display:flex; gap:4px; flex-shrink:0; align-items:center;">${buttons.join('')}</div>`
            : '<div style="flex-shrink:0;"></div>';

          return `
            <div class="ss-row" data-lead-id="${escapeHtml(lead.id)}"
              style="
                display:grid; grid-template-columns:auto 1fr auto;
                gap:10px; align-items:center;
                padding:10px 12px; border-radius:8px;
                background:var(--s2,#0f1419); border:1px solid var(--br,#1e2530);
                cursor:pointer; transition:background .15s;
                -webkit-tap-highlight-color:transparent;"
              title="Sent the portal link ${relativeTime(sharedMs)} — no response yet">
              <div style="
                width:34px; height:34px; flex-shrink:0;
                background:#9b6dff; color:#fff;
                font-size:16px; font-weight:800;
                display:flex; align-items:center; justify-content:center;
                border-radius:8px;
                box-shadow:0 1px 2px rgba(0,0,0,0.15);">
                📤
              </div>
              <div style="min-width:0;">
                <div style="font-size:13px; font-weight:600; color:var(--t,#e8eaf0); margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${escapeHtml(name)}
                  ${lead.customerId ? `<span style="font-family:monospace; font-size:10px; font-weight:600; color:var(--orange,#c8541a); opacity:0.7; margin-left:4px;">${escapeHtml(lead.customerId)}</span>` : ''}
                </div>
                <div style="font-size:11px; color:var(--m,#9aa3b2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${escapeHtml(subParts.join(' · '))}
                </div>
              </div>
              ${reshareHTML}
            </div>`;
        }).join('')}
      </div>
      <div style="margin-top:10px; font-size:11px; color:var(--m,#9aa3b2); text-align:center; line-height:1.5;">
        Customer was sent the portal link 5+ days ago and never responded. Tap the actions to nudge.
      </div>`;

    // Wave 55: action button handlers (mirrors W46/W47/W48/W49).
    // SMS + Email delegate to PortalLinkHelpers (W42); Call uses
    // native tel:. stopPropagation so action click doesn't ALSO
    // navigate to the customer page.
    container.querySelectorAll('.ss-action[data-action]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-lead-id');
        if (!id) return;
        const lead = (Array.isArray(window._leads) ? window._leads : [])
          .find(l => l && l.id === id);
        if (!lead) return;
        if (action === 'sms' && window.PortalLinkHelpers) {
          ev.preventDefault();
          window.PortalLinkHelpers.smsForLead(lead);
        } else if (action === 'email' && window.PortalLinkHelpers) {
          ev.preventDefault();
          window.PortalLinkHelpers.emailForLead(lead);
        } else if (action === 'preview' && window.PortalLinkHelpers) {
          // Wave 66: preview opens W56 iframe modal on top.
          // preventDefault keeps the widget from also navigating
          // to customer.html on the same click.
          ev.preventDefault();
          window.PortalLinkHelpers.previewForLead(lead);
        } else if (action === 'snooze' && window.LeadSnooze) {
          // Wave 66: snooze opens the W35 preset modal. After
          // dismiss, nbd:data-refreshed re-renders the widget and
          // the lead drops out via the StaleShares.compute() filter.
          ev.preventDefault();
          const fullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
          window.LeadSnooze.prompt(lead.id, fullName);
        }
      });
      btn.addEventListener('mouseover', (ev) => {
        ev.stopPropagation();
        btn.style.transform = 'scale(1.06)';
      });
      btn.addEventListener('mouseout', () => {
        btn.style.transform = '';
      });
    });

    // Row click → customer page via Wave 11 handoff.
    container.querySelectorAll('.ss-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-lead-id');
        if (!id) return;
        try {
          if (typeof window._stashLeadForCustomerPage === 'function') {
            window._stashLeadForCustomerPage(id);
          }
        } catch (_) {}
        window.location.href = `/pro/customer.html?id=${encodeURIComponent(id)}`;
      });
      row.addEventListener('mouseover', () => { row.style.background = 'var(--s,#1a1f2a)'; });
      row.addEventListener('mouseout',  () => { row.style.background = 'var(--s2,#0f1419)'; });
    });
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    render();
    window.addEventListener('nbd:data-refreshed', render);
    setInterval(render, 5 * 60_000);
  }

  window.StaleSharesWidget = {
    __sentinel: 'nbd-stale-shares-widget-v1',
    render,
    compute,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1700));
  } else {
    setTimeout(init, 1700);
  }
})();

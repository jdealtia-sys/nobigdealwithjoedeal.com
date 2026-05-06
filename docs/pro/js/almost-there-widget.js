/**
 * almost-there-widget.js — Wave 45 (Engaged-but-uncommitted leads)
 *
 * Companion to Hot Leads (W29). Where Hot Leads answers "who should
 * I call FIRST?" (high-scoring uncontacted prospects), this widget
 * answers "who almost said YES?" — leads where the customer engaged
 * with the project portal / estimate but hasn't committed yet. The
 * highest-intent recoverable signal in the pipeline; a 30-second
 * follow-up call wins more deals here than anywhere else.
 *
 * Dashboard home decision tree now reads:
 *   Where do I start?       → Hot Leads (W29)
 *   Who almost said yes?    → Almost there (W45) ← THIS WAVE
 *   Where am I stuck?       → Bottlenecks (W19)
 *   What needs follow-up?   → Needs Attention filter (W25)
 *   What just happened?     → Bell + Activity feed (W13/W24)
 *
 * Signal: lead has at least one estimate with viewedAt set AND no
 * respondedAt AND status isn't signed/rejected/expired. Snoozed
 * leads excluded (W35 pattern). Sorted by most-recent viewedAt so
 * fresh engagement bubbles to the top.
 */
(function () {
  'use strict';

  if (window.AlmostThere && window.AlmostThere.__sentinel === 'nbd-almost-there-v1') return;

  const TOP_N = 5;
  // Skip estimates viewed >30 days ago — past that window the lead
  // has gone cold and Hot Leads / Needs Attention surface it via
  // other signals.
  const STALE_VIEW_DAYS = 30;
  const TERMINAL_ESTIMATE_STATUSES = new Set(['signed', 'rejected', 'expired']);

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
    const diff = Date.now() - ms;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d === 1) return 'yesterday';
    if (d < 7) return `${d}d ago`;
    const w = Math.floor(d / 7);
    return `${w}w ago`;
  }

  // ─── Compute ─────────────────────────────────────────────────────
  function compute() {
    const leads = Array.isArray(window._leads) ? window._leads : [];
    const estimates = Array.isArray(window._estimates) ? window._estimates : [];
    if (leads.length === 0 || estimates.length === 0) return [];

    const leadById = {};
    for (const l of leads) leadById[l.id] = l;

    const cutoff = Date.now() - STALE_VIEW_DAYS * 86400000;

    // Group eligible estimates by lead, keeping the latest viewedAt
    // per lead and the highest-value estimate they viewed (most
    // useful single number to surface).
    const byLead = new Map();
    for (const e of estimates) {
      if (!e || !e.leadId) continue;
      if (e.respondedAt) continue;
      const status = (e.status || '').toLowerCase();
      if (TERMINAL_ESTIMATE_STATUSES.has(status)) continue;
      const viewed = toMillis(e.viewedAt);
      if (!viewed) continue;
      if (viewed < cutoff) continue;

      const lead = leadById[e.leadId];
      if (!lead) continue;
      if (lead.deleted || lead.isProspect) continue;
      // W35: respect snoozes — rep deferred them by design.
      if (window.LeadSnooze && window.LeadSnooze.isSnoozed(lead)) continue;

      const total = Number(e.total || e.amount || 0);
      const existing = byLead.get(lead.id);
      if (!existing) {
        byLead.set(lead.id, { lead, viewedAt: viewed, total, estCount: 1 });
      } else {
        existing.estCount++;
        if (viewed > existing.viewedAt) existing.viewedAt = viewed;
        if (total > existing.total)     existing.total = total;
      }
    }

    return [...byLead.values()]
      .sort((a, b) => b.viewedAt - a.viewedAt)
      .slice(0, TOP_N);
  }

  // ─── Render ──────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('almost-there-body');
    if (!container) return;
    const rows = compute();

    if (rows.length === 0) {
      container.innerHTML = `
        <div style="padding:22px 18px; text-align:center; color:var(--m,#9aa3b2); font-size:12px;">
          <div style="font-size:24px; margin-bottom:6px; opacity:0.6;">🎯</div>
          <div style="font-weight:600; color:var(--t,#e8eaf0); margin-bottom:3px;">Nothing engaged but uncommitted.</div>
          <div>When a customer views an estimate without responding, they show up here.</div>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${rows.map(({ lead, viewedAt, total, estCount }) => {
          const name = leadName(lead);
          const value = total > 0 ? `$${Number(total).toLocaleString()}` : '';
          // Wave 46: inline reshare buttons. Closes the loop from
          // "spotted the opportunity" → "took action" in one tap
          // without leaving the dashboard. Each button only renders
          // when the lead has the relevant contact info.
          const phoneDigits = String(lead.phone || '').replace(/\D+/g, '');
          const email = String(lead.email || '').trim();
          const reshareButtons = [];
          if (phoneDigits) {
            reshareButtons.push(`
              <a class="at-action" data-action="call" data-lead-id="${escapeHtml(lead.id)}" href="tel:${escapeHtml(phoneDigits)}"
                title="Call ${escapeHtml(lead.phone)}"
                style="
                  display:flex; align-items:center; justify-content:center;
                  width:30px; height:30px; border-radius:6px;
                  background:rgba(16,185,129,0.14); color:#10b981;
                  text-decoration:none; font-size:14px;
                  -webkit-tap-highlight-color:transparent;
                  transition:background .12s, transform .12s;">📞</a>`);
            reshareButtons.push(`
              <button class="at-action" data-action="sms" data-lead-id="${escapeHtml(lead.id)}" type="button"
                title="Text portal link to ${escapeHtml(lead.phone)}"
                style="
                  display:flex; align-items:center; justify-content:center;
                  width:30px; height:30px; border-radius:6px;
                  background:rgba(59,130,246,0.14); color:#3b82f6;
                  border:none; font-size:14px; cursor:pointer;
                  -webkit-tap-highlight-color:transparent;
                  transition:background .12s, transform .12s;">💬</button>`);
          }
          if (email) {
            reshareButtons.push(`
              <button class="at-action" data-action="email" data-lead-id="${escapeHtml(lead.id)}" type="button"
                title="Email portal link to ${escapeHtml(email)}"
                style="
                  display:flex; align-items:center; justify-content:center;
                  width:30px; height:30px; border-radius:6px;
                  background:rgba(139,92,246,0.14); color:#8b5cf6;
                  border:none; font-size:14px; cursor:pointer;
                  -webkit-tap-highlight-color:transparent;
                  transition:background .12s, transform .12s;">📧</button>`);
          }
          // Wave 65: preview action — always available, no contact
          // gate. Mirrors W64 Hot Leads + W63 cmd+K positioning so
          // the rep gets the same "talk / look / set aside" rhythm
          // on every list surface. Especially valuable here: the
          // rep is about to nudge a customer who just viewed an
          // estimate — peek at exactly what they saw before
          // calling.
          if (window.PortalLinkHelpers
              && typeof window.PortalLinkHelpers.previewForLead === 'function') {
            reshareButtons.push(`
              <button class="at-action" data-action="preview" data-lead-id="${escapeHtml(lead.id)}" type="button"
                title="Preview the portal — see what the customer just saw"
                style="
                  display:flex; align-items:center; justify-content:center;
                  width:30px; height:30px; border-radius:6px;
                  background:rgba(245,158,11,0.14); color:#f59e0b;
                  border:none; font-size:14px; cursor:pointer;
                  -webkit-tap-highlight-color:transparent;
                  transition:background .12s, transform .12s;">🔍</button>`);
          }
          // Wave 65: snooze action. Like W64 Hot Leads, this widget
          // already filters out snoozed leads (line 101 above), so
          // we render the 💤 variant only — the lead drops out of
          // the widget on next render after snooze.
          if (window.LeadSnooze) {
            reshareButtons.push(`
              <button class="at-action" data-action="snooze" data-lead-id="${escapeHtml(lead.id)}" type="button"
                title="Snooze this lead"
                style="
                  display:flex; align-items:center; justify-content:center;
                  width:30px; height:30px; border-radius:6px;
                  background:rgba(155,109,255,0.10); color:#a890e8;
                  border:none; font-size:14px; cursor:pointer;
                  -webkit-tap-highlight-color:transparent;
                  transition:background .12s, transform .12s;">💤</button>`);
          }
          const reshareHTML = reshareButtons.length
            ? `<div class="at-actions" style="display:flex; gap:4px; flex-shrink:0; align-items:center;">${reshareButtons.join('')}</div>`
            : '<div style="flex-shrink:0;"></div>';

          return `
            <div class="at-row" data-lead-id="${escapeHtml(lead.id)}"
              style="
                display:grid; grid-template-columns:auto 1fr auto;
                gap:10px; align-items:center;
                padding:10px 12px; border-radius:8px;
                background:var(--s2,#0f1419); border:1px solid var(--br,#1e2530);
                cursor:pointer; transition:background .15s;
                -webkit-tap-highlight-color:transparent;"
              title="Customer viewed ${estCount === 1 ? 'an estimate' : estCount + ' estimates'} — no response yet">
              <div style="
                width:34px; height:34px; flex-shrink:0;
                background:#a855f7; color:#fff;
                font-size:16px; font-weight:800;
                display:flex; align-items:center; justify-content:center;
                border-radius:8px;
                box-shadow:0 1px 2px rgba(0,0,0,0.15);">
                👁
              </div>
              <div style="min-width:0;">
                <div style="font-size:13px; font-weight:600; color:var(--t,#e8eaf0); margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${escapeHtml(name)}
                  ${lead.customerId ? `<span style="font-family:monospace; font-size:10px; font-weight:600; color:var(--orange,#c8541a); opacity:0.7; margin-left:4px;">${escapeHtml(lead.customerId)}</span>` : ''}
                </div>
                <div style="font-size:11px; color:var(--m,#9aa3b2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  Viewed ${escapeHtml(relativeTime(viewedAt))}${value ? ' · ' + value : ''}${estCount > 1 ? ' · ' + estCount + ' estimates' : ''}
                </div>
              </div>
              ${reshareHTML}
            </div>`;
        }).join('')}
      </div>
      <div style="margin-top:10px; font-size:11px; color:var(--m,#9aa3b2); text-align:center; line-height:1.5;">
        Customer viewed an estimate but hasn't responded. Tap the actions on the right for a 30-second follow-up.
      </div>`;

    // Wave 46: inline reshare buttons. Each fires its action then
    // stops propagation so the row click doesn't ALSO navigate to
    // the customer page. Call uses tel:, SMS + email delegate to
    // PortalLinkHelpers (W42) for the prefilled-body flow.
    container.querySelectorAll('.at-action').forEach(btn => {
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
          // Wave 65: preview opens W56 iframe modal on top of
          // dashboard. Don't navigate — peek + dismiss should
          // leave the rep on the dashboard with the widget intact.
          ev.preventDefault();
          window.PortalLinkHelpers.previewForLead(lead);
        } else if (action === 'snooze' && window.LeadSnooze) {
          // Wave 65: snooze opens the W35 preset modal. After the
          // rep picks a date, nbd:data-refreshed re-renders the
          // widget and the lead drops out via the line-101 filter.
          ev.preventDefault();
          const fullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
          window.LeadSnooze.prompt(lead.id, fullName);
        }
        // 'call' is an <a href="tel:..."> — let the default fire so
        // the browser hands off to the phone app naturally.
      });
      btn.addEventListener('mouseover', (ev) => {
        ev.stopPropagation();
        btn.style.transform = 'scale(1.06)';
      });
      btn.addEventListener('mouseout', () => {
        btn.style.transform = '';
      });
    });

    // Click a row (anywhere outside the action buttons) → open the
    // customer page via Wave 11 handoff for instant render.
    container.querySelectorAll('.at-row').forEach(row => {
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

  window.AlmostThere = {
    __sentinel: 'nbd-almost-there-v1',
    render,
    compute,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1700));
  } else {
    setTimeout(init, 1700);
  }
})();

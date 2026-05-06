/**
 * activity-feed.js — Wave 24 (Recent Activity Timeline)
 *
 * A timeline of what's happened across the rep's pipeline in the
 * last few days — leads created, stages moved, estimates sent, tasks
 * completed. Lives on the dashboard home so reps see momentum at a
 * glance the moment they log in.
 *
 * Sources of truth (no new collections — everything is already
 * loaded by other modules):
 *   - window._leads       (createdAt, stageStartedAt, updatedAt)
 *   - window._estimates   (createdAt, sentAt, viewedAt, respondedAt)
 *   - window._taskCache   (per-lead tasks; completedAt for done items)
 *
 * Each event has:
 *   { type, ts, icon, title, sub, leadId? estId? }
 *
 * The list is bounded (top 20 by ts desc) so even with thousands of
 * leads the render stays cheap. Re-renders on init, on every
 * 'nbd:data-refreshed' fire, and every 60s so relative-time labels
 * update.
 *
 * No exposed API beyond debug helpers.
 */
(function () {
  'use strict';

  if (window.ActivityFeed && window.ActivityFeed.__sentinel === 'nbd-activity-feed-v1') return;

  const MAX_EVENTS = 20;

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
    if (v instanceof Date)                return v.getTime();
    if (typeof v === 'number')            return v;
    if (typeof v === 'string')            { const d = new Date(v); return isNaN(d) ? 0 : d.getTime(); }
    return 0;
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
    if (d < 7) return `${d}d ago`;
    const w = Math.floor(d / 7);
    if (w < 5) return `${w}w ago`;
    const mo = Math.floor(d / 30);
    return `${mo}mo ago`;
  }

  function leadName(lead) {
    if (!lead) return 'Unnamed';
    const n = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
    return n || lead.address || 'Unnamed lead';
  }

  function stageDisplay(stage) {
    const map = {
      'new': 'New', 'contacted': 'Contacted', 'inspected': 'Inspected',
      'claim_filed': 'Claim Filed', 'estimate_submitted': 'Estimate Sent',
      'estimate_sent_cash': 'Estimate Sent', 'negotiating': 'Negotiating',
      'contract_signed': 'Contract Signed', 'job_created': 'Job Created',
      'install_in_progress': 'Installing', 'install_complete': 'Install Done',
      'closed': 'Closed Won', 'lost': 'Lost', 'final_payment': 'Final Payment',
    };
    return map[stage] || stage;
  }

  // ─── Event collection ────────────────────────────────────────────
  function collectEvents() {
    const events = [];
    const leads = Array.isArray(window._leads) ? window._leads : [];
    const leadById = {};
    for (const l of leads) leadById[l.id] = l;
    const estimates = Array.isArray(window._estimates) ? window._estimates : [];
    const tasks = window._taskCache || {};

    // Wave 39: snooze-aware. Build a Set of snoozed lead IDs once
    // so the per-event filter calls are O(1). The rule mirrors the
    // notification bell from Wave 35: suppress REP-side events
    // (lead created, stage moved, estimate created/sent, task done)
    // on snoozed leads — those are noise the rep deferred. KEEP
    // CUSTOMER-side events (estimate viewed, estimate responded)
    // because the customer didn't know about the snooze and that
    // signal is still valuable for the rep to see.
    const snoozedLeadIds = new Set();
    if (window.LeadSnooze && typeof window.LeadSnooze.isSnoozed === 'function') {
      for (const l of leads) {
        if (l && window.LeadSnooze.isSnoozed(l)) snoozedLeadIds.add(l.id);
      }
    }
    const isSnoozed = (id) => snoozedLeadIds.has(id);

    // Lead-level events: created + stage moved.
    for (const l of leads) {
      if (!l || l.deleted) continue;
      // Snoozed → skip rep-side lead-level events.
      if (isSnoozed(l.id)) continue;
      const created = toMillis(l.createdAt);
      if (created) {
        events.push({
          type: 'lead-created',
          ts: created,
          icon: '➕',
          title: 'New lead added',
          sub: leadName(l),
          leadId: l.id,
        });
      }
      // A stageStartedAt that's meaningfully later than createdAt
      // means the lead has moved at least once. We don't have full
      // stage history (would need a stageHistory subcollection), so
      // we surface "stage changed to X" as a single event using the
      // current stage. Skips brand-new leads where stageStartedAt ==
      // createdAt (stamped at create time).
      const stageStarted = toMillis(l.stageStartedAt);
      if (stageStarted && created && (stageStarted - created) > 60_000) {
        events.push({
          type: 'stage-moved',
          ts: stageStarted,
          icon: '➡️',
          title: `Moved to ${stageDisplay(l._stageKey || l.stage || 'new')}`,
          sub: leadName(l),
          leadId: l.id,
        });
      }
    }

    // Estimate events: created, sent, viewed, responded.
    for (const e of estimates) {
      if (!e) continue;
      const lead = e.leadId ? leadById[e.leadId] : null;
      const subBase = lead ? leadName(lead) : 'Estimate';
      const total = Number(e.total || e.amount || 0);
      const totalLabel = total > 0 ? ` · $${total.toLocaleString()}` : '';
      // Wave 39: customer-side events (viewed/responded) still fire
      // on snoozed leads because the customer doesn't know the rep
      // snoozed them and the signal is still valuable. Rep-side
      // events (created/sent) are suppressed.
      const leadIsSnoozed = isSnoozed(e.leadId);
      const created = toMillis(e.createdAt);
      if (created && !leadIsSnoozed) {
        events.push({
          type: 'estimate-created',
          ts: created,
          icon: '📄',
          title: 'Estimate created',
          sub: subBase + totalLabel,
          estId: e.id,
          leadId: e.leadId,
        });
      }
      const sent = toMillis(e.sentAt);
      if (sent && sent !== created && !leadIsSnoozed) {
        events.push({
          type: 'estimate-sent',
          ts: sent,
          icon: '📤',
          title: 'Estimate sent',
          sub: subBase + totalLabel,
          estId: e.id,
          leadId: e.leadId,
        });
      }
      const viewed = toMillis(e.viewedAt);
      if (viewed) {
        events.push({
          type: 'estimate-viewed',
          ts: viewed,
          icon: '👁',
          title: 'Estimate viewed by customer',
          sub: subBase + totalLabel,
          estId: e.id,
          leadId: e.leadId,
        });
      }
      const responded = toMillis(e.respondedAt);
      if (responded) {
        const status = (e.status || '').toLowerCase();
        events.push({
          type: 'estimate-responded',
          ts: responded,
          icon: status === 'signed' ? '✅' : status === 'rejected' ? '❌' : '💬',
          title: status === 'signed' ? 'Estimate signed!'
               : status === 'rejected' ? 'Estimate declined'
               : 'Customer responded',
          sub: subBase + totalLabel,
          estId: e.id,
          leadId: e.leadId,
        });
      }
    }

    // Task completed events. Keys of _taskCache are leadIds.
    for (const leadId of Object.keys(tasks)) {
      // Wave 39: task-done is rep-side; suppress on snoozed leads.
      if (isSnoozed(leadId)) continue;
      const list = tasks[leadId] || [];
      const lead = leadById[leadId];
      for (const t of list) {
        if (!t.done) continue;
        const ts = toMillis(t.completedAt) || toMillis(t.updatedAt);
        if (!ts) continue;
        events.push({
          type: 'task-done',
          ts,
          icon: '☑️',
          title: 'Task completed',
          sub: `"${(t.text || 'Task').slice(0, 60)}" · ${leadName(lead)}`,
          leadId,
        });
      }
    }

    // Sort newest first, cap at MAX_EVENTS.
    events.sort((a, b) => b.ts - a.ts);
    return events.slice(0, MAX_EVENTS);
  }

  // ─── Render ──────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('activity-feed-body');
    if (!container) return;
    const events = collectEvents();

    if (events.length === 0) {
      container.innerHTML = `
        <div style="padding:28px 20px; text-align:center; color:var(--m,#9aa3b2); font-size:12px;">
          <div style="font-size:24px; margin-bottom:8px; opacity:0.6;">📜</div>
          Nothing yet. Add a lead or send an estimate — recent activity
          will show up here.
        </div>`;
      return;
    }

    // Wave 49: build a per-event reshare button block. Mirrors the
    // W46/W47/W48 pattern from Almost There + Hot Leads + Bell. An
    // event tied to a lead with phone/email picks up Call/Text/Email
    // affordances inline with the row, so the rep can spot a recent
    // event AND act on it without opening the customer page.
    function _resharBtnsForEvent(ev) {
      if (!ev || !ev.leadId) return '';
      const leads = Array.isArray(window._leads) ? window._leads : [];
      const lead = leads.find(l => l && l.id === ev.leadId);
      if (!lead) return '';
      const phoneDigits = String(lead.phone || '').replace(/\D+/g, '');
      const email = String(lead.email || '').trim();
      const buttons = [];
      if (phoneDigits) {
        buttons.push(`
          <a class="af-action" href="tel:${escapeHtml(phoneDigits)}"
            title="Call ${escapeHtml(lead.phone)}"
            style="
              display:flex; align-items:center; justify-content:center;
              width:26px; height:26px; border-radius:5px;
              background:rgba(16,185,129,0.14); color:#10b981;
              text-decoration:none; font-size:12px;
              -webkit-tap-highlight-color:transparent;
              transition:transform .12s;"
            onclick="event.stopPropagation();"
            onmouseover="this.style.transform='scale(1.08)'"
            onmouseout="this.style.transform=''"
          >📞</a>`);
        buttons.push(`
          <button class="af-action" type="button"
            data-action="sms" data-lead-id="${escapeHtml(lead.id)}"
            title="Text portal link to ${escapeHtml(lead.phone)}"
            style="
              display:flex; align-items:center; justify-content:center;
              width:26px; height:26px; border-radius:5px;
              background:rgba(59,130,246,0.14); color:#3b82f6;
              border:none; font-size:12px; cursor:pointer;
              -webkit-tap-highlight-color:transparent;
              transition:transform .12s;"
            onmouseover="this.style.transform='scale(1.08)'"
            onmouseout="this.style.transform=''"
          >💬</button>`);
      }
      if (email) {
        buttons.push(`
          <button class="af-action" type="button"
            data-action="email" data-lead-id="${escapeHtml(lead.id)}"
            title="Email portal link to ${escapeHtml(email)}"
            style="
              display:flex; align-items:center; justify-content:center;
              width:26px; height:26px; border-radius:5px;
              background:rgba(139,92,246,0.14); color:#8b5cf6;
              border:none; font-size:12px; cursor:pointer;
              -webkit-tap-highlight-color:transparent;
              transition:transform .12s;"
            onmouseover="this.style.transform='scale(1.08)'"
            onmouseout="this.style.transform=''"
          >📧</button>`);
      }
      if (buttons.length === 0) return '';
      return `<div style="display:flex; gap:3px; flex-shrink:0; align-items:center;">${buttons.join('')}</div>`;
    }

    container.innerHTML = events.map(ev => `
      <div class="activity-row" data-lead-id="${escapeHtml(ev.leadId || '')}" data-est-id="${escapeHtml(ev.estId || '')}"
        style="
          display:flex; align-items:center; gap:10px;
          padding:10px 12px; border-bottom:1px solid var(--br,#1e2530);
          cursor:pointer; transition:background .15s;
          -webkit-tap-highlight-color:transparent;">
        <div style="font-size:16px; flex-shrink:0; width:28px; text-align:center;">${ev.icon}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:12px; font-weight:600; color:var(--t,#e8eaf0); margin-bottom:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(ev.title)}
          </div>
          <div style="font-size:11px; color:var(--m,#9aa3b2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(ev.sub)}
          </div>
        </div>
        ${_resharBtnsForEvent(ev)}
        <div style="font-size:10px; color:var(--m,#9aa3b2); flex-shrink:0; white-space:nowrap;">${escapeHtml(relativeTime(ev.ts))}</div>
      </div>
    `).join('');

    // Wave 49: wire the action button click handlers. Sms + email
    // delegate to PortalLinkHelpers (W42) for the prefilled-body
    // flow + W44 lastSharedAt tracking. Call uses tel: directly.
    container.querySelectorAll('.af-action[data-action]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-lead-id');
        if (!id) return;
        const lead = (Array.isArray(window._leads) ? window._leads : [])
          .find(l => l && l.id === id);
        if (!lead) return;
        if (action === 'sms' && window.PortalLinkHelpers) {
          window.PortalLinkHelpers.smsForLead(lead);
        } else if (action === 'email' && window.PortalLinkHelpers) {
          window.PortalLinkHelpers.emailForLead(lead);
        }
      });
    });

    // Click → navigate. Lead events open the customer page (with
    // Wave 11 handoff for instant render); estimate events open the
    // estimate tab with that estimate selected.
    container.querySelectorAll('.activity-row').forEach(row => {
      row.addEventListener('click', () => {
        const leadId = row.getAttribute('data-lead-id');
        const estId  = row.getAttribute('data-est-id');
        if (estId) {
          window.location.href = `/pro/dashboard.html?tab=estimates&est=${encodeURIComponent(estId)}`;
          return;
        }
        if (leadId) {
          // Stash for instant render via the Wave 11 handoff.
          try {
            if (typeof window._stashLeadForCustomerPage === 'function') {
              window._stashLeadForCustomerPage(leadId);
            }
          } catch (e) {}
          window.location.href = `/pro/customer.html?id=${encodeURIComponent(leadId)}`;
        }
      });
      row.addEventListener('mouseover', () => { row.style.background = 'var(--s2,#0f1419)'; });
      row.addEventListener('mouseout',  () => { row.style.background = ''; });
    });
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    render();
    window.addEventListener('nbd:data-refreshed', render);
    // Update every 60s so relative times tick over.
    setInterval(render, 60_000);
  }

  window.ActivityFeed = {
    __sentinel: 'nbd-activity-feed-v1',
    render,
    collectEvents,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1800));
  } else {
    setTimeout(init, 1800);
  }
})();

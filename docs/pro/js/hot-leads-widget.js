/**
 * hot-leads-widget.js — Wave 29 (Hot Leads on dashboard home)
 *
 * The dashboard already had three views of "what's wrong" (bell,
 * Needs Attention filter, bottleneck widget) but no view of "what
 * should I work on FIRST today" — the morning question. This wave
 * surfaces the top 5 highest-scoring leads that haven't been moved
 * past the contact stage and haven't been touched recently. Reps
 * come in, see the list, that's their first hour planned.
 *
 * Composes:
 *   - window.LeadScoring.scoreAll()  for the score (existing module
 *     blends recency + value + damage signals + claim status etc.)
 *   - filter to early-stage leads (new / contacted / inspected) so
 *     "hot" reflects PROSPECTING priority, not deals already in
 *     play
 *   - skips leads with recent activity (estimate sent in last 3d)
 *     so you don't get nagged about leads you just worked
 *
 * Lives on the dashboard home, above the bottleneck widget — the
 * "where do I start" comes before the "where am I stuck."
 *
 * Re-renders on init, on 'nbd:data-refreshed', and every 5 minutes
 * so freshly-touched leads age out of the list automatically.
 */
(function () {
  'use strict';

  if (window.HotLeads && window.HotLeads.__sentinel === 'nbd-hot-leads-v1') return;

  const TOP_N = 5;
  const RECENT_TOUCH_DAYS = 3;
  // Stages that count as "still in prospecting" — these are where a
  // hot lead deserves attention. Past this, the lead is already in
  // an active deal motion and the rep doesn't need a nudge to call.
  const PROSPECTING_STAGES = new Set([
    'new', 'contacted', 'inspected',
  ]);

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

  function leadName(lead) {
    if (!lead) return '';
    const n = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
    return n || lead.address || 'Unnamed lead';
  }

  function stageKey(lead) {
    if (lead._stageKey) return lead._stageKey;
    if (typeof window.normalizeStage === 'function') return window.normalizeStage(lead.stage);
    return lead.stage || 'new';
  }

  // Looks up estimates by leadId in the in-memory cache. Returns the
  // most-recent ts so we can skip leads with recent activity.
  function lastEstimateActivityMs(leadId, estimates) {
    let best = 0;
    for (const e of estimates) {
      if (!e || e.leadId !== leadId) continue;
      const ts = Math.max(
        toMillis(e.sentAt),
        toMillis(e.respondedAt),
        toMillis(e.viewedAt),
        toMillis(e.createdAt)
      );
      if (ts > best) best = ts;
    }
    return best;
  }

  // ─── Scoring + filtering ────────────────────────────────────────
  function compute() {
    if (!window.LeadScoring || typeof window.LeadScoring.scoreAll !== 'function') return [];

    const scored = window.LeadScoring.scoreAll();
    const estimates = Array.isArray(window._estimates) ? window._estimates : [];
    const recentCutoff = Date.now() - RECENT_TOUCH_DAYS * 86_400_000;

    const filtered = scored.filter(({ lead }) => {
      if (!lead || lead.deleted || lead.isProspect) return false;
      const sk = stageKey(lead);
      if (!PROSPECTING_STAGES.has(sk)) return false;
      // Recently touched? Skip.
      const lastEst = lastEstimateActivityMs(lead.id, estimates);
      if (lastEst > recentCutoff) return false;
      // No score, no signal — skip.
      if (typeof lead === 'undefined') return false;
      return true;
    });

    return filtered.slice(0, TOP_N);
  }

  // ─── Render ──────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('hot-leads-body');
    if (!container) return;
    const rows = compute();

    if (rows.length === 0) {
      container.innerHTML = `
        <div style="padding:22px 18px; text-align:center; color:var(--m,#9aa3b2); font-size:12px;">
          <div style="font-size:24px; margin-bottom:6px; opacity:0.6;">🔥</div>
          <div style="font-weight:600; color:var(--t,#e8eaf0); margin-bottom:3px;">All hot leads worked.</div>
          <div>Add new leads or wait for fresh ones to appear.</div>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${rows.map(({ lead, score, grade, color, label }) => {
          const name = leadName(lead);
          const value = lead.jobValue ? `$${Number(lead.jobValue).toLocaleString()}` : '';
          const subParts = [];
          if (lead.address) subParts.push(escapeHtml(lead.address.split(',')[0]));
          if (value) subParts.push(value);
          if (lead.damageType) subParts.push(escapeHtml(lead.damageType));
          const sub = subParts.join(' · ');
          return `
            <div class="hot-lead-row" data-lead-id="${escapeHtml(lead.id)}"
              style="
                display:grid; grid-template-columns:auto 1fr auto;
                gap:12px; align-items:center;
                padding:10px 12px; border-radius:8px;
                background:var(--s2,#0f1419); border:1px solid var(--br,#1e2530);
                cursor:pointer; transition:background .15s;
                -webkit-tap-highlight-color:transparent;"
              title="Score: ${score} · ${escapeHtml(label || '')}">
              <div style="
                width:34px; height:34px; flex-shrink:0;
                background:${color}; color:#fff;
                font-family:'Barlow Condensed',sans-serif; font-weight:800;
                font-size:16px; letter-spacing:0.4px;
                display:flex; align-items:center; justify-content:center;
                border-radius:8px;
                box-shadow:0 1px 2px rgba(0,0,0,0.15);">
                ${escapeHtml(grade || '?')}
              </div>
              <div style="min-width:0;">
                <div style="font-size:13px; font-weight:600; color:var(--t,#e8eaf0); margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${escapeHtml(name)}
                  ${lead.customerId ? `<span style="font-family:monospace; font-size:10px; font-weight:600; color:var(--orange,#c8541a); opacity:0.7; margin-left:4px;">${escapeHtml(lead.customerId)}</span>` : ''}
                </div>
                <div style="font-size:11px; color:var(--m,#9aa3b2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${sub}
                </div>
              </div>
              <div style="font-size:11px; color:var(--m,#9aa3b2); text-align:right; flex-shrink:0;">
                <div style="font-size:18px; font-weight:800; color:${color}; line-height:1;">${score}</div>
                <div style="font-size:9px; text-transform:uppercase; letter-spacing:0.5px;">score</div>
              </div>
            </div>`;
        }).join('')}
      </div>
      <div style="margin-top:10px; font-size:11px; color:var(--m,#9aa3b2); text-align:center; line-height:1.5;">
        Scored on damage, value, recency, claim status. Refreshes every 5 min.
      </div>`;

    // Click → navigate via Wave 11 handoff for instant render.
    container.querySelectorAll('.hot-lead-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-lead-id');
        if (!id) return;
        try {
          if (typeof window._stashLeadForCustomerPage === 'function') {
            window._stashLeadForCustomerPage(id);
          }
        } catch (e) {}
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

  window.HotLeads = {
    __sentinel: 'nbd-hot-leads-v1',
    render,
    compute,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1700));
  } else {
    setTimeout(init, 1700);
  }
})();

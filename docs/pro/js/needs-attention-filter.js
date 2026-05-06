/**
 * needs-attention-filter.js — Wave 25 (Kanban "Needs Attention" filter)
 *
 * Single header button that toggles the kanban to show ONLY leads
 * the rep should act on today. Composes prior waves into one
 * actionable view:
 *   - Wave 13 (notification bell): overdue tasks + stale estimates
 *   - Wave 17 (stage-aging cues):  ≥7 days in stage
 *
 * The kanban already has a renderLeads(leads, filtered) hook from
 * crm.js that respects a precomputed filtered subset and stores it
 * on window._filteredLeads. This module just feeds the right subset
 * in when the button is active.
 *
 * Triggers:
 *   - Click button     → toggle filter
 *   - 'nbd:data-refreshed' → recompute count + re-apply if active
 *   - Periodically every 60s so stale-stage / overdue counts tick
 *
 * The button's badge shows how many leads currently need attention
 * — a number reps can glance at across the day to know if their
 * pipeline is on the rails or going stale.
 *
 * Exposes: window.NeedsAttention.{compute, isActive, toggle, recount}
 *          window.toggleNeedsAttention (for inline onclick)
 */
(function () {
  'use strict';

  if (window.NeedsAttention && window.NeedsAttention.__sentinel === 'nbd-needs-attention-v1') return;

  const STAGE_AGE_DAYS    = 7;     // matches Wave 17 'stale' threshold
  const ESTIMATE_STALE_DAYS = 3;   // matches Wave 13 stale-estimate
  const TERMINAL_STAGES = new Set([
    'closed', 'lost', 'Lost', 'Complete',
    'final_payment', 'deductible_collected',
  ]);

  let active = false;

  // ─── Helpers ─────────────────────────────────────────────────────
  function toMillis(v) {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function')   return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? 0 : d.getTime(); }
    return 0;
  }

  function stageKey(lead) {
    if (lead._stageKey) return lead._stageKey;
    if (typeof window.normalizeStage === 'function') return window.normalizeStage(lead.stage);
    return lead.stage || 'new';
  }

  function daysInStage(lead) {
    const ref = toMillis(lead.stageStartedAt) || toMillis(lead.updatedAt) || toMillis(lead.createdAt);
    if (!ref) return 0;
    return Math.floor((Date.now() - ref) / 86400000);
  }

  // Returns reason string if lead needs attention, else null.
  function needsAttentionReason(lead, taskCache, estimates, now) {
    if (!lead || lead.deleted) return null;
    if (lead.isProspect) return null;
    const sk = stageKey(lead);
    if (TERMINAL_STAGES.has(sk)) return null;
    // Wave 35: respect rep snooze. Snoozed leads don't generate a
    // "needs attention" signal until the snooze expires.
    if (window.LeadSnooze && window.LeadSnooze.isSnoozed(lead)) return null;

    // 1) Stale stage
    if (daysInStage(lead) >= STAGE_AGE_DAYS) return 'stale-stage';

    // 2) Overdue task
    const tasks = (taskCache && taskCache[lead.id]) || [];
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    for (const t of tasks) {
      if (t.done) continue;
      if (!t.dueDate) continue;
      const due = new Date(t.dueDate + 'T23:59:59');
      if (due < startOfToday) return 'overdue-task';
    }

    // 3) Stale estimate (sent ≥3d ago, no respondedAt)
    const cutoff = now - ESTIMATE_STALE_DAYS * 86400000;
    for (const e of estimates) {
      if (!e || e.leadId !== lead.id) continue;
      const status = (e.status || '').toLowerCase();
      if (status === 'signed' || status === 'rejected' || status === 'expired') continue;
      if (e.respondedAt) continue;
      const sent = toMillis(e.sentAt) || toMillis(e.createdAt);
      if (sent && sent < cutoff) return 'stale-estimate';
    }
    return null;
  }

  // ─── Compute the subset ─────────────────────────────────────────
  function compute() {
    const leads = Array.isArray(window._leads) ? window._leads : [];
    const taskCache = window._taskCache || {};
    const estimates = Array.isArray(window._estimates) ? window._estimates : [];
    const now = Date.now();
    return leads.filter(l => needsAttentionReason(l, taskCache, estimates, now) != null);
  }

  function count() {
    return compute().length;
  }

  // ─── Button rendering / state ───────────────────────────────────
  function updateButton() {
    const btn = document.getElementById('needsAttentionBtn');
    const badge = document.getElementById('needsAttentionCountBadge');
    if (!btn || !badge) return;
    const c = count();
    badge.textContent = c;
    badge.style.display = c > 0 ? 'inline-block' : 'none';

    if (active) {
      btn.style.background = 'rgba(239,68,68,0.12)';
      btn.style.borderColor = '#ef4444';
      btn.style.color = '#ef4444';
    } else {
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
    }
  }

  // ─── Apply the filter ────────────────────────────────────────────
  function applyFilter() {
    if (!active) {
      // Restore default rendering (no filter override).
      window._filteredLeads = null;
      window._needsAttentionActive = false;
      if (typeof window.renderLeads === 'function') {
        window.renderLeads(window._leads, null);
      }
      updateButton();
      return;
    }
    const subset = compute();
    window._filteredLeads = subset;
    window._needsAttentionActive = true;
    if (typeof window.renderLeads === 'function') {
      window.renderLeads(window._leads, subset);
    }
    updateButton();

    // Friendly toast on activation if there's nothing to act on.
    if (subset.length === 0 && typeof window.showToast === 'function') {
      window.showToast('Nothing needs attention right now — clean pipeline.', 'success');
    }
  }

  function toggle() {
    active = !active;
    applyFilter();
  }

  function recount() {
    if (active) applyFilter();
    else updateButton();
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    updateButton();
    window.addEventListener('nbd:data-refreshed', recount);
    setInterval(recount, 60_000);
  }

  // Expose API
  window.NeedsAttention = {
    __sentinel: 'nbd-needs-attention-v1',
    compute,
    count,
    isActive: () => active,
    toggle,
    recount,
    needsAttentionReason,
  };
  window.toggleNeedsAttention = toggle;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1500));
  } else {
    setTimeout(init, 1500);
  }
})();

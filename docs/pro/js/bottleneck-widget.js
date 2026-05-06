/**
 * bottleneck-widget.js — Wave 19 (Pipeline Bottleneck Widget)
 *
 * Companion to Wave 17's per-card stage-aging cues. Where the
 * card-level cue tells a rep "THIS lead is stuck", this widget
 * tells them "this STAGE is where deals die" — operational
 * insight that compounds over time and points the rep at where
 * to focus their day.
 *
 * For each non-terminal kanban stage, computes:
 *   - count of leads currently in the stage
 *   - average days-in-stage (using stageStartedAt with fallbacks)
 *   - median days-in-stage (more robust to outliers)
 *
 * Flags the slowest 1-2 stages (avg ≥ 10 days AND ≥ 2 leads) as
 * "bottlenecks" with a red marker so reps see them at a glance.
 * Click a row to jump into the CRM filtered to that stage.
 *
 * Re-renders on init + on the 'nbd:data-refreshed' event fired
 * by loadLeads. Renders to #pipeline-bottleneck-body which the
 * dashboard owns.
 */
(function () {
  'use strict';

  if (window.PipelineBottleneck && window.PipelineBottleneck.__sentinel === 'nbd-bottleneck-v1') return;

  // Stages that we DON'T flag as bottlenecks — terminal or trivial.
  const SKIP_STAGES = new Set([
    'new',                  // brand-new leads belong to the funnel top, not a "bottleneck"
    'closed', 'lost', 'Lost', 'Complete',
    'final_payment', 'deductible_collected',
  ]);

  const BOTTLENECK_AVG_DAYS = 10;   // avg ≥ 10d → eligible for flag
  const BOTTLENECK_MIN_COUNT = 2;   // at least 2 leads to be statistically meaningful
  const MAX_FLAGGED = 2;            // flag at most 2 stages

  // Display labels mirror the kanban / customer-page maps so the
  // widget speaks the same language as the rest of the app.
  const STAGE_LABELS = {
    'new': 'New Lead', 'contacted': 'Contacted', 'inspected': 'Inspected',
    'claim_filed': 'Claim Filed', 'adjuster_meeting_scheduled': 'Adjuster Meeting',
    'adjuster_inspection_done': 'Adjuster Done', 'scope_received': 'Scope Received',
    'estimate_submitted': 'Estimate Sent', 'estimate_sent': 'Estimate Sent',
    'estimate_sent_cash': 'Est. Sent (Cash)', 'supplement_requested': 'Supplement',
    'supplement_approved': 'Supp. Approved', 'contract_signed': 'Contract Signed',
    'negotiating': 'Negotiating', 'prequal_sent': 'Pre-Qual Sent',
    'loan_approved': 'Loan Approved', 'job_created': 'Job Created',
    'permit_pulled': 'Permit', 'materials_ordered': 'Materials Ordered',
    'materials_delivered': 'Materials Here', 'crew_scheduled': 'Crew Scheduled',
    'install_in_progress': 'Installing', 'install_complete': 'Install Done',
    'final_photos': 'Final Photos',
  };

  // ─── Helpers ─────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function toMillis(v) {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? 0 : d.getTime(); }
    return 0;
  }

  function median(arr) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  }

  function average(arr) {
    if (!arr.length) return 0;
    return Math.round(arr.reduce((s, n) => s + n, 0) / arr.length);
  }

  function stageKey(lead) {
    if (lead._stageKey) return lead._stageKey;
    if (typeof window.normalizeStage === 'function') return window.normalizeStage(lead.stage);
    return lead.stage || 'new';
  }

  function daysInStageFor(lead) {
    const ref = toMillis(lead.stageStartedAt) || toMillis(lead.updatedAt) || toMillis(lead.createdAt);
    if (!ref) return null;
    const ms = Date.now() - ref;
    if (ms < 0) return 0;
    return Math.floor(ms / 86400000);
  }

  // ─── Aggregation ─────────────────────────────────────────────────
  function compute(leads) {
    const buckets = new Map(); // stageKey → array of day counts
    leads.forEach(l => {
      if (!l || l.deleted || l.isProspect) return;
      const sk = stageKey(l);
      if (!sk || SKIP_STAGES.has(sk)) return;
      const days = daysInStageFor(l);
      if (days == null) return;
      if (!buckets.has(sk)) buckets.set(sk, []);
      buckets.get(sk).push(days);
    });

    const rows = [];
    for (const [stage, days] of buckets) {
      rows.push({
        stage,
        label: STAGE_LABELS[stage] || stage.replace(/_/g, ' '),
        count: days.length,
        avg: average(days),
        median: median(days),
        max: Math.max(...days),
      });
    }

    // Sort by avg desc — slowest first.
    rows.sort((a, b) => b.avg - a.avg);

    // Mark bottlenecks: top N rows that meet thresholds.
    let flagged = 0;
    for (const row of rows) {
      if (flagged >= MAX_FLAGGED) break;
      if (row.avg >= BOTTLENECK_AVG_DAYS && row.count >= BOTTLENECK_MIN_COUNT) {
        row.isBottleneck = true;
        flagged++;
      }
    }

    return rows;
  }

  // ─── Render ──────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('pipeline-bottleneck-body');
    if (!container) return;
    const leads = Array.isArray(window._leads) ? window._leads : [];
    const rows = compute(leads);

    if (rows.length === 0) {
      container.innerHTML = `
        <div style="padding:24px;text-align:center;color:var(--m,#9aa3b2);font-size:12px;">
          <div style="font-size:24px;margin-bottom:6px;opacity:0.6;">📊</div>
          Add a few leads and move them through stages — bottleneck data
          shows up here once we have something to measure.
        </div>`;
      return;
    }

    // Worst row determines the upper bound for the bar visualization.
    const maxAvg = Math.max(...rows.map(r => r.avg), 1);

    const visibleRows = rows.slice(0, 6);
    const summary = rows.find(r => r.isBottleneck);

    let html = '';
    if (summary) {
      html += `
        <div style="
          padding:10px 14px; border-radius:8px; margin-bottom:12px;
          background:rgba(239,68,68,0.10); border:1px solid rgba(239,68,68,0.30);
          font-size:12px; line-height:1.5;">
          <strong style="color:#dc2626;">Bottleneck spotted:</strong>
          <span style="color:var(--t,#e8eaf0);">
            ${escapeHtml(summary.label)} — ${summary.count} lead${summary.count === 1 ? '' : 's'} averaging
            <strong>${summary.avg} day${summary.avg === 1 ? '' : 's'}</strong> in stage.
          </span>
        </div>`;
    }

    html += '<div style="display:flex;flex-direction:column;gap:6px;">';
    visibleRows.forEach(r => {
      const pct = Math.round((r.avg / maxAvg) * 100);
      const barColor = r.isBottleneck ? '#ef4444'
                     : r.avg >= 7      ? '#f97316'
                     : r.avg >= 3      ? '#fbbf24'
                                       : '#10b981';
      const flagHtml = r.isBottleneck
        ? `<span style="background:rgba(239,68,68,0.18);color:#dc2626;font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:0.4px;border:1px solid rgba(239,68,68,0.45);">Bottleneck</span>`
        : '';
      html += `
        <div class="pb-row" data-stage="${escapeHtml(r.stage)}"
          style="
            display:grid; grid-template-columns:1fr auto auto;
            gap:10px; align-items:center;
            padding:10px 12px; border-radius:8px;
            background:var(--s2,#0f1419); border:1px solid var(--br,#1e2530);
            cursor:pointer; transition:background .15s;
            -webkit-tap-highlight-color:transparent;"
          title="${r.count} leads · avg ${r.avg}d · median ${r.median}d · max ${r.max}d">
          <div style="min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <strong style="font-size:13px;color:var(--t,#e8eaf0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.label)}</strong>
              ${flagHtml}
            </div>
            <div style="height:4px;background:var(--br,#1e2530);border-radius:2px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:${barColor};transition:width .3s;"></div>
            </div>
          </div>
          <div style="font-size:11px;color:var(--m,#9aa3b2);text-align:right;line-height:1.3;">
            <div><strong style="color:var(--t,#e8eaf0);font-size:13px;">${r.avg}d</strong></div>
            <div style="font-size:10px;">avg</div>
          </div>
          <div style="font-size:11px;color:var(--m,#9aa3b2);text-align:right;min-width:30px;">
            ${r.count}
          </div>
        </div>`;
    });
    html += '</div>';

    if (rows.length > visibleRows.length) {
      html += `
        <div style="padding-top:10px;text-align:center;font-size:11px;color:var(--m,#9aa3b2);">
          + ${rows.length - visibleRows.length} more stage${rows.length - visibleRows.length === 1 ? '' : 's'} not shown
        </div>`;
    }

    container.innerHTML = html;

    // Wire row clicks → jump into kanban filtered to that stage.
    container.querySelectorAll('.pb-row').forEach(row => {
      row.addEventListener('click', () => {
        const s = row.getAttribute('data-stage');
        if (typeof window.goTo === 'function') window.goTo('crm');
        setTimeout(() => {
          if (typeof window.filterByStage === 'function' && s) window.filterByStage(s);
        }, 200);
      });
      row.addEventListener('mouseover', () => { row.style.background = 'var(--s,#1a1f2a)'; });
      row.addEventListener('mouseout',  () => { row.style.background = 'var(--s2,#0f1419)'; });
    });
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    render();
    window.addEventListener('nbd:data-refreshed', render);
    // Also re-render every 5 minutes so day-counts tick over without
    // needing a data refresh — important for this widget specifically
    // because the user could leave the dashboard open all day.
    setInterval(render, 5 * 60_000);
  }

  window.PipelineBottleneck = {
    __sentinel: 'nbd-bottleneck-v1',
    render,
    compute,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1500));
  } else {
    setTimeout(init, 1500);
  }
})();

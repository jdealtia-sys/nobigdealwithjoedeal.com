/**
 * NBD Pro — Lead Source ROI Dashboard
 *
 * Reads window._leads, groups by lead.source, and surfaces:
 *   - Total leads / qualified / closed per source
 *   - Pipeline value generated per source
 *   - Closed revenue per source
 *   - Conversion rate (closed / total) per source
 *   - Best / worst source callouts
 *
 * No backend dependency — pure client-side aggregation off the live
 * lead cache. Re-renders on the `leadsChanged` event dispatched by crm.js.
 *
 * IIFE exposed as window.LeadSourceROI.
 */
(function() {
  'use strict';

  // Stage keys we treat as "closed / won". Mirrors the _closedKeys list
  // in crm.js renderLeads. Anything in this set counts toward closed
  // revenue + closed-deal counts.
  const CLOSED_STAGE_KEYS = new Set([
    'contract_signed', 'job_created', 'permit_pulled',
    'materials_ordered', 'materials_delivered', 'crew_scheduled',
    'install_in_progress', 'install_complete', 'final_photos',
    'deductible_collected', 'final_payment', 'closed',
    'Approved', 'In Progress', 'Complete'
  ]);
  const LOST_STAGE_KEYS = new Set(['lost', 'Lost']);

  // Source normalization — d2d-tracker writes "Door-to-Door", but the
  // Add Lead form has "Door Knock". Treat them as the same bucket.
  const SOURCE_ALIASES = {
    'door knock':    'Door-to-Door',
    'door-to-door':  'Door-to-Door',
    'd2d':           'Door-to-Door',
    'storm canvass': 'Storm Canvass',
    'referral':      'Referral',
    'online':        'Online',
    '':              'Unknown',
    'other':         'Other'
  };

  function normalizeSource(raw) {
    const s = String(raw || '').trim().toLowerCase();
    return SOURCE_ALIASES[s] || (raw || 'Unknown');
  }

  function toNum(v) { return parseFloat(v) || 0; }

  // ────────────────────────────────────────────────────────────────────
  // Aggregation
  // ────────────────────────────────────────────────────────────────────
  function computeMetrics(leads) {
    const buckets = {};
    let aggTotal = 0, aggClosed = 0, aggPipe = 0, aggRev = 0, aggLost = 0;

    for (const lead of leads) {
      // Skip prospects — they're pre-qualification leads. ROI math should
      // only count leads the rep has actually touched.
      if (lead.isProspect) continue;
      // Skip soft-deleted records.
      if (lead.deleted) continue;

      const source = normalizeSource(lead.source);
      const stageKey = lead._stageKey || lead.stage || 'new';
      const isClosed = CLOSED_STAGE_KEYS.has(stageKey);
      const isLost   = LOST_STAGE_KEYS.has(stageKey);
      const value    = toNum(lead.jobValue);

      if (!buckets[source]) {
        buckets[source] = {
          source, total: 0, closed: 0, lost: 0,
          pipeValue: 0, closedRev: 0, openCount: 0
        };
      }
      const b = buckets[source];
      b.total++;
      aggTotal++;
      if (isClosed) {
        b.closed++; aggClosed++;
        b.closedRev += value;  aggRev += value;
      } else if (isLost) {
        b.lost++; aggLost++;
      } else {
        b.openCount++;
        b.pipeValue += value;  aggPipe += value;
      }
    }

    // Compute derived metrics + sort by closed revenue desc
    const rows = Object.values(buckets).map(b => ({
      ...b,
      conversionRate: b.total ? Math.round((b.closed / b.total) * 100) : 0,
      avgDealSize:    b.closed ? Math.round(b.closedRev / b.closed) : 0,
    })).sort((a, b) => b.closedRev - a.closedRev);

    return {
      rows,
      totals: {
        total:     aggTotal,
        closed:    aggClosed,
        lost:      aggLost,
        pipeValue: aggPipe,
        closedRev: aggRev,
        conversionRate: aggTotal ? Math.round((aggClosed / aggTotal) * 100) : 0,
      },
      bestByRevenue: rows[0] || null,
      bestByConversion: [...rows].filter(r => r.total >= 3)
                                 .sort((a, b) => b.conversionRate - a.conversionRate)[0] || null
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────
  function fmtMoney(n) {
    if (!n) return '$0';
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1000)      return '$' + Math.round(n / 1000) + 'K';
    return '$' + Math.round(n).toLocaleString();
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function render(targetId) {
    const el = document.getElementById(targetId);
    if (!el) return;
    const leads = window._leads || [];
    const m = computeMetrics(leads);

    if (m.totals.total === 0) {
      el.innerHTML = `
        <div class="lsroi-empty">
          <div class="lsroi-empty-icon">📊</div>
          <div class="lsroi-empty-title">No closed deals yet</div>
          <div class="lsroi-empty-sub">Once you close a few leads, this panel will surface which sources actually generate revenue.</div>
        </div>
      `;
      return;
    }

    const totalsBar = `
      <div class="lsroi-totals">
        <div class="lsroi-tot">
          <div class="lsroi-tot-label">Total Leads</div>
          <div class="lsroi-tot-val">${m.totals.total}</div>
        </div>
        <div class="lsroi-tot">
          <div class="lsroi-tot-label">Closed</div>
          <div class="lsroi-tot-val" style="color:var(--green);">${m.totals.closed}</div>
        </div>
        <div class="lsroi-tot">
          <div class="lsroi-tot-label">Closed Revenue</div>
          <div class="lsroi-tot-val" style="color:var(--green);">${fmtMoney(m.totals.closedRev)}</div>
        </div>
        <div class="lsroi-tot">
          <div class="lsroi-tot-label">Open Pipeline</div>
          <div class="lsroi-tot-val" style="color:var(--orange);">${fmtMoney(m.totals.pipeValue)}</div>
        </div>
        <div class="lsroi-tot">
          <div class="lsroi-tot-label">Conv. Rate</div>
          <div class="lsroi-tot-val">${m.totals.conversionRate}%</div>
        </div>
      </div>
    `;

    const callouts = [];
    if (m.bestByRevenue && m.bestByRevenue.closedRev > 0) {
      callouts.push(`
        <div class="lsroi-callout">
          <span class="lsroi-callout-icon">🏆</span>
          <div>
            <div class="lsroi-callout-label">Top revenue source</div>
            <div class="lsroi-callout-value">${escHtml(m.bestByRevenue.source)} — ${fmtMoney(m.bestByRevenue.closedRev)}</div>
          </div>
        </div>
      `);
    }
    if (m.bestByConversion && m.bestByConversion.source !== m.bestByRevenue?.source) {
      callouts.push(`
        <div class="lsroi-callout">
          <span class="lsroi-callout-icon">🎯</span>
          <div>
            <div class="lsroi-callout-label">Best conversion (3+ leads)</div>
            <div class="lsroi-callout-value">${escHtml(m.bestByConversion.source)} — ${m.bestByConversion.conversionRate}%</div>
          </div>
        </div>
      `);
    }
    const calloutsHtml = callouts.length
      ? `<div class="lsroi-callouts">${callouts.join('')}</div>`
      : '';

    const maxRev = Math.max(...m.rows.map(r => r.closedRev), 1);
    const tableRows = m.rows.map(r => {
      const barPct = Math.round((r.closedRev / maxRev) * 100);
      return `
        <tr>
          <td class="lsroi-source">${escHtml(r.source)}</td>
          <td class="lsroi-num">${r.total}</td>
          <td class="lsroi-num">${r.closed}</td>
          <td class="lsroi-num">${r.lost}</td>
          <td class="lsroi-num lsroi-rate">${r.conversionRate}%</td>
          <td class="lsroi-num">${fmtMoney(r.pipeValue)}</td>
          <td class="lsroi-num lsroi-rev">
            ${fmtMoney(r.closedRev)}
            <div class="lsroi-bar"><div class="lsroi-bar-fill" style="width:${barPct}%;"></div></div>
          </td>
          <td class="lsroi-num">${fmtMoney(r.avgDealSize)}</td>
        </tr>
      `;
    }).join('');

    el.innerHTML = `
      ${totalsBar}
      ${calloutsHtml}
      <div class="lsroi-table-wrap">
        <table class="lsroi-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Leads</th>
              <th>Closed</th>
              <th>Lost</th>
              <th>Conv.</th>
              <th>Open Pipeline</th>
              <th>Closed Rev</th>
              <th>Avg Deal</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;
  }

  // ────────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────────
  const LeadSourceROI = {
    render,
    compute: () => computeMetrics(window._leads || []),
    init(targetId) {
      this._targetId = targetId;
      render(targetId);
      // Live-update on lead changes.
      document.addEventListener('leadsChanged', () => render(targetId));
    }
  };

  window.LeadSourceROI = LeadSourceROI;
})();

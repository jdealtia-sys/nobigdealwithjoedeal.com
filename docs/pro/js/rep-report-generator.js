// ═══════════════════════════════════════════════════════════════
// NBD Pro — Rep Report Generator (Stage 1)
//
// Legendary visual reports for rep coaching + owner meetings.
// Uses ApexCharts for charts, NBDDocViewer for rendering/export,
// Firestore for saving generated reports.
//
// Ships with: Rep Monthly Review template (Tier 3 metrics).
// Future stages add: Territory Deep Dive, Pipeline Health Check,
// Revenue Recap, Customer Journey Report, Claude narrative.
//
// Public API:
//   window.NBDReports.init()                    — called on tab open
//   window.NBDReports.openGenerator()           — shows template picker
//   window.NBDReports.generate(template, opts)  — builds + opens report
//   window.NBDReports.listSavedReports()        — renders My Reports
//   window.NBDReports.openSavedReport(id)       — re-opens a saved report
//
// Metric calculators (pure functions):
//   computeKnocksToDeal(leads, knocks, rangeStart, rangeEnd)
//   computeTimeOfDayHeatmap(knocks, rangeStart, rangeEnd)
//   computeTopCitiesZips(knocks, leads, rangeStart, rangeEnd)
//   computePipelineVelocity(leads, rangeStart, rangeEnd)
//   computeRevenuePerKnock(leads, knocks, rangeStart, rangeEnd)
//   computeEstimateAccuracy(estimates, leads, rangeStart, rangeEnd)
//
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.NBDReports && window.NBDReports.__sentinel === 'nbd-reports-v1') return;

  // ─── State ───────────────────────────────────────────────
  let initialized = false;

  // ─── Helpers ─────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const toDate = (ts) => {
    if (!ts) return null;
    if (ts.toDate) return ts.toDate();
    if (ts instanceof Date) return ts;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  };

  const inRange = (d, start, end) => {
    if (!d) return false;
    const t = d.getTime();
    return t >= start.getTime() && t <= end.getTime();
  };

  const fmtMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const fmtNumber = (n) => (Number(n) || 0).toLocaleString('en-US');
  const fmtPct = (n) => ((Number(n) || 0) * 100).toFixed(1) + '%';
  const fmtDate = (d) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  const WON_STAGES = new Set([
    'closed', 'install_complete', 'final_photos', 'final_payment',
    'deductible_collected', 'Complete', 'install_in_progress', 'contract_signed'
  ]);
  const LOST_STAGES = new Set(['lost', 'Lost']);

  const isWon = (lead) => {
    const s = (lead.stage || lead._stageKey || '').toString();
    return WON_STAGES.has(s) || WON_STAGES.has(s.toLowerCase());
  };
  const isLost = (lead) => {
    const s = (lead.stage || lead._stageKey || '').toString();
    return LOST_STAGES.has(s) || LOST_STAGES.has(s.toLowerCase());
  };

  // ─── Metric calculators (pure functions) ─────────────────

  // Knocks-to-deal ratio — how many doors does it take to close one?
  function computeKnocksToDeal(leads, knocks, rangeStart, rangeEnd) {
    const knocksInRange = knocks.filter(k => inRange(toDate(k.timestamp || k.createdAt), rangeStart, rangeEnd));
    const wonInRange = leads.filter(l =>
      isWon(l) && inRange(toDate(l.updatedAt || l.createdAt), rangeStart, rangeEnd)
    );
    const ratio = wonInRange.length > 0 ? (knocksInRange.length / wonInRange.length) : 0;
    return {
      totalKnocks: knocksInRange.length,
      dealsClosed: wonInRange.length,
      knocksPerDeal: ratio,
      display: wonInRange.length > 0
        ? Math.round(ratio) + ' knocks per deal'
        : knocksInRange.length + ' knocks · 0 deals closed'
    };
  }

  // Time-of-day heatmap — 7-day × 24-hour grid of knock activity
  // Returns a 7×24 matrix suitable for ApexCharts heatmap series.
  function computeTimeOfDayHeatmap(knocks, rangeStart, rangeEnd) {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let total = 0;
    let bestHour = 0, bestDay = 0, bestCount = 0;
    knocks.forEach(k => {
      const d = toDate(k.timestamp || k.createdAt);
      if (!d || !inRange(d, rangeStart, rangeEnd)) return;
      const day = d.getDay();
      const hour = d.getHours();
      grid[day][hour]++;
      total++;
      if (grid[day][hour] > bestCount) {
        bestCount = grid[day][hour];
        bestHour = hour;
        bestDay = day;
      }
    });
    // Convert to ApexCharts series format
    const series = days.map((dayName, i) => ({
      name: dayName,
      data: grid[i].map((count, hour) => ({ x: (hour < 10 ? '0' : '') + hour + ':00', y: count }))
    })).reverse(); // Reverse so Sunday is at top in display
    return {
      series,
      total,
      bestSlot: bestCount > 0
        ? `${days[bestDay]} ${bestHour}:00 (${bestCount} knocks)`
        : 'No data',
      bestDay: days[bestDay],
      bestHour
    };
  }

  // Top cities/zips by conversion — ranks territories by appointments + deals
  function computeTopCitiesZips(knocks, leads, rangeStart, rangeEnd) {
    // Bucket knocks by city from reverse-geocoded field, falling
    // back to parsed address if city isn't populated yet.
    const cityStats = {};
    const parseCity = (address) => {
      if (!address) return 'Unknown';
      // Try to pull "City" from "street, city, state zip" format
      const parts = String(address).split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) return parts[parts.length - 2] || parts[0];
      return parts[0] || 'Unknown';
    };
    knocks.forEach(k => {
      const d = toDate(k.timestamp || k.createdAt);
      if (!d || !inRange(d, rangeStart, rangeEnd)) return;
      const city = k.city || parseCity(k.address);
      if (!cityStats[city]) cityStats[city] = { city, knocks: 0, appts: 0, deals: 0, revenue: 0 };
      cityStats[city].knocks++;
      if (k.disposition === 'appointment' || k.disposition === 'interested') {
        cityStats[city].appts++;
      }
    });
    leads.forEach(l => {
      const d = toDate(l.updatedAt || l.createdAt);
      if (!d || !inRange(d, rangeStart, rangeEnd)) return;
      if (!isWon(l)) return;
      const city = l.city || parseCity(l.address);
      if (!cityStats[city]) cityStats[city] = { city, knocks: 0, appts: 0, deals: 0, revenue: 0 };
      cityStats[city].deals++;
      cityStats[city].revenue += Number(l.jobValue) || 0;
    });
    const sorted = Object.values(cityStats)
      .sort((a, b) => (b.deals * 1000 + b.appts * 10 + b.knocks) - (a.deals * 1000 + a.appts * 10 + a.knocks))
      .slice(0, 10);
    return { topCities: sorted };
  }

  // Pipeline velocity — avg days per stage, bottleneck detection
  function computePipelineVelocity(leads, rangeStart, rangeEnd) {
    const relevant = leads.filter(l =>
      inRange(toDate(l.updatedAt || l.createdAt), rangeStart, rangeEnd)
    );
    const stages = {};
    relevant.forEach(l => {
      const s = (l.stage || l._stageKey || 'unknown').toString();
      if (!stages[s]) stages[s] = { stage: s, count: 0, totalDays: 0 };
      stages[s].count++;
      const created = toDate(l.createdAt);
      const updated = toDate(l.updatedAt);
      if (created && updated) {
        stages[s].totalDays += Math.max(0, (updated - created) / (1000 * 60 * 60 * 24));
      }
    });
    const list = Object.values(stages).map(s => ({
      ...s,
      avgDays: s.count > 0 ? (s.totalDays / s.count) : 0
    }));
    const bottleneck = list.reduce((a, b) => (a && a.avgDays > b.avgDays) ? a : b, null);
    return {
      stages: list,
      bottleneck: bottleneck
        ? bottleneck.stage + ' (avg ' + bottleneck.avgDays.toFixed(1) + ' days)'
        : 'No data'
    };
  }

  // Revenue per knock — closed revenue / total knocks
  function computeRevenuePerKnock(leads, knocks, rangeStart, rangeEnd) {
    const knocksCount = knocks.filter(k =>
      inRange(toDate(k.timestamp || k.createdAt), rangeStart, rangeEnd)
    ).length;
    const revenue = leads
      .filter(l => isWon(l) && inRange(toDate(l.updatedAt || l.createdAt), rangeStart, rangeEnd))
      .reduce((sum, l) => sum + (Number(l.jobValue) || 0), 0);
    return {
      knocks: knocksCount,
      revenue,
      revenuePerKnock: knocksCount > 0 ? (revenue / knocksCount) : 0,
      display: knocksCount > 0
        ? fmtMoney(revenue / knocksCount) + ' per door'
        : 'No knocks yet'
    };
  }

  // Estimate accuracy — estimated vs. actual job value
  function computeEstimateAccuracy(estimates, leads, rangeStart, rangeEnd) {
    let totalEstimated = 0;
    let totalActual = 0;
    let sampleCount = 0;
    estimates.forEach(est => {
      const d = toDate(est.createdAt);
      if (!d || !inRange(d, rangeStart, rangeEnd)) return;
      const lead = leads.find(l => l.id === est.leadId);
      if (!lead || !isWon(lead)) return;
      const estVal = Number(est.grandTotal) || 0;
      const actualVal = Number(lead.jobValue) || 0;
      if (estVal > 0 && actualVal > 0) {
        totalEstimated += estVal;
        totalActual += actualVal;
        sampleCount++;
      }
    });
    const accuracy = totalEstimated > 0 ? (totalActual / totalEstimated) : 0;
    return {
      sampleCount,
      totalEstimated,
      totalActual,
      accuracy,
      display: sampleCount > 0
        ? (accuracy * 100).toFixed(1) + '% of estimate value'
        : 'No closed estimates in range'
    };
  }

  // Core KPIs — revenue, leads, close rate, pipeline value
  function computeCoreKPIs(leads, rangeStart, rangeEnd) {
    const inRangeLeads = leads.filter(l =>
      inRange(toDate(l.createdAt), rangeStart, rangeEnd)
    );
    const updatedInRange = leads.filter(l =>
      inRange(toDate(l.updatedAt || l.createdAt), rangeStart, rangeEnd)
    );
    const won = updatedInRange.filter(isWon);
    const lost = updatedInRange.filter(isLost);
    const active = leads.filter(l => !isWon(l) && !isLost(l));
    const revenue = won.reduce((sum, l) => sum + (Number(l.jobValue) || 0), 0);
    const pipelineValue = active.reduce((sum, l) => sum + (Number(l.jobValue) || 0), 0);
    const total = won.length + lost.length;
    const closeRate = total > 0 ? (won.length / total) : 0;
    return {
      leadsCreated: inRangeLeads.length,
      dealsClosed: won.length,
      dealsLost: lost.length,
      revenue,
      pipelineValue,
      closeRate,
      avgJobValue: won.length > 0 ? (revenue / won.length) : 0
    };
  }

  // ─── UI: Generator (template picker + date range) ────────
  function renderGeneratorUI() {
    const container = document.getElementById('reportGeneratorContainer');
    if (!container) return;

    // Default date range: last 30 days
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fmtInput = (d) => d.toISOString().split('T')[0];

    container.innerHTML = `
      <div class="panel" id="reportGenPanel">
        <div class="panel-hdr">
          <div>
            <div class="panel-label">Generator</div>
            <div class="panel-title">Create a New Report</div>
          </div>
        </div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:1fr;gap:14px;">
            <!-- Template picker -->
            <div>
              <label style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--m);display:block;margin-bottom:8px;">Template</label>
              <div id="reportTemplateGrid" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:10px;">
                ${renderTemplateCard('rep-monthly', 'Rep Monthly Review', '🎯', 'Per-rep coaching deep dive: knocks, deals, revenue, velocity, top cities.', true)}
                ${renderTemplateCard('territory', 'Territory Deep Dive', '🗺️', 'Best cities/zips, where to work. Ships in Stage 2.', false)}
                ${renderTemplateCard('pipeline-health', 'Pipeline Health Check', '📊', 'Stage velocity + bottleneck detection. Ships in Stage 2.', false)}
                ${renderTemplateCard('revenue-recap', 'Revenue Recap', '💰', 'Owner/partner meeting view. Ships in Stage 3.', false)}
                ${renderTemplateCard('customer-journey', 'Customer Journey', '📖', 'Full story of one customer. Ships in Stage 3.', false)}
              </div>
            </div>

            <!-- Date range -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div>
                <label style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--m);display:block;margin-bottom:6px;">Period Start</label>
                <input type="date" id="reportRangeStart" value="${fmtInput(thirtyDaysAgo)}" style="width:100%;background:var(--s2);border:1px solid var(--br);border-radius:6px;padding:10px 12px;color:var(--t);font-family:inherit;font-size:13px;">
              </div>
              <div>
                <label style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--m);display:block;margin-bottom:6px;">Period End</label>
                <input type="date" id="reportRangeEnd" value="${fmtInput(now)}" style="width:100%;background:var(--s2);border:1px solid var(--br);border-radius:6px;padding:10px 12px;color:var(--t);font-family:inherit;font-size:13px;">
              </div>
            </div>

            <!-- Quick range presets -->
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn btn-ghost" onclick="window.NBDReports.setQuickRange('today')" style="font-size:11px;padding:6px 12px;">Today</button>
              <button class="btn btn-ghost" onclick="window.NBDReports.setQuickRange('week')" style="font-size:11px;padding:6px 12px;">Last 7 days</button>
              <button class="btn btn-ghost" onclick="window.NBDReports.setQuickRange('month')" style="font-size:11px;padding:6px 12px;">Last 30 days</button>
              <button class="btn btn-ghost" onclick="window.NBDReports.setQuickRange('quarter')" style="font-size:11px;padding:6px 12px;">Last 90 days</button>
              <button class="btn btn-ghost" onclick="window.NBDReports.setQuickRange('year')" style="font-size:11px;padding:6px 12px;">Last 12 months</button>
              <button class="btn btn-ghost" onclick="window.NBDReports.setQuickRange('all')" style="font-size:11px;padding:6px 12px;">All time</button>
            </div>

            <!-- Generate button -->
            <button class="btn btn-orange" onclick="window.NBDReports.generateSelected()" style="font-size:14px;padding:14px 20px;justify-content:center;">
              📈 Generate Report
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderTemplateCard(id, name, icon, desc, available) {
    return `
      <div class="report-template-card ${available ? 'available' : 'disabled'}" data-template="${esc(id)}"
           style="background:var(--s2);border:2px solid ${available ? 'var(--br)' : 'var(--s3)'};border-radius:8px;padding:14px;cursor:${available ? 'pointer' : 'not-allowed'};opacity:${available ? '1' : '.45'};transition:all .15s;"
           onclick="${available ? `window.NBDReports.selectTemplate('${esc(id)}')` : ''}">
        <div style="font-size:24px;margin-bottom:6px;">${icon}</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;color:var(--t);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">${esc(name)}</div>
        <div style="font-size:11px;color:var(--m);line-height:1.4;">${esc(desc)}</div>
      </div>
    `;
  }

  // Template selection state
  let _selectedTemplate = 'rep-monthly';

  function selectTemplate(id) {
    _selectedTemplate = id;
    document.querySelectorAll('.report-template-card').forEach(c => {
      const isActive = c.dataset.template === id;
      c.style.borderColor = isActive ? '#e8720c' : 'var(--br)';
      c.style.background = isActive ? 'rgba(232,114,12,.06)' : 'var(--s2)';
    });
  }

  function setQuickRange(key) {
    const now = new Date();
    let start;
    switch (key) {
      case 'today':   start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
      case 'week':    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
      case 'month':   start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      case 'quarter': start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break;
      case 'year':    start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break;
      case 'all':     start = new Date(2020, 0, 1); break;
      default:        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    const fmtInput = (d) => d.toISOString().split('T')[0];
    const startEl = document.getElementById('reportRangeStart');
    const endEl = document.getElementById('reportRangeEnd');
    if (startEl) startEl.value = fmtInput(start);
    if (endEl) endEl.value = fmtInput(now);
  }

  async function generateSelected() {
    const startEl = document.getElementById('reportRangeStart');
    const endEl = document.getElementById('reportRangeEnd');
    if (!startEl || !endEl) return;
    const rangeStart = new Date(startEl.value + 'T00:00:00');
    const rangeEnd = new Date(endEl.value + 'T23:59:59');
    if (rangeStart > rangeEnd) {
      if (typeof showToast === 'function') showToast('Start date must be before end date', 'error');
      return;
    }
    await generate(_selectedTemplate, { rangeStart, rangeEnd });
  }

  // ─── Generate + open report ──────────────────────────────
  async function generate(template, opts) {
    opts = opts || {};
    if (template !== 'rep-monthly') {
      if (typeof showToast === 'function') {
        showToast('This template ships in a future stage. Rep Monthly Review is live now.', 'info');
      }
      return;
    }
    const leads = window._leads || [];
    const knocks = window._knocks || [];
    const estimates = window._estimates || [];
    const rangeStart = opts.rangeStart || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rangeEnd = opts.rangeEnd || new Date();

    // Compute all metrics
    const metrics = {
      core: computeCoreKPIs(leads, rangeStart, rangeEnd),
      knocksToDeal: computeKnocksToDeal(leads, knocks, rangeStart, rangeEnd),
      heatmap: computeTimeOfDayHeatmap(knocks, rangeStart, rangeEnd),
      topCities: computeTopCitiesZips(knocks, leads, rangeStart, rangeEnd),
      velocity: computePipelineVelocity(leads, rangeStart, rangeEnd),
      revenuePerKnock: computeRevenuePerKnock(leads, knocks, rangeStart, rangeEnd),
      estimateAccuracy: computeEstimateAccuracy(estimates, leads, rangeStart, rangeEnd)
    };

    // Build report HTML
    const meta = {
      template: 'rep-monthly',
      templateName: 'Rep Monthly Review',
      rangeStart,
      rangeEnd,
      rep: {
        name: window._user?.displayName || window._user?.email || 'Rep',
        email: window._user?.email || '',
        uid: window._user?.uid || ''
      }
    };
    const html = buildRepMonthlyReviewHTML(metrics, meta);

    // Save to Firestore
    const reportId = await saveReport({
      name: 'Rep Monthly Review — ' + fmtDate(rangeStart) + ' to ' + fmtDate(rangeEnd),
      template: 'rep-monthly',
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      html, // stored so re-open is instant
      metrics: JSON.parse(JSON.stringify(metrics)) // deep clone for Firestore
    });

    // Open in NBDDocViewer
    if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
      window.NBDDocViewer.open({
        html,
        title: 'Rep Monthly Review — ' + meta.rep.name,
        filename: 'NBD-Report-Monthly-' + fmtDate(rangeStart).replace(/,/g, '').replace(/\s/g, '') + '.pdf',
        onSave: async () => {
          if (typeof showToast === 'function') {
            showToast('✓ Report saved to My Reports', 'success');
          }
        }
      });
    } else {
      if (typeof showToast === 'function') showToast('Doc viewer not loaded', 'error');
    }

    // Refresh the My Reports list
    await listSavedReports();
    return reportId;
  }

  // ─── Build HTML for Rep Monthly Review template ──────────
  function buildRepMonthlyReviewHTML(metrics, meta) {
    const { core, knocksToDeal, heatmap, topCities, velocity, revenuePerKnock, estimateAccuracy } = metrics;
    const periodLabel = fmtDate(meta.rangeStart) + ' → ' + fmtDate(meta.rangeEnd);
    const repName = esc(meta.rep.name || 'Rep');

    // Top cities list HTML
    const cityRows = (topCities.topCities || []).slice(0, 5).map((c, i) => `
      <div class="city-row">
        <div class="city-rank">${i + 1}</div>
        <div class="city-body">
          <div class="city-name">${esc(c.city)}</div>
          <div class="city-stats">${fmtNumber(c.knocks)} knocks · ${fmtNumber(c.deals)} deals · ${fmtMoney(c.revenue)}</div>
        </div>
      </div>
    `).join('') || '<div class="empty-state">No geographic data yet.</div>';

    // Velocity rows
    const velocityRows = (velocity.stages || []).slice(0, 8).map(s => `
      <div class="velocity-row">
        <div class="velocity-stage">${esc(s.stage)}</div>
        <div class="velocity-bar-wrap">
          <div class="velocity-bar" style="width:${Math.min(100, (s.avgDays / 30) * 100)}%"></div>
        </div>
        <div class="velocity-days">${s.avgDays.toFixed(1)} days</div>
        <div class="velocity-count">${s.count} leads</div>
      </div>
    `).join('') || '<div class="empty-state">No pipeline velocity data yet.</div>';

    // Convert heatmap series to a JSON string for inline script
    const heatmapJSON = JSON.stringify(heatmap.series);

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Rep Monthly Review — ${repName}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/apexcharts@3.54.0/dist/apexcharts.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Barlow', sans-serif;
    color: #111;
    background: #f7f7f5;
    padding: 0;
    line-height: 1.5;
  }
  .report-page {
    max-width: 960px;
    margin: 0 auto;
    background: #fff;
    padding: 0;
  }

  /* ── HEADER ── */
  .report-hdr {
    background: #0a0c0f;
    color: #fff;
    padding: 40px 56px 32px;
    position: relative;
    overflow: hidden;
  }
  .report-hdr::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 6px;
    background: linear-gradient(90deg, #e8720c, #ff9030);
  }
  .report-brand {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .2em;
    color: #e8720c;
    margin-bottom: 10px;
  }
  .report-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 52px;
    font-weight: 800;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: -.01em;
    margin-bottom: 12px;
  }
  .report-subtitle {
    font-size: 14px;
    color: #c7cad1;
    margin-bottom: 6px;
  }
  .report-period {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    color: #e8720c;
    text-transform: uppercase;
    letter-spacing: .15em;
  }

  /* ── HERO NUMBERS ── */
  .hero-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
    background: #111418;
    color: #fff;
  }
  .hero-cell {
    padding: 28px 20px;
    border-right: 1px solid #2a2f35;
    border-bottom: 1px solid #2a2f35;
  }
  .hero-cell:last-child { border-right: none; }
  .hero-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    color: #8b8e96;
    text-transform: uppercase;
    letter-spacing: .15em;
    margin-bottom: 6px;
  }
  .hero-value {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 38px;
    font-weight: 800;
    color: #fff;
    line-height: 1;
    margin-bottom: 4px;
  }
  .hero-value.orange { color: #e8720c; }
  .hero-sub {
    font-size: 11px;
    color: #8b8e96;
  }

  /* ── SECTION ── */
  .section {
    padding: 40px 56px;
    border-bottom: 1px solid #eee;
  }
  .section-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .18em;
    color: #e8720c;
    margin-bottom: 8px;
  }
  .section-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 28px;
    font-weight: 800;
    text-transform: uppercase;
    color: #111;
    margin-bottom: 6px;
    line-height: 1;
  }
  .section-desc {
    font-size: 13px;
    color: #666;
    margin-bottom: 24px;
  }

  /* ── METRIC ROW ── */
  .metric-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
    margin-bottom: 30px;
  }
  .metric-card {
    background: #f7f7f5;
    border-left: 4px solid #e8720c;
    padding: 20px 24px;
  }
  .metric-card-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: #999;
    margin-bottom: 4px;
  }
  .metric-card-value {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 34px;
    font-weight: 800;
    color: #111;
    line-height: 1;
    margin-bottom: 4px;
  }
  .metric-card-sub {
    font-size: 12px;
    color: #666;
  }

  /* ── CITY LIST ── */
  .city-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 0;
    border-bottom: 1px solid #eee;
  }
  .city-row:last-child { border-bottom: none; }
  .city-rank {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 28px;
    font-weight: 800;
    color: #e8720c;
    line-height: 1;
    min-width: 36px;
  }
  .city-body { flex: 1; }
  .city-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: #111;
    text-transform: uppercase;
  }
  .city-stats {
    font-size: 11px;
    color: #666;
    margin-top: 2px;
  }

  /* ── VELOCITY BARS ── */
  .velocity-row {
    display: grid;
    grid-template-columns: 140px 1fr 80px 80px;
    gap: 12px;
    align-items: center;
    padding: 10px 0;
    font-size: 12px;
  }
  .velocity-stage {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    text-transform: uppercase;
    color: #111;
    letter-spacing: .04em;
  }
  .velocity-bar-wrap {
    height: 10px;
    background: #eee;
    border-radius: 5px;
    overflow: hidden;
  }
  .velocity-bar {
    height: 100%;
    background: linear-gradient(90deg, #e8720c, #ff9030);
    border-radius: 5px;
  }
  .velocity-days {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    color: #e8720c;
    text-align: right;
  }
  .velocity-count {
    font-size: 11px;
    color: #999;
    text-align: right;
  }

  /* ── FOOTER ── */
  .report-footer {
    background: #0a0c0f;
    color: #8b8e96;
    padding: 24px 56px;
    display: flex;
    justify-content: space-between;
    font-size: 10px;
  }
  .report-footer-brand {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    letter-spacing: .1em;
    color: #fff;
  }
  .report-footer-brand span { color: #e8720c; }

  .empty-state {
    padding: 20px;
    text-align: center;
    color: #999;
    font-style: italic;
    font-size: 12px;
  }

  /* ── CHART CONTAINER ── */
  .chart-box {
    background: #fafaf9;
    padding: 20px;
    border-radius: 8px;
    border: 1px solid #eee;
    min-height: 300px;
  }

  @media print {
    body { background: #fff; }
    .report-page { max-width: 100%; padding: 0; }
    .section { page-break-inside: avoid; }
    @page { margin: 0.5cm; size: letter; }
  }
</style>
</head>
<body>
  <div class="report-page">
    <!-- HEADER -->
    <div class="report-hdr">
      <div class="report-brand">NBD <span style="color:#fff;">PRO</span> — MONTHLY REVIEW</div>
      <div class="report-title">${repName}</div>
      <div class="report-subtitle">Personal performance review and coaching insights</div>
      <div class="report-period">${esc(periodLabel)}</div>
    </div>

    <!-- HERO NUMBERS -->
    <div class="hero-grid">
      <div class="hero-cell">
        <div class="hero-label">Revenue Closed</div>
        <div class="hero-value orange">${fmtMoney(core.revenue)}</div>
        <div class="hero-sub">${fmtNumber(core.dealsClosed)} deals</div>
      </div>
      <div class="hero-cell">
        <div class="hero-label">Close Rate</div>
        <div class="hero-value">${fmtPct(core.closeRate)}</div>
        <div class="hero-sub">${fmtNumber(core.dealsClosed)}W / ${fmtNumber(core.dealsLost)}L</div>
      </div>
      <div class="hero-cell">
        <div class="hero-label">Pipeline Value</div>
        <div class="hero-value">${fmtMoney(core.pipelineValue)}</div>
        <div class="hero-sub">${fmtNumber(core.leadsCreated)} new leads</div>
      </div>
      <div class="hero-cell">
        <div class="hero-label">Avg Deal Size</div>
        <div class="hero-value">${fmtMoney(core.avgJobValue)}</div>
        <div class="hero-sub">per closed deal</div>
      </div>
    </div>

    <!-- KNOCKS + CONVERSION -->
    <div class="section">
      <div class="section-label">Door-to-Door Performance</div>
      <div class="section-title">Knocks & Conversion</div>
      <div class="section-desc">Your field activity and how efficiently you're converting doors to deals.</div>
      <div class="metric-row">
        <div class="metric-card">
          <div class="metric-card-label">Total Knocks</div>
          <div class="metric-card-value">${fmtNumber(knocksToDeal.totalKnocks)}</div>
          <div class="metric-card-sub">${fmtNumber(knocksToDeal.dealsClosed)} deals closed from this activity</div>
        </div>
        <div class="metric-card">
          <div class="metric-card-label">Knocks per Deal</div>
          <div class="metric-card-value">${knocksToDeal.dealsClosed > 0 ? Math.round(knocksToDeal.knocksPerDeal) : '—'}</div>
          <div class="metric-card-sub">${esc(knocksToDeal.display)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-card-label">Revenue per Knock</div>
          <div class="metric-card-value">${fmtMoney(revenuePerKnock.revenuePerKnock)}</div>
          <div class="metric-card-sub">${esc(revenuePerKnock.display)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-card-label">Estimate Accuracy</div>
          <div class="metric-card-value">${estimateAccuracy.sampleCount > 0 ? ((estimateAccuracy.accuracy * 100).toFixed(0) + '%') : '—'}</div>
          <div class="metric-card-sub">${esc(estimateAccuracy.display)}</div>
        </div>
      </div>
    </div>

    <!-- TIME-OF-DAY HEATMAP -->
    <div class="section">
      <div class="section-label">When You Knock Best</div>
      <div class="section-title">Activity Heatmap</div>
      <div class="section-desc">Hour × day grid showing your knocking pattern. Best slot: <strong>${esc(heatmap.bestSlot)}</strong></div>
      <div class="chart-box" id="heatmap-chart"></div>
    </div>

    <!-- TOP CITIES -->
    <div class="section">
      <div class="section-label">Where You Work Best</div>
      <div class="section-title">Top Territories</div>
      <div class="section-desc">Cities ranked by total performance (deals weight 1000x, appointments 10x, knocks 1x).</div>
      ${cityRows}
    </div>

    <!-- PIPELINE VELOCITY -->
    <div class="section">
      <div class="section-label">How Fast Deals Move</div>
      <div class="section-title">Pipeline Velocity</div>
      <div class="section-desc">Average days a lead spends in each stage. Bottleneck: <strong>${esc(velocity.bottleneck)}</strong></div>
      ${velocityRows}
    </div>

    <!-- FOOTER -->
    <div class="report-footer">
      <div>
        <div class="report-footer-brand">NBD <span>PRO</span></div>
        <div>nobigdealwithjoedeal.com · Generated ${fmtDate(new Date())}</div>
      </div>
      <div style="text-align:right;">
        <div style="color:#fff;font-weight:700;">${repName}</div>
        <div>${esc(meta.rep.email)}</div>
      </div>
    </div>
  </div>

  <script>
    // Render ApexCharts heatmap once the DOM is ready.
    (function () {
      try {
        if (typeof ApexCharts === 'undefined') {
          document.getElementById('heatmap-chart').innerHTML = '<div style="padding:40px;text-align:center;color:#999;">Chart library loading — refresh to see the heatmap.</div>';
          return;
        }
        var series = ${heatmapJSON};
        var options = {
          series: series,
          chart: {
            height: 320,
            type: 'heatmap',
            toolbar: { show: false },
            fontFamily: 'Barlow, sans-serif'
          },
          dataLabels: { enabled: false },
          colors: ['#e8720c'],
          plotOptions: {
            heatmap: {
              shadeIntensity: 0.5,
              radius: 2,
              useFillColorAsStroke: false,
              colorScale: {
                ranges: [
                  { from: 0, to: 0, color: '#f0f0ed', name: 'None' },
                  { from: 1, to: 2, color: '#ffdcc0', name: 'Light' },
                  { from: 3, to: 5, color: '#ff9940', name: 'Active' },
                  { from: 6, to: 1000, color: '#e8720c', name: 'Heavy' }
                ]
              }
            }
          },
          xaxis: {
            type: 'category',
            labels: {
              style: { colors: '#999', fontSize: '10px' },
              rotate: 0
            }
          },
          yaxis: {
            labels: {
              style: { colors: '#666', fontSize: '11px', fontWeight: 600 }
            }
          },
          grid: { borderColor: '#eee' }
        };
        var chart = new ApexCharts(document.getElementById('heatmap-chart'), options);
        chart.render();
      } catch (e) {
        console.error('[Report] heatmap render failed:', e);
        var el = document.getElementById('heatmap-chart');
        if (el) el.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">Heatmap unavailable: ' + e.message + '</div>';
      }
    })();
  <\/script>
</body>
</html>`;
  }

  // ─── Save report to Firestore ────────────────────────────
  async function saveReport(data) {
    if (typeof window._saveReport !== 'function') {
      console.warn('[Reports] _saveReport helper not loaded');
      return null;
    }
    return await window._saveReport(data);
  }

  // ─── My Reports list ─────────────────────────────────────
  async function listSavedReports() {
    const container = document.getElementById('myReportsList');
    if (!container) return;
    if (typeof window._loadReports !== 'function') {
      container.innerHTML = '<div class="empty"><div class="empty-icon">📈</div>Reports store not loaded</div>';
      return;
    }
    const reports = await window._loadReports();
    if (!reports.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">📈</div>No reports saved yet. Click <strong>＋ New Report</strong> above to create your first one.</div>';
      return;
    }
    container.innerHTML = reports.map(r => {
      const created = toDate(r.createdAt);
      const createdStr = created ? fmtDate(created) : '—';
      return `
        <div class="est-card nbd-saved-report" data-id="${esc(r.id)}" style="margin-bottom:8px;cursor:pointer;padding:14px 16px;">
          <div style="font-size:22px;">📈</div>
          <div style="flex:1;min-width:0;">
            <div class="est-addr" style="font-size:13px;">${esc(r.name || 'Untitled report')}</div>
            <div class="est-meta" style="font-size:11px;color:var(--m);margin-top:2px;">
              ${esc(r.template || 'report')} · Generated ${esc(createdStr)}
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost" style="font-size:10px;padding:5px 10px;" onclick="event.stopPropagation();window.NBDReports.openSavedReport('${esc(r.id)}')">Open</button>
            <button class="btn btn-ghost" style="font-size:10px;padding:5px 10px;color:var(--red);" onclick="event.stopPropagation();window.NBDReports.deleteSavedReport('${esc(r.id)}')">🗑</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function openSavedReport(id) {
    const reports = window._reports || [];
    const r = reports.find(x => x.id === id);
    if (!r) {
      if (typeof showToast === 'function') showToast('Report not found', 'error');
      return;
    }
    if (!window.NBDDocViewer || typeof window.NBDDocViewer.open !== 'function') {
      if (typeof showToast === 'function') showToast('Doc viewer not loaded', 'error');
      return;
    }
    window.NBDDocViewer.open({
      html: r.html || '<html><body><p>Report HTML not stored.</p></body></html>',
      title: r.name || 'Saved Report',
      filename: 'NBD-' + (r.name || 'Report').replace(/[^A-Za-z0-9]+/g, '-') + '.pdf'
    });
  }

  async function deleteSavedReport(id) {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this report? This cannot be undone.')) return;
    if (typeof window._deleteReport !== 'function') return;
    const ok = await window._deleteReport(id);
    if (ok) {
      if (typeof showToast === 'function') showToast('✓ Report deleted', 'success');
      await listSavedReports();
    }
  }

  // ─── Init ────────────────────────────────────────────────
  async function init() {
    renderGeneratorUI();
    if (!initialized) {
      // Select first template by default
      setTimeout(() => selectTemplate('rep-monthly'), 50);
      initialized = true;
    }
    await listSavedReports();
  }

  function openGenerator() {
    // Scroll the generator into view if already initialized
    const panel = document.getElementById('reportGenPanel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    init();
  }

  // ─── Public API ──────────────────────────────────────────
  window.NBDReports = {
    __sentinel: 'nbd-reports-v1',
    init,
    openGenerator,
    selectTemplate,
    setQuickRange,
    generateSelected,
    generate,
    listSavedReports,
    openSavedReport,
    deleteSavedReport,
    // Expose calculators for future templates
    calculators: {
      computeCoreKPIs,
      computeKnocksToDeal,
      computeTimeOfDayHeatmap,
      computeTopCitiesZips,
      computePipelineVelocity,
      computeRevenuePerKnock,
      computeEstimateAccuracy
    }
  };

  console.log('[NBDReports] Stage 1 ready. Open Reports tab to generate.');
})();

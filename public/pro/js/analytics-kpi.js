/**
 * NBD Pro — Dashboard KPI Analytics Engine
 * Computes real-time business metrics from Firestore data and renders
 * a KPI row at the top of the Home dashboard view.
 *
 * Exposes: window.renderKPIRow()
 */

(function() {
  'use strict';

  // Terminal stages that count as "won"
  const WON_STAGES = ['closed','install_complete','final_photos','final_payment','deductible_collected','Complete'];
  const LOST_STAGES = ['lost','Lost'];
  const ACTIVE_STAGES_EXCLUDE = [...WON_STAGES, ...LOST_STAGES];

  function computeKPIs() {
    const leads = window._leads || [];
    const estimates = window._estimates || [];
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const today = new Date(); today.setHours(0,0,0,0);

    // ── PIPELINE VALUE ──
    const activeLeads = leads.filter(l => {
      const sk = l._stageKey || l.stage || 'new';
      return !ACTIVE_STAGES_EXCLUDE.includes(sk) && !l.deleted;
    });
    const pipelineValue = activeLeads.reduce((sum, l) => sum + (parseFloat(l.jobValue) || 0), 0);

    // ── MONTHLY REVENUE (closed this month) ──
    const closedThisMonth = leads.filter(l => {
      const sk = l._stageKey || l.stage || '';
      if (!WON_STAGES.includes(sk)) return false;
      const d = l.updatedAt?.toDate ? l.updatedAt.toDate() : (l.updatedAt?.seconds ? new Date(l.updatedAt.seconds * 1000) : null);
      return d && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    const monthlyRevenue = closedThisMonth.reduce((sum, l) => sum + (parseFloat(l.jobValue) || 0), 0);

    // ── CLOSE RATE ──
    const totalClosed = leads.filter(l => WON_STAGES.includes(l._stageKey || l.stage || '')).length;
    const totalLost = leads.filter(l => LOST_STAGES.includes(l._stageKey || l.stage || '')).length;
    const totalDecided = totalClosed + totalLost;
    const closeRate = totalDecided > 0 ? Math.round((totalClosed / totalDecided) * 100) : 0;

    // ── LEADS THIS MONTH ──
    const leadsThisMonth = leads.filter(l => {
      const d = l.createdAt?.toDate ? l.createdAt.toDate() : (l.createdAt?.seconds ? new Date(l.createdAt.seconds * 1000) : null);
      return d && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    }).length;

    // ── OVERDUE FOLLOW-UPS ──
    const overdueFollowUps = leads.filter(l => {
      const sk = l._stageKey || l.stage || '';
      if (ACTIVE_STAGES_EXCLUDE.includes(sk) || !l.followUp) return false;
      const d = new Date(l.followUp); d.setHours(0,0,0,0);
      return d < today;
    }).length;

    // ── AVG DEAL SIZE ──
    const closedWithValue = leads.filter(l => WON_STAGES.includes(l._stageKey || l.stage || '') && parseFloat(l.jobValue) > 0);
    const avgDealSize = closedWithValue.length > 0 ? closedWithValue.reduce((s, l) => s + parseFloat(l.jobValue), 0) / closedWithValue.length : 0;

    // ── SOURCE BREAKDOWN ──
    const sourceMap = {};
    leads.filter(l => !l.deleted).forEach(l => {
      const src = l.source || 'Unknown';
      sourceMap[src] = (sourceMap[src] || 0) + 1;
    });
    const topSource = Object.entries(sourceMap).sort((a, b) => b[1] - a[1])[0];

    return {
      pipelineValue,
      monthlyRevenue,
      closeRate,
      leadsThisMonth,
      overdueFollowUps,
      avgDealSize,
      activeLeadCount: activeLeads.length,
      closedThisMonthCount: closedThisMonth.length,
      topSource: topSource ? topSource[0] : 'N/A',
      topSourceCount: topSource ? topSource[1] : 0
    };
  }

  function renderKPIRow() {
    const container = document.getElementById('kpiRow');
    if (!container) return;

    const k = computeKPIs();

    container.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card kpi-primary">
          <div class="kpi-icon">💰</div>
          <div class="kpi-data">
            <div class="kpi-value">$${formatNum(k.pipelineValue)}</div>
            <div class="kpi-label">Active Pipeline</div>
            <div class="kpi-sub">${k.activeLeadCount} active leads</div>
          </div>
        </div>
        <div class="kpi-card kpi-green">
          <div class="kpi-icon">📈</div>
          <div class="kpi-data">
            <div class="kpi-value">$${formatNum(k.monthlyRevenue)}</div>
            <div class="kpi-label">Revenue This Month</div>
            <div class="kpi-sub">${k.closedThisMonthCount} closed</div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">🎯</div>
          <div class="kpi-data">
            <div class="kpi-value">${k.closeRate}%</div>
            <div class="kpi-label">Close Rate</div>
            <div class="kpi-sub">Avg deal $${formatNum(k.avgDealSize)}</div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">🆕</div>
          <div class="kpi-data">
            <div class="kpi-value">${k.leadsThisMonth}</div>
            <div class="kpi-label">New Leads</div>
            <div class="kpi-sub">Top: ${k.topSource}</div>
          </div>
        </div>
        ${k.overdueFollowUps > 0 ? `
        <div class="kpi-card kpi-warning" onclick="scrollToFollowUps();" style="cursor:pointer;">
          <div class="kpi-icon">⚠️</div>
          <div class="kpi-data">
            <div class="kpi-value">${k.overdueFollowUps}</div>
            <div class="kpi-label">Overdue Follow-Ups</div>
            <div class="kpi-sub">Click to view</div>
          </div>
        </div>` : ''}
      </div>
    `;
  }

  function formatNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
    return Math.round(n).toLocaleString();
  }

  window.renderKPIRow = renderKPIRow;
  window.computeKPIs = computeKPIs;

})();

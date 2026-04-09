/**
 * NBD Pro — Profit Margin Tracker
 * Adds cost tracking per job (material cost, labor cost, overhead)
 * and computes margins across the pipeline. Extends KPI dashboard with
 * margin analytics, per-job P&L breakdown, and profitability trends.
 *
 * Exposes: window.ProfitTracker
 */

(function() {
  'use strict';

  // Default overhead % applied to all jobs (configurable)
  const DEFAULT_OVERHEAD_PCT = 10;

  // ═════════════════════════════════════════════════════════════
  // COST DATA MANAGEMENT
  // ═════════════════════════════════════════════════════════════

  /**
   * Save cost data for a lead/job
   * Fields: materialCost, laborCost, overheadPct, miscCosts, costNotes
   */
  async function saveJobCosts(leadId, costs) {
    if (!window.db || !window._user || !leadId) return false;
    try {
      const data = {
        materialCost: parseFloat(costs.materialCost) || 0,
        laborCost: parseFloat(costs.laborCost) || 0,
        overheadPct: parseFloat(costs.overheadPct) || DEFAULT_OVERHEAD_PCT,
        miscCosts: parseFloat(costs.miscCosts) || 0,
        costNotes: (costs.costNotes || '').trim()
      };

      await window.updateDoc(window.doc(window.db, 'leads', leadId), data);

      // Update local lead object
      const lead = (window._leads || []).find(l => l.id === leadId);
      if (lead) Object.assign(lead, data);

      if (typeof showToast === 'function') showToast('Job costs saved', 'ok');
      return true;
    } catch(e) {
      console.error('Save job costs failed:', e);
      if (typeof showToast === 'function') showToast('Failed to save costs', 'error');
      return false;
    }
  }

  /**
   * Compute P&L for a single lead
   */
  function computeJobPL(lead) {
    const revenue = parseFloat(lead.jobValue) || 0;
    const materialCost = parseFloat(lead.materialCost) || 0;
    const laborCost = parseFloat(lead.laborCost) || 0;
    const overheadPct = parseFloat(lead.overheadPct) || DEFAULT_OVERHEAD_PCT;
    const miscCosts = parseFloat(lead.miscCosts) || 0;

    const overhead = revenue * (overheadPct / 100);
    const totalCost = materialCost + laborCost + overhead + miscCosts;
    const grossProfit = revenue - materialCost - laborCost - miscCosts;
    const netProfit = revenue - totalCost;
    const grossMargin = revenue > 0 ? Math.round((grossProfit / revenue) * 100) : 0;
    const netMargin = revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0;

    return {
      revenue,
      materialCost,
      laborCost,
      overhead,
      miscCosts,
      totalCost,
      grossProfit,
      netProfit,
      grossMargin,
      netMargin
    };
  }

  /**
   * Compute aggregate margin analytics across all won jobs
   */
  function computeMarginAnalytics() {
    const leads = window._leads || [];
    const WON = ['closed','install_complete','final_photos','final_payment','deductible_collected','Complete'];

    const wonJobs = leads.filter(l => WON.includes(l._stageKey || l.stage || '') && !l.deleted);
    const jobsWithCosts = wonJobs.filter(l => (parseFloat(l.materialCost) || 0) > 0 || (parseFloat(l.laborCost) || 0) > 0);

    if (jobsWithCosts.length === 0) {
      return {
        avgGrossMargin: 0,
        avgNetMargin: 0,
        totalRevenue: wonJobs.reduce((s, l) => s + (parseFloat(l.jobValue) || 0), 0),
        totalCost: 0,
        totalProfit: 0,
        jobsTracked: 0,
        totalJobs: wonJobs.length,
        topMarginJob: null,
        worstMarginJob: null,
        materialPct: 0,
        laborPct: 0
      };
    }

    let totalRevenue = 0, totalMaterial = 0, totalLabor = 0, totalMisc = 0, totalOverhead = 0;
    const pls = [];

    jobsWithCosts.forEach(l => {
      const pl = computeJobPL(l);
      pls.push({ lead: l, pl });
      totalRevenue += pl.revenue;
      totalMaterial += pl.materialCost;
      totalLabor += pl.laborCost;
      totalMisc += pl.miscCosts;
      totalOverhead += pl.overhead;
    });

    const totalCost = totalMaterial + totalLabor + totalMisc + totalOverhead;
    const totalProfit = totalRevenue - totalCost;
    const avgGrossMargin = pls.length > 0
      ? Math.round(pls.reduce((s, p) => s + p.pl.grossMargin, 0) / pls.length)
      : 0;
    const avgNetMargin = pls.length > 0
      ? Math.round(pls.reduce((s, p) => s + p.pl.netMargin, 0) / pls.length)
      : 0;

    pls.sort((a, b) => b.pl.grossMargin - a.pl.grossMargin);
    const topMarginJob = pls[0] || null;
    const worstMarginJob = pls[pls.length - 1] || null;

    return {
      avgGrossMargin,
      avgNetMargin,
      totalRevenue,
      totalCost,
      totalProfit,
      jobsTracked: jobsWithCosts.length,
      totalJobs: wonJobs.length,
      topMarginJob: topMarginJob ? {
        name: ((topMarginJob.lead.firstName || '') + ' ' + (topMarginJob.lead.lastName || '')).trim(),
        margin: topMarginJob.pl.grossMargin
      } : null,
      worstMarginJob: worstMarginJob ? {
        name: ((worstMarginJob.lead.firstName || '') + ' ' + (worstMarginJob.lead.lastName || '')).trim(),
        margin: worstMarginJob.pl.grossMargin
      } : null,
      materialPct: totalRevenue > 0 ? Math.round((totalMaterial / totalRevenue) * 100) : 0,
      laborPct: totalRevenue > 0 ? Math.round((totalLabor / totalRevenue) * 100) : 0
    };
  }

  // ═════════════════════════════════════════════════════════════
  // UI: Cost Entry Panel (injected into lead detail/modal)
  // ═════════════════════════════════════════════════════════════

  /**
   * Render cost entry fields — call from customer detail or lead modal
   * @param {string} containerId - DOM element ID to inject into
   * @param {string} leadId
   */
  function renderCostPanel(containerId, leadId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const lead = (window._leads || []).find(l => l.id === leadId);
    if (!lead) return;

    const pl = computeJobPL(lead);
    const marginColor = pl.grossMargin >= 40 ? '#16a34a' : pl.grossMargin >= 25 ? '#eab308' : '#dc2626';

    el.innerHTML = `
      <div style="background:var(--s,#1a1a2e);border:1px solid var(--br,rgba(255,255,255,.08));border-radius:12px;padding:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <h4 style="margin:0;font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:var(--h,#fff);">💲 Job Costs & Profit</h4>
          ${pl.revenue > 0 ? `<span style="background:${marginColor}22;color:${marginColor};padding:4px 12px;border-radius:20px;font-size:13px;font-weight:700;">${pl.grossMargin}% margin</span>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div>
            <label style="font-size:11px;color:var(--m,#9ca3af);text-transform:uppercase;letter-spacing:.05em;">Material Cost</label>
            <input id="ptMaterial" type="number" step="0.01" value="${lead.materialCost || ''}"
              style="width:100%;padding:10px;background:var(--s2,rgba(255,255,255,.04));border:1px solid var(--br,rgba(255,255,255,.1));border-radius:8px;color:var(--h,#fff);font-size:14px;margin-top:4px;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:11px;color:var(--m,#9ca3af);text-transform:uppercase;letter-spacing:.05em;">Labor Cost</label>
            <input id="ptLabor" type="number" step="0.01" value="${lead.laborCost || ''}"
              style="width:100%;padding:10px;background:var(--s2,rgba(255,255,255,.04));border:1px solid var(--br,rgba(255,255,255,.1));border-radius:8px;color:var(--h,#fff);font-size:14px;margin-top:4px;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:11px;color:var(--m,#9ca3af);text-transform:uppercase;letter-spacing:.05em;">Misc / Other</label>
            <input id="ptMisc" type="number" step="0.01" value="${lead.miscCosts || ''}"
              style="width:100%;padding:10px;background:var(--s2,rgba(255,255,255,.04));border:1px solid var(--br,rgba(255,255,255,.1));border-radius:8px;color:var(--h,#fff);font-size:14px;margin-top:4px;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:11px;color:var(--m,#9ca3af);text-transform:uppercase;letter-spacing:.05em;">Overhead %</label>
            <input id="ptOverhead" type="number" step="1" value="${lead.overheadPct || DEFAULT_OVERHEAD_PCT}"
              style="width:100%;padding:10px;background:var(--s2,rgba(255,255,255,.04));border:1px solid var(--br,rgba(255,255,255,.1));border-radius:8px;color:var(--h,#fff);font-size:14px;margin-top:4px;box-sizing:border-box;">
          </div>
        </div>
        <div style="margin-bottom:16px;">
          <label style="font-size:11px;color:var(--m,#9ca3af);text-transform:uppercase;letter-spacing:.05em;">Cost Notes</label>
          <textarea id="ptNotes" rows="2" style="width:100%;padding:10px;background:var(--s2,rgba(255,255,255,.04));border:1px solid var(--br,rgba(255,255,255,.1));border-radius:8px;color:var(--h,#fff);font-size:13px;margin-top:4px;resize:vertical;box-sizing:border-box;">${lead.costNotes || ''}</textarea>
        </div>

        ${pl.revenue > 0 ? `
        <div style="background:var(--s2,rgba(255,255,255,.03));border-radius:8px;padding:14px;margin-bottom:16px;">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;text-align:center;">
            <div>
              <div style="font-size:18px;font-weight:800;color:#16a34a;">$${formatPT(pl.grossProfit)}</div>
              <div style="font-size:10px;color:var(--m,#9ca3af);">GROSS PROFIT</div>
            </div>
            <div>
              <div style="font-size:18px;font-weight:800;color:${marginColor};">${pl.grossMargin}%</div>
              <div style="font-size:10px;color:var(--m,#9ca3af);">GROSS MARGIN</div>
            </div>
            <div>
              <div style="font-size:18px;font-weight:800;color:#C8541A;">$${formatPT(pl.totalCost)}</div>
              <div style="font-size:10px;color:var(--m,#9ca3af);">TOTAL COST</div>
            </div>
          </div>
        </div>` : '<div style="color:var(--m,#9ca3af);font-size:12px;text-align:center;padding:12px;">Set a Job Value on this lead to see margin calculations</div>'}

        <button onclick="window.ProfitTracker.save('${leadId}')"
          style="width:100%;padding:10px;background:#C8541A;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">
          Save Costs
        </button>
      </div>
    `;
  }

  /**
   * Save from the rendered cost panel
   */
  function saveFromPanel(leadId) {
    saveJobCosts(leadId, {
      materialCost: document.getElementById('ptMaterial')?.value,
      laborCost: document.getElementById('ptLabor')?.value,
      miscCosts: document.getElementById('ptMisc')?.value,
      overheadPct: document.getElementById('ptOverhead')?.value,
      costNotes: document.getElementById('ptNotes')?.value
    }).then(ok => {
      if (ok) {
        // Re-render KPI row to reflect updated margins
        if (typeof window.renderKPIRow === 'function') window.renderKPIRow();
      }
    });
  }

  // ═════════════════════════════════════════════════════════════
  // KPI EXTENSION: Margin card added to KPI row
  // ═════════════════════════════════════════════════════════════

  /**
   * Returns HTML for a margin KPI card — call after renderKPIRow
   */
  function getMarginKPICard() {
    const m = computeMarginAnalytics();
    if (m.jobsTracked === 0) return '';

    const marginColor = m.avgGrossMargin >= 40 ? '#16a34a' : m.avgGrossMargin >= 25 ? '#eab308' : '#dc2626';

    return `
      <div class="kpi-card" style="border-left:3px solid ${marginColor};">
        <div class="kpi-icon">💲</div>
        <div class="kpi-data">
          <div class="kpi-value" style="color:${marginColor};">${m.avgGrossMargin}%</div>
          <div class="kpi-label">Avg Margin</div>
          <div class="kpi-sub">${m.jobsTracked} jobs tracked · $${formatPT(m.totalProfit)} profit</div>
        </div>
      </div>
    `;
  }

  function formatPT(n) {
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1) + 'K';
    return Math.round(n).toLocaleString();
  }

  window.ProfitTracker = {
    save: saveFromPanel,
    saveJobCosts,
    computeJobPL,
    computeMarginAnalytics,
    renderCostPanel,
    getMarginKPICard
  };

})();

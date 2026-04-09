/**
 * NBD Pro CRM - Reporting & Analytics Dashboard Module
 * Advanced reporting and analytics for roofing contractor SaaS
 *
 * Reads from window._leads (array of lead objects) and window._estimates (array of estimates)
 * Provides visual analytics dashboards with pure CSS charts (no external dependencies)
 */

(function() {
  'use strict';

  const ReportingDashboard = {
    // Constants
    COLORS: {
      bg: 'var(--s, #1a1a2e)',
      border: 'var(--br, rgba(255,255,255,.08))',
      accent: '#C8541A',
      text: 'var(--m, #9ca3af)',
      header: 'var(--h, #fff)',
      success: '#16a34a',
      error: '#ef4444',
      muted: '#6b7280'
    },

    STAGES: {
      NEW: 'new',
      CONTACTED: 'contacted',
      ESTIMATED: 'estimated',
      PROPOSAL: 'proposal',
      WON: 'won',
      COMPLETED: 'completed',
      LOST: 'lost',
      QUALIFIED: 'qualified',
      NEGOTIATION: 'negotiation'
    },

    ACTIVE_STAGES: ['new', 'contacted', 'estimated', 'proposal', 'qualified', 'negotiation'],
    WON_STAGES: ['won', 'completed'],

    // ============ HELPER FUNCTIONS ============

    /**
     * Group array by field value
     */
    groupBy(arr, field) {
      return arr.reduce((acc, item) => {
        const key = item[field];
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
      }, {});
    },

    /**
     * Get min and max dates from leads by field
     */
    getDateRange(leads, field) {
      const dates = leads
        .filter(l => l[field])
        .map(l => new Date(l[field]).getTime());

      if (dates.length === 0) return { min: new Date(), max: new Date() };

      return {
        min: new Date(Math.min(...dates)),
        max: new Date(Math.max(...dates))
      };
    },

    /**
     * Monthly breakdown of leads with aggregation
     */
    getMonthlyBreakdown(leads, dateField, valueField) {
      const breakdown = {};

      leads.forEach(lead => {
        if (!lead[dateField]) return;

        const date = new Date(lead[dateField]);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!breakdown[monthKey]) {
          breakdown[monthKey] = { count: 0, value: 0, items: [] };
        }

        breakdown[monthKey].count += 1;
        breakdown[monthKey].value += valueField ? (lead[valueField] || 0) : 0;
        breakdown[monthKey].items.push(lead);
      });

      return breakdown;
    },

    /**
     * Format currency
     */
    formatCurrency(value) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0
      }).format(value || 0);
    },

    /**
     * Calculate days between dates
     */
    daysBetween(date1, date2) {
      if (!date1 || !date2) return 0;
      const d1 = new Date(date1).getTime();
      const d2 = new Date(date2).getTime();
      return Math.floor(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
    },

    /**
     * Get data from window or return empty array
     */
    getLeads() {
      return window._leads || [];
    },

    getEstimates() {
      return window._estimates || [];
    },

    /**
     * Create styled container for reports
     */
    createContainer(title, width = '100%') {
      const container = document.createElement('div');
      container.className = 'report-card';
      container.style.cssText = `
        background: ${this.COLORS.bg};
        border: 1px solid ${this.COLORS.border};
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 20px;
        width: ${width};
        box-sizing: border-box;
      `;

      if (title) {
        const header = document.createElement('h3');
        header.textContent = title;
        header.style.cssText = `
          color: ${this.COLORS.header};
          margin: 0 0 20px 0;
          font-size: 18px;
          font-weight: 600;
          border-bottom: 1px solid ${this.COLORS.border};
          padding-bottom: 12px;
        `;
        container.appendChild(header);
      }

      return container;
    },

    // ============ REVENUE REPORT ============

    /**
     * Renders revenue analytics dashboard
     */
    renderRevenueReport(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return console.error(`Container ${containerId} not found`);

      const leads = this.getLeads();
      const card = this.createContainer('Revenue Analytics');

      // Calculate metrics
      const activePipeline = leads.filter(l => this.ACTIVE_STAGES.includes(l.stage));
      const wonLeads = leads.filter(l => this.WON_STAGES.includes(l.stage));
      const lostLeads = leads.filter(l => l.stage === 'lost');

      const totalPipeline = activePipeline.reduce((s, l) => s + (l.jobValue || 0), 0);
      const wonRevenue = wonLeads.reduce((s, l) => s + (l.jobValue || 0), 0);
      const lostRevenue = lostLeads.reduce((s, l) => s + (l.jobValue || 0), 0);
      const avgDealSize = activePipeline.length > 0 ? totalPipeline / activePipeline.length : 0;

      // Create metrics grid
      const metricsGrid = document.createElement('div');
      metricsGrid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 15px;
        margin-bottom: 30px;
      `;

      const metrics = [
        { label: 'Total Pipeline', value: totalPipeline, color: this.COLORS.accent },
        { label: 'Won Revenue', value: wonRevenue, color: this.COLORS.success },
        { label: 'Lost Revenue', value: lostRevenue, color: this.COLORS.error },
        { label: 'Avg Deal Size', value: avgDealSize, color: this.COLORS.muted }
      ];

      metrics.forEach(metric => {
        const metricBox = document.createElement('div');
        metricBox.style.cssText = `
          padding: 12px;
          background: rgba(255,255,255,0.02);
          border-radius: 8px;
          border: 1px solid ${this.COLORS.border};
        `;

        const label = document.createElement('div');
        label.textContent = metric.label;
        label.style.cssText = `
          color: ${this.COLORS.text};
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        `;

        const value = document.createElement('div');
        value.textContent = this.formatCurrency(metric.value);
        value.style.cssText = `
          color: ${metric.color};
          font-size: 20px;
          font-weight: 700;
        `;

        metricBox.appendChild(label);
        metricBox.appendChild(value);
        metricsGrid.appendChild(metricBox);
      });

      card.appendChild(metricsGrid);

      // Monthly revenue trend chart
      const monthlyData = this.getMonthlyBreakdown(leads, 'createdAt', 'jobValue');
      const sortedMonths = Object.keys(monthlyData).sort();
      const maxValue = Math.max(...sortedMonths.map(m => monthlyData[m].value), 1);

      const chartTitle = document.createElement('h4');
      chartTitle.textContent = 'Monthly Revenue Trend';
      chartTitle.style.cssText = `
        color: ${this.COLORS.header};
        margin: 20px 0 15px 0;
        font-size: 14px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      `;
      card.appendChild(chartTitle);

      const chartContainer = document.createElement('div');
      chartContainer.style.cssText = `
        display: flex;
        align-items: flex-end;
        justify-content: space-around;
        height: 200px;
        gap: 8px;
        padding: 10px 0;
      `;

      sortedMonths.slice(-12).forEach(month => {
        const barWrapper = document.createElement('div');
        barWrapper.style.cssText = `
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        `;

        const bar = document.createElement('div');
        const height = maxValue > 0 ? (monthlyData[month].value / maxValue) * 160 : 0;
        bar.style.cssText = `
          width: 100%;
          height: ${height}px;
          background: linear-gradient(180deg, ${this.COLORS.accent}, rgba(200,84,26,0.3));
          border-radius: 4px 4px 0 0;
          transition: all 0.3s ease;
        `;

        const label = document.createElement('span');
        label.textContent = month.substring(5);
        label.style.cssText = `
          color: ${this.COLORS.text};
          font-size: 11px;
          writing-mode: horizontal-tb;
        `;

        barWrapper.appendChild(bar);
        barWrapper.appendChild(label);
        chartContainer.appendChild(barWrapper);
      });

      card.appendChild(chartContainer);

      // Source breakdown
      const sourceBreakdown = this.groupBy(activePipeline, 'source');
      const sourceStats = Object.entries(sourceBreakdown).map(([source, leads]) => ({
        source,
        count: leads.length,
        value: leads.reduce((s, l) => s + (l.jobValue || 0), 0)
      })).sort((a, b) => b.value - a.value);

      const sourceTitle = document.createElement('h4');
      sourceTitle.textContent = 'Revenue by Source';
      sourceTitle.style.cssText = `
        color: ${this.COLORS.header};
        margin: 20px 0 15px 0;
        font-size: 14px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      `;
      card.appendChild(sourceTitle);

      sourceStats.forEach(stat => {
        const row = document.createElement('div');
        row.style.cssText = `
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px;
          border-bottom: 1px solid ${this.COLORS.border};
        `;

        const label = document.createElement('span');
        label.textContent = stat.source || 'Unknown';
        label.style.color = this.COLORS.text;

        const value = document.createElement('span');
        value.textContent = `${this.formatCurrency(stat.value)} (${stat.count} leads)`;
        value.style.color = this.COLORS.accent;

        row.appendChild(label);
        row.appendChild(value);
        card.appendChild(row);
      });

      container.appendChild(card);
    },

    // ============ PIPELINE REPORT ============

    /**
     * Renders pipeline health dashboard
     */
    renderPipelineReport(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;

      const leads = this.getLeads();
      const card = this.createContainer('Pipeline Health');

      // Stage distribution
      const stageData = this.groupBy(leads, 'stage');
      const stageStats = Object.entries(stageData)
        .map(([stage, items]) => ({
          stage,
          count: items.length,
          value: items.reduce((s, l) => s + (l.jobValue || 0), 0)
        }))
        .sort((a, b) => b.count - a.count);

      const maxCount = Math.max(...stageStats.map(s => s.count), 1);

      // Bar chart
      const chartTitle = document.createElement('h4');
      chartTitle.textContent = 'Leads by Stage';
      chartTitle.style.cssText = `
        color: ${this.COLORS.header};
        margin: 0 0 15px 0;
        font-size: 14px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      `;
      card.appendChild(chartTitle);

      stageStats.forEach(stat => {
        const row = document.createElement('div');
        row.style.cssText = `
          margin-bottom: 15px;
        `;

        const label = document.createElement('div');
        label.textContent = `${stat.stage} (${stat.count})`;
        label.style.cssText = `
          color: ${this.COLORS.text};
          font-size: 12px;
          margin-bottom: 4px;
          text-transform: capitalize;
        `;

        const barWrapper = document.createElement('div');
        barWrapper.style.cssText = `
          width: 100%;
          height: 24px;
          background: ${this.COLORS.border};
          border-radius: 4px;
          overflow: hidden;
        `;

        const barFill = document.createElement('div');
        const percentage = maxCount > 0 ? (stat.count / maxCount) * 100 : 0;
        barFill.style.cssText = `
          width: ${percentage}%;
          height: 100%;
          background: linear-gradient(90deg, ${this.COLORS.accent}, rgba(200,84,26,0.6));
          transition: width 0.3s ease;
        `;

        barWrapper.appendChild(barFill);
        row.appendChild(label);
        row.appendChild(barWrapper);
        card.appendChild(row);
      });

      // Key metrics
      const metricsContainer = document.createElement('div');
      metricsContainer.style.cssText = `
        margin-top: 30px;
        padding-top: 20px;
        border-top: 1px solid ${this.COLORS.border};
      `;

      // Stale leads (no activity in 14+ days)
      const staleLeads = leads.filter(l => {
        const lastActivity = new Date(l.updatedAt).getTime();
        const daysSince = Math.floor((Date.now() - lastActivity) / (1000 * 60 * 60 * 24));
        return daysSince >= 14;
      });

      // Pipeline velocity
      const completedLeads = leads.filter(l => this.WON_STAGES.includes(l.stage) && l.wonDate && l.createdAt);
      const velocities = completedLeads.map(l => this.daysBetween(l.createdAt, l.wonDate));
      const avgVelocity = velocities.length > 0 ? velocities.reduce((a, b) => a + b) / velocities.length : 0;

      const metrics = [
        { label: 'Stale Leads (14+ days)', value: staleLeads.length, color: this.COLORS.error },
        { label: 'Avg Pipeline Velocity', value: `${Math.round(avgVelocity)} days`, color: this.COLORS.accent }
      ];

      metrics.forEach(metric => {
        const metricRow = document.createElement('div');
        metricRow.style.cssText = `
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 0;
          border-bottom: 1px solid ${this.COLORS.border};
        `;

        const label = document.createElement('span');
        label.textContent = metric.label;
        label.style.color = this.COLORS.text;

        const value = document.createElement('span');
        value.textContent = metric.value;
        value.style.cssText = `
          color: ${metric.color};
          font-weight: 600;
          font-size: 14px;
        `;

        metricRow.appendChild(label);
        metricRow.appendChild(value);
        metricsContainer.appendChild(metricRow);
      });

      card.appendChild(metricsContainer);
      container.appendChild(card);
    },

    // ============ SOURCE REPORT ============

    /**
     * Renders lead source analysis dashboard
     */
    renderSourceReport(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;

      const leads = this.getLeads();
      const card = this.createContainer('Lead Source Analysis');

      // Source metrics
      const sourceData = this.groupBy(leads, 'source');
      const sourceStats = Object.entries(sourceData).map(([source, items]) => {
        const won = items.filter(l => this.WON_STAGES.includes(l.stage));
        return {
          source,
          total: items.length,
          won: won.length,
          closeRate: items.length > 0 ? Math.round((won.length / items.length) * 100) : 0,
          avgValue: items.length > 0 ? items.reduce((s, l) => s + (l.jobValue || 0), 0) / items.length : 0
        };
      }).sort((a, b) => b.total - a.total);

      const totalLeads = sourceStats.reduce((s, st) => s + st.total, 0);
      const colors = [
        this.COLORS.accent,
        '#f59e0b',
        '#06b6d4',
        '#8b5cf6',
        '#ec4899'
      ];

      // Donut chart using conic-gradient
      const chartContainer = document.createElement('div');
      chartContainer.style.cssText = `
        display: flex;
        justify-content: center;
        margin-bottom: 30px;
        position: relative;
        height: 200px;
        align-items: center;
      `;

      let conicStops = [];
      let currentPercent = 0;

      sourceStats.forEach((stat, idx) => {
        const percent = (stat.total / totalLeads) * 100;
        conicStops.push(`${colors[idx % colors.length]} ${currentPercent}% ${currentPercent + percent}%`);
        currentPercent += percent;
      });

      const donut = document.createElement('div');
      donut.style.cssText = `
        width: 150px;
        height: 150px;
        border-radius: 50%;
        background: conic-gradient(${conicStops.join(',')});
        position: relative;
      `;

      const donutInner = document.createElement('div');
      donutInner.style.cssText = `
        position: absolute;
        width: 100px;
        height: 100px;
        border-radius: 50%;
        background: ${this.COLORS.bg};
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
      `;
      donut.appendChild(donutInner);
      chartContainer.appendChild(donut);

      card.appendChild(chartContainer);

      // Legend and stats
      const statsTitle = document.createElement('h4');
      statsTitle.textContent = 'Source Performance';
      statsTitle.style.cssText = `
        color: ${this.COLORS.header};
        margin: 0 0 15px 0;
        font-size: 14px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      `;
      card.appendChild(statsTitle);

      sourceStats.forEach((stat, idx) => {
        const row = document.createElement('div');
        row.style.cssText = `
          display: grid;
          grid-template-columns: 20px 1fr auto auto auto;
          gap: 12px;
          align-items: center;
          padding: 10px;
          border-bottom: 1px solid ${this.COLORS.border};
        `;

        const colorDot = document.createElement('div');
        colorDot.style.cssText = `
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: ${colors[idx % colors.length]};
        `;

        const label = document.createElement('span');
        label.textContent = stat.source || 'Unknown';
        label.style.color = this.COLORS.text;

        const closeRate = document.createElement('span');
        closeRate.textContent = `${stat.closeRate}%`;
        closeRate.style.cssText = `
          color: ${stat.closeRate >= 30 ? this.COLORS.success : this.COLORS.text};
          font-weight: 600;
          min-width: 40px;
          text-align: right;
        `;

        const avgValue = document.createElement('span');
        avgValue.textContent = this.formatCurrency(stat.avgValue);
        avgValue.style.cssText = `
          color: ${this.COLORS.accent};
          font-weight: 600;
          min-width: 80px;
          text-align: right;
        `;

        const count = document.createElement('span');
        count.textContent = `(${stat.total})`;
        count.style.cssText = `
          color: ${this.COLORS.muted};
          font-size: 12px;
          min-width: 35px;
          text-align: right;
        `;

        row.appendChild(colorDot);
        row.appendChild(label);
        row.appendChild(closeRate);
        row.appendChild(avgValue);
        row.appendChild(count);
        card.appendChild(row);
      });

      container.appendChild(card);
    },

    // ============ TEAM REPORT ============

    /**
     * Renders team/rep productivity dashboard
     */
    renderTeamReport(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;

      const leads = this.getLeads();
      const card = this.createContainer('Team Performance');

      // Team metrics
      const repData = this.groupBy(leads, 'assignedTo');
      const repStats = Object.entries(repData).map(([rep, items]) => {
        const won = items.filter(l => this.WON_STAGES.includes(l.stage));
        const recentActivity = items.filter(l => {
          const daysSince = Math.floor((Date.now() - new Date(l.updatedAt).getTime()) / (1000 * 60 * 60 * 24));
          return daysSince <= 7;
        });

        return {
          rep: rep || 'Unassigned',
          total: items.length,
          won: won.length,
          winRate: items.length > 0 ? Math.round((won.length / items.length) * 100) : 0,
          avgValue: items.length > 0 ? items.reduce((s, l) => s + (l.jobValue || 0), 0) / items.length : 0,
          activity: recentActivity.length
        };
      }).sort((a, b) => b.total - a.total);

      // Metrics grid
      const metricsGrid = document.createElement('div');
      metricsGrid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 15px;
        margin-bottom: 30px;
      `;

      repStats.forEach(stat => {
        const card = document.createElement('div');
        card.style.cssText = `
          padding: 15px;
          background: rgba(255,255,255,0.02);
          border: 1px solid ${this.COLORS.border};
          border-radius: 8px;
        `;

        const repName = document.createElement('div');
        repName.textContent = stat.rep;
        repName.style.cssText = `
          color: ${this.COLORS.header};
          font-weight: 600;
          margin-bottom: 10px;
          font-size: 14px;
        `;

        const stats = [
          { label: 'Leads', value: stat.total, color: this.COLORS.text },
          { label: 'Won', value: stat.won, color: this.COLORS.success },
          { label: 'Win Rate', value: `${stat.winRate}%`, color: stat.winRate >= 30 ? this.COLORS.success : this.COLORS.error },
          { label: 'Avg Deal', value: this.formatCurrency(stat.avgValue), color: this.COLORS.accent }
        ];

        stats.forEach(st => {
          const statRow = document.createElement('div');
          statRow.style.cssText = `
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            margin-bottom: 6px;
          `;

          const label = document.createElement('span');
          label.textContent = st.label;
          label.style.color = this.COLORS.text;

          const value = document.createElement('span');
          value.textContent = st.value;
          value.style.cssText = `
            color: ${st.color};
            font-weight: 600;
          `;

          statRow.appendChild(label);
          statRow.appendChild(value);
          card.appendChild(statRow);
        });

        metricsGrid.appendChild(card);
      });

      card.appendChild(metricsGrid);
      container.appendChild(card);
    },

    // ============ FULL DASHBOARD ============

    /**
     * Renders all reports in responsive grid layout
     */
    renderFullDashboard(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;

      // Create grid wrapper
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
        gap: 20px;
        padding: 20px;
      `;
      wrapper.id = 'dashboard-reports';

      container.appendChild(wrapper);

      // Create individual report containers
      const sections = [
        { id: 'revenue-section', renderer: this.renderRevenueReport.bind(this) },
        { id: 'pipeline-section', renderer: this.renderPipelineReport.bind(this) },
        { id: 'source-section', renderer: this.renderSourceReport.bind(this) },
        { id: 'team-section', renderer: this.renderTeamReport.bind(this) }
      ];

      sections.forEach(section => {
        const sectionContainer = document.createElement('div');
        sectionContainer.id = section.id;
        wrapper.appendChild(sectionContainer);
        section.renderer(section.id);
      });
    }
  };

  // Expose to global scope
  window.ReportingDashboard = ReportingDashboard;

})();

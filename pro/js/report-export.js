/**
 * NBD Pro - Branded PDF Report Generator
 * Generates professional branded PDF reports using browser print-to-PDF functionality
 * 
 * Exposes: window.ReportExport
 * Usage:
 *   ReportExport.generatePipelineReport({dateFrom, dateTo, stages, reps})
 *   ReportExport.generateRevenueReport({period: 'monthly'|'quarterly'|'annual', year})
 *   ReportExport.generateClaimReport(leadId)
 *   ReportExport.generateInspectionReport(leadId)
 *   ReportExport.generateTeamReport({dateFrom, dateTo})
 */

(function() {
  'use strict';

  // Color scheme and branding
  const BRAND = {
    orange: '#C8541A',
    navy: '#1e3a6e',
    white: '#ffffff',
    darkText: '#1f2937',
    lightText: '#6b7280',
    lightBg: '#f9fafb',
    border: '#e5e7eb'
  };

  const FONTS = {
    bodyFont: 'Barlow, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    headerFont: 'Barlow Condensed, Barlow, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  };

  /**
   * Utility: HTML escape
   */
  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replace(/[&<>"']/g, c => map[c]);
  }

  /**
   * Utility: Format currency
   */
  function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
  }

  /**
   * Utility: Format date
   */
  function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /**
   * Utility: Get today's date as YYYY-MM-DD
   */
  function getTodayISO() {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  /**
   * Build branded HTML template
   */
  function buildReportHTML(title, content, options = {}) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700&display=swap');
    
    body {
      font-family: ${FONTS.bodyFont};
      font-size: 11px;
      line-height: 1.5;
      color: ${BRAND.darkText};
      background: ${BRAND.white};
      padding: 0;
      margin: 0;
    }
    
    @media print {
      body { margin: 0; padding: 0; }
      .no-print { display: none !important; }
    }
    
    .report-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 40px;
      background: ${BRAND.white};
    }
    
    .report-header {
      border-bottom: 3px solid ${BRAND.orange};
      padding-bottom: 20px;
      margin-bottom: 30px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
    }
    
    .report-header-left {
      flex: 1;
    }
    
    .report-logo {
      font-family: ${FONTS.headerFont};
      font-size: 18px;
      font-weight: 700;
      color: ${BRAND.navy};
      margin-bottom: 8px;
      letter-spacing: -0.5px;
    }
    
    .report-logo-sub {
      font-size: 10px;
      color: ${BRAND.lightText};
      font-weight: 500;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    
    .report-title {
      font-family: ${FONTS.headerFont};
      font-size: 24px;
      font-weight: 700;
      color: ${BRAND.navy};
      margin-top: 12px;
      margin-bottom: 4px;
      letter-spacing: -0.5px;
    }
    
    .report-meta {
      font-size: 10px;
      color: ${BRAND.lightText};
      margin-top: 8px;
    }
    
    .report-date {
      font-size: 11px;
      color: ${BRAND.lightText};
      text-align: right;
    }
    
    .report-content {
      margin-bottom: 40px;
    }
    
    .section-title {
      font-family: ${FONTS.headerFont};
      font-size: 14px;
      font-weight: 700;
      color: ${BRAND.navy};
      margin-top: 24px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid ${BRAND.border};
      letter-spacing: -0.3px;
    }
    
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }
    
    .stat-card {
      background: ${BRAND.lightBg};
      border: 1px solid ${BRAND.border};
      border-radius: 4px;
      padding: 12px;
      text-align: center;
    }
    
    .stat-label {
      font-size: 9px;
      color: ${BRAND.lightText};
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    
    .stat-value {
      font-family: ${FONTS.headerFont};
      font-size: 18px;
      font-weight: 700;
      color: ${BRAND.orange};
    }
    
    .stat-value.primary {
      color: ${BRAND.navy};
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
      font-size: 10px;
    }
    
    thead {
      background: ${BRAND.lightBg};
      border-bottom: 2px solid ${BRAND.border};
    }
    
    th {
      padding: 10px 8px;
      text-align: left;
      font-weight: 600;
      color: ${BRAND.navy};
      font-family: ${FONTS.headerFont};
    }
    
    td {
      padding: 10px 8px;
      border-bottom: 1px solid ${BRAND.border};
    }
    
    tbody tr:hover {
      background: ${BRAND.lightBg};
    }
    
    .chart-container {
      margin: 20px 0;
      padding: 16px;
      background: ${BRAND.lightBg};
      border-radius: 4px;
      border-left: 4px solid ${BRAND.orange};
    }
    
    .chart-bar-horizontal {
      display: flex;
      align-items: center;
      margin-bottom: 12px;
      gap: 10px;
    }
    
    .chart-bar-label {
      min-width: 100px;
      text-align: right;
      font-weight: 500;
      font-size: 10px;
    }
    
    .chart-bar-fill {
      flex: 1;
      background: ${BRAND.orange};
      height: 20px;
      border-radius: 2px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 6px;
      color: white;
      font-weight: 600;
      font-size: 9px;
    }
    
    .report-footer {
      margin-top: 60px;
      padding-top: 16px;
      border-top: 1px solid ${BRAND.border};
      font-size: 9px;
      color: ${BRAND.lightText};
      text-align: center;
    }
    
    .footer-divider {
      color: ${BRAND.border};
      margin: 0 4px;
    }
    
    .two-column {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    
    .property-section {
      background: ${BRAND.lightBg};
      border: 1px solid ${BRAND.border};
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 12px;
    }
    
    .property-label {
      font-size: 9px;
      font-weight: 600;
      color: ${BRAND.lightText};
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    
    .property-value {
      font-size: 11px;
      color: ${BRAND.darkText};
      font-weight: 500;
    }
    
    .photo-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin: 16px 0;
    }
    
    .photo-item {
      aspect-ratio: 1;
      background: ${BRAND.lightBg};
      border: 1px solid ${BRAND.border};
      border-radius: 4px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      color: ${BRAND.lightText};
    }
    
    .photo-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    .timeline {
      margin: 16px 0;
    }
    
    .timeline-item {
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
      font-size: 10px;
    }
    
    .timeline-date {
      min-width: 70px;
      color: ${BRAND.lightText};
      font-weight: 600;
    }
    
    .timeline-content {
      flex: 1;
      color: ${BRAND.darkText};
    }
    
    .timeline-stage {
      color: ${BRAND.orange};
      font-weight: 600;
    }
    
    .loading-spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid ${BRAND.border};
      border-top-color: ${BRAND.orange};
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    @media print {
      .report-container { max-width: 100%; padding: 0; }
      .section-title { page-break-after: avoid; }
      table { page-break-inside: avoid; }
      .stat-grid { page-break-inside: avoid; }
      .chart-container { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="report-container">
    <div class="report-header">
      <div class="report-header-left">
        <div class="report-logo">NBD Pro</div>
        <div class="report-logo-sub">Roofing CRM</div>
        <div class="report-title">${escapeHtml(title)}</div>
        <div class="report-meta">${options.subtitle || ''}</div>
      </div>
      <div class="report-date">
        <div>${dateStr}</div>
        <div style="font-size: 9px; margin-top: 2px;">${timeStr}</div>
      </div>
    </div>
    
    <div class="report-content">
      ${content}
    </div>
    
    <div class="report-footer">
      <span>Generated by NBD Pro</span>
      <span class="footer-divider">•</span>
      <span>nobigdealwithjoedeal.com</span>
      <span class="footer-divider">•</span>
      <span>Page <span class="page-num">1</span></span>
    </div>
  </div>
  
  <script>
    // Auto-trigger print on load (user can save as PDF)
    window.addEventListener('load', () => {
      setTimeout(() => {
        window.print();
      }, 500);
    });
  </script>
</body>
</html>`;

    return html;
  }

  /**
   * Open print view in hidden iframe
   */
  function openPrintView(html) {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.style.position = 'absolute';
    iframe.style.width = '0';
    iframe.style.height = '0';
    
    document.body.appendChild(iframe);
    
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    
    iframe.onload = function() {
      iframe.contentWindow.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 100);
    };
  }

  /**
   * Fallback: Download as HTML file
   */
  function downloadAsHTML(html, filename) {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * PIPELINE REPORT
   */
  function generatePipelineReport(options = {}) {
    const leads = window._leads || [];
    const now = new Date();

    let dateFrom = options.dateFrom ? new Date(options.dateFrom) : new Date(now.getFullYear(), now.getMonth(), 1);
    let dateTo = options.dateTo ? new Date(options.dateTo) : now;

    const stages = options.stages || ['new', 'contacted', 'estimated', 'proposal', 'qualified', 'negotiation', 'won', 'completed'];
    const reps = options.reps || [];

    // Filter leads
    let filtered = leads.filter(l => {
      const created = l.created ? new Date(l.created) : null;
      if (created && (created < dateFrom || created > dateTo)) return false;
      if (reps.length && !reps.includes(l.assignedRep)) return false;
      return true;
    });

    // Summary stats
    const totalLeads = filtered.length;
    const stageBreakdown = {};
    const wonLeads = [];
    let totalValue = 0;

    stages.forEach(s => stageBreakdown[s] = 0);
    filtered.forEach(l => {
      const stage = l.stage || 'new';
      if (stage in stageBreakdown) stageBreakdown[stage]++;
      totalValue += l.jobValue || 0;
      if (stage === 'won' || stage === 'completed') wonLeads.push(l);
    });

    const conversionRate = totalLeads > 0 ? ((wonLeads.length / totalLeads) * 100).toFixed(1) : '0.0';
    const avgDealSize = wonLeads.length > 0 ? (wonLeads.reduce((sum, l) => sum + (l.jobValue || 0), 0) / wonLeads.length) : 0;

    // Build content
    let content = `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Total Leads</div>
          <div class="stat-value primary">${totalLeads}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Won Deals</div>
          <div class="stat-value primary">${wonLeads.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Conversion Rate</div>
          <div class="stat-value">${conversionRate}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg Deal Size</div>
          <div class="stat-value">${formatCurrency(avgDealSize)}</div>
        </div>
      </div>
    `;

    // Stage breakdown chart
    content += '<div class="section-title">Leads by Stage</div>';
    content += '<div class="chart-container">';

    const maxCount = Math.max(...Object.values(stageBreakdown), 1);
    stages.forEach(stage => {
      const count = stageBreakdown[stage] || 0;
      const pct = ((count / maxCount) * 100).toFixed(0);
      const capitalizedStage = stage.charAt(0).toUpperCase() + stage.slice(1);
      content += `
        <div class="chart-bar-horizontal">
          <div class="chart-bar-label">${capitalizedStage}</div>
          <div class="chart-bar-fill" style="width: ${pct}%">${count}</div>
        </div>
      `;
    });

    content += '</div>';

    // Table of leads
    content += '<div class="section-title">Lead Details</div>';
    content += `
      <table>
        <thead>
          <tr>
            <th>Lead Name</th>
            <th>Stage</th>
            <th>Source</th>
            <th>Value</th>
            <th>Assigned Rep</th>
          </tr>
        </thead>
        <tbody>
    `;

    filtered.slice(0, 50).forEach(lead => {
      const name = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
      const stage = (lead.stage || 'new').charAt(0).toUpperCase() + (lead.stage || 'new').slice(1);
      const source = lead.source || '—';
      const value = formatCurrency(lead.jobValue || 0);
      const rep = lead.assignedRep || 'Unassigned';

      content += `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(stage)}</td>
          <td>${escapeHtml(source)}</td>
          <td>${value}</td>
          <td>${escapeHtml(rep)}</td>
        </tr>
      `;
    });

    content += '</tbody></table>';

    const dateFromStr = formatDate(dateFrom);
    const dateToStr = formatDate(dateTo);
    const subtitle = `Pipeline Report • ${dateFromStr} to ${dateToStr}`;

    const html = buildReportHTML('Pipeline Report', content, { subtitle });
    openPrintView(html);
  }

  /**
   * REVENUE REPORT
   */
  function generateRevenueReport(options = {}) {
    const leads = window._leads || [];
    const period = options.period || 'monthly'; // 'monthly', 'quarterly', 'annual'
    const year = options.year || new Date().getFullYear();

    // Filter won deals
    const wonLeads = leads.filter(l => l.stage === 'won' || l.stage === 'completed');

    // Group by month
    const monthlyBreakdown = {};
    wonLeads.forEach(lead => {
      const created = lead.created ? new Date(lead.created) : null;
      if (!created) return;
      
      if (created.getFullYear() !== year) return;

      const month = String(created.getMonth() + 1).padStart(2, '0');
      const monthKey = `${year}-${month}`;

      if (!monthlyBreakdown[monthKey]) {
        monthlyBreakdown[monthKey] = { count: 0, value: 0, deals: [] };
      }
      monthlyBreakdown[monthKey].count += 1;
      monthlyBreakdown[monthKey].value += lead.jobValue || 0;
      monthlyBreakdown[monthKey].deals.push(lead);
    });

    // Build content
    let content = '';

    // Summary stats
    const totalRevenue = wonLeads.reduce((sum, l) => sum + (l.jobValue || 0), 0);
    const avgDealValue = wonLeads.length > 0 ? totalRevenue / wonLeads.length : 0;
    const closeRate = leads.length > 0 ? ((wonLeads.length / leads.length) * 100).toFixed(1) : '0.0';

    content += `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Total Revenue</div>
          <div class="stat-value">${formatCurrency(totalRevenue)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Deals Closed</div>
          <div class="stat-value primary">${wonLeads.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg Deal Value</div>
          <div class="stat-value">${formatCurrency(avgDealValue)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Close Rate</div>
          <div class="stat-value">${closeRate}%</div>
        </div>
      </div>
    `;

    // Monthly breakdown
    content += '<div class="section-title">Monthly Revenue</div>';
    content += `
      <table>
        <thead>
          <tr>
            <th>Month</th>
            <th>Deals</th>
            <th>Revenue</th>
            <th>Avg Deal</th>
          </tr>
        </thead>
        <tbody>
    `;

    Object.keys(monthlyBreakdown).sort().forEach(monthKey => {
      const data = monthlyBreakdown[monthKey];
      const monthName = new Date(`${monthKey}-01`).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
      const avgDeal = data.count > 0 ? data.value / data.count : 0;

      content += `
        <tr>
          <td>${escapeHtml(monthName)}</td>
          <td>${data.count}</td>
          <td>${formatCurrency(data.value)}</td>
          <td>${formatCurrency(avgDeal)}</td>
        </tr>
      `;
    });

    content += '</tbody></table>';

    // Revenue by source
    const bySource = {};
    wonLeads.forEach(lead => {
      const source = lead.source || 'Unknown';
      if (!bySource[source]) bySource[source] = { count: 0, value: 0 };
      bySource[source].count += 1;
      bySource[source].value += lead.jobValue || 0;
    });

    content += '<div class="section-title">Revenue by Source</div>';
    content += `
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Deals</th>
            <th>Revenue</th>
            <th>% of Total</th>
          </tr>
        </thead>
        <tbody>
    `;

    Object.keys(bySource).sort().forEach(source => {
      const data = bySource[source];
      const pct = ((data.value / totalRevenue) * 100).toFixed(1);

      content += `
        <tr>
          <td>${escapeHtml(source)}</td>
          <td>${data.count}</td>
          <td>${formatCurrency(data.value)}</td>
          <td>${pct}%</td>
        </tr>
      `;
    });

    content += '</tbody></table>';

    const subtitle = `Revenue Report for ${year}`;
    const html = buildReportHTML('Revenue Report', content, { subtitle });
    openPrintView(html);
  }

  /**
   * INSURANCE CLAIM REPORT (for specific lead)
   */
  function generateClaimReport(leadId) {
    const leads = window._leads || [];
    const lead = leads.find(l => l.id === leadId);

    if (!lead) {
      alert('Lead not found');
      return;
    }

    let content = `
      <div class="section-title">Property & Homeowner</div>
      <div class="two-column">
        <div>
          <div class="property-section">
            <div class="property-label">Property Address</div>
            <div class="property-value">${escapeHtml(lead.address || '—')}</div>
          </div>
          <div class="property-section">
            <div class="property-label">Homeowner</div>
            <div class="property-value">${escapeHtml((lead.firstName || '') + ' ' + (lead.lastName || ''))}</div>
          </div>
        </div>
        <div>
          <div class="property-section">
            <div class="property-label">Phone</div>
            <div class="property-value">${escapeHtml(lead.phone || '—')}</div>
          </div>
          <div class="property-section">
            <div class="property-label">Email</div>
            <div class="property-value" style="word-break: break-all;">${escapeHtml(lead.email || '—')}</div>
          </div>
        </div>
      </div>
    `;

    // Insurance/Claim details
    content += '<div class="section-title">Claim Details</div>';
    content += '<div class="two-column">';
    content += `
      <div>
        <div class="property-section">
          <div class="property-label">Claim Number</div>
          <div class="property-value">${escapeHtml(lead.claimNumber || '—')}</div>
        </div>
        <div class="property-section">
          <div class="property-label">Insurance Carrier</div>
          <div class="property-value">${escapeHtml(lead.insCarrier || '—')}</div>
        </div>
      </div>
      <div>
        <div class="property-section">
          <div class="property-label">Claim Status</div>
          <div class="property-value">${escapeHtml(lead.claimStatus || '—')}</div>
        </div>
        <div class="property-section">
          <div class="property-label">Adjuster Name</div>
          <div class="property-value">${escapeHtml(lead.adjusterName || '—')}</div>
        </div>
      </div>
    `;
    content += '</div>';

    // Damage & Estimate
    content += '<div class="section-title">Damage & Estimate</div>';
    content += `
      <div class="property-section">
        <div class="property-label">Damage Type</div>
        <div class="property-value">${escapeHtml(lead.damageType || '—')}</div>
      </div>
      <div class="property-section">
        <div class="property-label">Estimate Amount</div>
        <div class="property-value" style="font-size: 14px; color: ${BRAND.orange}; font-weight: 700;">
          ${formatCurrency(lead.estimateAmount || 0)}
        </div>
      </div>
      <div class="property-section">
        <div class="property-label">Deductible</div>
        <div class="property-value">${formatCurrency(lead.deductible || 0)}</div>
      </div>
      <div class="property-section">
        <div class="property-label">Scope of Work</div>
        <div class="property-value">${escapeHtml(lead.scopeOfWork || 'Not specified')}</div>
      </div>
    `;

    // Claim timeline
    if (lead.claimHistory && lead.claimHistory.length > 0) {
      content += '<div class="section-title">Claim Timeline</div>';
      content += '<div class="timeline">';
      
      lead.claimHistory.forEach(entry => {
        const dateStr = formatDate(entry.date);
        const stage = entry.stage || 'Update';
        const notes = entry.notes || '';

        content += `
          <div class="timeline-item">
            <div class="timeline-date">${dateStr}</div>
            <div class="timeline-content">
              <span class="timeline-stage">${escapeHtml(stage)}</span>
              ${notes ? ': ' + escapeHtml(notes) : ''}
            </div>
          </div>
        `;
      });

      content += '</div>';
    }

    const html = buildReportHTML('Insurance Claim Report', content, { 
      subtitle: `Claim Report for ${lead.firstName} ${lead.lastName}` 
    });
    openPrintView(html);
  }

  /**
   * PROPERTY INSPECTION REPORT (for specific lead)
   */
  function generateInspectionReport(leadId) {
    const leads = window._leads || [];
    const lead = leads.find(l => l.id === leadId);

    if (!lead) {
      alert('Lead not found');
      return;
    }

    let content = `
      <div class="section-title">Property Details</div>
      <div class="two-column">
        <div>
          <div class="property-section">
            <div class="property-label">Address</div>
            <div class="property-value">${escapeHtml(lead.address || '—')}</div>
          </div>
          <div class="property-section">
            <div class="property-label">Property Owner</div>
            <div class="property-value">${escapeHtml((lead.firstName || '') + ' ' + (lead.lastName || ''))}</div>
          </div>
        </div>
        <div>
          <div class="property-section">
            <div class="property-label">Inspection Date</div>
            <div class="property-value">${formatDate(lead.inspectionDate || getTodayISO())}</div>
          </div>
          <div class="property-section">
            <div class="property-label">Inspector</div>
            <div class="property-value">${escapeHtml(lead.inspector || 'NBD Pro Team')}</div>
          </div>
        </div>
      </div>
    `;

    // Roof condition assessment
    content += '<div class="section-title">Roof Condition Assessment</div>';
    content += `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Material Type</div>
          <div class="property-value" style="font-size: 12px; font-weight: 600; color: ${BRAND.navy};">
            ${escapeHtml(lead.roofMaterial || 'Unknown')}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Estimated Age</div>
          <div class="property-value" style="font-size: 12px; font-weight: 600; color: ${BRAND.navy};">
            ${escapeHtml(lead.roofAge || 'Unknown')}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Overall Condition</div>
          <div class="property-value" style="font-size: 12px; font-weight: 600; color: ${BRAND.orange};">
            ${escapeHtml(lead.roofCondition || 'Fair')}
          </div>
        </div>
      </div>
    `;

    // Assessment details
    content += `
      <div class="property-section">
        <div class="property-label">Assessment Notes</div>
        <div class="property-value">${escapeHtml(lead.assessmentNotes || 'No specific issues noted.')}</div>
      </div>
    `;

    // Recommended actions
    content += '<div class="section-title">Recommended Actions</div>';
    const actions = lead.recommendedActions || [];
    if (actions.length > 0) {
      content += '<ul style="margin: 0; padding-left: 20px;">';
      actions.forEach(action => {
        content += `<li style="margin-bottom: 6px; font-size: 11px;">${escapeHtml(action)}</li>`;
      });
      content += '</ul>';
    } else {
      content += '<p style="font-size: 11px; color: ' + BRAND.lightText + ';">No immediate action recommended.</p>';
    }

    // Estimate summary
    content += '<div class="section-title">Estimate Summary</div>';
    content += `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Labor Cost</div>
          <div class="stat-value">${formatCurrency(lead.laborCost || 0)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Material Cost</div>
          <div class="stat-value">${formatCurrency(lead.materialCost || 0)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Estimate</div>
          <div class="stat-value primary">${formatCurrency((lead.laborCost || 0) + (lead.materialCost || 0))}</div>
        </div>
      </div>
    `;

    const html = buildReportHTML('Property Inspection Report', content, { 
      subtitle: `Inspection for ${lead.firstName} ${lead.lastName}` 
    });
    openPrintView(html);
  }

  /**
   * TEAM PERFORMANCE REPORT
   */
  function generateTeamReport(options = {}) {
    const leads = window._leads || [];
    const now = new Date();

    let dateFrom = options.dateFrom ? new Date(options.dateFrom) : new Date(now.getFullYear(), now.getMonth(), 1);
    let dateTo = options.dateTo ? new Date(options.dateTo) : now;

    // Filter leads by date
    const filtered = leads.filter(l => {
      const created = l.created ? new Date(l.created) : null;
      if (created && (created < dateFrom || created > dateTo)) return false;
      return true;
    });

    // Group by rep
    const byRep = {};
    filtered.forEach(lead => {
      const rep = lead.assignedRep || 'Unassigned';
      if (!byRep[rep]) {
        byRep[rep] = {
          leadsAssigned: 0,
          leadsClosed: 0,
          totalRevenue: 0,
          leads: []
        };
      }
      byRep[rep].leadsAssigned += 1;
      byRep[rep].leads.push(lead);
      if (lead.stage === 'won' || lead.stage === 'completed') {
        byRep[rep].leadsClosed += 1;
        byRep[rep].totalRevenue += lead.jobValue || 0;
      }
    });

    let content = `
      <div class="section-title">Team Performance Leaderboard</div>
      <table>
        <thead>
          <tr>
            <th>Rep Name</th>
            <th>Assigned</th>
            <th>Closed</th>
            <th>Close Rate</th>
            <th>Revenue</th>
          </tr>
        </thead>
        <tbody>
    `;

    // Sort reps by revenue
    const sortedReps = Object.keys(byRep).sort((a, b) => {
      return byRep[b].totalRevenue - byRep[a].totalRevenue;
    });

    sortedReps.forEach((rep, idx) => {
      const data = byRep[rep];
      const closeRate = data.leadsAssigned > 0 ? ((data.leadsClosed / data.leadsAssigned) * 100).toFixed(1) : '0.0';

      content += `
        <tr>
          <td>${escapeHtml(rep)}</td>
          <td>${data.leadsAssigned}</td>
          <td>${data.leadsClosed}</td>
          <td>${closeRate}%</td>
          <td>${formatCurrency(data.totalRevenue)}</td>
        </tr>
      `;
    });

    content += '</tbody></table>';

    // D2D stats (if available)
    const hasD2D = Object.values(byRep).some(data => data.leads.some(l => l.doorsKnocked !== undefined));
    if (hasD2D) {
      content += '<div class="section-title">Door-to-Door Statistics</div>';
      content += `
        <table>
          <thead>
            <tr>
              <th>Rep Name</th>
              <th>Doors Knocked</th>
              <th>Appointments Set</th>
              <th>Conv. Rate</th>
            </tr>
          </thead>
          <tbody>
      `;

      sortedReps.forEach(rep => {
        const data = byRep[rep];
        const doorsKnocked = data.leads.reduce((sum, l) => sum + (l.doorsKnocked || 0), 0);
        const apptSet = data.leads.reduce((sum, l) => sum + (l.appointmentsSet || 0), 0);
        const convRate = doorsKnocked > 0 ? ((apptSet / doorsKnocked) * 100).toFixed(1) : '0.0';

        content += `
          <tr>
            <td>${escapeHtml(rep)}</td>
            <td>${doorsKnocked}</td>
            <td>${apptSet}</td>
            <td>${convRate}%</td>
          </tr>
        `;
      });

      content += '</tbody></table>';
    }

    const dateFromStr = formatDate(dateFrom);
    const dateToStr = formatDate(dateTo);
    const subtitle = `Team Performance • ${dateFromStr} to ${dateToStr}`;

    const html = buildReportHTML('Team Performance Report', content, { subtitle });
    openPrintView(html);
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  window.ReportExport = {
    generatePipelineReport,
    generateRevenueReport,
    generateClaimReport,
    generateInspectionReport,
    generateTeamReport,
    
    // Expose utilities for external use
    _buildReportHTML: buildReportHTML,
    _openPrintView: openPrintView,
    _downloadAsHTML: downloadAsHTML,
    _formatCurrency: formatCurrency,
    _formatDate: formatDate,
    
    // Helper to test
    testReport: function() {
      console.log('ReportExport API loaded. Available functions:');
      console.log('- generatePipelineReport(options)');
      console.log('- generateRevenueReport(options)');
      console.log('- generateClaimReport(leadId)');
      console.log('- generateInspectionReport(leadId)');
      console.log('- generateTeamReport(options)');
    }
  };

  console.log('✓ ReportExport module loaded');

})();

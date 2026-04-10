// ============================================================
// NBD Pro — Estimate Finalization / Output Formatters
//
// Takes a resolved estimate from EstimateLogic.resolveEstimate()
// and renders it in one of three formats:
//
//   1. INSURANCE SCOPE — Full Xactimate-style line-item scope
//      with OH/KY code references, reasoning text, photo flags,
//      and material/labor split. For adjuster negotiation.
//
//   2. RETAIL QUOTE — Clean per-tier summary with single grand
//      total, scope bullets, and signature block. For cash /
//      finance customers.
//
//   3. INTERNAL — All of the above plus margin calc, cost basis,
//      order quantities. Joe's eyes only.
//
// All three are self-contained HTML with inline CSS, safe to
// print, PDF-export, or embed in email.
//
// Exposes window.EstimateFinalization.
// ============================================================

(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  // ═════════════════════════════════════════════════════════
  // Shared helpers
  // ═════════════════════════════════════════════════════════

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtMoney(n, showZero) {
    const v = Number(n) || 0;
    if (v === 0 && !showZero) return '—';
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtMoneyBig(n) {
    const v = Number(n) || 0;
    return '$' + Math.round(v).toLocaleString('en-US');
  }

  function fmtQty(qty, unit) {
    const v = Number(qty) || 0;
    const decimals = (unit === 'SQ' || unit === 'LF' || unit === 'SF') ? 2 : 0;
    return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function fmtDate(d) {
    const date = d ? new Date(d) : new Date();
    return date.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  function fmtCodeRefs(refs) {
    if (!refs || !Object.keys(refs).length) return '';
    const parts = [];
    if (refs.oh)   parts.push(`OH ${refs.oh}`);
    if (refs.ky)   parts.push(`KY ${refs.ky}`);
    if (refs.irc)  parts.push(`IRC ${refs.irc}`);
    if (refs.nrca) parts.push(`NRCA`);
    if (refs.ul)   parts.push(`UL ${refs.ul}`);
    if (refs.osha) parts.push(`OSHA ${refs.osha}`);
    return parts.join(' · ');
  }

  // Group line items by category for display
  function groupByCategory(lines) {
    const groups = {};
    lines.forEach(line => {
      const cat = line.category || 'other';
      groups[cat] = groups[cat] || [];
      groups[cat].push(line);
    });
    return groups;
  }

  // Category display order + labels
  const CAT_ORDER = [
    { key: 'labor',        label: 'Labor — Removal & Installation' },
    { key: 'roofing',      label: 'Roofing Materials' },
    { key: 'gutters',      label: 'Gutters & Drainage' },
    { key: 'exterior',     label: 'Exterior — Fascia & Soffit' },
    { key: 'code-upgrade', label: 'Code Upgrades' },
    { key: 'specialty',    label: 'Specialty Items' },
    { key: 'disposal',     label: 'Disposal' },
    { key: 'permits',      label: 'Permits & Inspection' },
    { key: 'protection',   label: 'Jobsite Protection' },
    { key: 'equipment',    label: 'Equipment & Staging' },
    { key: 'emergency',    label: 'Emergency Services' },
    { key: 'interior',     label: 'Interior Repair' },
    { key: 'warranty',     label: 'Warranty & Documentation' },
    { key: 'other',        label: 'Other' }
  ];

  // Shared CSS for all outputs
  const BASE_CSS = `
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
           color:#111; background:#fff; padding:36px;
           max-width:880px; margin:0 auto; line-height:1.4; }
    .hdr { display:flex; justify-content:space-between; align-items:flex-start;
           padding-bottom:22px; border-bottom:3px solid #e8720c; margin-bottom:28px; }
    .brand { font-family:'Barlow Condensed','Helvetica Neue',sans-serif;
             font-size:28px; font-weight:800; text-transform:uppercase;
             letter-spacing:.04em; }
    .brand .pro { color:#e8720c; }
    .sub { font-size:13px; color:#666; margin-top:2px; }
    .badge { display:inline-block; font-size:9px; font-weight:700;
             letter-spacing:.18em; text-transform:uppercase; color:#e8720c;
             border:1px solid #e8720c; padding:3px 10px; border-radius:2px;
             margin-top:6px; }
    .doc-hdr { text-align:right; }
    .doc-title { font-family:'Barlow Condensed',sans-serif; font-size:28px;
                 font-weight:800; text-transform:uppercase; letter-spacing:.06em; }
    .doc-date { font-size:12px; color:#666; }
    .doc-total-lbl { font-size:9px; font-weight:700; letter-spacing:.15em;
                     text-transform:uppercase; color:#e8720c; margin-top:12px; }
    .doc-total-val { font-family:'Barlow Condensed',sans-serif; font-size:38px;
                     font-weight:800; color:#e8720c; line-height:1; }
    h2 { font-family:'Barlow Condensed',sans-serif; font-size:13px;
         font-weight:700; text-transform:uppercase; letter-spacing:.18em;
         margin:26px 0 12px; padding-bottom:4px; border-bottom:2px solid #e8720c; }
    h3 { font-family:'Barlow Condensed',sans-serif; font-size:11px;
         font-weight:700; text-transform:uppercase; letter-spacing:.12em;
         color:#555; margin:18px 0 8px; }
    .field-grid { display:grid; grid-template-columns:1fr 1fr; gap:18px;
                  margin-bottom:16px; }
    .field { font-size:12px; }
    .field label { display:block; font-size:9px; font-weight:700;
                   letter-spacing:.12em; text-transform:uppercase; color:#999; }
    .field .v { font-size:14px; font-weight:600; color:#111; }
    table { width:100%; border-collapse:collapse; margin:4px 0 14px; }
    thead tr { border-bottom:2px solid #111; background:#faf7f3; }
    th { font-family:'Barlow Condensed',sans-serif; font-size:10px;
         font-weight:700; text-transform:uppercase; letter-spacing:.08em;
         padding:8px 10px; text-align:left; color:#111; }
    td { padding:8px 10px; border-bottom:1px solid #eee; font-size:12px;
         vertical-align:top; }
    td.num { text-align:right; font-variant-numeric:tabular-nums; }
    td.code { color:#e8720c; font-weight:700; font-family:'Barlow Condensed',sans-serif;
              font-size:12px; }
    .reason { font-size:10px; color:#666; font-style:italic; margin-top:4px;
              padding-left:4px; border-left:2px solid #e8720c; }
    .code-refs { font-size:9px; color:#a0601f; font-weight:600; margin-top:3px;
                 letter-spacing:.04em; text-transform:uppercase; }
    .photo-req { display:inline-block; font-size:8px; font-weight:700;
                 color:#c53030; background:#fff5f5; padding:2px 6px;
                 border-radius:2px; letter-spacing:.08em; margin-left:6px; }
    .code-req { display:inline-block; font-size:8px; font-weight:700;
                color:#065f46; background:#ecfdf5; padding:2px 6px;
                border-radius:2px; letter-spacing:.08em; margin-left:6px; }
    .cat-hdr { background:#f8f4ef; padding:10px; border-left:4px solid #e8720c;
               font-family:'Barlow Condensed',sans-serif; font-weight:700;
               font-size:13px; text-transform:uppercase; letter-spacing:.1em;
               margin-top:20px; margin-bottom:0; }
    .cat-subtotal { background:#faf7f3; font-weight:700; }
    .grand-row td { font-family:'Barlow Condensed',sans-serif; font-size:16px;
                    font-weight:700; color:#e8720c; border-top:3px solid #111;
                    background:#fff8f5; padding:12px 10px; }
    .footer { margin-top:40px; padding-top:16px; border-top:2px solid #e8720c;
              font-size:10px; color:#555; }
    .terms { font-size:10px; color:#666; margin-top:16px; line-height:1.5; }
    .sig-block { display:grid; grid-template-columns:1fr 1fr; gap:30px;
                 margin-top:40px; page-break-inside:avoid; }
    .sig-line { border-top:1px solid #111; padding-top:6px; font-size:10px;
                color:#555; }
    @page { margin:1.5cm; size:letter; }
    @media print { body { padding:20px; } }
  `;

  // ═════════════════════════════════════════════════════════
  // 1. INSURANCE SCOPE FORMATTER
  // ═════════════════════════════════════════════════════════

  function formatInsuranceScope(estimate, meta) {
    meta = meta || {};
    const customer = meta.customer || {};
    const claim    = meta.claim || {};
    const est      = meta.estimate || {};
    const company  = meta.company || {
      name: 'No Big Deal Home Solutions',
      tagline: 'Roofing · Siding · Storm Restoration',
      phone: '(859) 420-7382',
      email: 'JD@nobigdealwithjoedeal.com',
      address: '6563 Manila Rd · Goshen, OH',
      license: 'OH / KY licensed'
    };

    const groups = groupByCategory(estimate.lines || []);

    // Header block
    const header = `
      <div class="hdr">
        <div>
          <div class="brand">No Big Deal<span class="pro"> PRO</span></div>
          <div class="sub">${escapeHtml(company.tagline)}</div>
          <div class="badge">Insurance Restoration Scope</div>
        </div>
        <div class="doc-hdr">
          <div class="doc-title">Insurance Scope</div>
          <div class="doc-date">${fmtDate(est.date)}</div>
          <div class="doc-date">Estimate #${escapeHtml(est.number || 'NBD-' + Date.now())}</div>
          ${est.revision ? `<div class="doc-date">Revision ${escapeHtml(est.revision)}</div>` : ''}
          <div class="doc-total-lbl">Scope Total (RCV)</div>
          <div class="doc-total-val">${fmtMoneyBig(estimate.total)}</div>
        </div>
      </div>
    `;

    // Claim & property info
    const claimBlock = `
      <h2>Claim Information</h2>
      <div class="field-grid">
        <div class="field"><label>Insured</label><div class="v">${escapeHtml(customer.name || '—')}</div></div>
        <div class="field"><label>Property Address</label><div class="v">${escapeHtml(customer.address || '—')}</div></div>
        <div class="field"><label>Carrier</label><div class="v">${escapeHtml(claim.carrier || '—')}</div></div>
        <div class="field"><label>Claim Number</label><div class="v">${escapeHtml(claim.number || '—')}</div></div>
        <div class="field"><label>Adjuster</label><div class="v">${escapeHtml(claim.adjuster || '—')}</div></div>
        <div class="field"><label>Date of Loss</label><div class="v">${escapeHtml(claim.dateOfLoss || '—')}</div></div>
        <div class="field"><label>Deductible</label><div class="v">${claim.deductible ? fmtMoneyBig(claim.deductible) : '—'}</div></div>
        <div class="field"><label>Scope Prepared By</label><div class="v">${escapeHtml(est.preparedBy || 'Joe Deal — NBD')}</div></div>
      </div>
    `;

    // Build scope tables grouped by category
    let scopeTables = '';
    CAT_ORDER.forEach(catDef => {
      const lines = groups[catDef.key];
      if (!lines || !lines.length) return;

      let catSubtotal = 0;
      const rows = lines.map(line => {
        catSubtotal += line.lineTotal;
        const reason = line.reason
          ? `<div class="reason">${escapeHtml(line.reason)}</div>`
          : '';
        const codeRefs = fmtCodeRefs(line.codeRefs);
        const codeRefsHtml = codeRefs
          ? `<div class="code-refs">${escapeHtml(codeRefs)}</div>`
          : '';
        const photoFlag = line.requiresPhoto
          ? `<span class="photo-req">PHOTO REQ</span>`
          : '';
        const codeFlag = (line.codeRefs && line.codeRefs.oh && /required/i.test(line.reason || ''))
          ? `<span class="code-req">CODE</span>`
          : '';

        return `
          <tr>
            <td class="code">${escapeHtml(line.code || '')}</td>
            <td>
              <strong>${escapeHtml(line.name || '')}</strong>${codeFlag}${photoFlag}
              ${reason}
              ${codeRefsHtml}
            </td>
            <td class="num">${fmtQty(line.quantity, line.unit)} ${escapeHtml(line.unit || '')}</td>
            <td class="num">${fmtMoney(line.materialCostPerUnit)}</td>
            <td class="num">${fmtMoney(line.laborCostPerUnit)}</td>
            <td class="num"><strong>${fmtMoney(line.lineTotal)}</strong></td>
          </tr>
        `;
      }).join('');

      scopeTables += `
        <div class="cat-hdr">${escapeHtml(catDef.label)}</div>
        <table>
          <thead>
            <tr>
              <th style="width:100px;">Code</th>
              <th>Description</th>
              <th class="num" style="width:70px;">Qty</th>
              <th class="num" style="width:75px;">Material</th>
              <th class="num" style="width:75px;">Labor</th>
              <th class="num" style="width:90px;">Line Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr class="cat-subtotal">
              <td></td>
              <td><strong>${escapeHtml(catDef.label)} Subtotal</strong></td>
              <td colspan="3"></td>
              <td class="num"><strong>${fmtMoney(catSubtotal)}</strong></td>
            </tr>
          </tbody>
        </table>
      `;
    });

    // Financial summary
    const ohp = (estimate.overhead || 0) + (estimate.profit || 0);
    const acv = claim.acv || null;
    const rcv = estimate.total;
    const depreciation = claim.recoverableDepreciation || null;
    const deductible = claim.deductible || 0;

    const summaryRows = [
      ['Material Cost', fmtMoney(estimate.materialRetail)],
      ['Labor Cost', fmtMoney(estimate.laborCost)],
      ['Overhead (' + Math.round((estimate.overheadPct || 0.10) * 100) + '%)', fmtMoney(estimate.overhead)],
      ['Profit (' + Math.round((estimate.profitPct || 0.10) * 100) + '%)', fmtMoney(estimate.profit)],
      ['Subtotal', fmtMoney(estimate.subtotal)]
    ];
    if (estimate.taxRate && estimate.taxRate > 0) {
      summaryRows.push(['Sales Tax (' + (estimate.taxRate * 100).toFixed(2) + '%)', fmtMoney(estimate.tax)]);
    }
    summaryRows.push(['REPLACEMENT COST VALUE (RCV)', fmtMoneyBig(rcv), 'grand']);
    if (acv) {
      summaryRows.push(['Actual Cash Value (ACV)', fmtMoneyBig(acv)]);
      summaryRows.push(['Recoverable Depreciation', fmtMoneyBig(depreciation || (rcv - acv))]);
    }
    if (deductible) {
      summaryRows.push(['Less: Deductible', '(' + fmtMoneyBig(deductible) + ')']);
      summaryRows.push(['NET CLAIM', fmtMoneyBig(rcv - deductible), 'grand']);
    }

    const summaryTable = `
      <h2>Financial Summary</h2>
      <table>
        <tbody>
          ${summaryRows.map(r => {
            const cls = r[2] === 'grand' ? 'grand-row' : '';
            return `<tr class="${cls}"><td colspan="5"><strong>${escapeHtml(r[0])}</strong></td><td class="num"><strong>${r[1]}</strong></td></tr>`;
          }).join('')}
        </tbody>
      </table>
    `;

    // Code-required items summary (if any)
    const codeRequired = (estimate.lines || []).filter(l => l.codeRefs && Object.keys(l.codeRefs).length);
    const codeSummary = codeRequired.length ? `
      <h2>Building Code Justification Summary</h2>
      <table>
        <thead><tr><th style="width:120px;">Code Ref</th><th>Item</th><th>Basis</th></tr></thead>
        <tbody>
          ${codeRequired.map(l => `
            <tr>
              <td class="code">${escapeHtml(fmtCodeRefs(l.codeRefs))}</td>
              <td>${escapeHtml(l.name || '')}</td>
              <td style="font-size:10px;color:#555;">${escapeHtml(l.reason || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '';

    // Photo documentation items
    const photoItems = (estimate.lines || []).filter(l => l.requiresPhoto);
    const photoSummary = photoItems.length ? `
      <h2>Photo Documentation Required</h2>
      <p style="font-size:11px;color:#555;margin-bottom:10px;">The following scope items require photographic documentation per code or adjuster review:</p>
      <ul style="font-size:11px;color:#555;margin-left:20px;">
        ${photoItems.map(l => `<li>${escapeHtml(l.name || '')} — ${escapeHtml(fmtCodeRefs(l.codeRefs) || 'documentation')}</li>`).join('')}
      </ul>
    ` : '';

    // Footer / signatures / terms
    const footer = `
      <h2>Signatures</h2>
      <div class="sig-block">
        <div>
          <div style="height:40px;"></div>
          <div class="sig-line">Contractor — ${escapeHtml(est.preparedBy || 'Joe Deal')}<br>
               ${escapeHtml(company.name)}<br>
               Date: ${fmtDate(est.date)}</div>
        </div>
        <div>
          <div style="height:40px;"></div>
          <div class="sig-line">Insured / Property Owner<br>
               ${escapeHtml(customer.name || '')}<br>
               Date: ____________________</div>
        </div>
      </div>

      <div class="terms">
        <strong>Scope Terms:</strong> This scope of work is prepared based on damage
        observed on ${fmtDate(est.inspectionDate || est.date)} and is valid for 30 days.
        All line items reference industry-standard pricing (RSMeans / Xactimate equivalent)
        for the Cincinnati / Northern Kentucky market.
        Code-required items cite Ohio Residential Code (OBC), Kentucky Residential Code (KRC),
        and International Residential Code (IRC) where applicable.
        Overhead and profit calculated at ${Math.round((estimate.overheadPct || 0.10) * 100)}% +
        ${Math.round((estimate.profitPct || 0.10) * 100)}% per industry standard.
      </div>

      <div class="footer">
        <div style="display:flex;justify-content:space-between;">
          <span>${escapeHtml(company.name)} · ${escapeHtml(company.phone)} · ${escapeHtml(company.email)}</span>
          <span>Generated by NBD Pro · ${fmtDate(est.date)}</span>
        </div>
      </div>
    `;

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Insurance Scope — ${escapeHtml(customer.name || 'NBD')} — ${fmtDate(est.date)}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${BASE_CSS}</style>
</head><body>
${header}
${claimBlock}
<h2>Scope of Work</h2>
${scopeTables}
${summaryTable}
${codeSummary}
${photoSummary}
${footer}
</body></html>`;

    return {
      format: 'insurance-scope',
      html,
      lineCount: estimate.lines.length,
      codeRefCount: codeRequired.length,
      photoReqCount: photoItems.length,
      total: estimate.total,
      rcv: estimate.total,
      acv: acv,
      deductible: deductible,
      netClaim: deductible ? (rcv - deductible) : rcv
    };
  }

  // ═════════════════════════════════════════════════════════
  // 2. RETAIL QUOTE FORMATTER
  // ═════════════════════════════════════════════════════════

  function formatRetailQuote(estimate, meta) {
    meta = meta || {};
    const customer = meta.customer || {};
    const est      = meta.estimate || {};
    const company  = meta.company || {
      name: 'No Big Deal Home Solutions',
      tagline: 'Contractor-Built · Contractor-Priced',
      phone: '(859) 420-7382',
      email: 'JD@nobigdealwithjoedeal.com',
      address: '6563 Manila Rd · Goshen, OH'
    };
    const tiers = meta.tiers || null;  // Optional: { good, better, best } per-tier totals

    // Bullet-style scope summary (by category, no prices)
    const groups = groupByCategory(estimate.lines || []);
    const bullets = [];
    CAT_ORDER.forEach(catDef => {
      const lines = groups[catDef.key];
      if (!lines || !lines.length) return;
      // Deduplicate by name
      const seen = new Set();
      lines.forEach(l => {
        if (!l.name || seen.has(l.name)) return;
        seen.add(l.name);
        bullets.push({ cat: catDef.label, name: l.name });
      });
    });

    const bulletHtml = bullets.map(b =>
      `<li><span style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:.1em;">${escapeHtml(b.cat)}</span><br>
           <strong>${escapeHtml(b.name)}</strong></li>`
    ).join('');

    // Tier card HTML (if tiers passed)
    let tierCards = '';
    if (tiers) {
      const tierDefs = [
        { key: 'good',   label: 'GOOD',   sub: 'Standard System', color: '#6b7280' },
        { key: 'better', label: 'BETTER', sub: 'System Warranty', color: '#3b82f6' },
        { key: 'best',   label: 'BEST',   sub: 'Impact + 50yr Warranty', color: '#e8720c' }
      ];
      tierCards = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0;">
          ${tierDefs.map(t => {
            const tierEst = tiers[t.key];
            if (!tierEst) return '';
            const selected = tierEst.total === estimate.total;
            return `
              <div style="border:${selected ? '3' : '1'}px solid ${t.color};
                          border-radius:8px; padding:20px; text-align:center;
                          background:${selected ? '#fff8f5' : '#fff'};
                          ${selected ? 'box-shadow:0 4px 12px rgba(232,114,12,0.15);' : ''}">
                <div style="font-family:'Barlow Condensed',sans-serif;font-size:12px;
                            font-weight:700;letter-spacing:.2em;color:${t.color};">
                  ${escapeHtml(t.label)}
                </div>
                <div style="font-size:11px;color:#666;margin-top:2px;">${escapeHtml(t.sub)}</div>
                <div style="font-family:'Barlow Condensed',sans-serif;font-size:36px;
                            font-weight:800;color:${t.color};margin-top:12px;line-height:1;">
                  ${fmtMoneyBig(tierEst.total)}
                </div>
                ${selected ? `<div style="font-size:9px;font-weight:700;letter-spacing:.15em;
                                          text-transform:uppercase;color:${t.color};margin-top:8px;">
                              ✓ Selected</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Deposit terms (cash: 50/50, insurance: 0)
    const deposit = estimate.deposit || Math.round((estimate.total * 0.5) / 25) * 25;
    const balance = estimate.total - deposit;
    const depositTerms = `
      <h2>Payment Terms</h2>
      <table>
        <tbody>
          <tr>
            <td><strong>Deposit (50% — Upon signing)</strong></td>
            <td class="num"><strong>${fmtMoneyBig(deposit)}</strong></td>
          </tr>
          <tr>
            <td><strong>Balance Due (50% — Upon completion)</strong></td>
            <td class="num"><strong>${fmtMoneyBig(balance)}</strong></td>
          </tr>
          <tr class="grand-row">
            <td><strong>PROJECT TOTAL</strong></td>
            <td class="num"><strong>${fmtMoneyBig(estimate.total)}</strong></td>
          </tr>
        </tbody>
      </table>
    `;

    // Warranty blurb
    const warranty = `
      <h2>Warranty</h2>
      <p style="font-size:12px;color:#444;">
        <strong>Materials:</strong> Manufacturer warranty per product (see scope details).<br>
        <strong>Workmanship:</strong> 10-year NBD labor warranty on all installation.<br>
        <strong>System Warranty:</strong> Available with ${escapeHtml((estimate.lines.find(l => /warranty/i.test(l.name)) || {}).name || 'Better/Best tier upgrades')}.
      </p>
    `;

    const header = `
      <div class="hdr">
        <div>
          <div class="brand">No Big Deal<span class="pro"> PRO</span></div>
          <div class="sub">${escapeHtml(company.tagline)}</div>
          <div class="badge">Project Estimate</div>
        </div>
        <div class="doc-hdr">
          <div class="doc-title">Estimate</div>
          <div class="doc-date">${fmtDate(est.date)}</div>
          <div class="doc-date">Estimate #${escapeHtml(est.number || 'NBD-' + Date.now())}</div>
          <div class="doc-total-lbl">Your Investment</div>
          <div class="doc-total-val">${fmtMoneyBig(estimate.total)}</div>
        </div>
      </div>
    `;

    const propertyBlock = `
      <h2>Property & Customer</h2>
      <div class="field-grid">
        <div class="field"><label>Customer</label><div class="v">${escapeHtml(customer.name || '—')}</div></div>
        <div class="field"><label>Property Address</label><div class="v">${escapeHtml(customer.address || '—')}</div></div>
        <div class="field"><label>Phone</label><div class="v">${escapeHtml(customer.phone || '—')}</div></div>
        <div class="field"><label>Email</label><div class="v">${escapeHtml(customer.email || '—')}</div></div>
      </div>
    `;

    // Scope summary (bulleted, no prices shown)
    const scopeBlock = `
      <h2>Scope of Work Included</h2>
      <p style="font-size:11px;color:#666;margin-bottom:12px;">
        This estimate includes everything listed below — no hidden charges.
      </p>
      <ul style="list-style:none;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${bulletHtml}
      </ul>
    `;

    const footer = `
      <h2>Acceptance</h2>
      <div class="sig-block">
        <div>
          <div style="height:40px;"></div>
          <div class="sig-line">Customer Signature<br>
               ${escapeHtml(customer.name || '')}<br>
               Date: ____________________</div>
        </div>
        <div>
          <div style="height:40px;"></div>
          <div class="sig-line">Contractor — ${escapeHtml(est.preparedBy || 'Joe Deal')}<br>
               ${escapeHtml(company.name)}<br>
               Date: ${fmtDate(est.date)}</div>
        </div>
      </div>

      <div class="terms">
        <strong>Terms:</strong> This estimate is valid for 30 days from the date above.
        Scope is based on visible conditions; hidden damage (rot, structural issues) may
        incur additional charges with prior authorization. Permits included where required.
        Warranty effective upon final payment.
      </div>

      <div class="footer">
        <div style="display:flex;justify-content:space-between;">
          <span>${escapeHtml(company.name)} · ${escapeHtml(company.phone)}</span>
          <span>${escapeHtml(company.email)} · ${escapeHtml(company.address)}</span>
        </div>
      </div>
    `;

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Estimate — ${escapeHtml(customer.name || 'NBD')} — ${fmtDate(est.date)}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${BASE_CSS}</style>
</head><body>
${header}
${propertyBlock}
${tierCards}
${scopeBlock}
${depositTerms}
${warranty}
${footer}
</body></html>`;

    return {
      format: 'retail-quote',
      html,
      lineCount: estimate.lines.length,
      scopeItemCount: bullets.length,
      total: estimate.total,
      deposit: deposit,
      balance: balance
    };
  }

  // ═════════════════════════════════════════════════════════
  // 3. INTERNAL VIEW FORMATTER (Joe's eyes only)
  // ═════════════════════════════════════════════════════════

  function formatInternalView(estimate, meta) {
    meta = meta || {};
    const customer = meta.customer || {};
    const est      = meta.estimate || {};

    // Order quantities (if LumaNails or other packaging)
    let orderLines = '';
    if (window.EstimateLogic && window.EstimateLogic.convertToOrderingUnit) {
      const orders = [];
      (estimate.lines || []).forEach(line => {
        // Look up original catalog item for packaging info
        const cat = window.NBD_XACT_CATALOG;
        if (!cat) return;
        const orig = cat.find(line.code);
        if (orig && orig.packaging) {
          const converted = window.EstimateLogic.convertToOrderingUnit(orig, line.quantity);
          if (converted.converted) {
            orders.push({
              line: line.name,
              sellQty: line.quantity,
              sellUnit: line.unit,
              orderQty: converted.qty,
              orderUnit: converted.unit,
              orderCost: converted.totalCost
            });
          }
        }
      });
      if (orders.length) {
        orderLines = `
          <h2>Purchase Order Quantities</h2>
          <table>
            <thead><tr><th>Item</th><th class="num">Scope Qty</th><th class="num">Order Qty</th><th class="num">Order Cost</th></tr></thead>
            <tbody>
              ${orders.map(o => `
                <tr>
                  <td>${escapeHtml(o.line)}</td>
                  <td class="num">${fmtQty(o.sellQty, o.sellUnit)} ${escapeHtml(o.sellUnit)}</td>
                  <td class="num"><strong>${o.orderQty} ${escapeHtml(o.orderUnit)}</strong></td>
                  <td class="num">${o.orderCost ? fmtMoneyBig(o.orderCost) : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    }

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Internal Estimate View — ${escapeHtml(customer.name || 'NBD')}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${BASE_CSS}
.internal-banner { background:#c53030; color:#fff; padding:10px 16px; font-size:11px;
                    font-weight:700; letter-spacing:.15em; text-transform:uppercase;
                    text-align:center; margin-bottom:20px; border-radius:4px; }
.margin-card { background:#ecfdf5; border:2px solid #065f46; border-radius:8px;
               padding:16px; text-align:center; }
.margin-big { font-family:'Barlow Condensed',sans-serif; font-size:32px;
              font-weight:800; color:#065f46; }
.cost-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:12px 0; }
.cost-card { background:#f8f4ef; padding:12px; border-radius:4px; text-align:center; }
.cost-card .lbl { font-size:9px; color:#666; text-transform:uppercase; letter-spacing:.1em; }
.cost-card .val { font-size:18px; font-weight:700; color:#111; margin-top:4px; }
</style>
</head><body>
<div class="internal-banner">🔒 INTERNAL VIEW — NOT FOR CUSTOMER — Joe's Eyes Only</div>

<div class="hdr">
  <div>
    <div class="brand">No Big Deal<span class="pro"> PRO</span></div>
    <div class="sub">Internal Cost / Margin Breakdown</div>
  </div>
  <div class="doc-hdr">
    <div class="doc-date">${fmtDate(est.date)}</div>
    <div class="doc-date">${escapeHtml(customer.name || '')}</div>
  </div>
</div>

<h2>Margin Analysis</h2>
<div class="cost-grid">
  <div class="cost-card">
    <div class="lbl">Customer Total</div>
    <div class="val">${fmtMoneyBig(estimate.total)}</div>
  </div>
  <div class="cost-card">
    <div class="lbl">Hard Cost (Material + Labor)</div>
    <div class="val">${fmtMoneyBig(estimate.hardCost)}</div>
  </div>
  <div class="cost-card">
    <div class="lbl">OH + Profit</div>
    <div class="val">${fmtMoneyBig((estimate.overhead || 0) + (estimate.profit || 0))}</div>
  </div>
  <div class="cost-card">
    <div class="lbl">Net Margin</div>
    <div class="val" style="color:#065f46;">${fmtMoneyBig(estimate.internal.margin)}</div>
  </div>
</div>

<div class="margin-card" style="margin-top:16px;">
  <div style="font-size:10px;color:#065f46;text-transform:uppercase;letter-spacing:.15em;font-weight:700;">
    MARGIN PERCENTAGE
  </div>
  <div class="margin-big">${estimate.internal.marginPct.toFixed(1)}%</div>
</div>

<h2>Cost Breakdown</h2>
<div class="cost-grid">
  <div class="cost-card">
    <div class="lbl">Raw Material Cost</div>
    <div class="val">${fmtMoneyBig(estimate.materialCost)}</div>
  </div>
  <div class="cost-card">
    <div class="lbl">Material Retail (+markup)</div>
    <div class="val">${fmtMoneyBig(estimate.materialRetail)}</div>
  </div>
  <div class="cost-card">
    <div class="lbl">Labor Cost</div>
    <div class="val">${fmtMoneyBig(estimate.laborCost)}</div>
  </div>
  <div class="cost-card">
    <div class="lbl">Hard Cost</div>
    <div class="val">${fmtMoneyBig(estimate.hardCost)}</div>
  </div>
</div>

${orderLines}

<h2>Resolved Line Items (with sources)</h2>
<table>
  <thead>
    <tr>
      <th style="width:90px;">Code</th>
      <th>Item</th>
      <th class="num" style="width:60px;">Qty</th>
      <th class="num" style="width:70px;">Mat $/u</th>
      <th class="num" style="width:70px;">Lab $/u</th>
      <th class="num" style="width:80px;">Total</th>
      <th style="width:100px;font-size:9px;">Source</th>
    </tr>
  </thead>
  <tbody>
    ${(estimate.lines || []).map(l => `
      <tr>
        <td class="code">${escapeHtml(l.code || '')}</td>
        <td>${escapeHtml(l.name || '')}</td>
        <td class="num">${fmtQty(l.quantity, l.unit)} ${escapeHtml(l.unit || '')}</td>
        <td class="num">${fmtMoney(l.materialCostPerUnit)}</td>
        <td class="num">${fmtMoney(l.laborCostPerUnit)}</td>
        <td class="num"><strong>${fmtMoney(l.lineTotal)}</strong></td>
        <td style="font-size:8px;color:#666;">
          M: ${escapeHtml((l.matSource || 'n/a').substring(0, 20))}<br>
          L: ${escapeHtml((l.labSource || 'n/a').substring(0, 20))}
        </td>
      </tr>
    `).join('')}
  </tbody>
</table>

<div class="footer">
  <strong>Min job applied:</strong> ${estimate.minJobApplied ? 'YES ($2,500 floor)' : 'No'} ·
  <strong>Tax rate:</strong> ${((estimate.taxRate || 0) * 100).toFixed(2)}% ·
  <strong>Tier:</strong> ${escapeHtml(estimate.tier || 'n/a')} ·
  <strong>Mode:</strong> ${escapeHtml(estimate.mode || 'n/a')}
</div>
</body></html>`;

    return {
      format: 'internal-view',
      html,
      margin: estimate.internal.margin,
      marginPct: estimate.internal.marginPct,
      total: estimate.total
    };
  }

  // ═════════════════════════════════════════════════════════
  // Unified dispatcher
  // ═════════════════════════════════════════════════════════

  function formatEstimate(estimate, format, meta) {
    format = format || 'retail-quote';
    switch (format) {
      case 'insurance-scope':
      case 'insurance':
        return formatInsuranceScope(estimate, meta);
      case 'retail-quote':
      case 'retail':
      case 'cash':
        return formatRetailQuote(estimate, meta);
      case 'internal-view':
      case 'internal':
        return formatInternalView(estimate, meta);
      default:
        return formatRetailQuote(estimate, meta);
    }
  }

  // Open a formatted estimate in a new window for print/PDF
  function openInNewWindow(formattedResult) {
    if (!formattedResult || !formattedResult.html) return null;
    const w = window.open('', '_blank');
    if (!w) return null;
    w.document.write(formattedResult.html);
    w.document.close();
    return w;
  }

  // ═════════════════════════════════════════════════════════
  // Public API
  // ═════════════════════════════════════════════════════════
  window.EstimateFinalization = {
    formatEstimate,
    formatInsuranceScope,
    formatRetailQuote,
    formatInternalView,
    openInNewWindow,

    // Helpers (exposed for reuse)
    escapeHtml,
    fmtMoney,
    fmtMoneyBig,
    fmtQty,
    fmtDate,
    fmtCodeRefs,
    groupByCategory,
    BASE_CSS
  };

  console.log('[EstimateFinalization] 3 output formatters ready: insurance-scope, retail-quote, internal-view');
})();

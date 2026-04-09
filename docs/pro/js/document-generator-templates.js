/**
 * NBD Document Generator - Extended Templates
 * Adds 11 additional document types to window.NBDDocGen
 * Requires: document-generator.js loaded first
 */
(function() {
  'use strict';
  const DG = window.NBDDocGen;
  if (!DG) { console.warn('NBDDocGen: document-generator.js must load first'); return; }

  const C = DG.COMPANY || {
    name: 'No Big Deal Home Solutions', phone: '(859) 420-7382',
    email: 'info@nobigdeal.pro', website: 'nobigdealwithjoedeal.com',
    colors: { primary: '#1e3a6e', secondary: '#1a1a2e', accent: '#e8720c' }
  };
  const P = C.colors?.primary || '#1e3a6e';   // Navy — headers, borders, structure
  const S = C.colors?.secondary || '#1a1a2e'; // Dark navy — body text headings
  const A = C.colors?.accent || '#e8720c';    // Orange — CTAs, totals, highlights

  // Register new document types
  Object.assign(DG.DOCUMENT_TYPES, {
    warranty_certificate: { name: 'Warranty Certificate', template: 'renderWarrantyCertificate' },
    supplement_request: { name: 'Supplement Request', template: 'renderSupplementRequest' },
    scope_of_work: { name: 'Scope of Work', template: 'renderScopeOfWork' },
    work_authorization: { name: 'Work Authorization', template: 'renderWorkAuthorization' },
    certificate_of_completion: { name: 'Certificate of Completion', template: 'renderCertificateOfCompletion' },
    change_order: { name: 'Change Order', template: 'renderChangeOrder' },
    invoice: { name: 'Invoice', template: 'renderInvoice' },
    company_intro: { name: 'Company Introduction', template: 'renderCompanyIntro' },
    before_after_report: { name: 'Before & After Report', template: 'renderBeforeAfterReport' },
    financing_options: { name: 'Financing Options', template: 'renderFinancingOptions' },
    referral_card: { name: 'Referral Card', template: 'renderReferralCard' }
  });

  // Shared print styles for all templates
  const printCSS = `
    @media print { .no-print { display:none!important; } body { margin:0; } @page { margin:0.5in; } }
    * { box-sizing:border-box; }
    body { font-family:Georgia,'Times New Roman',serif; color:#222; line-height:1.6; margin:0; padding:0; background:#fff; }
    h1,h2,h3,h4 { font-family:'Helvetica Neue',Arial,sans-serif; color:${S}; margin:0 0 12px 0; }
    .doc-page { max-width:8.5in; margin:0 auto; padding:40px 50px; }
    .orange { color:${A}; }
    .section { margin-bottom:28px; }
    .section-title { font-size:16px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em;
      color:${P}; border-bottom:2px solid ${P}; padding-bottom:6px; margin-bottom:16px; }
    table.items { width:100%; border-collapse:collapse; margin:16px 0; }
    table.items th { background:${P}; color:#fff; padding:10px 14px; text-align:left; font-family:'Helvetica Neue',Arial,sans-serif;
      font-size:12px; text-transform:uppercase; letter-spacing:0.06em; }
    table.items td { padding:10px 14px; border-bottom:1px solid #eee; font-size:14px; }
    table.items tr:nth-child(even) td { background:#f9f9f9; }
    table.items .right { text-align:right; }
    .sig-line { display:inline-block; width:280px; border-bottom:2px solid #333; margin:0 20px; }
    .sig-label { font-size:11px; color:#666; margin-top:4px; }
    .photo-zone { border:2px dashed #ccc; border-radius:8px; min-height:180px; display:flex; align-items:center;
      justify-content:center; color:#999; font-size:13px; background:#fafafa; }
    .badge { display:inline-block; padding:6px 16px; border-radius:20px; font-size:12px; font-weight:700;
      font-family:'Helvetica Neue',Arial,sans-serif; letter-spacing:0.04em; }
    .letterhead { border-top:6px solid ${P}; padding:24px 0 16px; margin-bottom:24px;
      display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px solid #ddd; }
    .letterhead-name { font-family:'Helvetica Neue',Arial,sans-serif; font-size:22px; font-weight:700; color:${S}; }
    .letterhead-tagline { font-size:12px; color:${A}; font-style:italic; margin-top:2px; }
    .letterhead-contact { text-align:right; font-size:12px; color:#555; line-height:1.8; }
    .footer { border-top:2px solid ${P}; margin-top:40px; padding-top:12px; display:flex;
      justify-content:space-between; font-size:10px; color:#999; }
    .print-btn { text-align:center; padding:24px; }
    .print-btn button { background:${A}; color:#fff; border:none; padding:14px 36px; border-radius:8px;
      font-size:16px; cursor:pointer; font-weight:600; font-family:'Helvetica Neue',Arial,sans-serif; }
    .print-btn button:hover { opacity:0.9; }
  `;

  function page(title, body) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title} | ${C.name}</title>
    <style>${printCSS}</style></head><body><div class="doc-page">${body}</div>
    <div class="no-print print-btn"><button onclick="window.print()">Print / Save as PDF</button></div>
    </body></html>`;
  }

  function letterhead() {
    return `<div class="letterhead">
      <div><div class="letterhead-name">${C.name}</div>
      <div class="letterhead-tagline">${C.tagline || 'No Big Deal — We\'ve Got You Covered'}</div></div>
      <div class="letterhead-contact">${C.phone}<br>${C.email}<br>${C.website}</div></div>`;
  }

  function footer(extra) {
    return `<div class="footer"><span>${C.name} | ${C.phone}</span><span>${extra || ''}</span>
    <span>Generated by NBD Pro</span></div>`;
  }

  function sigBlock(labels) {
    return `<div class="section" style="margin-top:36px;">` + labels.map(l =>
      `<div style="margin-bottom:28px;"><span class="sig-line"></span>
      <span style="margin-left:20px;"><span class="sig-line" style="width:140px;"></span></span>
      <div style="display:flex;gap:20px;margin-top:4px;padding-left:4px;">
        <span class="sig-label" style="width:280px;">${l}</span>
        <span class="sig-label" style="width:140px;margin-left:20px;">Date</span></div></div>`
    ).join('') + `</div>`;
  }

  function photoGrid(count, cols) {
    cols = cols || 3;
    let html = `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;margin:16px 0;">`;
    for (let i = 0; i < count; i++) html += `<div class="photo-zone">Click to add photo</div>`;
    return html + '</div>';
  }

  function esc(s) { return (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function money(n) { return '$' + (parseFloat(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function today() { return new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}); }

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 1: WARRANTY CERTIFICATE
  // ═══════════════════════════════════════════════════════════════
  DG.renderWarrantyCertificate = function(data) {
    const d = Object.assign({ homeownerName:'[Homeowner Name]', address:'[Property Address]',
      warrantyTier:'best', workPerformed:'Complete roof replacement including tear-off, underlayment, and installation of new roofing system.',
      certificateNumber:'NBD-WC-'+(Date.now()%100000), issueDate:today(), expirationDate:'N/A — Lifetime' }, data);

    const tiers = { good:{label:'GOOD',color:'#cd7f32',bg:'#fdf4e8',years:'5-Year',exp:'5 years from issue date'},
      better:{label:'BETTER',color:'#808080',bg:'#f0f0f0',years:'10-Year',exp:'10 years from issue date'},
      best:{label:'BEST',color:'#DAA520',bg:'#fefce8',years:'Lifetime',exp:'Lifetime — as long as you own the property'} };
    const t = tiers[d.warrantyTier] || tiers.best;
    if (d.warrantyTier==='best') d.expirationDate = 'Lifetime — No Expiration';
    else if (d.warrantyTier==='better') d.expirationDate = '10 years from ' + d.issueDate;
    else d.expirationDate = '5 years from ' + d.issueDate;

    const warrantyText = d.warrantyTier === 'best'
      ? 'For as long as you own your home, our installation is guaranteed. Includes priority service response, annual courtesy inspections, and transferable coverage if you sell your home.'
      : d.warrantyTier === 'better'
        ? 'Extended coverage guaranteeing installation quality for a full decade. Includes priority service response and annual courtesy inspection for the first 3 years.'
        : 'Our team guarantees the quality of installation for 5 years from the date of completion. If any defect in workmanship causes a leak or failure, we will repair it at no cost to you.';

    return page('Warranty Certificate', `
      <style>
        .cert-border { border:4px double ${t.color}; padding:48px 40px; margin:20px 0; position:relative; }
        .cert-seal { width:90px;height:90px;border-radius:50%;background:${t.color};display:flex;align-items:center;
          justify-content:center;color:#fff;font-size:32px;position:absolute;bottom:30px;right:30px;box-shadow:0 4px 12px rgba(0,0,0,0.2); }
        .cert-title { font-family:Georgia,serif; font-size:32px; text-align:center; color:${S};
          letter-spacing:0.12em; text-transform:uppercase; margin-bottom:8px; }
        .cert-sub { text-align:center; font-size:14px; color:${A}; letter-spacing:0.08em; margin-bottom:32px; }
        .cert-body { text-align:center; font-size:16px; line-height:2; }
        .cert-name { font-size:24px; font-weight:700; color:${S}; }
        .tier-badge { display:inline-block; padding:10px 28px; border-radius:24px; background:${t.bg};
          border:2px solid ${t.color}; color:${t.color}; font-weight:700; font-size:14px;
          letter-spacing:0.1em; font-family:'Helvetica Neue',Arial,sans-serif; margin:20px 0; }
        .cert-details { display:grid; grid-template-columns:1fr 1fr; gap:16px; max-width:480px;
          margin:24px auto; text-align:left; font-size:13px; }
        .cert-details dt { color:#666; font-family:'Helvetica Neue',Arial,sans-serif; text-transform:uppercase;
          font-size:10px; letter-spacing:0.06em; }
        .cert-details dd { margin:0 0 12px 0; font-weight:600; color:#333; }
      </style>
      ${letterhead()}
      <div class="cert-border">
        <div class="cert-title">Certificate of Warranty</div>
        <div class="cert-sub">${C.name}</div>
        <div class="cert-body">
          <p>This certifies that all work performed at the property of</p>
          <p class="cert-name">${esc(d.homeownerName)}</p>
          <p style="color:#555;">${esc(d.address)}</p>
          <div class="tier-badge">${t.years} WORKMANSHIP WARRANTY — ${t.label} TIER</div>
          <p style="max-width:520px;margin:0 auto;font-size:14px;color:#444;">${warrantyText}</p>
          <p style="font-size:14px;color:#444;margin-top:8px;">
            Additionally, all materials carry the manufacturer's warranty as specified by the product manufacturer.</p>
        </div>
        <dl class="cert-details">
          <div><dt>Certificate #</dt><dd>${esc(d.certificateNumber)}</dd></div>
          <div><dt>Issue Date</dt><dd>${esc(d.issueDate)}</dd></div>
          <div><dt>Coverage</dt><dd>${t.years} Workmanship</dd></div>
          <div><dt>Expiration</dt><dd>${esc(d.expirationDate)}</dd></div>
          <div><dt>Work Performed</dt><dd>${esc(d.workPerformed)}</dd></div>
          <div><dt>Warranty Tier</dt><dd>${t.label}</dd></div>
        </dl>
        <div class="cert-seal">&#10003;</div>
      </div>
      ${sigBlock(['Homeowner Acknowledgment','Authorized NBD Representative'])}
      ${footer('Certificate #' + d.certificateNumber)}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 2: SUPPLEMENT REQUEST
  // ═══════════════════════════════════════════════════════════════
  DG.renderSupplementRequest = function(data) {
    const d = Object.assign({ homeownerName:'[Homeowner Name]', address:'[Property Address]',
      claimNumber:'[Claim #]', policyNumber:'[Policy #]', insuranceCompany:'[Insurance Company]',
      dateOfLoss:'[Date of Loss]', originalApproved:'0.00',
      supplementItems:[
        {item:'Ridge cap — not included in original scope',code:'RSG-250',qty:120,unit:'LF',price:5.50},
        {item:'Ice & water shield at eaves (code required)',code:'IWS-100',qty:8,unit:'SQ',price:65},
        {item:'OSB decking replacement — hidden damage',code:'OSB-475',qty:4,unit:'SQ',price:125},
        {item:'Additional flashing at wall tie-ins',code:'FLS-300',qty:32,unit:'LF',price:8.50}
      ],
      justification:'During the course of the approved roof replacement, additional damage was discovered that was not visible during the initial inspection. The following supplemental items are necessary to restore the roof system to its pre-loss condition and ensure compliance with local building codes.' }, data);

    let suppTotal = 0;
    const rows = d.supplementItems.map(i => {
      const lineTotal = (i.qty||0) * (i.price||0);
      suppTotal += lineTotal;
      return `<tr><td>${esc(i.item)}</td><td>${esc(i.code)}</td><td class="right">${i.qty}</td>
        <td>${esc(i.unit)}</td><td class="right">${money(i.price)}</td><td class="right">${money(lineTotal)}</td></tr>`;
    }).join('');

    return page('Supplement Request', `
      ${letterhead()}
      <h1 style="text-align:center;font-size:24px;color:${S};margin:24px 0 8px;">SUPPLEMENT REQUEST</h1>
      <p style="text-align:center;color:#666;font-size:13px;margin-bottom:28px;">Insurance Claim Supplemental Documentation</p>

      <div class="section">
        <div class="section-title">Claim Information</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;">
          <div><strong>Homeowner:</strong> ${esc(d.homeownerName)}</div>
          <div><strong>Claim #:</strong> ${esc(d.claimNumber)}</div>
          <div><strong>Property:</strong> ${esc(d.address)}</div>
          <div><strong>Policy #:</strong> ${esc(d.policyNumber)}</div>
          <div><strong>Insurance:</strong> ${esc(d.insuranceCompany)}</div>
          <div><strong>Date of Loss:</strong> ${esc(d.dateOfLoss)}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Original Approved Amount</div>
        <p style="font-size:20px;font-weight:700;color:${S};">${money(d.originalApproved)}</p>
      </div>

      <div class="section">
        <div class="section-title">Supplemental Line Items</div>
        <table class="items">
          <thead><tr><th>Description</th><th>Code</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Total</th></tr></thead>
          <tbody>${rows}
            <tr style="border-top:3px solid ${A};font-weight:700;">
              <td colspan="5" style="text-align:right;font-size:15px;">SUPPLEMENT TOTAL:</td>
              <td class="right" style="font-size:15px;color:${A};">${money(suppTotal)}</td></tr>
            <tr style="font-weight:700;">
              <td colspan="5" style="text-align:right;font-size:15px;">NEW PROJECT TOTAL:</td>
              <td class="right" style="font-size:15px;color:${S};">${money(parseFloat(d.originalApproved)+suppTotal)}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-title">Justification</div>
        <p style="font-size:14px;">${esc(d.justification)}</p>
      </div>

      <div class="section">
        <div class="section-title">Supporting Documentation</div>
        <div style="font-size:14px;line-height:2;">
          <label><input type="checkbox" checked disabled> Photographs of additional damage</label><br>
          <label><input type="checkbox" checked disabled> Revised scope of work</label><br>
          <label><input type="checkbox" disabled> Manufacturer specifications</label><br>
          <label><input type="checkbox" checked disabled> Code compliance documentation</label><br>
          <label><input type="checkbox" disabled> Third-party assessment</label>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Photo Evidence</div>
        ${photoGrid(4,2)}
      </div>

      ${sigBlock(['Contractor — '+C.name])}
      ${footer('Supplement Request — Claim #' + d.claimNumber)}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 3: SCOPE OF WORK
  // ═══════════════════════════════════════════════════════════════
  DG.renderScopeOfWork = function(data) {
    const d = Object.assign({ homeownerName:'[Homeowner Name]', address:'[Property Address]',
      projectDescription:'Complete roof replacement — tear-off, underlayment, and installation of new architectural shingle roofing system.',
      materials:'GAF Timberline HDZ Architectural Shingles, GAF FeltBuster Synthetic Underlayment, GAF Cobra Ridge Vent',
      estimatedTimeline:'2-3 business days, weather permitting',
      exclusions:'Interior repairs, landscaping restoration beyond reasonable care, code upgrades not related to roofing, structural framing repairs.' }, data);

    const sections = [
      { title:'1. Removal & Demolition', items:[
        'Remove all existing roofing materials down to decking','Remove all existing flashing, vents, and pipe boots',
        'Inspect decking for damage and replace as needed','Remove and dispose of all debris in dumpster on-site'] },
      { title:'2. Decking & Substrate', items:[
        'Replace any damaged or rotted decking (7/16" OSB or equivalent)','Ensure all decking is properly nailed per code requirements',
        'Verify structural integrity of all rafters and trusses'] },
      { title:'3. Underlayment & Ice Shield', items:[
        'Install ice and water shield at all eaves (minimum 3 feet from edge)','Install ice and water shield in all valleys',
        'Install synthetic underlayment over remaining roof deck area','Ensure all underlayment overlaps per manufacturer specifications'] },
      { title:'4. Flashing & Waterproofing', items:[
        'Install new drip edge at all eaves and rakes','Install new step flashing at all wall intersections',
        'Install new pipe boot flashings on all penetrations','Install or replace chimney flashing as needed',
        'Seal all flashing with appropriate roofing sealant'] },
      { title:'5. Shingle Installation', items:[
        'Install starter strip shingles at all eaves and rakes','Install architectural shingles per manufacturer specifications',
        'Maintain proper exposure and offset throughout','Install ridge cap shingles at all ridges and hips'] },
      { title:'6. Ventilation', items:[
        'Install ridge vent system for proper attic ventilation','Ensure soffit vents are unobstructed',
        'Verify balanced intake/exhaust ventilation per code'] },
      { title:'7. Cleanup & Final', items:[
        'Magnetic sweep of entire property for nails and debris','Remove dumpster and all materials from property',
        'Final inspection walk-around with homeowner','Touch up any landscaping disturbed during work'] }
    ];

    return page('Scope of Work', `
      ${letterhead()}
      <h1 style="text-align:center;font-size:24px;color:${S};margin:24px 0 8px;">SCOPE OF WORK</h1>
      <p style="text-align:center;color:#666;margin-bottom:28px;font-size:13px;">Detailed Project Specification</p>

      <div class="section">
        <div class="section-title">Project Overview</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;margin-bottom:16px;">
          <div><strong>Property Owner:</strong> ${esc(d.homeownerName)}</div>
          <div><strong>Date:</strong> ${today()}</div>
          <div><strong>Property:</strong> ${esc(d.address)}</div>
          <div><strong>Timeline:</strong> ${esc(d.estimatedTimeline)}</div>
        </div>
        <p style="font-size:14px;">${esc(d.projectDescription)}</p>
      </div>

      ${sections.map(s => `<div class="section">
        <div class="section-title">${s.title}</div>
        <ul style="font-size:14px;line-height:2;padding-left:24px;">
          ${s.items.map(i => `<li>${esc(i)}</li>`).join('')}
        </ul>
      </div>`).join('')}

      <div class="section">
        <div class="section-title">Material Specifications</div>
        <p style="font-size:14px;">${esc(d.materials)}</p>
      </div>

      <div class="section">
        <div class="section-title">Exclusions</div>
        <p style="font-size:14px;color:#666;">${esc(d.exclusions)}</p>
      </div>

      ${sigBlock(['Homeowner','Contractor — '+C.name])}
      ${footer('Scope of Work')}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 4: WORK AUTHORIZATION
  // ═══════════════════════════════════════════════════════════════
  DG.renderWorkAuthorization = function(data) {
    const d = Object.assign({ homeownerName:'[Homeowner Name]', address:'[Property Address]',
      scopeSummary:'Complete roof replacement including tear-off, installation of new roofing system, and cleanup.',
      startDate:'[Start Date]', emergencyContact:'[Emergency Contact Name & Phone]',
      accessInstructions:'Gate code: _____ | Dogs: Yes / No | Parking: _____',
      isInsurance:false, claimNumber:'', insuranceCompany:'' }, data);

    return page('Work Authorization', `
      ${letterhead()}
      <h1 style="text-align:center;font-size:24px;color:${S};margin:24px 0 8px;">WORK AUTHORIZATION</h1>
      <p style="text-align:center;color:#666;margin-bottom:28px;font-size:13px;">Authorization to Perform Work</p>

      <div class="section" style="background:#f8f8f8;padding:24px;border-radius:8px;border-left:4px solid ${A};">
        <p style="font-size:15px;line-height:1.8;">
          I, <strong>${esc(d.homeownerName)}</strong>, as the owner of the property located at
          <strong>${esc(d.address)}</strong>, hereby authorize <strong>${C.name}</strong> to perform the
          following work on my property as described below. I understand and agree to the terms of the associated
          contract and scope of work documents.
        </p>
      </div>

      <div class="section">
        <div class="section-title">Scope Summary</div>
        <p style="font-size:14px;">${esc(d.scopeSummary)}</p>
      </div>

      <div class="section">
        <div class="section-title">Project Details</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:14px;">
          <div><strong>Authorized Start Date:</strong><br>${esc(d.startDate)}</div>
          <div><strong>Emergency Contact:</strong><br>${esc(d.emergencyContact)}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Property Access Instructions</div>
        <p style="font-size:14px;">${esc(d.accessInstructions)}</p>
      </div>

      ${d.isInsurance ? `<div class="section">
        <div class="section-title">Insurance Assignment</div>
        <p style="font-size:14px;">I hereby assign and transfer to <strong>${C.name}</strong> the insurance proceeds
        relating to claim number <strong>${esc(d.claimNumber)}</strong> with <strong>${esc(d.insuranceCompany)}</strong>
        to the extent of the contract price for the work authorized herein. This assignment authorizes ${C.name}
        to negotiate directly with the insurance company regarding the scope and payment for all covered repairs.</p>
      </div>` : ''}

      <div class="section" style="background:#fff8f5;padding:20px;border-radius:8px;border:1px solid #f0d0c0;">
        <p style="font-size:13px;color:#555;margin:0;">
          <strong>Notice of Cancellation:</strong> You have the right to cancel this authorization within three (3) business
          days of signing. To cancel, provide written notice to ${C.name} at ${C.email} or by calling ${C.phone}.
        </p>
      </div>

      ${sigBlock(['Property Owner','Witness (Optional)','Authorized NBD Representative'])}
      ${footer('Work Authorization')}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 5: CERTIFICATE OF COMPLETION
  // ═══════════════════════════════════════════════════════════════
  DG.renderCertificateOfCompletion = function(data) {
    const d = Object.assign({ homeownerName:'[Homeowner Name]', address:'[Property Address]',
      scopeSummary:'Complete roof replacement', startDate:'[Start Date]',
      completionDate:today(), warrantyTier:'best',
      inspectorName:'[Inspector Name]' }, data);

    const checklist = [
      {item:'All materials installed per manufacturer specifications',checked:true},
      {item:'Flashing and waterproofing completed at all penetrations',checked:true},
      {item:'Ventilation system installed and verified',checked:true},
      {item:'Property cleaned and all debris removed',checked:true},
      {item:'Magnetic nail sweep of entire property completed',checked:true},
      {item:'Final quality inspection completed by crew lead',checked:true},
      {item:'Homeowner walkthrough and approval obtained',checked:true}
    ];

    return page('Certificate of Completion', `
      <style>
        .comp-border { border:3px solid ${P}; padding:40px; margin:20px 0; border-radius:12px; }
        .check-item { display:flex; align-items:center; gap:12px; padding:8px 0; font-size:14px;
          border-bottom:1px solid #f0f0f0; }
        .check-icon { width:24px; height:24px; border-radius:50%; display:flex; align-items:center;
          justify-content:center; font-size:14px; flex-shrink:0; }
        .check-yes { background:#dcfce7; color:#16a34a; }
      </style>
      ${letterhead()}
      <div class="comp-border">
        <h1 style="text-align:center;font-size:28px;color:${S};margin-bottom:4px;">CERTIFICATE OF COMPLETION</h1>
        <p style="text-align:center;color:${A};font-size:13px;letter-spacing:0.08em;margin-bottom:28px;">${C.name}</p>

        <div class="section">
          <div class="section-title">Project Details</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;">
            <div><strong>Property Owner:</strong> ${esc(d.homeownerName)}</div>
            <div><strong>Start Date:</strong> ${esc(d.startDate)}</div>
            <div><strong>Property:</strong> ${esc(d.address)}</div>
            <div><strong>Completion Date:</strong> ${esc(d.completionDate)}</div>
            <div style="grid-column:1/-1;"><strong>Work Performed:</strong> ${esc(d.scopeSummary)}</div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Completion Verification</div>
          ${checklist.map(c => `<div class="check-item">
            <div class="check-icon ${c.checked?'check-yes':''}">&#10003;</div>
            <span>${esc(c.item)}</span>
          </div>`).join('')}
        </div>

        <div class="section">
          <div class="section-title">Final Inspection Photos</div>
          ${photoGrid(4,2)}
        </div>

        <div class="section" style="background:#f0fdf4;padding:20px;border-radius:8px;border:1px solid #bbf7d0;">
          <p style="font-size:14px;margin:0;color:#166534;">
            <strong>Warranty Activated:</strong> Your warranty coverage is now active as of ${esc(d.completionDate)}.
            Please retain this certificate along with your warranty certificate for your records.
          </p>
        </div>

        <div class="section" style="background:#f8f8f8;padding:20px;border-radius:8px;margin-top:16px;">
          <p style="font-size:14px;margin:0;">
            I confirm that the work described above has been completed to my satisfaction and I have inspected the
            finished project with the contractor.
          </p>
        </div>
      </div>
      ${sigBlock(['Homeowner','Authorized NBD Representative'])}
      ${footer('Certificate of Completion')}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 6: CHANGE ORDER
  // ═══════════════════════════════════════════════════════════════
  DG.renderChangeOrder = function(data) {
    const d = Object.assign({ homeownerName:'[Homeowner Name]', address:'[Property Address]',
      originalContractNumber:'[Contract #]', originalContractDate:'[Original Date]',
      changeOrderNumber:'CO-001', changesDescription:'Additional work identified during project execution.',
      itemsAdded:[{item:'Replace damaged fascia board (north side)',qty:24,unit:'LF',price:14}],
      itemsRemoved:[],
      originalTotal:12500, scheduleImpact:'No change to estimated completion date.' }, data);

    let addedTotal=0, removedTotal=0;
    const addedRows = d.itemsAdded.map(i => { const t=(i.qty||0)*(i.price||0); addedTotal+=t;
      return `<tr><td>${esc(i.item)}</td><td class="right">${i.qty}</td><td>${esc(i.unit)}</td><td class="right">${money(i.price)}</td><td class="right">${money(t)}</td></tr>`; }).join('');
    const removedRows = d.itemsRemoved.map(i => { const t=(i.qty||0)*(i.price||0); removedTotal+=t;
      return `<tr><td>${esc(i.item)}</td><td class="right">${i.qty}</td><td>${esc(i.unit)}</td><td class="right">${money(i.price)}</td><td class="right" style="color:#dc2626;">-${money(t)}</td></tr>`; }).join('');
    const netChange = addedTotal - removedTotal;
    const newTotal = (d.originalTotal||0) + netChange;

    return page('Change Order', `
      ${letterhead()}
      <h1 style="text-align:center;font-size:24px;color:${S};margin:24px 0 8px;">CHANGE ORDER</h1>
      <p style="text-align:center;color:#666;margin-bottom:28px;font-size:13px;">
        Change Order #${esc(d.changeOrderNumber)} | Original Contract: ${esc(d.originalContractNumber)}</p>

      <div class="section">
        <div class="section-title">Reference Information</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;">
          <div><strong>Homeowner:</strong> ${esc(d.homeownerName)}</div>
          <div><strong>Original Contract Date:</strong> ${esc(d.originalContractDate)}</div>
          <div><strong>Property:</strong> ${esc(d.address)}</div>
          <div><strong>Change Order Date:</strong> ${today()}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Description of Changes</div>
        <p style="font-size:14px;">${esc(d.changesDescription)}</p>
      </div>

      ${addedRows ? `<div class="section">
        <div class="section-title">Items Added</div>
        <table class="items"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>${addedRows}</tbody></table>
      </div>` : ''}

      ${removedRows ? `<div class="section">
        <div class="section-title">Items Removed / Credited</div>
        <table class="items"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Price</th><th>Credit</th></tr></thead>
        <tbody>${removedRows}</tbody></table>
      </div>` : ''}

      <div class="section" style="background:#f8f8f8;padding:24px;border-radius:8px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;text-align:center;">
          <div><div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;">Original Total</div>
            <div style="font-size:22px;font-weight:700;color:#333;">${money(d.originalTotal)}</div></div>
          <div><div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;">Change Amount</div>
            <div style="font-size:22px;font-weight:700;color:${netChange>=0?A:'#16a34a'};">${netChange>=0?'+':''}${money(netChange)}</div></div>
          <div><div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;">New Total</div>
            <div style="font-size:22px;font-weight:700;color:${S};">${money(newTotal)}</div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Schedule Impact</div>
        <p style="font-size:14px;">${esc(d.scheduleImpact)}</p>
      </div>

      <div class="section" style="font-size:13px;color:#555;">
        <p>By signing below, both parties agree to the changes described in this change order. All other terms and
        conditions of the original contract remain in full force and effect.</p>
      </div>

      ${sigBlock(['Homeowner','Contractor — '+C.name])}
      ${footer('Change Order #'+d.changeOrderNumber)}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 7: INVOICE
  // ═══════════════════════════════════════════════════════════════
  DG.renderInvoice = function(data) {
    const d = Object.assign({ homeownerName:'[Homeowner Name]', address:'[Property Address]',
      homeownerPhone:'', homeownerEmail:'',
      invoiceNumber:'INV-'+(Date.now()%100000), invoiceDate:today(), dueDate:'Due upon receipt',
      lineItems:[
        {description:'Complete Roof Replacement — Architectural Shingles',qty:1,unit:'JOB',rate:12500},
        {description:'Ice & Water Shield Upgrade',qty:1,unit:'JOB',rate:850},
        {description:'Additional OSB Decking Replacement (4 sheets)',qty:4,unit:'SQ',rate:125}
      ],
      taxRate:0, paymentsReceived:6250,
      claimNumber:'', insuranceCompany:'',
      notes:'Thank you for choosing No Big Deal Home Solutions. We appreciate your business and trust in our team.' }, data);

    let subtotal = 0;
    const rows = d.lineItems.map(i => {
      const amt = (i.qty||0)*(i.rate||0); subtotal += amt;
      return `<tr><td>${esc(i.description)}</td><td class="right">${i.qty}</td><td>${esc(i.unit)}</td>
        <td class="right">${money(i.rate)}</td><td class="right">${money(amt)}</td></tr>`;
    }).join('');
    const tax = subtotal * (d.taxRate||0);
    const total = subtotal + tax;
    const balance = total - (d.paymentsReceived||0);

    return page('Invoice', `
      <style>
        .inv-balance { background:${A}; color:#fff; padding:20px 28px; border-radius:8px; text-align:center; margin:20px 0; }
        .inv-balance-label { font-size:12px; text-transform:uppercase; letter-spacing:0.1em; opacity:0.9; }
        .inv-balance-amount { font-size:36px; font-weight:700; margin-top:4px; }
      </style>
      ${letterhead()}
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;">
        <div>
          <h1 style="font-size:36px;color:${S};margin:0;">INVOICE</h1>
          <p style="color:#666;font-size:13px;margin:4px 0 0;">#${esc(d.invoiceNumber)}</p>
        </div>
        <div style="text-align:right;font-size:14px;">
          <div><strong>Invoice Date:</strong> ${esc(d.invoiceDate)}</div>
          <div><strong>Due Date:</strong> ${esc(d.dueDate)}</div>
          ${d.claimNumber ? `<div style="margin-top:8px;"><strong>Claim #:</strong> ${esc(d.claimNumber)}</div>
            <div><strong>Insurance:</strong> ${esc(d.insuranceCompany)}</div>` : ''}
        </div>
      </div>

      <div class="section" style="background:#f8f8f8;padding:20px;border-radius:8px;">
        <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Bill To</div>
        <div style="font-size:16px;font-weight:700;color:${S};">${esc(d.homeownerName)}</div>
        <div style="font-size:14px;color:#555;">${esc(d.address)}</div>
        ${d.homeownerPhone ? `<div style="font-size:14px;color:#555;">${esc(d.homeownerPhone)}</div>` : ''}
        ${d.homeownerEmail ? `<div style="font-size:14px;color:#555;">${esc(d.homeownerEmail)}</div>` : ''}
      </div>

      <div class="section">
        <table class="items">
          <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>

        <div style="max-width:300px;margin-left:auto;font-size:14px;">
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;">
            <span>Subtotal</span><span>${money(subtotal)}</span></div>
          ${d.taxRate ? `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;">
            <span>Tax (${(d.taxRate*100).toFixed(1)}%)</span><span>${money(tax)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-weight:700;">
            <span>Total</span><span>${money(total)}</span></div>
          ${d.paymentsReceived ? `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;color:#16a34a;">
            <span>Payments Received</span><span>-${money(d.paymentsReceived)}</span></div>` : ''}
        </div>
      </div>

      <div class="inv-balance">
        <div class="inv-balance-label">Balance Due</div>
        <div class="inv-balance-amount">${money(balance)}</div>
      </div>

      <div class="section" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div style="background:#f8f8f8;padding:16px;border-radius:8px;">
          <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Payment Methods</div>
          <div style="font-size:13px;line-height:1.8;">
            Check — payable to <strong>${C.name}</strong><br>
            Zelle — ${C.email}<br>
            Credit Card — ask for secure link<br>
            Financing — through Improvifi
          </div>
        </div>
        <div style="background:#fff8f5;padding:16px;border-radius:8px;border:1px solid #f0d0c0;">
          <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Late Payment</div>
          <div style="font-size:13px;line-height:1.8;color:#555;">
            Payment is due upon receipt unless otherwise agreed in writing. Accounts past 30 days may be
            subject to a 1.5% monthly finance charge.
          </div>
        </div>
      </div>

      ${d.notes ? `<div class="section" style="text-align:center;font-style:italic;color:#555;font-size:14px;
        padding:16px;border-top:1px solid #eee;margin-top:20px;">${esc(d.notes)}</div>` : ''}

      ${footer('Invoice #'+d.invoiceNumber)}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 8: COMPANY INTRO ONE-PAGER
  // ═══════════════════════════════════════════════════════════════
  DG.renderCompanyIntro = function(data) {
    const d = Object.assign({}, data);
    const services = [
      {icon:'🏠',name:'Roofing',desc:'Full replacements, repairs, and storm damage restoration'},
      {icon:'🧱',name:'Siding',desc:'Vinyl, fiber cement, LP SmartSide, and board & batten'},
      {icon:'🌧️',name:'Gutters',desc:'Seamless gutters, guards, downspouts, and drainage'},
      {icon:'🪟',name:'Windows & Doors',desc:'Energy-efficient upgrades and storm damage replacement'},
      {icon:'🎨',name:'Interior',desc:'Water damage repair, paint, drywall, flooring'},
      {icon:'⛈️',name:'Storm Damage',desc:'Full insurance claim management from inspection to completion'}
    ];

    return page('About No Big Deal Home Solutions', `
      <style>
        .intro-hero { background:linear-gradient(135deg,${S} 0%,#2a2a4e 100%); color:#fff;
          padding:48px 40px; border-radius:12px; text-align:center; margin-bottom:32px; }
        .intro-hero h1 { font-size:32px; margin:0 0 8px; color:#fff; }
        .intro-hero .tagline { color:${A}; font-size:18px; font-style:italic; }
        .svc-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin:20px 0; }
        .svc-card { background:#f8f8f8; border-radius:8px; padding:20px; text-align:center;
          border-top:3px solid ${A}; }
        .svc-icon { font-size:28px; margin-bottom:8px; }
        .svc-name { font-weight:700; font-size:15px; color:${S}; margin-bottom:4px;
          font-family:'Helvetica Neue',Arial,sans-serif; }
        .svc-desc { font-size:12px; color:#666; }
        .value-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:16px; margin:20px 0; }
        .value-card { display:flex; align-items:flex-start; gap:12px; padding:16px;
          background:#fff; border:1px solid #eee; border-radius:8px; }
        .value-icon { font-size:24px; flex-shrink:0; }
        .value-title { font-weight:700; font-size:14px; color:${S};
          font-family:'Helvetica Neue',Arial,sans-serif; }
        .value-desc { font-size:12px; color:#666; margin-top:2px; }
        .testimonial { background:#f8f8f8; border-left:4px solid ${A}; padding:16px 20px;
          margin:12px 0; border-radius:0 8px 8px 0; }
        .testimonial-text { font-style:italic; font-size:14px; color:#444; }
        .testimonial-name { font-size:12px; color:#666; margin-top:8px; font-style:normal; }
        .finance-cta { background:linear-gradient(135deg,${A} 0%,#e0712a 100%); color:#fff;
          padding:24px; border-radius:12px; text-align:center; margin:24px 0; }
      </style>

      <div class="intro-hero">
        <h1>${C.name}</h1>
        <div class="tagline">No Big Deal — We've Got You Covered</div>
        <p style="margin-top:16px;font-size:14px;opacity:0.9;max-width:500px;margin-left:auto;margin-right:auto;">
          Your trusted partner for roofing, exteriors, and storm damage restoration.
          We handle everything from the first inspection to the final nail — so you don't have to stress.</p>
      </div>

      <div class="section">
        <div class="section-title">Our Services</div>
        <div class="svc-grid">
          ${services.map(s => `<div class="svc-card"><div class="svc-icon">${s.icon}</div>
            <div class="svc-name">${s.name}</div><div class="svc-desc">${s.desc}</div></div>`).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Why Choose NBD?</div>
        <div class="value-grid">
          <div class="value-card"><div class="value-icon">🛡️</div><div>
            <div class="value-title">Warranty Protection</div>
            <div class="value-desc">Up to lifetime workmanship warranty plus full manufacturer coverage on all materials.</div></div></div>
          <div class="value-card"><div class="value-icon">📋</div><div>
            <div class="value-title">Insurance Specialists</div>
            <div class="value-desc">We handle the entire insurance claim process so you can focus on what matters.</div></div></div>
          <div class="value-card"><div class="value-icon">⭐</div><div>
            <div class="value-title">5-Star Service</div>
            <div class="value-desc">Exceptional service from first contact through final walkthrough and beyond.</div></div></div>
          <div class="value-card"><div class="value-icon">💰</div><div>
            <div class="value-title">Flexible Financing</div>
            <div class="value-desc">Affordable monthly payments through our partnership with Improvifi.</div></div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">What Our Customers Say</div>
        <div class="testimonial">
          <div class="testimonial-text">"They made the whole process feel like... no big deal. From filing the claim to the final cleanup,
          everything was handled professionally."</div>
          <div class="testimonial-name">— Satisfied Homeowner, Lexington KY</div>
        </div>
        <div class="testimonial">
          <div class="testimonial-text">"The crew was on time, cleaned up everything, and the roof looks amazing. Best contractor experience
          I've ever had."</div>
          <div class="testimonial-name">— Satisfied Homeowner, Georgetown KY</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Project Photos</div>
        ${photoGrid(4,2)}
      </div>

      <div class="finance-cta">
        <div style="font-size:20px;font-weight:700;">Flexible Financing Available</div>
        <div style="font-size:14px;margin-top:8px;opacity:0.9;">Through our partnership with Improvifi — affordable monthly payments with quick approval.</div>
      </div>

      <div style="text-align:center;padding:24px 0;border-top:2px solid ${A};">
        <div style="font-size:20px;font-weight:700;color:${S};font-family:'Helvetica Neue',Arial,sans-serif;">
          Schedule Your Free Inspection</div>
        <div style="font-size:18px;color:${A};font-weight:700;margin-top:8px;">${C.phone}</div>
        <div style="font-size:14px;color:#555;margin-top:4px;">${C.email} | ${C.website}</div>
      </div>
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 9: BEFORE & AFTER PHOTO REPORT
  // ═══════════════════════════════════════════════════════════════
  DG.renderBeforeAfterReport = function(data) {
    const d = Object.assign({ homeownerName:'[Homeowner Name]', address:'[Property Address]',
      projectType:'Roof Replacement', startDate:'[Start Date]', completionDate:today(),
      workDescription:'Complete tear-off and replacement of existing roofing system with new GAF Timberline HDZ architectural shingles, including new underlayment, flashing, ventilation, and gutters.',
      highlights:['Full roof system replacement with premium materials','New ridge vent ventilation system installed',
        'All flashing replaced at walls, pipes, and chimney','Seamless gutter system installed','Complete property cleanup with magnetic nail sweep'] }, data);

    return page('Before & After Report', `
      <style>
        .ba-header { background:${S}; color:#fff; padding:32px; border-radius:12px; margin-bottom:28px; text-align:center; }
        .ba-label { display:inline-block; padding:6px 20px; border-radius:20px; font-size:13px; font-weight:700;
          font-family:'Helvetica Neue',Arial,sans-serif; letter-spacing:0.06em; margin-bottom:16px; }
        .ba-before { background:#fee2e2; color:#dc2626; }
        .ba-after { background:#dcfce7; color:#16a34a; }
      </style>
      ${letterhead()}
      <div class="ba-header">
        <h1 style="margin:0;color:#fff;font-size:28px;">PROJECT DOCUMENTATION</h1>
        <p style="color:${A};margin:8px 0 0;font-size:14px;">Before & After Photo Report</p>
      </div>

      <div class="section">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;">
          <div><strong>Property Owner:</strong> ${esc(d.homeownerName)}</div>
          <div><strong>Project:</strong> ${esc(d.projectType)}</div>
          <div><strong>Address:</strong> ${esc(d.address)}</div>
          <div><strong>Completed:</strong> ${esc(d.completionDate)}</div>
        </div>
      </div>

      <div class="section">
        <div class="ba-label ba-before">BEFORE</div>
        <div class="section-title">Pre-Project Condition</div>
        ${photoGrid(6,3)}
        <p style="font-size:12px;color:#666;text-align:center;margin-top:8px;">
          Add captions describing damage or existing conditions below each photo.</p>
      </div>

      <div class="section">
        <div class="section-title">Work Performed</div>
        <p style="font-size:14px;">${esc(d.workDescription)}</p>
      </div>

      <div class="section">
        <div class="ba-label ba-after">AFTER</div>
        <div class="section-title">Completed Project</div>
        ${photoGrid(6,3)}
        <p style="font-size:12px;color:#666;text-align:center;margin-top:8px;">
          Add captions highlighting improvements and quality of work.</p>
      </div>

      <div class="section">
        <div class="section-title">Project Highlights</div>
        <ul style="font-size:14px;line-height:2;padding-left:24px;">
          ${d.highlights.map(h => `<li>${esc(h)}</li>`).join('')}
        </ul>
      </div>

      ${sigBlock(['Homeowner Acknowledgment'])}
      ${footer('Before & After Report')}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 10: FINANCING OPTIONS
  // ═══════════════════════════════════════════════════════════════
  DG.renderFinancingOptions = function(data) {
    const d = Object.assign({ homeownerName:'', totalPrice:10000 }, data);
    const price = parseFloat(d.totalPrice) || 10000;
    const plans = [
      { months:12, apr:0, label:'12 Months', badge:'0% Intro APR', color:'#16a34a',
        monthly: (price/12) },
      { months:36, apr:6.99, label:'36 Months', badge:'Low Rate', color:'#0ea5e9',
        monthly: (price * (6.99/100/12) * Math.pow(1+6.99/100/12,36)) / (Math.pow(1+6.99/100/12,36)-1) },
      { months:60, apr:9.99, label:'60 Months', badge:'Extended', color:'#7c3aed',
        monthly: (price * (9.99/100/12) * Math.pow(1+9.99/100/12,60)) / (Math.pow(1+9.99/100/12,60)-1) }
    ];

    return page('Financing Options', `
      <style>
        .fin-hero { background:linear-gradient(135deg,${S} 0%,#2a2a4e 100%); color:#fff;
          padding:40px; border-radius:12px; text-align:center; margin-bottom:28px; }
        .plan-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin:24px 0; }
        .plan-card { border:2px solid #eee; border-radius:12px; padding:24px; text-align:center;
          transition:border-color 0.2s; }
        .plan-card:hover { border-color:${A}; }
        .plan-badge { display:inline-block; padding:4px 12px; border-radius:12px; font-size:11px;
          font-weight:700; color:#fff; margin-bottom:12px; }
        .plan-monthly { font-size:36px; font-weight:700; color:${S}; }
        .plan-monthly span { font-size:14px; font-weight:400; color:#666; }
        .plan-details { font-size:13px; color:#666; margin-top:8px; }
        .step-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:20px; margin:24px 0; }
        .step-card { text-align:center; padding:20px; }
        .step-num { width:40px; height:40px; border-radius:50%; background:${A}; color:#fff;
          display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:700;
          margin:0 auto 12px; }
      </style>
      ${letterhead()}
      <div class="fin-hero">
        <h1 style="margin:0;color:#fff;font-size:28px;">FLEXIBLE FINANCING OPTIONS</h1>
        <p style="color:${A};margin:12px 0 0;font-size:16px;">
          Make your home improvement project affordable with easy monthly payments</p>
        ${d.homeownerName ? `<p style="margin:16px 0 0;font-size:14px;opacity:0.8;">Prepared for: ${esc(d.homeownerName)}</p>` : ''}
      </div>

      <div class="section" style="text-align:center;">
        <p style="font-size:16px;color:#555;">We've partnered with <strong style="color:${A};">Improvifi</strong> to offer
        flexible financing solutions. Get approved in minutes with no impact to your credit score for pre-qualification.</p>
        ${price ? `<div style="margin:20px 0;"><div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.06em;">
          Project Total</div><div style="font-size:32px;font-weight:700;color:${S};">${money(price)}</div></div>` : ''}
      </div>

      <div class="section">
        <div class="section-title">Choose Your Plan</div>
        <div class="plan-grid">
          ${plans.map(p => `<div class="plan-card">
            <div class="plan-badge" style="background:${p.color};">${p.badge}</div>
            <div style="font-size:16px;font-weight:700;color:${S};margin-bottom:4px;">${p.label}</div>
            <div class="plan-monthly">${money(p.monthly)}<span>/mo</span></div>
            <div class="plan-details">${p.apr}% APR | ${p.months} payments</div>
          </div>`).join('')}
        </div>
        <p style="font-size:11px;color:#999;text-align:center;">
          *Monthly payments are estimates. Actual terms subject to credit approval and may vary.</p>
      </div>

      <div class="section">
        <div class="section-title">How It Works</div>
        <div class="step-grid">
          <div class="step-card"><div class="step-num">1</div>
            <div style="font-weight:700;font-size:15px;color:${S};margin-bottom:4px;">Apply Online</div>
            <div style="font-size:13px;color:#666;">Quick 2-minute application. No hard credit pull for pre-qualification.</div></div>
          <div class="step-card"><div class="step-num">2</div>
            <div style="font-weight:700;font-size:15px;color:${S};margin-bottom:4px;">Get Approved</div>
            <div style="font-size:13px;color:#666;">Instant decision. See your rate and monthly payment options immediately.</div></div>
          <div class="step-card"><div class="step-num">3</div>
            <div style="font-weight:700;font-size:15px;color:${S};margin-bottom:4px;">Choose Your Plan</div>
            <div style="font-size:13px;color:#666;">Pick the payment plan that works best for your budget. Start your project!</div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Benefits of Financing</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;">
          <div style="padding:12px;background:#f8f8f8;border-radius:6px;">No money down options available</div>
          <div style="padding:12px;background:#f8f8f8;border-radius:6px;">Fixed monthly payments — no surprises</div>
          <div style="padding:12px;background:#f8f8f8;border-radius:6px;">No prepayment penalties</div>
          <div style="padding:12px;background:#f8f8f8;border-radius:6px;">Quick and easy application process</div>
        </div>
      </div>

      <div style="background:#f8f8f8;padding:20px;border-radius:8px;margin:24px 0;text-align:center;">
        <div style="font-size:18px;font-weight:700;color:${S};">Ready to Get Started?</div>
        <div style="font-size:14px;color:#555;margin-top:8px;">
          Call <strong style="color:${A};">${C.phone}</strong> or visit <strong style="color:${A};">${C.website}</strong></div>
      </div>

      <p style="font-size:10px;color:#999;text-align:center;margin-top:24px;">
        Subject to credit approval. Interest rates and terms may vary based on creditworthiness. Financing provided by
        Improvifi and its lending partners. ${C.name} is not a lender and does not make credit decisions.
        See Improvifi for full terms, conditions, and disclosures.</p>

      ${footer('Financing Options')}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 11: REFERRAL CARD
  // ═══════════════════════════════════════════════════════════════
  DG.renderReferralCard = function(data) {
    const d = Object.assign({}, data);

    return page('Referral Card', `
      <style>
        .ref-card { max-width:5.5in; margin:0 auto; border:3px solid ${A}; border-radius:16px;
          overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.1); }
        .ref-top { background:linear-gradient(135deg,${S} 0%,#2a2a4e 100%); color:#fff;
          padding:28px 24px; text-align:center; }
        .ref-top h2 { margin:0; font-size:22px; color:#fff; line-height:1.3; }
        .ref-body { padding:24px; background:#fff; }
        .ref-reward { background:#fff8f5; border:2px dashed ${A}; border-radius:8px;
          padding:16px; text-align:center; margin:16px 0; }
        .ref-steps { margin:16px 0; }
        .ref-step { display:flex; align-items:flex-start; gap:12px; margin:12px 0; font-size:14px; }
        .ref-step-num { width:28px; height:28px; border-radius:50%; background:${A}; color:#fff;
          display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; flex-shrink:0; }
        .ref-from { border-top:2px solid #eee; padding-top:16px; margin-top:20px; }
        .ref-contact { background:${S}; color:#fff; padding:16px; text-align:center;
          font-size:13px; line-height:1.8; }
      </style>

      <div class="ref-card">
        <div class="ref-top">
          <h2>KNOW SOMEONE WHO<br>NEEDS A NEW ROOF?</h2>
          <p style="margin:8px 0 0;font-size:14px;color:${A};">Refer them to ${C.name}!</p>
        </div>
        <div class="ref-body">
          <div class="ref-reward">
            <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">Referral Reward</div>
            <div style="font-size:20px;font-weight:700;color:${A};">Ask Us For Details!</div>
            <div style="font-size:12px;color:#888;margin-top:4px;">Earn rewards for every referral that becomes a project</div>
          </div>

          <div class="ref-steps">
            <div style="font-size:13px;font-weight:700;color:${S};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">How It Works</div>
            <div class="ref-step"><div class="ref-step-num">1</div><div>Share our number or pass along this card to someone you know</div></div>
            <div class="ref-step"><div class="ref-step-num">2</div><div>Have them mention your name when they call or schedule</div></div>
            <div class="ref-step"><div class="ref-step-num">3</div><div>Get rewarded once their project is completed!</div></div>
          </div>

          <div class="ref-from">
            <div style="font-size:12px;color:#666;margin-bottom:8px;">Referred by:</div>
            <div style="border-bottom:2px solid #333;height:28px;"></div>
          </div>
        </div>
        <div class="ref-contact">
          <strong>${C.name}</strong><br>
          ${C.phone} | ${C.email}<br>
          ${C.website}
        </div>
      </div>

      <p style="text-align:center;font-size:10px;color:#999;margin-top:20px;">
        Referral reward is paid after referred project is completed. See us for full program details and terms.</p>
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 12: ASSIGNMENT OF BENEFITS (AOB)
  // ═══════════════════════════════════════════════════════════════
  DG.renderAssignmentOfBenefits = function(data) {
    const d = Object.assign({ homeownerName:'[Homeowner Name]', address:'[Property Address]',
      claimNumber:'[Claim #]', policyNumber:'[Policy #]', insuranceCompany:'[Insurance Company]',
      dateOfLoss:'[Date of Loss]', scopeSummary:'Roof replacement and related repairs due to storm damage.' }, data);

    return page('Assignment of Benefits', `
      ${letterhead()}
      <h1 style="text-align:center;font-size:24px;color:${S};margin:24px 0 8px;">ASSIGNMENT OF BENEFITS</h1>
      <p style="text-align:center;color:#666;font-size:13px;margin-bottom:28px;">Insurance Claim Assignment Authorization</p>

      <div class="section">
        <div class="section-title">Policyholder Information</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;">
          <div><strong>Policyholder:</strong> ${esc(d.homeownerName)}</div>
          <div><strong>Claim #:</strong> ${esc(d.claimNumber)}</div>
          <div><strong>Property Address:</strong> ${esc(d.address)}</div>
          <div><strong>Policy #:</strong> ${esc(d.policyNumber)}</div>
          <div><strong>Insurance Company:</strong> ${esc(d.insuranceCompany)}</div>
          <div><strong>Date of Loss:</strong> ${esc(d.dateOfLoss)}</div>
        </div>
      </div>

      <div class="section" style="background:#f8f8f8;padding:24px;border-radius:8px;border-left:4px solid ${A};">
        <p style="font-size:14px;line-height:1.8;margin:0;">
          I, <strong>${esc(d.homeownerName)}</strong>, as the named insured and owner of the property located at
          <strong>${esc(d.address)}</strong>, do hereby assign and transfer to <strong>${C.name}</strong>
          all insurance rights, benefits, and proceeds under my insurance policy with <strong>${esc(d.insuranceCompany)}</strong>,
          Policy Number <strong>${esc(d.policyNumber)}</strong>, for Claim Number <strong>${esc(d.claimNumber)}</strong>,
          to the extent of the contract price for all work performed at the above property.
        </p>
      </div>

      <div class="section">
        <div class="section-title">Scope of Assignment</div>
        <p style="font-size:14px;line-height:1.8;">This assignment authorizes ${C.name} to:</p>
        <ul style="font-size:14px;line-height:2;padding-left:24px;">
          <li>Communicate directly with ${esc(d.insuranceCompany)} regarding the above-referenced claim</li>
          <li>Negotiate the scope of covered repairs and associated pricing</li>
          <li>Submit supplemental claims for additional damage discovered during the repair process</li>
          <li>Receive insurance proceeds and endorsements related to the work performed</li>
          <li>Pursue any and all remedies available under the insurance policy for work completed</li>
        </ul>
      </div>

      <div class="section">
        <div class="section-title">Work to Be Performed</div>
        <p style="font-size:14px;">${esc(d.scopeSummary)}</p>
      </div>

      <div class="section">
        <div class="section-title">Terms and Conditions</div>
        <ol style="font-size:13px;line-height:2;padding-left:24px;color:#444;">
          <li>This assignment does not relieve the policyholder of any obligations under the insurance policy, including the timely payment of any deductible or non-covered amounts.</li>
          <li>The policyholder retains the right to cancel this assignment upon written notice, provided that payment for all completed work has been satisfied in full.</li>
          <li>${C.name} agrees to perform all work in a professional manner consistent with industry standards and applicable building codes.</li>
          <li>Any insurance proceeds received in excess of the contract price shall be returned to the policyholder.</li>
          <li>This assignment is binding upon the heirs, successors, and assigns of the policyholder.</li>
        </ol>
      </div>

      <div class="section" style="background:#fff8f5;padding:20px;border-radius:8px;border:1px solid #f0d0c0;">
        <p style="font-size:13px;color:#555;margin:0;">
          <strong>Right to Rescind:</strong> You may cancel this assignment within three (3) business days of signing
          by providing written notice to ${C.name}. After the rescission period, cancellation is subject to
          payment for all work completed to date.
        </p>
      </div>

      ${sigBlock(['Property Owner / Policyholder','Witness','Authorized NBD Representative'])}
      ${footer('Assignment of Benefits — Claim #' + d.claimNumber)}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 13: MATERIAL DELIVERY NOTICE
  // ═══════════════════════════════════════════════════════════════
  DG.renderMaterialDelivery = function(data) {
    const d = Object.assign({ homeownerName:'[Homeowner Name]', address:'[Property Address]',
      deliveryDate:'[Delivery Date]', deliveryTime:'Between 7:00 AM and 12:00 PM',
      startDate:'[Project Start Date]',
      materials:[
        {item:'GAF Timberline HDZ Architectural Shingles',qty:'30 bundles',notes:'Color: Charcoal'},
        {item:'GAF FeltBuster Synthetic Underlayment',qty:'6 rolls',notes:''},
        {item:'GAF Cobra Ridge Vent',qty:'4 pieces',notes:''},
        {item:'Drip Edge Flashing (Aluminum)',qty:'120 LF',notes:'Color-matched'},
        {item:'Ice & Water Shield',qty:'2 rolls',notes:'Eaves and valleys'},
        {item:'Pipe Boot Flashings',qty:'4 units',notes:''},
        {item:'Starter Strip Shingles',qty:'6 bundles',notes:''},
        {item:'Roofing Nails (1.25")',qty:'4 boxes',notes:''}
      ] }, data);

    return page('Material Delivery Notice', `
      ${letterhead()}
      <h1 style="text-align:center;font-size:24px;color:${S};margin:24px 0 8px;">MATERIAL DELIVERY NOTICE</h1>
      <p style="text-align:center;color:#666;font-size:13px;margin-bottom:28px;">Advance Notice of Project Material Delivery</p>

      <div class="section" style="background:linear-gradient(135deg,${S} 0%,#2a2a4e 100%);color:#fff;padding:28px;border-radius:12px;">
        <p style="font-size:16px;line-height:1.8;margin:0;">
          Dear <strong>${esc(d.homeownerName)}</strong>,<br><br>
          We are writing to let you know that materials for your upcoming project will be delivered to your property.
          Below are the details for your reference.
        </p>
      </div>

      <div class="section" style="margin-top:24px;">
        <div class="section-title">Delivery Details</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:14px;">
          <div style="background:#f8f8f8;padding:16px;border-radius:8px;">
            <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Delivery Date</div>
            <div style="font-size:18px;font-weight:700;color:${S};">${esc(d.deliveryDate)}</div>
          </div>
          <div style="background:#f8f8f8;padding:16px;border-radius:8px;">
            <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Delivery Window</div>
            <div style="font-size:18px;font-weight:700;color:${S};">${esc(d.deliveryTime)}</div>
          </div>
          <div style="background:#f8f8f8;padding:16px;border-radius:8px;">
            <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Property</div>
            <div style="font-size:14px;font-weight:600;color:${S};">${esc(d.address)}</div>
          </div>
          <div style="background:#f8f8f8;padding:16px;border-radius:8px;">
            <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Project Start</div>
            <div style="font-size:14px;font-weight:600;color:${S};">${esc(d.startDate)}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Materials Being Delivered</div>
        <table class="items">
          <thead><tr><th>Material</th><th>Quantity</th><th>Notes</th></tr></thead>
          <tbody>${d.materials.map(m =>
            `<tr><td>${esc(m.item)}</td><td>${esc(m.qty)}</td><td>${esc(m.notes)}</td></tr>`
          ).join('')}</tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-title">What to Expect</div>
        <ul style="font-size:14px;line-height:2;padding-left:24px;">
          <li>Materials will be placed in your driveway or alongside the home — our crew will position them for easy access.</li>
          <li>A delivery truck will need clear access to your driveway. Please move vehicles if possible.</li>
          <li>You do not need to be home for delivery, but please ensure gates are accessible.</li>
          <li>Materials may remain on the property for 1–3 days before the crew arrives — this is normal.</li>
          <li>Do not move, open, or disturb delivered materials — our crew will handle everything on project day.</li>
        </ul>
      </div>

      <div class="section" style="background:#f0fdf4;padding:20px;border-radius:8px;border:1px solid #bbf7d0;">
        <p style="font-size:14px;margin:0;color:#166534;">
          <strong>Questions?</strong> Call us at <strong>${C.phone}</strong> or email <strong>${C.email}</strong>.
          We are always happy to help.
        </p>
      </div>

      ${footer('Material Delivery Notice')}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 14: STORM DAMAGE CHECKLIST
  // ═══════════════════════════════════════════════════════════════
  DG.renderStormChecklist = function(data) {
    const d = Object.assign({}, data);

    const sections = [
      { title:'Roof', icon:'🏠', items:[
        'Missing, cracked, or curling shingles',
        'Exposed or damaged underlayment',
        'Dents or dimples on ridge cap or vents',
        'Granule loss in gutters or around downspouts',
        'Damaged or displaced flashing',
        'Sagging areas or visible structural damage',
        'Exposed nail heads or lifted shingle tabs'
      ]},
      { title:'Gutters & Downspouts', icon:'🌧️', items:[
        'Dents, dings, or crush marks on gutters',
        'Gutters pulled away from fascia board',
        'Clogged or overflowing gutter runs',
        'Downspout damage or disconnection',
        'Pooling water or improper drainage'
      ]},
      { title:'Siding & Exterior', icon:'🧱', items:[
        'Cracked, chipped, or broken siding panels',
        'Holes or punctures from hail or debris',
        'Faded or discolored siding from storm impact',
        'Loose or missing trim or soffit',
        'Paint damage or peeling from moisture'
      ]},
      { title:'Windows & Doors', icon:'🪟', items:[
        'Cracked or shattered glass',
        'Damaged screens or frames',
        'Broken seals causing fogging between panes',
        'Water intrusion around window or door frames',
        'Damaged weatherstripping or caulk'
      ]},
      { title:'Interior Warning Signs', icon:'🏚️', items:[
        'Water stains on ceilings or walls',
        'Peeling paint or bubbling drywall',
        'Musty odor indicating moisture or mold',
        'Light visible through the roof in the attic',
        'Damp insulation in the attic'
      ]}
    ];

    return page('Storm Damage Checklist', `
      <style>
        .storm-hero { background:linear-gradient(135deg,#1e3a5f 0%,${S} 100%); color:#fff;
          padding:40px; border-radius:12px; text-align:center; margin-bottom:28px; }
        .check-section { margin-bottom:24px; border:1px solid #eee; border-radius:8px; overflow:hidden; }
        .check-header { display:flex; align-items:center; gap:12px; padding:16px 20px;
          background:#f8f8f8; border-bottom:1px solid #eee; }
        .check-list { padding:12px 20px; }
        .check-row { display:flex; align-items:center; gap:12px; padding:10px 0;
          border-bottom:1px solid #f5f5f5; font-size:14px; }
        .check-row:last-child { border-bottom:none; }
        .check-box { width:20px; height:20px; border:2px solid #ccc; border-radius:4px; flex-shrink:0; }
      </style>
      ${letterhead()}
      <div class="storm-hero">
        <h1 style="margin:0;color:#fff;font-size:28px;">STORM DAMAGE CHECKLIST</h1>
        <p style="color:${A};margin:12px 0 0;font-size:16px;">Free Inspection Reference Guide</p>
        <p style="margin:16px 0 0;font-size:13px;opacity:0.85;max-width:500px;margin-left:auto;margin-right:auto;">
          After a storm, use this checklist to identify potential damage to your property.
          Mark anything you notice and contact us for a professional inspection — always free, always no obligation.</p>
      </div>

      ${sections.map(s => `<div class="check-section">
        <div class="check-header">
          <span style="font-size:24px;">${s.icon}</span>
          <h3 style="margin:0;font-size:16px;color:${S};font-family:'Helvetica Neue',Arial,sans-serif;">${s.title}</h3>
        </div>
        <div class="check-list">
          ${s.items.map(i => `<div class="check-row">
            <div class="check-box"></div>
            <span>${esc(i)}</span>
          </div>`).join('')}
        </div>
      </div>`).join('')}

      <div class="section" style="background:${A};color:#fff;padding:28px;border-radius:12px;text-align:center;">
        <div style="font-size:20px;font-weight:700;">Found Damage? We Can Help.</div>
        <div style="font-size:14px;margin-top:8px;opacity:0.9;">
          Schedule your free, no-obligation inspection today.</div>
        <div style="font-size:22px;font-weight:700;margin-top:12px;">${C.phone}</div>
        <div style="font-size:13px;margin-top:4px;opacity:0.8;">${C.email} | ${C.website}</div>
      </div>

      <p style="font-size:10px;color:#999;text-align:center;margin-top:20px;">
        This checklist is for reference only and does not constitute a professional inspection.
        ${C.name} recommends a licensed contractor inspect any suspected damage. We provide free inspections with no obligation.</p>
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 15: INSURANCE CLAIM PROCESS GUIDE
  // ═══════════════════════════════════════════════════════════════
  DG.renderClaimGuide = function(data) {
    const d = Object.assign({}, data);

    const steps = [
      { num:1, title:'Document the Damage', desc:'Take photos and video of all visible damage from multiple angles. Include wide shots and close-ups. Note the date and time of the storm.', icon:'📸' },
      { num:2, title:'File Your Claim', desc:'Contact your insurance company to file a claim. Provide the date of loss, description of damage, and your policy number. Write down your claim number.', icon:'📞' },
      { num:3, title:'Schedule Your Free Inspection', desc:'Call us to schedule a no-cost professional inspection. We will document all damage using industry standards and create a comprehensive report.', icon:'🔍' },
      { num:4, title:'Meet the Adjuster', desc:'Your insurance company will send an adjuster to assess the damage. We will be there with you to ensure nothing is missed and all damage is properly documented.', icon:'🤝' },
      { num:5, title:'Review the Estimate', desc:'Once the insurance company issues their estimate, we will review it to ensure fair and accurate pricing. If anything is missing, we file a supplement on your behalf.', icon:'📋' },
      { num:6, title:'Approve & Schedule', desc:'After the claim is approved, we handle all scheduling, permits, and coordination. You simply approve the scope of work and we take care of everything else.', icon:'✅' },
      { num:7, title:'Project Completion', desc:'Our crew completes the work to the highest standard. We conduct a final walkthrough with you to ensure complete satisfaction before closing out the project.', icon:'🏠' }
    ];

    return page('Insurance Claim Process Guide', `
      <style>
        .guide-hero { background:linear-gradient(135deg,${S} 0%,#2a2a4e 100%); color:#fff;
          padding:40px; border-radius:12px; text-align:center; margin-bottom:32px; }
        .step-row { display:flex; align-items:flex-start; gap:20px; padding:20px 0;
          border-bottom:1px solid #f0f0f0; }
        .step-row:last-child { border-bottom:none; }
        .step-bubble { width:48px; height:48px; border-radius:50%; background:${A}; color:#fff;
          display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:700;
          flex-shrink:0; box-shadow:0 2px 8px rgba(232,114,12,0.3); }
        .step-content h3 { margin:0 0 6px; font-size:16px; color:${S}; font-family:'Helvetica Neue',Arial,sans-serif; }
        .step-content p { margin:0; font-size:14px; color:#555; line-height:1.6; }
        .faq-item { margin-bottom:16px; }
        .faq-q { font-weight:700; font-size:14px; color:${S}; margin-bottom:4px; }
        .faq-a { font-size:13px; color:#555; line-height:1.6; }
      </style>
      ${letterhead()}
      <div class="guide-hero">
        <h1 style="margin:0;color:#fff;font-size:28px;">YOUR INSURANCE CLAIM</h1>
        <h2 style="margin:8px 0 0;font-size:18px;color:${A};font-weight:400;">Step-by-Step Process Guide</h2>
        <p style="margin:16px 0 0;font-size:14px;opacity:0.9;max-width:500px;margin-left:auto;margin-right:auto;">
          Filing an insurance claim can feel overwhelming. This guide walks you through every step
          so you know exactly what to expect. We handle the hard parts — so it really is no big deal.</p>
      </div>

      <div class="section">
        <div class="section-title">The 7-Step Process</div>
        ${steps.map(s => `<div class="step-row">
          <div class="step-bubble">${s.num}</div>
          <div class="step-content">
            <h3>${s.icon} ${s.title}</h3>
            <p>${s.desc}</p>
          </div>
        </div>`).join('')}
      </div>

      <div class="section">
        <div class="section-title">Common Questions</div>
        <div class="faq-item">
          <div class="faq-q">Will filing a claim raise my insurance rates?</div>
          <div class="faq-a">Storm damage claims are typically classified as "Acts of God" and generally do not result in rate increases. Your insurance exists for exactly this purpose.</div>
        </div>
        <div class="faq-item">
          <div class="faq-q">What is my deductible?</div>
          <div class="faq-a">Your deductible is the amount you pay out of pocket before insurance covers the rest. It is listed on your policy declarations page. We can help you locate it.</div>
        </div>
        <div class="faq-item">
          <div class="faq-q">How long does the process take?</div>
          <div class="faq-a">Most claims are approved within 2–4 weeks. Once approved, we typically begin work within 1–2 weeks depending on crew and material availability.</div>
        </div>
        <div class="faq-item">
          <div class="faq-q">What if the insurance estimate is too low?</div>
          <div class="faq-a">We will review every line item. If the estimate does not cover the full scope of necessary repairs, we file a supplement with supporting documentation to get the claim adjusted.</div>
        </div>
      </div>

      <div class="section" style="background:${A};color:#fff;padding:28px;border-radius:12px;text-align:center;">
        <div style="font-size:20px;font-weight:700;">Ready to Get Started?</div>
        <div style="font-size:14px;margin-top:8px;opacity:0.9;">Call us today for your free inspection. We will walk you through every step.</div>
        <div style="font-size:22px;font-weight:700;margin-top:12px;">${C.phone}</div>
        <div style="font-size:13px;margin-top:4px;opacity:0.8;">${C.email} | ${C.website}</div>
      </div>

      ${footer('Insurance Claim Process Guide')}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 16: DOOR HANGER
  // ═══════════════════════════════════════════════════════════════
  DG.renderDoorHanger = function(data) {
    const d = Object.assign({}, data);

    return page('Door Hanger', `
      <style>
        .hanger { max-width:4in; margin:0 auto; border:2px solid ${A}; border-radius:16px;
          overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.1); }
        .hanger-top { background:linear-gradient(180deg,${S} 0%,#2a2a4e 100%); color:#fff;
          padding:32px 24px 24px; text-align:center; position:relative; }
        .hanger-hole { width:36px; height:36px; border-radius:50%; border:3px solid ${A};
          background:#fff; margin:0 auto 16px; }
        .hanger-body { padding:24px; background:#fff; }
        .hanger-cta { background:${A}; color:#fff; padding:16px; text-align:center;
          font-size:14px; font-weight:700; }
        .hanger-service { display:flex; align-items:center; gap:8px; padding:6px 0; font-size:13px; color:#333; }
        .hanger-dot { width:8px; height:8px; border-radius:50%; background:${A}; flex-shrink:0; }
      </style>

      <div class="hanger">
        <div class="hanger-top">
          <div class="hanger-hole"></div>
          <div style="font-size:12px;letter-spacing:0.15em;text-transform:uppercase;color:${A};margin-bottom:8px;">
            WE'RE IN YOUR NEIGHBORHOOD</div>
          <h2 style="margin:0;font-size:22px;color:#fff;line-height:1.3;">FREE ROOF<br>INSPECTION</h2>
          <p style="margin:12px 0 0;font-size:13px;opacity:0.85;">No cost. No obligation. No big deal.</p>
        </div>
        <div class="hanger-body">
          <p style="font-size:13px;color:#555;margin:0 0 16px;line-height:1.6;">
            Hi Neighbor! Our crew is working on a project nearby. While we are in the area, we would be happy
            to provide a complimentary roof and exterior inspection at no cost to you.</p>

          <div style="font-size:11px;font-weight:700;color:${S};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">
            Our Services</div>
          <div class="hanger-service"><div class="hanger-dot"></div>Roofing — replacements, repairs, storm damage</div>
          <div class="hanger-service"><div class="hanger-dot"></div>Siding — vinyl, fiber cement, LP SmartSide</div>
          <div class="hanger-service"><div class="hanger-dot"></div>Gutters — seamless systems and guards</div>
          <div class="hanger-service"><div class="hanger-dot"></div>Windows & Doors — energy-efficient upgrades</div>
          <div class="hanger-service"><div class="hanger-dot"></div>Insurance Claims — handled start to finish</div>

          <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;">
            <div style="font-size:12px;color:#666;">Licensed | Insured | Warranty-Backed</div>
          </div>
        </div>
        <div class="hanger-cta">
          CALL OR TEXT: ${C.phone}<br>
          <span style="font-size:12px;font-weight:400;opacity:0.9;">${C.website}</span>
        </div>
      </div>

      <p style="text-align:center;font-size:10px;color:#999;margin-top:24px;">
        Print on cardstock. Cut along the border. Hang on front door handle.</p>
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 17: NEIGHBORHOOD MAILER
  // ═══════════════════════════════════════════════════════════════
  DG.renderNeighborhoodMailer = function(data) {
    const d = Object.assign({ neighborhoodName:'[Your Neighborhood]', projectAddress:'[Nearby Project Address]' }, data);

    return page('Neighborhood Mailer', `
      <style>
        .mailer { max-width:6in; margin:0 auto; border:2px solid #eee; border-radius:12px;
          overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08); }
        .mailer-top { background:linear-gradient(135deg,${S} 0%,#2a2a4e 100%); color:#fff;
          padding:36px 32px; text-align:center; }
        .mailer-body { padding:32px; background:#fff; }
        .mailer-stat { text-align:center; padding:16px; }
        .mailer-stat-num { font-size:28px; font-weight:700; color:${A}; font-family:'Helvetica Neue',Arial,sans-serif; }
        .mailer-stat-label { font-size:11px; color:#666; text-transform:uppercase; letter-spacing:0.06em; margin-top:4px; }
        .mailer-footer { background:#f8f8f8; padding:20px 32px; text-align:center; }
      </style>

      <div class="mailer">
        <div class="mailer-top">
          <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${A};margin-bottom:12px;">
            ATTENTION: ${esc(d.neighborhoodName)} RESIDENTS</div>
          <h1 style="margin:0;color:#fff;font-size:26px;line-height:1.3;">
            WE JUST COMPLETED A<br>PROJECT NEAR YOU</h1>
          <p style="margin:12px 0 0;font-size:14px;opacity:0.85;">
            Your neighbor at ${esc(d.projectAddress)} trusted ${C.name} — and so can you.</p>
        </div>
        <div class="mailer-body">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;border-bottom:1px solid #eee;padding-bottom:24px;">
            <div class="mailer-stat"><div class="mailer-stat-num">5★</div><div class="mailer-stat-label">Customer Rating</div></div>
            <div class="mailer-stat"><div class="mailer-stat-num">100%</div><div class="mailer-stat-label">Satisfaction</div></div>
            <div class="mailer-stat"><div class="mailer-stat-num">0</div><div class="mailer-stat-label">Cost for Inspection</div></div>
          </div>

          <p style="font-size:14px;color:#333;line-height:1.7;margin:0 0 20px;">
            Whether your home was affected by the same storm or you have been thinking about an upgrade,
            we would love the opportunity to take a look. Our inspections are always free, and there is
            never any pressure or obligation.</p>

          <div style="background:#fff8f5;border-radius:8px;padding:16px;border-left:4px solid ${A};margin-bottom:20px;">
            <div style="font-size:14px;font-weight:700;color:${S};margin-bottom:4px;">
              Ask about our neighbor referral program!</div>
            <div style="font-size:13px;color:#555;">
              Earn rewards for every referral that turns into a completed project.</div>
          </div>

          <div style="text-align:center;padding:20px;background:${A};border-radius:8px;color:#fff;">
            <div style="font-size:18px;font-weight:700;">Schedule Your Free Inspection</div>
            <div style="font-size:22px;font-weight:700;margin-top:8px;">${C.phone}</div>
            <div style="font-size:13px;margin-top:4px;opacity:0.9;">${C.email} | ${C.website}</div>
          </div>
        </div>
        <div class="mailer-footer">
          <div style="font-size:12px;color:#666;">
            ${C.name} | Licensed & Insured | Lexington, KY & Surrounding Areas</div>
        </div>
      </div>
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 18: CUSTOMER TESTIMONIAL SHEET
  // ═══════════════════════════════════════════════════════════════
  DG.renderTestimonialSheet = function(data) {
    const d = Object.assign({}, data);

    const testimonials = [
      { text:'They made the whole process feel like no big deal. From filing the claim to the final cleanup, everything was handled professionally and on time.', name:'Satisfied Homeowner', location:'Lexington, KY', project:'Roof Replacement', rating:5 },
      { text:'The crew was on time, cleaned up everything, and the roof looks amazing. Best contractor experience I have ever had. Highly recommend.', name:'Satisfied Homeowner', location:'Georgetown, KY', project:'Roof & Gutters', rating:5 },
      { text:'Joe and his team walked us through the entire insurance claim process. We did not have to stress about a single thing. The new roof looks incredible.', name:'Satisfied Homeowner', location:'Nicholasville, KY', project:'Insurance Restoration', rating:5 },
      { text:'Professional from start to finish. They showed up when they said they would, did exactly what they said they would do, and left the property cleaner than they found it.', name:'Satisfied Homeowner', location:'Versailles, KY', project:'Siding Replacement', rating:5 }
    ];

    return page('Customer Testimonials', `
      <style>
        .test-hero { background:linear-gradient(135deg,${S} 0%,#2a2a4e 100%); color:#fff;
          padding:40px; border-radius:12px; text-align:center; margin-bottom:32px; }
        .test-card { background:#fff; border:1px solid #eee; border-radius:12px; padding:24px;
          margin-bottom:16px; box-shadow:0 1px 4px rgba(0,0,0,0.06); position:relative; }
        .test-quote { font-size:48px; color:${A}; opacity:0.3; position:absolute; top:8px; left:16px;
          font-family:Georgia,serif; line-height:1; }
        .test-stars { color:#fbbf24; font-size:16px; letter-spacing:2px; margin-bottom:8px; }
        .test-text { font-size:15px; color:#333; line-height:1.7; font-style:italic; padding-left:20px;
          border-left:3px solid ${A}; margin:12px 0; }
        .test-meta { display:flex; justify-content:space-between; font-size:12px; color:#666; margin-top:12px; }
      </style>
      ${letterhead()}
      <div class="test-hero">
        <h1 style="margin:0;color:#fff;font-size:28px;">WHAT OUR CUSTOMERS SAY</h1>
        <p style="color:${A};margin:12px 0 0;font-size:16px;">Real Reviews From Real Homeowners</p>
        <div style="display:flex;justify-content:center;gap:24px;margin-top:20px;">
          <div><div style="font-size:28px;font-weight:700;">5.0</div><div style="font-size:12px;opacity:0.8;">Average Rating</div></div>
          <div><div style="font-size:28px;font-weight:700;">100%</div><div style="font-size:12px;opacity:0.8;">Would Recommend</div></div>
        </div>
      </div>

      ${testimonials.map(t => `<div class="test-card">
        <div class="test-quote">&ldquo;</div>
        <div class="test-stars">${'★'.repeat(t.rating)}</div>
        <div class="test-text">${esc(t.text)}</div>
        <div class="test-meta">
          <span><strong>${esc(t.name)}</strong> — ${esc(t.location)}</span>
          <span>${esc(t.project)}</span>
        </div>
      </div>`).join('')}

      <div class="section" style="text-align:center;margin-top:28px;">
        <div style="font-size:18px;font-weight:700;color:${S};">Join Our Growing List of Happy Homeowners</div>
        <div style="font-size:14px;color:#555;margin-top:8px;">
          Schedule your free inspection and see why our customers love working with us.</div>
        <div style="font-size:22px;font-weight:700;color:${A};margin-top:12px;">${C.phone}</div>
        <div style="font-size:13px;color:#666;margin-top:4px;">${C.email} | ${C.website}</div>
      </div>

      ${footer('Customer Testimonials')}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 19: THANK YOU LETTER
  // ═══════════════════════════════════════════════════════════════
  DG.renderThankYou = function(data) {
    const d = Object.assign({ homeownerName:'[Homeowner Name]', address:'[Property Address]',
      projectType:'roof replacement', completionDate:today() }, data);

    return page('Thank You Letter', `
      ${letterhead()}
      <div style="max-width:6in;margin:24px auto;font-size:15px;line-height:2;color:#333;">
        <p style="text-align:right;color:#666;font-size:13px;margin-bottom:28px;">${esc(d.completionDate)}</p>

        <p>Dear ${esc(d.homeownerName)},</p>

        <p>On behalf of everyone at ${C.name}, I want to personally thank you for trusting us with your
        recent ${esc(d.projectType)} project at ${esc(d.address)}. It was a privilege to work on your home,
        and we hope the experience lived up to our promise — no stress, no hassle, no big deal.</p>

        <p>We take enormous pride in every project we complete, and your satisfaction is the single most
        important measure of our success. If anything about your experience was less than exceptional, or
        if there is anything we can do to improve, please do not hesitate to reach out.</p>

        <p><strong>A few things to keep in mind going forward:</strong></p>

        <p style="padding-left:20px;border-left:3px solid ${A};">
          <strong>Your Warranty:</strong> Your workmanship warranty is now active. Keep your warranty certificate
          in a safe place. If you ever notice an issue, call us first — we stand behind every project we touch.<br><br>
          <strong>Maintenance:</strong> We recommend a visual check of your roof after any major storm. If you see
          anything that concerns you, give us a call and we will come take a look at no charge.<br><br>
          <strong>Referrals:</strong> If you know anyone who could benefit from our services, we would be grateful
          for the introduction. Ask us about our referral program — it is our way of saying thanks.
        </p>

        <p>Once again, thank you for choosing ${C.name}. It truly means the world to our team.</p>

        <p>If you have a moment, we would greatly appreciate a review on Google. It helps other homeowners
        find a contractor they can trust, and it lets our team know we are on the right track.</p>

        <p style="margin-top:32px;">
          With gratitude,<br><br>
          <strong>Joe Deal</strong><br>
          <span style="font-size:13px;color:#666;">Owner, ${C.name}</span><br>
          <span style="font-size:13px;color:#666;">${C.phone} | ${C.email}</span>
        </p>
      </div>
      ${footer('Thank You Letter')}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // TEMPLATE 20: PAYMENT AGREEMENT
  // ═══════════════════════════════════════════════════════════════
  DG.renderPaymentAgreement = function(data) {
    const d = Object.assign({ homeownerName:'[Homeowner Name]', address:'[Property Address]',
      totalAmount:'0.00', depositAmount:'0.00', depositDue:'Upon contract signing',
      progressAmount:'0.00', progressDue:'Upon material delivery',
      finalAmount:'0.00', finalDue:'Upon project completion',
      projectDescription:'Complete roof replacement per attached scope of work and contract.' }, data);

    const total = parseFloat(d.totalAmount)||0;
    const deposit = parseFloat(d.depositAmount)||0;
    const progress = parseFloat(d.progressAmount)||0;
    const final = parseFloat(d.finalAmount)||0;

    return page('Payment Agreement', `
      ${letterhead()}
      <h1 style="text-align:center;font-size:24px;color:${S};margin:24px 0 8px;">PAYMENT AGREEMENT</h1>
      <p style="text-align:center;color:#666;font-size:13px;margin-bottom:28px;">Payment Schedule & Terms</p>

      <div class="section">
        <div class="section-title">Project Information</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px;">
          <div><strong>Property Owner:</strong> ${esc(d.homeownerName)}</div>
          <div><strong>Date:</strong> ${today()}</div>
          <div><strong>Property:</strong> ${esc(d.address)}</div>
          <div><strong>Total Contract Amount:</strong> <span style="color:${A};font-weight:700;font-size:16px;">${money(total)}</span></div>
        </div>
        <p style="font-size:14px;margin-top:12px;">${esc(d.projectDescription)}</p>
      </div>

      <div class="section">
        <div class="section-title">Payment Schedule</div>
        <table class="items">
          <thead><tr><th>Payment</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td><strong>1. Deposit</strong></td><td class="right">${money(deposit)}</td><td>${esc(d.depositDue)}</td>
              <td><span class="badge" style="background:#fef3c7;color:#92400e;">Pending</span></td></tr>
            <tr><td><strong>2. Progress Payment</strong></td><td class="right">${money(progress)}</td><td>${esc(d.progressDue)}</td>
              <td><span class="badge" style="background:#f3f4f6;color:#6b7280;">Upcoming</span></td></tr>
            <tr><td><strong>3. Final Payment</strong></td><td class="right">${money(final)}</td><td>${esc(d.finalDue)}</td>
              <td><span class="badge" style="background:#f3f4f6;color:#6b7280;">Upcoming</span></td></tr>
            <tr style="font-weight:700;border-top:3px solid ${A};">
              <td>TOTAL</td><td class="right" style="color:${A};font-size:16px;">${money(total)}</td>
              <td colspan="2"></td></tr>
          </tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-title">Accepted Payment Methods</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;text-align:center;">
          <div style="padding:16px;background:#f8f8f8;border-radius:8px;font-size:13px;">
            <div style="font-size:24px;margin-bottom:4px;">💰</div>Check</div>
          <div style="padding:16px;background:#f8f8f8;border-radius:8px;font-size:13px;">
            <div style="font-size:24px;margin-bottom:4px;">📱</div>Zelle</div>
          <div style="padding:16px;background:#f8f8f8;border-radius:8px;font-size:13px;">
            <div style="font-size:24px;margin-bottom:4px;">💳</div>Credit Card</div>
          <div style="padding:16px;background:#f8f8f8;border-radius:8px;font-size:13px;">
            <div style="font-size:24px;margin-bottom:4px;">🏦</div>Financing</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Terms and Conditions</div>
        <ol style="font-size:13px;line-height:2;padding-left:24px;color:#444;">
          <li>All payments are due as specified above. Late payments may be subject to a 1.5% monthly finance charge.</li>
          <li>Checks should be made payable to <strong>${C.name}</strong>.</li>
          <li>For Zelle payments, send to <strong>${C.email}</strong>.</li>
          <li>Credit card payments are accepted via secure link provided by ${C.name}. A convenience fee may apply.</li>
          <li>Financing is available through Improvifi, subject to credit approval and separate terms.</li>
          <li>Work will not commence until the deposit payment has been received and verified.</li>
          <li>Final payment is due upon completion of the project and successful final walkthrough.</li>
          <li>Any disputed amounts must be communicated in writing within 10 days of the payment due date.</li>
        </ol>
      </div>

      <div class="section" style="background:#f8f8f8;padding:24px;border-radius:8px;">
        <p style="font-size:14px;margin:0;">
          By signing below, both parties acknowledge and agree to the payment schedule and terms outlined in
          this document. This agreement is supplemental to the primary project contract.
        </p>
      </div>

      ${sigBlock(['Property Owner','Authorized NBD Representative'])}
      ${footer('Payment Agreement')}
    `);
  };

  // ═══════════════════════════════════════════════════════════════
  // REGISTER ALL DOCUMENT TYPES (extended)
  // ═══════════════════════════════════════════════════════════════
  Object.assign(DG.DOCUMENT_TYPES, {
    assignment_of_benefits: { name: 'Assignment of Benefits', template: 'renderAssignmentOfBenefits' },
    material_delivery: { name: 'Material Delivery Notice', template: 'renderMaterialDelivery' },
    storm_checklist: { name: 'Storm Damage Checklist', template: 'renderStormChecklist' },
    claim_guide: { name: 'Insurance Claim Process Guide', template: 'renderClaimGuide' },
    door_hanger: { name: 'Door Hanger', template: 'renderDoorHanger' },
    neighborhood_mailer: { name: 'Neighborhood Mailer', template: 'renderNeighborhoodMailer' },
    testimonial_sheet: { name: 'Customer Testimonial Sheet', template: 'renderTestimonialSheet' },
    thank_you: { name: 'Thank You Letter', template: 'renderThankYou' },
    payment_agreement: { name: 'Payment Agreement', template: 'renderPaymentAgreement' }
  });

  // ═══════════════════════════════════════════════════════════════
  // REGISTER FILL FORM FIELDS FOR NEW TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  if (DG.FORM_FIELDS) {
    Object.assign(DG.FORM_FIELDS, {
      warranty_certificate: ['homeownerName','address','warrantyTier','workPerformed','issueDate'],
      supplement_request: ['homeownerName','address','claimNumber','policyNumber','insuranceCompany','dateOfLoss','originalApproved','justification'],
      scope_of_work: ['homeownerName','address','projectDescription','materials','estimatedTimeline','exclusions'],
      work_authorization: ['homeownerName','address','scopeSummary','startDate','emergencyContact','accessInstructions','isInsurance','claimNumber','insuranceCompany'],
      certificate_of_completion: ['homeownerName','address','scopeSummary','startDate','completionDate','inspectorName'],
      change_order: ['homeownerName','address','originalContractNumber','originalContractDate','changeOrderNumber','changesDescription','originalTotal','scheduleImpact'],
      invoice: ['homeownerName','address','homeownerPhone','homeownerEmail','invoiceNumber','dueDate','taxRate','paymentsReceived','claimNumber','insuranceCompany','notes'],
      company_intro: [],
      before_after_report: ['homeownerName','address','projectType','startDate','completionDate','workDescription'],
      financing_options: ['homeownerName','totalPrice'],
      referral_card: [],
      assignment_of_benefits: ['homeownerName','address','claimNumber','policyNumber','insuranceCompany','dateOfLoss','scopeSummary'],
      material_delivery: ['homeownerName','address','deliveryDate','deliveryTime','startDate'],
      storm_checklist: [],
      claim_guide: [],
      door_hanger: [],
      neighborhood_mailer: ['neighborhoodName','projectAddress'],
      testimonial_sheet: [],
      thank_you: ['homeownerName','address','projectType','completionDate'],
      payment_agreement: ['homeownerName','address','totalAmount','depositAmount','depositDue','progressAmount','progressDue','finalAmount','finalDue','projectDescription']
    });
  }

  console.log('NBDDocGen: 20 additional templates loaded');
})();

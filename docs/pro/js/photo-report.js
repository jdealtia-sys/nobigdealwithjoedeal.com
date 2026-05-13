/**
 * NBD Pro — Photo Report Generator
 * One-click before/after report that pulls actual photos from a lead
 * and generates a beautiful branded PDF-ready HTML document.
 *
 * Exposes: window.generatePhotoReport(leadId)
 */

(function() {
  'use strict';

  // Brand strings only. All visual styling (color/type/space) comes
  // from nbd-brand.css — the same locked token set that drives the
  // homeowner portal, share-link pages, and any other customer-facing
  // surface. Photo system Phase 1 (2026-05-13): every customer artifact
  // must come out of one brand source so the PDF a homeowner gets emailed
  // looks like the portal they were already shown.
  const BRAND = {
    name: 'No Big Deal Home Solutions',
    phone: '(859) 420-7382',
    email: 'info@nobigdeal.pro',
    website: 'nobigdealwithjoedeal.com'
  };

  /**
   * Generate a before/after photo report for a lead
   * Opens in a new window for print-to-PDF
   * @param {string} leadId
   */
  async function generatePhotoReport(leadId) {
    leadId = leadId || window._customerId || window._cardDetailLeadId;
    if (!leadId || !window._user) {
      if (typeof showToast === 'function') showToast(!window._user ? 'Must be logged in' : 'No customer selected', 'error');
      return;
    }

    if (typeof showToast === 'function') showToast('Building photo report...', 'ok');

    try {
      // Get lead data
      const lead = (window._leads || []).find(l => l.id === leadId);
      if (!lead) throw new Error('Lead not found');

      // Load all photos for this lead
      let photos = [];
      try {
        const snap = await window.getDocs(window.query(
          window.collection(window.db, 'photos'),
          window.where('leadId', '==', leadId),
          window.where('userId', '==', window._user.uid)
        ));
        photos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch(e) { console.warn('Photo load failed:', e.message); }

      if (photos.length === 0) {
        if (typeof showToast === 'function') showToast('No photos found for this lead — upload some first', 'error');
        return;
      }

      // Sort photos by createdAt
      photos.sort((a, b) => {
        const aT = a.createdAt?.seconds || 0;
        const bT = b.createdAt?.seconds || 0;
        return aT - bT;
      });

      // Split into before/after using phase, tag, type, or category fields
      const getPhase = p => (p.phase || p.tag || p.type || p.category || '').toLowerCase();
      const beforePhotos = photos.filter(p => getPhase(p).includes('before'));
      const duringPhotos = photos.filter(p => getPhase(p).includes('during'));
      const afterPhotos = photos.filter(p => getPhase(p).includes('after'));

      let before, during, after;
      const hasPhases = beforePhotos.length > 0 || duringPhotos.length > 0 || afterPhotos.length > 0;
      if (hasPhases) {
        before = beforePhotos;
        during = duringPhotos;
        after = afterPhotos;
      } else {
        // No phase tags at all — show all as "Project Photos" (don't guess)
        before = photos;
        during = [];
        after = [];
      }

      const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim() || 'Homeowner';
      const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      const html = buildReportHTML(lead, name, before, during, after, now, hasPhases);

      // Route through the Universal Document Viewer so the user
      // can Print or Download PDF via the action bar instead of
      // being dumped into a blank popup.
      if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
        const slug = (name || 'photos').replace(/[^A-Za-z0-9]+/g, '-').substring(0, 40);
        window.NBDDocViewer.open({
          html: html,
          title: 'Photo Report — ' + name,
          filename: 'NBD-PhotoReport-' + slug + '-' + new Date().toISOString().split('T')[0] + '.pdf',
          onSave: async () => {
            if (typeof showToast === 'function') {
              showToast('\u2713 Photo report ready \u2014 Print or Download PDF from the action bar', 'ok');
            }
          }
        });
      } else {
        // Fallback: legacy popup
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); }
      }

      if (typeof showToast === 'function') showToast('Photo report generated — print to PDF', 'ok');
    } catch(e) {
      console.error('Photo report failed:', e);
      if (typeof showToast === 'function') showToast('Report generation failed: ' + e.message, 'error');
    }
  }

  function buildReportHTML(lead, name, before, during, after, dateStr, hasPhases) {
    const photoGrid = (photos) => photos.map(p => `
      <div class="photo-tile">
        <img src="${p.url}" alt="${p.name || 'Photo'}">
        ${p.name ? `<div class="photo-tile-cap">${p.name}</div>` : ''}
      </div>
    `).join('');

    return `<!DOCTYPE html>
<html data-nbd-brand="true">
<head>
<meta charset="UTF-8">
<title>Photo Report — ${name}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700;800&display=swap">
<link rel="stylesheet" href="/pro/css/nbd-brand.css">
<style>
  /* Photo report layout — every color/type/space pulls from
     nbd-brand.css so the PDF a homeowner receives looks identical to
     the portal they were already shown. NO local color or font values. */
  @media print { body{margin:0;} .no-print{display:none!important;} @page{margin:0.5in;} }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{
    font-family: var(--nbd-font-body);
    color: var(--nbd-ink);
    line-height: var(--nbd-leading-body);
    background: var(--nbd-bg);
  }
  .header{
    background: linear-gradient(135deg, var(--nbd-bg-tint), var(--nbd-bg));
    border-bottom: 1px solid var(--nbd-line);
    padding: var(--nbd-space-8) var(--nbd-space-8);
    text-align: center;
  }
  .header h1{
    font-family: var(--nbd-font-display);
    font-size: var(--nbd-text-2xl);
    font-weight: 800;
    color: var(--nbd-ink);
    letter-spacing: var(--nbd-tracking-wide);
    margin-bottom: var(--nbd-space-2);
  }
  .header .sub{
    color: var(--nbd-orange);
    font-size: var(--nbd-text-sm);
    letter-spacing: var(--nbd-tracking-wider);
    text-transform: uppercase;
    font-weight: 700;
  }
  .brand-bar{
    display:flex; align-items:center; justify-content:space-between;
    padding: var(--nbd-space-3) var(--nbd-space-8);
    background: var(--nbd-bg-elevated);
    border-bottom: 1px solid var(--nbd-line);
    font-size: var(--nbd-text-xs);
    color: var(--nbd-ink-muted);
    gap: var(--nbd-space-4);
  }
  .brand-bar-left{ display:flex; align-items:center; gap: var(--nbd-space-3); min-width:0; }
  .brand-bar-name{
    font-family: var(--nbd-font-display);
    font-weight: 800;
    color: var(--nbd-ink);
    text-transform: uppercase;
    letter-spacing: var(--nbd-tracking-wide);
  }
  .brand-logo{ height:36px; width:auto; display:block; flex-shrink:0; }
  .content{ max-width: 800px; margin: 0 auto; padding: var(--nbd-space-8); }
  .section{ margin-bottom: var(--nbd-space-8); }
  .section-label{
    display: inline-block;
    padding: 5px 14px;
    border-radius: var(--nbd-radius-pill);
    font-size: var(--nbd-text-xs);
    font-weight: 700;
    font-family: var(--nbd-font-body);
    letter-spacing: var(--nbd-tracking-wider);
    text-transform: uppercase;
    margin-bottom: var(--nbd-space-3);
    border: 1px solid transparent;
  }
  .before-label{ background: var(--nbd-danger-soft);  color: var(--nbd-danger);     border-color: rgba(220,38,38,.25); }
  .during-label{ background: var(--nbd-orange-soft);  color: var(--nbd-orange-ink); border-color: var(--nbd-orange-medium); }
  .after-label { background: var(--nbd-success-soft); color: var(--nbd-success);    border-color: rgba(22,163,74,.25); }
  .section-title{
    font-family: var(--nbd-font-display);
    font-size: var(--nbd-text-lg);
    font-weight: 700;
    color: var(--nbd-ink);
    margin-bottom: var(--nbd-space-4);
  }
  .photo-grid{
    display:grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--nbd-space-3);
  }
  .photo-tile{
    background: var(--nbd-bg-elevated);
    border: 1px solid var(--nbd-line);
    border-radius: var(--nbd-radius-md);
    overflow: hidden;
    break-inside: avoid;
  }
  .photo-tile img{ width:100%; height:200px; object-fit:cover; display:block; background: var(--nbd-bg-sunken); }
  .photo-tile-cap{
    padding: var(--nbd-space-2) var(--nbd-space-3);
    font-size: var(--nbd-text-xs);
    color: var(--nbd-ink-muted);
    line-height: var(--nbd-leading-snug);
    text-align: center;
  }
  .info-row{
    display:grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--nbd-space-3);
    margin-bottom: var(--nbd-space-6);
    font-size: var(--nbd-text-sm);
    color: var(--nbd-ink);
  }
  .info-row strong{ color: var(--nbd-ink); font-weight: 700; }
  .footer{
    text-align:center;
    padding: var(--nbd-space-6);
    border-top: 1px solid var(--nbd-line);
    margin-top: var(--nbd-space-10);
    font-size: var(--nbd-text-xs);
    color: var(--nbd-ink-muted);
  }
  .footer strong{ color: var(--nbd-ink); font-family: var(--nbd-font-display); letter-spacing: var(--nbd-tracking-wide); text-transform: uppercase; }
  .top-bar{
    position:fixed; top:0; left:0; right:0; height:52px;
    background: var(--nbd-bg-elevated);
    border-bottom: 1px solid var(--nbd-line);
    display:flex; align-items:center; justify-content:space-between;
    padding: 0 var(--nbd-space-5);
    z-index:1000;
    box-shadow: var(--nbd-shadow-sm);
    font-family: var(--nbd-font-body);
  }
  .top-bar-btn{
    padding: 8px 16px;
    background: var(--nbd-bg-sunken);
    border: 1px solid var(--nbd-line);
    border-radius: var(--nbd-radius-md);
    color: var(--nbd-ink);
    font-weight: 700;
    font-size: var(--nbd-text-sm);
    cursor: pointer;
  }
  .top-bar-btn-primary{
    background: var(--nbd-orange);
    border-color: var(--nbd-orange);
    color: var(--nbd-ink-on-orange);
  }
  .top-bar-btn-primary:hover{ background: var(--nbd-orange-deep); }
</style>
</head>
<body class="nbd-brand">
<div class="no-print top-bar">
  <div style="display:flex;align-items:center;gap: 12px;">
    <button onclick="window.close()" class="top-bar-btn">&#8592; Close</button>
    <span style="color: var(--nbd-ink-muted); font-size: var(--nbd-text-sm);">Photo Report</span>
  </div>
  <button onclick="window.print()" class="top-bar-btn top-bar-btn-primary">Print / Save PDF</button>
</div>
<div style="height:52px;"></div>

<div class="header">
  <h1>PROJECT DOCUMENTATION</h1>
  <div class="sub">Before &amp; After Photo Report</div>
</div>
<div class="brand-bar">
  <div class="brand-bar-left">
    <img class="brand-logo" src="/assets/images/nbd-logo.png" alt="${BRAND.name}" />
    <span class="brand-bar-name">${BRAND.name}</span>
  </div>
  <span>${BRAND.phone} &nbsp;·&nbsp; ${BRAND.email}</span>
</div>

<div class="content">
  <div class="info-row">
    <div><strong>Property Owner:</strong> ${name}</div>
    <div><strong>Project:</strong> ${lead.jobType || lead.damageType || 'Exterior'}</div>
    <div><strong>Address:</strong> ${lead.address || ''}</div>
    <div><strong>Date:</strong> ${dateStr}</div>
  </div>

  ${before.length > 0 ? `<div class="section">
    <div class="section-label before-label">${hasPhases ? 'BEFORE' : 'PROJECT PHOTOS'}</div>
    <div class="section-title">${hasPhases ? 'Pre-Project Condition' : 'Documentation'} (${before.length} photos)</div>
    <div class="photo-grid">${photoGrid(before)}</div>
  </div>` : ''}

  ${lead.scopeOfWork ? `
  <div class="section">
    <div class="section-title">Work Performed</div>
    <p style="font-size: var(--nbd-text-sm); color: var(--nbd-ink);">${lead.scopeOfWork}</p>
  </div>` : ''}

  ${during.length > 0 ? `<div class="section">
    <div class="section-label during-label">DURING</div>
    <div class="section-title">Work In Progress (${during.length} photos)</div>
    <div class="photo-grid">${photoGrid(during)}</div>
  </div>` : ''}

  ${after.length > 0 ? `<div class="section">
    <div class="section-label after-label">AFTER</div>
    <div class="section-title">Completed Project (${after.length} photos)</div>
    <div class="photo-grid">${photoGrid(after)}</div>
  </div>` : ''}

  <div class="footer">
    <strong>${BRAND.name}</strong><br>
    ${BRAND.phone} &nbsp;·&nbsp; ${BRAND.email} &nbsp;·&nbsp; ${BRAND.website}<br>
    <em>We Put Our Name On It</em>
  </div>
</div>
</body>
</html>`;
  }

  window.generatePhotoReport = generatePhotoReport;

})();

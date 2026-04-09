/**
 * NBD Pro — Photo Report Generator
 * One-click before/after report that pulls actual photos from a lead
 * and generates a beautiful branded PDF-ready HTML document.
 *
 * Exposes: window.generatePhotoReport(leadId)
 */

(function() {
  'use strict';

  const BRAND = {
    name: 'No Big Deal Home Solutions',
    phone: '(859) 420-7382',
    email: 'info@nobigdeal.pro',
    website: 'nobigdealwithjoedeal.com',
    navy: '#1e3a6e',
    orange: '#e8720c',
    dark: '#1a1a2e'
  };

  /**
   * Generate a before/after photo report for a lead
   * Opens in a new window for print-to-PDF
   * @param {string} leadId
   */
  async function generatePhotoReport(leadId) {
    if (!leadId || !window._user) {
      if (typeof showToast === 'function') showToast('Must be logged in', 'error');
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

      // Split into before/after — first half = before, second half = after
      // If photos have tags, use those instead
      const beforePhotos = photos.filter(p => (p.tag || p.type || '').toLowerCase().includes('before'));
      const afterPhotos = photos.filter(p => (p.tag || p.type || '').toLowerCase().includes('after'));

      let before, after;
      if (beforePhotos.length > 0 || afterPhotos.length > 0) {
        before = beforePhotos.length > 0 ? beforePhotos : photos.slice(0, Math.ceil(photos.length / 2));
        after = afterPhotos.length > 0 ? afterPhotos : photos.slice(Math.ceil(photos.length / 2));
      } else {
        // No tags — split by time (older = before, newer = after)
        const midpoint = Math.ceil(photos.length / 2);
        before = photos.slice(0, midpoint);
        after = photos.slice(midpoint);
      }

      const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim() || 'Homeowner';
      const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      const html = buildReportHTML(lead, name, before, after, now);

      // Open in new window
      const win = window.open('', '_blank');
      win.document.write(html);
      win.document.close();

      if (typeof showToast === 'function') showToast('Photo report generated — print to PDF', 'ok');
    } catch(e) {
      console.error('Photo report failed:', e);
      if (typeof showToast === 'function') showToast('Report generation failed: ' + e.message, 'error');
    }
  }

  function buildReportHTML(lead, name, before, after, dateStr) {
    const photoGrid = (photos) => photos.map(p => `
      <div style="break-inside:avoid;">
        <img src="${p.url}" alt="${p.name || 'Photo'}"
             style="width:100%;height:200px;object-fit:cover;border-radius:8px;display:block;">
        ${p.name ? `<div style="font-size:11px;color:#666;margin-top:4px;text-align:center;">${p.name}</div>` : ''}
      </div>
    `).join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Before & After Report — ${name}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
@media print { body{margin:0;} .no-print{display:none!important;} @page{margin:0.5in;} }
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter',sans-serif;color:#1a1a2e;line-height:1.6;background:#fff;}
.header{background:linear-gradient(135deg,${BRAND.navy},${BRAND.dark});color:#fff;padding:40px 32px;text-align:center;}
.header h1{font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;margin-bottom:6px;}
.header .sub{color:${BRAND.orange};font-size:14px;}
.brand-bar{display:flex;justify-content:space-between;padding:12px 32px;background:#f8f9fa;border-bottom:2px solid ${BRAND.navy};font-size:12px;color:#666;}
.content{max-width:800px;margin:0 auto;padding:32px;}
.section{margin-bottom:32px;}
.section-label{display:inline-block;padding:6px 20px;border-radius:20px;font-size:13px;font-weight:700;font-family:'Barlow Condensed',sans-serif;letter-spacing:.06em;margin-bottom:16px;}
.before-label{background:#fee2e2;color:#dc2626;}
.after-label{background:#dcfce7;color:#16a34a;}
.section-title{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:${BRAND.navy};margin-bottom:16px;}
.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;}
.info-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;font-size:14px;}
.info-row strong{color:${BRAND.navy};}
.highlights{list-style:none;padding:0;}
.highlights li{padding:8px 0;border-bottom:1px solid #eee;font-size:14px;display:flex;align-items:center;gap:8px;}
.highlights li::before{content:'✓';color:${BRAND.orange};font-weight:700;}
.footer{text-align:center;padding:24px;border-top:2px solid ${BRAND.navy};margin-top:40px;font-size:12px;color:#888;}
.print-btn{position:fixed;bottom:20px;right:20px;padding:12px 24px;background:${BRAND.orange};color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.2);z-index:100;}
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">🖨️ Print to PDF</button>

<div class="header">
  <h1>PROJECT DOCUMENTATION</h1>
  <div class="sub">Before & After Photo Report</div>
</div>
<div class="brand-bar">
  <span>${BRAND.name}</span>
  <span>${BRAND.phone} | ${BRAND.email}</span>
</div>

<div class="content">
  <div class="info-row">
    <div><strong>Property Owner:</strong> ${name}</div>
    <div><strong>Project:</strong> ${lead.jobType || lead.damageType || 'Exterior'}</div>
    <div><strong>Address:</strong> ${lead.address || ''}</div>
    <div><strong>Date:</strong> ${dateStr}</div>
  </div>

  <div class="section">
    <div class="section-label before-label">BEFORE</div>
    <div class="section-title">Pre-Project Condition (${before.length} photos)</div>
    <div class="photo-grid">${photoGrid(before)}</div>
  </div>

  ${lead.scopeOfWork || lead.notes ? `
  <div class="section">
    <div class="section-title">Work Performed</div>
    <p style="font-size:14px;color:#333;">${lead.scopeOfWork || lead.notes || ''}</p>
  </div>` : ''}

  <div class="section">
    <div class="section-label after-label">AFTER</div>
    <div class="section-title">Completed Project (${after.length} photos)</div>
    <div class="photo-grid">${photoGrid(after)}</div>
  </div>

  <div class="footer">
    <strong>${BRAND.name}</strong><br>
    ${BRAND.phone} | ${BRAND.email} | ${BRAND.website}<br>
    <em>${BRAND.name} — No Big Deal, We've Got You Covered</em>
  </div>
</div>
</body>
</html>`;
  }

  window.generatePhotoReport = generatePhotoReport;

})();

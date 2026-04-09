/**
 * NBD Pro — Shareable Photo Gallery Generator
 * Generates a beautiful standalone gallery page that can be shared
 * with homeowners, adjusters, or anyone via link. No login required.
 *
 * Pattern: Generates HTML → uploads to Firebase Storage → returns share URL
 * Follows the same pattern as customer-portal.js
 *
 * Exposes: window.ShareGallery
 */

(function() {
  'use strict';

  const BRAND = {
    name: 'No Big Deal Home Solutions',
    phone: '(859) 420-7382',
    email: 'info@nobigdeal.pro',
    website: 'nobigdealwithjoedeal.com',
    navy: '#1e3a6e',
    orange: '#C8541A',
    dark: '#1a1a2e'
  };

  /**
   * Generate and share a photo gallery for a lead
   * @param {string} leadId
   * @returns {Promise<string>} The shareable URL
   */
  async function generate(leadId) {
    if (!window._user) { alert('Please log in first.'); return; }
    if (!leadId) { alert('No customer selected.'); return; }

    const toast = window.showToast ? window.showToast : (msg) => alert(msg);
    toast('Generating shareable gallery...', 'info');

    try {
      // 1. Load lead data
      const leadSnap = await window.getDoc(window.doc(window.db, 'leads', leadId));
      if (!leadSnap.exists()) { toast('Customer not found', 'error'); return; }
      const lead = leadSnap.data();
      const customerName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Customer';
      const address = lead.address || '';

      // 2. Load all photos for this lead
      const photosSnap = await window.getDocs(
        window.query(window.collection(window.db, 'photos'), window.where('leadId', '==', leadId))
      );

      if (photosSnap.empty) {
        toast('No photos to share for this customer.', 'error');
        return;
      }

      const photos = [];
      photosSnap.forEach(doc => {
        const data = doc.data();
        photos.push({
          url: data.url,
          phase: data.phase || 'During',
          category: data.category || 'Property',
          description: data.description || data.notes || '',
          filename: data.filename || '',
          date: data.date?.toDate ? data.date.toDate().toLocaleDateString() : data.uploadedAt?.toDate ? data.uploadedAt.toDate().toLocaleDateString() : ''
        });
      });

      // 3. Group by phase
      const phases = { 'Before': [], 'During': [], 'After': [] };
      photos.forEach(p => {
        const phase = phases[p.phase] ? p.phase : 'During';
        phases[phase].push(p);
      });

      // 4. Generate HTML
      const html = buildGalleryHTML(customerName, address, lead.damageType || '', photos, phases);

      // 5. Upload to Firebase Storage
      const blob = new Blob([html], { type: 'text/html' });
      const storageRef = window.ref(window.storage, `galleries/${window._user.uid}/${leadId}.html`);
      await window.uploadBytes(storageRef, blob, { contentType: 'text/html' });
      const shareUrl = await window.getDownloadURL(storageRef);

      // 6. Save URL to lead doc
      await window.updateDoc(window.doc(window.db, 'leads', leadId), {
        galleryUrl: shareUrl,
        galleryGeneratedAt: window.serverTimestamp()
      });

      // 7. Show share options
      showShareDialog(shareUrl, customerName, lead.phone, lead.email, photos.length);

      return shareUrl;
    } catch (error) {
      console.error('Gallery generation error:', error);
      toast('Failed to generate gallery. ' + error.message, 'error');
    }
  }

  /**
   * Build the standalone gallery HTML page
   */
  function buildGalleryHTML(customerName, address, damageType, photos, phases) {
    const totalPhotos = photos.length;
    const phaseCount = Object.entries(phases).filter(([_, p]) => p.length > 0).length;

    let photosHTML = '';
    Object.entries(phases).forEach(([phaseName, phasePhotos]) => {
      if (phasePhotos.length === 0) return;

      photosHTML += `
        <div class="phase-section">
          <h2 class="phase-title">${phaseName} Phase <span class="phase-count">${phasePhotos.length} photo${phasePhotos.length !== 1 ? 's' : ''}</span></h2>
          <div class="photo-grid">
            ${phasePhotos.map((p, i) => `
              <div class="photo-card" onclick="openLightbox('${p.url.replace(/'/g, "\\'")}', '${(p.description || p.category).replace(/'/g, "\\'")}')">
                <img src="${p.url}" alt="${p.description || 'Photo'}" loading="lazy">
                <div class="photo-overlay">
                  <div class="photo-label">${p.category}${p.date ? ' • ' + p.date : ''}</div>
                  ${p.description ? `<div class="photo-desc">${p.description}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });

    // If no phases had photos, show all in one grid
    if (!photosHTML) {
      photosHTML = `
        <div class="phase-section">
          <h2 class="phase-title">Project Photos <span class="phase-count">${totalPhotos} photo${totalPhotos !== 1 ? 's' : ''}</span></h2>
          <div class="photo-grid">
            ${photos.map(p => `
              <div class="photo-card" onclick="openLightbox('${p.url.replace(/'/g, "\\'")}', '${(p.description || p.category).replace(/'/g, "\\'")}')">
                <img src="${p.url}" alt="${p.description || 'Photo'}" loading="lazy">
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Project Photos — ${customerName} | ${BRAND.name}</title>
  <meta name="robots" content="noindex, nofollow">
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Barlow', sans-serif;
      background: #0f0f1a;
      color: #e0e0e0;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.dark} 100%);
      padding: 32px 24px;
      text-align: center;
      border-bottom: 3px solid ${BRAND.orange};
    }
    .brand-logo {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    .brand-mark {
      background: ${BRAND.orange};
      color: white;
      font-family: 'Barlow Condensed', sans-serif;
      font-weight: 800;
      font-size: 20px;
      padding: 8px 14px;
      border-radius: 8px;
      letter-spacing: 1px;
    }
    .brand-name {
      font-family: 'Barlow Condensed', sans-serif;
      font-weight: 700;
      font-size: 22px;
      color: white;
    }
    .header h1 {
      font-family: 'Barlow Condensed', sans-serif;
      font-size: 28px;
      font-weight: 700;
      color: white;
      margin-bottom: 8px;
    }
    .header-meta {
      font-size: 14px;
      color: rgba(255,255,255,.6);
    }
    .header-meta span { margin: 0 8px; }
    .stats-bar {
      display: flex;
      justify-content: center;
      gap: 32px;
      padding: 16px 24px;
      background: rgba(255,255,255,.05);
      border-bottom: 1px solid rgba(255,255,255,.08);
    }
    .stat { text-align: center; }
    .stat-num {
      font-family: 'Barlow Condensed', sans-serif;
      font-size: 28px;
      font-weight: 700;
      color: ${BRAND.orange};
    }
    .stat-label { font-size: 12px; color: rgba(255,255,255,.5); text-transform: uppercase; letter-spacing: .5px; }
    .content { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .phase-section { margin-bottom: 40px; }
    .phase-title {
      font-family: 'Barlow Condensed', sans-serif;
      font-size: 22px;
      font-weight: 700;
      color: white;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid ${BRAND.orange};
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .phase-count {
      font-size: 13px;
      font-weight: 400;
      color: rgba(255,255,255,.4);
    }
    .photo-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 16px;
    }
    .photo-card {
      position: relative;
      border-radius: 12px;
      overflow: hidden;
      background: #1a1a2e;
      cursor: pointer;
      transition: transform .2s, box-shadow .2s;
      aspect-ratio: 4/3;
    }
    .photo-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 40px rgba(0,0,0,.5);
    }
    .photo-card img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .photo-overlay {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(transparent, rgba(0,0,0,.85));
      padding: 24px 12px 12px;
    }
    .photo-label {
      font-size: 12px;
      color: ${BRAND.orange};
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .5px;
    }
    .photo-desc {
      font-size: 13px;
      color: rgba(255,255,255,.7);
      margin-top: 4px;
    }
    /* Lightbox */
    .lightbox {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(0,0,0,.95);
      align-items: center;
      justify-content: center;
      flex-direction: column;
    }
    .lightbox.active { display: flex; }
    .lightbox img {
      max-width: 90vw;
      max-height: 80vh;
      object-fit: contain;
      border-radius: 8px;
    }
    .lightbox-caption {
      color: rgba(255,255,255,.7);
      margin-top: 12px;
      font-size: 14px;
    }
    .lightbox-close {
      position: absolute;
      top: 20px;
      right: 24px;
      background: none;
      border: none;
      color: white;
      font-size: 36px;
      cursor: pointer;
      z-index: 10;
    }
    .footer {
      text-align: center;
      padding: 32px 24px;
      background: rgba(255,255,255,.03);
      border-top: 1px solid rgba(255,255,255,.08);
      margin-top: 40px;
    }
    .footer-brand {
      font-family: 'Barlow Condensed', sans-serif;
      font-size: 16px;
      font-weight: 600;
      color: ${BRAND.orange};
      margin-bottom: 8px;
    }
    .footer-contact { font-size: 13px; color: rgba(255,255,255,.4); }
    .footer-contact a { color: ${BRAND.orange}; text-decoration: none; }
    @media (max-width: 600px) {
      .photo-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
      .header h1 { font-size: 22px; }
      .stats-bar { gap: 16px; }
    }
  </style>
</head>
<body>

<div class="header">
  <div class="brand-logo">
    <div class="brand-mark">NBD</div>
    <div class="brand-name">${BRAND.name}</div>
  </div>
  <h1>Project Photos — ${customerName}</h1>
  <div class="header-meta">
    ${address ? `<span>${address}</span>` : ''}
    ${damageType ? `<span>•</span><span>${damageType} Damage</span>` : ''}
  </div>
</div>

<div class="stats-bar">
  <div class="stat"><div class="stat-num">${totalPhotos}</div><div class="stat-label">Total Photos</div></div>
  <div class="stat"><div class="stat-num">${phaseCount}</div><div class="stat-label">Phase${phaseCount !== 1 ? 's' : ''}</div></div>
</div>

<div class="content">
  ${photosHTML}
</div>

<div class="footer">
  <div class="footer-brand">${BRAND.name}</div>
  <div class="footer-contact">
    <a href="tel:${BRAND.phone.replace(/\D/g, '')}">${BRAND.phone}</a>
    <span style="margin:0 8px;">•</span>
    <a href="mailto:${BRAND.email}">${BRAND.email}</a>
    <span style="margin:0 8px;">•</span>
    <a href="https://${BRAND.website}">${BRAND.website}</a>
  </div>
</div>

<div class="lightbox" id="lightbox" onclick="closeLightbox()">
  <button class="lightbox-close" onclick="closeLightbox()">&times;</button>
  <img id="lightboxImg" src="" alt="Photo">
  <div class="lightbox-caption" id="lightboxCaption"></div>
</div>

<script>
  function openLightbox(url, caption) {
    document.getElementById('lightboxImg').src = url;
    document.getElementById('lightboxCaption').textContent = caption || '';
    document.getElementById('lightbox').classList.add('active');
  }
  function closeLightbox() {
    document.getElementById('lightbox').classList.remove('active');
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
</script>

</body>
</html>`;
  }

  /**
   * Show share dialog with SMS, Email, and Copy Link options
   */
  function showShareDialog(url, customerName, phone, email, photoCount) {
    const existingDialog = document.getElementById('nbd-share-dialog');
    if (existingDialog) existingDialog.remove();

    const firstName = (customerName || '').split(' ')[0] || 'there';
    const smsBody = encodeURIComponent(`Hey ${firstName}, here are your project photos from No Big Deal Home Solutions: ${url}`);
    const emailSubject = encodeURIComponent(`Your Project Photos — ${BRAND.name}`);
    const emailBody = encodeURIComponent(`Hi ${firstName},\n\nHere's a link to view all the photos from your project:\n\n${url}\n\nIf you have any questions, don't hesitate to reach out!\n\n— Joe\n${BRAND.name}\n${BRAND.phone}`);

    const dialog = document.createElement('div');
    dialog.id = 'nbd-share-dialog';
    dialog.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);';
    dialog.innerHTML = `
      <div style="background:#1a1a2e;border-radius:16px;padding:28px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.1);">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:700;color:#fff;margin-bottom:4px;">Gallery Ready to Share</div>
        <div style="font-size:13px;color:rgba(255,255,255,.5);margin-bottom:20px;">${photoCount || ''} photos for ${customerName}</div>

        <div style="background:rgba(255,255,255,.05);border-radius:10px;padding:12px;margin-bottom:20px;display:flex;align-items:center;gap:8px;">
          <input type="text" value="${url}" readonly style="flex:1;background:none;border:none;color:#fff;font-size:12px;outline:none;font-family:monospace;" id="nbd-share-url">
          <button onclick="navigator.clipboard.writeText('${url.replace(/'/g, "\\'")}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000);" style="background:#C8541A;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;white-space:nowrap;">Copy</button>
        </div>

        <div style="display:flex;gap:10px;margin-bottom:16px;">
          ${phone ? `<a href="sms:${phone.replace(/\D/g, '')}?body=${smsBody}" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:#25d366;color:#fff;padding:12px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;">💬 Text</a>` : ''}
          ${email ? `<a href="mailto:${email}?subject=${emailSubject}&body=${emailBody}" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:#0088ff;color:#fff;padding:12px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;">📧 Email</a>` : ''}
          <button onclick="window.open('${url.replace(/'/g, "\\'")}','_blank')" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:rgba(255,255,255,.1);color:#fff;padding:12px;border-radius:10px;border:none;cursor:pointer;font-weight:600;font-size:14px;">👁 Preview</button>
        </div>

        <button onclick="document.getElementById('nbd-share-dialog').remove()" style="width:100%;background:rgba(255,255,255,.08);color:rgba(255,255,255,.6);border:none;padding:12px;border-radius:10px;cursor:pointer;font-size:14px;">Close</button>
      </div>
    `;

    document.body.appendChild(dialog);
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });
  }

  // Expose API
  window.ShareGallery = { generate };

})();

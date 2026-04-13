/**
 * NBD Pro — Customer Portal Generator
 * Generates a beautiful standalone customer-facing portal page
 * that can be shared via link. Homeowners see their project status,
 * photos, documents, and timeline — no login required.
 *
 * Pattern: Generates HTML → uploads to Firebase Storage → returns share URL
 * Follows the same pattern as close-board.js deal rooms.
 *
 * Exposes: window.CustomerPortal
 */

(function() {
  'use strict';

  const PORTAL_COLLECTION = 'portals';
  const BRAND = {
    name: 'No Big Deal Home Solutions',
    phone: '(859) 420-7382',
    email: 'info@nobigdeal.pro',
    website: 'nobigdealwithjoedeal.com',
    tagline: 'No Big Deal — We\'ve Got You Covered',
    navy: '#1e3a6e',
    orange: '#e8720c',
    dark: '#1a1a2e'
  };

  // Stage display config — maps internal stage keys to customer-friendly labels
  const STAGE_DISPLAY = {
    new:                        { label: 'Getting Started', progress: 5, icon: '📋' },
    contacted:                  { label: 'In Contact', progress: 10, icon: '📞' },
    inspected:                  { label: 'Inspection Complete', progress: 20, icon: '🔍' },
    claim_filed:                { label: 'Claim Filed', progress: 25, icon: '📄' },
    adjuster_meeting_scheduled: { label: 'Adjuster Meeting Scheduled', progress: 30, icon: '📅' },
    adjuster_inspection_done:   { label: 'Adjuster Inspection Done', progress: 35, icon: '✅' },
    scope_received:             { label: 'Scope Received', progress: 40, icon: '📋' },
    estimate_submitted:         { label: 'Estimate Submitted', progress: 45, icon: '💰' },
    supplement_requested:       { label: 'Supplement in Review', progress: 50, icon: '📝' },
    supplement_approved:        { label: 'Supplement Approved', progress: 55, icon: '✅' },
    estimate_sent_cash:         { label: 'Estimate Sent', progress: 45, icon: '💰' },
    negotiating:                { label: 'Finalizing Details', progress: 55, icon: '🤝' },
    prequal_sent:               { label: 'Financing in Progress', progress: 50, icon: '🏦' },
    loan_approved:              { label: 'Financing Approved', progress: 55, icon: '✅' },
    contract_signed:            { label: 'Contract Signed', progress: 60, icon: '✍️' },
    job_created:                { label: 'Job Created', progress: 65, icon: '🔨' },
    permit_pulled:              { label: 'Permits Secured', progress: 70, icon: '📋' },
    materials_ordered:          { label: 'Materials Ordered', progress: 75, icon: '📦' },
    materials_delivered:        { label: 'Materials Delivered', progress: 80, icon: '🚛' },
    crew_scheduled:             { label: 'Crew Scheduled', progress: 85, icon: '👷' },
    install_in_progress:        { label: 'Installation in Progress', progress: 90, icon: '🏗️' },
    install_complete:           { label: 'Installation Complete', progress: 95, icon: '🏠' },
    final_photos:               { label: 'Final Inspection', progress: 97, icon: '📸' },
    deductible_collected:       { label: 'Wrapping Up', progress: 98, icon: '💳' },
    final_payment:              { label: 'Final Payment', progress: 99, icon: '💰' },
    closed:                     { label: 'Project Complete!', progress: 100, icon: '🎉' }
  };

  /**
   * Generate and share the customer portal for a lead
   * @param {string} leadId
   */
  async function generatePortal(leadId) {
    if (!leadId || !window._user) {
      if (typeof showToast === 'function') showToast('Must be logged in', 'error');
      return null;
    }

    if (typeof showToast === 'function') showToast('Generating customer portal...', 'ok');

    try {
      // Gather all lead data
      const lead = (window._leads || []).find(l => l.id === leadId);
      if (!lead) throw new Error('Lead not found');

      // Load photos
      let photos = [];
      try {
        const photoSnap = await window.getDocs(window.query(
          window.collection(window.db, 'photos'),
          window.where('leadId', '==', leadId),
          window.where('userId', '==', window._user.uid)
        ));
        photos = photoSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch(e) { console.warn('Portal: photos load failed', e.message); }

      // Load estimates
      let estimates = [];
      try {
        const estSnap = await window.getDocs(window.query(
          window.collection(window.db, 'estimates'),
          window.where('userId', '==', window._user.uid)
        ));
        estimates = estSnap.docs.map(d => ({ id: d.id, ...d.data() }))
          .filter(e => e.leadId === leadId || e.customerId === leadId);
      } catch(e) { console.warn('Portal: estimates load failed', e.message); }

      // Load notes/activity
      let notes = [];
      try {
        const noteSnap = await window.getDocs(window.query(
          window.collection(window.db, 'leads', leadId, 'notes')
        ));
        notes = noteSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch(e) { /* subcollection may not exist */ }

      // Load tasks
      let tasks = [];
      try {
        const taskSnap = await window.getDocs(window.query(
          window.collection(window.db, 'leads', leadId, 'tasks')
        ));
        tasks = taskSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch(e) { /* subcollection may not exist */ }

      // Generate the portal HTML
      const html = buildPortalHTML(lead, photos, estimates, tasks, notes);

      // Upload to Firebase Storage
      const storageRef = window.ref(window.storage, `portals/${window._user.uid}/${leadId}.html`);
      const blob = new Blob([html], { type: 'text/html' });
      await window.uploadBytes(storageRef, blob, { contentType: 'text/html' });
      const shareUrl = await window.getDownloadURL(storageRef);

      // Save share URL to lead
      await window.updateDoc(window.doc(window.db, 'leads', leadId), {
        portalUrl: shareUrl,
        portalGeneratedAt: window.serverTimestamp()
      });

      // Update local lead cache
      lead.portalUrl = shareUrl;

      if (typeof showToast === 'function') showToast('Portal ready! Link copied to clipboard', 'ok');
      try { await navigator.clipboard.writeText(shareUrl); } catch(e) {}

      return shareUrl;
    } catch(e) {
      console.error('Portal generation failed:', e);
      if (typeof showToast === 'function') showToast('Portal generation failed: ' + e.message, 'error');
      return null;
    }
  }

  /**
   * Share portal via SMS
   */
  async function sharePortalSMS(leadId) {
    const lead = (window._leads || []).find(l => l.id === leadId);
    if (!lead) return;
    let url = lead.portalUrl;
    if (!url) url = await generatePortal(leadId);
    if (!url) return;

    const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim();
    const phone = (lead.phone || '').replace(/\D/g, '');
    const body = encodeURIComponent(
      `Hi${name ? ' ' + name.split(' ')[0] : ''}, here's your project portal from No Big Deal Home Solutions! Track your progress, view photos, and more: ${url}`
    );
    window.open(`sms:${phone}?body=${body}`, '_self');
  }

  /**
   * Share portal via Email
   */
  async function sharePortalEmail(leadId) {
    const lead = (window._leads || []).find(l => l.id === leadId);
    if (!lead) return;
    let url = lead.portalUrl;
    if (!url) url = await generatePortal(leadId);
    if (!url) return;

    const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim();
    const subject = encodeURIComponent('Your Project Portal — No Big Deal Home Solutions');
    const body = encodeURIComponent(
      `Hi ${name || 'there'},\n\nHere's your personal project portal where you can track progress, view photos, and see project details:\n\n${url}\n\nIf you have any questions, don't hesitate to call us at ${BRAND.phone}.\n\nBest,\nNo Big Deal Home Solutions`
    );
    window.location.href = `mailto:${lead.email || ''}?subject=${subject}&body=${body}`;
  }

  /**
   * Build the standalone HTML page for the customer portal
   */
  function buildPortalHTML(lead, photos, estimates, tasks, notes) {
    const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim() || 'Homeowner';
    const stageKey = lead._stageKey || lead.stage || 'new';
    const stageInfo = STAGE_DISPLAY[stageKey] || { label: lead.stage || 'In Progress', progress: 50, icon: '🔨' };
    const addr = lead.address || '';
    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Build photo gallery
    const photoHTML = photos.length > 0 ? photos.map(p => `
      <div style="border-radius:8px;overflow:hidden;aspect-ratio:1;background:#f0f0f0;">
        <img src="${p.url}" alt="${p.name || 'Project photo'}"
             style="width:100%;height:100%;object-fit:cover;cursor:pointer;"
             onclick="this.style.position=this.style.position==='fixed'?'':'fixed';this.style.top='0';this.style.left='0';this.style.width=this.style.width==='100vw'?'100%':'100vw';this.style.height=this.style.height==='100vh'?'100%':'100vh';this.style.zIndex=this.style.zIndex==='9999'?'':'9999';this.style.objectFit='contain';this.style.background='rgba(0,0,0,0.9)';">
      </div>
    `).join('') : '<div style="text-align:center;padding:30px;color:#888;">Photos will appear here as your project progresses</div>';

    // Build completed tasks list
    const completedTasks = tasks.filter(t => t.done);
    const pendingTasks = tasks.filter(t => !t.done);

    // Build milestone timeline
    const milestones = [];
    if (lead.createdAt) milestones.push({ date: formatTimestamp(lead.createdAt), label: 'Project started', icon: '🚀' });
    completedTasks.forEach(t => {
      milestones.push({ date: formatTimestamp(t.completedAt || t.createdAt), label: t.title || t.text || 'Task completed', icon: '✅' });
    });
    if (stageInfo.progress >= 60) milestones.push({ date: '', label: 'Contract signed', icon: '✍️' });
    if (stageInfo.progress >= 85) milestones.push({ date: '', label: 'Crew scheduled', icon: '👷' });
    if (stageInfo.progress >= 95) milestones.push({ date: '', label: 'Installation complete', icon: '🏠' });

    // Estimate info
    const latestEst = estimates.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))[0];
    const estAmount = latestEst ? (latestEst.total || latestEst.grandTotal || latestEst.amount || 0) : (lead.jobValue || 0);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Project — ${BRAND.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter',sans-serif;background:#f8f9fa;color:#1a1a2e;line-height:1.6;}
.hero{background:linear-gradient(135deg,${BRAND.navy} 0%,${BRAND.dark} 100%);color:white;padding:40px 20px 50px;text-align:center;position:relative;overflow:hidden;}
.hero::after{content:'';position:absolute;bottom:-20px;left:0;right:0;height:40px;background:#f8f9fa;border-radius:50% 50% 0 0;}
.brand{font-family:'Barlow Condensed',sans-serif;font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.7;margin-bottom:16px;}
.hero h1{font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:800;margin-bottom:6px;}
.hero .addr{font-size:14px;opacity:.8;margin-bottom:24px;}
.status-card{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:16px;padding:24px;max-width:500px;margin:0 auto;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}
.status-label{font-size:11px;text-transform:uppercase;letter-spacing:.1em;opacity:.7;margin-bottom:8px;}
.status-stage{font-size:22px;font-weight:700;margin-bottom:16px;}
.progress-track{background:rgba(255,255,255,.15);border-radius:20px;height:12px;overflow:hidden;}
.progress-fill{height:100%;border-radius:20px;background:linear-gradient(90deg,${BRAND.orange},#ff8c42);transition:width .8s ease;}
.progress-pct{font-size:13px;font-weight:600;margin-top:8px;text-align:right;color:${BRAND.orange};}
.container{max-width:800px;margin:0 auto;padding:20px;}
.section{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 2px 12px rgba(0,0,0,.06);}
.section-title{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:${BRAND.navy};margin-bottom:16px;display:flex;align-items:center;gap:8px;}
.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;}
.timeline-item{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #eee;}
.timeline-item:last-child{border-bottom:none;}
.tl-icon{width:36px;height:36px;border-radius:50%;background:${BRAND.navy}11;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
.tl-content{flex:1;}
.tl-label{font-weight:600;font-size:14px;color:#1a1a2e;}
.tl-date{font-size:12px;color:#888;margin-top:2px;}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.info-item{padding:14px;background:#f8f9fa;border-radius:10px;}
.info-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:4px;}
.info-value{font-size:15px;font-weight:600;color:${BRAND.navy};}
.next-steps{background:linear-gradient(135deg,${BRAND.navy}08,${BRAND.orange}08);border:1px solid ${BRAND.navy}20;}
.step{display:flex;align-items:center;gap:10px;padding:10px 0;font-size:14px;}
.step-dot{width:8px;height:8px;border-radius:50%;background:${BRAND.orange};}
.step-done{background:#2ECC8A;}
.cta{display:block;text-align:center;padding:16px;background:${BRAND.orange};color:white;border-radius:12px;font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:.04em;text-transform:uppercase;margin-top:20px;transition:transform .15s;}
.cta:hover{transform:scale(1.02);}
.footer{text-align:center;padding:30px 20px;color:#888;font-size:12px;}
.footer a{color:${BRAND.navy};text-decoration:none;font-weight:600;}
@media(max-width:600px){.info-grid{grid-template-columns:1fr;}.hero h1{font-size:26px;}.photo-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr));}}
</style>
</head>
<body>
<div class="hero">
  <div class="brand">${BRAND.name}</div>
  <h1>${stageInfo.icon} ${name}'s Project</h1>
  <div class="addr">${addr}</div>
  <div class="status-card">
    <div class="status-label">Current Status</div>
    <div class="status-stage">${stageInfo.label}</div>
    <div class="progress-track"><div class="progress-fill" style="width:${stageInfo.progress}%"></div></div>
    <div class="progress-pct">${stageInfo.progress}% Complete</div>
  </div>
</div>

<div class="container">

  ${estAmount > 0 ? `
  <div class="section">
    <div class="section-title">💰 Project Details</div>
    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">Project Value</div>
        <div class="info-value">$${parseFloat(estAmount).toLocaleString()}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Project Type</div>
        <div class="info-value">${(lead.jobType || 'Exterior').charAt(0).toUpperCase() + (lead.jobType || 'exterior').slice(1)}</div>
      </div>
      ${lead.damageType ? `<div class="info-item"><div class="info-label">Damage Type</div><div class="info-value">${lead.damageType}</div></div>` : ''}
      ${lead.insCarrier ? `<div class="info-item"><div class="info-label">Insurance</div><div class="info-value">${lead.insCarrier}</div></div>` : ''}
      ${lead.scheduledDate ? `<div class="info-item"><div class="info-label">Scheduled Date</div><div class="info-value">${lead.scheduledDate}</div></div>` : ''}
      ${lead.crew ? `<div class="info-item"><div class="info-label">Crew</div><div class="info-value">${lead.crew}</div></div>` : ''}
    </div>
  </div>` : ''}

  <div class="section next-steps">
    <div class="section-title">📋 What's Next</div>
    ${buildNextSteps(stageKey, lead)}
  </div>

  ${photos.length > 0 ? `
  <div class="section">
    <div class="section-title">📸 Project Photos (${photos.length})</div>
    <div class="photo-grid">${photoHTML}</div>
  </div>` : ''}

  ${milestones.length > 0 ? `
  <div class="section">
    <div class="section-title">📅 Project Timeline</div>
    ${milestones.map(m => `
      <div class="timeline-item">
        <div class="tl-icon">${m.icon}</div>
        <div class="tl-content">
          <div class="tl-label">${m.label}</div>
          ${m.date ? `<div class="tl-date">${m.date}</div>` : ''}
        </div>
      </div>
    `).join('')}
  </div>` : ''}

  ${pendingTasks.length > 0 ? `
  <div class="section">
    <div class="section-title">☑️ Upcoming Steps</div>
    ${pendingTasks.map(t => `
      <div class="step">
        <div class="step-dot"></div>
        <span>${t.title || t.text || 'Pending task'}</span>
      </div>
    `).join('')}
  </div>` : ''}

  <a href="tel:${BRAND.phone}" class="cta">📞 Call Us: ${BRAND.phone}</a>
</div>

<div class="footer">
  <p>Last updated: ${now}</p>
  <p style="margin-top:8px;"><a href="https://${BRAND.website}">${BRAND.website}</a></p>
  <p style="margin-top:4px;">${BRAND.tagline}</p>
</div>
</body>
</html>`;
  }

  function buildNextSteps(stageKey, lead) {
    const steps = {
      new: ['We\'ll be reaching out to schedule your free inspection', 'Have your insurance policy number ready if applicable'],
      contacted: ['Your inspection is being scheduled', 'We\'ll confirm the date and time with you'],
      inspected: ['Our team is reviewing the inspection findings', 'We\'ll prepare a detailed scope of work'],
      claim_filed: ['Your insurance claim has been filed', 'An adjuster will be assigned to your case'],
      adjuster_meeting_scheduled: ['The adjuster meeting is scheduled — we\'ll be there with you', 'Have any relevant documentation ready'],
      adjuster_inspection_done: ['Waiting for the adjuster\'s scope and pricing', 'We\'ll review everything when it arrives'],
      scope_received: ['We\'re reviewing the adjuster\'s scope', 'We\'ll prepare and submit our estimate'],
      estimate_submitted: ['Your estimate is under review', 'We\'ll follow up on approval status'],
      supplement_requested: ['A supplement has been submitted for additional items', 'This typically takes 5-10 business days'],
      supplement_approved: ['Supplement approved — your project scope is finalized', 'We\'ll prepare the contract for your review'],
      contract_signed: ['Your contract is signed — let\'s get to work!', 'Materials will be ordered shortly'],
      materials_ordered: ['Your materials are on order', 'Delivery is typically 3-7 business days'],
      materials_delivered: ['Materials are on site and ready', 'Crew scheduling is next'],
      crew_scheduled: ['Your crew is scheduled', 'Weather permitting, installation will begin on schedule'],
      install_in_progress: ['Installation is underway!', 'Our crew is on-site working on your project'],
      install_complete: ['Installation is complete!', 'Final inspection and photos are next'],
      closed: ['Your project is complete! 🎉', 'Your warranty is now active — we\'ve got you covered']
    };

    const list = steps[stageKey] || ['Your project is being actively managed', 'We\'ll keep you updated on next steps'];
    return list.map(s => `<div class="step"><div class="step-dot${stageKey === 'closed' ? ' step-done' : ''}"></div><span>${s}</span></div>`).join('');
  }

  function formatTimestamp(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts.seconds ? ts.seconds * 1000 : ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ════════════════════════════════════════════════════════
  // Photo-Only Portal (April 2026)
  //
  // A minimal gallery page showing ONLY before/during/after
  // photos — no project status, no estimates, no notes.
  // Perfect for showing a homeowner "look at our work on
  // your neighbor's house" at the door.
  // ════════════════════════════════════════════════════════
  async function generatePhotoPortal(leadId) {
    if (!leadId || !window._user) {
      if (typeof showToast === 'function') showToast('Must be logged in', 'error');
      return null;
    }
    if (typeof showToast === 'function') showToast('Generating photo gallery...', 'ok');
    try {
      const lead = (window._leads || []).find(l => l.id === leadId);
      if (!lead) throw new Error('Lead not found');

      let photos = [];
      try {
        const photoSnap = await window.getDocs(window.query(
          window.collection(window.db, 'photos'),
          window.where('leadId', '==', leadId),
          window.where('userId', '==', window._user.uid)
        ));
        photos = photoSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch(e) { console.warn('Photo portal: photos load failed', e.message); }

      const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim() || 'Property';
      const addr = lead.address || '';
      const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      const photoGrid = photos.length > 0 ? photos.map(p => `
        <div style="border-radius:10px;overflow:hidden;aspect-ratio:4/3;background:#1a1a2e;">
          <img src="${esc(p.url)}" alt="${esc(p.name || 'Photo')}"
               style="width:100%;height:100%;object-fit:cover;cursor:pointer;transition:transform .2s;"
               onclick="this.style.position=this.style.position==='fixed'?'':'fixed';this.style.inset='0';this.style.width=this.style.width==='100vw'?'100%':'100vw';this.style.height=this.style.height==='100vh'?'100%':'100vh';this.style.zIndex=this.style.zIndex==='9999'?'':'9999';this.style.objectFit='contain';this.style.background='rgba(0,0,0,0.95);'">
        </div>
      `).join('') : '<div style="text-align:center;padding:60px 20px;color:#888;font-size:16px;">No photos uploaded yet.</div>';

      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Photo Gallery — ${esc(name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Barlow',sans-serif;background:#0a0c0f;color:#f0f0f0;min-height:100vh;}
  .header{background:linear-gradient(135deg,#1e3a6e,#0a0c0f);padding:40px 24px 32px;text-align:center;border-bottom:4px solid #e8720c;}
  .header h1{font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;}
  .header .addr{font-size:14px;color:#8b8e96;margin-bottom:4px;}
  .header .brand{font-size:11px;color:#e8720c;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-top:12px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;padding:20px;max-width:1200px;margin:0 auto;}
  .footer{text-align:center;padding:30px 20px;color:#555;font-size:11px;}
  .footer a{color:#e8720c;text-decoration:none;}
  .count{font-size:13px;color:#e8720c;font-weight:700;letter-spacing:.08em;margin-top:8px;}
  @media(max-width:600px){.grid{grid-template-columns:1fr 1fr;gap:8px;padding:12px;}.header h1{font-size:24px;}}
</style></head><body>
  <div class="header">
    <h1>${esc(name)}</h1>
    <div class="addr">${esc(addr)}</div>
    <div class="count">${photos.length} Photo${photos.length !== 1 ? 's' : ''}</div>
    <div class="brand">No Big Deal Home Solutions</div>
  </div>
  <div class="grid">${photoGrid}</div>
  <div class="footer">Generated ${esc(now)} · <a href="https://${BRAND.website}">${BRAND.website}</a></div>
</body></html>`;

      // Upload to Firebase Storage under a separate path
      const storageRef = window.ref(window.storage, `portals/${window._user.uid}/${leadId}-photos.html`);
      const blob = new Blob([html], { type: 'text/html' });
      await window.uploadBytes(storageRef, blob, { contentType: 'text/html' });
      const shareUrl = await window.getDownloadURL(storageRef);

      await window.updateDoc(window.doc(window.db, 'leads', leadId), {
        photoPortalUrl: shareUrl,
        photoPortalGeneratedAt: window.serverTimestamp()
      });

      lead.photoPortalUrl = shareUrl;
      if (typeof showToast === 'function') showToast('Photo gallery ready!', 'ok');
      try { await navigator.clipboard.writeText(shareUrl); } catch(e) {}
      return shareUrl;
    } catch(e) {
      console.error('Photo portal generation failed:', e);
      if (typeof showToast === 'function') showToast('Photo gallery failed: ' + e.message, 'error');
      return null;
    }
  }

  // ── Preview portal (opens in NBDDocViewer or new tab) ──
  function previewPortal(leadId, type) {
    const lead = (window._leads || []).find(l => l.id === leadId);
    if (!lead) return;
    const url = type === 'photo' ? lead.photoPortalUrl : lead.portalUrl;
    if (!url) {
      if (typeof showToast === 'function') showToast('Generate the portal first', 'info');
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  // Expose to window
  window.CustomerPortal = {
    generate: generatePortal,
    generatePhotoPortal: generatePhotoPortal,
    preview: previewPortal,
    shareSMS: sharePortalSMS,
    shareEmail: sharePortalEmail
  };

})();

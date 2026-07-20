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

let _NBD_CP_DELEGATE; // module-local (globals Tranche 1 — was window.*)
(function() {
  'use strict';

  const PORTAL_COLLECTION = 'portals';

  // Brand resolver — mirrors review-engine.js. window._brand() (TenantContext /
  // company-profile.js) drives the customer-facing name/phone/email/website/
  // tagline so a tenant's portal + share messages carry THEIR identity, never
  // Joe's. NBD (no brand, or the canonical NBD legalName) resolves to the
  // literals below → the portal renders byte-identical for NBD. Resolved lazily
  // (per property access, all at user-action time) because this IIFE can run
  // before company-profile.js registers window._brand.
  function _brandRaw() {
    try { if (typeof window._brand === 'function') return window._brand() || {}; } catch (e) { /* fall through */ }
    return {};
  }
  function _isNbdBrand(b) { return !b || !b.legalName || b.legalName === 'No Big Deal Home Solutions'; }
  const BRAND = {
    get name()    { const b = _brandRaw(); return _isNbdBrand(b) ? 'No Big Deal Home Solutions'        : (b.legalName || 'No Big Deal Home Solutions'); },
    // Non-NBD branch falls back to '' (NOT the NBD literal): _resolveBrand()
    // blanks an unset tenant contact/tagline field to '', so `|| NBD-literal`
    // would re-leak Joe's number/email/site/tagline into a stranger's homeowner
    // portal + share email. NBD keeps the exact literals (byte-identical).
    get phone()   { const b = _brandRaw(); return _isNbdBrand(b) ? '(859) 420-7382'                    : ((b.contact && b.contact.phone)   || ''); },
    get email()   { const b = _brandRaw(); return _isNbdBrand(b) ? 'info@nobigdealwithjoedeal.com'     : ((b.contact && b.contact.email)   || ''); },
    get website() { const b = _brandRaw(); return _isNbdBrand(b) ? 'nobigdealwithjoedeal.com'          : ((b.contact && b.contact.website) || ''); },
    get tagline() { const b = _brandRaw(); return _isNbdBrand(b) ? 'No Big Deal — We\'ve Got You Covered' : (b.tagline || ''); },
    navy: '#1e3a6e',
    orange: '#e8720c',
    dark: '#1a1a2e'
  };


  // ─── Token-based portal URL (the secure, revocable path) ──────────────
  // DEPRECATION: this module used to bake a lead's data into a static HTML
  // file, upload it to Firebase Storage, and share the getDownloadURL — a
  // permanent, non-expiring, UNREVOCABLE link (revokePortalToken never touched
  // it). The live portal is now token-based: mint a short-lived, revocable
  // token (createPortalToken) and share /pro/portal.html?token=…, which the
  // getHomeownerPortalView Cloud Function resolves to a redacted homeowner view
  // server-side. Every entry point below mints a token URL. (The legacy
  // buildPortalHTML builder, STAGE_DISPLAY config, and per-portal Firestore
  // loads were pruned 2026-07-20 — ~285 LOC of dead reference.)
  async function mintTokenUrl(leadId) {
    if (!leadId) throw new Error('leadId required');
    const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    const fns = mod.getFunctions();
    const call = mod.httpsCallable(fns, 'createPortalToken');
    const res = await call({ leadId: leadId, ttlDays: 30 });
    const token = res && res.data && res.data.token;
    if (!token) throw new Error('No token returned');
    return location.origin + '/pro/portal.html?token=' + encodeURIComponent(token);
  }

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
      // Guard: only mint tokens for leads the rep actually has loaded.
      const lead = (window._leads || []).find(l => l.id === leadId);
      if (!lead) throw new Error('Lead not found');

      // (2026-07-20) The four Firestore loads (photos/estimates/notes/tasks)
      // and the client-side buildPortalHTML that consumed them are gone —
      // the portal renders server-side from functions/portal.js, so they
      // were four wasted reads per share click feeding an unused string.

      // ── Versioned upload ──
      // The previous implementation always wrote `portals/{uid}/{leadId}.html`
      // — every regenerate replaced the file at the same Storage path.
      // Effects:
      //   * No way to roll back if the rep accidentally exposed a
      //     private note via regenerate.
      //   * Customers who already received the old link see the new
      //     content the next time they open it (privacy surprise).
      // Now each regenerate writes a distinct timestamped file. The
      // lead doc tracks the CURRENT version + a history array, so the
      // most recently shared link points at the latest content but
      // older versions stay reachable for audit/rollback. The lead's
      // portalUrl always points at the newest version — homeowners
      // who got the previous link don't get auto-promoted to the new
      // content because the old URL is a different file.
      // Portal is now token-based + revocable (createPortalToken →
      // /pro/portal.html?token=). The legacy Storage upload that used to live
      // here produced a permanent, non-expiring, UNREVOCABLE getDownloadURL —
      // mint a secure token URL instead. (`html` built above is now unused; see
      // the deprecation note on mintTokenUrl.)
      const shareUrl = await mintTokenUrl(leadId);

      // Clipboard write before the toast — Safari, focus-loss, and
      // insecure-context all silently fail. Tell the user whether the
      // copy actually happened so they don't paste an empty string into
      // a text to the homeowner.
      let copied = false;
      try {
        await navigator.clipboard.writeText(shareUrl);
        copied = true;
      } catch (clipErr) {
        console.warn('Portal share clipboard write failed:', clipErr && clipErr.message);
      }
      if (typeof showToast === 'function') {
        showToast(copied
          ? 'Portal ready! Link copied to clipboard'
          : 'Portal ready — long-press the URL below to copy', copied ? 'ok' : 'warning');
      }

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
    let url;
    try { url = await mintTokenUrl(leadId); }
    catch (e) { if (typeof showToast === 'function') showToast('Could not create link: ' + (e.message || 'error'), 'error'); return; }
    if (!url) return;

    const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim();
    const phone = (lead.phone || '').replace(/\D/g, '');
    const body = encodeURIComponent(
      `Hi${name ? ' ' + name.split(' ')[0] : ''}, here's your project portal from ${BRAND.name}! Track your progress, view photos, and more: ${url}`
    );
    window.open(`sms:${phone}?body=${body}`, '_self');
  }

  /**
   * Share portal via Email
   */
  async function sharePortalEmail(leadId) {
    const lead = (window._leads || []).find(l => l.id === leadId);
    if (!lead) return;
    let url;
    try { url = await mintTokenUrl(leadId); }
    catch (e) { if (typeof showToast === 'function') showToast('Could not create link: ' + (e.message || 'error'), 'error'); return; }
    if (!url) return;

    const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim();
    const subject = encodeURIComponent('Your Project Portal — ' + BRAND.name);
    // Only include the "call us at <phone>" sentence when a phone is actually
    // set — BRAND.phone is '' for a non-NBD tenant that hasn't set contact, and
    // we must not fall back to Joe's number.
    const callLine = BRAND.phone ? `\n\nIf you have any questions, don't hesitate to call us at ${BRAND.phone}.` : '';
    const body = encodeURIComponent(
      `Hi ${name || 'there'},\n\nHere's your personal project portal where you can track progress, view photos, and see project details:\n\n${url}${callLine}\n\nBest,\n${BRAND.name}`
    );
    window.location.href = `mailto:${lead.email || ''}?subject=${subject}&body=${body}`;
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
          window.collection(window.db, "photos"),
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
               data-cp-action="toggleImgFullscreen">
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
    <div class="brand">${esc(BRAND.name)}</div>
  </div>
  <div class="grid">${photoGrid}</div>
  <div class="footer">Generated ${esc(now)} · <a href="https://${BRAND.website}">${BRAND.website}</a></div>
</body></html>`;

      // Token-based now: the homeowner portal already shows shared photos, so
      // the dedicated photo gallery shares the same secure /pro/portal.html
      // token URL instead of uploading a separate static HTML file to Storage.
      const shareUrl = await mintTokenUrl(leadId);
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
  async function previewPortal(leadId, type) {
    if (!leadId) return;
    // type kept for signature compat; the token portal renders photos inline.
    try {
      const url = await mintTokenUrl(leadId);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Could not open preview: ' + (e.message || 'error'), 'error');
    }
  }

  // Expose to window
  window.CustomerPortal = {
    generate: generatePortal,
    generatePhotoPortal: generatePhotoPortal,
    preview: previewPortal,
    shareSMS: sharePortalSMS,
    shareEmail: sharePortalEmail,
    mintUrl: mintTokenUrl
  };

})();


(function(){if(_NBD_CP_DELEGATE)return;_NBD_CP_DELEGATE=true;document.addEventListener('click',function(ev){var t=ev.target.closest&&ev.target.closest('[data-cp-action]');if(!t)return;if(t.dataset.cpAction==='toggleImgFullscreen'){var s=t.style;s.position=s.position==='fixed'?'':'fixed';s.inset='0';s.width=s.width==='100vw'?'100%':'100vw';s.height=s.height==='100vh'?'100%':'100vh';s.zIndex=s.zIndex==='9999'?'':'9999';s.objectFit='contain';s.background='rgba(0,0,0,0.95)';}});})();

/**
 * NBD Pro — Shareable Photo Gallery Generator (Enhanced)
 * Generates a beautiful standalone gallery page with rich photo data,
 * statistics, tags, and phase-based organization.
 *
 * Exposes: window.ShareGallery = { generate }
 */

(function() {
  'use strict';

  // HTML escape — critical for share-gallery because the generated
  // HTML is served from Firebase Storage to customers. Any unescaped
  // photo metadata (damageType, description, location) would be a
  // stored XSS vector visible to every person who opens the gallery.
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  const BRAND = {
    name: 'No Big Deal Home Solutions',
    phone: '(859) 420-7382',
    email: 'info@nobigdeal.pro',
    website: 'nobigdealwithjoedeal.com',
    navy: '#1e3a6e',
    orange: '#e8720c',
    dark: '#1a1a2e'
  };

  const PHASE_COLORS = {
    'Before': '#3b82f6',
    'During': '#e8720c',
    'After': '#22c55e'
  };

  const SEVERITY_COLORS = {
    'minor': '#eab308',
    'moderate': '#f97316',
    'severe': '#ef4444'
  };

  async function generate(leadId) {
    if (!window._user) { alert('Please log in first.'); return; }
    if (!leadId) { alert('No customer selected.'); return; }

    const toast = window.showToast ? window.showToast : (msg) => alert(msg);
    toast('Generating shareable gallery...', 'info');

    try {
      const leadSnap = await window.getDoc(window.doc(window.db, 'leads', leadId));
      if (!leadSnap.exists()) { toast('Customer not found', 'error'); return; }
      const lead = leadSnap.data();
      const customerName = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim() || 'Customer';
      const address = lead.address || '';

      const photosSnap = await window.getDocs(
        window.query(window.collection(window.db, 'photos'), window.where('leadId', '==', leadId), window.where('userId', '==', window.auth.currentUser?.uid))
      );

      if (photosSnap.empty) {
        toast('No photos to share for this customer.', 'error');
        return;
      }

      const photos = [];
      photosSnap.forEach(function(doc) {
        var data = doc.data();
        photos.push({
          url: data.url,
          phase: data.phase || 'During',
          category: data.category || 'Property',
          description: data.description || data.notes || '',
          filename: data.filename || '',
          damageType: data.damageType || '',
          severity: data.severity || '',
          location: data.location || '',
          tags: data.tags || [],
          isAnnotated: data.isAnnotated || false,
          date: data.date && data.date.toDate ? data.date.toDate().toLocaleDateString() : data.uploadedAt && data.uploadedAt.toDate ? data.uploadedAt.toDate().toLocaleDateString() : ''
        });
      });

      var phases = { 'Before': [], 'During': [], 'After': [] };
      photos.forEach(function(p) {
        var ph = phases[p.phase] ? p.phase : 'During';
        phases[ph].push(p);
      });

      var tagCounts = {};
      photos.forEach(function(p) {
        if (p.damageType) tagCounts[p.damageType] = (tagCounts[p.damageType] || 0) + 1;
        if (p.severity) tagCounts[p.severity] = (tagCounts[p.severity] || 0) + 1;
        (p.tags || []).forEach(function(t) { tagCounts[t] = (tagCounts[t] || 0) + 1; });
      });

      var topTags = Object.entries(tagCounts).sort(function(a,b){ return b[1]-a[1]; }).slice(0, 5);

      var html = buildGalleryHTML(customerName, address, lead.damageType || '', photos, phases, topTags, lead);

      var blob = new Blob([html], { type: 'text/html' });
      var storageRef = window.ref(window.storage, 'galleries/' + window._user.uid + '/' + leadId + '.html');
      await window.uploadBytes(storageRef, blob, { contentType: 'text/html' });
      var shareUrl = await window.getDownloadURL(storageRef);

      await window.updateDoc(window.doc(window.db, 'leads', leadId), {
        galleryUrl: shareUrl,
        galleryGeneratedAt: window.serverTimestamp()
      });

      showShareDialog(shareUrl, customerName, lead.phone, lead.email, photos.length);
      return shareUrl;
    } catch (error) {
      console.error('Gallery generation error:', error);
      toast('Failed to generate gallery. ' + error.message, 'error');
    }
  }

  function buildGalleryHTML(customerName, address, damageType, photos, phases, topTags, lead) {
    var statsHtml = photos.length + ' Photos';
    if (phases['Before'].length) statsHtml += ' &middot; ' + phases['Before'].length + ' Before';
    if (phases['During'].length) statsHtml += ' &middot; ' + phases['During'].length + ' During';
    if (phases['After'].length) statsHtml += ' &middot; ' + phases['After'].length + ' After';

    var tagsHtml = topTags.map(function(t) {
      return '<span style="display:inline-block;background:rgba(232,114,12,.15);color:#e8720c;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600;">' + t[0] + ' (' + t[1] + ')</span>';
    }).join(' ');

    var phaseSections = '';
    ['Before', 'During', 'After'].forEach(function(phase) {
      var list = phases[phase];
      if (list.length === 0) return;
      var color = phase === 'Before' ? '#3b82f6' : phase === 'During' ? '#e8720c' : '#22c55e';

      phaseSections += '<div style="margin-bottom:40px;">';
      phaseSections += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid ' + color + ';">';
      phaseSections += '<div style="width:12px;height:12px;border-radius:50%;background:' + color + ';"></div>';
      phaseSections += '<h2 style="margin:0;font-size:22px;font-weight:700;color:#fff;">' + phase + ' Phase</h2>';
      phaseSections += '<span style="font-size:14px;color:#999;">(' + list.length + ' photo' + (list.length !== 1 ? 's' : '') + ')</span>';
      phaseSections += '</div>';

      phaseSections += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;">';
      list.forEach(function(photo) {
        var badges = '';
        if (photo.damageType) {
          badges += '<span style="display:inline-block;background:rgba(255,255,255,.12);color:#fff;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;">' + esc(photo.damageType) + '</span>';
        }
        if (photo.severity) {
          var sevColor = photo.severity === 'severe' ? '#ef4444' : photo.severity === 'moderate' ? '#f97316' : '#eab308';
          badges += '<span style="display:inline-block;background:' + sevColor + '22;color:' + sevColor + ';padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;text-transform:capitalize;">' + esc(photo.severity) + '</span>';
        }
        if (photo.location) {
          badges += '<span style="display:inline-block;background:rgba(59,130,246,.15);color:#60a5fa;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;">' + esc(photo.location) + '</span>';
        }
        if (photo.isAnnotated) {
          badges += '<span style="display:inline-block;background:rgba(34,197,94,.15);color:#22c55e;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;">Annotated</span>';
        }

        phaseSections += '<div style="background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">';
        phaseSections += '<div style="position:relative;cursor:pointer;" onclick="openLightbox(\'' + (photo.url || '').replace(/'/g, "\\'") + '\', \'' + (photo.description || '').replace(/'/g, "\\'") + '\')">';
        phaseSections += '<img src="' + photo.url + '" alt="' + (photo.description || 'Photo') + '" style="width:100%;height:200px;object-fit:cover;display:block;">';
        phaseSections += '</div>';
        phaseSections += '<div style="padding:12px;">';
        if (badges) phaseSections += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">' + badges + '</div>';
        if (photo.description) phaseSections += '<div style="font-size:13px;color:#cbd5e1;margin-bottom:4px;">' + esc(photo.description) + '</div>';
        if (photo.date) phaseSections += '<div style="font-size:11px;color:#64748b;">' + photo.date + '</div>';
        phaseSections += '</div></div>';
      });
      phaseSections += '</div></div>';
    });

    var projectDate = lead.projectDate || lead.inspectionDate || lead.createdAt;
    var dateStr = projectDate && projectDate.toDate ? projectDate.toDate().toLocaleDateString() : '';

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Project Photos - ' + esc(customerName) + '</title>'
      + '<style>'
      + '*{margin:0;padding:0;box-sizing:border-box;}'
      + 'body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;}'
      + '.header{background:linear-gradient(135deg,#1e3a6e 0%,#0f172a 100%);padding:40px 20px;text-align:center;border-bottom:3px solid #e8720c;}'
      + '.header h1{font-size:28px;font-weight:700;margin:16px 0 8px;}'
      + '.header .meta{color:#94a3b8;font-size:14px;}'
      + '.brand-mark{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;background:#e8720c;color:#fff;font-weight:800;font-size:18px;border-radius:10px;}'
      + '.brand-name{font-size:16px;font-weight:700;color:#fff;margin-top:8px;}'
      + '.stats{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:16px;}'
      + '.container{max-width:1100px;margin:0 auto;padding:30px 20px;}'
      + '.footer{text-align:center;padding:30px 20px;border-top:1px solid #1e293b;color:#64748b;font-size:13px;margin-top:40px;}'
      + '.footer a{color:#e8720c;text-decoration:none;}'
      + '#lightbox{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.9);z-index:10000;align-items:center;justify-content:center;flex-direction:column;}'
      + '#lightbox img{max-width:90vw;max-height:80vh;border-radius:8px;}'
      + '#lightbox .caption{color:#fff;margin-top:12px;font-size:14px;}'
      + '#lightbox .close{position:absolute;top:20px;right:20px;background:none;border:none;color:#fff;font-size:32px;cursor:pointer;}'
      + '@media(max-width:600px){.header h1{font-size:22px;} .container{padding:16px 12px;}}'
      + '</style>'
      + '</head><body>'
      + '<div class="header">'
      + '<div class="brand-mark">NBD</div>'
      + '<div class="brand-name">' + BRAND.name + '</div>'
      + '<h1>Project Photos</h1>'
      + '<div class="meta">' + esc(customerName) + (address ? ' &middot; ' + address : '') + (damageType ? ' &middot; ' + esc(damageType) + ' Damage' : '') + (dateStr ? ' &middot; ' + dateStr : '') + '</div>'
      + '<div class="stats"><span style="background:rgba(255,255,255,.1);padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;color:#fff;">' + statsHtml + '</span></div>'
      + (tagsHtml ? '<div style="margin-top:12px;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;">' + tagsHtml + '</div>' : '')
      + '</div>'
      + '<div class="container">' + phaseSections + '</div>'
      + '<div class="footer">'
      + '<div style="font-weight:700;color:#fff;margin-bottom:4px;">' + BRAND.name + '</div>'
      + '<div>' + BRAND.phone + ' &middot; <a href="mailto:' + BRAND.email + '">' + BRAND.email + '</a> &middot; <a href="https://' + BRAND.website + '">' + BRAND.website + '</a></div>'
      + '</div>'
      + '<div id="lightbox" onclick="if(event.target===this)closeLightbox()"><button class="close" onclick="closeLightbox()">&times;</button><img id="lbImg" src="" alt=""><div class="caption" id="lbCaption"></div></div>'
      + '<script>'
      + 'function openLightbox(url,desc){var lb=document.getElementById("lightbox");document.getElementById("lbImg").src=url;document.getElementById("lbCaption").textContent=desc||"";lb.style.display="flex";}'
      + 'function closeLightbox(){document.getElementById("lightbox").style.display="none";}'
      + 'document.addEventListener("keydown",function(e){if(e.key==="Escape")closeLightbox();});'
      + '<\/script>'
      + '</body></html>';
  }

  function showShareDialog(url, customerName, phone, email, photoCount) {
    var existing = document.getElementById('nbd-share-dialog-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'nbd-share-dialog-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;';

    var smsBody = encodeURIComponent('Check out your project photos: ' + url);
    var emailSubject = encodeURIComponent('Your Project Photos - ' + customerName);
    var emailBody = encodeURIComponent('Hi ' + esc(customerName) + ',\n\nHere are your project photos:\n' + url + '\n\nBest regards,\nNo Big Deal Home Solutions\n(859) 420-7382');

    var dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1a1a2e;border:1px solid #2a2a4e;border-radius:16px;padding:28px;max-width:440px;width:90%;color:#fff;font-family:system-ui,sans-serif;';

    dialog.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">'
      + '<h3 style="margin:0;font-size:20px;font-weight:700;">Share Gallery</h3>'
      + '<button onclick="this.closest(\'#nbd-share-dialog-overlay\').remove()" style="background:none;border:none;color:#999;font-size:24px;cursor:pointer;">&times;</button>'
      + '</div>'
      + '<div style="background:#16213e;border-radius:10px;padding:14px;margin-bottom:16px;font-size:13px;color:#94a3b8;word-break:break-all;">' + url + '</div>'
      + '<div style="text-align:center;margin-bottom:16px;font-size:13px;color:#64748b;">' + photoCount + ' photos shared with ' + esc(customerName) + '</div>'
      + '<div style="display:flex;gap:8px;margin-bottom:12px;">'
      + '<button onclick="navigator.clipboard.writeText(\'' + url.replace(/'/g, "\\'") + '\');this.textContent=\'Copied!\';setTimeout(function(){this.textContent=\'Copy Link\';}.bind(this),2000);" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:#e8720c;color:#fff;padding:12px;border-radius:10px;border:none;cursor:pointer;font-weight:600;font-size:14px;">Copy Link</button>'
      + (phone ? '<a href="sms:' + phone + '?body=' + smsBody + '" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:#22c55e;color:#fff;padding:12px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;">Text</a>' : '')
      + '</div>'
      + '<div style="display:flex;gap:8px;">'
      + (email ? '<a href="mailto:' + email + '?subject=' + emailSubject + '&body=' + emailBody + '" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:#3b82f6;color:#fff;padding:12px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;">Email</a>' : '')
      + '<button onclick="window.open(\'' + url.replace(/'/g, "\\'") + '\',\'_blank\')" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:rgba(255,255,255,.1);color:#fff;padding:12px;border-radius:10px;border:none;cursor:pointer;font-weight:600;font-size:14px;">Preview</button>'
      + '</div>'
      + '<button onclick="this.closest(\'#nbd-share-dialog-overlay\').remove()" style="width:100%;margin-top:16px;padding:10px;background:none;border:1px solid #2a2a4e;border-radius:10px;color:#94a3b8;cursor:pointer;font-size:13px;">Close</button>';

    overlay.appendChild(dialog);
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }

  window.ShareGallery = { generate: generate };
  console.log('Share Gallery module loaded. Use: ShareGallery.generate(leadId)');
})();

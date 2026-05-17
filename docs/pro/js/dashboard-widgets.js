/**
 * dashboard-widgets.js — render-heavy widgets: estimates list, photo
 * gallery, storm map init, property-intel card, kanban card-detail
 * modal, mobile job-detail screen.
 *
 * Extracted from dashboard-main.js (Step 4a — 2026-05-16). Third in
 * the state→api→widgets→ui→actions→main load chain.
 *
 * Widgets here read from the live data caches (window._leads,
 * window._estimates, window._photoCache, window._user) and render
 * into known DOM containers. They use api functions defined in
 * dashboard-api.js (loadPhotoCounts, renderRecentPhotoFeed via
 * window indirection) and forward most user actions to handlers in
 * dashboard-actions.js (via window.* lookups so load order is safe).
 */

// ══════════════════════════════════════════════
// ESTIMATES LIST + builder open
// ══════════════════════════════════════════════
function renderEstimatesList(ests) {
  // Null-guard the analytics stat tiles AND the list wrapper. After the
  // Step 4a split (PR #400), this function gets called on every dashboard
  // load to populate the estimates analytics — but on routes like #/crm
  // the statEsts/statVal/estListWrap elements don't exist in the DOM at
  // all. The previous version (assuming those elements were always
  // present) threw "Cannot set properties of null (setting 'textContent')"
  // which cascaded through bootstrap into a 30-second retry loop that
  // never recovered → skeleton-only page. Guard each touch; if the list
  // wrapper isn't here either, this whole page doesn't show estimates,
  // so we can return early after the stat update attempt.
  const statEsts = document.getElementById('statEsts');
  if (statEsts) statEsts.textContent = ests?.length || 0;
  const totalVal=(ests||[]).reduce((s,e)=>s+(e.grandTotal||0),0);
  const statVal = document.getElementById('statVal');
  if (statVal) statVal.textContent = '$' + Math.round(totalVal/1000) + 'K';

  const esc = window.nbdEsc || (s => String(s == null ? '' : s));
  const wrap=document.getElementById('estListWrap');
  if (!wrap) return; // Page has no estimates list — analytics-only call.
  if(!ests||!ests.length){
    // Empty state — the 2 builder options are already visible
    // above this wrap in the page header, so we just invite the
    // user to start one.
    wrap.innerHTML='<div class="empty"><div class="empty-icon">📋</div>'
      + 'No estimates yet.<br><span style="font-size:11px;color:var(--m);">'
      + 'Click <strong>Classic</strong> or <strong>V2 Builder</strong> above to create one.</span></div>';
    return;
  }

  // Helper: find the linked customer (lead) for this estimate
  // and render a short tag. Unassigned estimates get a neutral
  // "Unassigned" chip that's click-to-assign.
  const findLead = (leadId) => (window._leads || []).find(l => l.id === leadId);
  const formatDate = (ts) => {
    try {
      const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      if (!d || isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    } catch (e) { return '—'; }
  };
  const displayName = (e) => {
    if (e.name && e.name.trim()) return e.name.trim();
    if (e.addr && e.addr.trim()) return e.addr.trim();
    if (e.owner && e.owner.trim()) return e.owner.trim() + ' estimate';
    return 'Untitled estimate';
  };

  wrap.innerHTML = ests.map(e => {
    const lead = e.leadId ? findLead(e.leadId) : null;
    const leadTag = lead
      ? '<span class="est-lead-chip assigned" data-act="open-lead" data-lead="' + esc(lead.id) + '">'
          + '👤 ' + esc((lead.firstName || '') + ' ' + (lead.lastName || '')).trim()
          + (lead.firstName || lead.lastName ? '' : esc(lead.address || 'Customer'))
        + '</span>'
      : '<span class="est-lead-chip unassigned" data-act="assign">➕ Unassigned</span>';
    const builderTag = e.builder === 'v2'
      ? '<span class="est-src-chip v2">V2</span>'
      : '<span class="est-src-chip classic">CLASSIC</span>';
    // Signature status — emitted by BoldSign webhook. Distinct colors
    // so reps can eyeball the pipeline without clicking into each.
    let sigTag = '';
    if (e.signatureStatus === 'signed') {
      sigTag = '<span class="est-src-chip" style="background:rgba(46,204,138,.15);color:var(--green,#2ecc8a);border-color:var(--green,#2ecc8a);">✓ SIGNED</span>';
    } else if (e.signatureStatus === 'sent' || e.signatureStatus === 'viewed') {
      sigTag = '<span class="est-src-chip" style="background:color-mix(in srgb, var(--orange) 12%, transparent);color:var(--orange);border-color:var(--orange);">✍ AWAITING</span>';
    } else if (e.signatureStatus === 'declined') {
      sigTag = '<span class="est-src-chip" style="background:rgba(197,48,48,.15);color:#ff6b6b;border-color:#ff6b6b;">✗ DECLINED</span>';
    } else if (e.signatureStatus === 'expired') {
      sigTag = '<span class="est-src-chip" style="opacity:.6;">⧗ EXPIRED</span>';
    }
    return ''
      + '<div class="est-card nbd-est-card" data-id="' + esc(e.id) + '">'
        + '<div class="est-card-main" data-act="open">'
          + '<div class="est-card-icon">📋</div>'
          + '<div class="est-card-body">'
            + '<div class="est-card-name">' + esc(displayName(e)) + '</div>'
            + '<div class="est-card-meta">'
              + esc(e.addr || 'No address') + ' · '
              + esc(e.roofType || '—') + ' · '
              + esc((e.sq != null ? Number(e.sq).toFixed(2) : '—')) + ' SQ · '
              + esc(e.tierName || '—')
            + '</div>'
            + '<div class="est-card-chips">'
              + leadTag + builderTag + sigTag
              + '<span class="est-date">' + esc(formatDate(e.createdAt || e.updatedAt)) + '</span>'
            + '</div>'
          + '</div>'
          + '<div class="est-card-total">$' + Number(e.grandTotal || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) + '</div>'
        + '</div>'
        + '<div class="est-card-actions">'
          + '<button class="est-act-btn" data-act="open" title="Open & edit">✎ Edit</button>'
          + '<button class="est-act-btn" data-act="duplicate" title="Duplicate this estimate">⎘ Duplicate</button>'
          + '<button class="est-act-btn" data-act="rename" title="Rename estimate">✏ Rename</button>'
          + '<button class="est-act-btn" data-act="assign" title="Assign to customer">👤 Assign</button>'
          + '<button class="est-act-btn danger" data-act="delete" title="Delete estimate">🗑</button>'
        + '</div>'
      + '</div>';
  }).join('');

  // Single delegated handler for every action button on every
  // card. Walks up to .nbd-est-card to get the id, then dispatches
  // on data-act. CSP-clean (no inline onclicks, works under the
  // Report-Only script-src-attr 'none' policy).
  wrap.querySelectorAll('.nbd-est-card').forEach(card => {
    card.addEventListener('click', (ev) => {
      const target = ev.target.closest('[data-act]');
      if (!target) return;
      const act = target.dataset.act;
      const id = card.dataset.id;
      if (!id) return;
      ev.stopPropagation();
      switch (act) {
        case 'open':       if (typeof viewEstimate === 'function') viewEstimate(id); break;
        case 'duplicate':  if (typeof duplicateEstimateAction === 'function') duplicateEstimateAction(id); break;
        case 'rename':     if (typeof renameEstimateAction === 'function') renameEstimateAction(id); break;
        case 'assign':     if (typeof assignEstimateAction === 'function') assignEstimateAction(id); break;
        case 'delete':     if (typeof deleteEstimateAction === 'function') deleteEstimateAction(id); break;
        case 'open-lead': {
          const leadId = target.dataset.lead;
          if (leadId) window.location.href = '/pro/customer.html?id=' + encodeURIComponent(leadId);
          break;
        }
      }
    });
  });

  // Recent on dashboard — each card opens that specific estimate
  const rc=document.getElementById('recentEsts');
  rc.innerHTML=ests.slice(0,4).map(e=>`
    <div class="est-card nbd-recent-est" data-id="${esc(e.id)}" style="margin-bottom:8px;cursor:pointer;">
      <div style="font-size:18px;">📋</div>
      <div><div class="est-addr" style="font-size:12px;">${esc(e.addr||'No address')}</div>
      <div class="est-meta">${esc(e.tierName||'')}</div></div>
      <div class="est-total" style="font-size:16px;">$${Number(e.grandTotal||0).toLocaleString('en-US',{maximumFractionDigits:0})}</div>
    </div>`).join('');
  rc.querySelectorAll('.nbd-recent-est').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      goTo('est');
      setTimeout(() => viewEstimate(id), 200);
    });
  });

  // Update weekly stats
  if (typeof calculateWeeklyStats === 'function') calculateWeeklyStats();
}

function viewEstimate(id) {
  const est = (window._estimates || []).find(e => e.id === id);
  if (!est) { showToast('Estimate not found — it may still be loading', 'error'); console.error('viewEstimate: not found in _estimates, id=', id, 'available:', (window._estimates||[]).map(e=>e.id)); return; }

  // Show builder, hide list
  const listEl = document.getElementById('est-list');
  const builderEl = document.getElementById('est-builder');
  if (listEl) listEl.style.display = 'none';
  if (builderEl) { builderEl.style.display = 'flex'; builderEl.style.flexDirection = 'column'; }
  const noteEl = document.getElementById('drawImportNote');
  if (noteEl) noteEl.style.display = 'none';

  // Update title to reflect editing
  const titleEl = document.getElementById('estBuilderTitle');
  if (titleEl) titleEl.textContent = 'Edit Estimate';

  // Populate Step 1 — Measurements (handle null/0 gracefully)
  const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = (val != null && val !== '') ? val : ''; };
  setVal('estAddr', est.addr);
  setVal('estOwner', est.owner);
  setVal('estParcel', est.parcel);
  setVal('estYear', est.yr);
  setVal('estRawSqft', est.raw);
  setVal('estRidge', est.ridge != null ? est.ridge : '');
  setVal('estEave', est.eave != null ? est.eave : '');
  setVal('estHip', est.hip != null ? est.hip : '');
  setVal('estPipes', est.pipes || 4);

  // Populate Step 2 — Roof Type, Pitch, Waste
  setVal('estRoofType', est.roofType);

  // Match pitch to dropdown option value (format: "factor|label" like "1.202|8/12")
  const pitchSel = document.getElementById('estPitch');
  if (pitchSel && est.pitch) {
    const pitchLabel = est.pitch; // e.g. "8/12"
    let matched = false;
    for (let i = 0; i < pitchSel.options.length; i++) {
      // Exact match on the label portion after the pipe
      const parts = pitchSel.options[i].value.split('|');
      if (parts[1] === pitchLabel || pitchSel.options[i].value === pitchLabel) {
        pitchSel.selectedIndex = i;
        matched = true;
        break;
      }
    }
    // Fallback: try includes match (handles edge cases)
    if (!matched) {
      for (let i = 0; i < pitchSel.options.length; i++) {
        if (pitchSel.options[i].value.includes('|' + pitchLabel)) {
          pitchSel.selectedIndex = i;
          break;
        }
      }
    }
  }

  // Restore waste factor if saved
  if (est.wf) {
    const wasteSel = document.getElementById('estWaste');
    if (wasteSel) {
      for (let i = 0; i < wasteSel.options.length; i++) {
        if (Math.abs(parseFloat(wasteSel.options[i].value) - parseFloat(est.wf)) < 0.001) {
          wasteSel.selectedIndex = i;
          break;
        }
      }
    }
  }

  // Restore linked lead
  window._estLinkedLeadId = est.leadId || null;

  // Store the Firestore doc ID so we can update instead of creating new
  window._editingEstimateId = est.id;

  // Set tier BEFORE calculating so syncRatesFromProductLibrary uses the right tier
  selectedTier = est.tier || 'good';

  // Reset estData and run calculations (order matters: updateEstCalc reads DOM, calcTierPrices needs estData)
  estData = {};
  updateEstCalc();
  calcTierPrices();

  // Select saved tier in the UI
  document.querySelectorAll('.tier-card').forEach(c => {
    c.classList.remove('selected');
    const onclick = c.getAttribute('onclick') || '';
    if (onclick.includes("'" + selectedTier + "'")) {
      c.classList.add('selected');
    }
  });

  // Enable the step 3 next button (since tier is pre-selected)
  const step3Btn = document.getElementById('estStep3Next');
  if (step3Btn) { step3Btn.disabled = false; step3Btn.style.opacity = '1'; }

  // Build review and jump to Step 4 (use requestAnimationFrame to ensure DOM is painted)
  requestAnimationFrame(() => {
    buildReview();
    showEstStep(4);
    showToast('Estimate loaded — review and save or edit any step', 'info');
  });
}
window.viewEstimate = viewEstimate;

// ══════════════════════════════════════════════
// PHOTO LEADS LIST + PHOTO MODAL
// ══════════════════════════════════════════════
async function renderPhotoLeads(){
  const wrap=document.getElementById('photoLeadsList');

  // Ensure photo counts are loaded before we render so the sort
  // can put photos-first. First open shows a loading state; later
  // opens are instant because the counts cache hits.
  if (!window._photoCountsLoaded) {
    wrap.innerHTML='<div class="empty"><div class="empty-icon">📸</div>Loading photo counts...</div>';
    await loadPhotoCounts();
  }

  const allLeads = window._leads || [];
  // Exclude prospects (hidden from kanban, should also be hidden
  // from the Photos Near Me picker — they're not real customers).
  const counts = window._photoCountByLead || {};
  let realLeads = allLeads.filter(l => !l.isProspect);
  // Apply search filter if the user typed in the photo search bar
  const _pq = window._photoSearchQuery || '';
  if (_pq) {
    realLeads = realLeads.filter(l => {
      const text = [l.firstName, l.lastName, l.address, l.phone, l.name].filter(Boolean).join(' ').toLowerCase();
      return text.includes(_pq);
    });
  }
  // "Only with photos" toggle — hides jobs that have zero photos
  if (window._photosOnlyWithPhotos) {
    realLeads = realLeads.filter(l => (counts[l.id] || 0) > 0);
  }

  if(!realLeads.length){
    wrap.innerHTML='<div class="empty"><div class="empty-icon">📸</div>No customers yet. Add a lead or promote a prospect to attach photos.</div>';
    return;
  }

  // Smart rank: photos-first, then alphabetical by name
  const ranked = realLeads.slice().sort((a, b) => {
    const cntA = counts[a.id] || 0;
    const cntB = counts[b.id] || 0;
    if (cntA !== cntB) return cntB - cntA; // most photos first
    const nameA = ((a.firstName||'') + ' ' + (a.lastName||'')).trim() || a.address || '';
    const nameB = ((b.firstName||'') + ' ' + (b.lastName||'')).trim() || b.address || '';
    return nameA.localeCompare(nameB);
  });

  // Split into two sections: 'Jobs with photos' and 'Jobs without'
  const withPhotos = ranked.filter(l => (counts[l.id] || 0) > 0);
  const withoutPhotos = ranked.filter(l => !counts[l.id]);

  const e = window.nbdEsc || (s => String(s == null ? '' : s));
  const cardHTML = (l) => {
    const name = ((l.firstName||'')+ ' ' + (l.lastName||'')).trim() || l.name || 'Unknown';
    const addr = l.address || 'No address';
    const stage = l.stage || 'new';
    const stageLabel = {'new':'New','contacted':'Contacted','inspected':'Inspected','claim_filed':'Claim Filed','contract_signed':'Signed','closed':'Closed'}[stage] || stage.replace(/_/g,' ');
    const count = counts[l.id] || 0;
    const badgeBg = count > 0 ? '#22c55e' : 'var(--s3)';
    const badgeColor = count > 0 ? '#fff' : 'var(--m)';
    return `
    <div class="panel" style="margin:0;">
      <div class="panel-hdr nbd-photo-lead" style="cursor:pointer;" data-lead-id="${e(l.id)}" data-addr="${e(addr)}">
        <div>
          <div class="panel-label" style="display:flex;align-items:center;gap:6px;">
            📸 Photos
            <span style="background:${badgeBg};color:${badgeColor};font-size:9px;padding:1px 6px;border-radius:4px;font-weight:700;">${count} photo${count === 1 ? '' : 's'}</span>
            <span style="background:var(--s3);color:var(--orange);font-size:9px;padding:1px 6px;border-radius:4px;font-weight:700;">${e(stageLabel)}</span>
          </div>
          <div class="panel-title" style="font-size:14px;">${e(name)}</div>
          <div style="font-size:11px;color:var(--m);margin-top:2px;">📍 ${e(addr)}</div>
        </div>
        <button class="btn btn-orange" style="font-size:11px;padding:7px 14px;">${count > 0 ? '📷 View / Add' : '📷 Upload'}</button>
      </div>
    </div>`;
  };

  let html = '<div style="display:flex;flex-direction:column;gap:10px;">';
  if (withPhotos.length) {
    html += '<div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--green, #22c55e);padding:6px 2px 0;">📸 Jobs with Photos (' + withPhotos.length + ')</div>';
    html += withPhotos.map(cardHTML).join('');
  }
  if (withoutPhotos.length) {
    html += '<div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--m);padding:14px 2px 0;">Customers Without Photos (' + withoutPhotos.length + ')</div>';
    html += withoutPhotos.map(cardHTML).join('');
  }
  html += '</div>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('.nbd-photo-lead').forEach(el => {
    el.addEventListener('click', () => {
      openPhotoFor(el.dataset.leadId, el.dataset.addr);
    });
  });
}

async function openPhotoFor(leadId, addr){
  currentPhotoLeadId=leadId; currentPhotoAddr=addr;
  document.getElementById('photoModalTitle').textContent='Damage Photos';
  document.getElementById('photoModalAddr').textContent=addr;
  document.getElementById('photoGridModal').innerHTML='<div style="font-size:12px;color:var(--m);padding:10px;text-align:center;">Loading...</div>';
  document.getElementById('photoModal').classList.add('open');
  const photos=await window._getPhotos(leadId);
  renderPhotoGrid(photos);
}

function renderPhotoGrid(photos){
  const grid=document.getElementById('photoGridModal');
  if(!photos.length){grid.innerHTML='<p style="font-size:11px;color:var(--m);text-align:center;padding:10px;">No photos yet. Upload above.</p>';return;}
  // Build via DOM so user-controlled `p.url` and `p.name` cannot inject markup.
  grid.textContent='';
  const e = window.nbdEsc || (s => String(s == null ? '' : s));
  photos.forEach(p => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb';
    const img = document.createElement('img');
    img.src = p.url;
    img.alt = p.name || '';
    img.addEventListener('click', () => {
      // Validate url before opening to avoid javascript: schemes.
      const safe = /^https?:/i.test(p.url) ? p.url : '#';
      window.open(safe, '_blank', 'noopener,noreferrer');
    });
    wrap.appendChild(img);
    grid.appendChild(wrap);
    void e; // keep helper referenced
  });
}

async function uploadPhotos(input){
  let files=Array.from(input.files);
  if(!files.length||!currentPhotoLeadId) return;

  // Batch cap — iPhone 'Select All' can grab 200+ photos. Cap at 25
  // to keep the browser responsive and avoid runaway Storage bills.
  if(files.length > PHOTO_MAX_BATCH){
    const dropped = files.length - PHOTO_MAX_BATCH;
    files = files.slice(0, PHOTO_MAX_BATCH);
    showToast(`Only the first ${PHOTO_MAX_BATCH} photos will upload. ${dropped} skipped — add them in the next batch.`, 'warning');
  }

  // Validate each file before uploading
  const valid = [];
  for(const f of files){
    if(!PHOTO_ALLOWED_TYPES.includes(f.type) && !f.name.match(/\.(jpe?g|png|webp|gif|heic|heif|avif)$/i)){
      showToast(`"${f.name}" is not a supported image type`,'error'); continue;
    }
    if(f.size > PHOTO_MAX_SIZE){
      showToast(`"${f.name}" exceeds 15 MB limit (${(f.size/1024/1024).toFixed(1)} MB)`,'error'); continue;
    }
    valid.push(f);
  }
  if(!valid.length){ input.value=''; return; }

  showToast('Uploading '+valid.length+' photo(s)...');
  let uploaded = 0;
  for(const f of valid){
    const url = await window._uploadPhoto(currentPhotoLeadId,f);
    if(url) uploaded++;
  }
  const photos=await window._getPhotos(currentPhotoLeadId);
  renderPhotoGrid(photos);
  // Invalidate the photo-count cache so the Photos Near Me list
  // re-sorts this lead to the top (it just gained photos).
  if (window._photoCountByLead) {
    window._photoCountByLead[currentPhotoLeadId] =
      (window._photoCountByLead[currentPhotoLeadId] || 0) + uploaded;
  }
  showToast(uploaded === valid.length ? 'Photos uploaded!' : `${uploaded}/${valid.length} uploaded — some failed`);
  input.value='';
}

// ══════════════════════════════════════════════════════════════════════
// Phase D.2 — Cross-lead Recent Photo Feed
//
// CompanyCam-style chronological feed: every photo the rep owns,
// grouped by date, ordered newest-first. Triggered by the "Recent"
// tab in the Photo Library; "By Property" stays the default (existing
// renderPhotoLeads + per-lead gallery).
//
// Query: photos collection, where userId == current uid, ordered by
// uploadedAt desc, limit 200. The photos rules at firestore.rules
// L225 already allow .read for the photo's owner so no rules update
// is needed.
// ══════════════════════════════════════════════════════════════════════
async function renderRecentPhotoFeed() {
  const container = document.getElementById('photoRecentFeed');
  if (!container) return;
  const uid = window._user && window._user.uid;
  if (!uid) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">🔒</div>Sign in to see your photos.</div>';
    return;
  }
  if (!window.db || typeof window.collection !== 'function') {
    container.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>Photo library still loading — try again in a moment.</div>';
    return;
  }
  container.innerHTML = '<div class="empty"><div class="empty-icon">📷</div>Loading recent photos…</div>';

  let docs;
  try {
    const q = window.query(
      window.collection(window.db, 'photos'),
      window.where('userId', '==', uid),
      window.orderBy('uploadedAt', 'desc'),
      window.limit(200)
    );
    const snap = await window.getDocs(q);
    docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[D.2] recent feed query failed:', e && e.message);
    container.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>Could not load recent photos. Refresh to retry.</div>';
    return;
  }

  if (!docs.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">📷</div>No photos yet — capture one from any property to populate this feed.</div>';
    return;
  }

  // Lead-name lookup off the existing window._leads cache so we can
  // tag each tile with which property it came from.
  const leads = window._leads || [];
  const leadName = id => {
    const l = leads.find(x => x.id === id);
    if (!l) return '';
    return ((l.firstName || '') + ' ' + (l.lastName || '')).trim() || l.name || '';
  };

  // Group by display date — Today / Yesterday / Mon DD / Mon DD YYYY.
  const groups = new Map();
  const today = new Date(); today.setHours(0,0,0,0);
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  const dateKey = ts => {
    if (!ts) return 'Older';
    const d = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
    if (!d || isNaN(d)) return 'Older';
    const dd = new Date(d); dd.setHours(0,0,0,0);
    if (dd.getTime() === today.getTime()) return 'Today';
    if (dd.getTime() === yest.getTime()) return 'Yesterday';
    const sameYear = dd.getFullYear() === today.getFullYear();
    return d.toLocaleDateString(undefined, sameYear
      ? { month:'short', day:'numeric' }
      : { month:'short', day:'numeric', year:'numeric' });
  };
  for (const photo of docs) {
    const k = dateKey(photo.uploadedAt || photo.takenAt);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(photo);
  }

  const escAttr = s => String(s || '').replace(/"/g, '&quot;');
  const escText = s => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let html = '';
  for (const [date, photos] of groups) {
    html += '<div class="ph-recent-group">';
    html += '<div class="ph-recent-date">' + escText(date) + '  ·  ' + photos.length + ' photo' + (photos.length === 1 ? '' : 's') + '</div>';
    html += '<div class="ph-recent-grid">';
    for (const p of photos) {
      const url = p.thumbUrl || p.url || p.downloadUrl || p.src || '';
      if (!url) continue;
      const name = leadName(p.leadId);
      html += '<div class="ph-recent-tile" onclick="window._currentPhotoLeadId=\'' + escAttr(p.leadId) + '\';if(window.PhotoEngine)PhotoEngine.openGallery(\'photoGalleryContainer\',\'' + escAttr(p.leadId) + '\');setPhotoMode(\'by-property\');">' +
                '<img loading="lazy" src="' + escAttr(url) + '" alt="">' +
                (name ? '<div class="ph-recent-tile-label">' + escText(name) + '</div>' : '') +
              '</div>';
    }
    html += '</div></div>';
  }
  container.innerHTML = html;
}
window.renderRecentPhotoFeed = renderRecentPhotoFeed;

// ══════════════════════════════════════════════
// PROPERTY INTEL — card render + modal pull
// ══════════════════════════════════════════════
function renderIntelCard(targetElId, intel, county, address) {
  const targetEl = document.getElementById(targetElId);
  if(!targetEl) return;

  // Store intel globally for pre-fill
  window._lastIntel = intel;

  const esc = window.nbdEsc || (s => String(s == null ? '' : s));
  const yr = intel.yearBuilt ? parseInt(intel.yearBuilt) : null;
  const age = yr ? (new Date().getFullYear() - yr) : null;
  const roofAge = intel.roofAge || age;

  let roofBadgeClass = 'pi-roof-mid';
  let roofLabel = '';
  if(roofAge !== null) {
    const rn = Number(roofAge);
    if(rn < 10)      { roofBadgeClass='pi-roof-new';     roofLabel=`${rn} yrs — Likely good`; }
    else if(rn < 20) { roofBadgeClass='pi-roof-mid';     roofLabel=`${rn} yrs — Watch it`; }
    else if(rn < 30) { roofBadgeClass='pi-roof-old';     roofLabel=`${rn} yrs — Needs attention`; }
    else             { roofBadgeClass='pi-roof-ancient'; roofLabel=`${rn} yrs — Due for replacement`; }
  }

  const ownerName  = intel.ownerName || 'Owner Unknown';
  const isLLC     = intel.isLLC || /LLC|INC|CORP|TRUST|PROPERTIES|HOLDINGS|INVESTMENTS/i.test(ownerName);
  const lastSale  = intel.lastSaleAmount ? '$'+parseInt(intel.lastSaleAmount).toLocaleString() : null;
  const mktVal    = intel.marketValue ? '$'+parseInt(intel.marketValue).toLocaleString() : null;
  const dataNote  = intel.dataSource === 'estimated' ? ' (est.)' : '';
  const safeAuditor = /^https?:/i.test(intel.auditorUrl || '') ? intel.auditorUrl : null;

  const card = `<div class="pi-card">
    <div class="pi-header">
      <span class="pi-title">🏠 Property Intel${esc(dataNote)}</span>
      <span class="pi-county">${esc(county || 'OH')} County</span>
    </div>
    <div class="pi-body">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px;">
        <span class="pi-owner">${esc(ownerName)}</span>
        ${isLLC ? '<span class="pi-llc-flag">🏢 LLC/Corp</span>' : ''}
      </div>
      <div class="pi-addr-line">${esc(address)}</div>
      ${roofAge !== null ? `<div class="pi-roof-badge ${esc(roofBadgeClass)}">🏠 ${esc(roofLabel)}</div>` : ''}
      <div class="pi-grid">
        ${yr ? `<div class="pi-stat"><span class="pi-stat-val">${Number(yr)}</span><span class="pi-stat-key">Year Built</span></div>` : ''}
        ${intel.propertyType ? `<div class="pi-stat"><span class="pi-stat-val">${esc(intel.propertyType)}</span><span class="pi-stat-key">Type</span></div>` : ''}
        ${mktVal ? `<div class="pi-stat"><span class="pi-stat-val">${esc(mktVal)}</span><span class="pi-stat-key">Market Value</span></div>` : ''}
        ${lastSale ? `<div class="pi-stat"><span class="pi-stat-val">${esc(lastSale)}</span><span class="pi-stat-key">Last Sale</span></div>` : ''}
        ${intel.lastSaleDate ? `<div class="pi-stat"><span class="pi-stat-val">${esc(intel.lastSaleDate)}</span><span class="pi-stat-key">Sale Date</span></div>` : ''}
        ${intel.bedrooms ? `<div class="pi-stat"><span class="pi-stat-val">${esc(intel.bedrooms)} bed</span><span class="pi-stat-key">Bedrooms</span></div>` : ''}
        ${intel.sqft ? `<div class="pi-stat"><span class="pi-stat-val">${parseInt(intel.sqft).toLocaleString()} sf</span><span class="pi-stat-key">Living Area</span></div>` : ''}
        ${intel.acreage ? `<div class="pi-stat"><span class="pi-stat-val">${parseFloat(intel.acreage).toFixed(3)} ac</span><span class="pi-stat-key">Acreage</span></div>` : ''}
        ${intel.homestead ? `<div class="pi-stat"><span class="pi-stat-val" style="color:var(--green);">Yes</span><span class="pi-stat-key">Homestead</span></div>` : ''}
        ${intel.parcelId ? `<div class="pi-stat"><span class="pi-stat-val" style="font-size:10px;">${esc(intel.parcelId)}</span><span class="pi-stat-key">Parcel ID</span></div>` : ''}
      </div>
      ${safeAuditor ? `<a class="pi-link" href="${esc(safeAuditor)}" target="_blank" rel="noopener noreferrer">↗ View Full County Record</a>` : ''}
    </div>
  </div>`;

  // Replace loading card, keep Make This a Lead button
  const existingCard = targetEl.querySelector('.pi-card');
  if(existingCard) {
    existingCard.outerHTML = card;
  } else {
    targetEl.innerHTML = card + '<button class="make-lead-btn" onclick="makeLeadFromSearch()">＋ Make This a Lead</button>';
  }
}

async function fetchPropertyIntelModal(geo, addr) {
  const resultEl = document.getElementById('modalIntelResult');
  const gAddr = geo.address || {};
  const county = (gAddr.county||'').replace(' County','').trim();

  // Run same engine but capture result for modal
  const cacheKey = addr.toLowerCase().replace(/\s/g,'');
  let intel = _piCache[cacheKey] || null;

  if(!intel) {
    // Temporarily show result container
    resultEl.innerHTML = '<div style="color:var(--m);font-size:11px;">Fetching county records...</div>';
    resultEl.classList.add('visible');
    // Fire the intel engine with a temp container
    const tempId = 'pi-temp-' + Date.now();
    const tempDiv = document.createElement('div');
    tempDiv.id = tempId;
    tempDiv.style.display = 'none';
    document.body.appendChild(tempDiv);
    await fetchPropertyIntel(geo, tempId);
    intel = window._lastIntel || null;
    document.body.removeChild(tempDiv);
  }

  if(!intel) {
    resultEl.innerHTML = '<div style="color:var(--red);font-size:11px;">Could not retrieve property data. Check your API key in Settings.</div>';
    resultEl.classList.add('visible');
    return;
  }

  // Pre-fill lead modal fields
  if(intel.ownerName && intel.ownerName !== 'Owner Unknown') {
    const parts = intel.ownerName.trim().split(/\s+/);
    const fname = document.getElementById('lFname');
    const lname = document.getElementById('lLname');
    if(fname && !fname.value) {
      if(parts.length >= 2) {
        fname.value = parts[0];
        lname.value = parts.slice(1).join(' ');
      } else {
        fname.value = intel.ownerName;
      }
    }
  }

  // Build notes pre-fill
  const notesEl = document.getElementById('lNotes');
  if(notesEl && !notesEl.value) {
    const yr = intel.yearBuilt;
    const age = yr ? (new Date().getFullYear() - parseInt(yr)) : null;
    const lines = [];
    if(yr) lines.push(`Year Built: ${yr} (${age} yr old roof)`);
    if(intel.ownerName) lines.push(`Owner of Record: ${intel.ownerName}`);
    if(intel.propertyType) lines.push(`Property: ${intel.propertyType}`);
    if(intel.marketValue) lines.push(`Market Value: $${parseInt(intel.marketValue).toLocaleString()}`);
    if(intel.lastSaleDate && intel.lastSaleAmount) lines.push(`Last Sale: $${parseInt(intel.lastSaleAmount).toLocaleString()} on ${intel.lastSaleDate}`);
    if(intel.isLLC) lines.push('Owner is LLC/Corporate entity');
    notesEl.value = lines.join('\n');
  }

  // Store yearBuilt for Firestore save
  window._modalIntel = intel;

  // Show compact result card
  const yr = intel.yearBuilt;
  const age = yr ? (new Date().getFullYear() - parseInt(yr)) : null;
  const roofAge = intel.roofAge || age;
  let roofColor = 'var(--gold)';
  if(roofAge !== null) {
    if(roofAge < 10) roofColor = 'var(--green)';
    else if(roofAge < 20) roofColor = 'var(--gold)';
    else if(roofAge < 30) roofColor = 'var(--red)';
    else roofColor = 'var(--purple)';
  }

  const esc = window.nbdEsc || (s => String(s == null ? '' : s));
  resultEl.innerHTML = `
    <div class="mir-owner">${esc(intel.ownerName||'Unknown Owner')}${intel.isLLC?'&nbsp;<span style="font-size:9px;color:var(--blue);font-weight:700;">LLC</span>':''}</div>
    <div class="mir-grid">
      ${yr ? `<div class="mir-item">Built <span>${esc(yr)}</span></div>` : ''}
      ${roofAge !== null ? `<div class="mir-item">Roof <span style="color:${esc(roofColor)};">${Number(roofAge)} yrs</span></div>` : ''}
      ${intel.marketValue ? `<div class="mir-item">Value <span>$${parseInt(intel.marketValue).toLocaleString()}</span></div>` : ''}
      ${intel.propertyType ? `<div class="mir-item">Type <span>${esc(intel.propertyType)}</span></div>` : ''}
      ${intel.bedrooms ? `<div class="mir-item">Beds <span>${esc(intel.bedrooms)}</span></div>` : ''}
      ${intel.homestead ? `<div class="mir-item">Homestead <span style="color:var(--green);">Yes</span></div>` : ''}
    </div>
    <div style="font-size:10px;color:var(--m);margin-top:5px;">✓ Owner name and notes pre-filled below</div>`;
  resultEl.classList.add('visible');
}

// ══════════════════════════════════════════════
// ZONE LIST — Territory zones render
// ══════════════════════════════════════════════
function renderZoneList() {
  const el = document.getElementById('zoneList');
  if(!el) return;
  if(!zones.length) { el.innerHTML=''; return; }
  const esc = window.nbdEsc || (s => String(s == null ? '' : s));
  // Only accept hex colors; reject anything else to block style-attr injection.
  const safeColor = c => /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : 'var(--blue)';
  el.innerHTML = zones.map(z => `
    <div class="zone-item">
      <div class="zone-dot" style="background:${safeColor(z.color)};"></div>
      <span>${esc(z.name)}</span>
      <button class="zone-del nbd-zone-del" data-zone-id="${esc(z.id)}">✕</button>
    </div>`).join('');
  el.querySelectorAll('.nbd-zone-del').forEach(btn => {
    btn.addEventListener('click', () => deleteZone(btn.dataset.zoneId));
  });
}

// ══════════════════════════════════════════════
// PIN STATS OVERLAY
// ══════════════════════════════════════════════
function updatePinStats() {
  const el = document.getElementById('pinStatsOverlay');
  if(!el || !window._pins) return;
  const pins = window._pins;
  if(!pins.length) { el.innerHTML=''; return; }
  const counts = {};
  pins.forEach(p => { counts[p.status] = (counts[p.status]||0) + 1; });
  const total = pins.length;
  const signed = counts['signed']||0;
  const interested = counts['interested']||0;
  const notHome = counts['not-home']||0;

  el.innerHTML = `
    <div class="pin-stat-pill">
      <span style="font-weight:700;color:var(--t);">${total}</span>
      <span style="font-size:9px;color:var(--m);text-transform:uppercase;letter-spacing:.06em;">Doors</span>
    </div>
    ${signed ? `<div class="pin-stat-pill"><div class="pin-stat-dot" style="background:var(--gold);"></div><span style="color:var(--gold);font-weight:700;">${signed} Signed</span></div>` : ''}
    ${interested ? `<div class="pin-stat-pill"><div class="pin-stat-dot" style="background:var(--green);"></div><span style="color:var(--green);font-weight:700;">${interested} Interested</span></div>` : ''}
    ${notHome ? `<div class="pin-stat-pill"><div class="pin-stat-dot" style="background:#9CA3AF;"></div><span style="color:var(--m);">${notHome} Not Home</span></div>` : ''}`;
}

// ══════════════════════════════════════════════════════════════════════
// KANBAN CARD DETAIL MODAL
// ══════════════════════════════════════════════════════════════════════
function openCardDetailModal(leadId) {
  const lead = (window._leads || []).find(l => l.id === leadId);
  if (!lead) return;

  window._cardDetailLeadId = leadId;

  // Populate modal
  document.getElementById('cardDetailName').textContent =
    `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Lead';
  // Stage chip — use stageLabel() to convert raw keys ("claim_filed")
  // to display labels ("Claim Filed"), and stageColor() to tint the
  // chip so it matches the kanban column it came from.
  const stageEl = document.getElementById('cardDetailStage');
  if (stageEl) {
    const rawStage = lead._stageKey || lead.stage || 'new';
    const label = (typeof window.stageLabel === 'function')
      ? window.stageLabel(rawStage)
      : String(rawStage).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const color = (typeof window.stageColor === 'function')
      ? window.stageColor(rawStage)
      : 'var(--m)';
    stageEl.textContent = label;
    stageEl.style.color = color;
    stageEl.style.borderColor = `color-mix(in srgb, ${color} 50%, var(--br))`;
    stageEl.style.background = `color-mix(in srgb, ${color} 14%, var(--s2))`;
  }
  document.getElementById('cardDetailAddress').textContent = lead.address || '—';
  document.getElementById('cardDetailPhone').textContent = lead.phone || '—';
  document.getElementById('cardDetailDamage').textContent = lead.damageType || '—';
  document.getElementById('cardDetailValue').textContent =
    lead.jobValue ? `$${parseFloat(lead.jobValue).toLocaleString()}` : '—';

  // ─── Prospect promote button + quick actions ───
  // Show a "Promote to Customer" CTA + a row of quick actions
  // (Call/Text/Email/Re-knock/Map/Hide/Delete) at the top of the detail
  // modal when this lead is still a prospect. The actions row is built
  // each time so it reflects the current lead's data (phone, email, lat/lng).
  const promoteBanner = document.getElementById('cardDetailPromoteBanner');
  if (promoteBanner) {
    if (lead.isProspect) {
      promoteBanner.style.display = 'flex';
      populateProspectQuickActions(lead);
    } else {
      promoteBanner.style.display = 'none';
    }
  }
  // Sync the kind label so we don't show "CUSTOMER" on a prospect
  // (and vice versa). Belt-and-suspenders alongside the banner above.
  const kindLabel = document.getElementById('cardDetailKindLabel');
  if (kindLabel) kindLabel.textContent = lead.isProspect ? 'PROSPECT' : 'CUSTOMER';

  // Show modal
  document.getElementById('cardDetailModal').classList.add('open');
}
window.openCardDetailModal = openCardDetailModal;

function closeCardDetailModal() {
  document.getElementById('cardDetailModal').classList.remove('open');
  window._cardDetailLeadId = null;
}
window.closeCardDetailModal = closeCardDetailModal;

// ══════════════════════════════════════════════════════════════════════
// Wave 2B — Mobile job-detail screen
//
// Phones get a full-screen overlay instead of the shrunken
// cardDetailModal. Same data flow (window._leads + window._photoCache),
// fundamentally different layout: hero photo banner, big action ring,
// 3 tabs (Activity / Photos / Details). Routing decision lives in
// openLeadDetail() below — that's what card clicks now call.
//
// On a tablet/desktop session the .m-jobdetail selector is force-hidden
// via the @media (min-width:769px) rule in dashboard.html, so this code
// is mobile-only by construction even if a wrong path opens it.
// ══════════════════════════════════════════════════════════════════════
function openMobileJobDetail(leadId) {
  const lead = (window._leads || []).find(l => l.id === leadId);
  if (!lead) return;
  window._cardDetailLeadId = leadId;

  const $ = (id) => document.getElementById(id);

  // ── Status pill (uses the same stageLabel/stageColor as the desktop modal) ──
  const rawStage = lead._stageKey || lead.stage || 'new';
  const stageEl = $('mJdStatus');
  if (stageEl) {
    const label = (typeof window.stageLabel === 'function')
      ? window.stageLabel(rawStage)
      : String(rawStage).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const color = (typeof window.stageColor === 'function')
      ? window.stageColor(rawStage) : 'var(--orange)';
    stageEl.textContent = label;
    stageEl.style.color = color;
    stageEl.style.background = 'color-mix(in srgb, ' + color + ' 14%, transparent)';
  }

  // ── Title block ──
  const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim()
    || lead.name || 'Lead';
  $('mJdName').textContent = name;
  $('mJdAddr').textContent = lead.address || '—';
  const valEl = $('mJdValue');
  if (lead.jobValue) {
    valEl.textContent = '$' + parseFloat(lead.jobValue).toLocaleString();
    valEl.hidden = false;
  } else {
    valEl.hidden = true;
  }

  // ── Hero photo ──
  const photos = (window._photoCache && window._photoCache[lead.id]) || [];
  const heroEl = $('mJdHero');
  const firstPhotoUrl = photos[0] && (photos[0].url || photos[0].downloadUrl || photos[0].src);
  if (firstPhotoUrl) {
    heroEl.style.backgroundImage = 'url("' + String(firstPhotoUrl).replace(/"/g, '%22') + '")';
    heroEl.classList.add('has-photo');
  } else {
    heroEl.style.backgroundImage = '';
    heroEl.classList.remove('has-photo');
  }

  // ── Storm chip — NBD differentiator ──
  const stormEl = $('mJdStorm');
  if (lead.hailHit && lead.hailHit.sizeInches) {
    const inches = Number(lead.hailHit.sizeInches).toFixed(1);
    let when = '';
    const hitAt = lead.hailHit.date || lead.hailHit.observedAt;
    if (hitAt) {
      const d = (hitAt && hitAt.toDate) ? hitAt.toDate()
              : (hitAt instanceof Date) ? hitAt
              : new Date(hitAt);
      if (d && !isNaN(d)) {
        const days = Math.floor((Date.now() - d.getTime()) / 86400000);
        when = days <= 0 ? ' · today'
             : days === 1 ? ' · yesterday'
             : days < 30 ? ' · ' + days + 'd ago'
             : '';
      }
    }
    stormEl.textContent = inches + '" hail' + when;
    stormEl.hidden = false;
  } else {
    stormEl.hidden = true;
  }

  // ── Action button enablement ──
  const setEnabled = (id, on) => {
    const b = $(id);
    if (b) b.disabled = !on;
  };
  setEnabled('mJdCall',  !!lead.phone);
  setEnabled('mJdText',  !!lead.phone);
  setEnabled('mJdEmail', !!lead.email);
  setEnabled('mJdPhotos', true);
  setEnabled('mJdEstimate', true);

  // ── Details tab ──
  $('mJdDmg').textContent     = lead.damageType || '—';
  $('mJdPhone').textContent   = lead.phone || '—';
  $('mJdEmailV').textContent  = lead.email || '—';
  $('mJdSource').textContent  = lead.source || lead.leadSource || '—';
  $('mJdCarrier').textContent = lead.carrier || lead.insuranceCarrier || '—';
  $('mJdClaim').textContent   = lead.claimNumber || lead.claim || '—';

  // ── Photos tab — CompanyCam-style date groups ──
  const photoBody = $('mJdTabPhotos');
  if (photoBody) {
    if (!photos.length) {
      photoBody.innerHTML = '<div class="m-jd-empty">No photos yet.</div>';
    } else {
      const groups = {};
      photos.forEach(p => {
        const ts = (p.takenAt && p.takenAt.toDate) ? p.takenAt.toDate()
                 : (p.takenAt instanceof Date) ? p.takenAt
                 : (p.takenAt) ? new Date(p.takenAt)
                 : (p.uploadedAt && p.uploadedAt.toDate) ? p.uploadedAt.toDate()
                 : null;
        const key = ts && !isNaN(ts)
          ? ts.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' })
          : 'Older';
        (groups[key] = groups[key] || []).push(p);
      });
      const escAttr = (s) => String(s).replace(/"/g, '%22');
      photoBody.innerHTML = Object.keys(groups).map(date => {
        const tiles = groups[date].map(p => {
          const url = p.url || p.downloadUrl || p.src || '';
          return url ? '<img loading="lazy" src="' + escAttr(url) + '" alt="">' : '';
        }).join('');
        return '<div class="m-jd-photo-group">'
             +   '<div class="m-jd-photo-date">' + date + '</div>'
             +   '<div class="m-jd-photo-grid">' + tiles + '</div>'
             + '</div>';
      }).join('');
    }
  }

  // ── Reset to Activity tab on every open ──
  _mJdSwitchTab('activity');

  // Show
  const root = $('mJobDetail');
  root.hidden = false;
  root.classList.add('open');
  document.body.style.overflow = 'hidden';
}
window.openMobileJobDetail = openMobileJobDetail;

function closeMobileJobDetail() {
  const root = document.getElementById('mJobDetail');
  if (!root) return;
  root.classList.remove('open');
  root.hidden = true;
  document.body.style.overflow = '';
}
window.closeMobileJobDetail = closeMobileJobDetail;

// Populate the row of quick actions inside the prospect banner. Disabled
// states render for actions whose underlying data isn't on the lead
// (e.g. no phone → Call/Text disabled). Uses programmatic event listeners
// instead of inline onclick attributes so addresses with special chars
// (double-quotes, ampersands, etc.) can't break the HTML.
function populateProspectQuickActions(lead) {
  const wrap = document.getElementById('prospectQuickActions');
  if (!wrap) return;
  const phone = (lead.phone || '').replace(/\D/g, '');
  const email = (lead.email || '').trim();
  const hasGeo = (lead.lat != null && lead.lng != null);
  const isHidden = !!lead.prospectHidden;

  // Build buttons with createElement so user-controlled strings (address,
  // email) never enter the HTML attribute parser.
  wrap.innerHTML = '';
  const make = (icon, label, opts) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${icon} ${label}`;
    b.disabled = !!opts.disabled;
    const danger = !!opts.danger;
    const color = danger ? 'var(--red)' : 'var(--t)';
    const border = danger ? 'rgba(224,82,82,.35)' : 'var(--br)';
    b.style.cssText = `
      display:inline-flex;align-items:center;gap:5px;
      padding:6px 11px;border-radius:6px;
      background:${opts.disabled ? 'transparent' : 'var(--s2)'};
      border:1px solid ${border};
      color:${opts.disabled ? 'var(--m)' : color};
      font-family:inherit;font-size:11px;font-weight:600;
      cursor:${opts.disabled ? 'not-allowed' : 'pointer'};
      opacity:${opts.disabled ? '.45' : '1'};
      transition:all .15s;
    `;
    if (!opts.disabled && typeof opts.onClick === 'function') {
      b.addEventListener('click', opts.onClick);
    }
    return b;
  };

  wrap.appendChild(make('📞', 'Call',  { disabled: !phone, onClick: () => { window.location.href = 'tel:' + phone; } }));
  wrap.appendChild(make('💬', 'Text',  { disabled: !phone, onClick: () => { window.location.href = 'sms:' + phone; } }));
  wrap.appendChild(make('✉️', 'Email', { disabled: !email, onClick: () => { window.location.href = 'mailto:' + email; } }));
  wrap.appendChild(make('🚪', 'Re-knock', { onClick: () => {
    closeCardDetailModal();
    if (window.D2D) {
      window.D2D.openQuickKnock({ address: lead.address || '', lat: lead.lat || null, lng: lead.lng || null });
    } else {
      goTo('d2d');
    }
  }}));
  wrap.appendChild(make('🗺️', 'See on Map', {
    disabled: !hasGeo,
    onClick: () => { closeCardDetailModal(); window.viewProspectOnMap(lead.id); }
  }));
  wrap.appendChild(make(isHidden ? '👁️' : '🗄️', isHidden ? 'Unhide' : 'Hide', {
    onClick: () => { window.toggleProspectHidden(lead.id); }
  }));
  wrap.appendChild(make('🗑️', 'Delete', {
    danger: true, onClick: () => { window.absoluteDeleteProspect(lead.id); }
  }));
}

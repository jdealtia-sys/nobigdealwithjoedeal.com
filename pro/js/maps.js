// ============================================================
// NBD Pro — maps.js
// Map init, pins, overlays, heat map, storm layer,
// drawing tool, measurement, zone management
// ============================================================

// ══════════════════════════════════════════════
// MAIN MAP
// ══════════════════════════════════════════════
let mainMap, curPinStatus='not-home', curPinColor='#9CA3AF', pinMarkers={};
const PIN_LABELS = {'not-home':'Not Home','interested':'Interested','not-interested':'Not Interested','signed':'⭐ Signed','callback':'Callback','do-not-knock':'Do Not Knock','left-material':'Left Material','follow-up':'Follow Up'};
const PIN_COLORS = {'not-home':'#9CA3AF','interested':'#2ECC8A','not-interested':'#E05252','signed':'#D4A017','callback':'#4A9EFF','do-not-knock':'#374151','left-material':'#9B6DFF','follow-up':'#C8541A'};

// Stage colors for customer pins (matches kanban)
const STAGE_COLORS = {
  'New': '#9CA3AF',
  'Inspection': '#4A9EFF',
  'Estimate': '#D4A017',
  'Approved': '#9B6DFF',
  'In Progress': '#22C55E',
  'Complete': '#4ade80',
  'Lost': '#E05252'
};

// ══════════════════════════════════════════════
// MAP OVERLAY SYSTEM
// ══════════════════════════════════════════════
let overlayState = { heat:false, pins:true, jobs:false, storm:false, weather:false };
let heatLayer = null, jobMarkers = [], weatherLayer = null, stormTileLayer = null;
let pendingPin = null; // { lat, lng, status, color } — waiting for confirm

function initMainMap() {
  mainMap = L.map('mainMap').setView([39.07,-84.17],14);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'© Esri',maxZoom:20}).addTo(mainMap);
  // Click = show confirm dialog instead of instant drop
  mainMap.on('click', e => openPinConfirm(e.latlng.lat, e.latlng.lng));
  if(window._pins) window._pins.forEach(p => addPinMarker(p));
  // Build heat + jobs layers from existing data
  setTimeout(()=>{ buildHeatLayer(); buildJobsLayer(); updatePinStats(); }, 400);
}

// ── OVERLAY TOGGLE ──────────────────────────────
function toggleOverlay(type, el) {
  overlayState[type] = !overlayState[type];
  el.classList.toggle('on', overlayState[type]);
  if(type==='heat')    { overlayState.heat    ? showHeatLayer()    : hideHeatLayer();    }
  if(type==='pins')    { overlayState.pins    ? showAllPins()      : hideAllPins();      }
  if(type==='jobs')    { overlayState.jobs    ? showJobsLayer()    : hideJobsLayer();    }
  if(type==='storm')   { overlayState.storm   ? showStormLayer()   : hideStormLayer();   }
  if(type==='weather') { overlayState.weather ? showWeatherLayer() : hideWeatherLayer(); }
}

// ── HEAT MAP ─────────────────────────────────────
function buildHeatLayer() {
  if(!mainMap || !window._pins) return;
  const pts = window._pins.map(p => [p.lat, p.lng, 0.5]);
  if(heatLayer) mainMap.removeLayer(heatLayer);
  if(pts.length === 0) return;
  heatLayer = L.heatLayer(pts, {
    radius:28, blur:22, maxZoom:17,
    gradient:{0.3:'#4A9EFF', 0.5:'#EAB308', 0.75:'#FF6B35', 1.0:'#E05252'}
  });
  if(overlayState.heat) heatLayer.addTo(mainMap);
}
function showHeatLayer() { if(!heatLayer){ buildHeatLayer(); return; } heatLayer.addTo(mainMap); }
function hideHeatLayer() { if(heatLayer) mainMap.removeLayer(heatLayer); }
function refreshHeatLayer() { buildHeatLayer(); }

// ── PINS SHOW/HIDE ───────────────────────────────
function showAllPins() { Object.values(pinMarkers).forEach(m=>m.addTo(mainMap)); }
function hideAllPins() { Object.values(pinMarkers).forEach(m=>mainMap.removeLayer(m)); }

// ── JOBS OVERLAY ──────────────────────────────────
async function buildJobsLayer() {
  if(!mainMap) return;
  jobMarkers.forEach(m=>mainMap.removeLayer(m));
  jobMarkers = [];
  const leads = window._leads || [];
  const active = leads.filter(l => ['In Progress','Complete','Finalizing'].includes(l.stage||''));
  for(const lead of active) {
    const addr = lead.address || lead.addr || '';
    if(!addr) continue;
    try {
      const geo = await geocode(addr);
      if(!geo) continue;
      const val = parseFloat(lead.value||lead.jobValue||lead.contractValue||0);
      const label = val > 0 ? '$'+val.toLocaleString() : lead.stage;
      const color = lead.stage==='Complete' ? '#34D399' : lead.stage==='In Progress' ? '#4A9EFF' : '#EAB308';
      const icon = L.divIcon({
        html:`<div style="background:${color};color:#0A0C0F;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:800;padding:3px 7px;border-radius:5px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.2);">💰 ${label}</div>`,
        iconAnchor:[0,0], className:''
      });
      const m = L.marker([parseFloat(geo.lat),parseFloat(geo.lon)],{icon});
      m.bindPopup(`<div style="font-family:sans-serif;min-width:160px;">
        <b style="font-size:13px;color:${color};">${lead.name||'Lead'}</b>
        <p style="font-size:11px;color:#666;margin:4px 0;">${addr}</p>
        <p style="font-size:11px;margin:2px 0;"><b>Stage:</b> ${lead.stage}</p>
        ${val>0?`<p style="font-size:12px;font-weight:700;color:${color};">$${val.toLocaleString()}</p>`:''}
      </div>`);
      jobMarkers.push(m);
      if(overlayState.jobs) m.addTo(mainMap);
      await new Promise(r=>setTimeout(r,180)); // rate-limit Nominatim
    } catch(e){}
  }
}
function showJobsLayer() {
  if(jobMarkers.length===0){ buildJobsLayer(); return; }
  jobMarkers.forEach(m=>m.addTo(mainMap));
}
function hideJobsLayer() { jobMarkers.forEach(m=>mainMap.removeLayer(m)); }

// ── STORM LAYER (NOAA via RainViewer / mesonet tile) ───────
function showStormLayer() {
  if(stormTileLayer) { stormTileLayer.addTo(mainMap); return; }
  // NOAA Ridge2 latest composite reflectivity — free, no key
  stormTileLayer = L.tileLayer(
    'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png',
    {opacity:0.65, attribution:'NOAA/IEM', maxZoom:20, tms:false}
  );
  stormTileLayer.addTo(mainMap);
  showToast('Storm radar loaded — NOAA NEXRAD');
}
function hideStormLayer() { if(stormTileLayer) mainMap.removeLayer(stormTileLayer); }

// ── WEATHER LAYER (OpenWeatherMap precipitation — free tier key optional) ──
function showWeatherLayer() {
  if(weatherLayer) { weatherLayer.addTo(mainMap); return; }
  // RainViewer public precipitation overlay — no API key needed
  weatherLayer = L.tileLayer(
    'https://tilecache.rainviewer.com/v2/coverage/0/256/{z}/{x}/{y}/1/1_1.png',
    {opacity:0.55, attribution:'RainViewer', maxZoom:20}
  );
  weatherLayer.addTo(mainMap);
  showToast('Live weather overlay active');
}
function hideWeatherLayer() { if(weatherLayer) mainMap.removeLayer(weatherLayer); }

// ── PIN CONFIRM FLOW ─────────────────────────────
function openPinConfirm(lat, lng) {
  pendingPin = { lat, lng, status: curPinStatus, color: curPinColor };
  document.getElementById('pcd-dot').style.background = curPinColor;
  document.getElementById('pcd-label').textContent = PIN_LABELS[curPinStatus] || curPinStatus;
  document.getElementById('pcd-coords').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  document.getElementById('pcd-notes').value = '';
  document.getElementById('pinConfirmOverlay').classList.add('open');
}
function cancelPinConfirm() {
  pendingPin = null;
  document.getElementById('pinConfirmOverlay').classList.remove('open');
}
async function commitPin() {
  if(!pendingPin) return;
  const notes = document.getElementById('pcd-notes').value.trim();
  document.getElementById('pinConfirmOverlay').classList.remove('open');
  await dropPin(pendingPin.lat, pendingPin.lng, pendingPin.status, pendingPin.color, null, notes);
  refreshHeatLayer();
  pendingPin = null;
  showToast('Pin saved ✓');
  if(typeof updatePinStats === 'function') updatePinStats();
}

// ── DROP PIN BY ADDRESS ──────────────────────────
async function dropPinByAddress() {
  const addr = document.getElementById('pinAddrInput').value.trim();
  let lat, lng;
  if(addr) {
    showToast('Geocoding address...');
    const geo = await geocode(addr);
    if(!geo) { showToast('Address not found','error'); return; }
    lat = parseFloat(geo.lat); lng = parseFloat(geo.lon);
    mainMap.setView([lat,lng],18);
  } else {
    const c = mainMap.getCenter();
    lat = c.lat; lng = c.lng;
  }
  openPinConfirm(lat, lng);
  document.getElementById('pinAddrInput').value = '';
}

// ── ORIGINAL PIN FUNCTIONS (updated) ────────────────
function makePinIcon(color, status) {
  const svg = status==='signed' ? '⭐' : `<svg viewBox="0 0 24 32" width="20" height="28" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C7.6 0 4 3.6 4 8c0 6 8 16 8 16s8-10 8-16c0-4.4-3.6-8-8-8z" fill="${color}" stroke="white" stroke-width="1.5"/><circle cx="12" cy="8" r="3" fill="white"/></svg>`;
  return L.divIcon({html:`<div style="font-size:20px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));">${svg}</div>`,iconSize:[20,28],iconAnchor:[10,28],popupAnchor:[0,-28],className:''});
}

async function dropPin(lat,lng,status,color,existingId,notes) {
  const id = existingId || await window._savePin({lat,lng,status,color,notes});
  addPinMarker({id,lat,lng,status,color,notes});
}

function addPinMarker(p) {
  if(!mainMap) return;
  
  // Determine pin color: use stage color for customer pins, status color otherwise
  let pinColor = p.color || PIN_COLORS[p.status] || '#9CA3AF';
  if (p.type === 'customer' && p.stage && STAGE_COLORS[p.stage]) {
    pinColor = STAGE_COLORS[p.stage];
  }
  
  const m = L.marker([p.lat,p.lng],{icon:makePinIcon(pinColor, p.status || p.stage)});
  m.on('click', () => openPinLeadPopup(p, m));
  m.addTo(mainMap);
  pinMarkers[p.id] = m;
}

function buildPinPopupHTML(p, lead) {
  const statusColor = PIN_COLORS[p.status] || '#9CA3AF';
  const statusLabel = PIN_LABELS[p.status] || p.status;
  if(lead) {
    const name  = ((lead.firstName||'')+ ' ' +(lead.lastName||'')).trim() || lead.address || 'Lead';
    const addr  = (lead.address||'').split(',').slice(0,2).join(',');
    const val   = lead.jobValue ? '$'+parseFloat(lead.jobValue).toLocaleString() : '—';
    const stage = lead.stage || 'New';
    const dmg   = lead.damageType || '—';
    const claim = lead.claimStatus || '—';
    return `<div class="pin-lead-popup">
      <div class="plp-header">
        <div class="plp-status"><span style="width:8px;height:8px;border-radius:50%;background:${statusColor};display:inline-block;"></span>${statusLabel}</div>
        <div class="plp-name">${name}</div>
        <div class="plp-addr">${addr}</div>
      </div>
      <div class="plp-body">
        <div class="plp-row"><span class="plp-key">Stage</span><span class="plp-val">${stage}</span></div>
        <div class="plp-row"><span class="plp-key">Damage</span><span class="plp-val">${dmg}</span></div>
        <div class="plp-row"><span class="plp-key">Claim</span><span class="plp-val">${claim}</span></div>
        <div class="plp-row"><span class="plp-key">Value</span><span class="plp-val" style="color:var(--green);">${val}</span></div>
        ${p.notes ? `<div class="plp-row"><span class="plp-key">Notes</span><span class="plp-val">${p.notes}</span></div>` : ''}
      </div>
      <div class="plp-btns">
        <button class="plp-btn-go" onclick="goToLeadFromPin('${lead.id}')">→ Go to Lead</button>
        <button class="plp-btn-del" onclick="deleteLeadFromPin('${lead.id}','${name.replace(/'/g,'&#39;')}',this)">🗑 Delete Lead</button>
      </div>
    </div>`;
  } else {
    return `<div class="pin-lead-popup">
      <div class="plp-header">
        <div class="plp-status"><span style="width:8px;height:8px;border-radius:50%;background:${statusColor};display:inline-block;"></span>${statusLabel}</div>
        <div class="plp-name">No lead linked</div>
        <div class="plp-addr">${p.notes || 'No notes'}</div>
      </div>
      <div class="plp-btns">
        <button class="plp-btn-go" onclick="makeLeadFromPin('${p.id}')">＋ Create Lead Here</button>
        <button class="plp-btn-del" onclick="deletePinOnly('${p.id}')">🗑 Delete Pin</button>
      </div>
    </div>`;
  }
}

function openPinLeadPopup(p, marker) {
  const leads = window._leads || [];
  let matched = null;
  
  // NEW: Match by leadId if available (from auto-pinned leads)
  if (p.leadId) {
    matched = leads.find(l => l.id === p.leadId);
  }
  
  // FALLBACK: Match by address proximity or notes (old pins)
  if (!matched) {
    const pinLat = parseFloat(p.lat), pinLng = parseFloat(p.lng);
    
    // Try matching notes → address
    if (p.notes) {
      const notesLower = p.notes.toLowerCase();
      matched = leads.find(l => {
        const addr = (l.address||'').toLowerCase();
        return addr && notesLower.includes(addr.split(',')[0].toLowerCase());
      });
    }
    
    // Try reverse: lead address geocache match by lat/lng proximity (< 50m)
    if (!matched) {
      matched = leads.find(l => {
        if (!l.lat || !l.lng) return false;
        const dlat = Math.abs(parseFloat(l.lat) - pinLat);
        const dlng = Math.abs(parseFloat(l.lng) - pinLng);
        return dlat < 0.0005 && dlng < 0.0005;
      });
    }
  }
  
  const popupHTML = buildPinPopupHTML(p, matched);
  const popup = marker.bindPopup(popupHTML, {
    maxWidth: 280, minWidth: 220,
    className: 'nbd-pin-popup',
    closeButton: true
  }).openPopup();
  
  // NEW: Add click handler to open card detail modal
  if (matched && matched.id) {
    popup.on('popupopen', () => {
      const popupEl = document.querySelector('.nbd-pin-popup');
      if (popupEl) {
        popupEl.style.cursor = 'pointer';
        popupEl.addEventListener('click', () => {
          goTo('crm');
          setTimeout(() => openCardDetailModal(matched.id), 300);
        });
      }
    });
  }
}

function goToLeadFromPin(leadId) {
  // Close any open popup
  if(mainMap) mainMap.closePopup();
  // Navigate to CRM, then highlight the lead card
  goTo('crm');
  setTimeout(()=>{
    const card = document.querySelector(`.k-card[data-id="${leadId}"]`);
    if(card) {
      card.scrollIntoView({behavior:'smooth', block:'center'});
      card.style.outline = '2px solid var(--orange)';
      card.style.outlineOffset = '2px';
      setTimeout(()=>{ card.style.outline=''; card.style.outlineOffset=''; }, 2500);
    }
  }, 350);
}

function deleteLeadFromPin(leadId, leadName, btnEl) {
  if(mainMap) mainMap.closePopup();
  showDeleteConfirm(leadId, leadName);
}

function makeLeadFromPin(pinId) {
  if(mainMap) mainMap.closePopup();
  const pin = window._pins?.find(p=>p.id===pinId);
  openLeadModal();
  if(pin?.notes) {
    setTimeout(()=>{
      const notesEl = document.getElementById('lNotes');
      if(notesEl) notesEl.value = pin.notes;
      document.getElementById('lFname')?.focus();
    }, 80);
  }
}

function deletePinOnly(pinId) {
  if(mainMap) mainMap.closePopup();
  deletePin(pinId);
}

function selectPin(status,color,el) {
  document.querySelectorAll('.pin-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  curPinStatus=status; curPinColor=color;
  document.getElementById('mapBadge').textContent='📍 '+(PIN_LABELS[status]||status).toUpperCase();
}
function deletePin(id) { if(pinMarkers[id]){mainMap.removeLayer(pinMarkers[id]);delete pinMarkers[id];} window._deletePin(id); refreshHeatLayer(); }
function clearAllPins() { Object.values(pinMarkers).forEach(m=>mainMap.removeLayer(m)); pinMarkers={}; }

async function searchMap() {
  const q=document.getElementById('mapSearch').value.trim(); if(!q)return;
  hideAcDrop('mapSearch');
  const data=await geocode(q); if(!data) return;
  mainMap.setView([data.lat,data.lon],19);
  window._lastMapSearch = data;
  const parts = data.display_name.split(',');
  const shortAddr = parts.slice(0,3).join(',').trim();
  // Show loading state immediately
  document.getElementById('propCard').style.display='block';
  document.getElementById('propCardInner').innerHTML=`
    <div class="pi-card">
      <div class="pi-header"><span class="pi-title">🏠 Property Intel</span><span class="pi-county"></span></div>
      <div class="pi-loading"><div class="pi-spinner"></div>Looking up county records...</div>
    </div>
    <button class="make-lead-btn" onclick="makeLeadFromSearch()">＋ Make This a Lead</button>`;
  // Fire intel lookup
  fetchPropertyIntel(data, 'propCardInner');
}
window.searchMap = searchMap;

function makeLeadFromSearch() {
  const d = window._lastMapSearch;
  if(!d) return;
  const a = d.address || {};
  // Build clean address string
  const num   = a.house_number || '';
  const road  = a.road || a.street || '';
  const city  = a.city || a.town || a.village || a.county || '';
  const state = a.state_code || a.state || '';
  const zip   = a.postcode || '';
  const addrStr = [num+' '+road, city, state+' '+zip].map(s=>s.trim()).filter(Boolean).join(', ');
  // Open lead modal and pre-fill
  openLeadModal();
  setTimeout(()=>{
    if(addrStr) document.getElementById('lAddr').value = addrStr;
    // Source default = Door Knock since they're on the map
    const srcEl = document.getElementById('lSource');
    if(srcEl) srcEl.value = 'Door Knock';
    // Pre-fill notes with full address context
    const notesEl = document.getElementById('lNotes');
    if(notesEl && !notesEl.value) {
      notesEl.value = `Map search: ${d.display_name}`;
    }
    // Focus first name so they can type right away
    document.getElementById('lFname')?.focus();
  }, 80);
}

function damagNearMe() { showToast('Getting location...'); navigator.geolocation?.getCurrentPosition(p=>{ if(mainMap) mainMap.setView([p.coords.latitude,p.coords.longitude],15); }, ()=>showToast('Location unavailable','error')); }

// ══════════════════════════════════════════════
// DRAW MAP
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// DRAWING TOOL — full rewrite with perimeter, eave/rake, gutters, line select
// ══════════════════════════════════════════════
let drawMap, drawOn=false, drawStart=null, drawLT=0, drawnLines=[], tempLine=null, tempLbl=null;
let drawMode = 'line'; // 'line' | 'perim' | 'er' | 'gutter'

// LT index 10 = Gutters (added)
const LT = [
  {n:'Ridge',      color:'#22C55E', dash:null},
  {n:'Ridge Vent', color:'#86EFAC', dash:'8,4'},
  {n:'Hip',        color:'#06B6D4', dash:null},
  {n:'Valley',     color:'#3B82F6', dash:null},
  {n:'Rake',       color:'#EC4899', dash:'8,5'},
  {n:'Eave',       color:'#BE185D', dash:null},
  {n:'Flashing',   color:'#F97316', dash:'4,3'},
  {n:'Step Flash', color:'#EAB308', dash:'4,3'},
  {n:'Drip Edge',  color:'#1D4ED8', dash:null},
  {n:'Parapet',    color:'#92400E', dash:null},
  {n:'Gutters',    color:'#06B6D4', dash:'10,4'}
];

// Perimeter state
let perimPoints   = [];   // latlng array
let perimDots     = [];   // circleMarker array
let perimSegments = [];   // {line, lbl, dist, p1, p2, subtype} subtype='eave'|'rake'
let perimClosed   = false;
let perimPendingP1 = null; // point waiting for rake/eave choice
let perimPendingP2 = null;
let perimTempLine  = null;
let perimTempLbl   = null;
let perimPolygon   = null; // fill polygon when closed
let perimBaseArea  = 0;
// The first-point close indicator ring
let perimCloseRing = null;

// Line select
let selectedLineId = null;

function initDrawMap() {
  drawMap = L.map('drawMap').setView([39.07,-84.17],19);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'© Esri',maxZoom:21}).addTo(drawMap);

  drawMap.on('click', e => {
    if(!drawOn) return;
    if(drawMode === 'line') handleLineClick(e.latlng);
    else if(drawMode === 'perim') handlePerimClick(e.latlng);
    else if(drawMode === 'gutter') handleGutterClick(e.latlng);
    // 'er' mode handled by segment click listeners
  });

  drawMap.on('mousemove', e => {
    if(!drawOn) return;
    if(drawMode === 'line' && drawStart) {
      if(tempLine) drawMap.removeLayer(tempLine);
      if(tempLbl)  drawMap.removeLayer(tempLbl);
      const lt = LT[drawLT];
      tempLine = L.polyline([drawStart, e.latlng], {color:lt.color, weight:3, dashArray:'6,4', opacity:.7}).addTo(drawMap);
      const d = hav(drawStart, e.latlng);
      tempLbl  = L.marker(mid(drawStart, e.latlng), {icon:L.divIcon({html:`<div class="meas-label">${d.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
    }
    if((drawMode === 'perim' || drawMode === 'gutter') && perimPoints.length > 0 && !perimClosed) {
      const lastPt = perimPoints[perimPoints.length-1];
      if(perimTempLine) drawMap.removeLayer(perimTempLine);
      if(perimTempLbl)  drawMap.removeLayer(perimTempLbl);
      const color = drawMode === 'gutter' ? '#06B6D4' : '#BE185D';
      perimTempLine = L.polyline([lastPt, e.latlng], {color, weight:3, dashArray:'6,4', opacity:.6}).addTo(drawMap);
      const d = hav(lastPt, e.latlng);
      perimTempLbl  = L.marker(mid(lastPt, e.latlng), {icon:L.divIcon({html:`<div class="meas-label">${d.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
    }
  });

  recalc();
}

// ── DRAW MODE SWITCHER ───────────────────────
function setDrawMode(mode, btn) {
  // stop any active drawing
  if(drawOn) toggleDraw();
  // cancel any pending perim chooser
  hideReChooser();

  drawMode = mode;
  document.querySelectorAll('.draw-mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const ltGrid = document.getElementById('ltGrid');
  const ltLabel = document.getElementById('ltGridLabel');
  const perimBar = document.getElementById('perimBar');
  const erBar = document.getElementById('erBar');
  const gutterResult = document.getElementById('gutterResult');

  // Reset all status bars
  perimBar.classList.remove('visible');
  erBar.classList.remove('visible');
  gutterResult.classList.remove('visible');

  if(mode === 'line') {
    ltGrid.style.display = '';
    ltLabel.style.display = '';
    // turn off ER click listeners on segments
    setERListeners(false);
  } else if(mode === 'perim') {
    ltGrid.style.display = 'none';
    ltLabel.style.display = 'none';
    perimBar.classList.add('visible');
    setERListeners(false);
  } else if(mode === 'er') {
    ltGrid.style.display = 'none';
    ltLabel.style.display = 'none';
    erBar.classList.add('visible');
    setERListeners(true);
  } else if(mode === 'gutter') {
    ltGrid.style.display = 'none';
    ltLabel.style.display = 'none';
    gutterResult.classList.add('visible');
    setERListeners(false);
    recalcGutters();
  }
}

// ── LINE MODE ────────────────────────────────
function handleLineClick(latlng) {
  if(!drawStart) {
    drawStart = latlng;
    // Store dot with line — create dot and keep reference
    const dot = L.circleMarker(latlng, {radius:5, color:'#fff', fillColor:LT[drawLT].color, fillOpacity:1, weight:2}).addTo(drawMap);
    drawStart._dot = dot;
  } else {
    const endDot = L.circleMarker(latlng, {radius:5, color:'#fff', fillColor:LT[drawLT].color, fillOpacity:1, weight:2}).addTo(drawMap);
    finalizeLine(drawStart, latlng, drawStart._dot, endDot);
    drawStart = null;
  }
}

function selLT(i, el) {
  document.querySelectorAll('.lt-btn').forEach(b => { b.classList.remove('active'); b.style.borderColor = ''; });
  el.classList.add('active'); el.style.borderColor = LT[i].color;
  drawLT = i;
  // If a line is selected, retype it
  if(selectedLineId !== null) retypeLine(selectedLineId, i);
}

function toggleDraw() {
  drawOn = !drawOn;
  const btn = document.getElementById('drawToggle');
  if(drawOn) {
    btn.textContent = '⏹ Stop'; btn.className = 'draw-btn stop';
    drawMap.getContainer().style.cursor = 'crosshair';
  } else {
    btn.textContent = '▶ Draw'; btn.className = 'draw-btn go';
    drawMap.getContainer().style.cursor = '';
    drawStart = null; clearTemp();
    // Don't cancel pending perim chooser — user may need to choose
  }
}

function clearTemp() {
  if(tempLine) { drawMap.removeLayer(tempLine); tempLine = null; }
  if(tempLbl)  { drawMap.removeLayer(tempLbl);  tempLbl  = null; }
  if(perimTempLine) { drawMap.removeLayer(perimTempLine); perimTempLine = null; }
  if(perimTempLbl)  { drawMap.removeLayer(perimTempLbl);  perimTempLbl  = null; }
}

function finalizeLine(p1, p2, dot1, dot2) {
  const lt = LT[drawLT], d = hav(p1, p2);
  const dash = lt.dash || null;
  const line = L.polyline([p1, p2], {color:lt.color, weight:4, opacity:.95, dashArray:dash}).addTo(drawMap);
  const lbl  = L.marker(mid(p1, p2), {icon:L.divIcon({html:`<div class="meas-label" style="border-color:${lt.color}">${d.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
  const id = Date.now() + Math.random();
  drawnLines.push({id, type:drawLT, name:lt.name, color:lt.color, dist:d, line, lbl, p1, p2, dot1, dot2, subtype:'line'});
  clearTemp(); renderLineList(); recalc();
  return id;
}

// ── PERIMETER MODE ────────────────────────────
function handlePerimClick(latlng) {
  if(perimClosed) return;
  // Check if clicking near first point to close
  if(perimPoints.length >= 3) {
    const first = perimPoints[0];
    const dist = hav(first, latlng);
    if(dist < 30) { // within 30ft — snap to close
      closePerimeter();
      return;
    }
  }
  // Can't add next point until user chooses eave/rake for the last segment
  if(perimPendingP1 !== null) return;

  const dot = L.circleMarker(latlng, {radius:6, color:'#fff', fillColor:'#22C55E', fillOpacity:1, weight:2}).addTo(drawMap);

  if(perimPoints.length === 0) {
    // First point — add close-ring indicator
    perimCloseRing = L.circleMarker(latlng, {radius:14, color:'#22C55E', fillColor:'transparent', weight:2, dashArray:'4,3', opacity:.6}).addTo(drawMap);
  }

  if(perimPoints.length > 0) {
    // We have a previous point — prompt eave/rake
    perimPendingP1 = perimPoints[perimPoints.length - 1];
    perimPendingP2 = latlng;
    perimDots.push(dot);
    clearTemp();
    showReChooser();
    return;
  }

  perimPoints.push(latlng);
  perimDots.push(dot);
}

function showReChooser() {
  document.getElementById('reChooser').classList.add('visible');
  document.getElementById('perimBar').classList.remove('visible');
}
function hideReChooser() {
  document.getElementById('reChooser').classList.remove('visible');
  document.getElementById('perimBar').classList.add('visible');
  perimPendingP1 = null;
  perimPendingP2 = null;
}

function perimChooseType(subtype) {
  if(!perimPendingP1 || !perimPendingP2) return;
  const p1 = perimPendingP1;
  const p2 = perimPendingP2;
  addPerimSegment(p1, p2, subtype);
  perimPoints.push(p2);
  hideReChooser();
}

function addPerimSegment(p1, p2, subtype) {
  const color = '#BE185D'; // both eave and rake share this color family
  const eaveColor = '#BE185D';
  const rakeColor = '#EC4899';
  const segColor  = subtype === 'eave' ? eaveColor : rakeColor;
  const dash      = subtype === 'eave' ? null : '8,5';
  const d = hav(p1, p2);
  const line = L.polyline([p1, p2], {color:segColor, weight:4, opacity:.95, dashArray:dash}).addTo(drawMap);
  const lbl  = L.marker(mid(p1, p2), {icon:L.divIcon({html:`<div class="meas-label" style="border-color:${segColor}">${d.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
  const id = Date.now() + Math.random();
  const seg = {id, type: subtype==='eave' ? 5 : 4, name: subtype==='eave'?'Eave':'Rake', color:segColor, dist:d, line, lbl, p1, p2, subtype, isPerim:true};
  perimSegments.push(seg);
  drawnLines.push(seg);

  // Add click listener for ER mode
  line.on('click', () => { if(drawMode === 'er') erToggleSegment(id); });

  renderLineList(); recalc();
  return id;
}

function closePerimeter() {
  if(perimPoints.length < 3) return;
  // Final segment: first point to last
  const last  = perimPoints[perimPoints.length - 1];
  const first = perimPoints[0];
  // Prompt eave/rake for closing segment too
  perimPendingP1 = last;
  perimPendingP2 = first;
  showReChooser();
  // After user chooses, we detect close in perimChooseType
  // Override: mark that closing
  window._perimClosing = true;
}

// Intercept perimChooseType for closing segment
const _origPerimChoose = window.perimChooseType;
// We handle closing inside perimChooseType by checking _perimClosing below

function perimChooseType(subtype) {
  if(!perimPendingP1 || !perimPendingP2) return;
  const p1 = perimPendingP1;
  const p2 = perimPendingP2;
  addPerimSegment(p1, p2, subtype);
  if(!window._perimClosing) {
    perimPoints.push(p2);
  } else {
    window._perimClosing = false;
    perimClosed = true;
    // Draw fill polygon
    if(perimPolygon) drawMap.removeLayer(perimPolygon);
    perimPolygon = L.polygon(perimPoints, {color:'#22C55E', weight:0, fillColor:'#22C55E', fillOpacity:.08}).addTo(drawMap);
    // Calculate base area via Shoelace
    perimBaseArea = shoelaceArea(perimPoints);
    showToast('Perimeter closed — '+perimBaseArea.toFixed(0)+' sf base area');
    document.getElementById('perimBar').textContent = '⬡ Perimeter closed — '+perimBaseArea.toFixed(0)+' sf · redraw or continue adding lines';
    if(perimCloseRing) { drawMap.removeLayer(perimCloseRing); perimCloseRing = null; }
    recalc();
  }
  hideReChooser();
}

// Shoelace formula: area in sq feet from latlng array
function shoelaceArea(pts) {
  if(pts.length < 3) return 0;
  // Convert latlng to feet using haversine approximation
  // Use first point as origin
  const origin = pts[0];
  const toFt = pts.map(p => {
    const dx = hav({lat:origin.lat, lng:p.lng}, {lat:origin.lat, lng:origin.lng});
    const dy = hav({lat:p.lat, lng:origin.lng}, {lat:origin.lat, lng:origin.lng});
    return {x: p.lng > origin.lng ? dx : -dx, y: p.lat > origin.lat ? dy : -dy};
  });
  let area = 0;
  const n = toFt.length;
  for(let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += toFt[i].x * toFt[j].y;
    area -= toFt[j].x * toFt[i].y;
  }
  return Math.abs(area / 2);
}

// ── EAVE/RAKE TOGGLE MODE ─────────────────────
function setERListeners(on) {
  perimSegments.forEach(seg => {
    if(on) {
      seg.line.on('click', () => erToggleSegment(seg.id));
      seg.line.getElement && seg.line.getElement()?.classList.add('er-hover');
    } else {
      seg.line.off('click');
      // Re-attach non-ER handler
      seg.line.on('click', () => { if(drawMode === 'er') erToggleSegment(seg.id); });
    }
  });
}

function erToggleSegment(id) {
  const seg = perimSegments.find(s => s.id === id);
  if(!seg) return;
  // Toggle
  const newSub  = seg.subtype === 'eave' ? 'rake' : 'eave';
  const newColor = newSub === 'eave' ? '#BE185D' : '#EC4899';
  const newDash  = newSub === 'eave' ? null : '8,5';
  const newType  = newSub === 'eave' ? 5 : 4;
  const newName  = newSub === 'eave' ? 'Eave' : 'Rake';

  // Update the Leaflet polyline in place
  seg.line.setStyle({color:newColor, dashArray:newDash});
  // Update label
  drawMap.removeLayer(seg.lbl);
  seg.lbl = L.marker(mid(seg.p1, seg.p2), {icon:L.divIcon({html:`<div class="meas-label" style="border-color:${newColor}">${seg.dist.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);

  // Update data
  seg.subtype = newSub;
  seg.color   = newColor;
  seg.type    = newType;
  seg.name    = newName;

  // Sync drawnLines
  const dl = drawnLines.find(l => l.id === id);
  if(dl) { dl.subtype=newSub; dl.color=newColor; dl.type=newType; dl.name=newName; }

  renderLineList(); recalc();
  showToast(`Toggled to ${newName}`);
}

// ── GUTTER MODE ───────────────────────────────
function handleGutterClick(latlng) {
  if(!perimPoints.length || perimClosed) {
    // Start new gutter run
    perimPoints = [];
    perimClosed = false;
  }
  const dot = L.circleMarker(latlng, {radius:5, color:'#fff', fillColor:'#06B6D4', fillOpacity:1, weight:2}).addTo(drawMap);
  if(perimPoints.length > 0) {
    const prev = perimPoints[perimPoints.length-1];
    const d = hav(prev, latlng);
    const line = L.polyline([prev, latlng], {color:'#06B6D4', weight:4, opacity:.95, dashArray:'10,4'}).addTo(drawMap);
    const lbl  = L.marker(mid(prev, latlng), {icon:L.divIcon({html:`<div class="meas-label" style="border-color:#06B6D4">${d.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
    const id = Date.now() + Math.random();
    drawnLines.push({id, type:10, name:'Gutters', color:'#06B6D4', dist:d, line, lbl, p1:prev, p2:latlng, dot1:null, dot2:dot, subtype:'gutter'});
    clearTemp(); renderLineList(); recalcGutters();
  }
  perimPoints.push(latlng);
  perimDots.push(dot);
}

function recalcGutters() {
  const gutterLines = drawnLines.filter(l => l.type === 10);
  const total = gutterLines.reduce((s, l) => s + l.dist, 0);
  const ds = Math.ceil(total / 40); // rough: 1 downspout per 40lf
  document.getElementById('gr-total').textContent = total.toFixed(1) + ' ft';
  document.getElementById('gr-ds').textContent = ds;
  const el = document.getElementById('gutterResult');
  if(el) el.classList.toggle('visible', gutterLines.length > 0);
}

// ── LINE SELECTION ─────────────────────────────
function selectLine(id) {
  selectedLineId = id;
  renderLineList();
  // Highlight on map
  drawnLines.forEach(l => {
    if(l.line) {
      if(l.id === id) {
        l.line.setStyle({weight:6, opacity:1});
      } else {
        l.line.setStyle({weight:4, opacity:.95});
      }
    }
  });
}

function deselectLine() {
  selectedLineId = null;
  drawnLines.forEach(l => { if(l.line) l.line.setStyle({weight:4, opacity:.95}); });
  renderLineList();
}

function retypeLine(id, ltIndex) {
  const l = drawnLines.find(x => x.id === id);
  if(!l) return;
  const lt = LT[ltIndex];
  l.type  = ltIndex;
  l.name  = lt.n;
  l.color = lt.color;
  l.line.setStyle({color:lt.color, dashArray:lt.dash||null});
  drawMap.removeLayer(l.lbl);
  l.lbl = L.marker(mid(l.p1, l.p2), {icon:L.divIcon({html:`<div class="meas-label" style="border-color:${lt.color}">${l.dist.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
  renderLineList(); recalc();
}

// ── UNDO / DELETE / CLEAR ─────────────────────
function deleteLine(id) {
  const i = drawnLines.findIndex(l => l.id === id); if(i < 0) return;
  const l = drawnLines[i];
  drawMap.removeLayer(l.line);
  drawMap.removeLayer(l.lbl);
  // Remove dots that belong to this line
  if(l.dot1) drawMap.removeLayer(l.dot1);
  if(l.dot2) drawMap.removeLayer(l.dot2);
  // Remove from perimSegments if applicable
  const pi = perimSegments.findIndex(s => s.id === id);
  if(pi >= 0) perimSegments.splice(pi, 1);
  drawnLines.splice(i, 1);
  if(selectedLineId === id) deselectLine();
  renderLineList(); recalc(); recalcGutters();
}

function undoLine() {
  if(drawnLines.length) deleteLine(drawnLines[drawnLines.length-1].id);
  // Also remove last perim dot if in perim mode and pending
  if((drawMode === 'perim' || drawMode === 'gutter') && perimDots.length > 0 && !perimClosed) {
    const d = perimDots.pop();
    drawMap.removeLayer(d);
    if(perimPoints.length > 0) perimPoints.pop();
  }
}

function clearDraw() {
  drawnLines.forEach(l => {
    drawMap.removeLayer(l.line);
    drawMap.removeLayer(l.lbl);
    if(l.dot1) drawMap.removeLayer(l.dot1);
    if(l.dot2) drawMap.removeLayer(l.dot2);
  });
  perimDots.forEach(d => drawMap.removeLayer(d));
  if(perimPolygon) { drawMap.removeLayer(perimPolygon); perimPolygon = null; }
  if(perimCloseRing) { drawMap.removeLayer(perimCloseRing); perimCloseRing = null; }
  if(perimTempLine) drawMap.removeLayer(perimTempLine);
  if(perimTempLbl)  drawMap.removeLayer(perimTempLbl);
  drawnLines = []; perimSegments = []; perimPoints = []; perimDots = [];
  perimClosed = false; perimPendingP1 = null; perimPendingP2 = null;
  perimBaseArea = 0; selectedLineId = null;
  clearTemp(); clearTemp();
  hideReChooser();
  document.getElementById('perimBar').textContent = '⬡ Perimeter mode — click map to trace. Click first dot to close.';
  renderLineList(); recalc(); recalcGutters();
}

function renderLineList() {
  const el = document.getElementById('lineList');
  if(!drawnLines.length) {
    el.innerHTML = '<p style="font-size:10px;color:var(--m);text-align:center;padding:8px;">No lines yet.</p>';
    return;
  }
  // Build LT options for inline retype select
  const ltOpts = LT.map((lt, i) => `<option value="${i}">${lt.n}</option>`).join('');
  el.innerHTML = drawnLines.map(l => {
    const isSel = l.id === selectedLineId;
    const dash = l.subtype === 'rake' ? 'border-top:2px dashed' : '';
    return `<div class="line-item ${isSel ? 'selected' : ''}" onclick="selectLine(${l.id})">
      <div class="lt-dot" style="background:${l.color};${l.type===4?'border:1px dashed #fff;':''}"></div>
      <span class="line-lbl">${l.name}</span>
      <span class="line-len">${l.dist.toFixed(1)} ft</span>
      ${isSel ? `<select class="line-type-sel" onchange="retypeLine(${l.id},parseInt(this.value))" onclick="event.stopPropagation()">${ltOpts}</select>` : `<button class="line-del" onclick="event.stopPropagation();deleteLine(${l.id})">✕</button>`}
    </div>`;
  }).join('');
  // Set selected value in dropdown if selected
  if(selectedLineId !== null) {
    const sel = el.querySelector('.line-type-sel');
    if(sel) {
      const l = drawnLines.find(x => x.id === selectedLineId);
      if(l) sel.value = l.type;
    }
  }
}

function recalc() {
  const pitch = parseFloat(document.getElementById('pitchSel')?.value || 1.202);
  const waste = parseFloat(document.getElementById('wasteSel')?.value || 1.17);
  const eave  = drawnLines.filter(l => l.type === 5);
  const rake  = drawnLines.filter(l => l.type === 4);
  let base = 0;

  // Priority 1: closed perimeter polygon — most accurate
  if(perimClosed && perimBaseArea > 0) {
    base = perimBaseArea;
  }
  // Priority 2: eave × avg rake
  else if(eave.length && rake.length) {
    base = eave.reduce((s,l) => s+l.dist, 0) * (rake.reduce((s,l) => s+l.dist, 0) / rake.length);
  }
  // Priority 3: rough estimate from total line length
  else if(drawnLines.length) {
    const tot = drawnLines.reduce((s,l) => s+l.dist, 0);
    base = (tot/4) * (tot/4);
  }

  const pitched = base * pitch, w = pitched * waste, sq = w / 100;
  document.getElementById('cr-base').textContent    = base.toFixed(0) + ' sf';
  document.getElementById('cr-pitched').textContent = pitched.toFixed(0) + ' sf';
  document.getElementById('cr-waste').textContent   = w.toFixed(0) + ' sf';
  document.getElementById('cr-sq').textContent      = sq.toFixed(2) + ' sq';
}

function importToEstimate() {
  const addr=document.getElementById('drawSearch').value||'';
  const rawSqft=parseFloat(document.getElementById('cr-base').textContent)||0;
  const ridgeLns=drawnLines.filter(l=>l.type===0);
  const eaveLns=drawnLines.filter(l=>l.type===5);
  const hipLns=drawnLines.filter(l=>l.type===2);
  goTo('est');
  startNewEstimate();
  setTimeout(()=>{
    document.getElementById('estAddr').value=addr;
    document.getElementById('estRawSqft').value=Math.round(rawSqft);
    document.getElementById('estRidge').value=Math.round(ridgeLns.reduce((s,l)=>s+l.dist,0));
    document.getElementById('estEave').value=Math.round(eaveLns.reduce((s,l)=>s+l.dist,0));
    document.getElementById('estHip').value=Math.round(hipLns.reduce((s,l)=>s+l.dist,0));
    document.getElementById('drawImportNote').style.display='block';
    updateEstCalc();
  },100);
}

async function searchDraw() {
  const q=document.getElementById('drawSearch').value.trim(); if(!q)return;
  const d=await geocode(q); if(!d)return;
  drawMap.setView([d.lat,d.lon],19);
}

function exportDrawReport() {
  const addr=document.getElementById('drawSearch').value||'No Address';
  const lines=drawnLines;
  const total=lines.reduce((s,l)=>s+l.dist,0);
  const grouped={};
  lines.forEach(l=>{if(!grouped[l.name])grouped[l.name]={color:l.color,total:0,count:0};grouped[l.name].total+=l.dist;grouped[l.name].count++;});
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NBD Drawing Report</title>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500&display=swap" rel="stylesheet">
  <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Barlow',sans-serif;padding:32px;max-width:850px;margin:0 auto;}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #C8541A;margin-bottom:22px;}
  .brand{font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:800;text-transform:uppercase;}
  .brand span{color:#C8541A;}.badge{font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#C8541A;border:1px solid #C8541A;padding:2px 9px;border-radius:2px;display:inline-block;margin-top:4px;}
  .addr{font-size:15px;font-weight:600;text-align:right;}.date{font-size:11px;color:#666;text-align:right;}
  h2{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#C8541A;margin:20px 0 10px;padding-bottom:4px;border-bottom:1px solid #eee;}
  table{width:100%;border-collapse:collapse;}th{background:#0A0C0F;color:#fff;font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:7px 10px;text-align:left;}
  td{padding:7px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;}tr:nth-child(even) td{background:#fafafa;}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px;}
  .card{background:#f8f8f8;border:1px solid #eee;border-radius:7px;padding:12px;text-align:center;}
  .card .v{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:700;color:#C8541A;}
  .card .k{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.05em;margin-top:3px;}
  .foot{margin-top:28px;padding-top:14px;border-top:1px solid #eee;display:flex;justify-content:space-between;font-size:10px;color:#999;}
  .total-row td{font-weight:700;border-top:2px solid #eee;}</style></head><body>
  <div class="hdr"><div><div class="brand">No Big Deal <span>Home Solutions</span></div><div class="badge">Drawing Measurement Report</div></div>
  <div><div class="addr">${addr}</div><div class="date">${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</div></div></div>
  <div class="cards">
    <div class="card"><div class="v">${document.getElementById('cr-base').textContent}</div><div class="k">Base Area</div></div>
    <div class="card"><div class="v">${document.getElementById('cr-pitched').textContent}</div><div class="k">Pitched Area</div></div>
    <div class="card"><div class="v">${document.getElementById('cr-waste').textContent}</div><div class="k">With Waste</div></div>
    <div class="card" style="background:#C8541A;border-color:#C8541A;"><div class="v" style="color:#fff;">${document.getElementById('cr-sq').textContent}</div><div class="k" style="color:rgba(255,255,255,.8);">Squares</div></div>
  </div>
  <h2>Line Summary</h2>
  <table><thead><tr><th>Type</th><th>Count</th><th>Total LF</th></tr></thead><tbody>
  ${Object.entries(grouped).map(([n,v])=>`<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${v.color};margin-right:6px;vertical-align:middle;"></span>${n}</td><td>${v.count}</td><td>${v.total.toFixed(1)} ft</td></tr>`).join('')}
  <tr class="total-row"><td><b>TOTAL</b></td><td><b>${lines.length}</b></td><td><b>${total.toFixed(1)} ft</b></td></tr>
  </tbody></table>
  <h2>Individual Lines</h2>
  <table><thead><tr><th>Type</th><th>Length</th></tr></thead><tbody>
  ${lines.map(l=>`<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${l.color};margin-right:6px;vertical-align:middle;"></span>${l.name}</td><td>${l.dist.toFixed(1)} ft</td></tr>`).join('')}
  </tbody></table>
  <div class="foot"><div>No Big Deal Home Solutions — nobigdealwithjoedeal.com</div><div>Measurements are estimates. Always verify on-site.</div></div>
  <script>window.print();<\/script>

<!-- ══ QM IMPORT MODAL ══ -->
<div class="modal-bg" id="qmImportModal">
  <div class="modal" style="max-width:480px;">
    <button class="modal-close" onclick="closeQMImportModal()">✕</button>
    <div style="margin-bottom:18px;">
      <div style="font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--orange);margin-bottom:4px;">AI-Powered Import</div>
      <div style="font-size:18px;font-weight:800;color:var(--t);">Quick Measure Import</div>
      <div style="font-size:12px;color:var(--m);margin-top:4px;">Upload your GAF Quick Measure PDF. AI extracts all measurements automatically.</div>
    </div>
    <div id="qmDropZone" style="border:2px dashed var(--br);border-radius:10px;padding:32px 20px;text-align:center;cursor:pointer;transition:all .2s;margin-bottom:16px;" onclick="document.getElementById('qmFileInput').click()" ondragover="event.preventDefault();this.style.borderColor='#C8541A'" ondragleave="this.style.borderColor=''" ondrop="handleQMDrop(event)">
      <div style="font-size:32px;margin-bottom:8px;">📄</div>
      <div style="font-weight:700;color:var(--t);font-size:13px;">Drop PDF here or click to browse</div>
      <div style="font-size:11px;color:var(--m);margin-top:4px;">GAF Quick Measure PDF only</div>
      <input type="file" id="qmFileInput" accept=".pdf" style="display:none;" onchange="handleQMFile(this.files[0])">
    </div>
    <div id="qmStatus" style="display:none;background:var(--s2);border-radius:8px;padding:12px 14px;font-size:12px;color:var(--m);margin-bottom:16px;min-height:44px;">
      <span id="qmStatusText">Analyzing PDF with AI...</span>
    </div>
    <div id="qmPreview" style="display:none;margin-bottom:16px;">
      <div style="font-size:9px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--orange);margin-bottom:8px;">Extracted Measurements</div>
      <div id="qmPreviewGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;"></div>
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn btn-ghost" onclick="closeQMImportModal()" style="flex:1;">Cancel</button>
      <button class="btn btn-orange" id="qmApplyBtn" onclick="applyQMData()" style="flex:2;display:none;">✓ Apply to Estimate</button>
    </div>
  </div>
</div>


<!-- ══ ONBOARDING MODAL ══ -->
<div id="onboardingModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);backdrop-filter:blur(8px);z-index:9999;align-items:center;justify-content:center;padding:16px;">
  <div style="background:var(--s);border:1px solid var(--br);border-radius:14px;width:100%;max-width:480px;padding:32px;position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,var(--orange),transparent);"></div>

    <!-- Step indicators -->
    <div style="display:flex;gap:6px;margin-bottom:24px;" id="onbSteps">
      <div id="onbDot1" style="flex:1;height:3px;border-radius:2px;background:var(--orange);transition:all .3s;"></div>
      <div id="onbDot2" style="flex:1;height:3px;border-radius:2px;background:var(--br);transition:all .3s;"></div>
      <div id="onbDot3" style="flex:1;height:3px;border-radius:2px;background:var(--br);transition:all .3s;"></div>
    </div>

    <!-- Step 1: Welcome + Company -->
    <div id="onbStep1">
      <div style="font-size:32px;margin-bottom:12px;">👋</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--orange);margin-bottom:4px;">Welcome to NBD Pro</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;text-transform:uppercase;margin-bottom:8px;" id="onbGreeting">Let's get you set up.</div>
      <div style="font-size:13px;color:var(--m);margin-bottom:24px;line-height:1.6;">30 seconds. That's all this takes. We'll personalize the platform to your business.</div>
      <div style="margin-bottom:16px;">
        <label style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--m);display:block;margin-bottom:6px;">Your Company Name</label>
        <input type="text" id="onbCompany" placeholder="No Big Deal Home Solutions"
          style="width:100%;background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:13px 14px;font-family:inherit;font-size:15px;color:var(--t);outline:none;">
      </div>
      <div style="margin-bottom:14px;">
        <label style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--m);display:block;margin-bottom:6px;">Your Name</label>
        <input type="text" id="onbName" placeholder="Joe Deal"
          style="width:100%;background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:13px 14px;font-family:inherit;font-size:15px;color:var(--t);outline:none;">
      </div>
      <div style="margin-bottom:14px;">
        <label style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--m);display:block;margin-bottom:6px;">Your Phone</label>
        <input type="tel" id="onbPhone" placeholder="(859) 420-7382"
          style="width:100%;background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:13px 14px;font-family:inherit;font-size:15px;color:var(--t);outline:none;">
      </div>
      <div style="margin-bottom:20px;">
        <label style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--m);display:block;margin-bottom:6px;">I'm primarily a...</label>
        <select id="onbRole"
          style="width:100%;background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:13px 14px;font-family:inherit;font-size:15px;color:var(--t);outline:none;">
          <option value="owner">Owner / Operator</option>
          <option value="salesperson">Sales Rep / Canvasser</option>
          <option value="estimator">Estimator</option>
          <option value="pm">Project Manager</option>
          <option value="other">Other</option>
        </select>
      </div>
      <button onclick="onbNext(1)"
        style="width:100%;background:var(--orange);color:#fff;border:none;border-radius:8px;padding:14px;font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;">
        Continue →
      </button>
    </div>

    <!-- Step 2: First Lead prompt -->
    <div id="onbStep2" style="display:none;">
      <div style="font-size:32px;margin-bottom:12px;">🎯</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--orange);margin-bottom:4px;">Your Pipeline</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;text-transform:uppercase;margin-bottom:8px;">Add Your First Lead</div>
      <div style="font-size:13px;color:var(--m);margin-bottom:20px;line-height:1.6;">Got a property in mind? Add it now and it'll show up on your pipeline and map. You can always skip this.</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <div>
          <label style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--m);display:block;margin-bottom:6px;">Property Address</label>
          <div class="ac-wrap">
            <input type="text" id="onbAddr" placeholder="123 Main St, Goshen OH..."
              style="width:100%;background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:13px 14px;font-family:inherit;font-size:15px;color:var(--t);outline:none;"
              autocomplete="off">
            <div class="ac-drop" id="ac-onbAddr" style="display:none;"></div>
          </div>
        </div>
        <div>
          <label style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--m);display:block;margin-bottom:6px;">Damage Type</label>
          <select id="onbDamage"
            style="width:100%;background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:13px 14px;font-family:inherit;font-size:15px;color:var(--t);outline:none;">
            <option value="Roof - Hail">Roof — Hail</option>
            <option value="Roof - Wind">Roof — Wind</option>
            <option value="Siding - Hail">Siding — Hail</option>
            <option value="Full Exterior">Full Exterior</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>
      <div style="display:flex;gap:10px;">
        <button onclick="onbSkipLead()"
          style="flex:1;background:transparent;color:var(--m);border:1px solid var(--br);border-radius:8px;padding:13px;font-family:inherit;font-size:13px;cursor:pointer;">
          Skip for now
        </button>
        <button onclick="onbSaveLead()"
          style="flex:2;background:var(--orange);color:#fff;border:none;border-radius:8px;padding:13px;font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;">
          Add Lead →
        </button>
      </div>
    </div>

    <!-- Step 3: You're in -->
    <div id="onbStep3" style="display:none;text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;">🚀</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--orange);margin-bottom:4px;">You're in.</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:800;text-transform:uppercase;margin-bottom:16px;">NBD Pro is live.</div>

      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px;text-align:left;">
        <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--orange);">
          <span style="font-size:18px;">📊</span>
          <div><div style="font-weight:700;font-size:13px;color:var(--t);">CRM is ready</div><div style="font-size:11px;color:var(--m);">Add leads, track stages, log follow-ups</div></div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--orange);">
          <span style="font-size:18px;">📋</span>
          <div><div style="font-weight:700;font-size:13px;color:var(--t);">Estimate builder is loaded</div><div style="font-size:11px;color:var(--m);">Quick or Advanced — import GAF Quick Measure PDFs</div></div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--orange);">
          <span style="font-size:18px;">🤖</span>
          <div><div style="font-weight:700;font-size:13px;color:var(--t);">Joe AI is watching your pipeline</div><div style="font-size:11px;color:var(--m);">Ask anything — claims, canvassing, closes</div></div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--s2);border-radius:8px;border-left:3px solid var(--orange);">
          <span style="font-size:18px;">🛡️</span>
          <div><div style="font-weight:700;font-size:13px;color:var(--t);">Lifetime guarantee system active</div><div style="font-size:11px;color:var(--m);">Every estimate generates the right certificate automatically</div></div>
        </div>
      </div>

      <button onclick="onbFinish()"
        style="width:100%;background:var(--orange);color:#fff;border:none;border-radius:8px;padding:16px;font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;margin-bottom:10px;">
        Open My Dashboard →
      </button>
      <div style="font-size:11px;color:var(--m);">Tip: Tap <strong style="color:var(--t);">Ask Joe</strong> on the bottom nav any time — he knows your pipeline.</div>
    </div>

  </div>
</div>
</body></html>`;
  const w=window.open('','_blank'); w.document.write(html); w.document.close();
}


/* ── NBD UNIFIED APPEARANCE ENGINE (inlined) ── */
/* ═══════════════════════════════════════════════════════════════════
   NBD UNIFIED APPEARANCE ENGINE v1.0
   Shared by: pro/dashboard.html + pro/daily-success/index.html
   DO NOT EDIT independently in each file — keep in sync.
   ═══════════════════════════════════════════════════════════════════ */

/* ── THEME REGISTRY (100 themes) ──────────────────────────────────── */
const NBD_THEMES = [
  // STANDARD
  {id:'default',          name:'NBD Default',       cat:'standard', plan:'blueprint', accent:'#C8541A', bg:'#0A0C0F', s:'#13171d', jp:true},
  {id:'matrix',           name:'Matrix',            cat:'standard', plan:'blueprint', accent:'#00ff41', bg:'#000300', s:'#000800'},
  {id:'neon',             name:'Neon',              cat:'standard', plan:'foundation',accent:'#ff00ff', bg:'#08000f', s:'#120018'},
  {id:'galaxy',           name:'Galaxy',            cat:'standard', plan:'foundation',accent:'#9c27b0', bg:'#06000e', s:'#0e0020'},
  {id:'space',            name:'Space',             cat:'standard', plan:'blueprint', accent:'#4fc3f7', bg:'#000508', s:'#000e18'},
  {id:'ghost',            name:'Ghost',             cat:'standard', plan:'blueprint', accent:'#aab8e0', bg:'#050810', s:'#0c1020'},
  {id:'glow',             name:'Glow',              cat:'standard', plan:'blueprint', accent:'#ff6d00', bg:'#050200', s:'#0e0600'},
  {id:'grayscale',        name:'Grayscale',         cat:'standard', plan:'blueprint', accent:'#c8c8c8', bg:'#0a0a0a', s:'#141414'},
  {id:'blackwhite',       name:'Black & White',     cat:'standard', plan:'blueprint', accent:'#ffffff', bg:'#000000', s:'#0a0a0a'},
  {id:'old-timey',        name:'Old Timey',         cat:'standard', plan:'blueprint', accent:'#c8840a', bg:'#1e1408', s:'#2c1e10'},
  // HEROES
  {id:'batman',           name:'Batman',            cat:'heroes',   plan:'foundation',accent:'#f5c518', bg:'#080808', s:'#111115', jp:true},
  {id:'superman',         name:'Superman',          cat:'heroes',   plan:'foundation',accent:'#e53935', bg:'#030060', s:'#050090'},
  {id:'captain-america',  name:'Captain America',  cat:'heroes',   plan:'foundation',accent:'#b71c1c', bg:'#030a20', s:'#071430'},
  {id:'wolverine',        name:'Wolverine',         cat:'heroes',   plan:'infused',   accent:'#ffd600', bg:'#0e0a00', s:'#1e1600'},
  {id:'magneto',          name:'Magneto',           cat:'heroes',   plan:'infused',   accent:'#ce0000', bg:'#0e000a', s:'#1e0018'},
  {id:'darth-vader',      name:'Darth Vader',       cat:'heroes',   plan:'foundation',accent:'#cc0000', bg:'#000000', s:'#080808', jp:true},
  {id:'stormtrooper',     name:'Stormtrooper',      cat:'heroes',   plan:'foundation',accent:'#111118', bg:'#f2f2f4', s:'#ffffff', lt:true},
  {id:'lightsaber',       name:'Lightsaber',        cat:'heroes',   plan:'foundation',accent:'#00e5ff', bg:'#000508', s:'#000d14'},
  {id:'halo',             name:'Halo',              cat:'heroes',   plan:'foundation',accent:'#00e676', bg:'#010a04', s:'#031408'},
  // GAMING
  {id:'pokemon',          name:'Pokémon',           cat:'gaming',   plan:'foundation',accent:'#ffcc02', bg:'#1a1a2e', s:'#16213e'},
  {id:'mario',            name:'Mario',             cat:'gaming',   plan:'foundation',accent:'#e52222', bg:'#1a0800', s:'#2e1200'},
  {id:'mario-underground',name:'Mario Underground',cat:'gaming',   plan:'infused',   accent:'#6666ff', bg:'#000018', s:'#00002e'},
  {id:'kirby',            name:'Kirby',             cat:'gaming',   plan:'infused',   accent:'#ff4081', bg:'#120008', s:'#200014'},
  {id:'zelda',            name:'Zelda',             cat:'gaming',   plan:'infused',   accent:'#c8a800', bg:'#060e00', s:'#0e1c00'},
  {id:'megaman',          name:'Mega Man',          cat:'gaming',   plan:'infused',   accent:'#00a8e8', bg:'#00060e', s:'#000e20'},
  {id:'digimon',          name:'Digimon',           cat:'gaming',   plan:'team',      accent:'#ff6600', bg:'#0a0014', s:'#160028'},
  {id:'lego',             name:'Lego',              cat:'gaming',   plan:'team',      accent:'#ffd700', bg:'#0c0c00', s:'#1c1c00'},
  {id:'retro',            name:'Retro',             cat:'gaming',   plan:'blueprint', accent:'#ff8c00', bg:'#120a00', s:'#201400'},
  {id:'arcade',           name:'Arcade',            cat:'gaming',   plan:'blueprint', accent:'#ff0055', bg:'#000018', s:'#000030', jp:true},
  // OS / TECH
  {id:'android',          name:'Android',           cat:'os',       plan:'blueprint', accent:'#4caf50', bg:'#0a0f0a', s:'#141c14'},
  {id:'ios',              name:'iOS',               cat:'os',       plan:'blueprint', accent:'#0a84ff', bg:'#000000', s:'#1c1c1e'},
  {id:'ios26',            name:'iOS 26',            cat:'os',       plan:'foundation',accent:'#30d158', bg:'#050508', s:'#0e0e14', jp:true},
  {id:'windows',          name:'Windows',           cat:'os',       plan:'foundation',accent:'#0078d4', bg:'#001828', s:'#002040'},
  {id:'terminal',         name:'Terminal',          cat:'os',       plan:'blueprint', accent:'#00ff00', bg:'#000000', s:'#0a0a0a'},
  // MATERIAL
  {id:'liquid',           name:'Liquid',            cat:'material', plan:'foundation',accent:'#78c8e8', bg:'#080c12', s:'#101820'},
  {id:'material-metal',   name:'Metal',             cat:'material', plan:'team',      accent:'#c8ccd8', bg:'#0e0e10', s:'#1a1a1e'},
  {id:'translucent',      name:'Translucent',       cat:'material', plan:'infused',   accent:'#e8eeff', bg:'#030408', s:'#080c14'},
  {id:'frosted',          name:'Frosted',           cat:'material', plan:'infused',   accent:'#5064c8', bg:'#e8eaf2', s:'#f0f2fa', lt:true},
  {id:'glass',            name:'Glass',             cat:'material', plan:'team',      accent:'#64c8f8', bg:'#010610', s:'#081828'},
  // AMBIENT / MOOD
  {id:'candlelit',        name:'Candlelit',         cat:'ambient',  plan:'blueprint', accent:'#e8820a', bg:'#0c0600', s:'#180e00', jp:true},
  {id:'ember',            name:'Ember',             cat:'ambient',  plan:'blueprint', accent:'#ff4500', bg:'#0a0300', s:'#160800'},
  {id:'midnight-oil',     name:'Midnight Oil',      cat:'ambient',  plan:'foundation',accent:'#d4900a', bg:'#060402', s:'#100c06'},
  {id:'deep-focus',       name:'Deep Focus',        cat:'ambient',  plan:'foundation',accent:'#0d9488', bg:'#020404', s:'#060c0c'},
  {id:'neon-rain',        name:'Neon Rain',         cat:'ambient',  plan:'infused',   accent:'#ff2d9b', bg:'#06000e', s:'#0e0018'},
  {id:'noir',             name:'Noir',              cat:'ambient',  plan:'team',      accent:'#d8cfa8', bg:'#080604', s:'#121008'},
  {id:'blood-moon',       name:'Blood Moon',        cat:'ambient',  plan:'team',      accent:'#e8001a', bg:'#080002', s:'#140006'},
  {id:'aurora',           name:'Aurora',            cat:'ambient',  plan:'infused',   accent:'#00ffc0', bg:'#020810', s:'#040e18'},
  {id:'obsidian',         name:'Obsidian',          cat:'ambient',  plan:'infused',   accent:'#8b5cf6', bg:'#06040a', s:'#0e0c14'},
  {id:'copper',           name:'Copper',            cat:'ambient',  plan:'foundation',accent:'#b87333', bg:'#0c0800', s:'#1a1200'},
  {id:'sakura',           name:'Sakura',            cat:'ambient',  plan:'team',      accent:'#e8346c', bg:'#fff0f4', s:'#ffe8f0', lt:true},
  // ABSTRACT
  {id:'typewriter',       name:'Typewriter',        cat:'abstract', plan:'blueprint', accent:'#8b4513', bg:'#f0e8d4', s:'#e8dfc8', lt:true},
  {id:'ink',              name:'Ink',               cat:'abstract', plan:'blueprint', accent:'#0f0a04', bg:'#f5f0e8', s:'#ece6d8', lt:true},
  {id:'brutalist',        name:'Brutalist',         cat:'abstract', plan:'command',   accent:'#000000', bg:'#e8e8e8', s:'#ffffff', lt:true},
  {id:'vapor',            name:'Vaporwave',         cat:'abstract', plan:'infused',   accent:'#ff71ce', bg:'#0a0014', s:'#140028'},
  {id:'chalk',            name:'Chalk',             cat:'abstract', plan:'team',      accent:'#f8f8f8', bg:'#1a1a2e', s:'#202040'},
  {id:'blueprint-art',    name:'Blueprint',         cat:'abstract', plan:'foundation',accent:'#ffffff', bg:'#001428', s:'#001e3c'},
  // TACTICAL
  {id:'army',             name:'Army',              cat:'tactical', plan:'infused',   accent:'#6a8c2a', bg:'#060a02', s:'#0e1808'},
  {id:'cia',              name:'CIA',               cat:'tactical', plan:'infused',   accent:'#c8a000', bg:'#020202', s:'#0c0c0c'},
  {id:'fbi',              name:'FBI',               cat:'tactical', plan:'infused',   accent:'#c0c8d8', bg:'#000410', s:'#000820'},
  {id:'ninja',            name:'Ninja',             cat:'tactical', plan:'foundation',accent:'#cc0000', bg:'#040400', s:'#0c0c00'},
  {id:'stoic',            name:'Stoic',             cat:'tactical', plan:'blueprint', accent:'#8a8a8a', bg:'#080808', s:'#101010'},
  // SEASONAL
  {id:'halloween',        name:'Halloween',         cat:'seasonal', plan:'blueprint', accent:'#ff6d00', bg:'#080200', s:'#100400'},
  {id:'christmas',        name:'Christmas',         cat:'seasonal', plan:'blueprint', accent:'#e53935', bg:'#000e04', s:'#001808'},
  {id:'easter',           name:'Easter',            cat:'seasonal', plan:'blueprint', accent:'#9c27b0', bg:'#f0e8f8', s:'#ffe8f8', lt:true},
  {id:'thanksgiving',     name:'Thanksgiving',      cat:'seasonal', plan:'blueprint', accent:'#bf6000', bg:'#120800', s:'#201200'},
  {id:'usa',              name:'USA',               cat:'seasonal', plan:'blueprint', accent:'#cc0000', bg:'#010614', s:'#020c28'},
  // NATURE
  {id:'underwater',       name:'Underwater',        cat:'nature',   plan:'foundation',accent:'#00e5cc', bg:'#000c14', s:'#001828'},
  {id:'forest',           name:'Forest',            cat:'nature',   plan:'infused',   accent:'#4caf50', bg:'#010a02', s:'#03140a'},
  {id:'ocean',            name:'Ocean',             cat:'nature',   plan:'infused',   accent:'#1565c0', bg:'#000612', s:'#000e22'},
  {id:'desert',           name:'Desert',            cat:'nature',   plan:'infused',   accent:'#d4870a', bg:'#100800', s:'#201400'},
  {id:'storm',            name:'Storm',             cat:'nature',   plan:'infused',   accent:'#7eb8f7', bg:'#04060e', s:'#080e18'},
  {id:'tundra',           name:'Tundra',            cat:'nature',   plan:'team',      accent:'#a8e8f0', bg:'#040e1c', s:'#081a2e'},
  {id:'volcanic',         name:'Volcanic',          cat:'nature',   plan:'team',      accent:'#ff3d00', bg:'#120000', s:'#220000'},
  // MUSIC
  {id:'hiphop',           name:'Hip Hop',           cat:'music',    plan:'team',      accent:'#ffd600', bg:'#08040c', s:'#120818'},
  {id:'jazz',             name:'Jazz',              cat:'music',    plan:'team',      accent:'#d4a020', bg:'#0e0800', s:'#1e1400'},
  {id:'metal',            name:'Heavy Metal',       cat:'music',    plan:'team',      accent:'#888888', bg:'#000000', s:'#080808'},
  {id:'synthwave',        name:'Synthwave',         cat:'music',    plan:'infused',   accent:'#f706cf', bg:'#0d0018', s:'#180030'},
  {id:'lofi',             name:'Lo-Fi',             cat:'music',    plan:'foundation',accent:'#c8a878', bg:'#f2ede4', s:'#ebe4d8', lt:true},
  {id:'punk',             name:'Punk',              cat:'music',    plan:'team',      accent:'#ff1744', bg:'#0e0000', s:'#1e0000'},
  // REGION
  {id:'japan',            name:'Japan',             cat:'region',   plan:'team',      accent:'#c41c24', bg:'#0a0608', s:'#180e12'},
  {id:'viking',           name:'Viking',            cat:'region',   plan:'team',      accent:'#9a7c28', bg:'#080c14', s:'#101820'},
  {id:'roman',            name:'Roman',             cat:'region',   plan:'team',      accent:'#c8960a', bg:'#100e08', s:'#1e1c10'},
  {id:'wildwest',         name:'Wild West',         cat:'region',   plan:'command',   accent:'#c87840', bg:'#120a00', s:'#201400'},
  {id:'samurai',          name:'Samurai',           cat:'region',   plan:'command',   accent:'#cc2200', bg:'#080208', s:'#120810'},
  {id:'pharaoh',          name:'Pharaoh',           cat:'region',   plan:'command',   accent:'#c8980a', bg:'#0e0c00', s:'#1e1c00'},
  // CULTURE
  {id:'american-dad',     name:'American Dad',      cat:'culture',  plan:'command',   accent:'#e53935', bg:'#010614', s:'#030e28'},
  {id:'family-guy',       name:'Family Guy',        cat:'culture',  plan:'command',   accent:'#f5c518', bg:'#001020', s:'#001c38'},
  {id:'south-park',       name:'South Park',        cat:'culture',  plan:'command',   accent:'#ff8c00', bg:'#08100a', s:'#101e12'},
];

/* ── FONT PAIRINGS (8 fonts) ──────────────────────────────────────── */
const NBD_FONTS = [
  { id:'nbd-default',    name:'NBD Default',    plan:'blueprint', css:{fd:"'Bebas Neue',sans-serif",   fu:"'Barlow Condensed',sans-serif", fb:"'Barlow',sans-serif",          fm:"'DM Mono',monospace"},          preview:{d:'NBD PRO', b:'Sharp. Direct. Built for the field.'} },
  { id:'operator',       name:'Operator',       plan:'foundation',css:{fd:"'Unbounded',sans-serif",     fu:"'Unbounded',sans-serif",        fb:"'Inter',sans-serif",            fm:"'JetBrains Mono',monospace"},    preview:{d:'NBD PRO', b:'Technical. Futuristic. Command-grade.'} },
  { id:'editorial',      name:'Editorial',      plan:'infused',   css:{fd:"'Playfair Display',serif",   fu:"'Barlow Condensed',sans-serif", fb:"'Barlow',sans-serif",          fm:"'IBM Plex Mono',monospace"},     preview:{d:'NBD Pro', b:'Refined. Authoritative. Premium feel.'} },
  { id:'terminal-font',  name:'Terminal',       plan:'blueprint', css:{fd:"'Share Tech Mono',monospace",fu:"'Share Tech Mono',monospace",   fb:"'Share Tech Mono',monospace",   fm:"'Share Tech Mono',monospace"},   preview:{d:'> NBD_PRO', b:'All mono. Pure signal. Zero noise.'} },
  { id:'typewriter-font',name:'Typewriter',     plan:'foundation',css:{fd:"'Courier Prime',monospace",  fu:"'Barlow Condensed',sans-serif", fb:"'Courier Prime',monospace",     fm:"'Courier Prime',monospace"},     preview:{d:'NBD PRO', b:'Worn-in. Tactile. Old iron feel.'} },
  { id:'syne',           name:'Syne / Exo',     plan:'team',      css:{fd:"'Syne',sans-serif",           fu:"'Exo 2',sans-serif",            fb:"'Exo 2',sans-serif",            fm:"'JetBrains Mono',monospace"},    preview:{d:'NBD PRO', b:'Geometric. Modern. Interface-native.'} },
  { id:'chakra',         name:'Chakra Petch',   plan:'infused',   css:{fd:"'Chakra Petch',sans-serif",  fu:"'Chakra Petch',sans-serif",     fb:"'Barlow',sans-serif",           fm:"'Space Mono',monospace"},        preview:{d:'NBD PRO', b:'Military-tech. Tactical. Clean edge.'} },
  { id:'classic',        name:'Classic Serif',  plan:'command',   css:{fd:"'Anton',sans-serif",          fu:"'Barlow Condensed',sans-serif", fb:"'Libre Baskerville',serif",     fm:"'IBM Plex Mono',monospace"},     preview:{d:'NBD PRO', b:'Heavy headline. Old press authority.'} },
];

/* ── STATE ────────────────────────────────────────────────────────── */
const NBD_PLAN_ORDER  = ['blueprint','foundation','infused','team','command'];
// Read actual plan from window._userPlan (set by subscription check above)
// Fallback to 'blueprint' (lowest tier) if not set
const NBD_USER_PLAN   = window._userPlan || 'blueprint';
let _nbd_activeTheme  = localStorage.getItem('nbd-theme') || 'default';
let _nbd_activeFont   = localStorage.getItem('nbd-font')  || 'nbd-default';
let _nbd_activeCat    = 'all';
let _nbd_customs      = JSON.parse(localStorage.getItem('nbd-customs') || '[]');

const _nbdUnlocked  = p => NBD_PLAN_ORDER.indexOf(NBD_USER_PLAN) >= NBD_PLAN_ORDER.indexOf(p);
const _nbdGetTheme  = id => [...NBD_THEMES, ..._nbd_customs].find(t => t.id === id);

/* ── APPLY THEME ──────────────────────────────────────────────────── */
function nbdApplyTheme(id) {
  const t = _nbdGetTheme(id);
  if (!t) return;
  if (!_nbdUnlocked(t.plan) && t.cat !== 'custom') {
    nbdToast('🔒 Requires ' + t.plan + ' plan');
    return;
  }
  // 1. body class (v5 system)
  document.body.className = id === 'default' ? '' : 'theme-' + id;
  // 2. data-theme attr (v3 system)
  document.documentElement.setAttribute('data-theme', id);
  // 3. Force --ac + legacy DS vars immediately
  const R = document.documentElement.style;
  R.setProperty('--ac',     t.accent);
  R.setProperty('--orange', t.accent);
  R.setProperty('--gold',   t.accent);
  // bg/surface for DS pages that use --bg/--bar
  R.setProperty('--bg',  t.bg  || '#0A0C0F');
  R.setProperty('--bar', t.s   || '#13171d');
  // 4. Persist
  _nbd_activeTheme = id;
  localStorage.setItem('nbd-theme', id);
  try { localStorage.setItem('nbd_gt', id); } catch(e){}
  // 5. Firestore sync (if auth available)
  try {
    if (typeof db !== 'undefined' && typeof currentUser !== 'undefined' && currentUser) {
      db.collection('users').doc(currentUser.uid).set({ theme: id }, { merge: true });
    }
  } catch(e) {}
  // 6. UI
  _nbdUpdateLabels(t);
  nbdRenderThemes();
  nbdToast('✓ ' + t.name);
}

/* ── APPLY FONT ───────────────────────────────────────────────────── */
function nbdApplyFont(id) {
  const f = NBD_FONTS.find(f => f.id === id);
  if (!f) return;
  if (!_nbdUnlocked(f.plan)) { nbdToast('🔒 Font requires ' + f.plan + ' plan'); return; }
  const R = document.documentElement.style;
  R.setProperty('--fd', f.css.fd);
  R.setProperty('--fu', f.css.fu);
  R.setProperty('--fb', f.css.fb);
  R.setProperty('--fm', f.css.fm);
  document.body.style.fontFamily = f.css.fb;
  _nbd_activeFont = id;
  localStorage.setItem('nbd-font', id);
  nbdRenderFonts();
  nbdToast('✓ Font: ' + f.name);
}

/* ── LABELS ───────────────────────────────────────────────────────── */
function _nbdUpdateLabels(t) {
  const badge = document.getElementById('abadge') || document.querySelector('.tbb');
  if (badge) badge.textContent = t.name.toUpperCase();
  const nl = document.getElementById('npm-active-name');
  if (nl) nl.textContent = t.name;
  const ns = document.getElementById('npm-active-sub');
  if (ns) {
    const f = NBD_FONTS.find(f => f.id === _nbd_activeFont);
    ns.textContent = t.name + ' · ' + (f ? f.name : 'Default') + ' font';
  }
}

/* ── PICKER MODAL ─────────────────────────────────────────────────── */
function nbdPickerOpen()  { document.getElementById('nbd-picker-modal').classList.add('open'); nbdRenderThemes(); nbdRenderFonts(); }
function nbdPickerClose() { document.getElementById('nbd-picker-modal').classList.remove('open'); }

// Add modal click handler after DOM loads
const pickerModal = document.getElementById('nbd-picker-modal');
if (pickerModal) {
  pickerModal.addEventListener('click', function(e) { if (e.target === this) nbdPickerClose(); });
}

function nbdPickerTab(tab, el) {
  document.querySelectorAll('.npm-tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  document.querySelectorAll('.npm-panel').forEach(p => p.classList.remove('on'));
  document.getElementById('npm-panel-' + tab).classList.add('on');
}

/* ── RENDER THEMES ────────────────────────────────────────────────── */
function nbdRenderThemes() {
  const grid = document.getElementById('npm-grid');
  if (!grid) return;
  const q = (document.getElementById('npm-search')?.value || '').toLowerCase();
  let list = [...NBD_THEMES, ..._nbd_customs];
  if (_nbd_activeCat !== 'all') list = list.filter(t => t.cat === _nbd_activeCat);
  if (q) list = list.filter(t => t.name.toLowerCase().includes(q));
  if (!list.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:32px;font-size:11px;color:#5a6478;">No themes found.</div>'; return; }
  grid.innerHTML = '';
  list.forEach(t => {
    const ok = _nbdUnlocked(t.plan) || t.cat === 'custom';
    const isAct = t.id === _nbd_activeTheme;
    const hexLum = h => { const n=parseInt((h||'#000').replace('#',''),16); const r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255; const tl=c=>c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4); return 0.2126*tl(r)+0.7152*tl(g)+0.0722*tl(b); };
    const textCol = hexLum(t.bg||'#000') > 0.12 ? '#1a1208' : '#e8eaf0';
    const d = document.createElement('div');
    d.className = 'npm-bubble' + (isAct ? ' active' : '') + (ok ? '' : ' locked');
    d.onclick = () => { if (ok) nbdApplyTheme(t.id); else nbdToast('🔒 ' + t.plan + ' required'); };
    d.style.cssText = `background:${t.s||'#13171d'};border-color:${t.accent};box-shadow:inset 0 0 0 1px ${t.accent}33;`;
    if (isAct) d.style.boxShadow = `0 0 0 2.5px #fff, 0 4px 22px rgba(0,0,0,0.6)`;
    d.innerHTML = `<div class="npm-dot" style="background:${t.accent};box-shadow:0 0 5px ${t.accent}88"></div><span class="npm-lbl" style="color:${textCol}">${t.name}</span>${t.jp?`<span class="npm-star" style="color:${t.accent}">★</span>`:''}<div class="npm-activedot"></div>${!ok?'<div class="npm-lock-overlay">🔒</div>':''}`;
    grid.appendChild(d);
  });
}

function nbdRenderCats() {
  const el = document.getElementById('npm-cats');
  if (!el) return;
  const cats = ['all','standard','heroes','gaming','os','material','ambient','abstract','tactical','nature','music','region','seasonal','culture','custom'];
  const labels = {all:'All',standard:'Standard',heroes:'Heroes',gaming:'Gaming',os:'OS/Tech',material:'Material',ambient:'Ambient',abstract:'Abstract',tactical:'Tactical',nature:'Nature',music:'Music',region:'Region',seasonal:'Seasonal',culture:'Culture',custom:'⚡ Custom'};
  el.innerHTML = cats.map(c => `<button class="npm-cat${_nbd_activeCat===c?' on':''}" onclick="nbdSetCat('${c}',this)">${labels[c]||c}</button>`).join('');
}

function nbdSetCat(cat, el) {
  _nbd_activeCat = cat;
  document.querySelectorAll('.npm-cat').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  nbdRenderThemes();
}

function nbdRandom() {
  const ok = NBD_THEMES.filter(t => _nbdUnlocked(t.plan));
  nbdApplyTheme(ok[Math.floor(Math.random() * ok.length)].id);
}

/* ── RENDER FONTS ─────────────────────────────────────────────────── */
function nbdRenderFonts() {
  const el = document.getElementById('npm-fonts');
  if (!el) return;
  el.innerHTML = '';
  NBD_FONTS.forEach(f => {
    const isAct = f.id === _nbd_activeFont;
    const ok = _nbdUnlocked(f.plan);
    const d = document.createElement('div');
    d.className = 'npm-font-card' + (isAct ? ' active' : '');
    d.style.opacity = ok ? '1' : '0.45';
    d.style.cursor = ok ? 'pointer' : 'default';
    d.onclick = () => nbdApplyFont(f.id);
    d.innerHTML = `<div class="npm-font-head">${f.name} ${!ok?'🔒':''}<div class="npm-font-check"></div></div><div class="npm-font-display" style="font-family:${f.css.fd}">${f.preview.d}</div><div class="npm-font-body" style="font-family:${f.css.fb}">${f.preview.b}</div><div class="npm-font-mono" style="font-family:${f.css.fm}">const lead = { name: 'Dave Pruitt' }</div>`;
    el.appendChild(d);
  });
}

/* ── CUSTOM BUILDER ───────────────────────────────────────────────── */
function nbdLiveCustom() {
  const bg=document.getElementById('ncp-bg').value, s=document.getElementById('ncp-s').value, ac=document.getElementById('ncp-accent').value, t=document.getElementById('ncp-t').value, m=document.getElementById('ncp-m').value;
  _nbdApplyCustomVars(ac,bg,s,t,m);
}
function nbdApplyCustom() { nbdLiveCustom(); nbdToast('Custom preview applied'); }
function nbdSaveCustom() {
  if (!_nbdUnlocked('command')) { nbdToast('🔒 Custom themes require Command plan'); return; }
  const ac=document.getElementById('ncp-accent').value, bg=document.getElementById('ncp-bg').value, s=document.getElementById('ncp-s').value, tc=document.getElementById('ncp-t').value, m=document.getElementById('ncp-m').value;
  const slot = { id:'custom-'+Date.now(), name:'Custom '+((_nbd_customs.length)+1), cat:'custom', plan:'command', accent:ac, bg, s, tc, m };
  _nbd_customs.push(slot);
  localStorage.setItem('nbd-customs', JSON.stringify(_nbd_customs));
  nbdToast('Saved: ' + slot.name);
  nbdRenderThemes();
}
function _nbdApplyCustomVars(accent,bg,s,text,muted) {
  const R = document.documentElement.style;
  const adj=(h,p)=>{const n=parseInt((h||'#000').replace('#',''),16);const r=Math.min(255,Math.max(0,((n>>16)&255)+Math.round(p*2.55)));const g=Math.min(255,Math.max(0,((n>>8)&255)+Math.round(p*2.55)));const b=Math.min(255,Math.max(0,(n&255)+Math.round(p*2.55)));return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);};
  R.setProperty('--bg',bg); R.setProperty('--s',s); R.setProperty('--bar',s);
  R.setProperty('--s2',adj(s,5)); R.setProperty('--s3',adj(s,10)); R.setProperty('--rule',adj(s,12));
  R.setProperty('--orange',accent); R.setProperty('--ac',accent);
  R.setProperty('--orange-h',adj(accent,12)); R.setProperty('--orange-a',adj(accent,-10));
  R.setProperty('--t',text); R.setProperty('--m',muted); R.setProperty('--muted',muted);
  try { const rr=parseInt(accent.slice(1,3),16),gg=parseInt(accent.slice(3,5),16),bb=parseInt(accent.slice(5,7),16); R.setProperty('--glow',`rgba(${rr},${gg},${bb},0.28)`); R.setProperty('--glow2',`rgba(${rr},${gg},${bb},0.09)`); } catch(e){}
}

/* ── COPY HELPERS ─────────────────────────────────────────────────── */
function nbdCopyClass() { const c=_nbd_activeTheme==='default'?'(default — no class needed)':`body.theme-${_nbd_activeTheme}`; navigator.clipboard?.writeText(c); nbdToast('Copied: '+c); }
function nbdCopyFS()    { const c=`await db.collection('users').doc(uid).update({ theme: '${_nbd_activeTheme}', font: '${_nbd_activeFont}' });`; navigator.clipboard?.writeText(c); nbdToast('Firestore write copied'); }

/* ── HOW-TO MODAL ─────────────────────────────────────────────────── */
function nbdHowtoOpen()  { document.getElementById('nbd-howto-modal').classList.add('open'); }
function nbdHowtoClose() { document.getElementById('nbd-howto-modal').classList.remove('open'); }
document.addEventListener('DOMContentLoaded', function() {
  const _howtoModal = document.getElementById('nbd-howto-modal');
  if (_howtoModal) _howtoModal.addEventListener('click', function(e) { if (e.target === this) nbdHowtoClose(); });
});

/* ── TOAST ────────────────────────────────────────────────────────── */
function nbdToast(msg) {
  let el = document.getElementById('nbd-toast') || document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id='nbd-toast'; el.className='nbd-toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

/* ── GLOBAL ALIASES (backward compat for both pages) ─────────────── */
window.toggleThemeMenu         = nbdPickerOpen;
window.dsApplyTheme            = nbdApplyTheme;
window.buildTopbarThemeGrid    = nbdRenderThemes;
window.buildWelcomeThemePicker = () => {};  // DS welcome modal — no-op, full picker replaces it

/* ── EXPOSE MAP FUNCTIONS TO WINDOW ─────────────────────────────── */
window.searchMap = searchMap;
window.selectPin = selectPin;
window.deletePin = deletePin;
window.clearAllPins = clearAllPins;
window.damageNearMePhotos = damageNearMePhotos;
window.toggleMapSidebar = toggleMapSidebar;
window.spyglassSearch = spyglassSearch;
window.spyglassGoToLocation = spyglassGoToLocation;
window.fabToggle = fabToggle;
window.quickStormCheck = quickStormCheck;
window.updatePinStats = updatePinStats;
window.startZoneDraw = startZoneDraw;
window.cancelZoneDraw = cancelZoneDraw;
window.saveZone = saveZone;
window.deleteZone = deleteZone;
window.selectZoneColor = selectZoneColor;
window.toggleOverlay = toggleOverlay;
// Note: damagNearMe is an alias for spyglassGoToLocation
window.damagNearMe = spyglassGoToLocation;

/* ── BOOT ─────────────────────────────────────────────────────────── */
(function nbdBoot() {
  const saved = localStorage.getItem('nbd-theme') || localStorage.getItem('nbd_gt') || localStorage.getItem('ds-theme') || 'default';
  const t = _nbdGetTheme(saved) || _nbdGetTheme('default');
  if (t) {
    document.body.className = t.id === 'default' ? '' : 'theme-' + t.id;
    document.documentElement.setAttribute('data-theme', t.id);
    const R = document.documentElement.style;
    R.setProperty('--ac',     t.accent);
    R.setProperty('--orange', t.accent);
    R.setProperty('--gold',   t.accent);
    R.setProperty('--bg',     t.bg  || '#0A0C0F');
    R.setProperty('--bar',    t.s   || '#13171d');
    _nbd_activeTheme = t.id;
    _nbdUpdateLabels(t);
  }
  nbdApplyFont(localStorage.getItem('nbd-font') || 'nbd-default');
  nbdRenderCats();
})();
/* ── END NBD UNIFIED APPEARANCE ENGINE ── */


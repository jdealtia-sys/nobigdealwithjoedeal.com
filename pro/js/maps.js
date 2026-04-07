// ============================================================
// NBD Pro — maps.js
// Map init, pins, overlays, heat map, storm layer,
// drawing tool, measurement, zone management
// ============================================================

// ══════════════════════════════════════════════
// MAIN MAP
// ══════════════════════════════════════════════
let mainMap, curPinStatus='not-home', curPinColor='#9CA3AF', pinMarkers={}, pinClusterGroup=null;
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
  // Initialize marker cluster group for performance with many pins
  if(typeof L.markerClusterGroup === 'function') {
    pinClusterGroup = L.markerClusterGroup({ maxClusterRadius:50, spiderfyOnMaxZoom:true, showCoverageOnHover:false, zoomToBoundsOnClick:true, disableClusteringAtZoom:18 });
    mainMap.addLayer(pinClusterGroup);
  }
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
  // Add to cluster group if available, otherwise directly to map
  if(pinClusterGroup) { pinClusterGroup.addLayer(m); } else { m.addTo(mainMap); }
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
function deletePin(id) { if(pinMarkers[id]){if(pinClusterGroup)pinClusterGroup.removeLayer(pinMarkers[id]);else mainMap.removeLayer(pinMarkers[id]);delete pinMarkers[id];} window._deletePin(id); refreshHeatLayer(); }
function clearAllPins() { if(pinClusterGroup){pinClusterGroup.clearLayers();}else{Object.values(pinMarkers).forEach(m=>mainMap.removeLayer(m));} pinMarkers={}; }

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

window.makeLeadFromSearch = makeLeadFromSearch;
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
// DRAWING TOOL v2 — multi-facet, save/restore, drag, snap, shortcuts
// ══════════════════════════════════════════════
let drawMap, drawOn=false, drawStart=null, drawLT=0, drawnLines=[], tempLine=null, tempLbl=null;
let drawMode = 'line'; // 'line' | 'perim' | 'er' | 'gutter'

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

// Multi-facet state
const FACET_COLORS = ['#22C55E','#3B82F6','#F97316','#A855F7','#EC4899','#EAB308','#06B6D4','#EF4444'];
let facets = []; // [{points, dots, segments, closed, polygon, baseArea, closeRing, pitch, label}]
let activeFacetIdx = -1; // -1 = no active facet

// Current perimeter state (points into active facet)
let perimPoints   = [];
let perimDots     = [];
let perimSegments = [];
let perimClosed   = false;
let perimPendingP1 = null;
let perimPendingP2 = null;
let perimTempLine  = null;
let perimTempLbl   = null;
let perimPolygon   = null;
let perimBaseArea  = 0;
let perimCloseRing = null;

// Gutter state (separate from perim)
let gutterPoints = [];
let gutterDots   = [];

// Line select
let selectedLineId = null;

// Map layers
let drawMapLayers = {};
let currentLayerType = 'satellite';

// Snap
const SNAP_PX = 12;

function initDrawMap() {
  drawMap = L.map('drawMap',{preferCanvas:true}).setView([39.07,-84.17],19);
  // Map layers
  drawMapLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'© Esri',maxZoom:21});
  drawMapLayers.street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM',maxZoom:19});
  drawMapLayers.hybrid = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:21}),
    L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-labels/{z}/{x}/{y}.png',{maxZoom:20,opacity:.7})
  ]);
  drawMapLayers.satellite.addTo(drawMap);
  currentLayerType = 'satellite';

  drawMap.on('click', e => {
    if(!drawOn) return;
    const snapped = snapToVertex(e.latlng);
    if(drawMode === 'line') handleLineClick(snapped);
    else if(drawMode === 'perim') handlePerimClick(snapped);
    else if(drawMode === 'gutter') handleGutterClick(snapped);
  });

  drawMap.on('mousemove', e => {
    if(!drawOn) return;
    const pt = snapToVertex(e.latlng);
    if(drawMode === 'line' && drawStart) {
      if(tempLine) drawMap.removeLayer(tempLine);
      if(tempLbl)  drawMap.removeLayer(tempLbl);
      const lt = LT[drawLT];
      tempLine = L.polyline([drawStart, pt], {color:lt.color, weight:3, dashArray:'6,4', opacity:.7}).addTo(drawMap);
      const d = hav(drawStart, pt);
      tempLbl  = L.marker(mid(drawStart, pt), {icon:L.divIcon({html:`<div class="meas-label">${d.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
    }
    if(drawMode === 'perim' && perimPoints.length > 0 && !perimClosed) {
      const lastPt = perimPoints[perimPoints.length-1];
      if(perimTempLine) drawMap.removeLayer(perimTempLine);
      if(perimTempLbl)  drawMap.removeLayer(perimTempLbl);
      perimTempLine = L.polyline([lastPt, pt], {color:'#BE185D', weight:3, dashArray:'6,4', opacity:.6}).addTo(drawMap);
      const d = hav(lastPt, pt);
      perimTempLbl  = L.marker(mid(lastPt, pt), {icon:L.divIcon({html:`<div class="meas-label">${d.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
    }
    if(drawMode === 'gutter' && gutterPoints.length > 0) {
      const lastPt = gutterPoints[gutterPoints.length-1];
      if(perimTempLine) drawMap.removeLayer(perimTempLine);
      if(perimTempLbl)  drawMap.removeLayer(perimTempLbl);
      perimTempLine = L.polyline([lastPt, pt], {color:'#06B6D4', weight:3, dashArray:'6,4', opacity:.6}).addTo(drawMap);
      const d = hav(lastPt, pt);
      perimTempLbl  = L.marker(mid(lastPt, pt), {icon:L.divIcon({html:`<div class="meas-label">${d.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName||'').toLowerCase();
    if(tag==='input'||tag==='textarea'||tag==='select') return;
    const active = document.getElementById('view-draw');
    if(!active || active.style.display==='none' || !active.offsetParent) return;
    if(e.key==='d'||e.key==='D') { e.preventDefault(); toggleDraw(); }
    else if(e.key==='z'||e.key==='Z') { e.preventDefault(); undoLine(); }
    else if(e.key==='c'&&!e.ctrlKey&&!e.metaKey) { e.preventDefault(); clearDraw(); }
    else if(e.key==='Escape') { e.preventDefault(); if(drawOn) toggleDraw(); }
    else if(e.key>='1'&&e.key<='9') { const i=parseInt(e.key)-1; if(i<LT.length){ const btn=document.querySelectorAll('.lt-btn')[i]; if(btn) selLT(i,btn); }}
    else if(e.key==='f'||e.key==='F') { e.preventDefault(); zoomToFit(); }
  });

  // Show shortcut hint briefly
  showShortcutHint();

  // Try restore previous drawing
  tryRestoreDrawing();

  recalc();
}

function showShortcutHint() {
  if(localStorage.getItem('nbd_draw_hint_shown')) return;
  const hint = document.createElement('div');
  hint.className = 'draw-shortcut-hint';
  hint.innerHTML = '<b>Shortcuts:</b> D=Draw Z=Undo C=Clear F=Fit 1-9=Type Esc=Cancel';
  const area = document.querySelector('#view-draw .map-area');
  if(area) { area.appendChild(hint); setTimeout(()=>{ hint.style.opacity='0'; setTimeout(()=>hint.remove(),500); },6000); }
  localStorage.setItem('nbd_draw_hint_shown','1');
}

// ── SNAP TO VERTEX ──────────────────────────────
function snapToVertex(latlng) {
  if(!drawMap) return latlng;
  const screenPt = drawMap.latLngToContainerPoint(latlng);
  let best = null, bestDist = SNAP_PX+1;
  // Check all existing dots/points
  const allPts = [];
  drawnLines.forEach(l => {
    if(l.p1) allPts.push(l.p1);
    if(l.p2) allPts.push(l.p2);
  });
  facets.forEach(f => f.points.forEach(p => allPts.push(p)));
  gutterPoints.forEach(p => allPts.push(p));
  perimPoints.forEach(p => allPts.push(p));

  allPts.forEach(p => {
    const sp = drawMap.latLngToContainerPoint(p);
    const dx = sp.x - screenPt.x, dy = sp.y - screenPt.y;
    const d = Math.sqrt(dx*dx + dy*dy);
    if(d < bestDist) { bestDist = d; best = p; }
  });
  return best || latlng;
}

// ── MAP LAYER TOGGLE ────────────────────────────
function toggleMapLayer() {
  const order = ['satellite','street','hybrid'];
  const labels = {satellite:'🛰️ Satellite',street:'🗺️ Street',hybrid:'🔀 Hybrid'};
  const idx = order.indexOf(currentLayerType);
  const next = order[(idx+1)%order.length];
  // Remove current
  if(drawMapLayers[currentLayerType]) drawMap.removeLayer(drawMapLayers[currentLayerType]);
  // Add next
  drawMapLayers[next].addTo(drawMap);
  currentLayerType = next;
  const btn = document.getElementById('layerToggleBtn');
  if(btn) btn.textContent = labels[next]||next;
}

// ── MY LOCATION ─────────────────────────────
function goToMyLocation() {
  const btn = document.getElementById('myLocBtn');
  if (!btn) return;
  if (!navigator.geolocation) {
    if (window.showToast) showToast('Geolocation not supported by this browser', 'error');
    return;
  }
  btn.textContent = '⏳ Locating...';
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (drawMap) {
        drawMap.setView([lat, lng], 20);
        // Add a pulsing marker at current location
        const locMarker = L.circleMarker([lat, lng], {
          radius: 8, color: '#4A9EFF', fillColor: '#4A9EFF',
          fillOpacity: 0.4, weight: 3
        }).addTo(drawMap);
        // Remove after 5 seconds
        setTimeout(() => { if (drawMap.hasLayer(locMarker)) drawMap.removeLayer(locMarker); }, 5000);
      }
      btn.innerHTML = '📍 My Location';
      btn.disabled = false;
      if (window.showToast) showToast('Moved to your location', 'success');
    },
    (err) => {
      btn.innerHTML = '📍 My Location';
      btn.disabled = false;
      const msgs = {1: 'Location permission denied', 2: 'Location unavailable', 3: 'Location request timed out'};
      if (window.showToast) showToast(msgs[err.code] || 'Could not get location', 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ── DRAW MODE SWITCHER ───────────────────────
function setDrawMode(mode, btn) {
  if(drawOn) toggleDraw();
  hideReChooser();

  drawMode = mode;
  document.querySelectorAll('.draw-mode-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');

  const ltGrid = document.getElementById('ltGrid');
  const ltLabel = document.getElementById('ltGridLabel');
  const perimBar = document.getElementById('perimBar');
  const erBar = document.getElementById('erBar');
  const gutterResult = document.getElementById('gutterResult');

  perimBar.classList.remove('visible');
  erBar.classList.remove('visible');
  gutterResult.classList.remove('visible');

  if(mode === 'line') {
    ltGrid.style.display = '';
    ltLabel.style.display = '';
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
    const dot = makeDraggableDot(latlng, LT[drawLT].color);
    drawStart._dot = dot;
  } else {
    const endDot = makeDraggableDot(latlng, LT[drawLT].color);
    finalizeLine(drawStart, latlng, drawStart._dot, endDot);
    drawStart = null;
  }
}

// ── DRAGGABLE DOT FACTORY ────────────────────
function makeDraggableDot(latlng, color, opts) {
  const dot = L.circleMarker(latlng, {
    radius:6, color:'#fff', fillColor:color, fillOpacity:1, weight:2,
    draggable:true, ...(opts||{})
  }).addTo(drawMap);
  // Make draggable via mouse events
  let dragging = false, dragLine = null;
  dot.on('mousedown', e => {
    if(drawOn) return; // Don't drag while drawing
    L.DomEvent.stopPropagation(e);
    dragging = true;
    drawMap.dragging.disable();
    drawMap.on('mousemove', onDragMove);
    drawMap.on('mouseup', onDragEnd);
  });
  function onDragMove(e) {
    if(!dragging) return;
    dot.setLatLng(e.latlng);
    updateLinesForDot(dot, e.latlng);
  }
  function onDragEnd(e) {
    if(!dragging) return;
    dragging = false;
    drawMap.dragging.enable();
    drawMap.off('mousemove', onDragMove);
    drawMap.off('mouseup', onDragEnd);
    updateLinesForDot(dot, dot.getLatLng());
    recalc(); recalcGutters(); autoSaveDrawing();
    // Update facet polygons
    facets.forEach((f,fi) => {
      const dotIdx = f.dots.indexOf(dot);
      if(dotIdx >= 0) { f.points[dotIdx] = dot.getLatLng(); rebuildFacetPolygon(fi); }
    });
  }
  dot._nbd_id = Date.now() + Math.random();
  return dot;
}

function updateLinesForDot(dot, newLatLng) {
  drawnLines.forEach(l => {
    let changed = false;
    if(l.dot1 === dot) { l.p1 = newLatLng; changed = true; }
    if(l.dot2 === dot) { l.p2 = newLatLng; changed = true; }
    if(changed) {
      l.line.setLatLngs([l.p1, l.p2]);
      l.dist = hav(l.p1, l.p2);
      drawMap.removeLayer(l.lbl);
      l.lbl = L.marker(mid(l.p1, l.p2), {icon:L.divIcon({html:`<div class="meas-label" style="border-color:${l.color}">${l.dist.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
    }
  });
  renderLineList();
}

function selLT(i, el) {
  document.querySelectorAll('.lt-btn').forEach(b => { b.classList.remove('active'); b.style.borderColor = ''; });
  el.classList.add('active'); el.style.borderColor = LT[i].color;
  drawLT = i;
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
  // Editable label on click
  lbl.on('click', () => editLineLength(id));
  const id = Date.now() + Math.random();
  drawnLines.push({id, type:drawLT, name:lt.name, color:lt.color, dist:d, line, lbl, p1, p2, dot1, dot2, subtype:'line'});
  clearTemp(); renderLineList(); recalc(); autoSaveDrawing();
  return id;
}

// ── LINE LENGTH EDITING ──────────────────────
function editLineLength(lineId) {
  if(drawOn) return;
  const l = drawnLines.find(x => x.id === lineId);
  if(!l) return;
  const val = prompt(`Edit ${l.name} length (current: ${l.dist.toFixed(1)} ft):`, l.dist.toFixed(1));
  if(!val || isNaN(parseFloat(val))) return;
  const newDist = parseFloat(val);
  if(newDist <= 0) return;
  const ratio = newDist / l.dist;
  // Scale line from p1 toward p2
  const newLat = l.p1.lat + (l.p2.lat - l.p1.lat) * ratio;
  const newLng = l.p1.lng + (l.p2.lng - l.p1.lng) * ratio;
  const newP2 = L.latLng(newLat, newLng);
  l.p2 = newP2;
  l.dist = newDist;
  l.line.setLatLngs([l.p1, l.p2]);
  if(l.dot2) l.dot2.setLatLng(newP2);
  drawMap.removeLayer(l.lbl);
  l.lbl = L.marker(mid(l.p1, l.p2), {icon:L.divIcon({html:`<div class="meas-label" style="border-color:${l.color}">${l.dist.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
  l.lbl.on('click', () => editLineLength(lineId));
  renderLineList(); recalc(); autoSaveDrawing();
  showToast(`Updated to ${newDist.toFixed(1)} ft`);
}

// ── PERIMETER MODE (multi-facet) ─────────────
function handlePerimClick(latlng) {
  if(perimClosed) {
    // Current facet closed — start new facet
    saveFacet();
    resetPerimState();
  }
  // Check if clicking near first point to close
  if(perimPoints.length >= 3) {
    const first = perimPoints[0];
    const screenDist = drawMap.latLngToContainerPoint(first).distanceTo(drawMap.latLngToContainerPoint(latlng));
    if(screenDist < 20) { // 20px on screen — much more precise than 30ft
      closePerimeter();
      return;
    }
  }
  if(perimPendingP1 !== null) return;

  const facetColor = FACET_COLORS[facets.length % FACET_COLORS.length];
  const dot = makeDraggableDot(latlng, facetColor);

  if(perimPoints.length === 0) {
    perimCloseRing = L.circleMarker(latlng, {radius:14, color:facetColor, fillColor:'transparent', weight:2, dashArray:'4,3', opacity:.6}).addTo(drawMap);
  }

  if(perimPoints.length > 0) {
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
  if(drawMode==='perim') document.getElementById('perimBar').classList.add('visible');
  perimPendingP1 = null;
  perimPendingP2 = null;
}

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
    const facetColor = FACET_COLORS[facets.length % FACET_COLORS.length];
    if(perimPolygon) drawMap.removeLayer(perimPolygon);
    perimPolygon = L.polygon(perimPoints, {color:facetColor, weight:1, fillColor:facetColor, fillOpacity:.12}).addTo(drawMap);
    perimBaseArea = shoelaceArea(perimPoints);
    // Add area label on polygon
    addAreaLabel(perimPoints, perimBaseArea, facets.length);
    showToast('Facet '+(facets.length+1)+' closed — '+perimBaseArea.toFixed(0)+' sf');
    const bar = document.getElementById('perimBar');
    bar.textContent = '⬡ Facet '+(facets.length+1)+' — '+perimBaseArea.toFixed(0)+' sf · click to start new facet';
    if(perimCloseRing) { drawMap.removeLayer(perimCloseRing); perimCloseRing = null; }
    saveFacet();
    recalc(); autoSaveDrawing();
  }
  hideReChooser();
}

function addPerimSegment(p1, p2, subtype) {
  const eaveColor = '#BE185D', rakeColor = '#EC4899';
  const segColor  = subtype === 'eave' ? eaveColor : rakeColor;
  const dash      = subtype === 'eave' ? null : '8,5';
  const d = hav(p1, p2);
  const line = L.polyline([p1, p2], {color:segColor, weight:4, opacity:.95, dashArray:dash}).addTo(drawMap);
  const lbl  = L.marker(mid(p1, p2), {icon:L.divIcon({html:`<div class="meas-label" style="border-color:${segColor}">${d.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
  lbl.on('click', () => editLineLength(id));
  const id = Date.now() + Math.random();
  const dot1 = perimDots.find(d => {
    const ll = d.getLatLng();
    return Math.abs(ll.lat-p1.lat)<0.0000001 && Math.abs(ll.lng-p1.lng)<0.0000001;
  });
  const dot2 = perimDots.find(d => {
    const ll = d.getLatLng();
    return Math.abs(ll.lat-p2.lat)<0.0000001 && Math.abs(ll.lng-p2.lng)<0.0000001;
  });
  const seg = {id, type: subtype==='eave' ? 5 : 4, name: subtype==='eave'?'Eave':'Rake', color:segColor, dist:d, line, lbl, p1, p2, dot1:dot1||null, dot2:dot2||null, subtype, isPerim:true};
  perimSegments.push(seg);
  drawnLines.push(seg);
  line.on('click', () => { if(drawMode === 'er') erToggleSegment(id); });
  renderLineList(); recalc();
  return id;
}

function closePerimeter() {
  if(perimPoints.length < 3) return;
  const last  = perimPoints[perimPoints.length - 1];
  const first = perimPoints[0];
  perimPendingP1 = last;
  perimPendingP2 = first;
  window._perimClosing = true;
  showReChooser();
}

// ── FACET MANAGEMENT ─────────────────────────
function saveFacet() {
  if(perimPoints.length < 3) return;
  const pitch = parseFloat(document.getElementById('pitchSel')?.value || 1.202);
  facets.push({
    points:[...perimPoints], dots:[...perimDots], segments:[...perimSegments],
    closed:perimClosed, polygon:perimPolygon, baseArea:perimBaseArea,
    closeRing:perimCloseRing, pitch, label:'Facet '+(facets.length+1),
    areaLabel: null // set by addAreaLabel
  });
  activeFacetIdx = facets.length - 1;
  renderFacetList();
}

function resetPerimState() {
  perimPoints = []; perimDots = []; perimSegments = [];
  perimClosed = false; perimPendingP1 = null; perimPendingP2 = null;
  perimPolygon = null; perimBaseArea = 0; perimCloseRing = null;
  window._perimClosing = false;
  const bar = document.getElementById('perimBar');
  if(bar) bar.textContent = '⬡ Perimeter mode — click to trace Facet '+(facets.length+1)+'. Click first dot to close.';
}

function rebuildFacetPolygon(fi) {
  const f = facets[fi];
  if(!f || !f.closed) return;
  if(f.polygon) drawMap.removeLayer(f.polygon);
  const color = FACET_COLORS[fi % FACET_COLORS.length];
  f.polygon = L.polygon(f.points, {color, weight:1, fillColor:color, fillOpacity:.12}).addTo(drawMap);
  f.baseArea = shoelaceArea(f.points);
  // Update area label
  if(f.areaLabel) drawMap.removeLayer(f.areaLabel);
  addAreaLabel(f.points, f.baseArea, fi);
  recalc();
}

function addAreaLabel(points, area, facetIdx) {
  if(!points.length) return;
  // Center point
  const cLat = points.reduce((s,p)=>s+p.lat,0)/points.length;
  const cLng = points.reduce((s,p)=>s+p.lng,0)/points.length;
  const color = FACET_COLORS[facetIdx % FACET_COLORS.length];
  const lbl = L.marker([cLat,cLng], {icon:L.divIcon({
    html:`<div class="facet-area-label" style="border-color:${color};color:${color}">F${facetIdx+1}: ${area.toFixed(0)} sf</div>`,
    className:'', iconAnchor:[40,12]
  })}).addTo(drawMap);
  if(facets[facetIdx]) facets[facetIdx].areaLabel = lbl;
}

function renderFacetList() {
  const el = document.getElementById('facetList');
  if(!el) return;
  if(!facets.length) { el.innerHTML = '<p style="font-size:10px;color:var(--m);text-align:center;padding:4px;">No facets yet.</p>'; return; }
  el.innerHTML = facets.map((f,i) => {
    const color = FACET_COLORS[i % FACET_COLORS.length];
    const pitched = f.baseArea * f.pitch;
    return `<div class="facet-row" style="border-left:3px solid ${color};">
      <span class="facet-name">${f.label}</span>
      <span class="facet-area">${f.baseArea.toFixed(0)} sf</span>
      <select class="facet-pitch-sel" onchange="updateFacetPitch(${i},this.value)" title="Facet pitch">
        <option value="1.0" ${f.pitch===1?'selected':''}>Flat</option>
        <option value="1.054" ${f.pitch===1.054?'selected':''}>4/12</option>
        <option value="1.083" ${f.pitch===1.083?'selected':''}>5/12</option>
        <option value="1.118" ${f.pitch===1.118?'selected':''}>6/12</option>
        <option value="1.158" ${f.pitch===1.158?'selected':''}>7/12</option>
        <option value="1.202" ${f.pitch===1.202?'selected':''}>8/12</option>
        <option value="1.25" ${f.pitch===1.25?'selected':''}>9/12</option>
        <option value="1.302" ${f.pitch===1.302?'selected':''}>10/12</option>
        <option value="1.357" ${f.pitch===1.357?'selected':''}>11/12</option>
        <option value="1.414" ${f.pitch===1.414?'selected':''}>12/12</option>
      </select>
    </div>`;
  }).join('');
}

function updateFacetPitch(fi, val) {
  if(!facets[fi]) return;
  facets[fi].pitch = parseFloat(val);
  recalc(); autoSaveDrawing();
}

// ── AREA LABEL ON MAP ────────────────────────
// (handled by addAreaLabel above)

// Shoelace formula: area in sq feet from latlng array
function shoelaceArea(pts) {
  if(pts.length < 3) return 0;
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
  const allSegs = [...perimSegments];
  facets.forEach(f => allSegs.push(...f.segments));
  allSegs.forEach(seg => {
    if(on) {
      seg.line.on('click', () => erToggleSegment(seg.id));
    } else {
      seg.line.off('click');
      seg.line.on('click', () => { if(drawMode === 'er') erToggleSegment(seg.id); });
    }
  });
}

function erToggleSegment(id) {
  // Find in current segments or facet segments
  let seg = perimSegments.find(s => s.id === id);
  if(!seg) { for(const f of facets) { seg = f.segments.find(s => s.id === id); if(seg) break; } }
  if(!seg) return;
  const newSub  = seg.subtype === 'eave' ? 'rake' : 'eave';
  const newColor = newSub === 'eave' ? '#BE185D' : '#EC4899';
  const newDash  = newSub === 'eave' ? null : '8,5';
  const newType  = newSub === 'eave' ? 5 : 4;
  const newName  = newSub === 'eave' ? 'Eave' : 'Rake';

  seg.line.setStyle({color:newColor, dashArray:newDash});
  drawMap.removeLayer(seg.lbl);
  seg.lbl = L.marker(mid(seg.p1, seg.p2), {icon:L.divIcon({html:`<div class="meas-label" style="border-color:${newColor}">${seg.dist.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
  seg.subtype = newSub; seg.color = newColor; seg.type = newType; seg.name = newName;

  const dl = drawnLines.find(l => l.id === id);
  if(dl) { dl.subtype=newSub; dl.color=newColor; dl.type=newType; dl.name=newName; }

  renderLineList(); recalc(); autoSaveDrawing();
  showToast(`Toggled to ${newName}`);
}

// ── GUTTER MODE (separate from perimeter) ────
function handleGutterClick(latlng) {
  const dot = makeDraggableDot(latlng, '#06B6D4');
  if(gutterPoints.length > 0) {
    const prev = gutterPoints[gutterPoints.length-1];
    const d = hav(prev, latlng);
    const line = L.polyline([prev, latlng], {color:'#06B6D4', weight:4, opacity:.95, dashArray:'10,4'}).addTo(drawMap);
    const lbl  = L.marker(mid(prev, latlng), {icon:L.divIcon({html:`<div class="meas-label" style="border-color:#06B6D4">${d.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
    const prevDot = gutterDots[gutterDots.length-1]||null;
    const id = Date.now() + Math.random();
    drawnLines.push({id, type:10, name:'Gutters', color:'#06B6D4', dist:d, line, lbl, p1:prev, p2:latlng, dot1:prevDot, dot2:dot, subtype:'gutter'});
    clearTemp(); renderLineList(); recalcGutters(); autoSaveDrawing();
  }
  gutterPoints.push(latlng);
  gutterDots.push(dot);
}

function recalcGutters() {
  const gutterLines = drawnLines.filter(l => l.type === 10);
  const total = gutterLines.reduce((s, l) => s + l.dist, 0);
  const ds = Math.ceil(total / 40);
  document.getElementById('gr-total').textContent = total.toFixed(1) + ' ft';
  document.getElementById('gr-ds').textContent = ds;
  const el = document.getElementById('gutterResult');
  if(el) el.classList.toggle('visible', gutterLines.length > 0);
}

// ── LINE SELECTION ─────────────────────────────
function selectLine(id) {
  selectedLineId = id;
  renderLineList();
  drawnLines.forEach(l => {
    if(l.line) l.line.setStyle({weight: l.id===id ? 6 : 4, opacity: l.id===id ? 1 : .95});
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
  l.type = ltIndex; l.name = lt.n; l.color = lt.color;
  l.line.setStyle({color:lt.color, dashArray:lt.dash||null});
  drawMap.removeLayer(l.lbl);
  l.lbl = L.marker(mid(l.p1, l.p2), {icon:L.divIcon({html:`<div class="meas-label" style="border-color:${lt.color}">${l.dist.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
  l.lbl.on('click', () => editLineLength(id));
  renderLineList(); recalc(); autoSaveDrawing();
}

// ── UNDO / DELETE / CLEAR ─────────────────────
function deleteLine(id) {
  const i = drawnLines.findIndex(l => l.id === id); if(i < 0) return;
  const l = drawnLines[i];
  drawMap.removeLayer(l.line);
  drawMap.removeLayer(l.lbl);
  if(l.dot1 && !isSharedDot(l.dot1, id)) drawMap.removeLayer(l.dot1);
  if(l.dot2 && !isSharedDot(l.dot2, id)) drawMap.removeLayer(l.dot2);
  const pi = perimSegments.findIndex(s => s.id === id);
  if(pi >= 0) perimSegments.splice(pi, 1);
  drawnLines.splice(i, 1);
  if(selectedLineId === id) deselectLine();
  renderLineList(); recalc(); recalcGutters(); autoSaveDrawing();
}

function isSharedDot(dot, excludeLineId) {
  return drawnLines.some(l => l.id !== excludeLineId && (l.dot1 === dot || l.dot2 === dot));
}

function undoLine() {
  if(drawnLines.length) deleteLine(drawnLines[drawnLines.length-1].id);
  if(drawMode === 'perim' && perimDots.length > 0 && !perimClosed) {
    const d = perimDots.pop();
    drawMap.removeLayer(d);
    if(perimPoints.length > 0) perimPoints.pop();
  }
  if(drawMode === 'gutter' && gutterDots.length > 0) {
    const d = gutterDots.pop();
    drawMap.removeLayer(d);
    if(gutterPoints.length > 0) gutterPoints.pop();
  }
}

function clearDraw() {
  if(!confirm('Clear all lines and facets?')) return;
  drawnLines.forEach(l => {
    drawMap.removeLayer(l.line);
    drawMap.removeLayer(l.lbl);
    if(l.dot1) drawMap.removeLayer(l.dot1);
    if(l.dot2) drawMap.removeLayer(l.dot2);
  });
  perimDots.forEach(d => drawMap.removeLayer(d));
  gutterDots.forEach(d => drawMap.removeLayer(d));
  if(perimPolygon) { drawMap.removeLayer(perimPolygon); perimPolygon = null; }
  if(perimCloseRing) { drawMap.removeLayer(perimCloseRing); perimCloseRing = null; }
  clearTemp();
  // Clear facets
  facets.forEach(f => {
    if(f.polygon) drawMap.removeLayer(f.polygon);
    if(f.areaLabel) drawMap.removeLayer(f.areaLabel);
    f.dots.forEach(d => { try{drawMap.removeLayer(d);}catch(e){} });
  });
  facets = []; activeFacetIdx = -1;
  drawnLines = []; perimSegments = []; perimPoints = []; perimDots = [];
  gutterPoints = []; gutterDots = [];
  perimClosed = false; perimPendingP1 = null; perimPendingP2 = null;
  perimBaseArea = 0; selectedLineId = null;
  hideReChooser();
  document.getElementById('perimBar').textContent = '⬡ Perimeter mode — click map to trace. Click first dot to close.';
  renderLineList(); renderFacetList(); recalc(); recalcGutters();
  clearSavedDrawing();
}

// ── ANGLE DISPLAY ────────────────────────────
function calcAngle(pA, pB, pC) {
  // Angle at B between segments BA and BC, in degrees
  const ax = pA.lng - pB.lng, ay = pA.lat - pB.lat;
  const cx = pC.lng - pB.lng, cy = pC.lat - pB.lat;
  const dot = ax*cx + ay*cy;
  const cross = ax*cy - ay*cx;
  let angle = Math.atan2(Math.abs(cross), dot) * 180 / Math.PI;
  return angle;
}

function showAngles() {
  // Show angles at each vertex where 2+ lines meet
  const vertices = new Map(); // key: "lat,lng" -> [{p1,p2,lineId}]
  drawnLines.forEach(l => {
    if(!l.p1 || !l.p2) return;
    const k1 = l.p1.lat.toFixed(7)+','+l.p1.lng.toFixed(7);
    const k2 = l.p2.lat.toFixed(7)+','+l.p2.lng.toFixed(7);
    if(!vertices.has(k1)) vertices.set(k1,[]);
    if(!vertices.has(k2)) vertices.set(k2,[]);
    vertices.get(k1).push({other:l.p2, id:l.id});
    vertices.get(k2).push({other:l.p1, id:l.id});
  });
  // Remove old angle labels
  document.querySelectorAll('.angle-label-marker').forEach(e=>e.remove());
  vertices.forEach((edges, key) => {
    if(edges.length < 2) return;
    const [lat,lng] = key.split(',').map(Number);
    const center = L.latLng(lat,lng);
    for(let i=0; i<edges.length; i++) {
      for(let j=i+1; j<edges.length; j++) {
        const angle = calcAngle(edges[i].other, center, edges[j].other);
        if(angle > 1 && angle < 179) {
          L.marker(center, {icon:L.divIcon({
            html:`<div class="angle-label">${angle.toFixed(0)}°</div>`,
            className:'angle-label-marker', iconAnchor:[12,-8]
          })}).addTo(drawMap);
        }
      }
    }
  });
}

function renderLineList() {
  const el = document.getElementById('lineList');
  if(!drawnLines.length) {
    el.innerHTML = '<p style="font-size:10px;color:var(--m);text-align:center;padding:8px;">No lines yet.</p>';
    return;
  }
  const ltOpts = LT.map((lt, i) => `<option value="${i}">${lt.n}</option>`).join('');
  el.innerHTML = drawnLines.map(l => {
    const isSel = l.id === selectedLineId;
    return `<div class="line-item ${isSel ? 'selected' : ''}" onclick="selectLine(${l.id})">
      <div class="lt-dot" style="background:${l.color};${l.type===4?'border:1px dashed #fff;':''}"></div>
      <span class="line-lbl">${l.name}</span>
      <span class="line-len">${l.dist.toFixed(1)} ft</span>
      ${isSel ? `<select class="line-type-sel" onchange="retypeLine(${l.id},parseInt(this.value))" onclick="event.stopPropagation()">${ltOpts}</select>` : `<button class="line-del" onclick="event.stopPropagation();deleteLine(${l.id})">✕</button>`}
    </div>`;
  }).join('');
  if(selectedLineId !== null) {
    const sel = el.querySelector('.line-type-sel');
    if(sel) { const l = drawnLines.find(x => x.id === selectedLineId); if(l) sel.value = l.type; }
  }
  // Show angles when lines exist
  showAngles();
}

function recalc() {
  const globalPitch = parseFloat(document.getElementById('pitchSel')?.value || 1.202);
  const waste = parseFloat(document.getElementById('wasteSel')?.value || 1.17);
  const eave  = drawnLines.filter(l => l.type === 5);
  const rake  = drawnLines.filter(l => l.type === 4);
  let base = 0, pitched = 0;

  // Multi-facet: sum each facet with its own pitch
  if(facets.length > 0) {
    facets.forEach(f => {
      if(f.closed && f.baseArea > 0) {
        base += f.baseArea;
        pitched += f.baseArea * f.pitch;
      }
    });
    // Add any open perimeter
    if(perimClosed && perimBaseArea > 0 && !facets.find(f => f.baseArea === perimBaseArea)) {
      base += perimBaseArea;
      pitched += perimBaseArea * globalPitch;
    }
  }
  // Fallback: single perimeter or line-based
  else if(perimClosed && perimBaseArea > 0) {
    base = perimBaseArea;
    pitched = base * globalPitch;
  }
  else if(eave.length && rake.length) {
    base = eave.reduce((s,l) => s+l.dist, 0) * (rake.reduce((s,l) => s+l.dist, 0) / rake.length);
    pitched = base * globalPitch;
  }
  else if(drawnLines.filter(l=>l.type!==10).length) {
    const tot = drawnLines.filter(l=>l.type!==10).reduce((s,l) => s+l.dist, 0);
    base = (tot/4) * (tot/4);
    pitched = base * globalPitch;
  }

  const w = pitched * waste, sq = w / 100;
  document.getElementById('cr-base').textContent    = base.toFixed(0) + ' sf';
  document.getElementById('cr-pitched').textContent = pitched.toFixed(0) + ' sf';
  document.getElementById('cr-waste').textContent   = w.toFixed(0) + ' sf';
  document.getElementById('cr-sq').textContent      = sq.toFixed(2) + ' sq';
}

// ── ZOOM TO FIT ──────────────────────────────
function zoomToFit() {
  if(!drawMap) return;
  const allPts = [];
  drawnLines.forEach(l => { if(l.p1) allPts.push(l.p1); if(l.p2) allPts.push(l.p2); });
  facets.forEach(f => f.points.forEach(p => allPts.push(p)));
  gutterPoints.forEach(p => allPts.push(p));
  perimPoints.forEach(p => allPts.push(p));
  if(!allPts.length) { showToast('No lines to fit','info'); return; }
  const bounds = L.latLngBounds(allPts);
  drawMap.fitBounds(bounds.pad(0.15));
}

// ── SCREENSHOT EXPORT ────────────────────────
function screenshotMap() {
  showToast('Capturing map...','info');
  // Use leaflet-image or canvas approach
  try {
    const mapEl = document.getElementById('drawMap');
    // Try html2canvas if available, else use leaflet's built-in
    if(typeof html2canvas !== 'undefined') {
      html2canvas(mapEl).then(canvas => {
        canvas.toBlob(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'nbd-drawing-'+(document.getElementById('drawSearch')?.value||'map').replace(/\s+/g,'-')+'.png';
          a.click(); URL.revokeObjectURL(url);
          showToast('Screenshot saved!','ok');
        });
      });
    } else {
      // Fallback: grab the tile canvas
      const canvases = mapEl.querySelectorAll('canvas');
      if(canvases.length) {
        canvases[0].toBlob(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'nbd-drawing.png';
          a.click(); URL.revokeObjectURL(url);
          showToast('Screenshot saved!','ok');
        });
      } else {
        showToast('Canvas not available — try in a different browser','error');
      }
    }
  } catch(e) { showToast('Screenshot failed: '+e.message,'error'); }
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
  <script>window.print();<\/script></body></html>`;
  const w=window.open('','_blank'); w.document.write(html); w.document.close();
}

// ── SAVE / RESTORE DRAWING STATE (localStorage) ──────────
function _drawStorageKey() {
  const addr = (document.getElementById('drawSearch')?.value || '').trim();
  return 'nbd_draw_' + (addr ? addr.replace(/\s+/g,'_').substring(0,60) : 'default');
}

function autoSaveDrawing() {
  try {
    const data = {
      address: document.getElementById('drawSearch')?.value || '',
      lines: drawnLines.map(l => ({
        id:l.id, type:l.type, name:l.name, color:l.color, dist:l.dist,
        p1:{lat:l.p1.lat,lng:l.p1.lng}, p2:{lat:l.p2.lat,lng:l.p2.lng},
        subtype:l.subtype||null
      })),
      facets: facets.map(f => ({
        name:f.name, color:f.color, pitch:f.pitch, closed:f.closed, baseArea:f.baseArea,
        points: f.points.map(p=>({lat:p.lat,lng:p.lng}))
      })),
      perimPoints: perimPoints.map(p=>({lat:p.lat,lng:p.lng})),
      perimClosed: perimClosed,
      gutterPoints: gutterPoints.map(p=>({lat:p.lat,lng:p.lng})),
      pitch: document.getElementById('pitchSel')?.value || '1.202',
      waste: document.getElementById('wasteSel')?.value || '1.17',
      ts: Date.now()
    };
    localStorage.setItem(_drawStorageKey(), JSON.stringify(data));
  } catch(e) { /* quota or private browsing — silently fail */ }
}

function tryRestoreDrawing() {
  try {
    const key = _drawStorageKey();
    const raw = localStorage.getItem(key);
    if(!raw) return;
    const data = JSON.parse(raw);
    // Only restore if less than 7 days old
    if(Date.now() - (data.ts||0) > 7*24*60*60*1000) { localStorage.removeItem(key); return; }
    if(!data.lines || !data.lines.length) return;

    // Restore lines
    data.lines.forEach(l => {
      const p1 = L.latLng(l.p1.lat, l.p1.lng);
      const p2 = L.latLng(l.p2.lat, l.p2.lng);
      const lt = LT[l.type] || LT[0];
      const color = l.color || lt.color;
      const line = L.polyline([p1,p2], {color:color, weight:4, opacity:.95, dashArray:lt.dash||null}).addTo(drawMap);
      const lbl = L.marker(mid(p1,p2), {icon:L.divIcon({html:`<div class="meas-label" style="border-color:${color}">${l.dist.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
      lbl.on('click', () => editLineLength(l.id));
      const dot1 = makeDraggableDot(p1, color);
      const dot2 = makeDraggableDot(p2, color);
      drawnLines.push({id:l.id, type:l.type, name:l.name, color:color, dist:l.dist, line, lbl, p1, p2, dot1, dot2, subtype:l.subtype});
      // Track perimeter segments
      if(l.type === 4 || l.type === 5) {
        perimSegments.push({id:l.id, line, lbl, p1, p2, dist:l.dist, type:l.type, name:l.name, color:color, subtype:l.subtype||'eave'});
      }
    });

    // Restore perimeter points
    if(data.perimPoints && data.perimPoints.length) {
      data.perimPoints.forEach(p => {
        const ll = L.latLng(p.lat, p.lng);
        perimPoints.push(ll);
        perimDots.push(makeDraggableDot(ll, '#4A9EFF'));
      });
      perimClosed = !!data.perimClosed;
      if(perimClosed && perimPoints.length >= 3) {
        perimPolygon = L.polygon(perimPoints, {color:'#4A9EFF', fillColor:'#4A9EFF', fillOpacity:.12, weight:0}).addTo(drawMap);
        perimBaseArea = shoelaceArea(perimPoints);
        addAreaLabel(perimPoints, perimBaseArea);
      }
    }

    // Restore facets
    if(data.facets && data.facets.length) {
      data.facets.forEach(fd => {
        const pts = fd.points.map(p => L.latLng(p.lat, p.lng));
        const f = {
          name:fd.name, color:fd.color, pitch:fd.pitch, closed:fd.closed,
          baseArea:fd.baseArea, points:pts, dots:[], segments:[], polygon:null, areaLabel:null
        };
        pts.forEach(p => f.dots.push(makeDraggableDot(p, fd.color)));
        if(fd.closed && pts.length >= 3) {
          f.polygon = L.polygon(pts, {color:fd.color, fillColor:fd.color, fillOpacity:.12, weight:0}).addTo(drawMap);
          addAreaLabel(pts, fd.baseArea);
        }
        facets.push(f);
      });
      activeFacetIdx = facets.length - 1;
    }

    // Restore gutter points
    if(data.gutterPoints && data.gutterPoints.length) {
      data.gutterPoints.forEach(p => {
        const ll = L.latLng(p.lat, p.lng);
        gutterPoints.push(ll);
        gutterDots.push(makeDraggableDot(ll, '#06B6D4'));
      });
    }

    // Restore pitch/waste selectors
    if(data.pitch) { const el = document.getElementById('pitchSel'); if(el) el.value = data.pitch; }
    if(data.waste) { const el = document.getElementById('wasteSel'); if(el) el.value = data.waste; }

    renderLineList(); renderFacetList(); recalc(); recalcGutters();
    showToast('Previous drawing restored','ok');
  } catch(e) { /* corrupted data — ignore */ }
}

function clearSavedDrawing() {
  try { localStorage.removeItem(_drawStorageKey()); } catch(e) {}
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

// All themes/fonts unlocked — single-tier mode (no plan gating)
const _nbdUnlocked  = p => true;
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
// damageNearMePhotos is defined in dashboard.html, not maps.js
if (typeof damageNearMePhotos === 'function') window.damageNearMePhotos = damageNearMePhotos;
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
// Pin popup actions
window.goToLeadFromPin = goToLeadFromPin;
window.deleteLeadFromPin = deleteLeadFromPin;
window.makeLeadFromPin = makeLeadFromPin;
window.deletePinOnly = deletePinOnly;
// Note: damagNearMe is an alias for spyglassGoToLocation
window.damagNearMe = spyglassGoToLocation;
window.goToMyLocation = goToMyLocation;

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


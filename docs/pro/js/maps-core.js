/**
 * maps-core.js — Leaflet init, overlay state, geodetic helpers,
 * shared constants for the maps surface.
 *
 * Extracted from maps.js (Step 4d — 2026-05-16) as one of three
 * sibling modules. Load order is critical and locked in
 * dashboard.html:
 *
 *   core → overlays → routing → maps (shim)
 *
 * This file is loaded FIRST so every later split module + the shim
 * can rely on:
 *   - hav() / mid() — geodetic helpers (window.hav is also a hard
 *     dep of smart-calendar.js — preserved via the shim's window
 *     exports table)
 *   - PIN_LABELS / PIN_COLORS / STAGE_COLORS — pin colour palette
 *   - the module-state vars (mainMap, curPinStatus, curPinColor,
 *     pinMarkers, pinClusterGroup, overlayState, heatLayer,
 *     jobMarkers, weatherLayer, stormTileLayer, pendingPin)
 *   - initMainMap() / toggleOverlay() / heat + pin show/hide
 *
 * Classic-script (non-ESM): every let/const declared at top level
 * here is a sibling-scope global readable by maps-overlays.js,
 * maps-routing.js, and the maps.js shim. Same pattern as
 * dashboard-state.js / crm-leads.js.
 */

// ══════════════════════════════════════════════
// GEODETIC HELPERS
// Haversine distance (returns feet; R is Earth radius in ft)
// and midpoint between two Leaflet latLng-like objects.
// Previously lived in dashboard.html — moved here so maps.js
// is self-contained and works across pages that load it.
// Kept as function declarations (not const) so they hoist
// above all callers below and match the original signatures.
// ══════════════════════════════════════════════
function hav(a, b) {
  const R = 20902231; // Earth radius in feet
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const aa = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}
function mid(a, b) {
  return L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
}
// Expose for any remaining callers still referencing the dashboard globals.
if (typeof window !== 'undefined') { window.hav = hav; window.mid = mid; }

// ══════════════════════════════════════════════
// MAIN MAP
// ══════════════════════════════════════════════
let mainMap, curPinStatus='not-home', curPinColor='#9CA3AF', pinMarkers={}, pinClusterGroup=null;
const PIN_LABELS = {'not-home':'Not Home','interested':'Interested','not-interested':'Not Interested','signed':'⭐ Signed','callback':'Callback','do-not-knock':'Do Not Knock','left-material':'Left Material','follow-up':'Follow Up'};
const PIN_COLORS = {'not-home':'#9CA3AF','interested':'#2ECC8A','not-interested':'#E05252','signed':'#D4A017','callback':'#4A9EFF','do-not-knock':'#374151','left-material':'#9B6DFF','follow-up':'#e8720c'};

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
  // Esri World Imagery — documented, stable endpoint. Native z=19, upscale to 22.
  // Previously used undocumented mt{s}.google.com which returns 403 with no SLA.
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri', maxNativeZoom: 19, maxZoom: 22 }
  ).addTo(mainMap);
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

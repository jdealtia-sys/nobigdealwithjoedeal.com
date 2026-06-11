/**
 * maps-routing.js — drawing-tool surface for the maps module:
 * drawing tool v2 (line / perimeter / E-R / gutter modes),
 * draggable dots, snap, structures / facets / segments,
 * save+load to Firestore, accessories, solar overlay,
 * Xactimate export, comparison mode, shadow / voice /
 * presentation / auto-detect "WOW features".
 *
 * Extracted from maps.js (Step 4d — 2026-05-16) as the
 * drawing-tool sibling of maps-core.js and maps-overlays.js.
 * Load order in dashboard.html is:
 *
 *   core → overlays → routing → maps (shim)
 *
 * Depends on the sibling-scope globals declared in maps-core.js
 * (mainMap, hav, mid, …) and helpers reachable as classic-script
 * globals (showToast, geocode, openLeadModal, goTo, …). No
 * import/export — every let/const declared at top level here is
 * a sibling-scope global readable by the maps.js shim.
 *
 * window.loadDrawingFromCustomer is exported inline below
 * (legacy from the original maps.js); the rest of the public
 * surface is re-stated by the maps.js shim alongside the
 * core / overlays exports.
 */

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

// Multi-structure support
let structures = []; // [{name, facets[], lines[], gutterPts[], gutterDots[], pitch}]
let activeStructureIdx = 0;

// Shadow pitch estimation
let shadowMode = false;
let shadowLine = null; // The shadow line drawn by user
let shadowEdgeLine = null; // The corresponding roof edge

// Voice control
let voiceRecognition = null;
let voiceActive = false;

// Historical imagery
let historyLayerOld = null;
let historySliderActive = false;

// Presentation mode
let presentationActive = false;
let presentationStep = 0;

// Edge auto-detect
let autoDetectActive = false;

// Comparison mode
let comparisonData = null; // Parsed external report data

function initDrawMap() {
  // Guard: if already initialized, just refresh the size
  if (drawMap) { drawMap.invalidateSize(); return; }

  // Ensure the container is visible before Leaflet measures it.
  // In Safari standalone, there can be a paint delay between
  // classList.add('active') and the element actually being visible.
  const container = document.getElementById('drawMap');
  if (!container) { console.error('drawMap container not found'); return; }

  // maxZoom set on the map itself enforces a HARD STOP — Leaflet refuses
  // to zoom past this regardless of user input. Previously the user could
  // zoom to 22 even though no provider had tiles at 20+, which surfaced
  // Esri's "This map is not yet available at this zoom level" placeholder
  // tile. With Google primary + maxZoom 21, every zoom level the user
  // can reach has real imagery.
  drawMap = L.map('drawMap',{preferCanvas:true, maxZoom: 21}).setView([39.07,-84.17],20);

  // Google satellite primary — Brave Shields blocks `server.arcgisonline.com`
  // at the network layer (instant onerror → SW returns synthetic 503 → black
  // tiles). Google's `mt{s}.google.com` is on every tracker-blocker
  // allowlist AND supports higher native zoom (21 universal vs Esri's 19),
  // so the drawing tool gets crisp imagery at the deepest zoom rather than
  // an upscaled blur. Esri stays as a per-tile fallback for the rare case
  // Google rate-limits a tile, but only at z<=19 where Esri actually has
  // imagery — beyond that the failed tile just stays blank rather than
  // showing Esri's "not available" placeholder.
  const GOOGLE_SAT_TILE = 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
  const ESRI_TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const ESRI_FALLBACK = (z, x, y) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  const GOOGLE_ATTR = 'Imagery © Google';

  function attachFallback(layer) {
    layer.on('tileerror', function (ev) {
      if (!ev.tile || !ev.coords) return;
      if (ev.tile.dataset.nbdFallbackTried === '1') return; // give up after one retry
      ev.tile.dataset.nbdFallbackTried = '1';
      // Esri caps at z=19; beyond that the fallback would just surface the
      // "not available" placeholder, so we leave the failed tile blank.
      if (ev.coords.z > 19) return;
      ev.tile.src = ESRI_FALLBACK(ev.coords.z, ev.coords.x, ev.coords.y);
    });
    return layer;
  }

  drawMapLayers.satellite = attachFallback(L.tileLayer(GOOGLE_SAT_TILE, {
    subdomains: '0123', attribution: GOOGLE_ATTR, maxNativeZoom: 21, maxZoom: 21
  }));
  drawMapLayers.street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM',maxNativeZoom:19,maxZoom:21});
  drawMapLayers.hybrid = L.layerGroup([
    attachFallback(L.tileLayer(GOOGLE_SAT_TILE, { subdomains: '0123', maxNativeZoom: 21, maxZoom: 21 })),
    // Place labels overlay still uses Esri Reference; tops out at z=19 and is
    // semi-transparent (opacity:0.75) so missing tiles at z>19 are unnoticeable.
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxNativeZoom: 19, maxZoom: 21, opacity: 0.75 }
    )
  ]);
  drawMapLayers.satellite.addTo(drawMap);
  currentLayerType = 'satellite';

  // Force Leaflet to recalculate container size multiple times.
  // In Safari standalone/web app mode, the container reports
  // zero dimensions during the first few paint frames even though
  // the CSS has been applied. Without these retries, tiles load
  // but appear as grey squares or don't appear at all.
  setTimeout(function() { if(drawMap) drawMap.invalidateSize(); }, 100);
  setTimeout(function() { if(drawMap) drawMap.invalidateSize(); }, 500);
  setTimeout(function() { if(drawMap) drawMap.invalidateSize(); }, 1500);

  // ── Touch support (April 2026) ──
  // Detect touch device and add a Draw/Navigate mode toggle.
  // In Draw mode: map panning is disabled, taps place points.
  // In Navigate mode: normal pan/zoom, no drawing.
  // Two-finger always zooms regardless of mode.
  const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  let drawNavMode = 'draw'; // 'draw' | 'navigate'
  if (isTouchDevice) {
    // Create floating mode toggle button
    const modeBtn = document.createElement('button');
    modeBtn.id = 'drawModeToggle';
    modeBtn.style.cssText = 'position:absolute;top:10px;left:10px;z-index:1000;'
      + 'background:var(--orange,#e8720c);color:#fff;border:none;border-radius:8px;'
      + 'padding:10px 16px;font-family:\'Barlow Condensed\',sans-serif;font-size:13px;'
      + 'font-weight:800;letter-spacing:.04em;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.4);'
      + 'transition:all .15s;-webkit-tap-highlight-color:transparent;min-height:44px;';
    modeBtn.textContent = '✏️ DRAW MODE';
    modeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (drawNavMode === 'draw') {
        drawNavMode = 'navigate';
        modeBtn.textContent = '🗺️ NAVIGATE';
        modeBtn.style.background = 'var(--s2,#181C22)';
        modeBtn.style.border = '1px solid var(--br,#2a2f35)';
        drawMap.dragging.enable();
        drawMap.touchZoom.enable();
      } else {
        drawNavMode = 'draw';
        modeBtn.textContent = '✏️ DRAW MODE';
        modeBtn.style.background = 'var(--orange,#e8720c)';
        modeBtn.style.border = 'none';
        if (drawOn) drawMap.dragging.disable();
      }
    });
    const mapEl = document.getElementById('drawMap');
    if (mapEl) { mapEl.style.position = 'relative'; mapEl.appendChild(modeBtn); }
  }

  drawMap.on('click', e => {
    if(shadowMode) { handleShadowClick(e.latlng); return; }
    // Accessory placement mode takes priority
    if(accessoryMode) { placeAccessory(e.latlng); return; }
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
// Handles both mouse and touch input. Leaflet's `mousedown` event does
// NOT fire on touch-only devices (iOS Safari, iPad), so we also bind
// native `touchstart`/`touchmove`/`touchend` on the rendered SVG path
// element. Two-finger gestures fall through to Leaflet for zoom/pan.
function makeDraggableDot(latlng, color, opts) {
  const dot = L.circleMarker(latlng, {
    radius:6, color:'#fff', fillColor:color, fillOpacity:1, weight:2,
    draggable:true, ...(opts||{})
  }).addTo(drawMap);

  let dragging = false;

  function containerPointToLatLng(clientX, clientY) {
    // Leaflet expects point relative to the map container
    const rect = drawMap.getContainer().getBoundingClientRect();
    return drawMap.containerPointToLatLng([clientX - rect.left, clientY - rect.top]);
  }

  function startDrag() {
    if (drawOn) return false; // Don't drag while actively drawing
    dragging = true;
    drawMap.dragging.disable();
    // Stop touch scrolling on the whole map while a dot is being dragged
    drawMap.getContainer().style.touchAction = 'none';
    return true;
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    drawMap.dragging.enable();
    drawMap.getContainer().style.touchAction = '';
    updateLinesForDot(dot, dot.getLatLng());
    recalc(); recalcGutters(); autoSaveDrawing();
    // Update facet polygons
    facets.forEach((f,fi) => {
      const dotIdx = f.dots.indexOf(dot);
      if(dotIdx >= 0) { f.points[dotIdx] = dot.getLatLng(); rebuildFacetPolygon(fi); }
    });
  }

  // ── Mouse path (desktop) ──
  dot.on('mousedown', e => {
    L.DomEvent.stopPropagation(e);
    if (!startDrag()) return;
    drawMap.on('mousemove', onMouseMove);
    drawMap.on('mouseup', onMouseUp);
  });
  function onMouseMove(e) {
    if (!dragging) return;
    dot.setLatLng(e.latlng);
    updateLinesForDot(dot, e.latlng);
  }
  function onMouseUp() {
    drawMap.off('mousemove', onMouseMove);
    drawMap.off('mouseup', onMouseUp);
    endDrag();
  }

  // ── Touch path (iOS/Android) ──
  // Bind on the underlying SVG path element once Leaflet has rendered it.
  // Retry in a microtask because the path isn't in the DOM until addTo().
  function bindTouch() {
    const el = dot._path || dot.getElement?.();
    if (!el) { setTimeout(bindTouch, 30); return; }
    el.style.touchAction = 'none'; // Prevent browser gesture on the dot itself

    el.addEventListener('touchstart', onTouchStart, { passive: false });

    function onTouchStart(ev) {
      if (ev.touches.length !== 1) return; // Ignore pinch/multi-touch
      ev.preventDefault();
      ev.stopPropagation();
      if (!startDrag()) return;
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', onTouchEnd);
    }
    function onTouchMove(ev) {
      if (!dragging) return;
      if (ev.touches.length !== 1) return;
      ev.preventDefault();
      const t = ev.touches[0];
      const newLatLng = containerPointToLatLng(t.clientX, t.clientY);
      dot.setLatLng(newLatLng);
      updateLinesForDot(dot, newLatLng);
    }
    function onTouchEnd() {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
      endDrag();
    }
  }
  bindTouch();

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
    // On touch devices in Draw mode, disable map dragging so
    // taps register as drawing points instead of panning.
    if (typeof drawNavMode !== 'undefined' && drawNavMode === 'draw') {
      drawMap.dragging.disable();
    }
  } else {
    btn.textContent = '▶ Draw'; btn.className = 'draw-btn go';
    drawMap.getContainer().style.cursor = '';
    drawStart = null; clearTemp();
    // Re-enable dragging when drawing stops
    drawMap.dragging.enable();
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
  // ── Click line on map → type picker popup (April 2026) ──
  line.on('click', function(e) {
    L.DomEvent.stopPropagation(e);
    if (drawOn) return; // don't open picker while actively drawing
    openLineTypePicker(id, e.latlng);
  });
  clearTemp(); renderLineList(); recalc(); autoSaveDrawing();
  return id;
}

// ── LINE TYPE PICKER POPUP ──
// Shows a popup with common 6 types + "More" expand when user
// clicks a drawn line on the map. Replaces the old workflow of
// selecting a line in the sidebar then changing the type dropdown.
function openLineTypePicker(lineId, latlng) {
  const COMMON = [5, 4, 0, 2, 3, 10]; // Eave, Rake, Ridge, Hip, Valley, Gutters
  const EXTRA = [1, 6, 7, 8, 9];       // Ridge Vent, Flashing, Step Flash, Drip Edge, Parapet

  const makeBtn = (idx) => {
    const lt = LT[idx];
    return '<button style="background:' + lt.color + '20;border:2px solid ' + lt.color + ';color:' + lt.color + ';'
      + 'padding:6px 10px;border-radius:5px;cursor:pointer;font-family:\'Barlow Condensed\',sans-serif;'
      + 'font-size:11px;font-weight:700;letter-spacing:.03em;white-space:nowrap;'
      + 'transition:all .12s;min-height:32px;" '
      + 'data-mr-action="retypeLine" data-mr-id="' + lineId + '" data-mr-arg2="' + idx + '" '
      + 'onmouseenter="this.style.background=\'' + lt.color + '\';this.style.color=\'#fff\';" '
      + 'onmouseleave="this.style.background=\'' + lt.color + '20\';this.style.color=\'' + lt.color + '\';"'
      + '>' + lt.n + '</button>';
  };

  const commonBtns = COMMON.map(makeBtn).join('');
  const extraBtns = EXTRA.map(makeBtn).join('');

  const html = '<div style="min-width:200px;">'
    + '<div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#e8720c;margin-bottom:6px;">Change Line Type</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">' + commonBtns + '</div>'
    + '<details style="margin-top:4px;"><summary style="font-size:10px;color:#888;cursor:pointer;user-select:none;">More types \u25bc</summary>'
    + '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">' + extraBtns + '</div></details>'
    + '<div style="margin-top:8px;display:flex;gap:4px;">'
    + '<button data-mr-action="deleteLine" data-mr-id="' + lineId + '" style="flex:1;background:#E0525220;border:1px solid #E05252;color:#E05252;padding:5px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:600;">Delete</button>'
    + '<button data-mr-action="editLineLength" data-mr-id="' + lineId + '" style="flex:1;background:transparent;border:1px solid #888;color:#888;padding:5px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:600;">Edit Length</button>'
    + '</div></div>';

  L.popup({ closeButton: true, className: 'nbd-line-picker-popup' })
    .setLatLng(latlng)
    .setContent(html)
    .openOn(drawMap);
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
  const rc = document.getElementById('reChooser');
  const pb = document.getElementById('perimBar');
  if (rc) rc.classList.add('visible');
  if (pb) pb.classList.remove('visible');
}
function hideReChooser() {
  const rc = document.getElementById('reChooser');
  const pb = document.getElementById('perimBar');
  if (rc) rc.classList.remove('visible');
  if (drawMode==='perim' && pb) pb.classList.add('visible');
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
  const totalEl = document.getElementById('gr-total');
  const dsEl    = document.getElementById('gr-ds');
  if (totalEl) totalEl.textContent = total.toFixed(1) + ' ft';
  if (dsEl)    dsEl.textContent = ds;
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

async function clearDraw() {
  // Batch 2 (iOS PWA): native confirm() always returns true in PWA
  // standalone mode (see standalone-compat.js) — destructive guards
  // get bypassed. nbdConfirm returns a real Promise<boolean> via a
  // modal in PWA mode, falls back to native confirm on desktop.
  const _ask = window.nbdConfirm || ((m) => Promise.resolve(window.confirm(m)));
  if (!(await _ask('Clear all lines and facets?'))) return;
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
  const pb = document.getElementById('perimBar');
  if (pb) pb.textContent = '⬡ Perimeter mode — click map to trace. Click first dot to close.';
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
    el.onclick = null;
    el.onchange = null;
    return;
  }
  // Per-type aggregates (count + total feet), preserving LT order
  const totals = LT.map(() => ({count:0, len:0}));
  drawnLines.forEach(l => {
    if (totals[l.type]) { totals[l.type].count++; totals[l.type].len += l.dist; }
  });
  const chips = totals.map((t, idx) => {
    if (!t.count) return '';
    const lt = LT[idx];
    return `<span class="line-total-chip" title="${lt.n}: ${t.count} line${t.count===1?'':'s'}, ${t.len.toFixed(1)} ft total">
      <span class="lt-dot" style="background:${lt.color};${idx===4?'border:1px dashed #fff;':''}"></span>
      <span class="line-total-chip-name">${lt.n}</span>
      <span class="line-total-chip-meta">×${t.count}</span>
      <span class="line-total-chip-len">${t.len.toFixed(1)} ft</span>
    </span>`;
  }).join('');
  // Per-type ordinal (#N) numbering as we iterate drawnLines in original order
  const ridx = {};
  const ltOpts = LT.map((lt, i) => `<option value="${i}">${lt.n}</option>`).join('');
  const rows = drawnLines.map(l => {
    ridx[l.type] = (ridx[l.type] || 0) + 1;
    const isSel = l.id === selectedLineId;
    return `<div class="line-item ${isSel ? 'selected' : ''}" data-action="selectLine" data-line-id="${l.id}">
      <div class="lt-dot" style="background:${l.color};${l.type===4?'border:1px dashed #fff;':''}"></div>
      <span class="line-lbl">${l.name}<span class="line-num"> #${ridx[l.type]}</span></span>
      <span class="line-len">${l.dist.toFixed(1)} ft</span>
      ${isSel
        ? `<select class="line-type-sel" data-action="retypeLine" data-line-id="${l.id}">${ltOpts}</select>`
        : `<button class="line-del" data-action="deleteLine" data-line-id="${l.id}" aria-label="Delete line">✕</button>`}
    </div>`;
  }).join('');
  el.innerHTML = (chips ? `<div class="line-totals">${chips}</div>` : '') + rows;
  if(selectedLineId !== null) {
    const sel = el.querySelector('.line-type-sel');
    if(sel) { const l = drawnLines.find(x => x.id === selectedLineId); if(l) sel.value = l.type; }
  }
  // CSP-safe delegated handlers via DOM-property assignment (NOT inline onclick=
  // attribute, which is blocked by the prod CSP `script-src-attr 'none'`).
  el.onclick = function(ev) {
    const target = ev.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = parseInt(target.dataset.lineId, 10);
    if (action === 'deleteLine')      { ev.stopPropagation(); deleteLine(id); }
    else if (action === 'selectLine') { selectLine(id); }
    else if (action === 'retypeLine') { ev.stopPropagation(); /* change-handler does the work */ }
  };
  el.onchange = function(ev) {
    const target = ev.target.closest('[data-action="retypeLine"]');
    if (!target) return;
    retypeLine(parseInt(target.dataset.lineId, 10), parseInt(target.value, 10));
  };
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
  // Draw-tool readout — only present when #view-draw is in DOM. Guard
  // each one so a partial-view render doesn't blow up the calc loop.
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTxt('cr-base',    base.toFixed(0) + ' sf');
  setTxt('cr-pitched', pitched.toFixed(0) + ' sf');
  setTxt('cr-waste',   w.toFixed(0) + ' sf');
  setTxt('cr-sq',      sq.toFixed(2) + ' sq');
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
  // Collect all measurements from the drawing tool.
  //
  // IMPORTANT: the estimate builders expect `rawSqft` = actual roof surface
  // area with pitch ALREADY APPLIED (see estimate-logic-engine.js:43 comment
  // — "'rawSqft', // Actual roof area (pitch applied)"). The drawing tool's
  // `cr-pitched` readout is that value; `cr-base` is the unpitched footprint
  // and was the historical import source — sending it meant every estimate
  // was under-counted by the pitch factor (12–41% depending on pitch).
  const addr = document.getElementById('drawSearch').value || '';
  const pitchedSqft = parseFloat(document.getElementById('cr-pitched').textContent) || 0;
  const baseSqft = parseFloat(document.getElementById('cr-base').textContent) || 0;
  // Line types: 0=ridge, 1=valley, 2=hip, 3=rake, 4=wall, 5=eave
  const ridgeLf = Math.round(drawnLines.filter(l => l.type === 0).reduce((s, l) => s + l.dist, 0));
  const eaveLf = Math.round(drawnLines.filter(l => l.type === 5).reduce((s, l) => s + l.dist, 0));
  const hipLf = Math.round(drawnLines.filter(l => l.type === 2).reduce((s, l) => s + l.dist, 0));
  const valleyLf = Math.round(drawnLines.filter(l => l.type === 1).reduce((s, l) => s + l.dist, 0));
  const rakeLf = Math.round(drawnLines.filter(l => l.type === 3).reduce((s, l) => s + l.dist, 0));
  const wallLf = Math.round(drawnLines.filter(l => l.type === 4).reduce((s, l) => s + l.dist, 0));

  // The global pitch selector value is "<multiplier>" (e.g. "1.202" for 8/12).
  // Multi-facet drawings already compose per-facet pitch into `cr-pitched`,
  // so we just need a representative pitch rise to pass through for rules
  // like pitch-surcharge pricing.
  const globalPitchMult = parseFloat(document.getElementById('pitchSel')?.value || 1.202) || 1.202;
  // Invert sqrt(1 + (rise/12)^2) to recover rise from multiplier
  const pitchRise = Math.round(12 * Math.sqrt(Math.max(0, globalPitchMult * globalPitchMult - 1))) || 8;

  // Ask which builder to use
  const useV2 = window.openEstimateV2Builder && confirm(
    'Open V2 Builder (line-item mode) with these measurements?\n\n'
    + 'Pitched area: ' + Math.round(pitchedSqft) + ' SF '
    + '(footprint ' + Math.round(baseSqft) + ' SF × pitch)\n'
    + 'Eave: ' + eaveLf + ' LF · Ridge: ' + ridgeLf + ' LF\n'
    + 'Rake: ' + rakeLf + ' LF · Hip: ' + hipLf + ' LF\n'
    + 'Valley: ' + valleyLf + ' LF · Wall: ' + wallLf + ' LF\n\n'
    + 'Click OK for V2 Builder, Cancel for Classic Builder.'
  );

  if (useV2) {
    // V2 Builder: rawSqft is pitched area (logic engine only applies waste).
    // Measurements ride through open(opts) instead of a setTimeout DOM poke:
    // the builder may still be lazy-loading (openEstimateV2Builder can be the
    // load-then-run stub, which forwards arguments) and open() restores any
    // nbd_v2_draft_v1 draft asynchronously — a fixed 300ms timer lost both
    // races, so the import silently no-opd or was overridden by the stale
    // draft while the success toast still fired (NEW-D39, d8 sweep). The
    // builder now applies these AFTER draft restore and owns the toast.
    window.openEstimateV2Builder({
      importMeasurements: {
        rawSqft: Math.round(pitchedSqft),
        pitch: pitchRise,
        eaveLf, ridgeLf, rakeLf, hipLf, valleyLf, wallLf
      }
    });
  } else {
    // Classic builder: `updateEstCalc` does raw × pitch × waste. The drawing
    // tool already baked pitch (and per-facet pitch on multi-facet drawings)
    // into cr-pitched, so we pass pitched area AND pin the classic pitch
    // selector to Flat (1.000×) so it isn't multiplied a second time.
    goTo('est');
    startNewEstimate();
    setTimeout(() => {
      document.getElementById('estAddr').value = addr;
      document.getElementById('estRawSqft').value = Math.round(pitchedSqft);
      const pitchSelEl = document.getElementById('estPitch');
      if (pitchSelEl) pitchSelEl.value = '1.0|Flat';
      document.getElementById('estRidge').value = ridgeLf;
      document.getElementById('estEave').value = eaveLf;
      document.getElementById('estHip').value = hipLf;
      const noteEl = document.getElementById('drawImportNote');
      if (noteEl) {
        noteEl.style.display = 'block';
        noteEl.textContent = 'Pitched area imported from drawing tool. Pitch set to Flat so your '
          + pitchRise + '/12 drawing pitch is not applied twice.';
      }
      updateEstCalc();
    }, 100);
  }
}

async function searchDraw() {
  const q=document.getElementById('drawSearch').value.trim(); if(!q)return;
  const d=await geocode(q); if(!d)return;
  drawMap.setView([d.lat,d.lon],19);
}

// ═══════════════════════════════════════════════════════════
// SAVE DRAWING TO CUSTOMER (Firestore)
// Saves the full drawing state as GeoJSON + metadata to
// leads/{leadId}/drawings/{drawingId}. Includes version history.
// ═══════════════════════════════════════════════════════════
async function saveDrawingToCustomer() {
  const addr = (document.getElementById('drawSearch')?.value || '').trim();
  if (!addr) {
    showToast('Enter an address first so we can match to a customer', 'error');
    return;
  }
  if (!window._user?.uid || !window._db) {
    showToast('Not signed in — cannot save', 'error');
    return;
  }
  if (!drawnLines.length && !facets.length) {
    showToast('Nothing to save — draw some lines first', 'error');
    return;
  }

  // Find matching lead by address
  const leads = window._leads || [];
  const addrNorm = addr.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matched = leads.find(l => {
    const lNorm = String(l.address || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return lNorm && addrNorm && (lNorm.includes(addrNorm.substring(0, 12)) || addrNorm.includes(lNorm.substring(0, 12)));
  });

  let leadId = matched?.id;
  if (!leadId) {
    // No match — ask if they want to create a new lead
    // Batch 2 (iOS PWA): nbdConfirm gates the unlinked-save fallback.
    const _ask = window.nbdConfirm || ((m) => Promise.resolve(window.confirm(m)));
    if (!(await _ask('No customer found for "' + addr + '". Save as an unlinked drawing?\n\n(You can link it to a customer later.)'))) return;
    leadId = '_unlinked_' + window._user.uid;
  }

  // Build the drawing data (GeoJSON + metadata)
  const drawingData = {
    address: addr,
    measurements: {
      totalAreaSF: parseFloat(document.getElementById('cr-base')?.textContent) || 0,
      pitchedAreaSF: parseFloat(document.getElementById('cr-pitched')?.textContent) || 0,
      withWasteSF: parseFloat(document.getElementById('cr-waste')?.textContent) || 0,
      squares: parseFloat(document.getElementById('cr-sq')?.textContent) || 0,
      ridgeLF: drawnLines.filter(l => l.type === 0).reduce((s, l) => s + l.dist, 0),
      eaveLF: drawnLines.filter(l => l.type === 5).reduce((s, l) => s + l.dist, 0),
      rakeLF: drawnLines.filter(l => l.type === 4).reduce((s, l) => s + l.dist, 0),
      hipLF: drawnLines.filter(l => l.type === 2).reduce((s, l) => s + l.dist, 0),
      valleyLF: drawnLines.filter(l => l.type === 3).reduce((s, l) => s + l.dist, 0)
    },
    lines: drawnLines.map(l => ({
      type: l.type, name: l.name, dist: l.dist,
      p1: { lat: l.p1.lat, lng: l.p1.lng },
      p2: { lat: l.p2.lat, lng: l.p2.lng }
    })),
    facets: facets.map(f => ({
      name: f.name, pitch: f.pitch, closed: f.closed, baseArea: f.baseArea,
      points: f.points.map(p => ({ lat: p.lat, lng: p.lng }))
    })),
    pitch: document.getElementById('pitchSel')?.value || '1.202',
    waste: document.getElementById('wasteSel')?.value || '1.17',
    userId: window._user.uid,
    leadId: leadId,
    version: 1,
    createdAt: window.serverTimestamp(),
    updatedAt: window.serverTimestamp()
  };

  try {
    // Check for existing drawings to increment version
    if (leadId && !leadId.startsWith('_unlinked_')) {
      const existing = await window.getDocs(window.collection(window._db, 'leads', leadId, 'drawings'));
      drawingData.version = existing.size + 1;
    }

    const collPath = leadId.startsWith('_unlinked_')
      ? window.collection(window._db, 'drawings')
      : window.collection(window._db, 'leads', leadId, 'drawings');

    await window.addDoc(collPath, drawingData);
    showToast('Drawing saved' + (matched ? ' to ' + (matched.firstName || matched.address || 'customer') : ' (unlinked)') + ' — v' + drawingData.version, 'success');
  } catch (e) {
    console.error('Save drawing failed:', e);
    showToast('Save failed: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// LOAD DRAWING FROM CUSTOMER
// Inverse of saveDrawingToCustomer. Matches by address → pulls
// the most recent drawing from leads/{leadId}/drawings (or the
// unlinked collection) and rehydrates facets/lines onto the map.
// Safe to call without a current drawing — will replace whatever
// is on screen after confirmation if the canvas is non-empty.
// ═══════════════════════════════════════════════════════════
async function loadDrawingFromCustomer() {
  const addr = (document.getElementById('drawSearch')?.value || '').trim();
  if (!addr) {
    showToast('Enter an address first so we can find the customer', 'error');
    return;
  }
  if (!window._user?.uid || !window._db) {
    showToast('Not signed in — cannot load', 'error');
    return;
  }

  // Find matching lead (same logic as save)
  const leads = window._leads || [];
  const addrNorm = addr.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matched = leads.find(l => {
    const lNorm = String(l.address || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return lNorm && addrNorm && (lNorm.includes(addrNorm.substring(0, 12)) || addrNorm.includes(lNorm.substring(0, 12)));
  });

  const leadId = matched?.id || ('_unlinked_' + window._user.uid);
  const isUnlinked = leadId.startsWith('_unlinked_');

  try {
    // Query the appropriate collection, ordered by version desc, limit 1
    const collPath = isUnlinked
      ? window.collection(window._db, 'drawings')
      : window.collection(window._db, 'leads', leadId, 'drawings');

    // For unlinked, we filter to this user; linked is scoped to the lead.
    const q = isUnlinked
      ? window.query(collPath, window.where('userId', '==', window._user.uid), window.orderBy('version', 'desc'), window.limit(1))
      : window.query(collPath, window.orderBy('version', 'desc'), window.limit(1));

    const snap = await window.getDocs(q);
    if (snap.empty) {
      showToast('No saved drawings found for this address', 'info');
      return;
    }

    const data = snap.docs[0].data() || {};

    // Confirm replacement if canvas has work
    // Batch 2 (iOS PWA): nbdConfirm gates the destructive overwrite.
    if ((drawnLines && drawnLines.length) || (facets && facets.length)) {
      const _ask = window.nbdConfirm || ((m) => Promise.resolve(window.confirm(m)));
      if (!(await _ask('Replace the current drawing with v' + (data.version || '?') + ' from ' + (matched?.firstName || matched?.address || 'customer') + '?'))) return;
    }

    // Clear current state
    if (typeof clearAll === 'function') {
      clearAll();
    } else {
      // Fallback: manual reset
      drawnLines = [];
      facets = [];
    }

    // Restore pitch/waste selectors
    const pitchSel = document.getElementById('pitchSel');
    if (pitchSel && data.pitch) pitchSel.value = String(data.pitch);
    const wasteSel = document.getElementById('wasteSel');
    if (wasteSel && data.waste) wasteSel.value = String(data.waste);

    // Rehydrate lines
    (data.lines || []).forEach(l => {
      try {
        drawnLines.push({
          type: l.type, name: l.name, dist: l.dist,
          p1: L.latLng(l.p1.lat, l.p1.lng),
          p2: L.latLng(l.p2.lat, l.p2.lng)
        });
      } catch (err) { /* skip malformed line */ }
    });

    // Rehydrate facets
    (data.facets || []).forEach(f => {
      try {
        facets.push({
          name: f.name, pitch: f.pitch, closed: !!f.closed, baseArea: f.baseArea,
          points: (f.points || []).map(p => L.latLng(p.lat, p.lng))
        });
      } catch (err) { /* skip malformed facet */ }
    });

    // Redraw + recompute
    if (typeof redrawAll === 'function') redrawAll();
    if (typeof recalc === 'function') recalc();

    // Center map on drawing bounds if possible
    try {
      const allPts = [];
      drawnLines.forEach(l => { allPts.push(l.p1, l.p2); });
      facets.forEach(f => { (f.points || []).forEach(p => allPts.push(p)); });
      if (allPts.length && drawMap) {
        const bounds = L.latLngBounds(allPts);
        drawMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 21 });
      }
    } catch (err) { /* bounds best-effort */ }

    showToast('Loaded v' + (data.version || '?') + (matched ? ' from ' + (matched.firstName || matched.address || 'customer') : ' (unlinked)'), 'success');
  } catch (e) {
    console.error('Load drawing failed:', e);
    showToast('Load failed: ' + e.message, 'error');
  }
}

// Expose for inline button onclick in dashboard.html
if (typeof window !== 'undefined') {
  window.loadDrawingFromCustomer = loadDrawingFromCustomer;
}

// ═══════════════════════════════════════════════════════════
// ROOF ACCESSORIES (pipes, skylights, chimneys, vents, etc.)
// Click-to-place icons on the map + count form in sidebar.
// Counts auto-populate in estimates.
// ═══════════════════════════════════════════════════════════
const ACCESSORIES = [
  { id: 'pipe',      icon: '🔵', label: 'Pipe Boot',       color: '#4A9EFF' },
  { id: 'skylight',  icon: '🟦', label: 'Skylight',        color: '#38BDF8' },
  { id: 'chimney',   icon: '🟫', label: 'Chimney',         color: '#92400E' },
  { id: 'vent',      icon: '⬜', label: 'Roof Vent',       color: '#6B7280' },
  { id: 'satellite',  icon: '📡', label: 'Satellite Dish',  color: '#9B6DFF' },
  { id: 'turbine',   icon: '🌀', label: 'Turbine Vent',    color: '#14B8A6' }
];
let placedAccessories = []; // { id, type, latlng, marker }
let accessoryMode = null; // null = not placing, or accessory type id

function toggleAccessoryMode(typeId) {
  if (accessoryMode === typeId) {
    // Turn off
    accessoryMode = null;
    drawMap.getContainer().style.cursor = '';
    showToast('Accessory placement off', 'info');
  } else {
    accessoryMode = typeId;
    const acc = ACCESSORIES.find(a => a.id === typeId);
    drawMap.getContainer().style.cursor = 'crosshair';
    showToast('Click the roof to place: ' + (acc?.label || typeId), 'info');
  }
  renderAccessoryPanel();
}

function placeAccessory(latlng) {
  if (!accessoryMode) return false;
  const acc = ACCESSORIES.find(a => a.id === accessoryMode);
  if (!acc) return false;

  const icon = L.divIcon({
    html: '<div style="background:' + acc.color + '20;border:2px solid ' + acc.color + ';width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,.3);">' + acc.icon + '</div>',
    iconSize: [28, 28],
    className: ''
  });

  const marker = L.marker(latlng, { icon, draggable: true }).addTo(drawMap);
  const id = Date.now() + Math.random();
  placedAccessories.push({ id, type: accessoryMode, latlng, marker });

  // Click to remove
  // Batch 2 (iOS PWA): nbdConfirm gates the destructive remove via a
  // real modal in standalone mode. Native confirm falls through on desktop.
  marker.on('click', async function() {
    const _ask = window.nbdConfirm || ((m) => Promise.resolve(window.confirm(m)));
    if (await _ask('Remove this ' + acc.label + '?')) {
      drawMap.removeLayer(marker);
      placedAccessories = placedAccessories.filter(a => a.id !== id);
      renderAccessoryPanel();
      autoSaveDrawing();
    }
  });

  renderAccessoryPanel();
  autoSaveDrawing();
  return true;
}

function getAccessoryCounts() {
  const counts = {};
  ACCESSORIES.forEach(a => { counts[a.id] = 0; });
  placedAccessories.forEach(a => { counts[a.type] = (counts[a.type] || 0) + 1; });
  return counts;
}

function renderAccessoryPanel() {
  const panel = document.getElementById('accessoryPanel');
  if (!panel) return;
  const counts = getAccessoryCounts();
  panel.innerHTML = ACCESSORIES.map(a => {
    const isActive = accessoryMode === a.id;
    const count = counts[a.id] || 0;
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;">'
      + '<button data-mr-action="toggleAccessoryMode" data-mr-id="' + a.id + '" style="background:' + (isActive ? a.color + '20' : 'transparent') + ';border:1px solid ' + (isActive ? a.color : 'var(--br,#2a2f35)') + ';color:' + (isActive ? a.color : 'var(--m,#888)') + ';padding:5px 10px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:600;flex:1;text-align:left;font-family:\'Barlow Condensed\',sans-serif;letter-spacing:.03em;transition:all .15s;">'
      + a.icon + ' ' + a.label + '</button>'
      + '<span style="font-family:\'Barlow Condensed\',sans-serif;font-size:16px;font-weight:800;color:' + (count > 0 ? 'var(--t,#fff)' : 'var(--m,#888)') + ';min-width:24px;text-align:center;">' + count + '</span>'
      + '</div>';
  }).join('');
}

// Hook into map click — place accessory if in accessory mode
// (called from the main drawMap.on('click') handler)

// ── Generate Scope of Work from Drawing ──
// Customer-facing document showing what work will be performed,
// derived from the drawing measurements. Different from the
// measurement report (which is technical/internal).
// ═══════════════════════════════════════════════════════════
// GOOGLE SOLAR API INTEGRATION
// Shows sun exposure heatmap overlay on the drawing. Uses
// Google Solar API ($0.05/lookup) if a key is configured,
// otherwise shows a static sun path estimate based on lat/lng.
// ═══════════════════════════════════════════════════════════
async function runSolarAnalysis() {
  const center = drawMap ? drawMap.getCenter() : null;
  if (!center) { showToast('Open the drawing tool first', 'error'); return; }

  const addr = document.getElementById('drawSearch')?.value || '';
  showToast('Running solar analysis...', 'info');

  // Check for Google Solar API key in localStorage
  const apiKey = localStorage.getItem('nbd_google_solar_key') || '';

  if (apiKey) {
    // Real Google Solar API call
    try {
      const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${center.lat}&location.longitude=${center.lng}&requiredQuality=HIGH&key=${apiKey}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('API returned ' + response.status);
      const data = await response.json();

      // Render solar data overlay
      renderSolarOverlay(data);
      showToast('Solar analysis complete — ' + (data.solarPotential?.maxSunshineHoursPerYear || 0).toFixed(0) + ' hours/year max sun', 'success');
    } catch (e) {
      console.error('Solar API failed:', e);
      showToast('Solar API error: ' + e.message + '. Showing estimate instead.', 'warning');
      renderSolarEstimate(center.lat);
    }
  } else {
    // No API key — show estimated sun path
    renderSolarEstimate(center.lat);
    showToast('Solar estimate shown. Add Google Solar API key in Settings for precise data.', 'info');
  }
}

function renderSolarOverlay(data) {
  // Remove previous overlay
  if (window._solarOverlay) { drawMap.removeLayer(window._solarOverlay); }

  const sp = data.solarPotential;
  if (!sp || !sp.roofSegmentStats) return;

  const group = L.layerGroup();

  // Draw roof segments colored by sun exposure
  sp.roofSegmentStats.forEach((seg, i) => {
    const hours = seg.stats?.sunshineQuantiles?.[5] || 0; // median sunshine
    const maxHours = sp.maxSunshineHoursPerYear || 1500;
    const ratio = Math.min(1, hours / maxHours);
    // Red = most sun, blue = least sun
    const r = Math.round(255 * ratio);
    const b = Math.round(255 * (1 - ratio));
    const color = `rgb(${r},${Math.round(100 * ratio)},${b})`;

    if (seg.center) {
      L.circle([seg.center.latitude, seg.center.longitude], {
        radius: Math.sqrt(seg.stats?.areaMeters2 || 50) * 2,
        color: color,
        fillColor: color,
        fillOpacity: 0.4,
        weight: 1
      }).bindPopup(`<b>Segment ${i + 1}</b><br>${hours.toFixed(0)} hrs/yr sunshine<br>${(seg.stats?.areaMeters2 * 10.764 || 0).toFixed(0)} SF`).addTo(group);
    }
  });

  // Summary label
  const center = drawMap.getCenter();
  L.marker(center, {
    icon: L.divIcon({
      html: `<div style="background:rgba(234,179,8,.9);color:#000;padding:6px 12px;border-radius:6px;font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.4);">☀️ ${sp.maxSunshineHoursPerYear?.toFixed(0) || '—'} hrs/yr max · ${sp.roofSegmentStats?.length || 0} segments</div>`,
      className: '', iconAnchor: [0, 0]
    })
  }).addTo(group);

  group.addTo(drawMap);
  window._solarOverlay = group;
}

function renderSolarEstimate(lat) {
  // Simple estimate based on latitude — no API call
  // US average: 1000-2500 kWh/kW/yr depending on location
  if (window._solarOverlay) { drawMap.removeLayer(window._solarOverlay); }

  const absLat = Math.abs(lat);
  const sunHours = Math.round(2500 - (absLat - 25) * 30); // rough estimate
  const center = drawMap.getCenter();

  const group = L.layerGroup();

  // Orange-to-red gradient circle showing general sun exposure
  L.circle(center, {
    radius: 80,
    color: '#EAB308',
    fillColor: '#EAB308',
    fillOpacity: 0.15,
    weight: 2,
    dashArray: '6,4'
  }).addTo(group);

  // Sun path arc (simplified)
  const arcPoints = [];
  for (let angle = -80; angle <= 80; angle += 10) {
    const rad = angle * Math.PI / 180;
    arcPoints.push([
      center.lat + Math.cos(rad) * 0.0008,
      center.lng + Math.sin(rad) * 0.001
    ]);
  }
  L.polyline(arcPoints, { color: '#EAB308', weight: 2, dashArray: '4,4', opacity: 0.6 }).addTo(group);

  L.marker(center, {
    icon: L.divIcon({
      html: `<div style="background:rgba(234,179,8,.9);color:#000;padding:6px 12px;border-radius:6px;font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.4);">☀️ Est. ${sunHours} hrs/yr · Lat ${lat.toFixed(1)}° · <span style="font-size:10px;font-weight:400;">Add API key for precise data</span></div>`,
      className: '', iconAnchor: [0, 0]
    })
  }).addTo(group);

  group.addTo(drawMap);
  window._solarOverlay = group;
}

function generateScopeFromDrawing() {
  const addr = document.getElementById('drawSearch')?.value || 'Property Address';
  const area = document.getElementById('cr-base')?.textContent || '0 sf';
  const pitched = document.getElementById('cr-pitched')?.textContent || '0 sf';
  const sq = document.getElementById('cr-sq')?.textContent || '0 sq';
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const ridgeLF = drawnLines.filter(l => l.type === 0).reduce((s, l) => s + l.dist, 0).toFixed(1);
  const eaveLF = drawnLines.filter(l => l.type === 5).reduce((s, l) => s + l.dist, 0).toFixed(1);
  const rakeLF = drawnLines.filter(l => l.type === 4).reduce((s, l) => s + l.dist, 0).toFixed(1);
  const hipLF = drawnLines.filter(l => l.type === 2).reduce((s, l) => s + l.dist, 0).toFixed(1);
  const valleyLF = drawnLines.filter(l => l.type === 3).reduce((s, l) => s + l.dist, 0).toFixed(1);
  const counts = typeof getAccessoryCounts === 'function' ? getAccessoryCounts() : {};

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Scope of Work — ${addr}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Barlow',sans-serif;padding:36px;max-width:860px;margin:0 auto;}
.hdr{display:flex;justify-content:space-between;padding-bottom:18px;border-bottom:3px solid #e8720c;margin-bottom:24px;}
.brand{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;text-transform:uppercase;}.brand span{color:#e8720c;}
.badge{font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#e8720c;border:1px solid #e8720c;padding:2px 9px;border-radius:2px;display:inline-block;margin-top:5px;}
h2{font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#e8720c;margin:22px 0 10px;border-bottom:1px solid #eee;padding-bottom:4px;}
.scope-item{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px;}
.scope-check{color:#22c55e;font-weight:800;font-size:16px;flex-shrink:0;margin-top:1px;}
.scope-text{flex:1;line-height:1.5;}
.scope-qty{font-family:'Barlow Condensed',sans-serif;font-weight:700;color:#1e3a6e;min-width:80px;text-align:right;}
.meas-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;}
.meas-card{background:#f8f8f8;border:1px solid #eee;border-radius:6px;padding:12px;text-align:center;}
.meas-val{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:700;color:#e8720c;}
.meas-lbl{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.05em;margin-top:3px;}
.sig{margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:40px;}.sig-line{border-top:1px solid #333;padding-top:6px;font-size:11px;color:#666;margin-top:50px;}
.foot{margin-top:30px;font-size:10px;color:#999;display:flex;justify-content:space-between;}
@media print{body{padding:20px;}@page{margin:1.5cm;size:letter;}}</style></head><body>
<div class="hdr"><div><div class="brand">No Big Deal <span>Home Solutions</span></div><div class="badge">Scope of Work</div></div>
<div style="text-align:right;"><div style="font-size:14px;font-weight:600;">${addr}</div><div style="font-size:11px;color:#666;">${date}</div></div></div>

<h2>Project Measurements</h2>
<div class="meas-grid">
  <div class="meas-card"><div class="meas-val">${area}</div><div class="meas-lbl">Roof Area</div></div>
  <div class="meas-card"><div class="meas-val">${pitched}</div><div class="meas-lbl">Pitched Area</div></div>
  <div class="meas-card"><div class="meas-val">${sq}</div><div class="meas-lbl">Squares</div></div>
</div>

<h2>Scope of Work</h2>
<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Remove existing roof covering (tear-off 1 layer)</span><span class="scope-qty">${sq}</span></div>
<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Install synthetic underlayment over entire deck</span><span class="scope-qty">${sq}</span></div>
<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Install ice & water shield at eaves and valleys</span><span class="scope-qty">${eaveLF} LF + ${valleyLF} LF</span></div>
<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Install architectural shingles (GAF Timberline series)</span><span class="scope-qty">${sq}</span></div>
<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Install starter strip at eaves</span><span class="scope-qty">${eaveLF} LF</span></div>
<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Install drip edge at eaves and rakes</span><span class="scope-qty">${(parseFloat(eaveLF) + parseFloat(rakeLF)).toFixed(0)} LF</span></div>
<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Install ridge cap shingles</span><span class="scope-qty">${ridgeLF} LF</span></div>
${parseFloat(hipLF) > 0 ? '<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Install hip cap shingles</span><span class="scope-qty">' + hipLF + ' LF</span></div>' : ''}
${parseFloat(valleyLF) > 0 ? '<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Install valley flashing / weave</span><span class="scope-qty">' + valleyLF + ' LF</span></div>' : ''}
${(counts.pipe || 0) > 0 ? '<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Replace pipe boot flashings</span><span class="scope-qty">' + counts.pipe + ' EA</span></div>' : ''}
${(counts.skylight || 0) > 0 ? '<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Re-flash skylights</span><span class="scope-qty">' + counts.skylight + ' EA</span></div>' : ''}
${(counts.chimney || 0) > 0 ? '<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Re-flash chimney</span><span class="scope-qty">' + counts.chimney + ' EA</span></div>' : ''}
<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Install ridge ventilation</span><span class="scope-qty">${ridgeLF} LF</span></div>
<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Complete cleanup and debris removal</span><span class="scope-qty">1 JOB</span></div>
<div class="scope-item"><span class="scope-check">✓</span><span class="scope-text">Final inspection and walkthrough with homeowner</span><span class="scope-qty">1 JOB</span></div>

<h2>Terms</h2>
<p style="font-size:12px;line-height:1.6;color:#333;">All work performed by No Big Deal Home Solutions includes industry-standard materials and labor. Work area will be protected during installation. Final cleanup includes magnet sweep of yard and driveway. Manufacturer warranties apply per selected material tier.</p>

<div class="sig"><div><div class="sig-line">Homeowner Signature</div></div><div><div class="sig-line">Contractor Signature</div></div></div>
<div class="foot"><span>No Big Deal Home Solutions · (859) 420-7382 · nobigdealwithjoedeal.com</span><span>Generated by NBD Pro</span></div>
</body></html>`;

  if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
    window.NBDDocViewer.open({ html, title: 'Scope of Work — ' + addr, filename: 'NBD-Scope-' + date.replace(/\s/g, '') + '.pdf' });
  } else {
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  }
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
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #e8720c;margin-bottom:22px;}
  .brand{font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:800;text-transform:uppercase;}
  .brand span{color:#e8720c;}.badge{font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#e8720c;border:1px solid #e8720c;padding:2px 9px;border-radius:2px;display:inline-block;margin-top:4px;}
  .addr{font-size:15px;font-weight:600;text-align:right;}.date{font-size:11px;color:#666;text-align:right;}
  h2{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#e8720c;margin:20px 0 10px;padding-bottom:4px;border-bottom:1px solid #eee;}
  table{width:100%;border-collapse:collapse;}th{background:#0A0C0F;color:#fff;font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:7px 10px;text-align:left;}
  td{padding:7px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;}tr:nth-child(even) td{background:#fafafa;}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px;}
  .card{background:#f8f8f8;border:1px solid #eee;border-radius:7px;padding:12px;text-align:center;}
  .card .v{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:700;color:#e8720c;}
  .card .k{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.05em;margin-top:3px;}
  .foot{margin-top:28px;padding-top:14px;border-top:1px solid #eee;display:flex;justify-content:space-between;font-size:10px;color:#999;}
  .total-row td{font-weight:700;border-top:2px solid #eee;}</style></head><body>
  <div class="hdr"><div><div class="brand">No Big Deal <span>Home Solutions</span></div><div class="badge">Drawing Measurement Report</div></div>
  <div><div class="addr">${addr}</div><div class="date">${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</div></div></div>
  <div class="cards">
    <div class="card"><div class="v">${document.getElementById('cr-base').textContent}</div><div class="k">Base Area</div></div>
    <div class="card"><div class="v">${document.getElementById('cr-pitched').textContent}</div><div class="k">Pitched Area</div></div>
    <div class="card"><div class="v">${document.getElementById('cr-waste').textContent}</div><div class="k">With Waste</div></div>
    <div class="card" style="background:#e8720c;border-color:#e8720c;"><div class="v" style="color:#fff;">${document.getElementById('cr-sq').textContent}</div><div class="k" style="color:rgba(255,255,255,.8);">Squares</div></div>
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
  </body></html>`;
  if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
    window.NBDDocViewer.open({
      html: html,
      title: 'Roof Measurement Report',
      filename: 'NBD-Measurements-' + new Date().toISOString().split('T')[0] + '.pdf'
    });
    return;
  }
  const w=window.open('','_blank'); if(w){ w.document.write(html); w.document.close(); }
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
    // Only restore if less than 30 days old (extended from 7 days)
    if(Date.now() - (data.ts||0) > 30*24*60*60*1000) { localStorage.removeItem(key); return; }
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

// ╔═══════════════════════════════════════════════════════════════════╗
// ║  WOW FEATURES — INDUSTRY-FIRST CAPABILITIES                     ║
// ╚═══════════════════════════════════════════════════════════════════╝

// ── FEATURE 1: SMART WASTE CALCULATOR ────────────────────────────
// Calculates waste % based on actual roof complexity instead of flat %
function calcSmartWaste() {
  const valleys = drawnLines.filter(l => l.type === 3);
  const hips    = drawnLines.filter(l => l.type === 2);
  const ridges  = drawnLines.filter(l => l.type === 0 || l.type === 1);
  const flashings = drawnLines.filter(l => l.type === 6 || l.type === 7);
  const nFacets = Math.max(facets.length, 1);

  // Base waste: 10% for simple, scales with complexity
  let waste = 0.10;
  // Valleys add 2.5% each (lots of cuts)
  waste += valleys.length * 0.025;
  // Hips add 1.5% each
  waste += hips.length * 0.015;
  // Extra facets beyond 2 add 1% each
  if(nFacets > 2) waste += (nFacets - 2) * 0.01;
  // Flashings add 0.5% each (detail work = more cuts)
  waste += flashings.length * 0.005;
  // Short ridge relative to perimeter = steep/complex
  const totalRidge = ridges.reduce((s,l) => s+l.dist, 0);
  const totalPerim = drawnLines.filter(l => l.type === 4 || l.type === 5).reduce((s,l) => s+l.dist, 0);
  if(totalPerim > 0 && totalRidge > 0 && totalRidge / totalPerim < 0.15) waste += 0.03;

  // Compute average angle at vertices — tight angles = more waste
  const vertices = new Map();
  drawnLines.forEach(l => {
    if(!l.p1 || !l.p2 || l.type === 10) return;
    const k1 = l.p1.lat.toFixed(7)+','+l.p1.lng.toFixed(7);
    const k2 = l.p2.lat.toFixed(7)+','+l.p2.lng.toFixed(7);
    if(!vertices.has(k1)) vertices.set(k1,[]);
    if(!vertices.has(k2)) vertices.set(k2,[]);
    vertices.get(k1).push(l.p2);
    vertices.get(k2).push(l.p1);
  });
  let angles=[], angleCnt=0;
  vertices.forEach((others, key) => {
    if(others.length < 2) return;
    const [lat,lng] = key.split(',').map(Number);
    const center = {lat,lng};
    for(let i=0;i<others.length;i++) {
      for(let j=i+1;j<others.length;j++) {
        const a = calcAngle(others[i], center, others[j]);
        if(a > 1 && a < 179) { angles.push(a); angleCnt++; }
      }
    }
  });
  if(angleCnt > 0) {
    const avgAngle = angles.reduce((s,a)=>s+a,0) / angleCnt;
    if(avgAngle < 75) waste += 0.04;
    else if(avgAngle < 90) waste += 0.02;
  }

  // Cap between 8% and 35%
  waste = Math.max(0.08, Math.min(0.35, waste));

  // Build explanation
  const reasons = [];
  if(valleys.length) reasons.push(`${valleys.length} valley${valleys.length>1?'s':''}`);
  if(hips.length) reasons.push(`${hips.length} hip${hips.length>1?'s':''}`);
  if(nFacets > 2) reasons.push(`${nFacets} facets`);
  if(flashings.length) reasons.push(`${flashings.length} flashing detail${flashings.length>1?'s':''}`);
  if(angleCnt > 0 && angles.reduce((s,a)=>s+a,0)/angleCnt < 90) reasons.push('tight angles');

  return {
    pct: waste,
    multiplier: 1 + waste,
    label: (waste * 100).toFixed(0) + '%',
    reasons: reasons.length ? reasons.join(', ') : 'simple geometry',
    complexity: waste <= 0.12 ? 'Simple' : waste <= 0.18 ? 'Moderate' : waste <= 0.25 ? 'Complex' : 'Very Complex'
  };
}

function applySmartWaste() {
  const sw = calcSmartWaste();
  // Find closest waste option or use custom
  const wasteSel = document.getElementById('wasteSel');
  if(!wasteSel) return;
  // Add smart option if not present
  let smartOpt = wasteSel.querySelector('option[value="smart"]');
  if(!smartOpt) {
    smartOpt = document.createElement('option');
    smartOpt.value = 'smart';
    wasteSel.insertBefore(smartOpt, wasteSel.firstChild);
  }
  smartOpt.textContent = `Smart: ${sw.label} (${sw.complexity})`;
  smartOpt.value = sw.multiplier.toFixed(4);
  wasteSel.value = sw.multiplier.toFixed(4);
  recalc();
  // Update smart waste display
  const swEl = document.getElementById('smartWasteInfo');
  if(swEl) {
    swEl.innerHTML = `<span style="color:var(--orange);font-weight:700;">${sw.label}</span> waste — ${sw.complexity} roof (${sw.reasons})`;
    swEl.style.display = 'block';
  }
  showToast(`Smart Waste: ${sw.label} — ${sw.reasons}`, 'ok');
  autoSaveDrawing();
}


// ── FEATURE 2: ONE-CLICK MATERIAL TAKEOFF ────────────────────────
const MATERIAL_SPECS = {
  shingleBundlesPerSq: 3,       // Architectural shingles
  underlaymentSqPerRoll: 4,     // Synthetic underlayment
  dripEdgeFtPerPiece: 10,       // Standard drip edge length
  starterStripFtPerBundle: 120, // Starter strip coverage
  ridgeCapBundleLF: 31.7,       // Hip & ridge cap per bundle
  iceWaterFtPerRoll: 75,        // Ice & water shield per roll
  iceWaterWidthFt: 3,           // 36" wide = eave coverage
  stepFlashPerPiece: 1,         // Each piece ~1 LF coverage
  pipeBootCount: 2,             // Default estimate
  ventCount: 1,                 // Ridge vent per 40ft ridge
};

function generateMaterialTakeoff() {
  const sw = calcSmartWaste();
  const base = parseFloat(document.getElementById('cr-base')?.textContent) || 0;
  const pitched = parseFloat(document.getElementById('cr-pitched')?.textContent) || 0;
  const wasteArea = pitched * sw.multiplier;
  const squares = wasteArea / 100;

  // Line totals by type
  const ridgeLF  = drawnLines.filter(l => l.type === 0 || l.type === 1).reduce((s,l) => s+l.dist, 0);
  const hipLF    = drawnLines.filter(l => l.type === 2).reduce((s,l) => s+l.dist, 0);
  const valleyLF = drawnLines.filter(l => l.type === 3).reduce((s,l) => s+l.dist, 0);
  const rakeLF   = drawnLines.filter(l => l.type === 4).reduce((s,l) => s+l.dist, 0);
  const eaveLF   = drawnLines.filter(l => l.type === 5).reduce((s,l) => s+l.dist, 0);
  const flashLF  = drawnLines.filter(l => l.type === 6).reduce((s,l) => s+l.dist, 0);
  const stepLF   = drawnLines.filter(l => l.type === 7).reduce((s,l) => s+l.dist, 0);
  const dripLF   = drawnLines.filter(l => l.type === 8).reduce((s,l) => s+l.dist, 0);
  const gutterLF = drawnLines.filter(l => l.type === 10).reduce((s,l) => s+l.dist, 0);

  const M = MATERIAL_SPECS;
  const materials = [
    { name: 'Shingle Bundles', qty: Math.ceil(squares * M.shingleBundlesPerSq), unit: 'bdl', note: `${squares.toFixed(1)} sq × ${M.shingleBundlesPerSq}/sq` },
    { name: 'Underlayment Rolls', qty: Math.ceil(squares / M.underlaymentSqPerRoll), unit: 'roll', note: `${M.underlaymentSqPerRoll} sq/roll` },
    { name: 'Drip Edge', qty: Math.ceil((eaveLF + rakeLF + dripLF) / M.dripEdgeFtPerPiece), unit: 'pc', note: `${(eaveLF+rakeLF+dripLF).toFixed(0)} LF total` },
    { name: 'Starter Strip', qty: Math.ceil((eaveLF + rakeLF) / M.starterStripFtPerBundle), unit: 'bdl', note: `${(eaveLF+rakeLF).toFixed(0)} LF perimeter` },
    { name: 'Hip & Ridge Cap', qty: Math.ceil((ridgeLF + hipLF) / M.ridgeCapBundleLF), unit: 'bdl', note: `${(ridgeLF+hipLF).toFixed(0)} LF ridge+hip` },
  ];

  // Conditional materials
  if(eaveLF > 0) {
    materials.push({ name: 'Ice & Water Shield', qty: Math.ceil(eaveLF / M.iceWaterFtPerRoll), unit: 'roll', note: `${eaveLF.toFixed(0)} LF eave` });
  }
  if(valleyLF > 0) {
    materials.push({ name: 'Valley Metal / Ice Shield', qty: Math.ceil(valleyLF / 10), unit: 'pc', note: `${valleyLF.toFixed(0)} LF valley` });
  }
  if(stepLF > 0) {
    materials.push({ name: 'Step Flashing', qty: Math.ceil(stepLF), unit: 'pc', note: `${stepLF.toFixed(0)} LF step` });
  }
  if(flashLF > 0) {
    materials.push({ name: 'Flashing (misc)', qty: Math.ceil(flashLF / 10), unit: 'pc', note: `${flashLF.toFixed(0)} LF` });
  }
  if(ridgeLF > 0) {
    materials.push({ name: 'Ridge Vent', qty: Math.ceil(ridgeLF / 4), unit: 'pc (4ft)', note: `${ridgeLF.toFixed(0)} LF ridge` });
  }
  if(gutterLF > 0) {
    materials.push({ name: 'Gutter Sections (10ft)', qty: Math.ceil(gutterLF / 10), unit: 'pc', note: `${gutterLF.toFixed(0)} LF gutter` });
    materials.push({ name: 'Downspouts', qty: Math.ceil(gutterLF / 40), unit: 'pc', note: '1 per 40 LF' });
  }
  // Always add nails + pipe boots
  materials.push({ name: 'Roofing Nails (coil)', qty: Math.ceil(squares / 4), unit: 'box', note: '~4 sq per box' });
  materials.push({ name: 'Pipe Boots', qty: M.pipeBootCount, unit: 'pc', note: 'Verify on-site' });

  return { materials, squares, wasteInfo: sw };
}

function showMaterialTakeoff() {
  const t = generateMaterialTakeoff();
  if(!t.materials.length || t.squares < 0.1) { showToast('Draw some lines first','info'); return; }

  const addr = document.getElementById('drawSearch')?.value || 'Property';
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Material Takeoff — ${addr}</title>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500&display=swap" rel="stylesheet">
  <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Barlow',sans-serif;padding:32px;max-width:850px;margin:0 auto;}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #e8720c;margin-bottom:22px;}
  .brand{font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:800;text-transform:uppercase;}
  .brand span{color:#e8720c;}.badge{font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#e8720c;border:1px solid #e8720c;padding:2px 9px;border-radius:2px;display:inline-block;margin-top:4px;}
  .addr{font-size:15px;font-weight:600;text-align:right;}.date{font-size:11px;color:#666;text-align:right;}
  h2{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#e8720c;margin:20px 0 10px;padding-bottom:4px;border-bottom:1px solid #eee;}
  table{width:100%;border-collapse:collapse;}th{background:#0A0C0F;color:#fff;font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:7px 10px;text-align:left;}
  td{padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;}tr:nth-child(even) td{background:#fafafa;}
  .qty{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:#e8720c;}
  .note{font-size:10px;color:#888;}
  .summary{background:#f8f8f8;border:1px solid #eee;border-radius:8px;padding:16px;margin-bottom:20px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;text-align:center;}
  .summary .v{font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:700;color:#e8720c;}
  .summary .k{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.05em;}
  .warn{background:#FEF3C7;border:1px solid #FCD34D;border-radius:6px;padding:10px 14px;font-size:11px;color:#92400E;margin-top:16px;}
  .foot{margin-top:28px;padding-top:14px;border-top:1px solid #eee;display:flex;justify-content:space-between;font-size:10px;color:#999;}
  </style></head><body>
  <div class="hdr"><div><div class="brand">No Big Deal <span>Home Solutions</span></div><div class="badge">Material Takeoff</div></div>
  <div><div class="addr">${addr}</div><div class="date">${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</div></div></div>
  <div class="summary">
    <div><div class="v">${t.squares.toFixed(1)} sq</div><div class="k">Total Squares</div></div>
    <div><div class="v">${t.wasteInfo.label}</div><div class="k">Smart Waste (${t.wasteInfo.complexity})</div></div>
    <div><div class="v">${t.materials.length}</div><div class="k">Material Items</div></div>
  </div>
  <h2>Material List</h2>
  <table><thead><tr><th>Material</th><th>Qty</th><th>Unit</th><th>Based On</th></tr></thead><tbody>
  ${t.materials.map(m => `<tr><td><b>${m.name}</b></td><td class="qty">${m.qty}</td><td>${m.unit}</td><td class="note">${m.note}</td></tr>`).join('')}
  </tbody></table>
  <div class="warn">⚠️ Quantities are estimates based on satellite measurements. Always verify on-site before ordering. Pipe boot count and specialty items should be confirmed during inspection.</div>
  <div class="foot"><div>No Big Deal Home Solutions — nobigdealwithjoedeal.com</div><div>Generated from NBD Pro Drawing Tool</div></div>
  </body></html>`;
  if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
    const slug = (addr || 'takeoff').replace(/[^A-Za-z0-9]+/g, '-').substring(0, 40);
    window.NBDDocViewer.open({
      html: html,
      title: 'Material Takeoff — ' + (addr || 'Drawing'),
      filename: 'NBD-Takeoff-' + slug + '-' + new Date().toISOString().split('T')[0] + '.pdf'
    });
    return;
  }
  const w = window.open('','_blank'); if(w){ w.document.write(html); w.document.close(); }
}


// ── FEATURE 3: SHADOW-BASED PITCH ESTIMATION ─────────────────────
// Solar position calculator
function getSunPosition(lat, lng, date) {
  const d = date || new Date();
  const rad = Math.PI / 180;
  // Day of year
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  const dayOfYear = Math.floor(diff / 86400000);
  // Solar declination (simplified)
  const declination = 23.45 * Math.sin(rad * (360/365) * (dayOfYear - 81));
  // Hour angle
  const solarNoon = 12; // approximate
  const hours = d.getHours() + d.getMinutes()/60;
  const hourAngle = (hours - solarNoon) * 15;
  // Elevation angle
  const sinElev = Math.sin(lat*rad)*Math.sin(declination*rad) +
                  Math.cos(lat*rad)*Math.cos(declination*rad)*Math.cos(hourAngle*rad);
  const elevation = Math.asin(sinElev) / rad;
  // Azimuth
  const cosAz = (Math.sin(declination*rad) - Math.sin(elevation*rad)*Math.sin(lat*rad)) /
                (Math.cos(elevation*rad)*Math.cos(lat*rad));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) / rad;
  if(hourAngle > 0) azimuth = 360 - azimuth;

  return { elevation, azimuth };
}

function startShadowPitch() {
  shadowMode = 'shadow'; // First: draw shadow line
  showToast('Step 1: Draw a line along the shadow edge on the satellite image', 'info');
  const bar = document.getElementById('shadowBar');
  if(bar) { bar.style.display = 'block'; bar.textContent = '☀️ Step 1: Click two points along the roof shadow on the ground.'; }
}

function handleShadowClick(latlng) {
  if(shadowMode === 'shadow') {
    if(!shadowLine) {
      shadowLine = { p1: latlng };
      makeDraggableDot(latlng, '#EAB308');
      showToast('Now click the end of the shadow', 'info');
    } else {
      shadowLine.p2 = latlng;
      makeDraggableDot(latlng, '#EAB308');
      const sl = L.polyline([shadowLine.p1, shadowLine.p2], {color:'#EAB308', weight:3, dashArray:'6,3', opacity:.8}).addTo(drawMap);
      shadowLine.leafletLine = sl;
      shadowLine.dist = hav(shadowLine.p1, shadowLine.p2);
      shadowMode = 'edge'; // Next: draw roof edge
      const bar = document.getElementById('shadowBar');
      if(bar) bar.textContent = `☀️ Shadow: ${shadowLine.dist.toFixed(1)} ft — Step 2: Now draw the corresponding roof edge (eave to ridge).`;
      showToast('Step 2: Draw the corresponding roof edge line (eave to peak)', 'info');
    }
  } else if(shadowMode === 'edge') {
    if(!shadowEdgeLine) {
      shadowEdgeLine = { p1: latlng };
      makeDraggableDot(latlng, '#F97316');
    } else {
      shadowEdgeLine.p2 = latlng;
      makeDraggableDot(latlng, '#F97316');
      const el = L.polyline([shadowEdgeLine.p1, shadowEdgeLine.p2], {color:'#F97316', weight:3, dashArray:'6,3', opacity:.8}).addTo(drawMap);
      shadowEdgeLine.leafletLine = el;
      shadowEdgeLine.dist = hav(shadowEdgeLine.p1, shadowEdgeLine.p2);
      // Calculate pitch
      estimatePitchFromShadow();
    }
  }
}

function estimatePitchFromShadow() {
  if(!shadowLine || !shadowEdgeLine) return;
  const center = drawMap.getCenter();
  const sun = getSunPosition(center.lat, center.lng);

  // Shadow length on ground = building height / tan(sun elevation)
  // So building height = shadow length * tan(sun elevation)
  // Pitch = atan(height / run) where run = horizontal roof extent
  const shadowLen = shadowLine.dist;
  const roofEdgeLen = shadowEdgeLine.dist;
  const sunElevRad = sun.elevation * Math.PI / 180;

  if(sun.elevation < 10) {
    showToast('Sun too low for reliable pitch estimation — try when sun is higher', 'error');
    resetShadowMode();
    return;
  }

  // Estimated vertical rise from shadow
  const estHeight = shadowLen * Math.tan(sunElevRad);
  // Pitch ratio: rise per 12 inches of run
  const pitchRatio = (estHeight / roofEdgeLen) * 12;
  const pitchRounded = Math.round(pitchRatio);
  const clampedPitch = Math.max(1, Math.min(12, pitchRounded));

  // Map to pitch multiplier
  const pitchMultipliers = {1:1.003,2:1.014,3:1.031,4:1.054,5:1.083,6:1.118,7:1.158,8:1.202,9:1.25,10:1.302,11:1.357,12:1.414};
  const mult = pitchMultipliers[clampedPitch] || 1.202;

  // Apply to pitch selector
  const pitchSel = document.getElementById('pitchSel');
  if(pitchSel) {
    // Find closest option
    let best = null, bestDiff = 999;
    for(const opt of pitchSel.options) {
      const diff = Math.abs(parseFloat(opt.value) - mult);
      if(diff < bestDiff) { bestDiff = diff; best = opt; }
    }
    if(best) pitchSel.value = best.value;
  }

  recalc();
  const bar = document.getElementById('shadowBar');
  if(bar) {
    bar.innerHTML = `☀️ <b>Estimated Pitch: ${clampedPitch}/12</b> (multiplier: ${mult}×) — Sun elevation: ${sun.elevation.toFixed(1)}° | Shadow: ${shadowLine.dist.toFixed(1)}ft | Edge: ${shadowEdgeLine.dist.toFixed(1)}ft`;
  }
  showToast(`Pitch estimated: ${clampedPitch}/12 (${mult}× multiplier)`, 'ok');
  resetShadowMode();
  autoSaveDrawing();
}

function resetShadowMode() {
  shadowMode = false;
  shadowLine = null;
  shadowEdgeLine = null;
}


// ── FEATURE 4: HISTORICAL IMAGERY SLIDER ─────────────────────────
// Uses Esri World Imagery Wayback service
const ESRI_WAYBACK_VERSIONS = [
  {date:'2024-06-12', version:'WB_2024_R06'},
  {date:'2023-06-14', version:'WB_2023_R06'},
  {date:'2022-06-15', version:'WB_2022_R06'},
  {date:'2021-06-16', version:'WB_2021_R06'},
  {date:'2020-06-10', version:'WB_2020_R06'},
  {date:'2019-06-12', version:'WB_2019_R06'},
  {date:'2018-02-14', version:'WB_2018_R02'},
  {date:'2017-09-20', version:'WB_2017_R09'},
];

function toggleHistoricalImagery() {
  if(historySliderActive) {
    closeHistoricalImagery();
    return;
  }
  historySliderActive = true;
  // Show the slider UI
  const panel = document.getElementById('historyPanel');
  if(panel) panel.style.display = 'block';
  // Default: show oldest available
  setHistoricalLayer(ESRI_WAYBACK_VERSIONS.length - 1);
  showToast('Historical imagery loaded — use slider to compare dates', 'ok');
}

function setHistoricalLayer(idx) {
  const v = ESRI_WAYBACK_VERSIONS[idx];
  if(!v) return;
  if(historyLayerOld) drawMap.removeLayer(historyLayerOld);
  historyLayerOld = L.tileLayer(
    `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${v.version}/{z}/{y}/{x}`,
    { maxZoom: 21, opacity: 1 }
  ).addTo(drawMap);
  // Put behind current drawings
  historyLayerOld.setZIndex(-1);

  const label = document.getElementById('historyDateLabel');
  if(label) label.textContent = v.date;
}

function updateHistoryOpacity(val) {
  if(historyLayerOld) historyLayerOld.setOpacity(parseFloat(val));
  const pctLabel = document.getElementById('historyOpacityLabel');
  if(pctLabel) pctLabel.textContent = Math.round(val * 100) + '%';
}

function closeHistoricalImagery() {
  historySliderActive = false;
  if(historyLayerOld) { drawMap.removeLayer(historyLayerOld); historyLayerOld = null; }
  const panel = document.getElementById('historyPanel');
  if(panel) panel.style.display = 'none';
}


// ── FEATURE 5: ROOF EDGE AUTO-DETECT ─────────────────────────────
function startAutoDetect() {
  autoDetectActive = true;
  showToast('Click a corner of the roof — AI will try to trace the edges', 'info');
  drawMap.once('click', async (e) => {
    autoDetectActive = false;
    await detectRoofEdges(e.latlng);
  });
}

async function detectRoofEdges(startLatLng) {
  showToast('Analyzing satellite imagery...', 'info');
  try {
    const mapEl = document.getElementById('drawMap');
    const canvases = mapEl.querySelectorAll('canvas');
    if(!canvases.length) { showToast('No canvas found — switch to satellite layer', 'error'); return; }

    const canvas = canvases[0];
    const ctx = canvas.getContext('2d', {willReadFrequently:true});
    const w = canvas.width, h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Convert click to pixel position
    const startPx = drawMap.latLngToContainerPoint(startLatLng);
    const sx = Math.round(startPx.x * (w / mapEl.clientWidth));
    const sy = Math.round(startPx.y * (h / mapEl.clientHeight));

    // Sobel edge detection on grayscale
    const gray = new Float32Array(w * h);
    for(let i = 0; i < w*h; i++) {
      gray[i] = data[i*4]*0.299 + data[i*4+1]*0.587 + data[i*4+2]*0.114;
    }

    const edges = new Float32Array(w * h);
    for(let y = 1; y < h-1; y++) {
      for(let x = 1; x < w-1; x++) {
        const gx = -gray[(y-1)*w+x-1] + gray[(y-1)*w+x+1]
                   -2*gray[y*w+x-1] + 2*gray[y*w+x+1]
                   -gray[(y+1)*w+x-1] + gray[(y+1)*w+x+1];
        const gy = -gray[(y-1)*w+x-1] - 2*gray[(y-1)*w+x] - gray[(y-1)*w+x+1]
                   +gray[(y+1)*w+x-1] + 2*gray[(y+1)*w+x] + gray[(y+1)*w+x+1];
        edges[y*w+x] = Math.sqrt(gx*gx + gy*gy);
      }
    }

    // Find edge threshold (adaptive: use top 15% of edge magnitudes)
    const sorted = Array.from(edges).sort((a,b) => b-a);
    const threshold = sorted[Math.floor(sorted.length * 0.15)] || 50;

    // Trace edge from starting point using greedy walk
    const traced = [];
    const visited = new Set();
    let cx = sx, cy = sy;
    const maxSteps = 2000;
    const searchRadius = 6;

    // Find nearest strong edge from click point
    let bestDist = Infinity;
    for(let dy = -searchRadius; dy <= searchRadius; dy++) {
      for(let dx = -searchRadius; dx <= searchRadius; dx++) {
        const nx = cx+dx, ny = cy+dy;
        if(nx<0||ny<0||nx>=w||ny>=h) continue;
        if(edges[ny*w+nx] >= threshold) {
          const d = dx*dx+dy*dy;
          if(d < bestDist) { bestDist = d; cx = nx; cy = ny; }
        }
      }
    }

    // Walk along edge
    for(let step = 0; step < maxSteps; step++) {
      const key = cx+','+cy;
      if(visited.has(key)) {
        // Closed loop detected
        if(traced.length > 10) break;
        else { visited.clear(); } // reset if too early
      }
      visited.add(key);

      // Only add every Nth pixel as a vertex (reduces noise)
      if(step % 8 === 0) {
        const pt = drawMap.containerPointToLatLng(
          L.point(cx * (mapEl.clientWidth / w), cy * (mapEl.clientHeight / h))
        );
        traced.push(pt);
      }

      // Find strongest neighboring edge pixel (8-connected)
      let bestVal = -1, bx = cx, by = cy;
      for(let dy = -2; dy <= 2; dy++) {
        for(let dx = -2; dx <= 2; dx++) {
          if(dx===0 && dy===0) continue;
          const nx = cx+dx, ny = cy+dy;
          if(nx<0||ny<0||nx>=w||ny>=h) continue;
          const nk = nx+','+ny;
          if(visited.has(nk)) continue;
          if(edges[ny*w+nx] > bestVal) { bestVal = edges[ny*w+nx]; bx = nx; by = ny; }
        }
      }

      if(bestVal < threshold * 0.3) break; // Lost the edge
      cx = bx; cy = by;
    }

    if(traced.length < 4) {
      showToast('Could not detect clear edges — try a different corner or zoom level', 'error');
      return;
    }

    // Simplify the traced points (Douglas-Peucker)
    const simplified = douglasPeucker(traced, 0.00003);

    // Draw the detected outline as a preview
    const preview = L.polyline(simplified, {color:'#EAB308', weight:3, dashArray:'8,4', opacity:.8}).addTo(drawMap);
    simplified.forEach(p => makeDraggableDot(p, '#EAB308'));

    showToast(`Detected ${simplified.length} edge points — adjust dots to refine, or accept`, 'ok');

    // Store for acceptance
    window._autoDetectPreview = { line: preview, points: simplified };
    const bar = document.getElementById('autoDetectBar');
    if(bar) bar.style.display = 'flex';

  } catch(e) {
    showToast('Edge detection failed: ' + e.message, 'error');
  }
}

// Douglas-Peucker simplification for lat/lng
function douglasPeucker(points, epsilon) {
  if(points.length <= 2) return points;
  let maxDist = 0, maxIdx = 0;
  const first = points[0], last = points[points.length-1];
  for(let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], first, last);
    if(d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if(maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx+1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function perpDist(p, a, b) {
  const dx = b.lng - a.lng, dy = b.lat - a.lat;
  const len2 = dx*dx + dy*dy;
  if(len2 === 0) return Math.sqrt((p.lng-a.lng)**2 + (p.lat-a.lat)**2);
  const t = Math.max(0, Math.min(1, ((p.lng-a.lng)*dx + (p.lat-a.lat)*dy) / len2));
  const projLng = a.lng + t*dx, projLat = a.lat + t*dy;
  return Math.sqrt((p.lng-projLng)**2 + (p.lat-projLat)**2);
}

function acceptAutoDetect() {
  const ad = window._autoDetectPreview;
  if(!ad) return;
  // Convert to perimeter points
  ad.points.forEach(p => {
    perimPoints.push(p);
    perimDots.push(makeDraggableDot(p, '#4A9EFF'));
  });
  // Auto-close if enough points
  if(ad.points.length >= 3) {
    // Create segments between consecutive points
    for(let i = 0; i < ad.points.length; i++) {
      const p1 = ad.points[i];
      const p2 = ad.points[(i+1) % ad.points.length];
      addPerimSegment(p1, p2, 'eave'); // Default all to eave — user can toggle with E/R mode
    }
    perimClosed = true;
    perimPolygon = L.polygon(perimPoints, {color:'#4A9EFF', fillColor:'#4A9EFF', fillOpacity:.12, weight:0}).addTo(drawMap);
    perimBaseArea = shoelaceArea(perimPoints);
    addAreaLabel(perimPoints, perimBaseArea);
    saveFacet();
    renderLineList(); renderFacetList(); recalc(); autoSaveDrawing();
    showToast(`Auto-detected facet: ${perimBaseArea.toFixed(0)} sf — switch to Eave/Rake mode to classify edges`, 'ok');
  }
  // ── ML FEEDBACK DATA PIPELINE (April 2026) ──
  // Save the auto-detected outline (before) and the user's
  // corrected version (after) as a training pair in Firestore.
  // When we eventually train an ML model for roof edge detection,
  // this labeled data is gold — real satellite images with
  // human-corrected polygon boundaries.
  if (window._db && window._user?.uid) {
    try {
      const trainingPair = {
        userId: window._user.uid,
        address: document.getElementById('drawSearch')?.value || '',
        timestamp: window.serverTimestamp(),
        autoDetected: ad.points.map(p => ({ lat: p.lat, lng: p.lng })),
        userCorrected: perimPoints.map(p => ({ lat: p.lat, lng: p.lng })),
        accepted: true, // user accepted (with possible corrections)
        mapCenter: drawMap.getCenter ? { lat: drawMap.getCenter().lat, lng: drawMap.getCenter().lng } : null,
        zoom: drawMap.getZoom ? drawMap.getZoom() : null
      };
      window.addDoc(window.collection(window._db, 'ml_training_data'), trainingPair);
    } catch (e) { console.warn('ML training pair save failed:', e.message); }
  }

  // Clean up preview
  if(ad.line) drawMap.removeLayer(ad.line);
  window._autoDetectPreview = null;
  const bar = document.getElementById('autoDetectBar');
  if(bar) bar.style.display = 'none';
}

function cancelAutoDetect() {
  const ad = window._autoDetectPreview;
  if(ad) {
    if(ad.line) drawMap.removeLayer(ad.line);
    window._autoDetectPreview = null;
  }
  const bar = document.getElementById('autoDetectBar');
  if(bar) bar.style.display = 'none';
  showToast('Auto-detect cancelled', 'info');
}


// ── FEATURE 6: VOICE-CONTROLLED MEASUREMENT ──────────────────────
function initVoiceControl() {
  if(!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('Voice control not supported in this browser', 'error');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  voiceRecognition = new SR();
  voiceRecognition.continuous = true;
  voiceRecognition.interimResults = false;
  voiceRecognition.lang = 'en-US';

  voiceRecognition.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    if(!last.isFinal) return;
    const cmd = last[0].transcript.trim().toLowerCase();
    processVoiceCommand(cmd);
  };

  voiceRecognition.onerror = (e) => {
    if(e.error !== 'no-speech') showToast('Voice error: ' + e.error, 'error');
  };

  voiceRecognition.onend = () => {
    // Auto-restart if voice is still active
    if(voiceActive) {
      try { voiceRecognition.start(); } catch(e) {}
    }
  };
}

function toggleVoiceControl() {
  if(!voiceRecognition) initVoiceControl();
  if(!voiceRecognition) return;

  voiceActive = !voiceActive;
  const btn = document.getElementById('voiceBtn');

  if(voiceActive) {
    voiceRecognition.start();
    if(btn) { btn.classList.add('voice-active'); btn.textContent = '🎙️ Listening...'; }
    showToast('Voice control ON — say commands like "ridge 48 feet" or "undo"', 'ok');
  } else {
    voiceRecognition.stop();
    if(btn) { btn.classList.remove('voice-active'); btn.textContent = '🎤 Voice'; }
    showToast('Voice control OFF', 'info');
  }
}

function processVoiceCommand(cmd) {
  const voiceLog = document.getElementById('voiceLog');
  if(voiceLog) voiceLog.textContent = `"${cmd}"`;

  // Normalize
  const c = cmd.replace(/[^\w\s]/g, '').trim();

  // Action commands
  if(c.includes('undo')) { undoLine(); showToast('↩ Undo (voice)', 'info'); return; }
  if(c.includes('clear')) { clearDraw(); return; }
  if(c.includes('draw') || c.includes('start')) { if(!drawOn) toggleDraw(); return; }
  if(c.includes('stop') || c.includes('done')) { if(drawOn) toggleDraw(); return; }
  if(c.includes('fit') || c.includes('zoom')) { zoomToFit(); return; }
  if(c.includes('close') && c.includes('perim')) { if(perimPoints.length >= 3) closePerimeter(); return; }
  if(c.includes('new facet') || c.includes('next facet')) { resetPerimState(); showToast('New facet started', 'ok'); return; }
  if(c.includes('screenshot') || c.includes('capture')) { screenshotMap(); return; }
  if(c.includes('materials') || c.includes('takeoff')) { showMaterialTakeoff(); return; }
  if(c.includes('report') || c.includes('export')) { exportDrawReport(); return; }
  if(c.includes('estimate')) { importToEstimate(); return; }
  if(c.includes('perimeter mode') || c.includes('perimeter')) { setDrawMode('perim', document.getElementById('modePerimBtn')); return; }
  if(c.includes('line mode') || c.includes('lines')) { setDrawMode('line', document.getElementById('modeLineBtn')); return; }
  if(c.includes('gutter mode') || c.includes('gutters')) { setDrawMode('gutter', document.getElementById('modeGutterBtn')); return; }

  // Measurement commands: "[type] [number] feet"
  const typeMap = {
    'ridge':0, 'ridge vent':1, 'hip':2, 'valley':3, 'rake':4,
    'eave':5, 'flashing':6, 'step flash':7, 'drip edge':8, 'parapet':9, 'gutter':10
  };

  // Try to match "[type] [number] feet/foot/ft"
  const numMatch = c.match(/(\d+\.?\d*)\s*(feet|foot|ft)/);
  if(numMatch) {
    const dist = parseFloat(numMatch[1]);
    let matchedType = null;
    for(const [name, typeIdx] of Object.entries(typeMap)) {
      if(c.includes(name)) { matchedType = typeIdx; break; }
    }
    if(matchedType !== null && dist > 0) {
      // Add a measurement line at the given length
      voiceAddMeasurement(matchedType, dist);
      return;
    }
  }

  // Line type selection
  for(const [name, typeIdx] of Object.entries(typeMap)) {
    if(c === name || c === name + 's') {
      drawLT = typeIdx;
      showToast(`Line type: ${LT[typeIdx].n} (voice)`, 'info');
      return;
    }
  }

  showToast(`Voice: "${cmd}" — not recognized`, 'info');
}

function voiceAddMeasurement(typeIdx, dist) {
  // If we have a starting point, extend from it at current bearing
  // Otherwise create a horizontal line from map center
  const lt = LT[typeIdx];
  let p1, p2;

  if(drawStart) {
    p1 = drawStart;
  } else if(drawnLines.length > 0) {
    p1 = drawnLines[drawnLines.length-1].p2;
  } else {
    p1 = drawMap.getCenter();
  }

  // Convert distance to lat offset (approximate: 1 ft ≈ 0.0000027° lat)
  const ftToLat = 1 / 364000;
  const ftToLng = ftToLat / Math.cos(p1.lat * Math.PI / 180);
  // Default: extend east
  p2 = L.latLng(p1.lat, p1.lng + dist * ftToLng);

  const dot1 = makeDraggableDot(p1, lt.color);
  const dot2 = makeDraggableDot(p2, lt.color);
  const line = L.polyline([p1, p2], {color:lt.color, weight:4, opacity:.95, dashArray:lt.dash||null}).addTo(drawMap);
  const lbl  = L.marker(mid(p1,p2), {icon:L.divIcon({html:`<div class="meas-label" style="border-color:${lt.color}">${dist.toFixed(1)} ft</div>`, className:'', iconAnchor:[0,10]})}).addTo(drawMap);
  lbl.on('click', () => editLineLength(id));
  const id = Date.now() + Math.random();
  drawnLines.push({id, type:typeIdx, name:lt.n, color:lt.color, dist, line, lbl, p1, p2, dot1, dot2, subtype:null});
  drawStart = p2; // Chain from end
  renderLineList(); recalc(); autoSaveDrawing();
  showToast(`Added ${lt.n}: ${dist} ft (voice)`, 'ok');
}


// ── FEATURE 7: HOMEOWNER PRESENTATION MODE ───────────────────────
function startPresentation() {
  if(!drawnLines.length) { showToast('Draw some lines first', 'info'); return; }
  presentationActive = true;
  presentationStep = 0;

  // Hide sidebar, go fullscreen
  const sidebar = document.getElementById('map-sidebar-draw');
  if(sidebar) sidebar.style.display = 'none';
  const mapArea = document.querySelector('#view-draw .map-area');
  if(mapArea) mapArea.style.flex = '1';

  // Create presentation overlay
  const overlay = document.createElement('div');
  overlay.id = 'presentOverlay';
  overlay.innerHTML = `
    <div class="present-bar">
      <div class="present-title" id="presentTitle">Your Roof Measurement</div>
      <div class="present-controls">
        <button class="present-btn" data-mr-action="presentPrev">← Back</button>
        <span class="present-step" id="presentStepLabel">1 / 5</span>
        <button class="present-btn present-btn-next" data-mr-action="presentNext">Next →</button>
        <button class="present-btn present-btn-close" data-mr-action="endPresentation">✕</button>
      </div>
    </div>
    <div class="present-info" id="presentInfo"></div>
  `;
  document.getElementById('view-draw').appendChild(overlay);

  // Build presentation steps
  window._presentSteps = buildPresentationSteps();
  showPresentationStep(0);
}

function buildPresentationSteps() {
  const addr = document.getElementById('drawSearch')?.value || 'Your Property';
  const steps = [];

  // Step 1: Overview
  steps.push({
    title: addr,
    info: 'Satellite aerial measurement of your property',
    action: () => { zoomToFit(); hideAllDrawnLayers(); }
  });

  // Step 2: Show perimeter/facets
  steps.push({
    title: 'Roof Outline',
    info: `${facets.length || 1} roof section${facets.length !== 1 ? 's' : ''} identified — ${(parseFloat(document.getElementById('cr-base')?.textContent)||0)} base square feet`,
    action: () => {
      zoomToFit();
      showOnlyLayers('perim');
    }
  });

  // Step 3: Show all measurements
  steps.push({
    title: 'Detailed Measurements',
    info: `${drawnLines.length} measurements taken — Ridge, Hip, Valley, Eave, Rake mapped`,
    action: () => {
      zoomToFit();
      showAllDrawnLayers();
    }
  });

  // Step 4: Calculations
  const t = generateMaterialTakeoff();
  steps.push({
    title: 'Roof Calculation',
    info: `${t.squares.toFixed(1)} squares | Smart waste: ${t.wasteInfo.label} (${t.wasteInfo.complexity}) | ${t.materials.length} material items needed`,
    action: () => { zoomToFit(); showAllDrawnLayers(); }
  });

  // Step 5: Call to action
  steps.push({
    title: 'Ready to Protect Your Home',
    info: 'All measurements verified by satellite. Tap below to review your estimate.',
    action: () => { zoomToFit(); showAllDrawnLayers(); }
  });

  return steps;
}

function showPresentationStep(idx) {
  const steps = window._presentSteps;
  if(!steps || idx < 0 || idx >= steps.length) return;
  presentationStep = idx;
  const step = steps[idx];
  step.action();
  document.getElementById('presentTitle').textContent = step.title;
  document.getElementById('presentInfo').textContent = step.info;
  document.getElementById('presentStepLabel').textContent = `${idx+1} / ${steps.length}`;
}

function presentNext() {
  if(presentationStep < (window._presentSteps?.length||1) - 1) {
    showPresentationStep(presentationStep + 1);
  } else {
    endPresentation();
    importToEstimate();
  }
}

function presentPrev() {
  if(presentationStep > 0) showPresentationStep(presentationStep - 1);
}

function endPresentation() {
  presentationActive = false;
  const overlay = document.getElementById('presentOverlay');
  if(overlay) overlay.remove();
  const sidebar = document.getElementById('map-sidebar-draw');
  if(sidebar) sidebar.style.display = '';
  showAllDrawnLayers();
}

function hideAllDrawnLayers() {
  drawnLines.forEach(l => {
    if(l.line) l.line.setStyle({opacity:0});
    if(l.lbl) l.lbl.setOpacity(0);
  });
}

function showAllDrawnLayers() {
  drawnLines.forEach(l => {
    if(l.line) l.line.setStyle({opacity:.95});
    if(l.lbl) l.lbl.setOpacity(1);
  });
}

function showOnlyLayers(type) {
  drawnLines.forEach(l => {
    const isPerim = l.type === 4 || l.type === 5;
    const show = (type === 'perim' && isPerim) || type === 'all';
    if(l.line) l.line.setStyle({opacity: show ? .95 : 0});
    if(l.lbl) l.lbl.setOpacity(show ? 1 : 0);
  });
}


// ── FEATURE 8: MULTI-STRUCTURE SUPPORT ───────────────────────────
function addStructure(name) {
  const structName = name || `Structure ${structures.length + 1}`;
  structures.push({
    name: structName,
    facets: [],
    lines: [],
    gutterPts: [],
    gutterDts: [],
    pitch: 1.202
  });
  activeStructureIdx = structures.length - 1;
  renderStructureList();
  showToast(`Added: ${structName}`, 'ok');
}

function switchStructure(idx) {
  if(idx < 0 || idx >= structures.length) return;
  // Save current state to current structure
  saveCurrentToStructure();
  activeStructureIdx = idx;
  loadStructureState(idx);
  renderStructureList();
  showToast(`Switched to: ${structures[idx].name}`, 'info');
}

function saveCurrentToStructure() {
  if(structures.length === 0) return;
  const s = structures[activeStructureIdx];
  if(!s) return;
  s.facets = [...facets];
  s.lines = drawnLines.map(l => ({...l}));
  s.gutterPts = [...gutterPoints];
}

function loadStructureState(idx) {
  const s = structures[idx];
  if(!s) return;
  // Clear current visual state
  drawnLines.forEach(l => {
    drawMap.removeLayer(l.line);
    drawMap.removeLayer(l.lbl);
    if(l.dot1) drawMap.removeLayer(l.dot1);
    if(l.dot2) drawMap.removeLayer(l.dot2);
  });
  facets.forEach(f => {
    if(f.polygon) drawMap.removeLayer(f.polygon);
    if(f.areaLabel) drawMap.removeLayer(f.areaLabel);
  });
  // Load structure state — simplified: just clear for new drawing
  drawnLines = [];
  facets = [];
  perimPoints = [];
  perimDots = [];
  perimSegments = [];
  perimClosed = false;
  perimBaseArea = 0;
  gutterPoints = [];
  gutterDots = [];
  renderLineList(); renderFacetList(); recalc(); recalcGutters();
}

function renameStructure(idx) {
  const s = structures[idx];
  if(!s) return;
  const name = prompt('Rename structure:', s.name);
  if(name && name.trim()) {
    s.name = name.trim();
    renderStructureList();
  }
}

async function removeStructure(idx) {
  // Batch 2 (iOS PWA): see clearDraw above — real async modal in PWA.
  const _ask = window.nbdConfirm || ((m) => Promise.resolve(window.confirm(m)));
  if (!(await _ask(`Remove "${structures[idx]?.name}"?`))) return;
  structures.splice(idx, 1);
  if(activeStructureIdx >= structures.length) activeStructureIdx = Math.max(0, structures.length-1);
  renderStructureList();
  if(structures.length) loadStructureState(activeStructureIdx);
}

function renderStructureList() {
  const el = document.getElementById('structureList');
  if(!el) return;
  if(!structures.length) {
    el.innerHTML = '<p style="font-size:10px;color:var(--m);text-align:center;padding:6px;">Single structure. Add more for garage, shed, etc.</p>';
    return;
  }
  el.innerHTML = structures.map((s, i) => `
    <div class="structure-row ${i===activeStructureIdx?'structure-active':''}" data-mr-action="switchStructure" data-mr-id="${i}">
      <span class="structure-icon">${i===0?'🏠':i===1?'🏗️':'🏚️'}</span>
      <span class="structure-name">${s.name}</span>
      <button class="structure-rename" data-mr-action="renameStructure" data-mr-id="${i}" data-mr-stop="1" title="Rename">✏️</button>
      ${i>0?`<button class="structure-del" data-mr-action="removeStructure" data-mr-id="${i}" data-mr-stop="1" title="Remove">✕</button>`:''}
    </div>
  `).join('');
}

function recalcAllStructures() {
  let totalBase = 0, totalPitched = 0;
  structures.forEach(s => {
    s.facets.forEach(f => {
      if(f.closed && f.baseArea > 0) {
        totalBase += f.baseArea;
        totalPitched += f.baseArea * (f.pitch || 1.202);
      }
    });
  });
  return { totalBase, totalPitched };
}


// ── FEATURE 9: XACTIMATE ESX EXPORT ─────────────────────────────
// Xactimate line item mapping
const XACTIMATE_CODES = {
  0: {code:'RFG RDGV', desc:'Ridge vent - standard', unit:'LF', cat:'Roofing'},
  1: {code:'RFG RDGV', desc:'Ridge vent', unit:'LF', cat:'Roofing'},
  2: {code:'RFG HPRD', desc:'Hip & ridge cap', unit:'LF', cat:'Roofing'},
  3: {code:'RFG VALY', desc:'Valley flashing', unit:'LF', cat:'Roofing'},
  4: {code:'RFG RAKE', desc:'Rake edge detail', unit:'LF', cat:'Roofing'},
  5: {code:'RFG EAVE', desc:'Eave/starter strip', unit:'LF', cat:'Roofing'},
  6: {code:'RFG FLAS', desc:'Flashing - general', unit:'LF', cat:'Roofing'},
  7: {code:'RFG STPF', desc:'Step flashing', unit:'LF', cat:'Roofing'},
  8: {code:'RFG DRPE', desc:'Drip edge', unit:'LF', cat:'Roofing'},
  9: {code:'RFG PRPT', desc:'Parapet cap', unit:'LF', cat:'Roofing'},
  10:{code:'GTR ALUM', desc:'Gutter - aluminum', unit:'LF', cat:'Gutters'},
};

function exportXactimateESX() {
  if(!drawnLines.length) { showToast('No measurements to export', 'info'); return; }

  const addr = document.getElementById('drawSearch')?.value || 'Property';
  const date = new Date().toISOString().split('T')[0];
  const baseSF = parseFloat(document.getElementById('cr-base')?.textContent) || 0;
  const pitchedSF = parseFloat(document.getElementById('cr-pitched')?.textContent) || 0;

  // Group lines by type
  const grouped = {};
  drawnLines.forEach(l => {
    if(!grouped[l.type]) grouped[l.type] = {total:0, count:0, lines:[]};
    grouped[l.type].total += l.dist;
    grouped[l.type].count++;
    grouped[l.type].lines.push(l);
  });

  // Build ESX-compatible XML
  let items = '';
  let itemIdx = 1;

  // Add roof area as main line item
  items += `    <Item seq="${itemIdx++}">
      <Code>RFG LAMI</Code>
      <Description>Remove &amp; Replace - Roofing - Laminated - comp/asphalt shingle</Description>
      <Category>Roofing</Category>
      <Quantity>${(pitchedSF/100).toFixed(2)}</Quantity>
      <Unit>SQ</Unit>
      <Note>Base area: ${baseSF.toFixed(0)} SF, pitched area: ${pitchedSF.toFixed(0)} SF</Note>
    </Item>\n`;

  // Add felt/underlayment
  items += `    <Item seq="${itemIdx++}">
      <Code>RFG FELT</Code>
      <Description>Felt paper - 15 lb.</Description>
      <Category>Roofing</Category>
      <Quantity>${(pitchedSF/100).toFixed(2)}</Quantity>
      <Unit>SQ</Unit>
      <Note>Full roof coverage</Note>
    </Item>\n`;

  // Add each line type
  Object.entries(grouped).forEach(([typeStr, data]) => {
    const typeIdx = parseInt(typeStr);
    const xact = XACTIMATE_CODES[typeIdx];
    if(!xact) return;
    items += `    <Item seq="${itemIdx++}">
      <Code>${xact.code}</Code>
      <Description>${xact.desc}</Description>
      <Category>${xact.cat}</Category>
      <Quantity>${data.total.toFixed(1)}</Quantity>
      <Unit>${xact.unit}</Unit>
      <Note>${data.count} segment(s), total ${data.total.toFixed(1)} LF</Note>
    </Item>\n`;
  });

  // Ice & water shield for eaves
  const eaveLF = grouped[5]?.total || 0;
  if(eaveLF > 0) {
    items += `    <Item seq="${itemIdx++}">
      <Code>RFG ICSHL</Code>
      <Description>Ice &amp; water shield membrane</Description>
      <Category>Roofing</Category>
      <Quantity>${eaveLF.toFixed(1)}</Quantity>
      <Unit>LF</Unit>
      <Note>Along eave line, 3ft width</Note>
    </Item>\n`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<XactimateClaim>
  <ClaimInfo>
    <Address>${addr.replace(/&/g,'&amp;')}</Address>
    <DateOfLoss>${date}</DateOfLoss>
    <CreatedBy>NBD Pro Drawing Tool</CreatedBy>
    <CreatedDate>${date}</CreatedDate>
  </ClaimInfo>
  <Structure name="Main">
    <Room name="Roof">
      <Dimensions>
        <Area unit="SF">${pitchedSF.toFixed(0)}</Area>
        <Perimeter unit="LF">${(eaveLF + (grouped[4]?.total||0)).toFixed(0)}</Perimeter>
      </Dimensions>
      <Items>
${items}      </Items>
    </Room>
  </Structure>
</XactimateClaim>`;

  // Download as file
  const blob = new Blob([xml], {type:'application/xml'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `NBD-Xactimate-${addr.replace(/[^a-zA-Z0-9]/g,'-').substring(0,40)}-${date}.esx`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Xactimate ESX file downloaded — import into Xactimate', 'ok');
}


// ── FEATURE 10: MEASUREMENT COMPARISON MODE ──────────────────────
function openComparisonMode() {
  const modal = document.getElementById('comparisonModal');
  if(modal) modal.style.display = 'flex';
}

function closeComparisonMode() {
  const modal = document.getElementById('comparisonModal');
  if(modal) modal.style.display = 'none';
}

function handleComparisonFile(file) {
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      parseComparisonReport(e.target.result, file.name);
    } catch(err) {
      showToast('Could not parse report: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

async function parseComparisonReport(text, filename) {
  // Try to extract common measurement values from report text
  const data = { source: filename, measurements: {} };

  // Common patterns in roofing reports
  const patterns = [
    {key:'totalArea', regex:/total\s*(?:roof\s*)?area[:\s]*([0-9,.]+)\s*(?:sq\.?\s*ft|sf)/i},
    {key:'ridgeLF',  regex:/ridge[:\s]*([0-9,.]+)\s*(?:lf|ft|lin)/i},
    {key:'hipLF',    regex:/hip[:\s]*([0-9,.]+)\s*(?:lf|ft|lin)/i},
    {key:'valleyLF', regex:/valley[:\s]*([0-9,.]+)\s*(?:lf|ft|lin)/i},
    {key:'eaveLF',   regex:/eave[:\s]*([0-9,.]+)\s*(?:lf|ft|lin)/i},
    {key:'rakeLF',   regex:/rake[:\s]*([0-9,.]+)\s*(?:lf|ft|lin)/i},
    {key:'perimLF',  regex:/perimeter[:\s]*([0-9,.]+)\s*(?:lf|ft|lin)/i},
    {key:'pitch',    regex:/(?:predominant\s*)?pitch[:\s]*(\d+)\s*\/\s*12/i},
    {key:'squares',  regex:/(\d+\.?\d*)\s*squares/i},
    {key:'facets',   regex:/(\d+)\s*(?:facets|sections|planes)/i},
  ];

  patterns.forEach(p => {
    const m = text.match(p.regex);
    if(m) data.measurements[p.key] = parseFloat(m[1].replace(',',''));
  });

  if(Object.keys(data.measurements).length === 0) {
    showToast('No measurements found in report — try a different file format', 'error');
    return;
  }

  comparisonData = data;

  // If regex found <3 fields, try Claude AI extraction
  if (Object.keys(data.measurements).length < 3 && typeof window.callClaude === 'function') {
    showToast('Regex found limited data — trying AI extraction...', 'info');
    try {
      const result = await window.callClaude({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: 'Extract roofing measurements from this report text. Return ONLY a JSON object with these fields (numbers only, no units): totalArea, ridgeLF, hipLF, valleyLF, eaveLF, rakeLF, perimLF, pitch, squares, facets. If a field is not found, omit it.',
        messages: [{ role: 'user', content: text.substring(0, 4000) }]
      });
      const aiText = result?.content?.[0]?.text || '';
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const aiData = JSON.parse(jsonMatch[0]);
        // Merge AI results with regex results (AI fills gaps)
        Object.keys(aiData).forEach(k => {
          if (typeof aiData[k] === 'number' && !data.measurements[k]) {
            data.measurements[k] = aiData[k];
          }
        });
        showToast('AI extracted additional measurements', 'success');
      }
    } catch (e) {
      console.warn('AI extraction failed:', e.message);
    }
  }

  comparisonData = data;
  renderComparison();
}

function renderComparison() {
  if(!comparisonData) return;
  const ext = comparisonData.measurements;
  const el = document.getElementById('comparisonResults');
  if(!el) return;

  // Our measurements
  const ourArea = parseFloat(document.getElementById('cr-base')?.textContent) || 0;
  const ourRidge = drawnLines.filter(l=>l.type===0||l.type===1).reduce((s,l)=>s+l.dist,0);
  const ourHip = drawnLines.filter(l=>l.type===2).reduce((s,l)=>s+l.dist,0);
  const ourValley = drawnLines.filter(l=>l.type===3).reduce((s,l)=>s+l.dist,0);
  const ourEave = drawnLines.filter(l=>l.type===5).reduce((s,l)=>s+l.dist,0);
  const ourRake = drawnLines.filter(l=>l.type===4).reduce((s,l)=>s+l.dist,0);
  const ourPerim = ourEave + ourRake;
  const ourSq = parseFloat(document.getElementById('cr-sq')?.textContent) || 0;

  const comparisons = [
    {label:'Total Area (sf)', ours:ourArea, theirs:ext.totalArea},
    {label:'Ridge (LF)', ours:ourRidge, theirs:ext.ridgeLF},
    {label:'Hip (LF)', ours:ourHip, theirs:ext.hipLF},
    {label:'Valley (LF)', ours:ourValley, theirs:ext.valleyLF},
    {label:'Eave (LF)', ours:ourEave, theirs:ext.eaveLF},
    {label:'Rake (LF)', ours:ourRake, theirs:ext.rakeLF},
    {label:'Perimeter (LF)', ours:ourPerim, theirs:ext.perimLF},
    {label:'Squares', ours:ourSq, theirs:ext.squares},
  ];

  el.innerHTML = `<div style="font-size:9px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--orange);margin-bottom:8px;">Comparison: ${comparisonData.source}</div>` +
    comparisons.filter(c => c.theirs !== undefined).map(c => {
      const diff = c.ours > 0 && c.theirs > 0 ? ((c.ours - c.theirs) / c.theirs * 100) : null;
      const diffClass = diff !== null ? (Math.abs(diff) <= 5 ? 'comp-match' : Math.abs(diff) <= 15 ? 'comp-warn' : 'comp-off') : 'comp-na';
      const diffLabel = diff !== null ? (diff > 0 ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`) : '—';
      return `<div class="comp-row ${diffClass}">
        <span class="comp-label">${c.label}</span>
        <span class="comp-ours">${typeof c.ours === 'number' ? c.ours.toFixed(1) : '—'}</span>
        <span class="comp-theirs">${typeof c.theirs === 'number' ? c.theirs.toFixed(1) : '—'}</span>
        <span class="comp-diff">${diffLabel}</span>
      </div>`;
    }).join('');

  // Match score
  const scored = comparisons.filter(c => c.theirs !== undefined && c.ours > 0);
  const matchPcts = scored.map(c => 100 - Math.min(100, Math.abs((c.ours - c.theirs) / c.theirs * 100)));
  const avgMatch = matchPcts.length > 0 ? Math.round(matchPcts.reduce((a, b) => a + b, 0) / matchPcts.length) : 0;

  el.innerHTML += `<div style="margin-top:12px;padding:12px;background:var(--s2,#181c22);border:1px solid var(--br,#2a2f35);border-radius:6px;">
    <div style="font-size:10px;color:var(--m);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;">Match Score</div>
    <div style="font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;color:${avgMatch >= 90 ? 'var(--green)' : avgMatch >= 70 ? 'var(--gold)' : 'var(--red)'};">${avgMatch}%</div>
  </div>`;

  // Supplement letter button (only show if differences > 5%)
  const bigDiffs = comparisons.filter(c => c.theirs !== undefined && c.ours > 0 && Math.abs((c.ours - c.theirs) / c.theirs * 100) > 5);
  if (bigDiffs.length > 0) {
    el.innerHTML += `<button class="btn btn-orange" style="width:100%;margin-top:10px;justify-content:center;" data-mr-action="generateSupplementFromComparison">📝 Generate Supplement Letter</button>`;
  }

  // Manual entry link
  el.innerHTML += `<button class="btn btn-ghost" style="width:100%;margin-top:6px;justify-content:center;font-size:10px;" data-mr-action="openManualComparisonEntry">✏️ Enter Report Values Manually</button>`;

  el.style.display = 'block';
  closeComparisonMode();
  showToast('Comparison loaded — match score: ' + avgMatch + '%', avgMatch >= 80 ? 'success' : 'warning');
}

// ── Manual comparison entry ──
function openManualComparisonEntry() {
  const fields = ['totalArea','ridgeLF','hipLF','valleyLF','eaveLF','rakeLF','squares'];
  const labels = ['Total Area (SF)','Ridge (LF)','Hip (LF)','Valley (LF)','Eave (LF)','Rake (LF)','Squares'];
  const current = comparisonData?.measurements || {};
  const html = fields.map((f, i) =>
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">'
    + '<label style="font-size:11px;color:var(--m);width:120px;">' + labels[i] + '</label>'
    + '<input type="number" id="mc_' + f + '" value="' + (current[f] || '') + '" placeholder="0" style="flex:1;background:var(--s2);border:1px solid var(--br);border-radius:4px;padding:6px 8px;color:var(--t);font-size:12px;">'
    + '</div>'
  ).join('');
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = '<div style="background:var(--s,#1a1d23);border:1px solid var(--br);border-radius:12px;padding:24px;max-width:400px;width:100%;">'
    + '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:18px;font-weight:800;color:var(--t);margin-bottom:14px;">Enter Report Measurements</div>'
    + html
    + '<div style="display:flex;gap:8px;margin-top:14px;">'
    + '<button class="btn btn-ghost" data-mr-action="closeManualOverlay" style="flex:1;justify-content:center;">Cancel</button>'
    + '<button class="btn btn-orange" data-mr-action="applyManualComparisonAndClose" style="flex:1;justify-content:center;">Compare</button>'
    + '</div></div>';
  document.body.appendChild(modal);
}

function applyManualComparison() {
  const fields = ['totalArea','ridgeLF','hipLF','valleyLF','eaveLF','rakeLF','squares'];
  const data = { source: 'Manual Entry', measurements: {} };
  fields.forEach(f => {
    const val = parseFloat(document.getElementById('mc_' + f)?.value);
    if (val > 0) data.measurements[f] = val;
  });
  if (Object.keys(data.measurements).length === 0) {
    showToast('Enter at least one measurement', 'error');
    return;
  }
  comparisonData = data;
  renderComparison();
}

// ── Auto-generate supplement letter from comparison differences ──
function generateSupplementFromComparison() {
  if (!comparisonData) { showToast('Run a comparison first', 'error'); return; }
  const ext = comparisonData.measurements;
  const addr = document.getElementById('drawSearch')?.value || 'Property Address';
  const ourArea = parseFloat(document.getElementById('cr-base')?.textContent) || 0;
  const ourRidge = drawnLines.filter(l => l.type === 0 || l.type === 1).reduce((s, l) => s + l.dist, 0);
  const ourHip = drawnLines.filter(l => l.type === 2).reduce((s, l) => s + l.dist, 0);
  const ourValley = drawnLines.filter(l => l.type === 3).reduce((s, l) => s + l.dist, 0);
  const ourEave = drawnLines.filter(l => l.type === 5).reduce((s, l) => s + l.dist, 0);
  const ourRake = drawnLines.filter(l => l.type === 4).reduce((s, l) => s + l.dist, 0);

  const diffs = [
    { label: 'Total Roof Area', ours: ourArea, theirs: ext.totalArea, unit: 'SF' },
    { label: 'Ridge Length', ours: ourRidge, theirs: ext.ridgeLF, unit: 'LF' },
    { label: 'Hip Length', ours: ourHip, theirs: ext.hipLF, unit: 'LF' },
    { label: 'Valley Length', ours: ourValley, theirs: ext.valleyLF, unit: 'LF' },
    { label: 'Eave Length', ours: ourEave, theirs: ext.eaveLF, unit: 'LF' },
    { label: 'Rake Length', ours: ourRake, theirs: ext.rakeLF, unit: 'LF' }
  ].filter(d => d.theirs && d.ours > 0 && Math.abs(d.ours - d.theirs) > 1);

  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const diffRows = diffs.map(d => {
    const diff = d.ours - d.theirs;
    return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${d.label}</td>`
      + `<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${d.theirs.toFixed(1)} ${d.unit}</td>`
      + `<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${d.ours.toFixed(1)} ${d.unit}</td>`
      + `<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:${diff > 0 ? '#c53030' : '#22c55e'};font-weight:700;">${diff > 0 ? '+' : ''}${diff.toFixed(1)} ${d.unit}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Supplement Request — ${addr}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Barlow',sans-serif;padding:36px;max-width:860px;margin:0 auto;}
.hdr{display:flex;justify-content:space-between;padding-bottom:18px;border-bottom:3px solid #e8720c;margin-bottom:24px;}
.brand{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;text-transform:uppercase;}.brand span{color:#e8720c;}
.badge{font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#e8720c;border:1px solid #e8720c;padding:2px 9px;border-radius:2px;display:inline-block;margin-top:5px;}
h2{font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#e8720c;margin:20px 0 10px;border-bottom:1px solid #eee;padding-bottom:4px;}
table{width:100%;border-collapse:collapse;}th{background:#0a0c0f;color:#fff;font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:8px 10px;text-align:left;}
td{font-size:12px;}.note{background:#fff8f0;border-left:4px solid #e8720c;padding:14px;margin:16px 0;font-size:13px;line-height:1.6;}
.sig{margin-top:40px;border-top:1px solid #eee;padding-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:40px;}
.sig-line{border-top:1px solid #333;padding-top:6px;font-size:11px;color:#666;margin-top:50px;}
.foot{margin-top:30px;font-size:10px;color:#999;display:flex;justify-content:space-between;}
@media print{body{padding:20px;}@page{margin:1.5cm;size:letter;}}</style></head><body>
<div class="hdr"><div><div class="brand">No Big Deal <span>Home Solutions</span></div><div class="badge">Supplement Request</div></div>
<div style="text-align:right;"><div style="font-size:14px;font-weight:600;">${addr}</div><div style="font-size:11px;color:#666;">${date}</div></div></div>
<p style="font-size:13px;line-height:1.6;margin-bottom:16px;">To Whom It May Concern,</p>
<p style="font-size:13px;line-height:1.6;margin-bottom:16px;">After conducting our own detailed field measurements at the above property, we have identified discrepancies between our measurements and the carrier's approved scope. We respectfully request a supplemental review based on the following documented differences:</p>
<h2>Measurement Comparison</h2>
<table><thead><tr><th>Measurement</th><th style="text-align:right;">Report Value</th><th style="text-align:right;">Our Measurement</th><th style="text-align:right;">Difference</th></tr></thead><tbody>${diffRows}</tbody></table>
<div class="note"><strong>Note:</strong> Our measurements were taken using satellite imagery analysis with the NBD Pro Drawing Tool and verified against on-site inspection. All measurements are in linear feet (LF) or square feet (SF) as indicated.</div>
<p style="font-size:13px;line-height:1.6;margin-top:16px;">We kindly request that the scope be adjusted to reflect the accurate measurements documented above. We are available to meet with the adjuster on-site to verify these measurements if needed.</p>
<div class="sig"><div><div class="sig-line">Contractor Signature</div></div><div><div class="sig-line">Date</div></div></div>
<div class="foot"><span>No Big Deal Home Solutions · (859) 420-7382 · nobigdealwithjoedeal.com</span><span>Generated by NBD Pro</span></div>
</body></html>`;

  if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
    window.NBDDocViewer.open({ html, title: 'Supplement Request — ' + addr, filename: 'NBD-Supplement-' + date.replace(/\s/g, '') + '.pdf' });
  } else {
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  }
}


// ╔═══════════════════════════════════════════════════════════════════╗
// ║  END WOW FEATURES                                                ║
// ╚═══════════════════════════════════════════════════════════════════╝

// ── CSP-SAFE EVENT DELEGATION (data-mr-action) ──────────────────
// Prod CSP `script-src-attr 'none'` kills inline onclicks injected via
// innerHTML (line-popup buttons, accessory toggles, structure rows,
// present-mode nav, supplement-comparison overlay). The line-list got
// its own delegate in PR #453; this catches everything else.
(function () {
  if (window._NBD_MR_DELEGATE_BOUND) return;
  window._NBD_MR_DELEGATE_BOUND = true;

  function closeDrawMapPopup() {
    if (typeof drawMap !== 'undefined' && drawMap && typeof drawMap.closePopup === 'function') {
      drawMap.closePopup();
    }
  }

  document.addEventListener('click', function (ev) {
    const t = ev.target.closest && ev.target.closest('[data-mr-action]');
    if (!t) return;
    if (t.dataset.mrStop === '1') ev.stopPropagation();
    const action = t.dataset.mrAction;
    const id = t.dataset.mrId;
    const arg2 = t.dataset.mrArg2;
    try {
      switch (action) {
        case 'retypeLine':       if (typeof retypeLine === 'function') retypeLine(parseInt(id, 10), parseInt(arg2, 10)); closeDrawMapPopup(); break;
        case 'deleteLine':       if (typeof deleteLine === 'function') deleteLine(parseInt(id, 10)); closeDrawMapPopup(); break;
        case 'editLineLength':   if (typeof editLineLength === 'function') editLineLength(parseInt(id, 10)); closeDrawMapPopup(); break;
        case 'toggleAccessoryMode': if (typeof toggleAccessoryMode === 'function') toggleAccessoryMode(id); break;
        case 'presentPrev':      if (typeof presentPrev === 'function') presentPrev(); break;
        case 'presentNext':      if (typeof presentNext === 'function') presentNext(); break;
        case 'endPresentation':  if (typeof endPresentation === 'function') endPresentation(); break;
        case 'switchStructure':  if (typeof switchStructure === 'function') switchStructure(parseInt(id, 10)); break;
        case 'renameStructure':  if (typeof renameStructure === 'function') renameStructure(parseInt(id, 10)); break;
        case 'removeStructure':  if (typeof removeStructure === 'function') removeStructure(parseInt(id, 10)); break;
        case 'generateSupplementFromComparison': if (typeof generateSupplementFromComparison === 'function') generateSupplementFromComparison(); break;
        case 'openManualComparisonEntry': if (typeof openManualComparisonEntry === 'function') openManualComparisonEntry(); break;
        case 'closeManualOverlay': {
          const overlay = t.closest('div[style*=fixed]');
          if (overlay) overlay.remove();
          break;
        }
        case 'applyManualComparisonAndClose': {
          if (typeof applyManualComparison === 'function') applyManualComparison();
          const overlay = t.closest('div[style*=fixed]');
          if (overlay) overlay.remove();
          break;
        }
        default:
          console.warn('[maps-routing] no dispatch for', action);
      }
    } catch (e) {
      console.error('[maps-routing] dispatch ' + action + ' failed:', e);
    }
  });
})();

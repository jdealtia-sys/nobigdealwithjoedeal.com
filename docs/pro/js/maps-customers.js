/**
 * maps-customers.js — "Customers" map layer: plot EVERY customer/lead
 * from the CRM book on the main map, with a control panel to COLOR BY and
 * FILTER on multiple dimensions, and zoom-gated deal-value labels.
 *
 * Sibling module of maps-core.js / maps-overlays.js / maps-routing.js
 * (Step 4d split). Load order in dashboard.html:
 *
 *   core → overlays → customers → routing → maps (shim)
 *
 * Why a dedicated layer (vs the Jobs overlay / D2D pins):
 *   - Jobs overlay only shows job-stage leads, geocoded live and capped.
 *   - D2D `_pins` are door-knock activity; most customers have no pin.
 *   - This layer is driven by `window._leads` (company-scoped for the team) so
 *     it shows the WHOLE book.
 *
 * Control panel (floating, bottom-left):
 *   - COLOR BY — Stage/Role · Damage Type · Deal Value. Recolours the dots and
 *     regenerates the legend for the chosen dimension.
 *   - LEGEND / FILTER — click a category chip to show/hide it. Filters compose
 *     ACROSS dimensions (AND): e.g. color by Stage, but filter Damage=Hail and
 *     Value=$25k+ at the same time via the "＋ Filters" section.
 *   - ZOOM-GATED LABELS — past z≥16 a lead's dot blooms into a 💰 $value pill;
 *     zoomed out it's a clean coloured dot. Clusters at low zoom.
 *
 * Coordinates: new leads persist lat/lng at save; older / edited-address leads
 * are lazily geocoded here (fair-use capped) and persisted via
 * window._saveLeadCoords — a rolling backfill.
 *
 * Depends on sibling-scope globals: mainMap, overlayState, L, geocode,
 * _mapsEscHtml / _mapsEscJsInAttr. Consumes window.*: _leads, stageRole,
 * STAGE_META, normalizeStage, _saveLeadCoords. Classic-script — no import/export.
 */

let customersLayer = null;
let _custPanelEl = null;                  // floating control panel DOM
const _custGeocodeCache = new Map();      // address(lower) → {lat,lng} | null
const _CUST_GEOCODE_CAP = 12;             // max live geocodes per build (fair-use)
const _CUST_LABEL_ZOOM = 16;              // ≥ this zoom → show $ value labels
let _custZoomWired = false;
let _custFiltersOpen = false;             // "＋ Filters" panel expanded?

// ── DIMENSIONS ──────────────────────────────────────────────────────────
// Each dimension: catOf(lead) → category key; cats = ordered [{key,label,color}].
// The role palette mirrors the kanban.
const _CUST_ROLE_COLORS = { new: '#9CA3AF', active: '#4A9EFF', job: '#0D9488', won: '#22C55E', lost: '#E05252' };
const _CUST_ROLE_LABELS = { new: 'New', active: 'Active', job: 'In Production', won: 'Won', lost: 'Lost' };
const _CUST_ROLE_ORDER  = ['new', 'active', 'job', 'won', 'lost'];

function _custRoleOf(lead) {
  const key = lead._stageKey
    || (typeof window.normalizeStage === 'function' ? window.normalizeStage(lead.stage) : (lead.stage || 'new'));
  if (typeof window.stageRole === 'function') { try { return window.stageRole(key); } catch (_) {} }
  return lead._stageRole || 'active';
}

function _custValueOf(lead) {
  return parseFloat(lead.jobValue || lead.value || lead.contractValue || 0) || 0;
}

// Damage families — normalise the free-ish damageType text to a peril bucket.
const _CUST_DAMAGE_CATS = [
  { key: 'hailwind', label: 'Hail & Wind', color: '#7c3aed' },
  { key: 'hail',     label: 'Hail',        color: '#4A9EFF' },
  { key: 'wind',     label: 'Wind',        color: '#0891b2' },
  { key: 'fire',     label: 'Fire',        color: '#ea580c' },
  { key: 'water',    label: 'Water',       color: '#0ea5e9' },
  { key: 'gutters',  label: 'Gutters',     color: '#a16207' },
  { key: 'full',     label: 'Full Exterior', color: '#16a34a' },
  { key: 'other',    label: 'Other',       color: '#9B6DFF' },
  { key: 'unset',    label: 'Unset',       color: '#6B7280' },
];
function _custDamageKey(lead) {
  const d = String(lead.damageType || '').toLowerCase().trim();
  if (!d) return 'unset';
  const hasHail = d.indexOf('hail') !== -1, hasWind = d.indexOf('wind') !== -1;
  if (hasHail && hasWind) return 'hailwind';
  if (hasHail) return 'hail';
  if (hasWind) return 'wind';
  if (d.indexOf('fire') !== -1) return 'fire';
  if (d.indexOf('water') !== -1) return 'water';
  if (d.indexOf('gutter') !== -1) return 'gutters';
  if (d.indexOf('full') !== -1) return 'full';
  return 'other';
}

// Deal-value tiers.
const _CUST_VALUE_CATS = [
  { key: 'v4', label: '$50k+',     color: '#16a34a', test: v => v >= 50000 },
  { key: 'v3', label: '$25–50k',   color: '#22C55E', test: v => v >= 25000 && v < 50000 },
  { key: 'v2', label: '$10–25k',   color: '#D4A017', test: v => v >= 10000 && v < 25000 },
  { key: 'v1', label: '< $10k',    color: '#4A9EFF', test: v => v > 0 && v < 10000 },
  { key: 'v0', label: 'No value',  color: '#6B7280', test: v => !(v > 0) },
];
function _custValueKey(lead) {
  const v = _custValueOf(lead);
  const t = _CUST_VALUE_CATS.find(c => c.test(v));
  return t ? t.key : 'v0';
}

const _CUST_DIMENSIONS = {
  stage:  { label: 'Stage / Role', order: _CUST_ROLE_ORDER,
            cats: _CUST_ROLE_ORDER.map(r => ({ key: r, label: _CUST_ROLE_LABELS[r], color: _CUST_ROLE_COLORS[r] })),
            catOf: _custRoleOf },
  damage: { label: 'Damage Type', cats: _CUST_DAMAGE_CATS, catOf: _custDamageKey },
  value:  { label: 'Deal Value',  cats: _CUST_VALUE_CATS.map(c => ({ key: c.key, label: c.label, color: c.color })), catOf: _custValueKey },
};
const _CUST_DIM_KEYS = ['stage', 'damage', 'value'];

// Active color-by dimension + per-dimension filter sets (null = all visible).
let _custColorBy = 'stage';
const _custFilters = { stage: null, damage: null, value: null };

function _custColorForCat(dimKey, catKey) {
  const dim = _CUST_DIMENSIONS[dimKey];
  const c = dim && dim.cats.find(x => x.key === catKey);
  return (c && c.color) || '#6B7280';
}
// A lead's dot colour = its category colour in the ACTIVE color-by dimension.
function _custColorOf(lead) {
  const dim = _CUST_DIMENSIONS[_custColorBy] || _CUST_DIMENSIONS.stage;
  return _custColorForCat(_custColorBy, dim.catOf(lead));
}
// Visible if it passes EVERY dimension's filter (AND).
function _custPasses(lead) {
  for (const dk of _CUST_DIM_KEYS) {
    const f = _custFilters[dk];
    if (f && !f.has(_CUST_DIMENSIONS[dk].catOf(lead))) return false;
  }
  return true;
}

function _custStageLabel(lead) {
  const key = lead._stageKey
    || (typeof window.normalizeStage === 'function' ? window.normalizeStage(lead.stage) : (lead.stage || 'new'));
  const meta = (window.STAGE_META && window.STAGE_META[key]) || null;
  return (meta && meta.label) || lead.stage || 'New';
}
function _custName(lead) {
  const n = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim();
  return n || lead.name || lead.address || 'Customer';
}
function _custMoney(v) {
  if (!(v > 0)) return '';
  return v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + v;
}

// Dot, or (past label zoom + has value) a 💰 $value pill.
function _custIcon(lead, color, labelMode) {
  const esc = (typeof _mapsEscHtml === 'function') ? _mapsEscHtml : (s => String(s || ''));
  const c = esc(color);
  const v = _custValueOf(lead);
  if (labelMode && v > 0) {
    const html = `<div style="background:${c};color:#0A0C0F;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:800;`
      + `padding:2px 6px;border-radius:5px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.25);">💰 ${esc(_custMoney(v))}</div>`;
    return L.divIcon({ html, iconAnchor: [0, 0], className: '' });
  }
  const inner = lead.isProspect
    ? `<div style="width:12px;height:12px;border-radius:50%;background:transparent;border:3px solid ${c};box-shadow:0 1px 4px rgba(0,0,0,.5);"></div>`
    : `<div style="width:14px;height:14px;border-radius:50%;background:${c};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.55);"></div>`;
  return L.divIcon({ html: inner, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -9], className: '' });
}

function _custPopupHTML(lead) {
  const esc  = (typeof _mapsEscHtml === 'function') ? _mapsEscHtml : (s => String(s || ''));
  const escA = (typeof _mapsEscJsInAttr === 'function') ? _mapsEscJsInAttr : esc;
  const color = _custColorOf(lead);
  const addr  = String(lead.address || '').split(',').slice(0, 2).join(',');
  const val   = _custValueOf(lead);
  const stage = _custStageLabel(lead);
  const tag   = lead.isProspect ? ' · prospect' : '';
  return `<div class="pin-lead-popup">
    <div class="plp-header">
      <div class="plp-name" style="color:${esc(color)};">${esc(_custName(lead))}</div>
      <div class="plp-addr">${esc(addr)}${esc(tag)}</div>
    </div>
    <div class="plp-body">
      <div class="plp-row"><span class="plp-key">Stage</span><span class="plp-val">${esc(stage)}</span></div>
      ${lead.damageType ? `<div class="plp-row"><span class="plp-key">Damage</span><span class="plp-val">${esc(lead.damageType)}</span></div>` : ''}
      ${val > 0 ? `<div class="plp-row"><span class="plp-key">Value</span><span class="plp-val" style="color:${esc(color)};">$${esc(val.toLocaleString())}</span></div>` : ''}
    </div>
    <div class="plp-btns">
      <button class="plp-btn-go" data-mo-action="goToLeadFromPin" data-mo-id="${escA(lead.id)}">→ Go to Lead</button>
    </div>
  </div>`;
}

function _addCustomerMarker(lead, lat, lng, labelMode) {
  const m = L.marker([lat, lng], { icon: _custIcon(lead, _custColorOf(lead), labelMode) });
  m.bindPopup(_custPopupHTML(lead), { maxWidth: 260, minWidth: 200, className: 'nbd-pin-popup', closeButton: true });
  customersLayer.addLayer(m);
}

function _ensureCustomersLayer() {
  if (customersLayer) return;
  customersLayer = (typeof L.markerClusterGroup === 'function')
    ? L.markerClusterGroup({ maxClusterRadius: 50, showCoverageOnHover: false, disableClusteringAtZoom: 18 })
    : L.layerGroup();
}

// Build (or rebuild) the layer from window._leads, honouring color-by + all
// filters, geocoding+persisting missing coords (capped), refreshing the panel.
async function buildCustomersLayer() {
  if (!mainMap) return;
  _ensureCustomersLayer();
  customersLayer.clearLayers();

  const labelMode = mainMap.getZoom && mainMap.getZoom() >= _CUST_LABEL_ZOOM;
  const leads = window._leads || [];
  // Counts for the ACTIVE color-by dimension's legend (post other-dim filters).
  const counts = {};
  let liveRequests = 0;

  for (const lead of leads) {
    if (!lead || lead.deleted) continue;
    if (!_custPasses(lead)) continue; // AND across every dimension's filter

    const catForLegend = _CUST_DIMENSIONS[_custColorBy].catOf(lead);

    // 1) Already geocoded — plot now.
    const haveLat = lead.lat != null && lead.lat !== '';
    const haveLng = lead.lng != null && lead.lng !== '';
    if (haveLat && haveLng) {
      const la = parseFloat(lead.lat), ln = parseFloat(lead.lng);
      if (!isNaN(la) && !isNaN(ln)) { _addCustomerMarker(lead, la, ln, labelMode); counts[catForLegend] = (counts[catForLegend] || 0) + 1; }
      continue;
    }

    // 2) No coords but has address — lazy geocode + persist (backfill).
    const addr = lead.address || lead.addr || '';
    if (!addr) continue;
    const key = addr.trim().toLowerCase();
    let geo = _custGeocodeCache.get(key);
    if (geo === undefined) {
      if (liveRequests >= _CUST_GEOCODE_CAP) continue;
      if (typeof geocode !== 'function') continue;
      try { geo = await geocode(addr); } catch (_) { geo = null; }
      geo = geo ? { lat: parseFloat(geo.lat), lng: parseFloat(geo.lon) } : null;
      _custGeocodeCache.set(key, geo);
      liveRequests++;
      await new Promise(r => setTimeout(r, 1100)); // Nominatim fair-use
    }
    if (!geo || isNaN(geo.lat) || isNaN(geo.lng)) continue;

    lead.lat = geo.lat; lead.lng = geo.lng;
    if (typeof window._saveLeadCoords === 'function' && lead.id && !String(lead.id).startsWith('d-')) {
      try { window._saveLeadCoords(lead.id, geo.lat, geo.lng); } catch (_) {}
    }
    _addCustomerMarker(lead, geo.lat, geo.lng, labelMode);
    counts[catForLegend] = (counts[catForLegend] || 0) + 1;
  }

  _renderCustPanel(counts);

  if (liveRequests >= _CUST_GEOCODE_CAP && typeof showToast === 'function') {
    showToast('Placed the first batch of un-mapped customers — reopen the layer to map more', 'info');
  }
}

// ── CONTROL PANEL (color-by + legend/filter + cross-dim filters) ─────────
function _injectCustPanelCss() {
  if (document.getElementById('cust-panel-style')) return;
  const s = document.createElement('style');
  s.id = 'cust-panel-style';
  s.textContent =
    '.nbd-cust-panel{position:absolute;left:12px;bottom:22px;z-index:600;background:rgba(10,12,15,.88);'
    + 'border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:9px 10px;font-family:sans-serif;'
    + 'box-shadow:0 4px 16px rgba(0,0,0,.5);backdrop-filter:blur(4px);width:186px;max-height:60vh;overflow:auto;}'
    + '.nbd-cust-panel .ncp-row{display:flex;align-items:center;gap:6px;margin-bottom:7px;}'
    + '.nbd-cust-panel .ncp-lbl{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#9aa4b2;font-weight:700;}'
    + '.nbd-cust-panel select{flex:1;background:#171b21;color:#e7ebf0;border:1px solid rgba(255,255,255,.16);border-radius:6px;font-size:12px;padding:3px 5px;}'
    + '.nbd-cust-panel .ncp-chip{display:flex;align-items:center;gap:7px;width:100%;background:none;border:none;padding:3px 4px;border-radius:6px;cursor:pointer;color:#e7ebf0;font-size:12px;text-align:left;}'
    + '.nbd-cust-panel .ncp-chip:hover{background:rgba(255,255,255,.07);}'
    + '.nbd-cust-panel .ncp-chip.off{opacity:.38;}'
    + '.nbd-cust-panel .ncp-dot{width:11px;height:11px;border-radius:50%;flex:0 0 auto;border:1px solid rgba(255,255,255,.5);}'
    + '.nbd-cust-panel .ncp-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
    + '.nbd-cust-panel .ncp-cnt{color:#9aa4b2;font-variant-numeric:tabular-nums;}'
    + '.nbd-cust-panel .ncp-more{width:100%;background:none;border:none;border-top:1px solid rgba(255,255,255,.12);margin-top:6px;padding-top:6px;'
    + 'color:#9aa4b2;font-size:11px;cursor:pointer;text-align:left;}'
    + '.nbd-cust-panel .ncp-group-lbl{font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#7f8894;margin:6px 2px 3px;font-weight:700;}';
  document.head.appendChild(s);
}

// Chip row markup for a dimension (used by the legend + the filter groups).
function _custChipsHTML(dimKey, counts) {
  const esc = (typeof _mapsEscHtml === 'function') ? _mapsEscHtml : (s => String(s || ''));
  const dim = _CUST_DIMENSIONS[dimKey];
  const filter = _custFilters[dimKey];
  let html = '';
  dim.cats.forEach(function (c) {
    const off = (filter && !filter.has(c.key)) ? ' off' : '';
    const cnt = counts ? ('<span class="ncp-cnt">' + (counts[c.key] || 0) + '</span>') : '';
    html += '<button type="button" class="ncp-chip' + off + '" data-cust-dim="' + esc(dimKey) + '" data-cust-cat="' + esc(c.key) + '">'
      + '<span class="ncp-dot" style="background:' + esc(c.color) + ';"></span>'
      + '<span class="ncp-name">' + esc(c.label) + '</span>' + cnt + '</button>';
  });
  return html;
}

function _renderCustPanel(counts) {
  if (!mainMap) return;
  const container = mainMap.getContainer && mainMap.getContainer();
  if (!container) return;
  _injectCustPanelCss();
  if (!_custPanelEl) {
    _custPanelEl = document.createElement('div');
    _custPanelEl.className = 'nbd-cust-panel';
    container.appendChild(_custPanelEl);
    if (L.DomEvent) { L.DomEvent.disableClickPropagation(_custPanelEl); L.DomEvent.disableScrollPropagation(_custPanelEl); }
  }
  const esc = (typeof _mapsEscHtml === 'function') ? _mapsEscHtml : (s => String(s || ''));
  let html = '';
  // Color-by selector.
  html += '<div class="ncp-row"><span class="ncp-lbl">Color</span>'
    + '<select data-cust-colorby>';
  _CUST_DIM_KEYS.forEach(function (dk) {
    html += '<option value="' + dk + '"' + (_custColorBy === dk ? ' selected' : '') + '>' + esc(_CUST_DIMENSIONS[dk].label) + '</option>';
  });
  html += '</select></div>';
  // Legend for the active color-by dimension (counts + click-to-filter).
  html += _custChipsHTML(_custColorBy, counts);
  // Cross-dimension filters (the OTHER dims), collapsible.
  const others = _CUST_DIM_KEYS.filter(function (d) { return d !== _custColorBy; });
  const anyOtherFilter = others.some(function (d) { return !!_custFilters[d]; });
  html += '<button type="button" class="ncp-more" data-cust-morefilters>'
    + (_custFiltersOpen ? '▾' : '▸') + ' Filters' + (anyOtherFilter ? ' •' : '') + '</button>';
  if (_custFiltersOpen) {
    others.forEach(function (dk) {
      html += '<div class="ncp-group-lbl">' + esc(_CUST_DIMENSIONS[dk].label) + '</div>';
      html += _custChipsHTML(dk, null);
    });
  }
  _custPanelEl.innerHTML = html;

  if (!_custPanelEl._wired) {
    _custPanelEl._wired = true;
    // Color-by change.
    _custPanelEl.addEventListener('change', function (e) {
      const sel = e.target && e.target.closest && e.target.closest('[data-cust-colorby]');
      if (!sel) return;
      if (_CUST_DIMENSIONS[sel.value]) { _custColorBy = sel.value; buildCustomersLayer(); }
    });
    // Chip toggle (legend + filter groups) and "＋ Filters".
    _custPanelEl.addEventListener('click', function (e) {
      const more = e.target && e.target.closest && e.target.closest('[data-cust-morefilters]');
      if (more) { _custFiltersOpen = !_custFiltersOpen; _renderCustPanel(counts); return; }
      const chip = e.target && e.target.closest && e.target.closest('[data-cust-cat]');
      if (!chip) return;
      const dk = chip.getAttribute('data-cust-dim');
      const cat = chip.getAttribute('data-cust-cat');
      const dim = _CUST_DIMENSIONS[dk];
      if (!dim) return;
      if (!_custFilters[dk]) _custFilters[dk] = new Set(dim.cats.map(function (c) { return c.key; }));
      const f = _custFilters[dk];
      if (f.has(cat)) { if (f.size > 1) f.delete(cat); } else { f.add(cat); }
      // If a dimension's filter is back to "all", drop it (null = no filter).
      if (f.size === dim.cats.length) _custFilters[dk] = null;
      buildCustomersLayer();
    });
  }
  _custPanelEl.style.display = '';
}
function _hideCustPanel() { if (_custPanelEl) _custPanelEl.style.display = 'none'; }

// Re-icon (dot ↔ $ label) when crossing the label-zoom threshold.
function _wireCustZoom() {
  if (_custZoomWired || !mainMap) return;
  _custZoomWired = true;
  let wasLabel = mainMap.getZoom() >= _CUST_LABEL_ZOOM;
  mainMap.on('zoomend', function () {
    if (!overlayState || !overlayState.customers) return;
    const nowLabel = mainMap.getZoom() >= _CUST_LABEL_ZOOM;
    if (nowLabel !== wasLabel) { wasLabel = nowLabel; buildCustomersLayer(); }
  });
}

function showCustomersLayer() {
  _ensureCustomersLayer();
  _wireCustZoom();
  if (customersLayer.getLayers().length === 0) { buildCustomersLayer(); }
  else if (_custPanelEl) { _custPanelEl.style.display = ''; }
  customersLayer.addTo(mainMap);
}
function hideCustomersLayer() { if (customersLayer && mainMap) mainMap.removeLayer(customersLayer); _hideCustPanel(); }

function refreshCustomersLayer() { if (overlayState && overlayState.customers) { buildCustomersLayer(); } }

if (typeof window !== 'undefined') {
  window.buildCustomersLayer   = buildCustomersLayer;
  window.showCustomersLayer    = showCustomersLayer;
  window.hideCustomersLayer    = hideCustomersLayer;
  window.refreshCustomersLayer = refreshCustomersLayer;
}

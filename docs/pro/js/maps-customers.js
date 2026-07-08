/**
 * maps-customers.js — "Customers" map layer: plot EVERY customer/lead
 * from the CRM book on the main map, colour-coded by the freeform-pipeline
 * SEMANTIC ROLE (new / active / job / won / lost) so it reads the same as
 * the kanban.
 *
 * Sibling module of maps-core.js / maps-overlays.js / maps-routing.js
 * (Step 4d split). Load order in dashboard.html:
 *
 *   core → overlays → customers → routing → maps (shim)
 *
 * Why a dedicated layer (vs the existing Jobs overlay / D2D pins):
 *   - Jobs overlay only shows leads in job stages, geocoded live and capped.
 *   - D2D `_pins` are door-knock activity, and a lead only gets a pin if it was
 *     CREATED from a pin/knock — most customers have none.
 *   - This layer is driven by `window._leads` (already company-scoped for the
 *     team) so it shows the WHOLE book, and colours by window.stageRole() /
 *     window.STAGE_META so a tenant's custom stages "just work".
 *
 * Coordinates: new leads persist lat/lng at save time (dashboard-bootstrap
 * `_saveLead`). Leads that predate that — or whose address changed — are
 * lazily geocoded here (fair-use capped, same 1.1s spacing as the Jobs
 * overlay) and the result is persisted back via window._saveLeadCoords so it
 * only happens once per address (a rolling backfill).
 *
 * UX: markers CLUSTER at low zoom (L.markerClusterGroup, same as the D2D pins)
 * so a big book stays readable, and a floating LEGEND lets you toggle roles on
 * and off (per-role show/hide).
 *
 * Depends on sibling-scope globals: mainMap, overlayState, L, geocode
 * (dashboard-api.js), _mapsEscHtml / _mapsEscJsInAttr (maps-overlays.js).
 * Consumes window.* engine surface: _leads, stageRole, STAGE_META,
 * normalizeStage, STAGE_ROLE, _saveLeadCoords. Classic-script — no import/export.
 */

// Dedicated layer group (NOT the pin cluster — that's for door-knock _pins).
// Clusters when the plugin is present (it is — maps-core uses it for pins),
// else a plain layerGroup.
let customersLayer = null;
let _custLegendEl = null;                 // floating legend DOM (built once)
const _custGeocodeCache = new Map();      // address(lower) → {lat,lng} | null
const _CUST_GEOCODE_CAP = 12;             // max live geocodes per build (fair-use)

// Role → fallback colour when a stage has no STAGE_META entry (custom stages
// that only declared a role, or legacy display names). Mirrors the kanban's
// role palette. STAGE_META colour wins when present.
const _CUST_ROLE_COLORS = {
  new:    '#9CA3AF',
  active: '#4A9EFF',
  job:    '#0D9488',
  won:    '#22C55E',
  lost:   '#E05252',
};
const _CUST_ROLE_LABELS = { new: 'New', active: 'Active', job: 'In Production', won: 'Won', lost: 'Lost' };
const _CUST_ROLE_ORDER  = ['new', 'active', 'job', 'won', 'lost'];

// Which roles are currently VISIBLE. null = all (default). A role is hidden by
// removing it from the set via the legend; buildCustomersLayer skips it.
let _custRoleFilter = null;
function _custRoleVisible(role) { return !_custRoleFilter || _custRoleFilter.has(role); }

// Resolve a lead's role via the (possibly tenant-overridden) engine surface.
function _custRoleOf(lead) {
  const key = lead._stageKey
    || (typeof window.normalizeStage === 'function' ? window.normalizeStage(lead.stage) : (lead.stage || 'new'));
  if (typeof window.stageRole === 'function') { try { return window.stageRole(key); } catch (_) {} }
  return lead._stageRole || 'active';
}

// Colour for a lead's marker: exact stage colour if the engine knows the
// stage, else the role fallback — so custom + legacy stages still get a colour.
function _custColorOf(lead) {
  const key = lead._stageKey
    || (typeof window.normalizeStage === 'function' ? window.normalizeStage(lead.stage) : (lead.stage || 'new'));
  const meta = (window.STAGE_META && window.STAGE_META[key]) || null;
  if (meta && meta.color) return meta.color;
  return _CUST_ROLE_COLORS[_custRoleOf(lead)] || '#6B7280';
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

// Small colour-coded pin. Prospects (un-converted knocks) render as a hollow
// ring so a full customer reads as a solid dot at a glance.
function _custIcon(color, isProspect) {
  const esc = (typeof _mapsEscHtml === 'function') ? _mapsEscHtml : (s => String(s || ''));
  const c = esc(color);
  const inner = isProspect
    ? `<div style="width:12px;height:12px;border-radius:50%;background:transparent;border:3px solid ${c};box-shadow:0 1px 4px rgba(0,0,0,.5);"></div>`
    : `<div style="width:14px;height:14px;border-radius:50%;background:${c};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.55);"></div>`;
  return L.divIcon({ html: inner, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -9], className: '' });
}

function _custPopupHTML(lead) {
  const esc  = (typeof _mapsEscHtml === 'function') ? _mapsEscHtml : (s => String(s || ''));
  const escA = (typeof _mapsEscJsInAttr === 'function') ? _mapsEscJsInAttr : esc;
  const color = _custColorOf(lead);
  const addr  = String(lead.address || '').split(',').slice(0, 2).join(',');
  const val   = parseFloat(lead.jobValue || lead.value || lead.contractValue || 0);
  const stage = _custStageLabel(lead);
  const tag   = lead.isProspect ? ' · prospect' : '';
  return `<div class="pin-lead-popup">
    <div class="plp-header">
      <div class="plp-name" style="color:${esc(color)};">${esc(_custName(lead))}</div>
      <div class="plp-addr">${esc(addr)}${esc(tag)}</div>
    </div>
    <div class="plp-body">
      <div class="plp-row"><span class="plp-key">Stage</span><span class="plp-val">${esc(stage)}</span></div>
      ${val > 0 ? `<div class="plp-row"><span class="plp-key">Value</span><span class="plp-val" style="color:${esc(color)};">$${esc(val.toLocaleString())}</span></div>` : ''}
    </div>
    <div class="plp-btns">
      <button class="plp-btn-go" data-mo-action="goToLeadFromPin" data-mo-id="${escA(lead.id)}">→ Go to Lead</button>
    </div>
  </div>`;
}

function _addCustomerMarker(lead, lat, lng) {
  const m = L.marker([lat, lng], { icon: _custIcon(_custColorOf(lead), !!lead.isProspect) });
  m.bindPopup(_custPopupHTML(lead), { maxWidth: 260, minWidth: 200, className: 'nbd-pin-popup', closeButton: true });
  customersLayer.addLayer(m);
}

function _ensureCustomersLayer() {
  if (customersLayer) return;
  customersLayer = (typeof L.markerClusterGroup === 'function')
    ? L.markerClusterGroup({ maxClusterRadius: 50, showCoverageOnHover: false, disableClusteringAtZoom: 18 })
    : L.layerGroup();
}

// Build (or rebuild) the layer from window._leads. Plots leads that already
// carry lat/lng immediately; lazily geocodes+persists the rest (capped).
// Honours the per-role legend filter and refreshes the legend counts.
async function buildCustomersLayer() {
  if (!mainMap) return;
  _ensureCustomersLayer();
  customersLayer.clearLayers();

  const leads = window._leads || [];
  const roleCounts = { new: 0, active: 0, job: 0, won: 0, lost: 0 };
  let liveRequests = 0;

  for (const lead of leads) {
    if (!lead || lead.deleted) continue;

    const role = _custRoleOf(lead);
    // Legend filter — skip hidden roles entirely (also spares geocode budget).
    if (!_custRoleVisible(role)) continue;

    // 1) Already geocoded — plot straight away.
    const haveLat = lead.lat != null && lead.lat !== '';
    const haveLng = lead.lng != null && lead.lng !== '';
    if (haveLat && haveLng) {
      const la = parseFloat(lead.lat), ln = parseFloat(lead.lng);
      if (!isNaN(la) && !isNaN(ln)) { _addCustomerMarker(lead, la, ln); roleCounts[role] = (roleCounts[role] || 0) + 1; }
      continue;
    }

    // 2) No coords but has an address — lazy geocode + persist (backfill).
    const addr = lead.address || lead.addr || '';
    if (!addr) continue;
    const key = addr.trim().toLowerCase();
    let geo = _custGeocodeCache.get(key);
    if (geo === undefined) {
      if (liveRequests >= _CUST_GEOCODE_CAP) continue; // respect fair-use; picked up next open
      if (typeof geocode !== 'function') continue;
      try { geo = await geocode(addr); } catch (_) { geo = null; }
      geo = geo ? { lat: parseFloat(geo.lat), lng: parseFloat(geo.lon) } : null;
      _custGeocodeCache.set(key, geo);
      liveRequests++;
      // Nominatim fair-use: ≥ 1 req/s (same spacing as the Jobs overlay).
      await new Promise(r => setTimeout(r, 1100));
    }
    if (!geo || isNaN(geo.lat) || isNaN(geo.lng)) continue;

    // Persist onto the lead so we never re-geocode this address, and update
    // the in-memory copy so the very next rebuild treats it as case (1).
    lead.lat = geo.lat; lead.lng = geo.lng;
    if (typeof window._saveLeadCoords === 'function' && lead.id && !String(lead.id).startsWith('d-')) {
      try { window._saveLeadCoords(lead.id, geo.lat, geo.lng); } catch (_) {}
    }
    _addCustomerMarker(lead, geo.lat, geo.lng);
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }

  _renderCustLegend(roleCounts);

  if (liveRequests >= _CUST_GEOCODE_CAP) {
    if (typeof showToast === 'function') {
      showToast('Placed the first batch of un-mapped customers — reopen the layer to map more', 'info');
    }
  }
}

// ── LEGEND (floating, per-role show/hide) ───────────────────────────────
function _injectCustLegendCss() {
  if (document.getElementById('cust-legend-style')) return;
  const s = document.createElement('style');
  s.id = 'cust-legend-style';
  s.textContent =
    '.nbd-cust-legend{position:absolute;left:12px;bottom:22px;z-index:600;background:rgba(10,12,15,.86);'
    + 'border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 9px;font-family:sans-serif;'
    + 'box-shadow:0 4px 16px rgba(0,0,0,.5);backdrop-filter:blur(4px);max-width:180px;}'
    + '.nbd-cust-legend .ncl-title{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#9aa4b2;margin:0 2px 6px;font-weight:700;}'
    + '.nbd-cust-legend .ncl-chip{display:flex;align-items:center;gap:7px;width:100%;background:none;border:none;'
    + 'padding:4px 4px;border-radius:6px;cursor:pointer;color:#e7ebf0;font-size:12px;text-align:left;}'
    + '.nbd-cust-legend .ncl-chip:hover{background:rgba(255,255,255,.07);}'
    + '.nbd-cust-legend .ncl-chip.off{opacity:.4;}'
    + '.nbd-cust-legend .ncl-dot{width:11px;height:11px;border-radius:50%;flex:0 0 auto;border:1px solid rgba(255,255,255,.5);}'
    + '.nbd-cust-legend .ncl-lbl{flex:1;}'
    + '.nbd-cust-legend .ncl-cnt{color:#9aa4b2;font-variant-numeric:tabular-nums;}';
  document.head.appendChild(s);
}

function _renderCustLegend(roleCounts) {
  if (!mainMap) return;
  const container = mainMap.getContainer && mainMap.getContainer();
  if (!container) return;
  _injectCustLegendCss();
  if (!_custLegendEl) {
    _custLegendEl = document.createElement('div');
    _custLegendEl.className = 'nbd-cust-legend';
    container.appendChild(_custLegendEl);
    // Stop map drag/zoom when interacting with the legend.
    if (L.DomEvent) { L.DomEvent.disableClickPropagation(_custLegendEl); L.DomEvent.disableScrollPropagation(_custLegendEl); }
  }
  const esc = (typeof _mapsEscHtml === 'function') ? _mapsEscHtml : (s => String(s || ''));
  let html = '<div class="ncl-title">Customers</div>';
  _CUST_ROLE_ORDER.forEach(function (role) {
    const off = !_custRoleVisible(role) ? ' off' : '';
    html += '<button type="button" class="ncl-chip' + off + '" data-cust-role="' + role + '">'
      + '<span class="ncl-dot" style="background:' + esc(_CUST_ROLE_COLORS[role]) + ';"></span>'
      + '<span class="ncl-lbl">' + esc(_CUST_ROLE_LABELS[role]) + '</span>'
      + '<span class="ncl-cnt">' + (roleCounts[role] || 0) + '</span>'
      + '</button>';
  });
  _custLegendEl.innerHTML = html;
  // Delegated, CSP-safe (no inline handlers).
  if (!_custLegendEl._wired) {
    _custLegendEl._wired = true;
    _custLegendEl.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest && e.target.closest('[data-cust-role]');
      if (!btn) return;
      const role = btn.getAttribute('data-cust-role');
      if (!_custRoleFilter) _custRoleFilter = new Set(_CUST_ROLE_ORDER);
      if (_custRoleFilter.has(role)) {
        if (_custRoleFilter.size > 1) _custRoleFilter.delete(role); // never hide the last one
      } else {
        _custRoleFilter.add(role);
      }
      buildCustomersLayer();
    });
  }
  _custLegendEl.style.display = '';
}

function _hideCustLegend() { if (_custLegendEl) _custLegendEl.style.display = 'none'; }

function showCustomersLayer() {
  _ensureCustomersLayer();
  if (customersLayer.getLayers().length === 0) { buildCustomersLayer(); }
  else if (_custLegendEl) { _custLegendEl.style.display = ''; }
  customersLayer.addTo(mainMap);
}
function hideCustomersLayer() { if (customersLayer && mainMap) mainMap.removeLayer(customersLayer); _hideCustLegend(); }

// Rebuild after a leads reload / stage move so the map tracks the book. Only
// touches the map if the overlay is currently on (cheap no-op otherwise).
function refreshCustomersLayer() {
  if (overlayState && overlayState.customers) { buildCustomersLayer(); }
}

if (typeof window !== 'undefined') {
  window.buildCustomersLayer   = buildCustomersLayer;
  window.showCustomersLayer    = showCustomersLayer;
  window.hideCustomersLayer    = hideCustomersLayer;
  window.refreshCustomersLayer = refreshCustomersLayer;
}

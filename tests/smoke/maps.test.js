/**
 * tests/smoke/maps.test.js — Hail overlay on D2D + Pipeline badge,
 * Storm Briefing automation, large-view extractions for photos +
 * admin templates.
 */

'use strict';

const path = require('path');
const { ROOT, PRO_JS, FUNCTIONS, read, readCrm, readD2DLive, readMaps } = require('./_shared');

module.exports.run = function run(ctx) {
  const { assert, section } = ctx;

section('UI-D: Hail overlay on D2D + Pipeline badge');
{
  // Step 5 (2026-05-17): legacy docs/pro/js/d2d-tracker.js was deleted
  // (not loaded by any HTML; split into d2d-tracker-{core,ui}-2026b.js +
  // d2d-tracker-2026b.js in step 4f). Use readD2DLive() to grep the
  // post-split surface for showHail / hideHail / _d2dHailLayer.
  const src = readD2DLive();
  assert('D2D exposes showHail', /showHail:\s*async/.test(src));
  assert('D2D exposes hideHail', /hideHail:\s*\(\)\s*=>/.test(src));
  assert('Hail button rendered in map controls',
    /data-d2d-action="toggleHail"/.test(src));
  // Step 4b: buildCard (which renders the hail badge) lives in
  // crm-pipeline.js post-split — concat via readCrm() so the
  // assertion finds the pattern.
  const crm = readCrm();
  assert('Kanban card renders hail badge when hailHit.sizeInches present',
    /l\.hailHit && l\.hailHit\.sizeInches/.test(crm));
}

section('D2D delegate registry — data-d2d-action ⇄ window.D2D shim contract');
{
  // The document-level click delegate (d2d-tracker-ui-2026b.js) resolves
  // data-d2d-action names ONLY through window.D2D, which is composed from an
  // explicit export list in d2d-tracker-2026b.js. A helper that exists on
  // window._D2DState but is missing from the shim renders a button that
  // silently no-ops ('[d2d] no dispatch'). 2026-07-06: the hot-lead
  // conversion prompt's three buttons + toggleHail + dismissFollowupsBanner
  // were all dead this way.
  const shim = read(path.join(PRO_JS, 'd2d-tracker-2026b.js'));
  for (const name of [
    'convertToLeadAndDismissPrompt',
    'convertToLeadWithEditAndDismissPrompt',
    'dismissConvertPrompt',
    'toggleHail',
    'dismissFollowupsBanner',
  ]) {
    assert('D2D shim exports ' + name,
      new RegExp('^\\s*' + name + ':\\s*state\\.' + name + ',', 'm').test(shim),
      'expected `' + name + ': state.' + name + ',` in the window.D2D literal');
  }
  // General contract: every action name rendered in the tracker sources must
  // be a key in the shim's window.D2D literal. Skip comment lines so the
  // delegate's own `data-d2d-action="methodName"` doc example doesn't count.
  const rendered = new Set();
  for (const shard of ['d2d-tracker-core-2026b.js', 'd2d-tracker-ui-2026b.js', 'd2d-tracker-2026b.js']) {
    for (const line of read(path.join(PRO_JS, shard)).split('\n')) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      for (const m of line.matchAll(/data-d2d-action="(\w+)"/g)) rendered.add(m[1]);
    }
  }
  const missing = [...rendered].filter(name => !new RegExp('^\\s*' + name + ':', 'm').test(shim));
  assert('every rendered data-d2d-action has a window.D2D export (found ' + rendered.size + ' actions)',
    missing.length === 0,
    'dead buttons — rendered but not exported by the shim: ' + missing.join(', '));
}

section('Phase C.3 — large-view extractions (photos + admin)');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  for (const v of ['photos','admin']) {
    assert('view-' + v + ' is an empty mount with data-view-template (C.3)',
      new RegExp('<div class="view" id="view-' + v + '"\\s+data-view-template="tpl-view-' + v + '"></div>').test(dash),
      'expected mount div for view-' + v);
    assert('<template id="tpl-view-' + v + '"> exists',
      new RegExp('<template id="tpl-view-' + v + '">').test(dash),
      'expected tpl-view-' + v + ' template element');
  }
  // Spot-check Wave 2C.2 shutter FAB survived the photos extraction —
  // it moves INTO the template so the CSS selector
  //   #view-photos.active > .m-shutter-fab
  // matches once the template is cloned at hydration time.
  assert('tpl-view-photos contains the m-shutter-fab as a direct child',
    /<template id="tpl-view-photos">[\s\S]*?<button class="m-shutter-fab"/.test(dash),
    'expected the Wave 2C.2 shutter FAB to live inside tpl-view-photos');
  // adminCreateModal + adminEditModal stay top-level (sit OUTSIDE
  // view-admin, independently toggled by AdminManager). Check that
  // the admin template's body doesn't contain adminCreateModal.
  {
    const tplStart = dash.indexOf('<template id="tpl-view-admin">');
    const tplEnd = dash.indexOf('</template>', tplStart);
    const adminTplBody = dash.slice(tplStart, tplEnd);
    assert('adminCreateModal stays top-level (outside tpl-view-admin)',
      /<div id="adminCreateModal" class="modal-overlay"/.test(dash)
      && !/id="adminCreateModal"/.test(adminTplBody),
      'expected adminCreateModal to remain top-level, not inside the admin template body');
  }
}

section('Phase B.2 — Storm Briefing automation');
{
  const sb = read(path.join(ROOT, 'functions/integrations/storm-briefing.js'));
  const idx = read(path.join(ROOT, 'functions/index.js'));
  assert('storm-briefing module exists with onDocumentCreated trigger',
    /exports\.stormBriefing_onAlertSent\s*=\s*onDocumentCreated/.test(sb),
    'expected stormBriefing_onAlertSent registered');
  assert('storm-briefing module guards SLACK_WEBHOOK_URL secret',
    /SECRETS\.SLACK_WEBHOOK_URL/.test(sb),
    'expected SLACK_WEBHOOK_URL declared as a secret on the trigger');
  assert('storm-briefing uses atomic sentinel to dedup',
    /storm_briefings_sent\/\$\{alertId\}/.test(sb)
    && /runTransaction/.test(sb),
    'expected dedup via storm_briefings_sent sentinel + runTransaction');
  assert('storm-briefing scoring exports for unit tests',
    /exports\._test\s*=\s*\{[\s\S]*scoreLead/.test(sb),
    'expected scoreLead exported via _test');
  assert('functions/index.js registers stormBriefingIntegration',
    /stormBriefingIntegration\s*=\s*require\('\.\/integrations\/storm-briefing'\)/.test(idx)
    && /Object\.assign\(exports,\s*stormBriefingIntegration\)/.test(idx),
    'expected index.js to require + Object.assign stormBriefingIntegration');
  // Static checks on the ranking contract — STAGE_WEIGHTS table + the
  // shape of scoreLead. We don't require() the module here because it
  // depends on firebase-functions which isn't in tests/node_modules.
  assert('STAGE_WEIGHTS ranks early-stage > install_in_progress',
    /STAGE_WEIGHTS\s*=\s*\{[\s\S]{0,1500}new:\s*1\.00/.test(sb)
    && /install_in_progress:\s*0\.10/.test(sb),
    'expected new=1.00 and install_in_progress=0.10 in STAGE_WEIGHTS');
  assert('recencyWeight returns 1.00 for leads ≤30 days old',
    /if \(ageDays <= RECENT_LEAD_DAYS\) return 1\.00/.test(sb),
    'expected recencyWeight to cap at 1.00 for the recent window');
  assert('storm-briefing composes a Slack briefing with leadCount + topLeadIds',
    /leadCount:\s*scored\.length/.test(sb)
    && /topLeadIds:\s*scored\.slice\(0, BRIEFING_LEAD_LIMIT\)\.map/.test(sb),
    'expected the storm_briefings_sent sentinel to carry leadCount + topLeadIds for Viktor');
}

section('Customers map layer — all leads on the map, role-coloured');
{
  const maps = readMaps(); // includes maps-customers.js via MAPS_SPLIT
  // The layer builds from the company-scoped CRM book, not the userId-scoped
  // door-knock _pins, so the whole team's customers show.
  assert('Customers layer builds from window._leads',
    /function buildCustomersLayer[\s\S]{0,400}window\._leads/.test(maps),
    'expected buildCustomersLayer() to iterate window._leads');
  // The stage dimension classifies by the LIVE pipeline role (window.stageRole)
  // so it matches the kanban and honours a tenant's custom stages; the legend +
  // dots share the role palette for consistency.
  assert('stage dimension classifies via window.stageRole',
    /function _custRoleOf\(lead\)[\s\S]{0,200}window\.stageRole/.test(maps)
    && /catOf:\s*_custRoleOf/.test(maps),
    'expected the stage dimension catOf to resolve the role via window.stageRole');
  // Rolling geocode-backfill: lazy, fair-use capped, and PERSISTED so a lead
  // is only ever geocoded once.
  assert('Customers layer persists geocoded coords via _saveLeadCoords',
    /window\._saveLeadCoords\(lead\.id/.test(maps),
    'expected the backfill to call window._saveLeadCoords to persist lat/lng');
  assert('Customers layer respects a live-geocode fair-use cap',
    /_CUST_GEOCODE_CAP/.test(maps) && /liveRequests\s*>=\s*_CUST_GEOCODE_CAP/.test(maps),
    'expected a per-build geocode cap like the Jobs overlay');
  // Wired into the generic overlay toggle path.
  assert('toggleOverlay routes the customers layer',
    /type==='customers'[\s\S]{0,120}showCustomersLayer\(\)[\s\S]{0,40}hideCustomersLayer\(\)/.test(maps),
    'expected toggleOverlay to show/hide the customers layer');
  assert('overlayState seeds a customers flag',
    /overlayState\s*=\s*\{[^}]*customers:\s*false/.test(maps),
    'expected overlayState to include customers:false');
  // Legacy customer pins must no longer trust the dead static STAGE_COLORS map
  // for post-migration/custom stages.
  assert('addPinMarker colours customer pins via the live engine',
    /p\.type === 'customer'[\s\S]{0,400}window\.STAGE_META/.test(maps),
    'expected addPinMarker() to colour customer pins from window.STAGE_META');
  // Clusters at low zoom (like the D2D pins) so a big book stays readable.
  assert('Customers layer clusters when markerClusterGroup is available',
    /L\.markerClusterGroup === 'function'[\s\S]{0,120}L\.markerClusterGroup\(/.test(maps)
    && /L\.layerGroup\(\)/.test(maps),
    'expected _ensureCustomersLayer() to prefer L.markerClusterGroup with a layerGroup fallback');
  // Control panel: color-by, legend/filter, cross-dimension AND filters.
  assert('Customers panel offers color-by dimensions (stage/damage/value/rep)',
    /_CUST_DIM_KEYS\s*=\s*\['stage',\s*'damage',\s*'value',\s*'rep'\]/.test(maps)
    && /data-cust-colorby/.test(maps),
    'expected a color-by selector over stage/damage/value/rep dimensions');
  assert('dot colour follows the active color-by dimension',
    /function _custColorOf\(lead\)[\s\S]{0,200}_CUST_DIMENSIONS\[_custColorBy\]/.test(maps),
    'expected _custColorOf to resolve via the active color-by dimension');
  assert('filters compose across dimensions (AND)',
    /function _custPasses\(lead\)[\s\S]{0,260}for \(const dk of _CUST_DIM_KEYS\)[\s\S]{0,160}return false/.test(maps)
    && /if \(!_custPasses\(lead\)\) continue;/.test(maps),
    'expected _custPasses to AND every dimension filter and gate the build');
  assert('damage + value dimensions normalise lead fields',
    /function _custDamageKey\(lead\)/.test(maps) && /function _custValueKey\(lead\)/.test(maps),
    'expected damage-type and value-tier categorisers');
  assert('zoom-gated $ labels bloom past the label zoom',
    /_CUST_LABEL_ZOOM/.test(maps)
    && /labelMode && v > 0/.test(maps) && /💰/.test(maps)
    && /zoomend[\s\S]{0,200}buildCustomersLayer\(\)/.test(maps),
    'expected a $ value pill icon past _CUST_LABEL_ZOOM, rebuilt on zoomend');
  assert('panel filter keeps at least one category per dimension',
    /f\.size > 1[\s\S]{0,30}f\.delete\(cat\)/.test(maps),
    'expected the chip toggle to never empty a dimension filter');
  assert('panel is CSP-safe (delegated listeners, no inline handlers)',
    /_custPanelEl\.addEventListener\('click'/.test(maps)
    && /_custPanelEl\.addEventListener\('change'/.test(maps),
    'expected delegated click + change listeners on the panel');
  // Value-range slider — min/max $ filter, live readout on input, commit on change.
  assert('value-range slider filters by min/max deal value',
    /function _custValRangePasses\(lead\)/.test(maps)
    && /return _custValRangePasses\(lead\);/.test(maps)
    && /data-cust-valmin/.test(maps) && /data-cust-valmax/.test(maps),
    'expected a value-range filter gated in _custPasses with min/max range inputs');
  assert('value-range readout updates live on input (no rebuild mid-drag)',
    /_custPanelEl\.addEventListener\('input'/.test(maps)
    && /read\.textContent = _custValLabel\(_custValMin\)/.test(maps),
    'expected an input listener that updates the readout without a full rebuild');
  // Saved views — TEAM-SHARED: persisted to companyProfile.mapViews (read by
  // all, write by owner/admin), snapshot/apply the whole panel state.
  assert('saved views are team-shared via companyProfile.mapViews',
    /window\._companyProfile && window\._companyProfile\.mapViews/.test(maps)
    && /_saveCompanyProfile\(\{ mapViews: v \}\)/.test(maps)
    && /function _custSnapshot\(\)/.test(maps) && /function _custApplyView\(v\)/.test(maps),
    'expected saved views backed by companyProfile.mapViews + snapshot/apply helpers');
  assert('saved-view save/delete gated to owner/admin (everyone can apply)',
    /function _custCanEditViews\(\)/.test(maps)
    && /canEditViews[\s\S]{0,120}data-cust-saveview/.test(maps),
    'expected _custCanEditViews to gate the save/delete controls');
  assert('saved views wired: apply on select, save + delete buttons',
    /data-cust-view/.test(maps) && /data-cust-saveview/.test(maps) && /data-cust-delview/.test(maps),
    'expected a view select + save/delete controls');
  // Rep / owner — a DYNAMIC color-by dimension (cats computed from lead owners).
  assert('rep/owner is a dynamic color-by dimension over lead owners',
    /rep:\s*\{ label: 'Rep \/ Owner', catsFn: _custRepCats/.test(maps)
    && /_CUST_DIM_KEYS = \['stage', 'damage', 'value', 'rep'\]/.test(maps)
    && /function _custRepCats\(\)[\s\S]{0,300}window\._leads/.test(maps),
    'expected a rep dimension whose categories are the distinct lead owners');
  assert('dynamic dimensions resolve cats via _dimCats',
    /function _dimCats\(dim\)\s*\{\s*return dim\.catsFn \? dim\.catsFn\(\)/.test(maps)
    && /_dimCats\(dim\)\.forEach/.test(maps),
    'expected _dimCats() used wherever a dimension enumerates categories');
  assert('rep names are best-effort (Me / team maps / short uid)',
    /function _custRepName\(uid\)[\s\S]{0,300}window\._user[\s\S]{0,200}'Me'/.test(maps),
    'expected _custRepName to label the current user Me and fall back gracefully');
  // Route optimizer — nearest-neighbor over the currently-filtered stops.
  assert('route optimizer orders filtered stops nearest-neighbor from map centre',
    /function _custRoutableStops\(\)[\s\S]{0,200}_custPasses\(l\)/.test(maps)
    && /function _custNnOrder\(start, pts\)/.test(maps)
    && /mainMap\.getCenter\(\)/.test(maps),
    'expected _custRoutableStops (filter-aware) + _custNnOrder from the map centre');
  assert('route draws a polyline + numbered stop markers, capped',
    /L\.polyline\(latlngs/.test(maps)
    && /_custNumIcon\(i \+ 1\)/.test(maps)
    && /_CUST_ROUTE_CAP/.test(maps),
    'expected a dashed polyline, numbered markers, and a stop cap');
  assert('route toggle wired in the panel',
    /data-cust-route/.test(maps) && /toggleCustomerRoute\(\)/.test(maps),
    'expected a Route button wired to toggleCustomerRoute');
  // Field-ready: start from the rep's GPS (fall back to map centre) + hand off
  // to Google Maps for turn-by-turn.
  assert('route starts from GPS with a map-centre fallback',
    /function _custResolveStart\(\)/.test(maps)
    && /navigator\.geolocation\.getCurrentPosition/.test(maps)
    && /const start = await _custResolveStart\(\)/.test(maps),
    'expected _custResolveStart to prefer geolocation and buildCustomerRoute to await it');
  assert('route hands off to Google Maps directions (origin/dest/waypoints/driving)',
    /google\.com\/maps\/dir\/\?api=1/.test(maps)
    && /destination=/.test(maps) && /&waypoints=/.test(maps) && /travelmode=driving/.test(maps)
    && /_CUST_GMAPS_WP_CAP/.test(maps),
    'expected _custGmapsUrl to build a directions URL capped at Google’s waypoint limit');
  assert('Open-in-Maps button shows only while a route is active',
    /_custRouteOn[\s\S]{0,80}data-cust-gmaps/.test(maps)
    && /openRouteInGmaps\(\)/.test(maps),
    'expected the gmaps hand-off button gated on _custRouteOn');
}

section('D2D pins — disposition legend + filter (second layer)');
{
  const maps = readMaps();
  // A disposition filter panel over the pins layer (PIN_LABELS categories).
  assert('pins layer renders a disposition filter panel',
    /function renderPinDispPanel\(\)/.test(maps)
    && /nbd-pin-panel/.test(maps)
    && /Object\.keys\(PIN_LABELS\)/.test(maps)
    && /data-pin-disp/.test(maps),
    'expected renderPinDispPanel() with a chip per PIN_LABELS disposition');
  // Filter hides/shows pin markers via the cluster group; status-less pins pass.
  assert('pin disposition filter shows/hides markers via applyPinDispFilter',
    /function applyPinDispFilter\(\)[\s\S]{0,200}pinMarkers\[p\.id\]/.test(maps)
    && /function _pinPassesDisp\(p\)[\s\S]{0,120}_pinDispFilter\.has\(p\.status\)/.test(maps),
    'expected applyPinDispFilter to gate each pin marker by _pinPassesDisp');
  assert('status-less (customer/legacy) pins always pass the disposition filter',
    /if \(!p \|\| !p\.status\) return true;/.test(maps),
    'expected pins without a status to bypass the disposition filter');
  assert('pins panel filter keeps at least one disposition + drops to no-filter when all on',
    /_pinDispFilter\.size > 1[\s\S]{0,30}_pinDispFilter\.delete\(st\)/.test(maps)
    && /_pinDispFilter\.size === all\.length[\s\S]{0,30}_pinDispFilter = null/.test(maps),
    'expected the pins chip toggle to never empty and to clear when all-on');
  assert('pins panel is CSP-safe (delegated listener)',
    /_pinPanelEl\.addEventListener\('click'/.test(maps),
    'expected a delegated click listener on the pins panel');
  // Wired into the pins overlay toggle + initial load.
  assert('toggleOverlay shows/hides the pins disposition panel',
    /overlayState\.pins[\s\S]{0,120}renderPinDispPanel\(\)[\s\S]{0,80}hidePinDispPanel\(\)/.test(maps),
    'expected the pins toggle to render/hide the disposition panel');
}

section('Customers map layer — dashboard.html wiring');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const maps = readMaps(); // for the window.nbdRepList export check below
  assert('dashboard.html loads maps-customers.js between overlays and routing',
    /maps-overlays\.js[\s\S]{0,80}maps-customers\.js[\s\S]{0,80}maps-routing\.js/.test(dash),
    'expected the customers module in the locked core→overlays→customers→routing order');
  assert('Customers overlay toggle rendered',
    /data-action="mapOverlay"\s+data-target="customers"/.test(dash),
    'expected a Customers overlay-row toggle');
  // Territory zones shaded by rep (session-only zones; assignment + colour).
  assert('zone panel has a rep assignment select',
    /id="zoneRepSelect"/.test(dash),
    'expected a #zoneRepSelect in the zone panel');
  const actions = read(path.join(ROOT, 'docs/pro/js/dashboard-actions.js'));
  assert('zones populate reps from the shared palette (window.nbdRepList)',
    /function _populateZoneReps\(\)/.test(actions) && /window\.nbdRepList\(\)/.test(actions),
    'expected _populateZoneReps to read window.nbdRepList');
  assert('saveZone shades the zone in the assigned rep colour + labels it',
    /getElementById\('zoneRepSelect'\)/.test(actions)
    && /getAttribute\('data-color'\)/.test(actions)
    && /rep:\s*repKey,\s*repLabel/.test(actions),
    'expected saveZone to colour by the rep data-color and store rep/repLabel');
  assert('maps-customers exposes the shared rep palette as window.nbdRepList',
    /window\.nbdRepList\s*=\s*_custRepCats/.test(maps),
    'expected window.nbdRepList = _custRepCats');
  const widgets = read(path.join(ROOT, 'docs/pro/js/dashboard-widgets.js'));
  assert('zone list shows the assigned rep label',
    /z\.repLabel \? [\s\S]{0,80}esc\(z\.repLabel\)/.test(widgets),
    'expected renderZoneList to render z.repLabel');

  // Zones are now PERSISTED + team-shared (Firestore /zones), not session-only.
  const boot = read(path.join(ROOT, 'docs/pro/js/dashboard-bootstrap.module.js'));
  assert('zones have Firestore CRUD (load/save/delete) with companyId stamping',
    /async function loadZones\(\)/.test(boot)
    && /window\._saveZone\s*=/.test(boot) && /window\._deleteZone\s*=/.test(boot)
    && /collection\(db,'zones'\)/.test(boot)
    && /zoneDoc\.companyId = \(window\._userClaims\?\.companyId\) \|\| _uid/.test(boot),
    'expected loadZones/_saveZone/_deleteZone against /zones with companyId stamped');
  assert('zones load at boot alongside pins',
    /loadPins\(\); loadZones\(\)/.test(boot),
    'expected loadZones() called in the boot sequence');
  assert('saveZone persists (serialized points) + renderSavedZones draws loaded zones',
    /window\._saveZone\(\{ name, color: fillColor, points: pts/.test(actions)
    && /function renderSavedZones\(\)/.test(actions)
    && /window\.renderSavedZones = renderSavedZones/.test(actions),
    'expected saveZone to persist serialized points and a renderSavedZones() to draw window._zones');
  assert('map init draws persisted zones',
    /renderSavedZones==='function'\) window\.renderSavedZones\(\)/.test(maps),
    'expected initMainMap to render saved zones');
  const rules = read(path.join(ROOT, 'firestore.rules'));
  assert('/zones rule is team-shared (mirrors /pins)',
    /match \/zones\/\{zoneId\}[\s\S]{0,900}sameCompanyAsResource\(\)[\s\S]{0,900}request\.resource\.data\.companyId == myCompanyId\(\)/.test(rules),
    'expected a /zones rule with same-company read + companyId-pinned create');
  // Audit fix: /pins + /zones UPDATE must freeze provenance (companyId) so an
  // owner can't repoint their doc into a victim tenant's shared map.
  assert('/pins + /zones update freezes userId/companyId (didNotChange)',
    (rules.match(/allow update: if \(isOwner\(resource\.data\.userId\)[\s\S]{0,220}didNotChange\(\['userId', 'companyId'\]\)/g) || []).length >= 2,
    'expected both /pins and /zones update rules to guard didNotChange([userId, companyId])');
  // Zone insights — point-in-polygon aggregation of the leads inside a zone.
  assert('zones show insights (point-in-polygon leads → count/$ /roles/damage)',
    /function _pointInPolygon\(lat, lng, poly\)/.test(actions)
    && /function _zoneInsights\(zone\)/.test(actions)
    && /_bindZoneInsights\(layer/.test(actions),
    'expected _pointInPolygon + _zoneInsights bound to the zone layer');
  assert('Customers map FAB rendered',
    /id="fab-customers"[\s\S]{0,120}data-arg="customers"/.test(dash),
    'expected a Customers map FAB wired to fabToggle');
}

section('Map heat + pins toggle + mobile');
{
  const maps = readMaps();
  // Heat weighted by money/intent, not a flat constant.
  assert('heat layer weights points by deal $ / disposition (not flat)',
    /function _pinHeatWeight\(p\)/.test(maps)
    && /_DISPO_HEAT/.test(maps)
    && /window\._pins\.map\(p => \[p\.lat, p\.lng, _pinHeatWeight\(p\)\]\)/.test(maps),
    'expected buildHeatLayer to weight each point via _pinHeatWeight');
  // Pins toggle bug fix: operate on the cluster group, not per-marker.
  assert('pins show/hide toggles the cluster group (fixes the no-op toggle)',
    /function showAllPins\(\)[\s\S]{0,200}mainMap\.addLayer\(pinClusterGroup\)/.test(maps)
    && /function hideAllPins\(\)[\s\S]{0,200}mainMap\.removeLayer\(pinClusterGroup\)/.test(maps),
    'expected showAllPins/hideAllPins to add/remove pinClusterGroup');
  // Mobile: both floating panels constrain on small viewports.
  assert('map panels are mobile-constrained (@media max-width:640px)',
    /@media \(max-width:640px\)\{[\s\S]{0,120}\.nbd-cust-panel\{width:46vw/.test(maps)
    && /@media \(max-width:640px\)\{[\s\S]{0,120}\.nbd-pin-panel\{width:46vw/.test(maps),
    'expected mobile media queries capping both the customers + pins panels');
  // ── Audit regression guards (2026-07-08) ──
  assert('route cap fits the Google Maps hand-off (no silently-dropped stop)',
    /_CUST_ROUTE_CAP = 24\b/.test(maps),
    'expected _CUST_ROUTE_CAP = 24 so map pins == URL stops (origin + 23 waypoints + dest)');
  assert('value-range max slider NaN-guards (0 is a valid max, not "no cap")',
    /data-cust-valmax'\)\) \{ const n = parseInt\(t\.value, 10\); _custValMax = Math\.max\(isNaN\(n\) \? _CUST_VAL_CAP : n/.test(maps),
    'expected the max handler to use isNaN(n), not `parseInt||CAP` which snapped 0 to no-cap');
  assert('Filters toggle re-renders with fresh counts (no stale closure)',
    /_custFiltersOpen = !_custFiltersOpen; _renderCustPanel\(\); return/.test(maps),
    'expected the more-filters branch to call _renderCustPanel() no-arg (fresh _custLastCounts)');
  const actionsSrc = read(path.join(ROOT, 'docs/pro/js/dashboard-actions.js'));
  assert('deleteZone confirms the server delete before removing locally',
    /async function deleteZone\(id\)[\s\S]{0,700}ok = await window\._deleteZone\(zone\.id\)[\s\S]{0,200}if \(!ok\)/.test(actionsSrc)
    && /window\._deleteZone = async \(id\)[\s\S]{0,300}return true;[\s\S]{0,300}return false;/.test(read(path.join(ROOT, 'docs/pro/js/dashboard-bootstrap.module.js'))),
    'expected deleteZone to await _deleteZone (which returns bool) and skip local removal on denial');
  assert('zone color swatches emit hex (survive reload through safeColor)',
    /data-target="#[0-9A-Fa-f]{6}"/.test(read(path.join(ROOT, 'docs/pro/dashboard.html'))),
    'expected zone color picker data-target values to be hex, not var(--x)');
  // ── Round-2 audit regression guards ──
  assert('buildCustomersLayer has a re-entrancy token guard (no duplicate pins)',
    /let _custBuildToken = 0/.test(maps)
    && /const token = \+\+_custBuildToken/.test(maps)
    && (maps.match(/if \(token !== _custBuildToken\) return;/g) || []).length >= 2,
    'expected a build token bumped per call + aborted after each geocode await');
  assert('geocode-backfill only runs on show/refresh (doGeocode), not re-renders',
    /async function buildCustomersLayer\(doGeocode\)/.test(maps)
    && /if \(!doGeocode\) continue;/.test(maps)
    && /getLayers\(\)\.length === 0\) \{ buildCustomersLayer\(true\)/.test(maps)
    && /overlayState\.customers\) \{ buildCustomersLayer\(true\)/.test(maps),
    'expected doGeocode gate + show/refresh passing true (filter/color/zoom pass false)');
  assert('zone rep label resolves per-viewer at render (not the stored "Me")',
    /function _zoneRepLabel\(zoneData\)[\s\S]{0,220}window\.nbdRepList/.test(actionsSrc)
    && /repLabel = window\._user\.displayName \|\| window\._user\.email/.test(actionsSrc),
    'expected _zoneRepLabel() to re-resolve via nbdRepList + saveZone to store a real name');
  // ── Round-3 audit regression guards ──
  // deletePin now mirrors deleteZone: await the server delete (which returns a
  // bool) and only strip the marker on success. Pins went team-visible, so a
  // manager/viewer can click Delete on a teammate's pin — the /pins rule denies
  // it, and an optimistic removal silently reappears on reload.
  assert('deletePin confirms the server delete before removing the marker',
    /async function deletePin\(id\)[\s\S]{0,400}await window\._deletePin\(id\)[\s\S]{0,120}if \(!ok\)/.test(maps)
    && /window\._deletePin = async \(id\)[\s\S]{0,260}return true;[\s\S]{0,200}return false;/.test(read(path.join(ROOT, 'docs/pro/js/dashboard-bootstrap.module.js'))),
    'expected deletePin to await _deletePin (which returns bool) and skip marker removal on denial');
  // _zoneRepLabel must not let nbdRepList's degenerate uid-slice fallback
  // (String(uid).slice(0,6), used when the rep has no leads in THIS viewer's
  // book) clobber the real name the assigner persisted in repLabel.
  assert('zone rep label prefers stored real name over a uid-slice fallback',
    /const isUidSlice = r\.label === String\(zoneData\.rep\)\.slice\(0, 6\)/.test(actionsSrc)
    && /if \(!isUidSlice \|\| !zoneData\.repLabel\) return r\.label;/.test(actionsSrc),
    'expected _zoneRepLabel to fall back to zoneData.repLabel when the live label is just the uid-slice');
  // ── Round-4 audit regression guards ──
  // makePinIcon interpolates the pin colour into the divIcon SVG (fill="…").
  // Pins are team-visible and `color` is an unvalidated /pins field, so a
  // teammate-controlled colour is cross-user stored XSS unless escaped. Every
  // other colour sink in the file already routes through _mapsEscHtml.
  assert('makePinIcon escapes the pin colour before interpolating (XSS guard)',
    /function makePinIcon\(color, status\)[\s\S]{0,700}const safe = \(typeof _mapsEscHtml === 'function'\) \? _mapsEscHtml\(color\)[\s\S]{0,500}fill="\$\{safe\}"/.test(maps),
    'expected makePinIcon to escape color via _mapsEscHtml and interpolate the escaped value into fill=""');
  // deleteZone awaits a server round-trip; a second concurrent delete can splice
  // the array mid-flight, so the pre-await index goes stale. Recompute by
  // identity after the await instead of splicing the captured idx.
  assert('deleteZone recomputes the splice index by identity after the await',
    /if \(zone\.layer\) mainMap\?\.removeLayer\(zone\.layer\);[\s\S]{0,260}const realIdx = zones\.findIndex\(z => String\(z\.id\) === String\(zone\.id\)\);[\s\S]{0,80}if \(realIdx >= 0\) zones\.splice\(realIdx, 1\);/.test(actionsSrc),
    'expected deleteZone to re-find the index after awaiting _deleteZone, not splice the stale captured idx');
  // ── Round-5 audit regression guards ──
  // buildCustomerRoute awaits GPS (~6s). If the overlay is toggled off during
  // the await, resuming would draw an orphaned route on mainMap + reopen the
  // panel. Re-check overlayState.customers after the await.
  assert('buildCustomerRoute aborts if the overlay was hidden during the GPS await',
    /const start = await _custResolveStart\(\);[\s\S]{0,320}if \(!overlayState \|\| !overlayState\.customers\) return;/.test(maps),
    'expected buildCustomerRoute to re-check overlayState.customers after awaiting _custResolveStart');
  // hideCustomersLayer must bump the build token so an in-flight geocode build
  // supersedes (its post-await guards return before _renderCustPanel) instead
  // of reopening the hidden control panel ~13s later.
  assert('hideCustomersLayer supersedes an in-flight build (no panel re-show after hide)',
    /function hideCustomersLayer\(\)\s*\{[\s\S]{0,260}_custBuildToken\+\+;/.test(maps),
    'expected hideCustomersLayer to bump _custBuildToken so a running backfill build aborts before re-showing the panel');
}

section('D2D map — "Search this area" viewport knock loader (fixes the 500-recent cap)');
{
  const src = readD2DLive();

  // The spatial loader exists and is wired into the public shim so the map
  // control (and any future caller) can reach it.
  assert('D2D core defines loadKnocksInViewport()',
    /async function loadKnocksInViewport\s*\(/.test(src));
  assert('window.D2D shim exports loadKnocksInViewport',
    /loadKnocksInViewport:\s*state\.loadKnocksInViewport/.test(src));

  // Bounding-box strategy: Firestore permits a range on ONE field, so lat is
  // range-filtered server-side and lng is filtered client-side.
  assert('viewport query range-filters lat server-side (>= and <=)',
    /where\(\s*['"]lat['"]\s*,\s*['"]>=['"]/.test(src) &&
    /where\(\s*['"]lat['"]\s*,\s*['"]<=['"]/.test(src));
  assert('viewport query filters lng client-side',
    /lng\s*>=\s*west\s*&&\s*lng\s*<=\s*east/.test(src));

  // Tenancy: the viewport query must stay scoped to userId / companyId — it
  // must never widen the read surface. Scope the check to the function body.
  const vp = src.slice(src.indexOf('async function loadKnocksInViewport'));
  const vpBody = vp.slice(0, 2200);
  assert('viewport query keeps rep (userId) tenancy scope',
    /where\(\s*['"]userId['"]\s*,\s*['"]==['"]/.test(vpBody));
  assert('viewport query keeps team (companyId) tenancy scope',
    /where\(\s*['"]companyId['"]\s*,\s*['"]==['"]/.test(vpBody));

  // Default first paint is UNCHANGED — 500-most-recent is still the boot
  // loader, so nothing regresses.
  assert('KNOCK_PAGE_SIZE default stays 500 (no regression to first paint)',
    /KNOCK_PAGE_SIZE\s*=\s*500/.test(src));

  // The Search-this-area control is created and CSP-safe (addEventListener,
  // not inline onclick).
  assert('createSearchAreaControl builds the #d2d-search-area pill',
    /function createSearchAreaControl\s*\(/.test(src) &&
    /id\s*=\s*['"]d2d-search-area['"]/.test(src));
  assert('search control is wired via addEventListener (CSP-safe, no inline onclick)',
    /search\.addEventListener\(\s*['"]click['"]/.test(src));
  assert('moveend handler is armed after init (no flash on the setView/invalidateSize settle)',
    /_searchAreaArmed/.test(src) &&
    /on\(\s*['"]moveend['"]\s*,\s*_onMapMoveForSearch\)/.test(src));

  // Oscillation guard (the #1061/#1062 lesson): the moveend handler and its
  // visibility toggle must NOT mutate the map — no setView/fitBounds/
  // invalidateSize — so the handler can't re-trigger its own moveend.
  const mh = src.slice(src.indexOf('function _onMapMoveForSearch'),
                       src.indexOf('async function runSearchThisArea'));
  assert('search move/visibility handlers perform no map mutation (no oscillation)',
    !/(setView|fitBounds|invalidateSize|flyTo|panTo|panBy)/.test(mh));

  // Honest feedback: loading state, result count, and an empty state that
  // reads "searched, none here" — distinct from "not loaded yet".
  assert('viewport search has an honest empty state',
    /No knocks logged in this area/.test(src));
  assert('viewport search reports a result count',
    /\$\{n\} knock/.test(src) && /in this area/.test(src));

  // Plain refresh affordance (there was previously no re-pull short of reload).
  assert('D2D exposes a plain refreshKnocks re-pull',
    /async function refreshKnocks\s*\(/.test(src) &&
    /refreshKnocks:\s*state\.refreshKnocks/.test(src));
}

section('D2D map — map-data diagnostic ("why is my map empty?")');
{
  const src = readD2DLive();

  // The diagnostic exists and is reachable from the shim (button + console).
  assert('D2D core defines runMapDiagnostics()',
    /async function runMapDiagnostics\s*\(/.test(src));
  assert('window.D2D shim exports mapDiagnostics',
    /mapDiagnostics:\s*state\.runMapDiagnostics/.test(src));

  // It uses a cheap server-side COUNT aggregation (no doc reads) to learn the
  // true total for the account — the number that disambiguates #1 vs #2 vs #3.
  assert('diagnostic uses getCountFromServer (aggregation, not a full read)',
    /getCountFromServer/.test(src));

  // Tenancy: the count query stays scoped to userId / companyId.
  const diag = src.slice(src.indexOf('async function runMapDiagnostics'));
  const diagBody = diag.slice(0, 2600);
  assert('diagnostic count query keeps rep (userId) tenancy scope',
    /where\(\s*['"]userId['"]\s*,\s*['"]==['"]/.test(diagBody));
  assert('diagnostic count query keeps team (companyId) tenancy scope',
    /where\(\s*['"]companyId['"]\s*,\s*['"]==['"]/.test(diagBody));

  // It distinguishes a silent load failure (#3) from a genuinely-empty
  // account (#2): loadKnocks must record the error, and the diagnostic reads it.
  assert('loadKnocks records state.lastKnockLoadError on failure',
    /state\.lastKnockLoadError\s*=\s*\{\s*message:/.test(src));
  assert('loadKnocks clears state.lastKnockLoadError on a clean load',
    /state\.lastKnockLoadError\s*=\s*null/.test(src));
  assert('diagnostic reads the recorded load error',
    /state\.lastKnockLoadError/.test(diagBody));

  // It names all five ranked hypotheses in its verdict text.
  assert('diagnostic verdict covers hypotheses #1–#5',
    /\(#1\)/.test(src) && /\(#2\)/.test(src) && /\(#3\)/.test(src) &&
    /\(#4\)/.test(src) && /\(#5\)/.test(src));

  // Surfaced via a CSP-safe button in the (existing) layer panel.
  assert('layer panel exposes a CSP-safe diagnostics button',
    /id\s*=\s*['"]d2d-map-diag['"]/.test(src) &&
    /diag\.addEventListener\(\s*['"]click['"][\s\S]*?runMapDiagnostics\(\)/.test(src));
}

section('firestore.indexes.json — knocks [tenant, lat] viewport indexes (deploy on merge)');
{
  const idx = JSON.parse(read(path.join(ROOT, 'firestore.indexes.json')));
  const hasKnockIndex = (fields) => idx.indexes.some(i =>
    i.collectionGroup === 'knocks' &&
    Array.isArray(i.fields) &&
    i.fields.length === fields.length &&
    i.fields.every((f, n) => f.fieldPath === fields[n]));
  assert('knocks [userId, lat] index present (rep viewport scope)',
    hasKnockIndex(['userId', 'lat']));
  assert('knocks [companyId, lat] index present (team viewport scope)',
    hasKnockIndex(['companyId', 'lat']));
}

};

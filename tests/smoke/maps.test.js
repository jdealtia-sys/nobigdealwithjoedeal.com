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
  assert('Customers panel offers 3 color-by dimensions (stage/damage/value)',
    /_CUST_DIM_KEYS\s*=\s*\['stage',\s*'damage',\s*'value'\]/.test(maps)
    && /data-cust-colorby/.test(maps),
    'expected a color-by selector over stage/damage/value dimensions');
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
}

section('Customers map layer — dashboard.html wiring');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('dashboard.html loads maps-customers.js between overlays and routing',
    /maps-overlays\.js[\s\S]{0,80}maps-customers\.js[\s\S]{0,80}maps-routing\.js/.test(dash),
    'expected the customers module in the locked core→overlays→customers→routing order');
  assert('Customers overlay toggle rendered',
    /data-action="mapOverlay"\s+data-target="customers"/.test(dash),
    'expected a Customers overlay-row toggle');
  assert('Customers map FAB rendered',
    /id="fab-customers"[\s\S]{0,120}data-arg="customers"/.test(dash),
    'expected a Customers map FAB wired to fabToggle');
}

};

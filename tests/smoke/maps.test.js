/**
 * tests/smoke/maps.test.js — Hail overlay on D2D + Pipeline badge,
 * Storm Briefing automation, large-view extractions for photos +
 * admin templates.
 */

'use strict';

const path = require('path');
const { ROOT, PRO_JS, FUNCTIONS, read, readCrm, readD2DLive } = require('./_shared');

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

};

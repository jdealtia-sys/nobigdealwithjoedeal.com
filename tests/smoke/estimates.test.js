/**
 * tests/smoke/estimates.test.js — V2 Builder (prefill, live snapshot,
 * autosave), measurement pass-through, voice memo transcription,
 * feature flags, V2 preview titleMap, UI-A HOVER Auto-measure.
 */

'use strict';

const path = require('path');
const { ROOT, PRO_JS, FUNCTIONS, read, readDashboard, readFunctionsIndex } = require('./_shared');

module.exports.run = function run(ctx) {
  const { assert, section } = ctx;

section('UI-A: HOVER Auto-measure in V2 Builder');
{
  const src = read(path.join(PRO_JS, 'estimate-v2-ui.js'));
  assert('Auto-measure button present', /data-action="auto-measure"/.test(src));
  assert('auto-measure case dispatches autoMeasure()',
    /case 'auto-measure':[\s\S]{0,80}autoMeasure\(\)/.test(src));
  assert('autoMeasure polls measurements/{jobId}',
    /measurements',\s*jobId/.test(src) && /status === 'ready'/.test(src));
  assert('applyMeasurementResult normalizes provider fields',
    /function applyMeasurementResult/.test(src));
}

section('Push-2: measurement pass-through line item');
{
  const src = read(path.join(PRO_JS, 'estimate-v2-ui.js'));
  assert('state.passThru seeded', /passThru: \[\]/.test(src));
  assert('applyMeasurementResult adds SVC MEASURE-RPT',
    /source: 'measurement'/.test(src) && /Aerial measurement report/.test(src));
  assert('getCurrentEstimate appends passThru to estimate.lines',
    /for \(const p of \(state\.passThru \|\| \[\]\)\)/.test(src));
  assert('removeFromScope clears from passThru first',
    /state\.passThru\s*=\s*\(state\.passThru \|\| \[\]\)\.filter/.test(src));
  assert('scope empty guard allows passThru-only quotes',
    /!state\.scope\.length && !\(state\.passThru && state\.passThru\.length\)/.test(src));
}

section('Wave B2: V2 prefill from lead');
{
  const src = read(path.join(PRO_JS, 'estimate-v2-ui.js'));
  assert('prefillFromLead helper defined', /function prefillFromLead\(leadId\)/.test(src));
  assert('syncCustomerInputs helper defined', /function syncCustomerInputs\(\)/.test(src));
  assert('open() accepts leadId', /function open\(opts\)/.test(src));
  assert('sendForSignature retries prefill before erroring',
    /prefillFromLead\(state\.customer\.leadId\)/.test(src));
}

section('Job Templates: "Add to Existing Customer" survives a repaint (attach fix)');
{
  const src = read(path.join(PRO_JS, 'job-templates-ui.js'));
  // The lead picker must mirror the pick into state.leadId (the source of
  // truth), or a reRender() rebuilds the create step from an empty state.leadId
  // and the estimate saves with leadId:null — "created but not attached".
  assert('_jtWireLeadPicker syncs the pick into state.leadId via onSelect',
    /function _jtWireLeadPicker[\s\S]{0,1600}onSelect:\s*function\s*\(lead\)\s*\{[\s\S]{0,160}state\.leadId\s*=/.test(src));
  // The create step's hidden #jtLeadSel must derive its value from state.leadId
  // so a repaint re-hydrates the selection instead of clearing it.
  assert('create step hydrates #jtLeadSel from state.leadId',
    /id="jtLeadSel"[\s\S]{0,80}state\.leadId\s*\?/.test(src));
  // doCreateEstimate still reads that input to attribute the estimate.
  assert('doCreateEstimate reads #jtLeadSel for attribution',
    /doCreateEstimate[\s\S]{0,260}getElementById\('jtLeadSel'\)/.test(src));
}

section('V2 builder: new estimate keeps its customer link (leadId not orphaned)');
{
  const src = read(path.join(PRO_JS, 'estimate-v2-ui.js'));
  // state.leadId is set only on reopen; a fresh estimate links via
  // state.customer.leadId (prefillFromLead). _buildSavePayload must fall back to
  // it, or new estimates save leadId:null — orphaned off the customer + no lead
  // jobValue/primaryEstimate stamp-back.
  assert('_buildSavePayload falls back to state.customer.leadId',
    /function _buildSavePayload[\s\S]{0,1600}leadId:\s*state\.leadId\s*\|\|\s*\(state\.customer && state\.customer\.leadId\)\s*\|\|\s*null/.test(src));
  assert('prefillFromLead is the fresh-open customer link',
    /function prefillFromLead\(leadId\)[\s\S]{0,800}state\.customer\.leadId = leadId/.test(src));
}

section('Wave B3: live estimates snapshot');
{
  // CSP hotfix: subscribe wiring is in dashboard-bootstrap.module.js.
  const dash = readDashboard();
  assert('onSnapshot imported',    /onSnapshot/.test(dash));
  assert('_subscribeEstimates wired', /window\._subscribeEstimates/.test(dash));
  assert('subscribe called on auth ready',
    /window\._subscribeEstimates\(\)/.test(dash));
}

section('F7: V2 Builder autosave');
{
  const src = read(path.join(PRO_JS, 'estimate-v2-ui.js'));
  assert('saveDraftDebounced called from render',
    /function render\(\)[\s\S]{0,400}saveDraftDebounced\(\)/.test(src));
  assert('collectDraft bundles state',
    /function collectDraft\(\)[\s\S]{0,400}scope:\s*state\.scope/.test(src));
  assert('restoreDraft merges local + remote',
    /function restoreDraft[\s\S]{0,600}estimate_drafts/.test(src));
  assert('clearDraft on successful save',
    /window\._v2SavedEstimateId = savedId[\s\S]{0,200}clearDraft\(\)/.test(src));
  const rules = read(path.join(ROOT, 'firestore.rules'));
  assert('estimate_drafts rules: owner only',
    /match \/estimate_drafts\/\{uid\}[\s\S]{0,200}isOwner\(uid\)/.test(rules));
}

section('F8: Voice memo transcription');
{
  const srv = read(path.join(FUNCTIONS, 'integrations/voice-memo.js'));
  assert('transcribeVoiceMemo callable exported',
    /exports\.transcribeVoiceMemo\s*=/.test(srv));
  assert('rate-limited 20/hour/uid',
    /callable:transcribeVoiceMemo:uid[\s\S]{0,80}20,\s*60 \* 60_000/.test(srv));
  assert('audio size capped',
    /MAX_AUDIO_BYTES\s*=\s*1_500_000/.test(srv));
  assert('writes activity on the lead',
    /type: 'voice_memo'/.test(srv));
  const cli = read(path.join(PRO_JS, 'voice-memo.js'));
  assert('client exposes window.NBDVoiceMemo',
    /window\.NBDVoiceMemo\s*=/.test(cli));
  assert('client uses MediaRecorder',
    /new MediaRecorder/.test(cli));
  const shared = read(path.join(FUNCTIONS, 'integrations/_shared.js'));
  assert('DEEPGRAM_API_KEY in secrets registry',
    /DEEPGRAM_API_KEY:\s*defineSecret\('DEEPGRAM_API_KEY'\)/.test(shared));
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // Voice memo button on the lead detail modal. The label was
  // shortened from "Record Voice Memo" to "Voice Memo" in the
  // 2026-05-05 modal redesign (cd-share-row), so the assertion
  // checks for the wiring (NBDVoiceMemo.recordForLead) AND the
  // label text — both must be present for the button to actually
  // record a memo. If you rename the label, update the regex but
  // KEEP the recordForLead wiring check.
  assert('Voice Memo button on lead detail',
    /(Voice Memo|Record Voice Memo)/.test(dash) &&
    /data-action="call" data-fn="cdaVoiceMemo"/.test(dash));
  const idx = readFunctionsIndex();
  assert('integrationStatus reports deepgram',
    /deepgram:\s*_hasInt\('DEEPGRAM_API_KEY'\)/.test(idx));
}

section('F9: Feature flags');
{
  const cli = read(path.join(PRO_JS, 'feature-flags.js'));
  assert('client exposes window.NBDFlags',
    /window\.NBDFlags\s*=/.test(cli));
  assert('reads _default + per-uid override',
    /feature_flags.*_default[\s\S]{0,400}window\._user\.uid/.test(cli));
  const rules = read(path.join(ROOT, 'firestore.rules'));
  assert('_default readable by authed users',
    /match \/feature_flags\/_default[\s\S]{0,200}allow read: if isAuth\(\)/.test(rules));
  assert('platform admin is the only writer',
    /match \/feature_flags\/_default[\s\S]{0,300}allow write: if isAdmin\(\)/.test(rules));
}

// ── V2 preview: titleMap key matches button data-arg ─────────
section('V2 preview titleMap alignment');
{
  const src = read(path.join(PRO_JS, 'estimate-v2-ui.js'));
  assert('finalize button data-arg uses internal-view',
    /data-arg="internal-view"/.test(src));
  assert("titleMap has 'internal-view' key (not legacy 'internal')",
    /'internal-view'\s*:/.test(src) && !/'internal'\s*:/.test(src));
  assert('FORMAT_ALIASES maps legacy names',
    /FORMAT_ALIASES\s*=\s*\{[^}]*internal:/.test(src));
  assert('guards formatter exception with try/catch',
    /formatEstimate\s*\(estimate,\s*format,\s*meta\);[\s\S]{0,200}catch/.test(src));
}

// ════════════════════════════════════════════════════════════════════
// JOB TEMPLATES — existence + CSP wiring smoke (appended 2026-07-19,
// job-templates harness buildout; deep data/engine coverage lives in
// tests/job-templates.test.js).
//
// The trio is authored in PARALLEL sessions and lands in arbitrary
// order, so every check is per-file soft-skip: absent → note + skip,
// present → locked in. No cross-file dependency asserts (they'd redline
// CI between landings). Durable existence protection after buildout:
// each landed file must be wired into the script-loader estimates
// bundle (smoke-tests-assert-existence RULE — grep tests/ before
// deleting code; this block is that tripwire).
// ════════════════════════════════════════════════════════════════════
section('Job Templates: existence + CSP wiring');
{
  const fs = require('fs');
  const JT_FILES = ['job-templates-data.js', 'job-templates.js', 'job-templates-ui.js'];
  const present = JT_FILES.filter(f => fs.existsSync(path.join(PRO_JS, f)));
  if (present.length === 0) {
    console.log('  (skip — job-templates files not present yet)');
  } else {
    for (const f of JT_FILES) {
      if (!present.includes(f)) { console.log('  (skip — ' + f + ' not present yet)'); continue; }
      assert('docs/pro/js/' + f + ' exists on disk', fs.existsSync(path.join(PRO_JS, f)));
    }
    // Wiring: every LANDED file must ride the estimates bundle in
    // script-loader.js (a landed-but-unwired file is dead code; checked
    // only for present files so parallel landing order never reds CI).
    const loaderPath = path.join(PRO_JS, 'script-loader.js');
    if (fs.existsSync(loaderPath)) {
      const loader = read(loaderPath);
      for (const f of present) {
        assert(f + ' is wired into the script-loader estimates bundle',
          new RegExp('js/' + f.replace(/[.]/g, '\\.')).test(loader));
      }
    }

    // CSP: /pro ships script-src WITHOUT 'unsafe-inline' — zero inline
    // on*= handler strings allowed, even inside JS-generated markup
    // (csp-onclick sweep RULE). Named-event match avoids false hits on
    // identifiers like "online".
    const INLINE_HANDLER_RE = /\son(?:click|dblclick|change|input|submit|reset|load|error|focus|blur|keydown|keyup|keypress|mouseover|mouseout|mouseenter|mouseleave|mousedown|mouseup|touchstart|touchend|contextmenu|scroll|wheel|dragstart|dragover|drop|paste|copy)\s*=\s*["'`]/gi;
    for (const f of present) {
      const src = read(path.join(PRO_JS, f));
      const hits = (src.match(INLINE_HANDLER_RE) || []).length;
      assert(f + ' has zero inline on*= handler strings', hits === 0,
        'found ' + hits + ' inline handler attribute(s)');
    }

    // UI delegate: ONE delegated listener keyed on data-jt-action (the
    // delegate must load on the page that renders the markup).
    if (present.includes('job-templates-ui.js')) {
      const ui = read(path.join(PRO_JS, 'job-templates-ui.js'));
      assert('job-templates-ui.js uses data-jt-action attributes', /data-jt-action/.test(ui));
      assert('job-templates-ui.js binds its delegated listener (addEventListener + data-jt-action)',
        /addEventListener\(\s*['"](?:click|change|input)['"]/.test(ui) && /data-jt-action|jtAction/.test(ui));
    } else {
      console.log('  (skip — job-templates-ui.js delegate check awaits the file)');
    }
  }
}

};

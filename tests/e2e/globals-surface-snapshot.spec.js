// @ts-check
// Globals-surface snapshot (opt-in; not part of the pinned CI e2e job).
//
// Logs in, hydrates the dashboard, then records `typeof window[name]` and a
// stable identity fingerprint for a list of names. Purpose: prove that a
// refactor which deletes `window.X = X` lines changes NOTHING about the live
// window surface. Run it once before the change and once after, then diff the
// two JSON files — an empty diff is the proof.
//
// Written for Globals Tranche 3 slice T3-A (2026-08-31), when dashboard-actions.js
// still carried 86 guarded forward-reference re-exports and static analysis said
// every one was either dead (subject defined in a LATER-loading script, so the
// typeof guard is false at this file's execution time) or redundant (subject
// already an auto-global from an earlier classic script). Static reasoning about
// classic-script load order is exactly the kind of claim that deserves an
// empirical check, so this makes one. All 86 are now deleted; the PINNED list
// below keeps their names covered so a re-export cannot creep back unnoticed.
//
// Extended 2026-09-01 (slice T3-M) to also exercise the LIVE dispatch path:
// it calls the real _nbdResolveMapped for every _NBD_TOGGLE_FNS /
// _NBD_MODAL_CLOSE_FNS entry and for every modalBackdropClose target, and
// reports what each resolves through. That part is not a before/after diff —
// it is a standalone assertion that no map-dispatched control is dead.
//
// Run against the emulator suite:
//   cd tests && npx firebase emulators:exec --only auth,firestore,storage,hosting \
//     --project nobigdeal-pro "node ./e2e/fixtures/seed-emulator.js && \
//     PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 \
//     PLAYWRIGHT_TEST_USER_EMAIL=playwright-e2e@nbd.test \
//     PLAYWRIGHT_TEST_USER_PASSWORD=nbd-e2e-password-1 \
//     GLOBALS_SNAPSHOT_OUT=.globals-before.json \
//     npx playwright test globals-surface-snapshot.spec.js"
// Output: JSON at tests/e2e/<GLOBALS_SNAPSHOT_OUT || .globals-snapshot.json>

const fs = require('fs');
const path = require('path');
const { test } = require('@playwright/test');
const { requireTestUser, loginAs } = require('./fixtures/auth');

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});

// The 75 forward-reference subjects in dashboard-actions.js, read from source so
// the list can never drift from the file under test.
function forwardRefNames() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'pro', 'js', 'dashboard-actions.js'), 'utf8');
  const names = [];
  for (const line of src.split('\n')) {
    const m = line.match(
      /^if\s*\(\s*typeof\s+([A-Za-z_$][\w$]*)\s*(?:!==|!=)\s*['"](?:undefined|function)['"]\s*\)\s*\{?\s*window\.\1\s*=\s*\1\s*;?\s*\}?/);
    if (m) names.push(m[1]);
  }
  return names;
}

// Names this slice must not disturb, listed explicitly so the snapshot still
// covers them after the forward-reference block is deleted.
const PINNED = [
  'searchMap', 'selectPin', 'deletePin', 'clearAllPins', 'toggleMapSidebar',
  'updatePinStats', 'loadSampleData', 'handleCardClick', 'toggleOverlay',
  'restoreDeletedLead', 'permanentDeleteLead', 'goToLeadFromPin',
  'deleteLeadFromPin', 'makeLeadFromPin', 'deletePinOnly', 'dropPinByAddress',
  'drop', 'openPinConfirm', 'cancelPinConfirm', 'commitPin', 'selectAcItem',
  'hideAcDrop', 'makeLeadFromSearch', 'fetchPropertyIntel', 'searchDraw',
  'selLT', 'toggleDraw', 'clearDraw', 'undoLine', 'deleteLine',
  'exportDrawReport', 'importToEstimate', 'setDrawMode', 'perimChooseType',
  'selectLine', 'deselectLine', 'retypeLine', 'erToggleSegment', 'openPhotoFor',
  'closePhotoModal', 'uploadPhotos', 'renderPhotoLeads', 'renderPhotoGrid',
  'closeUploadDoc', 'saveDocUpload', 'openDocTemplate', 'closeDocViewer',
  'sendJoeMessage', 'joeQuick', 'saveJoeKey', 'clearJoeKey', 'openTips',
  'closeTips', 'applyTheme', 'goToWithTheme', 'showToast', 'nbdPickerOpen',
  'nbdPickerClose', 'nbdPickerTab', 'nbdHowtoOpen', 'nbdHowtoClose',
  'nbdApplyTheme', 'nbdApplyFont', 'nbdRandom', 'nbdSaveCustom', 'nbdSetCat',
  'toggleNavSection', 'toggleSettingsSection', 'clearCrmSearch',
  'closePropertyIntelModal', 'closePropertyIntelConfirmModal',
  'markAllNotificationsRead', 'markNotificationRead', 'dsPickTheme',
  'renderLeaderboard',
  // The second, earlier forward-reference block in the same file (same inert
  // pattern, different comparison form: `typeof X === 'function'`).
  // tasks.js loads AFTER dashboard-actions.js; estimates.js is never a static
  // <script> at all — it only arrives through the lazy ScriptLoader bundle.
  'openTaskModal', 'closeTaskModal', 'addTask', 'removeTask',
  'saveEstimate', 'cancelEstimate', 'viewEstimate',
  // Unguarded direct exports that live in the same region and must SURVIVE —
  // these are owned by dashboard-actions.js, not forward references.
  'mobileNav', 'toggleMobileMore', 'closeMobileMore',
];

test('globals-surface-snapshot @globals', async ({ page }) => {
  test.setTimeout(180000);
  const user = requireTestUser();
  await loginAs(page, user);
  await page.goto((process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5000') + '/pro/dashboard',
    { waitUntil: 'domcontentloaded' });
  // Let the deferred script queue finish and the dashboard hydrate.
  await page.waitForTimeout(6000);

  // GLOBALS_SNAPSHOT_EXTRA: comma-separated extra names to record — lets a
  // conversion slice run the SAME list before and after its change without
  // editing this file mid-measurement (Tranche 3 dispatch-map slice,
  // 2026-09-02). A converted name is EXPECTED to read 'missing' in the
  // after-run; the differential is the proof.
  const extra = (process.env.GLOBALS_SNAPSHOT_EXTRA || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const names = Array.from(new Set([...forwardRefNames(), ...PINNED, ...extra])).sort();

  const snap = await page.evaluate((ns) => {
    /* eslint-disable no-undef */
    const out = {};
    const fingerprint = (v) => {
      const s = String(v);
      let h = 0;
      for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
      return 'len' + s.length + ':h' + h;
    };
    for (const n of ns) {
      let t = 'missing';
      let src = '';
      try {
        const v = window[n];
        t = typeof v;
        // A function's source text is a stable identity fingerprint: if the
        // deletion accidentally rebound a name to a DIFFERENT function, the
        // hash changes even though typeof does not.
        if (typeof v === 'function') src = fingerprint(v);
      } catch (e) { t = 'threw'; }
      out[n] = t + (src ? ' ' + src : '');
    }

    // ── Dispatch-map resolution (Globals Tranche 3, 2026-09-01) ──
    // A name reachable only through _NBD_TOGGLE_FNS / _NBD_MODAL_CLOSE_FNS is
    // now allowed to live in __NBD_CALL_REGISTRY instead of on window, so
    // "is it on window" is no longer the question that matters for it. Call the
    // REAL shipped resolver — _nbdResolveMapped is a top-level declaration in
    // dashboard-ui.js, so it is reachable here — and record what each map entry
    // actually resolves to. Any 'UNRESOLVED' is a control the user cannot
    // operate: for the modal map specifically, a dialog that will not close.
    const resolveMapped = (typeof _nbdResolveMapped === 'function') ? _nbdResolveMapped : null;
    out.__resolver = resolveMapped ? 'present' : 'MISSING — dispatch maps cannot resolve';
    const reg = window.__NBD_CALL_REGISTRY || {};
    for (const [mapName, map] of [
      ['TOGGLE', typeof _NBD_TOGGLE_FNS !== 'undefined' ? _NBD_TOGGLE_FNS : null],
      ['MODAL', typeof _NBD_MODAL_CLOSE_FNS !== 'undefined' ? _NBD_MODAL_CLOSE_FNS : null],
    ]) {
      if (!map) { out['__map_' + mapName] = 'MAP UNREACHABLE'; continue; }
      for (const key of Object.keys(map)) {
        const fnName = map[key];
        const via = (typeof reg[fnName] === 'function') ? 'registry'
          : (typeof window[fnName] === 'function') ? 'window' : 'NOWHERE';
        const fn = resolveMapped ? resolveMapped(fnName) : null;
        out['__map_' + mapName + '_' + key] = (typeof fn === 'function')
          ? 'resolved via ' + via + ' ' + fingerprint(fn)
          : 'UNRESOLVED (' + fnName + ' found in ' + via + ')';
      }
    }
    // ── modalBackdropClose (Globals Tranche 3, 2026-09-01) ──
    // A THIRD dispatcher over the same closeXxx namespace, and the only one
    // where data-target is the RAW function name straight out of the page. It
    // had no allowlist gate at all; it is now gated on _NBD_MODAL_CLOSE_FNS's
    // values and resolved registry-first. The @audit spec cannot see this
    // branch — 'modalBackdropClose' is in its UI_ACTIONS set but has no case in
    // its switch, so it falls through to default and always reports ok. Check
    // the real markup against the real gate here instead.
    const closeVals = (typeof _NBD_MODAL_CLOSE_FNS !== 'undefined')
      ? Object.keys(_NBD_MODAL_CLOSE_FNS).map(k => _NBD_MODAL_CLOSE_FNS[k]) : [];
    document.querySelectorAll('[data-action="modalBackdropClose"]').forEach((el, i) => {
      const t = el.dataset.target || '(none)';
      const gated = closeVals.indexOf(t) !== -1;
      const fn = resolveMapped ? resolveMapped(t) : null;
      out['__backdrop_' + i + '_' + t] = !gated
        ? 'BLOCKED BY GATE (not a _NBD_MODAL_CLOSE_FNS value) — backdrop click is now inert'
        : (typeof fn === 'function' ? 'ok (gated + resolves)' : 'UNRESOLVED after gate');
    });

    return out;
  }, names);

  const outFile = process.env.GLOBALS_SNAPSHOT_OUT || '.globals-snapshot.json';
  const dest = path.join(__dirname, outFile);
  fs.writeFileSync(dest, JSON.stringify(snap, null, 1));
  const nameEntries = Object.entries(snap).filter(([k]) => !k.startsWith('__'));
  const present = nameEntries.filter(([, v]) => !String(v).startsWith('missing')).length;
  const mapEntries = Object.entries(snap).filter(([k]) => k.startsWith('__map_'));
  const backdrops = Object.entries(snap).filter(([k]) => k.startsWith('__backdrop_'));
  const badBackdrops = backdrops.filter(([, v]) => !String(v).startsWith('ok'));
  const unresolved = mapEntries.filter(([, v]) => String(v).startsWith('UNRESOLVED') || String(v).includes('UNREACHABLE'))
    .concat(badBackdrops);
  console.log('GLOBALS_SNAPSHOT_WRITTEN ' + dest
    + ' names=' + nameEntries.length + ' present=' + present
    + ' missing=' + (nameEntries.length - present)
    + ' | mapEntries=' + mapEntries.length + ' backdrops=' + backdrops.length
    + ' unresolved=' + unresolved.length
    + ' resolver=' + snap.__resolver);
  if (unresolved.length) {
    console.log('UNRESOLVED DISPATCH-MAP ENTRIES (each is a control the user cannot operate):');
    for (const [k, v] of unresolved) console.log('  ' + k + ' -> ' + v);
  }
});

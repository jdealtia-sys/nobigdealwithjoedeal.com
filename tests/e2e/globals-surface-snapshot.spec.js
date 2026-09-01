// @ts-check
// Globals-surface snapshot (opt-in; not part of the pinned CI e2e job).
//
// Logs in, hydrates the dashboard, then records `typeof window[name]` and a
// stable identity fingerprint for a list of names. Purpose: prove that a
// refactor which deletes `window.X = X` lines changes NOTHING about the live
// window surface. Run it once before the change and once after, then diff the
// two JSON files — an empty diff is the proof.
//
// Written for Globals Tranche 3 slice T3-A (2026-08-31): dashboard-actions.js
// carries 75 guarded forward-reference re-exports, and static analysis says
// every one is either dead (the subject is defined in a LATER-loading script,
// so the typeof guard is false at this file's execution time) or redundant
// (the subject is already an auto-global from an earlier classic script).
// Static reasoning about classic-script load order is exactly the kind of
// claim that deserves an empirical check, so this makes one.
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

  const names = Array.from(new Set([...forwardRefNames(), ...PINNED])).sort();

  const snap = await page.evaluate((ns) => {
    /* eslint-disable no-undef */
    const out = {};
    for (const n of ns) {
      let t = 'missing';
      let src = '';
      try {
        const v = window[n];
        t = typeof v;
        // A function's source text is a stable identity fingerprint: if the
        // deletion accidentally rebound a name to a DIFFERENT function, the
        // hash changes even though typeof does not.
        if (typeof v === 'function') {
          const s = String(v);
          let h = 0;
          for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
          src = 'len' + s.length + ':h' + h;
        }
      } catch (e) { t = 'threw'; }
      out[n] = t + (src ? ' ' + src : '');
    }
    return out;
  }, names);

  const outFile = process.env.GLOBALS_SNAPSHOT_OUT || '.globals-snapshot.json';
  const dest = path.join(__dirname, outFile);
  fs.writeFileSync(dest, JSON.stringify(snap, null, 1));
  const present = Object.values(snap).filter(v => !String(v).startsWith('missing')).length;
  console.log('GLOBALS_SNAPSHOT_WRITTEN ' + dest
    + ' names=' + names.length + ' present=' + present
    + ' missing=' + (names.length - present));
});

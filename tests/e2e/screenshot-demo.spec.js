// @ts-check
// screenshot-demo.spec.js — NOT a pass/fail assertion suite. Boots the app in
// the emulator, logs in, injects a realistic Cincinnati-area book in memory,
// and captures the map (Customers layer + control panel, pins) and the kanban
// so the map/kanban work built on this branch can be eyeballed. Screenshots
// land in tests/screenshots/. Tagged @shots so the normal suites skip it.
//
// NETWORK REQUIREMENT: the app loads the Firebase SDK from www.gstatic.com,
// Google Fonts from fonts.googleapis.com, and basemap tiles from
// server.arcgisonline.com at runtime. This spec therefore only works in an
// environment whose network policy ALLOWS those hosts. In a locked-down
// sandbox (e.g. the default Claude Code container, which 403s gstatic) auth
// can't initialize and the run stops at the login page — that's the network
// policy, not the app.
//
// RUN (from tests/, with @playwright/test + firebase-tools installed and a
// full Chromium available):
//   export PATH="$PWD/node_modules/.bin:$PATH"
//   export NBD_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome   # if the pinned browser is absent
//   firebase emulators:exec --only auth,firestore,storage,hosting --project nobigdeal-pro \
//     "node ./e2e/fixtures/seed-emulator.js && PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 \
//      PLAYWRIGHT_TEST_USER_EMAIL=playwright-e2e@nbd.test PLAYWRIGHT_TEST_USER_PASSWORD=nbd-e2e-password-1 \
//      playwright test --config=playwright.config.js --workers=1 --grep @shots screenshot-demo.spec.js"
const { test } = require('@playwright/test');
const { requireTestUser, loginAs } = require('./fixtures/auth');
const path = require('path');

// The installed @playwright/test is newer than the pre-provisioned browser, so
// its default chrome-headless-shell is absent. Point at the full Chromium that
// ships in the image (env guidance) instead of downloading.
if (process.env.NBD_CHROMIUM) {
  test.use({ launchOptions: { executablePath: process.env.NBD_CHROMIUM } });
}

const OUT = path.join(__dirname, '..', 'screenshots');

// A spread of leads around NBD's Cincinnati home view (map centres ~39.07,-84.17),
// varied by stage / damage / value so color-by + filters + $ labels have signal.
const DEMO_LEADS = [
  { id: 'shot-1', firstName: 'Ann',   lastName: 'Reynolds', address: '11 Oak St, Cincinnati, OH',   lat: 39.10, lng: -84.51, stage: 'closed',           jobValue: 62000, damageType: 'Roof - Hail',        userId: 'U1' },
  { id: 'shot-2', firstName: 'Ben',   lastName: 'Carter',   address: '22 Elm Ave, Cincinnati, OH',  lat: 39.14, lng: -84.46, stage: 'contacted',        jobValue: 8000,  damageType: 'Roof - Wind',        userId: 'U1' },
  { id: 'shot-3', firstName: 'Cara',  lastName: 'Diaz',     address: '33 Pine Rd, Cincinnati, OH',  lat: 39.09, lng: -84.42, stage: 'estimate_submitted', jobValue: 31000, damageType: 'Roof - Hail & Wind', userId: 'U2' },
  { id: 'shot-4', firstName: 'Dan',   lastName: 'Evans',    address: '44 Maple Dr, Cincinnati, OH', lat: 39.18, lng: -84.53, stage: 'install_in_progress', jobValue: 45000, damageType: 'Full Exterior',     userId: 'U2' },
  { id: 'shot-5', firstName: 'Erin',  lastName: 'Frost',    address: '55 Birch Ln, Cincinnati, OH', lat: 39.06, lng: -84.48, stage: 'lost',             jobValue: 0,     damageType: 'Fire',              userId: 'U1' },
  { id: 'shot-6', firstName: 'Gus',   lastName: 'Hill',     address: '66 Cedar Ct, Cincinnati, OH', lat: 39.15, lng: -84.39, stage: 'contract_signed',  jobValue: 27500, damageType: 'Water',             userId: 'U2' },
  { id: 'shot-7', firstName: 'Ivy',   lastName: 'Jones',    address: '77 Ash Blvd, Cincinnati, OH', lat: 39.12, lng: -84.36, stage: 'new',              jobValue: 0,     damageType: '',                  userId: 'U1' },
  { id: 'shot-8', firstName: 'Kai',   lastName: 'Lopez',    address: '88 Walnut Way, Cincinnati, OH', lat: 39.20, lng: -84.44, stage: 'final_payment',  jobValue: 54000, damageType: 'Roof - Hail',       userId: 'U2' },
];
const DEMO_PINS = [
  { id: 'p1', lat: 39.11, lng: -84.49, status: 'signed' },
  { id: 'p2', lat: 39.13, lng: -84.45, status: 'interested' },
  { id: 'p3', lat: 39.08, lng: -84.44, status: 'not-home' },
  { id: 'p4', lat: 39.16, lng: -84.41, status: 'callback' },
];
const DEMO_ZONES = [
  { id: 'z1', name: 'North Territory', color: '#22C55E', repLabel: 'Me',
    points: [{ lat: 39.17, lng: -84.55 }, { lat: 39.22, lng: -84.42 }, { lat: 39.14, lng: -84.37 }, { lat: 39.12, lng: -84.50 }] },
];

test.describe('@shots map + kanban screenshots', () => {
  let creds;
  test.beforeAll(() => { try { creds = requireTestUser(); } catch (e) { console.warn('[shots] ' + e.message); } });
  test.beforeEach(({}, testInfo) => { if (!creds) testInfo.skip(true, 'no test user'); });

  test('capture map + kanban', async ({ page }) => {
    test.setTimeout(180_000);
    page.setViewportSize({ width: 1440, height: 900 });
    page.on('console', m => { if (m.type() === 'error') console.log('[browser-console]', m.text().slice(0, 200)); });
    page.on('requestfailed', r => { const u = r.url(); if (/gstatic|firebase|googleapis/.test(u)) console.log('[req-failed]', u.slice(0, 120), r.failure() && r.failure().errorText); });
    // Pre-warm: load the login page and give the dynamically-imported Firebase
    // SDK (from gstatic, via the proxy) generous time to enable the button.
    await page.goto('/pro/login.html');
    const enabled = await page.waitForSelector('#loginBtn:not([disabled])', { timeout: 90_000 }).then(() => true).catch(() => false);
    console.log('[diag] login button enabled after pre-warm:', enabled);
    await loginAs(page, creds);

    // Inject the demo book in memory + point the map/board at it. This exercises
    // the real render paths (buildCustomersLayer, renderSavedZones, renderLeads)
    // without geocoding/Firestore round-trips — we're verifying VISUALS here.
    await page.evaluate(({ leads, pins, zones }) => {
      leads.forEach(l => { l._stageKey = window.normalizeStage ? window.normalizeStage(l.stage) : l.stage; l.companyId = (window._userClaims && window._userClaims.companyId) || (window._user && window._user.uid); });
      window._leads = leads;
      window._pins = pins;
      window._zones = zones;
      if (typeof window.renderLeads === 'function') { try { window.renderLeads(); } catch (e) {} }
    }, { leads: DEMO_LEADS, pins: DEMO_PINS, zones: DEMO_ZONES });

    // ── MAP ──
    await page.evaluate(() => { if (typeof window.goTo === 'function') window.goTo('map'); });
    await page.waitForSelector('#mainMap', { timeout: 15_000 });
    // Give Leaflet a beat to init, then turn on Customers + Pins + Heat and draw zones.
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      try { if (typeof window.mainMap !== 'undefined' && window.mainMap) window.mainMap.setView([39.13, -84.45], 12); } catch (e) {}
      try { if (window.overlayState) { window.overlayState.customers = true; window.showCustomersLayer && window.showCustomersLayer(); } } catch (e) {}
      try { if (typeof window.renderSavedZones === 'function') window.renderSavedZones(); } catch (e) {}
      try { if (typeof window.renderPinDispPanel === 'function') window.renderPinDispPanel(); } catch (e) {}
    });
    await page.waitForTimeout(2500); // markers + tiles settle
    await page.screenshot({ path: path.join(OUT, 'map-customers.png') });

    // Color-by Damage Type to show the dimension switch.
    await page.evaluate(() => {
      const sel = document.querySelector('.nbd-cust-panel [data-cust-colorby]');
      if (sel) { sel.value = 'damage'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, 'map-colorby-damage.png') });

    // Zoom in to trigger the $ value labels.
    await page.evaluate(() => { try { window.mainMap && window.mainMap.setView([39.13, -84.45], 16); } catch (e) {} });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT, 'map-value-labels.png') });

    // ── KANBAN ──
    await page.evaluate(() => { if (typeof window.goTo === 'function') window.goTo('crm'); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      try { window.buildKanbanColumns && window.buildKanbanColumns(window._currentViewKey || 'insurance'); } catch (e) {}
      try { window.renderLeads && window.renderLeads(window._leads); } catch (e) {}
    });
    await page.waitForSelector('#kanbanBoard, #view-crm .kanban-board', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, 'kanban.png'), fullPage: false });
  });
});

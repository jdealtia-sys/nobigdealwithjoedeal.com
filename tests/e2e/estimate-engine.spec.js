// @ts-check
// Estimate-engine integrity harness (PR 2c verification).
//
// Proves the estimate builder assembles IDENTICALLY whether its modules
// are eager (pre-2c) or lazy-loaded on demand (post-2c). The invariant we
// lock in: same product count, same merged catalog size, same tier rates,
// same config, and the V2 builder modal actually opens. If the lazy load
// order or the xactimate->builder CATALOG merge ever breaks, these numbers
// drift and the test fails — catching a revenue-critical regression before
// it ships.
//
// Local run (emulator, Rule-0 safe):
//   firebase emulators:start --only "auth,firestore,hosting" --project nobigdeal-pro
//   node scripts/seed-emulator.js   (with FIRESTORE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST set)
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 \
//   PLAYWRIGHT_TEST_USER_EMAIL=companyadmin@demo.test \
//   PLAYWRIGHT_TEST_USER_PASSWORD=Test123! \
//   npx playwright test estimate-engine.spec.js

const { test, expect } = require('@playwright/test');

const creds = {
  email: process.env.PLAYWRIGHT_TEST_USER_EMAIL,
  password: process.env.PLAYWRIGHT_TEST_USER_PASSWORD,
};

// cleanUrls-tolerant login: the hosting emulator serves /pro/dashboard
// (no .html), prod may serve either — match both.
async function login(page) {
  await page.goto('/pro/login.html');
  await page.waitForSelector('#loginBtn:not([disabled])', { timeout: 15_000 });
  await page.fill('#emailInput', creds.email);
  await page.fill('#passwordInput', creds.password);
  await Promise.all([
    page.waitForURL('**/pro/dashboard**', { timeout: 30_000 }),
    page.click('#loginBtn'),
  ]);
  // Dashboard lands on the HOME view by default (kanban is in the hidden
  // CRM view), so wait on a view-agnostic hydration signal: the router +
  // an authed user global.
  await page.waitForFunction(
    () => typeof window.goTo === 'function' &&
          !!(window._user || (window.auth && window.auth.currentUser)),
    null, { timeout: 25_000 }
  );
}

test.describe('Estimate engine — assembles identically (PR 2c)', () => {
  test.beforeEach(async ({}, info) => {
    if (!creds.email || !creds.password) info.skip(true, 'PLAYWRIGHT_TEST_USER_* not set');
  });

  test('builder opens + engine integrity snapshot', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

    await login(page);

    // Diagnostic dump (one run tells us the lay of the land).
    const diag = await page.evaluate(() => ({
      url: location.href,
      activeView: (document.querySelector('.view.active') || {}).id || null,
      hasStartNewEstimate: typeof window.startNewEstimate,
      hasOpenV2: typeof window.openEstimateV2Builder,
      hasBuilderV2: typeof window.EstimateBuilderV2,
      hasProducts: Array.isArray(window.NBD_PRODUCTS) ? window.NBD_PRODUCTS.length : 'undef',
      hasScriptLoader: typeof window.ScriptLoader,
    }));
    console.log('ESTIMATE_DIAG=' + JSON.stringify(diag));
    console.log('CONSOLE_ERRORS=' + JSON.stringify(consoleErrors.slice(0, 8)));

    // Trigger the estimate flow via the real entry point. Eager today;
    // after PR 2c this fires the load-then-run stub that pulls the bundle.
    await page.evaluate(() => {
      try { window.startNewEstimate && window.startNewEstimate(); } catch (e) {}
    });

    // Wait until the engine has FULLY assembled — the bundle loads its 12
    // modules sequentially, so require the LAST-stage globals (xactimate merge
    // done + logic/finalization/v2-ui all present), not just builder-v2's base
    // CATALOG. Waiting only on builder-v2 races the still-loading tail.
    await page.waitForFunction(
      () => !!(window.EstimateBuilderV2 && window.EstimateBuilderV2.CATALOG &&
               window.NBD_XACT_CATALOG && window.NBD_XACT_CATALOG.count > 0 &&
               window.EstimateLogic && window.EstimateFinalization && window.EstimateV2UI &&
               Array.isArray(window.NBD_PRODUCTS) && window.NBD_PRODUCTS.length > 0),
      null, { timeout: 25_000 }
    );
    // The stub re-dispatches startNewEstimate after the bundle loads, which
    // opens the V2 modal — give that a beat to land.
    await page.waitForFunction(() => !!document.getElementById('estV2Modal'), null, { timeout: 10_000 }).catch(() => {});

    const snap = await page.evaluate(() => {
      const B = window.EstimateBuilderV2 || {};
      return {
        products: (window.NBD_PRODUCTS || []).length,
        catalogKeys: Object.keys(B.CATALOG || {}).length,
        xactCount: (window.NBD_XACT_CATALOG && window.NBD_XACT_CATALOG.count) || 0,
        tierRates: B.TIER_RATES || null,
        config: window.NBD_ESTIMATE_CONFIG || null,
        hasCalc: typeof B.calculateAllTiers,
        hasLogic: typeof window.EstimateLogic,
        hasFinalization: typeof window.EstimateFinalization,
        hasV2UI: typeof window.EstimateV2UI,
        modalInDom: !!document.getElementById('estV2Modal'),
      };
    });

    // Print for baseline capture (grep ESTIMATE_ENGINE_SNAPSHOT in output).
    console.log('ESTIMATE_ENGINE_SNAPSHOT=' + JSON.stringify(snap));

    // Structural invariants (independent of the exact baseline numbers):
    expect(snap.products, 'NBD_PRODUCTS populated').toBeGreaterThan(0);
    expect(snap.catalogKeys, 'EstimateBuilderV2.CATALOG populated (xactimate merge ran)').toBeGreaterThan(50);
    expect(snap.hasCalc, 'calculateAllTiers present').toBe('function');
    expect(snap.hasLogic, 'EstimateLogic present').toBe('object');
    expect(snap.hasFinalization, 'EstimateFinalization present').toBe('object');
    expect(snap.hasV2UI, 'EstimateV2UI present').toBe('object');
    expect(snap.modalInDom, 'V2 builder modal opened (DOM created)').toBe(true);

    // Exact-match baseline guard. Filled in from the first (eager) run so
    // the post-2c lazy run must reproduce the same assembled engine.
    const BASELINE = process.env.ESTIMATE_BASELINE
      ? JSON.parse(process.env.ESTIMATE_BASELINE) : null;
    if (BASELINE) {
      expect(snap.products, 'product count unchanged').toBe(BASELINE.products);
      expect(snap.catalogKeys, 'merged catalog size unchanged').toBe(BASELINE.catalogKeys);
      expect(snap.xactCount, 'xactimate count unchanged').toBe(BASELINE.xactCount);
      expect(snap.tierRates, 'tier rates unchanged').toEqual(BASELINE.tierRates);
      expect(snap.config, 'estimate config unchanged').toEqual(BASELINE.config);
    }
  });
});

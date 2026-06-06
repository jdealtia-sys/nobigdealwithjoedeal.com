// @ts-check
// D2D lazy-load check (PR 2e). Proves the door-to-door tracker is NOT eager at
// boot and DOES load when the D2D view opens (goTo('d2d') preloads the `d2d`
// bundle; the existing waitForD2D() poller catches window.D2D when it lands).
//
// Local run (emulator, Rule-0 safe):
//   firebase emulators:start --only "auth,firestore,hosting" --project nobigdeal-pro
//   node scripts/seed-emulator.js   (with FIRESTORE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST set)
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 \
//   PLAYWRIGHT_TEST_USER_EMAIL=companyadmin@demo.test \
//   PLAYWRIGHT_TEST_USER_PASSWORD=Test123! \
//   npx playwright test d2d-engine.spec.js

const { test, expect } = require('@playwright/test');

const creds = {
  email: process.env.PLAYWRIGHT_TEST_USER_EMAIL,
  password: process.env.PLAYWRIGHT_TEST_USER_PASSWORD,
};

async function login(page) {
  await page.goto('/pro/login.html');
  await page.waitForSelector('#loginBtn:not([disabled])', { timeout: 15_000 });
  await page.fill('#emailInput', creds.email);
  await page.fill('#passwordInput', creds.password);
  await Promise.all([
    page.waitForURL('**/pro/dashboard**', { timeout: 30_000 }),
    page.click('#loginBtn'),
  ]);
  await page.waitForFunction(
    () => typeof window.goTo === 'function' &&
          !!(window._user || (window.auth && window.auth.currentUser)),
    null, { timeout: 25_000 }
  );
}

test.describe('D2D tracker — lazy load (PR 2e)', () => {
  test.beforeEach(async ({}, info) => {
    if (!creds.email || !creds.password) info.skip(true, 'PLAYWRIGHT_TEST_USER_* not set');
  });

  test('D2D is not eager and loads on the d2d view', async ({ page }) => {
    await login(page);

    // At boot the D2D bundle is lazy — window.D2D should not exist yet.
    const before = await page.evaluate(() => typeof window.D2D);

    // Open the D2D view — goTo preloads the `d2d` bundle; waitForD2D polls.
    await page.evaluate(() => { window.goTo && window.goTo('d2d'); });

    await page.waitForFunction(
      () => !!(window.D2D && typeof window.D2D.init === 'function' && window._D2DState),
      null, { timeout: 20_000 }
    );

    const after = await page.evaluate(() => ({
      D2D: typeof window.D2D,
      init: typeof (window.D2D && window.D2D.init),
      state: typeof window._D2DState,
    }));
    console.log('D2D_SNAPSHOT=before:' + before + ' after:' + JSON.stringify(after));

    expect(before, 'window.D2D is NOT eager (undefined at boot)').toBe('undefined');
    expect(after.D2D, 'window.D2D loaded after opening the view').toBe('object');
    expect(after.init, 'window.D2D.init is a function').toBe('function');
    expect(after.state, 'window._D2DState published by the core module').toBe('object');
  });
});

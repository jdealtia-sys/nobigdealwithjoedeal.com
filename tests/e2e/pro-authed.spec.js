// @ts-check
// Authenticated /pro/ surface tests. Path A (BIG_ROCKS Rock 3):
// a dedicated test user logs in to the live site so we catch
// regressions in the actual post-auth shell — kanban load,
// auth-state plumbing, plan-tier gating, etc.
//
// Provisioning + secret setup: tests/e2e/README.md
//
// Without PLAYWRIGHT_TEST_USER_EMAIL + PLAYWRIGHT_TEST_USER_PASSWORD
// set, every test in this file skips (no failure, no pass) so
// running the suite locally without secrets stays clean.

const { test, expect } = require('@playwright/test');
const { requireTestUser, loginAs } = require('./fixtures/auth');

test.describe('Authenticated /pro/ shell', () => {
  let creds;
  test.beforeAll(() => {
    try { creds = requireTestUser(); }
    catch (e) {
      // Surface a single notice, not an error per spec, so the CI
      // logs make it obvious why the authed suite skipped.
      // eslint-disable-next-line no-console
      console.warn('[pro-authed] ' + e.message);
    }
  });

  test.beforeEach(async ({}, testInfo) => {
    if (!creds) testInfo.skip(true, 'PLAYWRIGHT_TEST_USER_EMAIL not set');
  });

  test('login redirects to dashboard and kanban container renders', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await loginAs(page, creds);

    // Post-redirect URL is dashboard.html; the auth gate (nbd-auth.js)
    // would bounce us back to /pro/login if auth state didn't stick.
    expect(page.url()).toContain('/pro/dashboard.html');

    // Kanban container loads via crm.js. Selector audited 2026-04-25:
    // #crm-board is the top-level kanban wrapper rendered post-login.
    // Fall back to any "crm" or "kanban" id if the selector drifts.
    const kanban = page.locator('#crm-board, #crm-kanban, [data-view="crm"]').first();
    await expect(kanban).toBeVisible({ timeout: 15_000 });

    // Sanity: no hard runtime errors during the dashboard's first paint.
    // Allow CSP Report-Only + Service Worker registration warnings — those
    // are expected on first visit and don't break the app.
    const hard = consoleErrors.filter(e =>
      !/Report Only|favicon|Service Worker registration|chrome-extension/i.test(e)
    );
    expect(hard, 'unexpected console errors during dashboard load').toEqual([]);
  });

  test('auth state persists across page reload (no kick to login)', async ({ page }) => {
    // The auth-restore race that kicked iOS users to /login was the
    // motivating bug for PRs #34 and #37. This test locks in that fix:
    // after a reload the user must stay on dashboard.html, not bounce.
    await loginAs(page, creds);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    // Give the 2.5-second nbd-auth.js grace window from PR #37 enough
    // headroom to settle; if we're going to bounce we'd see /login by now.
    await page.waitForTimeout(3_500);
    expect(page.url(), 'auth-restore must keep us on dashboard, not /login').toContain('/pro/dashboard.html');
  });
});

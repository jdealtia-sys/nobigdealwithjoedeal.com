// @ts-check
// Reusable Firebase Auth login helper for Playwright authed tests.
//
// Path A (BIG_ROCKS Rock 3): a dedicated test user lives in real
// Firebase Auth. Tests log in to the live site (or any base URL set
// via PLAYWRIGHT_BASE_URL) and exercise the post-auth surface.
//
// Required env (or GitHub Secrets in CI):
//   PLAYWRIGHT_TEST_USER_EMAIL
//   PLAYWRIGHT_TEST_USER_PASSWORD
//
// Tests should call requireTestUser() at the top of any spec that
// needs auth — it returns { email, password } or throws a skip-able
// error if either env is missing. That way the suite is safe to run
// locally without secrets (it just skips authed specs).

/**
 * @returns {{ email: string, password: string }}
 * @throws {Error} when either env var is missing — caller should
 *                 wrap the throw in test.skip() when appropriate.
 */
function requireTestUser() {
  const email    = process.env.PLAYWRIGHT_TEST_USER_EMAIL;
  const password = process.env.PLAYWRIGHT_TEST_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'PLAYWRIGHT_TEST_USER_EMAIL and PLAYWRIGHT_TEST_USER_PASSWORD must be set. ' +
      'See tests/e2e/README.md for the test-user provisioning runbook.'
    );
  }
  return { email, password };
}

/**
 * Log in via the email/password form on /pro/login.html and wait
 * for the redirect to /pro/dashboard.html to settle.
 *
 * The login page selectors are stable (audited 2026-04-25):
 *   #emailInput     — email field
 *   #passwordInput  — password field
 *   #loginBtn       — submit button
 * On success the page calls window.location.replace('/pro/dashboard.html')
 * (see docs/pro/js/pages/login.js:84,169,182,214,220).
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ email: string, password: string }} creds
 */
async function loginAs(page, creds) {
  await page.goto('/pro/login.html');
  // Login.js wires the form once the Firebase SDK has loaded; wait
  // for the button to be enabled rather than time-boxing.
  await page.waitForSelector('#loginBtn:not([disabled])', { timeout: 15_000 });
  await page.fill('#emailInput', creds.email);
  await page.fill('#passwordInput', creds.password);
  await Promise.all([
    page.waitForURL('**/pro/dashboard.html', { timeout: 30_000 }),
    page.click('#loginBtn'),
  ]);
}

/**
 * Log out by clearing Firebase auth state via the SDK already
 * loaded in the page. Safer than scrubbing localStorage manually
 * because it triggers the auth-state listener to detach Firestore
 * subscriptions cleanly.
 *
 * @param {import('@playwright/test').Page} page
 */
async function logout(page) {
  await page.evaluate(() => {
    // window.auth is the Firebase Auth instance set up by nbd-auth.js.
    // Fall back to firebase.auth() if the global hasn't been set yet.
    const auth = (typeof window !== 'undefined' && window.auth)
      || (typeof window !== 'undefined' && typeof window.firebase !== 'undefined'
          ? window.firebase.auth() : null);
    return auth && typeof auth.signOut === 'function' ? auth.signOut() : null;
  });
}

/**
 * Invoke a Firebase callable Cloud Function from inside the page
 * context. Avoids needing a Node-side Firebase Admin SDK + service
 * account in CI. The page is already authed (via loginAs) and has
 * App Check tokens minting, so the callable inherits everything it
 * needs.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name - the callable's exported name
 * @param {object} [data] - request body, defaults to {}
 * @returns {Promise<any>} the .data field from the callable response
 */
async function callCallableInPage(page, name, data) {
  return page.evaluate(async ({ fnName, payload }) => {
    const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    const f = m.httpsCallable(m.getFunctions(), fnName);
    const r = await f(payload || {});
    return r && r.data;
  }, { fnName: name, payload: data || {} });
}

/**
 * Convenience wrapper for the destructive-test cleanup callable.
 * Page must be authed as the e2eTestAccount user.
 *
 * @param {import('@playwright/test').Page} page
 */
async function cleanupE2EData(page) {
  return callCallableInPage(page, 'cleanupE2ETestData');
}

module.exports = {
  requireTestUser,
  loginAs,
  logout,
  callCallableInPage,
  cleanupE2EData
};

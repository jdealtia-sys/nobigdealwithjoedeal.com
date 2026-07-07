// @ts-check
// Playwright config for NBD Pro smoke/E2E tests.
//
// Target: the live production site by default so we can verify what
// real users see. Set PLAYWRIGHT_BASE_URL to run against a local server
// (e.g. `firebase serve` on http://localhost:5000).
//
// Run:     npm --prefix tests run test:e2e
// Headed:  npm --prefix tests run test:e2e:headed
// Specific: npx playwright test --grep "pricing"

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  // 3 (was 2): with 16 serial journeys in one emulator session, the Java
  // Firestore emulator intermittently drops reads ('client is offline')
  // under load and a rotating single test loses all its attempts while
  // everything else passes (rounds of 2026-07-05). One more attempt per
  // test costs seconds and converts most of those rounds to flaky-pass.
  retries: process.env.CI ? 3 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://nobigdealwithjoedeal.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Service workers are blocked in E2E. Every test context starts with a
    // pristine profile, so the first dashboard load installs /pro/sw.js
    // fresh; when the new SW takes control, dashboard-sw-bootstrap.js's
    // controllerchange handler reloads the page once, and that reload races
    // the spec's first post-login page.evaluate ("Execution context was
    // destroyed", reproduced 2026-07-06 on the emulator run). No spec
    // exercises the SW (sw.js is covered statically by pwa-manifest.test.js
    // and the smoke suite), and the app fully supports SW-less operation
    // (?nosw=1 kill-switch), so blocking registration is the deterministic
    // fix. Registration fails into the bootstrap's .catch → console.warn.
    serviceWorkers: 'block',
    // Emulator mode: the hosting emulator serves the PRODUCTION security
    // headers from firebase.json, and that CSP's connect-src has no
    // carve-out for the local emulator ports (127.0.0.1:9099 auth /
    // :8080 firestore — 'self' only covers :5000). The browser refuses the
    // SDK's sign-in and Firestore calls, so login can never complete.
    // Bypass CSP only when targeting a local server; prod-targeted runs
    // (Path A) keep the real policy enforced.
    ...(/^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/.test(process.env.PLAYWRIGHT_BASE_URL || '')
      ? { bypassCSP: true }
      : {}),
    // Escape hatches for sandboxed environments (no effect when unset):
    // - PLAYWRIGHT_CHROMIUM_PATH: use a pre-installed Chromium when the
    //   pinned browser build can't be downloaded.
    // - PLAYWRIGHT_PROXY_SERVER: route browser traffic through an egress
    //   proxy (with 127.0.0.1 bypassed so emulator traffic stays direct).
    //   Implies ignoreHTTPSErrors because such proxies MITM TLS with a CA
    //   Chromium doesn't trust — never set this against production.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
    ...(process.env.PLAYWRIGHT_PROXY_SERVER
      ? {
          proxy: { server: process.env.PLAYWRIGHT_PROXY_SERVER, bypass: '127.0.0.1,localhost' },
          ignoreHTTPSErrors: true,
        }
      : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to expand browser coverage once the smoke suite is stable:
    // { name: 'webkit',  use: { ...devices['Desktop Safari']  } },
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'mobile',  use: { ...devices['iPhone 13']       } },
  ],
});

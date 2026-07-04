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
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://nobigdealwithjoedeal.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
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

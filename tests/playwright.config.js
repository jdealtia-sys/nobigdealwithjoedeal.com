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

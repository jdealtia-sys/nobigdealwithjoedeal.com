/**
 * Playwright config for NBD Pro visual + brand-token regression tests.
 *
 * Boots an http-server pointed at ../../docs so every test can navigate
 * to the actual customer-facing surfaces (portal.html, estimate-view.html,
 * photo-review.html) without touching Firebase.
 */
const { defineConfig, devices } = require('@playwright/test');

const PORT = 4321;

module.exports = defineConfig({
  testDir: '.',
  timeout: 30_000,
  fullyParallel: false, // single project, sequential keeps screenshot snapshots stable
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    // Snapshot config: 0.2% pixel tolerance — catches real visual drift
    // but tolerates anti-alias jitter across CI runners.
    ignoreHTTPSErrors: true,
  },
  expect: {
    toHaveScreenshot: {
      threshold: 0.2,
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // http-server with no caching + silent so Playwright stdout stays clean
    command: 'npx http-server ../../docs -p ' + PORT + ' -c-1 --silent',
    url: `http://localhost:${PORT}/pro/portal.html`,
    timeout: 20_000,
    reuseExistingServer: true,
  },
});

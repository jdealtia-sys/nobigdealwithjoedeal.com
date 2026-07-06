// @ts-check
// Sandbox-only Firebase SDK shim for Playwright.
//
// The client pages import the Firebase JS SDK as standalone ESM bundles from
// https://www.gstatic.com/firebasejs/<ver>/firebase-*.js. Some sandboxed
// environments (egress-policied agent containers) deny www.gstatic.com at the
// proxy, so the browser can never load the SDK and every page dies before
// auth. The npm `firebase` package ships the IDENTICAL standalone bundles at
// its root (firebase-app.js, firebase-auth.js, …), and the npm registry is
// reachable in those sandboxes — so this fixture intercepts the gstatic URLs
// and fulfills them from a local `firebase` package directory.
//
// Activation is explicit and CI-safe: set NBD_E2E_SDK_LOCAL_DIR to the
// package dir (e.g. …/node_modules/firebase). Unset (the CI default), this
// is a hard no-op and the browser fetches gstatic like production.
//
//   NBD_E2E_SDK_LOCAL_DIR=/path/to/node_modules/firebase \
//   PLAYWRIGHT_CHROMIUM_PATH=… PLAYWRIGHT_PROXY_SERVER=… \
//   npm run test:e2e:authed:emu

const fs = require('fs');
const path = require('path');

const SDK_DIR = process.env.NBD_E2E_SDK_LOCAL_DIR || '';
const GSTATIC_RE = /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z-]+\.js)(\.map)?$/;

/**
 * Install the shim on a Page or BrowserContext. No-op unless
 * NBD_E2E_SDK_LOCAL_DIR is set and exists.
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} target
 */
async function installLocalSdkShim(target) {
  if (!SDK_DIR || !fs.existsSync(SDK_DIR)) return false;
  await target.route('https://www.gstatic.com/firebasejs/**', async (route) => {
    const m = GSTATIC_RE.exec(route.request().url());
    const file = m && path.join(SDK_DIR, m[1] + (m[2] || ''));
    if (file && fs.existsSync(file)) {
      await route.fulfill({
        status: 200,
        contentType: m[2] ? 'application/json' : 'text/javascript; charset=utf-8',
        body: fs.readFileSync(file),
      });
    } else {
      await route.abort();
    }
  });
  return true;
}

module.exports = { installLocalSdkShim };

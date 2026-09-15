// @ts-check
/**
 * Visual regression baseline.
 *
 * For each route + viewport pair below, Playwright takes a full-page
 * screenshot and diffs it against a committed baseline at
 * tests/e2e/visual-regression.spec.js-snapshots/{name}.png.
 *
 * First run on a new baseline: `npm --prefix tests run test:e2e:update`
 * (sets PLAYWRIGHT_UPDATE_SNAPSHOTS=1) writes the baseline images.
 * Subsequent runs compare against the committed baselines and fail
 * the build if any pixel differs beyond the configured threshold.
 *
 * The snapshots cover only PUBLIC pages (login, register, pricing,
 * landing). Authenticated screens require a signed-in session and
 * live in pro-authed.spec.js — visual regression for those is a
 * follow-up after the dev Firebase project lands (Joe-action #19).
 *
 * Why pixel-diff and not a string match
 *   - Catches CSS regressions like the "toolbar still tight" issue
 *     where the deployed CSS is correct but the rendered output
 *     doesn't match what we expected.
 *   - One screenshot covers font load, layout, animations, color,
 *     spacing simultaneously — no need to write 30 string assertions.
 *
 * Tuning
 *   - The pixel-diff threshold is generous (0.2 = 20% per-pixel
 *     tolerance) to absorb font subpixel rendering jitter across
 *     CI environments. Tighten when we have a dev Firebase project
 *     pinning Chromium versions.
 *   - We mask high-entropy regions (timestamps, dynamic counters)
 *     with the `mask` option to avoid false-positive flakes.
 */

const { test, expect } = require('@playwright/test');

const VIEWPORTS = [
  { name: 'mobile-375',  width: 375,  height: 812  },
  { name: 'tablet-768',  width: 768,  height: 1024 },
  { name: 'desktop-1280', width: 1280, height: 800 },
];

const PAGES = [
  { path: '/pro/login',    name: 'login' },
  { path: '/pro/register', name: 'register' },
  { path: '/pro/pricing',  name: 'pricing' },
  { path: '/',             name: 'landing' },
];

// Same-origin /api/* responses these pages render, pinned to fixed payloads.
//
// WHY (2026-09-13): CI serves docs/ from the hosting emulator, but
// `emulators:exec --only hosting` leaves firebase.json's function rewrites
// pointing at PRODUCTION. When the Places secrets went live (~22:31Z), prod
// /api/google-reviews began returning real reviews, the landing page rendered
// five live review cards instead of the "Read our reviews on Google" fallback,
// and the page grew 1337px at mobile-375. Every commit's visual job went red
// with no code change (d7506665, docs-only). A baseline blessed against live
// Google data would break again with the next review.
//
// `{ reviews: [], total: 0 }` renders google-reviews-widget.js's fallback card
// (renderAll → renderFallback) and hydrates no rating hooks. That is the state
// the committed baselines were captured in, so no re-bless is needed. What the
// live cards look like is not a pixel-baseline question; their content is
// Google's.
const PINNED_API = {
  '/api/google-reviews': { reviews: [], total: 0 },
};
// Same default as playwright.config.js `use.baseURL`.
const SITE_ORIGIN = new URL(process.env.PLAYWRIGHT_BASE_URL || 'https://nobigdealwithjoedeal.com').origin;

for (const page of PAGES) {
  test.describe('visual regression: ' + page.name, () => {
    for (const vp of VIEWPORTS) {
      test(page.name + ' @ ' + vp.name, async ({ page: pw }) => {
        // Any same-origin /api/* call without a pinned payload fails the test
        // by name, instead of surfacing later as an unexplained pixel diff
        // driven by production data.
        const unpinned = [];
        await pw.route(
          (url) => url.origin === SITE_ORIGIN && url.pathname.startsWith('/api/'),
          (route) => {
            const p = new URL(route.request().url()).pathname;
            if (Object.prototype.hasOwnProperty.call(PINNED_API, p)) {
              return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PINNED_API[p]) });
            }
            unpinned.push(p);
            return route.continue();
          },
        );
        await pw.setViewportSize({ width: vp.width, height: vp.height });
        await pw.goto(page.path, { waitUntil: 'networkidle' });
        expect(unpinned, 'unpinned /api/* calls hit production during a visual test; add a fixed payload to PINNED_API').toEqual([]);
        // Wait for fonts to settle — 'networkidle' alone fires before
        // late font swaps land.
        await pw.evaluate(() => document.fonts && document.fonts.ready);
        // Disable animations + transitions during the screenshot so
        // mid-flight CSS effects don't randomize the diff.
        await pw.addStyleTag({
          content: '*, *::before, *::after { transition: none !important; animation: none !important; }'
        });
        await expect(pw).toHaveScreenshot(page.name + '--' + vp.name + '.png', {
          fullPage:        true,
          maxDiffPixelRatio: 0.02,
          // Mask any element that legitimately changes between runs
          // (live timestamps, "as of" counters, ad creatives, etc.).
          // Add selectors here as flakes show up — easier than chasing
          // false positives in PR review.
          mask: [
            pw.locator('.live-timestamp'),
            pw.locator('[data-mask-visual]'),
          ],
        });
      });
    }
  });
}

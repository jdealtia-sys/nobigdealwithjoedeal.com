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

for (const page of PAGES) {
  test.describe('visual regression: ' + page.name, () => {
    for (const vp of VIEWPORTS) {
      test(page.name + ' @ ' + vp.name, async ({ page: pw }) => {
        await pw.setViewportSize({ width: vp.width, height: vp.height });
        await pw.goto(page.path, { waitUntil: 'networkidle' });
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

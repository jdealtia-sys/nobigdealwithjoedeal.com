/**
 * brand-tokens.spec.js — locks in the customer-facing brand token contract.
 *
 * Every page a homeowner / adjuster / referral source sees from NBD Pro
 * MUST render with the locked `nbd-brand.css` token set:
 *   --nbd-bg          = #faf8f5  (warm cream)
 *   --nbd-ink         = #1a1612  (warm dark)
 *   --nbd-orange      = #e8720c  (brand orange)
 *   --nbd-font-body   = 'Barlow', ...
 *
 * If anyone edits nbd-brand.css, drops the <link> from a customer-facing
 * page, or accidentally re-introduces a hardcoded color (the way
 * estimate-view.html was before audit batch 1), this test fails BEFORE
 * the change merges.
 *
 * Why this and not pixel screenshots? Pixel snapshots are great but
 * they're noisy across CI runners (font-rendering, anti-aliasing).
 * Computed-style assertions are deterministic and catch the actual
 * regressions we care about: brand drift.
 */
const { test, expect } = require('@playwright/test');

const BRAND_TOKENS = {
  '--nbd-bg':         '#faf8f5',
  '--nbd-bg-elevated':'#ffffff',
  '--nbd-ink':        '#1a1612',
  '--nbd-orange':     '#e8720c',
  '--nbd-orange-deep':'#c8541a',
};

const EXPECTED = {
  bodyBg:    'rgb(250, 248, 245)', // #faf8f5
  bodyColor: 'rgb(26, 22, 18)',    // #1a1612
};

const SURFACES = [
  { name: 'portal',         path: '/pro/portal.html' },
  { name: 'estimate-view',  path: '/pro/estimate-view.html' },
];

for (const surface of SURFACES) {
  test.describe(`${surface.name} — brand alignment`, () => {
    test('loads nbd-brand.css', async ({ page }) => {
      const responses = [];
      page.on('response', (res) => responses.push(res.url()));
      await page.goto(surface.path);
      await page.waitForLoadState('networkidle');
      const loadedBrand = responses.some(u => u.endsWith('/pro/css/nbd-brand.css'));
      expect(loadedBrand, `${surface.name} should <link> /pro/css/nbd-brand.css`).toBe(true);
    });

    test('opts into the brand cascade', async ({ page }) => {
      await page.goto(surface.path);
      const brandAttr = await page.getAttribute('html', 'data-nbd-brand');
      expect(brandAttr, '<html data-nbd-brand="true"> required').toBe('true');
      const bodyHasBrandClass = await page.evaluate(() =>
        document.body.classList.contains('nbd-brand')
      );
      expect(bodyHasBrandClass, '<body class="nbd-brand"> required').toBe(true);
    });

    test('brand tokens resolve to the locked values', async ({ page }) => {
      await page.goto(surface.path);
      const tokens = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const want = ['--nbd-bg','--nbd-bg-elevated','--nbd-ink','--nbd-orange','--nbd-orange-deep'];
        const out = {};
        for (const k of want) out[k] = cs.getPropertyValue(k).trim().toLowerCase();
        return out;
      });
      for (const [k, v] of Object.entries(BRAND_TOKENS)) {
        expect(tokens[k], `${surface.name} ${k} should resolve to ${v}`).toBe(v);
      }
    });

    test('body renders with brand bg + ink', async ({ page }) => {
      await page.goto(surface.path);
      const computed = await page.evaluate(() => ({
        bg:    getComputedStyle(document.body).backgroundColor,
        color: getComputedStyle(document.body).color,
        font:  getComputedStyle(document.body).fontFamily,
      }));
      expect(computed.bg).toBe(EXPECTED.bodyBg);
      expect(computed.color).toBe(EXPECTED.bodyColor);
      expect(computed.font.toLowerCase()).toContain('barlow');
    });
  });
}

// ── photo-review.html is rep-facing (NOT brand-locked) ────────────────
// It should NOT carry the brand class — it uses theme-system.css so
// Joe's chosen dashboard theme propagates. The negative assertion below
// catches accidental brand-locking of a rep surface.
test('photo-review.html is rep-themed (NOT brand-locked)', async ({ page }) => {
  await page.goto('/pro/photo-review.html?lead=test');
  await page.waitForLoadState('domcontentloaded');
  const brandAttr = await page.getAttribute('html', 'data-nbd-brand');
  expect(brandAttr, 'photo-review.html should NOT carry data-nbd-brand').toBeNull();
  const theme = await page.getAttribute('html', 'data-theme');
  expect(theme, 'photo-review.html should carry data-theme for rep theme system').not.toBeNull();
});

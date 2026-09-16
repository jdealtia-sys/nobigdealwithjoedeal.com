/**
 * tests/crm-logo-legibility-2026-09-16.test.js
 *
 * Jo: "the logo is still too small... has the white background still, not
 * like the homepage which moved to almost transparent." Investigated by
 * actually rendering the pages (Playwright, logged into a seeded emulator
 * tenant) rather than reasoning from source — the PNG itself was already
 * properly transparent (pixel-verified: corners are alpha 0), so "white
 * background" was a misread of the real bug: two separate legibility
 * failures.
 *
 * 1. docs/pro/customer.html's in-app header used the full illustrated
 *    marketing wordmark (docs/assets/images/nbd-logo.png, a 600x308 image
 *    designed for full-width public pages) shrunk to `height:28px` — at
 *    that size the multi-element wordmark (roofline + two-tone text +
 *    tagline) reads as a blank smear, not a mark. dashboard.html and
 *    login.html already solved this with a `.logo-mark` CSS badge (orange
 *    square, "NBD" text, `var(--accent-fg)` for guaranteed contrast on any
 *    of the 147 themes) instead of an image — customer.html was the one
 *    page still using the wrong asset for its size-constrained header.
 *
 * 2. docs/pro/portal.html's hero used the SAME shared nbd-logo.png, which
 *    #1572 recolored to WHITE main text specifically for the site's dark
 *    navy nav/footer. portal.html's hero sits on a light orange-tinted
 *    gradient (`.hero { background: linear-gradient(135deg,
 *    var(--nbd-orange-soft), rgba(189,87,40,0)) }`), where white-on-white
 *    is exactly as illegible as navy-on-navy was before #1572 fixed the
 *    dark case. Fixed by rendering a light-background variant from the
 *    same brand-pack source SVG (logo-color.svg, navy text) #1572 started
 *    from before its white recolor, and pointing the hero at that instead.
 *
 * Both are pinned here as source-text assertions (no headless render
 * needed to catch a regression back to the old markup) plus a pixel check
 * on the new light-bg asset proving it is genuinely transparent and not
 * just visually similar.
 *
 * Run: node tests/crm-logo-legibility-2026-09-16.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('CRM LOGO LEGIBILITY — customer.html header + portal.html hero');

// ── 1. customer.html no longer shrinks the illustrated wordmark ────────
const customerHtml = fs.readFileSync(path.join(ROOT, 'docs', 'pro', 'customer.html'), 'utf8');

ok('customer.html header does NOT use the illustrated wordmark image',
  !/<img[^>]*class="logo-img"[^>]*src="\/assets\/images\/nbd-logo\.png"/.test(customerHtml));
ok('customer.html defines a .logo-mark badge (same pattern as dashboard.html/login.html)',
  /\.logo-mark\s*\{[^}]*background:\s*var\(--orange\)/.test(customerHtml));
ok('.logo-mark uses --accent-fg for guaranteed contrast across all themes (not a hardcoded color)',
  /\.logo-mark\s*\{[^}]*color:\s*var\(--accent-fg\)/.test(customerHtml));
ok('the header markup actually renders the badge, not just defines unused CSS',
  /<div class="logo"><div class="logo-mark">NBD<\/div>/.test(customerHtml));
ok('the old .logo-img rule was removed, not left as dead CSS',
  !/\.logo-img\s*\{/.test(customerHtml));

// ── 2. portal.html hero uses a light-background-appropriate asset ──────
const portalHtml = fs.readFileSync(path.join(ROOT, 'docs', 'pro', 'portal.html'), 'utf8');

ok('portal.html hero-logo does NOT point at the dark-background (white-text) shared asset',
  !/class="hero-logo"[^>]*src="\/assets\/images\/nbd-logo\.png"/.test(portalHtml));
ok('portal.html hero-logo points at the light-background variant',
  /class="hero-logo"[^>]*src="\/assets\/images\/nbd-logo-light-bg\.png"/.test(portalHtml));

// ── 3. the new asset is genuinely transparent, not just visually similar ──
const LIGHT_BG_LOGO = path.join(ROOT, 'docs', 'assets', 'images', 'nbd-logo-light-bg.png');
ok('nbd-logo-light-bg.png exists', fs.existsSync(LIGHT_BG_LOGO));

if (fs.existsSync(LIGHT_BG_LOGO)) {
  const sharp = require(path.join(ROOT, 'functions', 'node_modules', 'sharp'));
  (async () => {
    const meta = await sharp(LIGHT_BG_LOGO).metadata();
    ok('same intrinsic size as the dark-background asset (600x308 — no CLS shift, no aspect distortion)',
      meta.width === 600 && meta.height === 308, `${meta.width}x${meta.height}`);
    ok('has an alpha channel (RGBA, not flattened to opaque RGB)', meta.hasAlpha === true);

    const { data, info } = await sharp(LIGHT_BG_LOGO).raw().toBuffer({ resolveWithObject: true });
    function px(x, y) {
      const i = (y * info.width + x) * info.channels;
      return Array.from(data.slice(i, i + info.channels));
    }
    const corners = [px(0, 0), px(5, 5), px(2, 150), px(595, 5)];
    ok('corner pixels are genuinely transparent (alpha 0), not an opaque light-gray box',
      corners.every(c => c[3] === 0), JSON.stringify(corners));

    // A pixel inside the wordmark's navy stroke should be dark, not white —
    // the whole point of this asset vs. the site-wide one.
    const navyPixel = px(60, 90);
    ok('text pixels are dark navy (legible on a light background), not white',
      navyPixel[3] > 0 && navyPixel[0] < 100 && navyPixel[1] < 100,
      JSON.stringify(navyPixel));

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) { console.log('Failed: ' + fails.join(', ')); process.exit(1); }
  })().catch(e => { console.error('FATAL', e); process.exit(1); });
} else {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('Failed: ' + fails.join(', ')); process.exit(1); }
}

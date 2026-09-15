/**
 * tests/nav-logo-size-2026-09-14.test.js
 *
 * Jo asked for the header logo bigger and cropped — it was rendering at
 * height:42px out of a heavily white-padded 240x160 source image, so most
 * of that box was empty space and the mark read as illegible. Fixed by
 * cropping the source to its real content (135x75) and raising the
 * rendered size to 60px desktop / 50px mobile — the largest that still
 * fits inside the site's existing fixed 70px nav bar without touching its
 * height (a bigger jump would require growing the bar itself, which
 * cascades into the mobile-drawer and sticky-header code that was already
 * hardened for exactly this kind of change — deliberately deferred, see
 * the PR description). Also dropped the redundant "NO BIG DEAL / Home
 * Solutions" text label that sat next to the image repeating what the
 * now-legible image already says.
 *
 * This pins the new state so a future site-src/partials/ edit or a stray
 * per-page override can't silently revert it. Source-of-truth checks on
 * site-src/partials/ (regenerate everything from there); a site-wide sweep
 * on the published docs/ tree (excluding docs/pro/**, which keeps its own
 * separate brand chrome per Jo's brand-separation rule) catches drift that
 * bypassed the partial system.
 *
 * UPDATE 2026-09-14 (later same day): the new logo/favicon brand-pack swap
 * replaced the source artwork again — 600x308 now, not the 135x75 this file
 * originally pinned. The `height:60px` rendered size and the CSS/markup this
 * test guards against regressing to are unchanged; only the intrinsic
 * width/height (an aspect-ratio hint for CLS, not the display size — see
 * `style="height:60px;width:auto"`) moved with the new artwork's real
 * dimensions. Session note:
 * documentation/projects/SESSION-2026-09-14-brand-refresh-logo-favicon.md.
 *
 * Pure-Node, zero-dep (PNG dimensions read from the raw IHDR chunk — no
 * image library needed). Run: node tests/nav-logo-size-2026-09-14.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const SKIP_DIRS = new Set(['pro', 'admin', 'dev', 'tools', 'assets', 'deploy']);

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; fails.push(label); console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); }
    else if (e.name.endsWith('.html')) out.push(path.join(dir, e.name));
  }
}
const PAGES = [];
walk(DOCS, PAGES);

console.log('\nsite-src/partials/ — the source of truth');
{
  const navFiles = ['nav-standard.html', 'nav-blog.html', 'nav-microsite.html', 'nav-tool.html'];
  for (const f of navFiles) {
    const src = fs.readFileSync(path.join(ROOT, 'site-src', 'partials', f), 'utf8');
    ok(f + ': logo renders at height:60px', /nbd-logo\.png" width="600" height="308"[^>]*style="height:60px/.test(src));
    ok(f + ': no redundant nav-logo-text label next to the image', !src.includes('nav-logo-text'));
  }
  const footerFiles = ['footer-extended.html', 'footer-blog.html'];
  for (const f of footerFiles) {
    const src = fs.readFileSync(path.join(ROOT, 'site-src', 'partials', f), 'utf8');
    ok(f + ': footer logo also raised to height:60px', /nbd-logo\.png" width="600" height="308"[^>]*style="height:60px/.test(src));
  }
}

console.log('\nPublished docs/ tree (excluding docs/pro/** — separate brand chrome) — no stale sizing survives anywhere');
{
  let staleCss = 0, staleImg = 0, staleTextBlocks = 0;
  for (const p of PAGES) {
    const src = fs.readFileSync(p, 'utf8');
    if (src.includes('nav .nav-logo img{height:42px') || src.includes('nav .nav-logo img{height:36px!important}')) staleCss++;
    if (/width="240" height="160"[^>]*alt="No Big Deal Home Solutions"/.test(src)) staleImg++;
    if (/<div class="nav-logo-text">[\s\S]{0,20}<div class="brand">NO BIG DEAL/.test(src)) staleTextBlocks++;
  }
  ok('no page still carries the old 42px/36px nav-logo CSS override', staleCss === 0, staleCss + ' file(s) still do');
  ok('no page still carries the old 240x160/42px image tag', staleImg === 0, staleImg + ' file(s) still do');
  ok('no page still carries the redundant NO BIG DEAL text block next to the image', staleTextBlocks === 0, staleTextBlocks + ' file(s) still do');
}

console.log('\nA representative sample actually renders the new size (not just present somewhere in the file)');
{
  const home = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  ok('index.html nav: 60px logo present', /nbd-logo\.png" width="600" height="308"[^>]*style="height:60px/.test(home));
  ok('index.html nav: no nav-logo-text label', !/<div class="nav-logo-text">[\s\S]{0,20}<div class="brand">NO BIG DEAL/.test(home));
  ok('index.html footer: 60px logo present too (its own hand-authored footer, not the shared partial)', (home.match(/nbd-logo\.png" width="600" height="308"[^>]*style="height:60px/g) || []).length >= 2);
  const about = fs.readFileSync(path.join(DOCS, 'about.html'), 'utf8');
  ok('about.html (partial-managed): 60px logo present', /nbd-logo\.png" width="600" height="308"[^>]*style="height:60px/.test(about));
}

console.log('\nThe source image itself is the real, cropped asset (not just the markup claiming new numbers)');
{
  // Raw PNG IHDR read: signature (8 bytes) + length (4) + "IHDR" (4), then
  // width (4, big-endian) + height (4, big-endian). No image library needed.
  const buf = fs.readFileSync(path.join(DOCS, 'assets', 'images', 'nbd-logo.png'));
  const isPng = buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR';
  ok('the file is a real PNG (the old file was a JPEG mislabeled .png)', isPng);
  if (isPng) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    ok('sized at 600x308 (2026-09-14 brand-pack artwork; was 135x75 post-crop, 240x160 before that)', width === 600 && height === 308, width + 'x' + height);
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }

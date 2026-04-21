#!/usr/bin/env node
/**
 * Two-part nav fix applied across every public HTML page:
 *   A. Inject a responsive override that forces the hamburger/mobile-nav at
 *      max-width:1100px (fixes desktop-nav bleed on 14" laptops @ 200% zoom).
 *   B. Replace the <div class="mobile-nav" id="mobileNav"> block with one
 *      canonical version — no duplicate groups, all desktop dropdown items
 *      present (Featured/Services/Company/Tools).
 *
 * Idempotent: re-running does nothing once files carry the marker comment
 * `/* nav-responsive-fix v1 *\/`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const SKIP_DIRS = new Set(['admin', 'pro', 'sites', 'assets', 'deploy', 'tools']);

const RESPONSIVE_MARKER_OLD = '/* nav-responsive-fix v1 */';
const RESPONSIVE_MARKER = '/* nav-responsive-fix v2 */';
const RESPONSIVE_CSS = `<style>
${RESPONSIVE_MARKER}
@media(max-width:1280px){
  nav .nav-links{display:none!important}
  nav .hamburger,nav button.hamburger{display:flex!important}
  nav{padding-left:20px!important;padding-right:20px!important}
}
</style>`;

const CANONICAL_MOBILE_NAV = `<div class="mobile-nav" id="mobileNav">
  <div class="mnav-group">Featured</div>
  <a href="/services/the-nbd-guarantee" style="color:#f08030;font-weight:800;">The NBD Guarantee</a>
  <a href="/services/the-nbd-better-build" style="color:#f08030;font-weight:800;">The Better Build</a>
  <a href="/services/lumanail" style="color:#f08030;font-weight:800;">LumaNail&trade; Upgrade</a>
  <a href="/services/roofivent" style="color:#f08030;font-weight:800;">Roofivent Products</a>
  <a href="/services/gaf-pivot-boot" style="color:#f08030;font-weight:800;">GAF Pivot Boot</a>
  <div class="mnav-group">Services</div>
  <a href="/services/roof-replacement">Roof Replacement</a>
  <a href="/services/roof-repair">Roof Repair</a>
  <a href="/services/siding-replacement">Siding Replacement</a>
  <a href="/services/siding-repair">Siding Repair</a>
  <a href="/services/gutter-replacement">Gutter Replacement</a>
  <a href="/services/storm-damage">Storm Damage &amp; Insurance</a>
  <a href="/services/hail-damage-insurance-claim">Hail Damage Claims</a>
  <a href="/services/roof-inspection">Roof Inspection</a>
  <a href="/services/roof-cleaning-soft-wash">Roof Cleaning</a>
  <a href="/services/fire-water-smoke-damage">Fire &amp; Water Damage</a>
  <a href="/services/financing">Financing</a>
  <div class="mnav-group">Company</div>
  <a href="/about">About Joe</a>
  <a href="/review">Reviews</a>
  <a href="/our-work">Our Work</a>
  <a href="/areas/">Service Areas</a>
  <a href="/blog">Blog</a>
  <div class="mnav-group">Tools</div>
  <a href="/estimate" style="color:#f08030">Instant Estimate</a>
  <a href="/visualizer" style="color:#f08030">Roof Visualizer</a>
  <a href="/storm-alerts" style="color:#f08030">Storm Alerts</a>
  <a href="/#contact" style="color:#e8720c;font-weight:800;">Free Estimate &rarr;</a>
</div>`;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Replace the mobile-nav block by scanning balanced <div> depth.
 * Returns { html, changed } — changed=false if block not found or already
 * byte-identical to canonical.
 */
function replaceMobileNavBlock(html) {
  const startTag = '<div class="mobile-nav" id="mobileNav">';
  const start = html.indexOf(startTag);
  if (start < 0) return { html, changed: false };

  let depth = 1;
  let i = start + startTag.length;
  const openRe = /<div\b/g;
  const closeRe = /<\/div>/g;

  while (depth > 0 && i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const openMatch = openRe.exec(html);
    const closeMatch = closeRe.exec(html);
    if (!closeMatch) return { html, changed: false };
    if (openMatch && openMatch.index < closeMatch.index) {
      depth++;
      i = openMatch.index + openMatch[0].length;
    } else {
      depth--;
      i = closeMatch.index + closeMatch[0].length;
    }
  }
  if (depth !== 0) return { html, changed: false };

  const existing = html.slice(start, i);
  if (existing === CANONICAL_MOBILE_NAV) return { html, changed: false };
  return { html: html.slice(0, start) + CANONICAL_MOBILE_NAV + html.slice(i), changed: true };
}

function injectResponsiveCss(html) {
  if (html.includes(RESPONSIVE_MARKER)) return { html, changed: false };
  // Strip any prior version of the injected block so we don't stack duplicates.
  const priorRe = /<style>\s*\/\* nav-responsive-fix v\d+ \*\/[\s\S]*?<\/style>\s*/g;
  let next = html.replace(priorRe, '');
  const idx = next.lastIndexOf('</head>');
  if (idx < 0) return { html, changed: false };
  return {
    html: next.slice(0, idx) + RESPONSIVE_CSS + '\n' + next.slice(idx),
    changed: true,
  };
}

const stats = { scanned: 0, cssInjected: 0, mobileNavReplaced: 0, untouched: 0, noMobileNav: 0 };
const samples = { css: [], mobileNav: [] };

for (const file of walk(ROOT)) {
  stats.scanned++;
  const rel = path.relative(ROOT, file);
  let html = fs.readFileSync(file, 'utf8');
  let fileChanged = false;

  const cssRes = injectResponsiveCss(html);
  if (cssRes.changed) {
    html = cssRes.html;
    fileChanged = true;
    stats.cssInjected++;
    if (samples.css.length < 3) samples.css.push(rel);
  }

  if (html.includes('<div class="mobile-nav" id="mobileNav">')) {
    const navRes = replaceMobileNavBlock(html);
    if (navRes.changed) {
      html = navRes.html;
      fileChanged = true;
      stats.mobileNavReplaced++;
      if (samples.mobileNav.length < 3) samples.mobileNav.push(rel);
    }
  } else {
    stats.noMobileNav++;
  }

  if (fileChanged) fs.writeFileSync(file, html);
  else stats.untouched++;
}

console.log(JSON.stringify({ stats, samples }, null, 2));

#!/usr/bin/env node
/*
 * The 25 blog pages (24 posts + index) ship a materially thinner nav than
 * the rest of the site: a flat 6-7 link list with no Services dropdown,
 * no storm tools, no Reviews/Our Work/Service Areas links. This brings
 * blog's desktop nav-links and mobile-nav up to the same structure
 * currently live on index.html (the most actively maintained page),
 * plus adds Roof Score / All Free Tools / the missing Inspect link that
 * the rest of the site is getting in the same pass (see
 * add-roofscore-freetools-nav.js) — so blog gets both fixes in one edit
 * instead of being touched twice.
 *
 * Only the <ul class="nav-links"> and <div class="mobile-nav"> CONTENTS
 * are replaced — blog's own <nav> wrapper, logo markup, hamburger button,
 * and script tag are left untouched to avoid regressing anything not
 * flagged by the audit.
 *
 * Idempotent: skips files that already contain the "Roof Score" nav link.
 */
const fs = require('fs');
const path = require('path');

const BLOG_DIR = path.resolve(__dirname, '..', 'docs', 'blog');

const NEW_NAV_LINKS = `<ul class="nav-links" id="navLinks">
    <li><a href="/the-pledge" style="color:var(--orange-light,#f08030);font-weight:700">The Pledge</a></li>
    <li class="dropdown"><a href="/#services">Services
      <svg class="nav-ico" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></a>
      <ul class="dropdown-menu">
        <li><a href="/the-pledge" style="color:var(--orange-light,#f08030);font-weight:800;">The Lifetime Pledge</a></li>
        <li><a href="/services/the-nbd-guarantee" style="color:var(--orange-light,#f08030);font-weight:800;">The NBD Guarantee</a></li>
        <li><a href="/services/lumanail" style="color:var(--orange-light,#f08030);font-weight:800;">LumaNail™ Upgrade</a></li>
        <li><a href="/services/gaf-timberline">GAF Timberline Lineup</a></li>
        <li><a href="/services/the-nbd-build" style="color:var(--orange-light,#f08030);font-weight:800;">The NBD Build</a></li>
        <li><a href="/services/roofivent" style="color:var(--orange-light,#f08030);font-weight:800;">Roofivent Products</a></li>
        <li><a href="/services/gaf-pivot-boot" style="color:var(--orange-light,#f08030);font-weight:800;">GAF Pivot Boot</a></li>
        <li><a href="/services/roof-replacement">Roof Replacement</a></li>
        <li><a href="/services/roof-repair">Roof Repair</a></li>
        <li><a href="/services/siding-replacement">Siding Replacement</a></li>
        <li><a href="/services/siding-repair">Siding Repair</a></li>
        <li><a href="/services/gutter-replacement">Gutter Replacement</a></li>
        <li><a href="/services/storm-damage">Storm Damage &amp; Insurance</a></li>
        <li><a href="/services/hail-damage-insurance-claim">Hail Damage Claims</a></li>
        <li><a href="/services/roof-inspection">Roof Inspection</a></li>
        <li><a href="/services/roof-cleaning-soft-wash">Roof Cleaning</a></li>
        <li><a href="/services/fire-water-smoke-damage">Fire &amp; Water Damage</a></li>
        <li><a href="/services/financing">Financing</a></li>
        <li><a href="/roof-score" style="color:var(--orange-light,#f08030)">Roof Score</a></li>
        <li><a href="/free-tools" style="color:var(--orange-light,#f08030)">All Free Tools</a></li>
        <li><a href="/storm-alerts" style="color:var(--orange-light,#f08030)">Storm Alerts</a></li>
        <li><a href="/storm-report" style="color:var(--orange-light,#f08030)">5-Year Storm Report</a></li>
        <li><a href="/storm-check" style="color:var(--orange-light,#f08030)">Is It Worth a Claim?</a></li><li><a href="/inspect" style="color:var(--orange-light,#f08030)">Free 24-Hr Inspection</a></li>
      </ul>
    </li>
    <li><a href="/about">About Joe</a></li>
    <li><a href="/review">Reviews</a></li>
    <li><a href="/our-work">Our Work</a></li>
    <li><a href="/areas/">Service Areas</a></li>
    <li><a href="/blog">Blog</a></li>
    <li><a href="/estimate" class="nav-instant">Instant Estimate
      <svg class="nav-ico" viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M13 2 L4 14 L11 14 L10 22 L20 10 L13 10 Z"/></svg></a></li>
    <li><a href="/#contact" class="nav-cta">Book Inspection &rarr;</a></li>
  </ul>`;

const NEW_MOBILE_NAV = `<div class="mobile-nav" id="mobileNav">
  <div class="mnav-group">The Promise</div>
  <a href="/the-pledge" style="color:#f08030;font-weight:800;">The Lifetime Pledge</a>
  <a href="/services/the-nbd-guarantee" style="color:#f08030;font-weight:800;">The NBD Guarantee</a>
  <a href="/services/the-nbd-build" style="color:#f08030;font-weight:800;">The NBD Build</a>
  <div class="mnav-group">Premium Components</div>
  <a href="/services/lumanail" style="color:#f08030;font-weight:800;">LumaNail&trade; Upgrade</a>
  <a href="/services/gaf-timberline">GAF Timberline Lineup</a>
  <a href="/services/roofivent" style="color:#f08030;font-weight:800;">Roofivent Products</a>
  <a href="/services/gaf-pivot-boot" style="color:#f08030;font-weight:800;">GAF Pivot Boot</a>
  <div class="mnav-group">Services</div>
  <a href="/services/roof-replacement">Roof Replacement</a>
  <a href="/services/roof-repair">Roof Repair</a>
  <a href="/services/storm-damage">Storm Damage &amp; Insurance</a>
  <a href="/services/hail-damage-insurance-claim">Hail Damage Claims</a>
  <a href="/services/siding-replacement">Siding Replacement</a>
  <a href="/services/siding-repair">Siding Repair</a>
  <a href="/services/gutter-replacement">Gutter Replacement</a>
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
  <a href="/roof-score" style="color:#f08030">Roof Score</a>
  <a href="/visualizer" style="color:#f08030">Roof Visualizer</a>
  <a href="/storm-alerts" style="color:#f08030">Storm Alerts</a>
  <a href="/storm-report" style="color:#f08030">5-Year Storm Report</a>
  <a href="/storm-check" style="color:#f08030">Is It Worth a Claim?</a>
  <a href="/inspect" style="color:#f08030">Free 24-Hr Inspection</a>
  <a href="/free-tools" style="color:#f08030">All Free Tools</a>
  <a href="/#contact" style="color:#e8720c;font-weight:800;">Book Inspection &rarr;</a>
</div>`;

const DROPDOWN_CSS = `
/* unified-nav injected (sync-blog-nav) */
.nav-links .dropdown{position:relative}
.nav-links .dropdown-menu{display:none;position:absolute;top:100%;left:0;background:var(--navy-dark,#142a52);border:2px solid var(--orange,#e8720c);border-top:none;min-width:230px;border-radius:0 0 8px 8px;padding:8px 0;z-index:999;list-style:none;margin:0}
.nav-links .dropdown:hover .dropdown-menu,.nav-links .dropdown:focus-within .dropdown-menu{display:block}
.nav-links .dropdown-menu a{display:block;padding:10px 18px;font-size:.75rem;border-bottom:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.85);text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-weight:600;transition:color .2s,background .2s}
.nav-links .dropdown-menu a:last-child{border-bottom:none}
.nav-links .dropdown-menu a:hover{color:var(--orange-light,#f08030);background:rgba(255,255,255,.04);border-bottom-color:rgba(255,255,255,.08)}
.nav-links .nav-ico{width:14px;height:14px;stroke:currentColor;stroke-width:2.2;fill:none;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;display:inline-block;vertical-align:-0.18em}
.nav-links > li > a.nav-instant{color:var(--orange-light,#f08030)!important}
.mobile-nav .mnav-group{font-size:.65rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--orange-light,#f08030);padding:14px 24px 6px;opacity:.75;border-bottom:none!important}
.mobile-nav .mnav-group:first-child{padding-top:8px}
`;

const NAV_LINKS_RE = /<ul class="nav-links" id="navLinks">[\s\S]*?<\/ul>/;
const MOBILE_NAV_RE = /<div class="mobile-nav" id="mobileNav">[\s\S]*?\r?\n<\/div>/;
const HEAD_CLOSE_RE = /<\/style>\s*<\/head>/;

const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith('.html'));
let touched = 0;
const skipped = [];
const failed = [];

for (const name of files) {
  const file = path.join(BLOG_DIR, name);
  const orig = fs.readFileSync(file, 'utf8');
  if (orig.includes('href="/roof-score"')) { skipped.push(name); continue; }
  if (!NAV_LINKS_RE.test(orig) || !MOBILE_NAV_RE.test(orig)) { failed.push(name); continue; }

  let next = orig.replace(NAV_LINKS_RE, NEW_NAV_LINKS);
  next = next.replace(MOBILE_NAV_RE, NEW_MOBILE_NAV);
  if (!/\.dropdown-menu/.test(orig) && HEAD_CLOSE_RE.test(next)) {
    next = next.replace(HEAD_CLOSE_RE, DROPDOWN_CSS + '</style></head>');
  }
  fs.writeFileSync(file, next, 'utf8');
  touched++;
}

console.log(JSON.stringify({ touched, skipped, failed, totalFiles: files.length }, null, 2));

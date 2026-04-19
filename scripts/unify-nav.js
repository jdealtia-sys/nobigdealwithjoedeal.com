#!/usr/bin/env node
/*
 * Unify the header nav across all docs/*.html pages that use <nav id="mainNav">.
 * Replaces both the desktop nav block and the mobile-nav block with the canonical
 * SVG-iconed version derived from the financing page.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

// Seven primary items + one CTA. Storm Alerts lives inside the Services dropdown.
const CANONICAL_NAV = `<nav id="mainNav">
  <a href="/" class="nav-logo">
    <img src="/assets/images/nbd-logo.png" alt="No Big Deal Home Solutions" style="height:42px;width:auto;border-radius:6px;">
    <div class="nav-logo-text">
      <div class="brand">NO BIG DEAL</div>
      <div class="sub">Home Solutions</div>
    </div>
  </a>
  <ul class="nav-links" id="navLinks">
    <li class="dropdown"><a href="/#services">Services
      <svg class="nav-ico" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></a>
      <ul class="dropdown-menu">
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
        <li><a href="/storm-alerts" style="color:var(--orange-light,#f08030)">Storm Alerts</a></li>
      </ul>
    </li>
    <li><a href="/about">About Joe</a></li>
    <li><a href="/review">Reviews</a></li>
    <li><a href="/our-work">Our Work</a></li>
    <li><a href="/#areas">Service Areas</a></li>
    <li><a href="/blog">Blog</a></li>
    <li><a href="/estimate" class="nav-instant">Instant Estimate
      <svg class="nav-ico" viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M13 2 L4 14 L11 14 L10 22 L20 10 L13 10 Z"/></svg></a></li>
    <li><a href="/#contact" class="nav-cta">Free Estimate &rarr;</a></li>
  </ul>
  <button class="hamburger" id="hamburger" aria-label="Open menu" onclick="(function(){var m=document.getElementById('mobileNav');if(m){m.classList.toggle('open')}})()">
    <span></span><span></span><span></span>
  </button>
</nav>`;

// Grouped mobile nav with section headings so the long list reads as organized, not a wall.
const CANONICAL_MOBILE = `<div class="mobile-nav" id="mobileNav">
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
  <a href="/#areas">Service Areas</a>
  <a href="/blog">Blog</a>
  <div class="mnav-group">Tools</div>
  <a href="/estimate" style="color:var(--orange-light,#f08030)">Instant Estimate</a>
  <a href="/storm-alerts" style="color:var(--orange-light,#f08030)">Storm Alerts</a>
  <a href="/#contact" style="color:var(--orange,#e8720c);font-weight:800;">Free Estimate &rarr;</a>
</div>`;

// CSS for dropdown + nav-ico — injected if the page lacks `.dropdown-menu` styling.
const DROPDOWN_CSS = `
/* unified-nav injected */
.nav-links .dropdown{position:relative}
.nav-links .dropdown-menu{display:none;position:absolute;top:100%;left:0;background:var(--navy-dark,#142a52);border:2px solid var(--orange,#e8720c);border-top:none;min-width:230px;border-radius:0 0 8px 8px;padding:8px 0;z-index:999;list-style:none;margin:0}
.nav-links .dropdown:hover .dropdown-menu{display:block}
.nav-links .dropdown-menu a{display:block;padding:10px 18px;font-size:.75rem;border-bottom:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.85);text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-weight:600;transition:color .2s,background .2s}
.nav-links .dropdown-menu a:last-child{border-bottom:none}
.nav-links .dropdown-menu a:hover{color:var(--orange-light,#f08030);background:rgba(255,255,255,.04);border-bottom-color:rgba(255,255,255,.08)}
.nav-links .nav-ico{width:14px;height:14px;stroke:currentColor;stroke-width:2.2;fill:none;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;display:inline-block;vertical-align:-0.18em}
.nav-links > li > a.nav-instant{color:var(--orange-light,#f08030)!important}
.mobile-nav .mnav-group{font-size:.65rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--orange-light,#f08030);padding:14px 24px 6px;opacity:.75;border-bottom:none!important}
.mobile-nav .mnav-group:first-child{padding-top:8px}
`;

const NAV_ID_RE = /<nav id="mainNav">[\s\S]*?<\/nav>/;
const NAV_PLAIN_RE = /<nav(?:\s[^>]*)?>[\s\S]*?<\/nav>/;
const HEAD_CLOSE_RE = /<\/style>\s*<\/head>/;

// Finds a div block balanced across nested <div>s, starting from a regex.
function findBalancedDiv(html, startRe) {
  const m = startRe.exec(html);
  if (!m) return null;
  const startIdx = m.index;
  let i = startIdx + m[0].length;
  let depth = 1;
  const len = html.length;
  const openRe = /<div\b/g;
  const closeRe = /<\/div>/g;
  while (depth > 0 && i < len) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const o = openRe.exec(html);
    const c = closeRe.exec(html);
    if (!c) return null;
    if (o && o.index < c.index) {
      depth++;
      i = o.index + o[0].length;
    } else {
      depth--;
      i = c.index + c[0].length;
    }
  }
  return { start: startIdx, end: i, text: html.slice(startIdx, i) };
}

// Orphan block produced by an earlier buggy run: `</div>` followed by a flat list of
// `<a>` tags (no nested divs, so this WON'T match our valid canonical mobile-nav) ending </div>.
// Requires the anchor list to contain both /services/roof-replacement and /#contact so we
// only collapse a real orphan mobile-nav tail, not any random pair of </div>s.
const ORPHAN_RE = /<\/div>(\s*(?:<a [^>]*>[^<]*<\/a>\s*){5,})<\/div>/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['admin', 'pro', 'sites', 'assets', 'deploy', 'free-guide', 'tools'].includes(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

let touched = 0, skipped = 0, noMatch = 0;
const skippedFiles = [];
const noMatchFiles = [];

function findSiteNav(html) {
  // Prefer <nav id="mainNav">. Otherwise match any <nav>...</nav> whose body
  // contains BOTH class="nav-logo" and class="nav-links" (the site header).
  if (NAV_ID_RE.test(html)) {
    const m = html.match(NAV_ID_RE);
    return { re: NAV_ID_RE, match: m[0] };
  }
  const m = html.match(NAV_PLAIN_RE);
  if (m && /class="nav-logo"/.test(m[0]) && /class="nav-links"/.test(m[0])) {
    // Build a literal-escaped regex for the exact block so we replace only this one.
    const escaped = m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { re: new RegExp(escaped), match: m[0] };
  }
  return null;
}

for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  const navHit = findSiteNav(orig);
  if (!navHit) {
    noMatch++;
    noMatchFiles.push(path.relative(ROOT, file));
    continue;
  }
  let next = orig.replace(navHit.re, CANONICAL_NAV);
  const mobileHit = findBalancedDiv(next, /<div class="mobile-nav"[^>]*>/);
  if (mobileHit) {
    next = next.slice(0, mobileHit.start) + CANONICAL_MOBILE + next.slice(mobileHit.end);
  } else {
    next = next.replace(/<\/nav>/, '</nav>\n' + CANONICAL_MOBILE);
  }
  // After replacement, any flat-<a>-only block between two </div>s is a stale tail from
  // an earlier buggy run. Canonical mobile-nav has <div class="mnav-group"> inside so it won't match.
  next = next.replace(ORPHAN_RE, '</div>');
  // Inject dropdown CSS if the page doesn't already define .dropdown-menu
  if (!/\.dropdown-menu/.test(next) && HEAD_CLOSE_RE.test(next)) {
    next = next.replace(HEAD_CLOSE_RE, DROPDOWN_CSS + '</style></head>');
  }
  if (next !== orig) {
    fs.writeFileSync(file, next);
    touched++;
  } else {
    skipped++;
    skippedFiles.push(path.relative(ROOT, file));
  }
}

console.log(JSON.stringify({ touched, skipped, noMatch, skippedFiles, noMatchFiles }, null, 2));

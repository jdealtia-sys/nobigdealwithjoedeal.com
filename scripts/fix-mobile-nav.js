#!/usr/bin/env node
/*
 * One-off repair for files damaged by the earlier buggy unify-nav run.
 * Damage pattern:
 *   <div class="mobile-nav" id="mobileNav">
 *     <div class="mnav-group">Services</div>
 *   (missing: rest of mobile-nav content + closing </div>)
 *
 * Fix: match the damage pattern exactly and expand to the full canonical mobile-nav.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

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

const DAMAGE_RE = /<div class="mobile-nav" id="mobileNav">\s*<div class="mnav-group">Services<\/div>\s*(?!<a)/;

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

let repaired = 0, healthy = 0;
const repairedFiles = [];
for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  if (!DAMAGE_RE.test(orig)) { healthy++; continue; }
  const next = orig.replace(DAMAGE_RE, CANONICAL_MOBILE + '\n');
  if (next !== orig) {
    fs.writeFileSync(file, next);
    repaired++;
    repairedFiles.push(path.relative(ROOT, file));
  }
}

console.log(JSON.stringify({ repaired, healthy, sample: repairedFiles.slice(0, 5) }, null, 2));

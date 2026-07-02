#!/usr/bin/env node
/*
 * Follow-up 2026-07 (#2 extended to all similar pages): the homepage got an
 * 800px mobile hero background (LCP 5.9s -> 4.6s local). The same criteria —
 * a 1600x1200 raster served as a CSS hero background under a heavy gradient —
 * applies to every service/area page:
 *
 *   .combo-hero-bg  image-set(roofing-2.webp 250KB / .jpg 404KB)  ~116 pages
 *   .city-hero-bg   image-set(roofing-1.webp 178KB / .jpg 331KB)  ~30 pages
 *
 * This codemod appends, immediately after each such rule, a
 * @media(max-width:600px) override that swaps in the 800x600 q72 variants
 * (roofing-1-800.webp 55KB / roofing-2-800.webp 77KB — both -69%). The
 * override's background value is derived from the page's own rule text, so
 * any per-page gradient differences carry over verbatim; only the webp URL
 * changes (the jpg fallback stays full-size for the ~nil non-webp mobile
 * browsers). Desktop is untouched.
 *
 * Idempotent: pages already containing a roofing-N-800 reference are skipped.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

const RULE_RE =
  /\.(city-hero-bg|combo-hero-bg)\{[^}]*?(background:linear-gradient\([^}]*?\),image-set\(url\(\/assets\/images\/roofing-([12])\.webp\) type\("image\/webp"\), url\(\/assets\/images\/roofing-\3\.jpg\) type\("image\/jpeg"\)\) center\/cover no-repeat)[^}]*\}/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['pro', 'admin', 'dev', 'tools', 'assets', 'deploy'].includes(entry.name)) continue;
      if (full.endsWith(path.join('sites', 'oaks'))) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

let touched = 0;
let rules = 0;
for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  if (/roofing-[12]-800\.webp/.test(orig)) continue; // already applied
  let count = 0;
  const next = orig.replace(RULE_RE, (rule, cls, bg, n) => {
    count++;
    const mobileBg = bg.replace(`roofing-${n}.webp`, `roofing-${n}-800.webp`);
    return `${rule}@media(max-width:600px){.${cls}{${mobileBg}}}`;
  });
  if (count > 0) {
    fs.writeFileSync(file, next);
    touched++;
    rules += count;
  }
}
console.log(JSON.stringify({ filesTouched: touched, rulesAugmented: rules }));

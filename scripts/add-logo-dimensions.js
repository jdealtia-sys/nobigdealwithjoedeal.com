#!/usr/bin/env node
/*
 * SEO-hardening 2026-07 (F3): add intrinsic width/height attributes to every
 * <img> that loads /assets/images/nbd-logo.png and has no width attribute.
 *
 * The logo's intrinsic size is 240x160 (verified with PIL). Rendering does not
 * change: the nav variant is sized by its inline style (height:42px;width:auto)
 * which overrides the attributes, and the unstyled footer/blog variants already
 * render at intrinsic size. The attributes give the browser an aspect ratio
 * before the image loads, eliminating that source of layout shift.
 *
 * Idempotent: tags that already carry a width attribute are left alone.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

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
let total = 0;
for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  let count = 0;
  const next = orig.replace(/<img\b[^>]*>/g, (tag) => {
    if (!tag.includes('/assets/images/nbd-logo.png')) return tag;
    if (/\bwidth\s*=/.test(tag)) return tag;
    count++;
    return tag.replace(
      /src="\/assets\/images\/nbd-logo\.png"/,
      'src="/assets/images/nbd-logo.png" width="240" height="160"'
    );
  });
  if (count > 0) {
    fs.writeFileSync(file, next);
    touched++;
    total += count;
  }
}
console.log(JSON.stringify({ filesTouched: touched, tagsUpdated: total }, null, 2));

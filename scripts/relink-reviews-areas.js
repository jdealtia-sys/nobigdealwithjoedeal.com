#!/usr/bin/env node
/*
 * Rewrite footer/body anchor links sitewide:
 *   /#reviews -> /review (dedicated page, better UX)
 *   /#areas   -> /areas/ (now a real hub page)
 *
 * Preserve index.html's own in-page section anchors (#reviews, #areas) so the
 * landing page still scrolls to its own sections.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['admin', 'pro', 'sites', 'assets', 'deploy', 'free-guide', 'tools'].includes(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

let stats = { reviews: 0, areas: 0 };
for (const f of walk(ROOT)) {
  const orig = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const isIndex = rel === 'index.html';
  let next = orig;

  // /#reviews always becomes /review (it's a cross-page link even on index)
  const rA = (next.match(/href="\/#reviews"/g) || []).length;
  next = next.replace(/href="\/#reviews"/g, 'href="/review"');
  stats.reviews += rA;

  // Plain #reviews only on non-index (index keeps its own section anchor)
  if (!isIndex) {
    const rB = (next.match(/href="#reviews"/g) || []).length;
    next = next.replace(/href="#reviews"/g, 'href="/review"');
    stats.reviews += rB;
  }

  // /#areas always becomes /areas/ (cross-page)
  const aA = (next.match(/href="\/#areas"/g) || []).length;
  next = next.replace(/href="\/#areas"/g, 'href="/areas/"');
  stats.areas += aA;

  // Plain #areas only on non-index
  if (!isIndex) {
    const aB = (next.match(/href="#areas"/g) || []).length;
    next = next.replace(/href="#areas"/g, 'href="/areas/"');
    stats.areas += aB;
  }

  if (next !== orig) fs.writeFileSync(f, next);
}
console.log(JSON.stringify(stats, null, 2));

#!/usr/bin/env node
/**
 * Every page carries an inline onclick on the hamburger button that
 * toggles the mobile-nav `.open` class. Several pages ALSO attach a
 * redundant addEventListener in a trailing <script> block. Clicking
 * fires both handlers, producing an even number of toggles, so the
 * menu appears non-clickable.
 *
 * This script removes the redundant addEventListener blocks, keeping
 * the inline onclick (consistent on every page) as the single
 * handler. Idempotent: runs are safe.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const SKIP_DIRS = new Set(['admin', 'pro', 'sites', 'assets', 'deploy', 'tools']);

// Match both single-line and multi-line variants of the redundant listener.
const PATTERNS = [
  // Multi-line arrow form with braces
  /document\.getElementById\(\s*['"]hamburger['"]\s*\)\.addEventListener\(\s*['"]click['"]\s*,\s*\(\s*\)\s*=>\s*\{\s*document\.getElementById\(\s*['"]mobileNav['"]\s*\)\.classList\.toggle\(\s*['"]open['"]\s*\)\s*;?\s*\}\s*\)\s*;?\s*/g,
  // Single-line arrow form without braces
  /document\.getElementById\(\s*['"]hamburger['"]\s*\)\.addEventListener\(\s*['"]click['"]\s*,\s*\(\s*\)\s*=>\s*document\.getElementById\(\s*['"]mobileNav['"]\s*\)\.classList\.toggle\(\s*['"]open['"]\s*\)\s*\)\s*;?\s*/g,
  // Classic function() form
  /document\.getElementById\(\s*['"]hamburger['"]\s*\)\.addEventListener\(\s*['"]click['"]\s*,\s*function\s*\(\s*\)\s*\{\s*document\.getElementById\(\s*['"]mobileNav['"]\s*\)\.classList\.toggle\(\s*['"]open['"]\s*\)\s*;?\s*\}\s*\)\s*;?\s*/g,
];

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

const stats = { scanned: 0, stripped: 0, removedBlocks: 0, clean: 0 };
const samples = [];

for (const file of walk(ROOT)) {
  stats.scanned++;
  let html = fs.readFileSync(file, 'utf8');
  let before = html;
  let totalRemoved = 0;
  for (const re of PATTERNS) {
    const matches = html.match(re);
    if (matches) totalRemoved += matches.length;
    html = html.replace(re, '');
  }
  if (html !== before) {
    fs.writeFileSync(file, html);
    stats.stripped++;
    stats.removedBlocks += totalRemoved;
    if (samples.length < 5) samples.push({ file: path.relative(ROOT, file), removed: totalRemoved });
  } else {
    stats.clean++;
  }
}

console.log(JSON.stringify({ stats, samples }, null, 2));

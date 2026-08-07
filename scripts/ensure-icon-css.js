#!/usr/bin/env node
/*
 * Ensure every page that contains `<svg class="nav-ico">` or `<svg class="ico">`
 * ALSO has the CSS rules that size them. Without the CSS, inline SVGs default
 * to huge native dimensions and blow the nav off screen.
 *
 * 2026-08-07: the rules moved from per-page injected <style> blocks (~1.1 KB
 * of byte-identical CSS stamped into 185 pages) to the shared stylesheet
 * docs/assets/css/nbd-icons.css — one cached 304 instead of re-downloading
 * the rules inside every 5-minute-max-age HTML body. This script is now the
 * LINKER: default run is assert-only (exit 1 listing offenders — CI-wireable);
 * --write removes any legacy injected block and adds the <link>.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const LINK_TAG = '<link rel="stylesheet" href="/assets/css/nbd-icons.css">';
const WRITE = process.argv.includes('--write');

// One dedicated <style> tag per legacy injection (ensure-icon-css or
// swap-emojis vintage) — matched by its marker comment, never by position.
const LEGACY_STYLE_RE = /[ \t]*<style>(?:(?!<\/style>)[\s\S])*?(?:ico sizing \(injected\)|unified-emoji-swap injected)(?:(?!<\/style>)[\s\S])*?<\/style>\n?/g;

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

let fixed = 0;
const offenders = [];
for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  const usesIcons = /<svg class="(?:nav-)?ico[ "]/.test(orig);
  const hasLegacy = LEGACY_STYLE_RE.test(orig);
  LEGACY_STYLE_RE.lastIndex = 0;
  const hasLink = orig.includes('/assets/css/nbd-icons.css');
  if (!usesIcons && !hasLegacy) continue;

  const ok = hasLink && !hasLegacy;
  if (ok) continue;

  if (!WRITE) {
    offenders.push(path.relative(ROOT, file) + (hasLegacy ? ' [legacy inline block]' : ' [missing link]'));
    continue;
  }

  let next = orig.replace(LEGACY_STYLE_RE, '');
  if (!next.includes('/assets/css/nbd-icons.css') && /<\/head>/.test(next)) {
    next = next.replace(/<\/head>/, LINK_TAG + '\n</head>');
  }
  if (next !== orig) { fs.writeFileSync(file, next); fixed++; }
}

if (!WRITE && offenders.length) {
  console.error('ensure-icon-css: ' + offenders.length + ' page(s) out of contract:');
  for (const o of offenders.slice(0, 20)) console.error('  - ' + o);
  console.error('Run: node scripts/ensure-icon-css.js --write');
  process.exit(1);
}
console.log(JSON.stringify(WRITE ? { fixed } : { clean: true }, null, 2));

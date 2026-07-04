#!/usr/bin/env node
/*
 * Perf-hardening 2026-07 (T3b): remove dead Google Fonts preconnects.
 *
 * Public pages carry <link rel="preconnect" href="https://fonts.googleapis.com">
 * and <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin> from
 * before the fonts were self-hosted. No public page loads a
 * fonts.googleapis.com stylesheet any more, so the preconnects cost two TLS
 * handshakes per page load for nothing. Remove both links (and any trailing
 * newline they leave behind).
 *
 * Pages that still load fonts.googleapis.com/css (sites/, pro/, admin/ — the
 * latter two are outside the walk anyway) are skipped: their preconnects are
 * live. Idempotent: re-running after conversion finds nothing to change.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // pro/admin = CRM app (out of scope); dev = not deployed; tools = private
      // utilities; sites/oaks = private customer template with its own brand.
      if (['pro', 'admin', 'dev', 'tools', 'assets', 'deploy'].includes(entry.name)) continue;
      if (full.endsWith(path.join('sites', 'oaks'))) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

const RE = /[ \t]*<link\s+rel="preconnect"\s+href="https:\/\/fonts\.(?:googleapis|gstatic)\.com"(?:\s+crossorigin)?\s*\/?>\n?/g;

let touched = 0;
let total = 0;
for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  if (orig.includes('fonts.googleapis.com/css')) continue; // preconnect is live
  let count = 0;
  const next = orig.replace(RE, () => { count++; return ''; });
  if (count > 0) {
    fs.writeFileSync(file, next);
    touched++;
    total += count;
  }
}
console.log(JSON.stringify({ filesTouched: touched, linksRemoved: total }, null, 2));

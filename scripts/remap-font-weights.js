#!/usr/bin/env node
/*
 * Perf-hardening 2026-07 (T3a): Montserrat font-weight diet.
 *
 * Public pages self-host six Montserrat weights (400/500/600/700/800/900,
 * ~277KB of woff2 on index alone). The 500 and 900 weights are visually
 * near-duplicates of 600 and 800. Rather than deleting @font-face rules
 * (which would risk faux-bold fallback for any missed usage), this codemod
 * remaps every inline-CSS usage on public HTML pages:
 *   font-weight:500 -> font-weight:600
 *   font-weight:900 -> font-weight:800
 * (both minified `font-weight:500` and spaced `font-weight: 500` forms).
 * With zero usages remaining, the browser never requests the 500/900 files.
 * nbd-fonts.css itself is intentionally untouched.
 *
 * Pages that load Google-hosted font stylesheets (fonts.googleapis.com/css)
 * are skipped — their weight axes are tied to the remote stylesheet request.
 * Idempotent: re-running after conversion finds nothing to change.
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

let touched = 0;
let total = 0;
for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  if (orig.includes('fonts.googleapis.com/css')) continue; // remote font page
  let count = 0;
  const next = orig
    .replace(/font-weight:(\s*)500\b/g, (m, sp) => { count++; return 'font-weight:' + sp + '600'; })
    .replace(/font-weight:(\s*)900\b/g, (m, sp) => { count++; return 'font-weight:' + sp + '800'; });
  if (count > 0) {
    fs.writeFileSync(file, next);
    touched++;
    total += count;
  }
}
console.log(JSON.stringify({ filesTouched: touched, declarationsRewritten: total }, null, 2));

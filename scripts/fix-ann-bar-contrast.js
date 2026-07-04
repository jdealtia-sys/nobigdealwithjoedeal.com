#!/usr/bin/env node
/*
 * SEO-hardening 2026-07 (F4, scoped): announcement-bar contrast.
 *
 * The .ann-bar renders white 10.4–12.8px bold text on brand orange #E8720C —
 * 3.06:1, which fails WCAG AA for normal-size text (needs 4.5:1) and is far
 * below the 18.66px-bold "large text" threshold where 3:1 would pass. The bar
 * text cannot grow to 18.66px without wrapping/redesign, so per the approved
 * remediation the bar's background moves to the darkened accent #B85400
 * (4.55:1 with white). This is a flagged, per-element exception — the rest of
 * the flagged white-on-orange elements (.btn-primary, .nav-cta, badges) are
 * awaiting Jo's decision and are NOT touched here.
 *
 * Only the `background` declaration inside `.ann-bar { ... }` style blocks is
 * rewritten (both minified and pretty-printed forms). Idempotent: re-running
 * after conversion finds nothing to change.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const NEW_BG = '#B85400';

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
  let count = 0;
  const next = orig.replace(
    /(\.ann-bar\s*\{[^}]*?)background:\s*var\(--orange\)/g,
    (m, head) => {
      count++;
      return head + 'background:' + NEW_BG;
    }
  );
  if (count > 0) {
    fs.writeFileSync(file, next);
    touched++;
    total += count;
  }
}
console.log(JSON.stringify({ filesTouched: touched, declarationsRewritten: total }, null, 2));

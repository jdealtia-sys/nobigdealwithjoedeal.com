#!/usr/bin/env node
/*
 * A11y contrast (Jul 2026 remediation follow-up): tiny ORANGE TEXT on light
 * backgrounds moves from brand orange #E8720C (3.07:1 on white, 2.77:1 on
 * off-white — AA fail at these sizes) to a darkened text-orange
 * #A64B00 — the lightest in-family shade that clears 4.5:1 on EVERY light
 * background in scope (5.79 white, 5.22 off-white #f5f3ef, 4.77/4.67 on the
 * rgba(232,114,12,.18/.20) tag-pill tints). The ann-bar/badge token #B85400
 * was tuned for white text ON orange; as text ON light tints it only reaches
 * ~3.9-4.0, so the text role gets its own darker value.
 *
 * In scope — verified light-background, sub-large-text (<18.66px bold):
 *   1. .section-label class defs         (~0.72rem labels on white sections)
 *   2. .post-tag class defs              (0.7rem pills, orange-tinted white bg)
 *   3. "View All 25+ Cities" area chips  (.82rem links on white pills)
 *   4. /review featured-section label + "Read … review(s) on Google" links
 *
 * Deliberately NOT touched:
 *   - Orange text on navy (#142a52) — 4.62:1, passes AA at these sizes
 *     (footer links, mobile menu, hero accents, .section-label-light).
 *   - White-on-orange primary CTA buttons (.btn-primary, .nav-cta, form
 *     submits) — brand orange kept per Jo's recorded decision (see
 *     scripts/fix-tiny-badge-contrast.js header).
 *   - Hover-only states (transient).
 *
 * Idempotent: replacements no longer match once applied.
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.resolve(__dirname, '..', 'docs');
const NEW = '#A64B00';

let totalEdits = 0;
let failures = 0;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.html') ? [p] : []);
  });
}
const PAGES = walk(DOCS);

// [description, regex (global), replacement, expected total matches across docs]
// Expected counts describe the original one-shot run; idempotent re-runs
// report 0s (warned, not failed).
const SWEEPS = [
  ['.section-label def color',
    /(\.section-label\s*\{[^}]*?)color:\s*var\(--orange\)/g, `$1color: ${NEW}`, 14],
  // Lookbehind keeps compound selectors out: .post-card.featured .post-tag
  // sits on the NAVY featured card, where brand orange is the readable
  // choice and darkening would be a regression.
  ['.post-tag def color (plain var, base selector only)',
    /((?<![ \w\]])\.post-tag\s*\{[^}]*?)color:\s*var\(--orange\)(?!,)/g, `$1color: ${NEW}`, 1],
  ['.post-tag def color (var with fallback, blog post pages)',
    /(\.post-tag\s*\{[^}]*?)color:var\(--orange,#e8720c\)/g, `$1color:${NEW}`, 6],
  ['area-chip "View All" links',
    /(background:white;border:1px solid #e8e5e0;border-radius:100px;padding:8px 16px;text-decoration:none;font-size:\.82rem;font-weight:600;)color:#e8720c/g,
    `$1color:${NEW}`, 12],
  ['/review featured-section label',
    /(letter-spacing:\.16em;text-transform:uppercase;)color:#e8720c(;margin-bottom:8px">Featured Reviews)/g,
    `$1color:${NEW}$2`, 1],
  ['/review "Read … on Google" links',
    /style="color:#e8720c(;font-weight:700;text-decoration:none">Read)/g,
    `style="color:${NEW}$1`, 4],
  // Round-2 context sweep (each verified on #f5f3ef / white backgrounds;
  // the visually similar eyebrows on .gtss/.nbd-system sit on navy and pass
  // at 4.62:1 — deliberately untouched):
  ['"Where I work / Serving your area" labels on off-white',
    /(font-size:\.7rem;font-weight:700;letter-spacing:\.15em;text-transform:uppercase;)color:#e8720c(;margin-bottom:8px;")/g,
    `$1color:${NEW}$2`, 3],
  ['blog-post area chips on white pills',
    /(padding:6px 14px;text-decoration:none;font-size:\.78rem;font-weight:600;)color:#e8720c/g,
    `$1color:${NEW}`, 2],
];

for (const [desc, re, replacement, expected] of SWEEPS) {
  let count = 0;
  for (const file of PAGES) {
    const src = fs.readFileSync(file, 'utf8');
    const matches = src.match(re);
    if (!matches) continue;
    count += matches.length;
    fs.writeFileSync(file, src.replace(re, replacement), 'utf8');
  }
  const ok = count === expected;
  if (!ok) failures++;
  totalEdits += count;
  console.log(`${ok ? '✓' : '✗'} ${desc}: ${count} (expected ${expected})`);
}

console.log(`\n${totalEdits} edits applied.`);
if (failures && totalEdits > 0) {
  console.warn(`${failures} sweep(s) hit an unexpected count — grep the targets before trusting this run.`);
}

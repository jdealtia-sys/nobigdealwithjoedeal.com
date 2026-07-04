#!/usr/bin/env node
/*
 * SEO-hardening 2026-07 (F4 follow-up, option "1C"): contrast for the
 * genuinely-tiny white-on-orange badge/pill/ribbon elements (~9.5-12.5px
 * computed) where the text cannot grow without redesign. Their backgrounds
 * move from brand orange #E8720C (3.06:1 with white — AA fail at these sizes)
 * to the darkened accent #B85400 (4.55:1 — AA pass), matching the announcement
 * bar. Primary CTA buttons (.btn-primary, .nav-cta, form submits) deliberately
 * KEEP brand orange per Jo's decision.
 *
 * Targets (each defined on exactly one page, verified by site-wide grep):
 *   index.html                              .about-badge, .wc-ribbon, .sc-badge,
 *                                           .nbd-tier-pill.featured, inline "MOST CHOSEN" span
 *   services/the-nbd-guarantee/index.html   .tc-pill
 *   estimate.html                           .progress-dot.active
 *   our-work.html                           .filter-btn.active
 *
 * Idempotent: replacements no longer match once applied.
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.resolve(__dirname, '..', 'docs');
const NEW = '#B85400';

// [file, description, regex, replacement]
const EDITS = [
  ['index.html', '.about-badge bg',
    /(\.about-badge\{[^}]*?)background:var\(--orange\)/, `$1background:${NEW}`],
  ['index.html', '.wc-ribbon bg',
    /(\.wc-ribbon\{[^}]*?)background:var\(--orange\)/, `$1background:${NEW}`],
  ['index.html', '.sc-badge bg',
    /(\.sc-badge\{[^}]*?)background:var\(--orange\)/, `$1background:${NEW}`],
  ['index.html', '.nbd-tier-pill.featured bg+border',
    /\.nbd-tier-pill\.featured\{background:#e8720c;border-color:#e8720c\}/,
    `.nbd-tier-pill.featured{background:${NEW};border-color:${NEW}}`],
  ['index.html', 'MOST CHOSEN inline span bg',
    /(<span style="font-size:\.6rem;)background:#e8720c;/, `$1background:${NEW};`],
  ['services/the-nbd-guarantee/index.html', '.tc-pill bg',
    /(\.tc-pill \{[^}]*?)background: var\(--orange\);/, `$1background: ${NEW};`],
  ['estimate.html', '.progress-dot.active bg+border',
    /\.progress-dot\.active\{border-color:var\(--orange\);background:var\(--orange\);/,
    `.progress-dot.active{border-color:${NEW};background:${NEW};`],
  ['our-work.html', '.filter-btn.active bg+border',
    /\.filter-btn\.active\{background:var\(--orange\);border-color:var\(--orange\);/,
    `.filter-btn.active{background:${NEW};border-color:${NEW};`],
];

let applied = 0;
for (const [rel, desc, re, replacement] of EDITS) {
  const file = path.join(DOCS, rel);
  const orig = fs.readFileSync(file, 'utf8');
  const next = orig.replace(re, replacement);
  if (next === orig) {
    console.log(`  - ${rel}: ${desc} — no match (already applied?)`);
    continue;
  }
  fs.writeFileSync(file, next);
  applied++;
  console.log(`  ✓ ${rel}: ${desc}`);
}
console.log(JSON.stringify({ applied, of: EDITS.length }));

#!/usr/bin/env node
/*
 * Follow-up to fix-cta-a11y-jul2026.js: that sweep moved white-on-orange
 * CONTROLS (.btn-primary, .nav-cta, etc.) to the #B85400 band token
 * (4.88:1 with white — passes AA) but its target list didn't reach the
 * funnel-family CTA classes (.sc-cta-primary on roof-score/storm-check,
 * .sr-cta-primary on storm-report) or four index.html-specific buttons
 * (.form-submit, .hs-btn, .storm-cta a, .mobile-cta-btn) — all still
 * painting white text on brand orange #E8720C (3.07:1, AA fail).
 *
 * Reuses the exact same band/hover tokens for consistency with the
 * established fix rather than inventing a new color.
 *
 * Idempotent: replacements stop matching once applied.
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.resolve(__dirname, '..', 'docs');
const BAND = '#B85400';
const HOVER = '#A64B00';

const SWEEPS = [
  ['.sc-cta-primary background → band',
    /\.sc-cta-primary\{background:var\(--orange\);color:#fff\}/g,
    `.sc-cta-primary{background:${BAND};color:#fff}`, 2],
  ['.sr-cta-primary background → band (+ hover darken)',
    /\.sr-cta-primary\{background:var\(--orange\);color:#fff\}\.sr-cta-primary:hover\{background:var\(--orange-dark\)\}/g,
    `.sr-cta-primary{background:${BAND};color:#fff}.sr-cta-primary:hover{background:${HOVER}}`, 1],
  ['index.html .mobile-cta-btn background → band',
    /\.mobile-cta-btn\{margin:16px;background:var\(--orange\)!important;/g,
    `.mobile-cta-btn{margin:16px;background:${BAND}!important;`, 1,
    /index\.html$/],
  ['index.html .form-submit background → band',
    /\.form-submit\{width:100%;padding:15px;background:var\(--orange\);color:white;/g,
    `.form-submit{width:100%;padding:15px;background:${BAND};color:white;`, 1,
    /index\.html$/],
  ['index.html .hs-btn background → band',
    /\.hs-btn\{display:block;background:var\(--orange\);color:white;/g,
    `.hs-btn{display:block;background:${BAND};color:white;`, 1,
    /index\.html$/],
  ['index.html .storm-cta a background → band',
    /\.storm-cta a\{display:inline-flex;align-items:center;gap:8px;background:#e8720c;color:#fff;/g,
    `.storm-cta a{display:inline-flex;align-items:center;gap:8px;background:${BAND};color:#fff;`, 1,
    /index\.html$/],
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['admin', 'pro', 'sites', 'assets', 'deploy'].includes(e.name)) return [];
      return walk(p);
    }
    return e.name.endsWith('.html') ? [p] : [];
  });
}
const PAGES = walk(DOCS);

let totalEdits = 0, failures = 0;
for (const [desc, re, replacement, expected, fileRe] of SWEEPS) {
  let count = 0;
  for (const file of PAGES) {
    if (fileRe && !fileRe.test(file)) continue;
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

#!/usr/bin/env node
/*
 * A11y label-in-name (Jul 2026 sitewide sweep): the GAF hero badge link's
 * visible action text is "Verify on GAF.com →", but its aria-label read
 * "Verify GAF Certified™ Contractor on GAF.com" — the visible phrase is
 * not a contiguous substring of the accessible name, so speech-input users
 * saying "click Verify on GAF.com" can't activate it (WCAG 2.5.3).
 *
 * Fix: lead the accessible name with the exact visible phrase and keep the
 * certification context after a dash.
 *
 * Idempotent: the old label no longer exists once applied.
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.resolve(__dirname, '..', 'docs');
// Two encodings of the same label in the wild: the hero badge uses the
// &trade; entity (38 city/service pages); the footer chip uses a literal ™
// (about, roof-replacement, gaf-pivot-boot). Both anchors show
// "Verify on GAF.com →" as visible text. The image-only floating badge
// ("… Contractor status on GAF.com") has no visible text, so label-in-name
// does not apply — deliberately untouched.
const SWAPS = [
  ['aria-label="Verify GAF Certified&trade; Contractor on GAF.com"',
   'aria-label="Verify on GAF.com &mdash; GAF Certified&trade; Contractor"', 38],
  ['aria-label="Verify GAF Certified™ Contractor on GAF.com"',
   'aria-label="Verify on GAF.com — GAF Certified™ Contractor"', 3],
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.html') ? [p] : []);
  });
}

const PAGES = walk(DOCS);
for (const [OLD, NEW, EXPECTED] of SWAPS) {
  let count = 0;
  for (const file of PAGES) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes(OLD)) continue;
    const hits = src.split(OLD).length - 1;
    fs.writeFileSync(file, src.split(OLD).join(NEW), 'utf8');
    count += hits;
  }
  const ok = count === EXPECTED;
  console.log(`${ok ? '✓' : '✗'} GAF badge aria-label: ${count} swapped (expected ${EXPECTED}) [${OLD.slice(12, 40)}…]`);
  if (!ok && count > 0) {
    console.warn('Unexpected count — grep the old label before trusting this run.');
  }
}

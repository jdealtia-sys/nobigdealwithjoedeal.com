#!/usr/bin/env node
/*
 * A11y label-in-name (Jul 2026 sitewide sweep, v2): the GAF badge links
 * carried aria-labels that did not CONTAIN their full visible text
 * ("GAF Certified™ Contractor … Verify on GAF.com →"), so speech-input
 * users couldn't activate them by saying what they see (WCAG 2.5.3 /
 * axe label-content-name-mismatch).
 *
 * v1 reordered the label to lead with "Verify on GAF.com" — not enough:
 * axe checks that the WHOLE normalized visible text is a substring of
 * the accessible name, and these links have two visible lines. The
 * robust fix is to drop the aria-label entirely — the visible text is a
 * complete, descriptive accessible name on its own, and voice users can
 * then speak any part of it.
 *
 * The image-only floating badge (aria-label="…Contractor status on
 * GAF.com", no text content) KEEPS its label — with no visible text
 * there is no mismatch, and removing it would leave an img-alt-only name.
 *
 * Idempotent: the removed attributes no longer exist once applied.
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.resolve(__dirname, '..', 'docs');
// Historic label forms (v1 rewrites + any pre-v1 stragglers), all on
// text-bearing badge links:
const REMOVE = [
  [' aria-label="Verify on GAF.com &mdash; GAF Certified&trade; Contractor"', 38],
  [' aria-label="Verify on GAF.com — GAF Certified™ Contractor"', 3],
  [' aria-label="Verify GAF Certified&trade; Contractor on GAF.com"', 0],
  [' aria-label="Verify GAF Certified™ Contractor on GAF.com"', 0],
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.html') ? [p] : []);
  });
}

const PAGES = walk(DOCS);
for (const [OLD, EXPECTED] of REMOVE) {
  let count = 0;
  for (const file of PAGES) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes(OLD)) continue;
    const hits = src.split(OLD).length - 1;
    fs.writeFileSync(file, src.split(OLD).join(''), 'utf8');
    count += hits;
  }
  const ok = count === EXPECTED;
  console.log(`${ok ? '✓' : '✗'} removed ${count} (expected ${EXPECTED}) [${OLD.slice(13, 55)}…]`);
  if (!ok && count > 0) {
    console.warn('Unexpected count — grep the old label before trusting this run.');
  }
}

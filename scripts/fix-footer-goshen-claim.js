#!/usr/bin/env node
/*
 * Footer copyright line hardcoded "— Goshen, OH" on every page, regardless
 * of which city/service the page is actually about (copy-paste artifact —
 * the page used as the copy source for the area/city-service batches never
 * had this one line parameterized, unlike every other city-specific field).
 *
 * Jo does not live in or claim Goshen as a hometown (he works there, doesn't
 * live there) — so the fix is not "swap in the page's own city" (that would
 * just repeat the same false-residency-claim pattern 212 times with a
 * different city each time). Instead the footer drops to the same neutral
 * service-area phrase already used elsewhere in the brand's own copy
 * (index.html's <title>: "Cincinnati Roofing & Insurance Restoration").
 *
 * Deliberately NOT touched: the homepage "Locally Owned — Goshen, OH —
 * your neighbor" trust badges, and the goshen-oh.html / *-goshen-oh.html
 * hero narrative ("I live and work in Goshen...") — Jo asked to leave that
 * copy alone for a separate pass; this script is footer-only.
 *
 * Idempotent: stops matching once applied.
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.resolve(__dirname, '..', 'docs');
const NEW_LOCATION = 'Greater Cincinnati';

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

const RE = /(No Big Deal Home Solutions\s*[—–-]\s*)Goshen,\s*OH/g;

let touched = 0;
let edits = 0;
const files = [];
for (const file of PAGES) {
  const src = fs.readFileSync(file, 'utf8');
  const matches = src.match(RE);
  if (!matches) continue;
  const next = src.replace(RE, `$1${NEW_LOCATION}`);
  fs.writeFileSync(file, next, 'utf8');
  touched++;
  edits += matches.length;
  files.push(path.relative(DOCS, file).replace(/\\/g, '/'));
}

console.log(JSON.stringify({ touched, edits, expected: 139 }, null, 2));
if (touched !== 139) {
  console.warn(`Expected 139 files, touched ${touched} — grep the target pattern before trusting this run.`);
}

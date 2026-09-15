#!/usr/bin/env node
/**
 * Wrap the GAF / TAMKO / American Operator credential badges into
 * docs/pro/js/nbd-badge-assets.js as data URIs.
 *
 * Same rationale as build-logo-asset.js: the Universal Doc Viewer renders
 * generated documents in a srcdoc iframe with a null origin, and the CSP's
 * object-src rule blocks <object> fallbacks — a root-relative <img src>
 * silently fails to load there (see document-generator-templates.js's
 * letterhead() comment). A data URI always resolves regardless of origin.
 *
 * Source files (already committed, used on the public site's trust-badge
 * sections — see docs/index.html):
 *   docs/assets/gaf/gaf-certified-badge-120.png
 *   docs/assets/tamko/tamko-pro-gold-badge-120.png
 *   docs/assets/american-operator/american-operator-badge-120.png
 * The -120 variant is used everywhere (not -320): these render at
 * roughly 40-60px tall in a document's credential-badge row, and -120
 * already targets that "footer cert bar" scale per the American
 * Operator kit's own CREDIT.txt sizing notes.
 *
 * Usage:  node scripts/build-badge-assets.js
 *         node scripts/build-badge-assets.js --check   (exit 1 if stale)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'docs', 'pro', 'js', 'nbd-badge-assets.js');
const CHECK = process.argv.includes('--check');

// key: the id stored on a companyProfile.brand.affiliates[].badge entry
// (see company-profile.js) and looked up by affiliateRow() in
// document-generator-templates.js.
const BADGES = [
  { key: 'gaf',           src: 'docs/assets/gaf/gaf-certified-badge-120.png' },
  { key: 'tamko',         src: 'docs/assets/tamko/tamko-pro-gold-badge-120.png' },
  { key: 'localOperator', src: 'docs/assets/american-operator/american-operator-badge-120.png' },
];

function readPng(relPath) {
  const abs = path.join(ROOT, relPath);
  const png = fs.readFileSync(abs);
  if (png.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    console.error('Not a PNG: ' + relPath);
    process.exit(1);
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  return { png, width, height };
}

const entries = BADGES.map(function (b) {
  const { png, width, height } = readPng(b.src);
  return {
    key: b.key,
    src: b.src,
    width: width,
    height: height,
    kb: Math.round(png.length / 1024),
    dataUri: 'data:image/png;base64,' + png.toString('base64'),
  };
});

const lines = [
  '/* Inline credential badges (GAF / TAMKO / American Operator "Locally Owned',
  '   & Operated") as data URIs. Bypasses the CSP object-src rule and the',
  '   null-origin srcdoc iframe the Universal Doc Viewer renders documents in,',
  '   either of which can stop a linked <img src="/assets/..."> from loading —',
  '   see build-logo-asset.js for the same reasoning applied to the NBD mark.',
  '',
  '   GENERATED FILE — do not hand-edit.',
  '   Sources (committed, also used on the public site — see docs/index.html):',
];
entries.forEach(function (e) {
  lines.push('     ' + e.src + ' (' + e.width + 'x' + e.height + ', ~' + e.kb + ' KB)');
});
lines.push('   Regenerate: node scripts/build-badge-assets.js');
lines.push(' */');
lines.push("window.NBD_BADGE_ASSETS = {");
entries.forEach(function (e, i) {
  lines.push("  " + e.key + ": { dataUri: '" + e.dataUri + "', width: " + e.width + ', height: ' + e.height + ' }' + (i < entries.length - 1 ? ',' : ''));
});
lines.push('};');
lines.push('');

const module_ = lines.join('\n');

if (CHECK) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== module_) {
    console.error('nbd-badge-assets.js is stale — run: node scripts/build-badge-assets.js');
    process.exit(1);
  }
  console.log('nbd-badge-assets.js is up to date (' + entries.map(function (e) { return e.key; }).join(', ') + ').');
  process.exit(0);
}

fs.writeFileSync(OUT, module_);
console.log('Wrote docs/pro/js/nbd-badge-assets.js');
entries.forEach(function (e) {
  console.log('  ' + e.key + ': ' + e.width + 'x' + e.height + ', ' + e.kb + ' KB -> data URI');
});
console.log('  Total module size: ~' + Math.round(module_.length / 1024) + ' KB');

/**
 * tests/render-pdf-brand-mark-square.test.js — the server-rendered PDF's
 * brand mark must be a SQUARE asset, because it's boxed into a 1:1
 * `object-fit:cover` crop.
 *
 * THE BUG (2026-09-15). functions/print/design-system.css's
 * `.doc-band-top .brand-mark` is a 42x42pt box with `object-fit: cover`
 * (design-system.css:215-220), included on EVERY document type this CRM
 * generates via functions/print/partials/_layout.hbs's unconditional
 * `{{> brandBandTop}}` (_layout.hbs:20) — contract, estimate, invoice,
 * warranty, receipt, changeOrder, inspection, photoReport, all 8 entries
 * of render-pdf.js's TEMPLATES map (render-pdf.js:69-79).
 *
 * `NBD_DOC_COMPANY.logoUrl` used to point at nbd-logo.png — harmless while
 * that asset was 135x75 (the old roofline icon happened to survive a
 * center crop), but the 2026-09-14 brand-pack refresh (#1570) replaced it
 * with a 600x308 pure-wordmark PNG with no icon at all. A 1.948:1 image
 * squeezed into a 1:1 `object-fit:cover` box shows only a fragment of text
 * ("DE") — every PDF generated since #1570 merged had an illegible brand
 * mark, and nothing caught it: no test asserted the crop box and the
 * configured asset actually agree on aspect ratio.
 *
 * This proves the INVARIANT, not just today's specific fix: whatever asset
 * `NBD_DOC_COMPANY.logoUrl` names must be square, because the CSS box that
 * displays it is square. If a future session makes `.brand-mark` non-square,
 * it should update this test deliberately — that's the point of coupling
 * the two checks instead of hardcoding one shape.
 *
 * Run: node tests/render-pdf-brand-mark-square.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RENDER_SRC = fs.readFileSync(path.join(ROOT, 'functions', 'render-pdf.js'), 'utf8');
const CSS_SRC = fs.readFileSync(path.join(ROOT, 'functions', 'print', 'design-system.css'), 'utf8');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('RENDER-PDF — brand-mark box vs configured logo asset agree on aspect ratio');

// ── 1. The .brand-mark crop box is still square (object-fit:cover) ──────
// If this ever stops being true, the invariant below no longer applies —
// better to fail loud here than silently pass a stale assumption.
const markMatch = CSS_SRC.match(/\.doc-band-top \.brand-mark\s*\{([^}]*)\}/);
ok('.doc-band-top .brand-mark rule exists', !!markMatch);
const markBlock = markMatch ? markMatch[1] : '';
const wMatch = markBlock.match(/width:\s*([\d.]+)pt/);
const hMatch = markBlock.match(/height:\s*([\d.]+)pt/);
ok('brand-mark box has explicit width/height in pt', !!wMatch && !!hMatch);
const boxW = wMatch ? parseFloat(wMatch[1]) : NaN;
const boxH = hMatch ? parseFloat(hMatch[1]) : NaN;
ok('brand-mark box is square (1:1) — the whole reason a square asset is required',
  boxW === boxH, boxW + 'pt x ' + boxH + 'pt');
ok('brand-mark still crops with object-fit:cover (not contain — cover is what makes a mismatched aspect ratio silently truncate instead of just letterboxing)',
  /object-fit:\s*cover/.test(markBlock));

// ── 2. NBD_DOC_COMPANY.logoUrl resolves to a real, on-disk, SQUARE PNG ───
const logoMatch = RENDER_SRC.match(/logoUrl:\s*'([^']+)'/);
ok('NBD_DOC_COMPANY.logoUrl is a string literal', !!logoMatch);
const logoUrl = logoMatch ? logoMatch[1] : '';

ok('logoUrl no longer points at the wordmark (the historical bug) — a 1.948:1 image can never satisfy the square-box invariant above',
  !/nbd-logo\.png$/.test(logoUrl), logoUrl);

// Map the public URL to its on-disk path under docs/ (the Hosting root).
const PREFIX = 'https://nobigdealwithjoedeal.com/';
ok('logoUrl is an absolute nobigdealwithjoedeal.com asset URL', logoUrl.startsWith(PREFIX));
const relPath = logoUrl.slice(PREFIX.length); // e.g. 'assets/images/apple-touch-icon.png'
const onDisk = path.join(ROOT, 'docs', ...relPath.split('/'));
ok('the referenced file actually exists on disk at ' + relPath, fs.existsSync(onDisk));

if (fs.existsSync(onDisk)) {
  const buf = fs.readFileSync(onDisk);
  const isPng = buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR';
  ok('the referenced file is a real PNG (IHDR present)', isPng);
  if (isPng) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    ok('the configured brand-mark asset is square — matches the 1:1 crop box (' + width + 'x' + height + ')',
      width === height, width + 'x' + height + ' is not square');
  }
}

console.log('\n' + (failed === 0 ? '✓' : '✗') + ' render-pdf brand-mark square: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }

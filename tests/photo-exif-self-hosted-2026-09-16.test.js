/**
 * tests/photo-exif-self-hosted-2026-09-16.test.js
 *
 * docs/pro/js/photo-smart-ingest.js's HEIC/HEIF/TIFF/AVIF EXIF fallback
 * lazy-loaded `exifr` via `import('https://cdn.skypack.dev/exifr@7')`.
 * firebase.json's CSP script-src-elem never allowlisted cdn.skypack.dev
 * (confirmed by reading the live CSP header value, not assumed), so that
 * import was SILENTLY BLOCKED on every real page load — the surrounding
 * try/catch swallowed the CSP refusal exactly like a network failure, so
 * every native HEIC/HEIF/TIFF/AVIF photo (AirDrop, Files-app drag-drop,
 * drone output, non-auto-converting iOS Safari) has been uploading with
 * ZERO EXIF/GPS since this landed, with nothing surfacing the failure
 * anywhere but an unwatched console.warn.
 *
 * Fix: exifr is now vendored same-origin at
 * docs/assets/vendor/exifr/exifr.esm.mjs (npm exifr@7.1.3's own "module"
 * entry, dist/full.esm.mjs, copied verbatim — the package has zero runtime
 * dependencies, so no import-rewriting was needed to make it a drop-in
 * same-origin ESM module), matching this repo's CLAUDE.md hard invariant
 * that new client JS is an external same-origin file, never a third-party
 * CDN. This avoids the CSP problem entirely instead of allowlisting a new
 * origin.
 *
 * Zero deps. Run: node tests/photo-exif-self-hosted-2026-09-16.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

console.log('photo-smart-ingest.js — exifr self-hosted, not CDN\n');

const SRC = read('docs/pro/js/photo-smart-ingest.js');
// Strip comments before matching — this file's own fix comment quotes the
// broken import verbatim ("the previous import('https://cdn.skypack.dev/
// exifr@7') was SILENTLY BLOCKED"), so an absence-regex against raw source
// would fail on the CORRECT, fixed file. Same guard as
// tests/photo-report-builder.test.js's decommentJs.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

ok('no LIVE reference to cdn.skypack.dev remains in actual code (comments may still document the old bug)',
  !/cdn\.skypack\.dev/.test(CODE));
ok('no reference to any other third-party CDN origin for exifr', !/jsdelivr\.net|unpkg\.com|esm\.sh/.test(CODE));
ok('imports the self-hosted, same-origin vendored build',
  /import\(['"]\/assets\/vendor\/exifr\/exifr\.esm\.mjs['"]\)/.test(CODE));

const VENDOR_PATH = path.join(ROOT, 'docs', 'assets', 'vendor', 'exifr', 'exifr.esm.mjs');
ok('the vendored file exists on disk under docs/ (Hosting root — same path the import string references)', fs.existsSync(VENDOR_PATH));

if (fs.existsSync(VENDOR_PATH)) {
  const vendorSrc = fs.readFileSync(VENDOR_PATH, 'utf8');
  ok('the vendored file is non-trivial (not an empty/placeholder stub)', vendorSrc.length > 10000, 'length=' + vendorSrc.length);
  ok('exports a `parse` binding (what _extractExifViaExifr calls)', /\bas parse\b|\bexport\s*\{[^}]*\bparse\b/.test(vendorSrc));
  ok('carries the HEIC/HEIF box-parsing markers of the FULL build, not the JPEG-only lite build',
    /heic|heif/i.test(vendorSrc));
}

// Confirm the CSP truly does not (and did not) allowlist skypack — proves
// this was a REAL, currently-live bug, not a theoretical one.
const FIREBASE_JSON = read('firebase.json');
const cspLine = (FIREBASE_JSON.match(/"Content-Security-Policy",\s*"value":\s*"([^"]*script-src-elem[^"]*)"/) || [])[1] || '';
ok('found the live CSP header value to check against', cspLine.length > 0);
ok('confirms cdn.skypack.dev was never in script-src-elem — the import really was CSP-blocked, not a red herring',
  !cspLine.includes('skypack'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }

/**
 * tests/theme-contrast.test.js — Phase 10 theme readability engine.
 *
 * The theme-engine's WCAG colour helpers (parseHex / luminance / contrastRatio)
 * are the safety net that keeps theme text readable (and back the FOUC-era
 * fixes). They're closure-private and DOM-coupled siblings make the whole module
 * un-loadable headlessly, so we extract just that pure, dependency-free slice of
 * the real source and evaluate it — testing the shipping implementation, not a
 * copy. Theme APPLICATION, FOUC, and visual rendering are needs-browser.
 *
 * Zero deps. Run: node tests/theme-contrast.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/theme-engine.js'), 'utf8');

// Slice from `function parseHex` through the end of `function contrastRatio`.
// Everything in between is pure colour-math function declarations (parseHex,
// luminance, adjustHex, hexToRgba, contrastRatio, …) — no DOM, no IIFE.
const start = src.indexOf('function parseHex');
const crStart = src.indexOf('function contrastRatio', start);
const end = src.indexOf('\n  }', crStart) + 4;
const slice = src.slice(start, end);

const sandbox = { Math, console, __exp: null };
vm.runInNewContext(slice + '\nthis.__exp = { parseHex, luminance, contrastRatio };', sandbox, { filename: 'theme-engine-slice.js' });
const { parseHex, luminance, contrastRatio } = sandbox.__exp;

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }
const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

console.log('THEME CONTRAST ENGINE — parseHex / luminance / contrastRatio (WCAG)');
ok('extracted the three pure helpers', [parseHex, luminance, contrastRatio].every(f => typeof f === 'function'));

// parseHex
ok("parseHex('#ffffff') → 255,255,255", JSON.stringify(parseHex('#ffffff')) === JSON.stringify({ r: 255, g: 255, b: 255 }));
ok("parseHex('#fff') shorthand expands", JSON.stringify(parseHex('#fff')) === JSON.stringify({ r: 255, g: 255, b: 255 }));
ok("parseHex('#000000') → 0,0,0", JSON.stringify(parseHex('#000000')) === JSON.stringify({ r: 0, g: 0, b: 0 }));
ok("parseHex('not-a-color') → null", parseHex('not-a-color') === null);
ok("parseHex('#12') → null (bad length)", parseHex('#12') === null);
ok('parseHex(null) → null', parseHex(null) === null);

// luminance (relative luminance, 0..1)
ok('luminance(white) ≈ 1', near(luminance('#ffffff'), 1));
ok('luminance(black) ≈ 0', near(luminance('#000000'), 0));
ok('white is brighter than black', luminance('#ffffff') > luminance('#000000'));
ok('green brighter than blue (0.7152 vs 0.0722 weights)', luminance('#00ff00') > luminance('#0000ff'));

// contrastRatio (WCAG: 1..21)
ok('contrast(white,black) ≈ 21 (max)', near(contrastRatio('#ffffff', '#000000'), 21, 0.1));
ok('contrast(white,white) === 1 (min)', near(contrastRatio('#ffffff', '#ffffff'), 1, 0.001));
ok('contrast is symmetric', near(contrastRatio('#123456', '#abcdef'), contrastRatio('#abcdef', '#123456')));
ok('contrast(#666,#fff) clears WCAG AA body text (>=4.5)', contrastRatio('#666666', '#ffffff') >= 4.5);
ok('contrast(#777,#fff) ≈ 4.48 — engine catches the AA boundary precisely', contrastRatio('#777777', '#ffffff') < 4.5 && contrastRatio('#777777', '#ffffff') > 4.4);
ok('contrast(#ccc,#fff) fails AA (too low) — engine can detect bad pairs', contrastRatio('#cccccc', '#ffffff') < 4.5);

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }

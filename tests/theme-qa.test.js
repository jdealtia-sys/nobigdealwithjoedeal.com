/**
 * tests/theme-qa.test.js — automated theme legibility + completeness gate.
 *
 * Phase 3 deliverable: a broken or illegible theme must not merge. For EVERY
 * theme in both registries we assert (a) the required color vars are present and
 * (b) text/muted/accent clear the WCAG floor AS RENDERED.
 *
 * We extract the REAL pure colour helpers from docs/pro/js/theme-engine.js
 * (parseHex … pickContrastingPair) and evaluate them — testing the shipping
 * math, not a copy — then replicate generateCSSVariables' render contract:
 *   - muted (--m) tuned against the card surface to 4.5:1
 *   - card ink/paper tuned to 4.5:1 (pickContrastingPair)
 *   - accent (--orange) tuned against the derived bg to 3:1
 * Static theme-system.css themes are checked at their authored values (+ the
 * appended --m override block), since engine-less pages render them as-is.
 *
 * Zero deps. Run: node tests/theme-qa.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/theme-engine.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/css/theme-system.css'), 'utf8');

// ── extract the real, pure colour helpers (parseHex … pickContrastingPair) ──
const sliceStart = ENGINE.indexOf('function parseHex');
const pcpStart = ENGINE.indexOf('function pickContrastingPair', sliceStart);
const sliceEnd = ENGINE.indexOf('\n  }', pcpStart) + 4;
const helperSrc = ENGINE.slice(sliceStart, sliceEnd);
const sb = { Math, __exp: null };
vm.runInNewContext(
  helperSrc + '\nthis.__exp={parseHex,luminance,adjustHex,hexToRgba,contrastRatio,tuneAgainst,pickContrastingPair};',
  sb, { filename: 'engine-helpers.js' }
);
const { parseHex, adjustHex, contrastRatio, tuneAgainst, pickContrastingPair } = sb.__exp;

const AA_BODY = 4.5, AA_UI = 3.0;
let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

// sanity: the extracted helpers work
ok('engine helpers extracted', [parseHex, adjustHex, contrastRatio, tuneAgainst, pickContrastingPair].every(f => typeof f === 'function'));
ok('contrast(white,black) ≈ 21', Math.abs(contrastRatio('#fff', '#000') - 21) < 0.2);

// ── 1. JS engine registry (186 themes) — rendered contract ──
const sIdx = ENGINE.indexOf('const THEMES = {');
const eIdx = ENGINE.indexOf('\n  };', sIdx);
const region = ENGINE.slice(sIdx, eIdx);
const themeRe = /'([\w-]+)':\s*\{[\s\S]*?category:\s*'([^']+)'[\s\S]*?colors:\s*\{([\s\S]*?)\}/g;
let m, jsCount = 0;
const REQUIRED = ['bg', 'surface', 'surface2', 'text', 'muted', 'accent'];
while ((m = themeRe.exec(region))) {
  const id = m[1]; const c = {};
  m[3].replace(/(\w+):\s*'([^']+)'/g, (_, k, v) => { c[k] = v; });
  if (!c.bg) continue;
  jsCount++;
  // required vars
  const missing = REQUIRED.filter(k => !c[k]);
  ok(`[js:${id}] has required color vars`, missing.length === 0);
  if (missing.length) continue;
  // replicate render
  const bgDerived = c.outerBg || adjustHex(c.bg, -0.18);
  const card = c.surface || c.surface2 || c.bg;
  const mutedFinal = tuneAgainst(c.muted, card, AA_BODY);
  const accentFinal = tuneAgainst(c.accent, bgDerived, AA_UI);
  const paperBase = c.paper || c.surface2 || c.surface;
  const inkPair = pickContrastingPair(c.ink || c.text, paperBase, AA_BODY);
  ok(`[js:${id}] muted clears AA on card`, contrastRatio(mutedFinal, card) >= AA_BODY - 0.01);
  ok(`[js:${id}] card ink clears AA on paper`, contrastRatio(inkPair.fg, inkPair.bg) >= AA_BODY - 0.01);
  ok(`[js:${id}] accent clears UI 3:1 on bg`, contrastRatio(accentFinal, bgDerived) >= AA_UI - 0.01);
}
ok('parsed the full JS registry (>=180 themes)', jsCount >= 180);

// ── 2. static theme-system.css themes — authored values (+ overrides merged) ──
const cssRe = /:root\[data-theme="([^"]+)"\]\s*\{([^}]*)\}/g;
const cssThemes = {}; let cm;
while ((cm = cssRe.exec(CSS))) {
  const v = {}; cm[2].replace(/--([\w-]+)\s*:\s*([^;]+);/g, (_, k, val) => { v[k] = val.trim(); });
  cssThemes[cm[1]] = Object.assign(cssThemes[cm[1]] || {}, v); // merge override blocks
}
const CSS_REQUIRED = ['bg', 's', 's2', 's3', 't', 'm', 'orange'];
let cssCount = 0;
for (const id of Object.keys(cssThemes)) {
  const v = cssThemes[id];
  if (!v.bg && !v.t) continue; // skip accent-only override blocks
  cssCount++;
  const missing = CSS_REQUIRED.filter(k => !v[k]);
  ok(`[css:${id}] has required vars`, missing.length === 0);
  if (missing.length) continue;
  // only check resolvable hex values (some use var() refs e.g. --paper:var(--s3))
  if (parseHex(v.t) && parseHex(v.s2)) ok(`[css:${id}] body text AA on card`, contrastRatio(v.t, v.s2) >= AA_BODY - 0.01);
  if (parseHex(v.t) && parseHex(v.bg)) ok(`[css:${id}] body text AA on bg`, contrastRatio(v.t, v.bg) >= AA_BODY - 0.01);
  if (parseHex(v.m) && parseHex(v.s2)) ok(`[css:${id}] muted AA on card`, contrastRatio(v.m, v.s2) >= AA_BODY - 0.01);
}
ok('parsed the static CSS registry (>=60 themes)', cssCount >= 60);

console.log('\n──────────────────────────────────────────────────');
console.log(`THEME QA — ${jsCount} engine themes + ${cssCount} static themes`);
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }

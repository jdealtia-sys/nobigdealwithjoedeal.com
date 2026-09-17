/* portal-tenant-cta-contrast-2026-09-16.test.js
 *
 * A 2026-09-07 recon flagged: the portal's tenant white-label accent color
 * was copied verbatim from view.company.colors.accent into the CSS
 * background ramp (--nbd-orange and its -deep/-medium/-soft/-glow
 * derivatives via color-mix), with only a coarse luminance>0.45 threshold
 * picking white-or-#12223D foreground text — never a computed WCAG
 * contrast ratio, and the background color itself was never adjusted.
 * "Derive by darkening until AA, don't copy the accent" was the fix this
 * repo's OWN shared accent-contrast contract (--accent-fg,
 * docs/pro/css/theme-system.css) already does correctly elsewhere — the
 * portal had invented its own separate, uncorrected mechanism.
 *
 * The bug is real and provable with a single color: a tenant accent of
 * mid-gray #808080 has a luminance of ~0.216 (below the 0.45 threshold),
 * so the OLD logic picked WHITE foreground text — at only ~3.95:1
 * contrast, BELOW the WCAG AA minimum of 4.5:1 for normal text. Any
 * tenant whose brand color landed in that mid-luminance band shipped
 * genuinely illegible buttons, not just "not ideal."
 *
 * Fix: darken the accent itself, in small steps, until either white or
 * dark-ink foreground actually achieves AA — verified below against five
 * cases spanning the color space, including the exact #808080 failure and
 * an explicit "what would the OLD logic have produced" comparison proving
 * this isn't a hypothetical.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const PORTAL = read('docs/pro/js/portal.js');

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

/* ── lift the color-math block out of the white-label IIFE ── */
const start = PORTAL.indexOf('var _hexToRgb = function');
const end = PORTAL.indexOf("? '#ffffff' : '#12223D';", PORTAL.indexOf('var _safeLum = _relLum')) + "? '#ffffff' : '#12223D';".length;
group('The AA-verification block is present and liftable', () => {
  assert('found the color-math block in docs/pro/js/portal.js', start > -1 && end > start,
    'if this moved, update the extractor — do NOT delete the suite');
});
if (start < 0 || end < start) { console.log('\ncannot continue'); console.log(passed + ' passed, ' + (failed + 1) + ' failed'); process.exit(1); }

const block = PORTAL.slice(start, end);
const ctx = { Math };
vm.createContext(ctx);
// _cols.accent is the only external reference in this slice — supply it
// as a real var so the lifted block runs unmodified.
function runFor(accent) {
  vm.runInContext(
    'var _cols = { accent: ' + JSON.stringify(accent) + ' };\n' + block
    + '\nthis.__out = { safeAccent: safeAccent, fg: _fg };',
    ctx
  );
  return ctx.__out;
}

/* Old-logic reference, for the "this is a real regression, not a
   hypothetical" comparison below — deliberately NOT reusing any of the
   lifted code, so a shared bug couldn't hide the same way in both. */
function oldLogicFg(accent) {
  const h = accent.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const lum = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return lum > 0.45 ? '#12223D' : '#ffffff';
}
function contrastOf(hexBg, hexFg) {
  const lumOf = (hex) => {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const l1 = lumOf(hexBg), l2 = lumOf(hexFg);
  const a = Math.max(l1, l2) + 0.05, b = Math.min(l1, l2) + 0.05;
  return a / b;
}

group('The exact reported failure: mid-gray #808080 under the OLD logic was below AA', () => {
  const oldFg = oldLogicFg('#808080');
  const oldContrast = contrastOf('#808080', oldFg);
  assert('CONTROL: the old luminance-threshold logic really did pick white text here',
    oldFg === '#ffffff', oldFg);
  assert('CONTROL: and that combination really was below WCAG AA (4.5:1) — the bug this fix closes',
    oldContrast < 4.5, 'old contrast was ' + oldContrast.toFixed(2) + ':1');
});

group('The fix: #808080 now darkens until AA passes', () => {
  const out = runFor('#808080');
  const c = contrastOf(out.safeAccent, out.fg);
  assert('the accent actually changed (darkened), not just the foreground pick',
    out.safeAccent.toLowerCase() !== '#808080', out.safeAccent);
  assert('the resulting background+foreground pair clears AA (4.5:1)',
    c >= 4.5, out.safeAccent + ' / ' + out.fg + ' = ' + c.toFixed(2) + ':1');
});

group('Colors that already pass AA are left untouched — no unnecessary darkening', () => {
  const cases = [
    ['#1a3057', 'a dark navy — already high contrast with white text'],
    ['#F0E68C', 'a bright pastel — already high contrast with dark ink'],
    ['#BD5728', 'NBD\'s own brand orange — must not be altered by this fix'],
  ];
  cases.forEach(([hex, why]) => {
    const out = runFor(hex);
    assert(hex + ' unchanged (' + why + ')', out.safeAccent.toLowerCase() === hex.toLowerCase(),
      'got ' + out.safeAccent);
  });
});

group('Every case in a spot-check spanning the color space clears real AA, not just the old coarse threshold', () => {
  ['#808080', '#1a3057', '#F0E68C', '#BD5728', '#FAFAFA', '#C0C0C0', '#996633'].forEach((hex) => {
    const out = runFor(hex);
    const c = contrastOf(out.safeAccent, out.fg);
    assert(hex + ' -> ' + out.safeAccent + ' / ' + out.fg + ' clears 4.5:1', c >= 4.5, c.toFixed(2) + ':1');
  });
});

group('The background ramp is built from the AA-verified color, not the raw tenant value', () => {
  const applyBlock = PORTAL.slice(PORTAL.indexOf('var _apply = function (st) {'), PORTAL.indexOf('_apply(document.documentElement.style);'));
  assert('--nbd-orange is set from safeAccent', /setProperty\('--nbd-orange', safeAccent\)/.test(applyBlock), applyBlock);
  assert('the color-mix ramp derives from safeAccent, not the raw _cols.accent',
    !/color-mix\(in srgb, ' \+ _cols\.accent/.test(applyBlock)
    && /color-mix\(in srgb, ' \+ safeAccent/.test(applyBlock),
    applyBlock);
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

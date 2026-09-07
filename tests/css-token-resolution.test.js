/* css-token-resolution.test.js
 *
 * A stylesheet that reads a custom property nothing on the page defines does
 * not fail — it silently paints its hardcoded fallback literal, forever, in
 * every theme.
 *
 * docs/pro/css/voice-intelligence.css did exactly that with --text2, --text3
 * and --border2: names from the docs/admin/* palette, defined by NONE of the
 * five stylesheets customer.html loads. So the Voice Intel panel always
 * painted #8892a4 and #4a5568 regardless of theme — 1.46:1 to 1.97:1 for
 * #4a5568 against the dark CRM surfaces, on a page a roofer reads outdoors.
 *
 * This suite checks the whole class: every var(--x) a page's own stylesheets
 * read must be defined by one of them (or by the page). It is deliberately
 * not a contrast test — measuring rendered contrast needs a browser, and
 * theme-system.css ships 66 themes.
 *
 * Also pins the portal's primary-CTA token. nbd-brand.css says in its own
 * words that --nbd-orange is 3.07:1 against --nbd-ink-on-orange and fails
 * AA, and ships --nbd-orange-cta (4.88:1) for text-bearing surfaces. Every
 * CTA portal.js generates carries an inline background:var(--accent), which
 * beats .btn's class rule — so the alias must point at the safe token.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

/* Local stylesheets a page pulls in, resolved relative to docs/pro/. */
function sheetsFor(pageRel) {
  const html = read(pageRel);
  const out = [];
  const re = /<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    if (/^https?:/i.test(href)) continue;          // web fonts etc.
    href = href.split('?')[0];
    const rel = href.startsWith('/')
      ? 'docs' + href
      : path.posix.join(path.posix.dirname(pageRel.replace(/\\/g, '/')), href);
    if (fs.existsSync(path.join(ROOT, rel))) out.push(rel);
  }
  return out;
}

function definedNames(texts) {
  const set = new Set();
  for (const t of texts) {
    const re = /(--[a-zA-Z0-9_-]+)\s*:/g;
    let m;
    while ((m = re.exec(t)) !== null) set.add(m[1]);
  }
  return set;
}

/* Tokens a page's own scripts publish at runtime via setProperty. These are
 * legitimately "defined" even though no stylesheet declares them — e.g.
 * --nbd-corner-claimed is written by fab-stack-coordinator.js and only
 * declared statically in dashboard-app.css, which customer.html does not
 * load. Its fallback (0px) is the correct pre-JS value, unlike a stranded
 * colour literal from another product's palette. */
function runtimeNames(pageRel) {
  const html = read(pageRel);
  const set = new Set();
  const re = /<script[^>]+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let src = m[1];
    if (/^https?:/i.test(src)) continue;
    src = src.split('?')[0];
    const rel = src.startsWith('/')
      ? 'docs' + src
      : path.posix.join(path.posix.dirname(pageRel.replace(/\\/g, '/')), src);
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const js = read(rel);
    const re2 = /setProperty\(\s*['"](--[a-zA-Z0-9_-]+)['"]/g;
    let m2;
    while ((m2 = re2.exec(js)) !== null) set.add(m2[1]);
    // fab-stack-coordinator lists its published names in an array.
    const re3 = /['"](--nbd-[a-zA-Z0-9_-]+)['"]/g;
    let m3;
    while ((m3 = re3.exec(js)) !== null) set.add(m3[1]);
  }
  return set;
}

function readNames(text) {
  const set = new Set();
  const re = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) set.add(m[1]);
  return set;
}

group('Every token docs/pro/customer.html reads is defined by something it loads', () => {
  const page = 'docs/pro/customer.html';
  const sheets = sheetsFor(page);
  assert('found the page stylesheets', sheets.length >= 3, sheets.join(', '));

  const corpus = sheets.map(read).concat([read(page)]);
  const defined = definedNames(corpus);
  for (const n of runtimeNames(page)) defined.add(n);

  // theme-system.css defines the palette; make sure we actually parsed it.
  assert('the theme system was parsed (sanity)', defined.has('--m') && defined.has('--br'));

  for (const sheet of sheets) {
    const missing = [...readNames(read(sheet))].filter((n) => !defined.has(n));
    assert(path.basename(sheet) + ' reads no undefined token', missing.length === 0,
      missing.length ? 'stranded: ' + missing.join(', ') + ' — these silently paint their hardcoded fallback in every theme' : '');
  }
});

group('The Voice Intel panel uses real theme tokens', () => {
  const css = read('docs/pro/css/voice-intelligence.css');
  assert('no --text2 remains', !/--text2\b/.test(css));
  assert('no --text3 remains', !/--text3\b/.test(css));
  assert('no --border2 remains', !/--border2\b/.test(css));
  assert('muted text now reads --m (defined in every theme block)',
    /var\(--m,/.test(css));
  assert('and the two rogue borders match the sheet\'s other nine',
    (css.match(/var\(--border,/g) || []).length >= 11,
    'consistency, not a contrast claim — --border bridges to --br, which is a translucent hairline');
});

group('Portal CTAs resolve to the AA-safe orange', () => {
  const portal = read('docs/pro/portal.html');
  const brand = read('docs/pro/css/nbd-brand.css');

  assert('--accent points at --nbd-orange-cta',
    /--accent:\s*var\(--nbd-orange-cta\)/.test(portal),
    'every generated CTA carries inline background:var(--accent), which beats .btn');
  assert('it does NOT point at the failing --nbd-orange',
    !/--accent:\s*var\(--nbd-orange\)\s*;/.test(portal));
  assert('the brand sheet still documents why', /fail WCAG AA/.test(brand));

  // Verify the token's own claim rather than trusting the comment.
  const cta = /--nbd-orange-cta:\s*(#[0-9a-f]{6})/i.exec(brand);
  assert('--nbd-orange-cta is defined', !!cta);
  if (cta) {
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (1.05) / (lum(cta[1]) + 0.05);
    assert('and clears 4.5:1 against white ink', ratio >= 4.5,
      'measured ' + ratio.toFixed(2) + ':1 for ' + cta[1]);
  }
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

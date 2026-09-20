/**
 * Homepage photo wall — cards link to their project write-up.
 *
 * THE DEFECT (2026-09-20)
 * ──────────────────────────────────────────────────────────────────
 * docs/assets/css/homeowner-wall.css:24 has always given `.hw-card:hover` a
 * 3px lift and a deeper shadow. The cards therefore ADVERTISED a click — and
 * delivered nothing, because scripts/build-projects.mjs built the manifest as
 *
 *     live.slice(0, 12).map((p) => ({ image: p.hero, city: p.city, alt: ... }))
 *
 * dropping `slug`, `tag` and `priceLow/priceHigh` on the floor. Twelve real job
 * photos sat on the homepage as dead thumbnails on top of 45 fully written,
 * individually-URL'd project pages, and the caption said nothing but a town.
 *
 * WHAT THIS SUITE PINS
 * ────────────────────
 * 1. The GENERATOR still emits slug/tag/price. If that map regresses to
 *    image+city+alt, the renderer silently falls back to unlinked figures and
 *    every card goes dead again with no other symptom — the exact failure this
 *    file exists to prevent, and one no visual or integrity gate would catch.
 * 2. The RENDERER links a card when — and only when — the slug is well-formed.
 *    It is lifted out of the shipped file and EXECUTED against a fake mount,
 *    not matched with a regex.
 * 3. A manifest entry with no slug degrades to the OLD behaviour (plain figure)
 *    rather than emitting href="/our-work/undefined".
 * 4. A hostile or malformed slug is never interpolated into an href.
 * 5. Every slug in the SHIPPED manifest resolves to a real detail page on disk.
 *    A broken homepage link is worse than no link.
 *
 * Pure Node, zero deps. Run: node tests/homeowner-wall-links.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function ok(label, cond, hint) {
  if (cond) { passed++; console.log('  \u2713 ' + label); }
  else { failed++; console.log('  \u2717 ' + label + (hint ? '\n      ' + hint : '')); }
}
function section(t) { console.log('\n' + t); }

function lift(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) return null;
  let depth = 0;
  let i = src.indexOf('{', start);
  if (i === -1) return null;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return i < src.length ? src.slice(start, i + 1) : null;
}

const WALL_JS = read('docs/assets/js/homeowner-wall.js');
const GEN_SRC = read('scripts/build-projects.mjs');
const MANIFEST = JSON.parse(read('docs/assets/data/homeowner-wall.json'));

// ── 1. The generator still carries the fields through ────────────────
section('generator — the wall map still emits slug/tag/price');

const wallMap = (() => {
  const i = GEN_SRC.indexOf('const wallJson = JSON.stringify(');
  if (i === -1) return null;
  const end = GEN_SRC.indexOf(') + \'\\n\';', i);
  return end === -1 ? null : GEN_SRC.slice(i, end);
})();

ok('the wall manifest builder was found in build-projects.mjs', !!wallMap);
ok('it maps slug through', !!wallMap && /\bslug:\s*p\.slug\b/.test(wallMap),
  'without slug the renderer cannot link a card — every tile goes dead silently');
ok('it maps tag through', !!wallMap && /\btag:\s*p\.tag\b/.test(wallMap));
ok('it maps a pre-formatted price through', !!wallMap && /\bprice:\s*priceLine\(p\)/.test(wallMap),
  'the renderer must never do money math on a public page');
ok('it does NOT leak cost/margin fields onto a public manifest',
  !!wallMap && !/cost|margin|contractor|profit/i.test(wallMap));

// ── 2. The shipped manifest actually carries them ────────────────────
section('manifest — the committed homeowner-wall.json is the regenerated one');

ok('manifest is a non-empty array', Array.isArray(MANIFEST) && MANIFEST.length > 0);
ok('every entry has a slug', MANIFEST.every((e) => typeof e.slug === 'string' && e.slug),
  'run: node scripts/build-projects.mjs — the manifest is GENERATED');
ok('every slug is kebab-case', MANIFEST.every((e) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.slug)));
ok('every entry has a tag', MANIFEST.every((e) => typeof e.tag === 'string' && e.tag));
ok('at least two-thirds carry a price (38 of 45 projects are priced)',
  MANIFEST.filter((e) => e.price).length >= Math.ceil(MANIFEST.length * 2 / 3));
ok('prices are pre-formatted strings, not raw numbers',
  MANIFEST.filter((e) => e.price).every((e) => typeof e.price === 'string' && e.price.startsWith('$')));
ok('no manifest entry carries a CRM storage URL or a token',
  MANIFEST.every((e) => !/\?|token|firebasestorage|googleapis/i.test(JSON.stringify(e))),
  'photos on public pages ship as EXIF-stripped copies under docs/assets');

section('manifest — every homepage link resolves to a real page on disk');
for (const e of MANIFEST) {
  const rel = path.join('docs', 'our-work', e.slug + '.html');
  ok('/our-work/' + e.slug + ' exists', fs.existsSync(path.join(ROOT, rel)),
    'a dead homepage link is worse than no link');
}

// ── 3. The renderer, executed ────────────────────────────────────────
section('renderer — lifted from the shipped file and run');

const escFn = lift(WALL_JS, 'function esc(s)');
const renderFn = lift(WALL_JS, 'function render(mount, items)');
const slugRe = /var SLUG_RE = (\/.*\/);/.exec(WALL_JS);

ok('esc() lifted', !!escFn);
ok('render() lifted', !!renderFn && renderFn.includes('hw-card'));
ok('SLUG_RE lifted', !!slugRe);
if (!escFn || !renderFn || !slugRe) {
  console.log('\n' + passed + ' passed, ' + (failed + 1) + ' failed\nFATAL: extraction failed');
  process.exit(1);
}

function makeMount() {
  const grid = { innerHTML: '' };
  return {
    hidden: true,
    _attrs: {},
    querySelector(sel) { return sel === '.hw-grid' ? grid : null; },
    removeAttribute(n) { delete this._attrs[n]; },
    get html() { return grid.innerHTML; },
  };
}

const renderWith = new Function(
  'items',
  `var MAX_ENTRIES = 12;\nvar SLUG_RE = ${slugRe[1]};\n${escFn}\n${renderFn}\n`
  + `var grid = { innerHTML: '' };\n`
  + `var mount = { hidden: true, querySelector: function (s) { return s === '.hw-grid' ? grid : null; }, removeAttribute: function () {} };\n`
  + `render(mount, items);\nreturn { html: grid.innerHTML, hidden: mount.hidden };`
);

{
  const out = renderWith([{
    image: '/assets/images/projects/x-1.jpg', alt: 'A roof',
    city: 'Cincinnati, OH', tag: 'Full Tear-Off', price: '$22,500–$23,500',
    slug: 'cincinnati-oh-full-tearoff-reroof-2026',
  }]);
  ok('a slugged card is wrapped in a link',
    out.html.includes('<a class="hw-link" href="/our-work/cincinnati-oh-full-tearoff-reroof-2026"'));
  ok('...extensionless (cleanUrls is on; .html would cost a 301 per click)',
    !/href="\/our-work\/[^"]*\.html"/.test(out.html));
  ok('...the image is INSIDE the link, so the photo is the hit target',
    /<a class="hw-link"[^>]*>\s*<img/.test(out.html));
  ok('...the caption reads city, job type, price',
    out.html.includes('Cincinnati, OH \u00b7 Full Tear-Off \u00b7 $22,500\u2013$23,500'));
  ok('...the link has its own accessible name (not the photo alt text)',
    out.html.includes('aria-label="See the full write-up: Cincinnati, OH \u2014 Full Tear-Off"'));
  ok('...the mount is revealed', out.hidden === false);
}

{
  // 2 of the 12 live entries have no price.
  const out = renderWith([{
    image: '/assets/images/projects/y-1.jpg', alt: 'A gable',
    city: 'Loveland, OH', tag: 'Small Repair', slug: 'loveland-oh-siding-peak-reseal-2026',
  }]);
  ok('an unpriced card still links and still shows city + tag',
    out.html.includes('href="/our-work/loveland-oh-siding-peak-reseal-2026"')
    && out.html.includes('Loveland, OH \u00b7 Small Repair'));
  ok('...and renders no empty price separator', !/\u00b7\s*<\/figcaption>/.test(out.html));
}

section('renderer — degradation and safety');

{
  const out = renderWith([{ image: '/assets/images/projects/z-1.jpg', alt: 'Old entry', city: 'Mason, OH' }]);
  ok('an entry with NO slug renders a plain figure, exactly as before',
    out.html.includes('<figure class="hw-card">') && !out.html.includes('<a '));
  ok('...and never emits /our-work/undefined', !out.html.includes('undefined'));
}

for (const bad of [
  '../../../etc/passwd',
  'javascript:alert(1)',
  'has space',
  'UPPER-CASE',
  'trailing-',
  'has/slash',
  '"onmouseover="alert(1)',
  'a#fragment',
  'a?query=1',
]) {
  const out = renderWith([{ image: '/assets/images/projects/z-1.jpg', alt: 'x', city: 'C', slug: bad }]);
  ok('malformed slug is not linked: ' + JSON.stringify(bad),
    !out.html.includes('<a '),
    'the renderer must not trust the manifest to have come from build-projects.mjs');
}

{
  const out = renderWith([{
    image: '/assets/images/projects/z-1.jpg',
    alt: '"><script>alert(1)</script>',
    city: '<img src=x onerror=alert(1)>',
    tag: '</figcaption><script>bad()</script>',
    price: '$1"><b>',
    slug: 'legit-slug',
  }]);
  // The payload's own characters survive as TEXT — "onerror=" is still spelled
  // out in the caption, inertly, because esc() escapes < > & " ' and not '='.
  // So the assertion that matters is structural: a breakout would create extra
  // ELEMENTS or extra attributes, not extra characters. Exactly four tags is
  // the whole contract (figure > a > img + figcaption).
  const tags = out.html.match(/<[a-zA-Z][^>]*>/g) || [];
  ok('hostile alt/city/tag/price create no new elements',
    tags.length === 4,
    'got ' + tags.length + ' tags: ' + tags.map((t) => t.slice(0, 24)).join(' | '));
  ok('...no <script> survives as a real tag', !/<script/i.test(out.html));
  // Checked per-tag with quoted VALUES stripped first. A naive /<[^>]+\son\w+=/
  // reports a false positive here: the payload's literal "onerror=" text lives
  // inside the aria-label value, and because esc() turned its '>' into '&gt;'
  // there is no literal '>' to stop [^>]+ before it reaches that text. Inert in
  // a browser, which parses the attribute value as a string — so the check has
  // to look at attribute NAMES, not at raw characters.
  const attrNames = tags.flatMap((t) =>
    Array.from(t.replace(/"[^"]*"/g, '""').matchAll(/\s([a-zA-Z-]+)\s*=/g), (m) => m[1].toLowerCase()));
  ok('...no on*= handler survives as a real attribute (CSP refuses inline handlers anyway)',
    attrNames.every((n) => !n.startsWith('on')),
    'attributes seen: ' + attrNames.join(', '));
  ok('...the angle brackets and quotes were escaped',
    out.html.includes('&lt;script&gt;') && out.html.includes('&quot;'));
  ok('...and the card still renders', out.html.includes('href="/our-work/legit-slug"'));
}

{
  const many = Array.from({ length: 20 }, (_, i) => ({
    image: '/assets/images/projects/p-' + i + '.jpg', alt: 'p' + i,
    city: 'C', slug: 'slug-' + i,
  }));
  const out = renderWith(many);
  ok('the grid still caps at 12 cards', (out.html.match(/<figure/g) || []).length === 12);
}

console.log('\n' + '\u2500'.repeat(30));
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);

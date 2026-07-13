#!/usr/bin/env node
/*
 * CTA + heading-accent + heading-structure remediation (2026-07-13).
 *
 * Jo approved fixing all three families that earlier rounds had flagged
 * as brand decisions (supersedes the "keep brand orange on primary CTAs"
 * decision recorded in scripts/fix-tiny-badge-contrast.js):
 *
 * 1. WHITE-ON-ORANGE CONTROLS — every control that painted white text on
 *    brand orange #E8720C (3.06:1; AA needs 4.5 at these sizes) moves to
 *    the site's existing dark-band token #B85400 (4.88:1 with white),
 *    already used by the announcement bar, "MOST CHOSEN" badge, and
 *    active filter pills — so this converges the site on one compliant
 *    orange band instead of inventing another. Hover states that used to
 *    lighten (#c45e08 / var(--orange-dark|hover|light)) now darken to
 *    #A64B00 (5.79:1) so hover still reads as a state change.
 *    In scope: .btn-primary, .nav-cta, .nbd-skip focus links, blog
 *    .callout/.cta-sidebar buttons, orange .final-cta bands (navy
 *    variants untouched), ann-bar stragglers, .nav-logo-badge,
 *    .step-num pills, misc active/hover states, the 14 inline blog
 *    estimate buttons, financing's numbered chips, and the qlf/bmc/
 *    mobile-cta CSS assets. Pale copy on the orange final-cta bands
 *    (rgba(255,255,255,.9/.92) ≈ 4.2–4.4 on #B85400) goes full #fff.
 *
 * 2. HEADING ACCENT WORDS — the orange accent span in h1/h2/section
 *    titles was 2.76:1 on off-white sections (large-text floor is 3.0).
 *    All heading-span rules move to #DA6A05: 3.13 on off-white, 3.47 on
 *    white, 4.08 on navy-dark, 3.21 on navy — ≥3.0 in every heading
 *    context sitewide, ~4% darker than brand (visually near-identical).
 *    Applied ONLY to heading-level rules (h1/h2/*title* + span); body
 *    text keeps the #A64B00 treatment from earlier rounds.
 *
 * 3. HEADING STRUCTURE + DECORATIVE NUMERALS —
 *    - Footer column titles were <h4> after page bodies ending at h2
 *      (heading-order skip). They become <h2 class="footer-col-title">;
 *      the per-page `.footer-col h4` rules are renamed to
 *      `.footer-col .footer-col-title` so styling is identical, and the
 *      readability override (footer .footer-col-title) already matches.
 *    - Blog fact-box <h4> → <h3> (follows h2 content, no skip).
 *    - The 3rem step-number watermarks (brand orange at opacity .25 ≈
 *      1.3:1) are decorative duplication of source order — they get
 *      aria-hidden="true" AND move to the solid #DA6A05 accent at full
 *      opacity (48px large-text, 3.47:1), matching about.html's timeline
 *      numerals: axe's color-contrast rule checks visible text regardless
 *      of aria-hidden, so a color fix is required either way. The
 *      numbered pills keep real contrast via the #B85400 sweep instead.
 *
 * Idempotent: every replacement stops matching once applied.
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.resolve(__dirname, '..', 'docs');
const BAND = '#B85400';   // white-on-it 4.88:1
const HOVER = '#A64B00';  // white-on-it 5.79:1
const ACCENT = '#DA6A05'; // ≥3.0 large-text on every heading background

let totalEdits = 0;
let failures = 0;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.html') ? [p] : []);
  });
}
// Perimeter: public marketing pages plus the pro blog/terms, which share
// the public design system. The themed pro APP (login, dashboard, etc.)
// runs its own token/theme engine with smoke-test contracts — hardcoding
// band colors there breaks theme swaps. sites/, admin/, dev/ are demo/
// internal surfaces outside the remit.
function inScope(p) {
  const f = p.split(path.sep).join('/');
  if (/\/(sites|admin|dev)\//.test(f)) return false;
  if (f.includes('/pro/')) return f.includes('/pro/blog/') || f.endsWith('/pro/terms.html');
  return true;
}
const PAGES = walk(DOCS).filter(inScope);

// [description, regex (global), replacement, expected, optional file filter]
const SWEEPS = [
  ['.btn-primary base → band', /(\.btn-primary\s*\{[^}]*?)background:\s*var\(--orange\)/g, `$1background:${BAND}`, 173],
  ['.nav-cta base → band', /(\.nav-cta\s*\{[^}]*?)background:\s*var\(--orange(?:,#e8720c)?\)(!important)?/g, `$1background:${BAND}$2`, 205],
  ['.nbd-skip focus link → band', /(\.nbd-skip[^{}]*\{[^}]*?)background:\s*#e8720c/g, `$1background:${BAND}`, 199],
  ['blog .callout/.cta-sidebar buttons → band', /(\.(?:callout|cta-sidebar) a\{[^}]*?)background:var\(--orange\)/g, `$1background:${BAND}`, 44],
  ['.section-orange band (currently unused defs)', /(\.section-orange\s*\{\s*)background:\s*var\(--orange\)/g, `$1background:${BAND}`, 12],
  ['orange .final-cta bands → band', /(\.final-cta\s*\{[^}]*?)background:\s*var\(--orange\)/g, `$1background:${BAND}`, 13],
  ['ann-bar stragglers (6 pages missed by the 2026-06 badge round)', /(\.ann-bar[^{}]*\{[^}]*?)background:\s*var\(--orange\)/g, `$1background:${BAND}`, 6],
  ['solid controls (nav-logo-badge, sb-call, tc-launch, submit/upload)', /(\.(?:nav-logo-badge|sb-call|tc-launch|submit-btn|upload-btn)[^{}]*\{[^}]*?)background:\s*var\(--orange\)/g, `$1background:${BAND}`, 39],
  ['active states (tab/tt/tl-pill/tier cta)', /(\.(?:tab-btn\.active|tt\.active|tl-pill\.active|tier-card\.preferred \.tc-cta)[^{}]*\{[^}]*?)background:\s*var\(--orange\)/g, `$1background:${BAND}`, 1],
  ['.tl-num pill', /(\.tl-num\{[^}]*?)background:var\(--orange\)/g, `$1background:${BAND}`, 1],
  ['.step-num pills (white numeral on orange)', /(\.step-num\{position:absolute[^}]*?)background:var\(--orange\)/g, `$1background:${BAND}`, 15],
  ['hovers that turned orange (btn-cal, back-to-top, call-btn, tc-cta)', /((?:\.btn-cal|\.back-to-top|\.topbar \.call-btn|\.tc-cta):hover[^{}]*\{[^}]*?)background:\s*var\(--orange\)/g, `$1background:${BAND}`, 109],
  ['.btn (offline.html)', /(\.btn\{[^}]*?)background:var\(--orange\)/g, `$1background:${BAND}`, 1],
  ['primary/nav hovers now darken', /(\.(?:btn-primary|nav-cta):hover[^{}]*\{[^}]*?)background:\s*(?:var\(--orange-dark\)|var\(--orange-hover\)|var\(--orange-light\)|#c45e08)\s*(!important)?/g, `$1background:${HOVER}$2`, 91],
  ['orange final-cta body copy → #fff', /(\.final-cta p\s*\{[^}]*?)color:\s*rgba\(255,255,255,\s*0?\.9[02]?\)/g, '$1color:#fff', 13],
  ['orange final-cta .phone → #fff', /(\.final-cta \.phone\s*\{[^}]*?)color:\s*rgba\(255,255,255,\s*0?\.9\)/g, '$1color:#fff', 12],
  ['heading accent spans (var form) → large-text-safe accent', /([\w .#-]*(?:h1|h2|title)[\w -]*span\s*\{[^}]*?)color:\s*var\(--orange\)/g, `$1color:${ACCENT}`, 533],
  ['heading accent spans (literal form)', /([\w .#-]*(?:h1|h2|title)[\w -]*span\s*\{[^}]*?)color:\s*#e8720c/g, `$1color:${ACCENT}`, 3],
  ['areas/index inline heading accent', /(<h2>Don't See <span style=")color:var\(--orange\)(">Your City\?<\/span>)/g, `$1color:${ACCENT}$2`, 1, /areas[\/\\]index\.html$/],
  ['inline blog estimate buttons → band', /style="display:inline-block;background:#e8720c;(color:white;padding:14px 28px;border-radius:8px;font-weight:800;font-size:\.9rem;text-decoration:none")/g, `style="display:inline-block;background:${BAND};$1`, 14],
  ['financing numbered chips → band', /background:var\(--orange\);(color:#fff;width:28px;height:28px;border-radius:50%)/g, `background:${BAND};$1`, 4],
  ['inline midpage-cta btn-primary → band',
    /(class="btn-primary" style=")background:var\(--orange,#e8720c\);(color:#fff;padding:14px 26px)/g,
    `$1background:${BAND};$2`, 11],
  // aria-hidden does NOT exempt visible text from the axe color-contrast
  // rule (verified empirically) — the ghost numerals get the same
  // full-strength accent treatment as about.html's timeline numerals.
  ['step-num watermark → solid accent numeral (48px large-text, 3.47:1)',
    /color: var\(--orange\); opacity: 0\.25; line-height: 1;/g,
    `color: ${ACCENT}; line-height: 1;`, 12],
  ['.footer-col h4 selector → .footer-col-title (tag swap below)', /\.footer-col h4(\s*\{)/g, '.footer-col .footer-col-title$1', 43],
  ['.fact-box h4 selector → h3', /\.fact-box h4\{/g, '.fact-box h3{', 19],
];

for (const [desc, re, replacement, expected, fileRe] of SWEEPS) {
  let count = 0;
  for (const file of PAGES) {
    if (fileRe && !fileRe.test(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const matches = src.match(re);
    if (!matches) continue;
    count += matches.length;
    fs.writeFileSync(file, src.replace(re, replacement), 'utf8');
  }
  const ok = count === expected;
  if (!ok) failures++;
  totalEdits += count;
  console.log(`${ok ? '✓' : '✗'} ${desc}: ${count} (expected ${expected})`);
}

// ---- markup transforms ----

// Watermark step numerals → aria-hidden (only pages with the opacity-.25 def)
{
  const wmDef = /\.step-num \{[\s\S]*?opacity: 0\.25/;
  let count = 0;
  for (const file of PAGES) {
    let src = fs.readFileSync(file, 'utf8');
    if (!wmDef.test(src)) continue;
    const next = src.replace(/<div class="step-num">/g, () => { count++; return '<div class="step-num" aria-hidden="true">'; });
    if (next !== src) fs.writeFileSync(file, next, 'utf8');
  }
  const ok = count === 28;
  if (!ok) failures++;
  totalEdits += count;
  console.log(`${ok ? '✓' : '✗'} watermark step-num aria-hidden: ${count} (expected 28)`);
}

// Footer <h4> → <h2 class="footer-col-title"> (footer-scoped)
{
  let count = 0;
  for (const file of PAGES) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/<h4/.test(src)) continue;
    let out = '';
    let idx = 0;
    let changed = false;
    const re = /<footer[\s>][\s\S]*?<\/footer>/g;
    let m;
    while ((m = re.exec(src))) {
      out += src.slice(idx, m.index);
      let seg = m[0];
      const n = (seg.match(/<h4>/g) || []).length;
      if (n) {
        seg = seg.replace(/<h4>/g, '<h2 class="footer-col-title">').replace(/<\/h4>/g, '</h2>');
        count += n;
        changed = true;
      }
      out += seg;
      idx = m.index + m[0].length;
    }
    out += src.slice(idx);
    if (changed) fs.writeFileSync(file, out, 'utf8');
  }
  const ok = count === 119;
  if (!ok) failures++;
  totalEdits += count;
  console.log(`${ok ? '✓' : '✗'} footer h4 → h2.footer-col-title: ${count} (expected 119)`);
}

// Blog fact-box <h4> → <h3>
{
  let count = 0;
  for (const file of PAGES) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes('<div class="fact-box">')) continue;
    const next = src.replace(/(<div class="fact-box">\s*)<h4>([\s\S]*?)<\/h4>/g, (whole, pre, inner) => {
      count++;
      return `${pre}<h3>${inner}</h3>`;
    });
    if (next !== src) fs.writeFileSync(file, next, 'utf8');
  }
  const ok = count === 19;
  if (!ok) failures++;
  totalEdits += count;
  console.log(`${ok ? '✓' : '✗'} fact-box h4 → h3: ${count} (expected 19)`);
}

// ---- shared CSS assets ----
const CSS_EDITS = [
  ['assets/css/quick-lead-form.css', [
    ['.qlf-btn{width:100%;margin-top:4px;background:#e8720c;', `.qlf-btn{width:100%;margin-top:4px;background:${BAND};`],
    ['.qlf-btn:hover:not(:disabled){background:#c45e08}', `.qlf-btn:hover:not(:disabled){background:${HOVER}}`],
  ]],
  ['assets/css/blog-midpost-cta.css', [
    ['.blog-midpost-cta .bmc-btn-primary{background:var(--orange,#e8720c);color:#fff}', `.blog-midpost-cta .bmc-btn-primary{background:${BAND};color:#fff}`],
  ]],
  ['assets/css/mobile-cta.css', [
    ['.mobile-cta-strip .mobile-cta-call:active{background:#e8720c}', `.mobile-cta-strip .mobile-cta-call:active{background:${BAND}}`],
  ]],
];
for (const [rel, edits] of CSS_EDITS) {
  const p = path.join(DOCS, rel);
  let src = fs.readFileSync(p, 'utf8');
  for (const [old, next] of edits) {
    const n = src.split(old).length - 1;
    if (n !== 1) {
      console.log(`${n === 0 ? '·' : '✗'} ${rel}: "${old.slice(0, 48)}…" matched ${n} (expected 1${n === 0 ? ', already applied?' : ''})`);
      if (n > 1) failures++;
      continue;
    }
    src = src.split(old).join(next);
    totalEdits++;
    console.log(`✓ ${rel}: ${old.slice(0, 48)}…`);
  }
  fs.writeFileSync(p, src, 'utf8');
}

console.log(`\n${totalEdits} edits applied.`);
if (failures && totalEdits > 0) {
  console.warn(`${failures} sweep(s) hit an unexpected count — grep the targets before trusting this run.`);
}

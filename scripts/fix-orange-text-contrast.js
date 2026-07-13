#!/usr/bin/env node
/*
 * A11y contrast (Jul 2026 remediation follow-up): tiny ORANGE TEXT on light
 * backgrounds moves from brand orange #E8720C (3.07:1 on white, 2.77:1 on
 * off-white — AA fail at these sizes) to a darkened text-orange
 * #A64B00 — the lightest in-family shade that clears 4.5:1 on EVERY light
 * background in scope (5.79 white, 5.22 off-white #f5f3ef, 4.77/4.67 on the
 * rgba(232,114,12,.18/.20) tag-pill tints). The ann-bar/badge token #B85400
 * was tuned for white text ON orange; as text ON light tints it only reaches
 * ~3.9-4.0, so the text role gets its own darker value.
 *
 * In scope — verified light-background, sub-large-text (<18.66px bold):
 *   1. .section-label class defs         (~0.72rem labels on white sections)
 *   2. .post-tag class defs              (0.7rem pills, orange-tinted white bg)
 *   3. "View All 25+ Cities" area chips  (.82rem links on white pills)
 *   4. /review featured-section label + "Read … review(s) on Google" links
 *
 * Round 3 (2026-07-13, sitewide Lighthouse sweep) adds — every target's
 * enclosing background verified light before inclusion:
 *   5. .breadcrumb defs: var(--gray) #6b7280 is 4.36:1 on the breadcrumb's
 *      own off-white bar → #646c7a (4.78). Anchor color (navy) untouched.
 *   6. .btn-white text: orange-on-white button face — 1rem/0.9rem at 800
 *      weight is still sub-large, 3.07:1 (or 4.24 for the two
 *      var(--orange-dark) #c45e08 variants) → #A64B00 (5.79). The button
 *      face is its own white background, so this is context-independent.
 *   7. Templated .eyebrow def on the 146 area/city-service pages — all 643
 *      usages sit in off-white/white/bare-white sections (verified by
 *      enclosing-section scan; the parent-page .eyebrow variants are NOT
 *      touched — some sit on navy where #A64B00 would drop to 2.45:1).
 *   8. .ey / .project-tag (our-work), .layer .label (the-pledge) — white
 *      cards & sections.
 *   9. .related-card .rtag (19 blog + pro/blog pages, off-white cards),
 *      .hs-blog-item .tag (homepage off-white sidebar card), and the 12
 *      inline "Helpful Guides" card labels (white cards) — the .68rem
 *      uppercase label family.
 *  10. Inline bold orange body links — ONLY the 12 in verified white
 *      article/section contexts (about + 3 blog posts; the financing.html
 *      twin lives in a navy section and stays brand orange), plus the 7
 *      underlined variants in off-white service sections.
 *
 * Deliberately NOT touched:
 *   - Orange text on navy (#142a52) — 4.62:1, passes AA at these sizes
 *     (footer links, mobile menu, hero accents, .section-label-light,
 *     financing.html inline link, non-templated .eyebrow variants).
 *   - White-on-orange primary CTA buttons (.btn-primary, .nav-cta, form
 *     submits) — brand orange kept per Jo's recorded decision (see
 *     scripts/fix-tiny-badge-contrast.js header).
 *   - Hover-only states (transient).
 *
 * Idempotent: replacements no longer match once applied.
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.resolve(__dirname, '..', 'docs');
const NEW = '#A64B00';
const GRAY = '#646c7a'; // 4.78:1 on off-white #f5f3ef (vs 4.36 for #6b7280)

let totalEdits = 0;
let failures = 0;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.html') ? [p] : []);
  });
}
const PAGES = walk(DOCS);

// [description, regex (global), replacement, expected total matches across docs]
// Expected counts describe the original one-shot run; idempotent re-runs
// report 0s (warned, not failed).
const SWEEPS = [
  ['.section-label def color',
    /(\.section-label\s*\{[^}]*?)color:\s*var\(--orange\)/g, `$1color: ${NEW}`, 14],
  // Lookbehind keeps compound selectors out: .post-card.featured .post-tag
  // sits on the NAVY featured card, where brand orange is the readable
  // choice and darkening would be a regression.
  ['.post-tag def color (plain var, base selector only)',
    /((?<![ \w\]])\.post-tag\s*\{[^}]*?)color:\s*var\(--orange\)(?!,)/g, `$1color: ${NEW}`, 1],
  ['.post-tag def color (var with fallback, blog post pages)',
    /(\.post-tag\s*\{[^}]*?)color:var\(--orange,#e8720c\)/g, `$1color:${NEW}`, 6],
  ['area-chip "View All" links',
    /(background:white;border:1px solid #e8e5e0;border-radius:100px;padding:8px 16px;text-decoration:none;font-size:\.82rem;font-weight:600;)color:#e8720c/g,
    `$1color:${NEW}`, 12],
  ['/review featured-section label',
    /(letter-spacing:\.16em;text-transform:uppercase;)color:#e8720c(;margin-bottom:8px">Featured Reviews)/g,
    `$1color:${NEW}$2`, 1],
  ['/review "Read … on Google" links',
    /style="color:#e8720c(;font-weight:700;text-decoration:none">Read)/g,
    `style="color:${NEW}$1`, 4],
  // Round-2 context sweep (each verified on #f5f3ef / white backgrounds;
  // the visually similar eyebrows on .gtss/.nbd-system sit on navy and pass
  // at 4.62:1 — deliberately untouched):
  ['"Where I work / Serving your area" labels on off-white',
    /(font-size:\.7rem;font-weight:700;letter-spacing:\.15em;text-transform:uppercase;)color:#e8720c(;margin-bottom:8px;")/g,
    `$1color:${NEW}$2`, 3],
  ['blog-post area chips on white pills',
    /(padding:6px 14px;text-decoration:none;font-size:\.78rem;font-weight:600;)color:#e8720c/g,
    `$1color:${NEW}`, 2],
  // ---- Round 3 (2026-07-13) — see header block 5–10 for the audits ----
  // Optional 5th element: a file-path filter regex; sweeps without one run
  // repo-wide as before.
  // 156 single-line templated defs + 12 multi-line defs on the parent
  // service pages/about — all the same off-white bar (verified 2026-07-13).
  ['.breadcrumb def gray → #646c7a (off-white bar)',
    /(\.breadcrumb\s*\{[^}]*?)color:\s*var\(--gray\)/g, `$1color:${GRAY}`, 168],
  ['.btn-white text (compact !important variant)',
    /(\.btn-white\{[^}]*?)color:var\(--orange\)!important/g, `$1color:${NEW}!important`, 1],
  ['.btn-white text (var(--orange-dark) #c45e08 variant)',
    /(\.btn-white\{[^}]*?)color:var\(--orange-dark\)/g, `$1color:${NEW}`, 2],
  ['.btn-white text (spaced var(--orange) defs)',
    /(\.btn-white\s*\{[^}]*?)color:\s*var\(--orange\)(?!\s*!)/g, `$1color: ${NEW}`, 13],
  ['templated .eyebrow def (area + city-service pages)',
    /(\.eyebrow\{font-size:\.7rem;font-weight:700;letter-spacing:\.15em;text-transform:uppercase;)color:var\(--orange\)(;margin-bottom:8px\})/g,
    `$1color:${NEW}$2`, 146],
  ['.ey def (our-work)',
    /(\.ey\{font-size:\.7rem;font-weight:700;letter-spacing:\.15em;text-transform:uppercase;)color:var\(--orange\)(;margin-bottom:8px;display:inline-flex)/g,
    `$1color:${NEW}$2`, 1],
  ['.project-tag def (our-work, tint pill on white cards)',
    /(\.project-tag\{[^}]*?)color:var\(--orange\)/g, `$1color:${NEW}`, 1],
  // The featured (navy) layer card keeps brand orange via a
  // .layer.featured .label override added in the page — #A64B00 on navy
  // is 2.44:1 (caught by the post-fix Lighthouse verify pass).
  ['.layer .label def (the-pledge, white cards)',
    /(\.layer \.label\{[^}]*?)color:var\(--orange\)/g, `$1color:${NEW}`, 1],
  ['.related-card .rtag defs (blog + pro/blog, off-white cards)',
    /(\.related-card \.rtag\{[^}]*?)color:var\(--orange\)/g, `$1color:${NEW}`, 19],
  ['.hs-blog-item .tag def (homepage off-white sidebar)',
    /(\.hs-blog-item \.tag\{[^}]*?)color:var\(--orange\)/g, `$1color:${NEW}`, 1],
  ['inline "Helpful Guides" card labels (white cards)',
    /(font-size:\.68rem;font-weight:700;letter-spacing:\.1em;text-transform:uppercase;)color:var\(--orange\)(;margin-bottom:7px;")/g,
    `$1color:${NEW}$2`, 12],
  ['inline bold orange links (verified white contexts only)',
    /style="color:var\(--orange\);font-weight:700;"/g,
    `style="color:${NEW};font-weight:700;"`, 12,
    /(about\.html|blog[\/\\](the-pipe-boot-fork|why-i-install-lumanail-on-every-elite-roof|why-roofivent-is-on-my-roofs)\.html)$/],
  ['inline underlined orange links (off-white sections)',
    /style="color:var\(--orange\)(;font-weight:700;text-decoration:underline)/g,
    `style="color:${NEW}$1`, 7],
  // ---- Round 4 (2026-07-13) — post-fix Lighthouse verify pass findings ----
  // Dark-context counterpart token: brand orange on the navy article hero
  // is only 3.6-3.9:1 at tag size; #ffaf66 clears 4.5 on every navy-family
  // background in scope (6.1 on --navy, 7.8 on --navy-dark, 6.6 on the
  // orange-tinted pills over navy).
  ['.article-tag def (navy article hero) → #ffaf66',
    /(\.article-tag\{[^}]*?)color:var\(--orange\)/g, '$1color:#ffaf66', 22],
  ['.fact-box h4 (off-white fact boxes)',
    /(\.fact-box h4\{[^}]*?)color:var\(--orange\)/g, `$1color:${NEW}`, 19],
  // White-alpha bumps on navy: rgba(255,255,255,.4) is ~3.5:1 on the
  // footer band; .65 lands ~6.8.
  ['.footer-bottom p white-alpha .4 → .65',
    /(\.footer-bottom p\{font-size:\.75rem;)color:rgba\(255,255,255,\.4\)/g,
    '$1color:rgba(255,255,255,.65)', 19],
  ['.footer-badge white-alpha .5 variant → .7 (matches sibling defs)',
    /(\.footer-badge\{background:rgba\(255,255,255,\.06\);[^}]*?)color:rgba\(255,255,255,\.5\)/g,
    '$1color:rgba(255,255,255,.7)', 3],
  ['GAF-ID legal line white-alpha .32 → .62 (matches /review treatment)',
    /(font-size:\.62rem;)color:rgba\(255,255,255,\.32\)/g,
    '$1color:rgba(255,255,255,.62)', 2],
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

console.log(`\n${totalEdits} edits applied.`);
if (failures && totalEdits > 0) {
  console.warn(`${failures} sweep(s) hit an unexpected count — grep the targets before trusting this run.`);
}

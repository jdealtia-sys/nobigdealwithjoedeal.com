#!/usr/bin/env node
/*
 * Follow-up 2026-07 (#1): remove every inline event-handler attribute from the
 * public pages. The site-wide CSP (script-src-attr 'none') blocks them all, so
 * none of these ever fired in production:
 *
 *  - 9 onmouseover/onmouseout hover-effect pairs (index.html x7, about.html x1,
 *    services/roof-replacement.html x1) -> replaced with CSS :hover rules
 *    (!important, because the base styles they override are inline styles).
 *  - 13 onclick handlers in sites/oaks.html (mobile menu toggle, menu-link
 *    auto-close, banner close — genuinely broken UI) -> externalized to
 *    /sites/js/oaks-nav.js with addEventListener (H-1 pattern).
 *
 * Idempotent: patterns no longer match once applied.
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.resolve(__dirname, '..', 'docs');

function edit(rel, fns) {
  const file = path.join(DOCS, rel);
  const orig = fs.readFileSync(file, 'utf8');
  let next = orig;
  for (const [desc, fn] of fns) {
    const before = next;
    next = fn(next);
    console.log(`  ${before === next ? '-' : '✓'} ${rel}: ${desc}`);
  }
  if (next !== orig) fs.writeFileSync(file, next);
}

const HOVER_CSS = {
  'index.html': `
/* CSP-safe replacements for former inline hover handlers (script-src-attr 'none' blocks onmouseover=) */
.hero-link-secondary:hover{color:var(--orange)!important}
.ql-pledge:hover{background:#ffe8d6!important}
.ql-tamko:hover{background:#fff4ee!important;border-color:#e8720c!important}
.ql-guarantee:hover{background:#e8720c!important;color:#fff!important}
.partner-logo-img:hover{filter:none!important;opacity:1!important}
`,
  'about.html': `
/* CSP-safe replacement for former inline hover handlers */
.gaf-badge-float:hover{transform:scale(1.05)!important}
`,
  'services/roof-replacement.html': `
/* CSP-safe replacement for former inline hover handlers */
.gaf-verify-link:hover{transform:translateY(-2px)!important}
`,
};

// index.html
edit('index.html', [
  ['hero-link-secondary handlers -> CSS', (s) =>
    s.replace(/ onmouseover="this\.style\.color='var\(--orange\)'" onmouseout="this\.style\.color='rgba\(255,255,255,\.82\)'"/, '')],
  ['pledge quick-link handlers -> class', (s) =>
    s.replace(/onmouseover="this\.style\.background='#ffe8d6'" onmouseout="this\.style\.background='#fff4ee'"/, 'class="ql-pledge"')],
  ['tamko quick-link handlers -> class', (s) =>
    s.replace(/onmouseover="this\.style\.background='#fff4ee';this\.style\.borderColor='#e8720c'" onmouseout="this\.style\.background='#fbfaf8';this\.style\.borderColor='#d8b48a'"/, 'class="ql-tamko"')],
  ['guarantee quick-link handlers -> class', (s) =>
    s.replace(/onmouseover="this\.style\.background='#e8720c';this\.style\.color='#fff'" onmouseout="this\.style\.background='#fff4ee';this\.style\.color='#c45e08'"/, 'class="ql-guarantee"')],
  ['3 partner-logo handlers -> class', (s) =>
    s.replace(/onmouseover="this\.style\.filter='none';this\.style\.opacity='1'" onmouseout="this\.style\.filter='grayscale\(100%\) brightness\(\.55\)';this\.style\.opacity='\.85'"/g, 'class="partner-logo-img"')],
  ['inject hover CSS', (s) =>
    s.includes('.ql-pledge:hover') ? s : s.replace('</head>', `<style>${HOVER_CSS['index.html']}</style>\n</head>`)],
]);

// about.html
edit('about.html', [
  ['GAF badge handlers -> class', (s) =>
    s.replace(/onmouseover="this\.style\.transform='scale\(1\.05\)'" onmouseout="this\.style\.transform='scale\(1\)'"/, 'class="gaf-badge-float"')],
  ['inject hover CSS', (s) =>
    s.includes('.gaf-badge-float:hover') ? s : s.replace('</head>', `<style>${HOVER_CSS['about.html']}</style>\n</head>`)],
]);

// services/roof-replacement.html
edit('services/roof-replacement.html', [
  ['GAF verify-link handlers -> class', (s) =>
    s.replace(/onmouseover="this\.style\.transform='translateY\(-2px\)'" onmouseout="this\.style\.transform='translateY\(0\)'"/, 'class="gaf-verify-link"')],
  ['inject hover CSS', (s) =>
    s.includes('.gaf-verify-link:hover') ? s : s.replace('</head>', `<style>${HOVER_CSS['services/roof-replacement.html']}</style>\n</head>`)],
]);

// sites/oaks.html — externalize the 13 onclick handlers
edit('sites/oaks.html', [
  ['banner-close onclick', (s) =>
    s.replace(/ onclick="document\.getElementById\('topBanner'\)\.style\.display='none'"/, '')],
  ['nav-toggle onclick', (s) =>
    s.replace(/ onclick="document\.getElementById\('mobileMenu'\)\.classList\.toggle\('open'\)"/, '')],
  ['11 menu-link onclicks', (s) =>
    s.replace(/ onclick="this\.parentElement\.classList\.remove\('open'\)"/g, '')],
  ['load /sites/js/oaks-nav.js', (s) =>
    s.includes('oaks-nav.js') ? s : s.replace('</body>', '<script defer src="/sites/js/oaks-nav.js"></script>\n</body>')],
]);

console.log('done');

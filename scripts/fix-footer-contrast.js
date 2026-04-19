#!/usr/bin/env node
/*
 * Footer text contrast fix:
 *  - .label spans in the contact column use rgba(255,255,255,.4) which is
 *    nearly invisible on navy-dark. Bump to .72.
 *  - .footer-col ul li a use .65; bump to .8 so the whole column reads clearly.
 *  - "More Guides" / "NBD Pro ↗" / copyright rows use .4 or .5 — bump to .72.
 *  - Also strip the inline ⚡ / 🌩️ emojis in footer-col links and replace with
 *    subtle orange accent (swap to orange-light color without icon).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

const FOOTER_CSS = `
/* footer contrast fix (injected) */
footer .label{color:rgba(255,255,255,.72)!important;font-weight:700}
footer .footer-col ul li a{color:rgba(255,255,255,.82)!important}
footer .footer-col ul li a:hover{color:var(--orange,#e8720c)!important}
footer .footer-contact-item .val,footer .footer-contact-item .val a{color:rgba(255,255,255,.9)!important}
footer p{color:rgba(255,255,255,.7)!important}
footer .footer-desc{color:rgba(255,255,255,.72)!important}
footer .footer-bottom p{color:rgba(255,255,255,.55)!important}
footer .footer-bottom a{color:rgba(255,255,255,.65)!important}
footer .footer-bottom a:hover{color:var(--orange,#e8720c)!important}
footer .pro-door{color:rgba(255,255,255,.65)!important}
footer .pro-door:hover{color:var(--orange,#e8720c)!important}
`;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['admin', 'pro', 'sites', 'assets', 'deploy', 'free-guide', 'tools'].includes(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

let touched = 0;
for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  let next = orig;
  if (!/footer contrast fix \(injected\)/.test(next) && /<\/head>/.test(next) && /<footer/.test(next)) {
    next = next.replace(/<\/head>/, '<style>' + FOOTER_CSS + '</style>\n</head>');
  }
  // Strip lingering emojis from footer-col service/utility links
  next = next.replace(/(<a[^>]*href="\/estimate"[^>]*>)\s*Instant Estimate\s*[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]+\s*(<\/a>)/gu, '$1Instant Estimate$2');
  next = next.replace(/(<a[^>]*href="\/storm-alerts"[^>]*>)\s*Storm Alerts\s*[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]+\s*(<\/a>)/gu, '$1Storm Alerts$2');
  next = next.replace(/(<a[^>]*href="\/visualizer"[^>]*>)\s*AI Visualizer\s*[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]+\s*(<\/a>)/gu, '$1AI Visualizer$2');
  if (next !== orig) { fs.writeFileSync(file, next); touched++; }
}
console.log(JSON.stringify({ touched }, null, 2));

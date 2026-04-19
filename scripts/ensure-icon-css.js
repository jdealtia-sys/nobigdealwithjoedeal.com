#!/usr/bin/env node
/*
 * Ensure every page that contains `<svg class="nav-ico">` or `<svg class="ico">`
 * ALSO has the CSS rules that size them. Without the CSS, inline SVGs default
 * to huge native dimensions and blow the nav off screen.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

const NAV_ICO_CSS = `
/* nav-ico sizing (injected) */
.nav-links .nav-ico{width:14px;height:14px;stroke:currentColor;stroke-width:2.2;fill:none;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;display:inline-block;vertical-align:-0.18em}
.nav-links > li > a{display:inline-flex;align-items:center;gap:5px}
.nav-links > li > a.nav-instant{color:var(--orange-light,#f08030)!important}
.mobile-nav .mnav-group{font-size:.65rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--orange-light,#f08030);padding:14px 24px 6px;opacity:.75;border-bottom:none!important}
`;

const ICO_CSS = `
/* ico sizing (injected) */
.ico{width:1em;height:1em;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;display:inline-block;vertical-align:-0.14em}
.ico-fill{fill:currentColor;stroke:none}
.trust-icon svg.ico,.aci-icon svg.ico,.cm-icon svg.ico{width:24px;height:24px}
.wc-phone-icon svg.ico{width:26px;height:26px}
.trust-icon svg.ico{color:#fff}
.aci-icon svg.ico,.cm-icon svg.ico,.wc-phone-icon svg.ico,.form-success-icon svg.ico{color:var(--orange,#e8720c)}
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
  let inject = '';
  if (/<svg class="nav-ico"/.test(next) && !/nav-ico sizing \(injected\)/.test(next)) {
    inject += NAV_ICO_CSS;
  }
  if (/<svg class="ico[ "]/.test(next) && !/ico sizing \(injected\)/.test(next)) {
    inject += ICO_CSS;
  }
  if (inject && /<\/head>/.test(next)) {
    next = next.replace(/<\/head>/, '<style>' + inject + '</style>\n</head>');
  }
  if (next !== orig) { fs.writeFileSync(file, next); touched++; }
}
console.log(JSON.stringify({ touched }, null, 2));

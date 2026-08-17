#!/usr/bin/env node
/*
 * Fix: trust-icon, cm-icon and wc-phone-icon containers have a solid orange
 * background, so orange-stroked icons render invisible. Strip the inline orange
 * style and inject CSS that forces icon color white on those containers, orange
 * on the light/navy-chip ones. Keep EXTRA_CSS in sync with
 * docs/assets/css/nbd-icons.css — that sheet links at the end of <head> and
 * wins the cascade over this injected block.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

const EXTRA_CSS = `
/* trust-icon fix */
.trust-icon svg.ico,.cm-icon svg.ico,.wc-phone-icon svg.ico{color:#fff}
.aci-icon svg.ico,.form-success-icon svg.ico{color:var(--orange,#e8720c)}
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
  // Strip the inline color:var(--orange) added to trust-icon during the earlier swap.
  next = next.replace(/(<div class="trust-icon")\s+style="color:var\(--orange[^"]*"/g, '$1');
  // Inject the extra CSS once per file (only when the file has any svg.ico).
  if (/<svg class="ico/.test(next) && !/trust-icon fix/.test(next)) {
    next = next.replace(/<\/head>/, '<style>' + EXTRA_CSS + '</style>\n</head>');
  }
  if (next !== orig) {
    fs.writeFileSync(file, next);
    touched++;
  }
}
console.log(JSON.stringify({ touched }, null, 2));

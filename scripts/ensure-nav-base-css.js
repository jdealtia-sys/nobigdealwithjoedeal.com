#!/usr/bin/env node
/*
 * Many pages still render with the dropdown permanently open and the mobile-nav
 * showing on desktop because their original CSS never had `.dropdown-menu {display:none}`
 * or `.mobile-nav {display:none}` defaults — those assumptions lived in inline markup
 * that my unify-nav.js replaced.
 *
 * Inject the missing base rules universally (scoped so we don't disturb pages that
 * already have them).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

const NAV_BASE_CSS = `
/* nav base (injected) */
.nav-links .dropdown{position:relative}
.nav-links .dropdown-menu{display:none;position:absolute;top:100%;left:0;background:var(--navy-dark,#142a52);border:2px solid var(--orange,#e8720c);border-top:none;min-width:230px;border-radius:0 0 8px 8px;padding:8px 0;z-index:999;list-style:none;margin:0}
.nav-links .dropdown:hover .dropdown-menu{display:block}
.nav-links .dropdown-menu a{display:block;padding:10px 18px;font-size:.75rem;border-bottom:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.85);text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-weight:600;transition:color .2s,background .2s}
.nav-links .dropdown-menu a:last-child{border-bottom:none}
.nav-links .dropdown-menu a:hover{color:var(--orange-light,#f08030);background:rgba(255,255,255,.04);border-bottom-color:rgba(255,255,255,.08)}
.mobile-nav{display:none;position:fixed;top:70px;left:0;right:0;background:var(--navy-dark,#142a52);z-index:999;border-top:2px solid var(--orange,#e8720c);max-height:calc(100vh - 70px);overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);padding-top:0}
.mobile-nav.open{display:block}
.mobile-nav > a{display:block;padding:12px 24px;color:rgba(255,255,255,.85);text-decoration:none;font-size:.82rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06)}
.mobile-nav > a:hover{color:var(--orange-light,#f08030);background:rgba(255,255,255,.04)}
.hamburger{display:none;flex-direction:column;gap:5px;cursor:pointer;padding:8px;background:transparent;border:none}
.hamburger span{display:block;width:24px;height:2.5px;background:#fff;border-radius:2px}
@media (max-width:900px){
  .nav-links{display:none}
  .hamburger{display:flex}
}
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
  if (!/<nav id="mainNav"/.test(orig)) continue;
  if (/nav base \(injected\)/.test(orig)) continue;
  if (!/<\/head>/.test(orig)) continue;
  const next = orig.replace(/<\/head>/, '<style>' + NAV_BASE_CSS + '</style>\n</head>');
  fs.writeFileSync(file, next);
  touched++;
}
console.log(JSON.stringify({ touched }, null, 2));

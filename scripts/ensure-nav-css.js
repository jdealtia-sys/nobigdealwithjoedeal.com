#!/usr/bin/env node
/*
 * Ensure every page that renders the shared header nav (any dropdown-menu,
 * mobile-nav or hamburger markup) also carries the "nav base (injected)"
 * <style> block that makes it work. Without the block the Services dropdown
 * renders as a permanently-expanded unstyled bullet list splattered over the
 * page header, the hamburger never hides, and the <=1024px nav collapse never
 * fires. 2026-08-17: live on /the-pledge, /areas/ and 9 blog posts — see
 * documentation/audit/ICON-CASCADE-REGRESSION-2026-08-17.md.
 *
 * The block predates this script and had no generator: 177 pages carry one
 * byte-identical copy (CANONICAL_BLOCK below is that copy) and one page (the
 * field-notes blog post) carries a deliberate variant. So the contract is
 * PRESENCE, not content: pages that already have ANY nav-base block are left
 * untouched. Default run is assert-only (exit 1 listing offenders —
 * CI-wireable); --write inserts the canonical block before </head> on pages
 * missing it, matching each file's line-ending style.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const WRITE = process.argv.includes('--write');

const MARKER = '/* nav base (injected) */';
const NAV_MARKUP_RE = /class="(?:dropdown-menu|mobile-nav|hamburger)[ "]/;

const CANONICAL_BLOCK = `<style>
${MARKER}
.nav-links .dropdown{position:relative}
.nav-links .dropdown-menu{display:none;position:absolute;top:100%;left:0;background:var(--navy-dark,#142a52);border:2px solid var(--orange,#e8720c);border-top:none;min-width:230px;border-radius:0 0 8px 8px;padding:8px 0;z-index:999;list-style:none;margin:0}
.nav-links .dropdown:hover .dropdown-menu,.nav-links .dropdown:focus-within .dropdown-menu,.nav-links .dropdown.open .dropdown-menu{display:block}
.nav-links .dropdown-menu a{display:block;padding:10px 18px;font-size:.75rem;border-bottom:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.85);text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-weight:600;transition:color .2s,background .2s}
.nav-links .dropdown-menu a:last-child{border-bottom:none}
.nav-links .dropdown-menu a:hover{color:var(--orange-light,#f08030);background:rgba(255,255,255,.04);border-bottom-color:rgba(255,255,255,.08)}
.mobile-nav{display:none;position:fixed;top:70px;left:0;right:0;background:var(--navy-dark,#142a52);z-index:999;border-top:2px solid var(--orange,#e8720c);max-height:calc(100vh - 70px);overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);padding-top:0}
.mobile-nav.open{display:block}
.mobile-nav > a{display:block;padding:12px 24px;color:rgba(255,255,255,.85);text-decoration:none;font-size:.82rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06)}
.mobile-nav > a:hover{color:var(--orange-light,#f08030);background:rgba(255,255,255,.04)}
.hamburger{display:none;flex-direction:column;gap:6px;cursor:pointer;padding:10px;background:transparent;border:none;z-index:1001}
.hamburger span{display:block;width:26px;height:3px;background:#fff;border-radius:2px;transition:all .3s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
@media (max-width:1024px){.nav-links{display:none}.hamburger{display:flex}}
</style>`;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 2026-08-19: this list still carried the exact stale entries that
      // ensure-icon-css.js was widened out of one day earlier — including a
      // dead 'free-guide' (that page moved under docs/sites/ in 6e499a38), so
      // docs/sites/** was never walked. 'pro' stays excluded on purpose:
      // unlike ensure-icon-css this script INJECTS marketing nav-base CSS, and
      // the CRM runs its own nav systems.
      if (['admin', 'pro', 'assets', 'deploy', 'tools'].includes(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

let fixed = 0;
const offenders = [];
for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  if (!NAV_MARKUP_RE.test(orig)) continue;
  if (orig.includes(MARKER)) continue;
  // Satisfied by the page's own CSS rather than the injected block:
  // dropdown hidden at rest AND a nav-collapse breakpoint. docs/sites/
  // free-guide meets the contract this way (its own design system).
  if (/\.dropdown-menu\s*\{[^}]*display:\s*none/.test(orig)
      && /@media[^{]*max-width:\s*(?:768|900|1024)px/.test(orig)) continue;

  if (!WRITE) {
    offenders.push(path.relative(ROOT, file));
    continue;
  }

  if (!/<\/head>/.test(orig)) {
    offenders.push(path.relative(ROOT, file) + ' [no </head> — fix by hand]');
    continue;
  }
  const eol = orig.includes('\r\n') ? '\r\n' : '\n';
  const block = CANONICAL_BLOCK.split('\n').join(eol);
  fs.writeFileSync(file, orig.replace(/<\/head>/, block + eol + '</head>'));
  fixed++;
}

if (offenders.length) {
  console.error('ensure-nav-css: ' + offenders.length + ' page(s) with nav markup but no nav-base CSS:');
  for (const o of offenders.slice(0, 20)) console.error('  - ' + o);
  if (!WRITE) console.error('Run: node scripts/ensure-nav-css.js --write');
  process.exit(1);
}
console.log(JSON.stringify(WRITE ? { fixed } : { clean: true }, null, 2));

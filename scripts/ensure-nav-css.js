#!/usr/bin/env node
/*
 * Ensure every page that renders the shared header nav (any dropdown-menu,
 * mobile-nav or hamburger markup) also gets the dropdown/mobile-nav/
 * hamburger SHOW-HIDE CSS that makes it work. Without it the Services
 * dropdown renders as a permanently-expanded unstyled bullet list splattered
 * over the page header, the hamburger never hides, and the <=1024px nav
 * collapse never fires. 2026-08-17: live on /the-pledge, /areas/ and 9 blog
 * posts — see documentation/audit/ICON-CASCADE-REGRESSION-2026-08-17.md.
 *
 * 2026-09-17: the rules moved from a per-page injected <style> block (the
 * "nav base (injected)" marker; 269 byte-identical copies, ~513 KB
 * duplicated — WEEKLY_CADENCE.md backlog item 10) to the shared stylesheet
 * docs/assets/css/nbd-nav-base.css, mirroring ensure-icon-css.js's
 * inject-to-link migration. The contract is now satisfied by ANY of:
 *   (a) the <link> to the shared stylesheet,
 *   (b) presence of the "nav base (injected)" marker at all — one blog post
 *       (field-notes) carries a deliberate hand-authored variant with
 *       different CSS under the same marker; presence of the mechanism is
 *       the contract, not this exact text, so it is never touched or flagged,
 *   (c) a page's own hand-rolled nav-base CSS (the escape hatch below).
 * Default run is assert-only (exit 1 listing offenders — CI-wireable);
 * --write migrates a byte-exact legacy block to the link and inserts the
 * link on a page satisfying none of (a)/(b)/(c).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const WRITE = process.argv.includes('--write');

const MARKER = '/* nav base (injected) */';
const LINK_HREF = '/assets/css/nbd-nav-base.css';
const LINK_TAG = `<link rel="stylesheet" href="${LINK_HREF}">`;
const NAV_MARKUP_RE = /class="(?:dropdown-menu|mobile-nav|hamburger)[ "]/;

// Must stay byte-identical to docs/assets/css/nbd-nav-base.css's body (minus
// its own file-header comment) — this is what --write matches to migrate a
// legacy inline block. Not derived from the CSS file at runtime so this
// script has no read dependency on it beyond the docs it links to.
const CANONICAL_BODY = `.nav-links .dropdown{position:relative}
.nav-links .dropdown-menu{display:none;position:absolute;top:100%;left:0;background:var(--navy-dark,#12223d);border:2px solid var(--orange,#bd5728);border-top:none;min-width:230px;border-radius:0 0 8px 8px;padding:8px 0;z-index:999;list-style:none;margin:0}
.nav-links .dropdown:hover .dropdown-menu,.nav-links .dropdown:focus-within .dropdown-menu,.nav-links .dropdown.open .dropdown-menu{display:block}
.nav-links .dropdown-menu a{display:block;padding:10px 18px;font-size:.75rem;border-bottom:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.85);text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-weight:600;transition:color .2s,background .2s}
.nav-links .dropdown-menu a:last-child{border-bottom:none}
.nav-links .dropdown-menu a:hover{color:var(--orange-light,#dd875f);background:rgba(255,255,255,.04);border-bottom-color:rgba(255,255,255,.08)}
.mobile-nav{display:none;position:fixed;top:70px;left:0;right:0;background:var(--navy-dark,#12223d);z-index:999;border-top:2px solid var(--orange,#bd5728);max-height:calc(100vh - 70px);overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);padding-top:0}
.mobile-nav.open{display:block}
.mobile-nav > a{display:block;padding:12px 24px;color:rgba(255,255,255,.85);text-decoration:none;font-size:.82rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06)}
.mobile-nav > a:hover{color:var(--orange-light,#dd875f);background:rgba(255,255,255,.04)}
.hamburger{display:none;flex-direction:column;gap:6px;cursor:pointer;padding:10px;background:transparent;border:none;z-index:1001}
.hamburger span{display:block;width:26px;height:3px;background:#fff;border-radius:2px;transition:all .3s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
@media (max-width:1024px){.nav-links{display:none}.hamburger{display:flex}}`;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 'pro' stays excluded on purpose: unlike ensure-icon-css this script
      // is about marketing-site nav chrome — the CRM runs its own nav systems.
      if (['admin', 'pro', 'assets', 'deploy', 'tools'].includes(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

// Matches the exact legacy <style> tag (marker + canonical body, byte-exact
// modulo the file's own EOL style) for migration to the shared stylesheet.
// A page whose block carries the marker but DIFFERENT content (the
// field-notes variant) does not match and is left untouched.
function exactBlockRegex(eol) {
  const body = eol === '\n' ? CANONICAL_BODY : CANONICAL_BODY.split('\n').join(eol);
  const raw = '<style>' + eol + MARKER + eol + body + eol + '</style>';
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('[ \\t]*' + escaped + '\\r?\\n?');
}

let fixed = 0;
const offenders = [];
for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  if (!NAV_MARKUP_RE.test(orig)) continue;

  const hasLink = orig.includes(LINK_HREF);
  const hasMarker = orig.includes(MARKER);
  // Satisfied by the page's own CSS rather than any injected mechanism:
  // dropdown hidden at rest AND a nav-collapse breakpoint. docs/sites/
  // free-guide meets the contract this way (its own design system).
  const ownCssEscapeHatch = /\.dropdown-menu\s*\{[^}]*display:\s*none/.test(orig)
      && /@media[^{]*max-width:\s*(?:768|900|1024)px/.test(orig);

  if (!WRITE) {
    if (!(hasLink || hasMarker || ownCssEscapeHatch)) offenders.push(path.relative(ROOT, file));
    continue;
  }

  const eol = orig.includes('\r\n') ? '\r\n' : '\n';
  const exactRe = exactBlockRegex(eol);
  let next = orig;

  if (exactRe.test(orig)) {
    next = next.replace(exactRe, '');
  } else if (hasLink || hasMarker || ownCssEscapeHatch) {
    continue; // already satisfied by an existing mechanism — nothing to do
  }

  if (!next.includes(LINK_HREF)) {
    if (!/<\/head>/.test(next)) {
      offenders.push(path.relative(ROOT, file) + ' [no </head> — fix by hand]');
      continue;
    }
    next = next.replace(/<\/head>/, LINK_TAG + eol + '</head>');
  }
  if (next !== orig) { fs.writeFileSync(file, next); fixed++; }
}

if (offenders.length) {
  console.error('ensure-nav-css: ' + offenders.length + ' page(s) with nav markup but no nav-base mechanism:');
  for (const o of offenders.slice(0, 20)) console.error('  - ' + o);
  if (!WRITE) console.error('Run: node scripts/ensure-nav-css.js --write');
  process.exit(1);
}
console.log(JSON.stringify(WRITE ? { fixed } : { clean: true }, null, 2));

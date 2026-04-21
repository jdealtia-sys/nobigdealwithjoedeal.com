#!/usr/bin/env node
/**
 * Phase C: sitewide readability pass.
 *  - Inject a typography override (16px body floor, card+footer copy, capped
 *    h1/h2/h3 on non-hero elements, nav breathing room at 1281px+).
 *  - Append a Privacy Policy link to the copyright line in every footer
 *    variant (full `.footer-bottom`, slim `footer.foot`, `.review-footer`).
 *
 * Idempotent: marker comment prevents double-injection.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const SKIP_DIRS = new Set(['admin', 'pro', 'sites', 'assets', 'deploy', 'tools']);

const TYPO_MARKER = '/* nbd-readability-v1 */';
const TYPO_CSS = `<style>
${TYPO_MARKER}
/* Root + body floor: 16px + generous line-height */
html{font-size:16px}
body{font-size:1rem;line-height:1.65;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}

/* Body copy — override per-page shrinks on main content */
main p,section p,article p,.sec-desc,.hiw-body{font-size:1rem!important;line-height:1.7!important}
.sc-body{font-size:.97rem!important;line-height:1.65!important;color:#4b5563!important}

/* Non-hero heading caps — keep hero h1s untouched */
main h2,section h2,article h2{font-size:clamp(1.8rem,3vw,2.6rem)!important;line-height:1.1!important}
main h3,section h3,article h3{font-size:clamp(1.05rem,1.35vw,1.3rem)!important;line-height:1.3!important}

/* Footer readability + contrast */
footer .footer-desc,footer .footer-links a,footer .footer-col ul li a,footer p,footer li{font-size:.92rem!important;line-height:1.65!important}
footer .footer-desc{color:rgba(255,255,255,.82)!important}
footer .footer-col-title,footer h4,footer .label{font-size:.72rem!important;letter-spacing:.14em!important;text-transform:uppercase!important;color:rgba(255,255,255,.95)!important;font-weight:800!important;margin-bottom:14px!important}
footer .footer-bottom,footer .footer-bottom p,footer .footer-bottom a,footer .pro-door{font-size:.82rem!important;line-height:1.6!important}
footer .footer-bottom a{color:rgba(255,255,255,.7)!important}
footer .footer-bottom a:hover{color:#e8720c!important}
footer.foot,.review-footer{font-size:.9rem!important;padding:24px 5%!important;line-height:1.6!important}
footer.foot a,.review-footer a{color:#e8720c!important}

/* Announcement bar legibility floor */
.ann-bar{font-size:.8rem!important;letter-spacing:.04em!important}
@media(max-width:640px){.ann-bar{font-size:.72rem!important;padding:10px 14px!important;min-height:40px!important}}

/* Nav breathing room at desktop widths */
@media(min-width:1281px){
  nav{padding-left:40px!important;padding-right:40px!important}
  nav .nav-logo{margin-right:28px!important}
  nav .nav-links{gap:22px!important}
  nav .nav-links > li > a{font-size:.78rem!important;letter-spacing:.07em!important}
}
@media(min-width:1440px){
  nav{padding-left:56px!important;padding-right:56px!important}
  nav .nav-links{gap:28px!important}
}
</style>`;

const PRIVACY_LINK_MARKER = 'data-nbd-privacy="1"';
const PRIVACY_FULL = ` <span style="opacity:.4">·</span> <a href="/privacy" ${PRIVACY_LINK_MARKER} style="color:inherit;text-decoration:none">Privacy</a>`;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function injectTypography(html) {
  if (html.includes(TYPO_MARKER)) return { html, changed: false };
  const idx = html.lastIndexOf('</head>');
  if (idx < 0) return { html, changed: false };
  return {
    html: html.slice(0, idx) + TYPO_CSS + '\n' + html.slice(idx),
    changed: true,
  };
}

/**
 * Append Privacy link to the copyright fragment(s). Matches both HTML-encoded
 * (&copy;) and literal (©) forms. Skips files that already carry the marker.
 */
function injectPrivacyLink(html) {
  if (html.includes(PRIVACY_LINK_MARKER)) return { html, changed: false };
  // Find the copyright text node and append before the closing tag on the
  // same line or element. Target patterns observed across the site:
  //   "© 2026 No Big Deal Home Solutions. All rights reserved."
  //   "&copy; 2026 No Big Deal Home Solutions &middot; ..."
  //   "&copy; 2026 No Big Deal Home Solutions — Goshen, OH"
  // Match the copyright span up to the next tag boundary. Both encoded
  // (&copy;) and literal (©) forms appear across the site, and some
  // variants omit the "All rights reserved" suffix entirely.
  const patterns = [
    /(©\s*20\d{2}[^<]*All rights reserved\.)/,
    /(&copy;\s*20\d{2} No Big Deal Home Solutions[^<]*)/,
    /(©\s*20\d{2} No Big Deal Home Solutions[^<]*)/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      return { html: html.replace(re, `$1${PRIVACY_FULL}`), changed: true };
    }
  }
  return { html, changed: false };
}

const stats = { scanned: 0, typoInjected: 0, privacyAdded: 0, untouched: 0 };
const samples = { typo: [], privacy: [], noPrivacy: [] };

for (const file of walk(ROOT)) {
  stats.scanned++;
  const rel = path.relative(ROOT, file);
  let html = fs.readFileSync(file, 'utf8');
  let changed = false;

  const t = injectTypography(html);
  if (t.changed) {
    html = t.html;
    changed = true;
    stats.typoInjected++;
    if (samples.typo.length < 3) samples.typo.push(rel);
  }

  const p = injectPrivacyLink(html);
  if (p.changed) {
    html = p.html;
    changed = true;
    stats.privacyAdded++;
    if (samples.privacy.length < 3) samples.privacy.push(rel);
  } else if (!html.includes(PRIVACY_LINK_MARKER) && samples.noPrivacy.length < 5) {
    samples.noPrivacy.push(rel);
  }

  if (changed) fs.writeFileSync(file, html);
  else stats.untouched++;
}

console.log(JSON.stringify({ stats, samples }, null, 2));

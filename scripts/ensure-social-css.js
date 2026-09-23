/**
 * ensure-social-css.js — keeps the `nbd-social-v1` footer social strip a
 * LINKED stylesheet instead of an inline <style> repeated on every page.
 * ═══════════════════════════════════════════════════════════════
 *
 * WHY (2026-09-23, inline-CSS dedup slice 5)
 *
 * The block was byte-identical inline CSS on 198 public pages, 907 B each —
 * ~178 KB of HTML to say one thing. 192 migrated (see the exclusions below).
 *
 * MODES
 *   (default) assert. Exits 1 if a page still carries the inline canonical
 *     copy, carries BOTH the link and the marker, or carries more than one
 *     copy. This is the CI gate.
 *   --write   migrates each byte-exact inline copy to the link IN PLACE.
 *
 * "IN PLACE" IS LOAD-BEARING — do not hoist the link.
 * `nbd-mobile.css` also styles this component (`footer .nbd-social a`), so
 * the two sheets share a selector surface. That one happens to win on
 * specificity whatever the order, but the discipline stands: slice 3b (#1674)
 * moved a link to the end of <head> as a control and changed computed styles
 * on 39 of 70 page@width combos. The regex below matches the <style>…</style>
 * span ONLY, so the link lands exactly where the block was.
 *
 * THIS BLOCK *DOES* HAVE A GENERATOR, unlike slice 4's.
 * `scripts/add-social-footer-strip.js` injects it into new pages, and it
 * guarded on the MARKER — which stops working the moment the marker becomes a
 * link, so it would have re-inlined the block into all 192 migrated pages on
 * its next run. It now skips the link too. Same trap fix-trust-icons.js
 * (#1671) and injectTypography (#1674) hit after their blocks were extracted.
 *
 * WHAT IS DELIBERATELY NOT MIGRATED (all byte-identical to how they were):
 *   - 23 blog pages carry the block inside `<style id="nbd-chrome-std">`,
 *     behind ~4.3 KB of other chrome CSS — a fragment, not a swappable
 *     element.
 *   - 2 pages append `.footer-badges` rules to the same block.
 *   - 5 pages listed in EXCLUDED_PAGES carry the CSS TWICE; see that comment.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const CSS_FILE = path.join(ROOT, 'assets', 'css', 'nbd-social.css');

const MARKER = '/* nbd-social-v1 */';
const LINK_HREF = '/assets/css/nbd-social.css';
const LINK_TAG = `<link rel="stylesheet" href="${LINK_HREF}">`;
// Same exclusions as ensure-readability-css.js. 'sites' matters here: one
// page carrying the block (sites/free-guide/index.html) lives under it and
// keeps its inline copy deliberately, as index.html did for readability.
const EXCLUDED_TOP = new Set(['admin', 'pro', 'sites', 'assets', 'deploy', 'tools']);


// Five blog pages carry the social CSS TWICE: once standalone (which this
// script would migrate) and once again inside a "footer badges + social"
// block further down. Migrating only the standalone copy leaves the page
// holding both a <link> and a duplicate of the same rules — renders
// identically, but it is a page in two states at once. Deduping that block is
// its own job; mixing a strip into an extraction is the mistake slice 1 owned
// up to. Skipped here, byte-identical to how they were.
const EXCLUDED_PAGES = new Set([
  'blog/architectural-shingles-vs-3-tab.html',
  'blog/field-notes-joes-notebook-goes-public.html',
  'blog/how-long-does-roof-replacement-take-cincinnati.html',
  'blog/my-roof-is-too-old-will-insurance-still-pay.html',
  'blog/state-farm-allstate-roof-claims-ohio.html',
]);
// Must stay byte-identical to docs/assets/css/nbd-social.css's body
// (minus that file's own header comment). Deliberately NOT derived from the
// CSS file at runtime, so a drifted stylesheet cannot silently redefine what
// counts as canonical — same reasoning as ensure-readability-css.js.
const CANONICAL_BODY = `.nbd-social{display:inline-flex;gap:10px;align-items:center;margin-left:14px;vertical-align:middle}
.nbd-social a{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.08);color:rgba(255,255,255,.85);text-decoration:none!important;transition:transform .2s,background .2s,color .2s}
.nbd-social a:hover{transform:translateY(-2px);color:#fff}
.nbd-social a.s-fb:hover{background:#1877f2}
.nbd-social a.s-ig:hover{background:linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)}
.nbd-social a.s-gg:hover{background:#4285f4}
.nbd-social a.s-yelp:hover{background:#d32323}
.nbd-social svg{width:15px;height:15px;display:block}
@media(max-width:640px){.nbd-social{margin-left:0;margin-top:8px;display:flex;gap:8px}}
footer.foot .nbd-social a,.review-footer .nbd-social a{background:rgba(255,255,255,.1)}`;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === ROOT && EXCLUDED_TOP.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

// The working tree is CRLF on Windows (core.autocrlf) and LF in git/CI, and
// an LF needle silently no-ops on a CRLF file — so the needle is always built
// with the file's own EOL.
function exactBlockRegex(eol, flags) {
  const body = eol === '\n' ? CANONICAL_BODY : CANONICAL_BODY.split('\n').join(eol);
  const raw = '<style>' + eol + MARKER + eol + body + eol + '</style>';
  return new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
}

function eolOf(src) {
  return src.includes('\r\n') ? '\r\n' : '\n';
}

/** Pure per-page transform, exported for tests. */
function migrate(src) {
  const eol = eolOf(src);
  const copies = (src.match(exactBlockRegex(eol, 'g')) || []).length;
  const hasLink = src.includes(LINK_HREF);
  const hasMarker = src.includes(MARKER);
  let problem = null;
  if (hasLink && hasMarker) problem = 'carries BOTH the ' + LINK_HREF + ' link and the inline marker';
  else if (copies > 1) problem = copies + ' inline canonical copies';
  let next = src;
  if (!problem && copies === 1) next = src.replace(exactBlockRegex(eol), LINK_TAG);
  return { next, copies, hasLink, hasMarker, problem };
}

function main() {
  const WRITE = process.argv.includes('--write');
  let migrated = 0;
  const offenders = [];
  if (!fs.existsSync(CSS_FILE)) {
    console.error('ensure-social-css: missing ' + path.relative(process.cwd(), CSS_FILE));
    process.exit(1);
  }
  // The stylesheet must still say exactly what the 173 inline copies said.
  // Without this, the sheet could be edited and every page would silently
  // render something the migration never signed off on — existence alone is
  // the weaker check, and this is the whole safety property of an extraction.
  {
    const raw = fs.readFileSync(CSS_FILE, 'utf8').replace(/\r\n/g, '\n');
    const at = raw.indexOf(MARKER);
    const body = at === -1 ? null : raw.slice(at + MARKER.length + 1).replace(/\n$/, '');
    if (body !== CANONICAL_BODY) {
      console.error('ensure-social-css: ' + path.relative(process.cwd(), CSS_FILE)
        + ' has DRIFTED from CANONICAL_BODY.');
      console.error('  The stylesheet and the block it replaced must stay byte-identical.');
      console.error('  Change both deliberately, or not at all.');
      process.exit(1);
    }
  }
  for (const file of walk(ROOT)) {
    const orig = fs.readFileSync(file, 'utf8');
    if (!orig.includes(MARKER) && !orig.includes(LINK_HREF)) continue;
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (EXCLUDED_PAGES.has(rel)) continue;
    const r = migrate(orig);
    if (r.problem) { offenders.push(rel + ' [' + r.problem + ' — fix by hand]'); continue; }
    if (!r.copies) continue; // already linked
    if (!WRITE) { offenders.push(rel + ' [inline canonical copy — run --write]'); continue; }
    fs.writeFileSync(file, r.next);
    migrated++;
  }

  if (offenders.length) {
    console.error('ensure-social-css: ' + offenders.length + ' page(s) off-contract:');
    for (const o of offenders.slice(0, 20)) console.error('  - ' + o);
    if (!WRITE) console.error('Run: node scripts/ensure-social-css.js --write');
    process.exit(1);
  }
  console.log(JSON.stringify(WRITE ? { migrated } : { clean: true }, null, 2));
}

if (require.main === module) main();

module.exports = { CANONICAL_BODY, MARKER, LINK_HREF, LINK_TAG, CSS_FILE, exactBlockRegex, migrate };

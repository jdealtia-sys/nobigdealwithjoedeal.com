/**
 * ensure-nav-logo-mobile-css.js — keeps the `shrink the logo on phones` block
 * a LINKED stylesheet instead of an inline <style> repeated on every page.
 * ═══════════════════════════════════════════════════════════════
 *
 * WHY (2026-09-24, inline-CSS dedup slice 7)
 *
 * 223 public pages carried one 69-byte declaration as its own inline <style>
 * — ~29 KB of HTML. The cleanest population of any slice: ONE byte-exact
 * body, exactly one copy per page, always the sole content of a bare
 * <style>, never inside an nbd:partial region, uniform CRLF.
 *
 * MODES
 *   (default) assert — the CI gate. Exits 1 on a re-inlined copy, a page
 *     carrying BOTH link and marker, more than one copy, or a stylesheet that
 *     has drifted from CANONICAL_BODY.
 *   --write   migrates each byte-exact inline copy to the link IN PLACE.
 *
 * DO NOT fold this into nbd-nav-responsive.css. It holds the identical
 * declaration text, but 51 of these 223 pages never link that sheet, and its
 * copy sits under a DISJOINT breakpoint (1025-1440 vs max-width:768). Same
 * text, different meaning.
 *
 * No generator re-injects this block — scripts/strip-dead-nav-logo-text.js is
 * its author, and triggers on a block that is now extinct. This assert is the
 * backstop if that ever changes.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const CSS_FILE = path.join(ROOT, 'assets', 'css', 'nbd-nav-logo-mobile.css');

const MARKER = '/* shrink the logo on phones (consistency audit 2026-07-15) */';
const LINK_HREF = '/assets/css/nbd-nav-logo-mobile.css';
const LINK_TAG = `<link rel="stylesheet" href="${LINK_HREF}">`;
// Same exclusions as ensure-readability-css.js. 'sites' matters here: one
// page carrying the block (sites/free-guide/index.html) lives under it and
// keeps its inline copy deliberately, as index.html did for readability.
const EXCLUDED_TOP = new Set(['admin', 'pro', 'sites', 'assets', 'deploy', 'tools']);

// A page that carries NEITHER the marker NOR the link is skipped by the loop
// below — which is correct for the 75 pages that never had this block, but it
// also means DELETING the link from a migrated page is invisible to the
// marker/link checks. The only existing test that touches this CSS
// (tests/nav-logo-size-2026-09-14.test.js) is a NEGATIVE pin: it asserts the
// OLD sizes are absent and never that the 50px rule exists, so deleting the
// block outright leaves that suite green too.
// So: a floor. Raise it deliberately when pages are added; a DROP means the
// link was removed somewhere and should fail loudly rather than pass silently.
const LINK_FLOOR = 223;


// Five blog pages carry the social CSS TWICE: once standalone (which this
// script would migrate) and once again inside a "footer badges + social"
// block further down. Migrating only the standalone copy leaves the page
// holding both a <link> and a duplicate of the same rules — renders
// identically, but it is a page in two states at once. Deduping that block is
// its own job; mixing a strip into an extraction is the mistake slice 1 owned
// up to. Skipped here, byte-identical to how they were.
const EXCLUDED_PAGES = new Set([]); // none: all 195 pages are byte-identical
// Must stay byte-identical to docs/assets/css/nbd-nav-logo-mobile.css's body
// (minus that file's own header comment). Deliberately NOT derived from the
// CSS file at runtime, so a drifted stylesheet cannot silently redefine what
// counts as canonical — same reasoning as ensure-readability-css.js.
const CANONICAL_BODY = `@media(max-width:768px){
  nav .nav-logo img{height:50px!important}
}`;

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
  let linked = 0;
  const offenders = [];
  if (!fs.existsSync(CSS_FILE)) {
    console.error('ensure-nav-logo-mobile-css: missing ' + path.relative(process.cwd(), CSS_FILE));
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
      console.error('ensure-nav-logo-mobile-css: ' + path.relative(process.cwd(), CSS_FILE)
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
    if (!r.copies) { if (r.hasLink) linked++; continue; } // already linked
    if (!WRITE) { offenders.push(rel + ' [inline canonical copy — run --write]'); continue; }
    fs.writeFileSync(file, r.next);
    migrated++;
  }

  if (!WRITE && linked < LINK_FLOOR) {
    console.error('ensure-nav-logo-mobile-css: only ' + linked + ' page(s) link '
      + LINK_HREF + ', floor is ' + LINK_FLOOR + '.');
    console.error('  A link was removed without the block coming back. If pages were');
    console.error('  legitimately deleted, lower LINK_FLOOR in this file deliberately.');
    process.exit(1);
  }

  if (offenders.length) {
    console.error('ensure-nav-logo-mobile-css: ' + offenders.length + ' page(s) off-contract:');
    for (const o of offenders.slice(0, 20)) console.error('  - ' + o);
    if (!WRITE) console.error('Run: node scripts/ensure-nav-logo-mobile-css.js --write');
    process.exit(1);
  }
  console.log(JSON.stringify(WRITE ? { migrated } : { clean: true }, null, 2));
}

if (require.main === module) main();

module.exports = { CANONICAL_BODY, MARKER, LINK_HREF, LINK_TAG, CSS_FILE, exactBlockRegex, migrate };

#!/usr/bin/env node
/*
 * One-shot cleanup (2026-09-18, inline-CSS dedup phase 2 slice 3a): strip
 * three per-page <style> blocks whose every declaration is already supplied,
 * with the same value, by a shared stylesheet on the same page. No CSS moves
 * anywhere; nothing is extracted. Same class as strip-dead-nav-logo-text.js
 * (slice 2): not CI-wired, byte-exact matched, dry-run by default.
 *
 *   1. "trust-icon fix" (181 pages). docs/assets/css/nbd-icons.css:17-18
 *      re-declares both rules with the same selector, value and importance,
 *      and is linked AFTER the block, so the inline copy can never win.
 *   2. "a11y ... visible focus ring + reduced-motion" (6 pages).
 *      docs/assets/css/nbd-mobile.css:538 (:focus-visible) and :544 (the
 *      reduced-motion kill switch) are identical and linked BEFORE the block.
 *      Stripping hands the win back to nbd-mobile.css, which is only
 *      cascade-neutral if nothing between the two competes, so the only
 *      things allowed in between are mobile-cta.css, the iOS-zoom block and
 *      the .nbd-skip block (none sets outline/animation/transition).
 *   3. "nav-collapse normalize" (17 pages). docs/assets/css/nbd-nav-base.css:25
 *      carries the same 1024px collapse. The inline copy is !important and the
 *      shared rule is not, so the shared rule only takes over if it comes
 *      after every competing (0,1,0) rule: the nbd-nav-base.css link must be
 *      after the block AND the last stylesheet in <head>.
 *
 * Every precondition is checked per page. A page that fails one is left
 * untouched and reported (skip-and-report), and the run exits 1.
 *
 * Deliberately NOT touched:
 *   - docs/index.html's "trust-icon fix" variant (explicit stroke/fill child
 *     rules — a deliberate upgrade, not a copy). It is the one expected
 *     residual marker below.
 *   - The iOS-zoom block. It is the ONLY source of 16px inputs on its pages;
 *     stripping it would change rendering.
 *   - docs/pro and docs/sites (different design systems; the /pro/blog
 *     trust-icon copies also carry different CSS).
 *
 * EOL: the working tree is CRLF (core.autocrlf=true) and git stores LF. The
 * variants below are written in LF and each needle is rebuilt with the file's
 * own EOL before matching — an LF needle silently no-ops on a CRLF file (the
 * partials-system CRLF incident). Removal takes the <style> element plus
 * exactly one trailing EOL, and only when the element sits alone on its line.
 *
 * After the transform the script reports every page that still carries one of
 * the three markers. Anything other than docs/index.html's variant means a
 * byte-level variant nobody listed here (or a skipped page), and exits 1.
 * A second --write run matches nothing.
 *
 * The generator scripts/fix-trust-icons.js re-stamps a (stale) trust-icon
 * block at the END of <head> when the marker is missing — where it would win
 * the cascade over nbd-icons.css. It now skips any page that links
 * nbd-icons.css, so it cannot undo this strip.
 *
 * Usage: node scripts/strip-redundant-inline-css.js          (dry run)
 *        node scripts/strip-redundant-inline-css.js --write  (apply)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const EXCLUDED_TOP = new Set(['pro', 'sites']);

const ICONS_HREF = '/assets/css/nbd-icons.css';
const MOBILE_HREF = '/assets/css/nbd-mobile.css';
const NAV_BASE_HREF = '/assets/css/nbd-nav-base.css';

// Pages whose residual marker is a deliberate variant, not a missed copy.
const EXPECTED_RESIDUAL = {
  'index.html': ['trust-icon fix'],
};

// Elements allowed between the nbd-mobile.css link and the a11y block
// (byte-exact, LF): none sets outline, animation or transition, so removing
// the a11y block cannot let any of them take over from nbd-mobile.css.
const A11Y_ALLOWED_BETWEEN = [
  '<link rel="stylesheet" href="/assets/css/mobile-cta.css">',
  '<style>/* iOS-zoom fix (conversion audit): 16px inputs prevent Safari auto-zoom on focus */@media(max-width:600px){input,select,textarea{font-size:16px!important}}</style>',
  '<style>/* iOS-zoom fix: 16px inputs prevent Safari auto-zoom on focus */@media(max-width:600px){input,select,textarea{font-size:16px!important}}</style>',
  '<style>.nbd-skip{position:absolute;left:-9999px;top:0;z-index:100000;background:#BD5728;color:#fff;padding:10px 16px;font-weight:700;text-decoration:none;border-radius:0 0 6px 0}.nbd-skip:focus{left:0}</style>',
];

// Every stylesheet <link> in [from, to), in document order.
function stylesheetLinks(html, from, to) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  re.lastIndex = from;
  let m;
  while ((m = re.exec(html)) && m.index < to) {
    const tag = m[0];
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) continue;
    const href = (tag.match(/\bhref\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    out.push({ start: m.index, end: m.index + tag.length, href: href.replace(/[?#].*$/, '') });
  }
  return out;
}

// The shared sheet must come after the block, inside <head>.
function sheetAfter(href) {
  return (html, start, end, headEnd) => {
    if (!stylesheetLinks(html, end, headEnd).some((l) => l.href === href)) {
      return 'no ' + href + ' link after the block in <head>';
    }
    return null;
  };
}

const TARGETS = [
  {
    name: 'trust-icon fix',
    marker: '/* trust-icon fix',
    variants: [
      '<style>\n/* trust-icon fix */\n.trust-icon svg.ico{color:#fff}\n.aci-icon svg.ico,.form-success-icon svg.ico{color:var(--orange,#bd5728)}\n</style>',
    ],
    precondition: sheetAfter(ICONS_HREF),
  },
  {
    name: 'a11y focus ring + reduced-motion',
    marker: 'visible focus ring + reduced-motion',
    variants: [
      '<style>/* a11y (audit 2026-07): visible focus ring + reduced-motion */:focus-visible{outline:3px solid #bd5728;outline-offset:2px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}}</style>',
      '<style>/* a11y: visible focus ring + reduced-motion */:focus-visible{outline:3px solid #bd5728;outline-offset:2px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}}</style>',
    ],
    precondition(html, start) {
      const mobile = stylesheetLinks(html, 0, start).filter((l) => l.href === MOBILE_HREF).pop();
      if (!mobile) return 'no ' + MOBILE_HREF + ' link before the block';
      let between = html.slice(mobile.end, start);
      for (const allowed of A11Y_ALLOWED_BETWEEN) between = between.split(allowed).join('');
      if (between.trim() !== '') {
        return 'unexpected content between ' + MOBILE_HREF + ' and the block: '
          + JSON.stringify(between.trim().slice(0, 80));
      }
      return null;
    },
  },
  {
    name: 'nav-collapse normalize',
    marker: '/* nav-collapse normalize',
    variants: [
      '<style>/* nav-collapse normalize (visual audit 2026-07-19): hamburger threshold is 1024px site-wide */@media(max-width:1024px){.nav-links{display:none!important}.hamburger{display:flex!important}}</style>',
      '<style>/* nav-collapse normalize: hamburger threshold is 1024px site-wide */@media(max-width:1024px){.nav-links{display:none!important}.hamburger{display:flex!important}}</style>',
    ],
    precondition(html, start, end, headEnd) {
      const navBase = stylesheetLinks(html, end, headEnd).filter((l) => l.href === NAV_BASE_HREF).pop();
      if (!navBase) return 'no ' + NAV_BASE_HREF + ' link after the block in <head>';
      const tail = html.slice(navBase.end, headEnd);
      if (/<style\b/i.test(tail) || stylesheetLinks(tail, 0, tail.length).length) {
        return NAV_BASE_HREF + ' is not the last stylesheet in <head>';
      }
      return null;
    },
  },
];

const lineOf = (s, i) => s.slice(0, i).split('\n').length;

function markerHits(html) {
  const hits = [];
  for (const t of TARGETS) {
    for (let i = html.indexOf(t.marker); i >= 0; i = html.indexOf(t.marker, i + 1)) {
      hits.push({ target: t.name, line: lineOf(html, i) });
    }
  }
  return hits;
}

// Pure transform of one page. Returns the new text plus what was removed,
// what was skipped (and why), and which targeted markers are still present.
function stripPage(orig) {
  const eol = orig.includes('\r\n') ? '\r\n' : '\n';
  let html = orig;
  const removed = [];
  const skipped = [];

  for (const t of TARGETS) {
    t.variants.forEach((variant, vi) => {
      const needle = eol === '\n' ? variant : variant.split('\n').join(eol);
      let from = 0;
      for (;;) {
        const start = html.indexOf(needle, from);
        if (start < 0) break;
        const end = start + needle.length;
        const headEnd = html.search(/<\/head>/i);
        let reason = null;
        if (start > 0 && html[start - 1] !== '\n') reason = 'block does not start its own line';
        else if (html.slice(end, end + eol.length) !== eol) reason = 'block is not followed by one ' + JSON.stringify(eol);
        else if (headEnd < 0 || end > headEnd) reason = 'block is not inside <head>';
        else reason = t.precondition(html, start, end, headEnd);
        if (reason) {
          skipped.push({ target: t.name, line: lineOf(html, start), reason });
          from = end;
          continue;
        }
        removed.push({ target: t.name, variant: vi, line: lineOf(html, start), bytes: needle.length + eol.length });
        html = html.slice(0, start) + html.slice(end + eol.length);
        from = start;
      }
    });
  }
  return { html, removed, skipped, residual: markerHits(html) };
}

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

function run({ write }) {
  const report = {
    mode: write ? 'write' : 'dry-run',
    pagesScanned: 0,
    filesChanged: 0,
    bytesRemoved: 0,
    perVariant: {},
    skipped: [],
    expectedResidual: [],
    unexpectedResidual: [],
  };
  for (const t of TARGETS) t.variants.forEach((_, vi) => { report.perVariant[t.name + ' #' + vi] = 0; });

  for (const file of walk(ROOT).sort()) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const orig = fs.readFileSync(file, 'utf8');
    report.pagesScanned++;
    const res = stripPage(orig);
    for (const r of res.removed) {
      report.perVariant[r.target + ' #' + r.variant]++;
      report.bytesRemoved += r.bytes;
    }
    for (const s of res.skipped) report.skipped.push(rel + ':' + s.line + ' [' + s.target + '] ' + s.reason);
    for (const h of res.residual) {
      const entry = rel + ':' + h.line + ' [' + h.target + ']';
      if ((EXPECTED_RESIDUAL[rel] || []).includes(h.target)) report.expectedResidual.push(entry);
      else report.unexpectedResidual.push(entry);
    }
    if (res.html !== orig) {
      report.filesChanged++;
      if (write) fs.writeFileSync(file, res.html);
    }
  }
  return report;
}

if (require.main === module) {
  const report = run({ write: process.argv.includes('--write') });
  console.log(JSON.stringify(report, null, 2));
  if (report.skipped.length || report.unexpectedResidual.length) process.exitCode = 1;
}

module.exports = { stripPage, TARGETS, EXPECTED_RESIDUAL, run };

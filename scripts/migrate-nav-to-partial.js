#!/usr/bin/env node
/**
 * migrate-nav-to-partial.js — one-shot: wrap each page's desktop nav or
 * mobile nav in nbd:partial markers so apply-partials.js owns it from then on.
 *
 * Same skeleton and guarantees as migrate-footer-to-partial.js (EXACT/NEAR/
 * UNMATCHED buckets, per-page zero-diff proof on EXACT, CRLF splice
 * discipline) — see that file's header for the rationale. What differs is
 * region extraction:
 *
 *   nav-standard / nav-blog / nav-tool   <nav id="mainNav" …> … </nav>
 *       (no nested <nav> exists on any page; the inline hamburger-toggle
 *        <script> tag that sits INSIDE the nav rides along into the region —
 *        that script is a REQUIRED_MARKUP needle, so a partial that loses it
 *        fails the render gate loudly)
 *   mobile-nav-standard / -blog / -hub   <div class="mobile-nav" id="mobileNav">
 *       … balanced-div scan … </div>  (mnav-group divs nest inside)
 *
 * The only data that varies across the big cohorts is the CTA target
 * ({{cta_href}}: "#quote" on pages with an on-page form section, "/#contact"
 * elsewhere) — extracted from the nav-cta anchor.
 *
 * Usage mirrors the footer codemod:
 *   node scripts/migrate-nav-to-partial.js --partial nav-standard [--dir docs]
 *       [--write] [--show-near] [--near-budget N]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const REPO_ROOT = path.resolve(__dirname, '..');
const PARTIAL_NAME = argValue('--partial', 'nav-standard');
const DOCS = path.join(REPO_ROOT, argValue('--dir', 'docs'));
const PARTIAL = path.join(REPO_ROOT, 'site-src', 'partials', `${PARTIAL_NAME}.html`);

const WRITE = process.argv.includes('--write');
const SHOW_NEAR = process.argv.includes('--show-near');
const SCAN_EXCLUDED_TOP_DIRS = new Set(['pro', 'admin', 'dev']);
const NEAR_LINE_BUDGET = parseInt(argValue('--near-budget', '6'), 10) || 6;

const IS_MOBILE = PARTIAL_NAME.startsWith('mobile-nav');

// Pages never converted by this codemod, with the reason on record.
// (Structurally different pages classify UNMATCHED on their own; these are
// the ones where even a NEAR match must not be taken.)
const HARD_EXCLUDE = new Map([
  // docs/our-work.html was excluded while the Featured Projects branch was in
  // flight; both merged 2026-08-06 and the page converted EXACT (0-diff) on
  // 2026-08-07.
  ['docs/sites/free-guide/index.html', 'separate microsite chrome (no mainNav, badge logo)'],
]);

function walkHtml(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (dir === DOCS && SCAN_EXCLUDED_TOP_DIRS.has(e.name)) continue;
      walkHtml(full, out);
    } else if (e.isFile() && e.name.endsWith('.html')) out.push(full);
  }
  return out;
}

// Desktop nav: first <nav id="mainNav" …> through its close. No page nests
// <nav>, so the first </nav> after the open tag is the close.
function extractDesktopNav(src) {
  const m = src.match(/<nav id="mainNav"[^>]*>[\s\S]*?<\/nav>/);
  return m ? m[0] : null;
}

// Mobile nav: balanced-div scan — mnav-group headings are nested <div>s.
function extractMobileNav(src) {
  const openRe = /<div class="mobile-nav" id="mobileNav">/;
  const om = src.match(openRe);
  if (!om) return null;
  const start = om.index;
  let i = start + om[0].length, depth = 1;
  const tag = /<\/?div\b[^>]*>/g;
  tag.lastIndex = i;
  let t;
  while ((t = tag.exec(src))) {
    depth += t[0][1] === '/' ? -1 : 1;
    if (depth === 0) return src.slice(start, t.index + t[0].length);
  }
  return null;
}

const CTA_RE = /<a href="([^"]+)" class="nav-cta">/;
// mobile nav CTA: the last anchor, "Book Inspection" with inline style.
const MOBILE_CTA_RE = /<a href="([^"]+)" style="color:#e8720c;font-weight:800;">Book Inspection/;

function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] !== B[i]) out.push({ i, have: A[i], want: B[i] });
  }
  return out;
}

function main() {
  if (!fs.existsSync(PARTIAL)) { console.error(`FATAL: missing ${path.relative(REPO_ROOT, PARTIAL)}`); process.exit(2); }
  const template = fs.readFileSync(PARTIAL, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');

  const buckets = { EXACT: [], NEAR: [], UNMATCHED: [] };

  for (const file of walkHtml(DOCS)) {
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    const src = fs.readFileSync(file, 'utf8');
    const markerFamily = IS_MOBILE ? '<!-- nbd:partial mobile-nav-' : '<!-- nbd:partial nav-';
    if (src.includes(markerFamily)) continue;                    // already migrated
    if (HARD_EXCLUDE.has(rel)) { buckets.UNMATCHED.push({ rel, why: HARD_EXCLUDE.get(rel) }); continue; }

    const rawRegion = IS_MOBILE ? extractMobileNav(src) : extractDesktopNav(src);
    if (!rawRegion) continue;                                    // page has no such nav
    const eol = src.includes('\r\n') ? '\r\n' : '\n';
    const region = rawRegion.replace(/\r\n/g, '\n');

    let attrs = {};
    if (/\{\{[a-z0-9_]+\}\}/.test(template)) {
      const cm = region.match(IS_MOBILE ? MOBILE_CTA_RE : CTA_RE);
      if (!cm) { buckets.UNMATCHED.push({ rel, why: 'no nav-cta anchor to extract {{cta_href}} from' }); continue; }
      attrs = { cta_href: cm[1] };
      if (cm[1].includes('"') || cm[1].includes('--')) {
        buckets.UNMATCHED.push({ rel, why: 'cta href unsafe for an HTML comment attribute' });
        continue;
      }
    }

    const rendered = template.replace(/\{\{([a-z0-9_]+)\}\}/g, (_, k) => (k in attrs ? attrs[k] : `{{${k}}}`));
    if (rendered.includes('{{')) { buckets.UNMATCHED.push({ rel, why: 'unresolved placeholder after substitution' }); continue; }

    const d = diffLines(region, rendered);
    const bucket = d.length === 0 ? 'EXACT' : (d.length <= NEAR_LINE_BUDGET ? 'NEAR' : 'UNMATCHED');
    if (bucket === 'UNMATCHED') { buckets.UNMATCHED.push({ rel, why: `${d.length} differing lines — too far from canonical` }); continue; }

    const attrStr = Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
    const openMarker = `<!-- nbd:partial ${PARTIAL_NAME}${attrStr} -->`;
    const closeMarker = `<!-- /nbd:partial ${PARTIAL_NAME} -->`;
    const wrapped = `${openMarker}${eol}${rendered.replace(/\n/g, eol)}${eol}${closeMarker}`;
    const out = src.replace(rawRegion, wrapped);
    if (out === src) {
      console.error(`FATAL: splice was a no-op for ${rel}. Aborting without writing anything.`);
      process.exit(2);
    }

    if (bucket === 'EXACT') {
      const stripped = out
        .replace(`${openMarker}${eol}`, '')
        .replace(`${eol}${closeMarker}`, '');
      if (stripped !== src) {
        console.error(`FATAL: zero-diff proof FAILED for ${rel} — aborting without writing anything.`);
        process.exit(2);
      }
    }

    buckets[bucket].push({ rel, file, out, diff: d });
  }

  const total = buckets.EXACT.length + buckets.NEAR.length;
  if (!total && !buckets.UNMATCHED.length) { console.log('Nothing to migrate.'); process.exit(1); }

  if (WRITE) {
    for (const b of ['EXACT', 'NEAR']) {
      for (const e of buckets[b]) {
        const tmp = `${e.file}.tmp-nav`;
        fs.writeFileSync(tmp, e.out);
        fs.renameSync(tmp, e.file);
      }
    }
  }

  console.log(`${WRITE ? 'APPLIED' : 'DRY RUN'} — ${PARTIAL_NAME} → nbd:partial migration\n`);
  console.log(`  EXACT      ${String(buckets.EXACT.length).padStart(4)}  rendered partial reproduces the region byte-for-byte (+2 marker lines only)`);
  console.log(`  NEAR       ${String(buckets.NEAR.length).padStart(4)}  converge to canonical — REVIEW THESE`);
  console.log(`  UNMATCHED  ${String(buckets.UNMATCHED.length).padStart(4)}  left untouched`);
  console.log(`\n  ${PARTIAL_NAME} coverage after this pass: ${total} page(s)`);

  if (buckets.NEAR.length) {
    console.log('\nNEAR — every differing line, for review:');
    for (const e of buckets.NEAR) {
      console.log(`\n  ${e.rel}  (${e.diff.length} line(s))`);
      if (SHOW_NEAR || buckets.NEAR.length <= 25) {
        for (const d of e.diff) {
          console.log(`    - ${(d.have ?? '').trim().slice(0, 150)}`);
          console.log(`    + ${(d.want ?? '').trim().slice(0, 150)}`);
        }
      }
    }
  }

  if (buckets.UNMATCHED.length) {
    console.log('\nUNMATCHED — untouched, no region added:');
    const byReason = new Map();
    for (const u of buckets.UNMATCHED) byReason.set(u.why, (byReason.get(u.why) || 0) + 1);
    for (const [why, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${why}`);
    }
  }

  console.log(WRITE
    ? '\nNow run: node scripts/apply-partials.js --check   (must be clean)'
    : '\nDry run. Re-run with --write to apply.');
  process.exit(0);
}

main();

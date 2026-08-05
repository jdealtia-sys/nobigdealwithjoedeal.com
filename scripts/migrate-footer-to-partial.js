#!/usr/bin/env node
/**
 * migrate-footer-to-partial.js — one-shot: wrap each page's <footer> in
 * nbd:partial markers so apply-partials.js owns it from then on.
 *
 * THE BET THIS PROVES OR DISPROVES
 * 180 of the ~200 homeowner footers are byte-distinct, which looks like 180
 * hand-authored footers. It isn't: diffing two sibling footers yields ONE
 * changed line — a breadcrumb carrying the page's service and city. This
 * script classifies every footer against the canonical partial with those two
 * values factored out, and reports which bucket each page lands in:
 *
 *   EXACT     rendering the partial reproduces the page's current footer
 *             byte-for-byte. Migration adds exactly 2 marker lines and changes
 *             no content. This should be the overwhelming majority.
 *   NEAR      differs in a handful of lines. Printed in full for review — this
 *             is the ONLY set a human needs to read, and it is where genuine
 *             per-page drift (or an intentional past fix) will surface.
 *   UNMATCHED no confident classification. Left completely untouched and
 *             listed. Partial coverage is a first-class state: apply-partials
 *             only governs regions that exist, so an unconverted page is a
 *             coverage gap, not a failure.
 *
 * THE ZERO-DIFF PROOF: for every EXACT page, this script asserts that removing
 * the two marker lines from its own output reproduces the original file
 * byte-for-byte, and aborts the whole run if that ever fails. Combined with
 * `git diff --numstat` showing +2/-0 on those files, a reviewer can trust the
 * bulk of the diff without reading it and spend their attention on NEAR.
 *
 * Usage:
 *   node scripts/migrate-footer-to-partial.js            # dry run + report
 *   node scripts/migrate-footer-to-partial.js --write    # apply
 *   node scripts/migrate-footer-to-partial.js --show-near  # print NEAR diffs
 *   node scripts/migrate-footer-to-partial.js --partial footer-blog --dir docs/blog
 *     # migrate a different cohort onto a different footer variant. A partial
 *     # with no {{placeholders}} skips breadcrumb extraction entirely — every
 *     # footer in the cohort is classified against the template verbatim.
 *
 * Exit codes: 0 ok / 1 nothing to do / 2 fatal.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const REPO_ROOT = path.resolve(__dirname, '..');
const PARTIAL_NAME = argValue('--partial', 'footer-standard');
const DOCS = path.join(REPO_ROOT, argValue('--dir', 'docs'));
const PARTIAL = path.join(REPO_ROOT, 'site-src', 'partials', `${PARTIAL_NAME}.html`);

const WRITE = process.argv.includes('--write');
const SHOW_NEAR = process.argv.includes('--show-near');
const SCAN_EXCLUDED_TOP_DIRS = new Set(['pro', 'admin', 'dev']);
const NEAR_LINE_BUDGET = 6;

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

const CRUMB_RE =
  /^([ \t]*)<a href="(\/services\/[^"]+)">([^<]+)<\/a> · <a href="(\/areas\/[^"]+)">([^<]+)<\/a> · <a href="\/">nobigdealwithjoedeal\.com<\/a><br>$/m;

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
    if (src.includes('<!-- nbd:partial footer-')) continue;     // already migrated

    const m = src.match(/<footer>[\s\S]*?<\/footer>/);
    if (!m) continue;                                            // no footer (funnel chrome)
    // EOL DISCIPLINE — these files are CRLF. Compare in LF (so the canonical
    // partial can be stored either way) but ALWAYS splice back using the raw
    // matched text and re-emit with the file's own line ending. Replacing a
    // LF-normalised needle inside a CRLF haystack silently matches nothing and
    // String.replace then returns the input unchanged — a no-op that still
    // reports success. Converting the file to LF instead would rewrite every
    // line and produce an unreviewable diff.
    const rawFooter = m[0];
    const eol = src.includes('\r\n') ? '\r\n' : '\n';
    const footer = rawFooter.replace(/\r\n/g, '\n');

    // The breadcrumb is the only per-page value; without it we cannot render a
    // faithful partial, so such pages are left alone rather than guessed at.
    // A template with no {{placeholders}} (e.g. footer-blog) has no per-page
    // values at all — skip extraction and classify against it verbatim.
    let attrs = {};
    if (/\{\{[a-z0-9_]+\}\}/.test(template)) {
      const cm = footer.match(CRUMB_RE);
      if (!cm) { buckets.UNMATCHED.push({ rel, why: 'no service/city breadcrumb line' }); continue; }

      attrs = {
        crumb_service_href: cm[2],
        crumb_service_name: cm[3],
        crumb_city_href: cm[4],
        crumb_city_name: cm[5],
      };
      for (const [k, v] of Object.entries(attrs)) {
        if (v.includes('"') || v.includes('--')) {
          buckets.UNMATCHED.push({ rel, why: `breadcrumb value unsafe for an HTML comment attribute: ${k}` });
          continue;
        }
      }
    }

    const rendered = template.replace(/\{\{([a-z0-9_]+)\}\}/g, (_, k) => (k in attrs ? attrs[k] : `{{${k}}}`));
    if (rendered.includes('{{')) { buckets.UNMATCHED.push({ rel, why: 'unresolved placeholder after substitution' }); continue; }

    const d = diffLines(footer, rendered);
    const bucket = d.length === 0 ? 'EXACT' : (d.length <= NEAR_LINE_BUDGET ? 'NEAR' : 'UNMATCHED');
    if (bucket === 'UNMATCHED') { buckets.UNMATCHED.push({ rel, why: `${d.length} differing lines — too far from canonical` }); continue; }

    const attrStr = Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
    const openMarker = `<!-- nbd:partial ${PARTIAL_NAME}${attrStr} -->`;
    const closeMarker = `<!-- /nbd:partial ${PARTIAL_NAME} -->`;
    const wrapped =
      `${openMarker}${eol}${rendered.replace(/\n/g, eol)}${eol}${closeMarker}`;
    const out = src.replace(rawFooter, wrapped);
    if (out === src) {
      console.error(`FATAL: splice was a no-op for ${rel} — the footer text was not found verbatim. Aborting without writing anything.`);
      process.exit(2);
    }

    // ── zero-diff proof (EXACT only) ─────────────────────────────────────
    // Stripping the two marker lines must reproduce the original byte-for-byte.
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
  if (!total && !buckets.UNMATCHED.length) { console.log('No footers to migrate.'); process.exit(1); }

  if (WRITE) {
    for (const b of ['EXACT', 'NEAR']) {
      for (const e of buckets[b]) {
        const tmp = `${e.file}.tmp-footer`;
        fs.writeFileSync(tmp, e.out);
        fs.renameSync(tmp, e.file);
      }
    }
  }

  console.log(`${WRITE ? 'APPLIED' : 'DRY RUN'} — footer → nbd:partial migration\n`);
  console.log(`  EXACT      ${String(buckets.EXACT.length).padStart(4)}  rendered partial reproduces the footer byte-for-byte (+2 marker lines only)`);
  console.log(`  NEAR       ${String(buckets.NEAR.length).padStart(4)}  converge to canonical — REVIEW THESE`);
  console.log(`  UNMATCHED  ${String(buckets.UNMATCHED.length).padStart(4)}  left untouched`);
  console.log(`\n  footer coverage after this pass: ${total} page(s)`);

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
    if (!SHOW_NEAR && buckets.NEAR.length > 25) console.log('\n  (re-run with --show-near for the line-level diffs)');
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

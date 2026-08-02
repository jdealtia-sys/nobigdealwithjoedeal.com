#!/usr/bin/env node
/**
 * remove-page-csp-meta.js — delete the per-page <meta http-equiv="Content-Security-Policy">
 * tags. One-shot codemod (2026-08-02).
 *
 * WHY THIS IS SAFE, precisely:
 * When a page carries BOTH a CSP header and a CSP meta, the browser enforces
 * every policy independently — the effective policy is their INTERSECTION.
 * Deleting the meta therefore moves each page from
 *     intersection(firebase.json header, page meta)   ->   firebase.json header
 * which is equal or MORE permissive on every directive. Relaxing a policy can
 * unblock things; it can never block something that works today. So this cannot
 * cause a runtime regression.
 *
 * The metas were also drifting: 9 distinct variants across 156 pages, each more
 * permissive than the real header (img-src 'self' data: blob: https: http: vs the
 * header's explicit ~15-host allowlist; base-uri 'self' vs 'none'; no
 * frame-ancestors / script-src-attr / worker-src; extra *.workers.dev and
 * api.resend.com). Keeping them meant hand-maintaining a second policy in
 * lockstep with firebase.json forever — a drift generator, and the real hazard
 * was the meta silently blocking something the header allows.
 *
 * The authoritative policy is the "source": "**" header block in firebase.json.
 *
 * Usage:
 *   node scripts/remove-page-csp-meta.js            # dry run (default)
 *   node scripts/remove-page-csp-meta.js --write    # apply
 *
 * Exit codes: 0 ok / 1 nothing to do or drift / 2 fatal.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(REPO_ROOT, 'docs');
const WRITE = process.argv.includes('--write');

// Single-line tags only — verified: all 156 occurrences are one line. A tag that
// ever spans lines will simply not match, and the count check below will notice.
const CSP_META_RE = /^[ \t]*<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>[ \t]*\r?\n/gim;
// Fallback for a tag sharing a line with other markup (none today, but do not
// silently leave one behind).
const CSP_META_INLINE_RE = /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi;

function walkHtml(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, out);
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function main() {
  if (!fs.existsSync(DOCS)) {
    console.error(`FATAL: docs/ not found at ${DOCS}`);
    process.exit(2);
  }

  const files = walkHtml(DOCS);
  const changed = [];
  let totalTags = 0;

  for (const file of files) {
    const before = fs.readFileSync(file, 'utf8');
    if (!/http-equiv=["']Content-Security-Policy["']/i.test(before)) continue;

    const count = (before.match(CSP_META_INLINE_RE) || []).length;
    let after = before.replace(CSP_META_RE, '');
    // Anything left shared a line with other markup — strip just the tag.
    after = after.replace(CSP_META_INLINE_RE, '');

    if (CSP_META_INLINE_RE.test(after)) {
      console.error(`FATAL: ${path.relative(REPO_ROOT, file)} still has a CSP meta after replacement`);
      process.exit(2);
    }
    if (after === before) {
      console.error(`FATAL: ${path.relative(REPO_ROOT, file)} matched the detector but nothing was removed`);
      process.exit(2);
    }

    totalTags += count;
    changed.push({ file, count, bytes: before.length - after.length });
    if (WRITE) {
      const tmp = `${file}.tmp-csp`;
      fs.writeFileSync(tmp, after);
      fs.renameSync(tmp, file);
    }
  }

  if (!changed.length) {
    console.log('remove-page-csp-meta: no per-page CSP meta tags found — nothing to do.');
    process.exit(1);
  }

  const byDir = new Map();
  for (const c of changed) {
    const rel = path.relative(DOCS, c.file);
    const top = rel.includes(path.sep) ? rel.split(path.sep)[0] : '(root)';
    byDir.set(top, (byDir.get(top) || 0) + 1);
  }

  console.log(`${WRITE ? 'REMOVED' : 'WOULD REMOVE'} ${totalTags} CSP meta tag(s) from ${changed.length} file(s):`);
  for (const [dir, n] of [...byDir.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  docs/${dir}`);
  }
  const savedKb = (changed.reduce((s, c) => s + c.bytes, 0) / 1024).toFixed(1);
  console.log(`  ~${savedKb} KB of duplicated policy text removed.`);
  if (!WRITE) console.log('\nDry run. Re-run with --write to apply.');
  process.exit(0);
}

main();

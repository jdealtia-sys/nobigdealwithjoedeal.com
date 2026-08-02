#!/usr/bin/env node
/**
 * consolidate-hail-claim-pages.js — one-shot codemod (2026-08-02).
 *
 * THE PROBLEM
 * Five cities shipped BOTH /services/hail-damage-<city>-oh and
 * /services/hail-damage-insurance-claim-<city>-oh. The bodies are ~97%
 * identical (Mason: 1,914 vs 1,871 words), both pages self-canonical, and the
 * GENERIC page's own <title> already claims the claim keyword ("Hail Damage
 * Repair & Insurance Claims in Mason, OH"). So the two pages compete for one
 * query with one site's authority split across them. The other 21 hail cities
 * have no such twin — these 5 are the anomaly, not the pattern.
 *
 * THE FIX (Jo's call, 2026-08-02): consolidate. The generic page survives, the
 * claim page is deleted, and its URL 301s to the generic one so the accrued
 * link equity folds in rather than 404ing.
 *
 * WHY LINKS ARE REMOVED, NOT REPOINTED
 * Every page that links to a claim page ALREADY links to its generic twin —
 * verified across all 5 cities, including the /services/hail-damage-insurance-claim
 * hub, whose "City by City" chip list carries both forms for each city.
 * Repointing would therefore leave two links to the identical URL sitting in
 * the same card grid, differing only in label. So the claim link is deleted and
 * the generic sibling already present does the job. No city loses a link.
 *
 * Every remaining reference to a claim URL lives INSIDE the claim pages
 * themselves (canonical, og:url, JSON-LD breadcrumb) and disappears with the file.
 *
 * NOT TOUCHED: /services/hail-damage-insurance-claim (the non-city hub) is a
 * real page in build-sitemap.js's PLAIN_SERVICES set and must survive.
 *
 * Usage:
 *   node scripts/consolidate-hail-claim-pages.js           # dry run (default)
 *   node scripts/consolidate-hail-claim-pages.js --write   # apply
 *
 * After --write you must also:
 *   1. add the 5 redirects to firebase.json  (this script prints them)
 *   2. node scripts/build-sitemap.js --write (drops the deleted URLs)
 *   3. node scripts/check-site-integrity.js  (must stay at 0 failures)
 *
 * Exit codes: 0 ok / 1 nothing to do / 2 fatal.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(REPO_ROOT, 'docs');
const WRITE = process.argv.includes('--write');

const CITIES = ['batavia', 'cincinnati', 'loveland', 'mason', 'west-chester'];
const claimSlug = c => `hail-damage-insurance-claim-${c}-oh`;
const genericSlug = c => `hail-damage-${c}-oh`;

function walkHtml(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkHtml(full, out);
    else if (e.isFile() && e.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function writeAtomic(file, content) {
  const tmp = `${file}.tmp-hail`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function main() {
  // ── Preflight: both pages of every pair must exist, and every claim page
  // must have a generic twin to fold into. Abort rather than half-apply.
  const pairs = [];
  for (const c of CITIES) {
    const claim = path.join(DOCS, 'services', `${claimSlug(c)}.html`);
    const generic = path.join(DOCS, 'services', `${genericSlug(c)}.html`);
    if (!fs.existsSync(claim)) {
      console.error(`FATAL: claim page missing for ${c}: ${path.relative(REPO_ROOT, claim)}`);
      process.exit(2);
    }
    if (!fs.existsSync(generic)) {
      console.error(`FATAL: no generic twin to redirect ${c} into — refusing to delete a page with nowhere to go`);
      process.exit(2);
    }
    pairs.push({ city: c, claim, generic });
  }

  const claimPaths = new Set(pairs.map(p => p.claim));
  const files = walkHtml(DOCS);

  // ── Pass 1: strip links to the claim URLs from every OTHER page ──────────
  const linkEdits = [];
  let removedLinks = 0;

  for (const file of files) {
    if (claimPaths.has(file)) continue;           // deleted wholesale below
    const before = fs.readFileSync(file, 'utf8');
    if (!CITIES.some(c => before.includes(claimSlug(c)))) continue;

    // Remove each <a href="…claim-url…"> … </a> as a whole element. Cards are
    // written both as one line and across five (svc-card in the service pages),
    // so line-based removal is not enough — but an anchor that is NOT a
    // standalone block (i.e. sits inline in a sentence) must never be removed
    // silently, because that would delete prose with it.
    let after = before;
    const dropped = [];

    for (;;) {
      const city = CITIES.find(c => after.includes(`href="/services/${claimSlug(c)}"`));
      if (!city) break;

      // The generic sibling must already be linked on this page, otherwise
      // removing this link would orphan the city here. Exception: when the
      // file BEING edited is that generic twin, the card is a cross-link to
      // the page we are folding in — a page does not link to itself, and
      // removing it orphans nothing because the reader is already there.
      const isOwnGenericTwin =
        path.resolve(file) === path.resolve(path.join(DOCS, 'services', `${genericSlug(city)}.html`));
      if (!isOwnGenericTwin && !after.includes(`href="/services/${genericSlug(city)}"`)) {
        console.error(`FATAL: ${path.relative(REPO_ROOT, file)} links ${claimSlug(city)} but NOT ${genericSlug(city)} — removing would orphan the city. Repoint by hand.`);
        process.exit(2);
      }

      const hrefIdx = after.indexOf(`href="/services/${claimSlug(city)}"`);
      const openIdx = after.lastIndexOf('<a', hrefIdx);
      const closeIdx = after.indexOf('</a>', hrefIdx);
      if (openIdx < 0 || closeIdx < 0) {
        console.error(`FATAL: ${path.relative(REPO_ROOT, file)} — could not bound the anchor around ${claimSlug(city)}`);
        process.exit(2);
      }
      const endIdx = closeIdx + '</a>'.length;
      const block = after.slice(openIdx, endIdx);

      // Anchors cannot nest in valid HTML; a second <a inside the span means
      // the bounds are wrong.
      if ((block.match(/<a\s/gi) || []).length !== 1) {
        console.error(`FATAL: ${path.relative(REPO_ROOT, file)} — anchor bounds around ${claimSlug(city)} enclose another <a>; needs a hand edit`);
        process.exit(2);
      }

      // Standalone block = only whitespace between the previous newline and
      // <a, and only whitespace between </a> and the next newline.
      const lineStart = after.lastIndexOf('\n', openIdx) + 1;
      const nextNl = after.indexOf('\n', endIdx);
      const prefix = after.slice(lineStart, openIdx);
      const suffix = after.slice(endIdx, nextNl === -1 ? after.length : nextNl);
      if (prefix.trim() !== '' || suffix.trim() !== '') {
        console.error(`FATAL: ${path.relative(REPO_ROOT, file)} has an INLINE claim link (prose would be lost) — needs a hand edit:\n  ...${after.slice(lineStart, Math.min(lineStart + 200, after.length)).replace(/\n/g, ' ')}...`);
        process.exit(2);
      }

      // Drop the element and the whole line it occupied.
      after = after.slice(0, lineStart) + after.slice(nextNl === -1 ? after.length : nextNl + 1);
      dropped.push(block.replace(/\s+/g, ' ').trim().slice(0, 120));
      removedLinks++;
    }

    if (after === before) continue;
    linkEdits.push({ file, dropped });
    if (WRITE) writeAtomic(file, after);
  }

  // ── Pass 2: delete the claim pages ───────────────────────────────────────
  if (WRITE) for (const p of pairs) fs.unlinkSync(p.claim);

  // ── Report ───────────────────────────────────────────────────────────────
  console.log(`${WRITE ? 'APPLIED' : 'DRY RUN'} — consolidate 5 hail claim pages into their generic twins\n`);
  console.log(`Removed ${removedLinks} claim link(s) from ${linkEdits.length} file(s):`);
  for (const e of linkEdits) {
    console.log(`  ${path.relative(REPO_ROOT, e.file)}  (${e.dropped.length})`);
  }
  console.log(`\n${WRITE ? 'Deleted' : 'Would delete'} ${pairs.length} page(s):`);
  for (const p of pairs) console.log(`  docs/services/${claimSlug(p.city)}.html  ->  /services/${genericSlug(p.city)}`);

  console.log('\nAdd these to firebase.json "redirects" (301, permanent alias):');
  for (const p of pairs) {
    console.log(`      { "source": "/services/${claimSlug(p.city)}", "destination": "/services/${genericSlug(p.city)}", "type": 301 },`);
  }

  if (!WRITE) console.log('\nDry run. Re-run with --write to apply.');
  else console.log('\nNow run: node scripts/build-sitemap.js --write && node scripts/check-site-integrity.js');
  process.exit(0);
}

main();

#!/usr/bin/env node
/**
 * check-vault-index.js
 *
 * Guards the Obsidian vault under documentation/ against the two
 * failure modes that have actually bitten sessions here.
 *
 * Why this exists:
 *   1. Duplicated handoff lines. INDEX.md accumulated THREE separate
 *      "- Session handoffs:" lines — two under Projects & planning and a
 *      stray one under Audits — because each session prepended its note to
 *      a *copy* of the line instead of editing the one list. Between them
 *      they carried five competing "current — start here" claims, up to ten
 *      days apart. A session that read the wrong line started from a stale
 *      brief, and the 2026-08-31 session re-created the problem while the
 *      fix for it was still an open PR. Nothing detected any of it: three
 *      contradictory lines are perfectly valid markdown.
 *
 *   2. Invisible notes. CLAUDE.md's standing rule is "Link it from INDEX.md
 *      in the same PR — an unlinked note is invisible." That rule was
 *      unenforced, and 49 notes across 11 folders had drifted out of reach:
 *      every QA campaign linked its entry doc from INDEX, but the entry docs
 *      named their siblings as backticked filenames rather than links, so
 *      nothing could navigate to them from the vault root.
 *
 * What's checked:
 *   - Exactly one "- Session handoffs" line in INDEX.md
 *   - Exactly one "**Current handoff:" pointer in INDEX.md
 *   - Zero legacy "current — start here" markers (the competing-claim form)
 *   - Every .md under documentation/ is reachable from INDEX.md by
 *     following relative markdown links to any depth
 *   - Every relative .md link inside documentation/ resolves to a real file
 *
 * Not checked:
 *   - Link text, ordering, or descriptions — those are editorial
 *   - External (http) links
 *   - Anchors within a file
 *   - Broken links *inside* documentation/archive/. Those docs are frozen
 *     historical records that point at a repo layout which no longer exists,
 *     and some of the dangling links are deliberate: GO_LIVE_CHECKLIST.md
 *     states in its own header that its `docs/deploy/**` links "are retained
 *     for historical context" after those files were removed (firebase.json
 *     sets hosting.public: "docs", so anything under docs/ would have been
 *     published). Rewriting them would destroy the record. Archive files are
 *     still required to be REACHABLE — only their outbound links are exempt.
 *
 * Usage:
 *   node scripts/check-vault-index.js            # report and exit non-zero on failure
 *   node scripts/check-vault-index.js --quiet    # only print on failure
 */

const fs = require('fs');
const path = require('path');

const ROOT = 'documentation';
const INDEX = path.join(ROOT, 'INDEX.md');

function walkMd(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walkMd(full);
    return e.name.endsWith('.md') ? [full] : [];
  });
}

/** Relative .md links in a file, resolved against its directory. */
function mdLinks(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of src.matchAll(/\]\(([^)\s#]+\.md)(#[^)]*)?\)/g)) {
    const raw = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue; // skip http:, mailto:, etc
    out.push({ raw, resolved: path.normalize(path.join(path.dirname(file), raw)) });
  }
  return out;
}

function checkIndexPointers(failures) {
  const lines = fs.readFileSync(INDEX, 'utf8').split('\n');

  const handoffLines = lines
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /^- Session handoffs/.test(l));
  if (handoffLines.length !== 1) {
    failures.push(
      `INDEX.md has ${handoffLines.length} "- Session handoffs" line(s); expected exactly 1` +
        (handoffLines.length
          ? `\n    lines: ${handoffLines.map(({ n }) => n).join(', ')}` +
            `\n    Fix: merge them into the single list — do NOT add another line.`
          : `\n    Fix: the consolidated handoff list is missing.`)
    );
  }

  const currentPtr = lines
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => l.includes('**Current handoff:'));
  if (currentPtr.length !== 1) {
    failures.push(
      `INDEX.md has ${currentPtr.length} "**Current handoff:" pointer(s); expected exactly 1` +
        (currentPtr.length ? `\n    lines: ${currentPtr.map(({ n }) => n).join(', ')}` : '') +
        `\n    Fix: exactly one line names the live brief; older ones become "Prior handoff:".`
    );
  }

  const stale = lines
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => l.includes('current — start here'));
  if (stale.length) {
    failures.push(
      `INDEX.md carries ${stale.length} legacy "current — start here" marker(s) on line(s) ` +
        `${stale.map(({ n }) => n).join(', ')}` +
        `\n    Fix: only the "**Current handoff:" pointer names the live brief.`
    );
  }
}

function checkReachability(all, failures) {
  const graph = new Map(all.map((f) => [f, mdLinks(f)]));
  const known = new Set(all);

  // broken links first — a dangling link is its own failure.
  // archive/ is exempt: frozen records, some dangling on purpose (see header).
  const ARCHIVE = path.join(ROOT, 'archive') + path.sep;
  const broken = [];
  for (const [file, links] of graph) {
    if (file.startsWith(ARCHIVE)) continue;
    for (const { raw, resolved } of links) {
      if (!known.has(resolved) && !fs.existsSync(resolved)) {
        broken.push(`${path.relative(ROOT, file)} → ${raw}`);
      }
    }
  }
  if (broken.length) {
    failures.push(
      `${broken.length} broken relative link(s) inside ${ROOT}/:\n` +
        broken.map((b) => '    ' + b).join('\n')
    );
  }

  const seen = new Set([INDEX]);
  const queue = [INDEX];
  while (queue.length) {
    const cur = queue.shift();
    for (const { resolved } of graph.get(cur) || []) {
      if (known.has(resolved) && !seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }
  }

  const unreachable = all.filter((f) => !seen.has(f)).sort();
  if (unreachable.length) {
    failures.push(
      `${unreachable.length} note(s) unreachable from INDEX.md — an unlinked note is invisible:\n` +
        unreachable.map((f) => '    ' + path.relative(ROOT, f)).join('\n') +
        `\n    Fix: link each from INDEX.md, or from a doc that INDEX already reaches` +
        `\n         (a campaign folder's entry doc is the usual home).`
    );
  }

  return { total: all.length, reachable: seen.size };
}

function main(argv) {
  const quiet = argv.includes('--quiet');

  if (!fs.existsSync(INDEX)) {
    console.error(`✘ vault-index: ${INDEX} not found.`);
    process.exit(1);
  }

  const all = walkMd(ROOT);
  const failures = [];

  checkIndexPointers(failures);
  const stats = checkReachability(all, failures);

  if (failures.length) {
    console.error('');
    console.error('✘ vault-index check failed:');
    for (const f of failures) {
      console.error('');
      console.error('  • ' + f);
    }
    console.error('');
    console.error(`Summary: ${failures.length} problem(s) in ${ROOT}/.`);
    console.error('');
    process.exit(1);
  }

  if (!quiet) {
    console.log(
      `✓ vault-index: ${stats.total} note(s), all reachable from INDEX.md; ` +
        `one handoff list, one current-handoff pointer, no competing claims.`
    );
  }
  process.exit(0);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { walkMd, mdLinks, checkIndexPointers, checkReachability };

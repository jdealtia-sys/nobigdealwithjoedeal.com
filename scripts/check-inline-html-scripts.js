#!/usr/bin/env node
/**
 * check-inline-html-scripts.js
 *
 * Extracts every inline <script> block from HTML files under docs/
 * and runs `node --check` on each one. Catches silent syntax errors
 * that browsers ignore or log to console where nobody sees them.
 *
 * Why this exists:
 *   On 2026-04-18 we shipped a broken /estimate funnel for weeks.
 *   calculateBallpark() was missing its closing brace, so the entire
 *   main script halted with "Unexpected end of input". The page still
 *   rendered (HTML doesn't care), but every interactive feature was
 *   dead. No git commit in history had the file intact. This check
 *   would have caught it the first time it was committed.
 *
 * What's checked:
 *   - docs/ ** / *.html  (recursive)
 *   - Only inline <script> blocks (no src attribute)
 *   - Only JS (no type="application/ld+json", no type="module" unless inline)
 *
 * What's skipped:
 *   - docs/sites/     (white-label client templates, separate project)
 *   - docs/pro/       (app, not marketing; has its own tooling)
 *   - docs/admin/     (admin UI; has its own tooling)
 *   - docs/assets/    (not HTML anyway; belt+suspenders)
 *   - docs/tools/     (internal tooling UI)
 *   - Tiny (<40 char) GA snippets matching the standard gtag() call
 *   - tests/          (fixtures may contain intentionally broken scripts)
 *
 * Exit codes:
 *   0 — all scripts parse cleanly
 *   1 — at least one script has a syntax error
 *   2 — tool failure (couldn't read files, etc.)
 *
 * Usage:
 *   node scripts/check-inline-html-scripts.js
 *   node scripts/check-inline-html-scripts.js docs/estimate.html   # one file
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

const SKIP_DIRS = ['sites', 'pro', 'admin', 'assets', 'tools'];

// ──────────────────────────────────────────────────────────────────
// File walker
// ──────────────────────────────────────────────────────────────────

function walkHtml(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.includes(entry.name)) continue;
      walkHtml(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Script extractor
// ──────────────────────────────────────────────────────────────────
//
// Finds every <script>...</script> block with no src attribute and no
// type="application/ld+json" (JSON data, not JS). Returns an array of
// { startLine, endLine, body, note }.
//
// Intentionally NOT a full HTML parser — we match on <script and </script>
// because the files are static and well-formed, and a full parser would
// drag in a big dep for something this focused. If nesting or escaped
// tags ever become an issue, swap to `parse5`.

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

function extractInlineScripts(html) {
  const blocks = [];
  let m;
  while ((m = SCRIPT_RE.exec(html)) !== null) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    const startOffset = m.index + m[0].indexOf('>') + 1;

    // Skip src'd scripts
    if (/\bsrc\s*=/.test(attrs)) continue;

    // Skip JSON-LD data blocks
    if (/type\s*=\s*["']application\/ld\+json["']/.test(attrs)) continue;

    // Skip empty bodies
    if (!body.trim()) continue;

    // Skip the well-known GA inline snippet. This pattern is copy-pasted
    // from Google and we don't want to chase its whitespace.
    const trimmed = body.replace(/\s+/g, ' ').trim();
    if (/^window\.dataLayer\s*=\s*window\.dataLayer\s*\|\|\s*\[\];\s*function gtag\(\)/.test(trimmed) && trimmed.length < 220) continue;

    // Skip trivial one-liners that set a single window.__NBD_* var
    if (/^window\.__NBD_[A-Z_]+\s*=\s*"[^"]*";?$/.test(trimmed)) continue;

    // Compute start line (1-indexed) so errors can reference the HTML file
    const preceding = html.slice(0, startOffset);
    const startLine = (preceding.match(/\n/g) || []).length + 1;

    blocks.push({
      startLine,
      endLine: startLine + (body.match(/\n/g) || []).length,
      body,
      attrs: attrs.trim() || null,
    });
  }
  return blocks;
}

// ──────────────────────────────────────────────────────────────────
// Per-file check
// ──────────────────────────────────────────────────────────────────

function checkFile(filePath) {
  const failures = [];
  const html = fs.readFileSync(filePath, 'utf8');
  const blocks = extractInlineScripts(html);
  if (blocks.length === 0) {
    return { filePath, blocksChecked: 0, failures };
  }

  for (const block of blocks) {
    // Write the body to a temp .js file. Pad with blank lines so the
    // line numbers in error output correspond to the HTML file's lines.
    const pad = '\n'.repeat(block.startLine - 1);
    const tmpPath = path.join(
      os.tmpdir(),
      'nbd-html-check-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.js'
    );
    fs.writeFileSync(tmpPath, pad + block.body, 'utf8');

    try {
      execFileSync(process.execPath, ['--check', tmpPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const stderr = (err.stderr || '').toString();
      // Replace temp-file path with the real HTML path for legible output
      const cleaned = stderr
        .split('\n')
        .map((line) => line.replace(tmpPath, filePath))
        .join('\n')
        .trim();
      failures.push({
        filePath,
        startLine: block.startLine,
        endLine: block.endLine,
        stderr: cleaned,
      });
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    }
  }

  return { filePath, blocksChecked: blocks.length, failures };
}

// ──────────────────────────────────────────────────────────────────
// Entry
// ──────────────────────────────────────────────────────────────────

function main(argv) {
  const explicitTargets = argv.slice(2).filter((a) => !a.startsWith('-'));
  const files = explicitTargets.length
    ? explicitTargets.map((p) => path.resolve(process.cwd(), p))
    : walkHtml(DOCS);

  if (files.length === 0) {
    console.error('No HTML files found to check.');
    process.exit(2);
  }

  let totalBlocks = 0;
  let totalFiles = 0;
  const allFailures = [];

  for (const f of files) {
    const result = checkFile(f);
    totalFiles++;
    totalBlocks += result.blocksChecked;
    if (result.failures.length) {
      allFailures.push(...result.failures);
    }
  }

  if (allFailures.length) {
    console.error('');
    console.error('╔════════════════════════════════════════════════════════════╗');
    console.error('║  Inline HTML <script> syntax check — FAILED               ║');
    console.error('╚════════════════════════════════════════════════════════════╝');
    for (const f of allFailures) {
      const rel = path.relative(ROOT, f.filePath);
      console.error('');
      console.error(`✘ ${rel}  (inline <script> @ line ${f.startLine})`);
      console.error('');
      f.stderr.split('\n').forEach((line) => console.error('    ' + line));
    }
    console.error('');
    console.error(`Summary: ${allFailures.length} failure(s) across ${totalFiles} file(s) (${totalBlocks} scripts scanned).`);
    console.error('');
    process.exit(1);
  }

  console.log(`✓ Inline HTML <script> syntax check passed — ${totalBlocks} script(s) across ${totalFiles} file(s).`);
  process.exit(0);
}

if (require.main === module) {
  main(process.argv);
}

module.exports = { extractInlineScripts, checkFile, walkHtml };

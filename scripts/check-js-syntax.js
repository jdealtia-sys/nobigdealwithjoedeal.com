#!/usr/bin/env node
/**
 * Parse-check every first-party JavaScript file that SHIPS.
 *
 * Why this exists
 * ───────────────
 * A syntax error in shipped JS is the cheapest possible production outage:
 * the file 404s-in-spirit (parses to nothing), the page it powers renders
 * dead, and nothing else in CI notices — the smoke suite `require()`s only
 * the handful of pure logic modules it asserts against, and the Playwright
 * shards exercise a few journeys, not every page's script.
 *
 * Before this script, ci.yml's `syntax-check` job looped `node --check` over
 * exactly two roots: `functions/` and `docs/pro/js/`. That left ~80 shipped
 * first-party files with NO parse check anywhere in CI, including all of
 * `docs/assets/js/inline/` — the directory the CSP sweeps moved every former
 * inline <script> and on*= handler into. Those files are load-bearing page
 * logic that is, by construction, no longer visible in the HTML.
 *
 * Scope (see ROOTS / EXCLUDED below)
 * ──────────────────────────────────
 *   INCLUDED: functions/**, docs/** — the code we author and deploy.
 *   EXCLUDED: node_modules (not ours), _archive (intentionally dead),
 *             assets/vendor (third-party bundles — minified, may legitimately
 *             use syntax we neither wrote nor control; a vendor parse failure
 *             would be an upgrade decision, not a build break).
 *   NOT SCANNED: scripts/** — build/maintenance tooling that never reaches a
 *             browser or a function runtime. It is covered by actually being
 *             executed in CI (build-sitemap, check-site-integrity, …).
 *
 * CJS vs ESM
 * ──────────
 * Everything here is a bare `.js` with no `"type": "module"` in scope, so
 * `node --check` parses it as CommonJS. Some of these files ARE loaded by the
 * browser as `<script type="module">` (e.g. docs/admin/js/pages/*) — today
 * none of them use top-level `import`/`export`, so the CommonJS parse is
 * correct for all of them. That is a coincidence of the current code, not a
 * guarantee: the moment someone adds an `import` to a module-loaded file, a
 * naive CommonJS-only check would report a syntax error on a perfectly valid
 * file and block the deploy.
 *
 * So a CommonJS failure is not final. Any file that fails the CJS parse is
 * re-checked as an ES module before being reported. A file is only a failure
 * when it parses as NEITHER — i.e. it is genuinely malformed under both
 * grammars, which is what we actually want to catch.
 *
 * Usage
 * ─────
 *   node scripts/check-js-syntax.js            # report every failure, exit 1 if any
 *   node scripts/check-js-syntax.js --quiet    # only print failures + the summary
 *
 * Exit code is 0 (all parse) or 1 (at least one file parses under neither
 * grammar), so it works as a CI step and as a pre-deploy gate.
 */

'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// Roots we author and ship. Anything outside these is not our parse problem.
const ROOTS = ['functions', 'docs'];

// Path segments that disqualify a file. Matched against the repo-relative
// path with forward slashes, so these are portable across win32/posix.
const EXCLUDED = [
  'node_modules',   // third-party, enormous, not ours
  '_archive',       // intentionally dead code kept for reference
  'assets/vendor',  // third-party browser bundles (leaflet, jspdf, chartjs, …)
];

const QUIET = process.argv.includes('--quiet');

/** Recursively collect .js files under `dir`, honouring EXCLUDED. */
function collect(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // root doesn't exist in this checkout — nothing to check
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
    if (EXCLUDED.some((frag) => rel.includes(frag))) continue;
    if (entry.isDirectory()) collect(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

/**
 * Parse-check one file. Resolves to null when it parses, or the stderr text
 * when it parses under neither CommonJS nor ESM.
 *
 * `node --check <file>` parses as CommonJS. To force the ESM grammar we pipe
 * the source in on stdin with `--input-type=module`, which is the documented
 * way to parse-check module syntax without the file needing an .mjs name.
 */
function checkFile(rel) {
  const abs = path.join(REPO_ROOT, rel);
  return new Promise((resolve) => {
    execFile(process.execPath, ['--check', abs], (cjsErr, _out, cjsStderr) => {
      if (!cjsErr) return resolve(null); // parses as CommonJS — done

      // Retry under the ES module grammar before calling it a failure.
      const child = execFile(
        process.execPath,
        ['--check', '--input-type=module'],
        (esmErr) => resolve(esmErr ? String(cjsStderr).trim() : null),
      );
      child.stdin.on('error', () => {}); // node can close stdin early on a parse abort
      fs.createReadStream(abs).pipe(child.stdin);
    });
  });
}

/** Run `tasks` with at most `limit` in flight at once. */
async function pool(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const files = [];
  for (const root of ROOTS) collect(path.join(REPO_ROOT, root), files);
  files.sort();

  if (!files.length) {
    console.error('check-js-syntax: found no .js files to check — is the checkout complete?');
    process.exit(1);
  }

  // One process per file is the only way to get node's real parser, so run a
  // CPU-sized pool rather than serially (~4x faster on a CI runner).
  const concurrency = Math.max(2, (os.cpus() || { length: 2 }).length);
  const results = await pool(files, concurrency, checkFile);

  const failures = [];
  results.forEach((stderr, i) => {
    if (stderr) failures.push({ file: files[i], stderr });
  });

  for (const { file, stderr } of failures) {
    console.error(`\n✗ ${file}`);
    console.error(stderr.split('\n').map((l) => `    ${l}`).join('\n'));
  }

  if (failures.length) {
    console.error(
      `\ncheck-js-syntax: ${failures.length} of ${files.length} file(s) failed to parse ` +
        'as CommonJS or as an ES module.',
    );
    process.exit(1);
  }

  if (!QUIET) console.log(`check-js-syntax: ${files.length} files parsed cleanly.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('check-js-syntax: unexpected error —', err && err.stack ? err.stack : err);
  process.exit(1);
});

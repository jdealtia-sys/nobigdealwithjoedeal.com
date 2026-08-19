#!/usr/bin/env node
/**
 * scripts/extract-job-template-costs.js — rebuild the PRIVATE job-template
 * cost overlay.
 *
 * The published template library (docs/pro/js/job-templates-data.js) carries
 * the whole scope of work — item name, description, unit, qty, category — and
 * NO cost. materialCost/laborCost are tenant-owned and live in Firestore at
 * catalogCosts/{companyId}.jtCosts, beside the product cost book that already
 * lives on that document. See functions/job-template-cost-logic.js for why the
 * line falls where it does.
 *
 * This script produces the document body that
 * scripts/import-job-template-costs.js loads into ONE company's book. It reads
 * the FULL (pre-strip) data file out of git history, because the numbers
 * deliberately no longer exist in the working tree:
 *
 *     node scripts/extract-job-template-costs.js --from <pre-strip-sha>
 *
 * `--from worktree` reads docs/pro/js/job-templates-data.js off disk instead —
 * that is how the initial migration ran, while the costs were still checked in.
 *
 * The overlay is ALWAYS validated against the CURRENT working-tree template
 * library before it is written: every live custom item must have an entry,
 * every value must be a finite number >= 0, and at least one of
 * material/labor must be > 0 per item. That last assertion used to live in
 * tests/job-templates.test.js, where it REQUIRED the costs to be published; it
 * cannot run there any more, so it runs here and again at import time.
 *
 * Output goes to an untracked path (.local/ is gitignored, and
 * tests/catalog-cost-privacy.test.js asserts both that and that no extracted
 * book is tracked) — writing it back into the repo would recreate the exact
 * leak this split exists to close.
 *
 * Usage:
 *   node scripts/extract-job-template-costs.js [--from <git-ref>|worktree] [--out <path>]
 *
 * Exit codes: 0 = overlay written, 1 = validation failed, 2 = fatal.
 * Zero npm dependencies — Node builtins only.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REL = 'docs/pro/js/job-templates-data.js';
const {
  buildJtCostOverlay, validateJtCostOverlay,
} = require(path.join(ROOT, 'functions', 'job-template-cost-logic.js'));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const FROM = arg('--from', 'worktree');
const OUT = path.resolve(ROOT, arg('--out', path.join('.local', 'jt-cost-seed.json')));

function readAt(ref, rel) {
  if (ref === 'worktree') return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  try {
    return execFileSync('git', ['show', ref + ':' + rel], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    console.error('FATAL: cannot read ' + rel + ' at ' + ref + ' — ' + e.message);
    process.exit(2);
  }
}

/** Run the data file in a bare sandbox and hand back window.NBD_JOB_TEMPLATES. */
function loadTemplates(ref) {
  const win = {};
  win.window = win;
  const sandbox = { window: win, Date, Math, JSON, Set, Object };
  try {
    vm.runInNewContext(readAt(ref, REL), sandbox, { filename: path.basename(REL) });
  } catch (e) {
    console.error('FATAL: ' + REL + ' threw while loading at ' + ref + ' — ' + e.message);
    process.exit(2);
  }
  const templates = win.NBD_JOB_TEMPLATES || [];
  if (!templates.length) {
    console.error('FATAL: no templates loaded at ' + ref);
    process.exit(2);
  }
  return templates;
}

const fullLibrary = loadTemplates(FROM);
const publicLibrary = FROM === 'worktree' ? fullLibrary : loadTemplates('worktree');

const overlay = buildJtCostOverlay(fullLibrary);
const keys = Object.keys(overlay.jtCosts);
const nonZero = keys.reduce((n, k) => {
  const e = overlay.jtCosts[k];
  return n + (e.materialCost > 0 ? 1 : 0) + (e.laborCost > 0 ? 1 : 0);
}, 0);

console.log('source          : ' + FROM + ' (' + fullLibrary.length + ' templates)');
console.log('public library  : worktree (' + publicLibrary.length + ' templates)');
console.log('overlay entries : ' + keys.length);
console.log('non-zero values : ' + nonZero);

if (!keys.length) {
  console.error('\nFATAL: the source carries NO cost data — you are extracting from a POST-strip ref.');
  console.error('Pass --from <pre-strip-sha>. Nothing written.');
  process.exit(2);
}

const { ok, errors, warnings } = validateJtCostOverlay(overlay, publicLibrary);
warnings.forEach((w) => console.log('  warn: ' + w));
if (!ok) {
  console.error('\nVALIDATION FAILED (' + errors.length + '):');
  errors.slice(0, 40).forEach((e) => console.error('  ' + e));
  if (errors.length > 40) console.error('  … and ' + (errors.length - 40) + ' more');
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(overlay, null, 2) + '\n');
console.log('\nOK — wrote ' + OUT);
console.log('These are LEAKED figures until they are rotated. Next, in order:');
console.log('  node scripts/rotate-job-template-costs.js --worksheet');
console.log('  node scripts/rotate-job-template-costs.js --overrides .local/jt-cost-rotation.json');
console.log('  node scripts/import-job-template-costs.js --company <companyId>');

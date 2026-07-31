#!/usr/bin/env node
/**
 * scripts/extract-catalog-costs.js — rebuild the PRIVATE catalog cost overlay.
 *
 * The published catalog (docs/pro/js/product-data.js + roofivent-catalog.js)
 * carries spec + retail sell only; wholesale cost and the labor block are
 * tenant-owned and live in Firestore at catalogCosts/{companyId}. See
 * functions/catalog-cost-logic.js for why the line falls where it does.
 *
 * This script produces the document body that scripts/import-catalog-costs.js
 * loads into ONE company's book. It reads the FULL (pre-strip) catalog out of
 * git history, because the numbers deliberately no longer exist in the working
 * tree:
 *
 *     node scripts/extract-catalog-costs.js --from 43024049
 *
 * `--from worktree` reads docs/pro/js/ off disk instead — that is how the
 * initial migration ran, while the costs were still checked in.
 *
 * The overlay is ALWAYS validated against the CURRENT working-tree public
 * catalog before it is written: every live SKU must have an entry, every cost
 * must be a positive number, and sell >= cost must hold on all three tiers.
 * That is the assertion that used to live in tests/product-data.test.js; it
 * cannot run there any more, so it runs here and again at import time.
 *
 * Output goes to an untracked path (.local/ is gitignored) — writing it back
 * into the repo would recreate the exact leak this split exists to close.
 *
 * Usage:
 *   node scripts/extract-catalog-costs.js [--from <git-ref>|worktree] [--out <path>]
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
const REL = ['docs/pro/js/product-data.js', 'docs/pro/js/roofivent-catalog.js'];
const { buildCostOverlay, validateCostOverlay } = require(path.join(ROOT, 'functions', 'catalog-cost-logic.js'));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const FROM = arg('--from', 'worktree');
const OUT = path.resolve(ROOT, arg('--out', path.join('.local', 'catalog-cost-seed.json')));

function readAt(ref, rel) {
  if (ref === 'worktree') return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  try {
    return execFileSync('git', ['show', ref + ':' + rel], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    console.error('FATAL: cannot read ' + rel + ' at ' + ref + ' — ' + e.message);
    process.exit(2);
  }
}

/** Run the two catalog files in one sandbox and hand back window.NBD_PRODUCTS. */
function loadCatalog(ref) {
  const win = {};
  win.window = win;
  const sandbox = { window: win, Date, Math, JSON, Set, Object };
  REL.forEach((rel) => {
    try {
      vm.runInNewContext(readAt(ref, rel), sandbox, { filename: path.basename(rel) });
    } catch (e) {
      console.error('FATAL: ' + rel + ' threw while loading at ' + ref + ' — ' + e.message);
      process.exit(2);
    }
  });
  const products = win.NBD_PRODUCTS || [];
  if (!products.length) {
    console.error('FATAL: no products loaded at ' + ref);
    process.exit(2);
  }
  return products;
}

const fullCatalog = loadCatalog(FROM);
const publicCatalog = FROM === 'worktree' ? fullCatalog : loadCatalog('worktree');

const overlay = buildCostOverlay(fullCatalog);
const entries = Object.keys(overlay.costs).length;

console.log('source          : ' + FROM + ' (' + fullCatalog.length + ' SKUs)');
console.log('public catalog  : worktree (' + publicCatalog.length + ' SKUs)');
console.log('overlay entries : ' + entries);
console.log('defaults        : overheadMultiplier=' + overlay.defaults.overheadMultiplier +
            ' profitMarginPct=' + overlay.defaults.profitMarginPct);

const { ok, errors, warnings } = validateCostOverlay(overlay, publicCatalog);
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
console.log('Next: node scripts/import-catalog-costs.js --company <companyId> --in ' + path.relative(ROOT, OUT));

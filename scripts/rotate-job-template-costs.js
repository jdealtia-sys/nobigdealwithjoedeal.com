#!/usr/bin/env node
/**
 * scripts/rotate-job-template-costs.js — revise the leaked job-template cost
 * basis before it goes into a tenant's book.
 *
 * WHY ROTATION IS THE ACTUAL FIX, AND THE STRIP IS NOT.
 *
 * docs/pro/js/job-templates-data.js published 84 contractor cost pairs — 146
 * non-zero values — for roughly a month, on a live URL AND from
 * raw.githubusercontent.com. They entered in exactly one commit and were never
 * modified, so they are readable forever at that blob: in this repo's history,
 * in every clone anybody has already taken, and in every fork (which keeps its
 * own objects and can push them back). Deleting them from HEAD stops NEW
 * exposure. It does not un-publish what is already out, and a `git filter-repo`
 * rewrite would not either — it breaks every clone, PR, permalink and worktree,
 * and GitHub keeps orphaned blobs in the fork network until Support garbage-
 * collects them. That trade was assessed and declined; see §6 of the migration
 * plan and the audit note.
 *
 * What DOES devalue every copy that already exists: making them wrong. Leaked
 * cost figures are worth something only while they are accurate. Revising the
 * basis as part of the migration is a stronger remedy than any attempt to
 * delete copies, and it is the one remedy that is fully within your control.
 *
 * WHAT THIS SCRIPT WILL NOT DO. It will not invent numbers. A blanket "scale
 * everything by 7%" would devalue the leaked copies and leave YOU quoting live
 * jobs off fabricated money — worse than the problem. The figures are yours;
 * this script's job is to make supplying them cheap, to prove the rotation
 * actually happened, and to refuse to let a no-op pass as one.
 *
 * THE THREE STEPS:
 *
 *   1. node scripts/rotate-job-template-costs.js --worksheet
 *      Writes .local/jt-cost-rotation.json — every key with the item's name,
 *      unit and CURRENT figures, ready to edit. Also writes a .csv alongside
 *      it if you would rather work in a spreadsheet.
 *
 *   2. Edit it. Put your current real material/labor cost on each line. Leave
 *      a line untouched to keep the existing figure (and be told about it).
 *
 *   3. node scripts/rotate-job-template-costs.js --overrides .local/jt-cost-rotation.json
 *      Applies them, validates the result, reports how much of the basis
 *      actually moved, and writes .local/jt-cost-seed.rotated.json — which is
 *      what scripts/import-job-template-costs.js reads.
 *
 * The rotated seed is stamped `rotatedAt` + `rotationCoverage`. The import
 * script refuses an unstamped seed unless you pass --unrotated, so "we meant
 * to rotate and forgot" cannot quietly become the outcome.
 *
 * Output stays under .local/ (gitignored, and asserted so by
 * tests/catalog-cost-privacy.test.js) — writing any of this back into the repo
 * would recreate the leak.
 *
 * Usage:
 *   node scripts/rotate-job-template-costs.js --worksheet [--in <seed>] [--out <path>]
 *   node scripts/rotate-job-template-costs.js --overrides <path> [--in <seed>] [--out <path>]
 *                                             [--min-coverage <0..1>]
 *
 * Exit codes: 0 = ok, 1 = validation/coverage failed, 2 = fatal.
 * Zero npm dependencies — Node builtins only.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const {
  jtKey, validateJtCostOverlay, SEED_VERSION,
} = require(path.join(ROOT, 'functions', 'job-template-cost-logic.js'));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) {
    console.error('FATAL: ' + name + ' requires a value (got ' + (v ? v : 'nothing') + ').');
    process.exit(2);
  }
  return v;
}

const WORKSHEET = process.argv.includes('--worksheet');
const OVERRIDES = arg('--overrides', null);
const IN = path.resolve(ROOT, arg('--in', path.join('.local', 'jt-cost-seed.json')));
// Default coverage floor. A rotation that moved a tenth of the basis has not
// devalued anything; the number is arguable, the presence of a floor is not.
const MIN_COVERAGE = Number(arg('--min-coverage', '0.5'));

if (!WORKSHEET && !OVERRIDES) {
  console.error('FATAL: pass --worksheet to generate one, or --overrides <path> to apply one.');
  process.exit(2);
}

let seed;
try { seed = JSON.parse(fs.readFileSync(IN, 'utf8')); }
catch (e) {
  console.error('FATAL: cannot read/parse ' + IN + ' — ' + e.message);
  console.error('Run scripts/extract-job-template-costs.js first.');
  process.exit(2);
}
if (!seed || !seed.jtCosts || typeof seed.jtCosts !== 'object') {
  console.error('FATAL: ' + IN + ' has no jtCosts map.');
  process.exit(2);
}

/** The public library, for item names/units — a bare key is unfillable. */
function loadPublicLibrary() {
  const win = {};
  win.window = win;
  const sandbox = { window: win, Date, Math, JSON, Set, Object };
  const p = path.join(ROOT, 'docs', 'pro', 'js', 'job-templates-data.js');
  try { vm.runInNewContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: 'job-templates-data.js' }); }
  catch (e) { console.error('FATAL: job-templates-data.js threw — ' + e.message); process.exit(2); }
  return win.NBD_JOB_TEMPLATES || [];
}
const LIBRARY = loadPublicLibrary();
const META = new Map();
LIBRARY.forEach((t) => {
  if (!t || !t.id || !Array.isArray(t.items)) return;
  t.items.forEach((item, i) => {
    const c = item && item.custom;
    if (c && c.name) META.set(jtKey(t.id, i), { template: t.name || t.id, name: c.name, unit: c.unit || 'EA', qty: c.qty });
  });
});

const KEYS = Object.keys(seed.jtCosts).sort();

// ── --worksheet ─────────────────────────────────────────────────────────────
if (WORKSHEET) {
  const OUT = path.resolve(ROOT, arg('--out', path.join('.local', 'jt-cost-rotation.json')));
  const rows = KEYS.map((k) => {
    const m = META.get(k) || {};
    const e = seed.jtCosts[k];
    return {
      key: k,
      template: m.template || '(retired template)',
      item: m.name || '(unknown item)',
      unit: m.unit || '',
      currentMaterialCost: e.materialCost,
      currentLaborCost: e.laborCost,
      // Fill these in. null = keep the current figure.
      materialCost: null,
      laborCost: null,
    };
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    '//': 'Fill in materialCost / laborCost with your CURRENT real figures. ' +
          'null keeps the existing (leaked) value. Then: node scripts/rotate-job-template-costs.js --overrides ' +
          path.relative(ROOT, OUT).replace(/\\/g, '/'),
    rows,
  }, null, 2) + '\n');

  const csv = ['key,template,item,unit,currentMaterialCost,currentLaborCost,materialCost,laborCost']
    .concat(rows.map((r) => [
      r.key,
      JSON.stringify(r.template),
      JSON.stringify(r.item),
      r.unit,
      r.currentMaterialCost,
      r.currentLaborCost,
      '',
      '',
    ].join(',')))
    .join('\n') + '\n';
  const CSV_OUT = OUT.replace(/\.json$/, '.csv');
  fs.writeFileSync(CSV_OUT, csv);

  console.log('rows            : ' + rows.length);
  console.log('OK — wrote ' + OUT);
  console.log('     and       ' + CSV_OUT);
  console.log('\nFill in materialCost / laborCost, then:');
  console.log('  node scripts/rotate-job-template-costs.js --overrides ' + path.relative(ROOT, OUT).replace(/\\/g, '/'));
  process.exit(0);
}

// ── --overrides ─────────────────────────────────────────────────────────────
const OUT = path.resolve(ROOT, arg('--out', path.join('.local', 'jt-cost-seed.rotated.json')));

let sheet;
try { sheet = JSON.parse(fs.readFileSync(path.resolve(ROOT, OVERRIDES), 'utf8')); }
catch (e) { console.error('FATAL: cannot read/parse ' + OVERRIDES + ' — ' + e.message); process.exit(2); }

const rows = Array.isArray(sheet) ? sheet : (sheet && Array.isArray(sheet.rows) ? sheet.rows : null);
if (!rows) {
  console.error('FATAL: ' + OVERRIDES + ' must be an array of rows, or { rows: [...] }.');
  process.exit(2);
}

const next = { version: seed.version || SEED_VERSION, jtCosts: {} };
KEYS.forEach((k) => { next.jtCosts[k] = { materialCost: seed.jtCosts[k].materialCost, laborCost: seed.jtCosts[k].laborCost }; });

const unknownKeys = [];
const badValues = [];
let valuesChanged = 0;
let keysTouched = 0;

rows.forEach((r, i) => {
  const k = r && r.key;
  if (!k) return;
  if (!(k in next.jtCosts)) { unknownKeys.push(k); return; }
  let touched = false;
  ['materialCost', 'laborCost'].forEach((field) => {
    const raw = r[field];
    if (raw === null || raw === undefined || raw === '') return;  // keep current
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) {
      badValues.push('row ' + i + ' (' + k + '): ' + field + ' = ' + JSON.stringify(raw));
      return;
    }
    if (v !== next.jtCosts[k][field]) valuesChanged++;
    next.jtCosts[k][field] = v;
    touched = true;
  });
  if (touched) keysTouched++;
});

const totalValues = KEYS.length * 2;
const coverage = totalValues ? valuesChanged / totalValues : 0;

console.log('seed            : ' + IN);
console.log('overrides       : ' + OVERRIDES);
console.log('entries         : ' + KEYS.length + ' (' + totalValues + ' values)');
console.log('keys touched    : ' + keysTouched);
console.log('values CHANGED  : ' + valuesChanged + '  (' + (coverage * 100).toFixed(1) + '% of the basis)');
if (unknownKeys.length) {
  console.log('  warn: ' + unknownKeys.length + ' override row(s) name a key not in the seed:');
  unknownKeys.slice(0, 8).forEach((k) => console.log('        ' + k));
}
if (badValues.length) {
  console.error('\nFATAL: ' + badValues.length + ' override value(s) are not finite numbers >= 0 — nothing written:');
  badValues.slice(0, 20).forEach((b) => console.error('  ' + b));
  process.exit(2);
}

const { ok, errors, warnings } = validateJtCostOverlay(next, LIBRARY);
warnings.forEach((w) => console.log('  warn: ' + w));
if (!ok) {
  console.error('\nVALIDATION FAILED (' + errors.length + ') — nothing written:');
  errors.slice(0, 40).forEach((e) => console.error('  ' + e));
  process.exit(1);
}

// The point of the exercise, asserted rather than assumed.
if (coverage < MIN_COVERAGE) {
  console.error('\nREFUSING: only ' + (coverage * 100).toFixed(1) + '% of the cost basis changed ' +
                '(floor ' + (MIN_COVERAGE * 100).toFixed(0) + '%).');
  console.error('A rotation that leaves most figures at their leaked values has not devalued the');
  console.error('copies in git history, in forks, or in anyone\'s clone — which is the only reason');
  console.error('this step exists. Fill in more of the worksheet, or lower the floor deliberately');
  console.error('with --min-coverage <0..1> and record that decision in the audit note.');
  process.exit(1);
}

next.rotatedAt = new Date().toISOString();
next.rotationCoverage = Number(coverage.toFixed(4));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(next, null, 2) + '\n');
console.log('\nOK — wrote ' + OUT);
console.log('Stamped rotatedAt=' + next.rotatedAt + ' coverage=' + (coverage * 100).toFixed(1) + '%.');
console.log('Next: node scripts/import-job-template-costs.js --company <companyId>');

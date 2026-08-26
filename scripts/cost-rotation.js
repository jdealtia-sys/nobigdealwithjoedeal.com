#!/usr/bin/env node
/**
 * scripts/cost-rotation.js — generate and apply cost-rotation worksheets for
 * every catalog that publishes a contractor cost basis.
 *
 * Rotation is the half of the leak fix that addresses the copies already out
 * there. The figures are readable forever at their pre-strip commits — in this
 * repo, in every clone, in every fork — so removing them from HEAD stops NEW
 * exposure and nothing else. A history rewrite was assessed and declined.
 *
 * The measurement that settled the design: de-identifying a published baseline
 * by transforming the leaked figures is theatre. Any deterministic transform
 * is invertible by anyone with a clone. So the published baseline does not
 * need to be secret, it needs to be STALE — the historical figures stay as a
 * labelled starter price book, and the shop's ROTATED current figures live in
 * catalogCosts/{companyId}, where they win.
 *
 * WHICH MEANS THIS SCRIPT WILL NOT INVENT A NUMBER. A blanket "scale
 * everything by 7%" would devalue the leaked copies and simultaneously put the
 * shop on fabricated money for live quoting — a worse failure than the leak.
 * Its job is to make supplying real figures cheap, to prove the rotation
 * happened, and to refuse to let a no-op pass as one.
 *
 * Catalogs (see functions/cost-basis-registry.js):
 *   labor  66 labor actions   — rate, hoursPerUnit, crewSize
 *   xact   276 line items     — materialCost, laborCost
 *   v2     28 package entries — cost, labor
 * Job-template costs already have a dedicated pair of scripts from PR-B
 * (extract-/rotate-job-template-costs.js) and are not duplicated here.
 *
 *   node scripts/cost-rotation.js --catalog all --worksheet
 *   # fill in the blank columns with current real figures
 *   node scripts/cost-rotation.js --catalog labor --apply .local/rotation-labor.json
 *   node scripts/import-cost-rotation.js --catalog labor --company <companyId>
 *
 * Output lands under .local/ (gitignored, and tests/catalog-cost-privacy.test.js
 * asserts both that and that no extracted book is ever tracked). Writing any of
 * it back into the repo would recreate the leak.
 *
 * Exit codes: 0 = ok, 1 = validation/coverage failed, 2 = fatal.
 * Zero npm dependencies — Node builtins only.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REG = require(path.join(ROOT, 'functions', 'cost-basis-registry.js'));

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
const APPLY = arg('--apply', null);
const WHICH = arg('--catalog', null);
// A rotation that leaves most figures at their leaked values has devalued
// nothing, which is the only reason this step exists. The floor is arguable;
// having one is not.
const MIN_COVERAGE = Number(arg('--min-coverage', '0.5'));
// Read the catalog from a git ref instead of disk. Needed once a field has
// been migrated OUT of the published file — see readSource().
const FROM = arg('--from', 'worktree');

if (!WHICH) {
  console.error('FATAL: --catalog <' + Object.keys(REG.CATALOGS).join('|') + '|all> is required.');
  process.exit(2);
}
if (!WORKSHEET && !APPLY) {
  console.error('FATAL: pass --worksheet to generate one, or --apply <path> to apply a filled one.');
  process.exit(2);
}
if (APPLY && WHICH === 'all') {
  console.error('FATAL: --apply takes one catalog at a time (a filled sheet belongs to exactly one).');
  process.exit(2);
}

const IDS = WHICH === 'all' ? Object.keys(REG.CATALOGS) : [WHICH];
IDS.forEach((id) => { try { REG.get(id); } catch (e) { console.error('FATAL: ' + e.message); process.exit(2); } });

/**
 * Read one catalog file, from the working tree or from a git ref.
 *
 * `--from <ref>` exists because a MIGRATED field is no longer readable from
 * disk. The labor catalog's crew productivity left the published tree on
 * 2026-08-19, so a worksheet built from the working tree can only offer
 * `rate` — and the tenant's real hoursPerUnit/crewSize, which they may well
 * want in their book, survive only at a pre-strip commit. Without this flag
 * that data is stranded in history with no tool to recover it.
 *
 *   node scripts/cost-rotation.js --catalog labor --worksheet --from <pre-strip-sha>
 */
function readSource(rel) {
  if (FROM === 'worktree') {
    const p = path.join(ROOT, 'docs', rel);
    if (!fs.existsSync(p)) { console.error('FATAL: missing ' + rel); process.exit(2); }
    return fs.readFileSync(p, 'utf8');
  }
  try {
    return execFileSync('git', ['show', FROM + ':docs/' + rel], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.error('FATAL: cannot read docs/' + rel + ' at ' + FROM + ' — ' + e.message);
    process.exit(2);
  }
}

/** Load one catalog's files into a bare window sandbox. */
function loadCatalog(catalog) {
  const win = {};
  win.window = win;
  const sandbox = {
    window: win,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      addEventListener() {}, removeEventListener() {},
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, setAttribute() {} }),
      body: { appendChild() {} },
    },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    navigator: {},
    Date, Math, JSON, Set, Map, Object, isFinite, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.createContext(sandbox);
  catalog.files.forEach((rel) => {
    try { vm.runInContext(readSource(rel), sandbox, { filename: path.basename(rel) }); }
    catch (e) { console.error('FATAL: ' + rel + ' threw while loading at ' + FROM + ' — ' + e.message); process.exit(2); }
  });
  return win;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ── --worksheet ─────────────────────────────────────────────────────────────
if (WORKSHEET) {
  IDS.forEach((id) => {
    const catalog = REG.get(id);
    const win = loadCatalog(catalog);
    const rows = REG.buildWorksheet(catalog, win);
    const out = path.resolve(ROOT, arg('--out', path.join('.local', 'rotation-' + id + '.json')));
    const outPath = IDS.length > 1 ? path.join(ROOT, '.local', 'rotation-' + id + '.json') : out;

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({
      '//': 'Fill in ' + catalog.fields.join(' / ') + ' with your CURRENT real figures. ' +
            'A blank keeps the existing (leaked) value and is reported. Then: ' +
            'node scripts/cost-rotation.js --catalog ' + id + ' --apply .local/rotation-' + id + '.json',
      catalog: id,
      rows,
    }, null, 2) + '\n');

    const cols = ['key', 'item', 'unit']
      .concat(catalog.fields.map((f) => 'current_' + f))
      .concat(catalog.fields);
    const csv = [cols.join(',')]
      .concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')))
      .join('\n') + '\n';
    const csvPath = outPath.replace(/\.json$/, '.csv');
    fs.writeFileSync(csvPath, csv);

    const values = rows.reduce((n, r) => n + catalog.fields.filter((f) => r['current_' + f] != null).length, 0);
    console.log(id.padEnd(6) + ' ' + String(rows.length).padStart(4) + ' rows / ' +
                String(values).padStart(4) + ' values  → ' + path.relative(ROOT, outPath).replace(/\\/g, '/') +
                ' (+ .csv)');
  });
  console.log('\nFill in the blank columns, then apply one catalog at a time:');
  IDS.forEach((id) => console.log('  node scripts/cost-rotation.js --catalog ' + id + ' --apply .local/rotation-' + id + '.json'));
  process.exit(0);
}

// ── --apply ─────────────────────────────────────────────────────────────────
const catalog = REG.get(WHICH);
const win = loadCatalog(catalog);
const OUT = path.resolve(ROOT, arg('--out', path.join('.local', 'rotation-' + WHICH + '.seed.json')));

let sheet;
try { sheet = JSON.parse(fs.readFileSync(path.resolve(ROOT, APPLY), 'utf8')); }
catch (e) { console.error('FATAL: cannot read/parse ' + APPLY + ' — ' + e.message); process.exit(2); }

const rows = Array.isArray(sheet) ? sheet : (sheet && Array.isArray(sheet.rows) ? sheet.rows : null);
if (!rows) { console.error('FATAL: ' + APPLY + ' must be an array of rows, or { rows: [...] }.'); process.exit(2); }
if (sheet && sheet.catalog && sheet.catalog !== WHICH) {
  console.error('FATAL: that sheet is for catalog "' + sheet.catalog + '", not "' + WHICH + '".');
  process.exit(2);
}

const res = REG.applyRotation(catalog, win, rows);
const coverage = res.total ? res.changed / res.total : 0;

console.log('catalog         : ' + catalog.id + ' — ' + catalog.label);
console.log('overrides       : ' + APPLY);
console.log('values          : ' + res.total);
console.log('values CHANGED  : ' + res.changed + '  (' + (coverage * 100).toFixed(1) + '% of the basis)');
if (res.unknownKeys.length) {
  console.log('  warn: ' + res.unknownKeys.length + ' row(s) name a key not in this catalog:');
  res.unknownKeys.slice(0, 8).forEach((k) => console.log('        ' + k));
}
if (res.badValues.length) {
  console.error('\nFATAL: ' + res.badValues.length + ' value(s) are not finite numbers >= 0 — nothing written:');
  res.badValues.slice(0, 20).forEach((b) => console.error('  ' + b));
  process.exit(2);
}

const { ok, errors, warnings } = REG.validateSeed(catalog, res.seed, win);
warnings.forEach((w) => console.log('  warn: ' + w));
if (!ok) {
  console.error('\nVALIDATION FAILED (' + errors.length + ') — nothing written:');
  errors.slice(0, 40).forEach((e) => console.error('  ' + e));
  process.exit(1);
}

if (coverage < MIN_COVERAGE) {
  console.error('\nREFUSING: only ' + (coverage * 100).toFixed(1) + '% of the cost basis changed ' +
                '(floor ' + (MIN_COVERAGE * 100).toFixed(0) + '%).');
  console.error('A rotation that leaves most figures at their leaked values has not devalued the');
  console.error('copies in git history, in forks, or in anyone\'s clone — which is the only reason');
  console.error('this step exists. Fill in more of the worksheet, or lower the floor deliberately');
  console.error('with --min-coverage <0..1> and record that decision in the audit note.');
  process.exit(1);
}

res.seed.rotatedAt = new Date().toISOString();
res.seed.rotationCoverage = Number(coverage.toFixed(4));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(res.seed, null, 2) + '\n');
console.log('\nOK — wrote ' + OUT);
console.log('Stamped rotatedAt=' + res.seed.rotatedAt + ' coverage=' + (coverage * 100).toFixed(1) + '%.');
console.log('Next: node scripts/import-cost-rotation.js --catalog ' + WHICH + ' --company <companyId>');

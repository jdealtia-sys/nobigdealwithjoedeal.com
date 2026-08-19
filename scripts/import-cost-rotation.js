#!/usr/bin/env node
/**
 * scripts/import-cost-rotation.js — load ONE company's rotated cost basis for
 * ONE catalog into Firestore at catalogCosts/{companyId}.
 *
 * Cost data is tenant-owned. Each catalog writes its own map on the tenant's
 * EXISTING cost-book document — laborOps, xactCosts, v2Costs beside the
 * `costs` and `jtCosts` already there — so none of this needs a rules change.
 * firestore.rules already governs every field of that document, and a rules
 * typo is the failure mode that locks a live tenant out of their own money
 * data. See functions/cost-basis-registry.js.
 *
 * ⚠ THIS WRITES TO PROD FIRESTORE. Jo runs this (Claude does not write prod).
 *   Auth: GOOGLE_APPLICATION_CREDENTIALS env var (same as the backfill scripts).
 *
 * ⚠ IT REFUSES AN UNROTATED SEED. The published figures are readable forever at
 *   their pre-strip commits, so importing them unchanged closes the live URL
 *   and leaves the numbers accurate — and leaked cost figures are only worth
 *   something while they are accurate. scripts/cost-rotation.js is the step
 *   that devalues every historical copy. `--unrotated` overrides, and is a
 *   deliberate acceptance of the residual exposure.
 *
 * Run:
 *   node scripts/cost-rotation.js --catalog labor --worksheet
 *   # fill in the blank columns with current real figures
 *   node scripts/cost-rotation.js --catalog labor --apply .local/rotation-labor.json
 *   node scripts/import-cost-rotation.js --catalog labor --company <companyId>        # dry run
 *   node scripts/import-cost-rotation.js --catalog labor --company <companyId> --yes
 *
 * It REFUSES to run over a tenant that already holds that catalog's map (add
 * --force). Firestore's {merge:true} deep-merges nested maps, so re-importing
 * would silently revert every entry the tenant has edited since.
 *
 * EVERY OTHER TENANT gets nothing, on purpose — they keep the published
 * starter baseline until they enter their own figures. That baseline is
 * deliberately still published: it is already public and cannot be recalled,
 * so what closes the leak is this company's actuals no longer being it.
 *
 * Dry run is the DEFAULT. Exit codes: 0 = ok, 1 = validation failed / refused,
 * 2 = fatal.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const REG = require(path.join(ROOT, 'functions', 'cost-basis-registry.js'));

// A following FLAG is not a value — without this, `--company --yes` silently
// consumes '--yes' as the companyId and writes a live book to catalogCosts/--yes.
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

const WHICH = arg('--catalog', null);
const COMPANY = arg('--company', null);
const WRITE = process.argv.includes('--yes');
const FORCE = process.argv.includes('--force');
const UNROTATED_OK = process.argv.includes('--unrotated');
const COLLECTION = 'catalogCosts';

if (!WHICH) {
  console.error('FATAL: --catalog <' + Object.keys(REG.CATALOGS).join('|') + '> is required.');
  process.exit(2);
}
let catalog;
try { catalog = REG.get(WHICH); } catch (e) { console.error('FATAL: ' + e.message); process.exit(2); }

if (!COMPANY) {
  console.error('FATAL: --company <companyId> is required.');
  console.error('There is no platform-wide cost book — costs belong to exactly one tenant.');
  process.exit(2);
}
if (!/^[A-Za-z0-9_-]{1,1500}$/.test(COMPANY)) {
  console.error('FATAL: --company "' + COMPANY + '" is not a plausible companyId.');
  process.exit(2);
}

const IN = path.resolve(ROOT, arg('--in', path.join('.local', 'rotation-' + WHICH + '.seed.json')));
let seed;
try { seed = JSON.parse(fs.readFileSync(IN, 'utf8')); }
catch (e) {
  console.error('FATAL: cannot read/parse ' + IN + ' — ' + e.message);
  console.error('Run: node scripts/cost-rotation.js --catalog ' + WHICH + ' --worksheet');
  process.exit(2);
}

/** Load the live catalog so the seed can be validated against it. */
function loadCatalog() {
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
    const p = path.join(ROOT, 'docs', rel);
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: path.basename(rel) }); }
    catch (e) { console.error('FATAL: ' + rel + ' threw while loading — ' + e.message); process.exit(2); }
  });
  return win;
}

const win = loadCatalog();
const entries = Object.keys(seed[catalog.bookField] || {}).length;

console.log('catalog         : ' + catalog.id + ' — ' + catalog.label);
console.log('seed file       : ' + IN);
console.log('entries         : ' + entries);
console.log('target          : ' + COLLECTION + '/' + COMPANY + '.' + catalog.bookField);
console.log('rotation        : ' + (seed.rotatedAt ? 'rotated ' + seed.rotatedAt +
            ' (' + Math.round((seed.rotationCoverage || 0) * 100) + '% of the basis)' : 'NOT ROTATED'));

if (!seed.rotatedAt && !UNROTATED_OK) {
  console.error('\nREFUSING: this seed carries the published figures unchanged.');
  console.error('They are readable forever at every pre-strip commit — in this repo, in every');
  console.error('clone and in every fork. Importing them unchanged closes nothing that matters:');
  console.error('leaked cost figures are only worth something while they are ACCURATE.');
  console.error('\n  node scripts/cost-rotation.js --catalog ' + WHICH + ' --worksheet');
  console.error('  # fill in current figures');
  console.error('  node scripts/cost-rotation.js --catalog ' + WHICH + ' --apply .local/rotation-' + WHICH + '.json');
  console.error('\nRe-run with --unrotated to accept the residual exposure deliberately.');
  process.exit(1);
}

const { ok, errors, warnings } = REG.validateSeed(catalog, seed, win);
warnings.forEach((w) => console.log('  warn: ' + w));
if (!ok) {
  console.error('\nVALIDATION FAILED (' + errors.length + ') — nothing written:');
  errors.slice(0, 40).forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log('validation      : OK');

if (!WRITE) {
  console.log('\nDRY RUN — no write. Re-run with --yes to import.');
  process.exit(0);
}

// firebase-admin lives in functions/node_modules (scripts/ has none).
let admin;
try { admin = require('firebase-admin'); }
catch (_) { admin = require('module').createRequire(path.join(ROOT, 'functions', 'package.json'))('firebase-admin'); }
if (!admin.apps.length) admin.initializeApp();

(async () => {
  const db = admin.firestore();
  const ref = db.doc(COLLECTION + '/' + COMPANY);
  const before = await ref.get();
  const beforeData = before.exists ? (before.data() || {}) : {};
  const beforeCount = Object.keys(beforeData[catalog.bookField] || {}).length;
  console.log('existing        : ' + (before.exists ? beforeCount + ' ' + catalog.bookField + ' entries' : 'no document'));
  ['costs', 'jtCosts', 'laborOps', 'xactCosts', 'v2Costs']
    .filter((f) => f !== catalog.bookField && beforeData[f])
    .forEach((f) => console.log('  (untouched)   : ' + f + ' — ' + Object.keys(beforeData[f]).length + ' entries'));

  if (beforeCount > 0 && !FORCE) {
    console.error('\nREFUSING: ' + COLLECTION + '/' + COMPANY + ' already holds ' + beforeCount + ' ' + catalog.bookField + ' entries.');
    console.error('This import OVERWRITES every key it carries — Firestore merges nested maps, so');
    console.error('anything the tenant has edited since would be reverted.');
    console.error('Re-run with --force only if replacing their book is what you actually want.');
    process.exit(1);
  }

  // Field-path write, so every OTHER map on this document is provably
  // untouched. This script has no business rewriting a sibling catalog.
  const payload = {};
  payload[catalog.bookField] = seed[catalog.bookField];
  payload[catalog.bookField + 'ImportedAt'] = admin.firestore.FieldValue.serverTimestamp();
  if (!before.exists) payload.version = seed.version || REG.SEED_VERSION;
  await ref.set(payload, { merge: true });

  console.log('\nImported ' + entries + ' entries into ' + COLLECTION + '/' + COMPANY + '.' + catalog.bookField + '.');
  console.log('That company\'s reps pick it up on their next Estimates view.');
  console.log('No other tenant is affected, and no sibling cost map on this document changed.');
  process.exit(0);
})().catch((e) => {
  console.error('FATAL: write failed — ' + e.message);
  process.exit(2);
});

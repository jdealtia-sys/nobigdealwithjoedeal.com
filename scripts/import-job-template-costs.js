/**
 * scripts/import-job-template-costs.js — load ONE company's job-template cost
 * book into Firestore at catalogCosts/{companyId}.jtCosts.
 *
 * This is a MIGRATION tool, not an ongoing publish step. Cost data is
 * tenant-owned: the per-item materialCost/laborCost for job-template custom
 * line items live on the tenant's existing cost-book document, readable only
 * by that tenant's members and writable only by its owner/company_admin
 * (firestore.rules). There is no platform-wide cost seed and nothing is
 * distributed between tenants — see functions/job-template-cost-logic.js.
 *
 * Its one job is the 2026-08-18 cutover: the 84 figures that used to live in
 * docs/pro/js/job-templates-data.js (public repo, public URL) belong to ONE
 * company. This puts them back where they belong, in that company's own book,
 * so nobody loses the numbers they had been quoting off.
 *
 * ⚠ THIS WRITES TO PROD FIRESTORE. Jo runs this (Claude does not write prod).
 *   Auth: GOOGLE_APPLICATION_CREDENTIALS env var (same as the backfill scripts).
 *
 * ⚠ ROTATE FIRST. The extracted seed contains the LEAKED figures verbatim.
 *   They are readable forever in this repo's git history, in every clone and
 *   every fork, so importing them unchanged closes the live URL and leaves the
 *   numbers accurate — and leaked cost figures are only worth something while
 *   they are accurate. scripts/rotate-job-template-costs.js is the step that
 *   devalues every historical copy. This script REFUSES a seed that has not
 *   been through it unless you pass --unrotated and mean it.
 *
 * Run:
 *   node scripts/extract-job-template-costs.js --from <pre-strip-sha>
 *   node scripts/rotate-job-template-costs.js --worksheet
 *   node scripts/rotate-job-template-costs.js --overrides .local/jt-cost-rotation.json
 *   node scripts/import-job-template-costs.js --company <companyId>          # dry run
 *   node scripts/import-job-template-costs.js --company <companyId> --yes
 *
 * It REFUSES to run over a tenant that already has a job-template cost book
 * (add --force to override). Firestore's {merge:true} deep-merges nested maps,
 * so re-importing would silently revert every item the tenant has edited back
 * to the imported figures.
 *
 * `companyId` is the tenant key: the companyId claim, or the owner's uid for a
 * solo operator (the companyId == uid convention used by companyProfile).
 *
 * Dry run is the DEFAULT — the write needs --yes. The book is re-validated
 * against the current working-tree template library first, so an entry for an
 * item that no longer exists warns, and an entry that is non-finite, negative,
 * or zero on BOTH material and labor is refused rather than written.
 *
 * EVERY OTHER TENANT gets nothing, on purpose. Until they have a book, the UI
 * shows "Cost not set" and a complete unpriced scope of work rather than
 * inventing a margin, and a rep prices each line with the $ / unit override.
 * Existing tenants who forked a template before the strip keep their embedded
 * costs — job-templates.js adoptLegacyCosts() lifts them into their own book
 * on first load, provided the person loading it can write it (owner/admin).
 *
 * Exit codes: 0 = ok, 1 = validation failed / refused, 2 = fatal.
 *
 * ⚠ A DRY RUN VERIFIES NOTHING ABOUT THE WRITE PATH. It exits above the
 *   firebase-admin require, so it never loads scripts/_admin.js, never
 *   authenticates and never reaches Firestore — measured, not assumed
 *   (documentation/audit/ADMIN-SCRIPTS-COST-IMPORT-PORT-2026-09-01.md). To
 *   exercise this script end to end without touching prod, point it at the
 *   Firestore emulator: FIRESTORE_EMULATOR_HOST + a demo GCLOUD_PROJECT.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const {
  validateJtCostOverlay, SEED_VERSION,
} = require(path.join(ROOT, 'functions', 'job-template-cost-logic.js'));

// A following FLAG is not a value. Without this, `--company --yes` silently
// consumed '--yes' as the companyId and (because WRITE scans argv separately)
// would have written a live cost book to catalogCosts/--yes.
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
const IN = path.resolve(ROOT, arg('--in', path.join('.local', 'jt-cost-seed.rotated.json')));
const COMPANY = arg('--company', null);
const WRITE = process.argv.includes('--yes');
const FORCE = process.argv.includes('--force');
const UNROTATED_OK = process.argv.includes('--unrotated');
const COLLECTION = 'catalogCosts';

if (!COMPANY) {
  console.error('FATAL: --company <companyId> is required.');
  console.error('There is no platform-wide cost book — costs belong to exactly one tenant.');
  process.exit(2);
}
// Firestore document ids: no slashes, no '..', not empty.
if (!/^[A-Za-z0-9_-]{1,1500}$/.test(COMPANY)) {
  console.error('FATAL: --company "' + COMPANY + '" is not a plausible companyId.');
  console.error('Expected the companyId claim, or the owner uid for a solo operator.');
  process.exit(2);
}

// ── load the book ───────────────────────────────────────────────────────────
let overlay;
try {
  overlay = JSON.parse(fs.readFileSync(IN, 'utf8'));
} catch (e) {
  console.error('FATAL: cannot read/parse ' + IN + ' — ' + e.message);
  console.error('Run scripts/extract-job-template-costs.js, then scripts/rotate-job-template-costs.js.');
  process.exit(2);
}

// ── load the PUBLIC template library it will be merged into ─────────────────
function loadPublicLibrary() {
  const win = {};
  win.window = win;
  const sandbox = { window: win, Date, Math, JSON, Set, Object, console: { log() {} } };
  const p = path.join(ROOT, 'docs', 'pro', 'js', 'job-templates-data.js');
  try {
    vm.runInNewContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: 'job-templates-data.js' });
  } catch (e) {
    console.error('FATAL: job-templates-data.js threw while loading — ' + e.message);
    process.exit(2);
  }
  return win.NBD_JOB_TEMPLATES || [];
}

const publicLibrary = loadPublicLibrary();
const entries = Object.keys((overlay && overlay.jtCosts) || {}).length;

console.log('book file       : ' + IN);
console.log('cost entries    : ' + entries);
console.log('public library  : ' + publicLibrary.length + ' templates');
console.log('target          : ' + COLLECTION + '/' + COMPANY + '.jtCosts');
console.log('rotation        : ' + (overlay && overlay.rotatedAt ? 'rotated ' + overlay.rotatedAt : 'NOT ROTATED'));

// ── the rotation gate ───────────────────────────────────────────────────────
if (!(overlay && overlay.rotatedAt) && !UNROTATED_OK) {
  console.error('\nREFUSING: this seed carries the LEAKED figures unchanged.');
  console.error('They are readable forever at every pre-strip commit — in this repo, in every');
  console.error('clone and in every fork. Removing them from HEAD stops NEW exposure; it does');
  console.error('not un-publish what is already out. Leaked cost figures are only worth');
  console.error('something while they are ACCURATE, so revising the basis is what actually');
  console.error('devalues the copies that exist.');
  console.error('\n  node scripts/rotate-job-template-costs.js --worksheet');
  console.error('  # fill in .local/jt-cost-rotation.json with current figures');
  console.error('  node scripts/rotate-job-template-costs.js --overrides .local/jt-cost-rotation.json');
  console.error('\nIf you have decided the leaked numbers are not worth rotating, re-run with');
  console.error('--unrotated. That is a deliberate acceptance of the residual exposure.');
  process.exit(1);
}

const { ok, errors, warnings } = validateJtCostOverlay(overlay, publicLibrary);
warnings.forEach((w) => console.log('  warn: ' + w));
if (!ok) {
  console.error('\nVALIDATION FAILED (' + errors.length + ') — nothing written:');
  errors.slice(0, 40).forEach((e) => console.error('  ' + e));
  if (errors.length > 40) console.error('  … and ' + (errors.length - 40) + ' more');
  process.exit(1);
}
console.log('validation      : OK');

if (!WRITE) {
  console.log('\nDRY RUN — no write. Re-run with --yes to import.');
  process.exit(0);
}

// ── write ───────────────────────────────────────────────────────────────────
// firebase-admin arrives through scripts/_admin.js, which resolves it out of
// functions/node_modules (scripts/ and the repo root have none) and re-exports
// the modular API. The local createRequire fallback this replaces was one of
// the duplicated resolvers _admin.js exists to collapse.
//
// v14 removed the whole legacy namespace off the default export, so all three
// of the old spellings here were dead: admin.apps, admin.firestore() and
// admin.firestore.FieldValue. getApps()/getFirestore()/FieldValue come from
// the modular subpaths, which _admin re-exports.
//
// Required HERE rather than at the top of the file, on purpose: everything
// above this line runs on a dry run, and keeping the require below the
// dry-run exit means `node scripts/import-job-template-costs.js --company …`
// needs nothing installed at all.
const { initAdmin, getFirestore, FieldValue } = require('./_admin');
// No projectId argument: the target project comes from ADC, exactly as the
// bare admin.initializeApp() this replaces resolved it. initAdmin's default
// credential IS applicationDefault(), which is what initializeApp() picks
// when passed no options.
initAdmin();

(async () => {
  const db = getFirestore();
  const ref = db.doc(COLLECTION + '/' + COMPANY);
  const before = await ref.get();
  const beforeData = before.exists ? (before.data() || {}) : {};
  const beforeCount = Object.keys(beforeData.jtCosts || {}).length;
  const beforeProducts = Object.keys(beforeData.costs || {}).length;
  console.log('existing jtCosts: ' + (before.exists ? beforeCount + ' entries' : 'no document'));
  console.log('existing costs  : ' + beforeProducts + ' product entries (UNTOUCHED by this script)');

  // REFUSE to run over an existing job-template book unless forced.
  //
  // `{merge: true}` does NOT protect a tenant's edits the way it looks like it
  // does: Firestore deep-merges nested maps, so every key present in
  // overlay.jtCosts overwrites whatever the tenant has since entered. Since
  // this is a one-time cutover for a tenant that has no jtCosts yet, the
  // honest guard is to stop rather than to pretend the write is additive.
  if (beforeCount > 0 && !FORCE) {
    console.error('\nREFUSING: ' + COLLECTION + '/' + COMPANY + ' already holds ' + beforeCount + ' jtCosts entries.');
    console.error('This import OVERWRITES every key it carries — Firestore merges nested maps, so');
    console.error('anything the tenant has edited since would be reverted.');
    console.error('Re-run with --force only if replacing their book is what you actually want.');
    process.exit(1);
  }

  // Field-path write, so the tenant's PRODUCT cost book on the same document
  // is provably untouched — this script has no business rewriting `costs`.
  const payload = { jtCosts: overlay.jtCosts, jtImportedAt: FieldValue.serverTimestamp() };
  if (!before.exists) payload.version = overlay.version || SEED_VERSION;
  await ref.set(payload, { merge: true });

  console.log('\nImported ' + entries + ' job-template cost entries into ' + COLLECTION + '/' + COMPANY + '.jtCosts.');
  console.log('That company\'s reps pick it up on their next Estimates / Job Templates view.');
  console.log('No other tenant is affected, and this company\'s product cost book is unchanged.');
  process.exit(0);
})().catch((e) => {
  console.error('FATAL: write failed — ' + e.message);
  process.exit(2);
});

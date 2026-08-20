#!/usr/bin/env node
/**
 * scripts/strip-labor-productivity.js — remove crew productivity from the
 * published labor catalog, and the pre-push gate that keeps it out.
 *
 * WHAT LEAVES, AND WHY ONLY THIS. docs/pro/js/estimate-labor-catalog.js
 * publishes 66 labor actions. Two different kinds of number live on each one:
 *
 *   rate           $/unit. STAYS PUBLISHED, deliberately — it is the starter
 *                  price book a new tenant needs, and a strip would leave the
 *                  estimator inert rather than degraded. What makes it
 *                  harmless is ROTATION (the tenant's current figures live in
 *                  catalogCosts/{companyId}.laborOps and win), not deletion:
 *                  the historical values are public forever regardless, so the
 *                  baseline needs to be stale, not secret.
 *
 *   hoursPerUnit   crew productivity. LEAVES. Measured: read at exactly two
 *   crewSize       sites, both a pass-through in resolveLabor
 *   ratePerManHour (estimate-logic-engine.js:396-397). Nothing customer-facing,
 *                  nothing in pricing, nothing in the payload consumes them, so
 *                  removing them costs a tenant nothing and there is no
 *                  onboarding argument for keeping them.
 *
 * functions/catalog-cost-logic.js already made this exact call for the product
 * catalog: "hoursPerUnit and crewSize ride the private half for that reason
 * alone; they are scheduling data, not price, and nothing public-facing reads
 * them." And this file's own header instructs authors not to disclose the
 * source of the productivity figures — a rule it was breaking by publishing
 * the figures themselves.
 *
 * WHY TEXTUAL. The catalog is one hand-aligned line per entry and reserialising
 * it would rewrite all 66. The risk of a textual edit is that it changes
 * meaning as well as text, so this does not trust itself: after rewriting it
 * re-loads the result and asserts entry-by-entry that every surviving field is
 * byte-identical to the original and that only the unpublished fields are gone.
 *
 * Usage:
 *   node scripts/strip-labor-productivity.js            # rewrite
 *   node scripts/strip-labor-productivity.js --dry-run  # report, write nothing
 *   node scripts/strip-labor-productivity.js --check    # gate
 *
 * Exit codes: 0 = ok, 1 = check/verification failed, 2 = fatal.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const REL = 'docs/pro/js/estimate-labor-catalog.js';
const TARGET = path.join(ROOT, REL);
const REG = require(path.join(ROOT, 'functions', 'cost-basis-registry.js'));
const CATALOG = REG.get('labor');
const GONE = CATALOG.unpublished;

const CHECK = process.argv.includes('--check');
const DRY = process.argv.includes('--dry-run');

function load(src, label) {
  const win = {};
  win.window = win;
  const sandbox = {
    window: win,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console: { log() {}, warn() {}, error() {} },
    Date, Math, JSON, Set, Object,
  };
  try { vm.runInNewContext(src, sandbox, { filename: label }); }
  catch (e) { console.error('FATAL: ' + label + ' threw while loading — ' + e.message); process.exit(2); }
  return (win.NBD_LABOR && win.NBD_LABOR.items) || {};
}

let src;
try { src = fs.readFileSync(TARGET, 'utf8'); }
catch (e) { console.error('FATAL: cannot read ' + REL + ' — ' + e.message); process.exit(2); }

const before = load(src, 'estimate-labor-catalog.js');
const ids = Object.keys(before);

function structuralHits(items) {
  const out = [];
  Object.keys(items).forEach((id) => {
    GONE.forEach((f) => { if (items[id] && items[id][f] !== undefined) out.push(id + '.' + f); });
  });
  return out;
}

// ── --check ────────────────────────────────────────────────────────────────
if (CHECK) {
  const hits = structuralHits(before);
  const textual = GONE.reduce((n, f) => n + (src.match(new RegExp('\\b' + f + '\\s*:', 'g')) || []).length, 0);
  if (!hits.length && textual === 0) {
    console.log('OK — ' + REL + ' publishes no crew productivity (' + ids.length + ' labor actions scanned).');
    process.exit(0);
  }
  console.error('FAIL — ' + REL + ' publishes crew productivity.');
  if (textual) console.error('  ' + textual + ' textual occurrence(s) of ' + GONE.join('/'));
  if (hits.length) console.error('  entries: ' + hits.slice(0, 8).join(', ') + (hits.length > 8 ? ' … +' + (hits.length - 8) : ''));
  console.error('\nCrew productivity is TENANT-OWNED (catalogCosts/{companyId}.laborOps).');
  console.error('docs/ is the Firebase Hosting root on a PUBLIC repo.');
  console.error('Run: node scripts/strip-labor-productivity.js');
  process.exit(1);
}

// ── rewrite ────────────────────────────────────────────────────────────────
const preHits = structuralHits(before);
if (!preHits.length) {
  console.log('Nothing to do — ' + REL + ' already publishes no crew productivity.');
  process.exit(0);
}

let out = src;
// Per-entry fields, e.g. `hoursPerUnit:0.4, ` inside an L({...}) call.
GONE.forEach((f) => {
  out = out.replace(new RegExp('\\b' + f + '\\s*:\\s*[A-Za-z_$][\\w$]*\\s*,\\s*', 'g'), '');
  out = out.replace(new RegExp('\\b' + f + '\\s*:\\s*-?[0-9]+(?:\\.[0-9]+)?\\s*,\\s*', 'g'), '');
  out = out.replace(new RegExp(',\\s*\\b' + f + '\\s*:\\s*(?:-?[0-9]+(?:\\.[0-9]+)?|[A-Za-z_$][\\w$]*)\\s*(?=[}\\]])', 'g'), '');
});
// The two shared constants the L() helper injected. Their only remaining
// references were the defaults just removed.
// `\r?\n`, not `\n`: this tree is CRLF, and `.` does not match `\r`, so a
// `.*\n` tail matches NOTHING and the constant survives the strip silently —
// no error, no diff, just a leftover. Caught on the first real run, which is
// also why the verification below asserts the absence structurally rather
// than trusting the replace to have fired.
out = out.replace(/^[ \t]*const CREW\s*=\s*\d+;.*\r?\n/m, '');
out = out.replace(/^[ \t]*const RATE_PER_MH\s*=\s*\d+;.*\r?\n/m, '');

const linesChanged = (() => {
  const a = src.split(/\r?\n/), b = out.split(/\r?\n/);
  let n = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
})();

// ── verification ───────────────────────────────────────────────────────────
const after = load(out, 'estimate-labor-catalog.js (rewritten)');
const problems = [];
if (Object.keys(after).length !== ids.length) {
  problems.push('entry count ' + Object.keys(after).length + ' != ' + ids.length);
} else {
  ids.forEach((id) => {
    const a = before[id], b = after[id];
    if (!b) { problems.push(id + ': entry vanished'); return; }
    // Every field that was NOT slated for removal must survive byte-identical.
    Object.keys(a).forEach((k) => {
      if (GONE.includes(k)) return;
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
        problems.push(id + '.' + k + ': changed (' + JSON.stringify(a[k]) + ' → ' + JSON.stringify(b[k]) + ')');
      }
    });
    // And nothing new may appear.
    Object.keys(b).forEach((k) => { if (!(k in a)) problems.push(id + '.' + k + ': appeared from nowhere'); });
  });
}
const stillThere = structuralHits(after);
if (stillThere.length) problems.push('still publishing: ' + stillThere.slice(0, 5).join(', '));

// TEXTUAL leftovers, checked separately from the structural pass. A shared
// constant that no longer feeds any entry is invisible to structuralHits() —
// it parses fine and every entry looks clean — but it is still the figure
// published in the file. This is exactly what the CRLF bug above produced.
GONE.forEach((f) => {
  const n = (out.match(new RegExp('\\b' + f + '\\s*:', 'g')) || []).length;
  if (n) problems.push(n + ' textual occurrence(s) of ' + f + ' survive');
});
[['CREW', /\bconst CREW\s*=/], ['RATE_PER_MH', /\bconst RATE_PER_MH\s*=/]].forEach(([name, re]) => {
  if (re.test(out)) problems.push('the shared constant ' + name + ' survives (it is a published figure with no remaining reader)');
});

const ratesKept = Object.keys(after).filter((id) => Number(after[id].rate) > 0).length;

console.log('file            : ' + REL);
console.log('labor actions   : ' + ids.length);
GONE.forEach((f) => console.log('removed ' + f.padEnd(15) + ': ' + preHits.filter((h) => h.endsWith('.' + f)).length));
console.log('rate: KEPT      : ' + ratesKept + '  (the published starter baseline — rotation is what makes it safe)');
console.log('lines changed   : ' + linesChanged);
console.log('verification    : ' + (problems.length ? 'FAILED' : 'every surviving field byte-identical, nothing added'));

if (problems.length) {
  console.error('\nVERIFICATION FAILED — nothing written:');
  problems.slice(0, 10).forEach((p) => console.error('  ' + p));
  process.exit(1);
}
if (DRY) { console.log('\nDRY RUN — nothing written.'); process.exit(0); }

fs.writeFileSync(TARGET, out);
console.log('\nOK — rewrote ' + REL + '.');
console.log('Crew productivity now lives ONLY in catalogCosts/{companyId}.laborOps.');
console.log('Seed a tenant: node scripts/cost-rotation.js --catalog labor --worksheet');

#!/usr/bin/env node
/**
 * scripts/strip-job-template-costs.js — the one-shot codemod that removed
 * materialCost/laborCost from docs/pro/js/job-templates-data.js, and the
 * cheap pre-push gate that keeps them out.
 *
 * WHY TEXTUAL. The data file is one minified line per template. Reserialising
 * it through JSON.stringify would rewrite all 179 lines and make the migration
 * diff unreviewable; a textual edit keeps it to the 49 lines that actually
 * carried a cost, one line per template. The risk of a textual edit is that it
 * changes meaning as well as text, so this script does NOT trust itself: after
 * rewriting it re-loads the result in a vm and asserts, template by template,
 * that the parsed output is EXACTLY stripJtCosts(original) — the executable
 * definition in functions/job-template-cost-logic.js — by JSON.stringify
 * equality, key order included. Nothing but the cost keys may move.
 *
 * Usage:
 *   node scripts/strip-job-template-costs.js            # rewrite the file
 *   node scripts/strip-job-template-costs.js --dry-run  # report, write nothing
 *   node scripts/strip-job-template-costs.js --check    # gate: 0 cost keys
 *
 * `--check` is the pre-push gate. It is cheap and it is a second, independent
 * spelling of what tests/catalog-cost-privacy.test.js enforces — deliberately,
 * because the privacy suite is the thing that already failed to look at this
 * file for a month.
 *
 * Exit codes: 0 = ok, 1 = check failed / verification failed, 2 = fatal.
 * Zero npm dependencies — Node builtins only.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'docs', 'pro', 'js', 'job-templates-data.js');
const REL = 'docs/pro/js/job-templates-data.js';
const {
  JT_PRIVATE_KEYS, stripJtCosts, hasJtPrivateFields,
} = require(path.join(ROOT, 'functions', 'job-template-cost-logic.js'));

const CHECK = process.argv.includes('--check');
const DRY = process.argv.includes('--dry-run');

function loadTemplates(src, label) {
  const win = {};
  win.window = win;
  const sandbox = { window: win, Date, Math, JSON, Set, Object };
  try {
    vm.runInNewContext(src, sandbox, { filename: label });
  } catch (e) {
    console.error('FATAL: ' + label + ' threw while loading — ' + e.message);
    process.exit(2);
  }
  return win.NBD_JOB_TEMPLATES || [];
}

let src;
try { src = fs.readFileSync(TARGET, 'utf8'); }
catch (e) { console.error('FATAL: cannot read ' + REL + ' — ' + e.message); process.exit(2); }

// ── count what is there now ────────────────────────────────────────────────
const occurrences = JT_PRIVATE_KEYS.reduce((acc, k) => {
  acc[k] = (src.match(new RegExp('"' + k + '"\\s*:', 'g')) || []).length;
  return acc;
}, {});
const totalOccurrences = Object.keys(occurrences).reduce((n, k) => n + occurrences[k], 0);

// ── --check: the pre-push gate ─────────────────────────────────────────────
if (CHECK) {
  const before = loadTemplates(src, 'job-templates-data.js');
  const structural = before.filter(hasJtPrivateFields).map((t) => t.id);
  const clean = totalOccurrences === 0 && structural.length === 0;
  if (clean) {
    console.log('OK — ' + REL + ' carries no ' + JT_PRIVATE_KEYS.join('/') + ' (' + before.length + ' templates scanned).');
    process.exit(0);
  }
  console.error('FAIL — ' + REL + ' carries contractor cost data.');
  Object.keys(occurrences).forEach((k) => { if (occurrences[k]) console.error('  "' + k + '": ' + occurrences[k] + ' occurrence(s)'); });
  if (structural.length) console.error('  templates: ' + structural.slice(0, 8).join(', ') + (structural.length > 8 ? ' … +' + (structural.length - 8) : ''));
  console.error('\nCost data is TENANT-OWNED (catalogCosts/{companyId}.jtCosts). docs/ is the');
  console.error('Firebase Hosting root on a PUBLIC repo — anything here is served to anyone.');
  console.error('Run: node scripts/strip-job-template-costs.js');
  process.exit(1);
}

// ── the rewrite ────────────────────────────────────────────────────────────
if (totalOccurrences === 0) {
  console.log('Nothing to do — ' + REL + ' already carries no cost keys.');
  process.exit(0);
}

const before = loadTemplates(src, 'job-templates-data.js');
const expected = before.map(stripJtCosts);

// Two shapes per key, because a cost key can sit mid-object (followed by a
// comma) or last (preceded by one). Today every one of the 84 blocks is
// {name,desc,unit,qty,materialCost,laborCost,category}, i.e. mid-object — but
// a codemod that only handles the shape it happened to meet is how the NEXT
// author gets a syntax error instead of a clean diff.
let out = src;
JT_PRIVATE_KEYS.forEach((k) => {
  out = out.replace(new RegExp('"' + k + '"\\s*:\\s*-?[0-9]+(?:\\.[0-9]+)?\\s*,\\s*', 'g'), '');
  out = out.replace(new RegExp(',\\s*"' + k + '"\\s*:\\s*-?[0-9]+(?:\\.[0-9]+)?\\s*(?=[}\\]])', 'g'), '');
});

const linesChanged = (() => {
  const a = src.split(/\r?\n/), b = out.split(/\r?\n/);
  let n = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
})();

// ── verification: the text edit must equal the structural definition ───────
const after = loadTemplates(out, 'job-templates-data.js (rewritten)');
const mismatches = [];
if (after.length !== expected.length) {
  mismatches.push('template count ' + after.length + ' != ' + expected.length);
} else {
  after.forEach((t, i) => {
    if (JSON.stringify(t) !== JSON.stringify(expected[i])) {
      mismatches.push((t && t.id) || ('index ' + i) + ' does not equal stripJtCosts(original)');
    }
  });
}
const stillPrivate = after.filter(hasJtPrivateFields).map((t) => t.id);
if (stillPrivate.length) mismatches.push('still carries cost keys: ' + stillPrivate.slice(0, 5).join(', '));

console.log('file            : ' + REL);
console.log('templates       : ' + before.length);
Object.keys(occurrences).forEach((k) => console.log('removed "' + k + '" : ' + occurrences[k]));
console.log('lines changed   : ' + linesChanged);
console.log('verification    : ' + (mismatches.length ? 'FAILED' : 'parsed output === stripJtCosts(original), key order included'));

if (mismatches.length) {
  console.error('\nVERIFICATION FAILED — nothing written:');
  mismatches.slice(0, 10).forEach((m) => console.error('  ' + m));
  process.exit(1);
}

if (DRY) {
  console.log('\nDRY RUN — nothing written.');
  process.exit(0);
}

fs.writeFileSync(TARGET, out);
console.log('\nOK — rewrote ' + REL + '.');
console.log('The figures now live ONLY in git history and in whatever seed you extracted');
console.log('with scripts/extract-job-template-costs.js. Rotate them (scripts/');
console.log('rotate-job-template-costs.js) — that is what devalues the historical copies.');

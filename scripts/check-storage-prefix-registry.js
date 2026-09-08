#!/usr/bin/env node
/**
 * check-storage-prefix-registry.js — CI gate for the owner-keyed Storage
 * registry in functions/integrations/user-owned.js.
 *
 * WHY THIS EXISTS
 *
 * STORAGE_PREFIXES drives BOTH halves of GDPR compliance: the Art. 15
 * export (compliance.js `for (const prefix of STORAGE_PREFIXES)`) and the
 * Art. 17 erasure sweep (`bucket.deleteFiles`). A prefix missing from that
 * list is silently absent from both — the user cannot obtain those objects
 * and a right-to-be-forgotten request does not delete them.
 *
 * On 2026-09-08 four were missing at once: `documents`, `esign`,
 * `homeowner-uploads` and `pdf-renders`.
 *
 * The old guard was tests/smoke/auth.test.js asserting the registry was a
 * SUPERSET of a hand-maintained array labelled "all 8 storage.rules
 * prefixes" — while storage.rules defined eleven. Two failure modes, both
 * silently green:
 *
 *   1. A subset check can only catch a prefix that someone remembered to
 *      type into the test's own list. A prefix absent from BOTH the list
 *      and the registry is invisible to it — which is precisely what
 *      happened to all four.
 *   2. The label lied, and nothing checked the label.
 *
 * So this gate DERIVES the truth instead of restating it.
 *
 * TWO SOURCES, DELIBERATELY
 *
 *   A. storage.rules — every `match /<prefix>/{uid}/` block.
 *   B. Write sites in shipped code — `<prefix>/${...uid...}/` path literals
 *      under functions/ and docs/**\/js/.
 *
 * Source A alone is NOT enough, and believing otherwise is what hid two of
 * the four. `pdf-renders/` and `homeowner-uploads/` are written with the
 * ADMIN SDK, which bypasses Security Rules entirely — so neither ever
 * needed a rules block, neither had one, and no amount of reading
 * storage.rules would have revealed them. storage.rules is a registry of
 * what is RULED, not of what EXISTS.
 *
 * Source B alone is not enough either: `galleries/`, `reports/` and
 * `shared_docs/` have rules blocks but no template write site matching the
 * pattern (their writers build paths in ways this scan does not model), so
 * a code-only derivation would call them dead and, with --fix-style
 * thinking, invite someone to delete them from the registry. The union is
 * the answer; neither source is authoritative alone.
 *
 * KNOWN LIMIT (stated, not papered over): source B models the template
 * form `` `foo/${uid}/` `` and the concatenation form `'foo/' + uid`, and
 * skips concatenation lines that are plainly Firestore (`db.doc(`,
 * `db.collection(`, `doc(db,` …). A new Storage prefix built by some third
 * shape — say `path.join(a, b)` — would evade it and would only be caught
 * if it also got a rules block. That is a narrower gap than the one this
 * replaces, not the absence of one.
 *
 * WHAT IT ENFORCES
 *
 *   FAIL — a derived prefix missing from STORAGE_PREFIXES (the export and
 *          erasure gap this exists to prevent)
 *   FAIL — a STORAGE_PREFIXES entry found in neither source (a dead entry:
 *          either the prefix was renamed and erasure now sweeps nothing,
 *          or the writer was deleted and the entry is noise)
 *   FAIL — an ERASURE_RETAINED_PREFIXES entry not in STORAGE_PREFIXES
 *          (retained but not exportable — the worst of both: we keep it
 *          and the data subject cannot even get a copy)
 *   FAIL — ERASURE_STORAGE_PREFIXES disagreeing with the derivation
 *          STORAGE_PREFIXES minus ERASURE_RETAINED_PREFIXES
 *
 * Zero dependencies. Usage:
 *   node scripts/check-storage-prefix-registry.js [--verbose]
 *
 * Also exported as a module so tests/smoke/auth.test.js enforces the same
 * derivation rather than keeping a second hand-maintained copy of it.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

// Directories holding shipped first-party JS that can write to Storage.
// scripts/ is deliberately OUT: those are operator tools, and one of them
// (audit-claim-escalation.js) builds a Firestore path `companies/${uid}/…`
// that would otherwise register as a Storage prefix.
const SCAN_DIRS = ['functions', 'docs/pro/js', 'docs/assets/js', 'docs/admin/js'];
const SKIP_DIRS = new Set(['node_modules', '_archive', 'vendor']);

// The registry module itself defines `leads/{uid}` (NESTED_LEADS_PATH) as a
// FIRESTORE path. It describes the lists; it is not a write site.
const REGISTRY_REL = 'functions/integrations/user-owned.js';

// `foo/${uid}/`, `foo/${window._user.uid}/`, `foo/${tok.ownerUid}/` …
const RE_TEMPLATE = /['"`]([a-z][a-z0-9_-]*)\/\$\{[^}]*[Uu]id[^}]*\}\//g;
// `'foo/' + uid` — the older concatenation shape.
const RE_CONCAT = /['"`]([a-z][a-z0-9_-]*)\/['"`]\s*\+\s*[^+;\n]*[Uu]id/g;
// Concatenation lines that are unambiguously Firestore, not Storage.
const RE_FIRESTORE = /\b(?:db\.doc|db\.collection|db\.recursiveDelete|doc\s*\(\s*db|collection\s*\(\s*db|firestore\.googleapis)/;
// `match /photos/{uid}/{allPaths=**} {`
const RE_RULE = /^\s*match\s+\/([A-Za-z0-9_-]+)\/\{uid\}\//gm;

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(?:js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Source A — owner-keyed `match` blocks in storage.rules. */
function deriveFromRules(rulesText) {
  const found = new Set();
  RE_RULE.lastIndex = 0;
  let m;
  while ((m = RE_RULE.exec(rulesText))) found.add(m[1]);
  return found;
}

/** Source B — `<prefix>/<uid>/` path literals in shipped code. */
function deriveFromCode(root) {
  const sites = new Map(); // prefix -> ['file:line', …]
  const files = [];
  for (const d of SCAN_DIRS) walk(path.join(root, d), files);

  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    if (rel === REGISTRY_REL) continue;
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split(/\r?\n/);
    for (const [re, form] of [[RE_TEMPLATE, 'template'], [RE_CONCAT, 'concat']]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const lineNo = src.slice(0, m.index).split(/\r?\n/).length;
        if (form === 'concat' && RE_FIRESTORE.test(lines[lineNo - 1] || '')) continue;
        if (!sites.has(m[1])) sites.set(m[1], []);
        sites.get(m[1]).push(`${rel}:${lineNo}`);
      }
    }
  }
  return sites;
}

/** The union of both sources — the set of prefixes that demonstrably exist. */
function deriveOwnerKeyedPrefixes(root = REPO_ROOT) {
  const rules = deriveFromRules(
    fs.readFileSync(path.join(root, 'storage.rules'), 'utf8')
  );
  const code = deriveFromCode(root);
  return {
    rules,
    code,
    union: new Set([...rules, ...code.keys()]),
  };
}

function main() {
  const verbose = process.argv.includes('--verbose');
  const { rules, code, union } = deriveOwnerKeyedPrefixes(REPO_ROOT);
  const reg = require(path.join(REPO_ROOT, REGISTRY_REL));

  const listed = reg.STORAGE_PREFIXES || [];
  const retained = reg.ERASURE_RETAINED_PREFIXES || [];
  const erasureScope = reg.ERASURE_STORAGE_PREFIXES || [];
  const errors = [];

  for (const prefix of [...union].sort()) {
    if (listed.includes(prefix)) continue;
    const where = rules.has(prefix) ? ['storage.rules'] : [];
    if (code.has(prefix)) where.push(...code.get(prefix).slice(0, 3));
    errors.push(
      `${prefix}/ exists but is NOT in STORAGE_PREFIXES — it is absent from the\n` +
      `      GDPR export AND the erasure sweep. Seen at: ${where.join(', ')}`
    );
  }

  for (const prefix of listed) {
    if (union.has(prefix)) continue;
    errors.push(
      `${prefix}/ is in STORAGE_PREFIXES but has no storage.rules block and no\n` +
      `      write site — renamed or removed? The erasure sweep is deleting nothing.`
    );
  }

  for (const prefix of retained) {
    if (!listed.includes(prefix)) {
      errors.push(
        `${prefix}/ is in ERASURE_RETAINED_PREFIXES but not STORAGE_PREFIXES — it\n` +
        `      would be retained on erasure AND missing from the export, so the data\n` +
        `      subject could neither delete nor obtain it.`
      );
    }
  }

  const expected = listed.filter(p => !retained.includes(p));
  if (expected.join('|') !== erasureScope.join('|')) {
    errors.push(
      'ERASURE_STORAGE_PREFIXES is not STORAGE_PREFIXES minus\n' +
      `      ERASURE_RETAINED_PREFIXES.\n      expected: ${expected.join(', ')}\n` +
      `      actual:   ${erasureScope.join(', ')}`
    );
  }

  if (verbose || errors.length) {
    console.log(`storage.rules blocks (${rules.size}): ${[...rules].sort().join(', ')}`);
    console.log(`code write sites (${code.size}): ${[...code.keys()].sort().join(', ')}`);
    console.log(`registry STORAGE_PREFIXES (${listed.length}): ${listed.join(', ')}`);
    console.log(`retained on erasure (${retained.length}): ${retained.join(', ') || '(none)'}`);
    console.log('');
  }

  if (errors.length) {
    console.error(`FAIL — owner-keyed Storage registry is out of sync (${errors.length}):\n`);
    for (const e of errors) console.error('  ✗ ' + e + '\n');
    console.error('Fix: add the prefix to STORAGE_PREFIXES in ' + REGISTRY_REL + '.');
    console.error('If it must survive erasure, add it to ERASURE_RETAINED_PREFIXES too');
    console.error('— with the reason written next to it. That is a decision, not a patch.');
    process.exit(1);
  }

  console.log(
    `check-storage-prefix-registry: OK — ${union.size} owner-keyed prefixes, ` +
    `all registered (${retained.length} retained on erasure).`
  );
}

if (require.main === module) main();

module.exports = { deriveOwnerKeyedPrefixes, deriveFromRules, deriveFromCode };

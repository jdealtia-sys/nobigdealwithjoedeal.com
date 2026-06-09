#!/usr/bin/env node
/* Merge ledger-fragments/*.json -> COVERAGE-LEDGER.json
 * Status-PRESERVING: re-running after a gap-fill (or mid-campaign) never resets
 * a row that has already been tested. Atomic write (tmp -> validate -> rename).
 * Usage: node build-ledger.js
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const FRAG = path.join(DIR, 'ledger-fragments');
const LEDGER = path.join(DIR, 'COVERAGE-LEDGER.json');
const SESSION = '2026-06-09-A';

// 1. Read every fragment, derive surface from filename, flatten rows.
const files = fs.readdirSync(FRAG).filter((f) => f.endsWith('.json')).sort();
const rows = [];
const bySurface = {};
const malformed = [];
for (const f of files) {
  const surface = f.replace(/\.json$/, '');
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(FRAG, f), 'utf8')); }
  catch (e) { malformed.push(f + ': ' + e.message); continue; }
  if (!Array.isArray(arr)) { malformed.push(f + ': not an array'); continue; }
  bySurface[surface] = arr.length;
  for (const r of arr) { r.surface = surface; rows.push(r); }
}

// 2. Preserve prior test results by id.
let preserved = 0;
if (fs.existsSync(LEDGER)) {
  const old = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const oldById = {};
  for (const r of (old.rows || [])) oldById[r.id] = r;
  for (const r of rows) {
    const o = oldById[r.id];
    if (o && o.status && o.status !== 'UNTESTED') {
      r.status = o.status; r.evidence = o.evidence || ''; r.notes = o.notes || r.notes; r.session = o.session || r.session;
      preserved++;
    }
  }
  // Carry forward any old row not present in fragments (manual additions).
  const newIds = new Set(rows.map((r) => r.id));
  for (const r of (old.rows || [])) if (!newIds.has(r.id)) { rows.push(r); }
}

// 3. Duplicate-id check.
const seen = {}; const dups = [];
for (const r of rows) { if (seen[r.id]) dups.push(r.id); seen[r.id] = 1; }

// 4. Tallies.
const byStatus = {}; const byDanger = {}; const byType = {};
for (const r of rows) {
  byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  byDanger[r.danger] = (byDanger[r.danger] || 0) + 1;
  byType[r.type] = (byType[r.type] || 0) + 1;
}

const out = {
  meta: {
    title: 'NBD Pro — Exhaustive Functional QA — Coverage Ledger',
    target: 'https://nobigdealwithjoedeal.com/pro (LIVE prod, tenant zero / JD)',
    last_build_session: SESSION,
    total: rows.length,
    by_status: byStatus,
    by_surface: bySurface,
    by_type: byType,
    by_danger: byDanger,
    duplicate_ids: dups,
    malformed_fragments: malformed,
    note: 'Source of truth. Never reset. status: UNTESTED|PASS|FAIL|BLOCKED|FIXED. Re-run build-ledger.js to fold in new fragments without losing test results.',
  },
  rows,
};

const tmp = LEDGER + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
JSON.parse(fs.readFileSync(tmp, 'utf8')); // validate
fs.renameSync(tmp, LEDGER);

console.log('LEDGER BUILT: ' + rows.length + ' rows');
console.log('preserved (already-tested) rows: ' + preserved);
console.log('by_status: ' + JSON.stringify(byStatus));
console.log('by_surface: ' + JSON.stringify(bySurface));
console.log('duplicate_ids: ' + (dups.length ? dups.join(',') : 'none'));
console.log('malformed: ' + (malformed.length ? malformed.join(' | ') : 'none'));

#!/usr/bin/env node
/* Apply a batch of test-result patches to COVERAGE-LEDGER.json atomically.
 * Usage: node ledger-update.js patch.json
 *   patch.json = [ { "id":"d1-chrome-014", "status":"PASS",
 *                    "evidence":"screens/...png", "notes":"..." }, ... ]
 * Only the keys present in each patch are overwritten; unknown ids are reported, not created.
 */
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const LEDGER = path.join(DIR, 'COVERAGE-LEDGER.json');
const SESSION = '2026-06-09-A';
const VALID = new Set(['UNTESTED', 'PASS', 'FAIL', 'BLOCKED', 'FIXED']);

const patchPath = process.argv[2];
if (!patchPath) { console.error('usage: node ledger-update.js patch.json'); process.exit(1); }
const patches = JSON.parse(fs.readFileSync(patchPath, 'utf8'));
const led = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
const byId = {};
for (const r of led.rows) byId[r.id] = r;

const applied = []; const unknown = []; const badStatus = [];
for (const p of patches) {
  const r = byId[p.id];
  if (!r) { unknown.push(p.id); continue; }
  if (p.status !== undefined) {
    if (!VALID.has(p.status)) { badStatus.push(p.id + ':' + p.status); continue; }
    r.status = p.status;
  }
  if (p.evidence !== undefined) r.evidence = p.evidence;
  if (p.notes !== undefined) r.notes = p.notes;
  r.session = p.session || SESSION;
  applied.push(p.id);
}

// recompute tallies
const byStatus = {}; const bySurfaceStatus = {};
for (const r of led.rows) {
  byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  bySurfaceStatus[r.surface] = bySurfaceStatus[r.surface] || {};
  bySurfaceStatus[r.surface][r.status] = (bySurfaceStatus[r.surface][r.status] || 0) + 1;
}
led.meta.by_status = byStatus;
led.meta.by_surface_status = bySurfaceStatus;
led.meta.last_update_session = SESSION;

const tmp = LEDGER + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(led, null, 2));
JSON.parse(fs.readFileSync(tmp, 'utf8'));
fs.renameSync(tmp, LEDGER);

const tested = led.rows.length - (byStatus.UNTESTED || 0);
console.log('applied: ' + applied.length + (unknown.length ? ' | UNKNOWN ids: ' + unknown.join(',') : '') + (badStatus.length ? ' | BAD status: ' + badStatus.join(',') : ''));
console.log('coverage: ' + tested + ' / ' + led.rows.length + ' verified  (' + ((tested / led.rows.length) * 100).toFixed(1) + '%)');
console.log('by_status: ' + JSON.stringify(byStatus));

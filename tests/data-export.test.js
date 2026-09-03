/**
 * tests/data-export.test.js — CSV formula injection (2026-09-03).
 *
 * docs/pro/js/data-export.js writes the rep's own leads and estimates to a
 * .csv he then double-clicks. Until this fix csvEscape quoted only for the
 * separator, the quote and the newline, so a field whose FIRST character was
 * = + - @ TAB or CR shipped verbatim — and Excel and Sheets evaluate such a
 * cell as a formula on open. Lead names, addresses and notes are supplied by
 * strangers through the PUBLIC intake form, which makes that a path from a
 * hostile form submission to code running on the owner's machine, in a file
 * he produced himself and therefore trusts.
 *
 * csvEscape now prefixes the spreadsheet text marker (') and quotes the
 * field. The exemption pinned below is the interesting half: a wholly-numeric
 * value like -1500 is left alone so a credit still reads and sums as a
 * number. This file pins both directions, because a regression in either one
 * is invisible until someone opens an export.
 *
 * DataExport is a Tranche-0 name (tests/smoke/dashboard.test.js), so there is
 * deliberately nothing on window to poke at — everything here is driven
 * through the real entry points, window.exportLeadsCsv /
 * window.exportEstimatesCsv, and read back off the Blob they hand the
 * download anchor.
 *
 * Zero deps. Run: node tests/data-export.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; fails.push(label); }
}

// ── Minimal DOM + Blob/URL so downloadCsv runs and we can read the file ──
function makeEl() {
  return {
    href: '', download: '', style: {}, dataset: {},
    click() {}, appendChild() {}, removeChild() {},
    addEventListener() {}, removeEventListener() {},
  };
}

let lastCsv = null;   // text of the most recent export
let lastName = null;  // filename it was offered under

function Blob(parts) { this.text = parts.join(''); lastCsv = this.text; }

const anchor = makeEl();
const win = { location: { href: '', pathname: '/pro/dashboard' } };
win.window = win;

const _ls = {};
const localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};

const sandbox = {
  window: win,
  document: {
    createElement: () => { lastName = null; return anchor; },
    body: { appendChild(a) { lastName = a.download; }, removeChild() {} },
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null,
  },
  // data-export.js reads localStorage un-namespaced, not off window.
  localStorage,
  Blob,
  URL: { createObjectURL: () => 'blob:nbd', revokeObjectURL() {} },
  // The cleanup timer is a no-op so nothing keeps the loop alive.
  setTimeout: () => 0, clearTimeout: () => 0,
  console: { log() {}, warn() {}, error() {} },
  Date, Math, JSON, Object, Array, String, Number, isNaN, encodeURIComponent,
};

const SRC_PATH = path.join(__dirname, '..', 'docs/pro/js/data-export.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');
vm.runInNewContext(src, sandbox, { filename: 'data-export.js' });

// ── A real RFC-4180 reader. Parsing (rather than string-matching) is the
// point: it proves the added marker never breaks the column, because a
// neutralizer that leaked out of its cell would shift every field after it.
function parseCsv(text) {
  const s = text.replace(/^﻿/, '');
  const rows = []; let row = []; let field = ''; let inQ = false; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r' && s[i + 1] === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; i += 2; continue;
    }
    field += c; i++;
  }
  row.push(field); rows.push(row);
  return rows;
}

// Column order is LEAD_HEADERS' order; index by label so a future column
// insert doesn't silently re-point these assertions at the wrong field.
function col(rows, label) { return rows[0].indexOf(label); }

// ── The export under test: one lead carrying every hostile shape ──────────
const HOSTILE = {
  id: 'L1',
  customerId: 'NBD-1001',
  firstName:  '=cmd|\' /C calc\'!A0',      // classic DDE payload
  lastName:   '+SUM(1+1)*cmd|\' /C calc\'!A0',
  address:    '-2+3+cmd|\' /C calc\'!A0',
  phone:      '@SUM(1+1)',
  email:      'jane=doe@example.com',       // contains = but doesn't start with it
  stage:      'contacted',
  jobType:    'roof',
  source:     '\tleading tab',              // 0x09 leader
  damageType: 'hail',
  jobValue:   -1500,                        // a credit — must stay a number
  claimNumber: 'C-77',
  insCarrier: 'State Farm, Inc. "SF"',      // comma + quotes
  claimStatus: '\rleading cr',              // 0x0D leader
  notes:      'line one\nline two',         // embedded newline
};

win._leads = [HOSTILE];
win.exportLeadsCsv();

const csv = lastCsv;
const rows = parseCsv(csv);
const r = rows[1];

console.log('\nCSV FORMULA INJECTION — leads export');
ok('export produced a file', typeof csv === 'string' && csv.length > 0);
ok('filename is the nbd-leads-YYYY-MM-DD.csv pattern',
  /^nbd-leads-\d{4}-\d{2}-\d{2}\.csv$/.test(lastName || ''));
ok('BOM still prepended (Excel for Windows reads it as UTF-8)', csv.charCodeAt(0) === 0xFEFF);
ok('exactly one header row + one data row', rows.length === 2);
ok('no column drift — data row has as many fields as the header',
  r.length === rows[0].length);

console.log('\nNEUTRALIZED — dangerous leaders get the text marker');
ok('= leader marked',  r[col(rows, 'First Name')] === "'" + HOSTILE.firstName);
ok('+ leader marked',  r[col(rows, 'Last Name')] === "'" + HOSTILE.lastName);
ok('- leader marked (expression, not a number)',
  r[col(rows, 'Address')] === "'" + HOSTILE.address);
ok('@ leader marked',  r[col(rows, 'Phone')] === "'" + HOSTILE.phone);
ok('TAB leader marked', r[col(rows, 'Source')] === "'\tleading tab");
ok('CR leader marked',  r[col(rows, 'Claim Status')] === "'\rleading cr");
// The marker must live inside quotes or it can be read as part of the
// column structure rather than the cell.
ok('marked field is quoted', csv.indexOf('"\'=cmd|\' /C calc\'!A0"') >= 0);

console.log('\nUNTOUCHED — legitimate values must not be mangled');
ok('= not in first position is left alone',
  r[col(rows, 'Email')] === 'jane=doe@example.com');
ok('...and is not needlessly quoted', csv.indexOf(',jane=doe@example.com,') >= 0);
ok('a negative number still reads as a number to a human',
  r[col(rows, 'Job Value')] === '-1500');
ok('...emitted bare, no marker and no quotes', csv.indexOf(',hail,-1500,C-77,') >= 0);
ok('ordinary text unchanged', r[col(rows, 'Stage')] === 'contacted');
ok('ordinary text unquoted', csv.indexOf(',contacted,roof,') >= 0);

console.log('\nNO REGRESSION — RFC-4180 quoting still works');
ok('comma + embedded quotes survive a round trip',
  r[col(rows, 'Carrier')] === 'State Farm, Inc. "SF"');
ok('internal quotes are doubled on the wire',
  csv.indexOf('"State Farm, Inc. ""SF"""') >= 0);
ok('embedded newline survives inside one field',
  r[col(rows, 'Notes')] === 'line one\nline two');

console.log('\nHEADER LINE');
ok('header labels present and intact',
  rows[0][0] === 'Customer ID' && rows[0].indexOf('Claim #') >= 0);
// The header row is built from the same csvEscape as the data rows, so it is
// covered by construction. Pinned at the source because today's labels are
// all hard-coded and safe — the day someone adds a user-named column, this is
// what stops it shipping through an unescaped path.
ok('header line routes through csvEscape (no second, unguarded path)',
  /headerLine\s*=\s*headers\.map\(\s*h\s*=>\s*csvEscape\(/.test(src));
ok('csvEscape is the single choke point — data rows use it too',
  /lines\.push\(headers\.map\(\s*h\s*=>\s*csvEscape\(/.test(src));

console.log('\nESTIMATES EXPORT — the joined leadName column too');
// leadName is derived from lead data, so it needs the same guard as the
// lead export's own columns; a payload in firstName reaches this file as well.
win._leads = [{ id: 'L9', firstName: '=HYPERLINK("http://evil","click")', lastName: 'Roe' }];
win._estimates = [{ id: 'E1', leadId: 'L9', status: 'sent', total: 250000, lineItems: [] }];
win.exportEstimatesCsv();
const erows = parseCsv(lastCsv);
ok('estimates file offered under the estimates name',
  /^nbd-estimates-\d{4}-\d{2}-\d{2}\.csv$/.test(lastName || ''));
ok('no column drift in the estimates row', erows[1].length === erows[0].length);
ok('joined lead name is neutralized',
  erows[1][erows[0].indexOf('Lead Name')] === '\'=HYPERLINK("http://evil","click") Roe');
ok('estimate total unaffected', erows[1][erows[0].indexOf('Total')] === '250000');

console.log('\nEVERY CSV ESCAPER IN THE CRM — one policy, no drift');
{
  // The neutralizer exists in THREE places. That is a deliberate tradeoff —
  // the three modules load independently across two pages, so a shared helper
  // would mean a new file plus load-order wiring — but three copies means
  // three chances to diverge on which leading characters are dangerous.
  //
  // This assertion exists because the first cut of this fix patched only
  // data-export.js. The Settings → Access → Data Retention button ("Export
  // All Leads (CSV)") stayed fully injectable over the same window._leads,
  // one panel away, and the PR would have claimed the hole was closed.
  const COPIES = [
    ['docs/pro/js/data-export.js', 'csvEscape'],
    ['docs/pro/js/dashboard-bootstrap.module.js', '_csvEscape'],
    ['docs/pro/js/expenses.js', 'the expense export escaper'],
  ];
  const CLASS = '^[=+\\-@\\t\\r]';
  for (const [rel, label] of COPIES) {
    const body = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    ok(rel.split('/').pop() + ' (' + label + ') neutralizes the same leading characters',
       body.indexOf(CLASS) !== -1, 'expected the class ' + CLASS);
  }
}

console.log('\nROUND TRIP — the marker must not survive re-import');
{
  // data-import.js round-trips this exact CSV (its HEADER_ALIASES match
  // LEAD_HEADERS label for label), so the export marker has to come back off
  // on the way in. The common case is not an attack — it is an ordinary
  // dash-bulleted note re-imported with an apostrophe welded on, permanently,
  // with CI green the whole time.
  const imp = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/data-import.js'), 'utf8');
  const m = imp.match(/val = val\.replace\((\/[^/]+\/)\s*,\s*''\)/);
  ok('data-import strips the export marker', !!m);
  // It must be lookahead-guarded, not a blanket leading-quote trim, or it
  // eats a real apostrophe out of the user's own data.
  ok('the strip is lookahead-guarded', !!m && m[1].indexOf('(?=') !== -1);
  if (m) {
    const re = new RegExp(m[1].slice(1, -1));
    ok('strips the marker off a bulleted note',
       "'- called 3x".replace(re, '') === '- called 3x');
    ok('strips the marker off a neutralized payload',
       "'=cmd|' /C calc'!A0".replace(re, '') === "=cmd|' /C calc'!A0");
    ok('leaves a genuine leading apostrophe alone',
       "'96 Chevy in the driveway".replace(re, '') === "'96 Chevy in the driveway");
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }

/**
 * tests/lead-trades-unknown.test.js — a lead edit must never overwrite the
 * stored lead.trades with [] when the trade-chip state is UNKNOWN.
 *
 * The bug (fail-open audit, 2026-09-18): saveLead() (docs/pro/js/crm-leads.js)
 * always sent `trades`, defaulting to [] when the registry helper was missing,
 * and getSelectedTrades() (dashboard-bootstrap.module.js) also returned []
 * whenever no .trade-chip had been drawn. The chips render only once
 * refreshSubTypeAndTrades sees a non-empty job type, so editing a lead whose
 * job type is "Not Set" never draws them, setSelectedTrades has nothing to
 * reflect the stored trades onto, and the edit payload — spread straight into
 * updateDoc — wiped the lead's trades with a "Lead saved!" toast. Six lines
 * up, the same payload already OMITS `stage` when its source is blank for
 * exactly this reason.
 *
 * Now: getSelectedTrades() returns null ("unknown") when no chip exists, and
 * saveLead omits the key unless it gets a real array. A user who deliberately
 * clears every chip still saves [].
 *
 * Both halves run for real: getSelectedTrades is lifted out of the bootstrap
 * module (it only touches `document`), and crm-leads.js is vm-loaded whole
 * with a stub lead form so window._saveLead receives the real payload.
 *
 * Zero deps. Run: node tests/lead-trades-unknown.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const LEADS_SRC = fs.readFileSync(path.join(ROOT, 'docs/pro/js/crm-leads.js'), 'utf8');
const BOOT_SRC = fs.readFileSync(path.join(ROOT, 'docs/pro/js/dashboard-bootstrap.module.js'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function assert(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('extractFn: ' + name + ' not found');
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) throw new Error('extractFn: unbalanced braces reading ' + name);
  return src.slice(start, i);
}

// A #lTradesGroup stand-in. chips: [{ value, selected }]; null = no group at all.
function tradesGroup(chips) {
  const els = chips.map((c) => ({ dataset: { value: c.value, selected: c.selected ? '1' : '0' } }));
  return {
    querySelector(sel) { return sel === '.trade-chip' ? (els[0] || null) : null; },
    querySelectorAll(sel) {
      if (sel === '.trade-chip[data-selected="1"]') return els.filter((e) => e.dataset.selected === '1');
      if (sel === '.trade-chip') return els;
      return [];
    },
  };
}

// The REAL getSelectedTrades, bound to a document whose #lTradesGroup is `group`.
function realGetSelectedTrades(group) {
  const ctx = { document: { getElementById: (id) => (id === 'lTradesGroup' ? group : null) } };
  vm.createContext(ctx);
  vm.runInContext(extractFn(BOOT_SRC, 'getSelectedTrades') + '\nglobalThis.__fn = getSelectedTrades;', ctx);
  return ctx.__fn;
}

// vm-load crm-leads.js and run the real saveLead() against a stub lead form.
// registry: the __NBD_CALL_REGISTRY object to expose (undefined = none).
async function runSaveLead(registry) {
  const el = (v) => ({ value: v, checked: false, style: {}, textContent: '', focus() {}, scrollIntoView() {}, addEventListener() {} });
  const fields = { lFname: el('Jane'), lAddr: el('1 Main St'), lEditId: el('lead-1'), lStage: el('new'), lJobType: el('') };
  const shared = {};
  const document = {
    getElementById: (id) => fields[id] || shared[id] || (shared[id] = el('')),
    querySelector: (sel) => (sel === '#leadModal .msave' ? (shared.__btn = shared.__btn || { disabled: false, textContent: 'Save' }) : null),
    addEventListener() {},
    dispatchEvent() {},
  };
  const payloads = [];
  const win = {
    db: {}, collection() {}, addDoc() {}, updateDoc() {}, deleteDoc() {}, doc() {}, getDoc() {}, getDocs() {},
    where() {}, orderBy() {}, query() {}, serverTimestamp() {}, arrayUnion() {},
    _saveLead: async (data) => { payloads.push(data); return data.id; },
  };
  if (registry !== undefined) win.__NBD_CALL_REGISTRY = registry;
  const sandbox = {
    window: win, document, console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0, clearTimeout() {}, CustomEvent: function () {},
  };
  vm.createContext(sandbox);
  vm.runInContext(LEADS_SRC, sandbox, { filename: 'crm-leads.js' });
  await sandbox.saveLead();
  return payloads[0];
}

(async () => {
  console.log('LEAD TRADES — unknown chip state never overwrites stored trades');

  // ── getSelectedTrades (dashboard-bootstrap.module.js) ──
  assert('getSelectedTrades: no chip ever rendered → null (unknown), not []',
    realGetSelectedTrades(tradesGroup([]))() === null);
  assert('getSelectedTrades: no #lTradesGroup at all → null',
    realGetSelectedTrades(null)() === null);
  const cleared = realGetSelectedTrades(tradesGroup([{ value: 'roofing' }, { value: 'gutters' }]))();
  assert('getSelectedTrades: chips rendered, user cleared every one → [] (a real "none")',
    Array.isArray(cleared) && cleared.length === 0);
  const picked = realGetSelectedTrades(tradesGroup([{ value: 'roofing', selected: true }, { value: 'siding' }, { value: 'gutters', selected: true }]))();
  assert('getSelectedTrades: returns exactly the selected chip values',
    JSON.stringify(picked) === JSON.stringify(['roofing', 'gutters']));

  // ── saveLead payload (crm-leads.js), fed by the REAL getSelectedTrades ──
  {
    const p = await runSaveLead({ getSelectedTrades: realGetSelectedTrades(tradesGroup([])) });
    assert('edit with "Not Set" job type (chips never drawn): payload reached _saveLead', !!p && p.id === 'lead-1');
    assert('edit with chips never drawn: `trades` key is OMITTED (stored trades untouched)', !!p && !('trades' in p));
  }
  {
    const p = await runSaveLead({ getSelectedTrades: realGetSelectedTrades(tradesGroup([{ value: 'roofing' }])) });
    assert('user cleared every chip: payload carries trades: []', !!p && Array.isArray(p.trades) && p.trades.length === 0);
  }
  {
    const p = await runSaveLead({ getSelectedTrades: realGetSelectedTrades(tradesGroup([{ value: 'roofing', selected: true }])) });
    assert('chips selected: payload carries them', !!p && JSON.stringify(p.trades) === JSON.stringify(['roofing']));
  }
  {
    const p = await runSaveLead({});
    assert('registry present but getSelectedTrades missing (stale cached bootstrap): key omitted', !!p && !('trades' in p));
  }
  {
    const p = await runSaveLead(undefined);
    assert('no registry at all: key omitted', !!p && !('trades' in p));
  }
  {
    const p = await runSaveLead({ getSelectedTrades: () => 'garbage' });
    assert('non-array answer from the helper: key omitted, never written', !!p && !('trades' in p));
  }
  {
    // Sanity: the neighbouring payload fields are untouched by the new spread.
    const p = await runSaveLead({ getSelectedTrades: () => null });
    assert('stage still written when the select has a value', !!p && p.stage === 'new');
  }

  console.log('');
  if (failed) {
    console.log('FAIL — ' + passed + ' passed, ' + failed + ' failed:');
    fails.forEach((f) => console.log('   ✗ ' + f));
    process.exit(1);
  } else {
    console.log('PASS — ' + passed + ' assertions');
  }
})().catch((e) => { console.log('FAIL — harness error: ' + (e && e.stack || e)); process.exit(1); });

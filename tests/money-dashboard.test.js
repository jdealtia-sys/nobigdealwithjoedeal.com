/**
 * tests/money-dashboard.test.js — pure P&L computation for the #/money view.
 * Loads money-dashboard.js in a vm sandbox and exercises computePnL (no DOM/FB).
 * Run: node tests/money-dashboard.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }
function eq(name, a, b) { ok(name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')', a === b); }

function loadIIFE(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js', file), 'utf8');
  const win = { addEventListener() {}, location: { pathname: '/pro/dashboard' } };
  win.window = win;
  const sandbox = {
    window: win,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, Math, JSON,
  };
  vm.runInNewContext(src, sandbox, { filename: file });
  return win;
}

const win = loadIIFE('money-dashboard.js');
const MD = win.MoneyDashboard;

console.log('MONEY DASHBOARD — computePnL');
ok('MoneyDashboard.computePnL exported', !!(MD && MD.computePnL));

const data = {
  year: 2026,
  leads: [
    { id: 'L1', _stageKey: 'closed', jobValue: 20000 }, // won + costed
    { id: 'L2', _stageKey: 'closed', jobValue: 10000 }, // won, NOT costed (excluded from margin)
    { id: 'L3', _stageKey: 'new', jobValue: 5000 },     // not won
  ],
  expenses: [
    { category: 'materials', costType: 'direct', amountCents: 500000, leadId: 'L1', supplier: 'ABC', date: new Date(2026, 1, 1) },
    { category: 'subcontractor', costType: 'direct', amountCents: 300000, supplier: 'Crew Co', date: new Date(2026, 2, 1) }, // no leadId
    { category: 'marketing', costType: 'overhead', amountCents: 100000, supplier: 'Google', date: new Date(2026, 1, 1) },
    { category: 'materials', costType: 'direct', amountCents: 999, supplier: 'Old', date: new Date(2025, 1, 1) }, // prior year — excluded
  ],
  invoices: [
    { status: 'paid', paidAt: new Date(2026, 2, 1), total: 12000 },
    { status: 'paid', paidAt: new Date(2025, 2, 1), total: 5000 }, // prior year — excluded from collected
    { status: 'sent', total: 4000, balanceDue: 4000 },             // outstanding
  ],
  suppliers: [
    { displayName: 'Crew Co', is1099Eligible: true, w9Status: 'received' }, // YTD sub $3000 >= $2000 -> 1099 due
    { displayName: 'ABC', is1099Eligible: false, w9Status: 'verified' },    // materials supplier, not eligible
  ],
};
const m = MD.computePnL(data);

console.log('  cash:');
eq('collected 2026 only ($12,000)', m.collectedCents, 1200000);
eq('spent 2026 only ($9,000; prior-year excluded)', m.spentCents, 900000);
eq('net cash = collected - spent', m.netCashCents, 300000);
eq('outstanding A/R ($4,000 unpaid)', m.outstandingCents, 400000);
console.log('  COGS / overhead:');
eq('COGS = direct (materials+sub)', m.cogsCents, 800000);
eq('overhead', m.overheadCents, 100000);
console.log('  job profitability:');
eq('won contract value (costed jobs only)', m.wonContractCents, 2000000);
eq('won direct (by-lead, only L1)', m.wonDirectCents, 500000);
eq('gross margin 75%', m.grossMargin, 75);
eq('costed jobs', m.costedJobs, 1);
eq('won jobs total', m.wonJobs, 2);
console.log('  suppliers / 1099:');
eq('top supplier is ABC', m.topSuppliers[0].supplier, 'ABC');
eq('supplier count (this year)', m.supplierCount, 3);
eq('1099 due count', m.due1099, 1);
eq('1099 due service $ (Crew Co $3,000)', m.due1099Cents, 300000);
eq('2026 threshold is $2,000', m.thresholdCents, 200000);

// empty safety
const empty = MD.computePnL({});
eq('empty collected 0', empty.collectedCents, 0);
eq('empty gross margin null', empty.grossMargin, null);

console.log('\n' + (failed === 0 ? '✓' : '✗') + ' money dashboard: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { console.error('FAILED: ' + fails.join(', ')); process.exit(1); }

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
    { category: 'subcontractor', costType: 'direct', amountCents: 300000, supplier: 'Crew Co, LLC', date: new Date(2026, 2, 1) }, // no leadId; name VARIANT (tests normVendor)
    { category: 'marketing', costType: 'overhead', amountCents: 100000, supplier: 'Google', date: new Date(2026, 1, 1) },
    { category: 'materials', costType: 'direct', amountCents: 999, supplier: 'Old', date: new Date(2025, 1, 1) }, // prior year — excluded
  ],
  invoices: [
    { status: 'paid', paidAt: new Date(2026, 2, 1), total: 12000 },
    { status: 'paid', paidAt: new Date(2025, 2, 1), total: 5000 }, // prior year — excluded from collected
    { status: 'sent', total: 4000, balanceDue: 4000 },             // fully outstanding
    // REAL partial-deposit shape markPaid/webhook produce: status stays 'sent'
    // (not 'partial'), paidAt is NULL (only set on full payoff), lastPaymentAt
    // carries the receipt date. The old fixture faked {status:'partial',
    // paidAt:set} — a shape the code never writes — which false-greened the
    // paidAt-gated Collected bug (deposits invisible). $600 collected, $400 due.
    { status: 'sent', total: 1000, balanceDue: 400, amountPaid: 600, lastPaymentAt: new Date(2026, 3, 1) },
  ],
  suppliers: [
    { displayName: 'Crew Co', is1099Eligible: true, w9Status: 'received' }, // YTD sub $3000 >= $2000 -> 1099 due
    { displayName: 'ABC', is1099Eligible: false, w9Status: 'verified' },    // materials supplier, not eligible
  ],
};
const m = MD.computePnL(data);

console.log('  cash:');
eq('collected 2026: $12,000 + $600 partial = $12,600', m.collectedCents, 1260000);
eq('spent 2026 only ($9,000; prior-year excluded)', m.spentCents, 900000);
eq('net cash = collected - spent', m.netCashCents, 360000);
eq('outstanding A/R: $4,000 + $400 partial balance', m.outstandingCents, 440000);
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

// ── tax-included COGS + normVendor collapse (product decision 2026-07-08) ──
console.log('  tax-included spend/COGS + supplier normVendor:');
const t = MD.computePnL({
  year: 2026,
  leads: [{ id: 'J1', _stageKey: 'closed', jobValue: 10000 }],
  invoices: [], suppliers: [],
  expenses: [
    // same vendor two spellings → ONE supplier row; tax rides into spend/COGS
    { category: 'materials', costType: 'direct', amountCents: 100000, taxCents: 8000, leadId: 'J1', supplier: 'ABC Supply', date: new Date(2026, 5, 1) },
    { category: 'materials', costType: 'direct', amountCents: 50000, taxCents: 4000, leadId: 'J1', supplier: 'abc supply ', date: new Date(2026, 6, 1) },
  ],
});
eq('spent = amount + tax', t.spentCents, 162000);
eq('COGS = amount + tax', t.cogsCents, 162000);
eq('won direct (per-job) includes tax', t.wonDirectCents, 162000);
eq('two spellings collapse to ONE supplier row', t.supplierCount, 1);
eq('supplier label = first-seen raw name', t.topSuppliers[0].supplier, 'ABC Supply');
eq('supplier total includes tax', t.topSuppliers[0].cents, 162000);

// ── ET-year bucketing (#11): 2026-01-01T00:30Z is 2025-12-31 in ET ──
console.log('  ET-year boundary:');
const etData = MD.computePnL({
  year: 2026, leads: [], invoices: [], suppliers: [],
  expenses: [{ category: 'materials', costType: 'direct', amountCents: 10000, supplier: 'X', date: new Date('2026-01-01T00:30:00Z') }],
});
eq('Jan-1 00:30 UTC buckets to 2025 in ET → excluded from 2026 spend', etData.spentCents, 0);

// ── stageRole precedence (freeform-pipeline foundation) ──
// isWon() reads the denormalized _stageRole first (custom-stage-safe), and
// only falls back to the legacy WON_STAGES key list when it's absent.
console.log('  stageRole precedence:');
const roleData = MD.computePnL({
  year: 2026, invoices: [], suppliers: [], expenses: [
    { category: 'materials', costType: 'direct', amountCents: 100000, leadId: 'CU', date: new Date(2026, 5, 1) },
  ],
  leads: [
    // custom won stage (unknown key) counts as won via _stageRole
    { id: 'CU', _stageKey: 'my_custom_done', _stageRole: 'won', jobValue: 10000 },
    // legacy-won key but role says active → NOT won (tenant remapped it)
    { id: 'RM', _stageKey: 'closed', _stageRole: 'active', jobValue: 99999 },
    // no _stageRole → falls back to the legacy key list (closed = won)
    { id: 'LG', _stageKey: 'closed', jobValue: 5000 },
  ],
});
eq('custom won-role stage is counted (wonJobs incl CU + LG, not RM)', roleData.wonJobs, 2);
eq('custom won lead contributes contract value', roleData.wonContractCents >= 1000000, true);

// ── Multi-payment cash ledger (post-sprint residual of #980/#990) ──
// A deposit in year Y and a balance payoff in year Y+1 must keep the deposit
// in Y's Collected — lastPaymentAt alone moves the whole invoice's cash to Y+1.
console.log('  multi-payment cash-basis dating:');
const multi = MD.computePnL({
  year: 2026, leads: [], expenses: [], suppliers: [],
  invoices: [
    {
      status: 'paid', total: 10000, balanceDue: 0, amountPaid: 10000,
      // lastPaymentAt is the LATER payoff — must NOT pull the May deposit into 2027
      lastPaymentAt: new Date(2027, 6, 1),
      paidAt: new Date(2027, 6, 1),
      payments: [
        { amount: 4000, at: new Date(2026, 4, 15) }, // May 2026 deposit
        { amount: 6000, at: new Date(2027, 6, 1) },  // July 2027 balance
      ],
    },
  ],
});
eq('2026 collected = May deposit only ($4,000), not full invoice', multi.collectedCents, 400000);

const multi27 = MD.computePnL({
  year: 2027, leads: [], expenses: [], suppliers: [],
  invoices: [
    {
      status: 'paid', total: 10000, balanceDue: 0, amountPaid: 10000,
      lastPaymentAt: new Date(2027, 6, 1),
      paidAt: new Date(2027, 6, 1),
      payments: [
        { amount: 4000, at: new Date(2026, 4, 15) },
        { amount: 6000, at: new Date(2027, 6, 1) },
      ],
    },
  ],
});
eq('2027 collected = July balance only ($6,000)', multi27.collectedCents, 600000);

// Legacy single-lump still works when payments[] is absent.
const legacy = MD.computePnL({
  year: 2026, leads: [], expenses: [], suppliers: [],
  invoices: [
    { status: 'sent', total: 1000, balanceDue: 400, amountPaid: 600, lastPaymentAt: new Date(2026, 3, 1) },
  ],
});
eq('legacy partial (no payments[]) still counts $600 in 2026', legacy.collectedCents, 60000);

console.log('\n' + (failed === 0 ? '✓' : '✗') + ' money dashboard: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { console.error('FAILED: ' + fails.join(', ')); process.exit(1); }

/**
 * tests/expenses-logic.test.js — Phase 1 expense subsystem pure logic.
 *
 * Exercises the money/aggregation/margin math in a vm sandbox over the browser
 * IIFEs, loading expense-config.js + profit-tracker.js + expenses.js into ONE
 * shared `window` (so expenses.js sees window.ExpenseConfig / window.ProfitTracker
 * exactly as it does in the dashboard). Zero deps.
 *
 * Run: node tests/expenses-logic.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }
function eq(name, a, b) { ok(name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')', a === b); }

function makeWin() {
  const win = { addEventListener() {}, removeEventListener() {}, confirm() { return true; }, open() {}, location: { pathname: '/pro/dashboard' } };
  win.window = win;
  return win;
}
function loadInto(win, file) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js', file), 'utf8');
  const noop = () => ({ style: {}, appendChild() {}, addEventListener() {}, remove() {}, classList: { add() {}, remove() {} }, dataset: {}, focus() {} });
  const sandbox = {
    window: win,
    document: { addEventListener() {}, removeEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return noop(); }, body: noop(), readyState: 'complete' },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, Math, JSON,
  };
  vm.runInNewContext(src, sandbox, { filename: file });
  return win;
}

const win = makeWin();
loadInto(win, 'expense-config.js');
loadInto(win, 'profit-tracker.js');
loadInto(win, 'expenses.js');

const EC = win.ExpenseConfig;
const EX = win.Expenses;
const PT = win.ProfitTracker;

// ── ExpenseConfig ────────────────────────────────────────────
console.log('EXPENSE CONFIG — categories + money helpers');
ok('ExpenseConfig exported', !!EC);
eq('materials is direct', EC.costTypeFor('materials'), 'direct');
eq('subcontractor is direct', EC.costTypeFor('subcontractor'), 'direct');
eq('insurance is overhead', EC.costTypeFor('insurance'), 'overhead');
eq('unknown category -> overhead (never silent job cost)', EC.costTypeFor('bogus'), 'overhead');
ok('isDirect(materials)', EC.isDirect('materials') === true);
ok('isDirect(marketing) false', EC.isDirect('marketing') === false);
eq('labelFor materials', EC.labelFor('materials'), 'Materials');
eq('dollarsToCents 12.34', EC.dollarsToCents('12.34'), 1234);
eq('dollarsToCents rounds 0.005', EC.dollarsToCents('0.005'), 1);
eq('dollarsToCents empty -> 0', EC.dollarsToCents(''), 0);
eq('dollarsToCents junk -> 0', EC.dollarsToCents('abc'), 0);
eq('dollarsToCents number 10 -> 1000', EC.dollarsToCents(10), 1000);
eq('centsToDollars 1234', EC.centsToDollars(1234), 12.34);
eq('formatCents 123456', EC.formatCents(123456), '$1,234.56');
eq('getJobRevenue from jobValue string', EC.getJobRevenue({ jobValue: '5000' }), 5000);
eq('getJobRevenue missing -> 0', EC.getJobRevenue({}), 0);
eq('REVENUE_FIELD is jobValue', EC.REVENUE_FIELD, 'jobValue');

// ── Expenses.aggregate ───────────────────────────────────────
console.log('EXPENSES — aggregate (supplier / category / job / cost-type)');
ok('Expenses exported', !!EX);
const list = [
  { amountCents: 10000, category: 'materials', costType: 'direct', supplier: 'ABC Supply', leadId: 'L1' },
  { amountCents: 5000, category: 'materials', costType: 'direct', supplier: 'ABC Supply', leadId: 'L1' },
  { amountCents: 3000, category: 'subcontractor', costType: 'direct', supplier: 'Crew Co', leadId: 'L1' },
  { amountCents: 2000, category: 'marketing', costType: 'overhead', supplier: 'Google', leadId: null },
  { amountCents: 1000, category: 'insurance', supplier: 'StateFarm' } // no costType -> fallback overhead
];
const agg = EX.aggregate(list);
eq('total cents', agg.totalCents, 21000);
eq('direct cents (10000+5000+3000)', agg.directCents, 18000);
eq('overhead cents (2000+1000 via fallback)', agg.overheadCents, 3000);
eq('supplier count', agg.supplierCount, 4);
eq('top supplier is ABC Supply', agg.suppliers[0].supplier, 'ABC Supply');
eq('top supplier total', agg.suppliers[0].cents, 15000);
ok('top supplier pct ~71.4%', Math.abs(agg.suppliers[0].pct - (15000 / 21000 * 100)) < 0.01);
eq('top category is materials', agg.categories[0].category, 'materials');
eq('job L1 total', agg.byJob['L1'].cents, 18000);
eq('job L1 direct', agg.byJob['L1'].directCents, 18000);
eq('job L1 count', agg.byJob['L1'].count, 3);
eq('unassigned bucket total', agg.byJob['__unassigned__'].cents, 3000);
const aggEmpty = EX.aggregate([]);
eq('empty total', aggEmpty.totalCents, 0);
eq('empty supplier count', aggEmpty.supplierCount, 0);

// ── ProfitTracker.computeJobPLWithExpenses ───────────────────
console.log('PROFIT TRACKER — computeJobPLWithExpenses (feed margin from ledger)');
ok('computeJobPLWithExpenses exported', typeof PT.computeJobPLWithExpenses === 'function');
const lead = { jobValue: '20000', overheadPct: 10 };
const exp = [
  { amountCents: 1000000, category: 'materials', costType: 'direct' },    // $10,000
  { amountCents: 300000, category: 'direct_labor', costType: 'direct' },  // $3,000
  { amountCents: 200000, category: 'subcontractor', costType: 'direct' }, // $2,000 -> misc
  { amountCents: 50000, category: 'marketing', costType: 'overhead' }     // ignored (not COGS)
];
const pl = PT.computeJobPLWithExpenses(lead, exp);
eq('materialCost from ledger', pl.materialCost, 10000);
eq('laborCost from ledger', pl.laborCost, 3000);
eq('miscCosts = other direct (subcontractor)', pl.miscCosts, 2000);
eq('revenue', pl.revenue, 20000);
eq('grossProfit = 20000-10000-3000-2000', pl.grossProfit, 5000);
eq('grossMargin 25%', pl.grossMargin, 25);
eq('overhead excluded from grossProfit (overhead=2000)', pl.overhead, 2000);
eq('netProfit = 20000-17000', pl.netProfit, 3000);
ok('overhead-type expense did NOT inflate COGS', pl.materialCost + pl.laborCost + pl.miscCosts === 15000);

// ── Expenses.jobMargin guards ────────────────────────────────
console.log('EXPENSES — jobMargin guards');
const jm = EX.jobMargin({ jobValue: 20000 }, exp);
eq('jobMargin grossMargin matches', jm.grossMargin, 25);
ok('jobMargin null when revenue 0', EX.jobMargin({ jobValue: 0 }, exp) === null);
ok('jobMargin null when no lead', EX.jobMargin(null, exp) === null);

// ── Follow-up: estVsActual (estimated-vs-actual variance) ────
console.log('EXPENSES — estVsActual (variance)');
EX._setEstCosts({ L1: 1000000 }); // $10,000 budgeted direct cost (V2 estimate)
const vaOver = EX.estVsActual('L1', 1200000); // actual $12,000
eq('estVsActual est cents', vaOver.estCents, 1000000);
eq('estVsActual actual cents', vaOver.actualCents, 1200000);
eq('estVsActual variance = actual-est (over)', vaOver.varianceCents, 200000);
const vaUnder = EX.estVsActual('L1', 800000); // actual $8,000
eq('estVsActual variance under is negative', vaUnder.varianceCents, -200000);
ok('estVsActual null when no estimate cost basis', EX.estVsActual('L2', 5000) === null);
EX._setEstCosts({});
ok('estVsActual null after clearing', EX.estVsActual('L1', 5000) === null);

// ── Follow-up: findDuplicate ─────────────────────────────────
console.log('EXPENSES — findDuplicate');
EX._setData([{ id: 'e1', supplier: 'ABC Supply', amountCents: 5000, date: new Date('2026-06-27T00:00:00') }]);
ok('finds exact dup (vendor+amount+day)', !!EX.findDuplicate('ABC Supply', 5000, '2026-06-27'));
ok('case-insensitive vendor match', !!EX.findDuplicate('abc supply', 5000, '2026-06-27'));
ok('no dup when amount differs', EX.findDuplicate('ABC Supply', 5001, '2026-06-27') === null);
ok('no dup when day differs', EX.findDuplicate('ABC Supply', 5000, '2026-06-28') === null);
ok('no dup when vendor differs', EX.findDuplicate('Beacon', 5000, '2026-06-27') === null);
EX._setData([]);

// ── Follow-up: csvCell (CSV escaping) ────────────────────────
console.log('EXPENSES — csvCell');
eq('plain value unquoted', EX.csvCell('plain'), 'plain');
eq('comma gets quoted', EX.csvCell('a,b'), '"a,b"');
eq('quotes are doubled + wrapped', EX.csvCell('he said "hi"'), '"he said ""hi"""');
eq('newline gets quoted', EX.csvCell('line1\nline2'), '"line1\nline2"');
eq('null -> empty', EX.csvCell(null), '');

// ── Follow-up #1: analytics-kpi expense metrics (vm sandbox) ─────
console.log('ANALYTICS-KPI — expense metrics (COGS / margin / supplier)');
const awin = makeWin();
loadInto(awin, 'analytics-kpi.js');
const AK = awin.AnalyticsKPI && awin.AnalyticsKPI._test;
ok('AnalyticsKPI._test.computeFullAnalytics exported', !!(AK && AK.computeFullAnalytics));
if (AK && AK.computeFullAnalytics) {
  const data = {
    leads: [
      { id: 'L1', _stageKey: 'closed', jobValue: 20000 },   // won, costed
      { id: 'L2', _stageKey: 'closed', jobValue: 10000 },   // won, NOT costed
    ],
    invoices: [], knocks: [], photos: [], estimates: [],
    expenses: [
      { amountCents: 500000, costType: 'direct', supplier: 'ABC Supply', leadId: 'L1', date: new Date() },
      { amountCents: 100000, costType: 'overhead', supplier: 'Google', leadId: null, date: new Date() },
    ],
  };
  const M = AK.computeFullAnalytics(data);
  eq('total COGS (direct only) dollars', M.expDirectDollars, 5000);
  eq('overhead dollars', M.expOverheadDollars, 1000);
  eq('total spend dollars', M.expTotalDollars, 6000);
  // gross margin: only L1 is costed → (20000-5000)/20000 = 75%
  eq('won-job gross margin uses jobValue basis, costed jobs only', M.expGrossMargin, 75);
  eq('costed-jobs count', M.expCostedJobs, 1);
  eq('won-jobs count', M.expWonJobs, 2);
  eq('top supplier in leaderboard', M.expSupplierLeaderboard[0].supplier, 'ABC Supply');
  eq('this-month spend includes both (dated now)', M.expMonthDollars, 6000);
}

// ── summary ──────────────────────────────────────────────────
console.log('\n' + (failed === 0 ? '✓' : '✗') + ' expenses logic: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { console.error('FAILED: ' + fails.join(', ')); process.exit(1); }

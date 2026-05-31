/**
 * tests/dashboard-kpi.test.js — Phase 9 dashboard KPI aggregation.
 *
 * Exercises analytics-kpi.js computeKPIs() in a vm sandbox over a controlled
 * window._leads set — the rollups the dashboard KPI row renders: pipeline value
 * (active only, deleted excluded), monthly revenue (WON this month), close rate,
 * avg deal size, leads this month, active count, and top lead source. Widget
 * RENDERING is browser-only (needs-browser).
 *
 * Zero deps. Run: node tests/dashboard-kpi.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

function loadIIFE(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js', file), 'utf8');
  const noop = () => ({ style: {}, appendChild() {}, addEventListener() {}, remove() {}, classList: { add() {}, remove() {} }, dataset: {} });
  const win = { addEventListener() {}, removeEventListener() {}, location: { pathname: '/pro/dashboard' } };
  win.window = win;
  const sandbox = {
    window: win,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, createElement() { return noop(); }, body: noop(), readyState: 'complete' },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, Math, JSON, Object,
  };
  vm.runInNewContext(src, sandbox, { filename: file });
  return win;
}

const win = loadIIFE('analytics-kpi.js');
const now = new Date().toISOString();

// Controlled pipeline. WON stage key = 'closed'; LOST = 'lost'.
win._leads = [
  { id: 'a', stage: 'inspected', jobValue: 10000, source: 'referral', createdAt: now },                 // active
  { id: 'b', stage: 'quoted',    jobValue: 20000, source: 'referral', createdAt: now },                 // active
  { id: 'c', stage: 'closed',    jobValue: 30000, source: 'referral', createdAt: now, updatedAt: now }, // WON this month
  { id: 'd', stage: 'closed',    jobValue: 50000, source: 'google',   createdAt: now, updatedAt: now }, // WON this month
  { id: 'e', stage: 'lost',      jobValue: 5000,  source: 'website',  createdAt: now },                 // lost
  { id: 'f', stage: 'inspected', jobValue: 99999, source: 'referral', deleted: true },                 // deleted → excluded
];
win._estimates = [];

const k = win.computeKPIs();

console.log('DASHBOARD KPIs — computeKPIs aggregation');
ok('exposes computeKPIs', typeof win.computeKPIs === 'function');
ok('pipelineValue = active leads only (10k+20k = 30000), deleted excluded', k.pipelineValue === 30000);
ok('monthlyRevenue = WON this month (30k+50k = 80000)', k.monthlyRevenue === 80000);
ok('closeRate = closed/(closed+lost) = 2/3 = 67%', k.closeRate === 67);
ok('avgDealSize = (30k+50k)/2 = 40000', k.avgDealSize === 40000);
ok('activeLeadCount = 2 (excludes WON/LOST/deleted)', k.activeLeadCount === 2);
ok('closedThisMonthCount = 2', k.closedThisMonthCount === 2);
ok('leadsThisMonth = 5 (a–e created now; f has no date)', k.leadsThisMonth === 5);
ok('topSource = referral (3 non-deleted)', k.topSource === 'referral' && k.topSourceCount === 3);

// empty pipeline → all zeros, no NaN/crash
{
  win._leads = []; win._estimates = [];
  const z = win.computeKPIs();
  ok('empty pipeline → pipelineValue 0', z.pipelineValue === 0);
  ok('empty pipeline → closeRate 0 (no divide-by-zero)', z.closeRate === 0);
  ok('empty pipeline → avgDealSize 0', z.avgDealSize === 0);
  ok('empty pipeline → topSource N/A', z.topSource === 'N/A');
}

// ── Estimate funnel analytics (estimate-analytics.js) ──
{
  console.log('\nESTIMATE FUNNEL — NBDEstimateAnalytics.compute');
  const ew = loadIIFE('estimate-analytics.js');
  const EA = ew.NBDEstimateAnalytics;
  ok('exposes NBDEstimateAnalytics.compute', EA && typeof EA.compute === 'function');
  // estimate-analytics._toMillis accepts numeric millis or Firestore Timestamps
  // (not ISO strings — it's stricter than analytics-kpi's parser).
  const t = (days) => Date.now() - days * 86400e3;
  ew._estimates = [
    { id: 'd1', status: 'draft' },                                            // draft
    { id: 's1', sentAt: t(1) },                                               // sent
    { id: 's2', sentAt: t(3), viewedAt: t(0) },                              // sent + viewed
    { id: 'g1', signedAt: t(0), grandTotal: 12000, tier: 'best' },          // signed
    { id: 'g2', sentAt: t(5), signedAt: t(0), grandTotal: 8000, tier: 'good' }, // signed + timeToSign
    { id: 'l1', status: 'lost' },                                            // lost
    { id: 'x', deleted: true, status: 'signed', grandTotal: 99999 },         // excluded
  ];
  const a = EA.compute();
  ok('draft count = 1', a.draft === 1);
  ok('sent count = 2', a.sent === 2);
  ok('viewed count = 1', a.viewed === 1);
  ok('signed count = 2 (deleted excluded)', a.signed === 2);
  ok('lost count = 1', a.lost === 1);
  ok('signedTotal = 20000 (deleted 99999 excluded)', a.signedTotal === 20000);
  ok('avgTicket = 10000', a.avgTicket === 10000);
  ok('tierCounts best=1, good=1', a.tierCounts.best === 1 && a.tierCounts.good === 1);
  ok('timeToSignDays captured for sent→signed', a.timeToSignDays.length === 1 && Math.round(a.timeToSignDays[0]) === 5);
}

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }

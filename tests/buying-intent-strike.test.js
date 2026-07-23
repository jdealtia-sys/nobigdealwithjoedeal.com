/**
 * tests/buying-intent-strike.test.js — the fresh-view detection behind the
 * Buying-Intent strike alert (docs/pro/js/buying-intent-strike.js).
 *
 * detectFreshViews() is the pure predicate that decides which estimates are
 * being viewed RIGHT NOW and deserve a "call them" strike — the same rule as
 * notif-bell's Wave 95, isolated + require()-able so a regression can't
 * silently start nagging on closed deals or miss a live viewer. The DOM/card
 * layer only renders what this returns.
 *
 * Zero deps. Run: node tests/buying-intent-strike.test.js
 */
'use strict';

const path = require('path');
const BIS = require(path.join('..', 'docs', 'pro', 'js', 'buying-intent-strike.js'));
const detect = BIS.detectFreshViews;

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const NOW = 1_800_000_000_000;
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();
const leads = [
  { id: 'L1', firstName: 'Sarah', lastName: 'Jones', phone: '(513) 555-0100', stage: 'inspected' },
  { id: 'L2', firstName: 'Bob', phone: '5135550200', stage: 'closed' },     // terminal
  { id: 'L3', firstName: 'Deleted', phone: '1', stage: 'inspected', deleted: true },
  { id: 'L4', firstName: 'Amy', phone: '', stage: 'contacted' },            // no phone
];

console.log('BUYING-INTENT STRIKE — fresh-view detection');

// happy path: fresh view on an open lead fires
{
  const ests = [{ id: 'E1', leadId: 'L1', total: 18000, viewedAt: minsAgo(10) }];
  const m = detect(ests, leads, NOW);
  ok('fresh view on an open lead is detected', m.length === 1 && m[0].estId === 'E1');
  ok('carries name, phone, amount for the call CTA',
    m[0].name === 'Sarah Jones' && m[0].phone === '(513) 555-0100' && m[0].amount === 18000);
}

// window edge: older than 6h is not "right now"
{
  ok('a view 5h ago still counts (inside 6h window)', detect([{ id: 'E', leadId: 'L1', viewedAt: minsAgo(300) }], leads, NOW).length === 1);
  ok('a view 7h ago is excluded (stale, not a strike)', detect([{ id: 'E', leadId: 'L1', viewedAt: minsAgo(420) }], leads, NOW).length === 0);
  ok('a future viewedAt (clock skew) is ignored', detect([{ id: 'E', leadId: 'L1', viewedAt: minsAgo(-5) }], leads, NOW).length === 0);
}

// suppression rules
{
  ok('responded estimate never strikes (deal already decided)',
    detect([{ id: 'E', leadId: 'L1', viewedAt: minsAgo(5), respondedAt: minsAgo(4) }], leads, NOW).length === 0);
  ok('terminal-stage lead (closed) is suppressed — noise on a won deal',
    detect([{ id: 'E', leadId: 'L2', viewedAt: minsAgo(5) }], leads, NOW).length === 0);
  ok('deleted lead is suppressed', detect([{ id: 'E', leadId: 'L3', viewedAt: minsAgo(5) }], leads, NOW).length === 0);
  ok('estimate with no parent lead is dropped', detect([{ id: 'E', leadId: 'NOPE', viewedAt: minsAgo(5) }], leads, NOW).length === 0);
  ok('missing / unparseable viewedAt is dropped',
    detect([{ id: 'E', leadId: 'L1' }, { id: 'F', leadId: 'L1', viewedAt: 'garbage' }], leads, NOW).length === 0);
}

// Firestore Timestamp shape (viewedAt is often a {seconds}/{toDate} sentinel)
{
  const tsObj = { toDate: () => new Date(NOW - 8 * 60000) };
  const tsSeconds = { seconds: Math.floor((NOW - 8 * 60000) / 1000) };
  ok('accepts a Firestore Timestamp with toDate()', detect([{ id: 'E', leadId: 'L1', viewedAt: tsObj }], leads, NOW).length === 1);
  ok('accepts a {seconds} Timestamp shape', detect([{ id: 'E', leadId: 'L1', viewedAt: tsSeconds }], leads, NOW).length === 1);
}

// ordering + robustness
{
  const ests = [
    { id: 'OLD', leadId: 'L1', viewedAt: minsAgo(120) },
    { id: 'NEW', leadId: 'L4', viewedAt: minsAgo(2) },
  ];
  const m = detect(ests, leads, NOW);
  ok('newest view is surfaced first (strike the hottest)', m[0].estId === 'NEW');
  ok('lead with empty phone still detected (card handles missing #)', m.some(x => x.leadId === 'L4' && x.phone === ''));
  let threw = false;
  try { detect(null, null, NOW); detect([{}], [null], NOW); detect(undefined, leads, NOW); }
  catch (e) { threw = true; }
  ok('null / malformed input never throws', !threw);
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

/**
 * tests/adjuster-board.test.js — the pure aggregation behind the
 * getAdjusterTacticBoard callable (functions/adjuster-board-logic.js, shared
 * verbatim by the handler).
 *
 * Guards the rollup invariants: objections/red-flags are tallied per carrier
 * AND per adjuster (the association voiceConsumer drops), counts are correct
 * and deduped within a call, carriers/adjusters rank by call volume, distinct
 * adjusters per carrier are counted, and odd/empty input never throws.
 *
 * Zero deps.  Run: node tests/adjuster-board.test.js
 */
'use strict';

const path = require('path');
const A = require(path.join('..', 'functions', 'adjuster-board-logic.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const find = (arr, name) => arr.find((x) => x.name === name);
const sig = (list, text) => (list.find((s) => s.text === text) || {}).count;

console.log('ADJUSTER BOARD — carrier/adjuster rollup');

const recs = [
  { status: 'complete', summary: { insuranceDetails: { carrier: 'State Farm', adjuster: 'Pat A' }, objections: ['Price too high', 'Wants to think it over'], redFlags: ['Mentioned a competitor'] } },
  { status: 'complete', summary: { insuranceDetails: { carrier: 'State Farm', adjuster: 'Dana B' }, objections: ['Price too high'], redFlags: [] } },
  { status: 'complete', summary: { insuranceDetails: { carrier: 'Allstate', adjuster: 'Pat A' }, objections: ['Depreciation dispute'], redFlags: ['Lowball estimate'] } },
  { status: 'complete', summary: { insuranceDetails: { carrier: '', adjuster: '' }, objections: ['Just looking'], redFlags: [] } },  // no carrier
];

// core aggregation
{
  const b = A.aggregateAdjusterBoard(recs);
  ok('counts every summarized call', b.totalCalls === 4);
  ok('counts calls that captured a carrier', b.withInsurance === 3);

  const sf = find(b.byCarrier, 'State Farm');
  ok('State Farm has 2 calls', sf && sf.calls === 2);
  ok('State Farm tallies its repeated objection ×2', sig(sf.topObjections, 'Price too high') === 2);
  ok('State Farm counts its 2 distinct adjusters', sf.adjusterCount === 2);
  ok('State Farm red flag from one call ×1', sig(sf.topRedFlags, 'Mentioned a competitor') === 1);

  const al = find(b.byCarrier, 'Allstate');
  ok('Allstate has 1 call', al && al.calls === 1);

  // carriers ranked by call volume
  ok('carriers ranked by call volume (State Farm first)', b.byCarrier[0].name === 'State Farm');

  // per-adjuster: Pat A appears under two carriers → 2 calls total
  const pat = find(b.byAdjuster, 'Pat A');
  ok('adjuster Pat A rolled up across carriers → 2 calls', pat && pat.calls === 2);

  // global tallies include the no-carrier call
  ok('global objections include the no-carrier call', sig(b.topObjections, 'Just looking') === 1);
  ok('global objection tally sums across carriers', sig(b.topObjections, 'Price too high') === 2);
}

// dedup within a single call
{
  const dup = [{ status: 'complete', summary: { insuranceDetails: { carrier: 'X' }, objections: ['Same', 'same', 'SAME'], redFlags: [] } }];
  const b = A.aggregateAdjusterBoard(dup);
  ok('duplicate objections within one call count once', sig(find(b.byCarrier, 'X').topObjections, 'Same') === 1);
}

// caps
{
  const many = Array.from({ length: 30 }, (_, i) => ({ status: 'complete', summary: { insuranceDetails: { carrier: 'Carrier ' + i }, objections: ['o'], redFlags: [] } }));
  const b = A.aggregateAdjusterBoard(many, { maxRows: 12 });
  ok('carrier rows capped at maxRows', b.byCarrier.length === 12);
}

// robustness
{
  ok('empty input → zeroed board, never throws',
    (() => { const b = A.aggregateAdjusterBoard([]); return b.totalCalls === 0 && b.byCarrier.length === 0; })());
  ok('null input → zeroed board', A.aggregateAdjusterBoard(null).totalCalls === 0);
  ok('recordings without a summary are skipped',
    A.aggregateAdjusterBoard([{ status: 'complete' }, { summary: null }]).totalCalls === 0);
  ok('malformed insuranceDetails never throws',
    (() => { const b = A.aggregateAdjusterBoard([{ status: 'complete', summary: { objections: null, redFlags: 'x' } }]); return b.totalCalls === 1 && b.byCarrier.length === 0; })());
  ok('uniqList trims + dedups + drops empties', JSON.stringify(A.uniqList([' a ', 'A', '', null, 'b'])) === JSON.stringify(['a', 'b']));
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

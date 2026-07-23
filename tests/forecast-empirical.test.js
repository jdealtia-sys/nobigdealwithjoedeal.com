/**
 * tests/forecast-empirical.test.js — the empirical forecast engine
 * (docs/pro/js/forecast-empirical.js).
 *
 * forecasting.js weighted its pipeline off a STATIC industry stage-probability
 * table; this engine derives each tenant's OWN P(win | reached stage) from the
 * stageHistory[] every move already writes, Bayesian-shrunk toward that table
 * so thin samples don't swing wildly. Pure + require()-able (no firebase), so
 * the money-sensitive aggregation + shrinkage math is locked here.
 *
 * Zero deps. Run: node tests/forecast-empirical.test.js
 */
'use strict';

const path = require('path');
const FE = require(path.join('..', 'docs', 'pro', 'js', 'forecast-empirical.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const approx = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-9 : eps);

// Terminal predicates for the default fixtures.
const isWon = (k) => k === 'closed';
const isLost = (k) => k === 'lost';

// ISO-timestamp history builder: transitions spaced `dayGaps` apart from day 0.
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const iso = (day) => new Date(T0 + day * 86400000).toISOString();
function hist(pairs) { // pairs: [from,to,day]
  return pairs.map(([from, to, day]) => ({ from, to, timestamp: iso(day), user: 'x' }));
}

console.log('EMPIRICAL FORECAST ENGINE');

// ── computeEmpiricalRates: P(win | reached stage) over RESOLVED leads ──
{
  const leads = [
    // A: won, passed new→contacted→inspected→closed
    { stage: 'closed', stageHistory: hist([['new', 'contacted', 0], ['contacted', 'inspected', 2], ['inspected', 'closed', 5]]) },
    // B: lost, passed new→contacted→lost
    { stage: 'lost', stageHistory: hist([['new', 'contacted', 0], ['contacted', 'lost', 3]]) },
    // C: still open in contacted — must NOT affect any rate
    { stage: 'contacted', stageHistory: hist([['new', 'contacted', 0]]) },
  ];
  const m = FE.computeEmpiricalRates(leads, { isWon, isLost });

  ok('totalResolved counts only terminal leads (A,B)', m.totalResolved === 2);
  ok('totalWon counts only wins (A)', m.totalWon === 1);
  ok('contacted: 2 resolved, 1 won → closeRate 0.5',
    m.byStage.contacted.resolved === 2 && m.byStage.contacted.won === 1 && approx(m.byStage.contacted.closeRate, 0.5));
  ok('inspected: only A reached it → 1/1 = 1.0',
    m.byStage.inspected.resolved === 1 && approx(m.byStage.inspected.closeRate, 1));
  ok('new: both resolved passed through → 1/2 = 0.5', approx(m.byStage.new.closeRate, 0.5));
  ok('open lead C added no resolution to contacted (still 2)', m.byStage.contacted.resolved === 2);
  ok('terminal stages (closed/lost) get NO rate entry',
    !m.byStage.closed && !m.byStage.lost);
}

// ── blendedProbability: Bayesian shrinkage toward the prior ──
{
  const model = { byStage: { contacted: { resolved: 2, won: 1, closeRate: 0.5 }, hot: { resolved: 100, won: 90, closeRate: 0.9 } } };

  ok('no model / no samples → returns the prior',
    FE.blendedProbability('contacted', null, 0.10) === 0.10 &&
    FE.blendedProbability('never_seen', model, 0.25) === 0.25);

  // (won + k*prior)/(resolved + k) with k=15, prior=0.10: (1 + 1.5)/17
  ok('thin sample stays near the prior (2 deals → ~0.147, not 0.50)',
    approx(FE.blendedProbability('contacted', model, 0.10), 2.5 / 17, 1e-6));

  // (90 + 1.5)/115 = 0.7957 — large sample pulls toward the empirical 0.90
  const big = FE.blendedProbability('hot', model, 0.10);
  ok('large sample pulls toward empirical (0.90) but stays shrunk',
    big > 0.70 && big < 0.90 && approx(big, 91.5 / 115, 1e-6));

  ok('result is clamped to [0,1]',
    FE.blendedProbability('hot', { byStage: { hot: { resolved: 3, won: 3 } } }, 1.0) <= 1 &&
    FE.blendedProbability('cold', { byStage: { cold: { resolved: 3, won: 0 } } }, 0.0) >= 0);

  ok('custom pseudocount honored (k=1 → nearly empirical)',
    approx(FE.blendedProbability('hot', model, 0.10, { pseudocount: 1 }), (90 + 0.1) / 101, 1e-6));
}

// ── stageVelocity: median COMPLETED days from consecutive transitions ──
{
  const leads = [
    { stage: 'closed', stageHistory: hist([['new', 'contacted', 0], ['contacted', 'inspected', 2], ['inspected', 'closed', 5]]) },
    { stage: 'inspected', stageHistory: hist([['new', 'contacted', 0], ['contacted', 'inspected', 6]]) },
  ];
  const v = FE.stageVelocity(leads);
  // contacted occupancies: A = day0→2 (2d), B = day0→6 (6d) → median 4
  ok('contacted median completed days = 4 (2d and 6d)', approx(v.byStage.contacted.medianDays, 4));
  // inspected occupancy only completed for A (day2→5 = 3d); B is still in inspected (excluded)
  ok('inspected counts only the COMPLETED occupancy (A: 3d), not open B',
    v.byStage.inspected.samples === 1 && approx(v.byStage.inspected.medianDays, 3));
  ok('slowest stage surfaced (contacted, avg 4 > inspected 3)', v.slowest.stage === 'contacted');
}

// ── robustness: malformed input must never throw or poison the math ──
{
  const junk = [
    { stage: 'closed', stageHistory: 'not-an-array' },
    { stage: 'contacted', stageHistory: [{ /* no from/to */ }, { from: 'a', to: 'b', timestamp: 'garbage' }] },
    { stage: 'closed', stageHistory: hist([['new', 'closed', 0]]) },
    null,
    { deleted: true, stage: 'closed', stageHistory: hist([['new', 'closed', 1]]) },
    { isProspect: true, stage: 'closed', stageHistory: hist([['new', 'closed', 1]]) },
  ];
  let threw = false;
  let m, v;
  try { m = FE.computeEmpiricalRates(junk, { isWon, isLost }); v = FE.stageVelocity(junk); }
  catch (e) { threw = true; }
  ok('malformed/deleted/prospect input never throws', !threw);
  // Two valid 'closed' leads resolve; the deleted + prospect 'closed' leads are
  // excluded (else this would be 4).
  ok('deleted + prospect leads excluded from resolution (2 valid, not 4)', m.totalResolved === 2);
  ok('empty input → empty model, prior-only forecast', FE.computeEmpiricalRates([], { isWon, isLost }).totalResolved === 0);
  ok('velocity ignores negative/garbage-timestamp gaps', v.byStage.a === undefined || v.byStage.a.samples === 0);
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

/**
 * tests/storm-proof.test.js — the server-verified storm proof (idea #1 Phase 2).
 *
 * Part 1 — the pure decision logic (functions/storm-proof-logic.js, shared
 * verbatim by the attachStormProof handler): the strongest-hit selection, the
 * 0.75" verify threshold (never claim damage the data doesn't support), and the
 * immutable proof record shape (carries userId/companyId so the frozen
 * subcollection read rule can gate it).
 *
 * Part 2 — a static "no dead control" wiring guard (mirrors #1046's sweep guard
 * for the zone button): the per-lead card-detail button must reference a
 * dispatch target that is actually registered, or it's a silent dead button.
 *
 * Zero deps.  Run: node tests/storm-proof.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const S = require(path.join('..', 'functions', 'storm-proof-logic.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('STORM PROOF — verify logic + wiring');

// ── strongestHit / maxSize ──
{
  const hits = [
    { sizeInches: 0.5, source: 'noaa' },
    { sizeInches: 1.75, source: 'noaa', at: '2026-07-01', lat: 39.1, lng: -84.5 },
    { sizeInches: 'x' },       // non-finite ignored
    { sizeInches: 1.0 },
  ];
  ok('strongestHit picks the largest finite report', S.strongestHit(hits).sizeInches === 1.75);
  ok('maxSize is the largest size', S.maxSize(hits) === 1.75);
  ok('strongestHit ignores non-finite sizes', !!S.strongestHit([{ sizeInches: 'nope' }, { sizeInches: 0.9 }]));
  ok('strongestHit → null on empty / garbage', S.strongestHit([]) === null && S.strongestHit(null) === null);
  ok('maxSize → 0 on empty', S.maxSize([]) === 0 && S.maxSize(null) === 0);
}

// ── buildStormProof: verify threshold ──
{
  const verified = S.buildStormProof({
    leadId: 'L1', userId: 'u1', companyId: 'c1', verifiedBy: 'rep1', provider: 'noaa',
    lat: 39.1, lng: -84.5, radiusMi: 3, daysBack: 365,
    hits: [{ sizeInches: 1.5, at: '2026-06-01', lat: 39.1, lng: -84.5, source: 'noaa' }],
    address: '123 Main St, Cincinnati OH',
  });
  ok('a ≥0.75" report verifies', verified.verified === true);
  ok('carries the strongest hit as headline evidence', verified.strongestHit && verified.strongestHit.sizeInches === 1.5);
  ok('maxSizeInches recorded', verified.maxSizeInches === 1.5);
  ok('carries userId + companyId for the read rule', verified.userId === 'u1' && verified.companyId === 'c1');
  ok('records who verified + provider', verified.verifiedBy === 'rep1' && verified.provider === 'noaa');
  ok('hitCount recorded', verified.hitCount === 1);

  const below = S.buildStormProof({ leadId: 'L2', hits: [{ sizeInches: 0.5 }] });
  ok('a report below 0.75" does NOT verify (never overclaim)', below.verified === false);
  ok('below-threshold still reports the lookup ran (hitCount)', below.hitCount === 1);

  const exact = S.buildStormProof({ leadId: 'L3', hits: [{ sizeInches: 0.75 }] });
  ok('exactly 0.75" verifies (threshold inclusive)', exact.verified === true);

  const none = S.buildStormProof({ leadId: 'L4', hits: [] });
  ok('no hits → verified false, strongestHit null, hitCount 0', none.verified === false && none.strongestHit === null && none.hitCount === 0);
}

// ── null-safety + address clamp ──
{
  const p = S.buildStormProof({});
  ok('empty input never throws + defaults verified false', p.verified === false && p.provider === 'noaa' && p.hitCount === 0);
  const clamped = S.buildStormProof({ leadId: 'L', address: 'x'.repeat(500), hits: [] });
  ok('address clamped to 300 chars', clamped.address.length === 300);
  ok('threshold constant is the NWS severe floor', S.HAIL_VERIFY_THRESHOLD_INCHES === 0.75);
}

// ── Part 2: static wiring guard (no dead control) ──
{
  const si = fs.readFileSync(path.join(__dirname, '..', 'docs', 'pro', 'js', 'storm-integration.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'pro', 'dashboard.html'), 'utf8');
  ok('storm-integration registers verifyStormProofForLead on the call registry',
    /__NBD_CALL_REGISTRY\.verifyStormProofForLead\s*=/.test(si));
  ok('the client handler calls the attachStormProof callable',
    /_httpsCallable\(window\._functions,\s*'attachStormProof'\)/.test(si));
  ok('dashboard card-detail has the Storm Proof button wired to that dispatch target',
    /data-fn="verifyStormProofForLead"/.test(html));
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

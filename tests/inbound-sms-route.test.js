/**
 * tests/inbound-sms-route.test.js — tenant-safe inbound-SMS routing decision
 * (functions/inbound-sms-route-logic.js, shared verbatim by the incomingSMS
 * webhook).
 *
 * Guards the audit 2026-08-02 HIGH-5 invariant: one shared Twilio number
 * serves every tenant, so a reply must NEVER be guessed into another
 * company's lead. The full decision table is pinned here — especially the
 * two cases that motivated the fix: cross-tenant with no outbound signal →
 * unmatched (triage, not a guess), and cross-tenant with exactly one fresh
 * outbound → routes to the tenant that was actually texting them.
 *
 * Zero deps (the logic module has no firebase imports).
 * Run: node tests/inbound-sms-route.test.js
 */
'use strict';

const path = require('path');
const R = require(path.join('..', 'functions', 'inbound-sms-route-logic.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const NOW = 1_800_000_000_000;           // fixed clock for every case
const DAY = 24 * 60 * 60 * 1000;
const pick = (cands, opts) => R.pickLeadForInbound(cands, Object.assign({ now: NOW }, opts));
const lead = (over) => Object.assign({
  id: 'L?', companyId: null, userId: null,
  lastOutboundAt: null, lastContactedAt: null, createdAt: null,
}, over);

console.log('INBOUND-SMS ROUTE — tenant-safe decision table');

// ── trivial cases ──────────────────────────────────────────────
{
  const r0 = pick([]);
  ok('0 candidates → unmatched, no ambiguity', r0.decision === 'unmatched' && r0.ambiguity === null);

  const r1 = pick([lead({ id: 'L1', companyId: 'coA', userId: 'u1' })]);
  ok('1 candidate → routes to it (the common case, unchanged)',
    r1.decision === 'route' && r1.leadId === 'L1' && r1.ambiguity === null);

  ok('garbage input never throws',
    pick(null).decision === 'unmatched' &&
    pick([null, undefined, {}]).decision === 'unmatched');
}

// ── same tenant, several leads: always routes, most-recently-worked wins ──
{
  const r = pick([
    lead({ id: 'Lold', companyId: 'coA', userId: 'u1', lastOutboundAt: NOW - 20 * DAY }),
    lead({ id: 'Lnew', companyId: 'coA', userId: 'u1', lastOutboundAt: NOW - 2 * DAY }),
  ]);
  ok('same tenant → routes (never triaged) to newest outbound',
    r.decision === 'route' && r.leadId === 'Lnew' && r.ambiguity === 'same-tenant');

  const r2 = pick([
    lead({ id: 'La', companyId: 'coA', userId: 'u1', lastContactedAt: NOW - 9 * DAY }),
    lead({ id: 'Lb', companyId: 'coA', userId: 'u1', lastContactedAt: NOW - 1 * DAY }),
  ]);
  ok('same tenant, no outbound history → lastContactedAt tiebreak',
    r2.decision === 'route' && r2.leadId === 'Lb');

  const r3 = pick([
    lead({ id: 'Lc', companyId: 'coA', userId: 'u1', createdAt: NOW - 40 * DAY }),
    lead({ id: 'Ld', companyId: 'coA', userId: 'u1', createdAt: NOW - 3 * DAY }),
  ]);
  ok('same tenant, cold leads → createdAt tiebreak', r3.decision === 'route' && r3.leadId === 'Ld');

  // Solo-owner convention: companyId may be absent; userId is the tenant key.
  const r4 = pick([
    lead({ id: 'Ls1', userId: 'solo' }),
    lead({ id: 'Ls2', userId: 'solo', lastContactedAt: NOW - DAY }),
  ]);
  ok('companyId-less solo leads group by userId (still same-tenant)',
    r4.decision === 'route' && r4.ambiguity === 'same-tenant');
}

// ── cross-tenant: THE misroute cases ───────────────────────────
{
  // No outbound signal on either side → refuse to guess.
  const r = pick([
    lead({ id: 'LA', companyId: 'coA', userId: 'u1', lastContactedAt: NOW - DAY }),
    lead({ id: 'LB', companyId: 'coB', userId: 'u2', lastContactedAt: NOW - 2 * DAY }),
  ]);
  ok('cross-tenant, no outbound signal → UNMATCHED (never guesses by activity)',
    r.decision === 'unmatched' && r.ambiguity === 'cross-tenant-unresolved');

  // Exactly one tenant texted them recently → that thread owns the reply.
  const r2 = pick([
    lead({ id: 'LA', companyId: 'coA', userId: 'u1', lastOutboundAt: NOW - 2 * DAY }),
    lead({ id: 'LB', companyId: 'coB', userId: 'u2' }),
  ]);
  ok('cross-tenant, one fresh outbound → routes to the texting tenant',
    r2.decision === 'route' && r2.leadId === 'LA' && r2.ambiguity === 'cross-tenant-resolved');

  // Both tenants texted recently → the strictly-newest wins…
  const r3 = pick([
    lead({ id: 'LA', companyId: 'coA', userId: 'u1', lastOutboundAt: NOW - 5 * DAY }),
    lead({ id: 'LB', companyId: 'coB', userId: 'u2', lastOutboundAt: NOW - 1 * DAY }),
  ]);
  ok('cross-tenant, both fresh → strictly-newest outbound wins',
    r3.decision === 'route' && r3.leadId === 'LB');

  // …but an exact tie is not a signal.
  const r4 = pick([
    lead({ id: 'LA', companyId: 'coA', userId: 'u1', lastOutboundAt: NOW - DAY }),
    lead({ id: 'LB', companyId: 'coB', userId: 'u2', lastOutboundAt: NOW - DAY }),
  ]);
  ok('cross-tenant, tied outbound timestamps → UNMATCHED',
    r4.decision === 'unmatched' && r4.ambiguity === 'cross-tenant-unresolved');

  // A stale outbound (outside the window) is no signal at all.
  const r5 = pick([
    lead({ id: 'LA', companyId: 'coA', userId: 'u1', lastOutboundAt: NOW - 45 * DAY }),
    lead({ id: 'LB', companyId: 'coB', userId: 'u2' }),
  ]);
  ok('cross-tenant, only a stale (>30d) outbound → UNMATCHED',
    r5.decision === 'unmatched' && r5.ambiguity === 'cross-tenant-unresolved');

  // Window is configurable (webhook passes the default; tests prove the knob).
  const r6 = pick([
    lead({ id: 'LA', companyId: 'coA', userId: 'u1', lastOutboundAt: NOW - 45 * DAY }),
    lead({ id: 'LB', companyId: 'coB', userId: 'u2' }),
  ], { recencyWindowMs: 60 * DAY });
  ok('recency window is configurable', r6.decision === 'route' && r6.leadId === 'LA');

  // 3-way: two leads in tenant A (one fresh), one in tenant B (cold) — the
  // fresh outbound uniquely identifies the thread even with a same-tenant
  // sibling in the mix.
  const r7 = pick([
    lead({ id: 'LA1', companyId: 'coA', userId: 'u1', lastOutboundAt: NOW - 2 * DAY }),
    lead({ id: 'LA2', companyId: 'coA', userId: 'u1' }),
    lead({ id: 'LB', companyId: 'coB', userId: 'u2' }),
  ]);
  ok('3-way cross-tenant with one fresh outbound → routes to it',
    r7.decision === 'route' && r7.leadId === 'LA1');
}

// ── module contract ────────────────────────────────────────────
{
  ok('default window is 30 days', R.DEFAULT_RECENCY_WINDOW_MS === 30 * DAY);
  ok('tenantOf falls back companyId → userId → per-lead key',
    R.tenantOf({ companyId: 'c' }) === 'c' &&
    R.tenantOf({ userId: 'u' }) === 'u' &&
    R.tenantOf({ id: 'x' }) === 'lead:x');
  ok('stays firebase-free (pure, requirable with zero deps)',
    !require('fs').readFileSync(path.join(__dirname, '..', 'functions', 'inbound-sms-route-logic.js'), 'utf8')
      .includes("require('firebase"));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }

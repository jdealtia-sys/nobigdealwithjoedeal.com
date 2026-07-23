/**
 * tests/fresh-view-strike.test.js — the real-time buying-intent strike
 * (idea #3 Phase 2). Two pure surfaces:
 *   1. functions/fresh-view-logic.js — the trigger's notification builder +
 *      cooldown decision (shared verbatim by customer-audit.js).
 *   2. buying-intent-strike.js pickFreshViewNotifs — the client predicate that
 *      turns a pushed notification into a strike card.
 *
 * Invariants that matter: the cooldown must suppress the refresh-burst of
 * estimate_view events but let a genuine later re-open through; the pushed
 * notification always carries the owner's userId (never a null-feed doc) and
 * degrades to a generic message; and the client predicate fires ONLY on a
 * fresh (≤ window) estimate_viewed notification with a parent lead, keyed by
 * estimateId so it dedupes against the estimates-cache path.
 *
 * Zero deps.  Run: node tests/fresh-view-strike.test.js
 */
'use strict';

const path = require('path');
const F = require(path.join('..', 'functions', 'fresh-view-logic.js'));
const B = require(path.join('..', 'docs', 'pro', 'js', 'buying-intent-strike.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('FRESH-VIEW STRIKE — server builder + client predicate');

// ── money ──
{
  ok('money: thousands → $NK', F.money(18000) === '$18K');
  ok('money: sub-1000 → $N', F.money(950) === '$950');
  ok('money: zero / negative / NaN → "" (message degrades)',
    F.money(0) === '' && F.money(-5) === '' && F.money('abc') === '');
}

// ── freshViewNotifId ──
{
  ok('deterministic per owner+lead', F.freshViewNotifId('own1', 'lead1') === 'fv_own1_lead1');
  ok('stable id → a re-view updates the SAME doc', F.freshViewNotifId('own1', 'lead1') === F.freshViewNotifId('own1', 'lead1'));
}

// ── shouldNotify (cooldown) ──
{
  const COOL = 30 * 60 * 1000;
  const now = 1_000_000_000_000;
  ok('no previous strike → notify', F.shouldNotify(0, now, COOL) === true);
  ok('within cooldown → suppress (refresh-burst)', F.shouldNotify(now - 60_000, now, COOL) === false);
  ok('past cooldown → re-fire (genuine later return)', F.shouldNotify(now - COOL - 1, now, COOL) === true);
  ok('exactly at cooldown → notify', F.shouldNotify(now - COOL, now, COOL) === true);
}

// ── buildFreshViewNotif ──
{
  const n = F.buildFreshViewNotif({ ownerUid: 'own1', leadId: 'lead1', estimateId: 'est1', customerName: 'Sarah Lee', customerPhone: '5551234', amount: 18000 });
  ok('keyed to the owner feed', n.userId === 'own1');
  ok('uses the bell-recognized estimate_viewed type', n.type === 'estimate_viewed');
  ok('carries lead + estimate ids', n.leadId === 'lead1' && n.estimateId === 'est1');
  ok('message names the customer + amount', n.message === 'Sarah Lee is viewing their $18K estimate right now.');
  ok('carries fields the strike card renders', n.customerName === 'Sarah Lee' && n.customerPhone === '5551234' && n.estimateAmount === 18000);
  ok('high priority, unread', n.priority === 'high' && n.read === false);

  const generic = F.buildFreshViewNotif({ ownerUid: 'own1', leadId: 'lead1' });
  ok('no name/amount → generic message', generic.message === 'A customer is viewing their estimate right now.');
  ok('no amount → estimateAmount null', generic.estimateAmount === null);
  ok('no name → customerName null', generic.customerName === null);

  // never a null-tenant feed doc that no client would read
  const noOwner = F.buildFreshViewNotif({ leadId: 'l' });
  ok('missing owner → userId null (caller guards, never mis-delivers)', noOwner.userId === null);
}

// ── pickFreshViewNotifs (client predicate) ──
{
  const now = 2_000_000_000_000;
  const ts = (ms) => ({ seconds: Math.floor(ms / 1000) }); // Firestore Timestamp shape
  const feed = [
    { type: 'estimate_viewed', leadId: 'l1', estimateId: 'e1', customerName: 'Ann', customerPhone: '111', estimateAmount: 9000, createdAt: ts(now - 60_000) },
    { type: 'estimate_viewed', leadId: 'l2', estimateId: 'e2', customerName: 'Bob', estimateAmount: 0, createdAt: ts(now - 5 * 60_000) },
    { type: 'lead_assigned', leadId: 'l3', createdAt: ts(now - 1000) },            // wrong type
    { type: 'estimate_viewed', leadId: 'l4', estimateId: 'e4', createdAt: ts(now - 7 * 60 * 60 * 1000) }, // too old (>6h)
    { type: 'estimate_viewed', estimateId: 'e5', createdAt: ts(now - 1000) },       // no leadId
  ];
  const picks = B.pickFreshViewNotifs(feed, now);
  ok('only fresh estimate_viewed notifs with a lead survive', picks.length === 2);
  ok('maps to the strike shape', picks[0].leadId === 'l1' && picks[0].estId === 'e1' && picks[0].name === 'Ann' && picks[0].phone === '111' && picks[0].amount === 9000);
  ok('newest-first', picks[0].leadId === 'l1' && picks[1].leadId === 'l2');
  ok('estId falls back to lead when no estimateId', B.pickFreshViewNotifs([{ type: 'estimate_viewed', leadId: 'lz', createdAt: ts(now - 1000) }], now)[0].estId === 'lead:lz');
  ok('wrong type excluded', !picks.some((p) => p.leadId === 'l3'));
  ok('older-than-window excluded', !picks.some((p) => p.leadId === 'l4'));
  ok('missing leadId excluded', picks.length === 2);
  ok('empty / null feed → [] (never throws)', B.pickFreshViewNotifs(null, now).length === 0 && B.pickFreshViewNotifs([], now).length === 0);
  ok('future-dated (clock skew) excluded', B.pickFreshViewNotifs([{ type: 'estimate_viewed', leadId: 'lf', createdAt: ts(now + 60_000) }], now).length === 0);
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

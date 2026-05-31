/**
 * tests/customer-portal-logic.test.js — Phase 3 customer-record logic.
 *
 * Exercises the customer engagement-tier engine (customer-engagement-score.js)
 * in a vm sandbox: New → Sent → Viewed → Hot → Responded, driven by share +
 * portal-view + estimate-response signals — the same ladder the customer page
 * chip and the smart-followup panel key off.
 *
 * Zero deps. Run: node tests/customer-portal-logic.test.js
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
  const win = { addEventListener() {}, removeEventListener() {}, location: { pathname: '/pro/dashboard', href: 'http://localhost/pro/dashboard' } };
  win.window = win;
  const sandbox = {
    window: win,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, createElement() { return noop(); }, body: noop(), readyState: 'complete' },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, Math, JSON,
  };
  vm.runInNewContext(src, sandbox, { filename: file });
  return win;
}

const ES = loadIIFE('customer-engagement-score.js').CustomerEngagementScore;
const tier = (lead, estimates) => ES.computeTier(lead, estimates);

console.log('CUSTOMER ENGAGEMENT TIER — computeTier ladder');
ok('exposes CustomerEngagementScore.computeTier', ES && typeof ES.computeTier === 'function');

const now = Date.now();
const lead = { id: 'L1' };
const HOUR = 3600e3;

// Tier 0 — New (no signals)
ok('no share/view → tier 0 New', tier(lead, []).tier === 0);

// Tier 1 — Sent (share sent, no view), stale share so not "fresh"
ok('shared, no view → tier 1 Sent', tier({ id: 'L1', lastSharedAt: now - 48 * HOUR }, []).tier === 1);

// Tier 2 — Viewed once, stale share (>24h), single view → not Hot
{
  const ests = [{ leadId: 'L1', viewedAt: now - 30 * HOUR }];
  const t = tier({ id: 'L1', lastSharedAt: now - 48 * HOUR }, ests);
  ok('one view, stale share → tier 2 Viewed', t.tier === 2 && t.label === 'Viewed');
}

// Tier 3 — Hot via multiple views (>=2)
{
  const ests = [{ leadId: 'L1', viewedAt: now - 30 * HOUR }, { leadId: 'L1', viewedAt: now - 5 * HOUR }];
  ok('two views → tier 3 Hot', tier({ id: 'L1', lastSharedAt: now - 48 * HOUR }, ests).tier === 3);
}

// Tier 3 — Hot via a single view within a FRESH share window (<24h)
{
  const ests = [{ leadId: 'L1', viewedAt: now - 2 * HOUR }];
  ok('one view + fresh share → tier 3 Hot', tier({ id: 'L1', lastSharedAt: now - 1 * HOUR }, ests).tier === 3);
}

// Tier 4 — Responded (overrides everything)
{
  const ests = [{ leadId: 'L1', viewedAt: now - 2 * HOUR, respondedAt: now - 1 * HOUR }];
  ok('estimate responded → tier 4 Responded (top)', tier({ id: 'L1', lastSharedAt: now - 1 * HOUR }, ests).tier === 4);
}

// estimates for OTHER leads are ignored (leadId filter)
{
  const ests = [{ leadId: 'OTHER', viewedAt: now - 1 * HOUR, respondedAt: now }];
  ok('estimates from other leads ignored', tier({ id: 'L1' }, ests).tier === 0);
}

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }

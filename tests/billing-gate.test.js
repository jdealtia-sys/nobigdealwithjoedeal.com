/**
 * tests/billing-gate.test.js — behavioral unit tests for the client billing
 * gate (docs/pro/js/billing-gate.js), Audit #3 Phase 1.
 *
 * billing-gate.js is a browser IIFE that attaches window.NBDBilling. It has no
 * DOM dependency at call time for the gate decisions (canUse / loadSubscription
 * / getPlan), so we load it in a vm sandbox with a stubbed `window` + a fake
 * Firestore (window.doc / window.getDoc / window.db) and actually EXERCISE the
 * plan logic — free defaults, an active professional sub, owner bypass, and a
 * past_due (inactive) sub. This drives the real code path the dashboard uses to
 * decide "is this feature available?", not a source grep.
 *
 * Zero deps. Run: node tests/billing-gate.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/billing-gate.js'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function assert(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

// Build a fresh sandboxed NBDBilling whose Firestore getDoc returns `subDoc`.
function makeBilling({ user, subDoc, subExists = true } = {}) {
  const noopEl = () => ({ style: {}, appendChild() {}, addEventListener() {}, remove() {}, dataset: {} });
  const documentStub = {
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; },
    createElement() { return noopEl(); },
    body: noopEl(),
  };
  const windowStub = {
    _user: user || null,
    db: {},
    doc: (_db, coll, id) => ({ coll, id }),
    getDoc: async () => ({ exists: () => subExists, data: () => subDoc || {} }),
  };
  windowStub.window = windowStub;
  const sandbox = { window: windowStub, document: documentStub, console: { log() {}, error() {}, warn() {} }, setTimeout, Date };
  vm.runInNewContext(SRC, sandbox, { filename: 'billing-gate.js' });
  return windowStub.NBDBilling;
}

(async () => {
  console.log('BILLING GATE — plan decision logic');

  // 1. Free defaults (no subscription loaded yet).
  {
    const B = makeBilling({ user: { uid: 'u1', email: 'rep@demo.test' } });
    assert('exposes NBDBilling API (canUse/loadSubscription/getPlan)',
      B && typeof B.canUse === 'function' && typeof B.loadSubscription === 'function' && typeof B.getPlan === 'function');
    assert('free default: leads allowed (0 < 10)', B.canUse('leads') === true);
    assert('free default: team feature locked (reps == 1)', B.canUse('team') === false);
    assert('free default: reports locked (limit 0)', B.canUse('reports') === false);
    assert('free default: aiCalls locked (limit 0)', B.canUse('aiCalls') === false);
    assert('free default getPlan(): plan=free, not active', B.getPlan().plan === 'free' && B.getPlan().isActive === false);
  }

  // 2. Active professional subscription → unlocks team/reports/aiCalls.
  {
    const B = makeBilling({ user: { uid: 'u2', email: 'admin@demo.test' }, subDoc: { plan: 'professional', status: 'active' } });
    await B.loadSubscription();
    const p = B.getPlan();
    assert('professional: getPlan().plan === professional', p.plan === 'professional');
    assert('professional: isActive === true', p.isActive === true);
    assert('professional: team unlocked (reps 5 > 1)', B.canUse('team') === true);
    assert('professional: reports unlocked (Infinity)', B.canUse('reports') === true);
    assert('professional: aiCalls unlocked (Infinity)', B.canUse('aiCalls') === true);
  }

  // 3. Owner email bypass → enterprise, never gated (short-circuits Firestore).
  {
    const B = makeBilling({ user: { uid: 'owner', email: 'jonathandeal459@gmail.com' }, subDoc: { plan: 'free', status: 'none' } });
    await B.loadSubscription();
    assert('owner bypass: getPlan().plan === enterprise', B.getPlan().plan === 'enterprise');
    assert('owner bypass: canUse(team) true despite free sub doc', B.canUse('team') === true);
    assert('owner bypass: canUse(leads) true', B.canUse('leads') === true);
  }

  // 4. past_due subscription → plan set but NOT active.
  {
    const B = makeBilling({ user: { uid: 'u4', email: 'late@demo.test' }, subDoc: { plan: 'professional', status: 'past_due' } });
    await B.loadSubscription();
    const p = B.getPlan();
    assert('past_due: getPlan().isActive === false', p.isActive === false);
    assert('past_due: isPastDue === true', p.isPastDue === true);
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})().catch(e => { console.error('billing-gate test crashed:', e); process.exit(1); });

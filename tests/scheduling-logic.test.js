/**
 * tests/scheduling-logic.test.js — Phase 5 follow-up / scheduling brain.
 *
 * Exercises SmartFollowup.computeSuggestion (smart-followup.js) in a vm sandbox —
 * the pure decision tree that drives the smart-followup panel and briefing:
 * terminal/snoozed → wait, customer-responded → urgent, and the priority ranking
 * helpers. Task CRUD persistence is covered in lead-lifecycle.test.js (tasks use
 * the same owner-scoped rule as leads).
 *
 * Zero deps. Run: node tests/scheduling-logic.test.js
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
  const store = {};
  const win = {
    addEventListener() {}, removeEventListener() {},
    location: { pathname: '/pro/dashboard' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  };
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

const win = loadIIFE('smart-followup.js');
const SF = win.SmartFollowup;
const now = Date.now();

console.log('SMART FOLLOWUP — computeSuggestion decision tree');
ok('exposes SmartFollowup.computeSuggestion', SF && typeof SF.computeSuggestion === 'function');

// guard: no lead / no id → null
ok('null lead → null', SF.computeSuggestion(null) === null);
ok('lead without id → null', SF.computeSuggestion({ stage: 'new' }) === null);

// terminal stage → wait
{
  const s = SF.computeSuggestion({ id: 'L1', stage: 'closed' });
  ok('terminal stage → priority wait', s && s.priority === 'wait');
  ok('terminal stage → signals include terminal-stage', s.signals.includes('terminal-stage'));
}

// snoozed (stub LeadSnooze) → wait
{
  win.LeadSnooze = { isSnoozed: () => true, snoozedUntilDate: () => null };
  const s = SF.computeSuggestion({ id: 'L2', stage: 'inspected', snoozedReason: 'callback Friday' });
  ok('snoozed lead → priority wait', s && s.priority === 'wait');
  ok('snoozed lead → signals include snoozed', s.signals.includes('snoozed'));
  win.LeadSnooze = undefined;
}

// customer responded to estimate → urgent follow-up
{
  const lead = { id: 'L3', stage: 'quoted', phone: '5550100', email: 'a@b.com', name: 'Dana' };
  const s = SF.computeSuggestion(lead, { estimates: [{ leadId: 'L3', respondedAt: now - 3600e3 }] });
  ok('responded estimate → priority urgent', s && s.priority === 'urgent');
  ok('responded estimate → action follow-up', s.action === 'follow-up');
  ok('responded estimate → signals include responded', s.signals.includes('responded'));
}

// an ordinary active lead → returns a well-formed suggestion (no crash)
{
  const s = SF.computeSuggestion({ id: 'L4', stage: 'inspected', phone: '5550100', updatedAt: new Date(now - 2 * 86400e3).toISOString() });
  ok('active lead → returns suggestion object', s && typeof s === 'object' && typeof s.priority === 'string');
  ok('active lead → signals is an array', Array.isArray(s.signals));
  ok('active lead → confidence within 0-100', typeof s.confidence === 'number' && s.confidence >= 0 && s.confidence <= 100);
}

// priority ranking helpers
console.log('\nPRIORITY RANKING');
ok('PRIORITY_ORDER maps urgent highest, wait lowest', SF.PRIORITY_ORDER.urgent > SF.PRIORITY_ORDER.wait && SF.PRIORITY_ORDER.wait === 0);
ok('priorityRank ranks an urgent suggestion above a wait one', SF.priorityRank({ priority: 'urgent' }) > SF.priorityRank({ priority: 'wait' }));

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }

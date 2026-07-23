/**
 * tests/voice-consumer.test.js — the transforms behind the voiceConsumer
 * trigger (functions/voice-consumer-logic.js, shared verbatim by the trigger).
 *
 * Guards the two data-safety invariants that matter: (1) the trigger NEVER
 * overwrites an insurance field the rep already typed — it only fills blanks;
 * (2) a bad/relative `when` becomes an undated task, never a wrong due date.
 * Plus dedup/caps so one call can't flood a lead.
 *
 * Zero deps (the logic file has no firebase imports).
 * Run: node tests/voice-consumer.test.js
 */
'use strict';

const path = require('path');
const V = require(path.join('..', 'functions', 'voice-consumer-logic.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('VOICE CONSUMER — summary → CRM actions');

// tasksFromSummary
{
  const summary = {
    nextActions: ['Email the signed contract', 'Order materials'],
    commitments: [
      { who: 'rep', what: 'send the estimate', when: '2026-07-25' },
      { who: 'homeowner', what: 'decide on color', when: 'next week' },
      { who: '', what: 'call the adjuster', when: null },
    ],
  };
  const tasks = V.tasksFromSummary(summary);
  ok('nextActions become tasks', tasks.some(t => t.text === 'Email the signed contract'));
  ok('commitment renders "Who: what"', tasks.some(t => t.text === 'Rep: send the estimate' && t.dueDate === '2026-07-25'));
  ok('ISO `when` → due date', tasks.find(t => /send the estimate/.test(t.text)).dueDate === '2026-07-25');
  ok('relative `when` ("next week") → NO due date (never a wrong date)',
    tasks.find(t => /decide on color/.test(t.text)).dueDate === '');
  ok('null `when` → no due date', tasks.find(t => /call the adjuster/.test(t.text)).dueDate === '');
  ok('empty summary → no tasks', V.tasksFromSummary({}).length === 0 && V.tasksFromSummary(null).length === 0);

  // dedup + cap
  const dup = { nextActions: Array.from({ length: 20 }, (_, i) => 'Task ' + (i % 3)) };
  const capped = V.tasksFromSummary(dup);
  ok('duplicate actions deduped', capped.length === 3);
  const many = { nextActions: Array.from({ length: 30 }, (_, i) => 'Unique task ' + i) };
  ok('a single call cannot flood (capped at MAX_TASKS)', V.tasksFromSummary(many).length === V.MAX_TASKS);
}

// parseWhen edge cases
{
  ok('parseWhen: full ISO datetime', V.parseWhen('2026-07-25T14:00:00Z') === '2026-07-25');
  ok('parseWhen: date only', V.parseWhen('2026-07-25') === '2026-07-25');
  ok('parseWhen: free text → empty', V.parseWhen('tomorrow') === '' && V.parseWhen('next Tuesday') === '');
  ok('parseWhen: impossible date → empty', V.parseWhen('2026-13-45') === '');
  ok('parseWhen: blank / null → empty', V.parseWhen('') === '' && V.parseWhen(null) === '');
}

// insuranceBackfill — the no-overwrite guarantee
{
  const summary = { insuranceDetails: { carrier: 'State Farm', claimNumber: 'CLM-9', adjuster: 'Pat A', deductible: '$1000' } };

  const empty = V.insuranceBackfill({}, summary);
  ok('fills all blank insurance fields from the call',
    empty.insCarrier === 'State Farm' && empty.claimNumber === 'CLM-9' && empty.adjuster === 'Pat A' && empty.deductible === '$1000');

  const repTyped = { insCarrier: 'Allstate', claimNumber: '', adjuster: 'Existing Adj', deductible: null };
  const patch = V.insuranceBackfill(repTyped, summary);
  ok('NEVER overwrites a rep-entered carrier', !('insCarrier' in patch));
  ok('NEVER overwrites a rep-entered adjuster', !('adjuster' in patch));
  ok('DOES fill an empty-string field', patch.claimNumber === 'CLM-9');
  ok('DOES fill a null field', patch.deductible === '$1000');

  ok('no summary values → empty patch (caller skips the write)',
    Object.keys(V.insuranceBackfill({}, { insuranceDetails: { carrier: null, claimNumber: '' } })).length === 0);
  ok('null-ish summary never throws', Object.keys(V.insuranceBackfill(null, null)).length === 0);
}

// denormalizeSignals
{
  const summary = {
    redFlags: ['Mentioned a competitor', 'Mentioned a competitor', '  Budget concern  ', ''],
    objections: ['Price too high', 'Wants to think it over'],
  };
  const sig = V.denormalizeSignals(summary);
  ok('redFlags deduped + trimmed', sig.callRedFlags.length === 2 && sig.callRedFlags.includes('Budget concern'));
  ok('objections carried through', sig.callObjections.length === 2 && sig.callObjections.includes('Price too high'));
  ok('signals capped at MAX_SIGNALS',
    V.denormalizeSignals({ redFlags: Array.from({ length: 40 }, (_, i) => 'flag ' + i) }).callRedFlags.length === V.MAX_SIGNALS);
  ok('empty / null summary → empty arrays',
    V.denormalizeSignals(null).callRedFlags.length === 0 && V.denormalizeSignals({}).callObjections.length === 0);
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

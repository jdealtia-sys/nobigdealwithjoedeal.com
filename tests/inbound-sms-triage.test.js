/**
 * tests/inbound-sms-triage.test.js — the classify/sort layer behind the
 * unmatched-SMS admin triage inbox (docs/pro/js/inbound-sms-triage.js).
 *
 * Guards the design bias: UNDER-filter. A real inbound lead hidden as "spam"
 * is a lost deal; a carrier keyword shown is a shrug. So only unambiguous
 * noise is set aside, everything else stays in the actionable inbox.
 *
 * Zero deps. Run: node tests/inbound-sms-triage.test.js
 */
'use strict';

const path = require('path');
const T = require(path.join('..', 'docs', 'pro', 'js', 'inbound-sms-triage.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const kind = (b) => T.classifyInbound(b).kind;

console.log('INBOUND-SMS TRIAGE');

// classification
{
  ok('a real message is a possible lead',
    kind('Hey saw your yard sign, my roof is leaking after the storm — can someone come look?') === 'lead');
  ok('bare STOP is an opt-out', kind('STOP') === 'optout' && kind('unsubscribe') === 'optout');
  ok('carrier keyword (HELP/START/YES) is noise', kind('HELP') === 'noise' && kind('START') === 'noise' && kind('Yes') === 'noise');
  ok('empty / whitespace is noise', kind('') === 'noise' && kind('   ') === 'noise');
  ok('single character is noise', kind('?') === 'noise');
  // under-filter guard: keyword-ish content that is actually a message stays a lead
  ok('"stop by anytime this week" is a LEAD, not an opt-out (under-filter)', kind('Stop by anytime this week') === 'lead');
  ok('"yes please call me tomorrow" is a LEAD, not noise', kind('Yes please call me tomorrow at noon') === 'lead');
  ok('a phone-shaped body is still a lead (someone left a callback #)', kind('call me 5135551234') === 'lead');
}

// triage: sorting + partition
{
  const now = 1_800_000_000_000;
  const at = (m) => ({ seconds: Math.floor((now - m * 60000) / 1000) });
  const docs = [
    { id: 'a', from: '+15135550100', body: 'Storm hit my roof, need an estimate', receivedAt: at(30) },
    { id: 'b', from: '15135550200', body: 'STOP', receivedAt: at(5) },
    { id: 'c', from: '(513) 555-0300', body: 'Do you do metal roofs?', receivedAt: at(2) },
    { id: 'd', from: '', body: '', receivedAt: at(1) },
    null,
  ];
  const r = T.triageInbound(docs);
  ok('actionable holds only the two real leads', r.actionable.length === 2);
  ok('actionable is newest-first (c before a)', r.actionable[0].id === 'c' && r.actionable[1].id === 'a');
  ok('STOP + empty land in the filtered pile', r.filtered.length === 2 && r.filtered.some(x => x.id === 'b') && r.filtered.some(x => x.id === 'd'));
  ok('null doc never throws / is dropped', r.actionable.length + r.filtered.length === 4);
  ok('rows carry a display phone for the UI', r.actionable[1]._display === '(513) 555-0100');
}

// phone formatting
{
  ok('formats 10-digit US', T.displayPhone('5135551234') === '(513) 555-1234');
  ok('strips leading country code', T.displayPhone('+15135551234') === '(513) 555-1234');
  ok('passes through unknown shapes untouched', T.displayPhone('short') === 'short');
  ok('digits() extracts only numerals', T.digits('+1 (513) 555-1234') === '15135551234');
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

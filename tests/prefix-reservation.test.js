/**
 * tests/prefix-reservation.test.js — reserveCompanyPrefix decision logic.
 *
 * Unit-tests the pure core of the cross-tenant customer-ID prefix guard
 * (functions/prefix-reservation.js): seal validation + the transaction decision
 * that makes prefixes globally unique. The Firestore I/O around it lives in
 * functions/handlers/provisioning.js:reserveCompanyPrefix; the security-critical
 * DECISION — "a prefix held by another company is rejected" — is here.
 *
 * Zero deps (pure module, like customer-id.js). Run: node tests/prefix-reservation.test.js
 */
'use strict';

const { validateSeal, decideReservation } = require('../functions/prefix-reservation');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

console.log('validateSeal — shape + reserved word');
ok('accepts OAK', validateSeal('OAK').seal === 'OAK');
ok('uppercases + trims', validateSeal('  oak ').seal === 'OAK');
ok('accepts 2 chars', validateSeal('AB').seal === 'AB');
ok('accepts 4 chars', validateSeal('ABCD').seal === 'ABCD');
ok('accepts digits', validateSeal('R1').seal === 'R1');
ok('rejects 1 char', !!validateSeal('A').error);
ok('rejects 5 chars', !!validateSeal('ABCDE').error);
ok('rejects punctuation', !!validateSeal('A-B').error);
ok('rejects empty', !!validateSeal('').error);
ok('rejects NBD (platform sentinel)', !!validateSeal('NBD').error);
ok('rejects nbd lowercase (normalized to NBD)', !!validateSeal('nbd').error);

console.log('\ndecideReservation — free slot');
ok('free + no existing prefix → claim',
  decideReservation({ prefixExists: false, existingPrefix: undefined, companyId: 'co-a', seal: 'OAK' }).action === 'claim');
ok('free + already has SAME prefix (re-run) → claim',
  decideReservation({ prefixExists: false, existingPrefix: 'OAK', companyId: 'co-a', seal: 'OAK' }).action === 'claim');

console.log('\ndecideReservation — slot taken');
{
  const d = decideReservation({ prefixExists: true, prefixOwner: 'co-b', companyId: 'co-a', seal: 'OAK' });
  ok('taken by OTHER company → reject already-exists (THE collision guard)',
    d.action === 'reject' && d.code === 'already-exists');
}
ok('taken by SAME company → idempotent no-op',
  decideReservation({ prefixExists: true, prefixOwner: 'co-a', companyId: 'co-a', seal: 'OAK' }).action === 'idempotent');

console.log('\ndecideReservation — rotation guard');
{
  const d = decideReservation({ prefixExists: false, existingPrefix: 'OLD', companyId: 'co-a', seal: 'NEW' });
  ok('tenant already holds a DIFFERENT prefix → reject failed-precondition',
    d.action === 'reject' && d.code === 'failed-precondition');
}

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('✓ All prefix-reservation tests passed');

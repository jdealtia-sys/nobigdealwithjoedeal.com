/**
 * tests/collection-group-paths.test.js: the parent-path checks that
 * collection-group handlers use (2026-09-25, invite-claim path check).
 *
 * A collectionGroup(<name>) query matches <name> under ANY parent, so a
 * handler that trusts the hit's parent path, or a field on the hit, trusts
 * whoever could write a doc under that name anywhere. Two helpers pin it:
 *
 *   matchDocPath (functions/collection-group-paths.js): exact-shape match of
 *     a doc path against a template; used by the invite lookup
 *     (functions/handlers/invite-lookup.js) for companies/{id}/members/{email}.
 *   retentionAudioPathFor (functions/integrations/voice-intelligence.js): the
 *     recording retention cron deletes a Storage object named by the doc's
 *     audioPath field; it now does so only for a doc at
 *     leads/{leadId}/recordings/{recordingId} whose audioPath names that same
 *     lead + recording.
 *
 * The handler-level behaviour (claimInvite / onRepSignup against the
 * emulator) is in tests/invite-claim-path.integration.test.js.
 *
 * Run: node tests/collection-group-paths.test.js  (needs functions/node_modules
 * for the voice-intelligence require, same as the unit-suite job installs)
 */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { matchDocPath } = require(path.join(ROOT, 'functions/collection-group-paths.js'));
const { INVITE_PATH, INVITE_SCAN_LIMIT } = require(path.join(ROOT, 'functions/handlers/invite-lookup.js'));
const { _retentionAudioPathFor: audioFor } = require(path.join(ROOT, 'functions/integrations/voice-intelligence.js'));

console.log('\nmatchDocPath — exact shape only');
{
  const T = 'companies/{companyId}/members/{memberId}';
  ok('the invite lookup uses this template', INVITE_PATH === T);
  ok('the invite lookup reads more than one hit per page', INVITE_SCAN_LIMIT >= 2);
  ok('canonical path → bound ids',
    same(matchDocPath(T, 'companies/c1/members/a@b.co'), { companyId: 'c1', memberId: 'a@b.co' }));
  ok('users/{uid}/members → null', matchDocPath(T, 'users/u1/members/a@b.co') === null);
  ok('another top-level collection → null', matchDocPath(T, 'aaa/x/members/a@b.co') === null);
  ok('nested deeper under a company → null', matchDocPath(T, 'companies/c1/teams/t1/members/a@b.co') === null);
  ok('right parent, wrong collection name → null', matchDocPath(T, 'companies/c1/member/a@b.co') === null);
  ok('too short → null', matchDocPath(T, 'companies/c1/members') === null);
  ok('empty segment → null', matchDocPath(T, 'companies//members/a@b.co') === null);
  ok('leading slash is not the relative path shape → null', matchDocPath(T, '/companies/c1/members/a@b.co') === null);
  ok('non-string path → null', matchDocPath(T, null) === null && matchDocPath(T, undefined) === null);
  ok('non-string template → null', matchDocPath(undefined, 'companies/c1/members/a') === null);
  ok('literal-only template matches itself',
    same(matchDocPath('system/migrations', 'system/migrations'), {}));
}

console.log('\nretentionAudioPathFor — the cron deletes only a recording\'s own audio');
{
  const A = 'audio/u1/L1/R1.webm';
  ok('leads/{L}/recordings/{R} + audio/{uid}/{L}/{R}.ext → that audio path',
    audioFor('leads/L1/recordings/R1', A) === A);
  ok('any audio extension processRecording accepts', audioFor('leads/L1/recordings/R1', 'audio/u1/L1/R1.m4a') === 'audio/u1/L1/R1.m4a');
  ok('a recordings doc under users/{uid} → null', audioFor('users/u9/recordings/R1', A) === null);
  ok('a recordings doc nested deeper → null', audioFor('companies/c/leads/L1/recordings/R1', A) === null);
  ok('audioPath naming ANOTHER lead → null', audioFor('leads/L2/recordings/R1', A) === null);
  ok('audioPath naming ANOTHER recording → null', audioFor('leads/L1/recordings/R2', A) === null);
  ok('audioPath outside audio/ → null', audioFor('leads/L1/recordings/R1', 'photos/u1/L1/R1.webm') === null);
  ok('traversal-shaped audioPath → null', audioFor('leads/L1/recordings/R1', 'audio/u1/L1/../x/R1.webm') === null);
  ok('missing audioPath → null', audioFor('leads/L1/recordings/R1', undefined) === null);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('FAILED:\n  ' + fails.join('\n  '));
  process.exit(1);
}

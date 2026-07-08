/**
 * stage-roles.test.js — guard for functions/stage-roles.js, the SERVER mirror
 * of the client semantic roles (freeform pipelines, Phase 3).
 *
 * Proves: built-in keys classify identically to the client (tests/crm-stages-
 * roles.test.js); a lead's PERSISTED stageRole wins (so a tenant CUSTOM stage
 * is understood server-side); legacy raw names still classify.
 *
 * Run: node tests/stage-roles.test.js
 */
'use strict';
const path = require('path');
const R = require(path.join(__dirname, '..', 'functions', 'stage-roles.js'));

let passed = 0, failed = 0; const fails = [];
function ok(n, c) { if (c) { passed++; } else { failed++; fails.push(n); console.log('  ✗ ' + n); } }

// ── built-in key → role (must match crm-stages.js) ──
['closed', 'install_complete', 'final_photos', 'final_payment', 'deductible_collected']
  .forEach(k => ok('won key ' + k, R.roleFromKey(k) === R.ROLE.WON));
ok('lost key', R.roleFromKey('lost') === R.ROLE.LOST);
ok('new key', R.roleFromKey('new') === R.ROLE.NEW);
ok('install_in_progress → job', R.roleFromKey('install_in_progress') === R.ROLE.JOB);
ok('contract_signed → active (NOT won)', R.roleFromKey('contract_signed') === R.ROLE.ACTIVE);
ok('unknown key → active', R.roleFromKey('totally_made_up') === R.ROLE.ACTIVE);

// ── legacy raw display names ──
ok("'Complete' → won", R.roleFromKey('Complete') === R.ROLE.WON);
ok("'Closed Won' → won", R.roleFromKey('Closed Won') === R.ROLE.WON);
ok("'Lost' → lost", R.roleFromKey('Lost') === R.ROLE.LOST);

// ── roleFor: persisted stageRole wins (custom-stage-safe) ──
ok('custom stage w/ persisted role → that role', R.roleFor({ _stageKey: 'custom_review', stageRole: 'won' }) === R.ROLE.WON);
ok('custom stage w/o role → key fallback (active)', R.roleFor({ _stageKey: 'custom_review' }) === R.ROLE.ACTIVE);
ok('invalid persisted role ignored → key', R.roleFor({ stage: 'closed', stageRole: 'bogus' }) === R.ROLE.WON);
ok('_stageKey preferred over raw stage', R.roleFor({ _stageKey: 'closed', stage: 'new' }) === R.ROLE.WON);
ok('empty lead → new', R.roleFor({}) === R.ROLE.NEW);

// ── helpers ──
ok('isWon built-in closed', R.isWon({ stage: 'closed' }) === true);
ok('isWon custom (persisted role)', R.isWon({ stageRole: 'won', stage: 'anything' }) === true);
ok('isWon false for lost', R.isWon({ stage: 'lost' }) === false);
ok('isLost lost', R.isLost({ stage: 'lost' }) === true);
ok('isDecided won', R.isDecided({ stage: 'closed' }) === true);
ok('isDecided lost', R.isDecided({ stage: 'lost' }) === true);
ok('isDecided false for active', R.isDecided({ stage: 'contract_signed' }) === false);

console.log('\n' + (failed === 0 ? '✓' : '✗') + ' stage-roles: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILURES:\n  ' + fails.join('\n  ')); process.exit(1); }

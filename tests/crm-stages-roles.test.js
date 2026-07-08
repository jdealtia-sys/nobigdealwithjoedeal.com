/**
 * crm-stages-roles.test.js — regression guard for the semantic-role foundation
 * (freeform-pipeline Phase 0).
 *
 * The KPI / money / leaderboard / dashboard-api consumers no longer hardcode a
 * WON_STAGES list — they classify a lead by its `_stageRole` (won/lost/active/
 * job/new). This test proves stageRole()/isWonStage()/isLostStage() reproduce
 * the LEGACY WON_STAGES / LOST_STAGES behaviour EXACTLY, so that migration
 * can't silently drift revenue / close-rate / leaderboard "won" counts.
 *
 * crm-stages.js is an ES module (browser <script type=module>); Node has no
 * ESM loader wired here, so we strip the `export` keywords and run it in a vm
 * (same pattern as money-dashboard.test.js).
 *
 * Run: node tests/crm-stages-roles.test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

let src = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/crm-stages.js'), 'utf8');
src = src.replace(/export\s+function\s+/g, 'function ').replace(/export\s+const\s+/g, 'const ');
src += '\nthis.__out = { S, STAGE_META, stageRole, isWonStage, isLostStage, ROLE, normalizeStage };';
const sandbox = { console };
vm.runInNewContext(src, sandbox, { filename: 'crm-stages.js' });
const { S, STAGE_META, stageRole, isWonStage, isLostStage, ROLE, normalizeStage } = sandbox.__out;

// The legacy canonical sets the roles must reproduce (copy-pasted across
// analytics-kpi / money-dashboard / dashboard-api / leaderboard before Phase 0).
const LEGACY_WON = ['closed', 'install_complete', 'final_photos', 'final_payment', 'deductible_collected', 'Complete'];

ok('module exports present', !!(stageRole && isWonStage && isLostStage && STAGE_META && ROLE));

// 1. For every real stage key, isWonStage matches raw legacy-list membership.
Object.keys(STAGE_META).forEach(k => {
  ok('isWonStage(' + k + ') == legacy', isWonStage(k) === LEGACY_WON.includes(k));
});

// 2. The won set is EXACTLY the five completion stages (no more, no less).
const wonKeys = Object.keys(STAGE_META).filter(k => stageRole(k) === ROLE.WON).sort();
const expectWon = ['closed', 'deductible_collected', 'final_payment', 'final_photos', 'install_complete'].sort();
ok('won set is exactly the 5 completion stages (' + wonKeys.join(',') + ')',
  JSON.stringify(wonKeys) === JSON.stringify(expectWon));

// 3. Legacy display names normalize + classify correctly (the raw values that
//    still live on old lead docs).
ok("legacy 'Complete' → won", isWonStage('Complete') === true);
ok("legacy 'Closed Won' → won", isWonStage('Closed Won') === true);
ok("legacy 'Lost' → lost", isLostStage('Lost') === true);
ok("'lost' → lost", isLostStage('lost') === true);

// 4. Role buckets for representative stages.
ok("'new' → new role", stageRole('new') === ROLE.NEW);
ok("'contract_signed' → active (NOT won)", stageRole('contract_signed') === ROLE.ACTIVE && !isWonStage('contract_signed'));
ok("'install_in_progress' → job (in-production, NOT won)", stageRole('install_in_progress') === ROLE.JOB && !isWonStage('install_in_progress'));
ok("unknown stage → new (normalizeStage fallback)", stageRole('zzz-does-not-exist') === ROLE.NEW);

// 5. role stamped onto STAGE_META (Phase-1 config resolver reads it).
ok('STAGE_META.closed.role === won', STAGE_META[S.CLOSED].role === ROLE.WON);
ok('STAGE_META.lost.role === lost', STAGE_META[S.LOST].role === ROLE.LOST);

console.log('\n' + (failed === 0 ? '✓' : '✗') + ' crm-stages roles: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILURES:\n  ' + fails.join('\n  ')); process.exit(1); }

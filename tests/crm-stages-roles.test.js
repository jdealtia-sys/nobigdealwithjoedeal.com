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
src += '\nthis.__out = { S, STAGE_META, stageRole, isWonStage, isLostStage, ROLE, normalizeStage, resolveColumn, resolvePipelineConfig, KANBAN_VIEWS };';
// A `window` global so the module's live-custom-key lookup (normalizeStage now
// consults window.STAGE_META) is exercisable; empty at load so the existing
// default-behaviour assertions below are unaffected.
const sandbox = { console, window: {} };
vm.runInNewContext(src, sandbox, { filename: 'crm-stages.js' });
const { S, STAGE_META, stageRole, isWonStage, isLostStage, ROLE, normalizeStage, resolveColumn, resolvePipelineConfig, KANBAN_VIEWS } = sandbox.__out;

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

// ── Phase 1: resolvePipelineConfig (per-tenant config over defaults) ──
ok('resolvePipelineConfig exported', typeof resolvePipelineConfig === 'function');

// empty / malformed config → defaults unchanged
const r0 = resolvePipelineConfig(null);
ok('null config → default stageMeta', Object.keys(r0.stageMeta).length === Object.keys(STAGE_META).length);
ok('null config → default views', Object.keys(r0.views).length === Object.keys(KANBAN_VIEWS).length);
ok('null config → roleOf still works', r0.roleOf('closed') === ROLE.WON);
ok('garbage config → no throw, defaults', resolvePipelineConfig(42).stageMeta.closed.role === ROLE.WON);

// override a built-in label + color (role untouched)
const r1 = resolvePipelineConfig({ stages: { inspected: { label: 'Site Visit', color: '#123456' } } });
ok('built-in label overridden', r1.stageMeta.inspected.label === 'Site Visit');
ok('built-in color overridden', r1.stageMeta.inspected.color === '#123456');
ok('override keeps original role', r1.stageMeta.inspected.role === STAGE_META.inspected.role);
ok('override does not mutate the default STAGE_META', STAGE_META.inspected.label !== 'Site Visit');

// custom stage WITH a role is added; roleOf classifies it (custom key, no normalize)
const r2 = resolvePipelineConfig({ stages: { my_review: { label: 'My Review', role: 'active', icon: '🔎' } } });
ok('custom stage added', !!r2.stageMeta.my_review && r2.stageMeta.my_review.custom === true);
ok('custom stage role via roleOf', r2.roleOf('my_review') === ROLE.ACTIVE);
ok('custom stage default color when omitted', r2.stageMeta.my_review.color === '#374151');

// custom stage WITHOUT a valid role is rejected (fail-safe)
const r3 = resolvePipelineConfig({ stages: { bad: { label: 'No Role' } } });
ok('custom stage w/o role skipped', !r3.stageMeta.bad && r3.errors.length > 0);

// a tenant can REMAP a built-in stage's role (e.g., contract_signed → won)
const r4 = resolvePipelineConfig({ stages: { contract_signed: { role: 'won' } } });
ok('role remap: contract_signed → won', r4.roleOf('contract_signed') === ROLE.WON);

// view override replaces the ordered stage list (invalid stages filtered out)
const r5 = resolvePipelineConfig({ views: { cash: { label: 'Homeowner Pays', stages: ['new', 'contract_signed', 'not_a_stage'] } } });
ok('view stages overridden + filtered', JSON.stringify(r5.views.cash.stages) === JSON.stringify(['new', 'contract_signed']));
ok('view label overridden', r5.views.cash.label === 'Homeowner Pays');
// a view with ONLY invalid stages keeps the default (fail-safe)
const r6 = resolvePipelineConfig({ views: { cash: { stages: ['nope', 'zzz'] } } });
ok('all-invalid view keeps default stages', r6.views.cash.stages.length === KANBAN_VIEWS.cash.stages.length && r6.errors.length > 0);

// ── Phase 3: custom-stage ROUND-TRIP — client resolve → persist → SERVER classify ──
// The freeform-pipeline contract: the client resolves a tenant's custom stage
// to a role, stamps it on the lead (_stageRole → persisted stageRole), and the
// SERVER (functions/stage-roles.js) classifies by that PERSISTED role — since it
// has no idea what the custom stage means. This ties the two suites together and
// proves the exact gap the backfill (scripts/backfill-lead-stageRole.js) closes.
const server = require('../functions/stage-roles');
// A tenant invents "custom_walkthru" and declares it WON.
const rt = resolvePipelineConfig({
  stages: { custom_walkthru: { label: 'Final Walkthrough', role: 'won' } },
  views:  { cash: { stages: ['new', 'contract_signed', 'custom_walkthru'] } },
});
ok('round-trip: custom stage present in the resolved view',
  rt.views.cash.stages.indexOf('custom_walkthru') !== -1);
ok('round-trip: client resolves the custom stage → won',
  rt.roleOf('custom_walkthru') === ROLE.WON);
// The client stamps that role on the lead; the server MUST honour the persisted
// value (custom-stage-safe path).
const persistedRole = rt.roleOf('custom_walkthru');
ok('round-trip: server honours the persisted stageRole (won)',
  server.roleFor({ stage: 'custom_walkthru', stageRole: persistedRole }) === server.ROLE.WON);
ok('round-trip: server isWon on the persisted custom-stage lead',
  server.isWon({ stage: 'custom_walkthru', stageRole: persistedRole }) === true);
// A LEGACY lead on the same custom stage with NO persisted role falls back to
// the key map and MISclassifies (active) — the precise gap the backfill fixes.
ok('round-trip: legacy (no stageRole) misclassifies as active — why the backfill exists',
  server.roleFor({ stage: 'custom_walkthru' }) === server.ROLE.ACTIVE);
// Built-in stages still agree client↔server without any persisted role.
ok('round-trip: built-in closed agrees client + server',
  rt.roleOf('closed') === ROLE.WON && server.roleFor({ stage: 'closed' }) === server.ROLE.WON);

// ── #921 regression: custom-stage BOARD BUCKETING ──────────────────────────
// The round-trip test above proves roleOf() classifies a custom stage — but the
// board bug lived elsewhere: a tenant custom_* key exists ONLY on
// window.STAGE_META (the resolved config), never on the module-local default
// STAGE_META. normalizeStage() ignored window.STAGE_META, so
// normalizeStage('custom_qc') → 'new' and resolveColumn() bucketed the lead into
// the New column while its custom column rendered empty. The roleOf coverage
// above never exercised normalizeStage/resolveColumn — that's the gap that let
// the bug ship. These assert the render-path helpers now resolve a LIVE custom
// key to ITS OWN column.
const board = resolvePipelineConfig({
  stages: { custom_qc: { label: 'QC Review', role: ROLE.ACTIVE, color: '#3366cc' } },
  views:  { insurance: { stages: ['new', 'custom_qc', 'closed', 'lost'] } },
});
ok('board: custom stage resolved without errors', board.errors.length === 0);
ok('board: custom key present on resolved meta', !!board.stageMeta.custom_qc);
// Publish the resolved meta onto window the way applyPipelineConfig does at runtime.
sandbox.window.STAGE_META = board.stageMeta;
sandbox.window.KANBAN_VIEWS = board.views;
// These two FAIL before the fix (both collapse to 'new'):
ok('board: normalizeStage preserves a live custom key',
  normalizeStage('custom_qc') === 'custom_qc');
ok('board: resolveColumn buckets a custom-stage lead into its own column',
  resolveColumn('custom_qc', board.views.insurance.stages) === 'custom_qc');
// Guard rails: a built-in key still buckets to itself with a live config set,
ok('board: built-in key still buckets to itself',
  resolveColumn('closed', board.views.insurance.stages) === 'closed');
// and an unknown/removed key still falls back to New (no throw, no leak).
ok('board: unknown key falls back to New',
  normalizeStage('totally_bogus_stage_xyz') === S.NEW);
// Restore the empty window so nothing downstream sees a stale live config.
sandbox.window.STAGE_META = undefined;
sandbox.window.KANBAN_VIEWS = undefined;

// ── #981 follow-up: Simple-view collapse of advanced insurance sub-stages ───
// The Simple 7-column view hides the fine-grained adjuster/supplement columns.
// Those sub-stages must collapse LEFT to a sensible mid-pipeline column — NOT
// fall through to New. Pre-fix, adjuster_inspection_done / supplement_requested
// / supplement_approved all bucketed into New: their PARENT column (Adjuster /
// Supplement) is ALSO hidden in Simple, and the old single-hop group map gave
// up instead of walking on to the next visible ancestor.
const SIMPLE = KANBAN_VIEWS.simple.stages;
const scol = (k) => resolveColumn(k, SIMPLE);

// (a) the regression itself: no insurance sub-stage may land on New.
['claim_filed', 'adjuster_meeting_scheduled', 'adjuster_inspection_done',
 'scope_received', 'supplement_requested', 'supplement_approved'].forEach(k => {
  ok('simple: insurance sub-stage ' + k + ' does NOT fall through to New', scol(k) !== S.NEW);
});
// (b) the exact target columns — adjuster phase → Inspected, scope/supplement → Estimate.
ok('simple: adjuster_inspection_done → Inspected (was New)', scol('adjuster_inspection_done') === S.INSPECTED);
ok('simple: claim_filed → Inspected (unchanged)',           scol('claim_filed') === S.INSPECTED);
ok('simple: adjuster_meeting_scheduled → Inspected (unchanged)', scol('adjuster_meeting_scheduled') === S.INSPECTED);
ok('simple: scope_received → Estimate Sent (unchanged)',    scol('scope_received') === S.ESTIMATE_SUBMITTED);
ok('simple: supplement_requested → Estimate Sent (was New)', scol('supplement_requested') === S.ESTIMATE_SUBMITTED);
ok('simple: supplement_approved → Estimate Sent (was New)',  scol('supplement_approved') === S.ESTIMATE_SUBMITTED);

// ── #981 follow-up: the revived Closed-grouping branch ──────────────────────
// Won/completed job stages collapse to Closed; in-production job stages to
// Installing. Before the reorder the Installing branch grabbed EVERY job stage
// first, so the Closed branch was dead and won deals (install_complete …
// final_payment) were mislabeled "Installing" in the Simple view.
['install_complete', 'final_photos', 'deductible_collected', 'final_payment'].forEach(k => {
  ok('simple: won job stage ' + k + ' → Closed (revived branch)', scol(k) === S.CLOSED);
});
['job_created', 'permit_pulled', 'materials_ordered', 'crew_scheduled', 'install_in_progress'].forEach(k => {
  ok('simple: in-production job stage ' + k + ' → Installing', scol(k) === S.INSTALL_IN_PROGRESS);
});

// ── Preservation guards (no drift in the primary views) ─────────────────────
// Full Insurance view: every stage is its own column — collapse never fires.
KANBAN_VIEWS.insurance.stages.forEach(k => {
  ok('insurance-full: ' + k + ' buckets to itself', resolveColumn(k, KANBAN_VIEWS.insurance.stages) === k);
});
// Warranty has Closed but no Installing → won-job stages still route to Closed
// (proves the branch reorder didn't kill the path that view actually relied on).
ok('warranty: install_complete → Closed (branch stays live)',
  resolveColumn('install_complete', KANBAN_VIEWS.warranty.stages) === S.CLOSED);
ok('warranty: in-production job_created → last non-Lost column (Closed)',
  resolveColumn('job_created', KANBAN_VIEWS.warranty.stages) === S.CLOSED);

console.log('\n' + (failed === 0 ? '✓' : '✗') + ' crm-stages roles: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILURES:\n  ' + fails.join('\n  ')); process.exit(1); }

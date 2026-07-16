/**
 * hidden-stage-bucketing.test.js — regression guard for the board's
 * hidden-stage handling (#921 QA follow-up).
 *
 * When a company_admin hides a stage via the Pipelines builder eye-toggle,
 * buildKanbanColumns drops that stage's column. Leads still sitting on that
 * stage must NOT leak into the first column (which would mislabel them and
 * inflate its count/$ badges) — they belong in the partition's `hidden` bucket
 * so the board's "N leads on hidden stages" chip can surface them (count + $)
 * instead of silently dropping them from the pipeline.
 *
 * partitionLeadsByColumn is the SINGLE source of truth the board render, the
 * chip, and this test all share — so these assertions cover the exact bucketing
 * the board uses, not a parallel re-implementation. (Per the standing rule:
 * "test column bucketing, not just roleOf.")
 *
 * crm-stages.js is an ES module (browser <script type=module>); Node has no
 * ESM loader wired here, so we strip the `export` keywords and run it in a vm
 * (same pattern as crm-stages-roles.test.js).
 *
 * Zero deps. Run: node tests/hidden-stage-bucketing.test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

let src = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/crm-stages.js'), 'utf8');
src = src.replace(/export\s+function\s+/g, 'function ').replace(/export\s+const\s+/g, 'const ');
src += '\nthis.__out = { S, STAGE_META, normalizeStage, resolveColumn, resolvePipelineConfig, KANBAN_VIEWS, partitionLeadsByColumn };';
// `window` starts empty (default-behaviour path). Some blocks below set
// window.STAGE_META so the module's live-custom-key lookup in normalizeStage
// resolves tenant custom_* keys exactly as it does in the browser.
const sandbox = { console, window: {} };
vm.runInNewContext(src, sandbox, { filename: 'crm-stages.js' });
const { S, STAGE_META, normalizeStage, resolveColumn, resolvePipelineConfig, KANBAN_VIEWS, partitionLeadsByColumn } = sandbox.__out;

// Mimic buildKanbanColumns: visible stages = view stages minus hidden, but
// never blank the board (fall back to all stages if hiding empties the view).
function visibleStages(viewStages, meta) {
  const vis = viewStages.filter(k => !(meta[k] && meta[k].hidden));
  return vis.length ? vis : viewStages.slice();
}
// Mimic renderHiddenStageChip's $ roll-up.
function sumJobValue(leads) { return leads.reduce((s, l) => s + (Number(l && l.jobValue) || 0), 0); }
// Standard injected deps — the board passes the same shape from window.*.
const DEPS = (meta) => ({ stageMeta: meta, normalize: normalizeStage, resolve: resolveColumn });

console.log('HIDDEN-STAGE BUCKETING — partitionLeadsByColumn');

// ── 0. sanity ──
ok('partitionLeadsByColumn is exported', typeof partitionLeadsByColumn === 'function');

// ── 1. no hidden stages → everything buckets, hidden empty ──
{
  const view = KANBAN_VIEWS.cash.stages;
  const leads = [
    { id: 'a', stage: 'new',             jobValue: 1000 },
    { id: 'b', stage: 'negotiating',     jobValue: 80000 },
    { id: 'c', stage: 'contract_signed', jobValue: 5000 },
  ];
  const { columns, hidden } = partitionLeadsByColumn(leads, view, DEPS(STAGE_META));
  ok('no hidden stages → hidden bucket empty', hidden.length === 0);
  ok('negotiating lead lands in its own column', columns[S.NEGOTIATING].some(l => l.id === 'b'));
  ok('new lead lands in New column', columns[S.NEW].some(l => l.id === 'a'));
}

// ── 2. hide a BUILT-IN stage → its leads go to hidden, NOT to New ──
{
  const cfg = { version: 1, stages: { [S.NEGOTIATING]: { hidden: true } }, views: {} };
  const resolved = resolvePipelineConfig(cfg);
  sandbox.window.STAGE_META = resolved.stageMeta;   // browser-parity lookup
  const meta = resolved.stageMeta;
  ok('config marks negotiating hidden', meta[S.NEGOTIATING].hidden === true);

  const view = visibleStages(KANBAN_VIEWS.cash.stages, meta);
  ok('negotiating removed from visible columns', !view.includes(S.NEGOTIATING));

  const leads = [
    { id: 'a', stage: 'new',             jobValue: 1000 },
    { id: 'b', stage: 'negotiating',     jobValue: 50000 },
    { id: 'c', stage: 'negotiating',     jobValue: 30000 },
    { id: 'd', stage: 'contract_signed', jobValue: 5000 },
  ];
  const { columns, hidden } = partitionLeadsByColumn(leads, view, DEPS(meta));
  ok('both negotiating leads in hidden bucket', hidden.length === 2 && hidden.every(l => l.stage === 'negotiating'));
  // The core regression: hidden-stage leads must NOT leak into the first column.
  ok('hidden leads do NOT leak into New column', !columns[S.NEW].some(l => l.id === 'b' || l.id === 'c'));
  ok('New column holds only the real New lead', columns[S.NEW].length === 1 && columns[S.NEW][0].id === 'a');
  ok('non-hidden lead still buckets correctly', columns[S.CONTRACT_SIGNED].some(l => l.id === 'd'));
  ok('hidden $ total is correct ($80k)', sumJobValue(hidden) === 80000);
  delete sandbox.window.STAGE_META;
}

// ── 3. CUSTOM hidden stage (#921 compounding case) → also caught, not leaked ──
{
  const cfg = {
    version: 1,
    stages: { custom_followup: { label: 'Long-Term Follow-Up', role: 'active', hidden: true } },
    views:  { cash: { stages: [S.NEW, S.CONTACTED, S.INSPECTED, 'custom_followup', S.NEGOTIATING, S.CONTRACT_SIGNED, S.LOST] } },
  };
  const resolved = resolvePipelineConfig(cfg);
  sandbox.window.STAGE_META = resolved.stageMeta;   // so normalizeStage resolves custom_*
  const meta = resolved.stageMeta;
  ok('custom stage created and hidden', !!meta.custom_followup && meta.custom_followup.hidden === true);

  const view = visibleStages(resolved.views.cash.stages, meta);
  ok('custom hidden stage not in visible columns', !view.includes('custom_followup'));

  const leads = [
    { id: 'a', stage: 'new',              jobValue: 1000 },
    { id: 'x', stage: 'custom_followup',  jobValue: 12000 },
  ];
  const { columns, hidden } = partitionLeadsByColumn(leads, view, DEPS(meta));
  ok('custom hidden lead in hidden bucket', hidden.some(l => l.id === 'x'));
  ok('custom hidden lead NOT leaked into New', !columns[S.NEW].some(l => l.id === 'x'));
  ok('custom hidden $ total correct ($12k)', sumJobValue(hidden) === 12000);
  delete sandbox.window.STAGE_META;
}

// ── 4. a pre-stamped _stageKey on a hidden stage is honoured ──
// (dashboard-bootstrap re-stamps l._stageKey when a config applies; partition
//  prefers it over the raw stage string.)
{
  const cfg = { version: 1, stages: { [S.LOST]: { hidden: true } }, views: {} };
  const resolved = resolvePipelineConfig(cfg);
  sandbox.window.STAGE_META = resolved.stageMeta;
  const meta = resolved.stageMeta;
  const view = visibleStages(KANBAN_VIEWS.cash.stages, meta);
  const leads = [
    { id: 'l1', stage: 'Closed Lost', _stageKey: 'lost', jobValue: 0 },
    { id: 'n1', stage: 'new',                             jobValue: 2000 },
  ];
  const { columns, hidden } = partitionLeadsByColumn(leads, view, DEPS(meta));
  ok('pre-stamped hidden lead goes to hidden', hidden.some(l => l.id === 'l1'));
  ok('visible lead unaffected by a hidden Lost', columns[S.NEW].some(l => l.id === 'n1'));
  delete sandbox.window.STAGE_META;
}

console.log('');
if (failed) { console.log('✗ ' + failed + ' failed: ' + fails.join('; ')); process.exit(1); }
console.log('✓ all ' + passed + ' passed');
process.exit(0);

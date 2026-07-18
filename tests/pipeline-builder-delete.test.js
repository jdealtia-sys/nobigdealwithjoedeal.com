/**
 * tests/pipeline-builder-delete.test.js — regression guard for the Pipelines
 * builder's delete-custom-stage handler (docs/pro/js/pipeline-builder.js).
 *
 * The delete handler used to remove a custom stage from the config while leads
 * were still sitting on it, orphaning them: their stage renders in no column,
 * so resolveColumn snaps them into the New column and stageRole() returns
 * 'active' — silently losing any won/lost role and dropping them from
 * role-keyed KPIs / revenue / the customer portal. (The confirm dialog even
 * claimed "Leads already in it keep their stage value", which was the bug.)
 *
 * The fix blocks deletion whenever any lead occupies the stage. The decision is
 * a pure function of window._leads, exposed as window.PipelineBuilder so we can
 * exercise the real code path off the DOM — the same idiom as
 * billing-gate.test.js (load the browser IIFE in a vm with a stubbed
 * window/document and drive its exposed API, not a source grep).
 *
 * A lead carries its raw stage key on `lead.stage` (moveCard writes the custom
 * key straight there) and its board-bucket key on `lead._stageKey`; the guard
 * matches EITHER, so an occupant is caught even if the denormalized field is
 * missing or diverged. This test covers both match paths, the empty-stage
 * (deletable) path, and the missing-_leads path.
 *
 * Zero deps. Run: node tests/pipeline-builder-delete.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/pipeline-builder.js'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function assert(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

// Load pipeline-builder.js in a sandbox. It's a browser IIFE with a DOM-only
// bootstrap (injectCss + a switchSettingsTab hook); a minimal window/document
// stub lets it initialize and expose window.PipelineBuilder without a real DOM.
// window.switchSettingsTab stays undefined so installHook() returns early.
function loadBuilder(leads) {
  const noopEl = () => ({ style: {}, appendChild() {}, addEventListener() {}, remove() {}, dataset: {}, id: '', textContent: '' });
  const documentStub = {
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; },
    createElement() { return noopEl(); },
    head: noopEl(),
    body: noopEl(),
  };
  const windowStub = { _leads: leads };
  windowStub.window = windowStub;
  const sandbox = { window: windowStub, document: documentStub, console: { log() {}, warn() {}, error() {} } };
  vm.runInNewContext(SRC, sandbox, { filename: 'pipeline-builder.js' });
  return { PB: windowStub.PipelineBuilder, win: windowStub };
}

console.log('PIPELINE BUILDER — delete-custom-stage guard');

// ── 0. API surface ──
{
  const { PB } = loadBuilder([]);
  assert('exposes window.PipelineBuilder', !!PB);
  assert('exposes leadsOnStage() + canDeleteStage()',
    PB && typeof PB.leadsOnStage === 'function' && typeof PB.canDeleteStage === 'function');
}

// ── 1. occupant matched via raw lead.stage → blocked ──
{
  const { PB } = loadBuilder([
    { id: 'a', stage: 'custom_paid', _stageKey: 'custom_paid', _stageRole: 'won' },
    { id: 'b', stage: 'new', _stageKey: 'new' },
  ]);
  const occ = PB.leadsOnStage('custom_paid');
  assert('leadsOnStage finds the raw-stage occupant', occ.length === 1 && occ[0].id === 'a');
  const v = PB.canDeleteStage('custom_paid');
  assert('canDeleteStage: occupied → not ok', v.ok === false);
  assert('canDeleteStage: reports count 1', v.count === 1);
}

// ── 2. occupant matched via _stageKey only (raw stage diverged/aliased) ──
{
  const { PB } = loadBuilder([
    { id: 'c', stage: 'paid_alias', _stageKey: 'custom_paid' }, // normalized to the custom key
  ]);
  const occ = PB.leadsOnStage('custom_paid');
  assert('leadsOnStage finds the _stageKey-only occupant', occ.length === 1 && occ[0].id === 'c');
  assert('canDeleteStage: _stageKey occupant → not ok', PB.canDeleteStage('custom_paid').ok === false);
}

// ── 3. empty stage → deletable ──
{
  const { PB } = loadBuilder([
    { id: 'd', stage: 'new', _stageKey: 'new' },
    { id: 'e', stage: 'custom_other', _stageKey: 'custom_other' },
  ]);
  assert('leadsOnStage empty for an unoccupied stage', PB.leadsOnStage('custom_paid').length === 0);
  const v = PB.canDeleteStage('custom_paid');
  assert('canDeleteStage: empty stage → ok (deletable)', v.ok === true && v.count === 0);
}

// ── 4. leads on OTHER stages never count toward this key ──
{
  const { PB } = loadBuilder([
    { id: 'f', stage: 'custom_other', _stageKey: 'custom_other' },
    { id: 'g', stage: 'lost', _stageKey: 'lost' },
  ]);
  assert("other stages' leads excluded", PB.leadsOnStage('custom_paid').length === 0);
}

// ── 5. multiple occupants counted; null/garbage entries ignored ──
{
  const { PB } = loadBuilder([
    { id: 'h', stage: 'custom_paid' },
    null,
    { id: 'i', _stageKey: 'custom_paid' },
    { id: 'j', stage: 'new' },
  ]);
  const v = PB.canDeleteStage('custom_paid');
  assert('counts every occupant (2), skips null entry', v.ok === false && v.count === 2);
}

// ── 6. missing / non-array window._leads → deletable, no throw ──
{
  const { PB } = loadBuilder(undefined);
  let threw = false, v;
  try { v = PB.canDeleteStage('custom_paid'); } catch (_) { threw = true; }
  assert('no throw when window._leads is absent', threw === false);
  assert('absent _leads → ok (deletable), count 0', v && v.ok === true && v.count === 0);
}

// ── 7. defensive: falsy key → empty, deletable ──
{
  const { PB } = loadBuilder([{ id: 'k', stage: 'custom_paid' }]);
  assert('empty key → no occupants', PB.leadsOnStage('').length === 0);
  assert('empty key → deletable (nothing to orphan)', PB.canDeleteStage('').ok === true);
}

// ── summary ──
console.log('');
if (failed) {
  console.log('FAIL — ' + passed + ' passed, ' + failed + ' failed:');
  fails.forEach(f => console.log('   ✗ ' + f));
  process.exit(1);
} else {
  console.log('PASS — ' + passed + ' assertions');
}

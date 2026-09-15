/**
 * kanban-next-action-chip.test.js — the kanban card's next-best-action chip
 * actually does something now.
 *
 * Context (CRM "driven UX" streamlining, 2026-09-15): the chip painted on
 * every kanban card ("→ File Claim" / "→ Send AOB" / etc., from
 * STAGE_ACTIONS in crm-stages.js via actionsForStage()) was display-only.
 * The REAL action list — the same data, rendered as real buttons — lived
 * only inside the edit modal's Next Actions panel (renderNextActionsPanel,
 * dashboard-bootstrap.module.js), which meant a rep had to open a 28-field
 * modal to do the one thing the card was already telling them to do. This
 * closes that gap: the chip now calls the SAME dispatcher
 * (runLeadAction, routed through window.__NBD_CALL_REGISTRY — the CSP-safe
 * delegated-call allowlist every other cross-module action already uses)
 * instead of a second implementation.
 *
 * Run: node tests/kanban-next-action-chip.test.js   (no deps, no DOM)
 */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

console.log('\nkanban-next-action-chip — the card chip runs the action, not just displays it\n');

const cp = read('docs/pro/js/crm-pipeline.js');
const dbm = read('docs/pro/js/dashboard-bootstrap.module.js');
const css = read('docs/pro/css/kanban-force.css');

// ── The chip markup ──────────────────────────────────────────────────
{
  const anchor = 'nextActionChip = `<span class="kc-tag';
  const idx = cp.indexOf(anchor);
  ok('nextActionChip markup found', idx >= 0);
  const chipLine = idx >= 0 ? cp.slice(idx, idx + 400) : '';

  ok('the chip carries data-action="run-next-action" (a real dispatch target, not decoration)',
    /data-action="run-next-action"/.test(chipLine));
  ok('the chip carries the card\'s own lead id (data-id) — the dispatcher has no open edit modal to infer it from',
    /data-id="\$\{safeId\}"/.test(chipLine));
  ok('the chip carries the action id it should run (data-action-id, from the SAME `preferred` object the label/icon already come from)',
    /data-action-id="\$\{escHtml\(preferred\.id/.test(chipLine));
  ok('the chip carries the action kind (data-action-kind) — the dispatcher branches on stage vs doc vs plain action',
    /data-action-kind="\$\{escHtml\(preferred\.kind/.test(chipLine));
  ok('the chip is keyboard-focusable (role="button" tabindex="0"), not mouse-only',
    /role="button"/.test(chipLine) && /tabindex="0"/.test(chipLine));
}

// ── The click handler ────────────────────────────────────────────────
{
  const handlerAnchor = "'run-next-action':";
  const idx = cp.indexOf(handlerAnchor);
  ok('wireKanbanCardListeners registers a run-next-action handler', idx >= 0);
  const handlerBlock = idx >= 0 ? cp.slice(idx, idx + 400) : '';

  ok('the handler calls window.__NBD_CALL_REGISTRY.runLeadAction — the SAME allowlisted dispatcher the edit modal\'s Next Actions panel uses, not a second implementation',
    /window\.__NBD_CALL_REGISTRY/.test(handlerBlock) && /registry\.runLeadAction\(/.test(handlerBlock));
  ok('…passing actionId, actionKind, AND the card\'s lead id (3 args — the 3rd is what makes this work outside the edit modal)',
    /registry\.runLeadAction\(el\.dataset\.actionId, el\.dataset\.actionKind, el\.dataset\.id\)/.test(handlerBlock));

  // The delegated-click dispatch table entry must actually be reachable —
  // confirm it sits inside the `handlers` object literal that
  // container.addEventListener('click', ...) reads `handlers[action]` from.
  const handlersObjIdx = cp.indexOf('const handlers = {');
  const clickListenerIdx = cp.indexOf("container.addEventListener('click'");
  ok('the handlers map (incl. run-next-action) is defined before the click listener that reads it',
    handlersObjIdx >= 0 && clickListenerIdx > handlersObjIdx && idx > handlersObjIdx && idx < clickListenerIdx);
}

// ── Keyboard activation ──────────────────────────────────────────────
{
  const kbdIdx = cp.indexOf("container.addEventListener('keydown'");
  ok('a keydown listener activates role="button" data-action elements (Enter/Space)', kbdIdx >= 0);
  const kbdBlock = kbdIdx >= 0 ? cp.slice(kbdIdx, kbdIdx + 400) : '';
  ok('…scoped to Enter and Space only (not hijacking every keypress on the board)',
    /ev\.key !== 'Enter' && ev\.key !== ' '/.test(kbdBlock));
  ok('…only fires for elements actually marked role="button" (the chip), not every [data-action] (cards themselves aren\'t meant to be Enter-activated from anywhere they get focus)',
    /\[data-action\]\[role="button"\]/.test(kbdBlock));
}

// ── runLeadAction accepts an explicit lead id ────────────────────────
{
  const fnIdx = dbm.indexOf('const runLeadAction = function(');
  ok('runLeadAction exists', fnIdx >= 0);
  const fnBlock = fnIdx >= 0 ? dbm.slice(fnIdx, fnIdx + 300) : '';

  ok('runLeadAction takes a 3rd explicitLeadId parameter',
    /function\(actionId, kind, explicitLeadId\)/.test(fnBlock));
  ok('…and prefers it over the edit-modal-inferred lEditId (not the other way — a stale open modal must never win over an explicit id the caller passed)',
    /const leadId = explicitLeadId \|\| document\.getElementById\('lEditId'\)\?\.value \|\| null;/.test(fnBlock));

  // Backward-compat: every EXISTING 2-arg call site (the Next Actions panel
  // button markup) must still work — explicitLeadId simply arrives as
  // undefined for them, which the `||` chain already handles, but assert
  // the actual call site wasn't accidentally changed to require a 3rd arg.
  const panelBtnIdx = dbm.indexOf("data-fn=\"runLeadAction\"");
  ok('the existing 2-arg Next Actions panel button markup is unchanged (data-arg + data-arg2 only, no 3rd data-arg3 the generic call-delegate doesn\'t support)',
    panelBtnIdx >= 0 && /data-arg="\$\{a\.id\}" data-arg2="\$\{a\.kind\}"/.test(dbm.slice(panelBtnIdx, panelBtnIdx + 150)));
}

// ── registry exposure ────────────────────────────────────────────────
{
  ok('runLeadAction is exposed on window.__NBD_CALL_REGISTRY (reachable from crm-pipeline.js, a plain <script>, not a module)',
    /window\.__NBD_CALL_REGISTRY = window\.__NBD_CALL_REGISTRY \|\| Object\.create\(null\)/.test(dbm)
    && /runLeadAction: runLeadAction,/.test(dbm));
}

// ── visual affordance — it has to LOOK clickable, not just be clickable ──
{
  const blockMatch = /\.kct-action-doc,\r?\n\s*\.kct-action-stage\{/.exec(css);
  const idx = blockMatch ? blockMatch.index : -1;
  ok('the chip CSS block exists', idx >= 0);
  const block = idx >= 0 ? css.slice(idx, idx + 900) : '';
  ok('cursor is pointer, not the old cursor:default (a display-only chip has no business inviting a click)',
    /cursor:\s*pointer;/.test(block) && !/cursor:\s*default;/.test(block));
  ok('there is a hover state (some visible feedback that the chip is interactive)',
    /\.kct-action:hover/.test(css) && /(filter|transform):/.test(css.slice(css.indexOf('.kct-action:hover'), css.indexOf('.kct-action:hover') + 300)));
}

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
process.exit(0);

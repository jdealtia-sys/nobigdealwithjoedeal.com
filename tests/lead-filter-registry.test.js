/**
 * tests/lead-filter-registry.test.js
 *
 * THE BUG THIS PINS (2026-09-03)
 * ──────────────────────────────
 * needs-attention-filter.js and stale-shares-filter.js each kept a PRIVATE
 * `active` boolean and each wrote the shared board directly. Their deactivate
 * path was unconditional:
 *
 *     if (!active) { window._filteredLeads = null; renderLeads(leads, null); }
 *
 * So turning Stale Shares OFF cleared the board even when Needs Attention was
 * still on with its button lit. Both then re-apply on 'nbd:data-refreshed' AND
 * on a 60s setInterval — so moments later the still-active filter silently
 * re-applied and leads vanished from the pipeline with no user action. Two
 * toggles, two sources of truth, one shared surface.
 *
 * The registry makes one owner of it. The assertions below are written as the
 * SEQUENCES a rep actually performs, because the bug only appears in a
 * sequence — every individual call looked correct in isolation, which is
 * exactly why it survived.
 *
 * Pure-Node, no emulator, no DOM. Run: node tests/lead-filter-registry.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else {
    console.log('  ✗ ' + label + (detail ? ' — ' + detail : ''));
    failed++; fails.push(label);
  }
}

const ROOT = path.join(__dirname, '..');
const REG_SRC = path.join(ROOT, 'docs/pro/js/lead-filter-registry.js');

// ── Harness ──────────────────────────────────────────────────────────────
// renderLeads is the real contract: crm-pipeline.js's renderLeads sets
// window._filteredLeads from its own second argument. The registry must drive
// the board THROUGH it and never assign that global itself, or we are back to
// two writers.
function makeEnv() {
  const win = {};
  win.window = win;
  win._leads = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  win.renderLeads = function (leads, filtered) {
    win._renderCalls.push(filtered === null ? null : (filtered || []).map((l) => l.id));
    win._filteredLeads = (filtered !== undefined && filtered !== null) ? filtered : null;
  };
  win._renderCalls = [];
  win._filteredLeads = null;
  const sandbox = { window: win, console: { log() {}, warn() {}, error() {} } };
  vm.runInNewContext(fs.readFileSync(REG_SRC, 'utf8'), sandbox, { filename: 'lead-filter-registry.js' });
  return win;
}

// Two filters over the same board, each with its own painted button.
function wire(win) {
  const lit = { needsAttention: false, staleShares: false };
  win.NBDLeadFilters.register('needsAttention', {
    compute: () => [win._leads[0]],
    paint: (on) => { lit.needsAttention = on; },
  });
  win.NBDLeadFilters.register('staleShares', {
    compute: () => [win._leads[1], win._leads[2]],
    paint: (on) => { lit.staleShares = on; },
  });
  return lit;
}

const ids = (arr) => (arr === null ? null : arr.map((l) => l.id));

console.log('\nTHE ORIGINAL BUG — turning one filter off must not blank the other');
{
  const win = makeEnv();
  const lit = wire(win);

  win.NBDLeadFilters.activate('needsAttention');
  ok('needs-attention on → board shows its subset', String(ids(win._filteredLeads)) === 'a');
  ok('...and only its button is lit', lit.needsAttention === true && lit.staleShares === false);

  // The rep taps the other filter. Mutual exclusion: the board hands over.
  win.NBDLeadFilters.activate('staleShares');
  ok('stale-shares on → board hands over to its subset',
     String(ids(win._filteredLeads)) === 'b,c');
  ok('...and the first button UNLIGHTS (it no longer owns the board)',
     lit.needsAttention === false && lit.staleShares === true);

  // THE BUG: turning stale-shares off used to null the board unconditionally.
  win.NBDLeadFilters.deactivate('staleShares');
  ok('stale-shares off → board clears, because it WAS the active one',
     win._filteredLeads === null);
  ok('no button is lit', lit.needsAttention === false && lit.staleShares === false);

  // ...and the poll that used to resurrect the other filter now does nothing.
  const before = win._renderCalls.length;
  win.NBDLeadFilters.refresh();
  ok('a refresh with nothing active does not touch the board',
     win._filteredLeads === null && win._renderCalls.length === before,
     'renders fired: ' + (win._renderCalls.length - before));
}

console.log('\nDEACTIVATING AN INACTIVE FILTER IS A NO-OP');
{
  // This is the exact call the old code got wrong. needs-attention is showing;
  // stale-shares (already off) asks to deactivate — from its own 60s poll, or
  // from a second tap. It must not touch the board.
  const win = makeEnv();
  const lit = wire(win);
  win.NBDLeadFilters.activate('needsAttention');
  const before = win._renderCalls.length;

  win.NBDLeadFilters.deactivate('staleShares');
  ok('the active filter still owns the board', String(ids(win._filteredLeads)) === 'a');
  ok('no render was issued at all', win._renderCalls.length === before,
     'renders fired: ' + (win._renderCalls.length - before));
  ok('the active button stays lit', lit.needsAttention === true);
}

console.log('\nTHE SILENT RE-APPLY — refresh only ever touches the ACTIVE filter');
{
  const win = makeEnv();
  const lit = wire(win);
  win.NBDLeadFilters.activate('staleShares');
  win.NBDLeadFilters.deactivate('staleShares');

  // 60s later, both modules' intervals fire recount() → refresh().
  win.NBDLeadFilters.refresh();
  win.NBDLeadFilters.refresh();
  ok('an off filter never re-applies itself on a poll', win._filteredLeads === null);
  ok('and no button lights up on its own',
     lit.needsAttention === false && lit.staleShares === false);

  // With one active, a refresh SHOULD repaint it — that is legitimate, the
  // underlying data moves.
  win.NBDLeadFilters.activate('needsAttention');
  win.NBDLeadFilters.refresh();
  ok('an active filter does recompute on refresh', String(ids(win._filteredLeads)) === 'a');
}

console.log('\nTOGGLE SEMANTICS');
{
  const win = makeEnv();
  wire(win);
  ok('toggle on returns true', win.NBDLeadFilters.toggle('needsAttention') === true);
  ok('toggle off returns false', win.NBDLeadFilters.toggle('needsAttention') === false);
  ok('board is clear after toggling off', win._filteredLeads === null);
  win.NBDLeadFilters.toggle('needsAttention');
  ok('toggling the OTHER one takes over rather than stacking',
     win.NBDLeadFilters.toggle('staleShares') === true
     && win.NBDLeadFilters.activeFilter() === 'staleShares');
  ok('only one filter is ever active', win.NBDLeadFilters.isActive('needsAttention') === false);
}

console.log('\nROBUSTNESS');
{
  const win = makeEnv();
  wire(win);
  ok('an unknown name cannot activate', (win.NBDLeadFilters.activate('nope'), win._filteredLeads === null));
  ok('...and cannot clear an active board',
     (win.NBDLeadFilters.activate('needsAttention'),
      win.NBDLeadFilters.deactivate('nope'),
      String(ids(win._filteredLeads)) === 'a'));

  // A compute() that throws must not take the board or the poll down with it.
  win.NBDLeadFilters.register('boom', { compute: () => { throw new Error('x'); }, paint: () => {} });
  let threw = false;
  try { win.NBDLeadFilters.activate('boom'); } catch (_) { threw = true; }
  ok('a throwing compute does not propagate', threw === false);
  ok('...and degrades to an empty subset rather than an unfiltered board',
     Array.isArray(win._filteredLeads) && win._filteredLeads.length === 0);
}

console.log('\nOWNERSHIP — the registry must not write the global itself');
{
  // renderLeads owns window._filteredLeads. A second writer here is how the
  // original bug became unanswerable, so pin it at the source.
  const src = fs.readFileSync(REG_SRC, 'utf8');
  const assigns = src.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
    return /window\._filteredLeads\s*=/.test(l);
  });
  ok('registry never assigns window._filteredLeads', assigns.length === 0, assigns.join(' | '));
  ok('registry drives the board through renderLeads', /window\.renderLeads\(/.test(src));
}

console.log('\nTHE FILTER MODULES NO LONGER KEEP THEIR OWN STATE');
{
  for (const f of ['needs-attention-filter.js', 'stale-shares-filter.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'docs/pro/js', f), 'utf8');
    const body = src.split(/\r?\n/).filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    }).join('\n');
    ok(f + ' has no private active flag', !/\b(let|var)\s+active\b/.test(body));
    ok(f + ' no longer writes the shared board', !/window\._filteredLeads\s*=/.test(body));
    ok(f + ' registers with the registry', /NBDLeadFilters\.register\(/.test(body));
  }
  // Load order is load-bearing: both register at init, and a registry that
  // arrives after them would leave two dead buttons.
  const html = fs.readFileSync(path.join(ROOT, 'docs/pro/dashboard.html'), 'utf8');
  const iReg = html.indexOf('js/lead-filter-registry.js');
  const iNa  = html.indexOf('js/needs-attention-filter.js');
  const iSs  = html.indexOf('js/stale-shares-filter.js');
  ok('dashboard.html loads the registry', iReg !== -1);
  ok('...before needs-attention', iReg !== -1 && iNa !== -1 && iReg < iNa);
  ok('...and before stale-shares', iReg !== -1 && iSs !== -1 && iReg < iSs);
}

console.log('\n──────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }

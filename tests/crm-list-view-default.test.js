/**
 * tests/crm-list-view-default.test.js — pipeline Board/List default
 * (docs/pro/js/crm-list-view.js), 2026-09-24.
 *
 * Two behaviours, both from a phone walk of the dashboard:
 *   1. With no saved choice, a phone (<=768px) opens List and a computer opens
 *      Board. The board showed 1.5 columns at 412px and scrolled sideways.
 *   2. Settings > Pipeline Preferences > Default Pipeline View: Auto forgets
 *      the saved choice (the device decides again); Board and List pin it;
 *      the matching picker button lights up.
 *
 * Drives the real file in a vm sandbox with a stub matchMedia and
 * localStorage. Zero deps. Run: node tests/crm-list-view-default.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/crm-list-view.js'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; fails.push(label); }
}

function load({ phone, saved }) {
  const store = {};
  if (saved) store['nbd-crm-view-mode'] = saved;
  const bodyClasses = new Set();
  const pickers = ['auto', 'board', 'list'].map((v) => ({
    style: {}, getAttribute: (k) => (k === 'data-view-default' ? v : null),
  }));
  const win = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    matchMedia: () => ({ matches: !!phone }),
    document: {
      body: { classList: { toggle: (c, on) => (on ? bodyClasses.add(c) : bodyClasses.delete(c)) } },
      getElementById: () => null,
      querySelectorAll: (sel) => (sel === '.cview-default-btn' ? pickers : []),
      querySelector: () => null,
      addEventListener() {},
    },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0,
    Date, Math, JSON, String, Number, Array, Object,
  };
  win.window = win;
  vm.runInNewContext(SRC, win, { filename: 'crm-list-view.js' });
  const lit = () => pickers.filter((p) => p.style.background === 'var(--orange)').map((p) => p.getAttribute('data-view-default'));
  return { win, store, listMode: () => bodyClasses.has('crm-list-mode'), lit };
}

console.log('\nDEFAULT — no saved choice');
{
  const p = load({ phone: true });
  ok('phone with no saved choice opens List', p.listMode() === true);
  ok('...and the picker shows Auto', p.lit().join() === 'auto');
  const d = load({ phone: false });
  ok('computer with no saved choice opens Board', d.listMode() === false);
}

console.log('\nSAVED CHOICE WINS');
ok('phone with Board saved opens Board', load({ phone: true, saved: 'board' }).listMode() === false);
ok('computer with List saved opens List', load({ phone: false, saved: 'list' }).listMode() === true);

console.log('\nSETTINGS PICKER');
{
  const t = load({ phone: true, saved: 'board' });
  ok('Board saved lights the Board button', t.lit().join() === 'board');
  t.win.crmViewAuto();
  ok('Auto forgets the saved choice', !('nbd-crm-view-mode' in t.store));
  ok('...so the phone falls back to List', t.listMode() === true);
  ok('...and the Auto button lights', t.lit().join() === 'auto');
  t.win.crmViewList();
  ok('List pins list', t.store['nbd-crm-view-mode'] === 'list' && t.lit().join() === 'list');
  t.win.crmViewBoard();
  ok('Board pins board and leaves list mode', t.store['nbd-crm-view-mode'] === 'board' && t.listMode() === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }

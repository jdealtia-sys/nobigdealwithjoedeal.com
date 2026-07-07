/**
 * tests/notif-bell-merge.test.js — single-owner bell merge (2026-07-07).
 *
 * Exercises notif-bell.js after the fix that made it the SOLE renderer of
 * the header bell and UNIONs two notification sources:
 *   - derived in-memory nags   (window._leads / _taskCache / _estimates,
 *                               read/dismiss state in localStorage)
 *   - server notifications      (window._notifications — the Firestore
 *                               `notifications` feed hydrated by
 *                               crm-snooze.js; read/dismiss state routed
 *                               back to Firestore via window.NBDServerNotifs)
 *
 * Regressions it guards:
 *   1. Server-written notifications (portal / referral / deal-accept /
 *      remote-sign / follow-up engine) were invisible in the opened
 *      dropdown AND unclearable, because notif-bell won the window
 *      bindings but never read window._notifications.
 *   2. The data-nb-action delegate lived in a sibling IIFE that could not
 *      see the `NotifBell` closure — every click threw ReferenceError, so
 *      row-click / × dismiss / inline action buttons were dead. The
 *      delegate now lives inside the module IIFE. This test drives the
 *      per-item actions THROUGH that delegate so the fix is covered.
 *
 * NotifBell is intentionally NOT on window (globals Tranche-0 guard), so
 * the API is reached via the window.* bindings + the click delegate,
 * exactly as the dashboard does.
 *
 * Zero deps. Run: node tests/notif-bell-merge.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

// ── Minimal mock DOM: registered elements by id, innerHTML captured ──
function makeEl() {
  return {
    innerHTML: '', textContent: '', style: {}, dataset: {},
    appendChild() {}, remove() {}, contains() { return false; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, contains() { return false; } },
  };
}
const els = {};
['notifList', 'notifDismissedList', 'notifDismissedToggle', 'dismissedCount',
 'notifBadge', 'clearAllNotifBtn', 'notifDropdown', 'notifBtn',
 'dismissedToggleLabel'].forEach(id => { els[id] = makeEl(); });

const _ls = {};
const localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};

const _winHandlers = {};
const win = {
  addEventListener(type, fn) { (_winHandlers[type] = _winHandlers[type] || []).push(fn); },
  removeEventListener() {}, dispatchEvent() {},
  location: { href: '', pathname: '/pro/dashboard' },
};
win.window = win;
function fireWin(type) { (_winHandlers[type] || []).forEach(fn => { try { fn({ type }); } catch (e) {} }); }

// Capture the document 'click' delegate the module registers.
const clickHandlers = [];
const sandbox = {
  window: win,
  document: {
    addEventListener(type, fn) { if (type === 'click') clickHandlers.push(fn); },
    removeEventListener() {},
    getElementById: (id) => els[id] || null,
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement: () => makeEl(), body: makeEl(), readyState: 'complete',
  },
  localStorage,
  console: { log() {}, warn() {}, error() {} },
  // no-op timers so the deferred init()/setInterval never fire and never
  // keep the event loop alive — we drive render()/mutations directly.
  setTimeout: () => 0, clearTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,
  Date, Math, JSON, Object, Array, String, Number, Set, Map, encodeURIComponent, Promise,
};

const src = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/notif-bell.js'), 'utf8');
vm.runInNewContext(src, sandbox, { filename: 'notif-bell.js' });

// Fire a synthetic click that the data-nb-action delegate will dispatch.
// `stop` mirrors the real markup: the × dismiss button carries
// data-nb-stop="1"; a row (handleClick) does not.
function clickAction(action, id, stop) {
  const node = {
    dataset: Object.assign({ nbAction: action, nbId: id }, stop ? { nbStop: '1' } : {}),
    closest(sel) {
      if (sel.indexOf('data-nb-stop-self') >= 0) return null;
      if (sel.indexOf('data-nb-action') >= 0) return node;
      return null;
    },
  };
  const ev = { target: node, stopPropagation() {} };
  clickHandlers.forEach(h => h(ev));
}

// ── Capture the Firestore persistence API notif-bell should call ──
const captured = { markRead: [], dismiss: [], markReadMany: [], dismissMany: [], restore: [] };
win.NBDServerNotifs = {
  markRead:     (id)  => { captured.markRead.push(id);      return Promise.resolve(); },
  dismiss:      (id)  => { captured.dismiss.push(id);       return Promise.resolve(); },
  restore:      (id)  => { captured.restore.push(id);       return Promise.resolve(); },
  markReadMany: (ids) => { captured.markReadMany.push(ids); return Promise.resolve(); },
  dismissMany:  (ids) => { captured.dismissMany.push(ids);  return Promise.resolve(); },
};

// ── Controlled data: 1 derived overdue task + 3 server notifs ──
const nowD = new Date();
win._leads = [
  { id: 'L1', firstName: 'Jane', lastName: 'Doe', phone: '555-1212', email: 'j@x.com',
    stage: 'contacted', updatedAt: nowD }, // recent → no stale-lead signal
];
win._taskCache = { L1: [{ id: 't1', text: 'Call Jane', dueDate: '2020-01-01', done: false }] }; // overdue
win._estimates = [];
win._notifications = [
  { id: 'srv1', userId: 'u', type: 'deal_accepted', leadId: 'L1', title: 'Deal accepted! 🎉',
    message: 'Jane accepted the PRO package', read: false, dismissed: false, priority: 'high', createdAt: nowD },
  { id: 'srv2', userId: 'u', type: 'referral_received', title: 'New referral!',
    message: 'Bob referred by a past customer', read: false, dismissed: false, createdAt: nowD },
  { id: 'srv3', userId: 'u', type: 'portal_message', title: 'Portal message',
    message: 'Old dismissed message', read: true, dismissed: true, createdAt: nowD },
];

console.log('NOTIF-BELL SINGLE-OWNER MERGE');
ok('captured the data-nb-action click delegate (no ReferenceError at load)', clickHandlers.length === 1);
ok('exposes window.toggleNotificationDropdown', typeof win.toggleNotificationDropdown === 'function');
ok('does NOT leak NotifBell onto window (Tranche-0 guard)', typeof win.NotifBell === 'undefined');

// ── Step 1: open the dropdown → render unions both sources ──
win.toggleNotificationDropdown();
const derivedTaskId = 'task:L1:t1';
ok('list shows derived overdue task', els.notifList.innerHTML.includes('Overdue task'));
ok('list shows server deal_accepted notif', els.notifList.innerHTML.includes('Deal accepted'));
ok('list shows server referral notif', els.notifList.innerHTML.includes('New referral'));
ok('dismissed server notif NOT in active list', !els.notifList.innerHTML.includes('Old dismissed message'));
ok('badge counts union unread (1 derived + 2 server = 3)', els.notifBadge.textContent === '3');
ok('badge visible', els.notifBadge.style.display === 'block');
ok('dismissed drawer toggle shown for the 1 dismissed server notif', els.notifDismissedToggle.style.display === 'block');
ok('dismissed count = (1)', els.dismissedCount.textContent === '(1)');
ok('dismissed drawer HTML holds the dismissed server notif', els.notifDismissedList.innerHTML.includes('Old dismissed message'));

// ── Step 2: dismiss ONE server notif THROUGH the delegate (× button) ──
clickAction('dismiss', 'server:srv2', true);
ok('delegate dispatched dismiss → NBDServerNotifs.dismiss with raw doc id', captured.dismiss.length === 1 && captured.dismiss[0] === 'srv2');
ok('dismissed server notif left the active list', !els.notifList.innerHTML.includes('New referral'));
ok('badge now 2 (derived + srv1)', els.notifBadge.textContent === '2');
ok('localStorage dismissed set NOT touched for a server item', localStorage.getItem('nbd_notif_dismissed_v1') === null);

// ── Step 3: mark all read → server via Firestore (explicit ids), derived via localStorage ──
win.markAllNotificationsRead();
ok('markAllRead persisted server unread via markReadMany', captured.markReadMany.length === 1);
ok('markReadMany got exactly the unread, non-dismissed server id [srv1]',
   JSON.stringify(captured.markReadMany[0]) === JSON.stringify(['srv1']));
ok('markReadMany did NOT include the dismissed srv2', !captured.markReadMany[0].includes('srv2'));
const readSet = JSON.parse(localStorage.getItem('nbd_notif_read_v1') || '[]');
ok('derived item read state persisted to localStorage', readSet.includes(derivedTaskId));
ok('badge hidden after mark-all-read (0 unread)', els.notifBadge.style.display === 'none');

// ── Step 4: clear all → dismiss remaining active across both sources ──
win.clearAllNotifications();
ok('clearAll persisted remaining active server ids via dismissMany', captured.dismissMany.length === 1);
ok('dismissMany got the still-active server id [srv1]',
   JSON.stringify(captured.dismissMany[0]) === JSON.stringify(['srv1']));
const dismSet = JSON.parse(localStorage.getItem('nbd_notif_dismissed_v1') || '[]');
ok('derived item dismissed state persisted to localStorage', dismSet.includes(derivedTaskId));
ok('active list empty → "All caught up"', els.notifList.innerHTML.includes('All caught up'));

// ── Step 5: row-click a server notif THROUGH the delegate → marks read + navigates ──
win._notifications = [
  { id: 'srv9', userId: 'u', type: 'remote_signature', leadId: 'L1', title: 'Document signed',
    message: 'A homeowner signed remotely', read: false, dismissed: false, priority: 'high', createdAt: nowD },
];
fireWin('nbd:data-refreshed'); // module binds this to invalidateNotifCache
clickAction('handleClick', 'server:srv9', false);
ok('delegate dispatched handleClick → NBDServerNotifs.markRead(srv9)', captured.markRead.includes('srv9'));
ok('handleClick navigated to the lead deep-link', /tab=crm&lead=L1/.test(win.location.href));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }

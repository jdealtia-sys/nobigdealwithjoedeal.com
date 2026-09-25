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

// ── Phone field cards (2026-09-24) ────────────────────────────────
// render() on a phone builds cards; the swipe handlers are driven by fake
// touch events on fake card elements parsed back out of the markup.
function loadCards({ phone, leads, ua }) {
  const moves = [];
  const toasts = [];
  let hrefSet = null;
  const cards = [];
  const wrap = {
    _html: '',
    set innerHTML(v) {
      this._html = String(v);
      cards.length = 0;
      const re = /<div class="cl-card" data-id="([^"]*)" data-phone="([^"]*)" data-stage="([^"]*)">/g;
      let m;
      while ((m = re.exec(this._html))) {
        const attrs = { 'data-id': m[1], 'data-phone': m[2], 'data-stage': m[3] };
        const h = {};
        cards.push({
          attrs, h, style: {},
          classList: { toggle() {}, remove() {} },
          getAttribute: (k) => attrs[k],
          addEventListener: (t, f) => { h[t] = f; },
        });
      }
    },
    get innerHTML() { return this._html; },
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '.cl-card' ? cards : []),
  };
  const win = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: !!phone }),
    navigator: { userAgent: ua || 'Android' },
    location: {},
    document: {
      body: { classList: { toggle() {} } },
      getElementById: (id) => (id === 'crmListWrap' ? wrap : null),
      querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
    },
    _stageKeys: ['new', 'contacted', 'inspected', 'closed', 'lost'],
    stageLabel: (k) => k.toUpperCase(),
    _leads: leads,
    showToast: (m) => toasts.push(m),
    // Stub moveCard: applies the move unless the stage is 'inspected'
    // (standing in for a stage gate the rep cancels).
    moveCard: async (id, stage) => {
      moves.push([id, stage]);
      if (stage === 'inspected') return;
      const l = leads.find((x) => x.id === id);
      if (l) l.stage = stage;
    },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0,
    Date, Math, JSON, String, Number, Array, Object, Promise,
  };
  win.window = win;
  Object.defineProperty(win.location, 'href', { set: (v) => { hrefSet = v; }, get: () => hrefSet });
  vm.runInNewContext(SRC, win, { filename: 'crm-list-view.js' });
  win.CrmListView.render(leads);
  const swipe = (card, dx) => {
    card.h.touchstart({ target: {}, touches: [{ clientX: 200, clientY: 300 }] });
    card.h.touchmove({ touches: [{ clientX: 200 + dx, clientY: 302 }] });
    card.h.touchend({});
  };
  return { wrap, cards, moves, toasts, swipe, href: () => hrefSet };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  console.log('\nFIELD CARDS — phone rendering');
  {
    const t = loadCards({ phone: true, leads: [
      { id: 'a', firstName: '<img src=x onerror=alert(1)>', stage: 'new', phone: '(513) 555-0101', address: '1 Main St, Loveland OH', jobValue: 14200 },
      { id: 'b', firstName: 'Nophone', stage: 'contacted', address: '' },
    ] });
    const html = t.wrap.innerHTML;
    ok('phone renders cards, not the table', /class="cl-card"/.test(html) && !/crm-list-table/.test(html));
    ok('lead name is escaped (no live markup)', html.includes('&lt;img src=x onerror=alert(1)&gt;') && !html.includes('<img src=x'));
    ok('Call and Text use the digits-only number', html.includes('href="tel:5135550101"') && html.includes('href="sms:5135550101"'));
    ok('Map uses Google Maps on Android', html.includes('https://www.google.com/maps/search/?api=1&amp;query=1%20Main%20St'));
    ok('a lead with no phone and no address gets only Open', (() => {
      // Anchor on the card div: the stage <select> repeats data-id="b".
      const card = html.split('class="cl-card" data-id="b"')[1] || '';
      return !/cl-call|cl-text|cl-map/.test(card.split('</div></div>')[0]) && /cl-open/.test(card);
    })());
    const iphone = loadCards({ phone: true, ua: 'iPhone', leads: [{ id: 'a', stage: 'new', address: '1 Main St' }] });
    ok('Map uses Apple Maps on iPhone', iphone.wrap.innerHTML.includes('https://maps.apple.com/?q=1%20Main%20St'));
    const desk = loadCards({ phone: false, leads: [{ id: 'a', stage: 'new' }] });
    ok('CONTROL desktop still renders the table', /crm-list-table/.test(desk.wrap.innerHTML) && !/cl-card/.test(desk.wrap.innerHTML));
  }

  console.log('\nFIELD CARDS — swipes');
  {
    const leads = [
      { id: 'a', stage: 'new', phone: '5135550101' },
      { id: 'b', stage: 'contacted', phone: '' },
      { id: 'c', stage: 'closed', phone: '5135550103' },
    ];
    const t = loadCards({ phone: true, leads });
    const card = (id) => t.cards.find((c) => c.attrs['data-id'] === id);
    t.swipe(card('a'), 120);
    ok('swipe right calls the lead', t.href() === 'tel:5135550101');
    t.swipe(card('a'), -120);
    await settle(); await settle();
    ok('swipe left moves to the next stage through moveCard', JSON.stringify(t.moves[0]) === '["a","contacted"]');
    ok('...and confirms once the lead reads the new stage', t.toasts.includes('Moved to CONTACTED'));
    t.swipe(card('b'), -120);
    await settle(); await settle();
    ok('a cancelled move (stage gate) is NOT confirmed', t.moves.some((m) => m[1] === 'inspected') && !t.toasts.includes('Moved to INSPECTED'));
    t.swipe(card('c'), -120);
    ok('Closed never advances (Lost/Closed are never swipe targets)', !t.moves.some((m) => m[0] === 'c') && t.toasts.includes('Already at the last stage'));
    t.swipe(card('b'), 120);
    ok('swipe right with no phone says so instead of dialing', t.toasts.includes('No phone number on this lead'));
    const before = t.moves.length;
    t.swipe(card('a'), 40);
    ok('a short drag does nothing', t.moves.length === before);
    card('a').h.touchstart({ target: { closest: () => ({}) }, touches: [{ clientX: 200, clientY: 300 }] });
    card('a').h.touchmove({ touches: [{ clientX: 360, clientY: 302 }] });
    card('a').h.touchend({});
    ok('a swipe that starts on a control is ignored', t.moves.length === before);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
})();

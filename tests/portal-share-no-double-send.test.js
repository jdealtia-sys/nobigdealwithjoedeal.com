/**
 * tests/portal-share-no-double-send.test.js — a portal-link share must never
 * send a message the rep did not review, and never send the same one twice.
 *
 * PortalLinkHelpers.smsForLead / emailForLead do not open a composer: they
 * POST through NBDComms to Twilio / Resend. TemplatesLibrary.pickAndRender is
 * the ONLY review-and-cancel step in front of that send, and both callers
 * treat its return value as the rep's choice (undefined = cancel, abort).
 *
 * Two fail-opens this pins (fail-open audit FO-1):
 *
 *  1. templates-library.js pickAndRender, "picker already open" branch.
 *     With 2+ templates and no ⭐ default (the SEEDED default state: two SMS
 *     templates, neither starred), a second share call arriving while a picker
 *     was already up skipped the picker and resolved apply(templates[0]) — so
 *     the caller SENT templates[0] to that homeowner, unreviewed, while the
 *     rep was still looking at the first picker. Trigger: two share taps (a
 *     double-tap, or two leads' 💬 buttons) landing inside the async
 *     portal-token mint in resolveUrl. Now fails closed like Cancel/Esc.
 *
 *  2. portal-link-helpers.js had no in-flight guard. On the one-template and
 *     ⭐-default paths there is no picker at all, so a double-tap sent the
 *     same text / email twice. Now a per channel+lead Set, cleared in
 *     finally.
 *
 * Both files are RUN for real in one vm against a fake DOM — the helpers
 * call the real TemplatesLibrary, exactly as on dashboard.html and
 * customer.html — and every assertion counts NBDComms sends.
 *
 * Zero deps.  Run: node tests/portal-share-no-double-send.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const TL = fs.readFileSync(path.join(ROOT, 'docs/pro/js/templates-library.js'), 'utf8');
const PLH = fs.readFileSync(path.join(ROOT, 'docs/pro/js/portal-link-helpers.js'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

function flush() { return new Promise((r) => setImmediate(r)); }
async function settle(n) { for (let i = 0; i < (n || 6); i++) await flush(); }

// Resolves with the promise's value, or the sentinel PENDING if it has not
// settled after a few macrotask turns.
const PENDING = { pending: true };
async function peek(p) {
  let v = PENDING;
  p.then((x) => { v = x; }, (e) => { v = { threw: e }; });
  await settle(4);
  return v;
}

// ── Fake DOM: just enough for the picker + manager overlays ───────────────
function makeDom() {
  const body = { children: [], appendChild(c) { this.children.push(c); c.parent = this; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); } };
  class FakeEl {
    constructor(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this.style = {}; this.attrs = {}; this.listeners = {}; this.sub = {};
      this.pickBtns = []; this._html = ''; this.value = ''; this.id = '';
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
    set innerHTML(h) {
      this._html = String(h); this.sub = {};
      this.pickBtns = Array.from(this._html.matchAll(/data-tpl-pick="([^"]*)"/g)).map((m) => {
        const b = new FakeEl('button'); b.attrs['data-tpl-pick'] = m[1]; return b;
      });
    }
    get innerHTML() { return this._html; }
    querySelector(sel) {
      if (sel === '[data-tpl-pick]') return this.pickBtns[0] || null;
      if (!this.sub[sel]) this.sub[sel] = new FakeEl('x');
      return this.sub[sel];
    }
    querySelectorAll(sel) { return sel === '[data-tpl-pick]' ? this.pickBtns.slice() : []; }
    fire(type) { (this.listeners[type] || []).slice().forEach((fn) => fn({ target: this, key: '' })); }
    remove() { body.removeChild(this); }
    focus() {} select() {}
  }
  const docListeners = {};
  const document = {
    body,
    createElement: (t) => new FakeEl(t),
    getElementById: () => null,
    addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
    removeEventListener(t, fn) { docListeners[t] = (docListeners[t] || []).filter((f) => f !== fn); },
    execCommand: () => false,
  };
  return { document, body };
}

function load(opts) {
  opts = opts || {};
  const store = {};
  const toasts = [];
  const sms = [];
  const email = [];
  const minted = [];
  const { document, body } = makeDom();
  const win = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, URL, Promise, Date, Math, JSON, Object, Array, String,
    Number, Boolean, RegExp, Error, Set, Map, encodeURIComponent,
    document,
    navigator: {},
    location: { href: '', origin: 'https://example.test' },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    showToast: (msg, kind) => { toasts.push([kind, String(msg)]); },
    dispatchEvent() {},
    _leads: [],
    // Dashboard-shape minter. Async like the real createPortalToken callable,
    // so two taps both reach `await resolveUrl` before either picks.
    _mintPortalUrl: async (id) => {
      minted.push(id);
      await flush();
      if (opts.mintFails && opts.mintFails(id, minted.length)) throw new Error('mint failed');
      return 'https://example.test/pro/portal.html?token=TOK-' + id;
    },
    NBDComms: {
      sendSMS: async (a) => { sms.push(a); await flush(); return { success: true, mode: 'platform', sid: 'SM' + sms.length }; },
      sendEmail: async (a) => { email.push(a); await flush(); return { success: true, mode: 'platform', id: 'EM' + email.length }; },
    },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(TL, win, { filename: 'templates-library.js' });
  vm.runInContext(PLH, win, { filename: 'portal-link-helpers.js' });
  return {
    win, toasts, sms, email, minted, body,
    TL: win.TemplatesLibrary, PLH: win.PortalLinkHelpers,
    pickers: () => body.children.filter((c) => c.id === 'nbd-templates-picker-overlay'),
  };
}

const LEAD_A = { id: 'lead-A', firstName: 'Dana', phone: '(513) 555-0101', email: 'dana@example.test' };
const LEAD_B = { id: 'lead-B', firstName: 'Lee', phone: '(513) 555-0202', email: 'lee@example.test' };

(async () => {
  console.log('PORTAL SHARE — no unreviewed send, no double send');

  // ══ Precondition: the seeded default state is the picker path ═════════
  {
    const h = load();
    ok('real modules load (TemplatesLibrary + PortalLinkHelpers)',
      !!(h.TL && typeof h.TL.pickAndRender === 'function' && h.PLH && typeof h.PLH.smsForLead === 'function'));
    ok('seeded default: 2 SMS templates, none starred (every SMS share opens the picker)',
      h.TL.list('sms').length === 2 && !h.TL.getDefault('sms'),
      JSON.stringify(h.TL.list('sms').map((t) => [t.name, !!t.isDefault])));
  }

  // ══ 1. pickAndRender re-entry fails closed ═════════════════════════════
  console.log('\n1. pickAndRender while a picker is already open');
  {
    const h = load();
    const first = h.TL.pickAndRender('sms', { lead: LEAD_A, url: 'U' });
    ok('first call opens exactly one picker', h.pickers().length === 1, String(h.pickers().length));
    const second = await peek(h.TL.pickAndRender('sms', { lead: LEAD_B, url: 'U' }));
    ok('second concurrent call resolves undefined (the caller\'s CANCEL value) — not a template',
      second === undefined, JSON.stringify(second));
    ok('...and does not open a second picker', h.pickers().length === 1, String(h.pickers().length));
    ok('...and tells the rep why nothing happened',
      h.toasts.some(([k, m]) => k === 'info' && /finish the open template picker/i.test(m)), JSON.stringify(h.toasts));
    ok('the first picker is still pending the rep\'s choice', (await peek(first)) === PENDING);

    // Rep picks in the first picker → a real rendered template.
    const picker = h.pickers()[0];
    const btn = picker.pickBtns[1];
    btn.fire('click');
    const picked = await peek(first);
    ok('the first picker still resolves the template the rep picked',
      picked && typeof picked.body === 'string' && /just checking in/.test(picked.body), JSON.stringify(picked));
    ok('picker closed → overlay removed', h.pickers().length === 0);

    // _modalOpen is released on close: the next call opens a picker again.
    const again = h.TL.pickAndRender('sms', { lead: LEAD_A, url: 'U' });
    ok('after close, the next call opens a fresh picker (flag released)', h.pickers().length === 1);
    h.pickers()[0].querySelector('#nbd-tpl-pick-cancel').fire('click');
    ok('Cancel resolves undefined (the sibling this branch now mirrors)', (await peek(again)) === undefined);
  }
  {
    // Manager modal open (it shares the same _modalOpen flag).
    const h = load();
    h.TL.openManager();
    const r = await peek(h.TL.pickAndRender('sms', { lead: LEAD_A, url: 'U' }));
    ok('with the template MANAGER open, pickAndRender also resolves undefined', r === undefined, JSON.stringify(r));
  }

  // ══ 2. End to end: two leads' share taps race the mint ═════════════════
  console.log('\n2. smsForLead(A) + smsForLead(B) racing the portal-token mint');
  {
    const h = load();
    const pa = h.PLH.smsForLead(Object.assign({}, LEAD_A));
    const pb = h.PLH.smsForLead(Object.assign({}, LEAD_B));
    await settle(8);
    ok('both taps minted (both got past the guard — different leads)',
      h.minted.includes('lead-A') && h.minted.includes('lead-B'), JSON.stringify(h.minted));
    ok('exactly one picker is on screen', h.pickers().length === 1, String(h.pickers().length));
    ok('NOTHING was sent while the picker is up (B did not auto-send templates[0])',
      h.sms.length === 0, JSON.stringify(h.sms));
    h.pickers()[0].pickBtns[0].fire('click');
    await pa; await pb; await settle(4);
    ok('after the rep picks: exactly ONE text went out', h.sms.length === 1, JSON.stringify(h.sms));
    ok('...to the lead whose picker the rep actually reviewed (A)',
      h.sms.length === 1 && h.sms[0].to === LEAD_A.phone && h.sms[0].leadId === 'lead-A', JSON.stringify(h.sms));
  }

  // ══ 3. In-flight guard: same-lead double-tap, no picker in the way ════
  console.log('\n3. double-tap on the ⭐-default / one-template paths');
  {
    const h = load();
    const def = h.TL.list('sms')[0];
    h.TL.setDefault(def.id);
    ok('⭐ default set (picker skipped)', !!h.TL.getDefault('sms'));
    await Promise.all([h.PLH.smsForLead(Object.assign({}, LEAD_A)), h.PLH.smsForLead(Object.assign({}, LEAD_A))]);
    await settle(4);
    ok('⭐-default SMS double-tap sends ONCE', h.sms.length === 1, JSON.stringify(h.sms));
    ok('...and mints once (the second tap stops before the network)', h.minted.length === 1, JSON.stringify(h.minted));
    ok('...and the second tap is acknowledged, not silent',
      h.toasts.some(([k, m]) => k === 'info' && /already sending/i.test(m)), JSON.stringify(h.toasts));

    // Guard is released after completion: a deliberate later re-send works.
    await h.PLH.smsForLead(Object.assign({}, LEAD_A));
    await settle(4);
    ok('a later, separate share to the same lead still sends (guard released in finally)',
      h.sms.length === 2, String(h.sms.length));

    // Guard is per-lead: two different leads at once both send.
    await Promise.all([h.PLH.smsForLead(Object.assign({}, LEAD_A)), h.PLH.smsForLead(Object.assign({}, LEAD_B))]);
    await settle(4);
    ok('two DIFFERENT leads at once both send (guard is per-lead, not global)',
      h.sms.length === 4 && h.sms.slice(2).map((s) => s.leadId).sort().join(',') === 'lead-A,lead-B',
      JSON.stringify(h.sms.slice(2)));
  }
  {
    // Email: the seed has exactly ONE email template → no picker at all.
    const h = load();
    ok('seeded default: exactly 1 email template (picker skipped)', h.TL.list('email').length === 1);
    await Promise.all([h.PLH.emailForLead(Object.assign({}, LEAD_A)), h.PLH.emailForLead(Object.assign({}, LEAD_A))]);
    await settle(4);
    ok('one-template email double-tap sends ONCE', h.email.length === 1, JSON.stringify(h.email));
    await h.PLH.emailForLead(Object.assign({}, LEAD_A));
    await settle(4);
    ok('a later email to the same lead still sends (guard released)', h.email.length === 2, String(h.email.length));
  }
  {
    // Channels are independent: an in-flight SMS must not swallow an email.
    const h = load();
    h.TL.setDefault(h.TL.list('sms')[0].id);
    await Promise.all([h.PLH.smsForLead(Object.assign({}, LEAD_A)), h.PLH.emailForLead(Object.assign({}, LEAD_A))]);
    await settle(4);
    ok('SMS and email to the same lead at once: both send (key is channel+lead)',
      h.sms.length === 1 && h.email.length === 1, JSON.stringify({ s: h.sms.length, e: h.email.length }));
  }

  // ══ 4. A failure must not wedge the lead's share button ════════════════
  console.log('\n4. guard released after a throw');
  {
    const h = load({ mintFails: (id, n) => n === 1 });
    h.TL.setDefault(h.TL.list('sms')[0].id);
    await h.PLH.smsForLead(Object.assign({}, LEAD_A));
    await settle(4);
    ok('first share: mint throws → error toast, nothing sent',
      h.sms.length === 0 && h.toasts.some(([k, m]) => k === 'error' && /couldn't prepare sms/i.test(m)),
      JSON.stringify({ sms: h.sms, t: h.toasts }));
    await h.PLH.smsForLead(Object.assign({}, LEAD_A));
    await settle(4);
    ok('retry after the throw sends (the guard did not stay stuck)', h.sms.length === 1, String(h.sms.length));
  }
  {
    // Cancelled picker (early return inside try) must release too.
    const h = load();
    const p = h.PLH.smsForLead(Object.assign({}, LEAD_A));
    await settle(8);
    h.pickers()[0].querySelector('#nbd-tpl-pick-cancel').fire('click');
    await p; await settle(4);
    ok('cancelled picker sends nothing', h.sms.length === 0, JSON.stringify(h.sms));
    const p2 = h.PLH.smsForLead(Object.assign({}, LEAD_A));
    await settle(8);
    ok('after a cancel, the next tap on that lead opens the picker again (guard released)',
      h.pickers().length === 1, String(h.pickers().length));
    h.pickers()[0].pickBtns[0].fire('click');
    await p2; await settle(4);
    ok('...and sends once when the rep picks', h.sms.length === 1, String(h.sms.length));
  }

  console.log('\n──────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})();

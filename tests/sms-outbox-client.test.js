/**
 * tests/sms-outbox-client.test.js — the browser half of the offline SMS
 * outbox: docs/pro/js/nbd-comms.js + docs/pro/js/sms-outbox.js, and every
 * NBDComms.sendSMS consumer's handling of mode 'queued'.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Offline, NBDComms.sendSMS used to open the rep's Messages app with the text
 * filled in — which over cellular SMS sends at once, with no opt-out check
 * and nothing in sms_log. It now stores the text (IndexedDB) and replays it
 * through sendSMS with `queued: true` when the app is back online; the server
 * re-checks everything (tests/sms-outbox-server.test.js). This suite RUNS the
 * real nbd-comms.js and sms-outbox.js in a vm — against an in-memory
 * IndexedDB that models transaction lifetime, a stub fetch, and a small DOM —
 * so it asserts what the page DOES, not what the source says:
 *
 *   - offline → queued, never an sms: handoff; the live 402/429/403/5xx
 *     contract from #1667 is untouched
 *   - no IndexedDB → the pre-outbox handoff (documented fallback)
 *   - the per-user cap refuses out loud
 *   - flush: stale → held without a server call; duplicates collapse (and are
 *     recorded); per-recipient FIFO; single-flight in a tab and across tabs;
 *     each server answer lands in the right state; never a handoff
 *   - the tray: pill only when something waits; the right buttons per
 *     reason; "Send now" = overrideStale only; "Send anyway" adds
 *     overrideActivity
 *   - purge on sign-out (nbd-auth.js purgeSmsOutbox, dashboard _signOut) and
 *     on account switch
 *   - every consumer treats 'queued' as NOT sent
 *
 * Zero deps. Run: node tests/sms-outbox-client.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const ROOT = path.join(__dirname, '..');
// Working-tree files are CRLF on Windows checkouts and LF in CI; normalise so
// the lifted-source markers below match either way.
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const COMMS_SRC = read('docs/pro/js/nbd-comms.js');
const OUTBOX_SRC = read('docs/pro/js/sms-outbox.js');
const AUTH_SRC = read('docs/pro/js/nbd-auth.js');
const BOOT_SRC = read('docs/pro/js/dashboard-bootstrap.module.js');
const INV_SRC = read('docs/pro/js/invoice-pipeline.js');
const CB_SRC = read('docs/pro/js/close-board.js');
const PLH_SRC = read('docs/pro/js/portal-link-helpers.js');
const SF_SRC = read('docs/pro/js/smart-followup.js');
const PANEL_SRC = read('docs/pro/js/customer-smart-followup-panel.js');
const D2D_SRC = read('docs/pro/js/d2d-tracker-core-2026b.js');

const QUIET = { log() {}, warn() {}, error() {}, info() {}, debug() {} };

// A promise that never settles lets Node drain its event loop and exit 0
// halfway through the suite. Finishing is part of passing.
let finished = false;
process.on('exit', (code) => {
  if (!finished && code === 0) {
    console.log('\n✗ suite exited before finishing (a promise never settled)');
    process.exitCode = 1;
  }
});
const MIN = 60 * 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms) {
  const end = Date.now() + (ms || 2000);
  while (Date.now() < end) { if (await cond()) return true; await wait(2); }
  return !!(await cond());
}

// ── In-memory IndexedDB with transaction lifetime ───────────────────────
// A transaction auto-commits once its request queue drains; a failing request
// aborts it and rolls back its writes. `disk` outlives any one page, so two
// "tabs" (two vm contexts) share it the way two real tabs share an origin.
// Transactions on one store run ONE AT A TIME, in creation order, across
// every connection — real IndexedDB never lets two readwrite transactions
// with overlapping scope interleave, and that is exactly the guarantee the
// outbox's queued→sending compare-and-set relies on across tabs.
const _tails = new WeakMap();
// setImmediate, not setTimeout(0): same async-macrotask semantics, without
// the ~1-15ms Windows timer floor on every simulated IndexedDB hop.
const later = (fn) => setImmediate(fn);
function makeIDB(disk) {
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  function makeTx(table, mode) {
    const tx = { mode, error: null, oncomplete: null, onabort: null, _pending: 0, _settled: false, _undo: [], _abort: null };
    const ready = _tails.get(table) || Promise.resolve();
    let release;
    _tails.set(table, new Promise((r) => { release = r; }));
    const finish = () => {
      if (tx._settled) return;
      tx._settled = true;
      if (tx._abort) {
        tx._undo.reverse().forEach((u) => u());
        tx.error = { name: tx._abort };
        if (tx.onabort) tx.onabort({ target: tx });
      } else if (tx.oncomplete) tx.oncomplete({ target: tx });
      release();
    };
    const drain = () => { if (tx._pending === 0) later(finish); };
    ready.then(() => later(drain));
    function request(apply) {
      if (tx._settled) { const e = new Error('inactive'); e.name = 'TransactionInactiveError'; throw e; }
      if (mode === 'readonly' && apply.write) { const e = new Error('readonly'); e.name = 'ReadOnlyError'; throw e; }
      const req = { onsuccess: null, onerror: null, result: undefined, error: null };
      tx._pending++;
      ready.then(() => later(() => {
        if (tx._settled) { tx._pending--; return; }
        try {
          if (apply.write && disk.failWrites) { const e = new Error('w'); e.name = disk.failWrites; throw e; }
          req.result = apply();
        } catch (e) {
          req.error = { name: e.name || 'Error' };
          if (req.onerror) req.onerror({ target: req });
          tx._abort = tx._abort || req.error.name;
          tx._pending--;
          later(finish);
          return;
        }
        if (req.onsuccess) req.onsuccess({ target: req });
        tx._pending--;
        drain();
      }));
      return req;
    }
    const w = (fn) => { fn.write = true; return fn; };
    const store = {
      get: (k) => request(() => clone(table.get(k))),
      getAll: () => request(() => [...table.values()].map(clone)),
      put: (v) => request(w(() => {
        const prev = table.get(v.id); table.set(v.id, clone(v));
        tx._undo.push(() => (prev === undefined ? table.delete(v.id) : table.set(v.id, prev)));
        return v.id;
      })),
      add: (v) => request(w(() => {
        if (table.has(v.id)) { const e = new Error('exists'); e.name = 'ConstraintError'; throw e; }
        table.set(v.id, clone(v)); tx._undo.push(() => table.delete(v.id));
        return v.id;
      })),
      delete: (k) => request(w(() => {
        const prev = table.get(k); table.delete(k);
        tx._undo.push(() => { if (prev !== undefined) table.set(k, prev); });
      })),
      clear: () => request(w(() => {
        const prev = new Map(table); table.clear();
        tx._undo.push(() => { for (const [k, v] of prev) table.set(k, v); });
      })),
    };
    tx.objectStore = () => store;
    tx.abort = () => { tx._abort = tx._abort || 'AbortError'; later(finish); };
    return tx;
  }
  return {
    open(name) {
      if (disk.throwOnOpen) { const e = new Error('open threw'); e.name = 'InvalidStateError'; throw e; }
      const req = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: null, error: null };
      later(() => {
        if (disk.failOpen) { req.error = { name: 'UnknownError' }; if (req.onerror) req.onerror({ target: req }); return; }
        const isNew = !disk.dbs[name];
        if (isNew) disk.dbs[name] = { stores: {} };
        const rec = disk.dbs[name];
        req.result = {
          objectStoreNames: { contains: (s) => !!rec.stores[s] },
          createObjectStore: (s, o) => { rec.stores[s] = new Map(); rec.keyPath = o && o.keyPath; return {}; },
          transaction: (s, mode) => {
            if (!disk.dbs[name] || !rec.stores[s]) { const e = new Error('gone'); e.name = 'InvalidStateError'; throw e; }
            return makeTx(rec.stores[s], mode || 'readonly');
          },
          close() {}, onclose: null, onversionchange: null,
        };
        if (isNew && req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    deleteDatabase(name) {
      const req = { onsuccess: null, onerror: null, onblocked: null };
      later(() => { delete disk.dbs[name]; disk.deleted.push(name); if (req.onsuccess) req.onsuccess({ target: req }); });
      return req;
    },
  };
}
const newDisk = () => ({ dbs: {}, deleted: [] });
const rowsOn = (disk) => {
  const db = disk.dbs['nbd-sms-outbox-db'];
  return db && db.stores.outbox ? [...db.stores.outbox.values()] : [];
};

// ── A small DOM ─────────────────────────────────────────────────────────
function makeDocument() {
  const doc = { _listeners: {}, _clicks: [] };
  function matchesOne(el, sel) {
    sel = sel.trim();
    const attr = sel.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    if (attr) {
      const v = el.getAttribute(attr[1]);
      return attr[2] === undefined ? v !== null : v === attr[2];
    }
    if (sel[0] === '#') return el.id === sel.slice(1);
    if (sel[0] === '.') return sel.slice(1).split('.').every((c) => el.classList.contains(c));
    return el.tagName === sel.toUpperCase();
  }
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = []; this.parentNode = null; this._attrs = {}; this._text = '';
      this.className = ''; this.disabled = false; this.value = ''; this.type = '';
      const style = {}; style.setProperty = (k, v) => { style[k] = v; }; style.cssText = '';
      this.style = style;
    }
    get id() { return this._attrs.id || ''; }
    set id(v) { this._attrs.id = String(v); }
    get classList() {
      const el = this;
      const list = () => el.className.split(/\s+/).filter(Boolean);
      return {
        add: (c) => { const s = new Set(list()); s.add(c); el.className = [...s].join(' '); },
        remove: (c) => { el.className = list().filter((x) => x !== c).join(' '); },
        contains: (c) => list().includes(c),
        toggle: (c, f) => { const on = f === undefined ? !list().includes(c) : f; if (on) el.classList.add(c); else el.classList.remove(c); },
      };
    }
    setAttribute(k, v) { if (k === 'class') this.className = String(v); else this._attrs[k] = String(v); }
    getAttribute(k) { if (k === 'class') return this.className; return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; }
    hasAttribute(k) { return this.getAttribute(k) !== null; }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
    insertBefore(c, ref) {
      if (c.parentNode) c.parentNode.removeChild(c);
      c.parentNode = this;
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = String(v); }
    matches(sel) { return sel.split(',').some((s) => matchesOne(this, s)); }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); });
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    closest(sel) { let n = this; while (n && n.matches) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    getClientRects() { return []; }
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }
    focus() {}
    click() { doc._clicks.push(this); }
  }
  doc.createElement = (t) => new El(t);
  doc.documentElement = new El('html');
  doc.head = new El('head');
  doc.body = new El('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.getElementById = (id) => doc.documentElement.querySelector('#' + id);
  doc.querySelector = (s) => doc.documentElement.querySelector(s);
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s);
  doc.addEventListener = (type, fn) => { (doc._listeners[type] = doc._listeners[type] || []).push(fn); };
  doc.removeEventListener = () => {};
  doc.contains = (n) => doc.documentElement.contains(n);
  doc.visibilityState = 'visible';
  doc.readyState = 'complete';
  doc.clickOn = (el) => (doc._listeners.click || []).forEach((fn) => fn({ target: el }));
  return doc;
}

// ── A page: nbd-comms.js (+ sms-outbox.js) in one vm context ────────────
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const OK200 = () => jsonRes(200, { success: true, sid: 'SM1' });

function loadPage(opts) {
  opts = opts || {};
  const toasts = [];
  const posts = [];
  const events = [];
  const winListeners = {};
  const document = makeDocument();
  const LS = opts.localStorage || {};
  const navigator = Object.assign({ onLine: opts.online !== false }, opts.navigator || {});
  const longTimers = [];
  const disk = opts.disk || newDisk();
  const window = {
    console: QUIET, document, navigator,
    location: { hostname: 'nobigdealwithjoedeal.com', href: 'https://nobigdealwithjoedeal.com/pro/dashboard.html' },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(LS, k) ? LS[k] : null),
      setItem: (k, v) => { LS[k] = String(v); },
      removeItem: (k) => { delete LS[k]; },
    },
    crypto: { randomUUID: () => nodeCrypto.randomUUID(), getRandomValues: (a) => nodeCrypto.randomFillSync(a) },
    showToast: (msg, type) => toasts.push({ msg: String(msg), type }),
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
    removeEventListener: () => {},
    dispatchEvent: (e) => { events.push(e); (winListeners[e.type] || []).forEach((fn) => fn(e)); return true; },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      posts.push({ url, body });
      const respond = opts.respond || OK200;
      const r = await respond(body, posts.length);
      if (r instanceof Error) throw r;
      return r;
    },
    AbortController,
    setTimeout: (fn, ms) => {
      // Long timers (the 25s fetch abort, the 60s retry) never fire here;
      // they are recorded so a test can assert one was scheduled.
      if (ms >= 1000) { const id = { fake: true, ms, fn }; longTimers.push(id); return id; }
      return setTimeout(fn, ms);
    },
    clearTimeout: (id) => { if (id && id.fake) { const i = longTimers.indexOf(id); if (i >= 0) longTimers.splice(i, 1); } else clearTimeout(id); },
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); t.unref && t.unref(); return t; },
    clearInterval,
    Promise, Date, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, Map, Set,
    Uint8Array, encodeURIComponent, decodeURIComponent, isFinite, isNaN, parseInt, URL,
    nbdModal: {
      open: (el) => { el.classList.add('open'); return el; },
      close: (el) => { el.classList.remove('open'); },
    },
    _user: opts.user === null ? null : (opts.user || { uid: 'rep-1', getIdToken: async () => 'id-token' }),
  };
  if (!opts.noIndexedDB) window.indexedDB = makeIDB(disk);
  window.window = window;
  window.self = window;
  if (opts.leads) window._leads = opts.leads;
  if (opts.before) opts.before(window);
  const ctx = vm.createContext(window);
  vm.runInContext(COMMS_SRC, ctx, { filename: 'nbd-comms.js' });
  if (!opts.noOutbox) vm.runInContext(OUTBOX_SRC, ctx, { filename: 'sms-outbox.js' });
  const smsLinks = () => document._clicks.map((a) => String(a.href || '')).filter((h) => /^sms:/.test(h));
  return {
    window, document, toasts, posts, events, disk, LS, longTimers, smsLinks,
    ob: window.NBDSmsOutbox, comms: window.NBDComms,
    fire: (type) => (winListeners[type] || []).forEach((fn) => fn({ type })),
    rows: () => rowsOn(disk),
  };
}

async function booted(h) {
  // Boot: wait for the user, purge other accounts, first flush.
  await wait(15);
  if (h.ob) await h.ob.flush('test-settle');
  await wait(5);
}

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function ' + name + ' not found');
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced ' + name);
}
function extractBlock(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('marker not found: ' + marker);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced block ' + marker);
}

const SMS = { to: '(859) 555-0134', message: 'Running 10 min late', leadId: 'lead-1' };

(async () => {
  // ═══ 1. offline → queued, never a handoff ══════════════════════════════
  console.log('1. OFFLINE — queued in the outbox, never an sms: handoff');
  {
    const h = loadPage({ online: false, leads: [{ id: 'lead-1', stage: 'inspection' }] });
    await booted(h);
    const r = await h.comms.sendSMS(Object.assign({ source: 'test', sourceRef: 'ref-1' }, SMS));
    ok('navigator offline: result { success: true, mode: "queued", id }',
      r.success === true && r.mode === 'queued' && typeof r.id === 'string' && r.id.length >= 16, JSON.stringify(r));
    ok('navigator offline: NO fetch attempted', h.posts.length === 0);
    ok('navigator offline: NO sms: link opened', h.smsLinks().length === 0, JSON.stringify(h.smsLinks()));
    ok('toast: "Queued — will send when you\'re back online"',
      h.toasts.some((t) => /Queued — will send when you're back online/.test(t.msg)), JSON.stringify(h.toasts));
    const rec = h.rows()[0] || {};
    ok('the stored record carries uid, to as entered, toDigits, body, leadId, source, sourceRef',
      rec.uid === 'rep-1' && rec.to === '(859) 555-0134' && rec.toDigits === '8595550134'
      && rec.body === 'Running 10 min late' && rec.leadId === 'lead-1' && rec.source === 'test' && rec.sourceRef === 'ref-1',
      JSON.stringify(rec));
    ok('…status "queued", attempts 0, createdAt a timestamp, id === the returned id',
      rec.status === 'queued' && rec.attempts === 0 && typeof rec.createdAt === 'number' && rec.id === r.id);
    ok('…and the lead\'s stage at queue time, looked up from window._leads', rec.leadStageAtQueue === 'inspection', rec.leadStageAtQueue);
  }
  {
    // The request takes 60ms to fail — long enough to tell "stamped before
    // the attempt" from "stamped after it failed".
    const h = loadPage({ respond: async () => { await wait(60); return new TypeError('Failed to fetch'); } });
    await booted(h);
    const before = Date.now();
    const r = await h.comms.sendSMS(SMS);
    const createdAt = (h.rows()[0] || {}).createdAt;
    ok('online but fetch rejects (status 0): queued, not handed off',
      r.mode === 'queued' && h.smsLinks().length === 0 && h.rows().length === 1, JSON.stringify(r));
    ok('createdAt is the attempt START (before the request), so the server sees a send that raced it',
      createdAt >= before - 5 && createdAt < before + 30, (createdAt - before) + 'ms after the call');
    ok('a retry flush is scheduled (no "online" event will come while the browser says online)',
      h.longTimers.some((t) => t.ms === 60000));
  }
  {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const h = loadPage({ respond: () => abort });
    await booted(h);
    const r = await h.comms.sendSMS(SMS);
    ok('the 25s abort (status 0) is queued too, not handed off', r.mode === 'queued' && h.smsLinks().length === 0);
  }
  {
    const h = loadPage({ online: false });
    await booted(h);
    const r = await h.comms.sendSMS('(859) 555-0134', 'Hi from D2D', 'knock-9', { source: 'd2d-followup-sms' });
    const rec = h.rows()[0] || {};
    ok('positional signature (D2D) queues with knockId and the 4th-arg source',
      r.mode === 'queued' && rec.knockId === 'knock-9' && rec.source === 'd2d-followup-sms' && rec.leadId === null, JSON.stringify(rec));
  }
  {
    const h = loadPage({ online: false });
    await booted(h);
    const r = await h.comms.sendSMS(Object.assign({ forceHandoff: true }, SMS));
    ok('forceHandoff is untouched: opens Messages, stores nothing', r.mode === 'sms' && h.smsLinks().length === 1 && h.rows().length === 0);
  }
  console.log('1b. LIVE answers keep the #1667 contract');
  for (const [label, res, expect] of [
    ['402 still hands off', jsonRes(402, { error: 'paid' }), 'sms'],
    ['429 still hands off', jsonRes(429, { error: 'limit' }), 'sms'],
    ['502 provider_error still hands off', jsonRes(502, { error: 'x', code: 'provider_error' }), 'sms'],
    ['403 opted_out refuses', jsonRes(403, { error: 'STOP', code: 'opted_out' }), 'refuse'],
    ['503 optout_unverified refuses', jsonRes(503, { error: 'x', code: 'optout_unverified' }), 'refuse'],
    ['200 is a platform send', OK200(), 'platform'],
  ]) {
    const h = loadPage({ respond: () => res });
    await booted(h);
    const r = await h.comms.sendSMS(SMS);
    const got = r.mode === 'platform' && r.success === false ? 'refuse' : r.mode;
    ok(label + ' — and nothing is queued', got === expect && h.rows().length === 0, JSON.stringify(r));
  }

  // ═══ 2. no IndexedDB → the pre-outbox behaviour ═══════════════════════
  console.log('2. NO INDEXEDDB — falls back to the pre-outbox handoff (documented)');
  {
    const h = loadPage({ online: false, noIndexedDB: true });
    await booted(h);
    const r = await h.comms.sendSMS(SMS);
    ok('no window.indexedDB: offline send hands off to Messages (old behaviour), nothing queued',
      r.mode === 'sms' && r.success === true && h.smsLinks().length === 1, JSON.stringify(r));
  }
  {
    const disk = newDisk(); disk.throwOnOpen = true;
    const h = loadPage({ online: false, disk });
    await booted(h);
    const r = await h.comms.sendSMS(SMS);
    ok('indexedDB.open throws (private-mode Safari): same fallback', r.mode === 'sms' && h.smsLinks().length === 1);
  }
  {
    const h = loadPage({ online: false, noOutbox: true, respond: () => new TypeError('Failed to fetch') });
    const r = await h.comms.sendSMS(SMS);
    ok('a page that did not load sms-outbox.js keeps the old offline handoff', r.mode === 'sms' && h.smsLinks().length === 1);
  }
  {
    const disk = newDisk();
    const h = loadPage({ online: false, disk });
    await booted(h);
    disk.failWrites = 'QuotaExceededError';
    const r = await h.comms.sendSMS(SMS);
    ok('a write that aborts (quota) is never reported as queued — falls back instead',
      r.mode === 'sms' && h.rows().length === 0, JSON.stringify(r));
  }

  // ═══ 3. the cap ═══════════════════════════════════════════════════════
  console.log('3. CAP — 50 waiting texts per user, the 51st refused out loud');
  {
    const h = loadPage({ online: false });
    await booted(h);
    for (let i = 0; i < 50; i++) {
      await h.ob.enqueue({ uid: 'rep-1', to: '555-010' + (i % 10) + ' ext', body: 'msg ' + i });
    }
    // Another user's rows (before an account-switch purge) never count.
    await h.ob.enqueue({ uid: 'rep-2', to: '5550100199', body: 'theirs' });
    const r = await h.comms.sendSMS(SMS);
    ok('51st: success:false, mode "platform" (a refusal consumers must not re-handle), error "outbox-full"',
      r.success === false && r.mode === 'platform' && r.error === 'outbox-full', JSON.stringify(r));
    ok('51st: nothing stored, nothing handed off', h.rows().filter((x) => x.uid === 'rep-1').length === 50 && h.smsLinks().length === 0);
    ok('51st: the rep is told why', h.toasts.some((t) => t.type === 'error' && /already waiting/.test(t.msg)));
    let threw = null;
    try { await h.ob.enqueue({ uid: 'rep-1', to: '5550100000', body: 'x' }); } catch (e) { threw = e; }
    ok('enqueue itself rejects with reason "queue-full" (never drops silently)', threw && threw.reason === 'queue-full');
  }

  // ═══ 4. flush ═════════════════════════════════════════════════════════
  console.log('4. FLUSH — replay through sendSMS with the queued fields');
  {
    const h = loadPage({ online: false, leads: [{ id: 'lead-1', stage: 'estimate' }] });
    await booted(h);
    const q = await h.comms.sendSMS(Object.assign({ source: 'invoice-sms', sourceRef: 'inv-7' }, SMS));
    h.window.navigator.onLine = true;
    h.fire('online');
    await h.ob.flush('join');      // single-flight: joins the run 'online' started
    const p = h.posts[0] || { body: {} };
    ok('"online" flushes it: one POST to sendSMS', h.posts.length === 1 && /\/sendSMS$/.test(p.url), h.posts.length);
    ok('…with queued:true, clientMsgId = record id, queuedAt = createdAt, leadStageAtQueue',
      p.body.queued === true && p.body.clientMsgId === q.id && typeof p.body.queuedAt === 'number'
      && p.body.leadStageAtQueue === 'estimate' && p.body.to === SMS.to && p.body.body === SMS.message, JSON.stringify(p.body));
    ok('…and no override flags on an automatic flush', !('overrideStale' in p.body) && !('overrideActivity' in p.body));
    ok('sent → removed from the store', h.rows().length === 0);
    const ev = h.events.find((e) => e.type === 'nbd:sms-outbox-sent');
    ok('fires nbd:sms-outbox-sent with source/sourceRef for the caller\'s listener',
      !!ev && ev.detail.id === q.id && ev.detail.source === 'invoice-sms' && ev.detail.sourceRef === 'inv-7' && ev.detail.leadId === 'lead-1');
    ok('toast: "Queued text sent"', h.toasts.some((t) => t.type === 'success' && /Queued text sent/.test(t.msg)));
    ok('no sms: link at any point', h.smsLinks().length === 0);
  }
  {
    const h = loadPage({ online: false });
    await booted(h);
    await h.ob.enqueue({ uid: 'rep-1', to: SMS.to, body: 'old one', createdAt: Date.now() - 16 * MIN });
    h.window.navigator.onLine = true;
    const s = await h.ob.flush('test');
    const rec = h.rows()[0] || {};
    ok('≥15 min old → held "stale" WITHOUT a server call', rec.status === 'held' && rec.heldReason === 'stale' && h.posts.length === 0, JSON.stringify(rec));
    ok('…and the rep is told it needs their OK', h.toasts.some((t) => /needs your OK/.test(t.msg)) && s.held === 1);
  }
  {
    const h = loadPage({ online: false });
    await booted(h);
    await h.ob.enqueue({ uid: 'rep-1', to: '(859) 555-0134', body: 'Same words', createdAt: Date.now() - 3 * MIN });
    await h.ob.enqueue({ uid: 'rep-1', to: '+1 859-555-0134', body: 'Same words', createdAt: Date.now() - 2 * MIN });
    await h.ob.enqueue({ uid: 'rep-1', to: '859.555.0134', body: 'Different words', createdAt: Date.now() - MIN });
    h.window.navigator.onLine = true;
    const s = await h.ob.flush('test');
    const left = h.rows();
    ok('duplicates collapse: identical number (any formatting) + identical text → sent ONCE',
      h.posts.filter((p) => p.body.body === 'Same words').length === 1, h.posts.map((p) => p.body.body).join(' | '));
    ok('the newer copy is kept as "discarded" with reason "duplicate" (recorded, not silently deleted)',
      left.length === 1 && left[0].status === 'discarded' && left[0].heldReason === 'duplicate' && s.duplicates === 1, JSON.stringify(left));
    ok('the OLDEST copy is the one that went', h.posts[0].body.queuedAt < left[0].createdAt);
    ok('a different text to the same number still goes', h.posts.some((p) => p.body.body === 'Different words'));
  }
  {
    // Per-recipient FIFO: A1, B1, A2 (A = one number, B = another).
    const h = loadPage({ online: false });
    await booted(h);
    const now = Date.now();
    await h.ob.enqueue({ uid: 'rep-1', to: '5135550001', body: 'A1', createdAt: now - 5 * MIN });
    await h.ob.enqueue({ uid: 'rep-1', to: '5135550002', body: 'B1', createdAt: now - 4 * MIN });
    await h.ob.enqueue({ uid: 'rep-1', to: '5135550001', body: 'A2', createdAt: now - 3 * MIN });
    h.window.navigator.onLine = true;
    await h.ob.flush('test');
    ok('per-recipient FIFO: oldest recipient first, its texts in order, one recipient at a time → A1, A2, B1',
      h.posts.map((p) => p.body.body).join(',') === 'A1,A2,B1', h.posts.map((p) => p.body.body).join(','));
  }
  {
    // A held text holds back every later text to the SAME number, not others.
    const h = loadPage({
      online: false,
      respond: (b) => (b.body === 'A1' ? jsonRes(409, { code: 'held', reason: 'recent_inbound', error: 'Held: …' }) : OK200()),
    });
    await booted(h);
    const now = Date.now();
    await h.ob.enqueue({ uid: 'rep-1', to: '5135550001', body: 'A1', createdAt: now - 5 * MIN });
    await h.ob.enqueue({ uid: 'rep-1', to: '5135550002', body: 'B1', createdAt: now - 4 * MIN });
    await h.ob.enqueue({ uid: 'rep-1', to: '5135550001', body: 'A2', createdAt: now - 3 * MIN });
    h.window.navigator.onLine = true;
    await h.ob.flush('test');
    const byBody = {}; h.rows().forEach((r) => { byBody[r.body] = r; });
    ok('A1 held (server said recent_inbound) → A2 is NOT sent ahead of it; B1 still goes',
      h.posts.map((p) => p.body.body).join(',') === 'A1,B1', h.posts.map((p) => p.body.body).join(','));
    ok('A1 is "held" with the server\'s reason, A2 stays "queued" behind it',
      byBody.A1 && byBody.A1.status === 'held' && byBody.A1.heldReason === 'recent_inbound'
      && byBody.A2 && byBody.A2.status === 'queued' && !byBody.B1, JSON.stringify(h.rows().map((r) => [r.body, r.status])));
    // A second flush still does not send A2 past the held A1.
    await h.ob.flush('again');
    ok('…and a later flush still does not send A2 past it', h.posts.length === 2);
  }

  console.log('4b. FLUSH — each server answer lands in the right state; never a handoff');
  const answer = async (res) => {
    const h = loadPage({ online: false, respond: () => res });
    await booted(h);
    await h.ob.enqueue({ uid: 'rep-1', to: SMS.to, body: 'hello', createdAt: Date.now() - MIN });
    h.window.navigator.onLine = true;
    const s = await h.ob.flush('test');
    return { h, s, rec: h.rows()[0] || null };
  };
  {
    const { h, rec } = await answer(jsonRes(409, { code: 'held', reason: 'quiet_hours', error: 'Held: outside 8am–9pm' }));
    ok('409 held → "held" with the server reason', rec && rec.status === 'held' && rec.heldReason === 'quiet_hours' && h.smsLinks().length === 0);
  }
  {
    const { h, rec } = await answer(jsonRes(403, { code: 'opted_out', error: 'opted out' }));
    ok('403 opted_out → "discarded", reason "opted_out"', rec && rec.status === 'discarded' && rec.heldReason === 'opted_out', JSON.stringify(rec));
    ok('…with a clear toast', h.toasts.some((t) => t.type === 'error' && /opted out/.test(t.msg) && /NOT sent/.test(t.msg)));
    ok('…and no handoff', h.smsLinks().length === 0);
  }
  for (const [label, res, reason] of [
    ['402', jsonRes(402, { error: 'paid' }), 'plan_required'],
    ['429', jsonRes(429, { error: 'limit' }), 'rate_limited'],
    ['502 provider_error', jsonRes(502, { error: 'x', code: 'provider_error' }), 'provider_error'],
  ]) {
    const { h, rec } = await answer(res);
    ok(label + ' on a replay → "held" (' + reason + '), NEVER an sms: handoff from the flush',
      rec && rec.status === 'held' && rec.heldReason === reason && h.smsLinks().length === 0, JSON.stringify(rec));
  }
  {
    const { h, s, rec } = await answer(new TypeError('Failed to fetch'));
    ok('network failure again → stays "queued", flush stops, retry scheduled',
      rec && rec.status === 'queued' && s.stoppedBy === 'network' && h.longTimers.some((t) => t.ms === 60000), JSON.stringify(s));
  }
  {
    const { rec, s } = await answer(jsonRes(503, { code: 'outbox_unverified', error: 'x' }));
    ok('503 (a server check could not run) → stays "queued" for a later try', rec && rec.status === 'queued' && s.stoppedBy === 'retry');
  }
  {
    const { h, rec } = await answer(jsonRes(200, { success: true, duplicate: true, sid: 'SM9' }));
    ok('200 duplicate (it went on an earlier attempt) → removed, counted as sent', rec === null && h.events.some((e) => e.type === 'nbd:sms-outbox-sent'));
  }
  {
    // A page that died mid-send leaves a 'sending' row; it is replayed with
    // the SAME clientMsgId (the server's claim makes that safe).
    const h = loadPage({ online: false });
    await booted(h);
    const rec = await h.ob.enqueue({ uid: 'rep-1', to: SMS.to, body: 'orphan', createdAt: Date.now() - 2 * MIN });
    const table = h.disk.dbs['nbd-sms-outbox-db'].stores.outbox;
    table.set(rec.id, Object.assign({}, table.get(rec.id), { status: 'sending', sendingAt: Date.now() - 3 * MIN }));
    h.window.navigator.onLine = true;
    await h.ob.flush('test');
    ok('an orphaned "sending" row is replayed with its original clientMsgId',
      h.posts.length === 1 && h.posts[0].body.clientMsgId === rec.id && h.rows().length === 0);
  }

  console.log('4c. SINGLE-FLIGHT — one flush per tab, one per origin');
  {
    let release;
    const gate = new Promise((r) => { release = r; });
    const h = loadPage({ online: false, respond: async () => { await gate; return OK200(); } });
    await booted(h);
    await h.ob.enqueue({ uid: 'rep-1', to: SMS.to, body: 'once', createdAt: Date.now() - MIN });
    h.window.navigator.onLine = true;
    const a = h.ob.flush('a');
    const b = h.ob.flush('b');
    h.fire('online');
    ok('concurrent flush() calls in one tab share one run', a === b);
    release();
    await a;
    ok('…and the text is POSTed exactly once', h.posts.length === 1, String(h.posts.length));
  }
  {
    // Two tabs, same origin: shared IndexedDB and localStorage, no Web Locks.
    const disk = newDisk();
    const LS = {};
    let release;
    const gate = new Promise((r) => { release = r; });
    const respond = async () => { await gate; return OK200(); };
    const t1 = loadPage({ online: false, disk, localStorage: LS, respond });
    const t2 = loadPage({ online: false, disk, localStorage: LS, respond });
    await booted(t1); await booted(t2);
    await t1.ob.enqueue({ uid: 'rep-1', to: '5135550001', body: 'one', createdAt: Date.now() - MIN });
    await t1.ob.enqueue({ uid: 'rep-1', to: '5135550002', body: 'two', createdAt: Date.now() - MIN });
    t1.window.navigator.onLine = true; t2.window.navigator.onLine = true;
    const f1 = t1.ob.flush('tab1');
    await wait(10);
    const f2 = await t2.ob.flush('tab2');
    release();
    await f1;
    ok('two tabs (localStorage lease): the second tab stands down while the first flushes', f2.skipped === 'busy', JSON.stringify(f2));
    ok('…each text POSTed exactly once across both tabs', t1.posts.length + t2.posts.length === 2, (t1.posts.length + t2.posts.length) + '');
  }
  {
    // Two tabs, both racing past a lock (no lease, no locks): the IndexedDB
    // queued→sending compare-and-set still lets only one take each text.
    const disk = newDisk();
    let release;
    const gate = new Promise((r) => { release = r; });
    const respond = async () => { await gate; return OK200(); };
    const noLS = (w) => { w.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} }; };
    const t1 = loadPage({ online: false, disk, respond, before: noLS });
    const t2 = loadPage({ online: false, disk, respond, before: noLS });
    await booted(t1); await booted(t2);
    await t1.ob.enqueue({ uid: 'rep-1', to: SMS.to, body: 'contested', createdAt: Date.now() - MIN });
    t1.window.navigator.onLine = true; t2.window.navigator.onLine = true;
    const f = [t1.ob.flush('x'), t2.ob.flush('y')];
    await wait(20);
    release();
    await Promise.all(f);
    ok('no lease available: the per-record compare-and-set still sends a text once', t1.posts.length + t2.posts.length === 1,
      (t1.posts.length + t2.posts.length) + '');
  }
  {
    // Web Locks path: ifAvailable → a second holder gets null and stands down.
    let held = false;
    const locks = {
      request: async (name, o, cb) => {
        if (held) return cb(null);
        held = true;
        try { return await cb({ name }); } finally { held = false; }
      },
    };
    const disk = newDisk();
    let release;
    const gate = new Promise((r) => { release = r; });
    const respond = async () => { await gate; return OK200(); };
    const t1 = loadPage({ online: false, disk, navigator: { locks }, respond });
    const t2 = loadPage({ online: false, disk, navigator: { locks }, respond });
    await booted(t1); await booted(t2);
    await t1.ob.enqueue({ uid: 'rep-1', to: SMS.to, body: 'locked', createdAt: Date.now() - MIN });
    t1.window.navigator.onLine = true; t2.window.navigator.onLine = true;
    const f1 = t1.ob.flush('a');
    await wait(10);
    const f2 = await t2.ob.flush('b');
    release(); await f1;
    ok('navigator.locks (ifAvailable): the second tab stands down', f2.skipped === 'busy' && t1.posts.length + t2.posts.length === 1, JSON.stringify(f2));
  }

  // ═══ 5. tray ══════════════════════════════════════════════════════════
  console.log('5. TRAY — pill, reasons, buttons, explicit consent');
  {
    const h = loadPage({ online: false });
    await booted(h);
    ok('no pill while nothing waits', !h.document.getElementById('nbd-sms-outbox-pill')
      || !h.document.getElementById('nbd-sms-outbox-pill').classList.contains('is-visible'));
    await h.comms.sendSMS(SMS);
    const pillEl = () => h.document.getElementById('nbd-sms-outbox-pill');
    await until(() => pillEl() && pillEl().classList.contains('is-visible'));
    const pill = pillEl() || h.document.createElement('button');
    ok('a queued text shows the "Pending texts (1)" pill',
      pill.classList.contains('is-visible') && pill.textContent === 'Pending texts (1)', pill.textContent);
    ok('the pill is a button driven by the delegated listener (no inline handler)',
      pill.tagName === 'BUTTON' && pill.getAttribute('data-sms-outbox-action') === 'open' && !pill.getAttribute('onclick'));
    h.document.clickOn(pill);
    await until(() => h.document.querySelector('[data-sms-outbox-row]'));
    const modal = h.document.getElementById('nbd-sms-outbox-modal') || h.document.createElement('div');
    ok('tapping it opens the tray through nbdModal (.modal-bg + .open)',
      !!modal && modal.classList.contains('modal-bg') && modal.classList.contains('open'));
    const row = modal.querySelector('[data-sms-outbox-row]');
    const txt = row ? row.textContent : '';
    ok('the row masks the number except the last 4', /\(•••\) •••-0134/.test(txt) && !/859/.test(txt), txt || ('modal: ' + modal.textContent));
    ok('…shows the text, and "Waiting for a connection"', /Running 10 min late/.test(txt) && /Waiting for a connection/.test(txt), txt);
  }
  {
    const I = loadPage({ online: false }).ob._internals;
    const reason = (heldReason, status) => I.reasonText({ status: status || 'held', heldReason });
    ok('plain-English reasons', reason('stale') === 'Waiting — sent more than 15 min ago'
      && reason('quiet_hours') === 'Quiet hours — can send after 8am'
      && reason('recent_inbound') === 'Homeowner texted you since'
      && reason('recent_outbound') === 'Someone already texted this number'
      && reason('lead_changed') === 'Lead changed'
      && reason('opted_out', 'discarded') === 'Opted out');
    const acts = (heldReason, status) => I.actionsFor({ status: status || 'held', heldReason }).map((a) => a[1]).join(',');
    ok('recent_outbound / recent_inbound / lead_changed offer Send anyway, Edit, Discard',
      ['recent_outbound', 'recent_inbound', 'lead_changed'].every((r) => acts(r) === 'send-anyway,edit,discard'));
    ok('stale / quiet hours offer Send now (no activity override), Edit, Discard',
      acts('stale') === 'send,edit,discard' && acts('quiet_hours') === 'send,edit,discard');
    ok('lead_gone offers only Discard', acts('lead_gone') === 'discard');
    ok('"Open in Messages" only after a 402 / 429 / provider_error',
      acts('plan_required').includes('handoff') && acts('rate_limited').includes('handoff') && acts('provider_error').includes('handoff')
      && !['stale', 'quiet_hours', 'recent_inbound', 'recent_outbound', 'lead_changed', 'lead_gone', 'in_flight'].some((r) => acts(r).includes('handoff')));
    ok('an opted-out (discarded) text can only be dismissed', acts('opted_out', 'discarded') === 'discard');
  }
  {
    const h = loadPage({ online: false });
    await booted(h);
    await h.ob.enqueue({ uid: 'rep-1', to: SMS.to, body: 'old', createdAt: Date.now() - 40 * MIN });
    h.window.navigator.onLine = true;
    await h.ob.flush('t');
    const rec = h.rows()[0];
    await h.ob.sendNow(rec.id);
    const p = h.posts[0] || { body: {} };
    ok('"Send now" on a stale text re-sends queued:true with overrideStale:true and NOT overrideActivity',
      p.body.queued === true && p.body.overrideStale === true && !('overrideActivity' in p.body) && p.body.clientMsgId === rec.id, JSON.stringify(p.body));
    ok('…sent → removed', h.rows().length === 0);
  }
  {
    const h = loadPage({ online: false, respond: (b, n) => (n === 1 ? jsonRes(409, { code: 'held', reason: 'recent_inbound', error: 'x' }) : OK200()) });
    await booted(h);
    await h.ob.enqueue({ uid: 'rep-1', to: SMS.to, body: 'reply?', createdAt: Date.now() - MIN });
    h.window.navigator.onLine = true;
    await h.ob.flush('t');
    const rec = h.rows()[0];
    ok('held recent_inbound after the flush', rec.status === 'held' && rec.heldReason === 'recent_inbound');
    h.ob.openTray();
    await until(() => h.document.querySelector('[data-sms-outbox-action="send-anyway"]'));
    const btn = h.document.querySelector('[data-sms-outbox-action="send-anyway"]') || h.document.createElement('button');
    ok('the tray renders a "Send anyway" button for it', btn.textContent === 'Send anyway' && btn.getAttribute('data-sms-outbox-id') === rec.id);
    const reasonEl = h.document.querySelector('.nbd-sms-ob-reason');
    ok('…under the plain-English reason "Homeowner texted you since"', !!reasonEl && reasonEl.textContent === 'Homeowner texted you since');
    h.document.clickOn(btn);
    await until(() => h.posts.length === 2 && h.rows().length === 0);
    const p = h.posts[1] || { body: {} };
    ok('"Send anyway" sends overrideActivity:true (with overrideStale — an explicit tap)',
      p.body.overrideActivity === true && p.body.overrideStale === true && p.body.queued === true, JSON.stringify(p.body));
    ok('…sent → removed', h.rows().length === 0);
  }
  {
    // Consent is per tap. "Send anyway" answered THAT hold; if its send never
    // reached the server, a later plain "Send now" must not inherit it.
    const answers = [
      jsonRes(409, { code: 'held', reason: 'recent_inbound', error: 'x' }),
      new TypeError('Failed to fetch'),
      jsonRes(409, { code: 'held', reason: 'recent_inbound', error: 'x' }),
    ];
    const h = loadPage({ online: false, respond: (b, n) => answers[n - 1] || OK200() });
    await booted(h);
    const rec = await h.ob.enqueue({ uid: 'rep-1', to: SMS.to, body: 'consent', createdAt: Date.now() - MIN });
    h.window.navigator.onLine = true;
    await h.ob.flush('t');
    await h.ob.sendNow(rec.id, { activity: true });
    const mid = h.rows()[0] || {};
    ok('a "Send anyway" that never reached the server leaves the text held as it was',
      mid.status === 'held' && mid.heldReason === 'recent_inbound' && h.posts[1].body.overrideActivity === true, JSON.stringify(mid));
    await h.ob.sendNow(rec.id);
    const p = h.posts[2] || { body: {} };
    ok('…and a later plain "Send now" carries overrideStale only — not the earlier activity consent',
      p.body.overrideStale === true && !('overrideActivity' in p.body), JSON.stringify(p.body));
    ok('…so the server can still hold it for the new activity', (h.rows()[0] || {}).heldReason === 'recent_inbound');
  }
  {
    const answers = [new TypeError('Failed to fetch'), OK200()];
    const h = loadPage({ online: false, respond: (b, n) => answers[n - 1] || OK200() });
    await booted(h);
    const rec = await h.ob.enqueue({ uid: 'rep-1', to: SMS.to, body: 'tap then flush', createdAt: Date.now() - MIN });
    h.window.navigator.onLine = true;
    await h.ob.sendNow(rec.id);          // explicit tap on a QUEUED text; network drops
    ok('an explicit tap that never reached the server puts a queued text back to "queued"',
      (h.rows()[0] || {}).status === 'queued' && h.posts[0].body.overrideStale === true);
    await h.ob.flush('auto');
    const p = h.posts[1] || { body: {} };
    ok('…and the next AUTOMATIC flush sends it with no override at all',
      p.body.queued === true && !('overrideStale' in p.body) && !('overrideActivity' in p.body), JSON.stringify(p.body));
  }
  {
    const h = loadPage({ online: false, respond: () => jsonRes(402, { error: 'paid' }) });
    await booted(h);
    await h.ob.enqueue({ uid: 'rep-1', to: SMS.to, body: 'plan', createdAt: Date.now() - MIN });
    h.window.navigator.onLine = true;
    await h.ob.flush('t');
    const rec = h.rows()[0];
    ok('a 402 on the replay leaves it held (plan_required) and opens nothing', rec.heldReason === 'plan_required' && h.smsLinks().length === 0);
    await h.ob.openInMessages(rec.id);
    ok('"Open in Messages" (explicit tap) hands THAT text off and removes it',
      h.smsLinks().length === 1 && /body=plan$/.test(h.smsLinks()[0]) && h.rows().length === 0, JSON.stringify(h.smsLinks()));
  }
  {
    const h = loadPage({ online: false, respond: () => jsonRes(409, { code: 'held', reason: 'recent_outbound', error: 'x' }) });
    await booted(h);
    const rec = await h.ob.enqueue({ uid: 'rep-1', to: SMS.to, body: 'x', createdAt: Date.now() - MIN });
    h.window.navigator.onLine = true;
    await h.ob.flush('t');
    ok('"Open in Messages" is refused for an activity hold', (await h.ob.openInMessages(rec.id)) === false && h.smsLinks().length === 0);
    await h.ob.discard(rec.id);
    ok('Discard removes it, sends nothing', h.rows().length === 0 && h.posts.length === 1);
  }
  {
    const h = loadPage({ online: false });
    await booted(h);
    const rec = await h.ob.enqueue({ uid: 'rep-1', to: SMS.to, body: 'typo hre', createdAt: Date.now() - 20 * MIN });
    h.window.navigator.onLine = true;
    await h.ob.flush('t');
    await h.ob.editAndSend(rec.id, 'typo here');
    const p = h.posts[0] || { body: {} };
    ok('Edit → sends the edited text under a NEW clientMsgId but the ORIGINAL queuedAt',
      p.body.body === 'typo here' && p.body.clientMsgId !== rec.id && p.body.queuedAt === rec.createdAt && p.body.overrideStale === true, JSON.stringify(p.body));
  }

  // ═══ 6. purge ═════════════════════════════════════════════════════════
  console.log('6. PURGE — sign-out and account switch');
  {
    const h = loadPage({ online: false });
    await booted(h);
    await h.comms.sendSMS(SMS);
    await h.ob.enqueue({ uid: 'rep-2', to: '5135550009', body: 'someone else' });
    ok('purgeAll() deletes every record for every user', (await h.ob.purgeAll()) === true && h.rows().length === 0);
  }
  {
    // nbd-auth.js purgeSmsOutbox, run for real (it is an object method on an
    // ES module that imports from gstatic, so the method is lifted out).
    const body = extractBlock(AUTH_SRC, 'purgeSmsOutbox() {');
    // Its 2s bound is shortened to 20ms here (the bound's EXISTENCE is what is
    // under test, not its length).
    const fastTimeout = (fn, ms) => setTimeout(fn, ms >= 1000 ? 20 : ms);
    const make = (win) => new Function('window', 'setTimeout', 'return ({ ' + body + ' });')(win, fastTimeout);
    const h = loadPage({ online: false });
    await booted(h);
    await h.comms.sendSMS(SMS);
    const ok1 = await make(h.window).purgeSmsOutbox();
    ok('NBDAuth.purgeSmsOutbox uses the loaded outbox and empties it', ok1 === true && h.rows().length === 0);
    const disk = newDisk();
    const h2 = loadPage({ online: false, disk });
    await booted(h2);
    await h2.comms.sendSMS(SMS);
    const bare = { indexedDB: makeIDB(disk) };      // a page that never loaded sms-outbox.js
    const ok2 = await make(bare).purgeSmsOutbox();
    ok('…on a page without the outbox module it deletes the database directly',
      ok2 === true && disk.deleted.includes('nbd-sms-outbox-db') && rowsOn(disk).length === 0);
    const hang = { NBDSmsOutbox: { purgeAll: () => new Promise(() => {}) } };
    // Watchdog: an unbounded purge must FAIL this assertion, not park the
    // suite on a promise that never settles.
    const ok3 = await Promise.race([make(hang).purgeSmsOutbox(), wait(1000).then(() => 'hung')]);
    ok('…and gives up after its bound instead of stalling sign-out', ok3 === false, String(ok3));
  }
  {
    ok('purgeAccountStorage (logout + account switch) purges the outbox',
      /purgeAccountStorage\(\)\s*\{[\s\S]*?return NBDAuth\.purgeSmsOutbox\(\);\s*\}/.test(AUTH_SRC));
    ok('logout() awaits purgeAccountStorage before signOut',
      /async logout\([^)]*\)\s*\{[\s\S]{0,300}await this\.purgeAccountStorage\(\)[\s\S]{0,200}await signOut\(_auth\)/.test(AUTH_SRC));
  }
  {
    // dashboard _signOut: the purge must COMPLETE before signOut() runs.
    const block = extractBlock(BOOT_SRC, 'window._signOut = () => {');
    const order = [];
    let finishPurge;
    const win = {
      NBDAuth: { purgeSmsOutbox: () => { order.push('purge-start'); return new Promise((r) => { finishPurge = () => { order.push('purge-done'); r(true); }; }); } },
      localStorage: { length: 0, key: () => null, removeItem() {} },
      location: { replace: (u) => order.push('redirect:' + u) },
    };
    const signOut = async () => { order.push('signOut'); };
    new Function('window', 'signOut', 'auth', 'localStorage', block)(win, signOut, {}, win.localStorage);
    const p = win._signOut();
    await wait(5);
    ok('dashboard _signOut starts the purge and does NOT sign out before it finishes',
      order.join(',') === 'purge-start', order.join(','));
    finishPurge();
    await p;
    ok('…then signs out and redirects', order.join(',') === 'purge-start,purge-done,signOut,redirect:/pro/login.html', order.join(','));
  }
  {
    // Account switch: rep-1 leaves texts; rep-2 opens the page on the same device.
    const disk = newDisk();
    const a = loadPage({ online: false, disk });
    await booted(a);
    await a.comms.sendSMS(SMS);
    ok('rep-1 has a queued text', rowsOn(disk).length === 1);
    const b = loadPage({ online: true, disk, user: { uid: 'rep-2', getIdToken: async () => 't' } });
    await booted(b);
    ok('rep-2 signing in on the same device: rep-1\'s text is deleted, never shown, never sent',
      rowsOn(disk).length === 0 && b.posts.length === 0, JSON.stringify(rowsOn(disk)));
    const pill = b.document.getElementById('nbd-sms-outbox-pill');
    ok('…and rep-2 sees no pill', !pill || !pill.classList.contains('is-visible'));
  }
  {
    const disk = newDisk();
    const a = loadPage({ online: false, disk });
    await booted(a);
    await a.ob.enqueue({ uid: 'rep-2', to: '5135550009', body: 'not mine', createdAt: Date.now() - MIN });
    a.window.navigator.onLine = true;
    await a.ob.flush('t');
    ok('a flush never sends another user\'s record', a.posts.length === 0);
    ok('list() never returns another user\'s record', (await a.ob.list('rep-1')).length === 0);
  }

  // ═══ 7. consumers ═════════════════════════════════════════════════════
  console.log('7. CONSUMERS — mode "queued" is NOT sent');
  const QUEUED = { success: true, mode: 'queued', id: 'q-1' };
  {
    // invoice-pipeline.js — runs for real; Firestore is a stub.
    const writes = [];
    let status = 'draft';
    const listeners = {};
    const win = {
      console: QUIET,
      _db: { name: 'db' },
      doc: (db, col, id) => ({ path: col + '/' + id }),
      collection: () => ({}),
      getDoc: async (ref) => ({ exists: () => true, data: () => ({ status, customerPhone: '(859) 555-0134', leadId: 'lead-1' }) }),
      updateDoc: async (ref, data) => { writes.push({ path: ref.path, data }); if (data.status) status = data.status; },
      showToast: () => {},
      NBDComms: { sendSMS: async (o) => { win._smsArgs = o; return QUEUED; } },
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    };
    win.window = win;
    const ctx = vm.createContext(Object.assign(win, { Date, JSON, Math, Promise, Object, Array, String, Number, Error, isNaN, parseFloat, setTimeout, clearTimeout }));
    vm.runInContext(INV_SRC, ctx, { filename: 'invoice-pipeline.js' });
    const r = await win.InvoicePipeline.sendInvoice('inv-1', 'sms');
    await wait(5);
    ok('invoice SMS queued: sendInvoice returns { queued: true }', r && r.queued === true, JSON.stringify(r));
    ok('invoice SMS queued: the invoice is NEVER written "sent"', !writes.some((w) => w.data.status === 'sent'), JSON.stringify(writes));
    ok('…its send lock is released back to "draft"', writes.some((w) => w.data.status === 'draft') && status === 'draft');
    ok('…and the text carries source "invoice-sms" + the invoice id', win._smsArgs.source === 'invoice-sms' && win._smsArgs.sourceRef === 'inv-1');
    (listeners['nbd:sms-outbox-sent'] || []).forEach((fn) => fn({ detail: { source: 'invoice-sms', sourceRef: 'inv-1' } }));
    await wait(5);
    ok('when the outbox actually sends it, the invoice is marked "sent" then', status === 'sent');
    status = 'paid';
    const n = writes.length;
    (listeners['nbd:sms-outbox-sent'] || []).forEach((fn) => fn({ detail: { source: 'invoice-sms', sourceRef: 'inv-1' } }));
    await wait(5);
    ok('…but never over a paid/void/already-sent invoice', writes.length === n && status === 'paid');
    (listeners['nbd:sms-outbox-sent'] || []).forEach((fn) => fn({ detail: { source: 'deal-sms', sourceRef: 'inv-1' } }));
    await wait(5);
    ok('…and ignores other sources', writes.length === n);
  }
  {
    // close-board.js sendViaSMS + its listener, lifted out with their deps.
    const listenerSrc = extractBlock(CB_SRC, "if (typeof window.addEventListener === 'function') {");
    ok('close-board: the lifted listener is the outbox one', /nbd:sms-outbox-sent/.test(listenerSrc));
    const sendSrc = extractFunction(CB_SRC, 'sendViaSMS');
    const updates = [];
    const listeners = {};
    const deal = { id: 'd1', customerPhone: '(859) 555-0134', customerName: 'Sam', leadId: 'lead-1', status: 'draft' };
    const dealRooms = [deal];
    const win = {
      NBDComms: { sendSMS: async (o) => { win._args = o; return QUEUED; } },
      showToast: () => {},
      open: () => { win._opened = true; },
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    };
    const updateDeal = (id, u) => { updates.push({ id, u }); Object.assign(dealRooms.find((d) => d.id === id), u); };
    const factory = new Function('window', 'dealRooms', 'getDealAcceptLink', '_dealBrand', 'DEAL_STATUS', 'updateDeal',
      "const DEAL_SMS_SOURCE = 'deal-sms';\n" + listenerSrc + '\nasync ' + sendSrc + '\nreturn sendViaSMS;');
    const sendViaSMS = factory(win, dealRooms, async () => 'https://nobigdealwithjoedeal.com/deal/tok', () => ({ name: 'NBD' }),
      { DRAFT: 'draft', SENT: 'sent' }, updateDeal);
    await sendViaSMS('d1');
    ok('close-board: a queued deal text does NOT stamp the deal SENT', updates.length === 0 && deal.status === 'draft', JSON.stringify(updates));
    ok('…and passes source "deal-sms" + the deal id', win._args.source === 'deal-sms' && win._args.sourceRef === 'd1');
    (listeners['nbd:sms-outbox-sent'] || []).forEach((fn) => fn({ detail: { source: 'deal-sms', sourceRef: 'd1' } }));
    ok('…the outbox sending it stamps SENT then', deal.status === 'sent' && updates.length === 1);
    deal.status = 'accepted';
    (listeners['nbd:sms-outbox-sent'] || []).forEach((fn) => fn({ detail: { source: 'deal-sms', sourceRef: 'd1' } }));
    ok('…but never rewinds a deal that moved on', deal.status === 'accepted' && updates.length === 1);
  }
  {
    // portal-link-helpers.js smsForLead — runs for real.
    const writes = [];
    const listeners = {};
    const leads = [{ id: 'lead-1', phone: '(859) 555-0134', firstName: 'Sam', stage: 'estimate' }];
    const win = {
      console: QUIET,
      _leads: leads,
      _mintPortalUrl: async () => 'https://nobigdealwithjoedeal.com/pro/portal.html?token=abc',
      NBDComms: { sendSMS: async (o) => { win._args = o; return QUEUED; } },
      showToast: () => {},
      db: {}, doc: (db, c, id) => ({ path: c + '/' + id }),
      updateDoc: async (ref, d) => { writes.push({ path: ref.path, d }); },
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
      dispatchEvent: () => true,
      CustomEvent: function (t, i) { this.type = t; this.detail = i && i.detail; },
      location: { href: '' },
      document: { getElementById: () => null, querySelector: () => null, addEventListener() {}, createElement: () => ({ style: {} }) },
      navigator: {},
    };
    win.window = win;
    const ctx = vm.createContext(Object.assign(win, { URL, Date, JSON, Math, Promise, Object, Array, String, Set, Map, Error, encodeURIComponent, setTimeout }));
    vm.runInContext(PLH_SRC, ctx, { filename: 'portal-link-helpers.js' });
    await win.PortalLinkHelpers.smsForLead(leads[0]);
    ok('portal link: a queued text is NOT recorded as a share (no lastSharedAt)',
      writes.length === 0 && !leads[0].lastSharedAt && !win._leads[0].lastSharedAt, JSON.stringify(writes));
    ok('…and passes leadStage + source for the outbox', win._args.leadStage === 'estimate' && win._args.source === 'portal-share-sms' && win._args.sourceRef === 'lead-1');
    (listeners['nbd:sms-outbox-sent'] || []).forEach((fn) => fn({ detail: { source: 'portal-share-sms', sourceRef: 'lead-1' } }));
    ok('…it becomes a share when the outbox actually sends it', writes.length === 1 && writes[0].d.lastSharedVia === 'sms');
  }
  {
    // smart-followup.js executeSuggestion — lifted with its helpers.
    const recorded = [];
    const factory = new Function('window', 'computeSuggestion', 'recordOutcome', 'leadName',
      'async ' + extractFunction(SF_SRC, 'executeSuggestion') + '\nreturn executeSuggestion;');
    const win = { NBDComms: { sendSMS: async (o) => { win._args = o; return QUEUED; } } };
    const exec = factory(win, () => null, (id, o) => recorded.push(o), () => 'Sam');
    const r = await exec({ id: 'lead-1', phone: '(859) 555-0134', stage: 'follow_up' }, { action: 'text', channel: 'sms', draft: 'Hi Sam' });
    ok('smart-followup: returns mode "queued" to its caller unchanged', r.mode === 'queued' && r.success === true);
    ok('…and passes the lead stage for the outbox', win._args.leadStage === 'follow_up' && win._args.source === 'smart-followup-sms');
  }
  {
    // customer-smart-followup-panel.js — a queued result is final: no fallback re-send.
    const factory = new Function('window', '_dismissedThisSession', 'update',
      extractFunction(PANEL_SRC, 'wireActions') + '\nreturn wireActions;');
    const calls = [];
    let handler = null;
    const btn = { getAttribute: () => 'sms', addEventListener: (ev, fn) => { handler = fn; }, disabled: false };
    const host = { querySelectorAll: (s) => (s === '[data-csf-action]' ? [btn] : []), querySelector: () => ({ textContent: 'Hi' }) };
    const win = {
      SmartFollowup: { computeSuggestion: () => ({ draft: 'x' }), executeSuggestion: async () => QUEUED, recordOutcome: () => {} },
      PortalLinkHelpers: { smsForLead: () => calls.push('smsForLead'), emailForLead: () => calls.push('emailForLead') },
    };
    factory(win, new Set(), () => {})(host, { id: 'lead-1' });
    await handler({ stopPropagation() {} });
    ok('customer panel: a queued text does NOT fall back to smsForLead (no second message)', calls.length === 0, calls.join());
  }
  {
    // d2d-tracker-core-2026b.js sendFollowUpSMS.
    const factory = new Function('window', 'state', 'SMS_TEMPLATES', '_fillTemplate', 'formatDate',
      extractFunction(D2D_SRC, 'sendFollowUpSMS') + '\nreturn sendFollowUpSMS;');
    const opened = []; const toasts = []; let args = null;
    const win = {
      NBDComms: { sendSMS: async (...a) => { args = a; return QUEUED; } },
      open: (u) => opened.push(u), showToast: (m, t) => toasts.push(m), _user: { displayName: 'Joe' },
    };
    factory(win, { currentRep: { name: 'Joe' } }, { follow_up: { body: 'Hi {name}' } }, (b) => b, () => 'soon')(
      { id: 'knock-1', phone: '(859) 555-0134', homeowner: 'Sam', disposition: 'follow_up' }, 'follow_up');
    await wait(5);
    ok('D2D: a queued follow-up shows no "Text sent" toast and opens nothing',
      !toasts.some((m) => /Text sent/.test(m)) && opened.length === 0, JSON.stringify(toasts));
    ok('D2D: still the positional call (phone, body, knockId) plus the source option',
      args && args[0] === '(859) 555-0134' && args[2] === 'knock-1' && args[3] && args[3].source === 'd2d-followup-sms');
  }

  // ═══ 8. wiring ════════════════════════════════════════════════════════
  console.log('8. WIRING');
  {
    for (const page of ['docs/pro/dashboard.html', 'docs/pro/customer.html']) {
      const html = read(page);
      const i = html.indexOf('<script defer src="js/nbd-comms.js?v=1"></script>');
      const j = html.indexOf('<script defer src="js/sms-outbox.js?v=1"></script>');
      ok(page + ' loads sms-outbox.js (defer) right after nbd-comms.js', i >= 0 && j > i && html.slice(i, j).split('<script').length === 2);
    }
    ok('sms-outbox.js has its OWN IndexedDB (not offline-manager\'s nbd-offline-db, which sw.js replays)',
      /const DB_NAME = 'nbd-sms-outbox-db'/.test(OUTBOX_SRC) && !/nbd-offline-db|pending-writes/.test(OUTBOX_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
    ok('no localStorage copy of phone numbers or message text (only the flush lease key)',
      (OUTBOX_SRC.match(/localStorage\.setItem\(/g) || []).length === 1 && /localStorage\.setItem\(LEASE_KEY/.test(OUTBOX_SRC));
    ok('no inline handlers in the tray (CSP)', !/\.on(click|change|input)\s*=|innerHTML/.test(OUTBOX_SRC));
  }

  finished = true;
  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('suite crashed:', (e && e.stack) || e);
  process.exit(1);
});

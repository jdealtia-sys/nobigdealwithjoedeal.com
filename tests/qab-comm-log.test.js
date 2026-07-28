/**
 * tests/qab-comm-log.test.js — the mobile quick-action bar must reach the
 * Comm Log.
 *
 * The gap this closes: on the dashboard, crm-snooze.js installs a
 * capture-phase delegate that logs EVERY tel:/sms:/mailto: click. That file is
 * NOT loaded on customer.html, so taps on the quick-action bar reached the
 * timeline from nowhere — a rep could call a customer from the bar and, weeks
 * later, find no record it happened.
 *
 * It must be closed with a LOGGER, not a send. An earlier attempt rewired the
 * Text button to PortalLinkHelpers.smsForLead, which mints a portal link,
 * composes a fixed body and POSTs to Twilio with no preview — a rep tapping 💬
 * would have fired an unreviewed templated message at the homeowner. An
 * irreversible customer-facing send behind a mislabelled control is strictly
 * worse than a missing log line, so this pins BOTH halves: the log fires, and
 * the anchors stay anchors.
 *
 * Drives the real module in a fake-DOM sandbox at a mobile viewport.
 *
 * Zero deps.  Run: node tests/qab-comm-log.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const QAB_PATH = path.join(ROOT, 'docs/pro/js/customer-quick-action-bar.js');
const QAB = fs.readFileSync(QAB_PATH, 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('QUICK-ACTION BAR — taps reach the Comm Log');

// ── Minimal DOM good enough for the module's render path ──────────────
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [], attrs: {}, style: {}, dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    _listeners: [],
    set innerHTML(html) { this._html = html; this.children = parseAnchors(html, this); },
    get innerHTML() { return this._html || ''; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); },
    addEventListener(type, fn, opts) { this._listeners.push({ type, fn, capture: !!opts }); },
    querySelector() { return null; },
    contains(node) {
      if (node === this) return true;
      return this.children.some((c) => c === node || (c.contains && c.contains(node)));
    },
  };
  return el;
}

// Pull the <a href> tags out of the rendered bar so we can "click" one.
function parseAnchors(html, parent) {
  const out = [];
  const re = /<a\s+class="([^"]*)"\s+href="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) {
    const a = makeEl('a');
    a.attrs.class = m[1];
    a.attrs.href = m[2];
    a.parentElement = parent;
    a.closest = (sel) => (sel === 'a[href]' ? a : null);
    out.push(a);
  }
  return out;
}

function run({ withLogger = true, lead = { id: 'L1', firstName: 'Dana', phone: '(555) 010-2020', email: 'd@x.test' } } = {}) {
  const head = makeEl('head');
  const body = makeEl('body');
  const logged = [];

  const win = {
    innerWidth: 390,                       // mobile — the bar only renders ≤640
    location: { pathname: '/pro/customer' },
    _currentLead: lead,
    _customerId: lead.id,
    openTaskModal() {},
    addEventListener() {},
    // init() schedules a re-render; run callbacks inline so the bar exists
    // by the time runInContext returns.
    setTimeout: (fn) => { try { fn(); } catch (e) { /* re-render is best-effort */ } return 0; },
    clearTimeout() {},
    document: {
      head, body,
      readyState: 'complete',
      createElement: makeEl,
      getElementById: () => null,
      addEventListener() {},
      querySelector: () => null,
    },
  };
  if (withLogger) {
    win.logCommunication = (leadId, type, content) => {
      logged.push({ leadId, type, content });
      return Promise.resolve('ok');
    };
  }
  win.window = win;
  vm.runInContext(QAB, vm.createContext(win));

  // The module renders on DOMContentLoaded/init; call the exported path by
  // dispatching what it listens for is fragile, so drive it via the bar it
  // appended to body.
  const bar = body.children.find((c) => c.attrs && c.attrs.id === undefined && c._listeners.length)
    || body.children[body.children.length - 1];
  return { win, bar, logged, body };
}

// ── 1. The bar renders and installs a capture-phase click listener ────
{
  const { bar } = run();
  ok('bar renders on a mobile customer page', !!bar, 'nothing appended to body');
  const capture = bar && bar._listeners.filter((l) => l.type === 'click' && l.capture);
  ok('installs a CAPTURE-phase click listener',
    !!capture && capture.length >= 1,
    'must fire before anything that could stopPropagation');
}

// ── 2. Each protocol logs with the right type ─────────────────────────
for (const [proto, type] of [['tel:', 'call'], ['sms:', 'sms'], ['mailto:', 'email']]) {
  const { bar, logged } = run();
  const anchor = bar.children.find((a) => (a.attrs.href || '').startsWith(proto));
  if (!anchor) { ok(`${proto} anchor exists`, false); continue; }
  const handler = bar._listeners.find((l) => l.type === 'click' && l.capture);
  // Guard rather than assume: with no listener installed (the pre-fix shape)
  // this must report a clean failure, not crash the whole suite on undefined.
  if (handler) handler.fn({ target: anchor });
  ok(`${proto} tap logs type '${type}'`,
    !!handler && logged.length === 1 && logged[0].type === type && logged[0].leadId === 'L1',
    handler ? JSON.stringify(logged) : 'no capture-phase click listener installed');
}

// ── 3. The anchors stay anchors — no silent send ──────────────────────
{
  const { bar } = run();
  const hrefs = bar.children.map((a) => a.attrs.href || '');
  ok('Text is an sms: anchor, not a Twilio send',
    hrefs.some((h) => h.startsWith('sms:')));
  ok('Email is a mailto: anchor',
    hrefs.some((h) => h.startsWith('mailto:')));
  ok('module never reaches for the auto-sending portal helpers',
    !/PortalLinkHelpers\.(smsForLead|emailForLead)\s*\(/.test(QAB),
    'smsForLead POSTs to Twilio with no preview — never wire it behind a button labelled "Text"');
}

// ── 4. Degrades safely ────────────────────────────────────────────────
{
  const { bar } = run({ withLogger: false });
  const anchor = bar.children.find((a) => (a.attrs.href || '').startsWith('tel:'));
  const handler = bar._listeners.find((l) => l.type === 'click' && l.capture);
  let threw = false;
  try { if (handler) handler.fn({ target: anchor }); } catch (e) { threw = true; }
  ok('no logger present → does not throw (navigation must never break)', !threw);
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

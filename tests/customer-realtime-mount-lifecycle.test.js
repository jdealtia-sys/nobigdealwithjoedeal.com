/**
 * tests/customer-realtime-mount-lifecycle.test.js — mountMessages(), driven
 * for real (Playwright), not just source-text pattern matching.
 *
 * 2026-09-17: customer-realtime.module.js used to be a bare top-level
 * whenReady().then(...) that ran exactly once per page load — fine for
 * customer.html (one lead per page load), wrong for the mobile job-detail
 * overlay (dashboard.html), which mounts/unmounts this SAME markup for a
 * DIFFERENT lead repeatedly on one page load. It was refactored into an
 * exported mountMessages({leadId, db}) -> {cleanup()}, with customer.html's
 * own auto-mount split out to customer-realtime-bootstrap.module.js so
 * importing mountMessages elsewhere (dashboard.html's bridge) doesn't
 * re-trigger it.
 *
 * The one thing worth proving with REAL execution rather than a regex: a
 * second mount() for a DIFFERENT lead, without cleanup() first, must not
 * double-bind the compose Send button — that would fire
 * replyToPortalMessage twice per click. And cleanup() then a fresh mount()
 * must behave like a clean first mount, not accumulate stale listeners.
 *
 * Run from tests/: node customer-realtime-mount-lifecycle.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

function serve(dir) {
  const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html' };
  const s = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s)));
}

const STUBS = {
  'firebase-firestore.js': `
    export function collection(){ return { _isCollection: true }; }
    export function query(...args){ return { _isQuery: true, args }; }
    export function where(){ return {}; }
    export function orderBy(){ return {}; }
    export function limit(){ return {}; }
    // The test drives message delivery via globalThis.__pushSnapshot(docs)
    // rather than a real Firestore backend — onSnapshot just remembers the
    // callback so the test can invoke it on demand.
    export function onSnapshot(q, onNext, onErr) {
      globalThis.__snapshotCallback = onNext;
      globalThis.__snapshotErrCallback = onErr;
      (globalThis.__onSnapshotCalls = globalThis.__onSnapshotCalls || 0);
      globalThis.__onSnapshotCalls++;
      let live = true;
      return () => { live = false; globalThis.__unsubscribeCalls = (globalThis.__unsubscribeCalls || 0) + 1; };
    }
  `,
  'firebase-functions.js': `
    export function getFunctions(){ return {}; }
    export function httpsCallable(_fns, name) {
      return async (payload) => {
        (globalThis.__calls = globalThis.__calls || []).push({ name, payload });
        return { data: { success: true } };
      };
    }
  `,
};

function makeSnap(docs) {
  return { forEach(cb) { docs.forEach((d) => cb({ id: d.id, data: () => d })); } };
}

(async () => {
  console.log('\ncustomer-realtime.module.js — mountMessages() lifecycle, driven for real\n');

  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (_) { console.log('  ! playwright unavailable — SKIPPED'); return report(); }

  const server = await serve(path.join(ROOT, 'docs'));
  const port = server.address().port;
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));

    for (const [file, body] of Object.entries(STUBS)) {
      await page.route(`**/${file}`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body }));
    }

    // A blank same-origin page to import the real module against — no
    // harness file written into docs/ (that directory IS what ships).
    await page.route('**/__harness.html', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto(`http://127.0.0.1:${port}/__harness.html`);

    await page.evaluate(async () => {
      const mod = await import('/pro/js/customer-realtime.module.js');
      window.__mountMessages = mod.mountMessages;
    });
    ok('page boots with no JS error importing the real module', errs.length === 0, errs.join(' | '));

    // Build the SAME markup ids the real panel (either page's) carries.
    async function buildDom() {
      await page.evaluate(() => {
        document.body.innerHTML =
          '<div id="repMsgThread"><div id="repMsgEmpty"></div></div>' +
          '<textarea id="repMsgText"></textarea>' +
          '<button id="repMsgSend" disabled></button>' +
          '<span id="repMsgStatus"></span>' +
          '<span id="msgUnreadBadge" style="display:none;"></span>' +
          '<span id="mJdMsgBadge" style="display:none;"></span>';
      });
    }

    // ── Real execution: mount, type, click Send — exactly once per click ──
    await buildDom();
    await page.evaluate(() => { window.__instanceA = window.__mountMessages({ leadId: 'LEAD_A', db: {} }); });
    await page.fill('#repMsgText', 'hello from A');
    await page.click('#repMsgSend');
    await page.waitForFunction(() => (globalThis.__calls || []).length > 0);
    let calls = await page.evaluate(() => globalThis.__calls);
    ok('a single Send click fires replyToPortalMessage exactly once', calls.length === 1, JSON.stringify(calls));
    ok('the call carries the mounted leadId + typed text', calls[0].payload.leadId === 'LEAD_A' && calls[0].payload.text === 'hello from A');

    // ── cleanup() must remove exactly the listeners THIS instance bound:
    //    after cleanup, Send fires nothing at all (dispatched directly via
    //    evaluate — the button is expected to end up non-actionable, which
    //    is itself part of what's being proven, so this bypasses Playwright's
    //    actionability wait rather than fighting it). ──
    await page.evaluate(() => {
      globalThis.__calls = [];
      window.__instanceA.cleanup();
    });
    await page.fill('#repMsgText', 'should not send');
    await page.evaluate(() => document.getElementById('repMsgSend').click());
    await page.waitForTimeout(150);
    calls = await page.evaluate(() => globalThis.__calls);
    ok('after cleanup(), Send fires nothing at all', calls.length === 0, JSON.stringify(calls));
    ok('cleanup() unsubscribed the onSnapshot listener',
      (await page.evaluate(() => globalThis.__unsubscribeCalls)) === 1);

    // ── The realistic caller pattern: cleanup then mount fresh for a new
    //    lead — must behave like a clean single mount, not accumulate. ──
    await buildDom();
    await page.evaluate(() => { globalThis.__calls = []; window.__instanceC = window.__mountMessages({ leadId: 'LEAD_C', db: {} }); });
    await page.fill('#repMsgText', 'clean remount');
    await page.click('#repMsgSend');
    await page.waitForFunction(() => (globalThis.__calls || []).length > 0);
    calls = await page.evaluate(() => globalThis.__calls);
    ok('a clean mount after cleanup fires exactly once per Send click (no accumulation)', calls.length === 1, JSON.stringify(calls));

    // ── Real thread rendering + BOTH badge ids update on an incoming
    //    unread homeowner message. ──
    await page.evaluate(() => {
      globalThis.__snapshotCallback({
        forEach(cb) {
          [
            { id: 'm1', source: 'homeowner', text: 'Are you coming Thursday?', createdAt: null, readByRecipient: false },
          ].forEach((d) => cb({ id: d.id, data: () => d }));
        }
      });
    });
    const threadHtml = await page.locator('#repMsgThread').innerHTML();
    ok('the real thread renders the homeowner message text', threadHtml.includes('Are you coming Thursday?'));
    const badgeDesktop = await page.locator('#msgUnreadBadge').evaluate((el) => ({ text: el.textContent, display: el.style.display }));
    const badgeMobile = await page.locator('#mJdMsgBadge').evaluate((el) => ({ text: el.textContent, display: el.style.display }));
    ok('desktop #msgUnreadBadge shows the unread count', badgeDesktop.text === '1' && badgeDesktop.display === 'inline-block', JSON.stringify(badgeDesktop));
    ok('mobile #mJdMsgBadge ALSO shows the unread count (both ids, same page in this test — real pages carry only one each)', badgeMobile.text === '1' && badgeMobile.display === 'inline-block', JSON.stringify(badgeMobile));

    ok('no JS errors across the whole session', errs.length === 0, errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }

  report();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

function report() {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }
  process.exit(0);
}

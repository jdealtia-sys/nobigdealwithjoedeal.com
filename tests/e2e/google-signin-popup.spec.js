// @ts-check
// ─────────────────────────────────────────────────────────────────────
// GOOGLE SIGN-IN POPUP vs COOP @stranger
//
// "Continue with Google" on /pro/register never worked. Half of that was a
// console setting (the Google provider was never enabled — nothing in CI can
// see it; the Auth emulator accepts any provider). The other half is code:
// firebase.json's global Cross-Origin-Opener-Policy: same-origin severs the
// cross-origin Firebase auth popup from the page, so window.opener is null
// in the popup, the SDK sees popup.closed === true, and sign-in ends in
// auth/popup-closed-by-user. firebase.json now overrides COOP to
// same-origin-allow-popups on /pro/register only.
//
// WHY A PROXY: the Hosting emulator serves NONE of firebase.json's headers
// (measured 2026-09-18, firebase-tools 15: no CSP, no COOP, not even
// Cache-Control), so a plain emulator run cannot see this bug at all. The
// spec puts a small reverse proxy in front of the Hosting emulator that
// sets, on every response, the COOP production would send for that path —
// computed from firebase.json by tests/lib/hosting-headers.js, the same
// resolver the static contract (tests/google-signin-popup.test.js) uses.
// Delete the override and this journey fails the way production did.
//
// WHY NOT page.route/route.fulfill: tried first, and it lies. With COOP
// same-origin-allow-popups injected through route.fulfill, Chromium keeps
// window.opener in the popup but throws SecurityError when the popup reads
// its same-origin sibling (the SDK's auth iframe inside the opener), so the
// handler's frame relay fails ("No matching frame") and sign-in never
// completes. The same header sent by a real HTTP response works end to end
// on the same browser build (chromium-1234, 2026-09-18). Production's
// firebaseapp.com handler relays the same way (walks window.opener.frames
// and reads location.href), so only a real header is a faithful test.
// Only COOP is injected: CSP is bypassed for local runs anyway
// (playwright.config.js), and COOP is the header under test.
//
// The auth popup is the Auth emulator's handler on 127.0.0.1:9099 — a
// different origin from the page, exactly like prod's firebaseapp.com
// handler vs nobigdealwithjoedeal.com — so COOP applies to it the same way.
//
// Two tests:
//   1. The real journey under the effective header: popup → emulator Google
//      account → signInWithIdp 200 → createCompany → /pro/onboarding, with a
//      google.com user and a companies/{uid} doc on the server.
//   2. A NEGATIVE CONTROL under COOP same-origin (what '**' sends): the same
//      click must end on /pro/register with the closed-window copy. It
//      proves the rig can see the severance, so test 1 cannot go green just
//      because the header stopped reaching the browser.
//
// @stranger shard because createCompany needs the Functions emulator, which
// only the @stranger/@gauntlet shards boot.
// ─────────────────────────────────────────────────────────────────────

const fs = require('fs');
const http = require('http');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { installLocalSdkShim } = require('./fixtures/local-sdk');
const { effectiveHeader } = require('../lib/hosting-headers');

const BASE = process.env.PLAYWRIGHT_BASE_URL || '';
const EMULATOR_MODE = /localhost|127\.0\.0\.1/.test(BASE)
  && !!process.env.FIRESTORE_EMULATOR_HOST
  && !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

const HOSTING = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'firebase.json'), 'utf8')).hosting;
const POPUP_SAFE_COOP = ['same-origin-allow-popups', 'unsafe-none'];
const CLOSED_COPY = 'Sign-in window closed before finishing. Try again, or sign up with email.';

let _admin = null;
function admin() {
  if (_admin) return _admin;
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ projectId: 'nobigdeal-pro' });
  _admin = { auth: getAuth(), db: getFirestore() };
  return _admin;
}

/**
 * Reverse proxy in front of the Hosting emulator that adds the
 * Cross-Origin-Opener-Policy production sends for each path (or `force`).
 * @param {{ force?: string }} [opt]
 */
async function startCoopProxy(opt = {}) {
  const upstream = new URL(BASE);
  /** @type {{ pathname: string, coop: string|undefined, status: number|undefined }[]} */
  const served = [];
  let origin = '';
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://proxy.invalid').pathname;
    const up = http.request({
      host: upstream.hostname, port: upstream.port, path: req.url, method: req.method,
      headers: { ...req.headers, host: upstream.host },
    }, (ur) => {
      const headers = { ...ur.headers };
      if (headers.location) headers.location = headers.location.split(upstream.origin).join(origin);
      const coop = opt.force || effectiveHeader(HOSTING, pathname, 'Cross-Origin-Opener-Policy');
      if (/text\/html/.test(String(headers['content-type'] || ''))) served.push({ pathname, coop, status: ur.statusCode });
      res.writeHead(ur.statusCode || 502, headers);
      ur.pipe(res);
    });
    up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const addr = server.address();
  origin = `http://127.0.0.1:${addr && typeof addr === 'object' ? addr.port : 0}`;
  return {
    origin,
    served,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve(undefined)); }),
  };
}

/**
 * Open /pro/register and wait until register.js has wired #googleRegBtn.
 * The module wires the button right after its top-level
 * `await connectEmulatorsIfLocal(...)`, whose one-time console.info marks
 * that moment (a module suspended on top-level await does not hold back
 * DOMContentLoaded or load, so neither is a wiring signal). networkidle is
 * the fallback if that log line is ever reworded. A zero-delay macrotask
 * after either lets the module's continuation finish.
 * @param {import('@playwright/test').Page} page
 * @param {string} origin
 */
async function openRegisterWired(page, origin) {
  const wiredLog = page.waitForEvent('console', {
    predicate: (m) => m.text().includes('[nbd-emulator-connect] LOCAL emulator mode'),
    timeout: 30_000,
  }).catch(() => null);
  await page.goto(origin + '/pro/register');
  await Promise.race([wiredLog, page.waitForLoadState('networkidle')]);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  await expect(page.locator('#googleRegBtn')).toBeEnabled();
}

test.describe('Google sign-in popup survives the COOP firebase.json serves @stranger', () => {
  /** @type {Awaited<ReturnType<typeof startCoopProxy>> | null} */
  let proxy = null;

  test.beforeEach(async ({ context }, testInfo) => {
    if (!EMULATOR_MODE) {
      testInfo.skip(true, 'emulator mode only (auth + firestore + functions + hosting emulators)');
    }
    testInfo.setTimeout(120_000);
    await installLocalSdkShim(context); // sandbox-only; no-op in CI
  });

  test.afterEach(async () => {
    if (proxy) await proxy.close();
    proxy = null;
  });

  test('new Google user: popup completes → createCompany → onboarding, under the effective header', async ({ page, context }) => {
    proxy = await startCoopProxy();
    const idp = [];
    page.on('response', (r) => { if (/accounts:signInWithIdp/.test(r.url())) idp.push(r.status()); });

    await openRegisterWired(page, proxy.origin);
    const doc = proxy.served.find((s) => s.pathname === '/pro/register');
    expect(doc, 'the /pro/register document went through the header proxy').toBeTruthy();
    expect(POPUP_SAFE_COOP, `firebase.json must serve /pro/register a popup-safe COOP (resolved ${JSON.stringify(doc && doc.coop)})`)
      .toContain(doc && doc.coop);

    const popupP = context.waitForEvent('page', { timeout: 20_000 });
    await page.click('#googleRegBtn');
    const popup = await popupP;
    await popup.waitForLoadState('domcontentloaded');
    // Auth emulator's IdP chooser: add a fresh account, auto-fill it, sign in.
    await popup.click('#add-account-button', { timeout: 15_000 });
    await popup.click('#autogen-button', { timeout: 10_000 });
    const email = (await popup.inputValue('#email-input')).trim();
    expect(email, 'the emulator generated an account email').toMatch(/@/);
    await popup.click('#sign-in', { timeout: 10_000 });

    try {
      await page.waitForURL(/\/pro\/onboarding(\.html)?([?#]|$)/, { timeout: 45_000 });
    } catch (e) {
      const regErr = await page.locator('#regErr').textContent().catch(() => '');
      throw new Error('Google sign-in never reached onboarding'
        + (regErr ? ` — #regErr: "${regErr.trim()}"` : ' — #regErr empty')
        + ` — signInWithIdp statuses: ${JSON.stringify(idp)}`);
    }
    expect(idp, 'the opener completed the sign-in (signInWithIdp 200)').toContain(200);

    const { auth, db } = admin();
    const user = await auth.getUserByEmail(email);
    expect(user.providerData.map((p) => p.providerId), 'a google.com account was created').toContain('google.com');
    const co = await db.doc(`companies/${user.uid}`).get();
    expect(co.exists, 'createCompany provisioned companies/{uid} for the Google newcomer').toBe(true);
    expect((co.data() || {}).ownerId).toBe(user.uid);
  });

  test('negative control: under COOP same-origin the same click is severed', async ({ page, context }) => {
    proxy = await startCoopProxy({ force: 'same-origin' });
    await openRegisterWired(page, proxy.origin);
    expect((proxy.served.find((s) => s.pathname === '/pro/register') || {}).coop).toBe('same-origin');

    const popupP = context.waitForEvent('page', { timeout: 20_000 });
    await page.click('#googleRegBtn');
    const popup = await popupP;
    // The SDK sees the severed popup as closed at once and rejects ~8 s later.
    await expect(page.locator('#regErr'), 'severed popup surfaces as a closed window')
      .toHaveText(CLOSED_COPY, { timeout: 30_000 });
    expect(new URL(page.url()).pathname).toMatch(/^\/pro\/register(\.html)?$/);
    await popup.close().catch(() => {});
  });
});

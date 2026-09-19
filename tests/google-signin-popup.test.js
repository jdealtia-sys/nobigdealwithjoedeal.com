/* tests/google-signin-popup.test.js
 *
 * "Continue with Google" on /pro/register had never worked. Two independent
 * faults, and fixing either alone still leaves it broken:
 *
 *   1. The Google provider was never enabled on the Firebase project (a
 *      console setting — Jo's step, not code; nothing here can test it).
 *   2. firebase.json's global '**' rule sends Cross-Origin-Opener-Policy:
 *      same-origin. signInWithPopup opens nobigdeal-pro.firebaseapp.com's
 *      /__/auth/handler — cross-origin — so the browser puts the popup in a
 *      new browsing-context group: window.opener is null inside it, the page
 *      sees popup.closed === true at once, and the SDK rejects with
 *      auth/popup-closed-by-user ("Sign-in cancelled.") even when the
 *      provider is on. Reproduced in the emulator 2026-09-18 (COOP
 *      same-origin: severed; same-origin-allow-popups: signInWithIdp 200 →
 *      createCompany 200 → /pro/onboarding).
 *
 * This suite guards the code half, three ways:
 *
 *   A. EFFECTIVE headers, not "a block mentions COOP". Every page whose
 *      scripts can reach a popup-auth call (signInWithPopup, linkWithPopup,
 *      reauthenticateWithPopup) is DISCOVERED — docs/ JS and inline scripts
 *      are scanned, then mapped to the HTML pages that load them through
 *      <script src>, static import and literal dynamic import(). For each
 *      such page the header Firebase Hosting would actually send is computed
 *      from firebase.json (tests/lib/hosting-headers.js: last matching block
 *      wins per key, minimatch globs) and must let popups keep their opener.
 *      Every OTHER page must still get same-origin, so "fixing" this by
 *      weakening '**' fails too. A Google button added to /pro/login later
 *      is covered with no edit here.
 *      Redirect flows (signInWithRedirect) are deliberately NOT in the
 *      requirement set: they are top-level navigations, which COOP does not
 *      touch, so demanding a looser COOP for them would loosen isolation for
 *      nothing. They are reported, not asserted.
 *
 *   B. register.js runs for real in a vm (only its import lines are swapped
 *      for stubs) to prove the App Check warm-up: firebase-auth 10.12.2
 *      awaits an App Check token between the click and window.open (checked
 *      in the gstatic build: _openPopup → _getRedirectUrl →
 *      `await auth._getAppCheckToken()` → _open → window.open). Cold, that is
 *      IndexedDB + reCAPTCHA Enterprise + an exchange round trip inside the
 *      click, which spends the user activation and gets the popup blocked on
 *      Safari/iOS. The page now fetches the token at load and holds the
 *      button until it lands (or a short timeout).
 *
 *   C. The same vm harness clicks the button with signInWithPopup rejecting
 *      each error code and reads #regErr, so the new copy is proven through
 *      the real catch block, not by grepping for strings.
 *
 * The runtime half — the popup really completes with the header this file
 * computes — is tests/e2e/google-signin-popup.spec.js (@stranger shard).
 *
 * Zero deps. Run: node tests/google-signin-popup.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { effectiveHeaders, canonicalPagePath } = require('./lib/hosting-headers');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
// Normalise EOLs: CRLF working tree on Windows, LF in the index and on CI.
const read = (abs) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
const FIREBASE = JSON.parse(read(path.join(ROOT, 'firebase.json')));
const HOSTING = FIREBASE.hosting;

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}
function group(name) { console.log('\n' + name); }

/* ══════════════════════════════════════════════════════════════════
   Discovery: which pages can run a popup-auth call?
   ══════════════════════════════════════════════════════════════════ */
const POPUP_CALL_RE = /\b(?:signInWithPopup|linkWithPopup|reauthenticateWithPopup)\s*\(/;
const REDIRECT_CALL_RE = /\b(?:signInWithRedirect|linkWithRedirect|reauthenticateWithRedirect)\s*\(/;
const COOP_ALLOWS_POPUPS = ['same-origin-allow-popups', 'unsafe-none'];
const COOP_DEFAULT = 'same-origin';

/** Map<relFromDocs, content> of every .html / .js / .mjs under a docs root. */
function loadDocsTree(dir) {
  const files = new Map();
  (function walk(abs, rel) {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), r);
      else if (/\.(html|m?js)$/.test(e.name)) files.set(r, read(path.join(abs, e.name)));
    }
  })(dir, '');
  return files;
}

// Resolve a script reference the way the browser would, from the URL path of
// the document/module that holds it, to a docs-relative file (or null when it
// is external, bare, or points at nothing we serve). An HTML src is an
// ordinary relative URL ('js/x.js' is fine); an ES import specifier must start
// with './', '../' or '/' — anything else is bare and the browser refuses it.
function resolveRef(spec, fromUrlPath, files, { moduleSpecifier = false } = {}) {
  if (!spec || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(spec)) return null; // http(s):, data:, //cdn
  if (moduleSpecifier && !/^(?:\.{1,2}\/|\/)/.test(spec)) return null;
  let p;
  try { p = decodeURIComponent(new URL(spec, 'https://site.invalid' + fromUrlPath).pathname); } catch (_) { return null; }
  const rel = p.replace(/^\/+/, '');
  return files.has(rel) ? rel : null;
}

const IMPORT_RES = [
  /\bimport\s+(?:[\w$*{}\s,]+?\s+from\s+)?["']([^"'\n]+)["']/g, // import x from '…' / import '…'
  /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+["']([^"'\n]+)["']/g,
  /\bimport\s*\(\s*["'`]([^"'`$\n]+)["'`]\s*\)/g, // literal dynamic import()
];
function moduleRefs(src) {
  const out = [];
  for (const re of IMPORT_RES) for (const m of src.matchAll(re)) out.push(m[1]);
  return out;
}

const SCRIPT_TAG_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/**
 * @param {Map<string,string>} files docs-relative path → content
 * @returns {{ popupPages: Map<string, string[]>, redirectPages: Map<string, string[]>,
 *             popupFiles: string[], orphans: string[], pageCount: number, allPages: string[] }}
 *   popupPages maps a page's canonical URL to the file(s) that carry the call.
 */
function discover(files) {
  const reachCache = new Map();
  // Every docs file reachable from a JS file via static/dynamic imports.
  function reach(rel, seen = new Set()) {
    if (seen.has(rel)) return seen;
    seen.add(rel);
    const src = files.get(rel) || '';
    const fromUrl = '/' + rel;
    for (const spec of moduleRefs(src)) {
      const dep = resolveRef(spec, fromUrl, files, { moduleSpecifier: true });
      if (dep && /\.m?js$/.test(dep)) reach(dep, seen);
    }
    return seen;
  }
  function reachable(rel) {
    if (!reachCache.has(rel)) reachCache.set(rel, reach(rel));
    return reachCache.get(rel);
  }

  const popupPages = new Map();
  const redirectPages = new Map();
  const loadedAnywhere = new Set();
  const allPages = [];
  for (const [rel, raw] of files) {
    if (!rel.endsWith('.html')) continue;
    const page = canonicalPagePath(rel, { cleanUrls: true, trailingSlash: false });
    allPages.push(page);
    const html = raw.replace(/<!--[\s\S]*?-->/g, ''); // a commented-out tag loads nothing
    const carriers = { popup: [], redirect: [] };
    const note = (label, src) => {
      if (POPUP_CALL_RE.test(src)) carriers.popup.push(label);
      if (REDIRECT_CALL_RE.test(src)) carriers.redirect.push(label);
    };
    for (const m of html.matchAll(SCRIPT_TAG_RE)) {
      const attrs = m[1];
      const sm = SRC_ATTR_RE.exec(attrs);
      if (sm) {
        const target = resolveRef(sm[1] ?? sm[2] ?? sm[3], page, files);
        if (!target) continue;
        for (const dep of reachable(target)) {
          loadedAnywhere.add(dep);
          note(dep, files.get(dep));
        }
      } else {
        // Inline script body: may call directly, or import modules itself.
        const body = m[2];
        note(rel + ' (inline <script>)', body);
        for (const spec of moduleRefs(body)) {
          const dep = resolveRef(spec, page, files, { moduleSpecifier: true });
          if (!dep) continue;
          for (const d of reachable(dep)) { loadedAnywhere.add(d); note(d, files.get(d)); }
        }
      }
    }
    if (carriers.popup.length) popupPages.set(page, [...new Set(carriers.popup)]);
    if (carriers.redirect.length) redirectPages.set(page, [...new Set(carriers.redirect)]);
  }
  const popupFiles = [...files].filter(([rel, src]) => /\.m?js$/.test(rel) && POPUP_CALL_RE.test(src)).map(([rel]) => rel);
  const orphans = popupFiles.filter((rel) => !loadedAnywhere.has(rel));
  return { popupPages, redirectPages, popupFiles, orphans, pageCount: allPages.length, allPages };
}

const coopOf = (hosting, page) => {
  const hit = effectiveHeaders(hosting, page).get('cross-origin-opener-policy');
  return hit ? hit : { value: undefined, ruleIndex: -1, source: '(none)' };
};

/* ══════════════════════════════════════════════════════════════════
   A0. The instruments work (synthetic inputs — no repo state)
   ══════════════════════════════════════════════════════════════════ */
group('A0. Discovery + effective-header instruments, on synthetic inputs');
{
  const fake = new Map(Object.entries({
    'pro/login.html': '<script type="module" src="js/pages/login.js"></script>',
    'pro/js/pages/login.js': "import { go } from '../auth/google.js';\ngo();",
    'pro/js/auth/google.js': 'export function go(a, p) { return signInWithPopup(a, p); }',
    // Named in an import list but never CALLED — not a popup page.
    'pro/quiet.html': '<script type="module" src="/pro/js/quiet.js"></script>',
    'pro/js/quiet.js': 'import { signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";',
    // A commented-out tag loads nothing.
    'index.html': '<!-- <script src="/pro/js/auth/google.js"></script> -->',
    // Compat-API call in an inline script, odd spacing.
    'pro/inline.html': '<script>auth.signInWithPopup (provider);</script>',
    // Redirect only: reported, not a popup page.
    'pro/redir.html': '<script src="/pro/js/redir.js" defer></script>',
    'pro/js/redir.js': 'signInWithRedirect(auth, p);',
    // Loaded by nothing we can trace — must surface as an orphan.
    'pro/js/lazy/popup-lazy.js': 'reauthenticateWithPopup(user, p);',
    // Directory index served at /pro (no trailing slash): 'js/x.js' resolves to /js/x.js.
    'pro/index.html': '<script src="js/pages/login.js"></script>',
    // A bare import specifier never loads in a browser (no import map here).
    'pro/bare.html': '<script type="module" src="/pro/js/bare.js"></script>',
    'pro/js/bare.js': "import { go } from 'pro/js/auth/google.js';\ngo();",
  }));
  const d = discover(fake);
  assert('a call two imports deep marks the page that loads the entry script',
    d.popupPages.has('/pro/login') && d.popupPages.get('/pro/login').includes('pro/js/auth/google.js'),
    JSON.stringify([...d.popupPages]));
  assert('an import-only mention (no call) does not', !d.popupPages.has('/pro/quiet'));
  assert('a commented-out <script> does not', !d.popupPages.has('/'));
  assert('an inline compat-API call does', d.popupPages.has('/pro/inline'));
  assert('a redirect-only page is reported separately, not as a popup page',
    d.redirectPages.has('/pro/redir') && !d.popupPages.has('/pro/redir'));
  assert('a popup file no page loads is an orphan', d.orphans.includes('pro/js/lazy/popup-lazy.js'),
    JSON.stringify(d.orphans));
  assert('relative srcs resolve like the browser (/pro index → /js/…, which is not served)',
    !d.popupPages.has('/pro'));
  assert('a bare import specifier is not followed (the browser refuses it)', !d.popupPages.has('/pro/bare'));

  const hosting = (blocks) => ({ cleanUrls: true, trailingSlash: false, headers: blocks });
  const G = { source: '**', headers: [{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }] };
  const O = { source: '/pro/login', headers: [{ key: 'cross-origin-opener-policy', value: 'same-origin-allow-popups' }] };
  assert('a later matching block wins (key compared case-insensitively)',
    coopOf(hosting([G, O]), '/pro/login').value === 'same-origin-allow-popups');
  assert('an override placed BEFORE "**" is overwritten by it',
    coopOf(hosting([O, G]), '/pro/login').value === 'same-origin');
  assert('the override does not leak to a neighbour path',
    coopOf(hosting([G, O]), '/pro/dashboard').value === 'same-origin');
  assert('a ".html" source never matches the served (clean) URL',
    coopOf(hosting([G, { ...O, source: '/pro/login.html' }]), '/pro/login').value === 'same-origin');
  assert('canonicalPagePath: register.html → /pro/register, pro/index.html → /pro, index.html → /',
    canonicalPagePath('pro/register.html', hosting([])) === '/pro/register'
    && canonicalPagePath('pro/index.html', hosting([])) === '/pro'
    && canonicalPagePath('index.html', hosting([])) === '/');
}

/* ══════════════════════════════════════════════════════════════════
   A. The real site: popup pages get a popup-safe COOP, nothing else does
   ══════════════════════════════════════════════════════════════════ */
const tree = loadDocsTree(DOCS);
const found = discover(tree);

group('A1. Discovery over docs/');
assert(`docs/ scanned (${found.pageCount} pages, ${tree.size} html/js files)`, found.pageCount >= 100 && tree.size >= 300,
  'the scan found too little — is DOCS pointing at the hosting root?');
assert('at least one popup-auth call exists in docs/ JS', found.popupFiles.length > 0,
  'if Google sign-in was removed on purpose, delete this suite with it');
assert('discovery attributes docs/pro/js/pages/register.js to /pro/register (the page this override was written for)',
  (found.popupPages.get('/pro/register') || []).includes('pro/js/pages/register.js'),
  'got ' + JSON.stringify([...found.popupPages]));
assert('every JS file with a popup-auth call is loaded by a page discovery can see',
  found.orphans.length === 0,
  'unattributed: ' + found.orphans.join(', ') + ' — it is loaded some way this suite cannot trace '
  + '(ScriptLoader, injected <script>, computed import()). Teach discover() that loader, or its '
  + 'page ships with COOP same-origin and the popup is severed.');
console.log('    popup pages: ' + [...found.popupPages.keys()].join(', '));
console.log('    redirect-flow pages (COOP-insensitive, not asserted): '
  + ([...found.redirectPages.keys()].join(', ') || 'none'));

group('A2. Every popup page is served a COOP that lets its popup keep window.opener');
for (const [page, carriers] of found.popupPages) {
  const c = coopOf(HOSTING, page);
  assert(`${page}: Cross-Origin-Opener-Policy is ${JSON.stringify(c.value)} (block #${c.ruleIndex} "${c.source}")`,
    COOP_ALLOWS_POPUPS.includes(c.value),
    `calls a popup-auth API via ${carriers.join(', ')}; under ${JSON.stringify(c.value)} the Firebase `
    + 'auth popup is severed from the page and sign-in ends in auth/popup-closed-by-user. Add '
    + '{ "key": "Cross-Origin-Opener-Policy", "value": "same-origin-allow-popups" } to a firebase.json '
    + `header block whose source is exactly "${page}" and that sits AFTER the "**" block.`);
}

group('A3. The rest of the site keeps COOP same-origin');
{
  const globalRule = HOSTING.headers.find((r) => r.source === '**');
  const g = globalRule && (globalRule.headers || []).find((h) => /^cross-origin-opener-policy$/i.test(h.key));
  assert('the global "**" block still sets Cross-Origin-Opener-Policy: same-origin',
    !!g && g.value === COOP_DEFAULT,
    'got ' + JSON.stringify(g && g.value) + ' — relaxing the global default to un-break one page '
    + 'strips cross-origin isolation from every page');

  for (const page of ['/pro/login', '/pro/dashboard', '/pro/customer', '/pro', '/', '/admin/login']) {
    if (found.popupPages.has(page)) continue;
    const c = coopOf(HOSTING, page);
    assert(`${page}: Cross-Origin-Opener-Policy is same-origin`, c.value === COOP_DEFAULT,
      `got ${JSON.stringify(c.value)} from block #${c.ruleIndex} "${c.source}"`);
  }

  const others = found.allPages.filter((p) => !found.popupPages.has(p));
  const loosened = others
    .map((p) => ({ p, c: coopOf(HOSTING, p) }))
    .filter(({ c }) => c.value !== COOP_DEFAULT);
  assert(`all ${others.length} non-popup pages resolve to same-origin`,
    others.length >= 100 && loosened.length === 0,
    loosened.slice(0, 8).map(({ p, c }) => `${p} → ${JSON.stringify(c.value)} (block #${c.ruleIndex} "${c.source}")`).join('; ')
    + ' — the popup override must stay on the popup pages only');
}

/* ══════════════════════════════════════════════════════════════════
   B + C. register.js, executed for real in a vm
   ══════════════════════════════════════════════════════════════════ */
const REGISTER_REL = 'docs/pro/js/pages/register.js';
const REGISTER_SRC = read(path.join(ROOT, REGISTER_REL));

// Swap each `import { a, b as c } from "spec";` for a destructure from stubs.
// Any other import shape throws, so a refactor cannot quietly bypass the harness.
function toScript(src) {
  const IMPORT_RE = /^\s*import\s*\{([^}]*)\}\s*from\s*(["'])([^"']+)\2\s*;?/gm;
  let body = src.replace(IMPORT_RE, (_, names, _q, spec) => {
    const binds = names.split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => s.replace(/^([\w$]+)\s+as\s+([\w$]+)$/, '$1: $2'));
    return `const { ${binds.join(', ')} } = __imports(${JSON.stringify(spec)});`;
  });
  if (/^\s*import[\s{*]/m.test(body)) throw new Error('register.js has an import shape the harness does not understand');
  return `(async () => {\n${body}\n})()`;
}

function strictModule(spec, obj) {
  return new Proxy(obj, {
    get(t, k) {
      if (typeof k === 'symbol' || k === 'then') return t[k];
      if (!(k in t)) throw new Error(`harness: ${spec} has no stub for "${String(k)}"`);
      return t[k];
    },
  });
}

function makeEl(id) {
  return {
    id, value: '', textContent: '', style: {}, disabled: false, _attrs: {}, _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    removeAttribute(k) { delete this._attrs[k]; },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

/**
 * Evaluate register.js with stubbed SDKs.
 * @param {{ emulator?: boolean, key?: string|undefined, warm?: 'pending'|'resolve'|'reject', popupError?: object }} opt
 */
async function runRegister(opt = {}) {
  const calls = [];
  const timers = [];
  const warns = [];
  let settleWarm;
  const APPCHECK = { __appCheck: true };
  const warmPromise = opt.warm === 'reject'
    ? Promise.reject(Object.assign(new Error('recaptcha blocked'), { code: 'appCheck/recaptcha-error' }))
    : new Promise((res) => { settleWarm = res; if (opt.warm === 'resolve') res({ token: 't' }); });
  const els = {};
  for (const id of ['regPlanBanner', 'regForm', 'googleRegBtn', 'regCode', 'regPass', 'regErr', 'regOk',
    'regFirst', 'regLast', 'regCompany', 'regEmail', 'regConfirm', 'regBtn', 'strengthBar']) els[id] = makeEl(id);

  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const stubs = {
    [SDK + 'firebase-app.js']: { initializeApp: () => { calls.push('initializeApp'); return { name: '[DEFAULT]' }; } },
    [SDK + 'firebase-app-check.js']: {
      initializeAppCheck: (app, o) => { calls.push('initializeAppCheck'); return APPCHECK; },
      ReCaptchaEnterpriseProvider: class { constructor(k) { this.key = k; } },
      getToken: (instance, forceRefresh) => { calls.push({ getToken: instance === APPCHECK, forceRefresh }); return warmPromise; },
    },
    [SDK + 'firebase-auth.js']: {
      getAuth: () => { calls.push('getAuth'); return { currentUser: null }; },
      createUserWithEmailAndPassword: async () => { throw new Error('not in this harness'); },
      updateProfile: async () => {},
      GoogleAuthProvider: class {},
      signInWithPopup: async () => {
        calls.push('signInWithPopup');
        if (opt.popupError) throw opt.popupError;
        throw new Error('harness: success path not modelled');
      },
      signInWithCustomToken: async () => {},
      sendEmailVerification: async () => {},
    },
    [SDK + 'firebase-firestore.js']: {
      getFirestore: () => ({}), doc: () => ({}), setDoc: async () => {}, getDoc: async () => ({ exists: () => true }),
      serverTimestamp: () => 'ts',
    },
    [SDK + 'firebase-functions.js']: { getFunctions: () => ({}), httpsCallable: () => async () => ({ data: {} }) },
    '../nbd-emulator-connect.js': {
      connectEmulatorsIfLocal: async () => !!opt.emulator,
      emulatorAppCheckIfLocal: async () => !!opt.emulator,
    },
    '../provisioning-retry.js': { ensureProvisioned: async () => {} },
  };
  const window = {
    location: { search: '', href: '', replace() {} },
    ...(opt.key === undefined ? {} : { __NBD_APP_CHECK_KEY: opt.key }),
  };
  const ctx = vm.createContext({
    __imports: (spec) => {
      if (!stubs[spec]) throw new Error('harness: register.js imports an unstubbed module: ' + spec);
      return strictModule(spec, stubs[spec]);
    },
    window,
    document: {
      readyState: 'complete',
      getElementById: (id) => els[id] || null,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    sessionStorage: { getItem: () => null, setItem() {} },
    URLSearchParams,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    console: { warn: (...a) => warns.push(a), log() {}, info() {}, error() {} },
  });
  await vm.runInContext(toScript(REGISTER_SRC), ctx, { filename: REGISTER_REL });
  await flush();
  return {
    els, calls, timers, warns,
    settleWarm: () => settleWarm && settleWarm({ token: 't' }),
    async click() {
      const fns = els.googleRegBtn._listeners.click || [];
      for (const fn of fns) await fn({ preventDefault() {} });
      await flush();
    },
  };
}

async function partB() {
  group('B. App Check token is warmed at load; the Google button waits for it');

  const cold = await runRegister({ key: 'site-key', warm: 'pending' });
  const tokenCalls = cold.calls.filter((c) => c && typeof c === 'object' && 'getToken' in c);
  assert('production path calls App Check getToken() at load, on the instance initializeAppCheck returned',
    tokenCalls.length === 1 && tokenCalls[0].getToken === true && !tokenCalls[0].forceRefresh,
    'calls: ' + JSON.stringify(cold.calls));
  assert('…and App Check is still initialised before getAuth (C-4 ordering)',
    cold.calls.indexOf('initializeAppCheck') > -1
    && cold.calls.indexOf('initializeAppCheck') < cold.calls.indexOf('getAuth'),
    'calls: ' + JSON.stringify(cold.calls));
  const btn = cold.els.googleRegBtn;
  assert('the Google button has its click handler', (btn._listeners.click || []).length === 1);
  assert('while the token is in flight the button is disabled and aria-busy',
    btn.disabled === true && btn.getAttribute('aria-busy') === 'true');
  const hold = cold.timers.find((t) => t.ms >= 1000 && t.ms <= 5000);
  assert('a short (1–5 s) fallback timer is armed so the button can never stay dead',
    !!hold, 'timers: ' + JSON.stringify(cold.timers.map((t) => t.ms)));
  cold.settleWarm();
  await flush();
  assert('the token landing re-enables the button and clears aria-busy',
    btn.disabled === false && btn.getAttribute('aria-busy') === null);

  const stuck = await runRegister({ key: 'site-key', warm: 'pending' });
  const stuckHold = stuck.timers.find((t) => t.ms >= 1000 && t.ms <= 5000);
  if (stuckHold) stuckHold.fn();
  await flush();
  assert('a token that never arrives still releases the button when the timer fires',
    stuck.els.googleRegBtn.disabled === false && stuck.els.googleRegBtn.getAttribute('aria-busy') === null);

  const failing = await runRegister({ key: 'site-key', warm: 'reject' });
  assert('a failed token fetch (reCAPTCHA blocked) releases the button at once — no unhandled rejection',
    failing.els.googleRegBtn.disabled === false);

  const emu = await runRegister({ emulator: true, key: 'site-key', warm: 'pending' });
  assert('emulator path: no production getToken, button never held',
    !emu.calls.some((c) => c && typeof c === 'object' && 'getToken' in c)
    && emu.els.googleRegBtn.disabled === false && emu.timers.length === 0);

  const nokey = await runRegister({ key: undefined, warm: 'pending' });
  assert('no App Check key: nothing awaited before window.open, so the button is not held',
    !nokey.calls.includes('initializeAppCheck') && nokey.els.googleRegBtn.disabled === false);
}

async function partC() {
  group('C. #regErr copy for each Google sign-in failure (through the real catch block)');
  const cases = [
    ['auth/operation-not-allowed', "Google sign-in isn't available yet — please sign up with email."],
    ['auth/popup-closed-by-user', 'Sign-in window closed before finishing. Try again, or sign up with email.'],
    ['auth/popup-blocked', 'Your browser blocked the Google window — allow pop-ups for this site or sign up with email.'],
    ['auth/account-exists-with-different-credential', null],
    ['auth/cancelled-popup-request', ''],
    ['auth/internal-error', null],
    [undefined, null],
  ];
  for (const [code, expected] of cases) {
    const err = Object.assign(new Error(`Firebase: Error (${code || 'unknown'}).`), code ? { code } : {});
    const h = await runRegister({ emulator: true, popupError: err });
    h.els.regErr.textContent = 'stale text from an earlier attempt';
    await h.click();
    const got = h.els.regErr.textContent;
    const label = code || '(no code)';
    assert(`${label}: signInWithPopup was actually reached by the click`, h.calls.includes('signInWithPopup'));
    if (expected !== null) {
      assert(`${label} → ${JSON.stringify(expected)}`, got === expected, 'got ' + JSON.stringify(got));
    } else if (code === 'auth/account-exists-with-different-credential') {
      assert(`${label} → tells them to log in with email + password`,
        /already has an account/i.test(got) && /log in with your email and password/i.test(got),
        'got ' + JSON.stringify(got));
    } else {
      assert(`${label} → a fallback that points at email signup`,
        /try again, or sign up with email\.$/i.test(got)
        && (code ? got.includes('(' + code + ')') : /^Google sign-in failed\. /.test(got)),
        'got ' + JSON.stringify(got));
    }
    assert(`${label}: no raw Firebase text and no old "Sign-in cancelled." copy`,
      !/Firebase:|Sign-in cancelled\./.test(got), 'got ' + JSON.stringify(got));
  }
}

// A rejection that escapes register.js (e.g. a warm-up with no rejection
// handler) is a page-console error in the browser; here it must be a named
// failure, not an anonymous process crash.
process.on('unhandledRejection', (e) => {
  failed++;
  console.log('  ✗ a promise rejection escaped register.js unhandled: ' + ((e && e.message) || e));
});

(async () => {
  try {
    await partB();
    await partC();
  } catch (e) {
    failed++;
    console.log('  ✗ register.js harness crashed: ' + (e && e.stack || e));
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

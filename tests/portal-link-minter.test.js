/**
 * tests/portal-link-minter.test.js — PortalLinkHelpers must resolve a portal
 * URL on EVERY page it ships to, not just customer.html.
 *
 * The bug this pins:
 *
 * Two minters exist, one per page family, with an identical contract
 * (async, takes a leadId, returns a fresh token URL, throws on failure):
 *
 *   customer.html            → window.CustomerPortal.mintUrl  (customer-portal.js)
 *   dashboard(.legacy).html  → window._mintPortalUrl          (dashboard-api.js)
 *
 * portal-link-helpers.js is loaded on BOTH families, but resolveUrl required
 * CustomerPortal — and customer-portal.js is loaded on customer.html ONLY. So
 * every portal affordance on both dashboards threw 'Portal module not loaded'
 * and surfaced an error toast. Ten modules reached it: the kanban context menu,
 * activity feed, global search, notification bell, the hot-leads /
 * almost-there / stale-shares widgets, smart-followup, its briefing, and the
 * dashboard bootstrap.
 *
 * Part 1 drives the REAL portal-link-helpers.js in a fake-DOM sandbox under
 * each page shape. Part 2 pins the page wiring both minters depend on, since a
 * behavioural pass means nothing if the script tags stop shipping.
 *
 * Zero deps.  Run: node tests/portal-link-minter.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PLH_PATH = path.join(ROOT, 'docs/pro/js/portal-link-helpers.js');
const PLH = fs.readFileSync(PLH_PATH, 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('PORTAL LINK MINTER — resolves on every page it ships to');

// ── Part 1: behaviour under each page shape ──────────────────────────
// Minimal fake DOM — resolveUrl itself touches none of it, but the module
// body references document/navigator at load time.
function loadHelpers(windowExtras) {
  const win = Object.assign({
    showToast() {},
    _leads: [],
    navigator: {},
    document: {
      createElement: () => ({ style: {}, setAttribute() {}, focus() {}, select() {} }),
      body: { appendChild() {}, removeChild() {} },
      execCommand: () => false,
    },
    location: { origin: 'https://example.test' },
  }, windowExtras);
  win.window = win;
  vm.runInContext(PLH, vm.createContext(win));
  return win;
}

async function resolve(windowExtras, leadId) {
  const win = loadHelpers(windowExtras);
  try {
    return 'OK:' + (await win.PortalLinkHelpers.resolveUrl(leadId));
  } catch (e) {
    return 'THROW:' + e.message;
  }
}

const CP = { mintUrl: async (id) => 'https://example.test/pro/portal.html?token=CP-' + id };
const DA = async (id) => 'https://example.test/pro/portal.html?token=DA-' + id;

(async () => {
  ok('customer.html shape (CustomerPortal) resolves',
    (await resolve({ CustomerPortal: CP }, 'lead1'))
      === 'OK:https://example.test/pro/portal.html?token=CP-lead1');

  // The regression itself: this shape threw 'Portal module not loaded'.
  ok('dashboard shape (_mintPortalUrl only) resolves',
    (await resolve({ _mintPortalUrl: DA }, 'lead1'))
      === 'OK:https://example.test/pro/portal.html?token=DA-lead1',
    'the dashboard minter must be accepted, or every portal control there dies');

  // customer.html loads both dashboard-api.js? No — but pin the precedence
  // anyway so the page-native minter always wins if that ever changes.
  ok('CustomerPortal wins when both are present',
    (await resolve({ CustomerPortal: { mintUrl: async (id) => 'CP-' + id }, _mintPortalUrl: async (id) => 'DA-' + id }, 'lead1'))
      === 'OK:CP-lead1');

  // The fallback must not become a silent success path.
  ok('still throws when NO minter is present',
    (await resolve({}, 'lead1')) === 'THROW:Portal module not loaded');

  ok('still rejects a missing leadId',
    (await resolve({ _mintPortalUrl: DA }, '')) === 'THROW:leadId required');

  // ── Part 2: the page wiring both minters depend on ─────────────────
  // A green Part 1 proves the resolution logic; it cannot notice that a
  // <script> tag stopped shipping, which is exactly how this broke.
  const dash = fs.readFileSync(path.join(ROOT, 'docs/pro/dashboard.html'), 'utf8');
  const customer = fs.readFileSync(path.join(ROOT, 'docs/pro/customer.html'), 'utf8');

  for (const [name, html] of [['dashboard.html', dash]]) {
    ok(`${name} loads portal-link-helpers.js`, html.includes('portal-link-helpers.js'));
    // dashboard-api.js is where _mintPortalUrl lives — the ONLY minter on
    // these pages, since customer-portal.js never ships here.
    ok(`${name} loads dashboard-api.js (defines _mintPortalUrl)`, html.includes('dashboard-api.js'));
  }
  ok('customer.html loads customer-portal.js (defines CustomerPortal)',
    customer.includes('customer-portal.js'));

  ok('_mintPortalUrl is still defined on the dashboard API surface',
    /window\._mintPortalUrl\s*=/.test(fs.readFileSync(path.join(ROOT, 'docs/pro/js/dashboard-api.js'), 'utf8')));

  // Order-independence is a property worth pinning: the minter is resolved
  // when resolveUrl RUNS, not when the module loads, so a future script-tag
  // reshuffle can't reintroduce the failure.
  ok('minter is resolved at call time, not captured at module load',
    /function _minter\(\)/.test(PLH) && !/const\s+_mint\s*=\s*window\./.test(PLH));

  console.log('\n──────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})();

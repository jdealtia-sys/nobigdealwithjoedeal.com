/**
 * sweep-regression.test.js — locks in the high-value bug fixes from the
 * 2026-06-25/26 surface sweeps (Vault #776, Close Board #777, Storm Center
 * #778/#779, Academy #780) so a silent revert is caught by CI.
 *
 * Two kinds of check:
 *   - BEHAVIORAL: load the real engine into a vm + fake-DOM sandbox and assert
 *     the runtime result (catches logic regressions, not just text edits).
 *   - STATIC GUARD: assert the fixed pattern is present / the buggy one absent
 *     (cheap revert tripwire, matching the smoke-suite idiom).
 *
 * Run via: node tests/sweep-regression.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const D = (...p) => path.join(__dirname, '..', 'docs', 'pro', 'js', ...p);
const read = (f) => fs.readFileSync(D(f), 'utf8');

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

// ── shared fake-DOM + localStorage sandbox ────────────────────────────────
function makeSandbox(extra) {
  const store = new Map();
  const makeEl = () => ({
    _html: '', value: '',
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    textContent: '', style: new Proxy({}, { get: () => '', set: () => true }),
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    dataset: {}, onclick: null, querySelector: () => null, querySelectorAll: () => [],
    appendChild: (c) => c, addEventListener() {}, removeChild() {}, closest: () => null,
    scrollIntoView() {}, select() {}, focus() {}, remove() {}, getAttribute: () => null, setAttribute() {},
  });
  const getById = (id) => { if (!store.has(id)) store.set(id, makeEl()); return store.get(id); };
  const LS = {};
  const localStorage = { getItem: (k) => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); }, removeItem: (k) => { delete LS[k]; } };
  const sandbox = Object.assign({
    console: { log() {}, warn() {}, error() {} }, JSON, Math, Date, Number, String, Array, Object, RegExp, Boolean, Error, isNaN, parseFloat, parseInt,
    setTimeout: () => 0, clearTimeout: () => {}, localStorage,
    document: { getElementById: getById, querySelector: () => null, querySelectorAll: () => [], createElement: makeEl, addEventListener() {}, body: makeEl() },
    navigator: {}, fetch: async () => ({ ok: true, json: async () => ({ features: [] }) }),
  }, extra || {});
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.window.showToast = () => {};
  sandbox.window.goTo = () => {};
  const ctx = vm.createContext(sandbox);
  return { ctx, sandbox, getById, LS };
}

console.log('\nClose Board — Closed Value reads the accepted tier/price (#777)');
(() => {
  const { ctx, sandbox, getById, LS } = makeSandbox({});
  sandbox.window._db = null; sandbox.window._user = null;
  vm.runInContext(read('close-board.js'), ctx, { filename: 'close-board.js' });
  const CB = ctx.window.CloseBoard;
  const tiers = { good: { price: 8000 }, better: { price: 11000 }, best: { price: 15000 } };
  LS['nbd_deal_rooms'] = JSON.stringify([{ id: 'd1', status: 'accepted', acceptedTier: 'best', acceptedPrice: 15000, customerName: 'T', tiers, createdAt: '2026-06-20T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' }]);
  CB.init();
  const html = getById('view-closeboard').innerHTML;
  ok('Closed Value uses the accepted $15,000.00, not the better-tier $11,000.00', html.includes('15,000.00') && !html.includes('11,000.00'));
})();

console.log('\nStorm Center — pushZoneToD2D writes a renderable geoJSON territory (#778)');
(() => {
  let captured = null;
  const { ctx, sandbox, LS } = makeSandbox({});
  sandbox.window._db = {}; sandbox.window._user = { uid: 'u1' }; sandbox.window._userClaims = { companyId: 'c1' };
  sandbox.window.addDoc = (col, doc) => { captured = doc; return Promise.resolve({ id: 'x' }); };
  sandbox.window.collection = (db, name) => name;
  sandbox.window.serverTimestamp = () => 'ts';
  vm.runInContext(read('storm-center.js'), ctx, { filename: 'storm-center.js' });
  const SC = ctx.window.StormCenter;
  const POLY = [[39.10, -84.52], [39.20, -84.52], [39.20, -84.40], [39.10, -84.40]]; // [lat,lng]
  LS['nbd_storm_zones'] = JSON.stringify([{ id: 'sz_1', name: 'Hail', status: 'active', knockCount: 0, leadCount: 0, estimatedRoofs: 100, damageProb: 0.6, polygon: POLY, center: [39.15, -84.46], createdAt: '2026-06-25T00:00:00Z' }]);
  SC.init();
  SC.pushToD2D('sz_1');
  ok('territory carries a geoJSON Polygon Feature (D2D renders only geoJSON)', !!(captured && captured.geoJSON && captured.geoJSON.geometry.type === 'Polygon'));
  ok('ring is [lng,lat] order (first pt = [-84.52, 39.10])', !!(captured && captured.geoJSON.geometry.coordinates[0][0][0] === -84.52));
  ok('no legacy polygon field + carries stormZoneId', !!(captured && captured.polygon === undefined && captured.stormZoneId === 'sz_1'));
})();

console.log('\nStorm Center — D2D knock attributes back to the storm zone (#779)');
(() => {
  const { ctx, sandbox, LS } = makeSandbox({});
  sandbox.window._db = {}; sandbox.window._user = { uid: 'u1' };
  sandbox.window.addDoc = () => Promise.resolve({ id: 'x' }); sandbox.window.collection = () => 'c'; sandbox.window.serverTimestamp = () => 'ts';
  sandbox.state = { territories: [] };
  vm.runInContext(read('storm-center.js'), ctx, { filename: 'storm-center.js' });
  // Extract the real pointInRing + attributeKnockToStormZone from d2d-core.
  const d2d = fs.readFileSync(path.join(__dirname, '..', 'docs', 'pro', 'js', 'd2d-tracker-core-2026b.js'), 'utf8');
  const s = d2d.indexOf('// Ray-casting point-in-polygon');
  const e = d2d.indexOf('// When a rep arrives here from a Storm Center');
  ok('d2d-core still defines the pointInRing + attribution helpers', s >= 0 && e > s);
  if (s >= 0 && e > s) {
    vm.runInContext(d2d.slice(s, e), ctx, { filename: 'd2d-helpers.js' });
    const RING = [[39.10, -84.52], [39.20, -84.52], [39.20, -84.40], [39.10, -84.40]].map((p) => [p[1], p[0]]);
    sandbox.state.territories = [{ stormZoneId: 'sz_1', geoJSON: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [RING] } } }];
    LS['nbd_storm_zones'] = JSON.stringify([{ id: 'sz_1', knockCount: 0, leadCount: 0 }]);
    ctx.attributeKnockToStormZone(39.15, -84.46, true);  // inside, hot disposition
    const z = JSON.parse(LS['nbd_storm_zones'])[0];
    ok('a knock inside the zone bumps knockCount + leadCount', z.knockCount === 1 && z.leadCount === 1);
    ctx.attributeKnockToStormZone(40.50, -85.50, false); // outside
    ok('a knock outside the zone changes nothing', JSON.parse(LS['nbd_storm_zones'])[0].knockCount === 1);
  }
})();

console.log('\nStatic guards against revert');
ok('Vault: no raw CODEX.decisions (canonical architecturalDecisions) (#776)', !/CODEX\.decisions/.test(read('vault-page.js')));
ok('Vault: boot dispatches firebase-ready (#776)', /dispatchEvent\(new Event\('firebase-ready'\)\)/.test(read('vault-auth.module.js')));
ok('Vault: boot sets window._firestore with setDoc (#776)', /window\._firestore\s*=\s*\{[^}]*setDoc/.test(read('vault-auth.module.js')));
ok('Close Board: dealValue prefers acceptedPrice/acceptedTier (#777)', /acceptedPrice/.test(read('close-board.js')) && /acceptedTier/.test(read('close-board.js')));
ok('rep-os: "signed" deal bucket includes the accepted status (#777)', /'accepted'[^\n]*'signed'[^\n]*'scheduled'/.test(read('rep-os.js')));
ok('Storm Center: recordKnock is exposed on the public API (#779)', /recordKnock:\s*recordZoneKnock/.test(read('storm-center.js')));
ok('D2D: submitKnock attributes knocks to a storm zone (#779)', /attributeKnockToStormZone\(/.test(read('d2d-tracker-core-2026b.js')));
ok('Academy: 5-star scoring uses per-node max, not a flat *30 (#780)', /maxNodeScore/.test(read('sales-training-engine.js')) && !/!== undefined && !s\.terminal\)\.length \* 30/.test(read('sales-training-engine.js')));
ok('Academy: progress repaints after the async load (#780)', /_repaintCurrentTab/.test(read('real-deal-academy.js')));
ok('Academy: failed quiz has a retry control (#780)', /retry-quiz/.test(read('real-deal-academy.js')));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

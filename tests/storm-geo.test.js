/**
 * tests/storm-geo.test.js — Phase 8 storm/map geo logic.
 *
 * Exercises the pure geo engine behind storm intel (storm-integration.js) in a
 * vm sandbox: haversine distance, point-in-polygon (ray casting), and
 * findLeadsInZone (which leads fall inside a storm footprint, sorted hardest-hit
 * first). Map *rendering* (Leaflet tiles, heatmap, draw tools) is browser-only
 * and marked needs-browser in the matrix.
 *
 * Zero deps. Run: node tests/storm-geo.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

function loadIIFE(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js', file), 'utf8');
  const noop = () => ({ style: {}, appendChild() {}, addEventListener() {}, remove() {}, classList: { add() {}, remove() {} }, dataset: {} });
  const win = { addEventListener() {}, removeEventListener() {}, location: { pathname: '/pro/dashboard' } };
  win.window = win;
  const sandbox = {
    window: win,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, createElement() { return noop(); }, body: noop(), readyState: 'complete' },
    L: { latLng: (a, b) => ({ lat: a, lng: b }) }, // Leaflet stub (not used by geo fns)
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, Math, JSON,
  };
  vm.runInNewContext(src, sandbox, { filename: file });
  return win;
}

const SI = loadIIFE('storm-integration.js').StormIntegration;

console.log('STORM GEO — distanceMiles / pointInPolygon / findLeadsInZone');
ok('exposes StormIntegration geo helpers', SI && typeof SI.distanceMiles === 'function' && typeof SI.pointInPolygon === 'function' && typeof SI.findLeadsInZone === 'function');

// ── distanceMiles (haversine, miles) ──
{
  const austin = [30.2672, -97.7431];
  const dallas = [32.7767, -96.7970];
  const d = SI.distanceMiles(austin, dallas);
  ok(`Austin↔Dallas ≈ 182 mi (got ${d.toFixed(1)})`, d > 170 && d < 200);
  ok('same point → 0 mi', near(SI.distanceMiles(austin, austin), 0));
  // symmetry
  ok('distance is symmetric', near(SI.distanceMiles(austin, dallas), SI.distanceMiles(dallas, austin)));
}

// ── pointInPolygon (ray casting); point/polygon are [lat,lng] ──
{
  const square = [[0, 0], [0, 10], [10, 10], [10, 0]];
  ok('point inside square → true', SI.pointInPolygon([5, 5], square) === true);
  ok('point outside (NE) → false', SI.pointInPolygon([20, 20], square) === false);
  ok('point outside (E of edge) → false', SI.pointInPolygon([5, 15], square) === false);
  ok('degenerate polygon (<3 pts) → false', SI.pointInPolygon([5, 5], [[0, 0], [1, 1]]) === false);
}

// ── findLeadsInZone — leads inside a storm footprint, sorted by distance ──
{
  const zone = { bounds: { n: 10, s: 0, e: 10, w: 0 } }; // center ≈ [5,5]
  const leads = [
    { id: 'center', lat: 5, lng: 5, name: 'Center' },
    { id: 'corner', lat: 1, lng: 1, name: 'Corner' },     // inside, farther from center
    { id: 'outside', lat: 20, lng: 20, name: 'Outside' }, // excluded
    { id: 'nogeo', name: 'No coords' },                   // skipped (no lat/lng)
  ];
  const inside = SI.findLeadsInZone(zone, leads);
  ok('finds the 2 leads inside the footprint', inside.length === 2);
  ok('excludes the lead outside the footprint', !inside.some(l => l.id === 'outside'));
  ok('skips leads with no coordinates', !inside.some(l => l.id === 'nogeo'));
  ok('sorted hardest-hit first (center closest to storm center)', inside[0].id === 'center');
  ok('annotates distanceFromCenter', typeof inside[0].distanceFromCenter === 'number');
  ok('empty/no zone → []', SI.findLeadsInZone(null, leads).length === 0);
}

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }

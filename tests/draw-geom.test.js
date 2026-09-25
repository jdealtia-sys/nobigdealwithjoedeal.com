/**
 * tests/draw-geom.test.js — docs/pro/js/draw-geom.js (window.NBDDrawGeom), the
 * pure geometry/totals module the phone Draw rebuild moves onto (draw lane
 * L1, 2026-09-25).
 *
 * Every check runs real inputs through real functions. Where draw-geom
 * claims to be a COPY of live code (hav, shoelace, recalc/recalcGutters,
 * the LT table, the pitch options), the ORIGINAL is lifted out of
 * maps-core.js / maps-routing.js / dashboard.html and EXECUTED beside the
 * copy on the same inputs — so an edit to either side reddens this suite,
 * and a source-text match cannot pass it by accident.
 *
 * Zero deps. Run: node tests/draw-geom.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GEOM_PATH = path.join(ROOT, 'docs', 'pro', 'js', 'draw-geom.js');
const G = require(GEOM_PATH);
const { WING } = require('./e2e/fixtures/draw-touch.js');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CORE = read('docs/pro/js/maps-core.js');
const ROUTING = read('docs/pro/js/maps-routing.js');
const DASH = read('docs/pro/dashboard.html');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// ── Lift a function / literal out of the live source, to EXECUTE it ──
// Balanced-bracket scan from the first `open` at/after `from`, skipping
// strings and comments. (None of the lifted bodies use template literals
// or regex literals; if one ever does, the lift throws and this suite reds.)
function balanced(src, from, open, close) {
  const s = src.indexOf(open, from);
  if (s < 0) throw new Error('no ' + open + ' after ' + from);
  let depth = 0, mode = null;
  for (let i = s; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) { if (c === '\\') { i++; continue; } if (c === mode) mode = null; continue; }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '`') throw new Error('template literal inside the lifted block — extend balanced()');
    if (c === '"' || c === "'") { mode = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return src.slice(s, i + 1);
  }
  throw new Error('unbalanced ' + open);
}
function liftFunction(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0 || src.indexOf('function ' + name + '(', at + 1) >= 0) throw new Error(name + ' is missing or defined twice');
  return src.slice(at, src.indexOf('{', at)) + balanced(src, at, '{', '}');
}

// Deterministic PRNG so a red run reproduces.
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

console.log('DRAW GEOMETRY (draw-geom.js)');

// ── 1. The copies ARE the originals ───────────────────────────────
console.log('\n[copies vs the live functions]');
const coreHav = new Function(liftFunction(CORE, 'hav') + '\nreturn hav;')();
const liveShoelace = new Function('hav', liftFunction(ROUTING, 'shoelaceArea') + '\nreturn shoelaceArea;')(coreHav);
{
  const rnd = lcg(20260925);
  let mism = 0, n = 0;
  for (let i = 0; i < 400; i++) {
    const a = { lat: 38 + rnd() * 2, lng: -85 + rnd() * 2 };
    const b = i % 4 === 0 ? { lat: a.lat, lng: a.lng } : { lat: a.lat + (rnd() - 0.5) * 0.01, lng: a.lng + (rnd() - 0.5) * 0.01 };
    n++; if (G.hav(a, b) !== coreHav(a, b)) mism++;
  }
  ok('hav === maps-core.js hav on 400 point pairs (bit-identical)', mism === 0, mism + '/' + n + ' differ');
  ok('hav of a point to itself is 0', G.hav({ lat: 39, lng: -84 }, { lat: 39, lng: -84 }) === 0);
  ok('EARTH_R_FT is 20,902,231 ft (the radius the bit-identical hav implies)', G.EARTH_R_FT === 20902231);
}
{
  const rnd = lcg(7);
  let mism = 0;
  for (let i = 0; i < 150; i++) {
    const o = { lat: 39 + rnd(), lng: -84.5 + rnd() };
    const pts = Array.from({ length: 3 + Math.floor(rnd() * 6) }, () => ({ lat: o.lat + (rnd() - 0.5) * 3e-4, lng: o.lng + (rnd() - 0.5) * 3e-4 }));
    if (G.shoelace(pts) !== liveShoelace(pts)) mism++;
  }
  ok('shoelace === maps-routing.js shoelaceArea on 150 polygons (bit-identical)', mism === 0, mism + ' differ');
  ok('shoelace of < 3 points is 0 (both)', G.shoelace([WING.A, WING.B]) === 0 && liveShoelace([WING.A, WING.B]) === 0);
  ok('shoelace(null) is 0', G.shoelace(null) === 0);
}

// recalc() / recalcGutters() run against a stub document: the #cr-* / #gr-*
// text they write is compared with computeTotals().text.
const liveRecalcSrc = liftFunction(ROUTING, 'recalc');
const liveGutterSrc = liftFunction(ROUTING, 'recalcGutters');
function stubDoc(pitch, waste) {
  const els = {};
  return {
    els,
    getElementById(id) {
      if (id === 'pitchSel') return pitch === null ? null : { value: pitch };
      if (id === 'wasteSel') return waste === null ? null : { value: waste };
      if (!els[id]) els[id] = { textContent: '', classList: { toggle() {} } };
      return els[id];
    },
  };
}
function runLiveRecalc(sc) {
  const d = stubDoc(sc.pitch, sc.waste);
  new Function('drawnLines', 'facets', 'perimClosed', 'perimBaseArea', 'document', liveRecalcSrc + '\nreturn recalc;')(
    sc.lines, sc.facets, sc.perimClosed, sc.perimBaseArea, d)();
  new Function('drawnLines', 'document', liveGutterSrc + '\nreturn recalcGutters;')(sc.lines, d)();
  const t = (id) => d.els[id] && d.els[id].textContent;
  return { base: t('cr-base'), pitched: t('cr-pitched'), waste: t('cr-waste'), sq: t('cr-sq'), gutter: t('gr-total'), ds: String(t('gr-ds')) };
}
function runGeom(sc) {
  const r = G.computeTotals(sc.lines, sc.facets, sc.pitch === null ? undefined : sc.pitch, sc.waste === null ? undefined : sc.waste,
    { perimClosed: sc.perimClosed, perimBaseArea: sc.perimBaseArea });
  return r.text;
}
{
  const line = (type, dist) => ({ type, dist });
  const fixed = [
    { name: 'empty drawing', lines: [], facets: [], perimClosed: false, perimBaseArea: 0, pitch: '1.202', waste: '1.17' },
    { name: 'two facets, own pitches; open + zero-area facets ignored', lines: [line(5, 40), line(4, 30)],
      facets: [{ closed: true, baseArea: 1075.248, pitch: 1.202 }, { closed: true, baseArea: 412.9, pitch: 1.118 },
        { closed: false, baseArea: 300, pitch: 1.2 }, { closed: true, baseArea: 0, pitch: 1.2 }],
      perimClosed: false, perimBaseArea: 0, pitch: '1.202', waste: '1.17' },
    { name: 'facets + a closed perimeter not yet saved (added at global pitch)', lines: [],
      facets: [{ closed: true, baseArea: 900, pitch: 1.054 }], perimClosed: true, perimBaseArea: 333.3, pitch: '1.302', waste: '1.10' },
    { name: 'facets + the closed perimeter IS a saved facet (not added twice)', lines: [],
      facets: [{ closed: true, baseArea: 900, pitch: 1.054 }], perimClosed: true, perimBaseArea: 900, pitch: '1.302', waste: '1.10' },
    { name: 'perimeter only', lines: [line(5, 10)], facets: [], perimClosed: true, perimBaseArea: 1205.36, pitch: '1.0', waste: '1.30' },
    { name: 'eave x average rake guess', lines: [line(5, 40.2), line(5, 20.1), line(4, 30), line(4, 26), line(0, 17)], facets: [], perimClosed: false, perimBaseArea: 0, pitch: '1.202', waste: '1.17' },
    { name: '(sum/4)^2 line-only guess excludes gutters', lines: [line(0, 17), line(2, 12.2), line(3, 17.1), line(10, 66.6)], facets: [], perimClosed: false, perimBaseArea: 0, pitch: '1.414', waste: '1.25' },
    { name: 'gutters only: no area', lines: [line(10, 40), line(10, 0.1)], facets: [], perimClosed: false, perimBaseArea: 0, pitch: '1.202', waste: '1.17' },
    { name: 'empty #pitchSel value falls back to 1.202', lines: [], facets: [{ closed: true, baseArea: 1000, pitch: 1.202 }], perimClosed: true, perimBaseArea: 50, pitch: '', waste: '' },
    { name: 'no #pitchSel / #wasteSel element at all', lines: [line(5, 30), line(4, 20)], facets: [], perimClosed: false, perimBaseArea: 0, pitch: null, waste: null },
    { name: 'the captured legacy autosave (duplicate facet, B4)', lines: null, facets: null, perimClosed: false, perimBaseArea: 0, pitch: '1.202', waste: '1.17', legacy: true },
  ];
  const rnd = lcg(42);
  const random = Array.from({ length: 250 }, (_, i) => {
    const lines = Array.from({ length: Math.floor(rnd() * 9) }, () => line(Math.floor(rnd() * 11), rnd() * 80));
    const facets = rnd() < 0.5 ? [] : Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({ closed: rnd() < 0.8, baseArea: rnd() < 0.1 ? 0 : rnd() * 2000, pitch: G.PITCH_OPTIONS[Math.floor(rnd() * 10)].factor }));
    const perimClosed = rnd() < 0.4;
    const perimBaseArea = perimClosed ? (facets.length && rnd() < 0.3 ? facets[0].baseArea : rnd() * 1500) : 0;
    const pitch = String(G.PITCH_OPTIONS[Math.floor(rnd() * 10)].factor);
    const waste = ['1.10', '1.15', '1.17', '1.20', '1.25', '1.30'][Math.floor(rnd() * 6)];
    return { name: 'random #' + i, lines, facets, perimClosed, perimBaseArea, pitch, waste };
  });
  const LEGACY = legacyAutosave();
  let mism = [];
  for (const sc of fixed.concat(random)) {
    if (sc.legacy) { sc.lines = LEGACY.lines; sc.facets = LEGACY.facets; }
    const live = runLiveRecalc(sc), geo = runGeom(sc);
    if (JSON.stringify(live) !== JSON.stringify(geo)) mism.push(sc.name + ': live ' + JSON.stringify(live) + ' vs geom ' + JSON.stringify(geo));
  }
  ok('computeTotals().text === the text recalc()+recalcGutters() write, 11 named + 250 random drawings', mism.length === 0, mism.slice(0, 3).join(' | '));
  const leg = G.computeTotals(LEGACY.lines, LEGACY.facets, LEGACY.pitch, LEGACY.waste);
  ok('the legacy duplicate-facet drawing reads 2898 pitched sf today (the B4 double count, 2 x 1449)', leg.text.pitched === '2898 sf' && leg.source === 'facets');
}

console.log('\n[the LT table and pitch options match the app]');
{
  const at = ROUTING.indexOf('const LT = [');
  const lt = new Function('return ' + balanced(ROUTING, at, '[', ']') + ';')();
  ok('LT_NAMES === maps-routing.js LT names, index for index', JSON.stringify(lt.map((t) => t.n)) === JSON.stringify(G.LT_NAMES), JSON.stringify(lt.map((t) => t.n)));
  ok('LT constant indices match the names', G.LT_NAMES[G.LT.VALLEY] === 'Valley' && G.LT_NAMES[G.LT.RAKE] === 'Rake' && G.LT_NAMES[G.LT.GUTTERS] === 'Gutters' && G.LT_NAMES[G.LT.RIDGE_VENT] === 'Ridge Vent');
  const sel = DASH.slice(DASH.indexOf('id="pitchSel"'), DASH.indexOf('</select>', DASH.indexOf('id="pitchSel"')));
  const vals = [...sel.matchAll(/value="([\d.]+)"/g)].map((m) => Number(m[1]));
  ok('PITCH_OPTIONS factors === dashboard.html #pitchSel option values', JSON.stringify(vals) === JSON.stringify(G.PITCH_OPTIONS.map((o) => o.factor)), JSON.stringify(vals));
  // renderFacetList builds its <select> in a template literal: read its text,
  // up to the next function, rather than lifting it to run.
  const rf = ROUTING.indexOf('function renderFacetList(');
  const facetSel = ROUTING.slice(rf, ROUTING.indexOf('\nfunction ', rf + 1));
  const fvals = [...facetSel.matchAll(/<option value="([\d.]+)"/g)].map((m) => Number(m[1]));
  ok('PITCH_OPTIONS factors === the per-facet pitch <select> values', JSON.stringify(fvals) === JSON.stringify(G.PITCH_OPTIONS.map((o) => o.factor)), JSON.stringify(fvals));
  ok('each option factor is pitchFactor(rise) to 3 places', G.PITCH_OPTIONS.every((o) => near(o.factor, G.pitchFactor(o.rise), 0.0005)));
  ok('riseFromFactor round-trips every option (0 for Flat, not 8)', G.PITCH_OPTIONS.every((o) => G.riseFromFactor(o.factor) === o.rise));
  ok('pitchFactor: 0 or junk is 1; 8/12 = 1.2019', G.pitchFactor(0) === 1 && G.pitchFactor('x') === 1 && near(G.pitchFactor(8), 1.20185, 1e-5));
}

// ── 2. The audited wing and analytic shapes ───────────────────────
console.log('\n[areas and lengths]');
{
  const ring = [WING.A, WING.B, WING.C, WING.D];
  const sides = ring.map((p, i) => G.hav(p, ring[(i + 1) % 4]));
  ok('audit wing sides are 40.5 / 25.6 / 41.0 / 27.2 ft (haversine)', JSON.stringify(sides.map((s) => s.toFixed(1))) === JSON.stringify(['40.5', '25.6', '41.0', '27.2']), sides.map((s) => s.toFixed(3)).join(' '));
  // The audit's independent check: WGS84 equatorial radius, local
  // equirectangular projection from corner A.
  const R = 6378137, d = Math.PI / 180, lat0 = ring[0].lat * d;
  const xy = ring.map((p) => [(p.lng - ring[0].lng) * d * R * Math.cos(lat0) * 3.28084, (p.lat - ring[0].lat) * d * R * 3.28084]);
  let a2 = 0; for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; a2 += xy[i][0] * xy[j][1] - xy[j][0] * xy[i][1]; }
  const independent = Math.abs(a2 / 2);
  const app = G.shoelace(ring);
  ok('the independent check gives 1077.7 sf', independent.toFixed(1) === '1077.7', independent.toFixed(3));
  ok('shoelace gives 1075 sf, within 0.5% of 1077.7', Math.round(app) === 1075 && Math.abs(app - independent) / independent <= 0.005, app.toFixed(3));
  ok('the audit single gutter run D-C-B is 66.6 ft', (G.hav(WING.D, WING.C) + G.hav(WING.C, WING.B)).toFixed(1) === '66.6');
  ok('WING.expected records the same numbers the geometry gives', WING.expected.appAreaSf === Math.round(app) && WING.expected.gutterDcbFt === 66.6);
}
{
  const FT_PER_DEG = G.EARTH_R_FT * Math.PI / 180;
  const o = { lat: 39.07, lng: -84.17 };
  const at = (x, y) => ({ lat: o.lat + y / FT_PER_DEG, lng: o.lng + x / (FT_PER_DEG * Math.cos(o.lat * Math.PI / 180)) });
  const rect = [at(0, 0), at(40, 0), at(40, 30), at(0, 30)];
  ok('analytic 40 x 30 ft rectangle at 39.07N = 1200 sf', near(G.shoelace(rect), 1200, 0.01), G.shoelace(rect));
  ok('...and its sides are 40 and 30 ft', near(G.hav(rect[0], rect[1]), 40, 1e-6) && near(G.hav(rect[1], rect[2]), 30, 1e-6));
  const ell = [at(0, 0), at(50, 0), at(50, 20), at(20, 20), at(20, 45), at(0, 45)];
  ok('analytic L-shape (50x20 + 20x25) = 1500 sf', near(G.shoelace(ell), 1500, 0.01), G.shoelace(ell));
  ok('winding direction does not change the area', near(G.shoelace(ell.slice().reverse()), 1500, 0.01));
  ok('starting corner does not change the area', near(G.shoelace(ell.slice(3).concat(ell.slice(0, 3))), 1500, 0.01));
}
{
  const f = [19, 20, 21].map((z) => G.ftPerPx(39.07, z).toFixed(2));
  ok('ft per px at 39.07N: z19 0.76, z20 0.38, z21 0.19', JSON.stringify(f) === JSON.stringify(['0.76', '0.38', '0.19']), f.join(' '));
  ok('z22 halves z21 (0.095 ft/px)', G.ftPerPx(39.07, 22).toFixed(3) === '0.095');
}
{
  const s8 = G.slopeFactors(8), s12 = G.slopeFactors(12), s6 = G.slopeFactors(6), s0 = G.slopeFactors(0);
  ok('slopeFactors 8/12: rake +20.2%, hip/valley +10.6%', s8.rake.toFixed(3) === '1.202' && s8.hipValley.toFixed(3) === '1.106');
  ok('slopeFactors 6/12: rake +11.8%, hip/valley +6.1%', s6.rake.toFixed(3) === '1.118' && s6.hipValley.toFixed(3) === '1.061');
  ok('slopeFactors 12/12: rake +41.4%, hip/valley +22.5%', s12.rake.toFixed(3) === '1.414' && s12.hipValley.toFixed(3) === '1.225');
  ok('slopeFactors flat / junk = 1 (off)', s0.rake === 1 && s0.hipValley === 1 && G.slopeFactors('x').rake === 1);
}

// ── 3. Readout strings, squares, downspouts ───────────────────────
console.log('\n[readouts and downspouts]');
{
  const t = G.computeTotals([{ type: 10, dist: 66.625 }], [{ closed: true, baseArea: 1075.248, pitch: 1.202 }], '1.202', '1.17');
  ok('#cr-sq = base x pitch x waste / 100, to 2 places', t.text.sq === (1075.248 * 1.202 * 1.17 / 100).toFixed(2) + ' sq' && t.text.sq === '15.12 sq');
  ok('readout strings have the contract shapes', /^\d+ sf$/.test(t.text.base) && /^\d+ sf$/.test(t.text.pitched) && /^\d+ sf$/.test(t.text.waste) && /^\d+\.\d\d sq$/.test(t.text.sq) && /^\d+\.\d ft$/.test(t.text.gutter) && /^\d+$/.test(t.text.ds));
  const rnd = lcg(99);
  let bad = 0;
  for (let i = 0; i < 300; i++) {
    const r = G.computeTotals([{ type: 10, dist: rnd() * 300 }], [{ closed: true, baseArea: 50 + rnd() * 5000, pitch: 1.158 }], '1.158', '1.20');
    if (parseFloat(r.text.base) !== Number(r.base.toFixed(0))
      || parseFloat(r.text.pitched) !== Number(r.pitched.toFixed(0))
      || parseFloat(r.text.waste) !== Number(r.withWaste.toFixed(0))
      || parseFloat(r.text.sq) !== Number(r.squares.toFixed(2))
      || parseFloat(r.text.gutter) !== Number(r.gutterLf.toFixed(1))
      || parseInt(r.text.ds, 10) !== r.downspouts) bad++;
  }
  ok('every readout string round-trips through parseFloat (300 drawings)', bad === 0, bad + ' failed');
  ok('the gutter readout of the audit run is "66.6 ft" / "2"', t.text.gutter === '66.6 ft' && t.text.ds === '2');
}
{
  const ds = (lf) => G.computeTotals([{ type: 10, dist: lf }], [], '1.202', '1.17').downspouts;
  ok('downspouts: 40 LF -> 1', G.downspouts(40) === 1 && ds(40) === 1);
  ok('downspouts: 40.1 LF -> 2', G.downspouts(40.1) === 2 && ds(40.1) === 2);
  ok('downspouts: 80 LF -> 2', G.downspouts(80) === 2 && ds(80) === 2);
  ok('downspouts: 80.0001 LF -> 3', G.downspouts(80.0001) === 3);
  ok('downspouts: 0 / negative / junk -> 0', G.downspouts(0) === 0 && G.downspouts(-5) === 0 && G.downspouts('x') === 0 && ds(0) === 0);
}

// ── 4. Estimate import table (audit B7) ───────────────────────────
console.log('\n[aggregateForEstimate]');
{
  const EXPECT = { 0: 'ridgeLf', 1: 'ridgeVentLf', 2: 'hipLf', 3: 'valleyLf', 4: 'rakeLf', 5: 'eaveLf', 6: 'wallLf', 7: 'wallLf', 8: 'dripEdgeLf', 9: 'parapetLf', 10: 'guttersLf' };
  const LF = ['ridgeLf', 'hipLf', 'valleyLf', 'rakeLf', 'eaveLf', 'wallLf', 'guttersLf', 'ridgeVentLf', 'dripEdgeLf', 'parapetLf'];
  const wrong = [];
  for (let t = 0; t <= 10; t++) {
    const dist = (t + 1) * 10 + 0.4;
    const r = G.aggregateForEstimate([{ type: t, dist }], []);
    const nonzero = LF.filter((f) => r[f] !== 0);
    if (nonzero.length !== 1 || nonzero[0] !== EXPECT[t] || r[EXPECT[t]] !== Math.round(dist)) wrong.push(t + ' (' + G.LT_NAMES[t] + ') -> ' + JSON.stringify(nonzero));
  }
  ok('each of the 11 LT types lands in exactly its one field', wrong.length === 0, wrong.join('; '));
  const mixed = G.aggregateForEstimate([{ type: 3, dist: 17.1 }, { type: 4, dist: 23.9 }, { type: 1, dist: 6.0 }, { type: 7, dist: 8 }, { type: 6, dist: 4 }], []);
  ok('Valley is valleyLf, never rakeLf (B7)', mixed.valleyLf === 17 && mixed.rakeLf === 24);
  ok('Rake is rakeLf, never wallLf (B7)', mixed.rakeLf === 24 && mixed.wallLf === 12);
  ok('Ridge Vent is not valleyLf (B7) — its own field until Jo decides', mixed.ridgeVentLf === 6 && mixed.valleyLf === 17 && mixed.ridgeLf === 0);
  ok('Flashing + Step Flash both go to wallLf', mixed.wallLf === 12);
  const rv = G.aggregateForEstimate([{ type: 1, dist: 6 }, { type: 0, dist: 19 }, { type: 9, dist: 5 }, { type: 6, dist: 2 }], [], { ridgeVentInRidge: true, parapetInWall: true });
  ok('opts.ridgeVentInRidge moves Ridge Vent into ridgeLf (and out of ridgeVentLf)', rv.ridgeLf === 25 && rv.ridgeVentLf === 0);
  ok('opts.parapetInWall moves Parapet into wallLf (and out of parapetLf)', rv.wallLf === 7 && rv.parapetLf === 0);
  const sumFirst = G.aggregateForEstimate([{ type: 5, dist: 10.4 }, { type: 5, dist: 10.4 }], []);
  ok('LF is Math.round of the SUM (10.4 + 10.4 -> 21, not 20)', sumFirst.eaveLf === 21 && near(sumFirst.exact.eaveLf, 20.8, 1e-9));
  const junk = G.aggregateForEstimate([{ type: 11, dist: 5 }, { type: '3', dist: 5 }, { type: 2, dist: 'x' }, null, { type: 2, dist: 3 }], []);
  ok('unknown types / bad dists are counted, never guessed into a field', junk.unknownTypes === 3 && junk.hipLf === 3 && junk.valleyLf === 0);
  const acc = [{ type: 'pipe' }, { type: 'pipe' }, { type: 'chimney' }, { type: 'skylight' }, { type: 'skylight' }, { type: 'skylight' }, { type: 'vent' }, { type: 'satellite' }, { type: 'turbine' }, { type: 'bogus' }];
  const ra = G.aggregateForEstimate([], acc);
  ok('placed accessories count into pipes / chimneys / skylights (+ vents, satellites, turbines)',
    ra.pipes === 2 && ra.chimneys === 1 && ra.skylights === 3 && ra.vents === 1 && ra.satellites === 1 && ra.turbines === 1 && ra.unknownAccessories === 1);
  const rc = G.aggregateForEstimate([], { pipe: 2, chimney: 1, skylight: 3, vent: 1, satellite: 1, turbine: 1 });
  ok('getAccessoryCounts()-shaped counts give the same fields', ['pipes', 'chimneys', 'skylights', 'vents', 'satellites', 'turbines'].every((k) => rc[k] === ra[k]));
  const oneEach = Object.keys(G.ACCESSORY_FIELD).map((k) => {
    const r = G.aggregateForEstimate([], [{ type: k }]);
    return ['pipes', 'chimneys', 'skylights', 'vents', 'satellites', 'turbines'].filter((f) => r[f] === 1);
  });
  ok('each accessory type lands in exactly one count field', oneEach.every((f, i) => f.length === 1 && f[0] === G.ACCESSORY_FIELD[Object.keys(G.ACCESSORY_FIELD)[i]]));
  const gut = G.aggregateForEstimate([{ type: 10, dist: 33.07 }, { type: 10, dist: 20.04 }], []);
  ok('gutter LF and downspouts from the exact sum (53.11 -> 53 LF, 2)', gut.guttersLf === 53 && gut.downspouts === 2);
  ok('slope fields are absent unless opts.slopeRise is passed', !('rakeSlopeLf' in gut) && !('hipSlopeLf' in gut));
  const sl = G.aggregateForEstimate([{ type: 4, dist: 23.9 }, { type: 2, dist: 12.2 }, { type: 3, dist: 17.1 }], [], { slopeRise: 8 });
  ok('opts.slopeRise 8 adds NEW *SlopeLf fields; existing keys stay plan-view',
    sl.rakeSlopeLf === Math.round(23.9 * G.slopeFactors(8).rake) && sl.hipSlopeLf === Math.round(12.2 * G.slopeFactors(8).hipValley)
    && sl.valleySlopeLf === Math.round(17.1 * G.slopeFactors(8).hipValley) && sl.rakeLf === 24 && sl.hipLf === 12);
}

// ── 5. Gutter runs ─────────────────────────────────────────────────
console.log('\n[gutterRuns]');
{
  const P = (x) => ({ lat: 39.1, lng: -84.1 + x * 1e-5 });
  const seg = (a, b, dist, extra) => Object.assign({ type: 10, dist, p1: P(a), p2: P(b) }, extra || {});
  const two = G.gutterRuns([seg(0, 1, 33.1), seg(1, 2, 20.0), { type: 5, dist: 9, p1: P(9), p2: P(10) }, seg(5, 6, 28.7)]);
  ok('continuity splits two separate runs (53.1 + 28.7)', two.length === 2 && near(two[0].lf, 53.1, 1e-9) && two[0].segmentCount === 2 && near(two[1].lf, 28.7, 1e-9));
  ok('downspouts per run: ceil(53.1/40)=2, ceil(28.7/40)=1', two[0].downspouts === 2 && two[1].downspouts === 1);
  const bridged = G.gutterRuns([seg(0, 1, 33.1), seg(1, 2, 20.0), seg(2, 3, 39.6)]);
  ok('a B5 bridge segment is continuous, so continuity alone keeps it in the run', bridged.length === 1 && near(bridged[0].lf, 92.7, 1e-9));
  const ided = G.gutterRuns([seg(0, 1, 33.1, { runId: 1 }), seg(1, 2, 20.0, { runId: 1 }), seg(2, 3, 28.7, { runId: 2 })]);
  ok('runId groups runs even when the ends touch (the L2 model)', ided.length === 2 && ided[0].runId === 1 && near(ided[1].lf, 28.7, 1e-9));
  ok('no gutters -> no runs', G.gutterRuns([{ type: 5, dist: 3, p1: P(0), p2: P(1) }]).length === 0 && G.gutterRuns(null).length === 0);
}

// ── 6. Legacy autosave: corners, ids, Firestore-safe copies ───────
console.log('\n[legacy autosave: corners and ids]');
{
  const L = legacyAutosave();
  const u = G.uniqueCorners(L);
  ok('a captured 9-line legacy autosave restores as 29 dots today', u.dotsToday === 29 && L.lines.length === 9, String(u.dotsToday));
  ok('...which are 14 unique corners after merging', u.vertices.length === 14, String(u.vertices.length));
  const perim = u.lineEnds.slice(0, 4);
  ok('the 4 perimeter edges close a ring over 4 distinct shared corners',
    perim.every((e, i) => e[1] === perim[(i + 1) % 4][0]) && new Set(perim.flat()).size === 4);
  const f0 = G.mergeCoincidentEndpoints(L.facets[0].points.concat(L.facets[1].points, L.lines[0].p1 ? [L.lines[0].p1] : []));
  ok('the duplicated facet and the edges share the same 4 corners', f0.vertices.length === 4);
  ok('gutter run ends are shared (3 corners for 2 segments)', u.lineEnds[7][1] === u.lineEnds[8][0] && new Set(u.lineEnds.slice(7).flat()).size === 3);
  const base = { lat: 39.1676, lng: -84.17 };
  const off = (dLat, dLng) => ({ lat: base.lat + dLat, lng: base.lng + dLng });
  ok('corners 1e-6 deg apart (~11 cm) are never merged', G.mergeCoincidentEndpoints([base, off(1e-6, 0), off(0, 1e-6)]).vertices.length === 3);
  ok('a JSON round-trip / 5e-8 deg jitter IS merged', G.mergeCoincidentEndpoints([base, JSON.parse(JSON.stringify(base)), off(5e-8, -5e-8)]).vertices.length === 1);
  const creep = G.mergeCoincidentEndpoints([base, off(0.9e-7, 0), off(1.8e-7, 0)]);
  ok('no chain creep: 0 / 0.9e-7 / 1.8e-7 -> 2 corners, not 1', creep.vertices.length === 2 && creep.index.join() === '0,0,1');
  const bad = G.mergeCoincidentEndpoints([base, null, { lat: NaN, lng: 1 }, base]);
  ok('garbage points index -1 and keep later indices aligned', bad.index.join() === '0,-1,-1,0' && bad.vertices.length === 1);
}
{
  const L = legacyAutosave();
  const before = JSON.stringify(L.lines);
  const r = G.normalizeIds(L.lines);
  const ids = r.lines.map((l) => l.id);
  ok('legacy decimal ids become integers 1..9', JSON.stringify(ids) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  ok('each copy keeps its legacyId and the map resolves it', r.lines.every((l, i) => l.legacyId === L.lines[i].id && r.map.get(L.lines[i].id) === l.id));
  ok('stored data is not rewritten (input untouched)', JSON.stringify(L.lines) === before);
  ok('parseInt(legacy id) never equals the id (why list/popup handlers missed, B3)', L.lines.every((l) => parseInt(String(l.id), 10) !== l.id));
  const mixed = G.normalizeIds([{ id: 5 }, { id: 5 }, { id: 2.5 }, {}, { id: 7 }, { id: -3 }]);
  ok('unique positive integers are kept; duplicates/decimals/missing/negative get fresh ids above them',
    JSON.stringify(mixed.lines.map((l) => l.id)) === JSON.stringify([5, 8, 9, 10, 7, 11]) && mixed.nextId === 12);
  ok('a duplicate id keeps the first mapping', mixed.map.get(5) === 5 && mixed.lines[1].legacyId === 5 && mixed.map.get(2.5) === 9);
  ok('opts.start seeds fresh ids', G.normalizeIds([{ id: 0.5 }], { start: 100 }).lines[0].id === 100);
}
{
  class Sentinel { constructor() { this.kind = 'serverTimestamp'; this.u = undefined; } }
  const s = new Sentinel(), dt = new Date(0);
  const doc = { a: 1, b: undefined, c: { d: undefined, e: [1, undefined, { f: undefined, g: 2 }] }, h: null, s, dt, z: Object.assign(Object.create(null), { y: undefined, x: 3 }) };
  const out = G.stripUndefined(doc);
  const findUndef = (v, p) => {
    if (v === undefined) return p;
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { const r = findUndef(v[i], p + '[' + i + ']'); if (r) return r; } }
    else if (v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
      for (const k of Object.keys(v)) { const r = findUndef(v[k], p + '.' + k); if (r) return r; }
    }
    return null;
  };
  ok('stripUndefined leaves no undefined anywhere in plain data', findUndef(out, 'doc') === null, findUndef(out, 'doc'));
  ok('undefined keys are dropped, array holes become null', !('b' in out) && !('d' in out.c) && JSON.stringify(out.c.e) === '[1,null,{"g":2}]' && out.h === null);
  ok('sentinels / Dates / class instances pass through by reference', out.s === s && out.dt === dt);
  ok('null-prototype objects are walked too', !('y' in out.z) && out.z.x === 3);
  ok('the input is not mutated', 'b' in doc && 'd' in doc.c && doc.c.e.length === 3);
  const L = legacyAutosave();
  const legacyDoc = { facets: L.facets.map((f) => ({ name: f.name, pitch: f.pitch, closed: f.closed, baseArea: f.baseArea, points: f.points })) };
  const fixed = G.stripUndefined(legacyDoc);
  ok('a Save doc built from legacy facets (name: undefined, code-map #4) comes out clean', findUndef(legacyDoc, 'doc') !== null && findUndef(fixed, 'doc') === null);
}

// ── 7. Module shape ────────────────────────────────────────────────
console.log('\n[module shape]');
{
  const win = {};
  const ctx = vm.createContext({ window: win, Math, Number, Object, Array, Set, Map, String, Buffer: undefined });
  vm.runInContext(fs.readFileSync(GEOM_PATH, 'utf8'), ctx, { filename: 'draw-geom.js' });
  ok('in a browser-like context it defines exactly window.NBDDrawGeom', Object.keys(win).join() === 'NBDDrawGeom' && typeof win.NBDDrawGeom.computeTotals === 'function');
  ok('the browser copy computes the same totals as the node copy', win.NBDDrawGeom.shoelace([WING.A, WING.B, WING.C, WING.D]) === G.shoelace([WING.A, WING.B, WING.C, WING.D]));
  ok('the API object is frozen', Object.isFrozen(G) && Object.isFrozen(G.LT_NAMES) && Object.isFrozen(G.FIELD_BY_TYPE));
}

// A real autosave captured from the rig on 2026-09-25 (maps-routing.js
// autoSaveDrawing, origin/main f7408d71): a 40x30 ft facet closed, one tap to
// start facet 2 (duplicating facet 1, B4), a Valley, a Ridge Vent and a
// Ridge line, and a 2-segment gutter run. Facets carry no name/color keys
// (JSON.stringify dropped their undefined values); gutterPoints misses the
// run's last point (autosave runs before the push). Re-anchored off the
// demo address the same way WING is.
function legacyAutosave() {
  return JSON.parse(JSON.stringify({
    address: '',
    lines: [
      { id: 1790347279719.1355, type: 5, name: 'Eave', color: '#BE185D', dist: 40.08931340324379, p1: { lat: 39.167670860328165, lng: -84.17000010609627 }, p2: { lat: 39.167670860328165, lng: -84.16985836745332 }, subtype: 'eave' },
      { id: 1790347279720.51, type: 4, name: 'Rake', color: '#EC4899', dist: 30.0669850524477, p1: { lat: 39.167670860328165, lng: -84.16985836745332 }, p2: { lat: 39.167753277910585, lng: -84.16985836745332 }, subtype: 'rake' },
      { id: 1790347279721.5767, type: 5, name: 'Eave', color: '#BE185D', dist: 40.08926642546462, p1: { lat: 39.167753277910585, lng: -84.16985836745332 }, p2: { lat: 39.167753277910585, lng: -84.17000010609627 }, subtype: 'eave' },
      { id: 1790347279722.097, type: 4, name: 'Rake', color: '#EC4899', dist: 30.0669850524477, p1: { lat: 39.167753277910585, lng: -84.17000010609627 }, p2: { lat: 39.167670860328165, lng: -84.17000010609627 }, subtype: 'rake' },
      { id: 1790347279725.4807, type: 3, name: 'Valley', color: '#3B82F6', dist: 25.055820876175698, p1: { lat: 39.167670860328165, lng: -84.1702127140607 }, p2: { lat: 39.167739541646846, lng: -84.1702127140607 }, subtype: 'line' },
      { id: 1790347279726.565, type: 1, name: 'Ridge Vent', color: '#86EFAC', dist: 10.022328349951849, p1: { lat: 39.167670860328165, lng: -84.17028358338217 }, p2: { lat: 39.167698332855636, lng: -84.17028358338217 }, subtype: 'line' },
      { id: 1790347279727.9907, type: 0, name: 'Ridge', color: '#22C55E', dist: 17.03795819621422, p1: { lat: 39.167670860328165, lng: -84.17035445270365 }, p2: { lat: 39.16771756362487, lng: -84.17035445270365 }, subtype: 'line' },
      { id: 1790347279728.621, type: 10, name: 'Gutters', color: '#06B6D4', dist: 33.073735231319105, p1: { lat: 39.167560970218275, lng: -84.17000010609627 }, p2: { lat: 39.167560970218275, lng: -84.16988317171584 }, subtype: 'gutter' },
      { id: 1790347279729.2104, type: 10, name: 'Gutters', color: '#06B6D4', dist: 20.044656702495846, p1: { lat: 39.167560970218275, lng: -84.16988317171584 }, p2: { lat: 39.16750602516333, lng: -84.16988317171584 }, subtype: 'gutter' },
    ],
    facets: [
      { pitch: 1.202, closed: true, baseArea: 1205.3647868582223, points: [{ lat: 39.167670860328165, lng: -84.17000010609627 }, { lat: 39.167670860328165, lng: -84.16985836745332 }, { lat: 39.167753277910585, lng: -84.16985836745332 }, { lat: 39.167753277910585, lng: -84.17000010609627 }] },
      { pitch: 1.202, closed: true, baseArea: 1205.3647868582223, points: [{ lat: 39.167670860328165, lng: -84.17000010609627 }, { lat: 39.167670860328165, lng: -84.16985836745332 }, { lat: 39.167753277910585, lng: -84.16985836745332 }, { lat: 39.167753277910585, lng: -84.17000010609627 }] },
    ],
    perimPoints: [{ lat: 39.167890640547945, lng: -84.16971662881036 }],
    perimClosed: false,
    gutterPoints: [{ lat: 39.167560970218275, lng: -84.17000010609627 }, { lat: 39.167560970218275, lng: -84.16988317171584 }],
    pitch: '1.202', waste: '1.17', ts: 1790347279730,
  }));
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}

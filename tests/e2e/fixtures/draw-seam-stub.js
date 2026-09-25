// tests/e2e/fixtures/draw-seam-stub.js — a TEST-ONLY stand-in for the Draw
// engine seam, drawMap.nbdDraw (seam v1).
//
// 2026-09-25, draw lane L4. The phone crosshair screen (docs/pro/js/
// draw-reticle.js) talks to the engine only through drawMap.nbdDraw, which
// draw lane L3 adds to maps-routing.js. L3 was not built when L4 was, so
// this stub implements the frozen contract faithfully enough for the UI to
// be driven end to end today: it keeps its own model (corners, edges, runs,
// facets, structures), commits ONLY at the map's centre, snaps, refuses the
// same spot and a moving map, keeps an undo stack, and paints what it holds
// on the real Leaflet map. It never ships: it is injected by addInitScript
// in the specs that ask for it, waits for maps-routing.js to construct the
// map, attaches .nbdDraw, and dispatches 'nbd:drawmap-ready' — exactly what
// L3 does at the end of initDrawMap. The engine underneath (today's main)
// is never armed by it, so a real tap on the map places nothing.
//
// Test hooks (stub only, never part of the contract): api.__calls (every
// seam call, with the map centre / zoom at the time for placements),
// api.__model() (a JSON copy of the model), api.__seed(model) (replace the
// model and fire 'change'), api.__previewCount.
'use strict';

// Runs IN THE PAGE (serialised by addInitScript) — keep it self-contained.
function seamStubInit() {
  var R_FT = 20902231; // maps-routing.js hav() earth radius, feet
  var LT = [
    { name: 'Ridge', color: '#22C55E' }, { name: 'Ridge Vent', color: '#86EFAC' }, { name: 'Hip', color: '#06B6D4' },
    { name: 'Valley', color: '#3B82F6' }, { name: 'Rake', color: '#EC4899' }, { name: 'Eave', color: '#BE185D' },
    { name: 'Flashing', color: '#F97316' }, { name: 'Step Flash', color: '#EAB308' }, { name: 'Drip Edge', color: '#1D4ED8' },
    { name: 'Parapet', color: '#92400E' }, { name: 'Gutters', color: '#06B6D4' },
  ];
  var PITCH = 1.202, WASTE = 1.17, SNAP_CAP_PX = 16, SAME_SPOT_PX = 6;

  function rad(d) { return d * Math.PI / 180; }
  function hav(a, b) {
    var dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R_FT * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function areaSf(pts) {
    var G = window.NBDDrawGeom;
    if (G && typeof G.shoelace === 'function') return G.shoelace(pts);
    var lat0 = pts.reduce(function (s, p) { return s + p.lat; }, 0) / pts.length;
    var fx = R_FT * Math.PI / 180 * Math.cos(rad(lat0)), fy = R_FT * Math.PI / 180;
    var s = 0;
    for (var i = 0; i < pts.length; i++) { var a = pts[i], b = pts[(i + 1) % pts.length]; s += a.lng * fx * b.lat * fy - b.lng * fx * a.lat * fy; }
    return Math.abs(s) / 2;
  }
  function ll(p) { return { lat: Number(p.lat), lng: Number(p.lng) }; }
  function same(a, b) { return !!a && !!b && Math.abs(a.lat - b.lat) < 1e-10 && Math.abs(a.lng - b.lng) < 1e-10; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function fresh() {
    return {
      mode: null, armed: false, lineType: 0, accessory: null, crosshair: false,
      lines: [], facets: [], open: [], openSegIds: [], lineStart: null, run: null,
      structures: [{ id: 1, name: 'Structure 1' }], structureId: 1, nextId: 1, nextRun: 1, nextFacet: 1,
    };
  }

  function attach(map) {
    var L = window.L;
    var m = fresh();
    var undoStack = [], redoStack = [], listeners = [], calls = [];
    var moving = false;
    var paint = L.layerGroup().addTo(map);
    var band = null;
    map.on('movestart zoomstart', function () { moving = true; });
    map.on('moveend zoomend', function () { moving = false; });

    function rec(fn, args, extra) {
      var c = { fn: fn, args: clone(args === undefined ? null : args), t: Date.now() };
      if (extra) for (var k in extra) c[k] = extra[k];
      calls.push(c);
      return c;
    }
    function emit() { listeners.slice().forEach(function (f) { try { f({ type: 'change' }); } catch (e) { setTimeout(function () { throw e; }); } }); }
    function snapshot() { undoStack.push(JSON.stringify(m)); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; }
    function centre() { var s = map.getSize(); return map.containerPointToLatLng([s.x / 2, s.y / 2]); }
    function anchor() {
      if (m.mode === 'perim') return m.open.length ? m.open[m.open.length - 1] : null;
      if (m.mode === 'line') return m.lineStart;
      if (m.mode === 'gutter') return m.run && m.run.pts.length ? m.run.pts[m.run.pts.length - 1] : null;
      return null;
    }
    function chainFt() {
      var ids = m.mode === 'perim' ? m.openSegIds : (m.mode === 'gutter' && m.run ? m.run.segIds : []);
      return m.lines.filter(function (l) { return ids.indexOf(l.id) !== -1; }).reduce(function (s, l) { return s + l.dist; }, 0);
    }
    function vertices() {
      var v = [];
      m.lines.forEach(function (l) { v.push(l.p1, l.p2); });
      m.facets.forEach(function (f) { f.points.forEach(function (p) { v.push(p); }); });
      m.open.forEach(function (p) { v.push(p); });
      if (m.run) m.run.pts.forEach(function (p) { v.push(p); });
      if (m.lineStart) v.push(m.lineStart);
      return v;
    }
    function snapLL(latlng, radius) {
      var r = Math.min(Number(radius) || SNAP_CAP_PX, SNAP_CAP_PX);
      var at = map.latLngToContainerPoint(latlng), best = null, bestD = r + 1e-9;
      vertices().forEach(function (p) {
        var d = map.latLngToContainerPoint(p).distanceTo(at);
        if (d <= bestD) { bestD = d; best = p; }
      });
      return best ? { latlng: ll(best), snapped: true, kind: 'vertex' } : { latlng: ll(latlng), snapped: false, kind: null };
    }
    function addLine(type, p1, p2, extra) {
      var l = { id: m.nextId++, type: type, name: LT[type].name, color: LT[type].color, p1: ll(p1), p2: ll(p2), dist: hav(p1, p2), structureId: m.structureId };
      if (extra) for (var k in extra) l[k] = extra[k];
      m.lines.push(l);
      return l;
    }
    function edgeLt(t) { return t === 'rake' ? 4 : 5; }
    function close(edgeType) {
      var last = m.open[m.open.length - 1];
      var e = addLine(edgeLt(edgeType), last, m.open[0], { isPerim: true });
      m.openSegIds.push(e.id);
      var f = { id: m.nextFacet++, points: m.open.map(ll), closed: true, baseArea: areaSf(m.open), pitch: PITCH, structureId: m.structureId, label: 'Facet ' + (m.facets.length + 1) };
      m.lines.forEach(function (l) { if (m.openSegIds.indexOf(l.id) !== -1) l.facetId = f.id; });
      m.facets.push(f);
      m.open = []; m.openSegIds = [];
    }
    function render() {
      paint.clearLayers();
      m.facets.forEach(function (f) { L.polygon(f.points, { color: '#22C55E', weight: 1, fillOpacity: 0.18, interactive: false }).addTo(paint); });
      m.lines.forEach(function (l) {
        L.polyline([l.p1, l.p2], { color: l.color, weight: 4, dashArray: l.type === 4 ? '8,6' : null, interactive: false }).addTo(paint);
      });
      vertices().forEach(function (p) { L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: '#BD5728', fillOpacity: 1, interactive: false }).addTo(paint); });
    }
    function totalsFor(lines, facets) {
      var base = 0, pitched = 0;
      facets.forEach(function (f) { if (f.closed && f.baseArea > 0) { base += f.baseArea; pitched += f.baseArea * f.pitch; } });
      var withWaste = pitched * WASTE, squares = withWaste / 100;
      var runs = {};
      lines.forEach(function (l) { if (l.type === 10) runs[l.runId] = (runs[l.runId] || 0) + l.dist; });
      var gutterLf = 0, ds = 0;
      Object.keys(runs).forEach(function (k) { gutterLf += runs[k]; ds += runs[k] > 0 ? Math.max(1, Math.ceil(runs[k] / 40)) : 0; });
      return {
        source: facets.length ? 'facets' : 'none', base: base, pitched: pitched, withWaste: withWaste, squares: squares, gutterLf: gutterLf, downspouts: ds,
        text: { base: base.toFixed(0) + ' sf', pitched: pitched.toFixed(0) + ' sf', waste: withWaste.toFixed(0) + ' sf', sq: squares.toFixed(2) + ' sq', gutter: gutterLf.toFixed(1) + ' ft', ds: String(ds) },
      };
    }
    function commit(p, edgeType) {
      if (m.accessory) { rec('accessory-placed', { type: m.accessory, at: p }); return; }
      if (m.mode === 'perim') {
        if (m.open.length >= 3 && same(p, m.open[0])) { close(edgeType); return; }
        if (m.open.length) { var e = addLine(edgeLt(edgeType), m.open[m.open.length - 1], p, { isPerim: true }); m.openSegIds.push(e.id); }
        m.open.push(ll(p));
      } else if (m.mode === 'line') {
        if (!m.lineStart) m.lineStart = ll(p);
        else { addLine(m.lineType, m.lineStart, p); m.lineStart = null; }
      } else if (m.mode === 'gutter') {
        if (!m.run) m.run = { id: m.nextRun++, pts: [], segIds: [] };
        if (m.run.pts.length) { var g = addLine(10, m.run.pts[m.run.pts.length - 1], p, { runId: m.run.id }); m.run.segIds.push(g.id); }
        m.run.pts.push(ll(p));
      }
    }
    function changed() { render(); emit(); }

    var api = {
      version: 1,
      state: function () {
        var a = anchor();
        return {
          mode: m.armed ? m.mode : null, armed: m.armed, lineType: m.lineType, lineTypes: LT.map(function (t) { return { name: t.name, color: t.color }; }),
          accessory: m.accessory, anchor: a ? ll(a) : null, first: m.mode === 'perim' && m.open.length ? ll(m.open[0]) : null,
          openCount: m.mode === 'perim' ? m.open.length : m.mode === 'line' ? (m.lineStart ? 1 : 0) : (m.run ? m.run.pts.length : 0),
          canClose: m.mode === 'perim' && m.open.length >= 3, canFinishRun: m.mode === 'gutter' && !!m.run && m.run.pts.length >= 2,
          canUndo: undoStack.length > 0, canRedo: redoStack.length > 0,
          structureId: m.structureId, structures: clone(m.structures), crosshair: m.crosshair,
        };
      },
      setMode: function (mode, opts) {
        rec('setMode', [mode, opts || null]);
        if (m.mode === 'gutter' && mode !== 'gutter') m.run = null;
        if (m.mode === 'line' && mode !== 'line') m.lineStart = null;
        m.mode = mode || null; m.armed = !!mode;
        if (opts && opts.lineType != null) m.lineType = Number(opts.lineType);
        changed();
      },
      setCrosshair: function (on) {
        rec('setCrosshair', [!!on]);
        m.crosshair = !!on;
        if (on) { map.dragging.enable(); map.options.touchZoom = 'center'; map.options.doubleClickZoom = 'center'; }
      },
      snap: function (latlng, radius) { return snapLL(latlng, radius); },
      preview: function (latlng) {
        api.__previewCount++;
        if (!latlng) { if (band) { map.removeLayer(band); band = null; } return { anchor: null, segmentFt: 0, runFt: 0 }; }
        var a = anchor();
        if (!a || !m.armed) { if (band) band.setLatLngs([]); return { anchor: null, segmentFt: 0, runFt: chainFt() }; }
        var seg = hav(a, latlng);
        if (!band) band = L.polyline([], { color: '#fff', weight: 3, dashArray: '6,4', opacity: 0.8, interactive: false }).addTo(map);
        band.setLatLngs([a, latlng]);
        return { anchor: ll(a), segmentFt: seg, runFt: chainFt() + seg };
      },
      placeAtReticle: function (opts) {
        map.stop();
        var s = map.getSize();
        var c = centre();
        var call = rec('placeAtReticle', opts || null, { centre: ll(c), zoom: map.getZoom(), size: { x: s.x, y: s.y } });
        if (!m.armed && !m.accessory) return (call.result = { ok: false, reason: 'not-armed' });
        if (moving) return (call.result = { ok: false, reason: 'moving' });
        var p = snapLL(c, SNAP_CAP_PX).latlng;
        var a = anchor();
        if (a && map.latLngToContainerPoint(a).distanceTo(map.latLngToContainerPoint(p)) < SAME_SPOT_PX) return (call.result = { ok: false, reason: 'same-spot' });
        snapshot();
        commit(p, (opts && opts.edgeType) || 'eave');
        call.result = { ok: true, at: ll(p) };
        changed();
        return call.result;
      },
      closeShape: function (opts) {
        rec('closeShape', opts || null);
        if (!(m.mode === 'perim' && m.open.length >= 3)) return { ok: false, reason: 'open-outline-needs-3' };
        snapshot(); close((opts && opts.edgeType) || 'eave'); changed();
        return { ok: true };
      },
      finishRun: function () {
        rec('finishRun');
        if (!m.run) return { ok: false };
        snapshot(); m.run = null; changed();
        return { ok: true };
      },
      undo: function () { rec('undo'); if (!undoStack.length) return; redoStack.push(JSON.stringify(m)); m = JSON.parse(undoStack.pop()); changed(); },
      redo: function () { rec('redo'); if (!redoStack.length) return; undoStack.push(JSON.stringify(m)); m = JSON.parse(redoStack.pop()); changed(); },
      pick: function (latlng, radius) {
        var r = Number(radius) || 16;
        var at = map.latLngToContainerPoint(latlng);
        var v = snapLL(latlng, r);
        if (v.snapped) {
          var count = m.lines.filter(function (l) { return same(l.p1, v.latlng) || same(l.p2, v.latlng); }).length;
          return { kind: 'vertex', latlng: v.latlng, count: count };
        }
        var best = null, bestD = r;
        m.lines.forEach(function (l) {
          var a = map.latLngToContainerPoint(l.p1), b = map.latLngToContainerPoint(l.p2);
          var dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
          var t = len2 ? Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / len2)) : 0;
          var d = Math.hypot(at.x - (a.x + t * dx), at.y - (a.y + t * dy));
          if (d <= bestD) { bestD = d; best = l; }
        });
        return best ? { kind: 'edge', id: best.id, type: best.type, name: best.name, dist: best.dist, p1: ll(best.p1), p2: ll(best.p2) } : null;
      },
      moveVertex: function (from, to) {
        rec('moveVertex', [ll(from), ll(to)]);
        snapshot();
        var moved = 0;
        var mv = function (p) { if (same(p, from)) { p.lat = Number(to.lat); p.lng = Number(to.lng); moved++; } };
        m.lines.forEach(function (l) { mv(l.p1); mv(l.p2); l.dist = hav(l.p1, l.p2); });
        m.facets.forEach(function (f) { f.points.forEach(mv); f.baseArea = areaSf(f.points); });
        m.open.forEach(mv);
        if (m.run) m.run.pts.forEach(mv);
        if (m.lineStart) mv(m.lineStart);
        if (!moved) undoStack.pop();
        changed();
        return { ok: moved > 0, moved: moved };
      },
      retype: function (id, lt) {
        rec('retype', [id, lt]);
        var l = m.lines.filter(function (x) { return x.id === Number(id); })[0];
        if (!l || !LT[lt]) return;
        snapshot(); l.type = Number(lt); l.name = LT[lt].name; l.color = LT[lt].color; changed();
      },
      flip: function (id) {
        rec('flip', [id]);
        var l = m.lines.filter(function (x) { return x.id === Number(id); })[0];
        if (!l || (l.type !== 4 && l.type !== 5)) return;
        snapshot(); l.type = l.type === 4 ? 5 : 4; l.name = LT[l.type].name; l.color = LT[l.type].color; changed();
      },
      remove: function (id) {
        rec('remove', [id]);
        var i = m.lines.map(function (x) { return x.id; }).indexOf(Number(id));
        if (i === -1) return;
        snapshot(); m.lines.splice(i, 1); changed();
      },
      totals: function () {
        var per = m.structures.map(function (s) {
          var own = function (x) { return (x.structureId || m.structures[0].id) === s.id; };
          var t = totalsFor(m.lines.filter(own), m.facets.filter(own));
          t.id = s.id; t.name = s.name;
          return t;
        });
        var c = { base: 0, pitched: 0, gutterLf: 0, downspouts: 0 };
        per.forEach(function (p) { c.base += p.base; c.pitched += p.pitched; c.gutterLf += p.gutterLf; c.downspouts += p.downspouts; });
        c.withWaste = c.pitched * WASTE; c.squares = c.withWaste / 100;
        c.text = { base: c.base.toFixed(0) + ' sf', pitched: c.pitched.toFixed(0) + ' sf', waste: c.withWaste.toFixed(0) + ' sf', sq: c.squares.toFixed(2) + ' sq', gutter: c.gutterLf.toFixed(1) + ' ft', ds: String(c.downspouts) };
        return { per: per, combined: c };
      },
      on: function (type, fn) {
        if (type !== 'change' || typeof fn !== 'function') return function () {};
        listeners.push(fn);
        return function () { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
      },
      // ── stub-only test hooks ──
      __calls: calls,
      __previewCount: 0,
      __model: function () { return clone(m); },
      __seed: function (next) { m = Object.assign(fresh(), clone(next)); m.armed = !!m.mode; undoStack.length = 0; redoStack.length = 0; changed(); },
    };
    map.nbdDraw = api;
    render();
    document.dispatchEvent(new CustomEvent('nbd:drawmap-ready', { detail: { map: map } }));
  }

  // maps-routing.js declares `drawMap` (a bare global `let`); before it runs
  // the identifier is the #drawMap ELEMENT (named access), so wait for a map.
  var tries = 0;
  var poll = setInterval(function () {
    var map = null;
    try { map = (typeof drawMap !== 'undefined' && drawMap && typeof drawMap.getSize === 'function') ? drawMap : null; } catch (e) { map = null; }
    if (map && window.L && !map.nbdDraw) { clearInterval(poll); attach(map); return; }
    if (++tries > 20 * 60 * 5) clearInterval(poll); // 5 minutes
  }, 50);
}

// Register BEFORE the first navigation.
async function installSeamStub(context) {
  await context.addInitScript(seamStubInit);
}

// Every seam call the crosshair screen makes, with the shape it relies on —
// the list the L4 PR hands to L3.
const SEAM_CALLS = Object.freeze([
  'state', 'totals', 'setMode', 'setCrosshair', 'snap', 'preview', 'placeAtReticle', 'closeShape',
  'finishRun', 'undo', 'redo', 'pick', 'moveVertex', 'retype', 'flip', 'remove', 'on',
]);

module.exports = { installSeamStub, seamStubInit, SEAM_CALLS };

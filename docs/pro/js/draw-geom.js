/**
 * draw-geom.js — pure geometry + totals for the Drawing Tool (NBDDrawGeom).
 *
 * 2026-09-25, draw lane L1 (phone Draw rebuild). The Draw view's math lives
 * inside maps-routing.js's IIFE, where nothing can test it and nothing can
 * share it. This module is the one copy the rebuild moves onto: the plan
 * (documentation, draw campaign 2026-09-25) has L2 route recalc(), the
 * gutter readout and importToEstimate() through here, and L3/L4 read totals
 * from it. In THIS lane it is loaded (drawtool bundle, before
 * maps-routing.js) but nothing calls it, so production behaviour is
 * unchanged — tests/draw-geom.test.js pins it against the live functions.
 *
 * What is a faithful COPY (must not drift — the unit test runs the originals
 * from maps-core.js / maps-routing.js side by side and compares outputs):
 *   hav()            maps-core.js hav (haversine, plan-view feet, R = 20,902,231 ft)
 *   shoelace()       maps-routing.js shoelaceArea (local projection from pts[0])
 *   computeTotals()  maps-routing.js recalc() + recalcGutters(), including the
 *                    readout strings "<int> sf", "<n.nn> sq", "<n.n> ft" that
 *                    8+ consumers parseFloat back out of #cr-* / #gr-*.
 *
 * What is NEW and deliberately different from today's code:
 *   aggregateForEstimate() — the LT-index → estimate-field table. Today's
 *     importToEstimate() maps 1 (Ridge Vent) to valleyLf, 3 (Valley) to
 *     rakeLf and 4 (Rake) to wallLf (audit B7, money). The corrected table
 *     is below; Ridge Vent (1) and Parapet (9) land in fields of their own
 *     until Jo decides whether they count as ridge / wall (open question).
 *   gutterRuns(), mergeCoincidentEndpoints(), uniqueCorners(),
 *   normalizeIds(), stripUndefined(), slopeFactors(), ftPerPx() — helpers
 *     the later lanes need (legacy autosave restore, Save to Customer's
 *     undefined-field throw, run-separated gutters, slope-corrected LF).
 *
 * Contracts (see the campaign plan's output_contracts_to_preserve):
 *   - LT indices 0-10 are stored in Firestore lines[].type and the
 *     localStorage autosave. Never renumber; relabel only.
 *   - Lengths stay plan-view. slopeFactors() is off by default and only
 *     ever feeds NEW, separately named *SlopeLf fields.
 *   - Pure: no DOM, no Leaflet, no clock, no randomness. Points are any
 *     {lat, lng} objects (Leaflet LatLngs or plain JSON).
 *
 * Dual export (window.NBDDrawGeom + module.exports) so node tests can
 * require() it, same pattern as forecast-empirical.js.
 */
(function (root) {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────
  // Earth radius in feet — the constant maps-core.js hav() uses (mean radius,
  // 6,371,009 m). Leaflet's own distanceTo uses 6,378,137 m, which reads
  // ~0.25% longer on area; the app has always used this one.
  const EARTH_R_FT = 20902231;

  // LT table indices (maps-routing.js `LT`). Names only — colours/dash stay
  // with the renderer. Index = the stored lines[].type value.
  const LT_NAMES = Object.freeze([
    'Ridge', 'Ridge Vent', 'Hip', 'Valley', 'Rake', 'Eave',
    'Flashing', 'Step Flash', 'Drip Edge', 'Parapet', 'Gutters'
  ]);
  const LT = Object.freeze({
    RIDGE: 0, RIDGE_VENT: 1, HIP: 2, VALLEY: 3, RAKE: 4, EAVE: 5,
    FLASHING: 6, STEP_FLASH: 7, DRIP_EDGE: 8, PARAPET: 9, GUTTERS: 10
  });

  // #pitchSel option values (dashboard.html). They are sqrt(1+(r/12)^2)
  // rounded to 3 places, so pitchFactor(rise) is NOT byte-equal to them —
  // anything that must match the select uses this table.
  const PITCH_OPTIONS = Object.freeze([
    Object.freeze({ rise: 0, factor: 1.0 }),
    Object.freeze({ rise: 4, factor: 1.054 }),
    Object.freeze({ rise: 5, factor: 1.083 }),
    Object.freeze({ rise: 6, factor: 1.118 }),
    Object.freeze({ rise: 7, factor: 1.158 }),
    Object.freeze({ rise: 8, factor: 1.202 }),
    Object.freeze({ rise: 9, factor: 1.25 }),
    Object.freeze({ rise: 10, factor: 1.302 }),
    Object.freeze({ rise: 11, factor: 1.357 }),
    Object.freeze({ rise: 12, factor: 1.414 })
  ]);
  const DEFAULT_PITCH = 1.202; // 8/12, the #pitchSel default
  const DEFAULT_WASTE = 1.17;  // 17%, the #wasteSel default
  const DOWNSPOUT_LF = 40;     // one downspout per 40 LF of gutter
  // Two stored endpoints closer than this (degrees, both axes) are the same
  // corner. 1e-7 deg is ~1.1 cm of latitude: JSON round-trips and snapped
  // copies land well inside it; two corners a rep meant to be separate are
  // never that close. It is the tolerance addPerimSegment already uses.
  const MERGE_EPS_DEG = 1e-7;
  // Web Mercator metres per pixel at the equator for 256px tiles, zoom 0.
  const MERC_M_PER_PX_Z0 = 156543.03392804097;
  const FT_PER_M = 3.280839895013123;

  // ── Distances and areas (faithful copies) ─────────────────────────
  // Copy of maps-core.js hav(). tests/draw-geom.test.js executes both and
  // requires identical output, so a change to either reddens the suite.
  function hav(a, b) {
    const R = EARTH_R_FT; // Earth radius in feet
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lng - a.lng) * Math.PI / 180;
    const aa = Math.sin(dLat / 2) ** 2
      + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  }

  // Copy of maps-routing.js shoelaceArea(): each point projected to feet from
  // pts[0] (east-west measured at the origin's latitude), then the planar
  // shoelace. Plan-view square feet; under 0.01% distortion at house scale.
  function shoelace(pts) {
    if (!pts || pts.length < 3) return 0;
    const origin = pts[0];
    const toFt = pts.map(function (p) {
      const dx = hav({ lat: origin.lat, lng: p.lng }, { lat: origin.lat, lng: origin.lng });
      const dy = hav({ lat: p.lat, lng: origin.lng }, { lat: origin.lat, lng: origin.lng });
      return { x: p.lng > origin.lng ? dx : -dx, y: p.lat > origin.lat ? dy : -dy };
    });
    let area = 0;
    const n = toFt.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += toFt[i].x * toFt[j].y;
      area -= toFt[j].x * toFt[i].y;
    }
    return Math.abs(area / 2);
  }

  // ── Pitch ──────────────────────────────────────────────────────────
  // Area multiplier for a rise-over-12 pitch: sqrt(1 + (rise/12)^2).
  function pitchFactor(rise) {
    const r = Number(rise);
    if (!Number.isFinite(r) || r <= 0) return 1;
    return Math.sqrt(1 + (r / 12) * (r / 12));
  }

  // Inverse of pitchFactor, rounded to a whole rise — the value V2's import
  // takes as `pitch`. NOTE (2026-09-25): importToEstimate() writes
  // `Math.round(...) || 8`, so a Flat (1.0) drawing reaches V2 as 8/12. This
  // returns 0 for Flat; L2 decides whether the import keeps the `|| 8`.
  function riseFromFactor(m) {
    const f = Number(m);
    if (!Number.isFinite(f) || f <= 1) return 0;
    return Math.round(12 * Math.sqrt(Math.max(0, f * f - 1)));
  }

  // Slope correction for plan-view lengths at a rise-over-12 pitch. A rake
  // climbs the full pitch; a hip/valley runs at 45 deg in plan, so it climbs
  // half as steeply: sqrt(1 + (r/12)^2 / 2). OFF by default — nothing in
  // the app applies these, and the only consumer (aggregateForEstimate with
  // opts.slopeRise) writes NEW *SlopeLf fields, never the existing keys.
  function slopeFactors(rise) {
    const r = Number(rise);
    if (!Number.isFinite(r) || r <= 0) return { rake: 1, hipValley: 1 };
    const t = (r / 12) * (r / 12);
    return { rake: Math.sqrt(1 + t), hipValley: Math.sqrt(1 + t / 2) };
  }

  // Ground feet per CSS pixel on 256px Web Mercator tiles.
  // 39.07 N: z19 0.76, z20 0.38, z21 0.19, z22 0.095.
  function ftPerPx(lat, zoom) {
    return MERC_M_PER_PX_Z0 * Math.cos(Number(lat) * Math.PI / 180) / Math.pow(2, Number(zoom)) * FT_PER_M;
  }

  function downspouts(lf) {
    const v = Number(lf);
    if (!Number.isFinite(v) || v <= 0) return 0;
    return Math.ceil(v / DOWNSPOUT_LF);
  }

  function sumDist(lines, pred) {
    let s = 0;
    for (let i = 0; i < lines.length; i++) { if (pred(lines[i])) s += lines[i].dist; }
    return s;
  }

  // ── Totals (faithful copy of recalc() + recalcGutters()) ──────────
  // lines:  drawnLines-shaped [{type, dist, ...}] (autosave lines work too)
  // facets: [{closed, baseArea, pitch}]
  // pitch / waste: the #pitchSel / #wasteSel VALUES (strings or numbers)
  // opts.perimClosed / opts.perimBaseArea: the in-progress perimeter, which
  //   recalc() adds when it is closed but not yet saved as a facet.
  // The branch order, the (sum/4)^2 line-only guess and the eave x average
  // rake guess are today's behaviour, copied — L2 changes them here and in
  // the app together (the "interim area" fix).
  function computeTotals(lines, facets, pitch, waste, opts) {
    lines = lines || [];
    facets = facets || [];
    opts = opts || {};
    const globalPitch = parseFloat(pitch || DEFAULT_PITCH);
    const w = parseFloat(waste || DEFAULT_WASTE);
    const perimClosed = !!opts.perimClosed;
    const perimBaseArea = Number(opts.perimBaseArea) || 0;
    const eave = lines.filter(function (l) { return l.type === LT.EAVE; });
    const rake = lines.filter(function (l) { return l.type === LT.RAKE; });
    let base = 0, pitched = 0, source = 'none';

    if (facets.length > 0) {
      source = 'facets';
      facets.forEach(function (f) {
        if (f.closed && f.baseArea > 0) {
          base += f.baseArea;
          pitched += f.baseArea * f.pitch;
        }
      });
      if (perimClosed && perimBaseArea > 0 && !facets.find(function (f) { return f.baseArea === perimBaseArea; })) {
        base += perimBaseArea;
        pitched += perimBaseArea * globalPitch;
      }
    } else if (perimClosed && perimBaseArea > 0) {
      source = 'perimeter';
      base = perimBaseArea;
      pitched = base * globalPitch;
    } else if (eave.length && rake.length) {
      source = 'eave-rake';
      base = sumDist(eave, function () { return true; }) * (sumDist(rake, function () { return true; }) / rake.length);
      pitched = base * globalPitch;
    } else if (lines.filter(function (l) { return l.type !== LT.GUTTERS; }).length) {
      source = 'lines';
      const tot = sumDist(lines, function (l) { return l.type !== LT.GUTTERS; });
      base = (tot / 4) * (tot / 4);
      pitched = base * globalPitch;
    }

    const withWaste = pitched * w;
    const squares = withWaste / 100;
    const gutterLf = sumDist(lines, function (l) { return l.type === LT.GUTTERS; });
    // recalcGutters() is Math.ceil(total / 40) with no guard: 0 LF -> 0.
    const ds = Math.ceil(gutterLf / DOWNSPOUT_LF);
    return {
      source: source,
      base: base, pitched: pitched, withWaste: withWaste, squares: squares,
      gutterLf: gutterLf, downspouts: ds,
      // The exact text recalc()/recalcGutters() write into #cr-base,
      // #cr-pitched, #cr-waste, #cr-sq, #gr-total and #gr-ds.
      text: {
        base: base.toFixed(0) + ' sf',
        pitched: pitched.toFixed(0) + ' sf',
        waste: withWaste.toFixed(0) + ' sf',
        sq: squares.toFixed(2) + ' sq',
        gutter: gutterLf.toFixed(1) + ' ft',
        ds: String(ds)
      }
    };
  }

  // ── Endpoint identity ──────────────────────────────────────────────
  function sameCorner(a, b, eps) {
    return Math.abs(a.lat - b.lat) < eps && Math.abs(a.lng - b.lng) < eps;
  }

  // Cluster points into shared corners. Each point joins the FIRST vertex
  // within eps on both axes (compared with that vertex's first point, never
  // a running average), so a chain of near-neighbours cannot creep two
  // distinct corners together. Returns {vertices:[{lat,lng}], index:[i]}.
  function mergeCoincidentEndpoints(points, eps) {
    const e = Number.isFinite(eps) && eps > 0 ? eps : MERGE_EPS_DEG;
    const vertices = [];
    const index = [];
    (points || []).forEach(function (p) {
      // A missing/garbled point is not a corner: -1 keeps later indices aligned.
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) { index.push(-1); return; }
      let hit = -1;
      for (let i = 0; i < vertices.length; i++) {
        if (sameCorner(vertices[i], p, e)) { hit = i; break; }
      }
      if (hit === -1) { vertices.push({ lat: p.lat, lng: p.lng }); hit = vertices.length - 1; }
      index.push(hit);
    });
    return { vertices: vertices, index: index };
  }

  // Every stored point of an autosave-shaped payload ({lines, facets,
  // perimPoints, gutterPoints}), merged into corners. `dotsToday` is how many
  // dots tryRestoreDrawing() creates for the same payload (two per line, one
  // per facet/perimeter/gutter point) — the stacked duplicates the code-map
  // audit counted (9 lines -> 29 dots).
  function uniqueCorners(payload, eps) {
    const d = payload || {};
    const lines = Array.isArray(d.lines) ? d.lines : [];
    const facets = Array.isArray(d.facets) ? d.facets : [];
    const perim = Array.isArray(d.perimPoints) ? d.perimPoints : [];
    const gutter = Array.isArray(d.gutterPoints) ? d.gutterPoints : [];
    const pts = [];
    lines.forEach(function (l) { pts.push(l.p1, l.p2); });
    facets.forEach(function (f) { (f.points || []).forEach(function (p) { pts.push(p); }); });
    perim.forEach(function (p) { pts.push(p); });
    gutter.forEach(function (p) { pts.push(p); });
    const m = mergeCoincidentEndpoints(pts, eps);
    const lineEnds = lines.map(function (_, i) { return [m.index[2 * i], m.index[2 * i + 1]]; });
    return { vertices: m.vertices, lineEnds: lineEnds, dotsToday: pts.length };
  }

  // ── Line ids ───────────────────────────────────────────────────────
  // Legacy ids are Date.now()+Math.random() decimals; the list/popup
  // handlers parseInt them, so they never match (audit B3). Returns COPIES
  // with integer ids — stored data is never rewritten here. A positive safe
  // integer id that is not already taken is kept, so post-fix data is
  // stable across restores; everything else (decimal, duplicate, missing)
  // gets the next integer above every kept id. map: legacy id -> new id,
  // first occurrence wins.
  function normalizeIds(lines, opts) {
    const list = Array.isArray(lines) ? lines : [];
    const start = opts && Number.isSafeInteger(opts.start) && opts.start > 0 ? opts.start : 1;
    const used = new Set();
    const keep = list.map(function (l) {
      const id = l ? l.id : undefined;
      if (Number.isSafeInteger(id) && id > 0 && !used.has(id)) { used.add(id); return true; }
      return false;
    });
    let next = start;
    used.forEach(function (id) { if (id >= next) next = id + 1; });
    const map = new Map();
    const out = list.map(function (l, i) {
      const copy = Object.assign({}, l);
      if (keep[i]) { if (!map.has(l.id)) map.set(l.id, l.id); return copy; }
      const nid = next++;
      if (l && l.id !== undefined && l.id !== null) {
        copy.legacyId = l.id;
        if (!map.has(l.id)) map.set(l.id, nid);
      }
      copy.id = nid;
      return copy;
    });
    return { lines: out, map: map, nextId: next };
  }

  // ── Firestore-safe copy ────────────────────────────────────────────
  // addDoc() rejects `undefined` anywhere in a document (code-map #4: every
  // Save with a facet threw on facets[].name). Deep copy that drops
  // undefined object keys and turns undefined array slots into null (so
  // point indices keep their positions). Only plain objects and arrays are
  // walked: Firestore sentinels (serverTimestamp()), Timestamps, Dates and
  // class instances pass through by reference.
  function isPlainObject(v) {
    if (v === null || typeof v !== 'object') return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  }
  function stripUndefined(v) {
    if (Array.isArray(v)) return v.map(function (x) { return x === undefined ? null : stripUndefined(x); });
    if (isPlainObject(v)) {
      const o = {};
      Object.keys(v).forEach(function (k) { if (v[k] !== undefined) o[k] = stripUndefined(v[k]); });
      return o;
    }
    return v;
  }

  // ── Gutter runs ────────────────────────────────────────────────────
  // Splits type-10 lines into runs. Lines carrying a runId are grouped by it
  // (first-seen order) — that is the model L2 introduces. Without runIds a
  // run breaks wherever a segment does not start on the previous segment's
  // end. NOTE: today's engine chains a new run onto the old one with a real
  // segment (audit B5, +48% LF), which is continuous by construction, so
  // continuity alone cannot find that bridge; only a runId can.
  function gutterRuns(lines, eps) {
    const e = Number.isFinite(eps) && eps > 0 ? eps : MERGE_EPS_DEG;
    const segs = (lines || []).filter(function (l) { return l && l.type === LT.GUTTERS; });
    const runs = [];
    const hasIds = segs.some(function (s) { return s.runId !== undefined && s.runId !== null; });
    if (hasIds) {
      const byId = new Map();
      segs.forEach(function (s) {
        const k = (s.runId === undefined || s.runId === null) ? '__none__' : s.runId;
        if (!byId.has(k)) { byId.set(k, []); }
        byId.get(k).push(s);
      });
      byId.forEach(function (list, k) { runs.push({ runId: k === '__none__' ? null : k, segments: list }); });
    } else {
      segs.forEach(function (s) {
        const cur = runs[runs.length - 1];
        const prev = cur && cur.segments[cur.segments.length - 1];
        if (prev && prev.p2 && s.p1 && sameCorner(prev.p2, s.p1, e)) cur.segments.push(s);
        else runs.push({ runId: null, segments: [s] });
      });
    }
    return runs.map(function (r) {
      const lf = sumDist(r.segments, function () { return true; });
      return { runId: r.runId, lf: lf, segmentCount: r.segments.length, downspouts: downspouts(lf) };
    });
  }

  // ── Estimate import ────────────────────────────────────────────────
  // The corrected LT -> field table (audit B7). Each type lands in exactly
  // one field. The V2 builder reads ridgeLf, hipLf, valleyLf, rakeLf, eaveLf,
  // wallLf and (once the gutter source is decided) guttersLf; the other
  // three fields are carried so nothing is silently dropped, and are NOT V2
  // keys until Jo says where they price.
  const FIELD_BY_TYPE = Object.freeze({
    0: 'ridgeLf', 1: 'ridgeVentLf', 2: 'hipLf', 3: 'valleyLf', 4: 'rakeLf', 5: 'eaveLf',
    6: 'wallLf', 7: 'wallLf', 8: 'dripEdgeLf', 9: 'parapetLf', 10: 'guttersLf'
  });
  const LF_FIELDS = Object.freeze(['ridgeLf', 'hipLf', 'valleyLf', 'rakeLf', 'eaveLf', 'wallLf', 'guttersLf',
    'ridgeVentLf', 'dripEdgeLf', 'parapetLf']);
  // placedAccessories[].type / getAccessoryCounts() keys -> count fields.
  // pipes, chimneys, skylights already exist in V2 state.measurements.
  const ACCESSORY_FIELD = Object.freeze({
    pipe: 'pipes', chimney: 'chimneys', skylight: 'skylights',
    vent: 'vents', satellite: 'satellites', turbine: 'turbines'
  });

  // lines: [{type, dist}]; accessories: placedAccessories-shaped [{type}] OR
  // a counts object {pipe: 2, ...}. opts:
  //   ridgeVentInRidge — count Ridge Vent (1) as ridgeLf (Jo, pending)
  //   parapetInWall    — count Parapet (9) as wallLf (Jo, pending)
  //   slopeRise        — a finite rise adds rakeSlopeLf / hipSlopeLf /
  //                      valleySlopeLf (new keys; off unless passed)
  // LF fields are Math.round(sum), like importToEstimate(); `exact` keeps
  // the unrounded sums. Unknown types/accessories are counted, never guessed.
  function aggregateForEstimate(lines, accessories, opts) {
    opts = opts || {};
    const exact = {};
    LF_FIELDS.forEach(function (f) { exact[f] = 0; });
    let unknownTypes = 0;
    (lines || []).forEach(function (l) {
      if (!l) return;
      let field = FIELD_BY_TYPE[l.type];
      if (l.type === LT.RIDGE_VENT && opts.ridgeVentInRidge) field = 'ridgeLf';
      if (l.type === LT.PARAPET && opts.parapetInWall) field = 'wallLf';
      const d = Number(l.dist);
      if (!field || !Number.isInteger(l.type) || !Number.isFinite(d)) { unknownTypes++; return; }
      exact[field] += d;
    });
    const out = {};
    LF_FIELDS.forEach(function (f) { out[f] = Math.round(exact[f]); });

    const counts = { pipes: 0, chimneys: 0, skylights: 0, vents: 0, satellites: 0, turbines: 0 };
    let unknownAccessories = 0;
    const bump = function (typeId, n) {
      const f = ACCESSORY_FIELD[typeId];
      const k = Number(n);
      if (!f || !Number.isFinite(k) || k < 0) { unknownAccessories++; return; }
      counts[f] += Math.floor(k);
    };
    if (Array.isArray(accessories)) accessories.forEach(function (a) { bump(a && a.type, 1); });
    else if (accessories && typeof accessories === 'object') Object.keys(accessories).forEach(function (k) { bump(k, accessories[k]); });
    Object.assign(out, counts);

    out.downspouts = downspouts(exact.guttersLf);
    if (Number.isFinite(opts.slopeRise) && opts.slopeRise > 0) {
      const sf = slopeFactors(opts.slopeRise);
      out.rakeSlopeLf = Math.round(exact.rakeLf * sf.rake);
      out.hipSlopeLf = Math.round(exact.hipLf * sf.hipValley);
      out.valleySlopeLf = Math.round(exact.valleyLf * sf.hipValley);
    }
    out.exact = exact;
    out.unknownTypes = unknownTypes;
    out.unknownAccessories = unknownAccessories;
    return out;
  }

  const api = Object.freeze({
    VERSION: 1,
    EARTH_R_FT: EARTH_R_FT,
    LT: LT,
    LT_NAMES: LT_NAMES,
    PITCH_OPTIONS: PITCH_OPTIONS,
    DEFAULT_PITCH: DEFAULT_PITCH,
    DEFAULT_WASTE: DEFAULT_WASTE,
    DOWNSPOUT_LF: DOWNSPOUT_LF,
    MERGE_EPS_DEG: MERGE_EPS_DEG,
    FIELD_BY_TYPE: FIELD_BY_TYPE,
    ACCESSORY_FIELD: ACCESSORY_FIELD,
    hav: hav,
    shoelace: shoelace,
    pitchFactor: pitchFactor,
    riseFromFactor: riseFromFactor,
    slopeFactors: slopeFactors,
    ftPerPx: ftPerPx,
    downspouts: downspouts,
    computeTotals: computeTotals,
    gutterRuns: gutterRuns,
    aggregateForEstimate: aggregateForEstimate,
    mergeCoincidentEndpoints: mergeCoincidentEndpoints,
    uniqueCorners: uniqueCorners,
    normalizeIds: normalizeIds,
    stripUndefined: stripUndefined
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.NBDDrawGeom = api;
})(typeof window !== 'undefined' ? window : this);

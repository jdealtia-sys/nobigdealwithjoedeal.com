// docs/pro/js/draw-reticle.js — the phone crosshair screen for the Drawing
// Tool (draw lane L4, 2026-09-25).
//
// WHY THIS EXISTS
// The phone audit (2026-09-25, 412/360 px, real CDP touch) found that placing
// a roof corner by tapping it misses by a fingertip — ~15 px, which is ±3 ft
// at zoom 21 and ±6 ft at zoom 20 — and the finger hides the very corner it
// is placing. Jo's decision 4 (2026-09-25) is the replacement, "like RoofLink":
//   1. a fixed crosshair sits at the map centre; the rep slides the map;
//   2. Add drops a PENDING point at the crosshair — nothing is committed yet;
//   3. the rep fine-tunes it: drag the point with a finger, or nudge the map
//      (a point that has not been dragged stays on the crosshair), while a
//      small round MAGNIFIER shows the imagery around it, zoomed in and
//      offset above the finger so the finger never hides the target;
//   4. Confirm commits it (Cancel throws it away). If the point is no longer
//      at the crosshair, Confirm first pans it there without animation, so
//      the engine's one placement path (placeAtReticle) is the only writer.
// Desktop keeps click-to-place: this file returns before touching anything
// unless (pointer: coarse) matches.
//
// ENGINE SEAM — every read and write goes through drawMap.nbdDraw (seam v1,
// added to maps-routing.js by draw lane L3). This file never touches the
// engine's arrays, layers or globals. Calls used (keep in step with L3):
//   discovery  document 'nbd:drawmap-ready' {detail:{map}}, or drawMap.nbdDraw
//              already present when this file runs (ScriptLoader may run
//              initDrawMap before this bundle entry has executed)
//   state()    {mode, armed, lineType, lineTypes[{name,color}], accessory,
//               anchor, first, openCount, canClose, canFinishRun, canUndo,
//               canRedo, structureId, structures[{id,name}]}
//   totals()   NBDDrawGeom.structureTotals shape {per[], combined{..., text}}
//   setMode(mode|null, {lineType})   arm Outline/Lines/Gutters, or disarm
//   setCrosshair(true)  snap(ll, px)  preview(ll|null)
//   placeAtReticle({edgeType})  closeShape({edgeType})  finishRun()
//   undo()  redo()  pick(ll, px)  moveVertex(from, to)
//   retype(id, lt)  flip(id)  remove(id)  on('change', fn)
//
// INVARIANTS: no new window globals; no inline handlers (addEventListener
// only); the DOM is built here, inside #view-draw .map-area (no template
// edits). Layer / Fit / My Location / Tools proxy the drawer's own controls.
(function () {
  'use strict';

  var coarse = false;
  try { coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { coarse = false; }
  if (!coarse) return;

  var SNAP_PX = 16;        // the engine's snap radius (L3); the ring shows only when it would snap
  var SAME_SPOT_PX = 6;    // the engine refuses a point this close to the last one
  var PICK_PX = 22;        // Edit mode: how far the crosshair may be from a corner / edge
  var LOUPE_UP = 2;        // magnifier zoom = map zoom + 2 (4x; upscaling past native is fine)
  var LOUPE_MAX_Z = 24;
  var LOUPE_GAP = 44;      // px between the point and the magnifier's near edge (clears a fingertip)
  var COACH_KEY = 'nbd_draw_crosshair_coached';
  var DRAW_MODES = { perim: 1, line: 1, gutter: 1 };
  var MODE_CHIPS = [['perim', 'Outline'], ['line', 'Lines'], ['gutter', 'Gutters'], ['edit', 'Edit']];

  // drawMap is maps-routing.js's bare sibling-scope `let`. Before that file
  // runs, the same identifier resolves to the #drawMap ELEMENT (named access
  // on window), so test for a Leaflet map, not for truthiness.
  function findMap() {
    try {
      /* global drawMap */
      if (typeof drawMap !== 'undefined' && drawMap && typeof drawMap.getSize === 'function') return drawMap;
    } catch (e) { /* not declared yet */ }
    return null;
  }

  function start(map) {
    if (!map || map._nbdReticleUi || !window.L) return;
    var api = map.nbdDraw;
    if (!api || typeof api.state !== 'function' || typeof api.placeAtReticle !== 'function') return;
    var container = map.getContainer();
    var area = container && container.closest ? container.closest('.map-area') : null;
    var view = document.getElementById('view-draw');
    if (!area || !view || !view.contains(area)) return;
    map._nbdReticleUi = true;
    buildUi(map, api, area, view);
  }

  document.addEventListener('nbd:drawmap-ready', function (e) {
    start((e && e.detail && e.detail.map) || findMap());
  });
  start(findMap());

  // ── The screen ───────────────────────────────────────────────────────
  function buildUi(map, api, area, view) {
    var L = window.L;
    var st = null;        // cached api.state(), refreshed on 'change'
    var tot = null;       // cached api.totals()
    var uiMode = null;    // 'perim' | 'line' | 'gutter' | 'edit' | null
    var edgeType = 'eave';
    var pending = null;   // {latlng, locked, purpose:'place'|'move', from}
    var drag = null;      // {id, dx, dy, fx, fy}
    var moving = false;   // the map is panning / gliding / zooming
    var snapHit = null;   // L.LatLng the next point would snap to
    var wasSnapped = false;
    var pv = null;        // last api.preview() result
    var previewOn = false;
    var picked = null;    // Edit mode: api.pick() at the crosshair
    var typesFor = null;  // the line-type picker is open for: 'line' | 'retype'
    var sheetOpen = false;
    var raf = 0;
    var loupe = null, loupeLayers = [], loupeBand = null, loupeDirty = true;

    function safe(fn, fallback) {
      try { var r = fn(); return r === undefined ? fallback : r; } catch (e) {
        if (window.console && console.warn) console.warn('[draw-reticle]', e);
        return fallback;
      }
    }
    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }
    function btn(cls, text, label) {
      var b = el('button', cls, text);
      b.type = 'button';
      if (label) b.setAttribute('aria-label', label);
      return b;
    }
    function show(n, on) { if (n) n.hidden = !on; }
    function readState() {
      st = safe(function () { return api.state(); }, null) || {};
      tot = safe(function () { return api.totals(); }, null);
    }

    // ── DOM ──
    var root = el('div', 'dr-root');
    root.setAttribute('data-nbd', 'draw-crosshair');
    var cross = el('div', 'dr-cross');
    cross.setAttribute('aria-hidden', 'true');
    var ring = el('div', 'dr-snap');
    ring.hidden = true;
    var pickRing = el('div', 'dr-snap dr-pickring');
    pickRing.hidden = true;
    var handle = el('div', 'dr-handle');
    handle.hidden = true;
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', 'Pending point — drag to fine-tune');
    var loupeEl = el('div', 'dr-loupe');
    loupeEl.hidden = true;
    loupeEl.setAttribute('aria-hidden', 'true');
    var loupeMapEl = el('div', 'dr-loupe-map');
    loupeEl.appendChild(loupeMapEl);
    loupeEl.appendChild(el('div', 'dr-loupe-x'));
    var coach = el('div', 'dr-coach', 'Slide the map to put the crosshair on a corner, then Add. Drag the point to fine-tune, then Confirm.');
    coach.hidden = true;
    var zoomHint = el('div', 'dr-zoomhint');
    zoomHint.hidden = true;

    var side = el('div', 'dr-side');
    var layerBtn = btn('dr-round', '🗺', 'Switch map layer');
    var fitBtn = btn('dr-round', '⤢', 'Fit the drawing');
    var locBtn = btn('dr-round', '📍', 'My location');
    side.appendChild(layerBtn); side.appendChild(fitBtn); side.appendChild(locBtn);

    var bar = el('div', 'dr-bar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Drawing controls');
    var typesRow = el('div', 'dr-row dr-types');
    typesRow.hidden = true;
    var modes = el('div', 'dr-row dr-modes');
    var modeBtns = {};
    MODE_CHIPS.forEach(function (m) {
      var b = btn('dr-chip dr-mode', m[1]);
      b.setAttribute('data-dr-mode', m[0]);
      b.setAttribute('aria-pressed', 'false');
      modeBtns[m[0]] = b;
      modes.appendChild(b);
    });
    var ctx = el('div', 'dr-row dr-ctx');
    var eaveBtn = btn('dr-chip dr-edge', 'Eave');
    eaveBtn.setAttribute('data-dr-edge', 'eave');
    var rakeBtn = btn('dr-chip dr-edge', 'Rake');
    rakeBtn.setAttribute('data-dr-edge', 'rake');
    var typeBtn = btn('dr-chip dr-type', '', 'Line type');
    var typeDot = el('span', 'dr-dot');
    var typeName = el('span', 'dr-type-name');
    typeBtn.appendChild(typeDot); typeBtn.appendChild(typeName);
    var retypeBtn = btn('dr-chip dr-edit', 'Type');
    retypeBtn.setAttribute('data-dr-act', 'type');
    var flipBtn = btn('dr-chip dr-edit', 'Flip');
    flipBtn.setAttribute('data-dr-act', 'flip');
    var delBtn = btn('dr-chip dr-edit dr-danger', 'Delete');
    delBtn.setAttribute('data-dr-act', 'delete');
    var read = btn('dr-read', '', 'Totals — open the results');
    var readMain = el('span', 'dr-read-main');
    var readSub = el('span', 'dr-read-sub');
    read.appendChild(readMain); read.appendChild(readSub);
    [eaveBtn, rakeBtn, typeBtn, retypeBtn, flipBtn, delBtn, read].forEach(function (n) { ctx.appendChild(n); });
    var acts = el('div', 'dr-row dr-acts');
    var undoBtn = btn('dr-act dr-icon', '↶', 'Undo');
    var redoBtn = btn('dr-act dr-icon', '↷', 'Redo');
    var addBtn = btn('dr-act dr-add', 'Add');
    var auxBtn = btn('dr-act dr-aux', '');
    var cancelBtn = btn('dr-act dr-cancel', 'Cancel');
    var confirmBtn = btn('dr-act dr-confirm', 'Confirm');
    [[undoBtn, 'undo'], [redoBtn, 'redo'], [addBtn, 'add'], [auxBtn, 'aux'], [cancelBtn, 'cancel'], [confirmBtn, 'confirm']].forEach(function (a) {
      a[0].setAttribute('data-dr-act', a[1]);
      acts.appendChild(a[0]);
    });
    bar.appendChild(typesRow); bar.appendChild(modes); bar.appendChild(ctx); bar.appendChild(acts);
    var live = el('div', 'dr-sr');
    live.setAttribute('aria-live', 'polite');

    [cross, ring, pickRing, handle, loupeEl, coach, zoomHint, side, bar, live].forEach(function (n) { root.appendChild(n); });
    area.appendChild(root);
    view.classList.add('dr-on');

    // ── Helpers on the map ──
    function centrePt() { var s = map.getSize(); return L.point(s.x / 2, s.y / 2); }
    function centreLL() { return map.containerPointToLatLng(centrePt()); }
    // Put `ll` under the crosshair at once. `reset` makes Leaflet re-origin
    // the view (<=0.5px rounding per axis); a plain {animate:false} setView
    // to a spot already on screen pans by a TRUNCATED offset — up to 1.4px
    // off, measured 2026-09-25 (vendored Leaflet 1.9.4, _tryAnimatedPan).
    function centreOn(ll) { map.setView(ll, map.getZoom(), { animate: false, reset: true }); }
    function px(ll) { return map.latLngToContainerPoint(ll); }
    function isDrawing() { return !!DRAW_MODES[uiMode] || !!(st && st.accessory); }
    function sameLL(a, b) { return !!a && !!b && Math.abs(a.lat - b.lat) < 1e-10 && Math.abs(a.lng - b.lng) < 1e-10; }
    function ftPerPx() {
      var c = centrePt();
      var a = map.containerPointToLatLng(c), b = map.containerPointToLatLng(c.add([100, 0]));
      return a.distanceTo(b) * 3.28084 / 100;
    }
    function fmtInt(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
    function vibrate() { try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) { /* not on iOS */ } }
    function say(text) { live.textContent = text; }

    // ── The magnifier: a small synced Leaflet map, 2 zooms deeper ──
    function ensureLoupe() {
      if (loupe) return loupe;
      loupe = L.map(loupeMapEl, {
        zoomControl: false, attributionControl: false, dragging: false, touchZoom: false,
        doubleClickZoom: false, scrollWheelZoom: false, boxZoom: false, keyboard: false,
        inertia: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
        zoomSnap: 0, minZoom: 0, maxZoom: LOUPE_MAX_Z,
      });
      loupeBand = L.polyline([], { color: '#fff', weight: 2, dashArray: '5,4', opacity: 0.95, interactive: false });
      loupe.setView(pending ? pending.latlng : map.getCenter(), Math.min(LOUPE_MAX_Z, map.getZoom() + LOUPE_UP), { animate: false });
      loupeBand.addTo(loupe);
      loupeDirty = true;
      return loupe;
    }
    // Mirror whatever base imagery the map shows (Satellite / Street /
    // Hybrid), capped at each source's native zoom so it upscales.
    function syncLoupeLayers() {
      if (!loupe || !loupeDirty) return;
      loupeDirty = false;
      loupeLayers.forEach(function (l) { loupe.removeLayer(l); });
      loupeLayers = [];
      map.eachLayer(function (l) {
        if (!(l instanceof L.TileLayer) || !l._url) return;
        var o = l.options || {};
        var c = L.tileLayer(l._url, {
          subdomains: o.subdomains, opacity: o.opacity, tileSize: o.tileSize, zoomOffset: o.zoomOffset,
          maxNativeZoom: o.maxNativeZoom != null ? o.maxNativeZoom : (o.maxZoom || 19),
          maxZoom: LOUPE_MAX_Z, keepBuffer: 0, updateWhenIdle: false, updateWhenZooming: true,
        });
        c.addTo(loupe);
        loupeLayers.push(c);
      });
    }
    map.on('layeradd layerremove', function (e) { if (e && e.layer instanceof L.TileLayer) loupeDirty = true; });

    function placeLoupe(p, finger) {
      // Shown before the map is built or resized: Leaflet measures its box.
      var wasHidden = loupeEl.hidden;
      loupeEl.hidden = false;
      var lp = ensureLoupe();
      if (wasHidden) lp.invalidateSize({ pan: false });
      syncLoupeLayers();
      var w = root.clientWidth, h = root.clientHeight;
      var d = loupeEl.offsetWidth || 128;
      var r = d / 2;
      var barTop = bar.offsetTop || h;
      // The finger sits at or just below the point; go above both.
      var topY = Math.min(p.y, finger ? finger.y : p.y);
      var cx = p.x, cy = topY - LOUPE_GAP - r;
      if (cy - r < 8) {
        // No room above: beside the point, on the roomier side.
        cx = p.x > w / 2 ? p.x - LOUPE_GAP - r : p.x + LOUPE_GAP + r;
        cy = Math.max(8 + r, Math.min(p.y, barTop - 8 - r));
      }
      cx = Math.max(8 + r, Math.min(w - 8 - r, cx));
      loupeEl.style.transform = 'translate3d(' + (cx - r) + 'px,' + (cy - r) + 'px,0)';
      var z = Math.min(LOUPE_MAX_Z, map.getZoom() + LOUPE_UP);
      lp.setView(pending.latlng, z, { animate: false });
      var anchor = pv && pv.anchor;
      loupeBand.setLatLngs(anchor && isDrawing() ? [anchor, snapHit || pending.latlng] : []);
      var c = lp.getCenter();
      loupeEl.setAttribute('data-lat', String(c.lat));
      loupeEl.setAttribute('data-lng', String(c.lng));
      loupeEl.setAttribute('data-zoom', String(lp.getZoom()));
    }

    function atPx(n, p, half) {
      n.style.transform = 'translate3d(' + (p.x - half) + 'px,' + (p.y - half) + 'px,0)';
    }

    // ── One frame: follow the finger / the map, snap, preview, paint ──
    function schedule() { if (!raf) raf = window.requestAnimationFrame(frame); }
    function frame() {
      raf = 0;
      if (!st) readState();
      var c = centrePt();
      var fingerPt = null;
      if (pending) {
        if (drag && drag.fx != null) {
          var rr = root.getBoundingClientRect();
          fingerPt = L.point(drag.fx - rr.left, drag.fy - rr.top);
          pending.latlng = map.containerPointToLatLng(fingerPt.add([drag.dx, drag.dy]));
        } else if (pending.locked) {
          // Rides the crosshair: shifted by exactly how far the centre has
          // moved since the point was put down (not re-read from the
          // centre, which Leaflet's integer pixel origin rounds by <=0.5px).
          var c0 = map.containerPointToLatLng(c);
          pending.latlng = L.latLng(pending.origin.lat + (c0.lat - pending.base.lat), pending.origin.lng + (c0.lng - pending.base.lng));
        }
      }
      var target = pending ? pending.latlng : map.containerPointToLatLng(c);
      var drawing = isDrawing() && !(pending && pending.purpose === 'move');
      snapHit = null;
      if (drawing && !(st && st.accessory)) {
        var s = safe(function () { return api.snap(target, SNAP_PX); }, null);
        if (s && s.snapped && s.latlng) snapHit = L.latLng(s.latlng.lat, s.latlng.lng);
      }
      if (snapHit && !wasSnapped) vibrate();
      wasSnapped = !!snapHit;
      if (drawing) { pv = safe(function () { return api.preview(snapHit || target); }, null); previewOn = true; }
      else { pv = null; if (previewOn) { safe(function () { api.preview(null); }); previewOn = false; } }
      picked = (uiMode === 'edit' && !pending) ? safe(function () { return api.pick(target, PICK_PX); }, null) : null;

      // Paint the overlays.
      if (snapHit) { atPx(ring, px(snapHit), 17); ring.hidden = false; } else ring.hidden = true;
      if (picked && picked.kind === 'vertex' && picked.latlng) { atPx(pickRing, px(picked.latlng), 17); pickRing.hidden = false; } else pickRing.hidden = true;
      if (pending) {
        var pp = px(pending.latlng);
        atPx(handle, pp, 28);
        handle.hidden = false;
        handle.setAttribute('data-lat', String(pending.latlng.lat));
        handle.setAttribute('data-lng', String(pending.latlng.lng));
        placeLoupe(pp, fingerPt);
      } else {
        handle.hidden = true;
        loupeEl.hidden = true;
      }
      root.classList.toggle('dr-pending', !!pending);
      root.classList.toggle('dr-free', !!(pending && !pending.locked));
      var z = map.getZoom();
      if (z < 20) { zoomHint.textContent = 'Zoom in for accuracy · 1 px ≈ ' + ftPerPx().toFixed(1) + ' ft'; zoomHint.hidden = false; }
      else zoomHint.hidden = true;
      render();
    }

    // ── The bar: labels, enabled state, readout ──
    function anchorGap(ll) {
      if (!st || !st.anchor || !ll) return Infinity;
      return px(ll).distanceTo(px(L.latLng(st.anchor.lat, st.anchor.lng)));
    }
    function closesShape(ll) {
      return uiMode === 'perim' && st && st.first && st.openCount >= 3 && !!ll && sameLL(ll, L.latLng(st.first.lat, st.first.lng));
    }
    function structureName(id) {
      var s = (st.structures || []).filter(function (x) { return x.id === id; })[0];
      return s ? s.name : 'Structure';
    }
    function perStructure(id) {
      return tot && tot.per ? tot.per.filter(function (p) { return p.id === id; })[0] : null;
    }
    function summary() {
      var mine = perStructure(st.structureId);
      var name = structureName(st.structureId);
      if (!mine) return name;
      if (uiMode === 'gutter') return name + ' · ' + (Number(mine.gutterLf) || 0).toFixed(1) + ' ft · ' + (mine.downspouts || 0) + ' downspout' + (mine.downspouts === 1 ? '' : 's');
      return name + ' · ' + fmtInt(mine.base) + ' sf · ' + (Number(mine.squares) || 0).toFixed(2) + ' sq';
    }
    // Jo's decision 3: per-structure totals are always on the bar.
    function jobLine() {
      if (!tot || !tot.combined) return '';
      var c = tot.combined;
      var per = tot.per || [];
      if (per.length > 1) {
        return per.map(function (p) { return p.name + ' ' + (Number(p.squares) || 0).toFixed(2) + ' sq'; }).join(' · ')
          + ' · Job ' + (Number(c.squares) || 0).toFixed(2) + ' sq';
      }
      var parts = ['Job ' + fmtInt(c.base) + ' sf', (Number(c.squares) || 0).toFixed(2) + ' sq'];
      if (c.gutterLf > 0) parts.push((Number(c.gutterLf) || 0).toFixed(1) + ' ft gutter · ' + c.downspouts + ' ds');
      return parts.join(' · ');
    }
    function ltName(i) { var t = (st.lineTypes || [])[i]; return t ? t.name : 'Line'; }
    function ltColor(i) { var t = (st.lineTypes || [])[i]; return t ? t.color : '#888'; }

    function render() {
      if (!st) readState();
      var drawing = isDrawing();
      Object.keys(modeBtns).forEach(function (k) { modeBtns[k].setAttribute('aria-pressed', String(uiMode === k)); });
      eaveBtn.setAttribute('aria-pressed', String(edgeType === 'eave'));
      rakeBtn.setAttribute('aria-pressed', String(edgeType === 'rake'));
      show(eaveBtn, uiMode === 'perim'); show(rakeBtn, uiMode === 'perim');
      show(typeBtn, uiMode === 'line');
      typeName.textContent = ltName(st.lineType || 0);
      typeDot.style.background = ltColor(st.lineType || 0);
      var edge = picked && picked.kind === 'edge' ? picked : null;
      show(retypeBtn, uiMode === 'edit' && !!edge && !pending);
      show(delBtn, uiMode === 'edit' && !!edge && !pending);
      show(flipBtn, uiMode === 'edit' && !!edge && !pending && (edge.type === 4 || edge.type === 5));

      // Readout: the live length while aiming / adjusting, else this
      // structure's total; the second line is always the per-structure / job
      // totals.
      var aim = pending ? (snapHit || pending.latlng) : (snapHit || centreLL());
      var gap = drawing ? anchorGap(aim) : Infinity;
      var sameSpot = gap < SAME_SPOT_PX;
      var main;
      // Right after a Confirm the crosshair sits ON the new point, so the
      // idle case is guidance, not a warning.
      if (sameSpot && pending) main = 'Same spot as the last point — drag it off, or Cancel';
      else if (sameSpot) main = 'On the last point — slide to the next one';
      else if (pending && pending.purpose === 'move') main = 'Moving corner — drag it, then Drop';
      else if (st.accessory && drawing) main = 'Place ' + st.accessory + ' at the crosshair';
      else if (drawing && pv && pv.anchor) {
        var seg = Number(pv.segmentFt) || 0, run = Number(pv.runFt) || 0;
        main = (closesShape(aim) ? 'Close · ' : '') + seg.toFixed(1) + ' ft' + (run > seg + 0.05 ? ' · run ' + run.toFixed(1) + ' ft' : '');
      } else if (uiMode === 'edit') {
        main = edge ? edge.name + ' · ' + (Number(edge.dist) || 0).toFixed(1) + ' ft'
          : (picked && picked.kind === 'vertex' ? 'Corner · on ' + (picked.count || 1) + ' line' + (picked.count === 1 ? '' : 's') : 'Aim at a corner or an edge');
      } else if (!uiMode) main = 'Pick Outline, Lines or Gutters';
      else main = summary();
      readMain.textContent = main;
      readSub.textContent = jobLine();

      // Buttons.
      var blocked = sheetOpen || moving;
      show(undoBtn, !pending); show(redoBtn, !pending); show(addBtn, !pending);
      show(cancelBtn, !!pending); show(confirmBtn, !!pending);
      undoBtn.disabled = !st.canUndo || sheetOpen;
      redoBtn.disabled = !st.canRedo || sheetOpen;
      var addLabel = 'Add';
      if (uiMode === 'edit') addLabel = 'Move corner';
      else if (st.accessory && drawing) addLabel = 'Place ' + st.accessory;
      else if (uiMode === 'perim') addLabel = closesShape(aim) ? 'Close' : 'Add corner';
      else if (uiMode === 'line') addLabel = st.anchor ? 'End line' : 'Start line';
      else if (uiMode === 'gutter') addLabel = st.anchor ? 'Add gutter point' : 'Start gutter run';
      addBtn.textContent = addLabel;
      addBtn.disabled = blocked || (uiMode === 'edit' ? !(picked && picked.kind === 'vertex') : (!drawing || sameSpot));
      var confirmLabel = 'Confirm';
      if (pending && pending.purpose === 'move') confirmLabel = 'Drop';
      else if (closesShape(aim)) confirmLabel = 'Confirm close';
      confirmBtn.textContent = '✓ ' + confirmLabel;
      confirmBtn.disabled = !pending || blocked || (pending.purpose === 'place' && sameSpot);
      var aux = '';
      if (!pending && uiMode === 'perim' && st.canClose) aux = 'Close shape';
      else if (!pending && uiMode === 'gutter' && st.canFinishRun) aux = 'Finish run';
      auxBtn.textContent = aux;
      show(auxBtn, !!aux);
      auxBtn.disabled = blocked;
      root.classList.toggle('dr-sheet-open', sheetOpen);
    }

    // ── Actions ──
    function setUiMode(m) {
      if (pending) cancelPending();
      closeTypes();
      uiMode = m;
      if (m === 'edit' || !m) safe(function () { api.setMode(null); });
      else safe(function () { api.setMode(m, { lineType: st && st.lineType }); });
      readState();
      schedule();
    }
    function cancelPending() {
      pending = null;
      drag = null;
      schedule();
    }
    function onAdd() {
      if (addBtn.disabled) return;
      closeTypes();
      if (uiMode === 'edit') {
        if (!picked || picked.kind !== 'vertex') return;
        var from = L.latLng(picked.latlng.lat, picked.latlng.lng);
        // Bring the corner to the crosshair, then it follows the crosshair
        // (nudge the map) until the rep drags it.
        centreOn(from);
        pending = { latlng: from, origin: from, base: centreLL(), locked: true, purpose: 'move', from: from };
      } else {
        var here = centreLL();
        pending = { latlng: here, origin: here, base: here, locked: true, purpose: 'place' };
      }
      say(uiMode === 'edit' ? 'Moving corner' : 'Point pending — adjust it, then Confirm');
      schedule();
    }
    function onConfirm() {
      if (confirmBtn.disabled || !pending) return;
      safe(function () { map.stop(); });
      if (pending.purpose === 'move') {
        var to = pending.latlng, from = pending.from;
        var mv = safe(function () { return api.moveVertex(from, to); }, { ok: true });
        if (mv && mv.ok === false) { say('Could not move that corner'); return; }
        pending = null; say('Corner moved'); readState(); schedule();
        return;
      }
      var target = snapHit || pending.latlng;
      // Jo's flow: the engine places only at the crosshair. A point the rep
      // dragged is brought there first, without animation, so nothing is
      // gliding when it commits.
      if (px(target).distanceTo(centrePt()) > 0.5) centreOn(target);
      var res = safe(function () { return api.placeAtReticle({ edgeType: edgeType }); }, { ok: true });
      if (res && res.ok === false) {
        readMain.textContent = res.reason === 'same-spot' ? 'Same spot as the last point — slide or zoom in'
          : res.reason === 'moving' ? 'Wait for the map to stop' : 'Could not place the point';
        return;
      }
      pending = null;
      coachDone();
      say('Point added');
      readState();
      schedule();
    }
    function onAux() {
      if (auxBtn.disabled) return;
      if (uiMode === 'perim') safe(function () { api.closeShape({ edgeType: edgeType }); });
      else if (uiMode === 'gutter') safe(function () { api.finishRun(); });
      readState();
      schedule();
    }

    // Line-type picker: Lines mode (which type to draw) and Edit > Type.
    function openTypes(forWhat) {
      typesFor = forWhat;
      typesRow.textContent = '';
      (st.lineTypes || []).forEach(function (t, i) {
        var b = btn('dr-chip dr-typechip', '');
        var d = el('span', 'dr-dot');
        d.style.background = t.color;
        b.appendChild(d);
        b.appendChild(el('span', '', t.name));
        b.setAttribute('data-dr-lt', String(i));
        var current = forWhat === 'line' ? st.lineType : (picked && picked.type);
        b.setAttribute('aria-pressed', String(current === i));
        typesRow.appendChild(b);
      });
      typesRow.hidden = false;
      measure();
    }
    function closeTypes() {
      if (!typesFor) return;
      typesFor = null;
      typesRow.hidden = true;
      measure();
    }
    function pickType(i) {
      if (typesFor === 'line') safe(function () { api.setMode('line', { lineType: i }); });
      else if (typesFor === 'retype' && picked && picked.kind === 'edge') {
        var id = picked.id;
        safe(function () { api.retype(id, i); });
      }
      closeTypes();
      readState();
      schedule();
    }

    // ── Wiring (addEventListener only — strict CSP) ──
    modes.addEventListener('click', function (e) {
      var b = e.target.closest('[data-dr-mode]');
      if (b) setUiMode(b.getAttribute('data-dr-mode'));
    });
    ctx.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b === eaveBtn || b === rakeBtn) { edgeType = b.getAttribute('data-dr-edge'); schedule(); }
      else if (b === typeBtn) { if (typesFor === 'line') closeTypes(); else openTypes('line'); }
      else if (b === retypeBtn) { if (typesFor === 'retype') closeTypes(); else openTypes('retype'); }
      else if (b === flipBtn && picked && picked.kind === 'edge') { var fid = picked.id; safe(function () { api.flip(fid); }); readState(); schedule(); }
      else if (b === delBtn && picked && picked.kind === 'edge') { var did = picked.id; safe(function () { api.remove(did); }); readState(); schedule(); }
      else if (b === read) openResults();
    });
    typesRow.addEventListener('click', function (e) {
      var b = e.target.closest('[data-dr-lt]');
      if (b) pickType(Number(b.getAttribute('data-dr-lt')));
    });
    addBtn.addEventListener('click', onAdd);
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', function () { cancelPending(); say('Point discarded'); });
    auxBtn.addEventListener('click', onAux);
    undoBtn.addEventListener('click', function () { safe(function () { api.undo(); }); readState(); schedule(); });
    redoBtn.addEventListener('click', function () { safe(function () { api.redo(); }); readState(); schedule(); });
    // The drawer's own controls stay the one implementation of each.
    function proxy(sel) { var b = document.querySelector(sel); if (b) b.click(); }
    layerBtn.addEventListener('click', function () { proxy('#layerToggleBtn'); });
    fitBtn.addEventListener('click', function () { proxy('#map-sidebar-draw [data-fn="zoomToFit"]'); });
    locBtn.addEventListener('click', function () { proxy('#myLocBtn'); });

    // Drag the pending point. Pointer events with capture: the finger keeps
    // the point even when it slides off the 56px handle, and the map never
    // sees the gesture (the handle sits outside the Leaflet container).
    handle.addEventListener('pointerdown', function (e) {
      if (!pending || (e.isPrimary === false)) return;
      e.preventDefault();
      e.stopPropagation();
      var rr = root.getBoundingClientRect();
      var hp = px(pending.latlng);
      drag = { id: e.pointerId, dx: hp.x - (e.clientX - rr.left), dy: hp.y - (e.clientY - rr.top), fx: e.clientX, fy: e.clientY };
      pending.locked = false;
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
      root.classList.add('dr-dragging');
      schedule();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      drag.fx = e.clientX; drag.fy = e.clientY;
      schedule();
    });
    function endDrag(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      drag = null;
      root.classList.remove('dr-dragging');
      schedule();
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('lostpointercapture', endDrag);
    // 2026-09-25: touch-action:none alone still let Chromium turn a drag
    // released mid-motion into a fling, and the NEXT tap — Confirm — was
    // eaten as the tap that stops the fling (measured: no click even 300ms
    // later). Consuming the handle's own touches means no scroll gesture,
    // so no fling. Pointer events are dispatched first and are unaffected.
    var eat = function (e) { if (e.cancelable) e.preventDefault(); };
    handle.addEventListener('touchstart', eat, { passive: false });
    handle.addEventListener('touchmove', eat, { passive: false });

    // ── The map ──
    map.on('movestart zoomstart', function () { moving = true; schedule(); });
    map.on('moveend zoomend', function () { moving = false; schedule(); });
    map.on('move zoom viewreset resize', schedule);
    if (typeof api.on === 'function') api.on('change', function () { readState(); schedule(); });

    // ── Tools sheet: Add waits while it is open; the readout opens it on
    // the results ──
    var sheet = document.getElementById('map-sidebar-draw');
    function syncSheet() {
      var open = !!(sheet && sheet.classList.contains('open'));
      if (open === sheetOpen) return;
      sheetOpen = open;
      if (open && pending) cancelPending();
      closeTypes();
      schedule();
    }
    if (sheet && window.MutationObserver) new MutationObserver(syncSheet).observe(sheet, { attributes: true, attributeFilter: ['class'] });
    function openResults() {
      var toolsBtn = area.querySelector('.map-toggle-btn');
      if (sheet && !sheet.classList.contains('open') && toolsBtn) toolsBtn.click();
      var res = sheet && sheet.querySelector('.calc-result');
      if (res) window.setTimeout(function () { sheet.scrollTop = Math.max(0, res.offsetTop - 60); }, 320);
    }

    // ── Where the bar may sit: above the app's bottom nav and Leaflet's
    // attribution strip; toasts lift above the bar while Draw is on screen ──
    function measure() {
      var a = area.getBoundingClientRect();
      var floor = 0;
      var nav = document.getElementById('mobile-nav');
      var navOn = false;
      if (nav) {
        var cs = window.getComputedStyle(nav);
        var nr = nav.getBoundingClientRect();
        navOn = cs.display !== 'none' && cs.visibility !== 'hidden' && nr.height > 0;
        if (navOn) floor = Math.max(0, a.bottom - nr.top);
      }
      if (!navOn) floor = safeAreaBottom();
      view.style.setProperty('--dr-floor', Math.round(floor) + 'px');
      var active = view.classList.contains('active') && a.height > 0;
      document.body.classList.toggle('dr-bar-on', active);
      if (active) {
        var br = bar.getBoundingClientRect();
        document.body.style.setProperty('--dr-toast-bottom', Math.round(window.innerHeight - br.top + 8) + 'px');
      }
      if (loupe && !loupeEl.hidden) loupe.invalidateSize({ pan: false });
      schedule();
    }
    var probe = null;
    function safeAreaBottom() {
      if (!probe) { probe = el('div', 'dr-safe-probe'); root.appendChild(probe); }
      return probe.offsetHeight || 0;
    }
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    if (window.ResizeObserver) new window.ResizeObserver(measure).observe(area);
    if (window.MutationObserver) new MutationObserver(measure).observe(view, { attributes: true, attributeFilter: ['class'] });

    // ── First use: one line of help ──
    var coached = false;
    try { coached = !!window.localStorage.getItem(COACH_KEY); } catch (e) { coached = false; }
    var coachTimer = 0;
    if (!coached) { coach.hidden = false; coachTimer = window.setTimeout(coachDone, 12000); }
    function coachDone() {
      if (coach.hidden) return;
      coach.hidden = true;
      window.clearTimeout(coachTimer);
      try { window.localStorage.setItem(COACH_KEY, '1'); } catch (e) { /* private mode: shows again next time */ }
    }

    // ── Go ──
    safe(function () { api.setCrosshair(true); });
    readState();
    if (st.armed && DRAW_MODES[st.mode]) uiMode = st.mode;
    if (typeof api.on === 'function') api.on('change', function () {
      // The drawer (inside Tools) can arm a mode too: follow it.
      if (uiMode !== 'edit') uiMode = st.armed && DRAW_MODES[st.mode] ? st.mode : (st.armed ? uiMode : null);
    });
    measure();
    syncSheet();
    schedule();
  }
})();

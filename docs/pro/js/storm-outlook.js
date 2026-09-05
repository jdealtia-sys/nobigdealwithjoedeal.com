/**
 * storm-outlook.js — today's SPC severe-weather outlook on the Storm Center map.
 *
 * Storm Center shows what is happening now (active NWS alerts) and what already
 * happened (hail history). It has never shown what is coming. The Storm
 * Prediction Center publishes the Day-1 convective outlook as GeoJSON, free and
 * keyless, and that is the single most useful pre-positioning signal a roofer
 * has: "there is a Slight Risk with a 15% hail probability over your territory
 * today" is a reason to hold the crew nearby, hours before any alert fires.
 *
 * Endpoints (VERIFIED LIVE 2026-09-05 — the research note's
 * `day1probotlk_*.nolyr.geojson` names 404; the working names are these):
 *   https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson
 *   https://www.spc.noaa.gov/products/outlook/day1otlk_hail.nolyr.geojson
 *
 * Each is a FeatureCollection of MultiPolygons whose properties carry
 * DN (an ordered risk level), LABEL ('SLGT', '0.05'), LABEL2 ('Slight Risk',
 * '5% Hail Risk'), VALID/EXPIRE/ISSUE plus *_ISO forms, FORECASTER, and — very
 * usefully — SPC's own `stroke` and `fill` colours, so the map matches every
 * other outlook graphic a rep has ever seen.
 *
 * Caching is keyed on EXPIRE_ISO rather than a fixed TTL: SPC reissues on a
 * fixed cycle (0100/1200/1300/1630/2000Z), so "expired" is a fact the payload
 * states rather than something to guess at.
 *
 * Everything a test needs is pure and exported on window.StormOutlook.
 */
(function () {
  'use strict';

  const __NBD_LOADED = window.__NBD_LOADED = window.__NBD_LOADED || {};
  if (__NBD_LOADED['storm-outlook']) return;
  __NBD_LOADED['storm-outlook'] = true;

  const BASE = 'https://www.spc.noaa.gov/products/outlook/';
  const CAT_URL = BASE + 'day1otlk_cat.nolyr.geojson';
  const HAIL_URL = BASE + 'day1otlk_hail.nolyr.geojson';
  const CACHE_KEY = 'nbd_spc_day1';
  const UA_HEADERS = { 'Accept': 'application/geo+json' };
  const FETCH_TIMEOUT_MS = 12000;

  // Module state — read by storm-center.js when it paints the map.
  let state = { cat: [], hail: [], fetchedAt: 0, expiresAt: 0 };

  // ── pure helpers ───────────────────────────────────────────────

  /**
   * Ray-casting point-in-polygon over a GeoJSON linear ring ([lng, lat] pairs).
   * storm-integration.js has a [lat, lng] version; this one takes GeoJSON order
   * so no coordinate swapping is needed on the way in — swapping thousands of
   * outlook vertices per paint was the alternative.
   */
  function pointInRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersects = ((yi > lat) !== (yj > lat))
        && (lng < (xj - xi) * (lat - yi) / ((yj - yi) || Number.MIN_VALUE) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  /**
   * True when the point falls inside a Polygon/MultiPolygon geometry, holes
   * respected — an outlook polygon with a hole punched in it genuinely means
   * "not this bit".
   */
  function pointInGeometry(lng, lat, geometry) {
    if (!geometry) return false;
    const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates
      : geometry.type === 'Polygon' ? [geometry.coordinates]
        : [];
    for (const rings of polys) {
      if (!rings || !rings.length) continue;
      if (!pointInRing(lng, lat, rings[0])) continue;      // outside the outer ring
      let inHole = false;
      for (let h = 1; h < rings.length; h++) {
        if (pointInRing(lng, lat, rings[h])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
    return false;
  }

  /**
   * The highest-DN feature containing the point, or null. SPC's DN is ordered
   * (2 TSTM < 3 MRGL < 4 SLGT < 5 ENH < 6 MDT < 8 HIGH), and its polygons
   * nest, so the point is usually inside several — the worst one is the answer.
   */
  function highestAt(features, lat, lng) {
    let best = null;
    for (const f of features || []) {
      if (!f || !f.properties) continue;
      if (!pointInGeometry(lng, lat, f.geometry)) continue;
      const dn = Number(f.properties.DN) || 0;
      if (!best || dn > (Number(best.properties.DN) || 0)) best = f;
    }
    return best;
  }

  /** Has this outlook run expired? EXPIRE_ISO is the payload's own answer. */
  function isExpired(cached, nowMs) {
    if (!cached || !cached.expiresAt) return true;
    return nowMs >= cached.expiresAt;
  }

  function expiryOf(features) {
    for (const f of features || []) {
      const iso = f && f.properties && f.properties.EXPIRE_ISO;
      const t = iso ? Date.parse(iso) : NaN;
      if (Number.isFinite(t)) return t;
    }
    return 0;
  }

  /**
   * One line for the header chip: the categorical risk plus the hail
   * probability at the rep's location. Returns null when the point is outside
   * every polygon — which is the normal case on a quiet day and must read as
   * "nothing", not as an error or a zero.
   */
  function summarizeAt(st, lat, lng) {
    if (!st) return null;
    const cat = highestAt(st.cat, lat, lng);
    const hail = highestAt(st.hail, lat, lng);
    if (!cat && !hail) return null;
    const catLabel = cat ? String(cat.properties.LABEL2 || cat.properties.LABEL || '') : '';
    // Hail LABEL is a probability as a decimal string ('0.05' → 5%).
    let hailLabel = '';
    if (hail) {
      const pct = Number(hail.properties.LABEL);
      hailLabel = Number.isFinite(pct) ? Math.round(pct * 100) + '% hail'
        : String(hail.properties.LABEL2 || '');
    }
    return {
      text: [catLabel, hailLabel].filter(Boolean).join(' · '),
      dn: cat ? Number(cat.properties.DN) || 0 : 0,
      color: cat ? String(cat.properties.stroke || '') : (hail ? String(hail.properties.stroke || '') : ''),
      hailPct: hail && Number.isFinite(Number(hail.properties.LABEL))
        ? Math.round(Number(hail.properties.LABEL) * 100) : null,
    };
  }

  // ── I/O ────────────────────────────────────────────────────────

  function readCache(nowMs) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (isExpired(c, nowMs)) return null;
      return c;
    } catch (e) { return null; }
  }

  function writeCache(st) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(st)); } catch (e) { /* quota/private mode */ }
  }

  async function fetchCollection(url) {
    const res = await fetch(url, { headers: UA_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error('SPC ' + res.status);
    const data = await res.json();
    return (data && Array.isArray(data.features)) ? data.features : [];
  }

  /**
   * Load today's outlook. Never throws: the Storm Center must render with or
   * without it, and an SPC outage is not a reason to show the rep an error on
   * a page whose whole job is the other two data sources.
   */
  async function load(opts) {
    const now = (opts && Number.isFinite(opts.nowMs)) ? opts.nowMs : Date.now();
    const cached = readCache(now);
    if (cached) { state = cached; return state; }
    try {
      const [cat, hail] = await Promise.all([fetchCollection(CAT_URL), fetchCollection(HAIL_URL)]);
      state = { cat, hail, fetchedAt: now, expiresAt: expiryOf(cat) || expiryOf(hail) || 0 };
      writeCache(state);
    } catch (e) {
      console.warn('[StormOutlook] SPC fetch failed:', (e && e.message) || e);
      // Keep whatever we had; an empty state simply draws nothing.
    }
    return state;
  }

  /**
   * Draw the outlook into a Leaflet layer group. SPC ships its own stroke/fill
   * per feature, so the map matches the outlook graphics reps already know.
   * Lowest risk first, so the worst polygon ends up on top.
   */
  function draw(L, layerGroup, st) {
    const s = st || state;
    if (!L || !layerGroup || !s) return 0;
    let drawn = 0;
    const ordered = (s.cat || []).slice().sort(
      (a, b) => (Number(a.properties.DN) || 0) - (Number(b.properties.DN) || 0));
    for (const f of ordered) {
      try {
        const p = f.properties || {};
        L.geoJSON(f, {
          style: {
            color: p.stroke || '#888',
            fillColor: p.fill || p.stroke || '#888',
            fillOpacity: 0.12,
            weight: 1,
          },
        }).bindPopup(
          '<strong>' + esc(p.LABEL2 || p.LABEL || 'Outlook') + '</strong><br>'
          + 'SPC Day 1 · valid to ' + esc(shortTime(p.EXPIRE_ISO))
        ).addTo(layerGroup);
        drawn++;
      } catch (e) { /* one bad feature must not stop the rest */ }
    }
    return drawn;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function shortTime(iso) {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t)) return 'today';
    try { return new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric' }); }
    catch (e) { return 'today'; }
  }

  window.StormOutlook = {
    load,
    draw,
    getState: () => state,
    summarizeAt: (lat, lng) => summarizeAt(state, lat, lng),
    // pure, exported for tests/storm-outlook.test.js
    _pointInRing: pointInRing,
    _pointInGeometry: pointInGeometry,
    _highestAt: highestAt,
    _isExpired: isExpired,
    _expiryOf: expiryOf,
    _summarizeAt: summarizeAt,
    _urls: { CAT_URL, HAIL_URL, CACHE_KEY },
  };
})();

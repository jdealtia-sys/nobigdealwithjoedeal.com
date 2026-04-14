/**
 * integrations/hail.js — hail / storm swath data source
 *
 * Two providers, both live:
 *   hailtrace (premium)    — paid subscription, polygon swaths per storm
 *   noaa      (free)       — NOAA Storm Prediction Center Storm Events
 *                            database. Free, but ~3-month delay on
 *                            verified data.
 *
 * NOAA is the default so the feature works out-of-the-box. HailTrace
 * provides real-time within ~15 min of storm end.
 *
 * Used for the D2D pitch: "your neighborhood had verified 1.5"+ hail
 * 6 weeks ago — here's the polygon and the timestamp."
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { getSecret, hasSecret, PROVIDERS, SECRETS } = require('./_shared');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nbd-pro.web.app'
];

// NOAA Storm Events CSV endpoint. Per-year files. We query by
// lat/lng bounding box + event type `Hail` then filter by distance.
// For a demo/zero-cost deployment, keep a rolling 12-month window.
async function fetchNoaaHail(lat, lng, radiusMi, daysBack) {
  // The NOAA Storm Events DB isn't a query-by-location API — it's
  // a bulk CSV. For real-time-ish use we hit their newer endpoint:
  // https://api.weather.gov is preferred for active alerts. For
  // hail history, use the IEM (Iowa Environmental Mesonet) JSON
  // service which wraps NWS Storm Events data.
  const tsEnd = new Date();
  const tsStart = new Date(tsEnd.getTime() - daysBack * 86_400_000);
  const fmt = (d) => d.toISOString().slice(0, 10);

  // Build a small bbox (degrees) approximately matching radiusMi.
  // Rough: 1deg lat ≈ 69mi, 1deg lng ≈ 69 * cos(lat) mi.
  const latDelta = radiusMi / 69;
  const lngDelta = radiusMi / (69 * Math.cos(lat * Math.PI / 180));

  const url = 'https://mesonet.agron.iastate.edu/geojson/lsr.php?'
    + 'sts=' + encodeURIComponent(fmt(tsStart) + 'T00:00')
    + '&ets=' + encodeURIComponent(fmt(tsEnd) + 'T23:59')
    + '&type%5B%5D=H'  // hail
    + '&minlat=' + (lat - latDelta).toFixed(4)
    + '&maxlat=' + (lat + latDelta).toFixed(4)
    + '&minlon=' + (lng - lngDelta).toFixed(4)
    + '&maxlon=' + (lng + lngDelta).toFixed(4);

  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('NOAA/IEM ' + res.status);
  const geo = await res.json();
  const features = (geo && geo.features) || [];
  return features.map(f => {
    const p = f.properties || {};
    const g = f.geometry && f.geometry.coordinates; // [lng,lat]
    return {
      at:   p.valid || p.utc_valid || null,
      lat:  Array.isArray(g) ? g[1] : null,
      lng:  Array.isArray(g) ? g[0] : null,
      sizeInches: parseFloat(p.magnitude) || null,
      source: p.source || 'noaa',
      remark: p.remark || null
    };
  }).filter(h => h.lat != null && h.lng != null);
}

async function fetchHailTrace(lat, lng, radiusMi, daysBack) {
  const key = getSecret('HAILTRACE_API_KEY');
  const url = 'https://api.hailtrace.com/v1/hail/query?'
    + 'lat=' + encodeURIComponent(lat)
    + '&lon=' + encodeURIComponent(lng)
    + '&radius_mi=' + encodeURIComponent(radiusMi)
    + '&days=' + encodeURIComponent(daysBack);
  const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + key } });
  if (!res.ok) throw new Error('HailTrace ' + res.status);
  const data = await res.json();
  // Normalize — HailTrace returns `events`, each with
  // { start_time, end_time, polygon, max_size, storm_id }.
  return (data.events || []).map(e => ({
    at: e.start_time,
    lat: (e.centroid && e.centroid.lat) || null,
    lng: (e.centroid && e.centroid.lng) || null,
    sizeInches: e.max_size || null,
    polygon: e.polygon || null,
    source: 'hailtrace',
    stormId: e.storm_id
  }));
}

// ─── Callable: getHailHistory ─────────────────────────────
exports.getHailHistory = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 20,
    memory: '256MiB',
    secrets: [SECRETS.HAILTRACE_API_KEY]
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    const lat = parseFloat(request.data && request.data.lat);
    const lng = parseFloat(request.data && request.data.lng);
    const radiusMi = Math.min(50, Math.max(0.5, parseFloat(request.data && request.data.radiusMi) || 3));
    const daysBack = Math.min(730, Math.max(7, parseInt(request.data && request.data.daysBack) || 365));

    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new HttpsError('invalid-argument', 'Valid lat/lng required');
    }

    const preferredProvider = PROVIDERS.hail === 'hailtrace' && hasSecret('HAILTRACE_API_KEY')
      ? 'hailtrace' : 'noaa';

    try {
      const hits = preferredProvider === 'hailtrace'
        ? await fetchHailTrace(lat, lng, radiusMi, daysBack)
        : await fetchNoaaHail(lat, lng, radiusMi, daysBack);
      return {
        success: true,
        provider: preferredProvider,
        lat, lng, radiusMi, daysBack,
        hits,
        count: hits.length,
        maxSizeInches: hits.reduce((m, h) => Math.max(m, h.sizeInches || 0), 0)
      };
    } catch (e) {
      logger.warn('getHailHistory failed:', e.message);
      // Try fallback once if primary was hailtrace.
      if (preferredProvider === 'hailtrace') {
        try {
          const hits = await fetchNoaaHail(lat, lng, radiusMi, daysBack);
          return { success: true, provider: 'noaa-fallback', lat, lng, radiusMi, daysBack, hits, count: hits.length };
        } catch (e2) { /* fall through */ }
      }
      throw new HttpsError('unavailable', 'Hail lookup failed');
    }
  }
);

module.exports = exports;

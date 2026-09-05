/**
 * integrations/swdi-hail.js — NCEI Severe Weather Data Inventory, `nx3hail`
 *
 * Radar-derived hail signatures (NEXRAD Level-III Hail Index) per storm
 * cell: probability of hail, probability of SEVERE hail, and maximum
 * expected hail size in inches, with the radar site, cell id and time.
 * Free, keyless, no published quota. This is the same class of signal the
 * paid swath vendors resell, so it is the honest "your street took 1.75 in
 * on this date" pitch for any address, not only where a spotter filed a
 * report (the IEM LSR feed behind the 'noaa' provider is ground reports).
 *
 * Service facts — measured against the live endpoint 2026-09-04, not read
 * off a doc page:
 *   - URL: https://www.ncei.noaa.gov/swdiws/json/nx3hail/{start}:{end}?bbox=minLon,minLat,maxLon,maxLat
 *   - Dates are YYYYMMDD in UTC. The END DAY IS EXCLUSIVE: `20260516:20260517`
 *     returns a 2026-05-16T13:13Z cell, `20260516:20260516` returns nothing.
 *   - A single request may span at most 744 hours (31 days). Longer ranges
 *     are rejected with HTTP 500 and an `error` string. The research note
 *     that scoped this work called the range "unlimited" — it is not, so
 *     the fetcher chunks the range into contiguous ≤31-day windows.
 *   - Rows: { ZTIME, SHAPE: "POINT (lng lat)", WSR_ID, CELL_ID, PROB,
 *     SEVPROB, MAXSIZE } — all strings. An empty window is
 *     `{ result: [], summary: { count: 0 } }`, still HTTP 200.
 *   - bbox is a rectangle; the radius the caller asked for is enforced here
 *     with a haversine filter so a 3-mile query does not return the corners
 *     of a 6-mile square.
 *
 * Contract: fetchSwdiHail(lat, lng, radiusMi, daysBack) → hits[] in the
 * shape hail.js's other fetchers return ({ at, lat, lng, sizeInches,
 * source, remark, … }). Throws on transport/HTTP failure so lookupHail's
 * existing NOAA fallback path engages. The pure helpers are exported for
 * tests/swdi-hail.test.js.
 */

'use strict';

const SWDI_BASE = 'https://www.ncei.noaa.gov/swdiws/json/nx3hail/';
// Service maximum is 744 h = 31 days; 30 keeps a day of margin and makes the
// arithmetic obvious. Windows are contiguous half-open intervals [start, end).
const WINDOW_DAYS = 30;
const CONCURRENCY = 4;
const DAY_MS = 86_400_000;

function ymdUtc(ms) {
  const d = new Date(ms);
  return String(d.getUTCFullYear())
    + String(d.getUTCMonth() + 1).padStart(2, '0')
    + String(d.getUTCDate()).padStart(2, '0');
}

function startOfUtcDay(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Split [startMs, endMs) into contiguous UTC-day windows of at most
 * `windowDays` days, each as { start, end } in YYYYMMDD with an exclusive
 * end — exactly the service's own convention. Adjacent windows share a
 * boundary day (one's end is the next's start) so nothing is double-counted
 * and nothing falls between them.
 */
function swdiWindows(startMs, endMs, windowDays = WINDOW_DAYS) {
  const out = [];
  const step = Math.max(1, Math.min(31, Math.floor(windowDays))) * DAY_MS;
  let s = startOfUtcDay(startMs);
  // The end is exclusive: the window must reach the START of the day after
  // the last instant we care about, or the final day is silently dropped.
  const endExclusive = startOfUtcDay(endMs) + DAY_MS;
  while (s < endExclusive) {
    const e = Math.min(s + step, endExclusive);
    out.push({ start: ymdUtc(s), end: ymdUtc(e) });
    s = e;
  }
  return out;
}

/** Degrees bbox roughly matching radiusMi around (lat, lng) — the same
 *  approximation hail.js uses for the IEM query. */
function bboxFor(lat, lng, radiusMi) {
  const latDelta = radiusMi / 69;
  const lngDelta = radiusMi / (69 * Math.cos(lat * Math.PI / 180));
  return {
    minLon: +(lng - lngDelta).toFixed(4),
    minLat: +(lat - latDelta).toFixed(4),
    maxLon: +(lng + lngDelta).toFixed(4),
    maxLat: +(lat + latDelta).toFixed(4),
  };
}

/** "POINT (-84.66 38.90)" → { lat, lng }; null on anything else. */
function parseSwdiPoint(shape) {
  const m = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(String(shape || ''));
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.7613;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Normalize raw SWDI rows to hail.js's hit shape, drop anything outside
 * `radiusMi` of the query point, newest first.
 *
 * sizeInches is MAXSIZE — the algorithm's maximum expected size for the
 * cell. A "0" or unparsable MAXSIZE becomes null (the D2D scorer already
 * treats null as "hail flagged, size unknown"), never 0.5 by default.
 */
function normalizeSwdiRows(rows, { lat, lng, radiusMi }) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const pt = parseSwdiPoint(r && r.SHAPE);
    if (!pt) continue;
    const miles = haversineMiles(lat, lng, pt.lat, pt.lng);
    if (isFinite(radiusMi) && radiusMi > 0 && miles > radiusMi) continue;
    const size = parseFloat(r.MAXSIZE);
    const prob = parseFloat(r.PROB);
    const sevProb = parseFloat(r.SEVPROB);
    const at = typeof r.ZTIME === 'string' && !isNaN(Date.parse(r.ZTIME)) ? r.ZTIME : null;
    out.push({
      at,
      lat: pt.lat,
      lng: pt.lng,
      sizeInches: isFinite(size) && size > 0 ? size : null,
      source: 'swdi',
      radar: r.WSR_ID || null,
      cellId: r.CELL_ID || null,
      probability: isFinite(prob) ? prob : null,
      severeProbability: isFinite(sevProb) ? sevProb : null,
      distanceMi: +miles.toFixed(2),
      remark: 'Radar ' + (r.WSR_ID || '?') + ' cell ' + (r.CELL_ID || '?')
        + (isFinite(sevProb) ? ' · ' + sevProb + '% severe' : '')
        + (isFinite(size) && size > 0 ? ' · max ' + size + ' in' : ''),
    });
  }
  out.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  return out;
}

function buildSwdiUrl(win, bbox) {
  return SWDI_BASE + win.start + ':' + win.end
    + '?bbox=' + [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat].join(',');
}

async function fetchWindow(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'NBDProCRM/1.0 (jd@nobigdealwithjoedeal.com)' },
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error('SWDI ' + res.status + (data && data.error ? ': ' + String(data.error).slice(0, 200) : ''));
  }
  if (data && typeof data.error === 'string') throw new Error('SWDI: ' + data.error.slice(0, 200));
  return (data && Array.isArray(data.result)) ? data.result : [];
}

/**
 * fetchSwdiHail(lat, lng, radiusMi, daysBack[, deps]) → hits[]
 * deps.fetchImpl / deps.now exist for tests; production callers pass none.
 * Any window failing fails the lookup (a partial answer that looks complete
 * is worse than the NOAA fallback), which is what lookupHail expects.
 */
async function fetchSwdiHail(lat, lng, radiusMi, daysBack, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const now = typeof deps.now === 'number' ? deps.now : Date.now();
  const days = Math.max(1, Math.floor(Number(daysBack) || 1));
  const windows = swdiWindows(now - days * DAY_MS, now);
  const bbox = bboxFor(lat, lng, radiusMi);
  const urls = windows.map((w) => buildSwdiUrl(w, bbox));

  // Bounded concurrency: a 730-day lookup is 25 windows; four in flight is
  // polite to a keyless public service and still finishes inside the
  // callable's 20 s budget on a healthy network.
  const results = new Array(urls.length);
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const i = next++;
      results[i] = await fetchWindow(urls[i], fetchImpl);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));

  return normalizeSwdiRows(results.flat(), { lat, lng, radiusMi });
}

module.exports = {
  fetchSwdiHail,
  // pure helpers, exported for tests
  swdiWindows,
  bboxFor,
  parseSwdiPoint,
  haversineMiles,
  normalizeSwdiRows,
  buildSwdiUrl,
  SWDI_BASE,
  WINDOW_DAYS,
};

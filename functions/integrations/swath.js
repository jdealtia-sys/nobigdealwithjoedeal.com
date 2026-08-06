/**
 * integrations/swath.js — Swath API adapter (swathapi.com)
 *
 * Storm-verified property intelligence: radar-MEASURED hail events (never
 * forecasts), webhook alerts for registered coverage areas, and per-property
 * exposure reports ("Swath Reports"). Three surfaces:
 *
 *   1. fetchSwathHail()     — hail-history provider for the existing
 *      hail.js contract (NBD_HAIL_PROVIDER=swath). GET /v1/storms +
 *      per-storm GET /v1/swaths/{id}/geometry for the swath polygon.
 *   2. querySwathProperty() — parcel-intel provider for the parcel.js
 *      contract (NBD_PARCEL_PROVIDER=swath). GET /v1/property?address=…
 *   3. swathWebhook         — inbound `storm.verified` alerts for the
 *      coverage monitors registered per the SWATH-SETUP runbook. HMAC-
 *      signed (X-Swath-Signature: t=<unix>,v1=hex(hmac_sha256(secret,
 *      t + "." + body))), Stripe-style.
 *
 * Plus two admin callables: getSwathReport (quote-first pull of the
 * per-property exposure report) and getSwathUsage (month-to-date credits).
 *
 * CREDIT MODEL (why this file caches so aggressively): the free plan is
 * 100 credits/month and HARD-STOPS. /storms = 1, /geometry = 1,
 * /property = 2, report = 1/property returned (10 min) +25 per
 * fresh-fetched record, quote = 1, usage = 1. Failed requests are never
 * billed. Every avoidable repeat call is cached in Firestore; the report
 * pull is quote-first and requires an explicit confirm.
 *
 * The nightly hailMatchCron deliberately does NOT use this provider — a
 * 500-lead sweep would burn the whole month's credits in one run. The
 * cron sticks to HailTrace/NOAA (see hail-cron.js).
 *
 * FIRESTORE NOTE: GeoJSON coordinates are nested arrays, which Firestore
 * rejects ("nested arrays are not supported"). Every cached geometry in
 * this file is stored JSON-stringified and parsed on read.
 *
 * NORMALIZER NOTE: swathapi.com's public docs specify response semantics
 * (fields like year built, exposure {hail_in, score}, county) but not
 * exact key spellings for /storms. normalizeStormEvent()/
 * normalizeSwathParcel() therefore pick tolerantly across the plausible
 * spellings. Verify against a live response on first use and prune —
 * see documentation/runbooks/SWATH-SETUP.md.
 *
 * SETUP (full steps in documentation/runbooks/SWATH-SETUP.md):
 *   curl -X POST https://swathapi.com/v1/signup -d '{"email": …}'
 *   firebase functions:secrets:set SWATH_API_KEY
 *   register a monitor (webhook_url = …/swathWebhook), then
 *   firebase functions:secrets:set SWATH_WEBHOOK_SECRET
 *   optionally: NBD_HAIL_PROVIDER=swath, NBD_PARCEL_PROVIDER=swath
 */

'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const { FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');
const { getSecret, hasSecret, SECRETS } = require('./_shared');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app'
];

const SWATH_API_BASE = 'https://swathapi.com/v1';

const HAIL_CACHE_TTL_MS     = 6 * 60 * 60 * 1000;        // storms query — 6h
const REPORT_CACHE_TTL_MS   = 30 * 24 * 60 * 60 * 1000;  // pulled report — 30d
const GEOMETRY_FETCH_LIMIT  = 3;    // max /geometry credits per hail lookup
const SIGNATURE_TOLERANCE_S = 300;  // webhook replay window — 5 min

// ── HTTP helper ─────────────────────────────────────────────
// Bearer-authed JSON GET/POST against the Swath API. Throws Error with a
// `.status` for non-2xx so callers can distinguish credit exhaustion
// (402) / rate limiting (429) from transport failures. Never logs the
// key or the URL query (addresses are homeowner PII).
async function swathFetch(pathAndQuery, { method = 'GET', body } = {}) {
  const key = getSecret('SWATH_API_KEY');
  if (!key) { const e = new Error('Swath not configured'); e.status = 0; throw e; }
  const res = await fetch(SWATH_API_BASE + pathAndQuery, {
    method,
    headers: {
      'Authorization': 'Bearer ' + key,
      'Accept': 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const e = new Error('Swath ' + res.status);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// Tolerant field pick — first non-null among plausible key spellings.
function pick(obj, names, fallback = null) {
  if (!obj || typeof obj !== 'object') return fallback;
  for (const n of names) { if (obj[n] != null) return obj[n]; }
  return fallback;
}

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return isFinite(n) ? n : null;
}

// ── GeoJSON helpers ─────────────────────────────────────────
// Accept a bare geometry, a Feature, or a FeatureCollection and return
// a plain { type, coordinates } Polygon/MultiPolygon (or null). The
// hail.js consumers (d2d swath→territory) validate ring area themselves.
function normalizeGeometry(g) {
  if (!g || typeof g !== 'object') return null;
  if (g.type === 'FeatureCollection' && Array.isArray(g.features)) g = g.features[0];
  if (g && g.type === 'Feature') g = g.geometry;
  if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon') && Array.isArray(g.coordinates)) {
    return { type: g.type, coordinates: g.coordinates };
  }
  return null;
}

// ── Normalizers ─────────────────────────────────────────────
// A /v1/storms event → the hail.js hit contract:
//   { at, lat, lng, sizeInches, polygon, source, stormId }
function normalizeStormEvent(e) {
  if (!e || typeof e !== 'object') return null;
  let centroid = pick(e, ['centroid', 'center'], {});
  let lat = null, lng = null;
  if (Array.isArray(centroid) && centroid.length === 2) {
    // GeoJSON position order: [lng, lat]
    lng = num(centroid[0]); lat = num(centroid[1]);
  } else {
    lat = num(pick(centroid, ['lat', 'latitude']));
    lng = num(pick(centroid, ['lng', 'lon', 'longitude']));
  }
  if (lat == null) lat = num(pick(e, ['lat', 'latitude']));
  if (lng == null) lng = num(pick(e, ['lng', 'lon', 'longitude']));
  return {
    at:         pick(e, ['occurred_at', 'verified_at', 'started_at', 'start_time', 'time', 'date']),
    lat, lng,
    sizeInches: num(pick(e, ['hail_max_in', 'max_hail_in', 'hail_in', 'max_size_in', 'max_size'])),
    polygon:    normalizeGeometry(pick(e, ['geometry', 'swath', 'polygon'])),
    county:     pick(e, ['county']),
    state:      pick(e, ['state', 'state_abbr']),
    source:     'swath',
    stormId:    pick(e, ['id', 'storm_id', 'swath_id']) != null
                  ? String(pick(e, ['id', 'storm_id', 'swath_id'])) : null
  };
}

// A /v1/property record → the parcel.js contract (queryRegrid shape),
// plus Swath's roof-age/occupancy extras (additive keys, harmless to
// existing consumers).
function normalizeSwathParcel(p) {
  if (!p || typeof p !== 'object') return null;
  const exposure = pick(p, ['exposure'], {});
  return {
    owner:         pick(p, ['owner', 'owner_name']),
    parcelNumber:  pick(p, ['parcel_id', 'parcel_number', 'apn']),
    acres:         num(pick(p, ['acres', 'lot_acres'])),
    sqft:          num(pick(p, ['sqft', 'building_sqft', 'lot_sqft'])),
    yearBuilt:     num(pick(p, ['year_built', 'yearbuilt'])),
    lastSaleDate:  pick(p, ['last_sale_date', 'sale_date']),
    lastSalePrice: num(pick(p, ['last_sale_price', 'sale_price'])),
    assessedValue: num(pick(p, ['assessed_value', 'assessedvalue'])),
    lat:           num(pick(p, ['lat', 'latitude'])),
    lng:           num(pick(p, ['lng', 'lon', 'longitude'])),
    stateAbbr:     pick(p, ['state', 'state_abbr']),
    county:        pick(p, ['county']),
    city:          pick(p, ['city']),
    zip:           pick(p, ['zip', 'zipcode', 'postal_code']),
    zoning:        pick(p, ['zoning']),
    schoolDist:    pick(p, ['school_district', 'sdname']),
    geometry:      normalizeGeometry(pick(p, ['geometry', 'parcel_geometry'])),
    // Swath extras
    roofAge:        num(pick(p, ['roof_age', 'roof_age_years'])),
    roofAgeSource:  pick(p, ['roof_age_source', 'roof_age_derived_from']),
    ownerOccupied:  typeof pick(p, ['owner_occupied']) === 'boolean' ? p.owner_occupied : null,
    exposureHailIn: num(pick(exposure, ['hail_in'])),
    exposureScore:  num(pick(exposure, ['score'])),
    address:        pick(p, ['address', 'formatted_address']),
    source: 'swath'
  };
}

// Pull the record array out of a response whose envelope key isn't
// pinned by the public docs.
function recordsOf(data, keys) {
  if (Array.isArray(data)) return data;
  const arr = pick(data, keys, []);
  return Array.isArray(arr) ? arr : [];
}

// ── Hail provider (hail.js contract) ────────────────────────
// GET /v1/storms within a bbox around (lat,lng), then attach swath
// polygons for the top-N largest storms (each /geometry = 1 credit,
// cached forever — a measured storm's footprint is immutable).
//
// Whole-query result is cached 6h keyed on rounded coords so reps
// re-opening the D2D map don't re-bill /storms every time.
async function fetchSwathHail(lat, lng, radiusMi, daysBack) {
  const db = getFirestore();
  const cacheKey = 'v1_' + lat.toFixed(2) + '_' + lng.toFixed(2) + '_'
    + Math.round(radiusMi) + '_' + Math.round(daysBack);
  const cacheRef = db.doc('swath_hail_cache/' + cacheKey);
  try {
    const cached = await cacheRef.get();
    if (cached.exists) {
      const d = cached.data();
      if (d.cachedAt && d.cachedAt.toMillis
          && Date.now() - d.cachedAt.toMillis() < HAIL_CACHE_TTL_MS
          && typeof d.hitsJson === 'string') {
        return JSON.parse(d.hitsJson);
      }
    }
  } catch (e) { logger.warn('swath hail cache read failed', { err: e.message }); }

  // bbox [W,S,E,N] — same degree math as the NOAA fetcher.
  const latDelta = radiusMi / 69;
  const lngDelta = radiusMi / (69 * Math.cos(lat * Math.PI / 180));
  const bbox = [
    (lng - lngDelta).toFixed(4), (lat - latDelta).toFixed(4),
    (lng + lngDelta).toFixed(4), (lat + latDelta).toFixed(4)
  ].join(',');
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();

  const data = await swathFetch('/storms?type=hail'
    + '&bbox=' + encodeURIComponent(bbox)
    + '&since=' + encodeURIComponent(since));
  let hits = recordsOf(data, ['storms', 'events', 'data', 'results'])
    .map(normalizeStormEvent)
    .filter(Boolean);

  // Attach swath polygons for the biggest storms that didn't inline one.
  const wantGeo = hits
    .filter(h => h.stormId && !h.polygon)
    .sort((a, b) => (b.sizeInches || 0) - (a.sizeInches || 0))
    .slice(0, GEOMETRY_FETCH_LIMIT);
  for (const h of wantGeo) {
    h.polygon = await getSwathGeometry(db, h.stormId);
  }

  // A hit is only useful downstream with coords or a polygon (the d2d
  // territory hull needs vertices; the cron needs a point).
  hits = hits.filter(h => (h.lat != null && h.lng != null) || h.polygon);

  try {
    await cacheRef.set({ hitsJson: JSON.stringify(hits), cachedAt: FieldValue.serverTimestamp() });
  } catch (e) { logger.warn('swath hail cache write failed', { err: e.message }); }
  return hits;
}

// Per-storm geometry with a permanent Firestore cache. Nulls are cached
// too (billed lookups that returned nothing shouldn't re-bill).
async function getSwathGeometry(db, stormId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(stormId)) return null;
  const ref = db.doc('swath_geometry_cache/' + stormId);
  try {
    const snap = await ref.get();
    if (snap.exists) {
      const j = snap.data().geometryJson;
      return typeof j === 'string' && j !== 'null' ? JSON.parse(j) : null;
    }
  } catch (e) { logger.warn('swath geometry cache read failed', { stormId, err: e.message }); }
  let geometry = null;
  try {
    const g = await swathFetch('/swaths/' + encodeURIComponent(stormId) + '/geometry');
    geometry = normalizeGeometry(g) || normalizeGeometry(pick(g, ['geometry', 'swath']));
  } catch (e) {
    logger.warn('swath geometry fetch failed', { stormId, status: e.status || null });
    return null; // transient failure — don't cache, don't fail the lookup
  }
  try {
    await ref.set({ geometryJson: JSON.stringify(geometry), cachedAt: FieldValue.serverTimestamp() });
  } catch (e) { logger.warn('swath geometry cache write failed', { stormId, err: e.message }); }
  return geometry;
}

// ── Parcel provider (parcel.js contract) ────────────────────
// GET /v1/property?address=… (2 credits). parcel.js owns the 90-day
// address cache; this stays a thin fetch+normalize.
async function querySwathProperty(address) {
  const data = await swathFetch('/property?address=' + encodeURIComponent(address));
  const rec = Array.isArray(data) ? data[0]
    : (pick(data, ['property', 'parcel', 'result'])
       || recordsOf(data, ['properties', 'results', 'data'])[0]
       || (pick(data, ['address', 'parcel_id', 'year_built', 'owner']) != null ? data : null));
  return normalizeSwathParcel(rec);
}

// ── Webhook signature (X-Swath-Signature) ───────────────────
// Stripe-style: `t=<unix seconds>,v1=<hex hmac_sha256(secret, t + "." + rawBody)>`.
// Exported pure so tests/smoke/swath-signature.test.js can exercise it
// without the Functions runtime. Timestamp bounded to ±SIGNATURE_TOLERANCE_S
// so a captured payload can't be replayed later (e.g. re-announcing a
// storm to re-trigger Slack pings).
function verifySwathSignature(rawBody, header, secret, nowMs) {
  if (!secret) return { ok: false, reason: 'no-secret' };
  if (!rawBody || !header) return { ok: false, reason: 'missing' };
  const m = /^t=(\d{1,12}),\s*v1=([0-9a-f]{64})$/i.exec(String(header).trim());
  if (!m) return { ok: false, reason: 'malformed' };
  const t = parseInt(m[1], 10);
  const now = (nowMs == null ? Date.now() : nowMs) / 1000;
  if (!isFinite(t) || Math.abs(now - t) > SIGNATURE_TOLERANCE_S) {
    return { ok: false, reason: 'stale' };
  }
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', secret)
    .update(m[1] + '.' + bodyStr)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(m[2].toLowerCase(), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true, timestamp: t };
}

// ── swathWebhook — storm.verified receiver ──────────────────
// One POST per verified storm crossing a registered coverage monitor.
// Verifies HMAC, ingests idempotently into storm_events/{stormId}
// (webhook retries + at-least-once delivery collapse onto one doc),
// pings Slack. Deliberately does NOT auto-pull the Swath Report —
// that's billed per property and stays behind the getSwathReport
// confirm flow.
exports.swathWebhook = onRequest(
  {
    region: 'us-central1',
    maxInstances: 10,
    timeoutSeconds: 15,
    memory: '256MiB',
    secrets: [SECRETS.SWATH_WEBHOOK_SECRET, SECRETS.SLACK_WEBHOOK_URL]
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }

    // Fail closed when the secret isn't configured — accepting unsigned
    // storm alerts would let anyone who knows the URL spoof "verified
    // storm" pings into Slack and storm_events.
    if (!hasSecret('SWATH_WEBHOOK_SECRET')) {
      logger.error('swathWebhook: SWATH_WEBHOOK_SECRET not set — rejecting unsigned request');
      res.status(503).json({ error: 'Webhook not configured' });
      return;
    }
    if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
      res.status(400).json({ error: 'Missing body' });
      return;
    }
    const sig = verifySwathSignature(
      req.rawBody,
      req.headers['x-swath-signature'],
      getSecret('SWATH_WEBHOOK_SECRET')
    );
    if (!sig.ok) {
      logger.warn('swathWebhook: signature rejected', { reason: sig.reason });
      res.status(sig.reason === 'missing' ? 400 : 403).json({ error: 'Bad signature' });
      return;
    }

    let body;
    try { body = JSON.parse(req.rawBody.toString('utf8')); }
    catch (_) { res.status(400).json({ error: 'Invalid JSON' }); return; }

    const eventType = String(pick(body, ['event', 'type'], '')).toLowerCase();
    if (eventType && eventType !== 'storm.verified') {
      // Unknown event types ack 200 so Swath's retry/backoff doesn't
      // hammer us for events this receiver doesn't consume.
      res.status(200).json({ ok: true, ignored: eventType });
      return;
    }

    const stormRaw = pick(body, ['storm', 'data', 'payload'], body);
    const storm = normalizeStormEvent(stormRaw) || {};
    // Idempotency key: the storm id when present, else a body digest so
    // redelivery of an id-less payload still collapses to one doc.
    const docId = storm.stormId && /^[A-Za-z0-9_-]{1,64}$/.test(storm.stormId)
      ? storm.stormId
      : 'sha_' + crypto.createHash('sha256').update(req.rawBody).digest('hex').slice(0, 32);

    try {
      await getFirestore().doc('storm_events/' + docId).set({
        stormId:     storm.stormId || null,
        at:          storm.at || null,
        county:      storm.county || null,
        state:       storm.state || null,
        sizeInches:  storm.sizeInches != null ? storm.sizeInches : null,
        lat:         storm.lat != null ? storm.lat : null,
        lng:         storm.lng != null ? storm.lng : null,
        monitor:     pick(body, ['monitor', 'monitor_name', 'monitor_id']) || null,
        // Full payload for forensics + follow-up report pulls — JSON string because
        // swath geometry is nested arrays (see header note).
        payloadJson: req.rawBody.toString('utf8').slice(0, 100_000),
        source:      'swath',
        receivedAt:  FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {
      logger.error('swathWebhook: storm_events write failed', { docId, err: e.message });
      res.status(500).json({ error: 'write failed' });
      return;
    }

    await postSlackStorm(storm, docId);
    res.status(200).json({ ok: true, id: docId });
  }
);

async function postSlackStorm(storm, docId) {
  if (!hasSecret('SLACK_WEBHOOK_URL')) return;
  const size = storm.sizeInches != null ? storm.sizeInches.toFixed(2) + '"' : 'unknown size';
  const where = [storm.county, storm.state].filter(Boolean).join(', ') || 'coverage area';
  try {
    await fetch(getSecret('SLACK_WEBHOOK_URL'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '⛈ Swath verified storm: ' + size + ' hail — ' + where,
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*⛈ Verified storm (Swath)*\n'
              + '`' + size + '` measured hail — *' + where + '*'
              + (storm.at ? '\nWhen: ' + storm.at : '')
              + '\nEvent: `storm_events/' + docId + '`'
              + '\nNext: pull a report quote via `getSwathReport` (admin console) before spending report credits.'
          }
        }]
      })
    });
  } catch (e) { logger.warn('swathWebhook: slack post failed', { err: e.message }); }
}

// ── getSwathReport — quote-first per-property exposure report ──
// Billed 1 credit per property RETURNED (10 min) and +25 per record the
// vendor fresh-fetches, so this callable never pulls without an explicit
// confirm: without `confirm: true` it returns the 1-credit quote
// (cached match count + labeled fresh-fetch estimate). Admin/company_admin
// only — it spends the shared key's credits.
exports.getSwathReport = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [SECRETS.SWATH_API_KEY]
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerRole = (request.auth.token && request.auth.token.role) || '';
    if (!['admin', 'company_admin'].includes(callerRole)) {
      throw new HttpsError('permission-denied', 'Admin access required');
    }
    if (!hasSecret('SWATH_API_KEY')) {
      throw new HttpsError('failed-precondition', 'Swath not configured.');
    }

    const { enforceRateLimit } = require('./upstash-ratelimit');
    try {
      await enforceRateLimit('callable:getSwathReport:uid', uid, 20, 60 * 60_000);
    } catch (e) {
      if (e.rateLimited) throw new HttpsError('resource-exhausted', 'Too many report requests — try again in an hour.');
      throw e;
    }

    const stormId = String(request.data && request.data.stormId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(stormId)) {
      throw new HttpsError('invalid-argument', 'Valid stormId required');
    }
    const confirm = request.data && request.data.confirm === true;
    const refresh = request.data && request.data.refresh === true;
    const limit = Math.min(500, Math.max(1, parseInt(request.data && request.data.limit, 10) || 250));

    // Filter passthrough — bounded, typed, allowlisted.
    const qs = ['limit=' + limit];
    const roofAgeMin = parseInt(request.data && request.data.roofAgeMin, 10);
    if (isFinite(roofAgeMin) && roofAgeMin >= 0 && roofAgeMin <= 100) qs.push('roof_age_min=' + roofAgeMin);
    if (request.data && typeof request.data.ownerOccupied === 'boolean') qs.push('owner_occupied=' + request.data.ownerOccupied);
    const query = qs.join('&');

    const db = getFirestore();
    const cacheId = stormId + '_' + crypto.createHash('sha256').update(query).digest('hex').slice(0, 12);
    const cacheRef = db.doc('swath_reports/' + cacheId);

    // Serve the cached pull unless explicitly refreshed — the report is
    // billed per property returned, and a measured storm's report barely
    // moves once pulled.
    if (!refresh) {
      try {
        const snap = await cacheRef.get();
        if (snap.exists) {
          const d = snap.data();
          if (d.fetchedAt && d.fetchedAt.toMillis
              && Date.now() - d.fetchedAt.toMillis() < REPORT_CACHE_TTL_MS
              && typeof d.propertiesJson === 'string') {
            return {
              success: true, cached: true, stormId,
              properties: JSON.parse(d.propertiesJson),
              summary: d.summary || null
            };
          }
        }
      } catch (e) { logger.warn('swath report cache read failed', { err: e.message }); }
    }

    try {
      if (!confirm) {
        // 1-credit preview: cached match count + clearly-labeled
        // fresh-fetch estimate, no rows returned, nothing else billed.
        const quote = await swathFetch('/swaths/' + encodeURIComponent(stormId) + '/properties/quote?' + query);
        return { success: true, quoted: true, requiresConfirm: true, stormId, quote };
      }

      const data = await swathFetch('/swaths/' + encodeURIComponent(stormId) + '/properties?' + query);
      const properties = recordsOf(data, ['properties', 'records', 'results', 'data'])
        .map(normalizeSwathParcel)
        .filter(Boolean);
      const summary = {
        count: properties.length,
        maxHailIn: properties.reduce((m, p) => Math.max(m, p.exposureHailIn || 0), 0),
        ownerOccupied: properties.filter(p => p.ownerOccupied === true).length
      };
      try {
        await cacheRef.set({
          stormId, query,
          propertiesJson: JSON.stringify(properties),
          summary,
          requestedBy: uid,
          fetchedAt: FieldValue.serverTimestamp()
        });
      } catch (e) { logger.warn('swath report cache write failed', { err: e.message }); }
      return { success: true, cached: false, stormId, properties, summary };
    } catch (e) {
      if (e.status === 402 || e.status === 429) {
        throw new HttpsError('resource-exhausted', 'Swath credits exhausted or rate-limited — check getSwathUsage.');
      }
      logger.warn('getSwathReport failed', { stormId, status: e.status || null, err: e.message });
      throw new HttpsError('unavailable', 'Swath report failed');
    }
  }
);

// ── getSwathUsage — month-to-date credit meter (1 credit) ───
// Admin visibility for the hard-stopping free plan. No cache: it IS the
// freshness check, and the 10/hr limiter bounds the spend at 10
// credits/hr worst-case.
exports.getSwathUsage = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 15,
    memory: '256MiB',
    secrets: [SECRETS.SWATH_API_KEY]
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerRole = (request.auth.token && request.auth.token.role) || '';
    if (!['admin', 'company_admin'].includes(callerRole)) {
      throw new HttpsError('permission-denied', 'Admin access required');
    }
    if (!hasSecret('SWATH_API_KEY')) {
      return { success: false, configured: false };
    }
    const { enforceRateLimit } = require('./upstash-ratelimit');
    try {
      await enforceRateLimit('callable:getSwathUsage:uid', uid, 10, 60 * 60_000);
    } catch (e) {
      if (e.rateLimited) throw new HttpsError('resource-exhausted', 'Too many usage checks — try again in an hour.');
      throw e;
    }
    try {
      const usage = await swathFetch('/usage');
      return { success: true, configured: true, usage };
    } catch (e) {
      if (e.status === 402 || e.status === 429) {
        throw new HttpsError('resource-exhausted', 'Swath credits exhausted or rate-limited.');
      }
      throw new HttpsError('unavailable', 'Swath usage lookup failed');
    }
  }
);

// Plain helpers (not Cloud Functions) — consumed by hail.js / parcel.js
// and the smoke suite. Documented in FUNCTIONS_INDEX.md alongside
// lookupHail.
exports.fetchSwathHail = fetchSwathHail;
exports.querySwathProperty = querySwathProperty;
exports.verifySwathSignature = verifySwathSignature;

module.exports = exports;

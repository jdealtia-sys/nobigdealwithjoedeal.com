/**
 * integrations/parcel.js — parcel intel adapter (Regrid | Swath)
 *
 * `property-intel.js` currently uses OSM Nominatim + whatever it
 * can scrape. A parcel provider gives us structured nationwide data:
 *   - Owner name
 *   - Deed/APN/parcel number
 *   - Lot size (acres + sqft)
 *   - Year built / last sale / assessed value
 *   - School district, flood zone, zoning
 *
 * Providers (NBD_PARCEL_PROVIDER):
 *   regrid (default) — ~$0.01/lookup on their Tier 2 plan
 *   swath            — swathapi.com GET /v1/property (2 credits/lookup,
 *                      adds roof age + owner-occupancy; free plan serves
 *                      cached parcel data only). integrations/swath.js.
 * Fallback is one-way: NBD_PARCEL_PROVIDER=swath keeps Regrid as the
 * fallback (error OR no-record), but the regrid default never falls back
 * to Swath — a configured SWATH_API_KEY with the flag unflipped must not
 * bill anything (billing surprise > resilience here).
 *
 * Cacheable — 90 days is fine, parcels don't change often. We cache in
 * `parcel_cache/{addressHash}` (both providers share the cache — a hit
 * is a hit no matter who fetched it).
 *
 * SETUP:
 *   regrid.com → API → generate token → firebase functions:secrets:set REGRID_API_TOKEN
 *   and/or documentation/runbooks/SWATH-SETUP.md → firebase functions:secrets:set SWATH_API_KEY
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const { FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');
const { getSecret, hasSecret, PROVIDERS, SECRETS } = require('./_shared');
const { querySwathProperty } = require('./swath');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app'
];

const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function addrHash(address) {
  const norm = String(address || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

async function queryRegrid(address) {
  const token = getSecret('REGRID_API_TOKEN');
  const url = 'https://app.regrid.com/api/v2/parcels/address?' +
    'query=' + encodeURIComponent(address) + '&limit=1&token=' + encodeURIComponent(token);
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Regrid ' + res.status);
  const data = await res.json();
  const feat = data && data.parcels && data.parcels.features && data.parcels.features[0];
  if (!feat) return null;
  const p = feat.properties || {};
  const fields = p.fields || {};
  // Audit batch 11 (2026-05-13): preserve the GeoJSON geometry. This is
  // the parcel polygon — load-bearing for the photo system Phase 2 slope
  // inference (photo-smart-ingest.js:getPropertyPolygon reads
  // `lead.parcel.geometry.coordinates`). Strip non-MultiPolygon /
  // Polygon shapes defensively. Polygon outer ring is what the heading-
  // to-slope math needs; we don't care about holes or alt geometry.
  let geometry = null;
  if (feat.geometry
      && (feat.geometry.type === 'Polygon' || feat.geometry.type === 'MultiPolygon')
      && Array.isArray(feat.geometry.coordinates)) {
    geometry = {
      type:        feat.geometry.type,
      coordinates: feat.geometry.coordinates
    };
  }
  return {
    owner:        fields.owner || null,
    parcelNumber: fields.parcelnumb || null,
    acres:        fields.gisacre || null,
    sqft:         fields.ll_gissqft || null,
    yearBuilt:    fields.yearbuilt || null,
    lastSaleDate: fields.saledate || null,
    lastSalePrice:fields.saleprice || null,
    assessedValue:fields.parval || null,
    lat:          fields.lat || null,
    lng:          fields.lon || null,
    stateAbbr:    fields.state2 || null,
    county:       fields.county || null,
    city:         fields.city || null,
    zip:          fields.szip || null,
    zoning:       fields.zoning || null,
    schoolDist:   fields.sdname || null,
    geometry:     geometry,
    source: 'regrid'
  };
}

// ─── Callable: lookupParcel ────────────────────────────────
exports.lookupParcel = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 15,
    memory: '256MiB',
    secrets: [SECRETS.REGRID_API_TOKEN, SECRETS.SWATH_API_KEY]
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    // Per-uid cap: this returns owner PII (name/last-sale/assessed value) and
    // bills Regrid ($0.01/lookup) per distinct address (each bypasses the cache),
    // so an unthrottled rep could enumerate a whole street. Same limiter the
    // other paid-vendor callables use (esign 30/hr, measurement/voice 20/hr).
    const { enforceRateLimit } = require('./upstash-ratelimit');
    try {
      await enforceRateLimit('callable:lookupParcel:uid', uid, 60, 60 * 60_000);
    } catch (e) {
      if (e.rateLimited) throw new HttpsError('resource-exhausted', 'Too many parcel lookups — try again in an hour.');
      throw e;
    }

    const address = typeof request.data?.address === 'string'
      ? request.data.address.trim() : '';
    if (!address || address.length < 5 || address.length > 500) {
      throw new HttpsError('invalid-argument', 'Valid address required');
    }

    // Provider selection (Swath wiring 2026-08-06): Swath participates
    // ONLY when NBD_PARCEL_PROVIDER=swath — deliberately one-way. With the
    // flag at its 'regrid' default, a configured SWATH_API_KEY changes
    // nothing here (the runbook promises "with only the key set, nothing
    // changes", and Swath lookups bill 2 credits each on a hard-stopping
    // plan — no billing surprises from a fallback nobody flipped on).
    // When the flag IS swath, Regrid remains the one-shot fallback. Not
    // configured at all → same failed-precondition as the Regrid-only era.
    const wantSwath = PROVIDERS.parcel === 'swath' && hasSecret('SWATH_API_KEY');
    const providers = [];
    if (wantSwath) providers.push('swath');
    if (hasSecret('REGRID_API_TOKEN')) providers.push('regrid');
    if (providers.length === 0) {
      throw new HttpsError('failed-precondition', 'Parcel provider not configured.');
    }

    const db = getFirestore();
    const key = addrHash(address);
    const cacheRef = db.doc(`parcel_cache/${key}`);
    const cache = await cacheRef.get();
    if (cache.exists) {
      const d = cache.data();
      if (d.cachedAt && d.cachedAt.toMillis
          && Date.now() - d.cachedAt.toMillis() < CACHE_TTL_MS) {
        const cachedParcel = d.parcel || null;
        // Geometry is cached JSON-stringified (Firestore rejects the
        // nested arrays of raw GeoJSON) — rehydrate for callers.
        if (cachedParcel && !cachedParcel.geometry && typeof cachedParcel.geometryJson === 'string') {
          try { cachedParcel.geometry = JSON.parse(cachedParcel.geometryJson); } catch (_) { /* leave null */ }
          delete cachedParcel.geometryJson;
        }
        return { success: true, cached: true, parcel: cachedParcel };
      }
    }

    let parcel = null;
    let lastErr = null;
    let answered = false; // some provider returned a substantive answer (incl. a legit no-record null)
    for (const provider of providers) {
      try {
        const got = provider === 'swath'
          ? await querySwathProperty(address)
          : await queryRegrid(address);
        answered = true;
        if (got) { parcel = got; break; }
        // null = this provider has no record (200-with-no-match — expected
        // on Swath's cache-only free plan). Let the fallback provider try
        // before we conclude "no parcel" and cache the miss for 90 days.
      } catch (e) {
        logger.warn(provider + ' parcel lookup failed:', e.message);
        lastErr = e;
      }
    }
    // Throw only when we got NO substantive answer and something errored —
    // an all-providers-miss (no errors) is a legitimate null worth caching.
    if (!parcel && !answered && lastErr) {
      throw new HttpsError('unavailable', 'Parcel lookup failed');
    }

    // Cache even nulls so repeat misses don't re-bill the provider.
    // GeoJSON coordinates are nested arrays, which Firestore REJECTS —
    // store geometry as a JSON string and rehydrate on cache read. (The
    // pre-Swath version wrote `parcel.geometry` raw: any geometry-bearing
    // Regrid result made this set() throw after the paid lookup had
    // already succeeded, 500ing the request. Best-effort now — a cache
    // failure must never fail a lookup we already paid for.)
    try {
      let cacheParcel = parcel;
      if (parcel && parcel.geometry) {
        cacheParcel = { ...parcel, geometryJson: JSON.stringify(parcel.geometry) };
        delete cacheParcel.geometry;
      }
      // Non-merge set: this write owns the whole doc. merge:true would keep
      // provider-specific keys from a PRIOR provider's pull (e.g. a stale
      // Swath geometryJson/roofAge surviving under a fresh Regrid result —
      // mixed-provenance parcels; adversarial review 2026-08-06, finding #4).
      await cacheRef.set({
        parcel: cacheParcel,
        cachedAt: FieldValue.serverTimestamp()
      });
    } catch (e) {
      logger.warn('parcel cache write failed (result still returned):', e.message);
    }

    return { success: true, cached: false, parcel };
  }
);

module.exports = exports;

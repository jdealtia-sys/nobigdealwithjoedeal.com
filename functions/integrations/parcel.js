/**
 * integrations/parcel.js — Regrid parcel intel adapter
 *
 * `property-intel.js` currently uses OSM Nominatim + whatever it
 * can scrape. Regrid gives us structured nationwide parcel data:
 *   - Owner name
 *   - Deed/APN/parcel number
 *   - Lot size (acres + sqft)
 *   - Year built / last sale / assessed value
 *   - School district, flood zone, zoning
 *
 * ~$0.01/lookup on their Tier 2 plan. Cacheable — 90 days is fine,
 * parcels don't change often. We cache in `parcel_cache/{addressHash}`.
 *
 * SETUP:
 *   regrid.com → API → generate token → firebase functions:secrets:set REGRID_API_TOKEN
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { getSecret, hasSecret, SECRETS } = require('./_shared');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nbd-pro.web.app'
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
    secrets: [SECRETS.REGRID_API_TOKEN]
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    const address = typeof request.data?.address === 'string'
      ? request.data.address.trim() : '';
    if (!address || address.length < 5 || address.length > 500) {
      throw new HttpsError('invalid-argument', 'Valid address required');
    }

    if (!hasSecret('REGRID_API_TOKEN')) {
      throw new HttpsError('failed-precondition', 'Parcel provider not configured.');
    }

    const db = admin.firestore();
    const key = addrHash(address);
    const cacheRef = db.doc(`parcel_cache/${key}`);
    const cache = await cacheRef.get();
    if (cache.exists) {
      const d = cache.data();
      if (d.cachedAt && d.cachedAt.toMillis
          && Date.now() - d.cachedAt.toMillis() < CACHE_TTL_MS) {
        return { success: true, cached: true, parcel: d.parcel || null };
      }
    }

    let parcel = null;
    try {
      parcel = await queryRegrid(address);
    } catch (e) {
      logger.warn('Regrid lookup failed:', e.message);
      throw new HttpsError('unavailable', 'Parcel lookup failed');
    }

    // Cache even nulls so repeat misses don't re-bill Regrid.
    await cacheRef.set({
      parcel,
      cachedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return { success: true, cached: false, parcel };
  }
);

module.exports = exports;

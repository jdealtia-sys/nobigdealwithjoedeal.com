/**
 * functions/handlers/reverify-knocks.js — team-scale address re-verify
 *
 * The client re-verify queue (d2d-tracker) can only re-verify the rep's OWN
 * knocks, because the `knocks` update rule is isOwner||isAdmin — a manager
 * can't write a teammate's doc. This owner/admin-only callable runs with Admin
 * SDK privileges, so it can re-score the WHOLE company's back-catalog server-
 * side (Google + Regrid) and stamp addrConfidence on every knock.
 *
 * Cost-guarded: owner/admin gate, App Check, per-company rate limit, a per-run
 * cap, and it reuses geocode.js's 30-day geocode_cache (same 'fwd:'+addr key)
 * so a bulk run shares cache hits with the live client path and never
 * re-bills an address the client already resolved.
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const { FieldValue } = require('firebase-admin/firestore');
const { CORS_ORIGINS, requireTeamAdmin } = require('./_shared');
const {
  _googleForward: googleForward,
  _regridAddress: regridAddress,
  _readCache: readCache,
  _writeCache: writeCache
} = require('./geocode');

const GOOGLE_GEOCODING_API_KEY = defineSecret('GOOGLE_GEOCODING_API_KEY');
const REGRID_API_TOKEN = defineSecret('REGRID_API_TOKEN');

// Server mirror of the client's scoreDoorResolution, restricted to the two
// authoritative sources available server-side (Google + Regrid): ≥2 sources
// agreeing on the same house number ⇒ verified; disagreement ⇒ conflict; a
// single source ⇒ likely; nothing ⇒ unverified.
function scoreServer(google, regrid) {
  const nums = [];
  if (google && google.houseNumber) nums.push(String(google.houseNumber).toLowerCase());
  if (regrid && regrid.houseNumber) nums.push(String(regrid.houseNumber).toLowerCase());
  if (!nums.length) return { confidence: 'unverified', houseNumber: '' };
  const distinct = [...new Set(nums)];
  if (distinct.length > 1) return { confidence: 'conflict', houseNumber: nums[0] };
  return { confidence: nums.length >= 2 ? 'verified' : 'likely', houseNumber: distinct[0] };
}

exports.reverifyCompanyKnocks = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    secrets: [GOOGLE_GEOCODING_API_KEY, REGRID_API_TOKEN],
    timeoutSeconds: 540, // max — sized for a few hundred lookups
    memory: '256MiB'
  },
  async (request) => {
    // Owner/admin only + resolves the tenant to operate on (throws otherwise).
    const { uid, companyId } = await requireTeamAdmin(request);

    // Per-company cap so two admins can't double-run (positional signature —
    // migrations.js's object-form call is a known no-op; don't copy it).
    const { enforceRateLimit } = require('../integrations/upstash-ratelimit');
    try {
      await enforceRateLimit('callable:reverifyCompanyKnocks:company', companyId, 6, 60 * 60_000);
    } catch (e) {
      if (e.rateLimited) throw new HttpsError('resource-exhausted', 'Please wait before re-running the bulk re-verify.');
      throw e;
    }

    const gKey = GOOGLE_GEOCODING_API_KEY.value();
    const rToken = REGRID_API_TOKEN.value();
    const hasGoogle = !!(gKey && gKey.startsWith('AIza'));
    const hasRegrid = !!(rToken && rToken.length > 10);
    if (!hasGoogle && !hasRegrid) throw new HttpsError('failed-precondition', 'Address providers not configured.');

    const cap = Math.min(Math.max(Number(request.data && request.data.max) || 200, 1), 500);
    const db = getFirestore();

    // Most-recent 5000 (the companyId+createdAt DESC composite index exists) —
    // the actionable working set. Skip docs re-checked server-side within the
    // staleness window so single-source 'likely'/'conflict' docs (which can
    // never reach 'verified') don't saturate the per-run cap and starve
    // genuinely-unprocessed knocks; each run then advances to fresh docs and
    // re-checks stale ones after the window (in case parcel data improved).
    const STALE_MS = 3 * 24 * 3600_000;
    const nowMs = Date.now();
    const toMs = (ts) => (ts && ts.toMillis) ? ts.toMillis() : (ts && ts.seconds ? ts.seconds * 1000 : 0);
    const snap = await db.collection('knocks')
      .where('companyId', '==', companyId).orderBy('createdAt', 'desc').limit(5000).get();
    const pending = snap.docs.filter(d => {
      const x = d.data();
      if ((x.addrConfidence || 'unverified') === 'verified') return false;
      const last = toMs(x.addrVerifiedAt);
      return !last || (nowMs - last) > STALE_MS;
    }).slice(0, cap);

    const summary = { companyId, scanned: snap.size, pending: pending.length, processed: 0, verified: 0, likely: 0, conflict: 0, unverified: 0, cached: 0, skipped: 0, warnings: [] };
    if (snap.size >= 5000) summary.warnings.push('Scanned the 5000 most-recent knocks; run again to reach older ones.');
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of pending) {
      const data = doc.data();
      const address = String(data.address || '').trim();
      if (address.length < 5) { summary.skipped++; continue; }
      summary.processed++;

      const cacheKey = 'fwd:' + address.toLowerCase().replace(/\s+/g, ' ');
      let payload = await readCache(db, cacheKey);
      if (payload) summary.cached++;
      else {
        const [google, regrid] = await Promise.all([
          hasGoogle ? googleForward(address, gKey).catch(() => null) : Promise.resolve(null),
          hasRegrid ? regridAddress(address, rToken).catch(() => null) : Promise.resolve(null)
        ]);
        payload = { google, regrid };
        if (google || regrid) await writeCache(db, cacheKey, payload); // never cache all-null
      }

      const res = scoreServer(payload.google, payload.regrid);
      summary[res.confidence]++;
      const sources = [
        payload.google && payload.google.houseNumber ? { src: 'Google', hn: payload.google.houseNumber } : null,
        payload.regrid && payload.regrid.houseNumber ? { src: 'County parcel', hn: payload.regrid.houseNumber } : null
      ].filter(Boolean);
      batch.update(doc.ref, {
        addrConfidence: res.confidence,
        addrHouseNumber: res.houseNumber || (data.addrHouseNumber || ''),
        addrSources: sources,
        addrNeedsReverify: res.confidence !== 'verified',
        addrVerifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      if (++batchCount >= 400) { await batch.commit(); batch = db.batch(); batchCount = 0; }
    }
    if (batchCount > 0) await batch.commit();

    logger.info('reverifyCompanyKnocks: done', Object.assign({ uid }, summary));
    return summary;
  }
);

module.exports = exports;

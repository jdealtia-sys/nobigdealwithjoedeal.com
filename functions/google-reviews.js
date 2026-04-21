/**
 * Google Reviews proxy — pulls the business's Google Place Details
 * (rating, total review count, latest ~5 reviews) through the Places
 * API and caches the result in Firestore so the public frontend never
 * touches the API key or burns billable calls on every page view.
 *
 * Design:
 *   - Fresh data window: 6 hours. Pages rendered within that window
 *     serve the cached doc with no external round-trip.
 *   - Stale fallback: if Google is down or quota is burnt, the function
 *     returns the last-known good cache with `stale: true` rather than
 *     a 500. The /review page degrades gracefully.
 *   - No client-side Firestore reads required — the public endpoint is
 *     the only surface. This keeps the security model simple.
 *
 * Setup (runbook in functions/google-reviews.README.md):
 *   1. Enable Places API in Google Cloud Console.
 *   2. firebase functions:secrets:set GOOGLE_PLACES_API_KEY
 *   3. firebase functions:secrets:set NBD_PLACE_ID
 *   4. firebase deploy --only functions:getGoogleReviews,hosting
 *
 * Cost model:
 *   With a 6-hour TTL we make ~4 Place Details calls per day
 *   ($17/1000 = $0.07/mo at current Google pricing). Effectively free.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

const GOOGLE_PLACES_API_KEY = defineSecret('GOOGLE_PLACES_API_KEY');
const NBD_PLACE_ID = defineSecret('NBD_PLACE_ID');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_DOC_PATH = 'public_cache/google_reviews';

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

/**
 * Fetch Place Details from Google Places API (legacy endpoint — the
 * New Places v1 endpoint has equivalent functionality but different
 * auth/response shape. Legacy is more stable and well-documented.)
 */
async function fetchFromGoogle(placeId, apiKey) {
  const fields = ['name', 'rating', 'user_ratings_total', 'reviews', 'url'].join(',');
  const url =
    'https://maps.googleapis.com/maps/api/place/details/json' +
    `?place_id=${encodeURIComponent(placeId)}` +
    `&fields=${encodeURIComponent(fields)}` +
    '&reviews_sort=newest' +
    `&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Places API HTTP ${res.status}`);
  }
  const body = await res.json();
  if (body.status !== 'OK') {
    throw new Error(`Google Places API status ${body.status}: ${body.error_message || ''}`);
  }
  const r = body.result || {};
  return {
    name: r.name || 'No Big Deal Home Solutions',
    rating: typeof r.rating === 'number' ? r.rating : 0,
    total: typeof r.user_ratings_total === 'number' ? r.user_ratings_total : 0,
    profileUrl: r.url || '',
    reviews: Array.isArray(r.reviews)
      ? r.reviews.slice(0, 5).map((rev) => ({
          author: rev.author_name || 'Google user',
          profilePhotoUrl: rev.profile_photo_url || '',
          rating: typeof rev.rating === 'number' ? rev.rating : 5,
          text: rev.text || '',
          relativeTime: rev.relative_time_description || '',
          time: typeof rev.time === 'number' ? rev.time : Date.now() / 1000,
        }))
      : [],
  };
}

exports.getGoogleReviews = onRequest(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    maxInstances: 3,
    secrets: [GOOGLE_PLACES_API_KEY, NBD_PLACE_ID],
  },
  async (req, res) => {
    const db = admin.firestore();
    const ref = db.doc(CACHE_DOC_PATH);
    const now = Date.now();

    let cached = null;
    try {
      const snap = await ref.get();
      if (snap.exists) cached = snap.data();
    } catch (e) {
      logger.warn('getGoogleReviews: cache read failed', e);
    }

    // Fresh-cache path: serve without hitting Google
    if (cached && cached.fetchedAt && now - cached.fetchedAt < CACHE_TTL_MS) {
      res.set('Cache-Control', 'public, max-age=600');
      return res.status(200).json({
        ...cached.data,
        cached: true,
        stale: false,
        fetchedAt: cached.fetchedAt,
      });
    }

    // Refresh path
    try {
      const placeId = NBD_PLACE_ID.value();
      const apiKey = GOOGLE_PLACES_API_KEY.value();
      if (!placeId || !apiKey) {
        throw new Error('Missing GOOGLE_PLACES_API_KEY or NBD_PLACE_ID secret');
      }

      const fresh = await fetchFromGoogle(placeId, apiKey);
      await ref.set({ data: fresh, fetchedAt: now }, { merge: true });

      res.set('Cache-Control', 'public, max-age=600');
      return res.status(200).json({
        ...fresh,
        cached: false,
        stale: false,
        fetchedAt: now,
      });
    } catch (err) {
      logger.error('getGoogleReviews: refresh failed', err);

      // Stale fallback — better to show old reviews than nothing
      if (cached && cached.data) {
        res.set('Cache-Control', 'public, max-age=120');
        return res.status(200).json({
          ...cached.data,
          cached: true,
          stale: true,
          fetchedAt: cached.fetchedAt || 0,
        });
      }
      return res.status(503).json({ error: 'reviews_unavailable' });
    }
  }
);

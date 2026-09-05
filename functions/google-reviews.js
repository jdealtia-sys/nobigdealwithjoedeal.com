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
 *   1. Enable "Places API (New)" in Google Cloud Console (the legacy
 *      "Places API" cannot be enabled on newer projects). Key
 *      restrictions: server-side calls need IP/none — an HTTP-referrer
 *      restricted key is silently refused. Billing must be active.
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
const { getFirestore } = require('firebase-admin/firestore');

const GOOGLE_PLACES_API_KEY = defineSecret('GOOGLE_PLACES_API_KEY');
const NBD_PLACE_ID = defineSecret('NBD_PLACE_ID');
const { secretValue } = require('./integrations/_shared');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_DOC_PATH = 'public_cache/google_reviews';

// Full-set layer (brief 3/C step 3): syncGbpReviews (gbp-reviews-sync.js)
// writes EVERY review here daily via the Business Profile API — no Places
// 5-review cap. Served while fresh; the Places path below stays as the
// fallback so nothing changes while the sync is dormant/unconfigured.
const GBP_DOC_PATH = 'siteContent/googleReviews';
const GBP_FRESH_MS = 36 * 60 * 60 * 1000; // daily sync + slack

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

/**
 * Fetch Place Details from Places API (New).
 *
 * Migrated off the legacy /maps/api/place/details/json endpoint
 * (2026-07-12): Google no longer enables the legacy Places API on newer
 * Cloud projects, so every legacy call came back REQUEST_DENIED. That
 * throw landed in the cold-cache fallback below on every invocation —
 * the observed `empty: true` payload with a fresh fetchedAt.
 * The v1 endpoint authenticates via headers and REQUIRES `reviews` in
 * the X-Goog-FieldMask or no review data comes back. Google returns at
 * most 5 reviews (hard product limit) sorted by relevance; there is no
 * newest-first parameter on v1 Place Details.
 */
async function fetchFromGoogle(placeId, apiKey) {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'displayName,rating,userRatingCount,googleMapsUri,reviews',
    },
    // A stalled Places response must not hold a billed invocation open until
    // the platform timeout; a timeout throw lands in the stale-cache fallback.
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google Places API (New) HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  const r = await res.json();
  // Guard the last-known-good cache: the legacy endpoint's body.status check
  // threw on degraded payloads BEFORE the cache write; v1 has no in-band
  // status, so an HTTP-200 body missing reviews (field-mask hiccup, profile
  // glitch) would otherwise overwrite good cached reviews with an empty set
  // and the widget would show nothing for the next 6h. This profile has
  // dozens of reviews — an empty list here is an anomaly, not a fact.
  if (!Array.isArray(r.reviews) || r.reviews.length === 0) {
    throw new Error('Google Places API (New) returned 200 with no reviews — refusing to overwrite last-known-good cache');
  }
  return {
    name: (r.displayName && r.displayName.text) || 'No Big Deal Home Solutions',
    rating: typeof r.rating === 'number' ? r.rating : 0,
    total: typeof r.userRatingCount === 'number' ? r.userRatingCount : 0,
    profileUrl: r.googleMapsUri || '',
    reviews: Array.isArray(r.reviews)
      ? r.reviews.slice(0, 5).map((rev) => ({
          author: (rev.authorAttribution && rev.authorAttribution.displayName) || 'Google user',
          profilePhotoUrl: (rev.authorAttribution && rev.authorAttribution.photoUri) || '',
          rating: typeof rev.rating === 'number' ? rev.rating : 5,
          text: (rev.text && rev.text.text) || (rev.originalText && rev.originalText.text) || '',
          relativeTime: rev.relativePublishTimeDescription || '',
          time: rev.publishTime
            ? Math.floor(Date.parse(rev.publishTime) / 1000)
            : Math.floor(Date.now() / 1000),
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
  // 2026-08-10: was the only public onRequest endpoint with NO rate limit at
  // all — each cache-miss/refresh request cost 2 Firestore reads plus (stale
  // cache) an unsynchronized billed Places API call. guardHttp enforces the
  // ROUTES ceilings (per-IP; uid 0 — anonymous marketing-page widget).
  require('./rate-limit-policy').guardHttp('getGoogleReviews', async (req, res) => {
    const db = getFirestore();
    const ref = db.doc(CACHE_DOC_PATH);
    const now = Date.now();

    let gbp = null;
    try {
      const snap = await db.doc(GBP_DOC_PATH).get();
      if (snap.exists) gbp = snap.data();
    } catch (e) {
      logger.warn('getGoogleReviews: gbp doc read failed', e);
    }
    if (
      gbp && gbp.fetchedAt && now - gbp.fetchedAt < GBP_FRESH_MS &&
      gbp.data && Array.isArray(gbp.data.reviews) && gbp.data.reviews.length
    ) {
      res.set('Cache-Control', 'public, max-age=600');
      return res.status(200).json({
        ...gbp.data,
        cached: true,
        stale: false,
        source: 'gbp',
        fetchedAt: gbp.fetchedAt,
      });
    }

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
      // secretValue(): the deploy's '__unset__' stub reads as unset. Before
      // 2026-09-04 both stubs passed a truthiness check and this asked Google
      // for places/__unset__ on every refresh.
      const placeId = secretValue(NBD_PLACE_ID);
      const apiKey = secretValue(GOOGLE_PLACES_API_KEY);
      if (!placeId || !apiKey) {
        throw new Error('Google Places not configured: GOOGLE_PLACES_API_KEY and/or NBD_PLACE_ID unset (or the __unset__ deploy stub)');
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
      // A stale GBP full-set doc still beats an empty payload — old
      // reviews are real reviews.
      if (gbp && gbp.data && Array.isArray(gbp.data.reviews) && gbp.data.reviews.length) {
        res.set('Cache-Control', 'public, max-age=120');
        return res.status(200).json({
          ...gbp.data,
          cached: true,
          stale: true,
          source: 'gbp',
          fetchedAt: gbp.fetchedAt || 0,
        });
      }
      // Cold-cache fallback: return an empty-but-valid payload instead
      // of a 503 — the widget renders its "Read our reviews on Google"
      // card and the static featured section still carries the page.
      // The error is still logged above so the missing-secret / API /
      // quota condition is visible in Cloud Logs.
      res.set('Cache-Control', 'public, max-age=60');
      return res.status(200).json({
        name: 'No Big Deal Home Solutions',
        rating: 0,
        total: 0,
        profileUrl: '',
        reviews: [],
        cached: false,
        stale: false,
        empty: true,
        fetchedAt: now,
      });
    }
  })
);

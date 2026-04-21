# Google Reviews — Setup Runbook

Live Google reviews on `/review` are served by the `getGoogleReviews`
Cloud Function. This doc is the first-time setup. After this is done,
reviews refresh on their own every 6 hours, no manual work.

## 1. Find your Place ID

You need Google's internal ID for your business. Two ways:

1. **Place ID Finder tool** — open
   <https://developers.google.com/maps/documentation/places/web-service/place-id>,
   type "No Big Deal Home Solutions Cincinnati", click the pin. The
   popup shows your Place ID. It starts with `ChIJ...`.
2. **From a Google Maps URL** — search your business on Google Maps.
   The URL contains a long string after `!1s0x...` that isn't the
   Place ID — use the finder above instead. The `?place_id=` query
   parameter is what you want if present.

Save this string. Example: `ChIJ1a2b3c4d5e6f7g8h9i0j`.

## 2. Enable the Places API

In Google Cloud Console, make sure you are on the `nobigdeal-pro`
project (same project Firebase Functions run under).

1. Open
   <https://console.cloud.google.com/apis/library/places-backend.googleapis.com>
2. Click **Enable**. If you see "Already enabled" you're done.
3. (If prompted) accept billing terms. Google gives a $200/month
   maps & places credit; with our 6-hour cache we use < $0.10/mo, so
   you will never pay for this.

## 3. Create an API key

1. Open <https://console.cloud.google.com/apis/credentials>
2. **Create credentials → API key**.
3. Click the new key → **Edit API key**.
4. Under **API restrictions**, choose "Restrict key" and select
   **Places API** only. This limits blast radius if the key ever
   leaks.
5. Under **Application restrictions**, leave as "None" — the key is
   only ever used server-side inside the Cloud Function, never
   exposed to the browser.
6. Copy the key. It starts with `AIza...`.

## 4. Store both values as Firebase secrets

From the repo root:

```bash
firebase functions:secrets:set GOOGLE_PLACES_API_KEY
# paste the AIza... key when prompted

firebase functions:secrets:set NBD_PLACE_ID
# paste the ChIJ... Place ID when prompted
```

Verify:

```bash
firebase functions:secrets:access GOOGLE_PLACES_API_KEY
firebase functions:secrets:access NBD_PLACE_ID
```

## 5. Deploy

```bash
firebase deploy --only functions:getGoogleReviews,hosting
```

The hosting deploy picks up the `firebase.json` rewrite so
`/api/google-reviews` routes through the function.

## 6. Verify

Hit the endpoint directly:

```bash
curl https://nobigdealwithjoedeal.com/api/google-reviews
```

You should see JSON with `rating`, `total`, and a `reviews` array.

Then visit <https://nobigdealwithjoedeal.com/review> — the live
Google section renders above the hand-curated review grid.

## How it behaves

- **Fresh cache (< 6 hours old)** — served from Firestore instantly,
  zero Google API cost.
- **Stale cache** — function refreshes from Google, stores new
  snapshot, serves it.
- **Google down / quota burnt** — function returns the last-known
  snapshot with `stale: true`. The widget shows a small
  "(showing last-known reviews)" note instead of blanking.
- **No cache yet and Google fails** — endpoint returns 503, the
  widget hides itself. Hand-curated review grid still renders.

## When you want to invalidate the cache manually

```bash
# From the Firebase console → Firestore → delete the doc:
public_cache/google_reviews
```

Next page view will trigger a refresh from Google.

## Cost

At a 6-hour TTL we make ~4 Place Details calls per day. Google's
price is $17 per 1,000. Monthly cost ≈ **$0.07**. Effectively free.

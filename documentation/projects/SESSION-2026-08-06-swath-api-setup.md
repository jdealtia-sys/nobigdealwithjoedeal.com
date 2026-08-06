# Session 2026-08-06 — Swath API integration (branch `claude/swath-api-setup-5z6ovd`)

Jo asked to wire up [swathapi.com](https://swathapi.com) (storm-verified
property intel: measured hail events, swath polygons, per-property exposure
reports, coverage-monitor webhooks). Decisions confirmed with Jo up front:
integrate **both** products (hail swaths + property lookups), build against
the pasted public docs, and Jo signs up + sets secrets himself (the key is
shown once; it never touches chat or the repo).

## What shipped

- **`functions/integrations/swath.js`** (new) — adapter + three Cloud
  Functions: `swathWebhook` (HMAC-verified `storm.verified` ingest →
  `storm_events/{id}` + Slack), `getSwathReport` (quote-first, admin-gated,
  30-day cache), `getSwathUsage` (credit meter). Plain helpers
  `fetchSwathHail` / `querySwathProperty` / `verifySwathSignature` are
  consumed by hail.js / parcel.js / smoke tests and deliberately NOT
  mounted on index.js.
- **hail.js** — third provider `swath` (`NBD_HAIL_PROVIDER=swath`, NOAA
  auto-fallback). `getHailHistory` now routes through the shared
  `lookupHail` instead of keeping a byte-identical inline copy — three
  providers × two copies was drift bait. Side effect (additive): the
  fallback response now carries `maxSizeInches`, which the old inline
  fallback path dropped.
- **parcel.js** — provider branch (`NBD_PARCEL_PROVIDER`), cross-provider
  fallback, secrets array now mounts both keys.
- **hail-cron.js** — untouched behavior + a comment making the Swath
  exclusion *deliberate* (500-lead nightly sweep ≈ the whole free plan).
- **storm-proof.js** — mounts `SWATH_API_KEY` so `attachStormProof` can
  resolve when Swath is the provider.
- **integrationStatus** — `swath` / `swathWebhook` configured-flags.
- **Tests** — `tests/smoke/swath-signature.test.js` (behavioral HMAC
  verifier tests: valid/tampered/stale/malformed/fail-closed) + three
  source guards in `security-guards.test.js` (fails closed,
  timingSafeEqual, replay window).
- **Docs** — [runbooks/SWATH-SETUP.md](../runbooks/SWATH-SETUP.md) is the
  Jo-facing setup + credit-model reference; FUNCTIONS_INDEX.md updated.

## Recon findings worth keeping

1. **Firestore nested-array trap in `parcel_cache`** (pre-existing,
   latent): GeoJSON `coordinates` are nested arrays, which Firestore
   rejects. The old `lookupParcel` wrote `parcel.geometry` raw into the
   cache doc **outside any try/catch** — any geometry-bearing Regrid
   result would throw AFTER the paid lookup succeeded and 500 the request.
   Fixed in this branch: geometry is cached as `geometryJson` (string) and
   rehydrated on read; the cache write is best-effort. Every Swath cache
   doc (`swath_hail_cache`, `swath_geometry_cache`, `swath_reports`,
   `storm_events.payloadJson`) stores geometry JSON-stringified for the
   same reason.
2. **FUNCTIONS_INDEX stale line corrected**: `lookupHail` was described as
   shared with "storm briefing" — storm-briefing.js never imports it; the
   real second consumer is `attachStormProof` (handlers/storm-proof.js).
3. **Admin-gate CI tripwire scope**: the smoke checker
   (`tests/smoke/dashboard.test.js` "admin function role-check drift
   guard") scans `functions/*.js` + `functions/handlers/*.js` but NOT
   `functions/integrations/`. The two Swath admin callables are therefore
   listed in the AUTHED table (gate noted in-row), not the ADMIN table —
   listing them there would make the checker fail to find the definitions.
4. **Swath response key spellings are unverified** — the public docs pin
   semantics, not exact JSON keys, for `/v1/storms` and `/v1/property`.
   Normalizers are tolerant; first live call should confirm + prune
   (runbook has the checklist).

## Open follow-ups (deliberately not in this branch)

- D2D/admin UI for `storm_events` + a "pull Swath Report" button on top of
  `getSwathReport` (server side is done; UI is a docs/pro change with CSP
  implications — separate lane).
- Consider Swath in `stormWatch`/`checkStormAlerts` lanes — left alone; the
  webhook monitor covers the real-time case without polling credits.
- After first live storms: prune the tolerant normalizers to the real
  field names and drop this caveat from the runbook.

## Jo's to-do (5 min)

1. Sign up (`POST /v1/signup` with your email) → `firebase
   functions:secrets:set SWATH_API_KEY`.
2. Register the coverage monitor → `firebase functions:secrets:set
   SWATH_WEBHOOK_SECRET`.
3. Optionally flip `NBD_HAIL_PROVIDER=swath` / `NBD_PARCEL_PROVIDER=swath`.
   Everything is dark until then; with only the key set, nothing changes.

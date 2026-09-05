# Free API integrations — verified shortlist (2026-09-02)

Jo's ask: "heavy research on free API integrations — maps improvements,
connections — not to add cost but add ease of usability at little to no cost,
or even better." This is the durable record. Session context:
[SESSION-2026-09-02-daily-driver-and-honest-gates](../projects/SESSION-2026-09-02-daily-driver-and-honest-gates.md).

## Method, and the one thing that went wrong

Ten category sweeps (maps/tiles/imagery, geocoding, parcel/roof, weather/hail,
comms/calendar, lead sources/marketing, docs/e-sign/payments/accounting,
AI/LLM cost, ops free tiers, insurance/permits/public records) produced **80
candidates**. Each got **two adversarial refuters**: a pricing/terms lens
reading the official pricing, ToS and usage-policy pages as of 2026-09-02,
and a codebase-fit lens grepping the repo for duplicate capability, the real
seam, CSP impact and honest effort. 159 of 160 verdicts landed (the Esri
ArcGIS geocoding pricing verdict hung the run; its terms are unverified).
**53 survived, 27 were rejected.** The run's critic + synthesis stages never
executed (one hung agent blocked the barrier) — this synthesis was done by
hand from the journal. Facts below are the refuters' *corrected* facts, not
the sweeps' claims.

Ground truth the research was measured against: Leaflet on raw OSM tiles +
Esri World Imagery + Wayback + RainViewer + IEM NEXRAD; Nominatim
client-side; Google Geocoding server-side; ~20 keyed paid providers with
`NBD_*_PROVIDER` switch seams (`functions/integrations/_shared.js:81-95`);
strict CSP (client-side third-party hosts need `img-src`/`connect-src` in
both the enforced and Report-Only `**` rules, `firebase.json:84-85`);
server-side calls need no CSP change. Scale: hundreds of calls/day.

> **UPDATE 2026-09-04 — two SWDI facts below are wrong, corrected by probing
> the live endpoint** (see `functions/integrations/swdi-hail.js`). The range
> is **not** unlimited: one request may span at most **744 hours (31 days)**;
> longer ranges return HTTP 500 with an `error` string, so the adapter chunks
> the lookup into contiguous windows. And the end date is **exclusive** at
> midnight UTC — `20260516:20260517` returns a 05-16 cell, `20260516:20260516`
> returns nothing. The rest of row 4 held. Row 2 shipped as #1385; row 4 as the
> PR that carries this note.
>
> **UPDATE 2026-09-05 — wave 1 is complete.** Row 1 → #1387 (the Wayback ids
> in `maps-routing.js` were never valid — every tile 404'd; KyFromAbove
> returns a blank PNG outside Kentucky, so it ships as an overlay on Google
> satellite, not a bare basemap). Row 2 → #1385. Row 3 → #1388 (NWS periods
> are 12-hour blocks with an exclusive end; `probabilityOfPrecipitation.value`
> is null for dry periods). Row 4 → #1386. Row 5 → #1389 (a drop-in
> `onSchedule` wrapper, not a per-cron helper call — one import line per file;
> runbook at `documentation/runbooks/HEALTHCHECKS-SETUP.md`). Session record:
> [SESSION-2026-09-05-free-api-wave1](../projects/SESSION-2026-09-05-free-api-wave1.md).
> Next: the wave-2 "Connections" list below, in the order it stands.

## TL;DR — wave 1 (one evening, five PRs)

| # | Win for Jo | Free tier (verified) | Seam | Effort |
|---|---|---|---|---|
| 1 | The historical-imagery slider **works again** (before/after storm proof) + Kentucky 3-inch leaf-off aerials, ~4× sharper than Esri, on the D2D tracker | Wayback config JSON keyless; KyFromAbove public domain, no key, no quota | `maps-routing.js:2404-2413` (use numeric release ids, e.g. 26334 = 2026-08-05) + `wayback.maptiles.arcgis.com` in `img-src`; `d2d-tracker-core-2026b.js:179-191` + `kygisserver.ky.gov` in `img-src`; then `maps-core.js:87-90`, `maps-routing.js:149-176`, `storm-center.js:754`, `widgets.js:651` | S (D2D only) / M (all sites) |
| 2 | Dictation stops costing money | Groq free: 20 req/min, 2,000/day, 8 h audio/day, 25 MB file cap, 10 s minimum billed; commercial use confirmed in the GroqCloud services agreement | `functions/dictate.js:111-133`; extract a Buffer-based `transcribeGroqBuffer()` from `voice-intelligence.js:209-246`; `GROQ_API_KEY` exists, `NBD_VOICE_TRANSCRIPTION_PROVIDER` already defaults to `groq` | S (~45 lines) |
| 3 | Rain-day chip on every scheduled job | NWS API: free, no key, no published quota, "free to use for any purpose"; **no `windGust` field** — precipitation probability, temperature, `shortForecast` only | `smart-calendar.js` `loadSmartCalendar()`; leads carry lat/lng; reuse `storm-center.js`'s User-Agent | S |
| 4 | Radar-derived hail size per cell for any address/date — the "your street took 1.75 in on this date" pitch | NCEI SWDI `nx3hail`: free, keyless, unlimited (the `limit` param is not a cap), bbox + date range, JSON | `functions/integrations/hail.js`: `fetchSwdiHail` beside `fetchNoaaHail` (~`:78`), register in `HAIL_FETCHERS` (`:110-114`) **and** in `preferredHailProvider()` (`:116-120`); `NBD_HAIL_PROVIDER=swdi` | S-M |
| 5 | Jo learns within minutes when a cron stops (OPS_AUDIT P0 #1, engineering half) | Healthchecks.io hobbyist: 20 checks, no card (24 crons → group 4); Better Stack free: 10 monitors + 1 status page | helper beside `functions/integrations/sentry.js`, lazy/no-op when unset, pinged at the end of each `onSchedule`; uptime targets are plain URLs (vendor config) | S-M |

Bonus if time remains: **read-only `.ics` feed** — new `functions/calendar-feed.js`
modelled on `report-sharing.js` (`createCalendarFeedToken` onCall +
`getCalendarFeed` onRequest, token as the last path segment); hand-written
VCALENDAR with CRLF, 75-octet folding, `America/New_York` VTIMEZONE; union of
Cal.com appointments and `scheduledDate` leads with smart-calendar's rep dedup.
No vendor, no cost; Jo subscribes once from the iPhone Calendar app. M.

## Cost reducers (paid providers a verified free option can replace at this scale)

- **Deepgram → Groq Whisper** (above). Cloudflare Workers AI (10,000
  neurons/day ≈ 214 min of whisper-large-v3-turbo) is a second free pool for
  failover; Llama vision on it carries the Meta license attribution.
- **HailTrace / Swath → NCEI SWDI** (above) for hail signatures; **MRMS
  MESH_Max_1440min** is the actual product the swath vendors resell (free on
  AWS Open Data, 30-min cadence, ~6-year archive) but needs a GRIB2 decode
  runtime the Functions gen2 source deploy cannot host — L, own rock.
- **Google Geocoding → Geocodio** (2,500 lookups/day free; field appends
  count as extra lookups; overage $1/1,000) — M, seven files; or the **Census
  geocoder** (free, keyless, 10,000-record batches) for nightly re-verification
  of the whole lead book — M. Note the geocoder seam is `property-intel.js:731`
  (its `geocode()` shadows `dashboard-api.js:308` by load order).
- **Hover/EagleView/Nearmap → Google Solar Building Insights** for quick
  pitch/area: 10,000 free Essentials calls/SKU/month. **`areaMeters2` is
  ground-projected** — divide each segment by cos(pitch) or the square count
  is wrong. Register the key in `_shared.js` `SECRETS`; adapter in
  `functions/integrations/measurement.js`. M.
- **Regrid → county GIS as the free fallback**: CAGIS Hamilton parcels +
  auditor layer (keyless ArcGIS REST, two calls, no published commercial
  terms) and the OGRIP Ohio statewide parcel view (public, commercial use
  unclear). Keep Regrid primary. M.
- **BoldSign → the in-repo `remote-signing.js` path** for estimates: the
  `NBD_ESIGN_PROVIDER` switch exists but nothing branches on it; saves the
  $30/month minimum. M-L.

## Connections (wave 2)

- **Meta Lead Ads webhook** — free; `functions/integrations/meta-leads.js` on
  the `thumbtack.js` template (GET verify handshake, HMAC-SHA256 raw body,
  Graph API fetch with Page-token expiry, `meta_leads` in `BRIDGE_KINDS` /
  `EXTERNAL_SOURCE_COLLECTIONS`). **Meta App Review is mandatory** for lead
  retrieval — Jo starts it early. M.
- **Generic tokenized inbound-lead webhook** — free by construction;
  `inbound-webhook.js`, `webhook_leads`, rules deny block, ci-manifest row,
  `integrationStatus` key. Makes Zapier (100 tasks/mo free), Make, n8n,
  Pipedream and Google Forms a config task. M.
- **Telegram bot** as Jo's alert channel (new lead, storm fire, contract
  signed, payment received, with photo + inline buttons) — free, unlimited at
  this scale; token declared in each consuming function's `secrets`
  (`lead-alert.js:31-36`, `storm-watch.js:37-41`). M. Plus **FCM notification
  actions** ("Call", "Snooze") in `push-functions.js:112` + a
  `notificationclick` handler in `sw.js`. S-M.
- **GA4 Data API + Search Console API** into `functions/marketing-report.js`
  via a service account — both free, no CSP; a `search-console-sync.js`
  modelled on `gbp-reviews-sync.js`. S (email) / M (panel).
- **Google Calendar two-way sync** — free at this scale; clone the OAuth
  refresh-token pattern in `gbp-reviews-sync.js:29-33`; no CSP change
  (`*.googleapis.com` already in `connect-src`). Do the `.ics` feed first. M-L.
- **Calendly API v2 polling** (Jo has an account) — free-plan GET access
  confirmed; rate limit differs by plan. M.
- **Compliance item**: the public funnels' address typeahead
  (`docs/assets/js/storm-check.js`, `roof-score.js`, `storm-report-page.js` +
  three more) is Nominatim autocomplete, which Nominatim's usage policy
  forbids outright. **Geoapify Autocomplete** (3,000 credits/day, soft
  limits, attribution shown, `api.geoapify.com` in `connect-src`). M.

## Data enrichment for D2D and storm work (wave 3)

- **Census TIGERweb** block-group / place polygons (keyless, GeoJSON, 2026
  vintage) → territories that snap to real boundaries;
  `functions/integrations/boundary.js` mirroring `createStormTerritory`. M.
- **Census ACS 5-year** block-group scoring (B25034/B25035 year built —
  the best free roof-age proxy; B25003 tenure; B25077 value) with a free
  `CENSUS_API_KEY`, cached by GEOID. M. Displaces the coarse paid Swath
  screening pass.
- **Cincinnati building permits** (Socrata v2.1, keyless; contractor name,
  cost, date since 2010) as "recent permits nearby" on Property Intel and a
  competitor-activity overlay. `property-intel.js:234` already builds a
  Socrata URL. M.
- **IEM storm-based-warning polygons** (`/api/1/` recommended) in
  `storm-center.js`; **SPC day-1 categorical + hail/wind probability** as a
  pre-positioning signal (client-side point-in-polygon; no turf in
  functions). M each.
- **NCEI Storm Events** bulk CSV for an offline county hail history. M.
- Cheap extras: **OpenFEMA** county declaration flag (daily cron; FEMA's
  disclaimer text is required wherever shown) S; **FEMA NFHL** flood zone via
  a new `hazard.js` `getFloodZone` S-M; **USACE NSI** structure inventory
  (year built, sqft, stories) — L, no address query.
- **Microsoft / Overture building footprints** self-hosted — L (index +
  Storage + viewport function + ODbL attribution).

## Ops freebies

Healthchecks.io + Better Stack (wave 1); **Google Sheets export** ("Open in
Sheets" beside CSV — a CSV on an iPhone is near-unopenable; M for a Jo-only
slice, single-tenant caveat); **Google Cloud Vision** DOCUMENT_TEXT_DETECTION
pre-pass in `receipt-vision.js` (1,000 units/month free; PDFs need
`files:annotate`) S-M; **BigQuery** sandbox for analytics — L.

## Own rock, not a session

QuickBooks Online (Builder tier $0; per-tenant rotating OAuth store has no
precedent, Intuit production review, three write paths) — L. LSA leads via
the Google Ads API (developer-token Basic access) — L. OpenFreeMap /
Protomaps street basemap (MapLibre vendoring + six CSP blocks; at hundreds
of loads/day the current OSM raster use is within policy tolerance with
attribution and a Referer) — M/L. Groq text tier under the Claude proxy (no
text-LLM provider switch exists) — M. Microsoft Clarity and Tawk.to (public
site only; Clarity is an independent data controller — privacy policy
changes) — M-L.

## Rejected — with the refuting fact, so nobody re-researches them

- **Anthropic prompt caching**: no call site has a stable prefix; saving $0.
- **Anthropic Batches API**: no batchable workload; not free.
- **Gemini free tier / OpenRouter free models**: no capability gap, no secret
  slot; not production-grade failover.
- **Cloudflare Workers AI image models** for the visualizer: the free draft
  preview already exists twice.
- **Cloudflare R2/Workers photo serving**: duplicate of `signImageUrl`.
- **Cloudflare edge proxy** for tiles/geocoding: reverses a documented
  decision (`handlers/ai.js` records why the Worker was killed).
- **Gmail API** lead ingestion: fails on restricted-scope terms, not price.
- **Documenso, Square, "stop paying Stripe invoicing fees"**: duplicates of
  `remote-signing.js` and the shipped Payment Links rail.
- **Adobe PDF Extract**: three Claude PDF-parse paths already ship.
- **Mapbox temporary geocoding**: terms forbid storing results (we store).
- **Photon**: no official terms exist. **Google Address Validation**: three of
  four benefits already shipped. **County address points, LINK-GIS NKY, LFUCG
  Lexington parcels, CAGIS footprints, Clermont auditor (empty dataset),
  CAGIS eActivities permits (terms), CAGIS imagery (license unverifiable),
  USGS National Map imagery (functional half dead)**: duplicate capability
  or unverifiable terms.
- **ArcGIS Location Platform** tile licensing: refuted only as "adds no
  capability"; the compliance benefit stands (Jo's optional free key).
- **Brevo, Telnyx/Plivo, Visual Crossing**: not free at the margin, or no new
  capability.

## Evidence (official pages read by the refuters, 2026-09-02)

Groq rate limits `console.groq.com/docs/rate-limits` · NWS
`weather.gov/documentation/services-web-api` · NCEI SWDI
`ncei.noaa.gov/products/severe-weather-data-inventory` · MRMS
`registry.opendata.aws/noaa-mrms-pds` · Geocodio `geocod.io/pricing` ·
Census geocoder `geocoding.geo.census.gov/geocoder` · Geoapify
`geoapify.com/pricing` · Solar API
`developers.google.com/maps/documentation/solar/building-insights` · CAGIS
parcels `data-cagisportal.opendata.arcgis.com` · OGRIP
`ohioparcels-geohio.hub.arcgis.com` · KyFromAbove
`kygisserver.ky.gov/arcgis/rest/services/WGS84WM_Services/Ky_Imagery_Phase3_3IN_WGS84WM/MapServer`
· Wayback `s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json`
· Healthchecks `healthchecks.io/pricing` · Better Stack `betterstack.com/pricing`
· Meta leadgen `developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen`
· Search Console `developers.google.com/webmaster-tools/limits` · GA4
`developers.google.com/analytics/devguides/reporting/data/v1/quotas` ·
Calendar `developers.google.com/workspace/calendar/api/guides/quota` ·
Telegram `telegram.org/tos/bot-developers` · Calendly
`calendly.com/help/calendly-api-overview` · Cloud Vision
`cloud.google.com/vision/pricing` · Cincinnati permits
`data.cincinnati-oh.gov/thriving-neighborhoods/Cincinnati-Building-Permits/uhjb-xac9`
· TIGERweb `tigerweb.geo.census.gov/arcgis/rest/services` · NFHL
`hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer` · Census ToS
`census.gov/data/developers/about/terms-of-service.html` · OpenFEMA
`fema.gov/openfema-data-page/disaster-declarations-summaries-v2` · Intuit
`static.developer.intuit.com/resources/Intuit_App_Partner_Program_Guide.pdf` ·
Workers AI `developers.cloudflare.com/workers-ai/platform/pricing` · BoldSign
`boldsign.com/pricing`.

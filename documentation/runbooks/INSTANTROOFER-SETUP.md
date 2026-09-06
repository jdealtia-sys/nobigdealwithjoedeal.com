# Instant Roofer setup (2026-09-06)

Wiring for [instantroofer.com](https://www.instantroofer.com/instant-roofer-api/) —
AI roof measurement from a coordinate pair (synchronous, 10–20 s) plus a
Human Certified Measure Report (~60 min, drawn by their team, delivered as a
file URL by webhook). It is the **first measurement provider that has ever
had a real key**: HOVER, EagleView and Nearmap were wired in April, but all
three prod secrets are the deploy's `__unset__` stub (verified via Secret
Manager version metadata — one version each, created 2026-04-14 03:25:06/09/12,
three seconds apart, i.e. the stub loop), so every click on the CRM's
auto-measure and D2D "order roof report" buttons had returned "not
configured" for five months.

| Surface | Code | Turn on with |
|---|---|---|
| V2 builder "📐 Auto-measure" | `docs/pro/js/estimate-v2-ui.js` → `autoMeasure` → `NBDIntegrations.requestMeasurement` → `requestMeasurement` (`functions/integrations/measurement.js` → `requestInstantRoofer`) | `INSTANTROOFER_API_KEY` set + a functions deploy |
| D2D "📐 Order precise roof report" | `docs/pro/js/d2d-tracker-core-2026b.js` → `orderRoofReport` (sends the knock pin as lat/lng) | same |
| Human Certified Report (`reportType:'human'`) — **server-side only today, no button** | `requestMeasurement({ reportType:'human' })` → `measurementWebhook?provider=instantroofer` | `INSTANTROOFER_WEBHOOK_SECRET` + the dashboard webhook (§3) |

The pure logic (request body, response normalizer, error table, webhook
parser, bearer check) is `functions/integrations/instantroofer-logic.js`;
`tests/instantroofer-measurement.test.js` pins it against the vendor's
documented example response.

## 1. Two accounts — only the second one has the key

- **dashboard.instantroofer.com** is the contractor bundle (CRM, quoting,
  website widgets, "$199/mo AI Bundle" with a 7-day unlimited-AI trial). Jo
  signed up here first. It does **not** issue an API key; its "Roof Data
  API" card just links to the marketing page.
- **api-dashboard.instantroofer.com** is the API account: phone-number
  login (SMS code + Cloudflare check), a service agreement to sign, a card
  on file (billed weekly on Sundays), and on activation **10 free AI
  measurements + 1 free Human Certified Report** (credits never expire and
  are consumed before paid usage). Account limits as shown on its
  dashboard: **5 requests/minute, 100 requests/day** — ask Support to raise.

Jo did both on 2026-09-06; the API key is active.

## 2. The key — Jo does this, never into chat, the repo, or `docs/`

The dashboard shows the key once at signup and tells you to **regenerate it
before first use** (banner: "For security, go to API Key and regenerate").
Do that, copy the new value, then:

```bash
firebase functions:secrets:set INSTANTROOFER_API_KEY --project nobigdeal-pro
```

(It prompts for the value — paste there.) **A new secret version binds only
on the next functions deploy.** Set the secret *before* merging the PR that
carries this runbook and the merge deploy binds it; if it lands after, run
the deploy workflow with `scope=functions` or
`npx firebase-tools deploy --only functions:requestMeasurement --project nobigdeal-pro --force`.
Verify with the admin readout (`integrationStatus` → `configured.instantroofer`),
not with a green run.

`NBD_MEASUREMENT_PROVIDER` is not set anywhere, so the code default applies —
and that default is now `instantroofer` (`functions/integrations/_shared.js`).
To go back: `NBD_MEASUREMENT_PROVIDER=hover` in `functions/.env.nobigdeal-pro`
(public repo — provider *names* only, never keys).

## 3. Human-report webhook (needed before any `reportType:'human'` order)

Their dashboard refuses a human order without a webhook destination, and
the code refuses too (`failed-precondition`) unless
`INSTANTROOFER_WEBHOOK_SECRET` is set — a $10 report we could never receive
is $10 for nothing. Webhooks are **per report format** (CSV / PDF / HTML /
XML); one completed report fires one delivery per enabled format, and
retries redeliver, so the receiver merges `reportUrls.{format}` idempotently
and keeps the PDF as the headline `measurements.reportUrl`.

API dashboard → **Webhook Delivery** → **PDF Webhook** (and CSV if you want
the data file too):

| Field | Value |
|---|---|
| Enabled | ✓ |
| Webhook URL | `https://us-central1-nobigdeal-pro.cloudfunctions.net/measurementWebhook?provider=instantroofer` |
| Timeout (seconds) | `15` (our function's own timeout) |
| Bearer token | click **↻ generate**, then **copy** — this is the value of `INSTANTROOFER_WEBHOOK_SECRET` |
| Auth header name | `Authorization` (default) |
| Additional headers | leave empty |

Payload fields (`+ Add row`, key → dynamic value) — the receiver
(`parseHumanWebhook`) reads these names and the snake_case originals, and
accepts `status` as either the string or the numeric `order.status_code`:

| Key | Dynamic value |
|---|---|
| `requestId` | `order.request_id` ← **required**, it is our `externalJobId` |
| `humanReportId` | `order.id` |
| `status` | `order.status` |
| `statusCode` | `order.status_code` |
| `reportType` | `report.type` |
| `reportUrl` | `report.url` |
| `failureReason` | `order.failure_reason` |
| `latitude` | `order.latitude` |
| `longitude` | `order.longitude` |
| `originalAddress` | `order.original_address` |

Then:

```bash
firebase functions:secrets:set INSTANTROOFER_WEBHOOK_SECRET --project nobigdeal-pro
```

The receiver compares `Authorization: Bearer <token>` constant-time, fails
closed with **503** when the secret is unset and **401** on a mismatch
(same shape as the HOVER/EagleView HMAC path). What arrives is a **file
URL only** — the payload never carries numbers. Turning the CSV into
ridge/hip/valley/eave/rake linear feet is a follow-up (see the session
note). The URL lands on the measurement doc as `reportUrls.{format}` and
`measurements.reportUrl`, which the D2D card renders as "Open PDF" — but
**nothing in the CRM orders a human report yet**: no button passes
`reportType:'human'`, so today it is reachable only by calling
`requestMeasurement` directly. Adding that control is the follow-up; this
section makes the receive path ready. Set the secret even if you are not
ordering reports yet — the callable refuses `reportType:'human'` without it,
and this form is the only place the token is ever shown.

## Cost model — why the code is stingy

| Call | Vendor price (2026-09-06) | Our guard |
|---|---|---|
| AI measure | $3 (0–199/mo), $2 (200–999), $1 (1,000+); 10 free credits first | 20/hr per uid; **5/min account meter** (their published limit); **90-day reuse** — a ready measurement under the same 5-decimal coordinate key, same tenant, is *copied* into a new doc for the caller (`reusedFrom`, `billed:false`) instead of re-billed; `passThruEligible:false`, so no $75 line is added to the customer quote for an internal AI cost |
| Human Certified Report | $10 on completion; 1 free credit first | refused without the webhook secret; vendor 409s a duplicate for the same coordinates inside their window; pass-through eligible (a document the homeowner receives) |
| 404 "roof not found" / 422 "too large or irregular" | unknown whether billed — **check Billing after the first one** | the error message tells the rep to put the pin on the building |

Weekly invoice every Sunday against the card on file; the Billing page
shows the tier counters live.

## What the numbers mean (do not double-apply waste)

- `rawSqft` = the vendor's `sqft.measured` — footprint with the predominant
  pitch applied, i.e. the roof surface. **No waste.** The V2 builder and the
  D2D card add their own waste on top, exactly as they did for HOVER's
  `total_facets_area_sqft`.
- `suggestedSqft` / `squares` = the vendor's material figure *with* waste,
  kept for comparison only.
- `pitch` is the predominant pitch as `"5/12"`; `complexity` 0–3 (Low /
  Moderate / High / Extreme); `wastePct` from `buildingPredictions.complexityWaste`
  (read as a fraction when ≤ 1); `confidence.{score,label}` — their buckets are
  Low < 0.24, Medium 0.24–0.34, High ≥ 0.35; `stories` is a beta field.
- The AI response has **no ridge / hip / valley / eave / rake** — only the
  human report (as a file) does. Their API V3 announcement (seen in the
  dashboard 2026-09-06) adds eave/rake/ridge/valley/sidewall/headwall
  lengths and roof height, each with a confidence score, and **discontinues
  raw LiDAR point data immediately** — the adapter already ignores it.

## Coordinates — the part that bites

The API takes **only** `latitude`/`longitude` and returns 404 unless the
point is on the building. `requestMeasurement` resolves them in this order
and records `coordSource` / `coordPrecision` on the doc:

1. `lat`/`lng` from the caller — the D2D knock pin, or (later) the public
   wizard's geocode;
2. the lead: `lead.lat/lng` (CRM Nominatim at save time), then
   `lead.parcel.center` (Regrid parcel centroid);
3. server geocode: Google (ROOFTOP results only) → Regrid → Nominatim. In
   prod today only Nominatim is live — `GOOGLE_GEOCODING_API_KEY` and
   `REGRID_API_TOKEN` are also the April stub — and Nominatim is
   street-interpolated wherever OSM lacks the building footprint, so the V2
   status line says so and asks the rep to confirm the pin. Results are
   cached in `geocode_cache/`.

Bridged web leads and Thumbtack leads carry **no** coordinates (the public
form allowlist drops the wizard's `lat`/`lon`; `lead-bridge-logic` copies
none) — those fall through to step 3.

## Caveats / first-use verification

- **Field tolerance to tighten after the first live call**: whether
  `complexityWaste` is a fraction or a percent, and whether the webhook's
  `status` arrives as a string or a status code. The first AI response is
  kept on the measurement doc as `vendorResponse` (image and LiDAR blobs
  replaced by `[stripped]`) — read one back and prune.
- `resultOptions` is sent as `{ mapWithOutlineFromImageModel:false, facetMeta:true, facetPoints:false }`
  (the three documented keys). If the sandbox answers 400 to explicit
  `false` values, drop `resultOptions` (`AI_RESULT_OPTIONS` in
  `instantroofer-logic.js`) — the outline image is wanted later by the
  public wizard, client-side only, never persisted.
- **Reps vs admins (pre-existing)**: `integrationStatus` is admin-only, so
  the V2 builder's Auto-measure gate reports "not set up" to ordinary reps;
  the D2D button calls the callable directly and works for everyone.
- **ToS**: "Powered by Instant Roofer" must appear on every *visible,
  indexable* page using their technology. Nothing public uses it yet (the
  CRM is authenticated; `privacy.html` only discloses them as a
  sub-processor). The public-wizard slice must add the mark.
- **Found in passing**: `TURNSTILE_SECRET` is the April stub too, so
  `submitPublicLead` is IP-rate-limit-only today. Fix before the wizard
  slice exposes a $3 call to anonymous traffic.
- `measurements/{jobId}` rules are uid-scoped; the 90-day reuse copies the
  doc under the caller's uid precisely so a colleague's job stays readable.

## Related

- [SECRET_ROTATION](SECRET_ROTATION.md) — the two Instant Roofer secrets are in its list now
- Session note: [SESSION-2026-09-06-instantroofer-adapter](../projects/SESSION-2026-09-06-instantroofer-adapter.md)
- The research note this supersedes for measurement: [FREE-API-INTEGRATIONS-RESEARCH-2026-09-02](../audit/FREE-API-INTEGRATIONS-RESEARCH-2026-09-02.md) (dated correction at its top)

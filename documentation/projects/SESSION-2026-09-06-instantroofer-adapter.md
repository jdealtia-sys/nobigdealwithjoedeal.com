# Session 2026-09-06 — Instant Roofer as the first real measurement provider

Jo: "check this out, I'm really wanting to integrate it" — instantroofer.com.
Runbook: [INSTANTROOFER-SETUP](../runbooks/INSTANTROOFER-SETUP.md). Branch
`claude/instantroofer-measurement-adapter` (worktree `C:\Users\jonat\nbd-wt-ir`,
cut from `origin/main` at `6e8b14b9`).

## The decision, in one paragraph

Instant Roofer is two products. The **$199/mo contractor bundle** (CRM,
quoting, e-sign, payments, website calculator) duplicates ~80% of `docs/pro/`
and its embed widget would need a CSP allow-list change and hand the
homeowner's first interaction to their script. The **measurement API**
(`POST https://v5.instantroofer.com/v2` with `{latitude, longitude}`, Bearer
key, 10–20 s, $3/address, plus a $10 ~1 h human-certified report by
webhook) fills a real hole — and it slots into an adapter that already
existed. So: API only, as a provider of `functions/integrations/measurement.js`.

## What shipped

- `functions/integrations/instantroofer-logic.js` — pure: request body,
  response normalizer (against the vendor's documented example), HTTP error
  table → `HttpsError` codes, human-report ack + webhook parser, per-format
  URL merge, constant-time bearer check, coordinate validation / dedup key.
- `functions/integrations/measurement.js` — `requestInstantRoofer` with a
  `deps.fetchImpl` seam; the callable now accepts `{lat, lng, reportType}`,
  resolves coordinates (client → lead → parcel → Google/Regrid/Nominatim),
  meters the vendor's 5/min limit, **reuses a ready measurement for the same
  roof + tenant within 90 days** (copied into a caller-owned doc because
  `measurements/` rules are uid-scoped), attaches the result to the lead on
  the synchronous path (task on `leads/{id}/tasks`, activity,
  `measurementReady`) — the webhook was the only path that did this before,
  and its task went to the top-level `tasks` collection that no UI has read
  since migration 006. `selectProvider` fails loudly on an unknown value
  instead of silently billing HOVER. Timeout 30 → 60 s. Webhook gains an
  `instantroofer` branch (bearer token, per-format `reportUrls`, never
  regresses `ready`). `exports._test` seam.
- `_shared.js`: `INSTANTROOFER_API_KEY`, `INSTANTROOFER_WEBHOOK_SECRET`;
  **default measurement provider flipped `hover` → `instantroofer`** (no
  test pinned the old default; nothing else was ever configured).
- `handlers/integrations.js`: `configured.instantroofer` /
  `.instantrooferWebhook` (the D.3 completeness smoke test requires every
  registered secret to appear there — it would have gone red otherwise).
- Client: `integrations-client.js` default `instantroofer`, forwards
  `lat/lng/reportType`, honest toast for a synchronous result;
  `estimate-v2-ui.js` sends the lead's stored coords, applies a synchronous
  result without polling, adds the $75 pass-through **only for pass-through-
  eligible reports** and matches the existing line by code as well as `source`
  (a reopen resets `source`, which let a second auto-measure duplicate the
  line); `d2d-tracker-core-2026b.js` sends the knock pin. `docs/privacy.html`
  discloses Instant Roofer as a measurement sub-processor (smoke test list
  extended).

  **Amended later the same day (Jo):** AI measures are billed through too —
  every measurement is now `passThruEligible`. The exclusion had been mine, on
  the reasoning that a $3 internal cost with no deliverable should not carry a
  $75 line; Jo's call is that the measurement is work performed either way.
  What survived the change is the *wording*: a new `passThruHasDocument` flag
  makes the line read "Aerial measurement report" only when a document actually
  exists (HOVER/EagleView PDF, human report) and "Aerial roof measurement"
  otherwise, so no invoice claims a report that could never be produced.
- `tests/instantroofer-measurement.test.js` (131 assertions; node bucket;
  FLOORS 52/65/131 → 53/65/132), `tests/smoke/functions.test.js` provider +
  secret-binding assertions, `FUNCTIONS_INDEX.md` rows,
  `scripts/deploy-runbook.sh` recommended-secret list.
- Vault: the runbook, this note, INDEX links, a dated correction on
  [FREE-API-INTEGRATIONS-RESEARCH-2026-09-02](../audit/FREE-API-INTEGRATIONS-RESEARCH-2026-09-02.md)
  (which had recommended swapping the trio for Google Solar), a section in
  [SECRET_ROTATION](../runbooks/SECRET_ROTATION.md), and Jo's queue item on
  the current handoff.

## Recon findings worth keeping

- **The whole measurement lane had never fired.** HOVER / EagleView / Nearmap
  keys are the deploy stub (one Secret Manager version each, created
  2026-04-14 03:25:06 / :09 / :12). Same for `GOOGLE_GEOCODING_API_KEY`,
  `REGRID_API_TOKEN` **and `TURNSTILE_SECRET`** — so no server-side geocoder
  works in prod and `submitPublicLead` is IP-rate-limit-only. Nothing in the
  vault recorded any of this; the stability audit had the geocoders.
- The public `/estimate` wizard never measures: a small/typical/large tile →
  `SIZE_SQUARES {14,20,30}` → Claude is prompted to *guess* `roofSqft`. It
  already geocodes to lat/lon and posts them, but `submitPublicLead`'s
  allowlist drops non-strings and `lead-bridge-logic` copies no coordinates,
  so no web lead has ever carried `lat/lng`.
- `measurementWebhook`'s task write went to top-level `tasks` — dead since
  migration 006; every task UI reads `leads/{id}/tasks`. The
  `measurement_ready` activity has no client renderer either (only the AI
  texting prompt reads activity labels).
- `integrationStatus` is admin-only, so `NBDIntegrations.requestMeasurement`
  fails closed for ordinary reps (V2 Auto-measure); the D2D path calls the
  callable directly and works for everyone. Pre-existing, left alone.
- Two vendor accounts: dashboard.instantroofer.com (bundle trial, no key)
  vs api-dashboard.instantroofer.com (phone login, agreement, card,
  10 AI + 1 human credit, **5 req/min, 100/day**). The API dashboard's
  banner tells you to regenerate the key before first use.
- API V3 (announced in-dashboard 2026-09-06) will add eave/rake/ridge/valley/
  sidewall/headwall lengths + roof height with confidence scores and has
  already dropped raw LiDAR points — the AI path will then cover the linear-
  feet fields the V2 builder wants. Watch for the migration doc.
- ToS: "Powered by Instant Roofer" on every visible indexable page using the
  tech; not sold/shared lead data; addresses used to train their models.

## Adversarial review

Six diverse-lens finders over the diff, each finding attacked by three
independent refuters. Four findings were fixed in this branch:

1. **(high, found twice independently) The human-report webhook threw away the
   $10 report's URL.** The merge did
   `if (human.reportUrl && human.reportType) reportUrls[human.reportType] = …`,
   but Instant Roofer's own documented *minimum* payload is
   `{requestID, url, status}` with **no** `report_type` — and the payload keys
   are configured in their dashboard, so any field we did not map produced the
   same result: URL discarded, `reportUrls` never written, doc still flipped to
   `ready`. Now keyed as `reportUrls[format || 'report']`. My own test suite had
   two assertions in this area and neither caught it — both checked `status`,
   not the URL's survival through the merge.
2. **(medium) The 90-day reuse window could never expire.** A reuse copy is
   itself a reuse candidate and carried `createdAt: serverTimestamp()`, which
   is what the freshness filter read — so every cache hit restamped the roof as
   freshly measured and one measurement could be served forever. Docs now carry
   `measuredAt` (when the vendor was actually called); copies inherit it and
   `measuredAtMs()` ages off that.
3. **(medium) I broke the admin "Measurements ready" tile.** Folding
   `passThruEligible` into `readyMeas` made `ready30d` exclude every AI measure —
   i.e. the tile would read 0 next to `requested30d: 40` under the new default
   provider, which reads as "the integration is broken". `ready30d` counts all
   delivered measurements again; only the revenue estimate filters, and
   `billable30d` is exposed alongside it.
4. **(medium) The runbook over-promised the human-report surface.** Its table
   implied a CRM control exists; no caller passes `reportType:'human'`. Marked
   server-side-only with the follow-up named.

## Live verification (1 of the 10 free credits)

After Jo set the key, one real AI measure against **their documentation's own
example coordinates** (not a customer property): `HTTP 200`, 1,536 bytes, and
the normalizer's output correct in every field. It settled three things the
code had been carrying tolerant parses for:

- `resultOptions` with explicit `false` values is accepted **and effective** —
  `imagery` came back empty, `lidar` carried only `facets`. The 1 MiB Firestore
  worry is moot as long as we keep sending it.
- `complexityWaste` is a **percent** (`11`), not a fraction. Both readings were
  tolerated and both land on 11; kept tolerant on one sample, since the two
  interpretations differ by 100× on an estimate's waste line.
- The response carries an **undocumented top-level `coordinates`** echo of the
  point actually measured — a free confirmation that we measured the right
  building.

Still unverified: the human-report webhook's `status` shape, because no human
report has been ordered. Both branches stay until one arrives.

## Second review pass — 14 confirmed findings

The six-lens run returned 25 findings; 14 survived three independent refuters,
11 were refuted. Beyond the four already listed above, the ones worth naming:

- **The reuse window was a blind lottery.** `findReusableMeasurement` is
  equality-only (no `orderBy` — that needs a composite index CI never deploys),
  so Firestore returns rows in document-ID order, which is random. Worse, every
  cache hit wrote another doc carrying the same `coordKey`, so the window
  filled with copies and the original became unfindable — silently re-billing
  $3. Copies no longer carry `coordKey`; only vendor-billed originals populate
  it, so N stays ~1 per roof per tenant.
- **The "measurement ready" task could never appear.** It was written with
  `dueDate: ''`, and both `tasks.js` and `notif-bell.js` do
  `t.dueDate ? new Date(...) : null` and return early on null. `dueAt`, which it
  did set, has no reader in the repo. The same *features-exist-but-unmounted*
  shape as the top-level `tasks` write it had already replaced.
- **Concurrent per-format webhook deliveries would erase each other.** One
  completed report fires one delivery per enabled format; the handler did a
  read-modify-write of the whole `reportUrls` map, so PDF and CSV each read `{}`
  and the later write won. Now a dotted field path, merged server-side.
- **No spend cap on the $10 path.** The 90-day reuse guard is AI-only and the
  other two meters are throughput limiters (20/hr/uid, 5/min/account = 300
  paid calls/hour). Human orders now have their own 2/hr/rep + 20/day/company.
- **Two definitions of "webhook configured".** The order gate used
  `hasSecret()` (any non-stub string) while the receiver rejects anything under
  16 chars as *unconfigured* → a short token would buy a $10 report and then
  503 every delivery of it. One shared `MIN_WEBHOOK_SECRET_LEN` now.
- **A flat roof would have priced as steep.** `parseInt('0/12')` is 0 and
  `parseInt('2/12')` is 2 — neither is an option in `#v2pitch` (3–16), so the
  select went blank and the estimate priced off a rise nobody chose. Parsed
  with the server's grammar and clamped.
- **The confirm-the-pin warning could not fire where it mattered.** Passing the
  lead's stored coordinates from the client labelled them `client` —
  indistinguishable from a real D2D knock pin — on exactly the leads whose
  coordinates came from a Nominatim `limit=1` geocode. The client now sends
  only `leadId`; the server reads the same coordinates and tags them honestly,
  and the warning fires for any non-rooftop precision.
- Repeat Auto-measure clicks stacked duplicate task/activity rows (now one
  deterministic id per lead+roof); the Google/Regrid geocode legs escaped the
  `deps.fetchImpl` seam so the cache assertion was weaker than it read; and the
  runbook's fallback deploy command rebound only `requestMeasurement`, not the
  `integrationStatus` it told you to verify with.

## Slice 2 — the public funnel measures for real (same session, second PR)

Jo picked two of the three follow-ups: the public wizard ("genius") and
measure-on-submit ("legit"), and passed on the CSV parse for now. Recon
collapsed them into **one** mechanism, because of where the funnel captures
contact details:

| Step | Asks | Vendor cost |
|---|---|---|
| 1 | Address → Nominatim geocode (`lat`/`lon` exist from here on) | free |
| 2 | "Is this your home?" — zoom-19 satellite confirm | free |
| 3 | Service, size tile, timeline | free |
| 4 | **Ballpark reveal** (the `SIZE_SQUARES {14,20,30}` guess) | free |
| 5 | **"Verify Your Info to Unlock"** — name, SMS-verified phone, email | — |

Contact capture is step 5, *after* the free ballpark. So nothing anonymous
ever needs to trigger a paid call: the measurement happens when the CRM lead is
created, and the unlock reveal reads it back. One mechanism serves both
slices, the $3 is 1:1 with a real lead, and **Turnstile stops being a
blocker** — which matters, because it turns out there is no CAPTCHA at all
today (below).

**What shipped**

- `functions/integrations/public-measure.js` — `measureNewWebLead`
  (`onDocumentCreated leads/{leadId}`, the only unattended spender) and
  `publicRoofMeasure` (public `onRequest`, **read-only**). The trigger is
  gated to bridged estimate leads with coordinates, writes a deterministic
  `measurements/weblead-{leadId}` with `create()` so a redelivery collides
  instead of re-billing, honours the 90-day reuse cache, is capped at 25/day,
  and checks a new `feature_flags/global.webLeadMeasureDisabled` kill switch.
- **The coordinates finally survive.** The wizard has always POSTed `lat`/`lon`
  (`4053149b2f.js:957-958`) but `submitPublicLead`'s optional loop drops every
  non-string, so no estimate lead has ever carried them — the same class of bug
  as the `tcpaConsent` boolean fixed on 2026-09-04. Added `numOptional` beside
  the existing `boolOptional` (range-checked, `0,0` rejected) and taught
  `mapPublicLeadToLead` to copy them as the canonical `lat`/`lng`.
- **The wizard uses them without letting a model do the money math.** When a
  measurement exists the prompt states the size is aerially measured and must
  be used exactly, and the returned `roofSqft`/`squares`/`tiers` are then
  *overwritten* from `tiersFromSquares()` — real squares × NBD's per-square
  ranges, $25 rounding, $2,500 minimum. The model keeps `joesTake` and
  `yearBuilt`. The offline fallback uses the measurement too, so an AI outage
  no longer costs the homeowner an accurate number.
- The results page drops its `~` for a measured roof, adds a low-confidence
  caveat, and carries the ToS-required "powered by Instant Roofer" line.
- The kanban chip now shows `📐 38.7 sq · 5/12` — because the recon found that
  shipping the measurement alone would have been **invisible**:
  `lead.measurementReady` had exactly one reader (a static chip),
  `lead.measurementJobId` had none, and `leads/{id}/activity` has six writers
  and zero client readers. The *features-exist-but-unmounted* pattern again,
  caught before it shipped this time.
- `tests/public-measure.test.js` — 55 assertions, node bucket, FLOORS → 54/65/133.

**Found and NOT fixed — the public funnel has no CAPTCHA at all.** It is not
just that `TURNSTILE_SECRET` is the April stub: `window.__NBD_TURNSTILE_SITEKEY`
is `""` (`docs/assets/js/inline/7cd8e505ab.js:10`), no `docs/` page contains a
`.cf-turnstile` element, so the widget script is never fetched and
`submitPublicLead` receives no token from any NBD page. `verifyTurnstile`
returns `{ok:true, configured:false}` and waves everything through. Public
forms rest on a honeypot and an IP rate limit. **Order of operations if Jo
fixes it: populate the site key → deploy → only then set the secret.** Setting
the secret first 403s 100% of public leads — spelled out at
`7cd8e505ab.js:4-9` and pinned by `tests/turnstile-contract.test.js:6-11`.
This is also the gate on ever showing the measurement *before* contact capture.

**Volume, honestly.** Nothing in the repo breaks leads down by source: 181→199
over 2026-08-18→09-04 is a total across D2D, manual, Cal.com and Thumbtack, and
`weeklyDigest`'s counter has never sent. Treat ~32/month all-sources as an
*upper bound* on web-form rate — so roughly $3/day at worst, which is why the
daily cap is 25 and not 200.

## Open follow-ups (deliberately not in this branch)

1. ~~Public wizard slice~~ and ~~measure on submit~~ — **both shipped**, as one
   mechanism (see above). What remains of the original idea: showing the
   measurement and the roof-outline image *before* contact capture, which needs
   Turnstile wired first, plus a CSP `img-src` entry or a re-host for the
   outline (`firebase.json:89` lists no instantroofer host, so the image would
   be silently blocked today).
2. **Human report CSV → linear feet** — the webhook delivers a file URL
   only; fetch + parse the CSV into ridge/hip/valley/eave/rake once a sample
   exists (the free credit is for exactly that).
4. Company-scoped `measurements/` rules (today: uid-owner + platform admin),
   so a manager can poll a teammate's job without the copy trick.
5. Let reps use V2 Auto-measure: a rep-safe subset of `integrationStatus`
   (just `providers.measurement` + `configured[that]`).
6. Store the outline image in Storage (EXIF-stripped) for the CRM card.
7. Tighten the human-webhook `status` parse once a real delivery lands (the AI
   parses were verified live — see above).

## Jo's to-do (10 minutes)

1. API dashboard → **API Key → regenerate**, copy, then
   `firebase functions:secrets:set INSTANTROOFER_API_KEY --project nobigdeal-pro`
   (paste at the prompt — never into chat).
2. Webhook Delivery → PDF webhook per the runbook table; **generate + copy**
   the bearer token, then
   `firebase functions:secrets:set INSTANTROOFER_WEBHOOK_SECRET --project nobigdeal-pro`.
3. Merge the PR **after** step 1 so the deploy binds the real version; then
   open any lead with an address in the V2 builder and press 📐 Auto-measure.

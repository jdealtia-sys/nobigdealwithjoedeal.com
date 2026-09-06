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
  eligible reports** (AI measures are an internal cost) and matches the
  existing line by code as well as `source` (a reopen resets `source`, which
  let a second auto-measure duplicate the line); `d2d-tracker-core-2026b.js`
  sends the knock pin. `handlers/admin.js` excludes AI measures from the
  pass-through revenue estimate. `docs/privacy.html` discloses Instant
  Roofer as a measurement sub-processor (smoke test list extended).
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

See the "Review" section appended below once the workflow has run; findings
that survived were fixed in the same PR.

## Open follow-ups (deliberately not in this branch)

1. **Public wizard slice** — replace the size tile with a real measurement +
   outline image (client-side, never persisted); needs a working Turnstile
   secret, a per-IP limit, the rounded-coordinate cache, and the "Powered
   by" mark. The callable already returns `measurements` directly so the
   wizard need not poll.
2. **Measure on submit** — hook `leadBridgeEstimate` to measure every
   submitted estimate lead (requires allowlisting numeric `lat/lon` in
   `submitPublicLead` and copying them in `mapPublicLeadToLead`).
3. **Human report CSV → linear feet** — the webhook delivers a file URL
   only; fetch + parse the CSV into ridge/hip/valley/eave/rake once a sample
   exists (the free credit is for exactly that).
4. Company-scoped `measurements/` rules (today: uid-owner + platform admin),
   so a manager can poll a teammate's job without the copy trick.
5. Let reps use V2 Auto-measure: a rep-safe subset of `integrationStatus`
   (just `providers.measurement` + `configured[that]`).
6. Store the outline image in Storage (EXIF-stripped) for the CRM card.
7. Tighten the two tolerant parses after the first live call (see runbook).

## Jo's to-do (10 minutes)

1. API dashboard → **API Key → regenerate**, copy, then
   `firebase functions:secrets:set INSTANTROOFER_API_KEY --project nobigdeal-pro`
   (paste at the prompt — never into chat).
2. Webhook Delivery → PDF webhook per the runbook table; **generate + copy**
   the bearer token, then
   `firebase functions:secrets:set INSTANTROOFER_WEBHOOK_SECRET --project nobigdeal-pro`.
3. Merge the PR **after** step 1 so the deploy binds the real version; then
   open any lead with an address in the V2 builder and press 📐 Auto-measure.

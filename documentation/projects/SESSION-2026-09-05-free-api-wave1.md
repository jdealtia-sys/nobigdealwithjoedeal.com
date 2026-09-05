# Session 2026-09-05 — free-API wave 1 shipped, plus four handoff items

> Session record. The live brief is [NEXT_SESSION-2026-09-06](NEXT_SESSION-2026-09-06.md).
> Built from [FREE-API-INTEGRATIONS-RESEARCH-2026-09-02](../audit/FREE-API-INTEGRATIONS-RESEARCH-2026-09-02.md)
> (wave 1, all five rows) and [NEXT_SESSION-2026-09-05](NEXT_SESSION-2026-09-05.md) (items 3, 5, 6).
> Dates: work ran the evening of 2026-09-04 local; every PR merged 2026-09-05 UTC.

## What shipped

| PR | | Verified how |
|---|---|---|
| #1385 | **Dictation on Groq's free tier**, Deepgram demoted to fallback (wave 1 #2) | 34-assertion decision table; full functions index loads; not a live Groq round-trip (needs an authed client) |
| #1386 | **NCEI SWDI radar hail** as a keyless provider, `NBD_HAIL_PROVIDER=swdi` (wave 1 #4) | live call through the adapter: 313 cells within 25 mi of Cincinnati in 180 days, max 2.25 in; 42 assertions on captured rows |
| #1387 | **Wayback slider fixed** (it had never shown a tile) + **KyFromAbove 3-inch** basemap on D2D (wave 1 #1) | all 14 release ids → 200 image/jpeg; KY z16/z19 → 200 image/png; a Cincinnati tile from the KY server → 190-byte blank (the reason it is an overlay); 31 assertions |
| #1388 | **NWS rain-day chip** on every scheduled job (wave 1 #3) | live /points → /gridpoints probe; 45 assertions incl. the 18:00 period boundary and a cache TTL |
| #1389 | **Healthchecks.io heartbeat from all 25 crons** — one import line per file (wave 1 #5) | full index loaded: 25 scheduled exports, every one binds `HEALTHCHECKS_PING_KEY`, existing secrets intact; 63 assertions; runbook |
| #1390 | **`__unset__` stub no longer passes as configured** — 17 files, 25 reads, guard test (handoff item 3) | 29 assertions, three source contracts over all of functions/; every suite touching the files green |
| #1391 | **GA4 on all 174 public landing pages** (handoff item 5) | `--check` exited 1 before / 0 after; SEO gate 0 errors on 216 pages; 23 assertions |
| #1392 | **Three storm/roof funnels record the TCPA consent they gate on**, label says "text" (handoff item 6) | T20 went red on the widened list as designed; 30 assertions |

Eight PRs, eight new node-bucket suites (node bucket 55 → 63), zero new
Cloud Functions, one new secret (`HEALTHCHECKS_PING_KEY`, stub-created by
the deploy's auto-discovery).

**Verified live after the #1389 deploy completed** (it carried #1385–#1389;
the #1387 and #1388 deploy runs were cancelled by the queue, see below):
`/pro/dashboard` sends both new `img-src` hosts on its CSP, the served
`maps-routing.js` carries the numeric Wayback releases, the served
`smart-calendar.js` exposes `NBDForecast`, and `/api/google-reviews` still
answers 200 with `rating:0` — the Places secrets are still the stub, as
expected. The GA4 tag on landing pages and the consent changes ride the
next deploy (#1391/#1392).

## Facts learned by measuring — several contradict the notes they came from

- **NCEI SWDI caps a request at 744 hours (31 days)**; longer returns HTTP
  500 with an `error` string. The research note called the range unlimited.
  And the **end date is exclusive at midnight UTC**: `20260516:20260517`
  returns a 05-16 cell, `20260516:20260516` returns nothing. The adapter
  chunks into contiguous 30-day windows whose last one ends the day AFTER
  today. Corrected in the research note (dated block).
- **The Wayback slider never worked.** `WB_2024_R06`-style ids 404; numeric
  release ids from Esri's `waybackconfig.json` serve. Ids are not
  chronological (2026-08-05 is 26334, 2014-06-25 is 11033), so the table
  carries the date beside the id and the test pins every pair.
- **KyFromAbove returns a blank transparent PNG outside Kentucky**, so a bare
  basemap would be a void in Ohio; it ships as an overlay on Google
  satellite inside a `layerGroup`.
- **NWS forecast periods are 12-hour blocks with an exclusive end**; a 4 pm
  inspection and a 9 pm one fall in different blocks, and
  `probabilityOfPrecipitation.value` is `null` for dry periods — rendered
  as a dash, never as "0 %". There is no wind-gust field in that product.
- **`Number(null) === 0`** keyed a forecast for 0°,0° for a lead with no
  coordinates — caught by the new test before commit.
- **Cloud Functions gen2 exposes the export name as `FUNCTION_TARGET`**;
  `K_SERVICE` is the lowercase Cloud Run name. Slugs derive from the former.
- **The handoff's item 3 was two-thirds wrong.** Sentry (`sentry.js:33`) and
  Turnstile (`turnstile.js:41`) already gate on `hasSecret()`; the audit's
  corrected list (four functions: getGoogleReviews, transcribeVoiceMemo,
  dictate, notifyNewLead) was accurate, and the same shape was in every
  `EMAIL_FROM.value() || …` sender and four `try { x = KEY.value() } catch`
  reads — including `storm-proof`'s `GOOGLE_GEOCODING_API_KEY`, which IS the
  stub in prod.
- **`functions/handlers/_shared.js` and `functions/integrations/_shared.js`
  share a basename.** Adding `secretValue` to a handler's
  `require('./_shared')` destructuring loads fine and throws `TypeError` at
  call time. Made that mistake mid-PR; the guard test now forbids it.
- **The two "unexplained cancelled deploys" from 09-03 are explained.**
  `firebase-deploy.yml` uses `concurrency: firebase-deploy` with
  `cancel-in-progress: false`. GitHub keeps ONE pending run per group, so a
  rapid merge cancels the previous *queued* run; the newest carries every
  change. Today's #1387 and #1388 deploys were cancelled by #1389's — no
  loss as long as the last one succeeds. It is a queue, not a bug.
- **"164 pages" was an undercount.** `docs/services/` has subdirectories;
  the real in-scope set is 174 (139 services + 32 areas + 3 top-level).

## Refuted this session

1. "Sentry DSN and Turnstile test truthiness instead of `hasSecret()`" —
   FALSE, both already use the registry check.
2. "SWDI: unlimited date range" — FALSE, 744 h per request.
3. "stripeConnectWebhook's secret guard is stub-unsafe" — FALSE as code: it
   already fails closed on `startsWith('whsec_')`; only the tense of the
   audit's finding was off. Left unchanged, allowlisted in the guard test.

## Watch-outs (new)

- **Running the node test bucket locally rewrites 78 files under
  `functions/`** with LF endings (they are byte-identical after
  `git checkout --`, yet `git status` keeps flagging them until a
  `git checkout -f`). The writer was not found — `crm-audit.test.js:80` and
  `inline-html-scripts.test.js` are the only suites that call
  `writeFileSync`. Never `git add -u functions/` after a test run; stage
  explicit paths. Open question for the next session.
- **`sed -i` over `functions/*.js` rewrites CRLF files** (stripe.js showed a
  5,276-line diff from a no-op pass). Most funnel HTML/JS and many functions
  files are CRLF. Edit with Node, detecting the EOL per file — and do NOT
  inline JS through a bash heredoc: backslashes in regex literals were
  stripped twice this session.
- **`gh pr checks` output contains "✗" inside passing labels** ("✓/✗/↓
  chips"). Grep for the exit code, not the glyph.
- **Squash-merge order matters for shared files.** `_shared.js` was touched
  by #1389 (secret) and #1390 (helpers) in different regions; both merged
  clean. Watch it if a third PR lands nearby.

## Jo's steps (all optional, none blocking)

1. `firebase functions:secrets:set HEALTHCHECKS_PING_KEY` then create checks
   by slug — [HEALTHCHECKS-SETUP](../runbooks/HEALTHCHECKS-SETUP.md). Until
   then every ping is a no-op.
2. `NBD_HAIL_PROVIDER=swdi` in `functions/.env.nobigdeal-pro` to switch the
   interactive hail lookups to radar cells (NOAA LSR stays the fallback).
   The cron is deliberately untouched this week.
3. GA4 → Realtime: any `/services/*` path should now register a page_view
   once #1391 is deployed.
4. The `/inspect` form has no consent checkbox; its leads never get the SMS
   ack. Adding one is a conversion-form decision.
5. Still Jo-only from the previous brief: Places credentials for the blank
   reviews, and whether to turn on the nine alert policies.

# Session 2026-09-05 (part 2) — free-API wave 2, mapped adversarially then built

> Session record. Live brief: [NEXT_SESSION-2026-09-06](NEXT_SESSION-2026-09-06.md).
> Part 1 of the same night: [SESSION-2026-09-05-free-api-wave1](SESSION-2026-09-05-free-api-wave1.md).
> Source: the "Connections (wave 2)" and "Ops freebies" rows of
> [FREE-API-INTEGRATIONS-RESEARCH-2026-09-02](../audit/FREE-API-INTEGRATIONS-RESEARCH-2026-09-02.md).

## Method — map first, because the note had already been wrong three times

Wave 1 caught three false claims in the research note by measuring instead of
trusting. So wave 2 started with a mapping pass rather than a build: **eight
readers, one per candidate integration**, each told the note is a starting
point whose every `file:line` must be re-verified, followed by **a critic**
that read the shared files for collisions and ranked the items by
value-delivered-before-Jo-acts. 2.1M tokens, 645 tool calls, 35 minutes.

That pass paid for itself before a line was written. It found:

- **Zapier's Webhooks app is a paid-plan feature.** The note's "Zapier (100
  tasks/mo free)" route for the inbound webhook does not exist on the free
  plan. Make / n8n / Pipedream / Apps Script are the $0 routes.
- **`SLACK_WEBHOOK_URL` is still the `__unset__` stub**, so a wave-3 map's
  claim that a FEMA cron could ping Slack "because it already is configured"
  was false.
- **Five Google APIs are not enabled** on the project (vision, analyticsdata,
  searchconsole, drive, sheets) — which killed the Drive-upload design for
  the Sheets export and confirmed GA4/GSC ships dark.
- **`documentation/architecture/THUMBTACK-WEBHOOK-2026-08.md` is wrong**: it
  says bridged leads page Jo. No `lead-alert` trigger exists on
  `thumbtack_leads`, `KIND_LABEL` has no entry, and `push-functions.js`
  returns early unless `assignedTo` is set, which the bridge never sets.
  **Still to correct in place.**
- **CI deploys `firestore.rules` but NOT `firestore.indexes.json`.** A new
  composite index would pass every local check and then throw
  `FAILED_PRECONDITION` in production. This changed the `.ics` feed's design.
- **Hosting's `**` headers do NOT override function-set headers** on a
  rewrite (probed against the live `/report/` endpoint), so the feed's
  `private, no-store` reaches the client.
- A `Authorization: Bearer` header passes through to a gen2 function rather
  than being intercepted by Google — probed, not assumed.

## What shipped

| PR | | Value with zero Jo setup |
|---|---|---|
| #1395 | **Leads/estimates → Google Sheets** from the Export panel | Full, every tenant |
| #1396 | **Read-only `.ics` calendar feed**, one secret URL per rep | Full, every rep |
| #1398 | **Notification taps work again**, plus Call / Snooze / Dismiss | Full, every registered device |
| #1399 | **SPC Day-1 outlook** on the Storm Center map | Full, first open |

Four PRs, four new node-bucket suites (bucket 63 → 64), **twenty negative
controls run across them** — every one of the four suites was proven able to
fail before being trusted.

## Bugs found while building, none of which had a symptom anyone could report

1. **Tapping a push notification did nothing when the CRM was open** (#1398).
   `firebase-messaging-sw.js` called `client.navigate()`, but that worker is
   registered at `/pro/firebase-cloud-messaging-push-scope`, deliberately not
   `/pro/` — a worker may only navigate clients its own registration
   controls, so the call always rejected, inside a `waitUntil` where nobody
   would see it.
2. **The "Dismiss" button navigated.** The click handler never inspected
   `event.action`, though `getNotificationActions` had declared Dismiss since
   it shipped.
3. **A lead with no name meant no push at all.** FCM rejects the entire send
   when any `data` value is not a string, and `onNewLead` passed
   `leadData.name`/`address` straight through.
4. **The rotate prompt would have silently killed a live calendar
   subscription** (#1396). It was a raw `confirm()`, which
   `standalone-compat.js` makes return `true` in the installed PWA — the
   exact class #1354/#1357 fixed. `tests/pwa-confirm-guard.test.js` caught it
   at review time, which is what that suite exists for.
5. **The shared `codeOnly` test idiom is unsafe.** Source-contract suites
   strip block comments then line comments. `push-functions.js` contains the
   line comment `// /pro/images/* does NOT exist`; that `/*` opens a fake
   block comment and the stripper swallows ~20 lines of REAL code up to the
   next `*/`. Assertions then pass or fail on text that was never a comment —
   two of mine failed for exactly this reason. Fixed in the new suite by
   stripping line comments first; a scan of every file my other suites read
   found none otherwise affected. **Other suites still use the unsafe order.**

## Endpoints measured live — three more note corrections

| Note says | Measured 2026-09-05 |
|---|---|
| SPC `day1probotlk_hail` / `_wind` | **404.** The names that serve are `day1otlk_hail`, `day1otlk_wind`, `day1otlk_cat`, `day1otlk_torn` |
| IEM SBW at `/api/1/nws/sbw_interval.geojson` | **404.** `/geojson/sbw.geojson` serves (`?wfo=` filters) |
| FEMA NFHL flood zone | Works, but only with an esriGeometryPoint **JSON** geometry; the `x,y` short form times out. Layer 28 serves, layer 14 returns 400 |

Also confirmed working and keyless: OpenFEMA disaster declarations, and the
Cincinnati permits Socrata endpoint.

## Design calls worth keeping

- **Sheets export flattens, trims, THEN neutralizes.** TSV has no quoting
  convention Sheets honours on paste, so the CSV trick of hiding the text
  marker inside quotes is unavailable. A value like `"\n=HYPERLINK(...)"` —
  whose leading character is a newline, which `FORMULA_LEAD` does not match —
  reaches the sheet as a live formula under the other order.
- **`window.open` before the clipboard write.** Safari only honours a pop-up
  opened in the same task as the click; an awaited clipboard call turns the
  new sheet into a blocked pop-up on every iPhone.
- **The `.ics` feed never expires and rotation is its only revocation.** A
  share link for one homeowner should expire; a calendar *subscription* that
  silently stops refreshing leaves a stale schedule on the phone with no
  error.
- **The feed returns 503, never an empty 200.** A calendar client reads an
  empty calendar as "every event was deleted" and wipes what it had.
- **SPC polygons nest**, so the risk at a point is the highest DN containing
  it, not the first match; and a point outside every polygon renders
  *nothing*, because a zero would assert SPC forecast no risk.

## Deliberately not built, with reasons

- **Telegram bot** — dark until Jo creates a bot and sets two secrets. Slack
  has been dark since it shipped for the same reason; a third channel nobody
  asked for is not worth three shared-file edits.
- **Calendly polling** — needs a `calcom.js` refactor that re-points four
  smoke regexes, a 26th cron with ratchet and runbook edits, and a token. Jo
  should first confirm he still uses Calendly alongside Cal.com.
- **Inbound webhook** — the endpoint would 401 safely and deliver nothing
  until Jo mints a token, and the settings UI is its own slice (the settings
  template has a script-count pin).
- **Geoapify autocomplete** — the compliance item, but it ships behaviourally
  identical to today until Jo has a key.
- **Vision OCR** — blocked on an API enablement only Jo can run.
- **Live storm-warning polygons** — they already reach the map through the
  NWS alerts path; adding them would double-count against the alert list and
  the pipeline figure derived from it.

## Watch-outs

- **`git checkout -- <file>` discards uncommitted work.** Used it to undo a
  sabotage during a negative-control run and lost the slice's edits; a `cp`
  backup taken before the mutation is what saved it. Prefer a scratchpad
  backup + restore, never `git checkout` on a dirty file.
- **`node -e` and bash heredocs strip one level of regex backslashes.** Bit
  me twice again this session. Write the script to a scratchpad `.js` file.
- **Requiring `functions/push-functions.js` from a test needs an initialized
  admin app** (it calls `getFirestore()` at module load), and `admin.apps` no
  longer exists in this SDK version — initialize inside a try/catch.

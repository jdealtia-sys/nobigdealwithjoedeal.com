# Recon 2026-09-06 — e-sign, CRM friction, and what NOT to integrate

Twenty agents: ten read-only lenses over the CRM, each followed by an
adversarial verifier that re-opened the cited files to **refute** the first
agent's claims. **171 findings — 112 confirmed, 57 partly, 2 refuted.**

Read with the verdicts. `partly` almost always means *the load-bearing fact is
right and the framing overshot* — those corrections are recorded inline below
and are the reason this note is worth trusting.

The e-sign lane became [its own session](../projects/SESSION-2026-09-06-esign-rebuild.md).
This note carries the two lanes that were **investigated but not built**, so the
next session starts from evidence instead of re-deriving it.

---

## A. CRM friction — the money path

Highest-severity confirmed items. These are not cosmetic.

**Invoice Send / Mark Paid exist ONLY in the modal shown right after creation.**
Close it and payment cannot be recorded from anywhere in the UI. `[high/partly]`

**The doc pre-flight reads `est.lineItems`; V2 estimates save `rows`.** Every
contract and proposal therefore starts with an empty — and required — scope.
`[high/partly]` This is also why `estimateLineItems` is always empty, so
warranty certificates and proposals **always claim GAF Timberline** even on a
TAMKO job. `[medium/confirmed]`

**`customer.html` "Move to Next Stage" full-page-reloads** and writes the stage
without `stageRole`, without the required-field gate, and without the drip
trigger. `[high/confirmed]`

**`CustomerEstimateHub` is mounted in exactly one place** — the mobile-only
job-detail overlay — while `customer.html` navigates away to build an estimate.
`[high/confirmed]`

**The Estimates-view "＋ New Estimate" always opens a customer-less builder**;
9 known fields get re-typed. `[high/confirmed]`

**The next-best-action chip is painted on every card but is not clickable.**
The real action list is locked inside the 28-field edit form.
`[high/confirmed]`

**`crew_scheduled` has no required-field gate**, so a scheduled job can carry no
date and never appear on the schedule. `[medium/confirmed]`

**Every `renderLeads` call rewrites `innerHTML` for all columns**, resetting
scroll — and it fires twice per stage move and on every task-modal close.
`[medium/confirmed]`

### Mobile

**The photo offline queue is write-only — every "Photo queued (offline)" is a
lie.** `[high/confirmed]` `OfflineManager.queueWrite` is unreachable and
`offline-manager.js` is not loaded on the dashboard at all `[high/confirmed]`;
the service worker's own write queue is dead code because non-GET requests
return before reaching it `[high/confirmed]`.

**Mobile "+ → Photo" captures a photo and throws it away** — 4 taps to nothing.
`[high/confirmed]`

**Three separate force-reload paths destroy unsaved form state**; only the
estimate builder has a draft. `[high/confirmed]`

**`standalone-compat` injects a second safe-area inset** on top of the one the
header already reserves. `[high/confirmed]` Tap targets systematically land at
22–40px while the comments claim they clear 44px `[medium/confirmed]`, and a
marketing stylesheet with blanket `!important` button rules loads into the CRM
and takes over below 480px `[medium/confirmed]`.

> Do **not** reopen the `confirm()`/`prompt()` shim — that history is genuinely
> resolved. `[low/confirmed]`

### Weight

129 JS files on dashboard boot (2.93 MiB, 922 KiB gzip); 74 on customer boot.
`[low/confirmed]` **`customer.html` eagerly loads 653.6 KiB the dashboard
already proves is lazy-loadable** `[high/confirmed]`. `ScriptLoader` dedupe
matches the raw `src` attribute, so `customer.html`'s absolute-path tags
**re-execute** `supplement-ui.js` and its MutationObserver `[high/partly]`.
Three live Cmd+K handlers; `ui.js` has no stand-down guard, so **two palettes
open on one keypress** `[high/partly]`. `crm-snooze.js` destroys and re-creates
a 50-document Firestore listener **every 120 seconds** `[high/confirmed]`.

### Do not touch

The kanban card face, `moveCard`, the field gate, and the context-menu triad
were all singled out as working well. `[high/confirmed]`

---

## B. Integrations — the honest answer is mostly "don't"

### The finding that reframes the lane

**A live `gcloud services list` on `nobigdeal-pro` returns 95 enabled services,
and calendar, drive, sheets, gmail, vision, analyticsdata, searchconsole,
mybusiness and people are ALL absent.** `[high/confirmed]`

So every Google integration starts from *enable the API and pass verification*,
not from *write the code*.

### Calendar — do not build two-way

**Recommendation: no.** `[high/partly]` The shipped `.ics` feed is ~90% of the
value: one secret URL, no vendor, no OAuth, no key — and it is **verified live
in production**. Two-way buys the remaining 10% at the cost of a Google
sensitive-scope review and 7-day refresh-token expiry.

*Verifier correction, and it matters:* the "Google verification burden" figure
is a policy assertion the verifier could **not** confirm from repo evidence or a
vendor doc. Treat the cost as real but unquantified.

The one genuine gap two-way would close: **the booking-conflict detector is
blind to anything outside the CRM** `[medium/partly]` — and wider than first
claimed, since leads carrying `scheduledDate` never enter the conflict or travel
math at all, and the whole view is today-only.

**The keyless calendar item actually worth doing** is an `.ics` **reader** for
busy blocks — the repo has a serializer and no parser anywhere.
`[medium/partly]`

*Also live and dark:* the `.ics` feed has **zero subscribers**
`[medium/confirmed]`, and Cal.com is correctly configured but has produced
**exactly one booking, ever** — which still has `leadId: null`, so the #1288
lead-create fix has never once been exercised. `[high/confirmed + high/partly]`

### Drive — do not build

**There is no Google Drive integration in this codebase, at all.**
`[high/confirmed]` And there should not be `[high/partly]`: Drive is the human
archive, Storage is the datastore, and the one Drive-shaped design here was
already killed and correctly replaced.

*Verifier corrections:* the "customer books" detail is not in the cited
inventory note (it is true, but lives elsewhere), and the RESTRICTED-scope /
CASA assessment cost is an unverified vendor-policy assertion.

### Email — the real gap, and it is not inbound

**18 of 19 outbound send sites write no `email_log` row**, so the customer's
Communication Log is blind to almost every email the system sends.
`[high/partly]` — *but* at least 7 of the 19 are addressed to Jo or a teammate,
not a customer, so the fix is smaller than "route the other 18".

**"Sent" means "Resend accepted it"** — there is no bounce, complaint or
delivery handling anywhere in the repo. `[medium/partly]`

**Inbound email is not handled at all** `[high/confirmed]` — but before building
it, read `documentation/architecture/EMAIL-INGEST-2026-08.md`, which already
**chose** an IMAP poller and explicitly rejected the forward-address webhook.
A recommendation that contradicts it needs to argue with it. `[medium/partly]`

### The highest-value work is not a build

**Shipped-but-dark configuration beats every new integration on value per
hour.** `[high/confirmed]` Three switches, minutes of Jo's time:

1. `HEALTHCHECKS_PING_KEY` — the secret exists but holds no value, so all 25
   cron heartbeats are no-ops. This is the difference between 25 monitored jobs
   and 25 unmonitored ones.
2. `NBD_HAIL_PROVIDER=swdi` — keyless hail history, merged and dark.
3. The Google **Places** credentials — both are the `__unset__` stub, which is
   why the Google reviews are blank on every marketing page and nothing ever
   alerted.

**21 of ~51 secrets are still the deploy pipeline's `__unset__` sentinel.**
`[high/partly]` One of them (`SLACK_WEBHOOK_URL`) silently darkens **nine**
deployed functions' alerting `[medium/partly]`, and **the dead-man's-switch
built to catch silently-dead crons is itself silent** `[high/confirmed]`.

**Do not add a Telegram bot** `[medium/confirmed]` — two alert channels already
exist and neither is configured.

### Dead weight, confirmed

Swath (3 deployed functions, no secret, no callers) · aerial measurement
(HOVER/EagleView/Nearmap — full UI, has never once succeeded) · Regrid parcel
lookup and the `resolveAddress` geocoder that shares its key · BoldSign ·
`registerDeviceFingerprint` · `nightlyFirestoreBackup` (exported, never
deployed, duplicate of one that works) · `transcribeVoiceMemo` (a live button
that always errors, while the Groq pipeline that IS configured has never run).

`syncGbpReviews` has run daily against a disabled API since 2026-07-13 —
though *not* "firing into a wall": it checks its secrets and returns early, so
every run is a zero-cost no-op. `[high/partly]`

**Nominatim autocomplete** is a live usage-policy violation across 12 files —
though "the only one" is an unbounded negative the verifier could not confirm.
`[medium/partly]`

---

## Method note

Every dimension was read by one agent and then attacked by a second whose brief
was to refute it, defaulting to skepticism and marking `unverifiable` rather
than `refuted` when it could not check. That is why 57 findings are `partly`
rather than silently wrong — and why the two `refuted` ones are not in this
note at all.

The pattern that produced the most value: **distinguishing "code exists" from
"code is wired up" from "code is live with a real secret."** Most of the dead
weight above passes the first test and fails the third.

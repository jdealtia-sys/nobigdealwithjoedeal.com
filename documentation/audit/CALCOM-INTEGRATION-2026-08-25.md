# CAL.COM INTEGRATION — audit + build-out, 2026-08-25

Jo asked for a full sweep of the Cal.com setup after the phone-field fix earlier
the same day, then approved every proposal (AskUserQuestion, all four answered).
Everything below was executed via Cal.com API v2 with a short-lived API key Jo
supplied for the session (told to revoke after; **v1 API is retired — returns
410**; v2 needs `Authorization: Bearer` + `cal-api-version: 2024-06-14` for
event types, `2024-06-11` for schedules).

## What the audit found (before state)

- **Hours contradiction**: site promises Mon–Sat 7–6; Cal.com offered Mon–Fri 9–5.
- **Phone field hidden + optional** (fixed earlier same day: required + visible,
  label "Mobile phone").
- **Zero webhooks** — bookings never reached the CRM, even though
  `functions/integrations/calcom.js` (`calcomWebhook`, HMAC-verified,
  fail-closed) was already deployed and waiting.
  *(Correction 2026-08-28: "waiting" overstated it. The deployed receiver
  only wrote `appointments/{bookingId}` and linked a lead that already
  existed — it had no path that CREATED one, and no trigger watched
  `appointments`. Registering the webhook and binding the secret were
  necessary but never sufficient; the cold-booking gap was in the code from
  the start and was closed by #1288 on 2026-08-28.)*
- **Zero guardrails**: 2h minimum notice, no buffers, no daily cap.
- **Zero workflows** (no reminders). Cal.com's "15/30 min meeting" starter
  events publicly visible. Empty bio.
- Good already: location = attendeeAddress (collects the property address);
  Google Calendar (jdeal.tia@gmail.com) connected for conflict-checking.

## What was built (all verified via authenticated GET + the public
`/api/trpc/public/event` endpoint, which is the booking form's own data source)

| Change | Detail |
|---|---|
| Schedule 1409605 "Working hours" | Mon–Sat 07:00–18:00 (matches site) |
| Free Roof Inspection (5279797) | afterEventBuffer 30 min · minimumBookingNotice 720 (12h) · bookingLimitsCount {day: 4} · timezone locked to booking page |
| Starter events 5274290/5274291 | hidden (unbookable from profile; direct links still work) |
| Webhook e6863880-80db-4fe2-90b0-f1e622855ec5 | → `https://us-central1-nobigdeal-pro.cloudfunctions.net/calcomWebhook`, BOOKING_CREATED/RESCHEDULED/CANCELLED, HMAC secret generated this session (handed to Jo in chat, NOT recorded here) |
| Workflow 432616 "24h inspection reminder" | email_attendee, 24h before event, active on all three event types below |
| **NEW** Free Roof Inspection — Lexington & Central KY (6823308, `roof-inspection-lexington`) | own schedule 2285623 "Central Kentucky days" (Mon–Sat 7–6 initially — restrict to trip days anytime), 30-min buffer, **24h notice** (trip batching), 4/day cap, phone required, attendeeAddress |
| **NEW** 15-Minute Roof Question Call (6823309, `roof-question-call`) | phone-call location (attendee's number collected by the location prompt — the separate phone booking field stays hidden to avoid a double ask), 4h notice — built for the Reader Questions blog audience |
| Profile bio | "Owner-operated roofing & insurance restoration — Greater Cincinnati, Northern Kentucky & the Lexington area. It's just me, Joe. (859) 420-7382" |
| Site (this PR) | the 9 Central KY pages' Schedule Inspection buttons now point at `roof-inspection-lexington` |

## Plan-gated (free plan) — deliberately NOT built

- **successRedirectUrl** (post-booking thank-you page on our site): API returns
  403 "team plan users" — if Jo ever upgrades, the `/booking-confirmed` page is
  a ~30-min build and two PATCHes.
- **SMS reminder workflows**: paid feature; the email reminder ships instead.

## Jo's finish steps (updated 2026-08-28 — read the correction first)

> **CORRECTION 2026-08-28 — "the webhook is LIVE end-to-end" was wrong.**
> The 08-26 header upgraded two signature probes into an end-to-end claim.
> The probes only proved the receiver accepts a signed POST. A real organic
> booking (Wilder KY, 08-28) landed as `appointments/{bookingId}` and
> **never became a lead**: the M-1 block stamped `leadId` only when the
> attendee already matched a lead in the rep's pipeline, and nothing
> promoted an orphaned appointment — there is no Firestore trigger on
> `appointments`. The Pipeline never queries that collection, so every cold
> booking was dropped silently. This was never a delivery or signature
> failure; the appointment doc was written correctly and the webhook
> returned `200 {ok:true}`. Fixed forward in **#1288** (`f44f346a`,
> deployed same day): on no match the webhook now creates
> `leads/{calcom__<bookingId>}` (`source: 'Website — Cal.com booking'`,
> `publicLeadKind: 'calcom_booking'`, deterministic id + `.create()` for
> idempotency against redelivery). **Still unproven against a real
> booking** — no prod credentials that session. Fire a test booking and
> assert the Pipeline card, not the probe. Full write-up:
> [SESSION-2026-08-28-calcom-lead-drop](../projects/SESSION-2026-08-28-calcom-lead-drop.md).

1. ~~Set `CALCOM_WEBHOOK_SECRET` + redeploy~~ **DONE 2026-08-26, verified
   live at 03:41Z**: unsigned POST → 400 "Missing signature" (was 503
   fail-closed), HMAC-signed PING → 200 `{"ok":true}`. Jo set the secret via
   the interactive prompt; the #1276 merge deploy bound it (chunk 1 of run
   32925767669 — that run shows red overall from an unrelated
   `onAiDraftApproved` polling transient; calcomWebhook itself deployed,
   its URL printed, and both probes confirm the binding).
2. ~~NBD Pro → Settings → Profile → set Cal.com username `nobigdeal`~~
   **DONE 2026-08-28** (Jo set and saved it live in session,
   screenshot-confirmed; the field takes the bare username, not the booking
   URL — the lookup is an exact-string compare). Two corrections to the
   original wording: unset, bookings do **not** "arrive but can't attach" —
   `calcomWebhook` logs `no matching rep — booking dropped` and returns 200,
   so the booking is gone. And this step was **necessary but not
   sufficient**: the username only gets the webhook past the organizer→rep
   lookup. Creating the CRM lead for a first-time booker required #1288
   (2026-08-28) — both fixes were needed, and the username alone would NOT
   have produced a Pipeline card.
3. Optional, anytime: restrict schedule 2285623 to actual Central-KY trip days.
4. Revoke the session API key if it wasn't created with an expiry.

## Schema notes for the next session that touches this API

- bookingFields override of a system field needs `type` AND `label`, not just
  slug/required/hidden.
- Workflow steps contract: `action` snake_case enum (`email_attendee`…),
  `stepNumber`, `recipient: "attendee"`, `sender`, and a mandatory `message`
  `{subject, html}` even when `template: "reminder"`.
- Sandbox Chromium cannot reach external sites through the egress proxy
  (TLS trust) — verify Cal.com state via the public trpc endpoint instead;
  it is the form's actual data source.

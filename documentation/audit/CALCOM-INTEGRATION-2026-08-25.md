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

## Still open — Jo's finish steps (webhook is registered but the function
fails closed until the secret lands)

1. `firebase functions:secrets:set CALCOM_WEBHOOK_SECRET` with the value from
   chat, then a functions redeploy so v2 binds the new secret version (any
   functions-touching merge triggers it, or
   `firebase deploy --only functions:calcomWebhook`).
2. NBD Pro → Settings → Profile → set Cal.com username `nobigdeal` (the webhook
   maps organizer→rep via `users/{uid}.calcomUsername`; without it bookings
   arrive but can't attach to Jo).
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

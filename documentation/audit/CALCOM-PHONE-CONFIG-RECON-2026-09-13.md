# CAL.COM PHONE-QUESTION RECON — 2026-09-13

Read-only reconnaissance, driven live in Jo's own logged-in Chrome
(`claude-in-chrome`, Jo present). No Save, toggle, delete, or dialog was
accepted anywhere in Cal.com — this is a snapshot of current state only, run
ahead of the "Phone → Required" rollout that [fix/calcom-phone-resolver
(PR #1535)](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1535)
gates on it. Trigger: an organic gutter/siding lead reached Jo with email but
no phone — see [CALCOM-INTEGRATION-2026-08-25](CALCOM-INTEGRATION-2026-08-25.md)
for the prior audit and PR #1458 (2026-09-07) for where `adjuster-meeting`,
`estimate-walkthrough`, and `gutter-siding-estimate` were created (all three
postdate that audit, so it never covered them).

Cal.com's booking-question editor UI has changed since the 08-25 audit: the
event-type page is now a left-nav (Setup / Availability / **Booking form** /
Confirmation / Appearance / …) instead of horizontal tabs. Booking questions
now live under **Booking form**, not "Advanced."

## Per-event-type state

| Event type (slug, id) | Location (Setup) | Phone capture | Other required questions |
|---|---|---|---|
| **Free Roof Inspection** (`roof-inspection`, 5279797) | In Person (Attendee Address) | Built-in Phone question **renamed "Mobile phone," Required**, visible. Identifier confirmed via the Edit-question modal: `attendeePhoneNumber`. | Your name, Email address, Location, Mobile phone |
| **Free Roof Inspection — Lexington & Central KY** (`roof-inspection-lexington`, 6823308) | In Person (Attendee Address) | Same as above — "Mobile phone," Required, identifier `attendeePhoneNumber` (confirmed via Edit modal) | Your name, Email address, Location, Mobile phone |
| **15-Minute Roof Question Call** (`roof-question-call`, 6823309) | **Attendee phone number** | Built-in "Phone number" question is **Hidden** (deliberate — Location already asks for the number, so this avoids a double ask, per the 08-25 audit) | Your name, Email address, Location (= the phone number, captured as the location value) |
| **Gutters & Siding Estimate** (`gutter-siding-estimate`, 6973405) | In Person (Attendee Address) | Built-in "Phone number" question is **Hidden**. **No other phone capture exists on this event.** | Your name, Email address, Location |
| **Estimate Walkthrough** (`estimate-walkthrough`, 6973349) | **Attendee phone number** | Built-in "Phone number" question is **Hidden** — same pattern as `roof-question-call` (Location already captures it) | Your name, Email address, Location (= the phone number) |
| **Insurance Adjuster Meeting** (`adjuster-meeting`, 6973306) | In Person (Attendee Address) | Built-in "Phone number" question is **Hidden**. **No other phone capture exists on this event.** | Your name, Email address, Location |

All six also carry: "What is this meeting about?" (Hidden), Additional notes
(Optional), Add guests (Optional), Reason for reschedule (Optional). The
"Confirmation: Email / Phone" selector (which channel gets the booking
confirmation — unrelated to data capture) was Email on every event type
checked visually (4 of 6: `roof-inspection`, `roof-inspection-lexington`,
`gutter-siding-estimate`, `estimate-walkthrough`).

## Webhook (Settings → Developer → Webhooks)

- One webhook, owned by Joe, **Enabled**
- URL: `https://us-central1-nobigdeal-pro.cloudfunctions.net/calcomWebhook`
- Triggers: Booking created, Booking rescheduled, Booking canceled
- **Custom Payload Template: OFF** — Cal.com sends its default full payload,
  nothing is stripped or renamed before it reaches the Cloud Function
- Secret exists (masked field; not opened, not revealed, not rotated)

## What this settles

1. **The "phone already required on `gutter-siding-estimate`" hypothesis is
   false.** It's Hidden, same as `adjuster-meeting`. Both currently have
   **zero** phone capture — not a webhook-parsing miss, a Cal.com config gap.
   `adjuster-meeting` isn't named in PR #1535's rollout list; it has the
   identical gap and should probably be included.
2. **`attendeePhoneNumber` is confirmed as the live system identifier**, not
   an assumption — read directly out of the Edit-question modal on both
   events where it's already Required. Matches what PR #1535's resolver
   reads from `responses.attendeePhoneNumber`.
3. **Two event types never populate that field at all.** `estimate-walkthrough`
   and `roof-question-call` use Location type "Attendee phone number," so the
   number arrives via `responses.location`, not a Phone question response —
   confirms the resolver needs both paths, not just the one field.
4. **No custom payload template** on the webhook — whatever Cal.com's
   documented payload contains reaches `calcomWebhook` unmodified.

## Order of operations (per PR #1535, unchanged by this note)

1. Merge + deploy the resolver fix first — flipping Cal.com settings before
   the code ships would still drop the number.
2. Live session: Jo present, approving each Save individually, sets the
   built-in Phone question to Required + visible on `gutter-siding-estimate`
   and `adjuster-meeting` — the two event types with zero phone capture today.
   `roof-question-call` and `estimate-walkthrough` should keep it Hidden —
   Location already carries the number there, and Required would double-ask.
3. One real booking per event type, checked against `phonePresent` in Cloud
   Logging.

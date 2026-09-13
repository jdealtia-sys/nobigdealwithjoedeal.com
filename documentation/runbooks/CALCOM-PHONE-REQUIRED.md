# Cal.com — a phone number on every booking

**Status 2026-09-13 (evening):** the code fix **merged as #1535** (`954e7331`)
and its production deploy was running at the time of writing — confirm the
deploy run for that SHA (or a later one containing it) succeeded before the
session. The Cal.com settings change below is **not done yet**. A read-only
recon of all six event types ran the same day (PR #1537) and filled in the
table; it cut the change down to **two** event types.

## Why there are two halves

An organic gutter and siding lead reached Jo with an email and no phone. Two
things had to be true for that to happen, and both need fixing:

1. **The webhook threw the phone away even when Cal.com had it.**
   `functions/integrations/calcom.js` read the phone only from
   `attendees[0].phoneNumber`. Cal.com's documented `BOOKING_CREATED` payload
   ([webhooks guide](https://cal.com/docs/developing/guides/automation/webhooks))
   carries no phone on the attendee. The Phone booking question arrives at
   `responses.attendeePhoneNumber` (`{label, value, isHidden}`). A phone-call
   event's number arrives in the location prompt, at
   `responses.location.value.optionValue`. Nothing in `functions/` read
   `responses`. The code fix is `functions/integrations/calcom-logic.js`,
   pinned by `tests/calcom-webhook-payload.test.js`.
2. **Not every event type asks for a phone as a required question.** The
   08-25 audit made the phone required on `roof-inspection` and
   `roof-inspection-lexington`. The three event types created in #1458
   (2026-09-07) have no recorded booking-question settings. The
   gutter-siding lead's booking type is the likely gap.

**Order matters.** Deploy the code fix first. Flipping Required before it
deploys would still produce phone-less CRM leads, just with the number sitting
unread in the payload.

## The six event types

Before state read live, read-only, in Jo's Chrome on 2026-09-13 (PR #1537 —
no setting was changed). The system field identifier `attendeePhoneNumber`
was confirmed in the Edit-question modal, and the webhook has **no custom
payload template**, so Cal.com's default payload reaches `calcomWebhook`.

| Event type | id | Location | Phone capture before | Change | After |
|---|---|---|---|---|---|
| `roof-inspection` | 5279797 | In Person (Attendee Address) | Phone question "Mobile phone", **required**, visible | none | |
| `roof-inspection-lexington` | 6823308 | In Person (Attendee Address) | "Mobile phone", **required**, visible | none | |
| `roof-question-call` | 6823309 | **Attendee phone number** | Phone question hidden; the number comes from the location prompt | none — resolver reads `responses.location` | |
| `estimate-walkthrough` | 6973349 | **Attendee phone number** | Phone question hidden; the number comes from the location prompt | none — resolver reads `responses.location` | |
| `gutter-siding-estimate` | 6973405 | In Person (Attendee Address) | Phone question **hidden — no phone capture at all** | **make Required + visible** | |
| `adjuster-meeting` | 6973306 | In Person (Attendee Address) | Phone question **hidden — no phone capture at all** | **make Required + visible** | |

**The change is two event types, not six.** The two inspection types already
require the phone. The two phone-call types collect the number through the
location prompt, which the resolver reads, so making the Phone question
required there would only ask for the number twice. `gutter-siding-estimate`
is where the email-only lead came from; `adjuster-meeting` has the identical
gap.

## The live session (Jo present, Claude drives Jo's Chrome)

Jo chose this on 2026-09-13. Claude uses the claude-in-chrome tools in Jo's
logged-in browser. **Jo approves every Save click; Claude never saves on its
own.**

For `gutter-siding-estimate` and `adjuster-meeting`:

1. app.cal.com → Event Types → open the event.
2. Left nav → **Booking form** (Cal.com moved booking questions out of the
   old "Advanced" tab — per the 09-13 recon). Read the Phone row's state back
   to Jo and confirm it still matches the table.
3. On the **Phone number** row (identifier `attendeePhoneNumber`): Edit →
   Required **on**, Hidden **off**, label "Mobile phone" (matches the two
   inspection types). Ask Jo, then click Save only on Jo's yes.
4. Reload the event, read the row back, record the After column.

Then, still in the session:

- Settings → Developer → Webhooks: confirm the one webhook still points at
  `https://us-central1-nobigdeal-pro.cloudfunctions.net/calcomWebhook` with
  BOOKING_CREATED, BOOKING_RESCHEDULED and BOOKING_CANCELLED. **Never display
  or copy the secret.**
- Check that the public booking page for `gutter-siding-estimate` now shows a
  required Mobile phone field, from a logged-out tab if possible.

Fallback if the browser route fails: Jo mints a short-lived Cal.com API key,
and six `PATCH /v2/event-types/{id}` calls send a `bookingFields` override
(`type` AND `label` are both mandatory, see the 08-25 audit's schema notes).
Jo revokes the key after.

## Proving it worked — one real booking per event type

The webhook now logs booleans and field names, never the number:

```
resource.type="cloud_run_revision"
resource.labels.service_name="calcomwebhook"
jsonPayload.message=~"created CRM lead for unmatched booking"
```

Each entry carries `phonePresent`, `phoneSource`, `addressSource` and
`eventSlug`.

1. Book each event type once with a test email and a real phone you control.
   An email not already in the pipeline forces the create path.
2. For each, confirm `phonePresent: true` and record which `phoneSource` won,
   e.g. `responses.attendeePhoneNumber` or `responses.location`. That settles
   the payload shape that was never captured in this repo.
3. Open the Pipeline card: the phone, and for in-person types the typed
   address (never the word `attendeeInPerson`), should both be there.
   `sourcePage` reads `calcom:<slug>`.
4. Cancel the test bookings in Cal.com. The webhook marks the appointment
   cancelled. Delete the test leads by hand.

If any entry shows `phonePresent: false` on a booking where a phone was
typed, the payload uses a field the resolver does not read. Copy the field
name from the raw request, never the value, and add it to
`resolveAttendeePhone()` with a fixture.

## A booking that still arrives without a phone

It lands with `needsPhone: true`, and its notes start with *"NO PHONE on this
booking — reply to the Cal.com confirmation email to get a number before the
visit."*

**Update 2026-09-13 — the alert is built, not yet live.** Lane B PR B added
`leadAlertCalcom` to `functions/lead-alert.js` (branch
`fix/calcom-lead-alert`). Once merged and deployed, every lead the webhook
creates pages Joe by email and SMS through the same path as the website
forms, and a phone-less one leads with **NO PHONE**: a highlighted email row
with a `mailto:` to the booker, an SMS whose first line is "NO PHONE — reply
to the confirmation email", and "(NO PHONE)" in the subject. It sends the
homeowner nothing, since Cal.com already emailed them. It skips manual CRM
leads, bridged website leads (those already paged from their own collection)
and rows written by `scripts/backfill-calcom-dropped-leads.js`. Each alert
leaves an `alert_outbox` row with `collection: "leads"`.

After deploy, every test booking in the section above also pages Joe. That
is the proof the trigger works: a test booking on an event type whose phone
is still optional, left blank, should arrive as a NO PHONE alert. Until one
has, the trigger has never run on a real booking. It is proven only by
`tests/lead-alert-calcom.test.js`.

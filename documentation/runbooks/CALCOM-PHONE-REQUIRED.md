# Cal.com — a phone number on every booking

**Status 2026-09-13:** code fix on branch `fix/calcom-phone-resolver` (not
merged). The Cal.com settings change below is **not done yet**. It runs as a
live session after the code fix is deployed.

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

Fill in the Before columns by reading each event, then the After column once
saved.

| Event type | id | Location (Setup tab) | Phone question: required / hidden (before) | After |
|---|---|---|---|---|
| `roof-inspection` | 5279797 | In Person (Attendee Address) | required, visible (08-25) | |
| `roof-inspection-lexington` | 6823308 | In Person (Attendee Address) | required (08-25) | |
| `roof-question-call` | 6823309 | Attendee phone number | hidden on purpose (08-25: avoids a double ask) | |
| `gutter-siding-estimate` | not recorded | In Person (Attendee Address) | not recorded | |
| `adjuster-meeting` | not recorded | In Person (Attendee Address) | not recorded | |
| `estimate-walkthrough` | not recorded | Attendee phone number | not recorded | |

**Recommendation: required and visible on all six, labelled "Mobile phone".**
On the two phone-call types this asks for the number twice. The resolver
already reads the location prompt's number, so leaving those two hidden loses
nothing. It is a UX call, not a data-loss one. Jo decides at the session.

## The live session (Jo present, Claude drives Jo's Chrome)

Jo chose this on 2026-09-13. Claude uses the claude-in-chrome tools in Jo's
logged-in browser. **Jo approves every Save click; Claude never saves on its
own.**

For each event type:

1. app.cal.com → Event Types → open the event.
2. Setup tab: read the Location setting back to Jo and record it in the table.
3. Advanced tab → Booking questions: read every row's label, type, Required
   and Hidden state back to Jo, then record the Before column.
4. On the **Phone** row (system slug `attendeePhoneNumber`): Edit → Required
   **on**, Hidden **off**, label "Mobile phone". Ask Jo, then click Save only
   on Jo's yes.
5. Reload the event and read the row back. Record the After column.

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
visit."* An alert that tells Joe about it is Lane B PR B of the 09-13 handoff
and has not been built.

# Calendar feed — your schedule on your phone

*Written 2026-09-05 with `functions/calendar-feed.js`. No vendor, no API key,
no secret: this feature works the moment it deploys.*

## What it does

Every Cal.com appointment and every lead with a Scheduled Date shows up in the
Calendar app on your phone, refreshing on its own. Until now those lived only
inside the CRM's Schedule view, so the thing that actually pings you — your
phone's own calendar — knew nothing about either.

## Subscribe (once per phone, about a minute)

1. NBD Pro → **Schedule** → the **Subscribe On Your Phone** panel.
2. Tap **Create my link**. A URL appears.
3. Tap **Subscribe on iPhone**. iOS offers to add a subscribed calendar —
   accept, and pick how often it refreshes (hourly is plenty).
   - On Android or a desktop: tap **Copy Link** and paste it into Google
     Calendar → Other calendars → **From URL**.
4. Done. Nothing to maintain; new bookings appear on their own.

## The link is a password

Anyone holding the URL can read your schedule: homeowner names, addresses and
phone numbers. It is exactly as sensitive as your CRM login, and it has no
expiry on purpose — a subscription that quietly stops refreshing is worse than
one you have to think about, because the phone just shows a stale schedule
with no error.

**If it gets out, tap "Rotate link".** The old URL dies immediately. Any phone
still subscribed to it stops updating, so re-subscribe on each of your devices
afterwards.

Only you can mint your own feed. A company admin cannot generate a link to a
teammate's schedule.

## What lands on the phone

| CRM thing | On the calendar |
|---|---|
| Cal.com appointment | A timed event with the homeowner's name, address, phone and any notes |
| Lead with a Scheduled Date (no time) | An all-day event that does **not** block your free/busy |
| Cancelled appointment | Nothing — it disappears from the phone too |
| A lead whose appointment is on the same day | Shown once, not twice |

Window: 30 days back, 180 days forward.

## When something looks wrong

- **The calendar is empty but you have appointments.** Check the Schedule view
  first — if it is empty there too, the appointments are not reaching the CRM
  and this feed is not the problem.
- **iOS says it cannot refresh.** Rotate the link and re-subscribe. A rotated
  link answers HTTP 410 with a message saying exactly that.
- **Events stopped updating but nothing errors.** That is the signature of a
  rotated link on a phone that has not been re-subscribed.
- **A job shows on two days.** Report it — an all-day event's end date is
  exclusive, and this is the one bug the tests exist to catch.

## For engineering

- `functions/calendar-feed-logic.js` is pure (no firebase, no clock) and holds
  the RFC 5545 serializer; `tests/calendar-feed.test.js` pins folding at 75
  **octets**, CRLF, escaping, the exclusive all-day end, and the New-York-day
  dedup. Five negative controls were run against it.
- `calendar_feed_tokens` is admin-SDK only (`firestore.rules`) and is
  registered in `functions/integrations/user-owned.js`, so account erasure
  revokes the feed.
- The lead query is deliberately equality-only with the date window applied in
  memory: CI deploys `firestore.rules` but **not** `firestore.indexes.json`, so
  a query needing a new composite would throw `FAILED_PRECONDITION` in
  production while passing every local check.
- A data failure returns **503**, never an empty 200 — a calendar client reads
  an empty calendar as "every event was deleted" and wipes what it had.

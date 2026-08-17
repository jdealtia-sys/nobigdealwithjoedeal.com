# Session 2026-08-17 — iCloud Mail sweep (CRM lane, follow-on to NEXT_SESSION-2026-08-16)

> Session log. **PII rule:** this repo is public — no customer names, emails,
> phones, addresses, or claim numbers here. Person-level detail lives in
> Google Drive (COMPANIES/NBD): the sweep log is mirrored in the session
> scratchpad (not committed), and the send-ready drafts are in
> **"KIT ADDENDUM 2 — iCloud sweep replies (Aug 17 2026)"**.

## What this was

Jo's iCloud mailbox turned out to be the last unswept lead/customer source
("another gold mine"). Full sweep via the in-Chrome browser: all 6
customer-named folders, Primary (58 msgs / 22 unread), Junk (32), Archive
scanned (172 — storm-watch/vendor noise). Transactions/Updates/Promotions/
Sent/Trash deliberately skipped (low expected value; revisit on request).

## Headline findings (details + names in the Drive kit addendum)

The mailbox held almost no unknown customers — the Aug-16 CRM load was that
complete. What it held was **stalled money: five customers waiting on a
reply**, some for weeks:

1. **A warranty callback sitting in JUNK since mid-July** — past gutter
   customer, follow-up said "or I will look elsewhere." Most urgent send.
2. **A won-job warranty complaint from mid-June** (ventilation/moisture,
   possible ongoing damage) — may have been handled by phone; flagged for
   Jo to confirm, service visit otherwise.
3. **The $17.5k insurance-claim dispute** (the D2D-whale record): carrier
   denied replacement 7/22 on an "ITEL exact match / mismatch = wear-and-
   tear" theory; the homeowner gave **written authorization** for Jo to
   respond on their behalf 7/24 — unanswered since. Rebuttal drafted
   (product-ID vs line-of-sight-appearance argument + re-inspection
   request + OAC 3901-1-54(I)(1)(b) uniform-appearance standard).
4. **An accepted $1,300 repair** (email acceptance Aug 14, unread 3 days)
   — scheduling reply drafted; CRM already had the record at
   crew_scheduled, so pipeline math was right all along.
5. **An active asbestos-siding project** — testing paid + report in hand,
   two competing abatement bids received (latest 7/29), decision email to
   the homeowners drafted with both options.

Also recovered: a documented **lost-reason** on a May roof-replacement quote
(competitor won on price/warranty/speed and "they actually inspected our
attic space" — process lesson: attic inspection sells); the real contact
info for a **repeat-commercial client** (a NJ multifamily investment firm
that owns two Cincinnati buildings Jo serviced — the CRM had only an
expiring Thumbtack proxy number); the probable location of the **missing
change-order paperwork** the Aug-15 audit flagged on the biggest paid job
(a scanned-documents email from the customer, 7/20); and confirmation that
the codes/weather report for the storm-claim packet (open task) was already
ordered 8/10.

## CRM writes

9 records enriched in prod (append-only notes; contact fields filled only
where empty; one expiring marketplace-proxy phone replaced by verified
lines). No new records needed — every mailbox customer already existed.
No deletions, no stage changes.

## Process lessons (worth keeping)

- **Junk folder is a lead-loss surface.** A paying past customer sat there
  a month. Weekly Junk scan added to the cadence candidates; longer-term
  fix is email ingest (below).
- **Email is the CRM's blind spot.** Estimate acceptances, warranty
  complaints, and claim correspondence all arrived as email and stalled
  unread. The Thumbtack webhook closed the marketplace gap; an email-ingest
  lane (forward-to-CRM address or IMAP poller → leads/notes) is the same
  play for the inbox. Candidate big rock — scoped same day:
  [EMAIL-INGEST-2026-08](../architecture/EMAIL-INGEST-2026-08.md).
- Mail app iframes defeat text extraction in the in-app browser
  (get_page_text returns the shell) — screenshot-driven reading works.

## Jo actions produced (all in KIT ADDENDUM 2, priority order)

1. Hartford rebuttal (pre-send checklist inside: attach the homeowner's
   authorization email + line-of-sight photos; verify the OAC cite).
2. Junk-folder warranty callback — call first, TODAY.
3. Mid-June warranty complaint — send full plan, or trimmed version if
   already handled by phone.
4. Accepted $1,300 repair — pick two date options, send.
5. Asbestos decision email — fill the two bid figures from the PDFs first.

Everything else from the Aug-16 queue (Stripe key roll, Yelp billing check,
storm-claim photos, Aug 24 8pm Thumbtack budget drop) is unchanged.

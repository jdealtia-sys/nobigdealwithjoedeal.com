# Next Session — after the 2026-08-16 lead-data / CRM-load / channel-rebalance session

> Cold-start brief, written at session end. Self-contained. Read the repo-root
> [CLAUDE.md](../../CLAUDE.md) first. The webhook's full technical record is
> [THUMBTACK-WEBHOOK-2026-08](../architecture/THUMBTACK-WEBHOOK-2026-08.md).
> [NEXT_SESSION-2026-08-11](NEXT_SESSION-2026-08-11.md)'s queue still stands
> where not superseded here. A parallel session the same weekend produced
> [NEXT_SESSION-2026-08-17](NEXT_SESSION-2026-08-17.md) (backlinks/AEO rush),
> which holds the "current handoff" slot — this note is the CRM/lead-ops lane.
>
> **PII rule for this note:** customer names, phones, and addresses stay OUT of
> this public repo. Everything person-level from this session lives in Google
> Drive (COMPANIES/NBD): the **follow-up kit** doc ("NBD FOLLOW-UP KIT —
> send-ready drafts, Aug 16 2026") and its **KIT ADDENDUM — D2D whales**
> companion. When this note says "see the kit", that's where.

> **UPDATE 2026-08-17 — iCloud Mail sweep ran as the next session in this
> lane** ([SESSION-2026-08-17-icloud-mail-sweep](SESSION-2026-08-17-icloud-mail-sweep.md)).
> Net effect on this note: the Jo action queue below is superseded by the
> combined queue in that log — **five send-ready customer replies now sit in
> Drive ("KIT ADDENDUM 2"), priority above everything except the Stripe key
> roll**. 9 CRM records were enriched with verified emails/phones; the
> missing change-order paperwork flagged in "What this session did" was
> located (customer's scanned-docs email of 7/20); the D2D-whale contact
> info gap flagged in Jo action #4 is now closed. Also: PR #1204's items and
> the queue below otherwise stand.

## What this session did

A long operator session, mostly in the live browser + prod Firestore, plus two
merged PRs. Three tracks:

### 1. Code shipped (both merged to `main`, deployed to prod)

- **#1203 — Thumbtack webhook → CRM lead pipeline.**
  `functions/integrations/thumbtack.js` (onRequest receiver: fails closed 503
  without secret, shared-token auth via custom header or Basic, timing-safe
  compare, 256KB cap) + `thumbtack-logic.js` (pure parser, fully unit-tested)
  + `lead-bridge` trigger so marketplace leads land as CRM leads with
  `source: 'Thumbtack'`, `webLead: false`. Secret
  `THUMBTACK_WEBHOOK_SECRET` set; added to the `integrationStatus` readout
  (smoke lock requires that). Explicit default-deny rules for the
  `thumbtack_*` collections. **It is LIVE and has already ingested real
  leads** — two came in during the session and were bridged, followed up in
  the kit. Same PR: `lead-dedup.js` normAddress street-guard fix,
  `widgets.js` Revenue-This-Month `closedAt` fix, importer owner plan-cap
  exemption.
- **#1204 — punch list.** CSV import now mints `customerId` (NBD-####) via
  the counters transaction, fail-open per row; Estimate V2 draft restore is
  now an actual offer (confirm prompt when draft >10 min old) instead of a
  silent overwrite.
- Tests: 110 new assertions across `thumbtack-webhook.test.js` (includes a
  REAL captured payload fixture) and `lead-dedup.test.js`; both wired into
  `tests/ci-manifest.json` + package scripts.

### 2. Data — the CRM is now the system of record

- All ~66 named customers from the Aug-15 audit trackers enriched (5 sources:
  Thumbtack threads + CSV export, Yelp threads, Drive folders, Google Keep,
  call-log filenames) and imported through the real UI importer.
- 10 conflicting records reconciled to receipts, `closedAt` stamped on 21
  won jobs (so revenue widgets report by close date, not touch date),
  `customerId` backfilled NBD-0123..0179, stages normalized to canonical keys.
- **Demo/ORC cleanup (Jo-confirmed per item):** 13 records soft-deleted —
  1 demo cluster record, **4 real jobs that were ORC's** (Oaks Roofing &
  Construction — Scott's book, not NBD's), 2 E2E test records, 2 of Jo's own
  funnel-test submissions. All reversible: `deleted: true` + dated
  `deletedReason` on each.
- **End state: 144 active leads, 23 won, $56,947.25 active named pipeline —
  every number real.** Honest revenue by month (NBD-verified): May ~$4.4k,
  Jun ~$32k, Jul ~$26.7k, Aug $6.1k so far. The Aug cliff is real (10 jobs,
  avg $609, none ≥ $3k).
- The big strategic finding: door-knocking won ~$53k this summer **on ORC's
  books**. The growth pattern that IS NBD's: big jobs seeding same-street
  neighbor referrals. The ORC-vs-NBD booking question is a business
  conversation for Jo, not a code fix.

### 3. Channels rebalanced (audit numbers: Thumbtack $2.45/$, Yelp $138/$)

- **Thumbtack:** 6 services paused (~77% of spend stopped); Roof Repair +
  Roof Inspection + Siding Repair stay on. Weekly budget left INTACT at
  $1,527 until **Mon Aug 24, 8pm ET** to keep the 6-free-leads offer —
  calendar reminder set (note: it landed on Jo's secondary Google account). After
  that deadline: lower the budget.
- **Yelp:** budget $24 → $40/day (Jo-approved), verified live on-platform.
  Profile/services mapped. Reminder: Yelp hides solicited reviews — never
  ask for them from the platform.

## Jo actions (ranked)

1. 🔴 **Roll the live Stripe secret key.** A live `sk_live_…` key sits in a
   Google Keep note found during the enrichment sweep. Roll it in the Stripe
   dashboard, update the secret where used, then delete the Keep note.
2. **Yelp Billing check** (behind password re-auth): $280 promo credit
   expires 25 Nov 2026; $211.70 accrued vs $0.00 outstanding — confirm the
   credit is actually being consumed now that $40/day is live.
3. **Shoot the roof photos** for the storm-claim packet (open task #7; the
   send-message draft is kit item 25). Packet goes same day.
4. **Send the follow-up kit** — 25 drafts, sectioned: today's 7 (including
   the two webhook-caught leads), 3 approved-money follow-ups, 12 cold
   proposals, 3 marked DO-NOT-SEND-YET. Fill the [BRACKETED] placeholders.
   The addendum has the 3 D2D whale texts (~~one target's contact info still
   needs adding to their CRM record first~~ — done 2026-08-17, found in the
   iCloud sweep along with the full claim-correspondence history).
5. **Aug 24, 8pm ET:** lower the Thumbtack budget (see above).
6. Small: delete the orange test photo left on one lead's Photos tab during
   CRM verification (noted in the kit); one webhook lead is waiting on an
   address before their estimate can move.

## Next session candidates

0. **Email-ingest lane** (new, from the 08-17 sweep): the inbox is the CRM's
   remaining blind spot — acceptances and warranty complaints stall unread
   in mail (one paying customer sat in JUNK for a month). Same play as the
   Thumbtack webhook: forward-to-CRM address or IMAP poller → leads/notes.
   Scope it before building.
1. Watch the webhook end-to-end on the next organic Thumbtack lead
   (receiver → bridge → kanban → follow-up); it's new in prod.
2. ~~Image-pipeline nested-path fix~~ ✅ **DONE in its own session** (PR
   #1206; see
   [SESSION-2026-08-16-image-pipeline-nested-shapes](SESSION-2026-08-16-image-pipeline-nested-shapes.md)
   — backfill follow-ups live there).
3. Yelp Portfolio build — photos + price ranges ONLY, under
   [PUBLISH-PROJECT](../runbooks/PUBLISH-PROJECT.md) consent rules; Jo
   reviews every image (EXIF-strip via `scripts/prepare-project-images.mjs`).
4. If Scott wants them: re-create the 4 ORC jobs under the `oaks` tenant.
5. Aug revenue-cliff response: the kit's 12 cold proposals + neighbor-referral
   plays around the big May–Jul jobs.

## Watch-outs

- **Thumbtack webhook realities** (hard-won; full detail in the architecture
  note): payload schema is unpublished — real leads arrive as
  `NegotiationCreatedV4`; test deliveries carry NO flag (only tell:
  `data.business.name` = "Test Business for Webhooks"); idempotency keys on
  `negotiationID` (a request can fan out to several pros); **Thumbtack never
  sends customer emails**; the 669-area phone numbers are expiring proxies —
  get real numbers into the CRM fast. Raw payloads are stored on the docs, so
  misclassified events are recoverable.
- **Deploy from a checked branch state.** This session briefly deployed
  firestore.rules from a stale detached HEAD (5 behind main) and regressed
  the #1197 tenant-isolation hardening for ~25 min before catching it.
  Rebase/fetch first; verify `git status` + branch vs `origin/main` before
  any `firebase deploy`.
- **Orphaned half-created gen2 function:** a transient Cloud Run failure
  mid-create leaves a corpse that makes retries fail with "Changing from an
  HTTPS function to a background triggered function is not allowed" — delete
  the orphan, then recreate. CI's retry loop will NOT self-clear this.
- The CI drift-locks work: they caught both webhook-PR omissions
  (ci-manifest classification + integrationStatus secret readout). Budget
  for them when adding functions/secrets.
- Soft-deleted leads vanish from `loadLeads()` results entirely — dashboard
  counts are active-only by construction; don't re-add "deleted" totals.

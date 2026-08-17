# Email ingest lane — scope (2026-08-17)

> **Status: SCOPED, NOT BUILT.** Product of the
> [2026-08-17 iCloud sweep](../projects/SESSION-2026-08-17-icloud-mail-sweep.md)'s
> candidate #0 ("scope it before building"). Companion pattern:
> [THUMBTACK-WEBHOOK-2026-08](THUMBTACK-WEBHOOK-2026-08.md) — this lane is
> the same play pointed at the business mailbox. No PII in this note.

## Why (the evidence)

The CRM's intake covers web forms (lead-bridge), marketplace webhooks
(Thumbtack), and inbound SMS. **Email is the remaining blind spot**, and the
Aug-17 mailbox sweep measured what that costs: five customer threads stalled
waiting on replies — an estimate acceptance unread 3 days, a warranty
complaint unanswered ~2 months, an insurance-claim authorization unanswered
~3.5 weeks, and a past customer's callback that sat in **Junk** for a month
until he threatened to "look elsewhere." The failure mode is precisely
*mail the operator never saw*. Any design that depends on the operator
noticing and forwarding a message does not fix the discovered problem.

## Options considered

**A. IMAP poller (scheduled function) — CHOSEN for v1.**
The business address is hosted on iCloud+ custom-domain mail. Apple offers
no push/webhook API; IMAP (imap.mail.me.com:993, app-specific password) is
the only programmatic read path. A cron reads INBOX **and Junk** directly —
covering exactly the mail-never-seen failure mode — with no third-party
vendor, no DNS/MX changes, and credentials in Secret Manager like every
other integration.

**B. Forward-address inbound-parse webhook (Mailgun/Postmark/CloudMailin →
onRequest receiver) — REJECTED for v1, right shape for v2/tenants.**
Cleanest server architecture (identical to the Thumbtack receiver) and it
scales to *other tenants* without holding their mailbox credentials — but
it only sees what someone forwards or what DNS routes to it. For Jo's own
mailbox it cannot see Junk or unread mail, i.e. it misses the entire
observed loss surface. Also adds a vendor + subdomain MX setup. Revisit
when the CRM grows a tenant-facing "connect your email" feature.

**C. Move mail to Google Workspace for the Gmail API — rejected.** Migrating
the business mailbox to gain an API is a tail-wags-dog move.

## v1 design (tenant-zero only, deliberately)

One new integration, two files, one bridge extension — mirroring Thumbtack:

- **`functions/integrations/email-ingest.js`** — `exports.emailIngestCron =
  onSchedule(...)` every 10 min (`timeZone: 'America/New_York'`,
  `region: 'us-central1'`, `maxInstances: 1`, `secrets: [...]`), gated
  behind an `EMAIL_INGEST_ENABLED` env flag like the other crons
  (FUNCTIONS_INDEX.md:160-169 convention). **Read-only IMAP**: never sets
  \\Seen, never moves messages — the operator's unread badges stay honest.
  Cursor = per-mailbox UIDNEXT watermark persisted in a
  `integration_state/email_ingest` doc; Message-ID (fallback
  sha256(headers)) → sanitized deterministic doc id for idempotency,
  exactly the thumbtack.js pattern (create(), 200-on-duplicate).
- **`functions/integrations/email-ingest-logic.js`** — pure, unit-testable:
  header/address parsing, matching, classification, note building.
- **Bridge extension** (functions/lead-bridge-logic.js): `email_leads:
  { kind: 'email', label: 'Email' }` in BRIDGE_KINDS + `'email_leads'` in
  EXTERNAL_SOURCE_COLLECTIONS (bare-label attribution, `webLead: false`,
  mapper prefers precomputed `notes` — logic:197-202), plus a literal
  `exports.leadBridgeEmail = onDocumentCreated(...)` trigger with the
  `{leadId}` path param (lead-bridge.js:112-118 factory).

### Per-message decision tree (privacy tiers)

1. **Known-customer match** → append an activity note to the existing lead
   + Resend alert to the operator (reuse the lead-alert pattern). Matching:
   sender email vs lead `email` (case-insensitive), else `phoneDigits10` of
   any phone found in the body vs lead `phoneDigits` — the
   inbound-sms-convert precedent (handlers/inbound-sms-convert.js:77-91).
   At tenant-zero scale (~150 leads) an in-memory scan over one
   `companyId==` query is fine; a normalized `emailLower` field + equality
   query is the v2 index play. **This attach path is the genuinely new
   logic** — the bridge only creates; it never attaches (recon-verified:
   no findExisting/email-dedup anywhere in functions/).
2. **Unknown sender, lead-shaped** (keyword heuristic: roof/gutter/siding/
   estimate/quote/leak/inspection/claim + a reply-to-our-domain signal) →
   store parsed doc in `email_leads` → bridge creates the CRM lead.
3. **Everything else** → counted in the state doc, **not stored**. The
   mailbox holds personal mail; the ingest keeps only what is plausibly
   business. This tier boundary is the privacy contract of the lane.
4. **Junk-folder hits** in tiers 1–2 get a "rescued from Junk" line in the
   alert — the sweep's single most expensive finding class.

### Storage & rules

`email_leads` (and `email_events` for tier-1 activity provenance if split
out) are Admin-SDK-only: explicit `allow read, write: if false;` blocks
above the DEFAULT DENY with a sole-writer comment — copy the thumbtack_*
block verbatim (firestore.rules:1628-1646 pattern).

### Secrets

`ICLOUD_IMAP_USER` (Apple ID username) + `ICLOUD_IMAP_APP_PASSWORD`
(app-specific password — Apple invalidates all of these on any Apple ID
password change, so the failure mode is "secret silently dead"; the cron
must alert once, then back off, when auth fails). Registered per the
standard checklist below.

### Dependencies (net-new — the main cost driver)

`imapflow` (IMAP client, CommonJS, Node 22 OK) + `mailparser` (MIME
decoding). Both must survive `npm audit --audit-level=high` (ci.yml
functions-parse gate) with any MODERATE findings documented in
NPM_AUDIT_ACCEPTED.md; regenerate functions/package-lock.json (the
referral-trigger job runs bare `npm ci`, no fallback — stale lockfile
breaks it specifically); don't disturb the brace-expansion/minimatch
override pair. If mailparser's tree audits badly, fallback is
imapflow-only envelope + hand-rolled text-part decode for v1 (tier-1 needs
headers + a text snippet, not full MIME fidelity).

## CI/lock checklist (recon-verified, with the tripwires)

1. Export names literal at column 0 (`exports.emailIngestCron = onSchedule(`,
   `exports.leadBridgeEmail = onDocumentCreated(`) in one of the four
   scanned globs — the deploy allowlist grep (firebase-deploy.yml:608)
   silently drops wrappers/new dirs; this exact bug hit the Storage
   triggers (#1210). `onSchedule`/`onDocumentCreated` are already in the
   alternation — no workflow edit.
2. Secrets: `defineSecret` entries in the `_shared.js` SECRETS registry +
   `emailIngest: _hasInt('ICLOUD_IMAP_APP_PASSWORD')` in integrationStatus's
   `configured:{}` — locked by tests/smoke/functions.test.js:2346-2378. The
   deploy workflow auto-stubs missing secrets (`__unset__`), so nothing
   deploys broken; `hasSecret()` reads the stub as not-configured and the
   cron no-ops with `notConfigured()`.
3. New unit test file → `"node"` bucket of tests/ci-manifest.json
   (precedent: thumbtack-webhook.test.js:35); verify with
   `node scripts/run-test-manifest.js --check`.
4. Both new exports → FUNCTIONS_INDEX.md rows (Background/trigger section +
   SCHEDULED CRONS table **and bump its hand-maintained count**) — locked by
   tests/smoke/dashboard.test.js:893.
5. firestore.rules explicit-deny blocks (see Storage & rules).
6. SECRET_ROTATION.md numbered section: mint new app-specific password at
   appleid.apple.com → `firebase functions:secrets:set` → revoke old.
7. Vault note update + this doc flipped from SCOPED to LIVE on ship.

## Operator setup (Jo, ~5 min)

1. appleid.apple.com → Sign-In & Security → App-Specific Passwords →
   generate one named `nbd-crm-email-ingest`.
2. Hand both values to the session doing the build for
   `firebase functions:secrets:set` (never paste secrets into chat/repo).
3. After first deploy: send a test email to the business address and watch
   it land as a lead + alert.

## Effort & sequencing

One focused session, same weight as the Thumbtack webhook build (~receiver
+ logic + tests + locks + deploy + live verification), plus the dep-audit
unknown (imapflow/mailparser tree). Suggested order: deps + audit first
(cheapest abort point), then logic + tests offline, then cron + bridge +
locks, then deploy dark behind `EMAIL_INGEST_ENABLED=false`, then flip.

## Open questions / v2

- **Attach-note shape**: plain `notes` append vs a proper activity/timeline
  subcollection — decide against whatever the dashboard timeline renders
  best; notes-append is the v1 answer if in doubt.
- **emailLower backfill + composite query** once any tenant's lead count
  makes in-memory scanning silly.
- **Folder signals**: the operator already files mail into per-customer
  folders; a v2 could treat folder placement as ground-truth matching.
- **Tenant-facing version** = option B (inbound-parse forward address per
  tenant), which avoids holding tenant mailbox credentials entirely.
- **Outbound linking**: Sent-folder scan to stamp "we replied" and close
  the loop on response-time metrics — explicitly out of v1.

# Email unsubscribe — per-tenant suppression, one-click List-Unsubscribe (2026-09-22)

**Why:** the CRM had no email opt-out anywhere (nothing wrote or read an unsubscribe;
`sendEmail` checked auth, role and rate limits only). CAN-SPAM needs a working opt-out
on every **commercial** email, honoured within 10 business days. Transactional /
relationship mail is exempt. Owner's call (2026-09-22): an unsubscribe blocks
commercial mail to that address **for that tenant**; transactional mail still sends;
contractor/team mail is out of scope.

## What was built

- `functions/email-suppression.js` — the register and the ONE gate.
  - `email_suppressions/{companyId}__{sha256(lowercased trimmed email)}` →
    `{companyId, emailHash, email, source: link|one_click|rep|complaint|bounce, createdAt, leadId?, byUid?}`.
  - `email_unsub_tokens/{token}` → `{companyId, email, emailHash, leadId?, source, createdAt}`;
    token = 32 random bytes, base64url (43 chars), minted per commercial send, no expiry.
  - `resolveCategory({category, kind})` — transactional ONLY for `category:'transactional'`
    or a kind in `TRANSACTIONAL_KINDS` (estimate, proposal, invoice, receipt, contract,
    portal_link, document, appointment). Anything else is commercial (fail closed).
  - `gateCommercialEmail()` — suppressed → `{suppressed:true}`; clear → mints a token and
    returns the footer + `List-Unsubscribe` / `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
    headers. **Throws** on a read/mint error (same stance as `sms-optout.js`). Bounded read (10s).
  - `SEND_PATHS` — every `functions/` file that calls `resend.emails.send()`, classified.
    `tests/email-unsubscribe.test.js` fails if a new send file is unclassified or a
    commercial one doesn't call the gate.
- `functions/email-unsubscribe.js`
  - `emailUnsubscribe` (onRequest, 256MiB, public by design) at `/unsubscribe/<token>`
    (firebase.json rewrite). GET/HEAD = confirm page (tenant `companyProfile.brand.legalName`,
    masked address, POST button, no script) with **no side effect**. POST = record
    (page button → `link`, RFC 8058 body → `one_click`), idempotent. Unknown token →
    neutral 404. Per-IP rate limit 30/min.
  - `markEmailUnsubscribed` (onCall, App Check) — lead owner / same-company
    company_admin|manager / platform admin; source `rep`.
- `sendEmail` (email-functions.js): takes `kind`; commercial to a suppressed address →
  **403 `{code:'unsubscribed', error:'This person unsubscribed from email'}`**, logged to
  `email_log` as `status:'suppressed'` (leadId+uid+date kept). Register unreadable →
  **503 `suppression_unverified`**. The check runs **before both limiters** (the #1667
  lesson — the client hands a 429 off to `mailto:`), so the per-IP limiter now runs
  after auth, as in `sendSMS`.
- `funnel-recovery.js`, `lead-followup.js` — gated; suppressed records are stamped
  (`recoveryEmailStatus:'suppressed'`, `followUpEmailSuppressedAt`) so they are not re-checked.
- Client: `nbd-comms.js` forwards `kind`, treats 403 `unsubscribed` and 503
  `suppression_unverified` as final refusals (no `mailto:`); `email_system.js` no longer
  falls through to `mailto:` after a platform refusal; callers declare kinds; customer page
  shows an "Unsubscribed from email" badge and a "Mark unsubscribed" action.
- Rules: `email_suppressions` GET for the tenant named in the id prefix (claim companyId, or
  uid for a claim-less solo), doc companyId must match; no list; no client write.
  `email_unsub_tokens`: no client access.

Tenant key everywhere = `claims.companyId || uid` (NBD tenant zero = `NBD_OWNER_UID` for the
public-site automations).

## Classification of every email path

| Path | Recipient | Category | Gate after this change |
|---|---|---|---|
| `email-functions.js` `sendEmail` | customer (rep-initiated) | per-request `kind`, default **commercial** | commercial → gated (403/503, footer + headers); transactional kinds pass |
| ↳ compose modal (`email_system.js`) general / follow-up | customer | commercial | gated |
| ↳ compose modal `estimate` / `photoReport` | customer | transactional (`estimate` / `document`) | not gated |
| ↳ stage templates: `adjuster_meeting_scheduled`, `crew_scheduled` | customer | transactional (`appointment`) | not gated |
| ↳ stage template `estimate_sent_cash` | customer | transactional (`estimate`) | not gated |
| ↳ every other stage template + generic follow-up | customer | commercial (fail closed; status updates like *claim filed* could arguably be relationship mail — kept commercial) | gated |
| ↳ `invoice-pipeline.js` send invoice / payment receipt | customer | transactional (`invoice` / `receipt`) | not gated |
| ↳ `close-board.js` deal accept link | customer | transactional (`proposal`) | not gated |
| ↳ `portal-link-helpers.js` portal link | customer | transactional (`portal_link`) | not gated |
| ↳ `smart-followup.js` suggestion email | customer | `send-portal` → `portal_link`; everything else commercial | gated unless portal |
| `funnel-recovery.js` `runAbandonRecovery` | website visitor | commercial | gated (NBD key) |
| `lead-followup.js` `leadFollowUpSweep` | homeowner | commercial (owner listed follow-up sequences) | gated (CRM card's tenant, else NBD) |
| `estimate-email.js` `estimateEmail` | homeowner who pressed "Email My Estimate" | transactional | not gated |
| `storm-report-email.js` `stormReportEmail` | homeowner who asked for the report | transactional (requested report copy; it does carry an inspection CTA — the judgement call) | not gated |
| `lead-alert.js` `ackHomeowner` | homeowner, one ack of their own request | transactional | not gated |
| `lead-alert.js` `alertJoe` email | tenant alert inbox | internal | out of scope |
| `esign-envelope.js`, `remote-signing.js` | signer | transactional | not gated |
| `report-sharing.js` | customer | transactional | not gated |
| `anniversary-touch.js`, `dormant-leads.js`, `review-request-nudge.js`, `weekly-digest.js` | the rep (not the homeowner — verified) | internal | out of scope |
| `storm-watch.js`, `lead-digest.js`, `marketing-report.js`, `verify-functions.js` | Joe | internal | out of scope |
| `handlers/invites.js` | invited teammate | internal (account) | out of scope |
| `integrations/email-queue-worker.js` (dunning, erasure confirm, health digest, backup freshness, overhead alert) | account holder / owner | internal (account) | out of scope |
| `mailto:` anchors (review request `ReviewEngine.sendReviewEmail`, header Email button, D2D, quick-action bar), `emailSystem.send` EmailJS path | sent from the rep's own mail app | — | not platform mail; not gated |

## Open for the owner

- ~~**CAN-SPAM also requires a valid physical postal address** in every commercial email.
  Not added here — the funnel-recovery footer says "Greater Cincinnati, OH", which is not
  one. Needs a tenant-level address field (companyProfile) and a footer line.~~
  **BUILT 2026-09-22 (later the same day) — see the update section at the bottom.**
  Still needs Jo to put his PO box in the field once he has it.
- Resend: no dashboard change needed — SDK 6.x passes `headers` (already used for
  `X-NBD-Campaign`). Resend's own bounce/complaint suppression list is not synced into
  this register (`bounce`/`complaint` sources are reserved for a future Resend webhook).
- No re-subscribe path (a homeowner who opts back in has to be removed by an admin).
- Review requests go out through `mailto:` today (the rep's own mailbox), so the platform
  cannot gate them.
- NBDComms still hands a network failure / plain 500 off to `mailto:` without knowing the
  suppression state (a 429 can no longer precede the check).

## Deploy notes

New functions `emailUnsubscribe` + `markEmailUnsubscribed` (picked up by the
`firebase-deploy.yml` export grep), new hosting rewrite `/unsubscribe/**`, new rules.
Rules must be live for the badge (without them the read is denied and the badge simply
stays off; the server still enforces). After deploy: `curl -sL` a garbage
`/unsubscribe/<43 chars>` → neutral 404 page proves the rewrite + public invoker.

Tests: `tests/email-unsubscribe.test.js` (node bucket), rules block 33 in
`tests/firestore-rules.test.js`. Mutation results are in the PR.

---

## Update 2026-09-22 (same day, follow-up PR) — the postal address is built

`functions/email-suppression.js` now resolves a CAN-SPAM §7704(a)(5) postal address and
prints it under the unsubscribe link in both the HTML and the text footer.

**Per tenant, with no platform default.** `tenantPostalAddress(db, companyId)` reads
`companyProfile/{companyId}` → `brand.contact.mailingAddress`. There is deliberately no
fallback: a hardcoded default would print one contractor's postal address in another
contractor's marketing mail, which is the NBD-leak class this codebase has been bitten by
before. Unset → the footer renders byte-identically to how it did before this change.

**It fails SOFT, and the asymmetry against the suppression read is deliberate.** An
unreadable suppression register throws (fail closed — sending after someone said stop is
a legal violation). An unreadable `companyProfile` returns `''` and the mail still goes
(a missing address is a disclosure gap on mail that is otherwise wanted; failing closed
there would mean one bad read silently stops all commercial email).

**Where a contractor sets it:** CRM → Settings → Company Profile → *Mailing address*.
Its own labelled sub-section, separate from the existing "Address (one line)" field and
NOT mirrored into it — the letterhead/microsite address and the address someone is willing
to publish in marketing email are different decisions, and a PO box is the normal answer
for the second. `maxlength=200`, newlines/tabs collapsed, HTML-escaped into the footer.
`mailingAddress` was added to `_IDENTITY_CONTACT` in `company-profile.js` so a stranger
tenant blanks it rather than inheriting NBD's.

**Mutation-verified** (four shapes, each applied-assert then run):

| mutation | result |
|---|---|
| address read always returns `''` (feature inert) | 4 failed |
| hardcoded platform default when the tenant sets none — *the leak shape* | 1 failed |
| drop the HTML escaping on the address | 1 failed |
| fail CLOSED on an unreadable profile | suite exits 1 |

The leak shape **survived the first pass** — the existing "no address" test used a
*missing* profile doc, which returns early and never reaches the field read. Two
assertions were added for a profile that EXISTS with no (or a blank) `mailingAddress`.
A fifth attempted mutation silently no-opped because the needle used `
` against a CRLF
file (the `String.replace` trap in CLAUDE.md); every mutation now asserts it applied
before the run.

**Still open on the postal address:** Jo has to enter the PO box once he has it. Until
then the field is empty and commercial email ships without an address, exactly as it did
before — this PR removes the blocker, it does not close the compliance gap by itself.

**Deliberately NOT done:** moving the unsubscribe-token mint after `sendEmail`'s rate
limiters. The handoff listed it as a cost leak, but the suppression gate has to stay
ahead of the limiters on purpose (#1667: the browser client answers a 429 by opening the
rep's mail app with the message filled in, so a 429 ahead of the check would hand an
unsubscribed address to a device-side send). Splitting check from mint is possible, but
the leak is one tiny doc on a send that 429s — rare at 60/hr/IP and 200/day/uid — and it
is not worth destabilising that ordering for. Revisit if token volume ever matters.

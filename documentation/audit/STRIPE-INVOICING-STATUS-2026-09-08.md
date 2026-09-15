# Stripe invoicing status — 2026-09-08

Jo asked how hard a "fully integrate Stripe with the CRM so we can create and
send invoices from there" project would be, and whether it's worth building
versus going straight to Stripe or drafting invoices outside the CRM. **The
premise was wrong: it is already built**, and built past the bar a
from-scratch version would likely clear. This note is the evidence trail —
recon only, nothing changed in code.

## Two Stripe systems in this repo — do not conflate them

1. **Platform subscription billing** — a contractor tenant paying NBD for
   NBD Pro seats (`createCheckoutSession`/`stripeWebhook`/
   `createCustomerPortalSession`, `functions/stripe.js:230-1073`). Separately
   scoped in [PILLAR4-BILLING-PLAN.md](../architecture/PILLAR4-BILLING-PLAN.md)
   (mostly shipped per its 2026-07-05 status header). Not what Jo asked about,
   but load-bearing evidence below: it uses the *same* `STRIPE_SECRET_KEY` /
   `STRIPE_WEBHOOK_SECRET` secrets as invoicing, and it demonstrably works
   today (it's how tenants pay for the product) — so those secrets are live
   in prod, not the `__unset__` deploy stub this repo has been bitten by
   before (Slack, Turnstile, HOVER/EagleView/Nearmap).

2. **Customer invoicing** — a tenant's rep billing their own homeowner and
   collecting payment. This is the one Jo means. It exists as a genuinely
   mature system, not a stub:
   - `createStripePaymentLink` (`functions/stripe.js:1075-1368`) mints a
     real, single-use Stripe Payment Link per invoice: recomputes line
     totals server-side against the product catalog, appends a tax line,
     reconciles the link total to `invoice.total` to the penny before
     minting, charges only the **outstanding balance** (total minus any
     recorded deposit) so a 50%-deposit job doesn't get double-billed, and
     deactivates any prior link on regeneration so two payable links can
     never coexist on one invoice.
   - `invoiceWebhook` (`functions/stripe.js:1497`+) verifies signatures
     against a dedicated `STRIPE_INVOICE_WEBHOOK_SECRET` (falling back to
     the shared one mid-rotation), marks the invoice paid on
     `payment_intent.succeeded`, and — phase 3 — handles disputes with a
     `disputeFundsWithdrawn`/`decideDisputeReversal` pair
     (`functions/stripe-connect-logic.js:175-262`) that correctly
     distinguishes an Amex/Discover *inquiry* (costs the platform $0) from a
     real chargeback, and reverses only the tenant's share of a destination
     charge — not a naive "reverse on any dispute event."
   - **Stripe Connect Express** (`functions/handlers/stripe-connect.js`,
     `functions/stripe-connect-logic.js`) exists for *other* tenants: each
     gets their own connected account so a homeowner's payment settles into
     the contractor's Stripe balance (not NBD's), with a 3.4%+30¢ platform
     fee on Connect-routed mints only. Gated on `mayCollectOnline()` (real
     `acct_` id + `chargesEnabled` + `detailsSubmitted` + live mode) **and**
     a live subscription (`stripe.js:85-99`).
   - **Jo's own account needs none of that.** `NBD_OWNER_UID` /
     `isPlatformTenant()` (`functions/stripe.js:72-81`) is the "platform
     tenant" — his invoices mint directly on the same Stripe account that
     already processes NBD Pro subscriptions, no Connect onboarding, no
     platform fee. The client-side gate mirrors this exactly
     (`docs/pro/js/invoice-pipeline.js:618-644`, `_canCollectOnline()`):
     checks `window.__NBD_OWNER_UID` first and short-circuits to `true`
     before ever reading a `connectAccounts/` doc. Both sides — client
     mirror and server authority — agree, and the comments on each say so
     explicitly (`stripe.js:1097-1107`, `invoice-pipeline.js:603-617`).

## The send flow is real, not a placeholder

`sendInvoice(invoiceId, method)` (`docs/pro/js/invoice-pipeline.js:682`+):
builds a full invoice HTML, sends it via `NBDComms.sendEmail` (or `sendSMS`
with the Stripe pay link interpolated into the message body), and refuses to
double-send — an explicit `status:'sent'`/`'sending'` lock with a stale-lock
timeout, because a flaky network used to leave an invoice `draft` after the
email had already gone out, so the next tap re-sent it. This is a "click
Send, the customer gets a real email with a real pay link" pipeline, not a
"generate a link and go paste it somewhere yourself" one.

**Mounted, not dead code**: a real dashboard button (`data-fn="cdaInvoice"`,
confirmed at `docs/pro/dashboard.html:6197` before this session's own recon
agent was cut off by an expired token) opens `InvoicePipeline.createInvoiceUI`,
and `case 'sendInvoice'` in the dashboard's action dispatcher
(`dashboard.html:1677`) calls `IP.sendInvoiceUI`.

## Test coverage exists and is dispute/tax/edge-case aware

`tests/stripe-connect.test.js`, `stripe-connect-ui.test.js`,
`stripe-payment-link-tax.test.js`, `stripe-dispute-branches.test.js`,
`stripe-platform-only-payments.test.js`, `invoice-payment-webhook.test.js`,
`customer-invoice-markpaid.test.js` — seven dedicated files, on top of the
pure-logic module (`functions/stripe-connect-logic.js`) being
dependency-free specifically so tests can exercise it directly without
mocking Firebase or Stripe (file header, `stripe-connect-logic.js:1-17`).

## What is NOT verified — the actual remaining gap

This repo has a well-established habit of writing "verified live" into a
session note the first time a feature is exercised for real (see e.g.
[ESIGN-CRM-RECON-2026-09-06](ESIGN-CRM-RECON-2026-09-06.md),
[NAV-DRAWER-RELIABILITY-2026-09-08](NAV-DRAWER-RELIABILITY-2026-09-08.md)).
A repo-wide search for `stripe`/`invoice`/`Connect` turned up **no such note
for this pipeline** — no record of anyone creating a real invoice, sending
it, and watching a real payment land. Given this codebase's own recurring
pattern (features complete and merged but never actually exercised —
[features-exist-but-are-unmounted], the renderPdf outage in
[RENDERPDF-CHROMIUM-INTEROP-2026-09-08](RENDERPDF-CHROMIUM-INTEROP-2026-09-08.md),
the Instant Roofer stub secrets), "built and unit-tested" is not the same
claim as "works end-to-end," and this session did not attempt a live run
(would touch real Stripe money and prod secrets — Jo's call, not a default
action). Concretely unverified:
- That `STRIPE_INVOICE_WEBHOOK_SECRET` specifically holds a real `whsec_`
  value rather than riding the fallback to the shared subscription secret
  (the code tolerates either, but only one has been *proven* live).
- That `window.NBDComms.sendEmail` actually delivers the invoice HTML in
  prod (versus queuing into `email_queue` and stalling — this repo has hit
  exactly that failure mode with other queues before).
- That a real customer-facing Payment Link renders correctly and redirects
  to `invoice-success.html` on completion.

## UPDATE 2026-09-08 — live-tested on a seeded dummy lead

Ran it for real: started the full local emulator suite (`firebase-full` /
`emulators:start`), seeded a Firestore user at the exact platform-tenant
`NBD_OWNER_UID`, a dummy lead, and a $42 test estimate, logged in as that
user through the real dashboard UI, and walked the actual invoice flow —
no mocking, no direct Firestore writes for the invoice itself.

**Confirmed working, by direct Firestore read-back, not just a UI toast:**
- `Invoice` → `Create Invoice from Estimate` produced a correct invoice doc:
  right customer, right line item, right subtotal/tax/total math for the
  0%-tax estimate.
- `Send to Customer` → `Send via Email` flipped `invoices/{id}.status` from
  `draft` to `sent` with a real `sentAt` timestamp — verified in Firestore,
  not inferred from the toast.
- The missing local Stripe key produced exactly the predicted, correct,
  **fail-soft** behavior: "Invoice created, but the online payment link
  could not be generated — you can still send it and use Mark Paid,"
  and the send flow proceeded anyway. Nothing crashed.

**Unplanned finding, more important than the above**: the email actually
went out through Jo's real, live Resend account, using real production
credentials — not a local stub. `functions/.env.local` stubs the Stripe
secrets explicitly (`STRIPE_SECRET_KEY=__unset__`, literal deploy-stub
text), but carries **no line at all** for `RESEND_API_KEY`/`EMAIL_FROM`. The
functions emulator's own startup banner says why: *"Application Default
Credentials detected. Non-emulated services will access production using
these credentials. Be careful!"* — Secret Manager is one of those
non-emulated services, so `defineSecret('RESEND_API_KEY').value()` fell
through to the REAL secret. Confirmed three ways: `email_log` (the write
path in `functions/email-functions.js:279-298`, a different collection than
`email_queue`) recorded `status:"sent"` — which `sendEmail`
(`functions/email-functions.js:388-410`) only writes after `resend.emails
.send()` returns without throwing; the request took 667ms (a real HTTPS
round trip, not an instant local stub); and the client-side success toast
matched. The recipient was `dummy-customer@example.test` — an IETF-reserved
non-routable test domain (RFC 2606) — so no real inbox received anything,
but this was still a genuine outbound call against Jo's live Resend API
key and account, made from inside a "safe local test," not something asked
for or noticed until checked after the fact.

**Consequence for anyone running `firebase emulators:start` locally on a
machine with `gcloud auth application-default login` configured**: any
secret NOT explicitly stubbed in `functions/.env.local` silently resolves
to its REAL production value, and any function that calls a real
third-party API with that secret (email, SMS, any other paid provider) will
genuinely fire in production, indistinguishable from a live send except by
checking the response timing / logging collection by hand. Stripe was safe
here only because its local `.env.local` entries are literal `__unset__`
text (which Stripe's own API then rejects with a real 401 — no charge, no
object created), not because the emulator is actually isolated from
production secrets in general. **SMS (`sendSMS`/Twilio) was not tested
after this was discovered** — same risk class, deliberately not attempted
without checking whether `TWILIO_*` secrets are locally stubbed first.

## UPDATE 2026-09-08, round 2 — root cause corrected, both bugs fixed

The round-1 update above named the wrong file, and left the actual bug live.
Corrected here, plus two real fixes landed and verified.

**§Where my own reasoning was wrong.** Round 1 blamed `functions/.env.local`
for not stubbing `RESEND_API_KEY`, added ~40 stub lines there, restarted the
emulator, and re-sent — the email still reported "sent." I initially assumed
the fix just hadn't taken effect. It hadn't, but not for a reload reason:
**`.env.local` is not the file the Functions emulator reads `defineSecret()`
values from at all.** It resolves those from a completely different file —
`functions/.secret.local` — per firebase-tools'
`emulator/functionsEmulatorShared.js` (`LOCAL_SECRETS_FILE = '.secret.local'`,
confirmed by reading that source directly). `.secret.local` didn't exist on
this machine, so EVERY `defineSecret()`-declared value — not just Resend —
was falling through to real Secret Manager via ADC the entire time,
regardless of anything written to `.env.local`. `.env.local` only feeds
plain `process.env.*` reads; its own header comment claimed otherwise before
this session, which is exactly what misled the round-1 fix. `.gitignore`
already had a comment saying "`ci.yml` generates `functions/.secret.local`…
and the local QA runbook has you do the same by hand" — that runbook does
not appear to exist anywhere in `documentation/`, so nothing pointed a human
at the file that actually matters. Confirmed with a debug probe logging the
resolved key's length/prefix: `len:38, prefix:"re_d", isStub:false` — a real
Resend key, live, mid-session, via a raw HTTP call to the local function
bypassing the browser entirely (the Auth emulator's own
`accounts:signInWithPassword` REST endpoint mints a real usable ID token,
which sidesteps a browser flakiness episode encountered mid-session).

**Fix 1 — the real secret-isolation fix**: generated
`functions/.secret.local` the same way `ci.yml` does
(`grep -rhoE "defineSecret\('[A-Z_]+'\)" functions | sort -u`, `__unset__`
per name — 50 secrets), restored the two real BoldSign local-test values
into it (they'd been sitting inert in `.env.local` the whole time — meaning
any past local e-sign testing was ALSO silently running against real
production BoldSign credentials via the same ADC fallback, not the value
anyone thought they'd configured), and rewrote `.env.local`'s header to
stop claiming it feeds secrets. Verified: the same debug probe now reads
`isStub:true` against a fresh emulator process.

**Fix 2 — a real, separate, previously-undiscovered bug**, found only
because fixing the secret leak let the failure path actually execute:
`resend.emails.send()` (SDK v6.24.0) does not throw on an API-level
rejection — it resolves to `{data: null, error: {...}}` — and
`functions/email-functions.js`'s `sendEmail` (the customer-facing
invoice-send path) never checked `.error`. Any Resend-side failure (bad key,
suspended account, rejected domain, rate limit) was logged to `email_log`
and returned to the CRM as a **genuine success**, indistinguishable from a
real delivery anywhere in the product. Fixed at
`functions/email-functions.js:388-421` — a Resend `error` now logs, writes
`email_log` status `'failed'`, and returns a real `502` the client's
existing (already-correct) failure path handles. Verified end to end
against a live emulator: response body
`{"error":"Failed to send email","detail":"API key is invalid"}` at
`502`, and `email_log` now reads `status:"failed"` for the same send that
previously read `"sent"`.

**Same `resend.emails.send()` shape, unchecked, exists at ~17 more call
sites** across `functions/` (`lead-alert.js` ×2, `storm-report-email.js`,
`handlers/invites.js`, `estimate-email.js`, `funnel-recovery.js`,
`dormant-leads.js`, `anniversary-touch.js`, `weekly-digest.js`,
`review-request-nudge.js`, `lead-digest.js`, `lead-followup.js`,
`marketing-report.js`, `report-sharing.js`, `remote-signing.js`,
`verify-functions.js`, `storm-watch.js`,
`integrations/email-queue-worker.js`). **Not fixed here** — each needs its
own read of what "failure" should mean in that context (some are
best-effort digests where a silent drop is arguably fine; the invoice path
is not) and a test proving the fix can fail first, which is bigger than
this session's scope. Flagged as a follow-up task.

**Separately, corrects an unrelated misattribution in the base note above**:
the "online payment link could not be generated" failure documented there
was NOT the local `__unset__` Stripe key doing its job — `console` showed
the real cause: `docs/pro/js/invoice-pipeline.js`'s `CLOUD_FUNCTION_BASE`
(`invoice-pipeline.js:11`) is hardcoded to the production
`cloudfunctions.net` URL unconditionally, with none of the
`location.hostname`-based emulator detection `docs/pro/js/nbd-comms.js`
uses for `sendEmail`/`sendSMS` (`nbd-comms.js:32-36`). The browser's own
CORS preflight blocked the cross-origin call to production before it ever
reached a handler, so the local Stripe secret was never actually exercised
by this test — and, reassuringly, nothing was minted in real production
Stripe either (CORS blocks pre-flight before any request body is sent).
This is a real inconsistency between two files serving the same page
that both call Cloud Functions, worth a matching fix, not done here.

## Recommendation

Don't build a Stripe integration — it exists. Don't route around it to
Stripe's own invoicing UI or to drafting invoices outside the CRM either —
that throws away deposit/balance-due tracking tied to the estimate pipeline,
the CRM lead-activity timeline, and dispute-aware settlement logic that a
hand-rolled Stripe Invoice wouldn't have. The right next step is a single
real invoice run (create → send → pay → confirm it flips to paid in the CRM
and the money lands in Stripe) to close the gap above — on the order of
15-30 minutes, not a build project.

# Stripe Connect Express — owner setup + phase-3 go-live

Connect lets each contractor collect card payments into **their own** Stripe
account instead of ours. Where the code stands:

- **Phase 1 (shipped, #1143/#1144):** account creation + Express onboarding +
  the `stripeConnectWebhook` state mirror (`connectAccounts/{companyId}`,
  admin-SDK-only so a `company_admin` cannot forge `chargesEnabled`).
- **Phase 2 (shipped):** the Settings → Billing card (owner **or**
  company_admin) showing capability truth from `getConnectStatus`.
- **Phase 3 (this PR):** the payment-link gate is **lifted in code**. A tenant
  mint routes as a **destination charge** to the tenant's connected account
  (`on_behalf_of` + `transfer_data` + `application_fee_amount` in
  `functions/stripe.js`) once `mayCollectOnline()` passes **and** the tenant
  holds a live subscription. Everyone else still gets the same 403
  `ONLINE_PAYMENTS_UNAVAILABLE` refusal and records check/cash via **Mark
  Paid**.

**The MINT is dark until the steps in this document are done.** No tenant
can pass `mayCollectOnline()` before Connect is enabled in the dashboard and a
tenant completes onboarding — there is no feature flag; this document IS the
switch. **Nothing in this document can be done by code.** Enabling Connect,
accepting the agreement, completing the platform profile, registering the
webhooks and setting the secret are account-owner actions.

### "Dark" covers the mint only — two things are already live

Read "ships dark" as a statement about *routed charges*, not about the whole
PR. Two phase-3 changes are in production on main right now:

1. **The Settings → Billing payouts card is already visible to
   `company_admin`s, not just owners.** Phase 3 widened `_nbdConnectVisible()`
   (`docs/pro/js/dashboard-connect-tab.js`) from an owner-only test to
   `owner === true || role === 'company_admin'`, mirroring the server surface
   `requireTeamAdmin` already exposes. Every company_admin on every tenant can
   see the card and press **Set up payouts** today. `requireTeamAdmin` still
   verifies ownership of `companies/{companyId}`, so a company_admin who is not
   that company's `ownerId` gets a clean refusal instead of an account — but
   the *surface* is live, not dark, and they can ask about it.
2. **The new `invoiceWebhook` branches act on the PLATFORM tenant's own
   payments the moment the events are registered (§5a).** They are not
   tenant-scoped and they do not check for a connected account first. Our own
   invoice links produce platform charges with no transfer, so
   `charge.dispute.created` finds nothing to reverse and logs
   `dispute_no_transfer_to_reverse` — but the chargeback alert, the refund
   alert and the decline alert all fire for real, on our own money, from that
   moment on. That is intended. Just do not read the first such alert as
   evidence that a *tenant* charge went through.

> **Do all of this in TEST MODE first, verify, then repeat in LIVE MODE.**
> Connect settings, branding, the platform profile and webhook endpoints are all
> per-mode and do **not** copy across.

---

## Liability — the truth

*(This section rewrites the earlier "answer the platform-profile liability
question so the connected account bears chargebacks" guidance. That premise
was wrong for the integration we shipped — rewritten, not deleted.)*

Under **destination charges with `on_behalf_of`** (what phase 3 ships),
chargeback and negative-balance liability sits on the **PLATFORM** regardless
of how the platform-profile liability question is answered. A homeowner
chargeback debits **our** balance (plus Stripe's dispute fee), on our dispute
rate, for work we did not perform.

**Shipped mitigation:** on `charge.dispute.created`, `invoiceWebhook`
automatically reverses the transfer attached to the disputed charge — the
disputed amount, clamped to what remains reversible on the transfer — so the
contractor, not the platform, bears the loss. It then alerts the owner
(email via `email_queue` + Slack) and stamps a lead activity row. The reversal
is idempotency-keyed on the dispute id, so webhook retries cannot double-pull.

**The reversal is recovery, not resolution.** Two manual halves finish the
job and both are the platform owner's: the dispute lives on **our** account,
so only we can file the evidence (**§6a** — the contractor cannot, an Express
dashboard does not even show them the dispute), and if we win, the money comes
back to **our** balance and has to reach the contractor we already debited
(**§6b**). The mitigation above is also only as live as §5a: an unregistered
event or an unset signing secret disables it silently.

A **true** liability shift requires Standard accounts / direct charges — out of
scope. Direct charges would also move `payment_intent.succeeded` off
`invoiceWebhook` and orphan the CRM ledger (no invoice credit, no payments[]
row), so this is not a knob to flip casually. Phase 4 territory.

---

## The platform fee

**3.4% + 30¢ per online card payment** = Stripe's 2.9% + 30¢ card-processing
pass-through + a 0.5% platform margin.

- Computed by `platformFeeCents()` in `functions/stripe-connect-logic.js`
  (`PLATFORM_FEE_BPS = 340`, `PLATFORM_FEE_FLAT_CENTS = 30`).
- Applied on **tenant Connect mints ONLY** — the platform tenant's own mints
  carry no fee. Check/cash recorded via Mark Paid is always free.
- Clamped strictly below the charge (the mint already refuses balances under
  $1.00, so the worst real fee is 33¢ on a $1.00 charge).
- The fee **nets out of the tenant's settlement, not the charge** — the
  PaymentIntent's `amount_received` stays the full homeowner payment, so the
  CRM ledger credits the gross amount and the payments[] contract is unchanged.
- Disclosure surfaces (keep in sync if the fee ever changes): the pricing-page
  FAQ, the index/landing pricing-footer, terms §3 ("Online Payment
  Processing"), and the Settings → Billing Connect card.

## Statement descriptor

**No statement descriptor is passed in code — deliberately.** With the tenant
as settlement merchant (`on_behalf_of`), the homeowner's card statement shows
the **CONNECTED account's** business-profile descriptor, collected during
Express onboarding. That is exactly what the homeowner should see ("Joe's
Roofing", not "NBD PRO"). Do **not** add one: it would mislabel the charge and
invites 22-char/prefix validation failures.

---

## 1. Enable Connect (once per mode)

1. dashboard.stripe.com → **Connect** → **Get started**.
2. Choose the **platform / marketplace** option — *not* "I'm a connected account".
3. Accept the **Connect platform agreement** when prompted. Only the account
   owner can accept this.

## 2. Complete the Connect platform profile

Connect → **Settings** → *Platform profile*. `accounts.create` is **refused**
until this is submitted, so `createConnectAccount` will error until it is done.

It asks what the business does, who the connected accounts are (US roofing
contractors), and estimated volume. Answer the liability question honestly —
but read **"Liability — the truth"** above: with destination charges the
platform carries the liability either way; the dispute auto-reversal is the
real mitigation.

## 3. Enable Express + branding

- Connect → Settings: make **Express** an available account type.
- Connect → Settings → **Branding**: business name, icon, logo, brand colour,
  accent colour. This is what the *contractor* sees on `connect.stripe.com`, and
  it is **separate** from the Checkout/portal branding already set for
  subscriptions. Left default, they see an unbranded Stripe page mid-onboarding.

## 4. Payouts

Connect → Settings → **Payouts**: default schedule (daily/weekly/monthly),
delay days, and whether connected accounts may change their own schedule.
Decide once — contractors will ask. (Statement descriptor: see the section
above — nothing to configure beyond what Express onboarding collects.)

## 5. Register webhooks — TWO endpoints

> **RESOLVED 2026-07-29 — this was a blocker, it is now a cleanup item.**
> This callout used to read: *"BEFORE registering anything: the live Stripe
> account carries an unmanaged Cloudflare-Worker webhook on
> `checkout.session.completed` that is not in this repo. Reconcile what it is
> (and whether it should survive) with Jo before adding endpoints."*
> Rewritten rather than deleted, because the finding was real and the audit
> trail matters.
>
> What it actually was: endpoint `we_1TEfvl3O36Xz6RgKFVVEoSLf` →
> `https://nbd-stripe-webhook.jonathandeal459.workers.dev`, **live mode**,
> subscribed to `checkout.session.completed` only, created long before this
> repo owned billing. How it resolved: the endpoint is now **status
> `disabled`** in live Stripe (re-confirmed against the live account
> 2026-07-30), so it receives no deliveries and is no longer a hidden consumer
> of this account's events. **Registering endpoints is unblocked.**
>
> **Residual — owner's, and not blocking:** the Cloudflare Worker itself still
> exists and is still deployed. Disabling the Stripe endpoint stopped the
> deliveries, not the Worker. Jo to delete the Worker when convenient. If
> anyone ever flips that endpoint back to `enabled`, it becomes an unmanaged
> consumer again and this reverts to a blocker.

### (a) invoiceWebhook — events + secret. THIS GATES §5b.

> **⛔ HARD GATE — finish §5a before §5b, and before any tenant onboards in
> LIVE mode.**
>
> §5a and §5b are **not** peer items on a checklist. **§5b plus one onboarded
> tenant is by itself sufficient to make real homeowner money route to a
> contractor.** §5a is the only thing that makes a chargeback on that money
> recoverable. Done in the wrong order, every charge taken in the gap is a
> charge whose dispute silently debits the platform and stays debited:
> `charge.dispute.created` never reaches us, no transfer is reversed, no alert
> fires, and nothing anywhere records that anything was missed.
>
> **The gap is unrecoverable, not merely late.** Stripe's **Resend** only
> replays deliveries the endpoint was already subscribed to; it does not
> backfill an event type that was not registered when the event occurred. A
> dispute opened during the gap is money gone. So: do not enable §5b, and do
> not let a tenant finish onboarding in live mode, until §5a's events **and**
> §5a's signing secret are both verified in that mode.

The existing platform endpoint
(`https://us-central1-nobigdeal-pro.cloudfunctions.net/invoiceWebhook`) must
be subscribed to **all five** of the events below. Live-account state as of
2026-07-30: endpoint `we_1TtvCO3O36Xz6RgKPlRllw11` carries
`payment_intent.succeeded` **and nothing else** — the other four are still to
be added, in both modes.

- **`payment_intent.succeeded` — the only event that credits the CRM ledger.**
  It is what moves invoice `amountPaid`, appends the `payments[]` row and
  auto-advances the lead to `final_payment`. It is listed here *because it is
  already registered on the LIVE endpoint*, which is exactly what makes it
  easy to lose: in TEST mode you create a **brand-new** endpoint, and an
  endpoint built from a list titled "the three phase-3 events" silently omits
  it. That produces the worst-shaped failure in this document — the dispute,
  refund and decline alerts all fire correctly, so the endpoint looks healthy,
  while **no payment ever posts to any invoice** and nothing errors anywhere.
  Put it on **every** endpoint you create, in **every** mode.
- `charge.dispute.created` — opens the dispute. Triggers the automatic transfer
  reversal **only when funds were actually withdrawn**. Card networks open some
  disputes as *inquiries* (`warning_needs_response` / `warning_under_review`)
  that take no money from the platform, so reversing on those would claw back a
  contractor's payout for an event that cost us nothing.
- **`charge.dispute.funds_withdrawn` — the escalation event, and the easiest to
  omit.** An inquiry that later becomes a real chargeback fires THIS, not a
  second `created`. Leave it off and the recovery never runs for any dispute
  that started life as an inquiry: the money is taken from the platform, the
  contractor keeps their payout, and **nothing alerts** — the same silent shape
  as a missing `payment_intent.succeeded`. Register it everywhere you register
  `charge.dispute.created`.
- `charge.dispute.closed` — the dispute's final outcome (won / lost /
  warning_closed). Required for the **won** path to close its loop; see §6b.
  Without it, a dispute we win leaves the contractor permanently short by the
  amount the auto-reversal pulled back, with nothing to flag it.
- `charge.refunded` — visibility only: alerts the owner; the CRM invoice
  ledger is **not** changed (adjust records manually if needed).
- `payment_intent.payment_failed` — visibility only: alerts the owner when a
  homeowner's card declines on one of OUR invoice links (subscription-billing
  failures are ignored here — they belong to `stripeWebhook`'s dunning wing).

Register them in **TEST mode AND LIVE mode separately** (dashboard settings do
not copy across).

#### Set the invoice endpoint's signing secret — REQUIRED, not "unchanged"

*(This rewrites the earlier line "The signing secret is **unchanged**
(`STRIPE_INVOICE_WEBHOOK_SECRET`, with the legacy fallback intact)". That was
wrong in a silent direction — the fallback is not a working configuration, it
is a rotation crutch. Rewritten, not deleted, 2026-07-30.)*

`STRIPE_INVOICE_WEBHOOK_SECRET` is **still the pending-rotation placeholder**.
Read `invoiceWebhook`'s verification block in `functions/stripe.js`: it builds
a candidate list, pushes the dedicated secret **only if the stored value
literally begins with `whsec_`**, then pushes the legacy
`STRIPE_WEBHOOK_SECRET`, and tries each in turn. A placeholder therefore never
fails loudly — it just **silently drops out of the list**, leaving exactly one
candidate: `stripeWebhook`'s *subscription-endpoint* secret.

**In TEST mode that is fatal.** A newly created test endpoint has its own
`whsec_`, which is neither the placeholder nor the subscription secret. Every
candidate throws, and the handler returns **400 `Invalid signature`**. The only
trace is one `logger.error('invoiceWebhook signature verification failed')`
line: the owner-alert path (email + Slack) runs *after* verification, so
**nothing alerts, ever**.

Consequences of skipping this step, in order of expense:

- Test payments never post to invoices (`payment_intent.succeeded` is rejected
  before it is ever dispatched) — from the outside, indistinguishable from
  forgetting to register the event at all.
- **The phase-3 dispute auto-reversal is silently disabled.**
  `charge.dispute.created` is rejected at the door, so the transfer is never
  reversed and the contractor keeps the money — **the platform eats the
  chargeback plus Stripe's dispute fee.** This is the whole mitigation named
  in "Liability — the truth", switched off by an unset secret.
- Stripe eventually **auto-disables** the endpoint on sustained failures. That
  email is the loudest signal you get, and it arrives long after the fact.

Reveal the endpoint's secret in the dashboard (**Developers → Webhooks → the
`invoiceWebhook` endpoint → Reveal**), then, **once per mode**:

```bash
# what is stored now (expect the placeholder, NOT a whsec_)
firebase functions:secrets:access STRIPE_INVOICE_WEBHOOK_SECRET --project nobigdeal-pro
# paste the endpoint's whsec_ at the prompt
firebase functions:secrets:set STRIPE_INVOICE_WEBHOOK_SECRET --project nobigdeal-pro
```

Then **redeploy the functions that bind the secret** — a new secret version is
picked up at deploy, not at write; the CLI names the affected functions when
you set it. Setting the secret without redeploying leaves the old value live
and every symptom above intact.

**Verify — do not assume:**

1. `firebase functions:secrets:access STRIPE_INVOICE_WEBHOOK_SECRET --project
   nobigdeal-pro` returns a `whsec_…`.
2. Dashboard → that endpoint → **Send test webhook** → `payment_intent.succeeded`.
   Expect **HTTP 200** in the endpoint's delivery log. A **400 `Invalid
   signature`** means the wrong mode's secret, or the redeploy has not landed.
   This proves the *signature* only: the synthetic payload carries no NBD
   metadata, so the credit branch is skipped and no invoice moves. A 200 with
   nothing changed is the correct result here.
3. Then take one real (test-card) payment on a real invoice link and confirm
   `amountPaid` moved. That — and only that — proves the secret **and** the
   event registration together.

### (b) stripeConnectWebhook — replace the placeholder secret

**Do not start this until §5a is verified in this mode** — see the hard gate
above. This step is what lets onboarding complete and capability go true, i.e.
it is the step that lets money move.

Developers → **Webhooks** → **Add endpoint** (per mode):

- **Endpoint URL:** `https://us-central1-nobigdeal-pro.cloudfunctions.net/stripeConnectWebhook`
- **Listen to:** events on **Connected accounts**
- **Events:** `account.updated`, `account.application.deauthorized`
- Save, then **Reveal** the signing secret (`whsec_...`).

Then set the secret — **the current stored value is a `__unset__`
placeholder**; every delivery 500s fail-closed until a real `whsec_` is set.
Verify first, then set:

```bash
firebase functions:secrets:access STRIPE_CONNECT_WEBHOOK_SECRET --project nobigdeal-pro
firebase functions:secrets:set STRIPE_CONNECT_WEBHOOK_SECRET --project nobigdeal-pro
```

After setting it: check Stripe has not **auto-disabled** the endpoint from the
accumulated 500s, and use **Resend** on any missed `account.updated` deliveries
so `connectAccounts/{companyId}` catches up.

> Do **not** reuse `STRIPE_WEBHOOK_SECRET` (the subscription endpoint's
> secret), and do not add "events on Connected accounts" to `stripeWebhook`.
> Each endpoint verifies its own signing secret; Connect account events belong
> only on the Connect endpoint, and the §5a payment events belong only on
> `invoiceWebhook`. Three endpoints, three distinct `whsec_` values, three
> distinct secrets — `STRIPE_WEBHOOK_SECRET`, `STRIPE_INVOICE_WEBHOOK_SECRET`,
> `STRIPE_CONNECT_WEBHOOK_SECRET` — in **each** mode.

## 6. Disputes, refunds + stale links — ops rules until phase 4

### (a) Dispute EVIDENCE is the platform owner's job, not the contractor's

**The contractor cannot fight their own chargeback. You have to.** Under
destination charges the dispute is raised against the **platform account**, so
it appears in *our* Stripe dashboard and *we* hold the only Submit button. An
Express dashboard does **not** show disputes — the contractor can log in, see
the money vanish from their balance (the auto-reversal), and find no dispute,
no deadline and no way to respond. If nobody drives this, the dispute is lost
by default when the clock runs out.

The evidence, meanwhile, is entirely on the contractor's side: signed
contract, signed completion certificate, before/after photos, change orders,
texts and call logs with the homeowner, delivery/permit records.

**Workflow, every time:**

1. `charge.dispute.created` fires the alert (email via `email_queue` + Slack).
   It carries the invoice, the amount, the reason and — when Stripe supplies
   `evidence_details.due_by` — the **evidence deadline**.
2. **Owner contacts the contractor the same day** with the reason code and an
   internal deadline **at least 48h before** Stripe's `due_by`. Uploading
   takes time and the deadline is hard.
3. Contractor sends the documents to the owner (email/portal — there is no
   in-CRM upload for this; phase 4 territory).
4. **Owner files the evidence in the Stripe dashboard** on the platform
   account, before `due_by`. Submitting is one-shot in practice — assemble
   everything first, then submit.
5. Record the outcome on the lead so the next person can see it.

> **The lever that gets documents out of a contractor:** the auto-reversal has
> *already* taken the disputed amount back from them. They are out the money
> from day one whatever happens. Winning is the **only** way they get it back
> (§6b). Say that plainly in step 2 — otherwise evidence arrives late or never.

### (b) When a dispute is WON

A win reinstates the disputed amount to the **PLATFORM** balance — that is
where it was debited from, and that is where it returns. (Stripe also returns
the dispute fee on a win under its current fee policy; verify it in the
balance entries rather than assuming.) Stripe signals the outcome with
`charge.dispute.closed` carrying `status: 'won'` — which is why that event is
on the §5a list.

**That reinstatement is not ours to keep.** The auto-reversal at dispute-open
pulled the money out of the contractor, so after a win the platform is holding
funds that belong to them. Closing the loop means paying it back — the
`charge.dispute.closed` (won) handling repays the contractor the amount that
was reversed, keyed on the dispute id so retries cannot pay twice.

**Never assume it ran.** This is the newest path in the integration and the
only one no go-live step above can exercise — nothing in "Done when" produces
a won dispute. Verify it, every time, with the four checks below.

**Expected observable outcome — verify all four on the first real won dispute:**

1. A **new transfer (`tr_…`) to that connected account** for the amount the
   reversal previously took, dated at the dispute close — not a second
   reversal, and not a new charge.
2. The **contractor's Express dashboard** shows the balance restored and the
   funds included in the next scheduled payout.
3. The **platform balance** nets out across the episode: disputed amount out
   at open → reinstated at close → paid back out to the contractor. Our
   retained position is the original application fee (less the dispute fee if
   Stripe did not return it).
4. The lead/invoice shows the dispute activity trail from open through close.

**If no repayment transfer appears within one business day of the win, treat
it as broken and repay manually** — a transfer to that connected account for
the reversed amount, referencing the dispute id — then work out why the
automatic path did not run. The two usual causes are the mundane ones:
`charge.dispute.closed` was never registered on the endpoint (§5a), or the
endpoint's signing secret is wrong so every delivery 400s (§5a). Silence looks
identical in both cases, which is why this check is a step and not an
assumption.

**When a dispute is LOST**, there is nothing further to do: the auto-reversal
already recovered the amount from the contractor at open. The platform's
residual cost is Stripe's dispute fee, which we absorb.

### (c) Refunds

- **Refunding a Connect charge from the dashboard: tick "Reverse transfer".**
  A plain refund returns the homeowner's money from the **PLATFORM** balance
  while the transfer stays with the contractor. Phase 4 owns the code path;
  until then this checkbox is the rule for every refund on a tenant charge.

### (d) Capability-loss stale links

- If a tenant loses capability (deauthorized / sub lapsed) while an invoice has
  an open payment link, a Mark Paid regen gets refused and the client nulls the
  CRM link fields (all Pay CTAs vanish) — but the `plink_` itself may remain
  payable on Stripe until it errors. The single-use restriction bounds exposure
  to one session; deactivate the link manually in the dashboard if needed.

## 7. Test mode + emulator QA walkthrough

`mayCollectOnline()` requires `livemode: true` unless test mode is explicitly
allowed. The opt-in exists ONLY for the emulator/QA:

- **Server:** `NBD_CONNECT_ALLOW_TEST_MODE=1` in `functions/.env.local`
  (**demo- projects ONLY** — never a prod deploy env). Read per-request via
  `connectTestModeAllowed(process.env)` in `functions/stripe-connect-logic.js`;
  strict string `'1'`.
- **Client:** set `window.__NBD_CONNECT_ALLOW_TEST_MODE = true` manually in the
  browser console — it is never shipped in page code. Spoofing it buys
  nothing; the server re-checks.
- **Seed** (admin-SDK write against the emulator):
  - `connectAccounts/{companyId}` = `{ accountId: 'acct_test000',
    chargesEnabled: true, detailsSubmitted: true, livemode: false,
    status: 'ready' }`
  - `subscriptions/{companyId}` = `{ stripeSubscriptionId: 'sub_test',
    status: 'active' }`

Then: sign in as that tenant, create an invoice, and confirm the mint returns
a link instead of the 403.

Note: `createStripePaymentLink` is a bearer-token `onRequest` endpoint with
**no App Check enforcement** (unchanged phase-3 parity with the platform
tenant's client). QA implication: browser-automation runs against prod die on
App Check throttling elsewhere in the app after ~1h — **use the emulator** for
this walkthrough.

---

## Done when

**These lists are ORDERED. The order is the safety property** — §5a before
§5b, in each mode, because §5b plus an onboarded tenant is what makes money
move and §5a is what makes a chargeback on it recoverable.

**TEST mode:**

1. **§5a is complete for the test endpoint:** all five events registered,
   `STRIPE_INVOICE_WEBHOOK_SECRET` set to that endpoint's `whsec_`, functions
   redeployed, and a **Send test webhook** returning **200** (not 400).
2. Only then §5b: an owner can create an account and complete Stripe
   onboarding; `getConnectStatus` reports `chargesEnabled: true` with
   `livemode: false`.
3. With test mode allowed (§7), a tenant invoice mints a payment link.
4. A test-card payment succeeds; the **application fee shows on the platform
   balance transaction**; `invoiceWebhook` credits the CRM ledger with the
   **full gross amount**.

**LIVE mode:**

1. **PREREQUISITE — §5a complete in live mode, before anything below.** All
   five events on the live `invoiceWebhook` endpoint (as of 2026-07-30 it
   still carries only `payment_intent.succeeded`), and
   `STRIPE_INVOICE_WEBHOOK_SECRET` holding that endpoint's real `whsec_` with
   the functions redeployed. **Nobody onboards in live mode until this is
   verified.** Charges taken before it are charges whose disputes cannot be
   recovered and cannot be backfilled.
2. `STRIPE_CONNECT_WEBHOOK_SECRET` is a real `whsec_` in both modes (§5b).
3. A real tenant is onboarded with `livemode: true`.
4. **ONE real homeowner payment settles into the TENANT's bank** — verify the
   transfer in their Express dashboard. Code-level proof is not settlement
   proof.
5. **Verify the fee actually netted — name the number, do not eyeball
   "money settled".** In the Stripe dashboard open that charge (Payments → the
   payment; the same object is listed under **Connect → Application fees**)
   and read the **Application fee collected on the charge** — an `fee_…`
   application-fee object with its own amount, distinct from Stripe's
   processing fee and from the transfer amount.
   - Expected, exactly: `round(gross_cents × 0.034) + 30`. On a **$5,000.00**
     charge that is **$170.30**; on **$850.00**, **$29.20**.
   - The homeowner's PaymentIntent `amount_received` must still be the **full
     gross**, and the CRM invoice must have been credited that same gross —
     the fee nets out of the tenant's settlement, never the ledger.
   - **A missing Application fee row, or $0.00, is a failure, not a rounding
     detail:** it means the charge did not route as a tenant Connect charge —
     it settled on the platform. The homeowner still paid, so nothing looks
     broken from the outside, but the contractor was not paid the way you
     think and the dispute auto-reversal has no transfer to reverse.
6. The dispute flow (§6a) has an owner: whoever will actually collect evidence
   from a contractor and file it in the dashboard knows it is their job and
   knows the deadline is hard.
7. The refund rule (§6c) has been dry-reviewed: everyone who can press Refund
   knows about "Reverse transfer".

**First won dispute (whenever it happens):** run the four checks in §6b. The
repayment-to-contractor path will not have been exercised by anything above.

---

The gate is lifted in code. What remains manual is this document.

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

**The feature is dark until the steps in this document are done.** No tenant
can pass `mayCollectOnline()` before Connect is enabled in the dashboard and a
tenant completes onboarding — there is no feature flag; this document IS the
switch. **Nothing in this document can be done by code.** Enabling Connect,
accepting the agreement, completing the platform profile, registering the
webhooks and setting the secret are account-owner actions.

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

> **BEFORE registering anything:** the live Stripe account carries an
> **unmanaged Cloudflare-Worker webhook on `checkout.session.completed`** that
> is not in this repo. Reconcile what it is (and whether it should survive)
> with Jo before adding endpoints, so we know every consumer of the account's
> events.

### (a) invoiceWebhook — ADD the three phase-3 events

The existing platform endpoint
(`https://us-central1-nobigdeal-pro.cloudfunctions.net/invoiceWebhook`)
gains three event types in its dashboard registration:

- `charge.dispute.created` — triggers the automatic transfer reversal + alert.
- `charge.refunded` — visibility only: alerts the owner; the CRM invoice
  ledger is **not** changed (adjust records manually if needed).
- `payment_intent.payment_failed` — visibility only: alerts the owner when a
  homeowner's card declines on one of OUR invoice links (subscription-billing
  failures are ignored here — they belong to `stripeWebhook`'s dunning wing).

Register them in **TEST mode AND LIVE mode separately** (dashboard settings do
not copy across). The signing secret is **unchanged**
(`STRIPE_INVOICE_WEBHOOK_SECRET`, with the legacy fallback intact). Until the
events are registered, the new branches are dead code — safe in either order
relative to the deploy.

### (b) stripeConnectWebhook — replace the placeholder secret

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
> only on the Connect endpoint, and the three new payment events belong only
> on `invoiceWebhook`.

## 6. Refunds + stale links — ops rules until phase 4

- **Refunding a Connect charge from the dashboard: tick "Reverse transfer".**
  A plain refund returns the homeowner's money from the **PLATFORM** balance
  while the transfer stays with the contractor. Phase 4 owns the code path;
  until then this checkbox is the rule for every refund on a tenant charge.
- **Capability-loss stale links:** if a tenant loses capability (deauthorized /
  sub lapsed) while an invoice has an open payment link, a Mark Paid regen gets
  refused and the client nulls the CRM link fields (all Pay CTAs vanish) — but
  the `plink_` itself may remain payable on Stripe until it errors. The
  single-use restriction bounds exposure to one session; deactivate the link
  manually in the dashboard if needed.

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

**TEST mode:**

- An owner can create an account and complete Stripe onboarding;
  `getConnectStatus` reports `chargesEnabled: true` with `livemode: false`.
- With test mode allowed (§7), a tenant invoice mints a payment link.
- A test-card payment succeeds; the **application fee shows on the platform
  balance transaction**; `invoiceWebhook` credits the CRM ledger with the
  **full gross amount**.

**LIVE mode:**

- A real tenant is onboarded with `livemode: true`.
- **ONE real homeowner payment settles into the TENANT's bank** — verify the
  transfer in their Express dashboard AND the fee on the platform balance.
  Code-level proof is not settlement proof.
- The three new events (§5a) are registered in **both** modes, and
  `STRIPE_CONNECT_WEBHOOK_SECRET` is a real `whsec_` in both modes.
- The dispute/refund flow (§6) has been dry-reviewed: everyone who can press
  Refund knows about "Reverse transfer".

---

The gate is lifted in code. What remains manual is this document.

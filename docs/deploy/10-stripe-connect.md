# Stripe Connect Express — owner setup

Connect lets each contractor collect card payments into **their own** Stripe
account instead of ours. Until it is live, online collection is restricted to the
platform tenant (see `functions/stripe.js`, PR #1123) and contractors record
check/cash/their-own-terminal payments via **Mark Paid**.

**Nothing in this document can be done by code.** Enabling Connect, accepting the
agreement, and completing the platform profile are account-owner actions.

> **Do all of this in TEST MODE first, verify, then repeat in LIVE MODE.**
> Connect settings, branding, the platform profile and webhook endpoints are all
> per-mode and do **not** copy across.

---

## What is already shipped (phase 1)

Code exists to create and onboard connected accounts:

| Function | What it does |
|---|---|
| `createConnectAccount` | creates the tenant's Express account (owner/company_admin only, idempotent) |
| `createConnectOnboardingLink` | mints a single-use Stripe-hosted onboarding URL |
| `getConnectStatus` | re-reads Stripe and returns the current capability state |
| `createConnectDashboardLink` | opens the contractor's Express dashboard |
| `stripeConnectWebhook` | persists `account.updated` / deauthorization |

Phase 1 **moves no money**: there is no `application_fee`, no `on_behalf_of`, no
payment-link change. State lands in `connectAccounts/{companyId}`, which is
admin-SDK-only (a `company_admin` must not be able to forge `chargesEnabled`).

Still to come: the Settings → Billing UI (phase 2) and lifting the payment-link
gate (phase 3, only after you have walked a real account through onboarding).

---

## 1. Enable Connect (once per mode)

1. dashboard.stripe.com → **Connect** → **Get started**.
2. Choose the **platform / marketplace** option — *not* "I'm a connected account".
3. Accept the **Connect platform agreement** when prompted. Only the account
   owner can accept this.

## 2. Complete the Connect platform profile

Connect → **Settings** → *Platform profile*. `accounts.create` is **refused**
until this is submitted, so phase 1 will error until it is done.

It asks what the business does, who the connected accounts are (US roofing
contractors), and estimated volume.

> **The liability question matters most.** Answer it so the **connected account**
> bears chargeback and negative-balance liability, **not the platform**. If the
> platform takes liability, the main reason for doing this — chargebacks landing
> on our dispute rate for work we did not perform — survives Connect.

## 3. Enable Express + branding

- Connect → Settings: make **Express** an available account type.
- Connect → Settings → **Branding**: business name, icon, logo, brand colour,
  accent colour. This is what the *contractor* sees on `connect.stripe.com`, and
  it is **separate** from the Checkout/portal branding already set for
  subscriptions. Left default, they see an unbranded Stripe page mid-onboarding.

## 4. Payouts + statement descriptor

- Connect → Settings → **Payouts**: default schedule (daily/weekly/monthly),
  delay days, and whether connected accounts may change their own schedule.
  Decide once — contractors will ask.
- Decide whose **statement descriptor** and support contact the homeowner sees.
  Express accounts normally carry their own.

## 5. Register the Connect webhook

Developers → **Webhooks** → **Add endpoint**:

- **Endpoint URL:** `https://us-central1-nobigdeal-pro.cloudfunctions.net/stripeConnectWebhook`
- **Listen to:** events on **Connected accounts**
- **Events:** `account.updated`, `account.application.deauthorized`
- Save, then **Reveal** the signing secret (`whsec_...`).

> Do **not** add "events on Connected accounts" to the existing `stripeWebhook`
> endpoint. That endpoint verifies a different signing secret and handles
> subscription events; Connect events belong only on the new endpoint.

## 6. Set the new secret

```bash
firebase functions:secrets:set STRIPE_CONNECT_WEBHOOK_SECRET --project nobigdeal-pro
```

Verify:

```bash
firebase functions:secrets:access STRIPE_CONNECT_WEBHOOK_SECRET --project nobigdeal-pro
```

The webhook **fails closed** if this is unset — it returns 500 rather than
skipping signature verification.

---

## Done when

In **test mode**, an owner can create an account, complete Stripe onboarding, and
`getConnectStatus` reports `chargesEnabled: true` with `livemode: false`.

A test-mode account can never satisfy the live payment gate: `livemode` is stored
per account and the gate predicate (`mayCollectOnline` in
`functions/stripe-connect-logic.js`) requires it to be `true`.

**Do not lift the payment-link gate yourself.** That is phase 3, and it is the
change that actually redirects money — it needs the gate test rewritten
deliberately, plus a live-mode settlement check against the Stripe dashboard
(code-level proof is not proof of settlement).

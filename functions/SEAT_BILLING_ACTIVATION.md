# Activating self-serve paid seats

**Status:** code-complete, **dark** until one Stripe price + one secret exist. No engineering work remains — this is a Stripe/config task.

## How it already works

- **Server:** `functions/handlers/seats.js` → `setCompanySeatCount` callable. Adds/removes a per-seat line item (`STRIPE_PRICE_SEAT` × qty) on the company's existing plan subscription, with proration (`always_invoice`), `payment_behavior: error_if_incomplete`, an occupied-seat guard (can't reduce below active members), and reduction rollback. Wired at `functions/index.js`.
- **Client:** `docs/pro/js/dashboard-team-tab.js` → `_renderSeatBuy` / `_applySeatBuy` already render the seat stepper and call `setCompanySeatCount`. It **self-hides** when seat buying isn't available, which is why nothing shows today.
- **Gate:** `seats.js:137-138` reads `STRIPE_PRICE_SEAT.value()` and no-ops unless it `startsWith('price_')`. A placeholder value is a valid, deployable "off" state; a real `price_…` turns the feature on.
- **Deploy guard:** the `secrets: [... STRIPE_PRICE_SEAT ...]` binding means a Firebase functions deploy **fails** until the secret exists in Secret Manager — so you must create the secret (even as a placeholder) before the next functions deploy.

## Steps (you)

1. **Create a recurring per-seat Price in Stripe** — in **test mode** first, then **live**.
   - Product: e.g. "Additional Seat"; Price: recurring, monthly (match your plan interval), your per-seat amount. Copy the `price_…` id from each mode.
2. **Set the secret** (from `functions/`):
   ```bash
   firebase functions:secrets:set STRIPE_PRICE_SEAT
   ```
   Paste the **live** `price_…` when prompted. (For a test-mode dry run, set it to the test `price_…` against a test project/env first.)
3. **Redeploy the seat function** so it picks up the secret:
   ```bash
   firebase deploy --only functions:setCompanySeatCount
   ```
   > Per the deploy notes: keep this a single, targeted deploy (don't chain it behind other function deploys), and never drop function memory below 256 MiB.
4. **Validate in test mode** (closes the open "$0 seat-buy validation" item):
   - Open **Team** as an owner → the seat stepper should now render.
   - Buy 1 seat → confirm the Stripe subscription gains a seat line item, proration invoices correctly, and `subscriptions/{companyId}.purchasedSeats` increments.
   - Reduce back down → confirm the occupied-seat guard blocks reducing below active members, and a valid reduction removes the line item.

## Notes

- `unmatched_sms` / seat data is per-**company**; seat enforcement already reads `purchasedSeats` + `PLAN_LIMITS` (see `functions/billing.js`) — no consumer changes needed.
- Plan-tier **feature gating** (locking premium features behind tiers) is intentionally **not** part of this — it would reverse the current single-tier decision (`maps.js: _nbdUnlocked = () => true`) and is a product call, not a config step.

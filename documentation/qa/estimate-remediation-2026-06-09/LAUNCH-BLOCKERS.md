# Pre-launch blockers — billing/pricing (scoping for Jo)

Surfaced 2026-06-09. These gate the public self-serve launch and **PR #579**
("NBD Pro: Terms page + honest marketing/pricing rewrite", branch
`feat/pro-terms-page`, still OPEN). #579 publishes pricing the billing system
can't yet honor, so it can't merge until 1 + 2 are resolved.

Canonical pricing the marketing page asserts today:
**Free $0 · Solo $99 · Crew $299 (+$39/seat) · Scale custom · 14-day trial, no card.**

---

## Blocker 1 — Crew price mismatch ($299 listed vs $249 in Stripe)
**Fact:** the pricing page says **Crew $299/mo**, but the live Stripe Price
(`STRIPE_PRICE_PROFESSIONAL`) is **$249** — called out in a comment in
`docs/pro/pricing.html` itself: *"create/re-point a $299 Stripe Price for Crew —
STRIPE_PRICE_PROFESSIONAL is $249 today."* A customer clicking "Start Crew"
would be charged $249 while the page promised $299 (or vice-versa) — a real
trust/legal problem at launch.

**Decision you must make:** which is canonical?
- **(a) Crew = $299** → create a new $299 Stripe Price (test + live), point
  `STRIPE_PRICE_PROFESSIONAL` at it. Marketing already says $299 — no page change.
- **(b) Crew = $249** → update the marketing/pricing page + meta + JSON-LD +
  the FAQ/Terms copy from $299 → $249. Keep the existing Stripe Price.

**Buildable once decided:** Claude can do (b)'s copy sweep in minutes, or wire
(a)'s new Price id into config once you create it in Stripe. The Stripe Price
creation is yours (account access).

---

## Blocker 2 — Per-seat billing ($39/seat Crew) not built
**Fact:** Crew lists **+$39/seat** but per-seat billing does not exist —
no Stripe metered/quantity subscription, no seat-count enforcement, no
add/remove-seat UI. (Phase D groundwork is decided but unbuilt — see
[[phase-d-billing-decisions]]: sub key `subscriptions/{companyId}`, per-seat
pricing, free+trial with no paywall.)

**Decisions you must make before the build:**
1. **Stripe test-mode keys** in `functions/.env.local` (the emulator can't test
   billing without them — see [[qa-sweep-2026-06]]).
2. **Final amounts**: confirm Solo $99, Crew base $299/$249, **per-seat $39**,
   trial length (14d), and whether Solo→Crew is an upgrade path.
3. **Seat model**: is the Crew base price 1 seat included + $39 each additional,
   or $39 × every seat? Proration on add/remove mid-cycle?
4. **Backups**: confirm a Firestore backup/export is in place before any billing
   writes go live (you flagged this as a gate).

**Buildable once decided (Phase D, test-mode first):**
- Stripe subscription with a base Price + a per-seat quantity Price; webhook
  updates `subscriptions/{companyId}` (seat count, status, current_period_end).
- Seat add/remove UI in Settings → Billing; enforce seat count on member invite.
- All behind the existing free+trial-no-paywall gate (don't eager-load
  `loadSubscription`; F3 softGate fail-open is intentional — see
  [[qa-sweep-2026-06]]).

---

## Recommended order
1. **Decide Blocker 1** (one number) → Claude aligns Stripe-or-copy → **#579 can
   merge** (the rest of #579 — Terms page, honest-proof rewrite, a11y FAQ — is
   ready; only the price assertion blocks it).
2. **Provision Stripe test-mode + amounts + backup** → Claude builds Blocker 2
   (per-seat billing) in test mode, you verify, then flip to live.

Nothing here is started — all gated on your product/Stripe calls above.

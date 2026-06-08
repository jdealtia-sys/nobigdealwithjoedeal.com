# NBD Pro — Pricing (canonical reference)

> Locked with Jo 2026-06-08, grounded in live competitor pricing + per-tenant COGS + the shipped feature set.
> This is the source of truth for the pricing page, the plan config (billing-gate/nbd-auth/stripe/billing), and the
> Phase D Stripe products. **Positioning:** wedge between the $30 "toy" disruptors (QuoteIQ) and the $600+ quote-gated
> incumbents (JobNimbus real ~$619/5-seat, AccuLynx, ServiceTitan). Win on **transparency + bundled AI**, not on price.

## Tiers

| Display | Internal id | Monthly | Annual (~30% off) | Seats | Per-seat add-on | Lead cap | AI/photo + measurement |
|---------|-------------|---------|-------------------|-------|-----------------|----------|------------------------|
| **Free** | `free` | $0 | $0 | 1 | — (upgrade to add) | 10/mo | **No** server-AI / SMS / measurements |
| **Solo** | `starter` (alias `foundation`) | **$99** | $69/mo ($828/yr) | 1 | — (2nd user ⇒ Crew) | 50/mo | Photo-AI ≤$25/mo · Claude 50k tok/day · AI-texting · **no** paid measurements |
| **Crew** | `growth` (alias `professional`) | **$299** | $209/mo ($2,508/yr) | **3** | **$39/mo** ($33 annual) | 500/mo | Photo-AI ≤$75/mo · Claude 250k tok/day · **measurements: 10 credits then cost+25%** |
| **Scale** | `enterprise` | **from $599** (custom) | custom (~30% off) | ∞ (volume) | volume-negotiated | ∞ | Photo-AI ≤$150/mo · Claude 1M tok/day · larger measurement pool · white-label (quote-gated) |

**Internal plan IDs are UNCHANGED** (free/starter/growth/enterprise + foundation/professional aliases) so no
subscription-doc migration is needed — only display names + seats + prices + caps are (re)defined. Phase D adds the
seat count + per-seat Stripe quantity on top.

## Model
- **One flat per-seat add-on** (Jobber-style), never JobNimbus's 3-layer (base + comms + role-seats) model.
- **Free forever** (volume-starved, zero billable-cost features) + **14-day no-card trial of Crew** on paid signup.
- **~30% annual discount** (market band 25–40%). Headline the monthly price; show annual savings beneath.
- **Publish every price** on the site; no sales call below Scale.

## Feature → tier ("show real value", drive upgrades)
- **Free:** full pipeline/kanban, D2D tracker, manual drawing/measure, instant-estimate engine, 5 doc templates.
- **Solo (+):** all 24 doc templates + 186 themes, **e-sign (BoldSign), customer portal, AI-texting drafts, AI roof-photo analysis**, basic reports. (Close-the-deal tools — cheap to serve, high perceived value.)
- **Crew (+):** AI photo at volume, **paid aerial measurements**, storm/hail lists, Rep OS / Close Board / Leaderboard / Sales Training, advanced reporting + forecasting + lead-source ROI. (Team + revenue engines.)
- **Scale (+):** white-label / custom domain (Pillar 5), multi-location rollup, API, priority support + SLA.

## Margin guardrails (every tier targets ~80%+ gross margin vs WORST-CASE COGS)
COGS: light tenant ~$2–5/mo, heavy ~$25–60, pathological ~$150–250. The marginal-cost levers are gated/metered by
tier using caps the code already enforces (photo-vision $25/$75/$150; Claude 50k/250k/1M tok/day).

## ⚠️ MUST-FIX before GA / self-serve signup
1. **Meter aerial measurements per tenant** (Hover/EagleView/Nearmap, $20–50/property, currently absorbed on a shared
   key with NO per-tenant cap — the #1 margin risk). Exclude from Free/Solo; on Crew+ = 10 bundled credits then
   pass-through at **cost+25%**. The markup was always intended; it just isn't built.
2. **Unify the 3 plan vocabularies** (nbd-auth.js / billing-gate.js / stripe.js disagree — latent billing bug) to one
   canonical set before seat pricing ships.
3. **Rewrite the pricing-page copy** to the REAL enforced limits (per-plan AI-photo $, Claude tokens, metered SMS,
   bundled-then-metered measurements) — not the current "2 reports / 20 AI calls" which map to nothing.
4. **Don't raise the low-tier AI caps** (a worst-case abusive Solo ≈ $51 COGS already → ~48% margin).
5. **SMS/AI-texting** is blocked on Twilio A2P 10DLC — market "coming soon" until it clears.
6. **Per-tenant COGS dashboard** from existing meters (api_usage, leadCostMeter, userCostMeter, voice_costCents, sms_log).

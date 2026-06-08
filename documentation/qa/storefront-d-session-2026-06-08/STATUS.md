# Storefront-finish + Privacy Policy + Phase D (Billing & Seats) — STATUS

**Session:** Launch Runway, Session 1 — 2026-06-08
**Branch at start:** `feat/pro-terms-page` (storefront work lives here)
**Owner/dev:** Jo Deal. NBD = tenant zero (byte-identical). Oaks = live test tenant.

Two sub-missions, **HARD CHECKPOINT between them**:
1. Storefront-finish + Privacy Policy + **lock pricing** → Jo signs off on pages + pricing.
2. Phase D billing + seats, wired to the **exact signed-off tiers**.

OUT of scope this session: security/isolation audit, Phase E self-serve signup, D-4 signup paywall.

---

## PHASE 0 — GROUND TRUTH (verified against live code 2026-06-08)

### Billing entitlements as ENFORCED in code (`docs/pro/js/billing-gate.js` PLANS, lines 31–38)

| tier key | label | leads/mo | reports | aiCalls | reps (seats) | price |
|----------|-------|----------|---------|---------|--------------|-------|
| `free` | Free | 10 | 0 | 0 | 1 | $0 |
| `starter` (alias `foundation`) | Starter | 50 | 2 | 20 | 1 | $99 |
| `growth` (alias `professional`) | Growth | 500 | ∞ | ∞ | 5 | **$249** |
| `enterprise` | Enterprise | ∞ | ∞ | ∞ | ∞ | null (custom) |

- Gating is **soft** — warns at 80%, upgrade modal at 100%, **never hard-locks mid-cycle** (`softGate` always returns true).
- `loadSubscription()` reads **`subscriptions/{uid}`** (uid = `window._user.uid`); fields: `plan`, `status`, `usage`, `trialEndsAt`. Fallback plan `free`.
- **Hardcoded owner-email bypass** (`OWNER_EMAILS`, lines 49–57): `jd@nobigdealwithjoedeal.com`, `jonathandeal459@gmail.com` → forced `enterprise`/`active`, skips Firestore, never gated. Mirrored in `nbd-auth.js` (lines 83–95). **D-1 retires this → drive off company plan.**

### Pricing as ADVERTISED on the live /pro pages (`pricing.html`, `index.html`, `terms.html` — all internally consistent)

| Plan (marketing) | Price advertised | Seats | Leads/mo |
|------------------|------------------|-------|----------|
| Free | $0 forever | 1 | 10 |
| Solo | $99/mo (14-day trial, no card) | 1 | 50 |
| **Crew** (MOST POPULAR) | **$299/mo + $39/mo per extra seat** | up to 5 incl. | 500 |
| Scale | Custom (contact) | unlimited | ∞ |

### ⚠ RECONCILIATION GAPS — page vs billing (the spine of the checkpoint)

1. **Crew price mismatch:** pages say **$299/mo**, but `STRIPE_PRICE_PROFESSIONAL` and `billing-gate` PLANS say **$249**. → Decision needed; whichever wins, page + Stripe + code must agree.
2. **Per-seat (+$39/seat) advertised but NOT built:** Stripe checkout hardcodes `quantity: 1` (`functions/stripe.js`). No seat logic anywhere. → D-3 build OR strip the copy.
3. **Trial mismatch:** pages advertise 14-day trial on Solo *and* Crew; Stripe configures `trial_period_days: 14` for **growth (Crew) only** (`functions/stripe.js`). Solo trial is not backed in Stripe.
4. **Naming map (cosmetic but must be documented):** Free=`free`, Solo=`starter`/`foundation` ($99), Crew=`growth`/`professional` ($249→?$299), Scale=`enterprise`.
5. **Self-serve signup gap (Phase E):** `register.html` is a real form that creates an account, BUT a fresh account has no `subscriptions/{uid}` doc → `nbd-auth.js` treats it as `free` (level 0) < `foundation` (level 2) → **upgrade wall**. So "Start Free Trial → register.html" does NOT land users in a working product unless an access code seeds a sub. → **CTA must be corrected** (point to Log In / labeled early-access). All landing CTAs currently href `/pro/register.html`.

### Stripe integration today (`functions/stripe.js`)
- Checkout: `mode: 'subscription'`, `client_reference_id = uid`, `quantity: 1`, success/cancel URLs **hardcoded to `nobigdealwithjoedeal.com`**.
- Price env vars (Secret Manager / `.env.local`): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_FOUNDATION` ($99 = Solo), `STRIPE_PRICE_PROFESSIONAL` ($249 = Crew).
- Webhook writes `subscriptions/{uid}` (keyed by `client_reference_id` / reverse-lookup by `stripeCustomerId`). **No `companyId` anywhere in the billing pipeline today.**
- Events handled: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid` (resets usage on cycle). Idempotency via `stripe_events/{event.id}`.

### Firestore rules
- `subscriptions/{uid}` (lines 368–374): `allow read: if isOwner(uid) || isAdmin();` `allow write: if false;` (admin-SDK only).
- `companies/{companyId}` (lines 552–568): member/owner readable; `members/{memberId}` subcollection writable by company owner or admin.

### Tenant resolution
- **No `functions/lib/tenant.js`.** Server resolves inline: `claims.companyId || uid` (`functions/handlers/_shared.js` `requireTeamAdmin`), `resolveAlertTarget` (`lead-alert.js`).
- Client: `window._tenant()` reads `window._userClaims.companyId` (`docs/pro/js/company-profile.js`), null → NBD solo defaults.
- companyId shape: lowercase `[a-z0-9-]`, ≤64 chars, validated against `companies/{cid}` registry. NBD solo: `companyId == uid`. Tenants: literal slug (`oaks`).

### Provisioning (`scripts/provision-tenant.js`, admin-SDK, Jo runs)
- Seeds **`subscriptions/{ownerUid}` = `{plan, status:'active', companyId, provisionedBy, updatedAt}`** (default plan `professional`) — bypasses the upgrade wall. **Keyed by uid today, not companyId.**
- Oaks test tenant: `companyId:'oaks'`, owner uid `VuXj6xUYoEVYwL7mhl1hFSN1XRx1`, email `zz-qa-oaks-owner@nobigdealwithjoedeal.com`, plan `professional`, active. Reuse for Phase D test validation.

### Existing legal pages
- `docs/pro/terms.html` — SaaS Terms of Service, wired into /pro footers.
- `docs/privacy.html` — marketing-site privacy policy (root `/privacy`). Names processors: Firebase, Google Analytics, Stripe, Resend, Twilio, Anthropic, BoldSign, HOVER/EagleView, Regrid, NWS/NOAA, Cal.com, Sentry, Cloudflare Turnstile. Marketing-focused; **no `/pro/privacy.html` exists**. /pro footers link Privacy → `/privacy`.
- **Missing:** a SaaS-appropriate Privacy Policy covering CRM/lead/estimate data, team seats, subprocessors.

---

## THE 3 OPEN DECISIONS (surfaced to Jo — Phase 0 step 2)

1. **Subscription key:** `subscriptions/{companyId}` (recommended, reuses doc shape + rules) vs `companies/{cid}.billing`.
2. **Pricing model:** flat per-plan vs per-seat (Crew incl. 5 seats + $39/seat). Gates both sub-missions.
3. **Trial / free tier** for new companies.
4. (reconciliation) **Crew price:** $299 (advertised) vs $249 (Stripe/code) — must agree.

### ✅ DECISIONS LOCKED (Jo, 2026-06-08)
1. **Subscription key:** `subscriptions/{companyId}` (recommended). NBD solo = no-op.
2. **Pricing model:** **per-seat** — Crew base incl. 5 seats, +$39/mo per extra seat. Build as Stripe item quantity (D-3).
3. **Trial / free tier:** **keep Free tier + 14-day trial** on paid plans. Make the trial back **Solo too** (today Stripe trials only Crew/growth).
4. **Crew price:** **$299/mo** canonical. → Stripe Price re-pointed $249→$299 (Jo, TEST mode); update `billing-gate` PLANS `growth.price` 249→299 (Sub-mission 2).

**Canonical pricing (locked):** Free $0 / 10 leads / 1 seat · Solo $99/mo / 50 leads / 1 seat / 14-day trial · Crew $299/mo / 500 leads / 5 seats incl. +$39/seat / 14-day trial · Scale custom / ∞.

**Page side:** live pages already reflect this → minimal page changes (Privacy Policy + CTA correction + functional pass).
**Billing side (Sub-mission 2):** Stripe Crew Price $249→$299, per-seat quantity, Solo trial, `billing-gate` price bump, company-keyed re-key.

**Still NEEDS JO before Sub-mission 2:** confirm Stripe TEST-mode access + back up `subscriptions` collection.

---

## SUB-MISSION 1 — Storefront-finish + Privacy + lock pricing (COMPLETE, awaiting checkpoint sign-off)

Branch `feat/pro-terms-page`. Working tree only — **not committed/deployed** (checkpoint gate). Smoke **1866/0 green**.

### Shipped (working tree)
1. **NEW `docs/pro/privacy.html`** — SaaS Privacy Policy, NBD-branded template (matches terms.html chrome). 14 sections; correctly frames NBD Pro as **controller** (account/billing) vs **processor** (the contractor's CRM data); 12-row **subprocessor table** (Firebase, Stripe, Resend, Twilio, Anthropic, BoldSign, HOVER/EagleView/Nearmap, Regrid, NWS/NOAA+HailTrace, Cal.com, Google Analytics, Sentry+Cloudflare) with what-data-flows per vendor; data-export/deletion, security, CCPA + state rights, US hosting. **Explicit "no SOC 2 / HIPAA / GDPR" fabricated-claim guard** + legal-review-pending comment. Verified rendering desktop + mobile + table.
2. **Privacy footers rewired** → `/pro/privacy.html` across index, pricing, terms (body §intro/§7/§17 + footer Legal + footer-bottom). Homeowner `/privacy` retained + cross-linked from the new policy.
3. **CTA honesty (early-access reframe, Jo's decision):** self-serve signup doesn't deliver a working account yet (no-code → upgrade wall; access-code → pending IAM grant). All over-promising "Start Free Trial / Start Free / Sign Up" CTAs → **"Get Early Access"** on index (8), pricing (3), register, demo. Microcopy reframed to founding-member/early-access (no instant-trial promise). Plan/pricing catalog kept (truthful product description).
4. **Truthful-copy fixes (RULE 0 #4):** removed "SOC 2-compliant" trust claims from index (badge + FAQ + JSON-LD, kept in sync) and pricing (trust badge) → precise "Google Firebase (Google Cloud) infrastructure, encryption in transit/at rest." register "25 leads"→"10 leads".
5. **demo.html stale-pricing landmine neutralized:** removed contradictory "$79/mo Pro", "$59/mo annual", "25 leads", "beta locks in forever", invalid `?plan=pro`; CTAs → Get Early Access / See Plans & Pricing.
6. **Smoke coverage added** for the new Pro privacy page (existence, subprocessor disclosure, controller/processor, footer wiring) in `tests/smoke/functions.test.js`.

### ⚠ FLAGGED FOR JO (not touched — needs your call)
- **`docs/pro/landing.html`** ("NBD Pro masterclass", linked from blogs + free-guide) is a **stale page**: full obsolete pricing table **$29/$49/$79** with old plan names (foundation/blueprint/professional), "Start Free Trial" CTAs, and **fabricated stats `$2.4M` / `$10M+`** (the smoke fabricated-proof guard only checks index.html, so these slipped through). Options: (a) reconcile to canonical Free/$99/$299 + strip fabricated stats + early-access CTAs, or (b) retire it via a hosting redirect `/pro/landing → /pro/`. **Recommend (a) or (b) — your call.**
- One SOC-2 claim remains on landing.html (§FAQ "compliant with SOC 2 standards") — folded into the landing.html decision above.

### 🚨 CRITICAL DISCOVERY (2026-06-08, mid-session) — the brief's premise is out of date

A parallel session already built **Phase D billing AND a canonical /pro storefront** on branch **`phase-d-build`** (worktree `C:/Users/jonat/nbd-phase-d-worktree`, pushed to origin, NOT merged), with a **locked canonical `documentation/PRICING.md`**. Surfaced via memory `phase-d-billing-decisions.md`, verified against the branches. This was NOT in the brief.

**The two branches diverged at `1c47eba5` and both independently reworked `index.html`/`pricing.html` → they conflict.**

| | `phase-d-build` (parallel) | `feat/pro-terms-page` (this branch) |
|---|---|---|
| index.html | **CANONICAL** — Free/Solo/Crew/Scale, Crew $299 **3 seats** +$39, $209 annual, **Scale $599+**, no SOC2/fabricated proof | older refresh: Solo/Crew $299 but **5 seats** ❌, no annual ❌, Scale "Custom" ❌ |
| pricing.html | **STALE** — Starter/Growth/Enterprise, **Growth $249** ❌ | refreshed Solo/Crew $299 but 5 seats ❌, Scale "Custom" ❌, no annual ❌ |
| CTAs | still "Start Free Trial" ❌ (same over-promise; early-access insight NOT applied) | **early-access honesty ✓ (mine)** |
| Terms / Privacy | **NONE** ❌ | terms.html ✓ + **privacy.html ✓ (mine, new)** |
| Phase D billing (plan-limits.js, company-keyed stripe.js, migration, seat gates) | **BUILT + adversarial-review-passed** ✓ | none ❌ |
| `documentation/PRICING.md` (canonical) | **YES** ✓ | none ❌ |

**Canonical pricing (locked w/ Jo in PRICING.md, implemented on phase-d-build/index):** Free $0/10 · Solo $99 ($69 annual)/50/1seat · Crew $299 ($209 annual) **/3 seats** +$39 /500 · Scale **from $599** custom. ~30% annual. Real feature caps (Photo-AI $/mo, Claude tok/day) — NOT the "2 reports/20 AI calls" on the current pricing.html (PRICING.md MUST-FIX #3 says those map to nothing).

**Implication:** The pages I "finalized" have the WRONG seat count (5 vs canonical **3**), no annual, no $599 Scale. Phase D is NOT unbuilt — it's built on phase-d-build awaiting Jo's Stripe-test-mode prereqs. `feat/pro-terms-page` was itself the *spawned task* to create the Terms page that phase-d-build lacked → the branches are meant to converge.

**My session's unique, branch-independent keepers:** the **Privacy Policy** (exists nowhere else), **Terms** (here only), the **early-access CTA honesty** + the self-serve-signup-is-broken insight (phase-d-build still over-promises), the **demo.html stale-pricing fix**, SOC2 removal.

### → RESOLVED (Jo, 2026-06-08): **phase-d-build is the trunk** + **canonical pricing per PRICING.md** (Crew 3 seats/$599 Scale/~30% annual).

## SUB-MISSION 1b — UNIFIED ONTO phase-d-build (COMPLETE, awaiting checkpoint sign-off)

Isolated worktree `C:/Users/jonat/nbd-storefront-on-phased`, branch **`storefront-legal-on-phased`** (off `phase-d-build`), commit **219f1706**. NOT pushed/merged (checkpoint + auto-deploy gate). **Smoke 1856/0 green.**

- **Legal pages ported** (phase-d-build had neither): `docs/pro/privacy.html` (my SaaS policy) + `docs/pro/terms.html`. phase-d-build's index footer Terms link was a dead `href="#"` → now `/pro/terms.html`. All Pro footers Privacy → `/pro/privacy.html`.
- **pricing.html reconciled to canonical** (was 5-seat/no-annual/Scale "Custom"): Crew **3 seats** +$39/extra, Solo **$69**/Crew **$209** annual (~30% off), Scale **from $599**. Replaced "2 reports / 20 AI calls" (map to nothing) with real per-tier features + metered aerial-measurements matrix row.
- **index.html (phase-d-build's canonical landing) reframed**: 7 CTAs → "Get Early Access", founding-member microcopy, nav dead `href="#"` → `/pro/register.html`, both legal footer links wired. (Its pricing was already canonical: 3 seats/$599/annual.)
- **register.html / demo.html**: early-access framing; demo's stale "$79/mo / $59 annual / 25 leads / beta / plan=pro" removed; register "25→10 leads".
- **Smoke +section** guards Pro Terms/Privacy existence+wiring, canonical pricing (3 seats/$599/annual), no SOC2/$249 in visible copy, Get-Early-Access CTAs.
- **Residual flags for Jo** (judgment calls, NOT changed): (1) `docs/pro/landing.html` masterclass page still stale ($29/$49/$79 + foundation/blueprint/professional + $2.4M/$10M stats + Start-Free-Trial) — reconcile or retire-via-redirect; (2) index.html hero mockup uses **$2.4M pipeline / 247 leads** sample data inside labeled product mockups — legit UI demo IMO (like demo.html), but feat's adversarial review had been stricter; confirm OK or soften.

## → HARD CHECKPOINT (NOW): Jo reviews the finalized unified storefront (branch `storefront-legal-on-phased`) + confirms pricing. After sign-off: merge into phase-d-build, then SUB-MISSION 2.

## SUB-MISSION 2 (after sign-off) — REVIEW/VALIDATE existing Phase D (NOT rebuild)
Phase D is already BUILT on phase-d-build (D-1 read-path + D-3 seats/gate/rules done+tested; D-2 money-path authored; migration script dry-run-validated; adversarial-review passed — see memory `phase-d-billing-decisions.md` + `documentation/qa/phase-d-build-2026-06-08/STATUS.md`). This session's Sub-mission 2 = review it against the brief's RULE 0 (Stripe test-mode, backups, propose migration), reconcile entitlements ↔ the now-canonical pricing page, and validate vs the Oaks test tenant in Stripe TEST mode.

**✅ REVIEW COMPLETE (2026-06-08) — see `REVIEW-PHASE-D.md`.** Verdict: build is SOUND. Entitlements MATCH the canonical page (Crew 3 seats/$299 — memory's $249/5 was stale). NBD byte-identical ✅. Money-path sound (the one invoice "downgrade" concern is moot — invoices aren't homeowner-editable). Migration reversible + no-charge. **Open: Jo decision on silent downgrade-below-members; per-seat add-on needs `STRIPE_PRICE_SEAT`.** **Money-validation + migration run GATED on Jo's Stripe test-mode + $249→$299 Price + `STRIPE_PRICE_SEAT` + fresh backup** (full prereqs + test plan in REVIEW-PHASE-D.md). Handoff: `HANDOFF.md`.

## BLOCKED / NEEDS JO (for Sub-mission 2 / Phase D)
- [ ] **Sign off on the finalized storefront pages + pricing** (the checkpoint).
- [ ] Decide landing.html treatment (reconcile vs retire).
- [ ] Confirm Stripe **TEST-mode** access.
- [ ] Back up the `subscriptions` collection before any re-key (Phase D).

# Session 2026-09-08 — a competitor email, and the claims it turned over

Started as "a competitor's owner emailed me, is any of it useful?" and became a
claims-accuracy audit of everything `/pro` tells a buyer. Eight PRs merged.

This is a **session note, not a handoff** — `NEXT_SESSION-2026-09-09.md` is
already the current brief (#1457) and stays that way. See also the companion
audit note: [PULSERELATE-RECON-AND-PRO-DOMAIN-2026-09-07](../audit/PULSERELATE-RECON-AND-PRO-DOMAIN-2026-09-07.md).

---

## 1. The competitor was a subset; the marketing was the gap

[pulserelate.com](https://pulserelate.com)'s fifteen advertised features all
already exist in `docs/pro/`, usually deeper. The only capability we lack is
**internal team-to-team chat** — `nbd-comms.js` is entirely customer-facing and
`talk-tank.js` is a voice inbox.

Their GAF Quick Measure integration looked like the one idea worth taking until
the price was checked: **QuickMeasure starts at $18/report**, and "free for
certified contractors" is a discount, not free. Instant Roofer at $3/address
already wins. No change warranted.

Where they beat us is **marketing surface**, not product — six indexed pages to
our four, and `FAQPage` schema on a page `/pro` did not have.

## 2. The domain question — answered: not yet

The homeowner/B2B split already exists and was *designed*: zero `/pro` URLs in
`sitemap.xml`, only **4 of 35** `/pro` pages indexable, "Secondary Product" in
`llms.txt`. Re-affirmed 2026-08-15 when an outside audit read it as an oversight
and in-repo verification ruled it a "designed posture".

Buying a domain is **7-11 focused working days**, and **`/pro` is not a clean
seam** — it holds the homeowner-facing `esign`, `portal`, `estimate-view` and
`invoice-success` surfaces, so moving it wholesale would route homeowners onto
the B2B SaaS domain to sign their roofing contracts. If it ever happens, move
only the 4 public acquisition URLs.

**The real coupling is 218 homeowner pages linking to `/pro`** from four
generator-owned footer partials — two orders of magnitude bigger than any
schema, and one restamp to unwind.

## 3. The pricing claim could not be made factual

"Priced at about one-third what JobNimbus and AccuLynx charge" shipped on
**eleven surfaces**. Neither company publishes a price:

- **JobNimbus** — all four tiers read "Request pricing"; their FAQ carries the
  question *"Why don't you list pricing on the website?"*
- **AccuLynx** — `/pricing/` is a lead form; `/plan-options/` offers "a custom
  price quote". Nothing in their 83-URL sitemap carries a figure.

Third-party numbers conflict by an order of magnitude ($225/mo flat vs
$300/user/mo), putting the "ratio" anywhere from ~1/2 to ~1/12. And AccuLynx
bills **per licence** against our flat tiers, so no fixed ratio can exist at any
headcount. Replaced with what IS checkable: **we publish, they require a call.**

**Roofr does publish** — $0 / $109 / $249 / $349, flat, unlimited users, no
setup fee — so NBD Team $149 vs Roofr Essentials $249 is sourceable if a number
is ever wanted. And JobNimbus explicitly states **no required setup or
onboarding fees**, so copy implying hidden implementation costs would be false
for them.

## 4. The claims audit — 24 raised, 14 survived

Every `/pro` claim checked against the code, each finding attacked by two
skeptics. The severe ones:

| Claim | Reality |
|---|---|
| *"sign out of all devices"* after a compromise | Local `signOut` only. `revokeRefreshTokens` had **zero user-reachable callers**. **Fixed for real in #1500** — a callable plus `session-revoke.js`. |
| Warranty Good = 25yr | Generator printed **`'5-Year'`**. Three different answers lived in the tree. |
| *"We never lock you out mid-cycle"* | `billing-gate.js:349` hard-stops. **Owners are exempt via `_isOwner()`** — the one person who would notice cannot reach the state. |
| Trial *"No credit card required"* | Stripe Checkout collects a card and auto-converts at day 14. |
| SMS from *"your business number"* | One shared Twilio number; `twilioNumber` has **no reader**. |
| Property Intel *"hits county records"* | Regrid token is the April stub; falls through to a Claude estimate whose prompt **seeds "Hamilton County Auditor" as the dataSource**. |

Plus: portal audit-trail (that prefix is delete-only), four D2D dispositions
that do not exist, GAF comparison that `readAsText()`s a PDF, and "1 theme" as
a Free limit when themes have no gate.

**One audit finding was overruled.** It filed `team` missing from `PLAN_LEVELS`
as P1 customer harm. `_normalizePlan('team')` does return `'free'`, but
`planLevel` has **zero consumers** and `billing-gate.js` has its own normalizer
that handles `team` correctly. A landmine, not a live fire.

## 5. Warranty is now 5 / 10 / 20 in sixteen places

Jo's call. Best's expiration is a real date (`'20 years from ' + issueDate`)
rather than "Lifetime — No Expiration". **Manufacturer warranties untouched** —
the three TAMKO Limited Lifetime references, Class 4 50yr, RoofIVent 50yr, GAF
Pivot Boot 50yr, the 3-Tab 25yr catalog entry and the 40yr standing-seam finish
are the manufacturers' terms on specific products and are correct as written.

**Five of the sixteen surfaces were found by a second sweep**, not the first
pass. Grepping the term beats trusting the obvious file.

## 6. Process lessons worth keeping

- **A merged PR's "still stale / not touched" line is a duplication magnet.**
  #1481 flagged `ci.yml:241`; a peer lane shipped it as #1482 eight minutes
  ahead of my #1485. Theirs was better (it *researched* the contradictory
  history instead of deleting it), so mine closed.
- **Two dedup guards can mask each other.** In #1484, removing either the
  `SKIP_DIRS` filter or the `Set` alone left the suite green; only both
  reddened it. Fixed in #1486 so the filter is independently provable.
- **The shared checkout overwrote a branch mid-session.** `bef41316` was
  committed on a contaminated HEAD and dragged 263 files of another lane's nav
  work; the remote ref for `fix/pro-claims-vs-code` was then replaced entirely.
  Recovered from the intact commit object into `nbd-wt-claims`. Detail in
  [[shared-checkout-parallel-sessions]] terms: rebuild in a worktree, never
  fight the shared tree.
- **Re-check every finding against `main` before re-applying.** Three of my
  thirteen copy fixes had become *wrong* — #1500 built the capability my copy
  said did not exist.

## Open items

1. **`docs/pro/js/close-board.js:195`** defaults the close-board warranty to
   `'25-year limited lifetime'` — self-contradictory, matches no tier, and it
   ships on a customer-facing document as a rep-overridable default. Needs a
   decision, not a guess.
2. **`sitemap-orphan` only guards the 4 skipped-dir pages**, not the 224 URLs in
   the main sitemap — same defect class, unreported.
3. **Only `pro` of the five `SKIP_DIRS` has fixture coverage.** `sites` is the
   live risk: tenant microsites are noindexed on purpose, and the
   `sitemap-noindex` branch would turn that into a CI-blocking ERROR.
4. **Internal team chat** — the one PulseRelate capability we lack. Unbuilt,
   deliberately.

# Session 2026-08-17 — Backlinks / internet-presence rush (PR #1205)

Trigger: two national inbound leads in one week from the shingle blog cluster — a
Northern Virginia text (Timberline HDZ vs StormFighter Flex, non-hail buyer) and a
Colorado Springs call (OC Duration vs HailGuard, "$9,000 upsell — reasonable?").
Jo asked to capitalize: backlinks, spread across the internet, as fast as legitimate.

## What shipped (7 commits, one PR)

1. **Entity hardening** — Yelp appended to `sameAs` (homepage RoofingContractor +
   review-page LocalBusiness), `/areas` og:url 301 fix, llms.txt NAP aligned to
   canonical Goshen OH.
2. **Two "Reader Questions" posts** (publish-ready, per Jo's decision — merging the
   PR approves them):
   - `/blog/gaf-timberline-hdz-vs-tamko-stormfighter-flex` — the NoVA question.
     Thesis: if hail isn't your problem, don't pay for the hail solution.
   - `/blog/owens-corning-duration-vs-tamko-hailguard` — the $9k question.
     Method-first: itemization test, per-square math, three-row insurance math.
   - New `Reader Questions` tag; both carry FAQPage JSON-LD from day one; Keep
     Reading backlinks from 4 sibling posts; POSTS/blog-index/sitemap regenerated.
3. **AEO instrumentation** — FAQPage JSON-LD (answers condensed strictly from each
   page's own prose) on the 3 gap posts (gaf-timberline-vs-tamko-storm-series,
   tamko-hailguard, why-class-4) + both shingle product pages; dateModified +
   sitemap lastmod bumps; product pages now link into the new posts; llms.txt
   Guides list completed (3 missing July posts + 2 new).
4. **Distribution plumbing** — `scripts/build-feed.mjs` (deterministic RSS 2.0 from
   the POSTS array; dry-run drift gate in ci.yml site-integrity job; soft-fail regen
   in firebase-deploy.yml), `docs/feed.xml` (24 items), rel=alternate discovery on
   homepage + blog index, robots/llms pointers, IndexNow key at
   `docs/b947f682ee5aa172a0005d5440a7bfcf.txt`.
5. **Off-site kit** — [marketing/rush-week-2026-08](../marketing/rush-week-2026-08.md)
   (sequenced sprint + baseline + IndexNow commands + pitch templates + Reddit
   guardrails + Reader Questions pipeline); dated addenda to the playbook and
   citation kit; WEEKLY_CADENCE citation line repointed.

## Recon corrections (fixing the record — stale-doc rule)

- **The dead Facebook URL is already fixed.** `homeowner-content-audit-2026-07.md`
  item #17 is resolved — `facebook.com/nobigdealwithjoedeal` appears nowhere under
  `docs/` anymore; only the live people/61577… URL ships.
- **GA4 IS installed** (`G-8PG7N9Q3DL` in docs/index.html) — the July-era notes
  saying "Google Analytics not installed" are stale.
- **FAQPage coverage was better than assumed**: most insurance/cost posts already
  had it; the real gaps were exactly the 3 posts + 2 product pages instrumented above.
- **TAMKO tier**: Pro Gold™ ID 181382 since 2026-07-08 — the playbook's "Team tier"
  guidance was written two days before the upgrade (corrected in-place).

## Product-claims verification table (also in PR #1205 description)

Sourced = already published on the site (file quoted in PR). NEW = stated in a new
post without an existing on-site source — **Jo verifies before merge**:

| Claim (new posts) | Status |
|---|---|
| All HDZ specs (LayerLock, WindProven no-max w/ starter+ridge, StainGuard Plus 25yr, 22 stocked colors, Class 3, most-installed) | Sourced — /services/gaf-timberline |
| All StormFighter Flex specs (Class 4, ForceFX/AnchorLock/TriShield, 160mph w/ TAMKO system, Kantar #1, cold-weather window, 8 colors) | Sourced — /services/tamko-storm-series |
| All HailGuard warranty terms (base 10yr Full Start + 7yr hail; ProShield 20+10 via Pro Gold; TAMKO underlayments required; arbitration clause) | Sourced — /services/tamko-storm-series + HailGuard post |
| Class 4 discount bands ($60–$300+/yr), like-kind-and-quality, Class 4 endorsement | Sourced — why-class-4 post |
| OC-network disclaimer phrasing ("…and I'm not one of them") | Sourced — gaf-vs-owens-corning post (passes the cert-claim CI guard) |
| **"Standard architectural Duration isn't sold on a Class 4 rating; impact-rated shingles are separate products"** | **NEW — verify** (industry-accurate to my knowledge; OC's impact options are separate SKUs) |
| **"Labor for two laminated asphalt shingles of the same format barely differs"** | **NEW — verify** (trade knowledge) |
| **"A medium house often lands around 20 squares"** (hedged) | Derived from published 2,000 sq ft = 20 sq example |
| **"HDZ color availability varies by region"** (hedge for national readers) | **NEW — low risk** |

## Decisions taken (Jo confirmed via session Q&A)

1. Posts publish-ready in the PR (not the stalled JO:-marker drafts pipeline).
2. Post 2 framed as OC Duration vs TAMKO HailGuard specifically.
3. AirOps AEO tracking approved as follow-up — **blocked on one-time setup**: the
   connected AirOps account has zero workspaces/brand kits and the MCP connection
   cannot create them (no create tool exposed). See NEXT_SESSION for the unblock.

## Not done / carried forward

See [NEXT_SESSION-2026-08-17](NEXT_SESSION-2026-08-17.md).

## Post-merge verification sweep — 2026-08-17 (later session)

All checks run against LIVE prod after #1205 + the same-day fix PRs (#1216/#1222)
deployed:

- **`/feed.xml`**: HTTP 200, `Content-Type: application/xml`, valid RSS 2.0
  opening with correct `atom:link rel=self`, `lastBuildDate` current. W3C
  validator UI couldn't be driven from the headless pane (bot-challenge
  interstitial) — feed verified structurally instead (parses as XML, correct
  channel/self-link shape). Re-run the W3C UI from a normal browser if wanted.
- **Structured data** (fetched live, every `ld+json` block parsed, zero errors):
  - `/blog/gaf-timberline-hdz-vs-tamko-stormfighter-flex` — BlogPosting +
    BreadcrumbList + FAQPage (4 Qs)
  - `/blog/owens-corning-duration-vs-tamko-hailguard` — BlogPosting +
    BreadcrumbList + FAQPage (4 Qs)
  - `/services/gaf-timberline` — Service + BreadcrumbList + FAQPage (4 Qs)
  - `/services/tamko-storm-series` — Service + BreadcrumbList + FAQPage (4 Qs)
  - `/blog/why-class-4-impact-shingles` (retrofit spot-check) — BlogPosting +
    BreadcrumbList + FAQPage (4 Qs)
  - Google Rich Results Test UI not driven headless; structural validation
    above is the substantive check.
- **`/areas` og:url**: now `https://nobigdealwithjoedeal.com/areas` — canonical,
  extensionless, no 301 hop. Fix confirmed live.
- **AirOps**: still blocked — `list_brand_kits` returns 0 workspaces as of
  2026-08-17; waiting on Jo's one-time workspace creation (handoff Jo-item #5).

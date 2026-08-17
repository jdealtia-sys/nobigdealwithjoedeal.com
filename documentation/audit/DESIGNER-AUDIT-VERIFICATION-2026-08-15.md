# Designer-Audit Verification — 2026-08-15

Jo received a third-party "Website Audit & Designer Handoff" document (dated
2026-08-15, scores the site 8.9/10) and asked for a claim-by-claim
verification plus an independent second sweep. This note is the record.
Verification ran against the repo at `9efc88b` (main, 2026-08-13); the live
site could not be fetched from this sandbox (proxy 403), but prod has been
caught up with main since 2026-08-11 (see
[NEXT_SESSION-2026-08-11](../projects/NEXT_SESSION-2026-08-11.md)).

**Headline: the audit's #1 priority ("complete absence of schema markup")
is factually wrong.** 206 of 250 HTML files under `docs/` carry inline
JSON-LD (551 blocks) — all static in the HTML, visible to any curl, none
JS-injected. Several other claims are also already-done or mitigated. The
audit is directionally useful in three places (conversion analytics,
privacy-policy tool coverage, location-page sameness) and its B2B-visibility
item collides with a deliberate design decision it didn't know about.

---

## Claim-by-claim verdict

| # | Audit claim | Verdict | Evidence |
|---|---|---|---|
| 1 | "Complete absence of schema markup"; add LocalBusiness/Service/Review/FAQ/HowTo/Article site-wide | **FALSE** | Homepage: `RoofingContractor` (credentials, 25-entry areaServed, OfferCatalog) + `Person` + 6-Q `FAQPage` (`docs/index.html:468,530,2042`). All 24 blog posts: `BlogPosting` + breadcrumbs + author/datePublished. Service pages + pledge + guarantee: `RoofingContractor` + `Service` + `FAQPage` + `BreadcrumbList`. Tools: `WebApplication`. Areas: `RoofingContractor` + `BreadcrumbList`. |
| 2 | Surface Free Guide / NBD Pro on consumer site | **HALF-TRUE, and collides with a deliberate decision** | See "Pro visibility" below. A discreet footer Pro link already exists on ~50 pages via `footer-extended.html`; the *free guide* genuinely has zero inbound links from anywhere except `/pro/landing` itself, and is noindexed. |
| 3 | Promote Free Tools hub + Roof Score more | **FALSE for nav, TRUE for homepage body** | `/free-tools` is in all 4 nav partials and linked from 189 pages (24/24 blog, 26/26 areas). But `docs/index.html` has **no in-body link** to `/free-tools` or `/roof-score` — nav chrome only. |
| 4 | Reviews: add Review schema + total count | **Schema FALSE (already present); count TRUE** | `docs/review.html` head has `LocalBusiness` with 8× `Review` (author/rating/date). No visible total count, no `AggregateRating` anywhere sitewide. NB: comment at `docs/review.html:522` claims the site *deliberately omits* Review JSON-LD — it contradicts the markup in the same file. Decide policy, fix one or the other. |
| 5 | Blog posts lack Article schema | **FALSE** | All 24 posts have `BlogPosting`; 2 have `HowTo`; index has `Blog`+`ItemList` (generator-stamped by `scripts/build-blog-index.mjs`). |
| 6 | Hero sub-headline too long for mobile | **MOSTLY MITIGATED** | Raw copy ~245 chars, but `trim-mobile` spans already cut it to ~130 chars on mobile (`docs/index.html:1321-1322`). Auditor measured desktop HTML. |
| 7 | Images: WebP / lazy-load / optimize | **FALSE on all counts that matter** | 100% of below-fold imgs `loading="lazy"`, universal width/height (+`decoding="async"` on portfolio), 22 `.webp` files. Only 2 images >300KB. Real payload issue is vendor JS (html2pdf 906KB, apexcharts 537KB, jspdf 364KB — verify which pages actually load them before "optimizing"). One dud: `drone-completed-brick.webp` is 427KB, larger than its jpg siblings — recompress. |
| 8 | Privacy policy coverage of forms/tools | **PARTLY TRUE — the one compliance-ish gap** | `docs/privacy.html` exists (686 lines, linked from all 3 footers, vendors named). But the OTP phone-verification flow (`inline/4053149b2f.js:618-680`) and Roof Score name/phone/email capture (`roof-score.js:303-318`) are not disclosed by name. |
| 9 | Location pages: avoid pure template swaps | **TRUE (audit's praise of Cincinnati/Batavia depth was wrong though)** | Normalized diff goshen↔monroe: 24/600 lines differ (~96% template). Storm-risk prose IS unique per city; neighborhoods are essentially absent everywhere (Batavia has 0 mentions). Cincinnati is only +46 lines (one credentials section). Byte spread across 25 pages: 43–51KB. |
| 10 | Confirm analytics goals fire on tools/forms | **MOSTLY TRUE — the biggest real gap** | GA4 (`G-8PG7N9Q3DL`) installed. Tracked: roof-score (`roof_score_band`, `roof_score_report`), storm tools (4 events), `cta_click`, `otp_skip_call_request`. **Untracked: every contact-form submit, estimate OTP unlock/reveal, visualizer render, free-tools clicks.** `public-lead-submit.js` and `quick-lead-form.js` fire zero events — lead conversions are unmeasured in GA4 outside roof-score/storm-report. |

Incidental findings from the sweep (not in the audit):

- All 25 area pages hardcode `"addressLocality": "Goshen"` in JSON-LD while
  `geo`/`areaServed` vary correctly. Fine if intended as business HQ;
  verify it wasn't meant to be the page city.
- `/pro/sandbox` is indexable **by accident** — not in the
  `firebase.json:235` noindex enumeration, no meta robots, in no sitemap.
- Free-guide opt-in: `window.__NBD_TURNSTILE_SITEKEY = ""` is still
  unpopulated (`inline/7cd8e505ab.js`) — the Turnstile order-of-operations
  item already queued in WEEKLY_CADENCE covers this; noting the touchpoint.
- Pro blog posts call the landing "Masterclass"; the landing sells a CRM.
  Free-guide body copy also says "NBD Pro Masterclass". Naming drift.
- `docs/pro/index.html` and `docs/pro/landing.html` are byte-identical
  files (same md5) — two URLs, one page, both in sitemap-pro.

## Pro visibility (Jo asked for a take)

The audit reads the pro funnel's invisibility as an oversight. The repo
says otherwise: it's a **designed posture** — the homepage footer link is
literally commented `<!-- ← THE SILENT PRO DOOR: visible only to those
looking for it → -->` (`docs/index.html:2379`), the pro blog noindex is
documented as brand separation (`firebase.json:221` — a homeowner
searching the brand should never surface contractor content), consumer
sitemap carries zero pro URLs by design, and no doc anywhere plans to
raise pro's consumer-side visibility.

What's *not* deliberate is that the top of the B2B funnel is sealed:
`/sites/free-guide` is noindexed AND its only inbound link is from
`/pro/landing` — the lead magnet is only reachable from the page it's
supposed to feed (the 2026-07 product audit's Break #1 fixed the
*exit* of the guide, not its *entrance*). Recommended framing: keep the
consumer/pro brand separation; fix the B2B funnel's own plumbing
(guide discoverability from pro surfaces, footer-partial consistency,
sandbox indexability decision, Turnstile key, Masterclass naming).

## What this means for the designer handoff

Safe to strike from the tracker: #1 (schema — done), #5 (blog schema —
done), most of #7 (images — done; vendor-JS check remains), #6 (hero —
mitigated). Genuinely worth doing: #10 analytics conversion events
(top pick — low effort, unblocks measuring everything else), #8 privacy
additions, #4 review-count + schema-policy decision, #3 homepage in-body
tools CTA, #9 incremental local depth on top-volume city pages, #2
reframed as B2B-funnel plumbing per above. New from this sweep: HowTo
on homepage "How It Works", Service/FAQPage on area pages,
`drone-completed-brick.webp` recompress, addressLocality check,
`/pro/sandbox` robots decision.

## Update 2026-08-15 (same session): Jo approved — fix wave shipped

Jo greenlit the recommended shortlist; shipped on the same branch:

1. **GA4 conversion events** — central `generate_lead` in
   `public-lead-submit.js` success path (covers all six public lead
   kinds; the estimate funnel's `_saveLead` routes through it too);
   `estimate_phone_verified` on OTP success; `visualizer_result`
   (with `ai_image` flag); GA4 bootstrap + `tool_click` tracker added
   to `/free-tools` (page had no analytics at all).
2. **privacy.html** — new "Free Tools and Interactive Features"
   subsection (Roof Score capture, estimate OTP flow, storm tools) +
   verification-codes paragraph in §5; Last Updated → August 2026.
3. **Homepage tools band** — in-body section after "How It Works":
   Roof Score / Instant Estimate / Storm Check / Visualizer cards +
   "all 7 free tools" link.
4. **review.html** — comment at ~:522 corrected to state the real
   policy: Review objects kept for AI readability; AggregateRating
   deliberately omitted (Google ignores self-serving rating markup).
5. **Footer pro door** — quiet "Are you a contractor? → NBD Pro" line
   added to `footer-standard` + `footer-area` partials, restamped into
   142 pages (matches footer-extended/footer-blog posture).
6. **Free-guide entrance** — linked from both navs, footer resources,
   and sidebar CTA of all 5 pro blog posts + index; "Masterclass"
   nav/footer labels for /pro/landing relabeled (in-app Real Deal
   Academy masterclass references untouched); `/pro/sandbox` added to
   the firebase.json app-shell noindex enumeration.

**Left open (deliberate, for Jo):** index the free guide or keep it
noindexed (kept noindexed for now); visible Google review count via
`getGoogleReviews` (needs a JS fetch on /review — worth its own pass);
Turnstile sitekey still empty (queued in WEEKLY_CADENCE); location-page
depth drip; HowTo schema + area-page Service/FAQPage;
`drone-completed-brick.webp` recompress; `addressLocality: "Goshen"`
in all 25 area pages' JSON-LD (verify HQ intent).

## Update 2026-08-17 (follow-up wave, second PR): review count + location depth

- **Live review count on /review** — discovery: `google-reviews-widget.js`
  was already wired on /review + 13 service pages and already renders the
  live total *in its own section*; the gap was only the static hero score
  box. The widget's existing fetch now also hydrates `[data-nbd-gr-rating]`
  / `[data-nbd-gr-count]` hooks on the hero (static "Verified on Google"
  text stays as the no-API fallback — count is never hardcoded).
- **Location-page depth drip, round 1** — "The <City> Roofs I Actually
  See" local-knowledge section added to `mason-oh` (Mason-Montgomery
  corridor boom subdivisions, Heritage Club / Crooked Tree HOA work,
  downtown core decking), `west-chester-oh` (Beckett Ridge second-roof
  cycle, Wetherington, Tylersville/Union Centre corridors, Olde West
  Chester), `batavia-oh` (village-core layered roofs + code limits, SR 32
  corridor claims, rural outbuildings on the same claim, county-seat
  permit office). Real place names, qualitative claims only — no invented
  stats per VOICE_BIBLE. **Remaining drip queue:** loveland, milford,
  anderson-township, blue-ash, cincinnati (already deepest), then the rest
  at 2-3 pages per session.

# PulseRelate recon + the /pro domain question — 2026-09-07

Triggered by an email from the owner of [pulserelate.com](https://pulserelate.com),
a restoration/construction CRM. Jo asked whether anything there was worth having.
The answer turned into a second, larger question — whether NBD Pro belongs on the
homeowner domain at all — and that is the part worth keeping.

Companion to the change on `feat/pro-faqpage-schema`: a `FAQPage` JSON-LD block
on `/pro`, plus the `@id`/`about` binding that makes it safe to have there.

---

## 1. PulseRelate is a strict subset of `docs/pro/`

All 15 features on their features page already exist here, usually deeper:

| PulseRelate | Ours |
|---|---|
| Project pipeline | `crm-pipeline.js`, `close-board.js`, `pipeline-builder.js` |
| Clients & leads | `crm-leads.js`, `prospects.js`, `lead-score.js`, `lead-dedup.js` |
| Schedule | `smart-calendar.js`, `booking-events.js`, `calendar-feed-ui.js` |
| Notifications + push | `notif-bell.js`, `push-registration.js` |
| Documents | `customer-documents.js`, `vault.html`, `nbd-doc-viewer.js` |
| Company documents | `templates-library.js`, `document-generator.js` |
| Team metrics | `leaderboard.html`, `rep-report-generator.js` |
| Owner reports | `profit-tracker.js`, `money-dashboard.js`, `forecasting.js` |
| AI assistant "with usage limits" | `claudeProxy` — per-day token budget, per-uid **and** per-IP rate limits, payload caps |
| Multi-tenant / branded / PWA | `docs/sites/`, `company-profile.js`, `manifest.json` |

Not on their site at all: e-sign, Xactimate catalog estimating, supplements,
insurance claim tooling, photo AI, storm center, D2D canvassing, maps/routing,
voice intelligence, customer portal, Stripe invoicing, review engine, warranty
certs, referral rewards, the academy.

**The one real gap: internal team chat.** They have member-to-member messaging
with unread counts. We have none — `nbd-comms.js` is entirely customer-facing
(Resend/Twilio outbound), and `talk-tank.js` is a voice-capture inbox, not a
chat. Whether it is worth building is a separate call; a crew this size solves
it with a group text.

**Not worth copying — and the reason is a correction.** Their GAF Quick Measure
integration looked like the one idea to steal, on the assumption QuickMeasure is
free for GAF-certified contractors (we are, `#1162011`). Checked before
recommending it: **QuickMeasure starts at $18/report**; "free for certified
contractors" is a discount, not free. Instant Roofer at $3/address is already
cheaper, and `integrations-client.js:99` already carries the two-tier
instant-vs-certified concept. No change warranted.

**Where they genuinely beat us: marketing surface, not product.** Six indexed
pages to our four, `FAQPage` schema they had and `/pro` did not, trade-specific
use-case pages, and a demo form that qualifies (office headcount, field
headcount, current tooling). We publish pricing and they do not — that one is
ours to keep.

---

## 2. What shipped on `/pro`

A `FAQPage` block mirroring the six visible FAQ entries verbatim, extracted
programmatically rather than transcribed, and verified in a real DOM: schema
text `===` rendered text for all six questions and all six answers, with the
`aria-hidden` `+` toggle and two inline HTML comments correctly excluded.

**Then a second edit, which is the one that mattered.** Adversarial review found
the block declared **no subject at all** — no `@id`, `about`, `isPartOf`,
`publisher` or `mainEntityOfPage` — while the page's graph chains:

```
SoftwareApplication --author--> Person "Joe Deal" (/about)
                                   --worksFor--> RoofingContractor "No Big Deal Home Solutions"
```

So six subject-less assertions — including `$149/mo` and the competitor price
claim — sat on a page whose entity chain reaches the roofing business. Fixed by
giving the `SoftwareApplication` a stable `@id`
(`https://nobigdealwithjoedeal.com/pro#nbd-pro`) and pointing the `FAQPage`'s
`about` at it. The answers are now explicitly about the software product.

This is a **deviation from house convention and a deliberate one**: none of the
other 177 `FAQPage` blocks under `docs/` carries a binding property, because on
a homeowner page the page subject and the domain entity are the same thing.
`/pro` is the one page where they differ.

---

## 3. The domain question — answered: don't buy one yet

### The separation already exists, and it was designed

- `docs/sitemap.xml` — **zero** `/pro` URLs, with an in-file comment saying
  mixing audiences "dilutes topical focus for both"
- `docs/sitemap-pro.xml` — exactly 4 URLs
- `/pro/blog` (6 posts) and 25 app pages — noindexed, `X-Robots-Tag` authoritative
- `docs/llms.txt:72` — NBD Pro under "**Secondary Product**"

Only **4 of 35** `/pro` pages are indexable. This was re-affirmed on 2026-08-15
when an outside designer's audit read `/pro`'s low consumer-side visibility as
an oversight and in-repo verification ruled it a **"designed posture."** Nothing
in `documentation/` has ever proposed a second domain — every "own domain"
discussion in the vault is about tenant microsites (Pillar 5 / Oaks), a
different problem, and Jo deferred even that on 2026-07-04.

### Cost if we do it anyway

**7–11 focused working days** (2–3 calendar weeks solo), plus a months-long tail
of dead links in already-sent emails.

**The biggest gotcha: `/pro` is not a clean seam.** It holds *homeowner-facing*
document surfaces — `esign`, `portal`, `estimate-view`, `invoice-success`.
Moving `/pro` wholesale would route homeowners onto the B2B SaaS domain to sign
their roofing contracts, while `/deal`, `/share`, `/report` and `/calendar` stay
on the apex. 8 server-side link bases hardcode the apex and 5+ client paths use
`location.origin`, so the two would disagree after a split. If it ever happens:
**move only the 4 public acquisition URLs, leave the app on the apex.**

### The real coupling lever is not schema

**218 homeowner pages link to `/pro`** from four generator-owned footer partials,
on a 243-page site. That is the entanglement, by two orders of magnitude — and
it is one restamp to unwind. Any future dilution worry should start there.

---

## 4. Where the reasoning was wrong

Recorded because three of these would have changed the recommendation.

- **"Free rich-result eligibility"** — wrong. Google **deprecated FAQ rich
  results entirely on 2026-05-07**, not merely narrowed them to gov/health. The
  remaining value is AEO/Bing/AI-crawler machine-readability — which is in fact
  the documented house strategy: `local-seo-playbook-2026-07.md:21-24` says
  "Bing's index feeds ChatGPT search, which is where the national leads are
  coming from."
- **"Eight FAQ items"** — six. The grep counted CSS selectors.
- **"A second FAQPage on the domain"** — off by 176. There are **177**, of which
  171 are homeowner-facing. `/pro` was the outlier, not the innovator.
- **An agent reported the new JSON was "missing its closing brace... 100%
  inert"** and made that its blocker for a `hold` verdict. **False** — both
  blocks parse, in Node and in a real browser. A `hold` resting on it was void.
- **An agent cited a `firebase.json` comment** about contractor content being
  "walled off from the No Big Deal HOMEOWNER brand" as proof `/pro/index.html`
  violates a settled policy. The quote is real but scoped to **`/pro/blog` only**
  (`firebase.json:242`), and its stated reason is that the blog "is not an SEO
  play." `/pro` is the documented opposite. Scope-check quoted config before
  treating it as policy.
- **"Zero edges to the RoofingContractor entity"** — wrong, and catching it is
  what produced §2's fix. The `Person.url` join edge is exact-string.

---

## 5. Open items

1. **The "one-third the price of JobNimbus/AccuLynx" claim has zero
   substantiation anywhere in this repo**, and the HTML comment directly above
   it concedes it "is unverifiable from this repo." It now also sits in
   structured data, where it is more liftable verbatim *without* its hedging
   context. Comparative advertising naming two live competitors on price is a
   business decision, not an SEO one. It appears in at least four places —
   change them together.
2. **`scripts/check-seo-surface.js` skips `docs/pro`** (`SKIP_DIRS`, line 76),
   so `/pro` structured data ships with no CI validation — pre-existing, since
   the `SoftwareApplication` block was already unvalidated. Un-skipping
   wholesale costs **33 errors** on app pages that correctly are not search
   surfaces (verified by running it). A scoped fix covering only the 4
   `sitemap-pro.xml` pages is cheap: those produce **zero** errors today.
3. **The SOC 2 sentence** — "hosted in Google Cloud's SOC 2–certified data
   centers" is true of Google and does not claim NBD Pro is certified, but sits
   one clause from being read that way. Visible copy and schema must change
   together.
4. **Internal team chat** — the one PulseRelate capability we lack. Unbuilt, and
   deliberately so until someone asks for it.

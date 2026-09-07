# Instant Roofer — second pass over the whole product surface (2026-09-07)

Jo: "look at instantroofer.com again and see if there's anything else on site
worth using or integrating. I thought it was all free other than the reports
but it's actually 99/mo for the whole tools suite package."

Follow-up to [SESSION-2026-09-06-instantroofer-adapter](../projects/SESSION-2026-09-06-instantroofer-adapter.md),
which evaluated the vendor as a *measurement provider* and shipped that. This
pass walked every page linked from the homepage nav and footer — the eight
product pages, the three premium-service pages, `/instant-roofer-api/`,
`/accuracy/` — looking for surface the adapter session never opened.

## Price correction: it is $199/mo, not $99

Every price surface says **$199/mo per office location**: the homepage hero,
the "replace legacy subscriptions" band, the bundle-inclusions block, the
final CTA, and the leads FAQ. Yesterday's session note recorded $199 as well.

Checked rather than eyeballed: fetched all 13 product/service pages from the
site's own origin and regexed every `$NN/mo`-shaped string. Eleven pages
quote a monthly price and **all eleven say 199**; `/online-payments/` and
`/book-a-demo/` quote none. **Zero occurrences of $99 anywhere.**

If Jo saw $99 it was in-dashboard
(there is a bundle trial on `dashboard.instantroofer.com`) — a promo or an
annual-equivalent rate, not the published price. **Worth confirming before
any decision is priced off $99.**

It does not change the verdict either way: the bundle was rejected at $199 on
duplication grounds, not on price, and $99 would not change that.

## The finding: the lead program is free to join and is NOT in the bundle

`/roofing-leads/`, which the adapter session never opened. Their own FAQ,
verbatim:

> **Are Instant Roofer leads part of the AI Tool Bundle?** No. Leads from
> InstantRoofer.com are a separate program. The AI Tool Bundle ($199/mo)
> includes the Website Calculator, Contact Form, and Instant Measure Reports.
> Leads from InstantRoofer.com are free to start and you only pay per lead if
> you upgrade to the paid program.

So the assumption that the lead channel was gated behind the bundle — the
reason it was never costed — is wrong. Mechanics:

- **Free to join, free leads immediately on signup.** Paid tier is opt-in.
- **$30/lead floor, self-priced.** A "Lead Maximizer" sets price per lead per
  material and shows what it costs to rank 1st / 2nd / 3rd in a service area.
  Rank drives volume.
- **1-to-1 consent, max 3 contractors shown.** Their own distribution:
  ~80% of homeowners select one contractor, ~15% two, ~5% three. Contrast
  with shared-lead sellers at up to 16.
- **Self-credit any lead within 4 days, one click, any reason** — they charge
  on day 4. The downside on a bad lead is capped at the effort of clicking.
- **Every lead ships with a full Instant Measure Report** — footprint, pitch,
  area, waste, recommended squares, 3D view. The $3 measurement is included
  in the lead price.
- **Zapier is the CRM integration surface.** No native API for lead delivery.
- **Google reviews are shown to the homeowner** next to the price and drive
  selection, so NBD's review count is a direct input to win rate here.

Why this is the one item that does not collide with `docs/pro/`: it is a
demand channel, not software. Everything else in the bundle duplicates
something NBD already runs; a lead does not.

**Two things to think about before signing up, not blockers:**

1. **It publishes NBD's retail pricing beside two competitors.** The homeowner
   sees an estimate built from NBD's per-material rates before choosing.
   That is retail, so it is outside the cost/margin invariant in CLAUDE.md —
   but it does make NBD's pricing directly comparable in-market.
2. **A lead arriving with a measurement must not re-trigger a paid measure.**
   `measureNewWebLead` is gated to bridged estimate leads carrying
   coordinates, so a Zapier-delivered lead almost certainly falls outside the
   gate today — but if the Zap writes into `leads/`, that gate is the thing
   to re-read before wiring it, not after.

## Already-paid-for data that nothing reads

`normalizeAiResponse` in `functions/integrations/instantroofer-logic.js`
parses more than the CRM shows. Grepped for production readers of each:

| Field | Sample value | Readers outside the parser, tests and the runbook |
|---|---|---|
| `perimeterLf` | 262 | none |
| `stories` | 2 | **`publicSummary` only** (`public-measure.js:79`) — see the correction below |
| `isTownhome` | true | none |
| `isCommercial` | false | none |
| `footprintSqft` | 3215 | none |
| `suggestedSqft` | 4006 | none |

### Correction, same day: `stories` is worse than unread — it is unwired *from the thing that prices it*

The first pass of this note put `stories` in the "no readers" column. That is
wrong, and the truth is more expensive. `stories` **is** read by
`publicSummary` (`public-measure.js:79`) for the public wizard. What it is not
wired to is the estimate builder — where it sets a price:

- `docs/pro/js/estimate-builder-v2.js:921-923` — `stories >= 3` charges
  `threeStoryPerSq`, `stories === 2` charges `twoStoryPerSq`, else zero.
  `tests/estimate-pricing.test.js:289-293` pins those at **$15/SQ for
  two-story and $30/SQ for three-story**, tiered rather than additive.
- `docs/pro/js/estimate-v2-ui.js:2883` feeds `state.measurements.stories`
  into that pricing context.
- `state.measurements.stories` **defaults to `1`**
  (`estimate-v2-ui.js:87`, `:1590`, `:1608`).
- `applyMeasurementResult` (`estimate-v2-ui.js:1436-1446`) builds its `next`
  object from `rawSqft`, `ridgeLf`, `eaveLf`, `hipLf`, `valleyLf`, `rakeLf`,
  then `pitch`. **`stories` is not in it.**

So pressing 📐 Auto-measure on a two-story house returns `stories: 2`, stores
it, shows it to the *homeowner* in the public wizard — and leaves the estimate
priced as one-story. On a 20-square roof that is **$300 not billed**; a
three-story is **$600**. The rep has to notice and set the dropdown by hand,
with the correct answer sitting one field away in the response.

Note also what `applyMeasurementResult` *does* map: five linear-feet fields
(`ridgeLf`/`eaveLf`/`hipLf`/`valleyLf`/`rakeLf`) that an **AI report never
returns** — they arrive only on the $10 human report. Against an Instant
Roofer AI result the mapper effectively applies two fields, `rawSqft` and
`pitch`, and no-ops on the rest.

One caution before wiring it: the vendor marks `stories` beta/estimated, and
the code comment already says so. Letting a beta field silently move a $300
line is a different risk from letting it prefill a control the rep confirms.
That trade-off is the open design question, not whether to use the field.

These arrive in every $3 call and are already persisted — the marginal cost
of surfacing them is zero. The *features-exist-but-unmounted* pattern again,
and the same shape the adapter session caught for `measurementReady` and
`measurementJobId` before shipping.

What each is actually worth here:

- **`perimeterLf` closes part of the linear-feet gap** the adapter session
  filed as follow-up #2 (human-report CSV) and #3 (API V3). Perimeter is not
  an eave/rake split, but drip edge and gutter are commonly priced straight
  off perimeter — so one already-present number covers a line the V2
  builder currently has no measured input for.
- **`stories`** feeds the access/steep labor factor. Their own docs mark it
  beta and the code comment already says "an estimate" — advisory, not a
  pricing input on its own.
- **`isCommercial` / `isTownhome`** are routing and disqualification signals.
  A townhome changes scope materially and is worth a flag on the lead card
  well before anyone quotes it.

## Volume pricing — confirmed, and the runbook already had it right

`/instant-roofer-api/` publishes these tiers. An earlier draft of this note
claimed the runbook recorded a flat $3 and needed correcting; that was wrong —
[INSTANTROOFER-SETUP](../runbooks/INSTANTROOFER-SETUP.md) line 182 already
carries the full tier table. It is the 2026-09-06 *session note* that says
"$3/address" in passing. No doc needs changing; recorded here only so the next
person does not re-derive it:

| Addresses / month | Per address |
|---|---|
| 0–199 | $3 |
| 200–999 | $2 |
| 1,000+ | $1 |

At NBD's volume (~32 leads/month all-sources, per the adapter session's own
upper bound) this stays at $3 and changes nothing today. It matters to one
open idea: measuring *every* public-funnel visitor rather than only leads
gets cheaper per unit as it scales, instead of linearly worse.

## Checked and clean — no action

The published confidence buckets are **Low < 0.24, Medium 0.24–0.34, High
>= 0.35**, and their own sample payload shows `score: 0.36` displaying
"High". That is counterintuitively low if you read the score as an ordinary
0–1 probability, and a naive threshold would have flagged nearly every
measurement as low-confidence. `confidenceLabel()` matches the published
buckets exactly, prefers the API's own `display.value` when present, and the
public wizard only ever renders the caveat for a non-High result. Verified,
nothing to change.

## Assessed and still not worth it

- **The $199 bundle** — unchanged from yesterday. CRM, quoting, e-sign,
  scheduler, contact form and website calculator each duplicate something in
  `docs/pro/` or the public funnel, and the embed would need a CSP
  allow-list change plus hand the homeowner's first interaction to their
  script.
- **Online Payments ($4.99/transaction).** The rate is genuinely good — flat
  $4.99 plus standard Stripe fees, no monthly, ACH as well as card, Stripe
  Connect paying out under the contractor's own name, QuickBooks sync. But
  `/online-payments/` states the constraint plainly: *"Online Payments only
  attaches to quotes built in our platform."* It is a premium add-on to
  **their** Quote Generation, so taking it means abandoning NBD's estimate
  and e-sign flow. Hard no as an integration — but the *pattern* is worth
  copying: Stripe Connect plus **ACH on large deposits** is where the saving
  actually lives, not in the $4.99.
- **Photo & Video Capture, Website Calculator, Contact Form, Online
  Scheduler** — bundle-only, and each duplicates a live NBD surface
  (`/estimate`, the public forms, Cal.com, the CRM photo queue).

## Free marketing asset: the `/accuracy/` page

Citable, vendor-published figures, useful as supporting copy now that the
public funnel ships real measured estimates:

- Mean Absolute Error **54 sqft** against 7,000+ manually measured roofs
  ("less than 2 bundles of shingles"), ~98% accuracy.
- **32 sqft** average error on roofs under 1,300 sqft.
- Error down from 231 sqft in 2024 (−77%); stated target 33 sqft by Jan 2027.
- Method is stated: MAE against professionally hand-measured roofs, broken
  out by size, region and complexity.

NBD's ToS obligation ("Powered by Instant Roofer" on visible indexable pages
using the tech) already ships on the results page, so the attribution that
makes citing these numbers natural is in place.

Also noted, not actionable: their free `/roof-pitch-calculator/`,
`/roof-financing-calculator/` and six per-material cost calculators are
direct SEO competitors to NBD's estimate funnel.

## What shipped — branch `feat/instantroofer-field-wiring`

A five-lens adversarial sweep over the adapter, the estimate engine and the
spend paths returned 59 findings; 16 were verified by three diverse refuters
each. **43 were never verified** — they sat below the verification cap and are
neither confirmed nor refuted. The four acted on:

**1. The homeowner's web quote was ~15% too high.** This is the one that was
already live, and it is not a missed opportunity — it is a wrong number in
front of customers. `publicSummary` passed the vendor's `squares` through
whenever it was present. That field is `sqft.suggested / 100`, the vendor's
material-order figure with waste **already added**; the wizard then multiplies
it by `PRICING.roof` bands that are themselves `rate × 1.12 .. rate × 1.25` —
the CRM's own pitch waste factor, baked in and documented as such at
`docs/assets/js/inline/4053149b2f.js:61-76`. Waste counted twice. On the
vendor's documented sample roof the "better" tier read **$26,675–$29,875**
instead of **$23,150–$25,950**, an overstatement of **$3,525–$3,925** — and
the *floor* of that band sat about $2,845 above what the rep's own CRM can
quote the same roof for, which is precisely the "price jump between screens"
the PRICING block says it exists to prevent. It was inconsistent three further
ways: with the `sqft` printed beside it on the same card (3,483 sq ft next to
"40.1 squares"), with the kanban chip's stored `measurementSqft`, and with its
own fallback branch — so the same house priced 15% apart depending on whether
one optional vendor field happened to be present. Now always derived from
`rawSqft`, which is what the bands expect.

**2. `stories` reaches the estimate.** The gap named above: measured on every
call, priced at $15/SQ (two-storey) and $30/SQ (three-storey), never mapped.
Filled **only while the control is still at its untouched default of 1** — the
vendor flags the field beta, and overwriting a storey count a rep chose by hand
would invert the bug and strip $600 off a corrected quote. Clamped to the 1–3
`#v2stories` offers, because `syncMeasurementInputs` blanks a select on any
value not in its option list.

**3. The vendor path was the one measurement path that never cleared
`_reopenedClean`.** `updateMeasurement` (`:1202`) and
`applyImportedMeasurements` (`:3741`) both clear it with an explicit "a
measurement change → re-resolve live" comment; `applyMeasurementResult` did
not. On a reopened estimate `effectiveEstimate()` therefore kept replaying the
saved rows: the builder pane showed the new numbers while Preview, the
presentation view, Save and the deal room all kept the old ones — and a save
afterwards wrote the **new pitch beside the old square footage**. Without this
one line, fix 2 would not have reached a reopened quote at all.

**4. The measured facts are visible.** Storeys, perimeter, facet count,
complexity and vendor waste now read out on the Auto-measure status line, and
a `isCommercial` / `isTownhome` classification is raised as a scope warning
instead of being discarded. Previously reading any of it meant opening the
Firestore document.

**Testing.** `tests/instantroofer-field-wiring.test.js` — 20 assertions that
slice `applyMeasurementResult` out of the source and run it in a `vm` sandbox
against a stub state, because this repo has a documented history of
regex-shape tests passing with the bug present. Three regression assertions
added to `tests/public-measure.test.js`. **Every fix was break-tested**: the
squares fix reddens exactly 4 assertions, the storey mapping exactly 3, the
reopen flag exactly 1, and nothing else moves. Two of my own assertions failed
on first run for being sloppily scoped (a file-wide `<option value="4">` check
that matched a different select, and a CSP regex too broad for a 4,000-line
file); both were tightened rather than deleted. Full node bucket, smoke
(3,638), and the adjacent estimate suites all green.

## Recommendation

1. **Sign up for the free lead tier.** It costs nothing, it is the only
   surface here that does not duplicate `docs/pro/`, and the 4-day
   self-credit caps the downside if the paid tier is tried later.
2. ~~Surface the unused fields~~ — **done**, plus two money bugs found on the
   way that were worth more than the original ask.
3. **Leave the bundle alone** at $199 or $99.

## Open questions for Jo

- Where did the $99 appear? If it is a live in-dashboard offer it is worth
  capturing, even though it does not change the verdict.
- Free-tier lead volume in the Cincinnati service area is unknown — nothing
  on the site quantifies it, and it is rank-dependent by design.

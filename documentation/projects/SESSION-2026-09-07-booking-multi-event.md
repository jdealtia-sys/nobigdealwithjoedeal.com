# Session 2026-09-07 — one booking link became six, and the resolver got a tenancy guard

Branch: `feat/booking-events-multi` · commits `a5a1ae75`, `496847f0`

Jo's ask: "we only have the free roof inspection — add more than one and
place the best links where we can. If we had the option to pick that would
be fantastic but I don't think that is possible." Then: overhaul the full
customer page, the homeowner link page, and the public homepage.

---

## The premise was wrong in a useful way

The cal.com account (`nobigdeal`) already published **three** public event
types, not one:

| Event | Slug | Links on the site before this session |
|---|---|---|
| Free Roof Inspection (30m) | `roof-inspection` | **338** |
| Free Roof Inspection — Lexington & Central KY (30m) | `roof-inspection-lexington` | **18** |
| 15-Minute Roof Question Call (15m) | `roof-question-call` | **0** |

`roof-question-call` was written, live, bookable, and linked from nowhere on
the whole site — complete working capability with zero callers, the same
pattern the [2026-09-04 stability audit](../audit/STABILITY-AUDIT-2026-09-04.md)
kept turning up. Three
further event types exist but are hidden (`secret`, `30min`, `15min` — the
cal.com defaults).

**And picking is not only possible, it already worked.** `cal.com/nobigdeal`
is a live page listing every public event type with description and
duration, and it embeds with `?embed=true` exactly like a single event does.
No plan tier, no routing form, nothing to build. That answered Jo's question
before any code was written.

## Three new event types (created in the Cal.com UI, this session)

Chosen to fill funnel gaps, not to pad the menu. Every existing event served
stage **New**; nothing served the middle of the pipeline.

| Event | Slug | Duration | Location | Fills |
|---|---|---|---|---|
| Insurance Adjuster Meeting | `adjuster-meeting` | 60m | In Person (Attendee Address) | Inspected → claim. Matches the `hail-damage-insurance-claim` page's actual promise ("Joe Deal meets your adjuster") |
| Estimate Walkthrough | `estimate-walkthrough` | 30m | Attendee phone number | Stage "Estimate Sent" had no bookable next step at all |
| Gutters & Siding Estimate | `gutter-siding-estimate` | 30m | In Person (Attendee Address) | ~32 gutter/siding pages whose CTA booked a *roof* inspection |

Location settings mirror the existing `roof-inspection` (verified in its
setup tab, not assumed). Phone events use *Attendee phone number* so Joe
calls them, matching the 15-minute call's "I will call you" copy.

**Deliberately NOT created: an emergency/tarping event.** `emergency-roof-
tarping.html` says "Call Joe", and a calendar slot is the wrong tool for
water coming through a ceiling. `/book` says so explicitly instead.

## What shipped

### Marketing (`a5a1ae75`)

- **`docs/book/index.html`** — the hub. Grouped by where the homeowner
  actually is: *Start Here* / *Already In a Claim or Holding an Estimate* /
  *Everything Else*. Built by copying the `free-tools` skeleton so the
  generator-owned marker regions stay byte-exact.
- **Homepage** — hero and how-it-works CTAs now point at `/book`; a three-up
  band before `#contact` leads with inspection / question call / adjuster.
- **32 gutter & siding pages, 60 anchors** repointed at
  `gutter-siding-estimate`, label "Schedule Inspection" → "Schedule Estimate".
- **`booking-clicks.js`** — GA4 `booking_click` carrying the slug, so the
  next session can see which visit types people actually pick.
- `/book` added to `CORE_PAGES` in `build-sitemap.js` at 0.9. **The sitemap
  is a curated list, not a glob** — a new top-level page is silently absent
  until it is added there, and the drift check reports "zero diff" while the
  page is missing. Worth remembering.

**`hail-damage-insurance-claim.html` deliberately keeps the inspection as
its primary CTA.** The first draft swapped it to `adjuster-meeting`; that is
wrong, because most visitors to a "do I have a claim" page have not filed
yet, so an adjuster meeting presumes a step they have not reached. Its
secondary link now offers the whole `/book` menu instead.

### CRM + portal (`496847f0`)

**A real defect, found on the way.** `customer-bootstrap.module.js` resolved
the booking link as:

```js
const calUser = calSettings.username || 'nobigdeal';
```

No tenant check at all. This is the *exact* bug `crm-portal-bridge.js`'s
`_repBookingUrl()` carries a comment about having fixed — "a contractor who
never configured Cal.com texted his homeowner a link to the platform owner's
calendar, and every booking landed there" — and the fix landed in one file
while the sibling one directory over kept the bug. It also read only
`localStorage`, which `purgeAccountStorage()` wipes on every logout.

`docs/pro/js/booking-events.js` is now the single resolver for both surfaces.
Resolution order, highest first:

1. `rep.calcomEventSlugs[kind]` — explicit per-kind config, any tenant
2. `kind === 'inspection'` → the rep's existing single `calcomEventSlug`
   (so every tenant's current behaviour is byte-identical)
3. NBD tenant only → the house catalog
4. `''` — unavailable; callers decline to send rather than invent a link

A tenant with nothing configured now gets **no buttons** instead of Joe's
calendar. A tenant with one slug sees one option and no dropdown (options
are deduped by resolved URL). NBD sees all six.

- **Customer page** — a visit-type picker, defaulted by `suggest()`:
  estimate walkthrough when an estimate is out unsigned, adjuster meeting
  when a claim is live, gutters/siding off `damageType`. The SMS and
  clipboard copy now name the visit being booked.
- **A gate that never fired**: booking buttons were shown for
  `['new','contacted','inspected']` compared against a raw `lead.stage`, but
  the pipeline writes **capitalised** stages (`'New'`, `'Estimate Sent'`) —
  so `earlyStages.includes('New')` was always false and the buttons never
  appeared for pipeline-created leads. Normalised, and opened to every
  non-terminal stage.
- **Portal** (the homeowner link page) — the booking card follows the job. A
  homeowner sitting on an unsigned estimate is offered the estimate
  walkthrough, not another roof inspection; the rep's other visit types list
  underneath. Falls back to the server-resolved `view.bookingUrl` if the
  catalog is unavailable. `functions/portal.js` passes `calcomEventSlugs`
  through.

## Testing — and a break-test that mattered

`tests/booking-events-tenancy.test.js` (30 assertions, node bucket,
vm-sandboxed so the real branching runs rather than a regex over source).

**The obvious test did not cover the guard.** "Non-NBD tenant with nothing
configured" passes whether or not the house-username guard exists, because
`slugFor()` returns `''` in that case anyway and `urlFor()` is empty either
way. Deleting the guard kept the suite green. The case that *does* cover it
is a tenant with a per-kind slug and **no username** — with the guard
removed that yields `https://cal.com/nobigdeal/acme-adjuster`. That case is
now in the suite, and removing the guard reddens exactly its three
assertions. The general rule this is an instance of: proving a gate *can*
fail is not enough — check **which** assertion reddens, because a break that
reddens a different one than expected means the case you thought you covered
is uncovered.

The smoke suite's `portal.html embeds Cal.com iframe` assertion was a single
`/cal\.com.*embed=true/` over one literal line. That line no longer exists —
the URL comes from `booking-events.js` and `portal.js` only appends the embed
params. `readPortal()` now joins `booking-events.js` too (its own comment
says it exists so assertions survive code moving between files), and the
assertion was **split across the files that jointly own the contract** rather
than loosened to a bare substring, plus a new one pinning the wiring
(`const embedSrc = primary.url +`). Breaking `embedSrc` reddens both, and
only those two — verified, then restored with `git checkout --`.

## Gates

`check-js-syntax` (495), `check-inline-html-scripts` (0 inline scripts),
`apply-partials --check` (647 regions clean), `check-site-integrity` (243
pages, 26,930 refs, 0 failures), `build-sitemap` zero-drift at 224 URLs,
`run-test-manifest --check` (node:77), `marketing-polish-contract` 53/53,
`tests/smoke.test.js` **3638 passed / 0 failed**.

## Left for Jo

- **The `/book` page is new and unlinked from the nav.** The homepage,
  32 service pages and the claim page reach it, but the main navigation
  still sends "Book Inspection →" to `/#contact`. Worth deciding whether
  the nav should point at `/book` — that is a `site-src/partials/` edit,
  not a page edit.
- **Per-tenant event slugs have no settings UI yet.** `calcomEventSlugs` is
  read everywhere and written nowhere; a non-NBD contractor still gets one
  option. The dashboard's Schedule → Your Booking Link panel is where it
  would go.
- Watch `booking_click` in GA4 for a couple of weeks before adding more
  event types — the whole point of the slug parameter.


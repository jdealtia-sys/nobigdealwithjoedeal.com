# Next session — brief as of the end of 2026-09-04

**This is the marketing/site lane.** The CRM lane's brief
([NEXT_SESSION-2026-09-04](NEXT_SESSION-2026-09-04.md)) is still the reference
for everything under `functions/` and `docs/pro/`, **and it is live, not
superseded** — it was rewritten in place on 09-03 (PR #1376) after a
verification sweep refuted several of that session's own claims. Its §Top of
the list opens with *confirm the scheduled Firestore backup actually ran*, and
its §Do not rebuild on these, §Corrections, §Blocked on a Cloud Functions
deploy window and §Needs a decision are all open. **Read that file first if
your work is CRM-side.** Nothing below touches any of it.

> Merged into this branch at close (`origin/main` → 3 commits, no conflicts),
> so the gate numbers below are measured on the merged tree. That merge also
> brought the `FLOORS` ratchet raise in `scripts/run-test-manifest.js` whose
> own comment says *"KEEP THESE IN STEP with the real counts whenever a suite
> is added"* — this branch adds one suite, so the floors go 51/65/130 →
> 52/65/131 here. **If you add a suite, raise them again in the same PR.**

---

## What happened

A homeowner at 5760 Farm Field Dr, Mason called about **wood siding repair**.
She found NBD by searching, then clicking through Google's *more similar
searches*. Jo's question was the right one — *"let's look at our site and see
what is working and what we can do even better or more of"* — and the answer
was uncomfortable: **she found us in spite of the site, not because of it.**
"wood siding repair" appeared on **zero pages**. So did wood rot, rotted
siding, fascia repair, clapboard, T1-11 and board-and-batten. All twelve siding
pages were vinyl-first.

The same shape then turned up twice more in one session. Full write-ups:
[WOOD-SIDING-GAP](../audit/WOOD-SIDING-GAP-2026-09-03.md) ·
[SHED-OUTBUILDING-GAP](../audit/SHED-OUTBUILDING-GAP-2026-09-03.md).

> ### The finding worth carrying past this session
>
> **`/our-work` is running ahead of `/services`.** Jobs get done, photographed
> and published — and nothing ever goes back to ask whether the site *sells*
> the thing the job proves. Three services were being delivered and published
> while no page offered them. Whoever publishes the next batch of cards: read
> the service tags on what you just published and diff them against
> `docs/services/`. That diff is a content backlog nobody is currently reading.

## Shipped — PR #1373, branch `claude/wood-siding-site-review-25ivvp`

Fourteen commits. Seven new pages, one new CRM contract test, two generator
fixes, one CI fix.

**The wood cluster (6 pages).** A hub plus five tier-1 cities. Each city page
was written from *that town's* housing stock, not from a template — the angles
are deliberately non-overlapping so the pages don't cannibalise each other, and
the table is here so the next city page doesn't repeat one:

| Page | The angle |
|---|---|
| Mason | **Where** the wood is — behind the vinyl (fascia, soffit, trim) |
| Loveland | **What material** — cedar vs wood fiber, valley shade and grade |
| West Chester | **Why** it rotted — a missed detail, a past re-roof, the HOA |
| Batavia | **The wood itself** — old-growth worth saving, exposure, insulation plugs |
| Cincinnati | **Reaching it** — hillside/upper-story access, protection first |

36 FAQ questions across the six, **zero repeats** (checked programmatically).
The Cincinnati angle was not the one predicted — the guess was "which era are
you in" and `/our-work` corrected it: two already-published Cincinnati jobs
(*"one piece worked loose three stories up"*, *"roof protection down before the
ladders went up"*) said the wood there is not hard to fix, it is hard to reach.

**Anti-drift construction, reusable.** Every new page generates its visible FAQ
HTML **from its own `FAQPage` JSON-LD**, so the two cannot diverge. Edit the
JSON-LD; the HTML follows. This caught British spellings repeatedly (`colour`
×5, `realise`, `grey`, `neighbours`, `mobilisation`, `recognise`, `storey` ×6)
— each appearing in *both* copies, which is exactly what deriving one from the
other is for.

**Sheds & outbuildings.** A hub page plus a published Mason shed re-roof card;
three older jobs retagged. Four outbuilding roofs had been done and published
with no page offering the service.

**City pages can carry proof strips.** The `OURWORK-STRIP` marker works on any
`docs/services/*.html`. **No city page had ever carried one** — ~90 city pages
with zero photographs on them. Six now do.

## Two things this session got wrong, and how

Both are recorded in full because the *mechanism* is reusable, not just the fix.

**1. Four false claims published on the shed card** (fixed `6509bc0`,
[SHED-OUTBUILDING-GAP §4b](../audit/SHED-OUTBUILDING-GAP-2026-09-03.md)).
The card asserted water staining around old fasteners, roofing bagged and
staged on tarps, a clear yard, and a "stripped" slope. All four false — proven
by cropping and enlarging the disputed regions: the deck marks are glossy
asphalt residue *on top of* sound pale OSB, the roofing lies loose on grass and
leaf litter, and the hero frame itself shows bundle wrappers on the lawn.

> **The root cause was a process bug, not a bad agent.** The drafting
> workflow's FACTS block was written from one quick read of the photos. Four
> drafters and three judges then worked faithfully — the judges caught every
> fabrication introduced *on top of* the brief. But **a judge panel measures
> candidates against the brief, so a wrong premise passes through untouched.**
> The verification workflow caught all four, because its agents read the images
> themselves and were told to *refute*. Brief-checking and candidate-checking
> are different jobs; a panel only does the second.

**2. Append-only rot in this session's own note** (fixed `4429853`). §1 of the
shed note still asserted what §4b had disproved. Corrected in place with a ⚠
marker — the exact defect CLAUDE.md names.

## Jo's queue — nothing here is engineering

1. **GBP services.** Paste-ready, verified under the 300-char limit, no editing
   needed: [gbp-services-2026-09-03](../marketing/gbp-services-2026-09-03.md).
   The site now sells **wood siding repair**, **fascia and soffit**, and **shed
   and outbuilding roofing**; **GBP lists none of the three**, and the service
   list is an input to which related searches the profile appears in — which is
   precisely how the Mason caller arrived. There is no Business Profile
   connector, so this is a live-in-Chrome job. It also carries a **carried
   item nobody has closed**: the 08-31 Hyde Park → Lexington service-area swap
   was left *"pending, up to 10 minutes"* and no session has confirmed it since.
2. **The Mason caller's three photos.** Rotted painted fascia with holes, a
   fascia/gutter rot spot, an aluminum-wrapped corner. Strong `/our-work`
   candidate — needs consent and the
   [PUBLISH-PROJECT](../runbooks/PUBLISH-PROJECT.md) runbook.
3. **RRP certification.** Jo, 2026-09-04: *"I'm not yet RRP certified."* See
   the next section — this one has a deadline shaped like a phone call.
4. **`Locally Owned — "Goshen, OH — your neighbor"`** is live on six pages
   (`services/roof-repair`, `roof-replacement`, `siding-repair`,
   `siding-replacement`, `gutter-replacement`, `storm-damage`). Jo lives in
   Cincinnati; Goshen is the warehouse. Jo's call whether that line stays.
5. **The homepage lead tile is a backyard shed.** The Mason shed card is now
   tile 1 of *"Real Roofs. Real Neighbors."* Flagged, deliberately not decided.

## The RRP constraint — read this before touching a wood page

Full note: [RRP-LEAD-PAINT-CONSTRAINT-2026-09-04](../audit/RRP-LEAD-PAINT-CONSTRAINT-2026-09-04.md).

**The site is clean and must stay that way.** A word-boundary sweep of `docs/`
finds zero lead/RRP claims on any homeowner page — the only correct posture for
an uncertified firm, since it is the *claim*, not the carpentry, that is
trivially provable. **Do not add "lead-safe" language to anything.**

**The exposure is the demand the pages create, not a claim they make.** Batavia
points at pre-1978 clapboard on purpose, and **"sanded flush"** is live in
seven files. Hand-sanding a patch is fine; a random-orbit sander on pre-1978
paint without HEPA extraction is a prohibited practice that **forfeits the
under-20-sq-ft exemption for the whole job**.

**One correction to carry:** an earlier answer this session said Ohio runs an
EPA-authorized program through ODH. Wrong — **US EPA administers RRP directly
in Ohio**; ODH only accredits in-state courses and licenses *abatement*
professionals. The firm application goes to **EPA**. Verified: **$300 / 5
years** firm certification, **8-hour** renovator course (2 hands-on) / 5 years,
and **window replacement is never exempt at any size**.

Also closed: of 107 CRM job templates only two warned about pre-1978 work and
**both were painting templates** — the ones that actually tear off painted
fascia, rake, frieze, soffit, windows and doors had nothing. Nine now carry a
`PRE-1978 CHECK:` line. The line names the check, not the firm's standing,
because `docs/pro/` is served from the public hosting root and the CRM is
multi-tenant.

**When certification lands it is one pass and it is already scoped** — §4 of
the note lists the six wood pages, two siding pages, the GBP description (270
of 300 chars, room to spare) and the nine template lines.

## Logged, not fixed — each is its own PR

- **`.webp` files are larger than their `.jpg` twins.** 261 pairs under
  `docs/`; **153 of them the webp is the bigger file**, 108 smaller. The
  pipeline is producing pessimised images at least half the time and nobody has
  looked at the encoder settings. (Five of the six webp files added this week
  are referenced by nothing at all.)
- **Roof-specific copy still sits on the siding pages** —
  `services/siding-repair.html` and `siding-replacement.html` carry *"Getting a
  new roof shouldn't feel like a negotiation"* and *"gets on the roof"*. Both
  now also carry `sanded flush` from the wood work, so they are due a pass
  regardless.
- **Sitemap `lastmod` on `/our-work` is stale by generator policy**, not by
  drift — `build-sitemap.js` reports zero diff. Worth deciding whether the
  policy is right rather than patching the file.
- **`docs/services/fascia-soffit-repair.html` does not exist.** Fascia/soffit
  is the one service in the GBP list that the site only sells *inside* another
  hub. If GBP starts showing impressions for it, that is the build signal.

## Watch-outs

- **`docs/pro/js/job-templates-data.js` is one JSON object per line and is
  parsed by `tests/job-templates.test.js`.** Edit it with a targeted
  string patch, never by re-serialising the array — a round-trip reorders keys
  and produces a 107-line diff for a one-word change.
- **`tests/catalog-cost-privacy.test.js` reports 123 passed / 3 failed in this
  sandbox and that is not a regression.** The three need real git history (the
  drift detector reads a labor catalog at `225c0d8c` and finds 0 entries in a
  shallow clone). Identical on a clean tree; green in CI. Do not "fix" it.
- **A green anchor check is not a working link.** `check-site-integrity`
  verified all 1,311 anchors including 55 `#svc-<slug>` deep links that had
  never filtered anything — the ids existed, so the gate passed. Fixed and
  guarded this session (`25ea216`), but the lesson generalises: assert the
  outcome, not the precondition.
- **CI's `Serve docs/` step was fixed on 28c75f3** — two `npx --yes` cold
  downloads were racing a 60-second `wait-on`. Verified passing since
  (3m45s for the step). If it times out again, warm the cache first.

---

*Session record: this brief · audits
[WOOD-SIDING-GAP](../audit/WOOD-SIDING-GAP-2026-09-03.md),
[SHED-OUTBUILDING-GAP](../audit/SHED-OUTBUILDING-GAP-2026-09-03.md),
[RRP-LEAD-PAINT-CONSTRAINT](../audit/RRP-LEAD-PAINT-CONSTRAINT-2026-09-04.md) ·
marketing [gbp-services-2026-09-03](../marketing/gbp-services-2026-09-03.md) ·
CRM lane [NEXT_SESSION-2026-09-04](NEXT_SESSION-2026-09-04.md).*

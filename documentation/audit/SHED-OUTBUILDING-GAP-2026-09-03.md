# Sheds & outbuildings — four jobs done, zero pages (2026-09-03)

**Trigger.** Jo dropped a new Drive folder — `NBD - internal - content / Scott Shed Project`
— and asked whether it should go on the site "as a job box or anything else."

Same session as [WOOD-SIDING-GAP-2026-09-03](WOOD-SIDING-GAP-2026-09-03.md), and
**the same finding shape for the third time this session**: real, photographed,
already-published work with no service surface pointing at it.

---

## §1 — The folder

28 files, but only **17 unique images** — every photo is uploaded twice, byte-identical
sizes, two upload batches two minutes apart (21:03 and 21:05). Worth knowing before
anyone counts them as 28.

Three of them (`IMG_0093/0094/0095`) are stored **rotated 90°** with no EXIF
orientation flag, so they render sideways in anything that trusts the tag. They need
a real pixel rotation, not a metadata fix — `prepare-project-images.mjs` will bake in
whatever orientation it is handed.

**What the photos show** (read end to end, not sampled): a gambrel "barn-style"
backyard shed, complete roof tear-off. Old black rolled roofing stripped to the
original OSB deck; the deck is visibly water-stained around the old fasteners
(`IMG_9493` is the "what we found" frame). Blue synthetic underlayment, starter
course, charcoal architectural shingles, ridge cap. A blue tarp covers the open roof
between stages. Old roofing is bagged on tarps, not dumped on the grass. Two roof
planes — the main gambrel plus a lower attached section. White T1-11 siding, dark
green trim, chain-link fenced wooded lot.

The 6 frames that actually shipped, in carousel order (see §4 for why):
`IMG_9490` tear-off → `IMG_9493` stained decking → `IMG_9510` tarped + roofing staged →
`IMG_9497` shingles going on → `IMG_9505` slope finished → `IMG_0095` the finished shed,
which is also the `hero`.

---

## §2 — The gap

Word-boundary search across `docs/**/*.html` — not substring, because `shed` matches
inside *finished*, *washed*, and the tarping page's *"tarps to shed water"*:

| Term | Homeowner-facing pages, before |
|---|---|
| `shed` as a **building** | **0** |
| `outbuilding` | **0** service pages (3 hits, all inside `/our-work` cards) |
| `detached garage` | **0** service pages |
| `pole barn`, `garage roof`, `workshop` | **0** |

Meanwhile `/our-work` had been carrying **three published, priced, consented
outbuilding jobs** the whole time:

| Slug | What | Retail |
|---|---|---|
| `batavia-oh-full-replacement-2025` | "House, Garage and Outbuilding" — *the detached outbuilding out back* | $11,000–$12,000 |
| `new-richmond-oh-storm-replacement-2024` | "House and Outbuildings, One Day" — partial claim denial worked, then done in a day | $15,000–$16,000 |
| `amelia-oh-gambrel-ridge-repair-2026` | 68 ft of ridge on a gambrel building, structure + addition | $1,500–$2,000 |

Three jobs, real prices, aerial photos — and a homeowner searching *shed roof
replacement* or *who will re-roof my detached garage* had nowhere on the site to land.

---

## §3 — What shipped

`/services/shed-roof-replacement.html` — hub page. `serviceType: Shed and Outbuilding
Roofing`, 6 FAQs, full scope list, its own `OURWORK` strip fed by the three jobs above.
Its FAQ HTML is generated from its own `FAQPage` JSON-LD (same anti-drift construction
as the wood pages).

- `shed-roof-replacement` added to `SERVICES` in `scripts/build-projects.mjs`
  (label "Sheds & Outbuildings") and `PLAIN_SERVICES` in `scripts/build-sitemap.js`.
- The three jobs tagged, so the strip and the `/our-work` filter carry real proof
  with retail ranges from day one.
- Callouts + links added to the `roof-replacement` and `roof-repair` hubs; `llms.txt`
  gained the service line and the page entry.

**The URL choice.** `shed-roof-replacement` over `shed-outbuilding-roofing`: it
exact-matches the highest-intent query and fits the existing service-slug convention
(`roof-repair`, `siding-repair`, `wood-siding-repair`). Detached garages, barns, pool
houses and lean-tos are carried in the title, H1, scope list and FAQs instead. Noted
because it was a real fork, not an obvious call.

**The two angles worth keeping.** *"The job most roofers won't schedule"* — homeowners
say they called three or four companies first, and declining sheds is an industry norm
rather than a rule. And *detached-structure coverage*: most policies cover outbuildings
under a separate limit, and it is the line carriers most often leave out of a scope.

---

## §4 — The shed card: raised, decided, shipped

The card was held on first pass. Jo's answer to "whose job is this" was **joint —
"I helped on it"** — and the vault has Scott as a contractor peer
(`scott@oaksroofingandconstruction.com`, the
[Oaks microsite](../projects/SESSION-2026-08-19-oaks-microsite-rebuild.md)), so publishing it
flat risked misstating who did the work. Two things were put to Jo:

1. **Attribution** — is this NBD's job to publish at all?
2. **The claim on 120 pages** — the transparency strip says *"I don't subcontract."*

**Jo's decision: run it as a regular project, no note.** That is the right call and it is his to
make. A joint job is **not** subcontracting — subcontracting is selling a job and handing it to
someone else's crew, which is not what happened. The site's own blog already holds the nuanced
position (`how-to-choose-a-roofer-after-a-storm`: *"Subcontracting isn't automatically bad, but the
answer should be immediate and specific"*). The card names no other company and makes no claim
about who swung the hammer; it describes the work.

The lesson kept in the runbook is the *asking*, not the disclosing: **surface provenance before
publishing, then let the owner decide.** Rule 3 of PUBLISH-PROJECT.md was reworded accordingly —
it originally read "needs the arrangement stated in the card — or it stays off," which was a
session inventing policy for the business rather than flagging a decision to its owner.

Jo's other three answers closed the rest: town **Mason**, **consent given**, retail **$2,000–$2,500**.
The range as first typed was "200-2500"; every other card on the site uses a tight range
($400–$700, $1,500–$2,000, $11,000–$12,000), so a 12× spread was queried rather than published —
it was a dropped digit.

### What shipped

`mason-oh-shed-reroof-2026` — "Barn-Style Shed, Down to the OSB", tag *Shed Re-Roof*,
Mason OH, $2,000–$2,500, 6 photos, `consentOnFile: true`. Tagged `shed-roof-replacement` only:
tagging it `roof-replacement` as well would have put a $2k shed at the head of the roof-replacement
hub's proof strip (the strip sorts newest-first), pushing house-scale work down. It now leads the
shed hub's own strip, ahead of the Batavia and Amelia jobs.

**Photo handling.** Selected from all 28 uniques, not a sample. Story order — tear-off → the
stained deck → tarped and staged → shingles going on → slope finished → the finished shed — with
`hero` pointed at photo **6** so the card thumbnail is the finished building. `hero` need not be
`photos[0]`: `heroAlt()` matches on `src`, and two existing entries already point at photo 3.
One frame was swapped late (`IMG_9506` → `IMG_9505`) because a fingertip intruded at the bottom
edge. `IMG_0095` needed a real 90° pixel rotation before re-encoding — it is stored rotated with
**no EXIF orientation tag**, so anything trusting the tag bakes it in sideways.

**Copy.** Drafted by a 14-agent workflow: 4 candidate descriptions from distinct angles, 6 alt
strings written against the actual images, 3 judges scoring on separate lenses (voice / truth /
pull), then a synthesis. `same-discipline` won 25–22–19–19. All three judges independently flagged
the same fabrications in the losing candidates — *"Most roofing companies won't put a shed on the
schedule"* (unverifiable claim about other contractors), *"water had been working in at each one
for a long time"* (invents duration from a stain), and an *"every old fastener"* quantifier — and
none reached the final text. One judge flagged *"both roof planes"* as a small extrapolation worth
confirming; it was confirmed against the finished photo (the lower attached plane carries the same
new shingles, continuous with the gambrel) rather than taken on trust.

## §4b — The card shipped with four false claims. Here is how, and how they were caught.

**This is the most useful thing in this note.** The first published version of the description said
the tear-off revealed *"water staining around the old fasteners"*, that the old roofing was
*"bagged and staged on tarps"*, and that *"the yard was clear when the ladders came down."* **All
three are false**, and a fourth claim — *"across both roof planes"* — is wrong for a gambrel, which
has four. It went to `main`'s PR branch as commit `bcacd43` before it was caught.

What the photos actually show, verified by cropping and enlarging each disputed region:

| Claim as published | What the frame actually shows |
|---|---|
| "water staining around the old fasteners" | Glossy, opaque **black asphalt residue sitting on top of the strands**, plus chalk lines. The OSB is pale, dry and sound — no diffuse halo soaking in, no swelling, no delamination, no rust rings. No decking was replaced on this job. |
| "bagged and staged on tarps" | The torn-off roofing lies **loose on the grass and in the leaf litter**. No bags. No tarp under any of it. |
| "the yard was clear when the ladders came down" | The **hero frame itself** — the card thumbnail — still shows shingle-bundle wrappers open on the lawn at the fence line. |
| alt #3 "a blue tarp over its stripped roof" | The lower slope in that frame is **already shingled**; the tarp covers only the unfinished upper section. |

### Root cause — and it is a process bug, not a bad agent

The drafting workflow was seeded with a `FACTS` block **written by the session from its own quick
first read of the photos**. That block asserted water staining, tarps and a clear yard. Four
drafting agents and three judges then worked *faithfully and well* — the judges caught every
fabrication the drafters introduced **on top of** the brief, and the winning draft invented nothing.
They simply had no mandate to doubt the brief itself. Garbage in the premise propagates through a
judge panel untouched, because a judge panel measures candidates against each other and against
the brief, not against reality.

**The verification workflow caught all four** precisely because its agents were pointed at the
*images* and told to refute, with no access to the drafting brief's framing. Three independent
lenses (truth-vs-photos, runbook, voice-and-claims) converged on the cleanup claim without
coordinating.

### The rules that come out of this

1. **A drafting brief written from your own impressions is a hypothesis, not a fact sheet.** Label
   it as such in the prompt, or verify it before you hand it to a fan-out that will amplify it.
2. **Verification must read the primary source, not the brief.** If the verifier and the drafter
   share a premise, the verifier cannot catch a wrong premise.
3. **Never publish a claim the accompanying photo refutes.** A cleanup line disproven by the very
   frame chosen to sell the job is worse than no cleanup line: the reader can see it.
4. **"It probably happened off camera" is not a defence.** If the shed really was tidied after the
   last frame, the honest fix is a seventh photo, not a sentence.

### The corrected description

Now: *"Barn-style backyard shed in Mason — old rolled roofing, torn off completely rather than
covered over. With it off we could actually look at the deck: original OSB with old asphalt still
stuck to it, sound underneath. Then synthetic underlayment, charcoal architectural shingles and a
shingle ridge cap. Same shingle that goes on a house."*

524 → 337 characters, which also closes a separate advisory: the original was 57% longer than any
other card and `.project p` has **no line-clamp**, so it was stretching the whole top row of the
`/our-work` grid. The tear-off rationale survives and is *better* honest — the deck turned out
sound, and you only know that because somebody looked.

Two documentation fixes fell out of the same pass: `projects.json`'s own `_readme` TAXONOMY list
still named **7** service keys after this session added two (it is the list an editor actually reads,
and it declared this very entry's only key invalid), and PUBLISH-PROJECT.md's "The last two were
added 2026-09-03" pointed, read literally, at `storm-damage` and `roof-inspection`. Both corrected.

### Known, pre-existing, NOT fixed here

`build-projects.mjs` stamps hub-strip links as `/our-work#svc-<slug>` (39 of them across `docs/`),
but `docs/assets/js/our-work.js` only parses `#service=<slug>` — its own comment says
*"#service=<slug> deep links let hub-page strips land pre-filtered."* There is no `#svc-` handler,
so **every hub strip link lands on the unfiltered gallery**. `check-site-integrity` passes because
the anchor resolves to the filter button's id. Zero `#service=` links exist anywhere. Out of scope
for a publish; worth a small PR of its own.

## §4c — What the completeness critic found that six skeptics missed

A seventh agent was asked only *"what did the other six miss?"* — and verified its own hypotheses
with real tool calls rather than asserting them. It is the highest-yield agent in either workflow.

**Acted on:**

- **The card silently rewrote the homepage.** `homeowner-wall.json` is `live.slice(0, 12)`,
  newest-first, and it mounts in exactly one place: `docs/index.html`, under
  *"Real Roofs. Real Neighbors. — Actual jobs on actual homes around Greater Cincinnati."*
  Publishing the shed made **a backyard outbuilding the lead proof tile of the homepage.** Nobody —
  including the session — looked at what appending to `projects.json` does three surfaces away.
  Left in place deliberately (the wall is date-ordered by design and self-corrects as jobs publish;
  faking the `published` date to demote it would be worse), but **flagged for Jo** rather than
  decided silently.
- **The lightbox opened on the wrong photo.** `project-carousel.js` opens at `let idx = 0` and never
  seeks to the hero. With `hero` pointed at photo 6, a visitor clicked the finished shed and the
  lightbox opened on the tear-off — the image swapped out from under the click. Two other entries
  have `hero !== photos[0]` but sit at index 2; this was at index 5, the maximum possible distance.
  **Fixed** by reordering so the finished shot is photo 1 *and* the hero.
- **The strip provenance comment could never tell the truth.** `stripBlock()` computed
  `matches.length` *after* `.slice(0, STRIP_MAX)`, so every capped strip reported "3 live project(s)"
  regardless. The shed hub said 3 while 4 carried the service. **Fixed in the generator** — it now
  counts before the cap and names what was left out. The fix immediately revealed the
  roof-replacement hub has been showing **3 of 28** with no indication.
- **A claim the judges rejected in the card was live on the hub.** The copy judges threw out
  *"Most roofing companies won't put a shed on the schedule"* as an unverifiable claim about other
  contractors — while that same claim was shipped in **8 places** (3 meta tags, an FAQ in both HTML
  and JSON-LD, body copy, an H2, and `llms.txt`) on the page hosting the card. Softened to Jo's own
  published phrasing, *"plenty of outfits won't schedule"*, which makes the point as an observation
  rather than a quantified claim about the market.
- **§6 of this note certified the wrong artifact.** It recorded 26,158 internal refs; the tree
  reports 26,161. The 3-ref delta *is* the new card. The evidence had been captured before the card
  was stamped.

**Checked and genuinely clean** (worth recording, because each was a real hazard):

- The new key `shed-roof-replacement` **contains** `roof-replacement` as a substring, but
  `our-work.js` does `split(/\s+/)` then `Array.indexOf` — exact token match, not a string search.
  Clicking "Roof Replacement" does not pull in the shed card. Same for `siding-repair` vs
  `wood-siding-repair`.
- "Charcoal" was measured, not assumed: the Mason roof's median luminance is 94 against 145 for
  `cincinnati-oh-hillside-charcoal-2023`, the site's own existing "charcoal" reference. Darker than
  the job already called charcoal, so the word holds.
- The 12 new binaries came through the sanctioned pipeline — progressive SOF2 with quantization
  tables hashing identically to corpus images from 2023, 2025 and 2026. Not a hand-rolled export.
- One verifier was caught overreaching: it claimed the page "contradicts itself" calling the same
  blue material both a tarp and underlayment. At 5× the blue in photo 4 is underlayment and the blue
  in photo 3 is a **glossy draped poly tarp with a rope and bundles weighted on it** — two different
  things. Acting on that finding would have introduced an error. *Adversarial verifiers need
  verifying too.*

**Logged, not fixed** (each deserves its own change):

- All six new `.webp` files are **larger** than their `.jpg` twins (1.04–1.14×), so a modern browser
  downloads ~9% more bytes than the fallback it is avoiding — and five of the six are referenced by
  nothing, since the lightbox serves `.jpg` only. Site-wide: **139 of 229** existing pairs are the
  same way.
- `docs/sitemap.xml` still stamps `/our-work` with `lastmod 2026-07-13` though the page changed four
  times today. That is the generator's documented lastmod-preservation policy, working as designed,
  but it means the sitemap understates freshness on the one page that changes most.
- The `#svc-` deep-link bug from §4b.

## §5 — Open

**Jo:** nothing outstanding on this card — all four answers landed and it shipped. Still open
from the companion note: the **GBP service list** (the site now claims wood siding, fascia/soffit
and shed/outbuilding roofing; GBP does not list them), and the Mason caller's own photos, which
still need consent before they can be published.

**Next session:**
1. City pages for `shed-roof-replacement` in the tier-1 towns — the hub now has a real Mason job
   to anchor a Mason page.
2. Tooling note for next time: `prepare-project-images.mjs` loads `sharp` from
   `functions/node_modules`, which was absent in this sandbox — `cd functions && npm install`
   first (~1 min). `pillow-heif` is needed to read the HEIC originals at all.
3. The three roof/siding hubs still carry roof-specific copy in the shared process
   module (*"Getting a new roof shouldn't feel like a negotiation"*, *"gets on the
   roof"*). Corrected on the two new hubs, still wrong on the originals.

---

## §6 — Gates

All green except a **pre-existing sandbox artifact**: `tests/catalog-cost-privacy.test.js`
reports 123 passed / 3 failed here, and **the identical 123/3 on a clean stash of this
branch** — so it is not this work. The three failures all need git history at
`225c0d8c`, which this container's **shallow clone** (120 commits, `.git/shallow`
present) does not contain; the test's own message names the cause and the fix
(`fetch-depth: 0`, which CI sets). Verified by stashing every change and re-running,
rather than assumed.

Everything else clean: `check-js-syntax`, `check-inline-html-scripts`,
`check-image-privacy`, `apply-partials --check --diff` (632 regions / 217 files),
`build-projects --check` (11 hub strips), `build-sitemap` (219 URLs, +1),
`check-chrome-governance`, `marketing-polish-contract` (53 passed),
`check-site-integrity` (238 pages, **26,161** refs, 0 failures — re-measured after the card was stamped; an earlier draft of this note recorded 26,158, which was captured *before* it and so certified something other than what shipped).

One copy note: a British-spelling pass caught `colour` and `mobilisation` in this
session's new copy — each appeared in **both** the visible HTML and the JSON-LD, which
is what deriving one from the other is for.

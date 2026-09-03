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
`check-site-integrity` (238 pages, 26,158 refs, 0 failures).

One copy note: a British-spelling pass caught `colour` and `mobilisation` in this
session's new copy — each appeared in **both** the visible HTML and the JSON-LD, which
is what deriving one from the other is for.

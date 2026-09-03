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

Proposed 6-frame carousel: `IMG_0095` (hero, finished) → `IMG_9510` (during, tarped
+ torn-off roofing staged) → `IMG_9484` (tear-off) → `IMG_9493` (stained decking) →
`IMG_9496` (underlayment + first courses) → `IMG_9506` (clean site).

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

## §4 — The Scott shed card is NOT shipped, and why

Jo's answer to "whose job is this": **joint — "I helped on it."** That is the reason
the card is held, and it is not a formality:

1. **Attribution.** The vault has Scott as `scott@oaksroofingandconstruction.com` —
   a contractor peer Jo built the Oaks microsite for
   ([SESSION-2026-08-19](../projects/SESSION-2026-08-19-oaks-microsite-rebuild.md)),
   also the source of the "2023 JK Roofing Customers (Scott's only)" book. So this is
   not a homeowner job with a customer named Scott, and publishing it flat as NBD work
   would misstate who did it.

2. **It collides with a claim on 120 pages.** The transparency strip says
   **"I don't subcontract"** on 120 homeowner pages. A joint job is not subcontracting
   — subcontracting is selling a job and handing it to someone else's crew — but a
   homeowner reading both deserves the distinction stated rather than left to inference.
   The site's own blog already takes the nuanced position
   (`how-to-choose-a-roofer-after-a-storm`: *"Subcontracting isn't automatically bad,
   but the answer should be immediate and specific"*), so the honest move is available
   and on-brand: publish it and say in the card what the arrangement was. That is the
   same move as "rot is usually not an insurance claim."

3. **Still missing, and only Jo has them:** the town (city-level only — never a street
   address), consent to publish, the retail range (or "skip"), and one line on how to
   describe the joint work honestly.

**Do not publish this card until all four land.** Everything in §3 is independent of
it and shipped on the already-consented jobs.

---

## §5 — Open

**Jo:** the four answers in §4. Also — the runbook's phone-paste template
([PUBLISH-PROJECT](../runbooks/PUBLISH-PROJECT.md)) lists the seven old service keys;
it now needs `wood-siding-repair` and `shed-roof-replacement` added, and a line about
consent when a job was not solely NBD's.

**Next session:**
1. Publish the Scott card once §4 clears — photos re-encoded through
   `prepare-project-images.mjs` (note: `sharp` loads from `functions/node_modules`, so
   `cd functions && npm install` first; it was absent in this sandbox), the three
   `IMG_009x` frames rotated 90° **before** re-encoding.
2. City pages for `shed-roof-replacement` in the tier-1 towns, once the hub has data.
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

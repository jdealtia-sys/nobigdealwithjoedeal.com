# Subcontracting claims — audit and correction (2026-09-20)

**Status: corrected.** 124 service pages plus ~16 hand-written claims said or
implied that No Big Deal does not subcontract. It does.

## What was true all along

Jo, 2026-09-20, in his own words:

> "I most definitely subcontract. The whole company is truthfully me — I run the
> whole company. I don't have any salespeople. I've got crews: a roofing crew,
> both residential and commercial; a gutter crew; a siding crew; an interior and
> drywall crew. They are NOT all employees on W-2 payroll. They are fellow
> subcontractors that I can get a good rate with and have done work with in the
> past."

Three follow-ups he answered the same day, each of which unblocked copy that
could not otherwise be written:

| Question | Answer |
|---|---|
| Is Joe personally on site for every job / every roof? | **Yes, every time.** So `inspect.html`'s "Joe gets on every roof himself" and the homepage's "Joe shows up himself — every time" are TRUE and were kept. |
| Do the crews carry their own GL / workers' comp, or are they under Jo's? | **Their own.** Corroborated by `partners.html:626`, which already required "Current GL and workers' comp certificates, no exceptions" of crews. |
| Is the same crew guaranteed start to finish? | **Same crew per trade, every time.** A multi-trade job naturally involves different people, so "same faces start to finish" was replaced with "the same crews, job after job". |

## How bad it was

- **124 identical badges.** One distinct string across all 124 files — verified,
  not assumed. The badge sits in a 4-up row styled identically to
  "Licensed & insured", so a homeowner reads it as a verified fact of the same
  class, not as marketing voice. It is the first factual claim below the hero on
  the pages taking the most traffic.
- **The site contradicted itself in public, in structured data.**
  `partners.html` is in the sitemap with no `noindex`, carries a visible
  `Crews & Subcontractors` section, and ships a JSON-LD `FAQPage` entry
  **"How are subcontractor crews paid?"** with a per-square answer. `robots.txt`
  explicitly welcomes GPTBot, ClaudeBot and PerplexityBot. So the same indexed
  domain told homeowners one thing and told machines the opposite.
- **The site coached homeowners to catch it.**
  `blog/how-to-choose-a-roofer-after-a-storm.html:555` tells readers to ask
  *"Who is actually on my roof — your crew or a sub?"*
- **It suppressed real marketing material.**
  [SHED-OUTBUILDING-GAP-2026-09-03](SHED-OUTBUILDING-GAP-2026-09-03.md) records a
  genuine completed job withheld from the portfolio *because* of the claim.
- **`llms.txt` was the highest-leverage surface and the easiest to miss.** Served
  at `/llms.txt`, advertised twice in `robots.txt`, written specifically to be
  quoted verbatim by AI assistants — and it mentioned crews **zero times in 165
  lines**, under a heading literally reading "Who does the work?".
- **The books were never wrong.** `docs/pro/js/expense-config.js:46` has always
  classified subcontractor payments as Schedule C Contract Labor (L11),
  `is1099: true`. Only the public site was out of step.

**No gate would ever have caught this**, and none reddened while it was wrong.
The only `subcontract` hits in `tests/` were bookkeeping fixtures.

## The separate, more serious one: the job posting

`docs/careers.html` advertised a part-time roofing helper on **W2 terms** — "taxes
withheld properly, workers' comp coverage from your first hour" — in body copy
AND in `JobPosting` structured data that Google Jobs surfaces, including the line
*"A lot of roofing labor in this area gets paid as 1099 or cash, which leaves the
worker with no coverage at all. I'm not doing that."*

That is categorically different from the marketing overstatements: it promised a
**person** their tax treatment and their injury coverage, and somebody could have
taken the job on it. Jo confirmed the terms were not accurate.

**Taken down in #1687**, not reworded — replacement employment terms are Jo's
decision, not a copy edit. The page is parked (not deleted: 219 pages link to
`/careers` from the footer partial), carries `robots noindex`, and was pulled
from the sitemap. Pinned by `tests/careers-posting-parked.test.js`.

## What changed

| Group | Where | Fix |
|---|---|---|
| A | 124 `docs/services/*.html` + `scripts/add-transparency-strip-services.js` | badge → **"You deal with me, start to finish"** |
| B | `index.html` compare pair, `inspect.html`, 2 area pages, `roof-replacement-fairfield-oh.html`, `gaf-timberline/index.html` | flat denials removed; true halves kept |
| C | `index.html` ×2, `about.html` ×2, `hail-damage-insurance-claim.html`, `anderson-township-oh.html`, `partners.html` ×2 | "doing the work" → "running the job", anonymity framing |
| D | `llms.txt:18` and `:56` | crews named, subcontractor status stated plainly |

### Traps that made this non-obvious

1. **Fixing the generator alone changes zero live pages.** `insertAfterHero()`
   returns early on `data-nbd-transparency="v1"`, which all 124 pages carry.
2. **A delete-and-restamp would have silently repainted the brand.** The script
   emits `#142a52`/`#e8720c`; the shipped pages use `#12223d`/`#bd5728`. Verified
   before writing anything — zero shipped pages contain `142a52`.
3. **Windows EOL.** Applied with an EOL-detecting Node script per `CLAUDE.md`.
   Result: 125 files, **126 insertions / 126 deletions**, one line per page, and
   `git ls-files --eol` shows zero LF-only rewrites.

## Deliberately NOT changed

- **`partners.html`'s Crews & Subcontractors track.** Seven reviewers flagged it
  as "the contradiction"; every flag was rejected on verification because it is
  **the correct half**. The foreseeable accident on a mechanical pass is deleting
  the only honest public statement while the denials stay live.
  `tests/subcontracting-honesty.test.js` guards it explicitly.
- **The blog's "Subcontracting isn't automatically bad…"** — true, and the model
  for the honest framing.
- **31 area pages' "supervises the crew"** — true, and already openly
  acknowledged a crew.
- **`/our-work` and `projects.json`**, including the page titled "Full Crew —
  Cul-de-Sac Tear-Off" — true, and photographic evidence a crew exists.
- **All internal bookkeeping** — correct accounting, invisible to customers, and
  evidence in Jo's favour.
- **`docs/sites/oaks/**`** — a different company's microsite.
- **`emergency-roof-tarping.html` "One person, the whole way"** — reviewed and
  kept. In context it is about continuity of the *claim* process, which Jo does
  handle personally, and he is on every job.

## Still open

- **The estimate PDF says "same crew".** `docs/pro/js/estimate-v2-ui.js:3010`
  (32pt hero headline) and `functions/print/templates/estimate.hbs:68`. In context
  it means tier-invariance — picking premium shingles does not change the labor —
  and given "same crew per trade, every time" it is TRUE for a single-trade
  estimate. **But it sits above a signature block**, and a multi-trade estimate
  (roof + siding + gutters) necessarily involves more than one crew. Flagged for
  Jo rather than edited, because it is contractual.
- **Commercial roofing and interior/drywall crews may not be advertised at all.**
  Jo named both; whether the site sells either was outside this audit's lens. If
  not, that is revenue not being asked for.

## Evidence

111-agent sweep across seven claim families, each finding individually verified
against the file before reaching this note: **80 confirmed** (42 false-claim,
37 misleading, 1 contradiction) across 36 files, **23 rejected** as true-as-written.
Verified good news: of **651 JSON-LD blocks in 295 files, not one** contained a
subcontracting denial.

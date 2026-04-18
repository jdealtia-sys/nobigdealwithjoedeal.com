# Geo-Combo Page Expansion Playbook

## The problem (from the April 2026 audit)

You have 132 geo-combo service pages (service × city combinations like `/services/roof-replacement-mason-oh`). They average 1,300–1,800 words. Google's March 2024 core update specifically targets "unhelpful, programmatically generated local pages." Most of your pages are sitting right on the edge of that category.

Target: **2,000+ words minimum**, with **locally unique content** (not just find/replace city names) on your **top 15 highest-traffic geo pages**. The long-tail 117 can stay as-is for now — they'd be a waste of effort before the top 15 are ranking.

## Priority list (do these first)

Based on search volume for roofing/home services in your service area:

### Tier 1 — Cincinnati + biggest suburbs (7 pages)
1. `/services/roof-replacement-cincinnati-oh`
2. `/services/storm-damage-cincinnati-oh`
3. `/services/hail-damage-insurance-claim-cincinnati-oh`
4. `/services/roof-replacement-mason-oh`
5. `/services/roof-replacement-west-chester-oh`
6. `/services/roof-replacement-loveland-oh`
7. `/services/roof-replacement-fairfield-oh`

### Tier 2 — insurance + storm variants on high-value cities (5 pages)
8. `/services/storm-damage-mason-oh`
9. `/services/storm-damage-loveland-oh`
10. `/services/hail-damage-insurance-claim-mason-oh`
11. `/services/hail-damage-insurance-claim-west-chester-oh`
12. `/services/hail-damage-insurance-claim-loveland-oh`

### Tier 3 — KY market anchor (3 pages)
13. `/services/roof-replacement-covington-ky`
14. `/services/roof-replacement-florence-ky`
15. `/services/storm-damage-florence-ky`

The other 117 geo pages: leave alone for 60 days. If any start ranking from the pure existence of the page + the H2/H3 fix we just shipped, promote them to this list.

## What "locally unique" content actually means

Bad ("templated"):
> Mason, OH homeowners know the reality of Cincinnati weather. When hail hits, you need a contractor who understands insurance claims.

Good (unique):
> Mason's 45014/45040 zip codes have the highest concentration of vinyl-siding homes in Warren County — most built between 1995 and 2010 when dutch-lap vinyl was standard. Those siding panels weren't rated for the impact velocities we see in April-May hail events (reference: 2023 Deerfield Township supercell). If your home is one of the ~4,200 here with original siding from that era, the insurance claim process is different — adjusters often miss the hidden impact damage behind downspouts and around windows. I've walked 60+ Mason claims through this exact scenario.

The difference: **specific zip codes, specific years, specific neighborhoods, specific numbers, specific experiences.** Google's content quality system can tell the difference. Homeowners can too.

## Content checklist per geo page (target: 2,000+ words)

Per priority-list page, add these sections in order:

### 1. Hero stays — no change (~150 words)
Keep the existing H1 + existing metadata + existing breadcrumb.

### 2. "Why [City] is different" section (NEW — 300-400 words)
Write this in first person as Joe. What's SPECIFICALLY true about roofing in this city?
- Topography / drainage patterns (e.g., "Cincinnati's river valley means XYZ")
- Housing stock age (when were most homes in this zip built?)
- Weather history (any notable recent storms?)
- Regulatory nuance (permit rules, HOAs, historic districts)
- Insurance carrier concentration (which carriers are biggest here?)

### 3. "Recent work in [City]" section (NEW — 200-300 words)
- 2–3 real project snapshots from that city
- No names/addresses (privacy), but specific neighborhood, scope, and outcome
- Example: "Finished a full tear-off in the Walker's Ridge neighborhood last October. 2,400 sq ft, GAF Timberline HDZ in Charcoal. Had to coordinate with an HOA because of the color change. Start to finish: 4 days."

### 4. "What it typically costs in [City]" section (NEW — 250-350 words)
- Local pricing anchors (don't publish exact numbers, but RANGES with reasoning)
- Reasons prices vary in THAT city specifically (steeper pitches? older decking? common upgrade needs?)
- Address insurance vs. out-of-pocket framing
- What homeowners should expect on their first call

### 5. "The 3 most common [service] mistakes in [City]" (NEW — 200-300 words)
- Named and common enough to be a real pattern
- E.g., "Mason's biggest roofing mistake: undersizing the gutters during replacement"
- Show you understand the local stock

### 6. FAQ section (KEEP existing 3-4 Q&A, add 2 new local ones — 150-200 words each)
- Add: "How long does a roof replacement take in [City]?" (reference permit turnaround in that city/county specifically)
- Add: "Do I need permits in [City] for a roof replacement?" (reference actual rules)

### 7. Trust strip — keep existing
### 8. CTA block — keep existing (the phone-primary pattern we just shipped)

## Process for each page

1. **Read the existing page.** Note what's already there.
2. **Research the city in 20 minutes max:**
   - Zillow for housing stock age in that zip
   - Google Maps for notable neighborhoods
   - Local news for any recent storm events (NOAA Storm Events Database for historical hail)
   - City/county permit portal for actual permit rules
3. **Write the 5 new sections in Joe's voice.** Not "we" — "I." Not corporate. Think "explaining to a friend."
4. **Add at least 1 data point per section** (zip code, year, neighborhood name, specific number).
5. **Save as a draft, read it aloud.** If it reads generic, rewrite.
6. **Target 2,000 total words on page.**

## Cadence suggestion

If you do 2 pages per week, you'll finish the top 15 in 8 weeks. That's plenty of time to see which ones start ranking before you expand the effort.

**Week 1-2:** Tier 1 (pages 1-7)
**Week 3-4:** Tier 2 (pages 8-12)
**Week 5-6:** Tier 3 (pages 13-15)
**Week 7-8:** Buffer + review + publish 2-3 matching blog posts to support rankings

## What NOT to do

- ❌ Don't use AI to auto-generate 2000 words per page. Google's detection is good now, and the pages will all read the same. You'll net negative vs. leaving them at 1500 words.
- ❌ Don't bulk-add the same "why [City]" section across all cities — make each unique.
- ❌ Don't make pricing too specific (risky if you're off) — give ranges with reasoning.
- ❌ Don't add fake testimonials. If you don't have one from that city, say "I haven't worked in this neighborhood yet — but here's what I know about it."

## Tracking what works

After 30 days, check Google Search Console:
- Which geo pages got impressions? (usually the top 3-5 cities dominate)
- Which got clicks?
- Which got a bounce <60s? (means content not matching intent)

Prioritize the NEXT 15 pages based on actual data, not guesses.

## If you want faster progress

You could hire a local Cincinnati writer (try Upwork "Cincinnati content writer") for ~$75/page × 15 pages = ~$1,100 for the whole top-15 rewrite. Just give them this playbook + access to the existing page so they know Joe's voice. That's worth it if you have the cash — it's the highest-leverage SEO investment on this site.

Alternative: a journalism student at NKU or UC would do this for $30-40/hr. Local, knows the area, wants the portfolio.

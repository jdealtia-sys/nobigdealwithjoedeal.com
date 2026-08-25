# SESSION 2026-08-25 — The Lexington call becomes two posts

**What happened:** Jo took another homeowner call — Lexington, KY this time — asking
the *exact* question the Colorado Springs caller asked on 2026-08-17: is the upgrade
premium for TAMKO HailGuard over OC Duration worth it. Second organic blog-sourced
call in nine days, on the same two products. The caller was deep-research informed
(almost certainly arrived via the blog), and his call carried two new facts worth
publishing. This session turned them into two Reader Questions posts, plus a
site-wide deep-dive audit (separate note:
[SITE-DEEP-DIVE-2026-08-25](../audit/SITE-DEEP-DIVE-2026-08-25.md)).

## The two posts

| Post | Slug | The fact it's built on |
|---|---|---|
| **The Same Question, a 12% Answer — Is Class 4 Worth It?** | `/blog/is-the-class-4-upgrade-worth-it` | His State Farm agent quoted **12% off his premium** for a qualifying Class 4 roof. Covers the four-shingle short list (Duration / Duration FLEX / UHDZ / HailGuard), payback arithmetic, and the **cosmetic-damage exclusion** fine print — a caveat no earlier post covered. |
| **He Tried to Buy His Own Shingles. Every Counter Said No.** | `/blog/why-wont-roofing-suppliers-sell-to-homeowners` | He tried to buy HailGuard himself: **SRS and QXO don't carry it; ABC Supply (sole distributor right now) is account-holders-only, no cash sales.** Covers the two walls (exclusive distribution vs. contractor-only counters), what owner-supplied actually costs, and the honest markup conversation. |

Both tagged **Reader Questions**, published 2026-08-25, ~1,800 words each, written
to the voice bible (driveway register, no invented figures, honest-caveat closers).

## Fact-sourcing decisions (read before editing these posts)

- **The 12% figure is attributed, not asserted.** Every appearance says the
  caller's *agent quoted him* 12% — the disclosure states plainly that Jo hasn't
  seen the paperwork and discounts are carrier/state/policy-specific. Web-verified
  2026-08-25: State Farm's impact-resistant product discount program exists and
  covers KY and OH ([statefarm.com/insurance/homeowners/discounts](https://www.statefarm.com/insurance/homeowners/discounts));
  third-party sources put typical IR discounts at 10–30%, so 12% is credible.
- **State Farm is named** (Jo left it to session judgment). Rationale: the carrier
  name is anonymous to the caller, verified-real as a program, already named on
  `/blog/why-class-4-impact-shingles` and `/blog/state-farm-allstate-roof-claims-ohio`,
  and it's the detail that makes the post citable. A State Farm trademark line was
  added to the post A disclosure. **If Jo prefers it removed:** the name appears in
  post A only — one body sentence ("His carrier is State Farm."), one FAQ heading +
  answer, the FAQPage JSON-LD twin of that Q&A, and the disclosure trademark line.
- **ABC exclusivity is hedged.** No public source confirms "exclusive" (TAMKO's
  launch PR, 2026-02-27, names no channel), so the post says "as I write this, it
  moves through one national distributor: ABC Supply," attributes the three supplier
  answers to the caller's calls, and the disclosure says supplier policies vary by
  branch and change without notice. Nothing claims permanence.
- **"QXO (the supplier formerly known as Beacon)"** — QXO completed the Beacon
  acquisition in 2025; phrasing chosen so both names are searchable.
- **No cost/margin figures anywhere** — the markup discussion in post B is
  qualitative on purpose (catalog-cost-privacy gate, and good sense).

## Wiring (all restamped by the owning generators)

- `POSTS` array (`docs/assets/js/inline/c00f1acac9.js`) — both added at top; post A
  is the featured card.
- `build-blog-index.mjs` → 27 static cards + Blog schema; `build-feed.mjs --write`
  → 27 RSS items; `build-sitemap.js --write` → +2 URLs, nothing else changed.
- `docs/llms.txt` — both added to Guides (blog) in slug order (hand-maintained file).
- Keep Reading cross-links: CO post ↔ post A, why-class-4 → post A,
  HailGuard launch post → post B; new posts link back to all three.
  `dateModified` bumped to 2026-08-25 on the three edited siblings (08-17 precedent).
- `/services/tamko-storm-series` Class 4 insurance paragraph now chains all four
  reader posts (the 08-17 wave's interlink pattern; area pages deliberately not
  touched, same as that wave).
- Verified: title ≤62 / meta ≤155 / 3 JSON-LD blocks parse / all internal hrefs
  resolve / only the real phone number / no h-overflow at 390px or 1280px
  (Playwright screenshots, both posts, both widths).

## For Jo

1. **Say the word if you'd rather not name State Farm** in post A — removal spots
   listed above, five-minute edit.
2. ~~The Lexington caller sounds like live pipeline~~ **Superseded same day:** Jo
   confirmed the caller asked point-blank whether NBD services Lexington, Jo said
   yes, and the caller said the conversation earned his business. Lexington is now
   claimed territory — see Part 2 below.
3. This is the second call proving the comparison posts convert phone-first.
   The obvious next entries in the series when calls supply the facts: "Duration
   FLEX vs HailGuard" (the two Class-4-with-polymer lanes head-to-head) and
   "what a Class 4 certificate actually looks like" (photo post, needs a real
   certificate scan through the EXIF pipeline).

---

# Part 2 (same session) — the Central Kentucky expansion

Jo's follow-up turned the call into territory: expand page coverage south toward
Lexington and "start trying to close that territory." Jo also released his
backstory for site use (grew up in eastern Kentucky ~15 min from the Red River
Gorge → lived in Lexington 2–4 years → a stretch in Omaha, NE → **first** arrived
in Cincinnati after Omaha, "moved to Cincinnati and never left" — Jo confirmed the
sequence when asked). Scope choices were put to Jo directly (AskUserQuestion) and
he picked: **Lexington flagship + 5-city ring · site-wide service-area line update
· backstory on About + Lexington + one blog line · vague-free "never left"
wording.**

## What shipped

- **6 area pages**: `/areas/lexington-ky` (flagship — personal "New to Serving
  Lexington, Not New to Lexington" section, honest new-territory framing, no
  fabricated job history) + georgetown, nicholasville, winchester, richmond,
  versailles — each with its own county, storm profile, and hero copy (no clone
  sameness; the 2026-08-19 design-sweep lesson).
- **Lexington service trio** (outer-ring tier, same as Mt. Orab/Wilmington):
  `hail-damage- / roof-replacement- / storm-damage-lexington-ky` with
  Kentucky-correct FAQ copy (wind = covered peril *in Kentucky*; honest
  scheduled-trips response-time answers, no same-day claims).
- **Wiring**: 6 cities added to `add-location-interlinks.js` COORDS and the script
  run (nearby sections stamped on the trio); Lexington pills hand-inserted into
  the three hub `data-nbd-cities` sections at the generator's sort position (the
  script only adds when the marker is absent — it never restamps, so a manual
  insert matching its output is the correct move); areas index got a **Central
  Kentucky (6 cities)** block, 31-city counts, new hero badge/lede, and schema
  areaServed additions; sitemap +9.
- **Site-wide service-area line** via the footer partials (footer-blog /
  footer-extended / footer-slim → "Greater Cincinnati, Northern Kentucky & the
  Lexington area"), restamped across 50 pages by apply-partials; homepage meta,
  LocalBusiness description + areaServed, areas strip (+6 tags), and the
  what-areas FAQ (visible + JSON-LD twin) updated; llms.txt territory lines and
  Common Questions updated with the scheduled-trips caveat.
- **Backstory placements** (exactly three, per Jo's pick): About page origin
  paragraph ("Kentucky roots, Midwest miles, Cincinnati home" + an Eastern
  Kentucky Roots cred chip), the Lexington flagship section, and post A's Kentucky
  section — which now records the real ending: Jo said yes, and the caller said
  the conversation earned his business.

## Decisions a future session should know

- **New KY pages omit the JSON-LD `address` block** instead of replicating the
  known-wrong hardcoded `addressLocality: "Goshen"` (open item from the
  2026-08-18 Goshen audit). areaServed + per-city geo carry the local signal.
  When Jo supplies the real base address, add it to all 31 area pages together.
- **Honesty rails on every Central KY page**: scheduled trips from Cincinnati,
  exact windows not maybes, no 24-48h response claims, no invented job history —
  "my Lexington job list is young" is stated, not hidden.
- Ring cities have **area pages only** for now; their service clusters are the
  named follow-up once Lexington produces jobs.

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
2. The Lexington caller sounds like live pipeline (he can't buy materials himself,
   and Lexington is reachable for the right job). If he calls back, both posts are
   ready to text him.
3. This is the second call proving the comparison posts convert phone-first.
   The obvious next entries in the series when calls supply the facts: "Duration
   FLEX vs HailGuard" (the two Class-4-with-polymer lanes head-to-head) and
   "what a Class 4 certificate actually looks like" (photo post, needs a real
   certificate scan through the EXIF pipeline).

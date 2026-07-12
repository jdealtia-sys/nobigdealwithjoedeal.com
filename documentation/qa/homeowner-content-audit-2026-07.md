# Homeowner-site content audit — 2026-07-03

Four parallel read-only audits of all 202 homeowner-facing pages (`docs/**`
excluding pro/admin/dev/tools/sites): (1) factual/trust claims + fake data,
(2) TAMKO/GAF product consistency, (3) brand voice/identity, (4) cross-page
contradictions. Prompted by the TAMKO addition to a historically GAF-heavy
site. Top confirmed items were re-verified by hand against the files.

**Nothing has been changed.** This is a findings list for Jo to action —
several items are live business claims (brief rule: flag, don't silently fix).
Two recon scares were FALSE ALARMS: the "615 Nashville number" is the Facebook
profile id inside a URL, and the "(513) number" is not on any homeowner page.
The only published phone is (859) 420-7382, used consistently.

Legend: **[FIX]** clear mechanical/consistency fix once Jo greenlights ·
**[CONFIRM]** needs a fact only Jo knows · **[DECIDE]** judgment call.

---

## Tier 1 — legal / trust exposure (do first)

1. **[FIX/DECIDE] The Pledge is over-promised on 25 area pages.**
   `docs/areas/*.html:442` (25 files): *"if anything goes wrong with the
   workmanship, Joe comes back and makes it right — no questions asked."*
   `docs/the-pledge/index.html:446` (+ FAQ schema :41) deliberately says the
   opposite: *"not a blank check… if it's something I caused and covered by
   your job's written warranty, I fix it. If it's not, I'll quote the fix
   fairly."* "No questions asked" reads as unconditional lifetime free repairs
   the canonical page disclaims. Recommend softening the area-page line to
   match the-pledge voice (e.g. "…makes it right under your job's written
   warranty"). One codemod across 25 identical lines.

2. **[CONFIRM] Hardcoded 5.0 / "47+ Reviews" next to a live Google widget.**
   `docs/review.html:388,391`, `docs/index.html:1317`, `docs/our-work.html:407`.
   review.html embeds the live Google reviews widget right below the hardcoded
   5.0 — if the real average/count differs, they contradict one click from
   Google. Confirm the real numbers; make them match the live data or drop the
   hardcoded figures.

3. **[CONFIRM] Testimonials with names + a specific "$8,000 saved" claim.**
   `docs/services/roof-repair.html:718,722` ("Tom B. — Batavia, OH … saved me
   over $8,000"); `docs/review.html:408-454` (9 named quotes). FTC needs these
   to be real customers with typical-results framing. Confirm each is genuine;
   consider pulling live from the Google widget instead.

4. **[CONFIRM] BBB badge links to bbb.org homepage, not a profile.**
   `docs/review.html:477` — implies BBB accreditation. Point to Joe's real BBB
   profile or remove the badge.

5. **[FIX] Deductible-waiver disclaimer only on the OH storm hub, missing on KY
   + city storm pages.** Present: `docs/services/storm-damage.html:399,771`
   ("can't waive or absorb your deductible — outside Ohio law"). Absent on
   storm-damage-{covington,florence,erlanger,fort-mitchell}-ky.html and the
   city hail variants (e.g. hail-damage-lebanon-oh.html:306). Level the
   disclosure across all storm/claim pages (KY has its own deductible law —
   confirm wording per state).

---

## Tier 2 — TAMKO rollout is half-finished (the reason for this sweep)

6. **[FIX] The "GAF vs Owens Corning vs Atlas" blog steers the hail buyer to
   Atlas — a brand NBD doesn't install — and the "150 mph highest" claim is now
   wrong.** `docs/blog/gaf-vs-owens-corning-vs-atlas-shingles.html:422,498`
   ("Atlas is the play" / "Atlas StormMaster wins for storm protection") vs the
   TAMKO Storm Series page (160 mph, Class 4, HailGuard). TAMKO isn't in the
   homepage "Brands I Install" strip's competitor set, so the verdict sends the
   exact hail customer TAMKO was added for to a competitor. Rework the
   storm/impact verdict to lead with GAF UHDZ / TAMKO Storm Series; fix the
   "150 mph is the highest" line (TAMKO does 160).

7. **[FIX] roof-replacement lists a "GAF" warranty even when the customer picks
   TAMKO.** `docs/services/roof-replacement.html:658` ("GAF Timberline **or
   TAMKO Storm Series** — your choice") + `:663` ("GAF lifetime manufacturer
   shingle warranty" as an included item). Make :663 brand-neutral: "Lifetime
   manufacturer shingle warranty (GAF or TAMKO)."

8. **[DECIDE] Good/better/best tiers are GAF-only; TAMKO is an afterthought.**
   `docs/services/the-nbd-guarantee/index.html:442-571` and homepage picker
   `docs/index.html:918-940` build Standard/Preferred/Elite entirely on GAF
   Timberline NS/HDZ/UHDZ, with TAMKO relegated to a dashed "ask about" aside —
   while `tamko-storm-series/index.html` builds a separate Heritage→Titan
   XT→StormFighter→HailGuard ladder. TAMKO's 160 mph actually beats the GAF
   tiers' 130 mph. Decide: integrate a TAMKO column/row into the tier
   comparison, or add an explicit "second lane" table so positioning is
   consistent.

9. **[DECIDE/FIX] TAMKO pages push the color Visualizer, which only has GAF
   palettes.** `docs/services/tamko-storm-series/index.html:431,493,555,600`
   send users to preview TAMKO colors; `docs/visualizer.html:492` is labeled
   "GAF Timberline HDZ Palette" only. Add TAMKO Heritage/Titan XT palettes to
   the Visualizer, or soften the TAMKO pages' Visualizer promise.

10. **[DECIDE] "Elite" in-house tier vs GAF "Master Elite" certification.**
    NBD's top tier is named "Elite" (`docs/index.html:931`, the-nbd-guarantee
    throughout) but NBD is GAF **Certified**, not GAF **Master Elite** (honestly
    disclaimed in gaf-vs-owens-corning blog:464). Naming the tier "Elite" beside
    GAF badges invites conflation. Consider a rename or a one-line clarifier.

11. **[FIX] about.html omits Heritage from the TAMKO lineup.**
    `docs/about.html:726` lists "Titan XT, StormFighter Flex, and HailGuard" —
    drops Heritage (the value line other pages include). Add it.

12. **[CONFIRM] TAMKO spec claims need a manufacturer-source check.** 160 mph
    ratings and "first asphalt shingle with a hail warranty" (HailGuard) are
    consistent across the site but externally unverified. Confirm against TAMKO
    literature before leaning on them in ads.

---

## Tier 3 — brand/area consistency

13. **[FIX] "SE Indiana" service overreach.**
    `docs/services/gaf-timberline/index.html:566`,
    `docs/services/tamko-storm-series/index.html:618`: "serving Greater
    Cincinnati, OH, Northern Kentucky, and SE Indiana." Locked area is
    Cincinnati + NKY. Drop "and SE Indiana."

14. **[FIX] Northern Kentucky dropped on some pages.** `docs/privacy.html:363`
    ("Greater Cincinnati, Ohio" only) and `areaServed` schema on
    financing.html:20, roof-cleaning-soft-wash.html:20,
    fire-water-smoke-damage.html:20, roof-inspection.html:20 (all "Greater
    Cincinnati, OH" without KY) — while most pages correctly include NKY.
    Standardize to include "and Northern Kentucky."

15. **[FIX] estimate.html shows two different top prices on the same tool.**
    `docs/estimate.html:688` ($8,500–$15,000 ballpark) vs `:812`
    ($8,500–$14,200 result). Pick one top figure and make them match.

16. **[DECIDE] Lighter orange `#f08030` (`--orange-light`) is the most-used
    color on the site** (4,841 uses vs 2,821 for the locked `#E8720C`), on nav
    links/hovers/accents. Bless it as an approved tint or retune toward brand
    orange. (The `#B85400` darkened badges from the earlier contrast pass are
    approved — not a finding.)

17. **[FIX] Two different Facebook URLs.** `facebook.com/nobigdealwithjoedeal`
    (3x incl. review.html:478) vs
    `facebook.com/people/No-Big-Deal-Home-Solutions/61577416645584/` (footer,
    site-wide). One is dead. Standardize to the live profile.

18. **[FIX] "NBD Home Solutions" hybrid name** in 8 files (titles/bylines/schema,
    e.g. free-roof/index.html title, blog bylines). Standardize to "No Big Deal
    Home Solutions" (or accept "NBD" as deliberate shorthand — Jo's pick).

19. **[FIX] "Greater Cincinnati & Beyond" vague heading** on 10 service hubs.
    Change to "Greater Cincinnati & Northern Kentucky" for consistency.

20. **[CONFIRM] "150+ Projects Completed"** (`docs/our-work.html:405`) and the
    "7+ years" experience (35+ pages) and "licensed & insured" (157x, no license
    number) — confirm each is currently accurate.

---

## Tier 4 — minor wording drift (optional)

21. Pipe-boot dollar figures drift ($20 gasket / $40 neoprene / $60 boot for the
    cheap option, described three ways across gaf-pivot-boot, the-pipe-boot-fork,
    roofivent pages). Standardize the low-end number.
22. Heritage called both "TAMKO's flagship" and "the value floor / best price"
    on tamko-storm-series/index.html:331 — reword "flagship" → "best-known."
23. 555 form-field placeholders: estimate.html:746 "(859) 555-1234",
    storm-alerts.html:359 "(859) 555-0123" — cosmetic; optional to neutralize.
24. "Based In" footer says "Greater Cincinnati, OH" on ~36 pages, "Goshen, OH ·
    Greater Cincinnati" on 2 — factually compatible, optional to align.

---

## Verified clean (no action)
Business name "No Big Deal Home Solutions" (consistent, no template leftovers);
phone (859) 420-7382 everywhere; email jd@nobigdealwithjoedeal.com only; owner
"Joe Deal, Owner & Operator, 7+ years insurance restoration"; tagline "No Big
Deal with Joe Deal"; financing partner "Acorn Finance" (partner swapped 2026-07; no fabricated APR/$ figures);
tier pricing math reconciles; warranty durations consistent per product; GAF
Certified ID 1162011 used consistently (never falsely "Master Elite"); no
cross-brand mislabeling (no "TAMKO Timberline"/"GAF Storm Series"); service scope
(exterior-only, interior→United Restore partner) consistent; free
inspection/estimate consistently $0; no lorem/123-Main-St/fake staff.

---

## Bucket ③ resolved — 2026-07-03 (Jo: "Do 3")

- **#8 TAMKO in the tiers — ✅ DONE.** the-nbd-guarantee: each tier card now
  shows its TAMKO alternative (Standard→Heritage, Preferred→Titan XT,
  Elite→StormFighter Flex + HailGuard), plus a new "TAMKO alternative (hail
  country)" row in the comparison table. Homepage picker: each tier line now
  reads "GAF … or TAMKO …". TAMKO is no longer just a dashed afterthought.
- **#9 Visualizer — ✅ DONE (honest note, not fake data).** The Visualizer is
  genuinely GAF-specific (real GAF product photos + color data per Timberline
  line); fabricating a TAMKO palette would mean fake photos/names. Added a note
  under the roof-color picker: colors model GAF Timberline, TAMKO shades preview
  the same look and are matched from a physical sample. TAMKO-page copy was
  already appropriately soft ("preview a look… confirm the exact color").
- **#10 "Elite" tier naming — ✅ DONE (clarifier, not rename).** A rename would
  touch ~160 references; instead added a clarifier under the tier cards: "'Elite'
  is our top build tier — it's ours, not a manufacturer program. We're GAF
  Certified; 'Master Elite' is a separate GAF tier and isn't what we're
  describing." Closes the conflation risk without a risky mass rename.
- **#16 `#f08030` orange — DOCUMENTED as approved tint (no change).** It's a
  single design token `--orange-light: #f08030` (defined once, 439
  `var(--orange-light)` refs, 0 hardcoded) — a deliberate lighter tint of the
  brand orange. Retuning it is explicitly a "global color change," which the
  locked-palette rule forbids, so it stays. If Jo ever wants it retuned toward
  #E8720C, it's a ONE-LINE change to the token definition — just say so.

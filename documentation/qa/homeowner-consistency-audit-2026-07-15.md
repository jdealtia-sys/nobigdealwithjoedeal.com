# Homeowner Site Consistency Audit — 2026-07-15

_Four parallel sweeps over the full homeowner-facing site (~206 pages: docs/ excluding
pro/, admin/, sites/, dev/, deploy/): (1) header/footer uniformity, (2) content
contradictions, (3) visual system + brand voice, (4) adversarial triple-check of the
same-day TAMKO Pro Gold rollout. Prompted by Jo's request after the Gold certification
went live (PR #942). Fixes applied same-day are marked ✅ FIXED with the commit;
everything else is a decision item for Jo, ranked._

---

## 1. What was FIXED same-day (commits `d0adddd` + the round-2 commit)

### Accuracy (content sweep)
- ✅ **Titan XT wrongly labeled "Class 4 impact"** on the-nbd-guarantee Preferred card —
  corrected to Class 3 (matches TAMKO spec + every other page).
- ✅ **GAF System Plus described three incompatible ways** ("50 yrs material+workmanship" /
  "20-year materials" / "material + workmanship") — unified everywhere to the accurate
  form: lifetime limited **material** coverage, 50-year non-prorated period, no GAF
  workmanship coverage (The Pledge covers workmanship). Files: gaf-timberline,
  why-class-4 blog, gaf-vs-owens blog ×2.
- ✅ **GAF tier ladder was wrong** in gaf-vs-owens blog ("System Plus, Silver, Gold,
  Golden Pledge" with wrong year figures) — corrected to System Plus / Silver Pledge /
  Golden Pledge with Master Elite gating noted.
- ✅ **"Serving Greater Cincinnati since 2008"** in how-long-roof-insurance-claim author
  bio — corrected to 7+ years (company founded 2024; sitewide record is 7 years).
- ✅ **"30yr Shingle Warranty" stat box** on roof-replacement hub next to "lifetime"
  claims — corrected to Lifetime.
- ✅ **Homepage areaServed schema** listed 21 cities incl. phantom "Middletown, OH" and
  missed 5 real cities — synced to the true 25-city list.
- ✅ **Homepage Elite tier row** said "or TAMKO StormFighter Flex" while the guarantee
  page says "StormFighter Flex + HailGuard" — homepage now matches.
- ✅ **Guarantee table wind row** capped HDZ/UHDZ at "130 mph (WindProven)" while the GAF
  page correctly says WindProven has no max — table + Preferred card now say "no max
  wind speed (WindProven™)".
- ✅ **"7 years doing this on my own"** (homepage) — softened to "in this trade"
  (company is ~2 yrs old; 7 yrs is total trade experience).
- ✅ gaf-vs-owens wind note ("150 mph — the highest…") now adds the 160-mph TAMKO
  Storm Series context.

### TAMKO rollout triple-check (all 8 checks PASS on accuracy; gaps fixed)
- ✅ **Disclaimer coverage**: ~28 pages made a new cert claim with no TAMKO
  independent-contractor/trademark disclaimer — added compact disclaimers to 25 city
  pages + roof-replacement hub + the-nbd-guarantee + visualizer; upgraded
  tamko-storm-series and gaf-timberline footer attribution lines (incl. ProShield® /
  Full Start® marks). privacy.html footer got the full GAF+TAMKO cert chip row +
  dual disclaimer (was the only F1-family page without it).
- No overclaims found: every warranty number matches the Gold tier (no Platinum/Diamond
  terms, no Master Elite/Golden Pledge claims). All verify links correct. All JSON-LD
  valid. Logo variants used correctly (color on light, reverse on dark).

### Brand voice (visual sweep)
- ✅ **Corporate "we/our" on the 6 service hubs** (roof-replacement, roof-repair,
  siding-replacement, siding-repair, gutter-replacement, storm-damage) — 67
  sentence-level rewrites to the locked first-person voice, JSON-LD FAQ text kept in
  sync with visible FAQ copy.

### Header/footer (header/footer sweep)
- ✅ **Mobile nav wordmark wrap** (Jo's screenshot): blog template had no mobile
  shrink/nowrap for the "NO BIG DEAL / Home Solutions" text block, so it wrapped to two
  lines beside the logo. Injected a uniform guard (`white-space:nowrap` + ≤768px logo
  36px / brand .9rem) into all 198 pages that render the wordmark.
- ✅ **3-slide vs 4-slide announcement bar**: 32 hub/blog/about pages were missing the
  "One free roof a year" slide the other 157 pages rotate — added, all rotating bars now
  match.
- ✅ privacy.html footer logo 52px → 42px (site standard).

**Verification:** all JSON-LD blocks re-validated (0 invalid), smoke suite unchanged
(2581 pass; 7 pre-existing env failures from missing functions/node_modules).

---

## 2. FALSE ALARMS (checked, intentionally NOT changed)

- **"© 2026 No Big Deal Home Solutions — Goshen, OH" on ~135 pages** — flagged as
  "wrong city," but Goshen is the company HQ; the © line states company location while
  the body "Serving Mason, OH" states the page's market. Coherent as-is.
- **"lifetime labor warranty next to five years"** (Jo's report): no such pairing exists
  on any NBD homeowner page. Two candidates for what was seen:
  1. **`docs/sites/oaks.html`** — the only page in the repo saying "5-Year Labor
     Warranty" (6×). That page is the **Oaks Roofing demo site** (a different, fictional
     company under /sites/ used to sell contractor websites), not the NBD brand.
  2. the-nbd-guarantee Standard card, where "lifetime functionality warranty"
     (Roofivent component) sits a few lines from "sell within five years" (a
     sell-horizon, not a warranty).
  NBD pages deliberately never state a numeric labor warranty — workmanship is The
  Pledge. **Jo: if you saw it somewhere else, say where and we'll hunt it down.**
- **Guarantee table "✓ System Plus" on the Standard tier** — the same table says
  Standard lacks the full 5-of-5 GAF accessories, but GAF System Plus only requires
  3+ qualifying accessory categories, so this may be correct depending on what's
  actually installed on Standard roofs. **CONFIRM with Jo** (see §3.6).

---

## 3. DECISION ITEMS FOR JO (ranked)

1. **Third-person "Joe handles / Joe inspects" voice on ~155 city/area/service pages**
   (HIGH, brand). The locked brand is first-person ("It's just me"), and these pages mix
   voices *within the same page* (ann-bar says "I Handle the Claim", body says "Joe
   offers…"). Fixing is a dedicated rewrite project (~155 pages), possibly scripted per
   template family. Decide: full first-person rewrite, or accept third-person as the
   standard for SEO/city pages and keep hubs first-person (then fix only the intra-page
   mixing).
2. **`docs/tools/index.html` is built on the NBD Pro design system** (HIGH, visual):
   Pro orange #C8541A, Barlow/JetBrains Mono fonts, `.topbar` instead of `.ann-bar`, no
   brand fonts, links into /pro/. Decide: is /tools/ homeowner-facing (→ restyle to the
   marketing system) or a Pro hub (→ move/limit like /pro/)?
3. **Blog posts have three different footers** (F2 grid ×15, blog-footer ×6,
   2-line product-blog ×3) and two nav variants; the 5 "family-C" pages
   (gaf-timberline, tamko-storm-series + 3 blogs) also use a static cert announcement
   bar and bare nav. Decide the canonical blog/product template; consolidation is
   mechanical after that.
4. **Trust bar advertises certifications only on the homepage** — service-hub trust bars
   have different 4–5 item sets with no GAF/TAMKO item. Decide whether cert belongs in
   all trust bars (recommended: yes, swap one slot for "GAF & TAMKO Certified").
5. **Footer feature coverage varies by family**: cert chip row on only ~19 pages; social
   icons absent from all 39 F2 grid-footer pages; "footer-badges" row missing on 11 of
   42 full-footer pages; NBD Pro door on only 16 pages. Pick the canonical footer
   feature set per family and it can be scripted.
6. **Standard tier × System Plus** (see §2): confirm whether Standard installs ≥3
   qualifying GAF accessory categories (starter + felt + Cobra would qualify). If not,
   the table cell should downgrade to GAF's base limited warranty.
7. **Estimate tool default price band $8,500–$15,000 vs pricing blog $13,000–$18,500**
   (floor $10k). A reader hitting both sees a mismatch. Jo owns pricing — align one to
   the other.
8. **Pledge naming isn't locked** — "NBD Lifetime Pledge" (894) vs "Lifetime Pledge"
   (404) vs "The Pledge" (50), inconsistent even on the-pledge hub. Recommend: full name
   "NBD Lifetime Pledge" on first mention/headers, "the Pledge" as running shorthand;
   fix casing strays.
9. **Smaller cosmetic queue** (fix opportunistically):
   - "Roof Visualizer" (160) vs "AI Visualizer" (15) — pick one.
   - tel: href split (`tel:8594207382` ×774 vs `tel:+18594207382` ×208) — E.164
     everywhere is the better standard.
   - Button/card radius mixes (6/8/10/12/14px), eyebrow letter-spacing .14/.15em drift.
   - og:image on 5 shingle pages is a logo/badge PNG — swap for photos.
   - `nbd-logo.png` is actually JPEG data with a .png extension (browsers cope; still
     worth re-exporting properly).
   - Guarantee-table impact row shows "Class 3" for the Standard tier — Timberline NS /
     Heritage carry no UL 2218 rating; verify and likely change to "—".
   - TAMKO Pro Gold badge: official artwork from Jo's TAMKO Pro portal still pending;
     site uses TAMKO logo + "PRO GOLD" chip meanwhile.

## 4. Confirmed CLEAN (no action)

Palette (204/204 pages identical navy/orange vars; the #B85400/#DA6A05/#A64B00 darker
oranges are a deliberate, role-consistent contrast ramp) · fonts (Bebas/Montserrat/
Dancing Script everywhere except tools/) · favicon 400/400 · displayed phone format
(1,446× consistent) · Pledge terms wording · TAMKO/GAF warranty numbers post-fix ·
wind/impact specs post-fix · accessory stack-up across homepage/guarantee/NBD Build ·
deductible/claims language (legally safe everywhere) · logo aspect ratio (no
distortion) · service-area page inventory (25 cities).

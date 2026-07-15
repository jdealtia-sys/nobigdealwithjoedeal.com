# GAF + TAMKO Rebrand — BUILD BRIEF (execution-ready)

_Last updated 2026-07-15. This is the self-contained brief to build the dual-brand homeowner site. Read this + memory `gaf-tamko-rebrand-audit` and you can run cold._

> **2026-07-15 — GOLD IS APPROVED.** Jo is now a **TAMKO Pro Certified Contractor — Gold** (The TAMKO Edge program). The §3 gold-safe rule is **lifted**: "TAMKO Pro Gold™ Certified Contractor" claims are live sitewide (homepage, about, storm-series, city-page hero chips, blog disclosures, llms.txt, JSON-LD credentials). Verified facts used on-site: ProShield® Enhanced Limited System Warranty (20-yr non-prorated Full Start®, tear-off covered, 10-yr transferability) and ProShield® HailGuard enhanced warranty (20-yr Full Start + 10-yr hail vs base 10/7). Verification link used: tamko.com/locate-a-contractor. **TAMKO Pro ID# 181382, certified July 8, 2026** (from Jo's certificate PDF, 2026-07-15) — ID is in JSON-LD credentials + footer disclaimers, mirroring GAF ID 1162011. Official TAMKO PRO™ GOLD shield badge extracted from the certificate → `docs/assets/tamko/tamko-pro-gold-badge{,-320,-120}.png`, deployed on all cert cards/chips (replaced the interim logo+"PRO GOLD" chip). Note: certification is subject to **annual recertification** — recheck each year.

---

## 0. STATUS

**Already LIVE (shipped today):**
- Homepage Phase 1 (PR #715): TAMKO Building Products logo in the "Brands I Install" strip (grayscale-hover, matches GAF/Hardie); hero tiers show "GAF Timberline NS/HDZ **or TAMKO Heritage**"; services-grid copy dual-brand; JSON-LD `knowsAbout` skill "TAMKO Heritage Shingle Installation" (NOT a credential). GAF cert badge/trust bar untouched.
- Golden Pledge accuracy fix (PR #714): removed false "Golden Pledge ready/eligible" claims (Joe is base GAF Certified, not Master Elite) → "System Plus".
- TAMKO logo assets committed at `docs/assets/tamko/` (tamko-logo-color.svg, -reverse.svg, -bw.svg, -color.png).

**Jo's status:** ~~**Team TAMKO** (installer) — **NOT yet Pro Gold** (cert pending TAMKO's review of <1-yr companies).~~ **UPDATE 2026-07-15: Pro Gold APPROVED — see banner at top.** Heritage is fine as an NS-equivalent value rung (his words).

---

## 1. THE LOCKED MODEL — service-led, GAF default, TAMKO "Storm Series"

The page leads with **NBD** (company / the Pledge / warranty / how Joe works) — that's what homeowners pick first; manufacturer/shingle comes second. Then the shingle, two ways:

- **GAF — default lineup (classic value→premium):** Timberline NS (good) → HDZ (better) → UHDZ (best).
- **TAMKO — "Storm Series" (hail/impact play, introductory):** Heritage (value/NS-equivalent) → **Titan XT** (good) → **StormFighter Flex** (better) → **HailGuard** (best). Framed "built for hail country."

**System/accessories = constant on every roof** EXCEPT where a TAMKO warranty requires TAMKO parts (see §3). Vents + pipe boots stay **GAF/Roofivent** (TAMKO has none). The NBD Build + Pledge + annual outreach ride on any shingle → service decouples from shingle.

Built to **graduate TAMKO to a co-equal lane** later if Jo goes 50/50 (he's considering it).

---

## 2. SPEC SHEET (verified from Jo's TAMKO sell sheets, 2026-06-24)

| Line | Tier | Impact | Wind | Warranty | Notes |
|---|---|---|---|---|---|
| **Heritage** | value | — | 110–130 mph | Limited Lifetime | NS-equivalent value rung |
| **Titan XT** | good | UL Class 3 | 160 mph* | Limited Lifetime | ForceFX + AnchorLock + TriShield; FL/Miami-Dade |
| **StormFighter Flex** | better | UL Class 4 | 160 mph* | Limited Lifetime | ForceFX/AnchorLock; "Voted #1 Product of the Year"; FL/Miami-Dade |
| **HailGuard** | best | UL Class 4 **+ tested beyond** | 160 mph | Hail warranty (see §3) | ImpactCore; "industry's first/only asphalt shingle with a HAIL warranty" |

\* 160 mph WindGuard requires **TAMKO starter + TAMKO hip & ridge**.

**Colors** — HailGuard (8): Black Walnut, Rustic Slate, Olde English Pewter, Thunderstorm Grey, Rustic Black, Rustic Cedar, Weathered Wood, Oxford Grey. Titan XT/StormFighter share the TAMKO premium palette (pull exact per-line lists from the brochures at visualizer-build). Sell sheets: `C:\Users\jonat\Downloads\tamko-{titan-xt,stormfighter-flex,hailguard}-*.pdf` (read via **PDF_Tools MCP `read_pdf_content`** — the Read tool's pdftoppm is unavailable on this box).

---

## 3. GOLD-SAFE / ACCURACY RULES (CRITICAL — Jo's TAMKO review is sensitive)

- ~~**NEVER** write "TAMKO Pro Gold," "TAMKO Certified," or any TAMKO certification claim until Gold is approved. TAMKO = "a brand I install" / "Storm Series," not a cert. GAF stays the only certification on the site.~~ **LIFTED 2026-07-15 — Gold approved.** Cert claims are live; keep them accurate to the Gold tier (do NOT claim Platinum/Diamond, MasterShield/DiamondShield, or workmanship coverage — those are higher tiers).
- **NEVER** write "UL rated over Class 4" / "Class 5" — Class 4 is the top UL 2218 tier. HailGuard is "**Class 4 — tested beyond Class 4**."
- **HailGuard hail warranty is NOT Gold-gated** ✅ — the base **HailGuard Limited System Warranty (10-yr non-prorated Full Start + 7-yr hail warranty)** is available to **ALL contractors incl. Team TAMKO**. So HailGuard CAN be featured WITH its hail warranty now. Enhanced terms scale with cert (Certified Pro → 20-yr/10-yr hail; Platinum/Diamond → 50-yr Full Start, 12–15-yr hail + 10–25-yr workmanship) — use those as future "more coverage when certified" upsells, not a gate.
- **Warranty accessory requirements** (bake into Storm Series specs so warranties stick): HailGuard warranty needs **TAMKO Synthetic Guard** (underlayment) + **Moisture Guard** (ice & water); StormFighter/Titan 160 mph needs **TAMKO starter + hip & ridge**. So a TAMKO storm roof = TAMKO underlayment/starter/hip&ridge + GAF/Roofivent vents & boots.

---

## 4. BUILD TASKS

1. **Homepage** (`docs/index.html`): rework hero tier card → GAF NS/HDZ/UHDZ as the default tiers; add a distinct **"TAMKO Storm Series"** callout/section (Titan XT/StormFighter/HailGuard, "built for hail"). Remove the interim "or TAMKO Heritage" inline text from the GAF tier rows (Heritage lives in the Storm Series as the value floor). Keep TAMKO logo in brands strip.
2. **Tier page** (`docs/services/the-nbd-guarantee/index.html`): restructure to NBD-led → GAF tiers → TAMKO Storm Series section. **DISCARD** the superseded batch-2 shared-tier edits (they were never deployed).
3. **New page** `docs/services/tamko-storm-series/index.html` (parallel to `/services/gaf-timberline`): the 4-line Storm Series with specs + warranties (Gold-safe). Add nav/footer link + JSON-LD.
4. **Visualizer** (`docs/assets/js/inline/27bd7bf65b.js` + `docs/visualizer.html`): add a manufacturer dimension; add TAMKO Storm Series lines + colors; parameterize `paletteHeaderLabel()` (line ~524, currently hardcodes "GAF") + the AI-prompt assembly.
5. **24 city pages** (`docs/services/roof-replacement-*.html` + hub): mechanical "GAF Timberline → GAF Timberline (or TAMKO Storm Series for hail)" body/meta; soften any remaining "full GAF system / no off-brand" absolutist copy. No cert-badge changes.
6. **about.html**: add TAMKO to brand picks (installer, not cert).

---

## 5. OPEN INPUTS (from Jo / his TAMKO rep)
- Confirm HailGuard/StormFighter/Titan **availability + color sets for OH/KY** (the sell sheets are Phillipsburg-region docs).
- Pull full per-line color lists (Titan XT, StormFighter Flex) from the brochures for the visualizer.
- ~~When Gold lands: add "TAMKO Pro Gold Certified" badge + the enhanced warranties + a TAMKO cert card (then it joins GAF in the certification area).~~ ✅ DONE 2026-07-15. Remaining: swap the interim TAMKO-logo+"PRO GOLD"-chip visuals for the official Gold badge artwork once Jo pulls it from the TAMKO Pro portal.

---

## 6. HOW TO RUN
- Fresh worktree off `origin/main`: `git worktree add -b feat/gaf-tamko-storm-series <path> origin/main`.
- Preview: add a config to `C:\Users\jonat\.claude\launch.json` (http-server on the worktree's `docs/`, unused port) → `preview_start`. Public marketing pages need no auth (verify live too).
- Repo auto-deploys on merge to `main` (~9 min, hosting-first). Deploy RED ≠ your code (transient auth/GCF races → `gh run rerun --failed`). Verify live homepage/pages via Chrome MCP (public, no App Check needed).
- Keep each change Gold-safe per §3.

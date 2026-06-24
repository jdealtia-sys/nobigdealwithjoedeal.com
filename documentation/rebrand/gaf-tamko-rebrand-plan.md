# GAF + TAMKO Dual-Certification — Homeowner Site Rebrand Plan

_Drafted 2026-06-24 from a 55-touchpoint multi-agent audit of the live homeowner site (nobigdealwithjoedeal.com). Status: **plan for review** — no site edits made yet._

---

## 0. Decision (locked with Jo)

- **Keep the NBD personal brand untouched** — Joe-first-person voice ("I", not "we"), the locked fonts (Bebas Neue / Montserrat / Dancing Script), the "I put my name on it" spine. The manufacturers are *credentials that reinforce the brand*, not a rebrand of it.
- **Brand-agnostic tiers.** Standard / Preferred / Elite stay as quality tiers; **GAF Timberline and TAMKO Heritage are the two material choices *within* each tier.**
- **GAF = flagship, TAMKO = certified second choice.** Don't dilute GAF; add TAMKO as real, certified, warranty-backed choice.
- **Honesty discipline.** You are **GAF Certified (base)** + **TAMKO Pro Gold** — both solid mid-tier. We say "certified installer for both systems, both backed by enhanced manufacturer warranties." We do **not** claim GAF Master Elite, GAF Golden Pledge, or TAMKO Diamond.

---

## 1. What the audit found (the shape of the work)

GAF is woven into the site at three depths — each needs a different fix:

| Depth | What | Reach | Fix type |
|---|---|---|---|
| **Chrome** | `/services/gaf-pivot-boot` nav + footer link | ~137+ pages (~274 spots) | Mechanical find/replace |
| **Badge** | "GAF Certified / Verify on GAF.com" block + `/assets/gaf/` images | ~29 service pages + homepage | Add TAMKO badge beside GAF |
| **Architecture** 🪝 | **Standard/Preferred/Elite hard-bonded to GAF SKUs** (NS/HDZ/UHDZ) | the-nbd-guarantee, hero card, gaf-timberline, lumanail, tier-rec JS, per-city copy | Re-concept (the real work) |

**Why it's less work than it looks:**
- Tier *names* (Standard/Preferred/Elite) are already **NBD-owned / brand-neutral** — they survive as-is.
- The **estimate/quote funnel is already manufacturer-agnostic** (Good/Better/Best = 3-Tab/Architectural/Designer) — **zero changes**.
- The **visualizer** is GAF-locked but driven by **one JS data file** (`27bd7bf65b.js`) — one refactor opens it.
- The **"Brands I Install" strip is already multi-manufacturer** (James Hardie, Royal, Polaris) — TAMKO drops in.
- ~5 city pages already say "GAF or Owens Corning" — proves copy can name 2 manufacturers without breaking layout.

**Today:** TAMKO appears **0 times** sitewide; the shingle story is 100% GAF.

---

## 2. TAMKO facts (web-verified)

- Program: **The TAMKO Edge**. Your tier = **TAMKO Pro Gold** (tiers above: Platinum, Diamond).
- **Homeowner value of Gold:** you can register the **TamkoShield Enhanced Warranty** (longer/stronger than a standard install) and install **Heritage® / Heritage Premium®** architectural shingles — TAMKO's direct answer to GAF Timberline.

---

## 3. Tier ↔ product mapping (PROPOSED — confirm against what you'll stock)

| NBD Tier | GAF (flagship) | TAMKO (certified choice) | Notes |
|---|---|---|---|
| **Standard** | Timberline NS | Heritage | Entry architectural |
| **Preferred** (Most Chosen) | Timberline HDZ | Heritage Premium *(or Titan XT)* | Main architectural |
| **Elite** | Timberline UHDZ (Class 4 IR) | StormFighter IR / Heritage IR | Impact-rated premium |

> ⚠️ Confirm the exact TAMKO lines you'll carry per tier and which carry the Class-4 impact rating — that drives the Elite mapping.

---

## 4. Phased execution

### Phase 1 — "Now dual-certified" signal _(fast, high-impact, no tier surgery)_
The credibility win, shippable first. **Text/schema doable immediately; visual needs your TAMKO logo.**
- `index.html`: add TAMKO to the **"Brands I Install"** strip (line ~1632); add a **second "Manufacturer" cert card** (TAMKO Pro Gold) in the partners grid (~1398); update the **trust bar** (~935) to read dual-cert.
- `index.html` **JSON-LD ×2** (lines 470, 536): add a TAMKO `EducationalOccupationalCredential`; add "TAMKO Shingle Installation" to the skills array (530).
- Add the **TAMKO trademark / independent-contractor disclaimer** beside the GAF one (lines 1429 + 1732 — keep both in sync).
- `about.html` (~716): add TAMKO to "Brand Picks."
- **Assets needed:** TAMKO logo (color + grayscale), TAMKO Pro Gold badge image.

### Phase 2 — Cert badges + meta across service pages
- Add a TAMKO cert badge **beside** GAF in the ~29 hero-badge blocks (24 roof-replacement city pages + hub + brand pages).
- Per-city `<meta>` / schema (~36 one-off strings): "GAF Certified Contractor" → "GAF & TAMKO Certified" where it's a *cert* claim (keep the unique city copy).
- Soften the absolutist **"full GAF system / no off-brand substitutes"** lines that actively fight dual-brand messaging.

### Phase 3 — Tier architecture (the spine)
- `services/the-nbd-guarantee/index.html`: re-concept Standard/Preferred/Elite as quality tiers, each presenting **GAF Timberline _or_ TAMKO Heritage** equivalent.
- `index.html` hero tier card (894/901/908): tier = quality level, "GAF Timberline HDZ or TAMKO Heritage Premium," etc.
- `assets/js/inline/087ec489fd.js` tier-recommendation copy: brand-agnostic, name both options.
- `lumanail` + `gaf-pivot-boot` pages: decouple from "full GAF system" language.

### Phase 4 — Visualizer manufacturer-aware
- `assets/js/inline/27bd7bf65b.js`: add a **manufacturer dimension** above `roofLines`; parameterize `paletteHeaderLabel()` (line 524, currently hardcodes "GAF"); add TAMKO Heritage/Premium lines + verified colors; update the AI-prompt assembly (612).
- `visualizer.html` (479-491): badge + copy → "GAF or TAMKO" picker.
- **Assets needed:** TAMKO shingle color swatches/images (parallel to the empty `assets/gaf/timberline/` scaffold).

### Phase 5 — Generated docs + accuracy fixes
- `functions/print/templates/warranty.hbs` (~68): make the manufacturer dynamic (GAF or TAMKO per job) so the **warranty PDF** reflects the shingle actually installed.
- **⚠️ Golden Pledge accuracy fix (folded in per your call):** replace every **"Golden Pledge ready/eligible"** claim with **"System Plus Limited Warranty"** (`the-nbd-guarantee`, `lumanail`, `gaf-pivot-boot`, `087ec489fd.js`). Golden Pledge requires GAF **Master Elite**, which you don't hold — this protects you from a false-advertising exposure regardless of TAMKO.
- New **`/services/tamko-heritage`** product page (parallel to `/services/gaf-timberline`) — captures TAMKO search traffic.

---

## 5. SEO guardrails
- **Don't remove GAF** — it has real equity + a verified GAF ID (1162011). *Add* TAMKO alongside everywhere.
- The new TAMKO product page captures TAMKO-specific searches you can't rank for today.
- Update the **"GAF vs Owens Corning vs Atlas"** comparison blog to include TAMKO.

---

## 6. What's needed from Jo (blocks the visual phases)
1. **TAMKO logo** — color + grayscale (for the brands strip hover effect).
2. **TAMKO Pro Gold badge** image.
3. **TAMKO shingle color set** (Heritage / Premium) for the visualizer.
4. Confirm **which TAMKO lines map to which tier** (+ which are Class-4 impact).
5. Confirm the **exact warranty** you can register (TamkoShield Enhanced — name + terms).
6. Confirm your **GAF level is base Certified** (not Master Elite) so we word warranties correctly + justify the Golden Pledge fix.

---

## 7. Rough effort
~55 inventoried touchpoints. Phase 1 ≈ 10 edits (highest impact-per-effort), Phase 2 ≈ 65 (badges + meta), Phase 3 ≈ 6 load-bearing pages, Phase 4 = 1 JS file + visualizer.html, Phase 5 = warranty.hbs + ~4 accuracy fixes + 1 new page.

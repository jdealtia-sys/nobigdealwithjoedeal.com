# BRAND-SPEC.md — Locked brand source of truth (per tenant)

> Run: brand-consistency sweep, 2026-06-07. Anchor commit: `6fefcd25` (main).
> These are the specs each surface is scored against. Extracted from live
> source in this repo (Phase 0). Where surfaces disagree, the **canonical**
> value is the public marketing site (`docs/index.html`), since that is the
> face customers see and the one the print system's own comments cite as
> "the canonical brand mark."

---

## Tenant ZERO — No Big Deal (NBD)

**Names seen in the wild (already inconsistent — see BUG-LOG):**
- "No Big Deal with Joe Deal" (domain / public voice)
- "No Big Deal Home Solutions" (PDF letterhead + footer, `brandBandTop.hbs`)
- "NBD" (seal / nav badge)

**Canonical brand (from `docs/index.html` `:root`, lines 29–42):**

| Token | Value | Source |
|-------|-------|--------|
| Navy (primary) | `#1E3A6E` | `--navy` |
| Navy dark | `#142A52` | `--navy-dark` (nav bg, body text color) |
| Navy mid | `#1A3260` | `--navy-mid` |
| Navy light | `#243F7A` | `--navy-light` |
| Orange (accent) | `#E8720C` | `--orange` |
| Orange light | `#F08030` | `--orange-light` |
| Orange dark | `#C45E08` | `--orange-dark` |
| Off-white | `#F5F3EF` | `--off-white` |

**Typography (marketing):** `Bebas Neue` (display), `Montserrat` (body), `Dancing Script` (logo accent). — `docs/index.html:27,45`

**Tagline / voice:** "No Big Deal with Joe Deal — …seriously, it's in the name." Anti-corporate, owner-on-every-job, "Call Joe directly." Real contact: **(859) 420-7382**, **jd@nobigdealwithjoedeal.com**, Greater Cincinnati / N. Kentucky.

**Logo:** `https://nobigdealwithjoedeal.com/assets/images/nbd-logo.png` (referenced by the PDF system as canonical), favicon `/favicon.svg`.

### ⚠ NBD internal drift already found in Phase 0 (Axis A, intra-tenant)
NBD's own brand is **not** consistent across its surfaces:

| Surface | Orange | Navy | Fonts | Source |
|---------|--------|------|-------|--------|
| Marketing site (canonical) | `#E8720C` | `#1E3A6E`/`#142A52` | Bebas Neue + Montserrat | `docs/index.html` |
| Client doc generator (NBDDocGen) | `#e8720c` ✓ | `#1e3a6e` ✓ (sec `#1a1a2e`) | Barlow (CSS) | `docs/pro/js/document-generator.js:30-34` |
| Server PDF system (.hbs) | **`#C8541A`** ✗ drift | **none** — charcoal `#14181F` | Barlow / Barlow Condensed | `functions/print/design-system.css:46-65` |
| `companies` Firestore seed (NBD) | **`#ff6600`** ✗ placeholder | **`#0066cc`/`#003366`** ✗ placeholder | — | `functions/seed-companies.js:33-37` |

→ **Three different "NBD oranges"** (`#E8720C`, `#C8541A`, `#ff6600`) and navy that is present on two surfaces and absent on the print PDFs.

---

## Beta Tenant — Oaks Roofing & Construction

Built for partner **Scott Oaks**. Source in THIS repo at `docs/sites/oaks/`
(served at `/sites/oaks/`, `noindex`). Brand extracted from `style.css`,
`index.html`, `logo-orange.svg`.

| Token | Value | Source |
|-------|-------|--------|
| Orange (accent/primary) | `#E8720C` | `style.css:6` `--orange` |
| Orange hover | `#D4670B` | `style.css:7` |
| Dark (nav/hero) | `#1A1A1A` | `style.css:9` `--dark` |
| Darker (footer) | `#111111` | `style.css:10` `--darker` |
| Gray scale | `#222`→`#f5f5f5` | `style.css:11-17` |
| Review stars | `#F5B731` | `style.css:210` |

**Typography (Oaks):** `Montserrat` (headings), `Open Sans` (body). — `style.css:19-20`, `index.html:10`

**Identity:** "Oaks Roofing & Construction", Goshen OH. Phone **(513) 827-5297** (`index.html:72`), email `joe@oaksrfc.com` (seed). Slogan emphasis "Roofing, Siding, Gutters", "5-year labor warranty". Logo: `docs/sites/oaks/logo-orange.svg` (house + hammer, orange).

**Intended palette per the per-tenant config** (`seed-companies.js:64-67`): `primary:#333333`, `accent:#e8720c`, `navBg:#1a1a1a` → charcoal/black + orange. Matches the live microsite.

### ⚠ The central tension (Axis B input)
**Oaks's accent orange `#E8720C` is byte-identical to NBD's canonical orange.**
This is the single biggest separation ambiguity: it could be (a) a deliberate
shared accent, (b) a copy-paste artifact from NBD's template, or (c) coincidence.
Oaks *does* diverge on darks (charcoal/black vs NBD navy) and body font (Open Sans
vs Montserrat), so it has a distinct identity — but the shared orange means
"orange alone" can never be used as a bleed signal between these two brands.
**→ Flagged as a question for Jo, not an auto-fix.** (See SEPARATION.md.)

---

## Per-tenant brand mechanism (does it exist? is it used?)

**A per-tenant brand config EXISTS** but is **not wired to the surfaces that render brand:**

- `companies/{companyId}` (`functions/seed-companies.js`) carries `name, owner, phone, email, address, logo, colors{primary,accent,navBg}, services, serviceAreas, warranty, siteUrl`. **But the NBD record's colors are generic placeholders (`#0066cc`/`#ff6600`), and the NBD/Oaks phones are both the same `(513) 827-5297` → this collection is stale seed/test data, not a live source of truth.**
- `companyProfile/{companyId}` (`docs/pro/js/company-profile.js`) is the *real* per-tenant doc, scoped per companyId after the Phase-1 security audit. It carries **letterhead TEXT** (businessName/phone/email/website/address/license), legal clauses, financing, services, tagline — **but NO colors and NO logo.** The doc generator's *visual* brand (navy/orange/Barlow/seal) is a **hardcoded JS literal** (`document-generator.js:23-35`), not read from this profile.

**Net:** brand TEXT is partly tenant-resolved (companyProfile letterhead, if the rep fills it). Brand VISUALS (colors, logo, fonts, seal, "No Big Deal" wordmark) are **hardcoded NBD** in every renderer. See SEPARATION.md for the full bleed map.

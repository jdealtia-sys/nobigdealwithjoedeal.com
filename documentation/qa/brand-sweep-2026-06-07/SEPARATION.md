# SEPARATION.md — Tenant brand separation / bleed verdict

> **THE CENTERPIECE.** Status: **FINAL (Phases 0–4, code-inspection + live public walk).**
> Per Jo's call, artifact branding was proven by code inspection (the renderers take
> no per-tenant brand input, so a live Oaks render can only re-prove the bleed). The
> Oaks *public* bleed was confirmed live in-browser.

## Headline verdict (preliminary)

**Brand is HARDCODED, not tenant-resolved, on every surface that renders brand.**
A per-tenant brand config exists (`companies.colors`, `companyProfile`) but:
1. it carries **no logo and no colors** on the doc path (`companyProfile`),
2. the one place colors *do* live (`companies.colors`) is **stale placeholder
   data nobody reads**, and
3. every renderer hardcodes NBD's identity directly.

→ **This is a STRUCTURAL fix ("resolve brand from the active tenant"), not a
pile of per-surface token swaps.** The token swaps (e.g. print orange drift)
are real but secondary; fixing them does nothing for tenant separation.

## Bleed map — where NBD identity is hardcoded

| # | Surface | What's hardcoded | File / line | If Oaks used it |
|---|---------|------------------|-------------|-----------------|
| B1 | **Server PDF layout** | NBD logo URL, "No Big Deal Home Solutions", `(859) 420-7382`, `jd@…`, "NBD" seal | `functions/print/partials/brandBandTop.hbs:7-11`, `_layout.hbs:27-30` | **CRITICAL bleed** — Oaks PDF shows NBD logo/name/phone/email |
| B2 | **Server PDF renderer** | `renderPdf` callable passes **no tenant/company/brand param**; only `{template,payload,filename}` | `functions/render-pdf.js:228-237` | renderer *cannot* produce Oaks branding — no input exists |
| B3 | **Server PDF colors** | static `:root` `--nbd-orange:#C8541A`, charcoal, Barlow fonts | `functions/print/design-system.css:46-65` | Oaks PDF uses NBD print palette |
| B4 | **Client doc generator** | `brand` JS literal: navy `#1e3a6e`, orange `#e8720c`, tagline "No Big Deal — We've Got You Covered" | `docs/pro/js/document-generator.js:23-35` | Oaks doc chrome is NBD navy/orange + NBD tagline |
| B5 | **Client doc letterhead** | `companyProfile` overrides letterhead TEXT only **if rep fills it**; colors/logo/seal/wordmark stay NBD | `docs/pro/js/company-profile.js:23-35` | Oaks gets Oaks *text* on NBD-colored chrome → partial bleed |
| B6 | **In-app chrome** | TBD Phase 3 — login/header/footer/portal/email branding | `docs/pro/*` | TBD |
| B7 | **Oaks public footer** | "Powered by NBD Pro" injected on every Oaks page | `docs/sites/oaks/shared.js:145` | NBD platform name shown to Scott's customers |
| B8 | **Oaks public background** | shared NBD stylesheet paints `html{background:#142a52}` NBD navy | `docs/assets/css/nbd-mobile.css:43` (linked by all Oaks pages) | NBD navy visible at Oaks page edges |
| B9 | **Oaks public assets/domain** | NBD-domain canonicals + NBD `drone-hero-curb.jpg` og:image | `docs/sites/oaks/*.html` heads | Oaks SEO/identity tied to NBD domain |
| B10 | **Oaks lead pipeline** | form posts via NBD `_nbdSubmitLead` | `docs/sites/oaks/shared.js:255` | data tenancy (cross-ref H-1), not visual brand |

> **Phase 2 update to the thesis:** bleed is NOT only in the artifact/CRM layer — the
> Oaks *public* microsite already leaks NBD identity via SHARED SOURCES (a shared NBD
> stylesheet, a shared footer component, shared assets/domain, a shared lead pipeline).
> This is the "shared source that defaults to one tenant's brand" pattern the brief
> asked to find, made concrete. Same structural root: surfaces don't resolve brand from
> the active tenant — they reach for NBD-named shared files.

## Does a per-tenant brand config exist, and is it ignored?

**Yes and yes.**
- `companies/{companyId}.colors{primary,accent,navBg}` — exists, **ignored by
  every renderer**, and populated with stale placeholders (NBD = `#0066cc`/`#ff6600`,
  not the real navy/orange; NBD & Oaks share one phone).
- `companyProfile/{companyId}` — exists, per-tenant, used for letterhead **text**
  only; has **no color/logo schema** to resolve visual brand from.

## Added Phase 3 bleed points (artifact + customer-facing layer)
| # | Surface | What's hardcoded | File |
|---|---------|------------------|------|
| B11 | **Customer portal** (most tenant-facing) | NBD logo, name, jsPDF "NO BIG DEAL" header, **SMS "Joe from No Big Deal Roofing"**, NBD email sender, nobigdealwithjoedeal.com | `docs/pro/customer.html:984,2122,3390,4248,4325` |
| B12 | **Doc numbers / customer IDs** | `NBD-` prefix everywhere (`NBD-0001`, `NBD-WC-`, `NBD-…`) | `dashboard-bootstrap.module.js:2463`, `document-generator-templates.js:188`, `estimate-finalization.js:214` |
| B13 | **3rd doc path (inline jsPDF)** | orange band + "NO BIG DEAL" text, no tenant input | `customer.html:2115`, `estimate-finalization.js:5259` |

## FINAL VERDICT — structural, not a pile of token fixes

Brand is **hardcoded on every customer-facing surface** — 3+ doc generators
(Puppeteer `.hbs`, client html→pdf, inline jsPDF), the customer portal, SMS/email
copy, doc-number prefixes — **and** the Oaks public microsite (shared NBD CSS, footer,
assets, domain). A per-tenant brand config **exists but is ignored** (`companies.colors`
= stale placeholders nobody reads; `companyProfile` = letterhead TEXT only, no
color/logo schema). The hardcoded brand is also **internally inconsistent** — 3
disagreeing oranges (`#e8720c`/`#C8541A`/`#ff6600`) and navy present on only one of
three doc paths. **→ The fix is to make surfaces resolve brand from the active tenant,
not to swap tokens.**

### The structural work (FLAGGED — out of RULE-1 "trivial" scope)
1. **One brand source.** Extend `companyProfile/{companyId}` with a real visual schema:
   `{ logoUrl, colors{navy,orange,ink,charcoal}, fonts, displayName, seal, contact, smsSignOff, emailFrom }`. Backfill real NBD + Oaks values; retire the stale `companies` seed.
2. **Server PDF:** thread resolved brand into `renderPdf` payload; replace hardcoded
   `brandBandTop.hbs`/`_layout.hbs` values with `{{company.*}}`; inject brand colors as
   CSS vars instead of the static `:root` in `design-system.css`.
3. **Client docgen:** replace the static `COMPANY.colors`/logo literal with the resolved brand.
4. **Customer portal + jsPDF + SMS/email:** swap every hardcoded "No Big Deal", `nbd-logo.png`,
   phone, email, and `NBD-` doc-number prefix for the resolved tenant values.
5. **Oaks public:** stop loading NBD-named shared sources on Oaks pages (`nbd-mobile.css`
   navy bg, NBD og:image/canonical) — give Oaks its own; "Powered by NBD Pro" footer is
   ACCEPTED (Jo: intentional white-label credit).

### Trivial token swaps available THIS run (Axis-A only — do NOT fix separation)
- Print orange drift `#C8541A → #E8720C` (`design-system.css:46-49`). One value.
- (Oaks navy-bg bleed B8/BLEED-O2 is near-trivial but Jo chose to keep it flagged, not fix.)

> None of the trivial swaps move the separation needle. The payload is the 5-step
> structural change above. Recommend scoping it as its own initiative.

## Resolved decisions (Jo, 2026-06-07)
- Oaks orange `#E8720C` (= NBD's) → **should be distinct** → counted as drift (BLEED-O4); report proposes an Oaks-specific accent.
- "Powered by NBD Pro" on Oaks → **accepted** (intentional white-label credit) → not bleed.
- Artifact diff → **code-inspection** (conclusive; renderers take no per-tenant brand input).

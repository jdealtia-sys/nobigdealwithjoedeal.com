# BUG-LOG.md — ranked brand findings

> Run 2026-06-07. Ranked. Each: wrong value vs correct brand token + file responsible.
> CRIT = cross-tenant bleed. A# = Axis A (fidelity). Status seeded from Phase 0;
> live-render confirmation in Phase 3.

| ID | Sev | Surface | Wrong value | Should be | File | Status |
|----|-----|---------|-------------|-----------|------|--------|
| CRIT-1 | Critical | Server PDF (all 8 types) for any non-NBD tenant | NBD logo + "No Big Deal Home Solutions" + (859) 420-7382 + jd@… + "NBD" seal, hardcoded | resolved from active tenant | `functions/print/partials/brandBandTop.hbs:7-11`, `_layout.hbs:27-30`, `render-pdf.js:228-237` | confirmed (code); structural fix — FLAG |
| CRIT-2 | Critical | Client docgen for any non-NBD tenant | brand literal navy/orange + "No Big Deal" tagline | resolved from active tenant | `docs/pro/js/document-generator.js:23-35` | confirmed (code); structural fix — FLAG |
| A1 | Medium | Server PDF system | orange `#C8541A` | `#E8720C` (canonical) | `functions/print/design-system.css:46-49` | ✅ **FIXED** on `brand-fixes-2026-06-07` (orange family unified to canonical). Pending Jo deploy-OK + render-verify. Note: `#C8541A` may have been a deliberate warm-print orange — revert is 1 commit. |
| A2 | Medium | Server PDF system | **no navy anywhere**; charcoal `#14181F` only | NBD brand pairs navy+orange | `functions/print/design-system.css:50-57` | drift — FLAG (design decision, not 1-value) |
| A3 | Low/Medium | `companies` Firestore seed (NBD) | colors `#0066cc`/`#ff6600`/`#003366`; phone (513) 827-5297; email joe@nobigdeals.com | navy `#1E3A6E` / orange `#E8720C`; (859) 420-7382; jd@nobigdealwithjoedeal.com | `functions/seed-companies.js:29-37` | stale placeholder — FLAG (seed only) |
| A4 | Low | Brand naming | "No Big Deal Home Solutions" vs "No Big Deal with Joe Deal" vs "NBD" | one canonical wordmark | `brandBandTop.hbs`, `_layout.hbs` | FLAG (naming decision for Jo) |

## Phase 1 (NBD public) — minor NON-brand notes (not Axis A failures)
| ID | Sev | Page | Note |
|----|-----|------|------|
| N1 | Low | `/blog/how-much-does-roof-cost-cincinnati-2026` | H1 is "how much does a roof cost" but the intro paragraph opens about hail-damage insurance coverage — title↔intro content mismatch (editorial, not brand). |
| N2 | Info | `/free-roof/` | Standalone magnet renders without the standard top nav/announcement bar — likely intentional for a focused landing; confirm with Jo. |

> Phase 1 Axis A = clean PASS across all 10 representative kinds (see BRAND-MATRIX).

## Phase 2 (Oaks microsite) — Axis B bleed (centerpiece) + Axis A
> Oaks public surface = in-repo `docs/sites/oaks/`, served at `nobigdealwithjoedeal.com/sites/oaks/`.
> The vanity domain `oaksroofingandconstruction.com` is a PARKED SQUARESPACE "under
> construction" placeholder — NOT this site (brief assumption was stale). Axis A = PASS
> (distinct black+orange+Montserrat identity, Oaks logo/phone/name, consistent chrome).

| ID | Sev | What bleeds onto Oaks | Wrong value | Should be | File | Status |
|----|-----|----------------------|-------------|-----------|------|--------|
| ~~BLEED-O1~~ | **ACCEPTED** | "Powered by NBD Pro" footer | — | — | `docs/sites/oaks/shared.js:145` | **Jo: intentional white-label platform credit — NOT bleed.** |
| BLEED-O2 | High | **NBD navy `#142a52`** painted as `<html>` background, visible below the Oaks footer | NBD brand color on Oaks surface | Oaks dark `#1a1a1a`/`#111111` (or don't load NBD CSS) | `docs/assets/css/nbd-mobile.css:43` (loaded by all 8 Oaks pages) | confirmed live + code |
| BLEED-O3 | Medium | Shared NBD assets: NBD-domain canonical/og:url + NBD `drone-hero-curb.jpg` og:image | Oaks-owned assets/domain | Oaks domain + Oaks imagery | every `docs/sites/oaks/*.html` head | confirmed code |
| BLEED-O4 | Medium | Oaks accent orange `#e8720c` = NBD's exact orange | (Jo: should be distinct) | an Oaks-specific accent | `docs/sites/oaks/style.css:6` + `seed-companies.js:66` | per Jo decision = drift |
| BLEED-O5 | Info/data | Oaks contact form submits via NBD pipeline `window._nbdSubmitLead` | (data tenancy, not brand) | verify Oaks leads tag companyId=oaks | `docs/sites/oaks/shared.js:255-258` | cross-ref prior H-1; flag |
| O-N1 | Low | Oaks `/contact` "Find Us in Goshen" map embed is broken (placeholder) | broken asset | working map | `docs/sites/oaks/contact.html` | confirmed live (non-brand) |

## Phase 3 (artifacts + in-app chrome) — code-inspection (Jo's call: no live gen)
**THREE+ doc-generation paths, ALL hardcode NBD brand, NONE resolve per tenant:**
1. Server Puppeteer — `functions/render-pdf.js` + `print/*.hbs` (orange `#C8541A` + charcoal + Barlow)
2. Client html→pdf — `docs/pro/js/document-generator.js` NBDDocGen (navy `#1e3a6e` + orange `#e8720c`, from static `COMPANY.colors` literal)
3. Inline jsPDF — `customer.html`, `estimate-finalization.js`, etc. (orange band + white/black)

| ID | Sev | Finding | Evidence | Status |
|----|-----|---------|----------|--------|
| CRIT-3 | **Critical** | **Customer portal saturated with hardcoded NBD** — logo `nbd-logo.png`, "No Big Deal Home Solutions", jsPDF "NO BIG DEAL" header, SMS "this is Joe from No Big Deal Roofing", email "Your estimate from No Big Deal", nobigdealwithjoedeal.com. The most tenant-FACING surface; an Oaks customer sees/receives full NBD branding. | `docs/pro/customer.html:984,1812-1814,2122,3390,4248,4325-4352,5259,5377` | confirmed code; structural — FLAG |
| CRIT-4 | High | **Doc numbers / customer IDs hardcoded `NBD-`** regardless of tenant — customer IDs `NBD-0001`, warranty `NBD-WC-`, estimates `NBD-…`, filenames `NBD-…` | `dashboard-bootstrap.module.js:2463,2523`; `document-generator-templates.js:188`; `document-generator.js:223,416`; `estimate-finalization.js:214,554` | confirmed code; structural — FLAG |
| A6 | **Resolved/Stale** | **The brief's "PDFs hardcode red/black/white instead of navy/orange" is NOT true of current code.** All paths use NBD orange (`#e8720c`/`#C8541A`); the only reds are severity badges + negative/credit amounts. | `design-system.css`, `document-generator.js:765-899`, `customer.html:2116` | corrected |
| A7 | Medium | **Navy applied inconsistently across NBD's own doc paths** — present in client docgen, ABSENT in server `.hbs` (charcoal only) and inline jsPDF (orange band + black body). NBD docs read "orange + charcoal", not the marketing "navy + orange". | `design-system.css:50-57` vs `document-generator.js:765` | Axis A intra-tenant drift — FLAG |
| A8 | Low | `companyProfile` IS loaded in the portal (`customer.html:2936`) but the hardcoded NBD strings above ignore it → "config exists but ignored", again. | `customer.html:2935-2937` | confirms structural root |

> In-app **rep-facing** shell ("NBD PRO" nav/footer in `pro/index.html`, `customer.html:984`)
> is the PRODUCT brand (the SaaS is named "NBD Pro") — acceptable as product chrome, NOT
> scored as tenant bleed. The bleed that matters is the CUSTOMER-facing output (CRIT-3).

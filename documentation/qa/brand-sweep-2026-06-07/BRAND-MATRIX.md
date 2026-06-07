# BRAND-MATRIX.md — Brand Fidelity Matrix

> Every surface/artifact × {Axis A fidelity, Axis B bleed}. Run 2026-06-07.
> PASS = on-brand AND zero bleed (with screenshot). OFF-BRAND = Axis A fail.
> BLEED = carries other tenant's brand (Axis B fail, Critical). PARTIAL = minor drift.
> Status filled per phase; ⏳ = not yet walked.

## NBD public (Phase 1 — DONE, desktop; live-mobile blocked, see note)
All sampled pages **PASS Axis A** — navy `#142a52`/`#1e3a6e` + orange `#e8720c`,
Bebas Neue display + Dancing Script accent + Montserrat body, NBD logo, owner
voice, correct phone **(859) 420-7382**. Chrome (nav/announcement/footer) uniform
across the template system. No off-brand page, wrong color, or placeholder copy found.

| Surface | URL walked | Axis A | Notes |
|---------|-----------|--------|-------|
| Homepage | `/` | **PASS** | "NO BIG DEAL. SERIOUSLY — IT'S IN THE NAME." canonical brand |
| City/area landing | `/areas/amelia-oh` | **PASS** | "YOUR AMELIA ROOFER. IT'S JUST ME, JOE." |
| Service page | `/services/roof-replacement` | **PASS** | breadcrumb + chrome consistent |
| Service×city combo | `/services/storm-damage-amelia-oh` | **PASS** | consistent |
| Blog post | `/blog/how-much-does-roof-cost-cincinnati-2026` | **PASS** | brand ok; minor non-brand: H1↔intro copy mismatch (N1) |
| /inspect lead form | `/inspect` | **PASS** | stripped nav (logo+phone) intentional; form NOT submitted |
| /review (Reviews page) | `/review` | **PASS** | 5.0★ Google, orange stars |
| About | `/about` | **PASS** | "MY NAME IS LITERALLY ON IT." |
| Our Work | `/our-work` | **PASS** | 150+/100%/5★ stats |
| AI Visualizer | `/visualizer` | **PASS** | stripped nav intentional |
| Free-roof magnet | `/free-roof/` | **PASS** | no top nav (standalone landing, likely intentional — N2) |

> **Mobile note:** Live mobile-viewport capture not achievable here — the Chrome MCP
> captures at a fixed ~1568px viewport regardless of OS window size, and sub-500px
> windows freeze the renderer. Brand TOKENS (colors/fonts/logo/voice) are
> viewport-independent, and the `@media (max-width:768px)` rules are verified in
> source (`docs/index.html`, `nbd-mobile.css`) → no mobile brand-fidelity risk
> beyond layout. Recorded as a tooling limitation, not a skipped check.

## Oaks public (Phase 2 — DONE, OBSERVATION ONLY; vanity domain is parked Squarespace)
Axis A vs Oaks spec = **PASS** (distinct black `#1a1a1a`/`#111111` + orange + Montserrat/Open
Sans, Oaks house logo, Oaks phone (513) 827-5297, consistent chrome). Axis B = **BLEED**
(shared NBD sources — see BUG-LOG BLEED-O1..O5). Home/About/Contact walked live; Services/
Gallery/Service-Areas share the same `shared.js` chrome + same shared NBD sources (code-confirmed).

| Surface | URL walked | Axis A | Axis B | Evidence |
|---------|-----------|--------|--------|----------|
| Home | `/sites/oaks/` | **PASS** | **BLEED** (navy bg, Powered-by-NBD, shared orange) | live + code |
| About | `/sites/oaks/about.html` | **PASS** | **BLEED** (same shared sources) | live + code |
| Contact | `/sites/oaks/contact.html` | **PASS** | **BLEED** + broken map (O-N1) | live + code |
| Services/Gallery/Areas | `/sites/oaks/...` | PASS (shared chrome) | BLEED (shared sources) | code-confirmed |
| Vanity domain | `oaksroofingandconstruction.com` | n/a | n/a — **parked Squarespace placeholder**, not this build | live |

## Multi-tenant artifacts (Phase 3 — DONE, code-inspection per Jo)
All doc types render on-brand NBD (Axis A) but hardcode it (Axis B BLEED for any
non-NBD tenant). "Red/black/white" claim = false (all use NBD orange). Navy is on the
client docgen path only (A7 intra-tenant drift).

| Artifact | Path | Axis A (NBD) | Axis B (any tenant) | Evidence |
|----------|------|--------------|---------------------|----------|
| Work order (→work_authorization) | client/server | on-brand | **BLEED** (CRIT-1/2) | hardcoded logo/name/colors |
| Receipt (deposit / paid-in-full) | `receipt.hbs` | on-brand orange+charcoal | **BLEED** | `_layout.hbs` NBD |
| Warranty cert | `warranty.hbs` + `NBD-WC-` | on-brand | **BLEED** + `NBD-` number | CRIT-4 |
| Estimate | `estimate.hbs` / estimate-* | on-brand | **BLEED** + `NBD-` number | CRIT-4 |
| Invoice | `invoice.hbs` | on-brand | **BLEED** | hardcoded |
| Contract / changeOrder | `*.hbs` | on-brand | **BLEED** | `…· No Big Deal Home Solutions` |
| **Customer portal** | `customer.html` | on-brand | **BLEED (worst)** CRIT-3 | logo/name/SMS/email/jsPDF all NBD |
| Rep-facing CRM shell | `pro/index.html` | n/a (product brand "NBD Pro") | not scored | acceptable product chrome |

## Surfaces / mechanism (Phase 0 — DONE)
| Item | Finding | Axis |
|------|---------|------|
| Server PDF system (.hbs) | hardcoded NBD identity; no tenant param | A: orange drift; B: CRIT bleed |
| Client docgen (NBDDocGen) | brand literal navy/orange, on-brand NBD; not tenant-resolved | A: pass NBD; B: CRIT bleed |
| `companies.colors` config | exists, stale placeholders, ignored | — |
| `companyProfile` | per-tenant text only; no color/logo schema | — |
| Oaks microsite | own charcoal+orange identity; shares NBD orange | A: TBD; B: TBD |

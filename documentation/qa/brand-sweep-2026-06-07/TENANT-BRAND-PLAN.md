# TENANT-BRAND-PLAN.md — make brand resolve from the active tenant

> The structural payload from the 2026-06-07 brand sweep (SEPARATION.md). Goal: every
> **customer-facing** surface renders the **active tenant's** brand — logo, colors, name,
> contact, doc-number prefix, SMS/email sender — instead of hardcoded NBD. Scoped as
> independently-shippable phases so each lands + verifies on its own (no big-bang).
>
> **Status: NOT STARTED — flagged for scoping.** This is its own initiative, not a sweep fix.
> Out of RULE-1 "trivial" scope (multi-file, changes how brand is resolved).

## Guardrails (every phase)
- Preserve `window._leads`, `CompanyAdmin`, `NBDAuth`, `ScriptLoader`.
- **NBD must stay byte-identical** — every change falls through to today's NBD values when a
  tenant hasn't set a brand field. A rep who never opens Settings sees no difference.
- Atomic full-file writes; smoke gates each deploy; branch off prod; deploy on Jo's OK.
- `companyProfile/{companyId}` is already per-tenant + already loaded in the portal — build on it.

## The single brand source (Phase 1 establishes it)
Extend `companyProfile/{companyId}` (defaults in `docs/pro/js/company-profile.js`) with:
```js
brand: {
  displayName, legalName, seal,            // "No Big Deal", "No Big Deal Home Solutions", "NBD"
  logoUrl,                                 // /assets/images/nbd-logo.png (NBD default)
  docPrefix,                               // "NBD" → customer IDs / doc numbers
  colors: { primary, accent, ink, charcoal, cream },   // navy #1e3a6e / orange #e8720c / …
  fonts:  { display, body },               // Bebas/Barlow + Montserrat
  contact:{ phone, email, website, address },
  smsSignOff,                              // "Joe from No Big Deal Roofing"
  emailFromName                            // "No Big Deal"
}
```
Expose a resolver `window._brand()` → merged tenant brand (defaults + remote), mirroring the
existing `_companyProfile` pattern. **One read path; every surface uses it.**

---

## Phases (each = one shippable PR)

### Phase 1 — Schema + resolver (foundation, ZERO visible change)
- Add the `brand` block + NBD defaults to `company-profile.js`; add `_brand()` resolver.
- Backfill **Oaks**'s real brand into its `companyProfile` (and fix the stale `companies` seed).
- **Ship risk: none** (nothing consumes it yet). **Verify:** console — `_brand()` returns NBD
  for NBD uid, Oaks for Oaks uid.

### Phase 2 — Client docgen + customer portal (highest impact, customer-FACING)
Files: `docs/pro/js/document-generator.js` (`COMPANY.colors`/logo literal → `_brand()`),
`docs/pro/customer.html` (hardcoded logo `:984`, name `:1812-1814`, jsPDF header `:2122`,
SMS sign-off `:3390`, email from `:4248/4325`, footer `:4352/5259`).
- Replace the hardcoded `NBD-` customer-ID/doc-number prefix (`dashboard-bootstrap.module.js:2463,2523`)
  with `brand.docPrefix`.
- **Verify:** generate a doc as NBD (unchanged) and as Oaks (Oaks logo/colors/name, `OAK-` numbers,
  Oaks SMS). Use the e2e harness or a `ZZ_QA_` render per RULE 0.

### Phase 3 — Server PDF (Puppeteer `.hbs`)
Files: `functions/render-pdf.js` (thread caller's resolved brand into the layout context),
`functions/print/partials/brandBandTop.hbs` + `_layout.hbs` (hardcoded logo/name/phone/email/seal
→ `{{company.*}}`), `functions/print/design-system.css` (static `:root` colors → injected CSS vars
from brand). renderPdf is App-Check+auth gated — pass brand in `payload`, validate server-side.
- **Verify:** render warranty/estimate/invoice/contract for NBD + Oaks; diff side-by-side.

### Phase 4 — Oaks public separation
Files: every `docs/sites/oaks/*.html` head + `docs/sites/oaks/style.css`.
- Stop loading NBD-navy bleed: remove/scope `nbd-mobile.css` on Oaks (give Oaks its own `html`
  background) — fixes BLEED-O2. Swap NBD `drone-hero-curb.jpg` og:image + NBD canonical for
  Oaks-owned (BLEED-O3). Give Oaks a distinct accent if desired (BLEED-O4; Jo: should be distinct).
- "Powered by NBD Pro" stays (Jo: accepted white-label).
- **Verify:** Oaks page bottom no longer paints NBD navy; og/canonical are Oaks.

### Phase 5 — Cleanup
- Retire or correct the stale `companies` seed colors/phone (`seed-companies.js`); pick the single
  source of truth (recommend `companyProfile`). Remove dead duplicate brand literals.

---

## Sequencing & sizing (rough)
| Phase | Size | Customer-visible? | Gate |
|-------|------|-------------------|------|
| 1 Schema+resolver | S | no | console check |
| 2 Client docgen + portal | **M–L** (customer.html is large) | **yes (biggest win)** | NBD-unchanged + Oaks-correct render |
| 3 Server PDF | M | yes | per-template render diff |
| 4 Oaks public | S | yes | navy-bleed gone |
| 5 Cleanup | S | no | smoke |

**Recommended order:** 1 → 2 → 3 → 4 → 5. Phase 2 is the headline (the customer portal is the
worst bleed surface). Phases 2/3 are where a live render harness (or `ZZ_QA_` jobs) earns its keep,
since the win is literally "does the Oaks doc show Oaks branding."

## Open decision for Jo before starting
- **One brand source = `companyProfile`?** (recommended — already per-tenant + loaded) or revive
  `companies.colors`? Pick one; don't keep two.
- **Tenant doc prefixes** — `OAK-` for Oaks etc.? (affects customer IDs / cert numbers).

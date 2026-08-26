# SESSION 2026-08-19 — /careers + /partners

Jo delivered three hand-authored files (`careers.html`, `partners.html`, and an
updated `footer-extended` partial adding Careers + Partners to the Company column
after NBD Pro) and asked for a marker/CSS conformance check, sitemap entries, and a
deploy. The pages were built against the live site's chrome and shipped with their
`nbd:partial` regions intact.

Both pages are **footer-linked only** — deliberately not in the nav dropdown, per Jo.
Pay ($18–22/hr) was flagged before deploy and Jo confirmed it.

## The requested deploy order was impossible

The brief said "deploy pages FIRST, then the footer partial + re-sync."

`firebase-deploy.yml` runs `apply-partials.js --check` as a hard pre-flight gate
**before** the Deploy Hosting step, under `set -e`. The new pages carry the *new*
footer, so until the partial lands they read as drift → the gate exits 1 → the whole
deploy aborts and **nothing ships**, pages included. Worse, anyone running
`apply-partials.js` (without `--check`) during that window silently restamps both new
footers back to the old partial, deleting the two links with no error.

Landed as one atomic change instead: partial + pages + restamp + sitemap.

> The brief also described the host as Cloudflare Pages. It is Firebase Hosting;
> `docs/` is the hosting root and "deploy" means merging to `main`.

## Conformance check on the delivered files

**Markers — clean.** Rendering `site-src/partials/*` into the delivered regions
byte-for-byte: `nav-standard cta_href="/#contact"` and `mobile-nav-hub` are
**byte-identical** to current source; the `footer-extended` region matches the new
delivered partial exactly. No missing/unused marker attributes, no dangling markers.

**Base `<style>` block — did NOT match current source.** The delivered `:root` block
was 16,912 chars vs `about.html`'s 21,019, and **all ten "injected" fix layers were
absent** — the pages were built against a flattened reconstruction of the live CSS,
not the current source. The custom-property contract was intact (13/13 defined, zero
undefined `var()`), so nothing was catastrophically unstyled, which is exactly what
made this easy to miss.

## Five blockers found, all fixed

1. **Inline `<script>`** (FAQ accordion). Violates the CSP
   (`script-src 'self'`, no `'unsafe-inline'`) — the accordions would have been
   **dead on the live site**. `check-inline-html-scripts.js` does *not* catch this:
   it only syntax-checks, and the JS was valid. The pages also never loaded
   `nav-faq.js`, which is what drives `nav-standard`'s `li.dropdown` Services menu —
   so that dropdown was dead too. Replacing the inline block with
   `<script src="/assets/js/nav-faq.js" defer>` fixed all three at once
   (`nav-faq.js` is a strict superset of the inlined code, plus `aria-expanded`).
2. **`/* nav base (injected) */` missing** → `ensure-nav-css.js` (blocking gate) failed.
3. **Nav collapsed at 900px, not 1024px** → `marketing-polish-contract.test.js` failed.
   `ensure-nav-css.js --write` fixed **both 2 and 3** — the canonical block it injects
   ends with `@media (max-width:1024px){.nav-links{display:none};.hamburger{display:flex}}`.
4. **The delivered partial included its own wrapper markers.** Partial *source* files
   are body-only — the markers live in the pages. Writing it as-is produces nested
   markers and trips the dangling-marker guard (fatal, exit 2). Stripped on the way in.
5. **`.nbd-skip` unstyled** — skip-link markup present but its CSS is in no linked
   stylesheet, so the skip link rendered as a **visible link** at the top of both pages.

Seven chrome CSS blocks were ported verbatim from `about.html` (the canonical
`nav-standard` + `footer-extended` page), in its order. Two were deliberately skipped:
`trust-icon fix` (`.trust-icon` is defined but never used in these pages) and the
CSP-safe hover block (no `.gaf-badge-float` markup).

## Sitemap

`docs/sitemap.xml` must not be hand-edited — `firebase-deploy.yml` regenerates it at
deploy time and would discard the edit. Entries were added to `CORE_PAGES` in
`scripts/build-sitemap.js` (`partners` 0.6, `careers` 0.5) and the file regenerated;
`lastmod` 2026-08-19 came free (the generator stamps today's date on new URLs only).

**Trap worth remembering:** `CORE_PAGES` is a *curated* list, not a filesystem walk —
top-level pages are never auto-discovered. Two new pages therefore produce **zero
sitemap drift**, so the CI gate stays green while the pages are silently missing from
the sitemap. The gate cannot catch this class of omission.

## Footer reach — smaller than it looks

`footer-extended` is on only **14** pages (about.html + 13 service pages), not the
whole site. `footer-standard` (117) and `footer-area` (25) have **no Company column at
all**, and the homepage plus 12 other top-level pages have **hand-rolled footers with
no partial markers** — no partial edit can reach them.

Shipped: `footer-extended` (16 pages incl. the two new), `footer-blog` (26 pages, links
appended to its existing Company column), and a hand-edit to `docs/index.html`'s
un-marked footer. ~43 pages, including the two highest-traffic surfaces.
`footer-standard` and `footer-area` were left alone deliberately — reaching them means
designing a new column into two footers and restamping ~142 hyper-local SEO pages.

## Local-only gotcha (not a real failure)

`node scripts/build-sitemap.js` exits 1 on a clean Windows checkout **before any
change**. The git blob is LF, `core.autocrlf=true` makes the working copy CRLF, and
the generator emits LF — a pure EOL disagreement, zero content difference. On Linux CI
the checkout is LF and the gate passes. Don't chase it.

## Verification

All eight gates pass: `check-js-syntax`, `check-site-integrity --quiet`,
`apply-partials --check --diff`, `build-sitemap` (dry-run), `check-inline-html-scripts`,
`ensure-nav-css`, `ensure-icon-css`, `marketing-polish-contract` (51 passed).

Render-verified under the **real production CSP** (served from `firebase.json`'s `**`
header block) at 1280px and 390px, both pages: FAQ opens on click and Enter,
`aria-expanded` set, Services dropdown opens, skip link off-screen at x=-9999, nav
collapses with hamburger at 1024px, footer carries both links, **0 CSP violations,
0 page errors**.

`qc-render-sweep.js` was not run — it does not exist on `main` (it is unmerged work on
`qc/site-sweep-2026-08-18`). It is `continue-on-error` in CI regardless.

---

## Update 2026-08-19 (same day) — footer-standard added

Jo asked for the links on `footer-standard` too, so the "left alone deliberately"
decision above is superseded for that partial. `footer-area` (25 pages) is still
without them.

`footer-standard` has **no column structure at all** — it is a compact block (cert
bar, one copyright/link `<p>`, breadcrumb line, quiet pro door). Adding a "Company
column" would have meant inventing one. Instead the two links joined the existing
inline row, matching its own idiom exactly:

> © 2026 No Big Deal Home Solutions — Greater Cincinnati · Privacy ·
> Free Roof Program · **Careers** · **Partners & Sponsorships**

One line changed in the partial, 117 pages restamped, no new CSS. Verified on three
`footer-standard` pages (`/our-work`, a service+city combo, a gutter combo): links
visible with correct labels, **zero horizontal overflow at 1280px and 390px** (the
longer row wraps rather than overflowing), 0 CSP violations, 0 page errors.

Footer reach is now ~160 pages: `footer-standard` (117) + `footer-blog` (26) +
`footer-extended` (16) + the hand-rolled homepage. Still uncovered: `footer-area`
(25 pages) and 12 hand-rolled top-level pages (`/estimate`, `/review`, `/inspect`,
`/roof-score`, the `storm-*` family, `/visualizer`, `/privacy`, `404`, `offline`).

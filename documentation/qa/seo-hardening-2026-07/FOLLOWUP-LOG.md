# SEO/Tech Hardening — Follow-up round (items 1–5)

Date: 2026-07-02 · Branch: `claude/seo-tech-hardening-ur3buf` (restarted from
main after PR #808 merged) · Companion: `FIX-LOG.md` (first round).

## 1. CSP-blocked inline event handlers — all 31 removed

The site-wide CSP (`script-src-attr 'none'`) blocks every inline handler
attribute, so none of these ever fired in production.

- **Hover effects (18 attrs, 9 pairs)** on index.html (hero secondary link,
  pledge/TAMKO/guarantee quick-links, 3 partner logos), about.html (GAF badge),
  services/roof-replacement.html (GAF verify link) → replaced with CSS `:hover`
  rules (`!important`, because the base styles they override are inline).
  Cosmetic-only loss before; effects now actually work.
- **onclick handlers (13)** in `sites/oaks.html` — **genuinely broken UI**: the
  mobile-menu toggle, the menu-link auto-close, and the top-banner close button
  did nothing in production. Externalized to `/sites/js/oaks-nav.js`
  (addEventListener, H-1 pattern).
- Codemod: `scripts/fix-inline-handlers.js`. Verified in headless Chromium:
  menu opens/closes, banner closes, hover states change. Zero inline handlers
  remain on public pages.

## 2. Homepage LCP — mobile hero variant

`drone-hero-crew.webp` (315 KB, 1600×1200) was the homepage LCP for all
viewports. Added `drone-hero-crew-800.webp` (84 KB, −73%) with a
`max-width:600px` media query on `.hero-bg` plus viewport-scoped
`<link rel=preload media=...>` tags. Desktop untouched. Full-size
recompression was tested and rejected (−7% at q70 — not worth double-encoding).
Fonts already ship `font-display:swap` on all 18 faces.
**Local Lighthouse (throttled mobile): LCP 5.9 s → 4.6 s, perf 0.71 → 0.76.**
Verified the correct variant loads per viewport (request log) and the mobile
hero is visually unchanged (the photo sits under a .78–.92 gradient).
Note for a future pass: the same treatment on `roofing-2.webp` (250 KB,
`combo-hero-bg` on 116 service pages) is the next-biggest win.

### 2b. Extended to every page with the same criteria (Jo's request)

A repo-wide sweep of CSS background raster references found exactly three hero
images: `drone-hero-crew` (homepage, done above), `roofing-2`
(`.combo-hero-bg`, 116 service pages), and `roofing-1` (`.city-hero-bg`,
30 area/city pages). Nothing else on the public site matches the criteria.

`scripts/add-mobile-hero-variants.js` appended a `@media(max-width:600px)`
override after each of the 146 rules, swapping in new 800×600 q72 variants:
`roofing-1-800.webp` 55 KB (−69% vs 178 KB) and `roofing-2-800.webp` 77 KB
(−69% vs 250 KB). The override's background value is derived from each page's
own rule text, so gradients carry over verbatim; desktop untouched.

Verified: request-log per viewport on a service + an area page (mobile fetches
only `-800`, desktop only full-size); mobile screenshot visually unchanged;
site integrity 0 failures; **Lighthouse on the sampled service page: LCP
3.9 s → 3.2 s, perf 0.86 → 0.91.**

## 3. `<main>` landmark — 195 pages

`scripts/add-main-landmark.js` wraps everything between the single `</nav>`
and `<footer` in `<main>`. Safe: zero `body >` child selectors exist repo-wide,
`<main>` is styling-inert, and only pages with exactly one nav + one footer
were touched (index and blog/index already had a landmark; 404/offline/utility
pages skipped). **Pixel-diff of before/after screenshots: zero changed pixels.**
Lighthouse `landmark-one-main` now passes; a11y 0.93 → 0.95 on sampled pages.

## 4. Wave-127 js/css revalidation rule — ordering fixed

The `**/*.@(js|css)` `max-age=0, must-revalidate` rule sat *before* `**`
(max-age=300) and, under last-match-wins, never applied — the Wave-127 P0 fix
had silently never shipped. Moved it directly after `**`. Effective
Cache-Control per path (verified with a minimatch simulation of the whole
rule chain):

| Path | Before (effective) | After |
|---|---|---|
| `/pro/js/**` (CRM app code) | 300 s | `max-age=0, must-revalidate` (Wave-127 intent) |
| `/assets/vendor/**` | 300 s | `max-age=0, must-revalidate` (per the rule's own comment) |
| `/assets/js/**`, `/assets/css/**` | 86400 | 86400 (unchanged, later rules win) |
| `/assets/fonts/**` / `/assets/images/**` | 30 d | 30 d (unchanged) |
| `/sw.js`, `/pro/sw.js` | no-cache | no-cache (unchanged) |
| `/pro/dashboard` etc. | no-store | no-store (unchanged) |

CRM behavior change is deliberate and restores the documented intent; the
tradeoff is one conditional request (ETag → 304) per asset per page-load,
which is exactly what the Wave-127 author designed for.

## 5. No code — see MANUAL-FOR-JO.md §7 (GBP/reviews checklist, added this round)

## Gates

- `check-site-integrity.js`: 215 pages, 17,515 refs — 0 failures
- `firebase.json` parses; per-path header simulation above
- Headless-Chromium functional tests (oaks menu/banner, hover effects, hero
  variant per viewport); pixel-diff on `<main>` wrap: zero
- Lighthouse: perf 0.71→0.76 (home), a11y 0.93→0.95 (our-work, service), no
  regressions anywhere

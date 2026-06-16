# Phase 4 — SEO & Performance Baseline

> Lighthouse 13.4.0, headless Chromium 141, run against the local Firebase-semantics server with
> external CDNs blocked by the session network policy. **Performance numbers are a local-server
> baseline** (no CDN latency, no webfonts, no GTM): treat them as upper bounds and re-baseline
> against prod when network access allows. SEO / accessibility / best-practices scores are
> environment-independent (best-practices loses ~10 pts to environment console noise on some
> pages). Raw category scores + LCP/CLS: `LIGHTHOUSE-BASELINE.json`.

## Lighthouse baseline (2026-06-11)

| Page | Mode | Perf | A11y | Best-Pr | SEO | LCP | CLS |
|---|---|---|---|---|---|---|---|
| / (home) | mobile | 95 | 84 → **94*** | 96 | 100 | 2.6s | 0.004 |
| / (home) | desktop | 99 | 86 | 96 | 100 | 1.0s | 0 |
| /estimate | mobile | 98 | 89 | 85† | 100 | 2.3s | 0 |
| /estimate | desktop | 100 | 89 | 85† | 100 | 0.6s | 0 |
| /storm-alerts | mobile | 99 | 77 → **88*** | 96 | 100 | 1.8s | 0 |
| /storm-alerts | desktop | 100 | 77 | 96 | 100 | 0.4s | 0 |
| /storm-report | mobile | 100 | 89 | 96 | 100 | 1.5s | 0 |
| /storm-report | desktop | 100 | 89 | 96 | 100 | 0.4s | 0 |
| /inspect | mobile | 100 | 91 | 96 | **69‡** | 1.4s | 0 |
| /inspect | desktop | 100 | 91 | 96 | **69‡** | 0.4s | 0 |
| /blog/why-class-4-impact-shingles | mobile | 99 | 90 | 96 | 100 | 1.8s | 0 |
| /blog/why-class-4-impact-shingles | desktop | 100 | 90 | 96 | 100 | 0.4s | 0 |
| /areas/mason-oh | mobile | 91 | 93 | 96 | 100 | 3.5s | 0.003 |
| /areas/mason-oh | desktop | 100 | 93 | 96 | 100 | 0.7s | 0 |

\* post-fix re-run after this phase's inline a11y fixes (label associations, honeypot
aria-hidden, GAF aria-label). † paste-prevention heuristic on the OTP inputs (the page actually
implements custom paste handling — near-false-positive) + environment console noise.
‡ `noindex` — see proposal P-SEO-1.

## Meta/SEO hygiene — all 198 homeowner pages (static scan)

| Check | Result |
|---|---|
| `<title>` present + unique | **198/198, zero duplicates** |
| Meta description present + unique | 197/198 (only `/offline` missing — utility page), zero duplicates |
| Canonical | all except `/404`+`/offline` (correct for utility pages) |
| OG cards | all except `/404`+`/offline` |
| Twitter cards | 2 real gaps (`/blog/`, `/inspect`) → **FIXED inline** |
| Viewport meta | 198/198 |
| Exactly one h1 | 198/198 |
| Image alt coverage | **100%** (0 missing across all pages) |
| Structured data | RoofingContractor + FAQPage + BreadcrumbList + Review/Rating present on key pages; absent only on 404/offline/privacy/free-roof/blog-index (acceptable; blog-index Blog schema = nice-to-have) |
| robots.txt / sitemap | fixed in Phase 1 (group binding; /storm-report added) |

## Weight & delivery posture

- **Images >300KB (homeowner surface): 8 files, 324–556KB** (drone-* heroes, roofing-1..4,
  ivent-pipe-flashing.png). No multi-MB monsters found (the old 10.8MB PNG has no siblings).
  Total `docs/assets` = 7.6MB. → P-PERF-1 proposal (compress/WebP — image pipeline is
  propose-only).
- Render-blocking: 1 stylesheet + 1 non-deferred script on the homepage — lean. Lazy-loading
  in use (8 imgs on home), 1 preload.
- Cache posture (firebase.json, verified Phase 0): JS/CSS `max-age=0 must-revalidate` (ETag
  304s), HTML `max-age=300`, images `max-age=86400` on /assets/images/**. Deliberate
  post-Wave-127 design — no change recommended.

## Inline fixes applied this phase

1. Twitter cards on `/blog/` + `/inspect` (+missing og:image on /inspect).
2. Form-label associations (`for=` on every label) on homepage contact + storm-alerts forms.
3. Honeypot fields `aria-hidden="true"` (screen readers no longer announce bot traps).
4. GAF badge aria-label now contains its visible text (label-content-name-mismatch).

## Proposals

- **P-SEO-1 (decision):** `/inspect` is `noindex,follow` (since page creation — deliberate
  QR-only design) but ALSO in sitemap.xml at priority 0.9 (added later). Contradiction: Google
  sees "please index" + "don't index". Either remove noindex (it's a strong "free roof
  inspection" page) or drop the sitemap entry. One-line fix either way — needs Jo's intent.
- **P-A11Y-1 (design):** brand-orange-on-navy CTA text (#e8720c bg / white text) fails WCAG AA
  contrast on several elements (nav-cta, announcement bar, wc-ribbon). The #f08030 accent
  exists partly for this; a tokens-level pass would clear the remaining a11y deductions.
- **P-A11Y-2 (structural):** no `<main>` landmark on most pages; heading-order skips (h4 after
  h2) on storm-alerts; footer links rely on color alone. Template-level changes.
- **P-PERF-1:** compress the 8 >300KB images to WebP/AVIF with responsive srcset (~70% savings
  likely, mason-oh mobile LCP 3.5s is the page that needs it most).

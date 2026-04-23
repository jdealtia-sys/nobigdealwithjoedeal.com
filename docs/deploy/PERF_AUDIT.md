# NBD Pro — Perf Audit Findings (2026-04-23)

Static audit of the CRM surface. No Lighthouse run (requires local server + headless chrome); these are the findings I can verify from the source tree.

## Highlights

| Area | Status | Action |
|------|--------|--------|
| Lazy-load architecture | ✅ Good | ScriptLoader already covers academy, training, storm, close-board, rep-os, decision-engine, reports, warranty — the right 8 bundles. |
| `loading="lazy"` coverage | ✅ Good | 77 anchor points across `/docs`. Added 2 missing ones on `customer.html` photo grids. |
| dashboard.html size | ⚠️ 814 KB raw | Biggest single asset. Largely inline CSS + HTML — real fix is V3's component split. |
| Oversized images | 🔴 10.8 MB single PNG | `docs/assets/roofivent/ivent-roto.png` is 10.8 MB. Lazy-loaded so not blocking render, but costs mobile users data. |
| Regression guard | ✅ Added | `tests/smoke.test.js` now fails CI if a new image > 1 MB lands outside the whitelist. |

## Top JS bundles (still eager on dashboard.html)

Could move to `ScriptLoader` bundles in a future pass — each needs per-view testing before the move:

| File | Size | Views that actually need it |
|------|------|-----------------------------|
| `product-data.js` | 111 KB | Estimates |
| `document-generator-templates.js` | 105 KB | Docs |
| `estimate-catalog-xactimate.js` | 96 KB | Estimates |
| `template-suite.js` | 82 KB | Templates |
| `estimate-v2-ui.js` | 81 KB | Estimates v2 |
| `document-generator.js` | 76 KB | Docs |
| `photo-editor.js` | 76 KB | Photo editing (rare) |
| `theme-engine.js` | 117 KB | Every view (theming is persistent — harder to defer) |

Combined lazy-movable: **~625 KB**. Worth doing once the V3 migration is done so we don't invest in code that's being replaced.

## Image compression queue

Drop into a `sharp` or `cwebp` script when someone takes a dedicated perf pass:

1. `docs/assets/roofivent/ivent-roto.png` — 10.8 MB → target 150 KB WebP (~98% reduction)
2. `docs/assets/roofivent/ivent-eco.png` — 1.3 MB → target 80 KB WebP
3. `docs/assets/roofivent/ivent-pipe-flashing.png` — 334 KB → target 50 KB WebP
4. `docs/assets/images/drone-*.jpg` — 320–552 KB each → target 80–120 KB WebP
5. `docs/assets/images/roofing-1..4.jpg` — 320–395 KB each → target 80–100 KB WebP

All of these are already `loading="lazy"` with explicit dimensions so the critical path isn't blocked — compression just saves mobile users data + improves LCP on their second+ page view.

## What's *not* measurable from static audit

Would need a headless Lighthouse run (or Sentry Browser Performance) for:

- LCP / INP / CLS real numbers
- Third-party script cost (Stripe, reCAPTCHA, Cal.com, GA4)
- Font loading blocking (Barlow Condensed is used heavily; is it FOUT or FOIT?)
- Long tasks during initial render of dashboard.html

**Suggested next step:** add a Lighthouse CI job that runs against the live URL post-deploy and tracks the metrics over time. Out of scope for this audit pass.

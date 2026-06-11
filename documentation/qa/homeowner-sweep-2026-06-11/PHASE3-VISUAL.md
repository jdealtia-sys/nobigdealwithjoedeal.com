# Phase 3 — Visual, Brand & Mobile Sweep

> Method: 46 pages (33 unique + 13 family samples) × 3 viewports (390 / 768 / 1440) in headless
> Chromium; automated checks for horizontal overflow (+offender identification), tap-target size,
> sub-11px text, logo aspect distortion, nav/footer/chrome consistency, h1 count; code-level scans
> of every homeowner HTML/CSS file for hex-token and font drift; copy samples read for dual-brand
> voice. Environment note: CDN webfonts blocked here, so font verification is declaration-level;
> pixel rendering used system fallbacks (layout metrics unaffected at these breakpoints).
> Full-page screenshots captured with `reducedMotion: 'reduce'` so scroll-reveal sections render
> (first pass produced misleading blank bands — recaptured).

## Brand verdict: PASS with 3 fixed defects

| Check | Result |
|---|---|
| Color tokens (94 distinct hex across 204 files) | **PASS.** Canonical `#1E3A6E`/`#142A52`/`#E8720C` dominate (264/1051/2821 uses). The near-brand values are a systematic family, not drift: `#f08030` (link/accent orange on dark navy, 197 files), `#c45e08` (button hover), `#1a3260`/`#243f7a` (navy gradient stops), Instagram-gradient colors in footer social icons. Zero one-off rogue hexes on homeowner pages. |
| Typography | **PASS.** Bebas Neue (display) + Montserrat (body) + Dancing Script (signature accent, 34 pages) consistently across all 199+ homeowner pages. Divergent stacks (Barlow, Syne, DM Mono) exist only on non-homeowner surfaces (pro/tools/sites). |
| Logo | Single canonical `/assets/images/nbd-logo.png` on 203 pages. **2 pages rendered it squashed** (forced 42×42 square on a 1.5:1 asset): `/services/gaf-timberline`, `/blog/why-class-4-impact-shingles` → **FIXED inline** (canonical `height:42px;width:auto`). Verified 1.50 aspect at all 3 viewports post-fix. |
| Chrome consistency | Header/nav/footer present and consistent on every page except `/free-roof/` (intentional focused lander — brand-sweep N2, still pending Jo's confirm) and `/404` (minimal page, acceptable). h1 count = exactly 1 on all 46 pages. |
| Dual-brand voice | **PASS.** Blog samples are unmistakably Joe ("We're parked down the street… before we knock a single door"); service/area pages are NBD-company voice with Joe's personal accountability. No corporate-speak found. One carry-in editorial defect confirmed (V-1 below). |

## Layout defects — found 4, fixed 3 inline

1. **FIXED — `/services/the-nbd-guarantee` (phone):** tier comparison table overflowed 390px
   viewport (477px doc width) pushing the whole page sideways. Added `.compare-scroll`
   overflow-x wrapper + `min-width` so the table pans within its card. Verified no overflow.
2. **FIXED — `/blog/field-notes-joes-notebook-goes-public` (tablet+desktop):** `.post-header`
   used `margin:0 -5%` inside an unpadded `<article>` → 5% horizontal overflow (806px @768,
   1512px @1440). Removed the negative margin. Verified clean at both widths.
3. **FIXED — squashed logos** (see brand table above).
4. **PROPOSE — tap-target sizing (site-wide pattern):** inline text links (breadcrumbs "Home /
   Services", footer link lists, the announcement-bar link) measure 11–25px tall on phone —
   below the 40px a11y guideline. This is the design system's inline-link pattern across ~34
   pages, not a per-page bug; fixing means a shared padding/line-height rule for breadcrumbs +
   footer columns. Low risk, but it's a global pattern change → Jo's call.

## Observations (logged, not fixed)

- **Sub-11px text** on most pages, 1–6 elements each (fine print, badge labels, copyright).
  Mostly legitimate fine-print use; worth a single pass raising anything informational to 12px+.
- **V-1 (carry-in N1, now diagnosed):** `/blog/how-much-does-roof-cost-cincinnati-2026` — the
  intro under the byline is the OPENING OF A DIFFERENT POST (verbatim the
  does-homeowner-insurance-cover-hail-damage intro: "yes, in most cases homeowner's insurance
  covers hail damage in Ohio…") under a "how much does a roof cost" H1. Copy-paste error during
  templating. Needs a rewritten intro in Joe's voice → propose-only (copy rewrite).

## Evidence
`evidence/phase3/` — 112 captures: every unique page full-page at phone/tablet/desktop
(reduced-motion), one phone capture per family sample. Defect before-states are inherent in the
first-pass captures retained in git history; post-fix verification logged above.

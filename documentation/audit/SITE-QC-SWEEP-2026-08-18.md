# Site QC sweep — 2026-08-18

Jo reported a "huge icon" on `/sites/free-guide`, asked for the `/pro` landing
to be updated, and said there were "more" visual issues. This is what the sweep
found, what shipped, and what is still open.

Branch: `qc/site-sweep-2026-08-18`. Related:
[ICON-CASCADE-REGRESSION-2026-08-17](ICON-CASCADE-REGRESSION-2026-08-17.md),
[DESIGNER-AUDIT-VERIFICATION-2026-08-15](DESIGNER-AUDIT-VERIFICATION-2026-08-15.md).

## Headline: the reported bug was real, and the guard that should have caught it was switched off

`/sites/free-guide` rendered `<svg class="ico">` at **1227×1227px** — measured
live, not inferred. The page carries the icon markup but never linked
`/assets/css/nbd-icons.css`, the only place `.ico{width:1em;height:1em}` is
defined. Because that sheet also supplies `fill:none;stroke:currentColor`, the
two open `<path>` outlines painted as **solid black blobs**, not a roof outline.
The same missing link left all five `.mnav-group` mobile-nav headers unstyled.

`scripts/ensure-icon-css.js` exists precisely to catch this — its header reads
*"Without the CSS, inline SVGs default to huge native dimensions."* Its
directory walk skipped `'sites'`, `'pro'`, and a stale `'free-guide'` entry left
from before commit `6e499a38` relocated the page under `docs/sites/`. **CI had
never inspected this page in either location.**

Widening the walk surfaced 6 more pages out of contract — the 5 `pro/blog` posts
and `pro/terms` — each carrying a byte-identical legacy inline block instead of
the link. Normalized with `--write`: 113 lines of duplicated CSS removed.

> **Correction to an earlier read.** A first pass suggested those 6 pages were
> *broken* like free-guide. They were not — each defines `.ico` inline at line
> 309, so they rendered correctly and were only carrying duplication.
> `free-guide` was the single genuinely broken page on the site.

## The structural finding: every gate here is grep-shaped

This is the fourth defect of its kind, and all four were caught **by Jo's eyes,
not by CI**:

| date | defect |
|---|---|
| 2026-08-17 | invisible orange-on-orange icon chips on the homepage |
| 2026-08-17 | nav-base CSS missing on 18 pages → dropdown splattered open |
| 2026-08-17 | `docs/index.html` shipped its entire `<style>` block twice; edits to the first copy were silently dead |
| 2026-08-18 | `svg.ico` at 1227px on `/sites/free-guide` |

`check-site-integrity`, `ensure-icon-css`, `ensure-nav-css`,
`check-inline-html-scripts`, `apply-partials --check` are all thorough and all
static. **None of them ever computes a style**, so cascade-order and layout
defects are structurally invisible to the entire suite.

`scripts/qc-render-sweep.js` (new) is the first rendered gate: it loads all 208
homeowner pages at 1280px and 390px and asserts oversized inline SVG, icon ink
within distance 40 of its own opaque chip background, dropdowns visible at rest,
horizontal overflow, and duplicated `<style>` blocks.

**It was validated against the real defect, not a synthetic one.** With the
free-guide fix reverted it reports `oversized-icon svg.ico 1242x1242px`; clean
once restored. A checker that has only ever printed "clean" proves nothing.

Wired into `ci.yml` as its own advisory job (`continue-on-error`), matching
`visual-brand-tokens` and `visual-regression`. Promote once it has a green
streak — note those two are already stalled mid-promotion at 3/10 per
`WEEKLY_CADENCE.md`.

## Full-surface result: the site is in good shape

208 pages swept. **One** further defect: `/services/gutter-replacement`
overflowed 20px at 390px. Traced rather than guessed — `.content-card`
min-content was 379px = 72px of padding + a 307px two-column `.stat-grid` whose
widest cell ("Seamless / No Joints") cannot wrap below 152px; grid items default
to `min-width:auto`, so the collapsed `1fr` track was pushed past the viewport.
Trimming mobile padding to 24px fixes it.

12 sibling service pages share the `.content-card` + `.stat-grid` pattern and do
**not** overflow today — their stat labels are shorter. They are one long label
away from the same bug. Left alone deliberately; flagged here instead.

## /pro landing

Assessed before changing anything: the page is **not stale**. Pricing matches
`functions/billing.js` `PLAN_LIMITS` exactly, copy is code-verified, no
placeholder text, accessibility handled. Last meaningful edit 2026-07-29.

**Shipped:**

- **Duplicate folded.** `docs/pro/landing.html` and `index.html` were
  byte-identical, both in `sitemap-pro.xml`, while landing's own `rel=canonical`
  already pointed at `/pro` — the sitemap was advertising a 0.9-priority URL
  that disowned itself. Deleted, 301'd, and all **78** inbound references
  rewritten rather than left leaning on the redirect. Four dead references that
  would have outlived the page were also cleaned: `NO_CACHE_HTML` in `sw.js`,
  `AUTH_GATED_PATHS` in `offline-manager.js`, the nav `pageMap` in two JS files,
  and two `robots.txt` Allow lines.
- **Honest `lastmod`.** Values were 6 weeks stale. Rather than stamping today
  across the board — a false freshness signal — each URL now carries its real
  last-content-change date from git.
- **Invented figures labelled.** The hero read "247 Leads / $2.4M Pipeline /
  **89% Close Rate**" with nothing marking it illustrative, two screens above
  the section promising *"I won't show you invented star ratings or made-up
  customer quotes."* An 89% close rate is roughly triple a strong real one. Now
  labelled **Sample data** with a plausible 31%; the other 12 panels carry an
  **Illustration** badge via one `::after` rule.
- **Real screenshots.** The page had **zero `<img>`** — every visual was CSS
  fakery. The kanban board and Good/Better/Best estimate panels now show real UI
  captured from `/pro/sandbox.html`, tagged **Live UI**.
  - Captured from the sandbox, not the CRM, on purpose: the board shows
    homeowner names and street addresses. Verified they are hardcoded in
    `pro/js/sandbox-demo.js` with no Firestore read before publishing. Figures
    are retail only — no cost or margin, so `catalog-cost-privacy` holds.
  - Encoded via Chromium's canvas WebP encoder (no `sharp` installed anywhere in
    the tree) at q0.92 / 1128px → 32KB and 9.4KB.
- **A2P disclosure readable.** Was 10px at `rgba(255,255,255,.55)` — a real
  onboarding obligation set in the smallest, faintest type on the page. Now 12px
  with lifted contrast. Copy untouched (it is fenced pending A2P verification).

**Measured, and it changed the plan:** `/pro` was audited at
320/360/390/414/768/1024/1280/1440px and has **zero horizontal overflow at every
width**. The "thin responsive coverage" concern (8 `@media` queries for 1,051
lines) does not translate into actual defects, so no restructuring was done. The
premise did not survive measurement.

## Still open

- **Full visual redesign + copy/messaging refresh of `/pro`** — not started.
  The objective defects are fixed and the responsive premise was disproved, so
  what remains is subjective direction. Needs Jo's steer, and two in-file
  comments fence parts of it (AI Texting copy pending A2P; the verified-features
  strip must stay code-sourced).
- **11 of 13 `/pro` panels are still hand-built illustrations.** The sandbox can
  supply more real captures the same way.
- **Tap targets** — 14–24 controls under 32px tall on `/pro`. This is the
  site-wide pattern already logged in
  `qa/homeowner-sweep-2026-06-11/PHASE3-VISUAL.md` as needing Jo's call; not
  changed unilaterally.
- ~~`docs/the-pledge/index.html` is missing `mobile-cta.css`.~~ **Not a defect —
  retracted the same day.** `mobile-cta.css`'s own header states *"The homepage
  and /the-pledge keep their own bottom bars and don't load this."* Verified:
  `/the-pledge` renders its own `.stickybar` ("📞 Call Joe / Text") and carries
  zero `mobile-cta-strip` markup, as does `docs/index.html`. The recon flagged
  it as a "soft signal" from stylesheet-coverage counting; reading the file it
  named would have resolved it. A page differing from its cohort is a question,
  not a finding.
- **`sitemap.xml` drift** — `build-sitemap.js` reports differences. Verified
  **pre-existing** (drift persists with this branch's changes stashed), so it was
  left alone. Someone should run `--write` deliberately.
- **`docs/pro/**` and `docs/admin/**` (43 pages) remain outside
  `check-site-integrity`. `scripts/crm-audit.js` covers `/pro` statically but is
  wired into no workflow.

## Gates

All green: `ensure-icon-css`, `ensure-nav-css`, `check-site-integrity` (210
pages / 22,733 refs / 0 failures), `check-js-syntax` (466 files),
`check-inline-html-scripts`, `check-image-privacy` (86 images),
`apply-partials --check`, `marketing-polish-contract` (51 passed),
`qc-render-sweep` (208 pages, 0 findings).

One caveat worth knowing: **the local `firebase serve` does not process
redirects at all** — the pre-existing `/yardsign` and `/sites/oaks` redirects
also 404 against it. The new `/pro/landing` 301 is therefore validated by config
shape and by `check-site-integrity` (which reads `firebase.json` at runtime),
not by a live request. Confirm it after deploy.

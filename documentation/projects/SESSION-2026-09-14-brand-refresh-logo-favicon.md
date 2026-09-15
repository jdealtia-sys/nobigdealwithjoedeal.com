# Session — brand refresh: new logo/favicon pack, 2026-09-14

Jo supplied a full upscaled logo/favicon pack (`Logo Upscale to 4K.zip`, 64
files, 14.8MB) and asked for it implemented across the site and repo. Branch
`feat/brand-refresh-2026-09`, cut from `origin/main` at `960426b1` (same-day
tip, which already includes today's earlier `fix(brand)` crop PR #1554 and
the squash-merged `fix/gbb-tier-followups` — see the branch-freshness note
below).

## What was in the pack, and what actually landed in the repo

The zip's `exports/` tree covers six use cases; only three are consumed by
any code:

| Folder | Use | Landed where |
|---|---|---|
| `icons/` | Two full favicon/app-icon families | `docs/favicon.svg`, `docs/pro/favicon.svg`, `docs/pro/img/nbd-icon-{192,512,maskable-192,maskable-512}.png` |
| `vector/`, `web/` | Wordmark lockup (SVG + web PNG) | `docs/assets/images/nbd-logo.png`, `scripts/assets/nbd-wordmark.png` |
| `upscaled-original/` | 4K master art | `print-assets/nbd-logo-master.png` |
| `apparel/`, `large-format/`, `social/` | Embroidery, yard-sign/vehicle-magnet print art, LinkedIn/FB banners | **Not consumed by any code** — archived only |

Jo's call (asked and answered before building): commit the **whole** pack to
git rather than just the web-consumed subset, and delete/overwrite the old
files in place rather than leaving them stranded. Since `docs/` is the
Firebase Hosting root — anything there ships to production — the full 64-file,
14.7MB pack (C2PA metadata stripped from every SVG, see below) lives at
**`brand/logo-pack-2026-09/`**, a new top-level folder alongside `functions/`
and `scripts/`, not under `docs/`. This closes a real gap: no prior brand-asset
drop had a documented home in this repo (unlike partner logos, which
[live in Drive](../rebrand/gaf-tamko-BUILD-BRIEF.md) — NBD's own master art
had nowhere named to go). `brand/logo-pack-2026-09/README.md` documents the
mapping table above for the next person who has to do this again.

## The two-mark scheme was already a locked decision — this refreshes it, doesn't change it

[FAVICON-NORMALIZATION-2026-09-13](../audit/FAVICON-NORMALIZATION-2026-09-13.md)
(same week, different session) already locked homeowner pages to
`/favicon.svg` + apple-touch, and `pro/**`/`admin/**`/`tools/**` to
`/pro/favicon.svg` + the PRO app icon, with a nine-page override map. The new
pack ships exactly that split — `home-solutions-*` and `nbd-pro-*` — so
**every file replacement below kept its existing on-disk path**. That means
zero changes were needed to `scripts/normalize-favicons.js`, the override
map, or any of the 280 pages' `<head>` tags; `tests/favicon-contract.test.js`
(77 assertions) and `tests/pwa-manifest.test.js` (42 assertions) both pass
unmodified against the new bytes.

## What changed, file by file

- **`docs/favicon.svg`** — was a hand-drawn roofline glyph (~500 bytes, no
  wordmark). Now the pack's `icons/home-solutions-icon-small.svg` (C2PA
  stripped): a vector-traced roofline, still wordless at this size (the "NBD"
  wordmark only appears on 192px+ app icons) but drawn from the same master
  art as everything else now, not a separate hand-drawn asset.
- **`docs/pro/favicon.svg`** — was `<text font-family="Arial Black">`
  drawing "NBD"/"PRO" (a font-fallback risk flagged and deliberately left
  alone in the 09-13 audit). Now `icons/nbd-pro-icon-small.svg`: real vector
  paths, no font dependency. See the dated update on that audit doc.
- **`docs/pro/img/nbd-icon-{192,512,maskable-192,maskable-512}.png`** —
  hand-placed with no generator (a gap the 09-13 audit also flagged: no
  script validates these, unlike the two apple-touch PNGs). Replaced
  directly from the pack; still hand-placed, still ungenerated — that gap is
  not closed by this session.
- **`docs/assets/images/apple-touch-icon.png`** — regenerated from the *new*
  `docs/favicon.svg`, 180×180, structurally validated by the existing
  favicon-contract test (chunk bounds, CRC, IDAT inflate size — the same
  checks that caught the #1467 corrupt-PNG bug on 09-13).
- **`docs/assets/images/nbd-logo.png`** (header/nav/footer wordmark) —
  swapped for `web/logo-color-600-transparent.png` (600×308, real PNG, ~54KB).
  This is a **different aspect ratio** than the 135×75 (1.8:1) art PR #1554
  landed hours earlier (new art is 1.948:1) — this session updated the
  `width`/`height` intrinsic-size attributes on the `<img>` tag in all six
  `site-src/partials/{nav,footer}-*.html` sources (135×75 → 600×308) and
  restamped with `apply-partials.js` (269 regions, 222 files). The four other
  in-repo references to this file (`docs/pro/customer.html`,
  `customer-bootstrap.module.js`, `photo-report.js` ×2) size it by CSS
  `height:__px;width:auto` with no baked-in attributes, so they needed no
  edit — confirmed by reading each rule before assuming so.
- **`print-assets/nbd-logo-master.png`** — replaced with
  `upscaled-original/logo-4K-transparent.png` (3840×2478, untrimmed,
  transparent — the crop-to-bbox step still runs on top of it, same as
  before).
- **`print-assets/nbd-logo-print.png`** and **`docs/pro/js/nbd-logo-asset.js`**
  — regenerated (crop-to-bbox + 4% pad + 64-color quantize, then wrapped as a
  base64 data-URI module). Capped the source at 1200px wide before
  quantizing — the master is a 4K upscale but nothing displays this above
  ~300 CSS px, so quantizing the full trimmed resolution just produced a
  158KB module for no visual gain; 1200px lands the module at 104KB.
- **`scripts/assets/nbd-wordmark.png`** — the standalone Python
  estimate-PDF tool's independent 4th copy of the logo. Replaced with the
  same `web/logo-color-600-transparent.png` used for the header, rather than
  cutting a fifth bespoke crop — one fewer surface for the next session's
  brand-drift audit to find diverging.
- Left alone, checked and confirmed unaffected: `functions/print/design-system.css`'s
  `--nbd-orange: #BD5728` token. The new pack's actual orange
  (`#ba5529` on the homeowner mark, `#e06a2c` on the pro mark's brighter
  black-background variant) is within ~3 units per channel of the existing
  token — consistent with resampling noise from an "upscale," not a deliberate
  palette change. Re-deriving CSS tokens site-wide for an imperceptible drift
  wasn't worth the blast radius (this token cascades into
  `docs/pro/manifest.json`'s `theme_color` and CSS across the print system).

## Two tooling substitutions, flagged rather than silent

This environment had **no Python** (so `scripts/crop-logo-master.py`,
Pillow-based, couldn't run) and **no Playwright** (`tests/node_modules` was
present but `playwright-core` wasn't, so `scripts/render-apple-touch-icon.js`
couldn't run either). Both were reimplemented one-off with `sharp`
(vendored under `functions/node_modules`, confirmed already present) instead
of skipping the step or hand-copying the pack's own pre-rendered files
verbatim:

- The crop script's bbox-trim + 4% pad + 64-color quantize became
  `sharp().trim()` + `.extend()` + `.png({palette:true, colors:64})`.
- The apple-touch rasterization became `sharp(svgBuffer).resize(180,180).png()`
  — librsvg-backed, and this SVG has no gradients/filters/fonts, so the
  render should be pixel-equivalent to the Chromium path, but this has not
  been cross-checked against Playwright output. **Worth a follow-up**: run
  the real `scripts/crop-logo-master.py` and
  `scripts/render-apple-touch-icon.js` on a machine that has Pillow and
  Playwright, diff their output against what's committed here, and replace
  if they disagree. Both outputs pass every existing structural/contract
  test in the meantime, including the byte-level PNG chunk walk that caught
  the #1467 corruption bug.

## C2PA metadata

Every SVG in the pack carried an embedded C2PA content-credentials manifest
(provenance metadata from whatever upscaling tool produced it) — bloating
simple 3-color marks to 90–160KB apiece for no reason a browser or this repo
cares about. Stripped on the way into `brand/logo-pack-2026-09/` (saved
~130KB across the archive) and from the two files inlined into `docs/`.
Also worth knowing for next time: the icon SVGs are auto-traced (a roofline
that should be a handful of path points is ~13KB of dense coordinate data
per icon) rather than clean hand-vectored source — shippable and correct,
just heavier than it should be. No `svgo` was available in this environment
(no network access to install it) to clean that up; flagging rather than
leaving it undiscovered.

## Branch-freshness trap avoided

The working tree was on `fix/gbb-tier-followups` @ `4def98a6`, five days
behind `origin/main` — which already had `fix/favicon-normalization` merged
(the two-mark rule this session built on) plus PR #1554 from *earlier the
same day* re-encoding `nbd-logo.png` as a real PNG. Building on the stale
branch would have silently redone or reverted both. Branched fresh off
`origin/main` instead (`git checkout -b feat/brand-refresh-2026-09
origin/main`) — the same class of shared-checkout hazard as prior incidents
in this repo (multiple worktrees, HEAD moving between turns).

## Verified

`check-js-syntax` (504 files), `check-site-integrity --quiet` (243 pages,
27336 refs, 0 failures), `apply-partials --check --diff` (647 regions, 222
files, clean), `check-image-privacy` (565 images, 0 failures),
`build-logo-asset --check` (up to date), `build-sitemap` (0 diff, 224 URLs),
`tests/favicon-contract.test.js` (77/77), `tests/pwa-manifest.test.js`
(42/42). Visually confirmed in a local static preview (http-server on 8099):
homepage header/footer logo, `/favicon.svg`, `/pro/favicon.svg`, and the
rasterized `apple-touch-icon.png` all render correctly; `/pro/login.html`'s
unrelated CSS-drawn "NBD" badge (not an image, untouched by this swap) still
renders fine. No new console errors — the only 404s on `/pro/login.html`
(`/pro/nosw.txt`) are a pre-existing, unrelated service-worker probe.

## Not done / left for a follow-up

- Re-run the real Python/Playwright pipeline scripts on a machine that has
  the deps and diff against what's committed (see above).
- `docs/pro/img/nbd-icon-*.png` still has no generator or contract-test
  coverage (pre-existing gap, not introduced or closed here).
- The auto-traced SVG path bloat (not cleaned up — no `svgo` available).
- `brand/logo-pack-2026-09/exports/apparel|large-format|social/*` are
  archived but not handed to anyone — Jo still needs to send the print/social
  files to whatever vendor or platform actually uses them; nothing in the
  repo does.

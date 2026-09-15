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
- **`docs/assets/images/apple-touch-icon.png`** — regenerated via the real
  `scripts/render-apple-touch-icon.js` (Playwright/Chromium) from the new
  `docs/favicon.svg`, 180×180, structurally validated by the existing
  favicon-contract test (chunk bounds, CRC, IDAT inflate size — the same
  checks that caught the #1467 corrupt-PNG bug on 09-13). Also fixed a real
  bug in that script surfaced by running it for real — see below.
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
  — regenerated via the real `scripts/crop-logo-master.py` +
  `scripts/build-logo-asset.js` (crop-to-bbox + 4% pad + 64-color quantize,
  then wrapped as a base64 data-URI module): 2124×1158, 87KB module. No
  resolution cap — that script doesn't have one, and an earlier sharp-based
  attempt that added a 1200px cap to control module size turned out both
  unfaithful to the real pipeline and unnecessary (see below).
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

## Two tooling substitutions — first sharp, then cross-checked against the real thing

This environment initially looked like it had **no Python** (`python`/
`python3` on PATH are Windows Store-install stubs that report "not found")
and **no Playwright** (`tests/node_modules/playwright-core` wasn't found by
an early, wrongly-chained check). The crop/quantize and SVG→PNG steps were
first reimplemented one-off with `sharp` (vendored under
`functions/node_modules`) as `sharp().trim()`+`.extend()`+
`.png({palette:true, colors:64})` and `sharp(svgBuffer).resize(180,180).png()`
respectively.

**Both turned out to be avoidable substitutions, caught by going back and
checking properly:**

- A **real Python 3.14.3 with Pillow 12.1.1** exists at
  `C:\Users\jonat\AppData\Local\Python\pythoncore-3.14-64\python.exe` — just
  not the name `python3`/`python` resolves to in this shell (a PATH-shadowing
  issue, not an absent tool). Running the actual `scripts/crop-logo-master.py`
  through it
  produced `nbd-logo-print.png` at **2124×1158** — no downscale step exists
  in that script, so at this master's 3840px resolution (a real "upscale,"
  vs. the old master's 1536px) the bbox crop is naturally ~2.5× larger than
  my sharp version, which had added an unrequested 1200px width cap to keep
  the CRM module small. The real, uncapped output is what's committed now
  (`docs/pro/js/nbd-logo-asset.js` regenerated from it, 87KB module vs. my
  capped 104KB attempt — Pillow's quantizer is more efficient anyway, so the
  "faithful" version isn't even the bigger one).
- `tests/node_modules` **did** have `playwright`/`playwright-core`/
  `@playwright` all along — the first check chained too many `&&`/`||`
  clauses in one line and mis-evaluated. Running the real
  `scripts/render-apple-touch-icon.js` surfaced a genuine bug my sharp
  substitute had silently gotten away with: the script hardcodes
  `const TILE = '#1a3057'` (the *old* favicon's navy tile) as the color it
  flattens onto before drawing the SVG, so iOS's own corner-rounding mask
  has an opaque, on-brand fill underneath instead of showing raw transparency
  (the whole reason this script exists — see its header comment on #1467).
  The new `docs/favicon.svg` has a **white** tile now, so `TILE` was stale
  and every apple-touch-icon this session had produced before this check had
  navy-filled corners around a white rounded-square glyph — visually wrong,
  and invisible to every existing test (none of them assert a corner color,
  only structural PNG validity). Fixed the constant to `#ffffff` and
  re-rendered; confirmed by screenshot and a second `favicon-contract.test.js`
  pass (still 77/77 — the gap in coverage is real and unaddressed here).

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

## CI caught what the restamp missed: 12 hand-authored pages

`apply-partials.js` only restamps pages between `<!-- nbd:partial ... -->`
markers. Twelve pages carry their nav/footer logo `<img>` **outside** that
system — `docs/index.html` (its own hand-authored nav/footer, distinct CSS
classes from the shared partials), `visualizer.html`, five service detail
pages (`the-nbd-guarantee`, `the-nbd-build`, `roofivent`, `lumanail`,
`gaf-pivot-boot`), `privacy.html`, `review.html`, `inspect.html`,
`areas/index.html`, and `the-pledge/index.html` (two occurrences) — and the
six-partial `width`/`height` update never reached them. `check-site-integrity`
and `apply-partials --check` don't look for this (neither owns hardcoded
per-page dimension attributes); what actually caught it was
`tests/nav-logo-size-2026-09-14.test.js`, a suite from this morning's #1554
that happens to assert the exact attribute string site-wide. Once its own
hardcoded 135×75 expectations were updated to reflect this session's real
600×308 artwork (the actual, legitimate reason it needed touching), it went
from 17/19 to 19/19 and named the 12 stragglers by exact file. Fixed with a
plain string find-replace (12 files, 13 occurrences — confirmed via a
lone-CR byte scan that no EOL corruption followed).

## Not done / left for a follow-up

- `scripts/render-apple-touch-icon.js`'s corner-fill `TILE` constant is a
  hand-maintained hex string, not derived from the SVG it renders — it will
  go stale again the next time `docs/favicon.svg`'s background color
  changes, exactly as it did this session. Nothing enforces the two stay in
  sync; a test asserting `TILE` matches the SVG's actual background fill
  would catch this class of bug before a session has to notice it visually.
- `docs/pro/img/nbd-icon-*.png` still has no generator or contract-test
  coverage (pre-existing gap, not introduced or closed here).
- The auto-traced SVG path bloat (not cleaned up — no `svgo` available).
- `brand/logo-pack-2026-09/exports/apparel|large-format|social/*` are
  archived but not handed to anyone — Jo still needs to send the print/social
  files to whatever vendor or platform actually uses them; nothing in the
  repo does.

## Dated corrections (2026-09-15)

`brand/logo-pack-2026-09/derived/README.md` cites "this note's dated
correction" for the header/nav/footer illegibility fix — that fix landed as
`#1572` the same day this note was written, but nothing was ever appended
here to match. Two corrections, closing that dangling reference:

- **`#1572` (same day, `67526692`)**: the header/nav/footer wordmark
  (`docs/assets/images/nbd-logo.png`) shipped by this session used the
  pack's `color` variant (navy main text) against the site's dark navy
  header/nav/footer background — illegible. Recolored to
  `brand/logo-pack-2026-09/derived/logo-white-accent.svg` (white main text,
  orange accent) at the same 600×308, so no `width`/`height` attributes
  needed re-touching a second time.
- **A scope gap in THIS session's own "Verified" list, found and fixed by a
  2026-09-15 follow-up session**: this session verified the client-side
  browser pipeline (`docs/**`, `docs/pro/js/nbd-logo-asset.js`,
  `scripts/assets/nbd-wordmark.png`) but never checked `functions/` — the
  Cloud Functions server-side PDF pipeline. `functions/render-pdf.js`'s
  `NBD_DOC_COMPANY.logoUrl` still pointed at `nbd-logo.png` (the wordmark),
  and `functions/print/partials/brandBandTop.hbs` renders that into a 42×42pt
  `.brand-mark` box with `object-fit:cover` (design-system.css:215-220) — a
  1:1 crop built for an icon. The OLD 135×75 asset happened to have a
  centered roofline icon that survived that crop; the NEW 600×308
  icon-less wordmark does not, so **every PDF this CRM generates** (contract,
  estimate, invoice, warranty, receipt, changeOrder, inspection, photoReport
  — all 8 entries of `render-pdf.js`'s `TEMPLATES` map) rendered with an
  illegible "DE" fragment instead of a brand mark, live on `main`, from the
  moment `#1570` merged until the follow-up fix. Corrected by pointing
  `logoUrl` at `apple-touch-icon.png` (already square, already on-brand, no
  CSS change needed) — see `tests/render-pdf-brand-mark-square.test.js`,
  added the same session so this class of bug can't silently recur.

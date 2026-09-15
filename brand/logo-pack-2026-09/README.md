# Logo pack — 2026-09-14 upscale/refresh

Source-of-truth archive for the full brand asset pack Jo supplied
(`Logo Upscale to 4K.zip`, 64 files). This directory is a straight copy of
the zip's `exports/` tree, with one change: every `.svg` has had its
embedded C2PA content-credentials metadata stripped (it was bloating simple
3-color marks to 90–160KB for no reason anything here cares about; saved
~130KB across the archive, no visual change).

**This folder is not served.** `docs/` is the Firebase Hosting root — only
files there ship to production. This lives outside it on purpose, next to
`functions/` and `scripts/`, as the canonical place future sessions drop a
new brand-asset pack. (There was no such place before this one; see
[SESSION-2026-09-14-brand-refresh-logo-favicon](../../documentation/projects/SESSION-2026-09-14-brand-refresh-logo-favicon.md).)

## What's here

- `icons/` — two full favicon/app-icon families: `home-solutions-*` (public
  marketing site) and `nbd-pro-*` (CRM). `.ico`, PNGs at 16/32/48/64/180/
  192/512/1024, maskable 192/512, and SVGs including `-small` variants
  (wordless, for tiny sizes).
- `vector/`, `web/` — the full wordmark lockup: SVG in color/black/navy/white
  plus "noscript" (no italic tagline) variants, and web-ready 600px PNGs.
- `logo/logo-color-4K.png`, `upscaled-original/` — high-res masters.
- `apparel/` — embroidery-ready logo variants (navy/black/white/color,
  script and noscript).
- `large-format/` — yard sign (18×24, 150dpi), vehicle magnet (24×12,
  150dpi), job-site sign (24×36, 100dpi).
- `social/` — 1500×500 profile banners (navy/white).

## What actually landed in the repo, and from where

Only `icons/`, `vector/`/`web/`, and `upscaled-original/` are consumed by
any code. `apparel/`, `large-format/`, and `social/` are archived here only —
nothing in the repo references them; Jo still needs to hand those to
whatever print vendor or social platform uses them.

| Repo path | Source in this pack |
|---|---|
| `docs/favicon.svg` | `icons/home-solutions-icon-small.svg` |
| `docs/pro/favicon.svg` | `icons/nbd-pro-icon-small.svg` |
| `docs/pro/img/nbd-icon-192.png` | `icons/nbd-pro-icon-192.png` |
| `docs/pro/img/nbd-icon-512.png` | `icons/nbd-pro-icon-512.png` |
| `docs/pro/img/nbd-icon-maskable-192.png` | `icons/nbd-pro-maskable-192.png` |
| `docs/pro/img/nbd-icon-maskable-512.png` | `icons/nbd-pro-maskable-512.png` |
| `docs/assets/images/apple-touch-icon.png` | regenerated FROM the new `docs/favicon.svg` (not copied directly — see `scripts/render-apple-touch-icon.js`) |
| `docs/assets/images/nbd-logo.png` | `derived/logo-white-accent.svg` (**not** `web/logo-color-600-transparent.png` — see below) |
| `scripts/assets/nbd-wordmark.png` | `web/logo-color-600-transparent.png` (navy-on-transparent — correct for this tool's white-paper PDF export context; **not** the same file as the header logo above, which needs the opposite colorway for its dark background) |
| `print-assets/nbd-logo-master.png` | `upscaled-original/logo-4K-transparent.png` |
| `print-assets/nbd-logo-print.png`, `docs/pro/js/nbd-logo-asset.js` | derived FROM the master above via `scripts/crop-logo-master.py` + `scripts/build-logo-asset.js` (not copied directly) |

To redo any of the "regenerated FROM" / "derived FROM" rows, replace the
named source file and re-run the script named next to it — don't hand-copy
a pack file into those slots, the pipeline exists to keep them correct
(bbox crop, palette quantization, byte-validated PNG structure).

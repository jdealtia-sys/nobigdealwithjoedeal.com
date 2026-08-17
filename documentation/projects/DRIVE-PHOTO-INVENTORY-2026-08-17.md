# Drive photo inventory — 2026-08-17 (full-drive sweep)

Jo asked for a deep look across "other devices and storage… USB files or the
SD card", guaranteeing 6–8k photos. An exhaustive agent walk of the whole
Drive (keyset-cursor pagination over `mimeType contains 'image/'` — the MCP's
own pageToken re-serves pages, so treat totals as a tight floor) found:

- **≈9,995 images** (Jo's guess was low) and **2,424 videos** (~1,100 of the
  videos are a personal TV-series archive, not job footage).

This note is the reusable map. Companion notes:
[SESSION-2026-08-17-photo-credibility-tarping-seo](SESSION-2026-08-17-photo-credibility-tarping-seo.md)
(what's already been scanned/published) ·
[rush-week addendum](../marketing/rush-week-2026-08.md) (what the photos feed).

## Device / backup roots

| Root | What's inside | Images |
|---|---|---|
| **USB Devices & SD Cards** (Drive folder at My Drive root) | Six device dumps — see card table below | 5,931 |
| **COMPANIES** (curated business tree) | Four brands: **NBD**, **ORC**, **SPR**, **MLR** (Mad Ladder Roofing — Jo's own prior brand; the 2025 "Mad Ladder" tarp-fee invoice is in-family, not a competitor's) | 3,335+ |
| **ASUS ROG 14** (laptop sync) | E:-drive image incl. **DCIM/101MEDIA — 235 DJI, July 2026, the newest job flying, on no SD card** + Documents copies of SPR/MLR trees | ~300 |
| TOWER / My Laptop (PC syncs) | Downloads only | 18 |
| Personal (old phone "Pictures", 2011 Fuji orphans, USB wallpapers) | Non-job | ~500 |

## The SD cards (all DJI drone rolls; heavy overlap — dedupe before bulk use)

| Card | Rolls (images) | Notes |
|---|---|---|
| SDXC 240GB | 100MEDIA (627) · 101MEDIA (952) | **Scanned 2026-08-17** (sampled). Source of the published tarp + guards + algae crops |
| SDXC Card | 101–106MEDIA (206 / 878 / 546 / 74 / 165 / 338) = 2,291 | **Unscanned.** 102MEDIA (878) + 103MEDIA (546) are the biggest unscanned rolls anywhere |
| SDXC 64GB | 101–107MEDIA = 1,660 | 102/103MEDIA duplicate "SDXC Card" 1:1; **107MEDIA (96) scanned** — source of the installed-screens shot |
| MICRO SD 64GB | 103–105MEDIA = 223 | Oldest drone archive (2025) |
| HSFTOOLS THERMAL | 202605 (130 thermal) | Thermal-inspection imagery (Rita Hatley job; same set duplicated in her customer folder). **Differentiated marketing material** — nobody else in the market shows thermal moisture scans |
| USB30FD / SANDISK 256 | wallpapers, old school files | Non-job |

## Curated customer sets (COMPANIES/NBD/CUSTOMERS — 2,250 imgs, 25+ folders)

Largest: Ty Mom Phone shots (269 HEIC) · Brian Goddard Build Day drone
(263 ×2 exact-duplicate folders + 63 loose) · Rita Hatley (136 iPhone + 130
thermals) · Heather Woods (121) · Troy (105) · Jennifer Morgan McCane (175) ·
Dan Philpot (77) · Houston Weedn (70) · Alison Coleman (69) · Louie (69).
ORC brand adds 224 (Mike Shaw 90…); SPR adds 166 (duplicated under ASUS ROG
Documents). iPhone sets are HEIC — **decode with `heic-convert` (npm), the
repo's sharp build can't read HEVC**; some .HEIC files are secretly JPEG.

## Sensitivity flags

- **"Scans to Sort" = bank checks + receipts (~100 PDFs), zero images** —
  never anything from there on the public site.
- MLR Drive-takeout under ASUS ROG Documents contains staff-account exports
  (kala@/patrick@madladderroofing.com) — internal, keep private.
- Standing photo rules from the credibility session apply to everything
  here: EXIF strip via `prepare-project-images.mjs`, anonymous crops for
  non-consented properties, condition-not-claim captions, no manufacturer
  marketing assets.

## Scan status / queue

- ✅ Sampled + harvested: SDXC-240GB 100/101MEDIA, 64GB 107MEDIA, Gutters
  folder, loose damaged-gutter JPEGs (6 photos published via PR #1227).
- 🔄 In flight (2026-08-17 evening): ASUS ROG July-2026 roll (Gary's
  screen-job window) · Ty Mom 269-HEIC set.
- ⏭ Next best: SDXC Card 102MEDIA (878) → covers its 64GB twin ·
  103MEDIA (546) · MICRO SD 103MEDIA (168, 2025 archive) · thermal set
  (marketing content, not the current three categories).
- Dedup rule of thumb: scan "SDXC Card" rolls, skip "SDXC 64GB" twins;
  prefer customer-named folders over raw rolls when both exist.

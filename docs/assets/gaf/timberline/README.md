# GAF Timberline Assets

Drop real product / installed photos here as you collect them. The
Timberline page (`/services/gaf-timberline/`) auto-detects the named
files below and falls back to high-quality CSS swatches when they're
missing — page never breaks.

## Where to source

- **Product / color swatch photos**: gaf.com product pages, GAF brochure
  PDFs, or your supplier (Beacon, ABC Supply). Hot Home Depot / Lowe's
  product listings are also fair game.
- **Installed-on-roof photos**: your own jobs are best — homeowners
  trust real installs over catalog shots. Manufacturer marketing photos
  are a good second.

## Naming convention

Color filenames must match the swatch IDs in `docs/visualizer.html`
(`VIZ_OPTIONS.shingleColors`) so the visualizer can re-use them later.

```
ns/charcoal.jpg
ns/pewter-gray.jpg
ns/weathered-wood.jpg
…

hdz/charcoal.jpg
hdz/pewter-gray.jpg
…

uhdz/charcoal.jpg
…

installed/hdz-charcoal-colonial.jpg
installed/uhdz-weathered-wood-ranch.jpg
…
```

## Image specs

- 800×600 (4:3) for swatch tile shots — keeps page light and grid-tight
- 1600×900 (16:9) for installed-on-a-roof hero shots
- JPEG, ~85% quality
- Strip EXIF before uploading

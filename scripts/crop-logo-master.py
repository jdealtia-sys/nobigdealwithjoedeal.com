#!/usr/bin/env python3
"""Crop the NBD logo master down to its artwork and write the print-ready PNG.

Why this exists
---------------
The logo the document generator embeds used to be the 1536x1024 master with
its studio whitespace intact: the artwork occupied 773x393 of that canvas,
19% of the area. Every document set the header logo to `width:150px`, so the
wordmark actually rendered at about 75px inside a 150x100 box of nothing and
read as a small logo floating in a large margin. Cropping to the artwork lets
the same 150px CSS render the wordmark at 150px.

It also converts JPEG -> PNG. The old asset was a JPEG (misnamed .png at one
point), and JPEG ringing around a hard-edged wordmark is exactly the artefact
a logo must not have.

Output stays small by quantizing to a 64-colour palette: this is flat brand
artwork -- navy, rust, grey, white and their anti-aliasing -- so 64 colours is
visually lossless here and lands under the size of the JPEG it replaces.

Usage:  python3 scripts/crop-logo-master.py
Needs:  Pillow.  Run it only when the master artwork changes; commit the
        result.  scripts/build-logo-asset.js then wraps the PNG into the
        data-URI module and needs no dependencies at all.
"""
import os
import sys

try:
    from PIL import Image, ImageChops
except ImportError:
    sys.exit("Pillow is required:  pip install --user Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "print-assets", "nbd-logo-master.png")
OUT = os.path.join(ROOT, "print-assets", "nbd-logo-print.png")

PAD_RATIO = 0.04      # breathing room, as a fraction of the artwork width
PALETTE = 64          # colours; flat brand art needs nowhere near 256
THRESHOLD = 12        # how far from the paper colour counts as artwork

img = Image.open(SRC).convert("RGB")
paper = img.getpixel((0, 0))
delta = ImageChops.difference(img, Image.new("RGB", img.size, paper)).convert("L")
box = delta.point(lambda p: 255 if p > THRESHOLD else 0).getbbox()
if not box:
    sys.exit("No artwork found in %s -- is it a blank image?" % SRC)

art = img.crop(box)
w, h = art.size
pad = round(w * PAD_RATIO)
canvas = Image.new("RGB", (w + 2 * pad, h + 2 * pad), (255, 255, 255))
canvas.paste(art, (pad, pad))
canvas.quantize(colors=PALETTE, method=Image.MEDIANCUT, dither=Image.NONE).save(
    OUT, "PNG", optimize=True
)

print("%s -> %s" % (os.path.basename(SRC), os.path.basename(OUT)))
print("  master   %dx%d" % img.size)
print("  artwork  %dx%d at %s" % (w, h, box))
print("  written  %dx%d, %d bytes" % (canvas.size[0], canvas.size[1], os.path.getsize(OUT)))
print("\nNext:  node scripts/build-logo-asset.js")

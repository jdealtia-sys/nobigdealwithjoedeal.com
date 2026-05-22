#!/usr/bin/env python3
"""
generate_qrs.py — print-tracking QR code generator.

Builds the 7 QR PNGs that go on physical marketing pieces (yard signs,
banners, door hangers, business cards, stickers). Each QR encodes a
URL with a unique utm_source so we can attribute scans back to the
specific piece in Google Analytics on /inspect, and to passthrough
query strings on /r (firebase redirect → Google Reviews).

Specs (tuned for print survival):
  - Error correction: H  (~30% — survives dirt, scuffs, sun fade)
  - Output size:       1200 × 1200 px (final canvas)
  - Box size:          18 px per module
                       (set so the longest URL's QR version still
                        fits inside the 1200 canvas with crisp,
                        non-stretched modules — 20 was originally
                        specced but 20*65 modules = 1300 px would
                        overflow for utm_source=banner-neighbor)
  - Border:            4 modules ("quiet zone") — plus extra white
                       padding around it from the canvas centering
  - Fill:              pure black on pure white (no grayscale, no
                       gradients — scanners need crisp edges)
  - Format:            PNG

Usage:
  pip install "qrcode[pil]"
  python scripts/generate_qrs.py
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_H
    from PIL import Image
except ImportError:
    sys.stderr.write(
        "ERROR: qrcode library not installed.\n"
        "  Install with:  pip install \"qrcode[pil]\"\n"
    )
    sys.exit(1)

CANVAS_SIZE = 1200
BOX_SIZE = 18
BORDER = 4

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = REPO_ROOT / "print-assets" / "qr-codes"

DOMAIN = "https://nobigdealwithjoedeal.com"
CAMPAIGN = "storm-2026"

# (filename, route, utm_source)
# 5 codes funnel scanners to the /inspect lead form.
# 2 codes (card-back, sticker) funnel scanners to /r → Google reviews.
PIECES = [
    ("qr-yard-sign.png",        "/inspect", "yard-sign"),
    ("qr-banner-neighbor.png",  "/inspect", "banner-neighbor"),
    ("qr-banner-event.png",     "/inspect", "banner-event"),
    ("qr-card-front.png",       "/inspect", "card"),
    ("qr-card-back.png",        "/r",       "card"),
    ("qr-hanger.png",           "/inspect", "hanger"),
    ("qr-sticker.png",          "/r",       "sticker"),
]


def build_url(route: str, source: str) -> str:
    return (
        f"{DOMAIN}{route}"
        f"?utm_source={source}"
        f"&utm_medium=print"
        f"&utm_campaign={CAMPAIGN}"
    )


def make_qr(url: str, out_path: Path) -> None:
    qr = qrcode.QRCode(
        version=None,                  # auto-fit to data
        error_correction=ERROR_CORRECT_H,
        box_size=BOX_SIZE,
        border=BORDER,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color=(0, 0, 0), back_color=(255, 255, 255))
    # The QR auto-fits to a version-dependent size. Different URLs hit
    # different versions (banner-neighbor is one module bigger than
    # the others), so a non-integer resize to 1200x1200 stretches
    # modules unevenly and breaks decoder alignment. Instead, paste
    # the natural-size QR into a 1200x1200 white canvas — every
    # module stays a crisp 20x20 block and the extra whitespace just
    # widens the quiet zone (only helps scanning).
    pil_img = img.get_image() if hasattr(img, "get_image") else img
    canvas = Image.new("RGB", (CANVAS_SIZE, CANVAS_SIZE), (255, 255, 255))
    qw, qh = pil_img.size
    if qw > CANVAS_SIZE or qh > CANVAS_SIZE:
        raise RuntimeError(
            f"QR for {out_path.name} is {qw}x{qh}, larger than the "
            f"{CANVAS_SIZE}px canvas. Drop box_size or shorten the URL."
        )
    canvas.paste(pil_img, ((CANVAS_SIZE - qw) // 2, (CANVAS_SIZE - qh) // 2))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, format="PNG")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be generated without writing files.",
    )
    args = parser.parse_args()

    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Domain:           {DOMAIN}")
    print(f"Campaign:         {CAMPAIGN}")
    print()

    for filename, route, source in PIECES:
        url = build_url(route, source)
        out_path = OUTPUT_DIR / filename
        print(f"  {filename:30s} -> {url}")
        if not args.dry_run:
            make_qr(url, out_path)

    if args.dry_run:
        print("\n(dry run — no files written)")
    else:
        print(f"\nWrote {len(PIECES)} PNG files to {OUTPUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

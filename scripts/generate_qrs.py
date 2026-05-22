#!/usr/bin/env python3
"""
generate_qrs.py — print-tracking QR code generator.

Builds the 7 QR PNGs that go on physical marketing pieces (yard signs,
banners, door hangers, business cards, stickers). Each QR encodes a
URL with a unique utm_source so we can attribute scans back to the
specific piece in Google Analytics on /inspect, and to passthrough
query strings on /r (firebase redirect → Google Reviews).

Each PNG carries a printed identifier strip under the QR — piece name,
destination summary, and campaign + utm_source — so files can't get
confused in a folder, in an email, or on the printer's screen. The
QR itself sits cleanly inside its own quiet zone, so a print designer
who wants only the code can crop the bottom strip.

Specs (tuned for print survival):
  - Error correction: H  (~30% — survives dirt, scuffs, sun fade)
  - Output size:       1200 × 1200 px (final canvas)
  - Box size:          14 px per module (chosen so the longest URL's
                       QR fits in the top portion of the canvas with
                       crisp non-stretched modules AND leaves room for
                       the identifier strip at the bottom)
  - Border:            4 modules ("quiet zone")
  - Fill:              pure black on pure white (no grayscale, no
                       gradients — scanners need crisp edges)
  - Format:            PNG

Usage:
  pip install "qrcode[pil]"
  python scripts/generate_qrs.py
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_H
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.stderr.write(
        "ERROR: qrcode/Pillow not installed.\n"
        "  Install with:  pip install \"qrcode[pil]\"\n"
    )
    sys.exit(1)

CANVAS_SIZE = 1200
BOX_SIZE = 16
BORDER = 4
QR_TOP_PAD = 20            # whitespace above the QR
LABEL_STRIP_HEIGHT = 130   # bottom strip reserved for the identifier text
# Box-size is the load-bearing knob here. Smaller modules let us reserve
# more room for the label, but reference QR decoders (we use opencv as
# our CI proxy) start failing on the longest URL once modules drop below
# ~16 px. Real phone scanners are tolerant down to single-digit pixel
# modules, but matching opencv's floor gives us a verifiable invariant.
# 65 modules * 16 = 1040 px QR; leaves 130 px label strip + 20 px top pad
# + 10 px slack underneath the QR before the divider.

# Brand palette (matches docs/inspect.html)
NAVY = (30, 58, 110)       # #1e3a6e — piece title
ORANGE = (232, 114, 12)    # #e8720c — destination summary
GRAY = (107, 114, 128)     # #6b7280 — campaign + utm
DIVIDER = (220, 220, 220)  # thin line between QR and label

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = REPO_ROOT / "print-assets" / "qr-codes"

DOMAIN = "https://nobigdealwithjoedeal.com"
CAMPAIGN = "storm-2026"

# (filename, route, utm_source, display title, route summary for label)
# 5 codes funnel scanners to the /inspect lead form.
# 2 codes (card-back, sticker) funnel scanners to /r → Google reviews.
PIECES = [
    ("qr-yard-sign.png",        "/inspect", "yard-sign",       "YARD SIGN",              "Scan → /inspect (lead form)"),
    ("qr-banner-neighbor.png",  "/inspect", "banner-neighbor", "NEIGHBOR BANNER",        "Scan → /inspect (lead form)"),
    ("qr-banner-event.png",     "/inspect", "banner-event",    "EVENT BANNER",           "Scan → /inspect (lead form)"),
    ("qr-card-front.png",       "/inspect", "card",            "BUSINESS CARD · FRONT",  "Scan → /inspect (lead form)"),
    ("qr-card-back.png",        "/r",       "card",            "BUSINESS CARD · BACK",   "Scan → /r (Google review)"),
    ("qr-hanger.png",           "/inspect", "hanger",          "DOOR HANGER",            "Scan → /inspect (lead form)"),
    ("qr-sticker.png",          "/r",       "sticker",         "STICKER",                "Scan → /r (Google review)"),
]


def build_url(route: str, source: str) -> str:
    return (
        f"{DOMAIN}{route}"
        f"?utm_source={source}"
        f"&utm_medium=print"
        f"&utm_campaign={CAMPAIGN}"
    )


def _load_font(size: int, *, bold: bool = False):
    """Try Arial (Windows) first, then DejaVu (Linux/Mac), then default.

    The script is dev-machine-only, so a missing font just means an
    uglier-but-still-legible label, never a failure.
    """
    candidates = (
        ("arialbd.ttf", "arial.ttf") if bold
        else ("arial.ttf", "arialbd.ttf")
    ) + (
        ("DejaVuSans-Bold.ttf", "DejaVuSans.ttf") if bold
        else ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf")
    )
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def _draw_centered(draw: ImageDraw.ImageDraw, text: str, y: int,
                   font, fill, canvas_w: int) -> int:
    """Draw text horizontally centered. Returns the y-coord of the next line."""
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (canvas_w - text_w) // 2
    draw.text((x, y), text, font=font, fill=fill)
    return y + text_h


def make_qr(url: str, out_path: Path, title: str, route_summary: str,
            source: str) -> None:
    qr = qrcode.QRCode(
        version=None,                  # auto-fit to data
        error_correction=ERROR_CORRECT_H,
        box_size=BOX_SIZE,
        border=BORDER,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color=(0, 0, 0), back_color=(255, 255, 255))
    pil_img = img.get_image() if hasattr(img, "get_image") else img
    qw, qh = pil_img.size

    qr_zone_height = CANVAS_SIZE - LABEL_STRIP_HEIGHT
    if qw > CANVAS_SIZE or qh > qr_zone_height - QR_TOP_PAD:
        raise RuntimeError(
            f"QR for {out_path.name} is {qw}x{qh}, won't fit in the "
            f"{CANVAS_SIZE}x{qr_zone_height - QR_TOP_PAD} QR zone above "
            f"the label strip. Drop box_size or shorten the URL."
        )

    canvas = Image.new("RGB", (CANVAS_SIZE, CANVAS_SIZE), (255, 255, 255))
    # Center the QR horizontally; pin near the top so the label area is roomy.
    qr_x = (CANVAS_SIZE - qw) // 2
    qr_y = QR_TOP_PAD + (qr_zone_height - QR_TOP_PAD - qh) // 2
    canvas.paste(pil_img, (qr_x, qr_y))

    draw = ImageDraw.Draw(canvas)

    # Thin divider between QR and label strip.
    divider_y = qr_zone_height
    draw.line([(80, divider_y), (CANVAS_SIZE - 80, divider_y)], fill=DIVIDER, width=2)

    # Three lines of identifier text in the bottom strip.
    title_font  = _load_font(34, bold=True)
    route_font  = _load_font(22)
    detail_font = _load_font(18)

    y = divider_y + 12
    y = _draw_centered(draw, title, y, title_font, NAVY, CANVAS_SIZE)
    y += 6
    y = _draw_centered(draw, route_summary, y, route_font, ORANGE, CANVAS_SIZE)
    y += 4
    detail = f"{CAMPAIGN}  ·  utm_source={source}"
    _draw_centered(draw, detail, y, detail_font, GRAY, CANVAS_SIZE)

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

    for filename, route, source, title, summary in PIECES:
        url = build_url(route, source)
        out_path = OUTPUT_DIR / filename
        print(f"  {filename:30s} {title!r:30s} -> {url}")
        if not args.dry_run:
            make_qr(url, out_path, title, summary, source)

    if args.dry_run:
        print("\n(dry run — no files written)")
    else:
        print(f"\nWrote {len(PIECES)} PNG files to {OUTPUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

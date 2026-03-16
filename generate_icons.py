#!/usr/bin/env python3
"""generate_icons.py — Creates all required PWA icon PNGs for 1folder."""

from PIL import Image, ImageDraw, ImageFont
import os

SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
OUT_DIR = os.path.join(os.path.dirname(__file__), 'public', 'icons')
os.makedirs(OUT_DIR, exist_ok=True)

BG_COLOR    = (26, 26, 46)     # --bg-surface
ACCENT      = (124, 106, 247)  # --accent
TEXT_COLOR  = (240, 240, 255)  # --text-primary

def make_icon(size):
    img  = Image.new('RGBA', (size, size), BG_COLOR + (255,))
    draw = ImageDraw.Draw(img)

    # Rounded rect background for the folder emoji style
    padding = size * 0.12
    r       = size * 0.22

    # Draw folder shape
    body_top = size * 0.38
    tab_h    = size * 0.14
    tab_w    = size * 0.42

    # Tab
    draw.rounded_rectangle(
        [padding, body_top - tab_h, padding + tab_w, body_top + r],
        radius=r * 0.5,
        fill=ACCENT
    )
    # Body
    draw.rounded_rectangle(
        [padding, body_top, size - padding, size - padding],
        radius=r,
        fill=ACCENT
    )

    # "1" text
    font_size = int(size * 0.38)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', font_size)
    except Exception:
        font = ImageFont.load_default()

    text = '1'
    bbox = draw.textbbox((0, 0), text, font=font)
    tw   = bbox[2] - bbox[0]
    th   = bbox[3] - bbox[1]
    tx   = (size - tw) / 2 - bbox[0]
    ty   = (size * 0.48) - th / 2 - bbox[1]
    draw.text((tx, ty), text, fill=TEXT_COLOR, font=font)

    return img

for size in SIZES:
    icon = make_icon(size)
    path = os.path.join(OUT_DIR, f'icon-{size}.png')
    icon.save(path, 'PNG')
    print(f'  ✓ icon-{size}.png')

print(f'\nAll icons written to {OUT_DIR}')

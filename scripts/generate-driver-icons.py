#!/usr/bin/env python3
"""
Genera los íconos PWA placeholder de la driver app.
Los reales se reemplazan cuando llegue branding final del cliente.

Uso: python3 scripts/generate-driver-icons.py
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "apps" / "driver" / "public"

# Verde VerdFrut (oklch ~ #16a34a en sRGB).
BRAND_GREEN = (22, 163, 74)
BRAND_DARK = (10, 10, 10)
WHITE = (255, 255, 255)


def render_icon(size: int, maskable: bool, output_path: Path):
    img = Image.new("RGB", (size, size), BRAND_GREEN)
    draw = ImageDraw.Draw(img)

    # Maskable icons necesitan padding (safe zone ~20%) para que no los recorten.
    inner_padding = int(size * 0.2) if maskable else int(size * 0.08)

    # Round corners visualmente (circle background) sólo para non-maskable.
    if not maskable:
        # Llenar fondo más oscuro fuera del círculo, círculo verde dentro.
        bg = Image.new("RGB", (size, size), BRAND_DARK)
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
        bg.paste(img, (0, 0), mask)
        img = bg
        draw = ImageDraw.Draw(img)

    # Letra V grande centrada.
    font_size = int(size * 0.62)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", font_size)
    except Exception:
        font = ImageFont.load_default()

    text = "V"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (size - tw) // 2 - bbox[0]
    y = (size - th) // 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=WHITE)

    img.save(output_path, "PNG", optimize=True)
    print(f"  {output_path.name}  ({size}x{size}, maskable={maskable})")


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Generando íconos en {OUTPUT_DIR}:")
    render_icon(192, False, OUTPUT_DIR / "icon-192.png")
    render_icon(512, False, OUTPUT_DIR / "icon-512.png")
    render_icon(192, True, OUTPUT_DIR / "icon-192-maskable.png")
    render_icon(512, True, OUTPUT_DIR / "icon-512-maskable.png")

    # Apple touch icon (iOS).
    render_icon(180, False, OUTPUT_DIR / "apple-touch-icon.png")

    # Favicon simple.
    fav = Image.new("RGB", (32, 32), BRAND_GREEN)
    d = ImageDraw.Draw(fav)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 24)
    except Exception:
        font = ImageFont.load_default()
    bbox = d.textbbox((0, 0), "V", font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    d.text(((32 - tw) // 2 - bbox[0], (32 - th) // 2 - bbox[1]), "V", font=font, fill=WHITE)
    fav.save(OUTPUT_DIR / "favicon.ico", "ICO")
    print(f"  favicon.ico  (32x32)")


if __name__ == "__main__":
    main()

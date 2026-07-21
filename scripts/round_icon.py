#!/usr/bin/env python3
"""Apply macOS-style rounded mask to Tauri app icon source."""
from PIL import Image, ImageDraw
import sys


def make_rounded_mask(size, radius_ratio=0.22):
    """Create a rounded rectangle alpha mask matching macOS app icon shape."""
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    width, height = size
    radius = int(min(width, height) * radius_ratio)
    draw.rounded_rectangle((0, 0, width, height), radius=radius, fill=255)
    return mask


def main():
    src_path = sys.argv[1] if len(sys.argv) > 1 else 'src-tauri/icons/icon.png'
    dst_path = sys.argv[2] if len(sys.argv) > 2 else 'src-tauri/icons/icon.png'

    img = Image.open(src_path).convert('RGBA')
    # Ensure square canvas
    w, h = img.size
    if w != h:
        size = max(w, h)
        new_img = Image.new('RGBA', (size, size), (255, 255, 255, 0))
        new_img.paste(img, ((size - w) // 2, (size - h) // 2), img)
        img = new_img

    # Resize to 1024x1024 source standard
    size = (1024, 1024)
    img = img.resize(size, Image.Resampling.LANCZOS)

    mask = make_rounded_mask(size, radius_ratio=0.22)
    img.putalpha(mask)

    img.save(dst_path)
    print(f"Saved rounded icon to {dst_path}")


if __name__ == '__main__':
    main()

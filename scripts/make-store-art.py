#!/usr/bin/env python3
"""Build Google Play graphic assets at exact required pixel sizes."""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PLAY = ROOT / "play"
ICON_SRC = ROOT / "public" / "icon-512.png"
APP_ICON_SRC = ROOT / "public" / "app-icon.png"

# Exact Play Store sizes
ICON_SIZE = (512, 512)
FEATURE_SIZE = (1024, 500)
PHONE_SIZE = (1080, 1920)  # recommended phone
TABLET7_SIZE = (1200, 1920)  # 7" portrait
TABLET10_SIZE = (1920, 1200)  # 10" landscape

INK = (232, 240, 255, 255)
MUTED = (170, 190, 220, 255)
ACCENT = (255, 214, 120, 255)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    paths = [
        "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"
        if bold
        else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def load_jar(max_side: int, knock_black: bool = True) -> Image.Image:
    src = ICON_SRC if ICON_SRC.exists() else APP_ICON_SRC
    img = Image.open(src).convert("RGBA")
    # Prefer larger source when available
    if APP_ICON_SRC.exists():
        big = Image.open(APP_ICON_SRC).convert("RGBA")
        if big.width >= img.width:
            img = big
    if knock_black:
        # Remove flat black store-icon backdrop so jar blends into night sky.
        px = img.load()
        for y in range(img.height):
            for x in range(img.width):
                r, g, b, a = px[x, y]
                if a > 0 and r < 18 and g < 18 and b < 22:
                    px[x, y] = (r, g, b, 0)
    scale = max_side / max(img.width, img.height)
    nw = max(1, int(img.width * scale))
    nh = max(1, int(img.height * scale))
    return img.resize((nw, nh), Image.Resampling.LANCZOS)


def night_sky(size: tuple[int, int], seed: int = 7) -> Image.Image:
    w, h = size
    canvas = Image.new("RGB", size, (8, 10, 28))
    px = canvas.load()
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(8 + 18 * t)
        g = int(10 + 28 * t)
        b = int(28 + 55 * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    rng = random.Random(seed)
    draw = ImageDraw.Draw(canvas)
    for _ in range(int(w * h / 1800)):
        x = rng.randint(0, w - 1)
        y = rng.randint(0, int(h * 0.72))
        s = rng.choice([1, 1, 1, 2, 2, 3])
        a = rng.randint(140, 255)
        c = (a, a, min(255, a + 20))
        draw.ellipse((x, y, x + s, y + s), fill=c)
    # soft aurora blobs
    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    blobs = [
        ((-w * 0.1, h * 0.05, w * 0.55, h * 0.45), (80, 120, 255, 55)),
        ((w * 0.35, h * 0.0, w * 1.1, h * 0.4), (180, 90, 220, 45)),
        ((w * 0.1, h * 0.55, w * 0.9, h * 1.05), (40, 80, 160, 40)),
    ]
    for box, color in blobs:
        od.ellipse(box, fill=color)
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=max(24, w // 30)))
    return Image.alpha_composite(canvas.convert("RGBA"), overlay).convert("RGB")


def paste_center(base: Image.Image, overlay: Image.Image, cy: int) -> None:
    x = (base.width - overlay.width) // 2
    y = cy - overlay.height // 2
    base.paste(overlay, (x, y), overlay)


def text_block(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    fnt: ImageFont.ImageFont,
    fill,
    max_width: int | None = None,
) -> int:
    x, y = xy
    if max_width is None:
        draw.text((x, y), text, font=fnt, fill=fill)
        box = draw.textbbox((x, y), text, font=fnt)
        return box[3] - box[1]
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=fnt) <= max_width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    line_h = 0
    for i, line in enumerate(lines):
        draw.text((x, y + i * int(fnt.size * 1.25)), line, font=fnt, fill=fill)
        line_h = int(fnt.size * 1.25)
    return line_h * len(lines)


def write_rgb(path: Path, img: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = img.convert("RGB")
    out.save(path, "PNG", optimize=True)


def write_rgba(path: Path, img: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGBA").save(path, "PNG", optimize=True)


def make_icon() -> None:
    src = Image.open(ICON_SRC if ICON_SRC.exists() else APP_ICON_SRC).convert("RGBA")
    if src.size != ICON_SIZE:
        src = src.resize(ICON_SIZE, Image.Resampling.LANCZOS)
    write_rgba(PLAY / "icon-512.png", src)


def make_feature() -> None:
    w, h = FEATURE_SIZE
    canvas = night_sky((w, h), seed=11).convert("RGBA")
    jar = load_jar(360)
    canvas.paste(jar, (70, (h - jar.height) // 2 + 10), jar)
    draw = ImageDraw.Draw(canvas)
    title = font(72, bold=True)
    sub = font(30, bold=False)
    draw.text((470, 155), "Glow Jars", font=title, fill=INK)
    draw.text((470, 250), "Sort orbs · melt ice · unlock the sky", font=sub, fill=MUTED)
    # soft vignette edge for safe zone
    write_rgb(PLAY / "feature.png", canvas)


def phone_frame(size: tuple[int, int], title: str, subtitle: str, seed: int) -> Image.Image:
    w, h = size
    canvas = night_sky((w, h), seed=seed).convert("RGBA")
    # top caption panel
    panel = Image.new("RGBA", (w - 96, 280), (12, 16, 36, 170))
    canvas.paste(panel, (48, 90), panel)
    draw = ImageDraw.Draw(canvas)
    title_f = font(max(42, w // 18), bold=True)
    sub_f = font(max(26, w // 32), bold=False)
    text_block(draw, title, (72, 120), title_f, INK, max_width=w - 160)
    text_block(draw, subtitle, (72, 220), sub_f, MUTED, max_width=w - 160)

    jar = load_jar(int(min(w, h) * 0.42))
    paste_center(canvas, jar, int(h * 0.58))

    # fake HUD chips
    chip_y = int(h * 0.82)
    for i, label in enumerate(["Undo", "Hint", "+ Jar"]):
        cx = int(w * (0.22 + i * 0.28))
        r = 54
        ImageDraw.Draw(canvas).ellipse((cx - r, chip_y - r, cx + r, chip_y + r), fill=(255, 255, 255, 28))
        tw = draw.textlength(label, font=sub_f)
        draw.text((cx - tw / 2, chip_y + r + 12), label, font=sub_f, fill=MUTED)
    return canvas.convert("RGB")


def tablet_frame(size: tuple[int, int], title: str, subtitle: str, seed: int, landscape: bool) -> Image.Image:
    w, h = size
    canvas = night_sky((w, h), seed=seed).convert("RGBA")
    draw = ImageDraw.Draw(canvas)
    title_f = font(56 if landscape else 50, bold=True)
    sub_f = font(28, bold=False)
    if landscape:
        jar = load_jar(int(h * 0.72))
        canvas.paste(jar, (80, (h - jar.height) // 2), jar)
        draw.text((int(w * 0.42), int(h * 0.32)), title, font=title_f, fill=INK)
        text_block(draw, subtitle, (int(w * 0.42), int(h * 0.48)), sub_f, MUTED, max_width=int(w * 0.5))
    else:
        jar = load_jar(int(w * 0.45))
        paste_center(canvas, jar, int(h * 0.55))
        text_block(draw, title, (72, 120), title_f, INK, max_width=w - 140)
        text_block(draw, subtitle, (72, 220), sub_f, MUTED, max_width=w - 140)
    return canvas.convert("RGB")


PHONE_SHOTS = [
    ("phone-01.png", "Sort glowing orbs", "Match colors and seal every jar"),
    ("phone-02.png", "Melt the ice", "Tap iced orbs to thaw, then move"),
    ("phone-03.png", "Reveal the mystery", "Uncover hidden colors one by one"),
    ("phone-04.png", "Unlock constellations", "Clear levels and light the night sky"),
]

TABLET7_SHOTS = [
    ("tablet7-01.png", "Cozy puzzle nights", "Big, calm boards made for tablets"),
    ("tablet7-02.png", "Hints when you need them", "Undo, hint, extra jar, +5 moves"),
]

TABLET10_SHOTS = [
    ("tablet10-01.png", "Glow Jars on tablet", "Sort orbs across a wide night sky"),
    ("tablet10-02.png", "Play at your pace", "Short sessions · English & Vietnamese"),
]


def main() -> None:
    PLAY.mkdir(parents=True, exist_ok=True)
    make_icon()
    make_feature()

    phone_dir = PLAY / "phone"
    for i, (name, title, sub) in enumerate(PHONE_SHOTS):
        write_rgb(phone_dir / name, phone_frame(PHONE_SIZE, title, sub, seed=20 + i))

    t7 = PLAY / "tablet-7"
    for i, (name, title, sub) in enumerate(TABLET7_SHOTS):
        write_rgb(t7 / name, tablet_frame(TABLET7_SIZE, title, sub, seed=40 + i, landscape=False))

    t10 = PLAY / "tablet-10"
    for i, (name, title, sub) in enumerate(TABLET10_SHOTS):
        write_rgb(t10 / name, tablet_frame(TABLET10_SIZE, title, sub, seed=60 + i, landscape=True))

    listing = PLAY / "LISTING.txt"
    listing.write_text(
        """Google Play graphic assets (exact px)

Required
• Hi-res icon 512×512 (32-bit PNG, alpha OK)
  → play/icon-512.png
• Feature graphic 1024×500 (24-bit PNG/JPEG, NO alpha)
  → play/feature.png
• Phone screenshots (min 2, max 8) — used 1080×1920 (recommended)
  → play/phone/phone-01.png … phone-04.png

Optional / recommended
• 7-inch tablet screenshots — 1200×1920 portrait
  → play/tablet-7/tablet7-01.png … tablet7-02.png
• 10-inch tablet screenshots — 1920×1200 landscape
  → play/tablet-10/tablet10-01.png … tablet10-02.png

Rules (Google Play)
• Screenshots: each side 320–3840 px; longest ≤ 2× shortest
• JPEG or 24-bit PNG without alpha for feature + screenshots
• Icon may include alpha

Rebuild
  python3 scripts/make-store-art.py

Note
These are marketing frames using the official jar icon. For best conversion,
replace phone shots with real device captures when ready (same sizes).
""",
        encoding="utf-8",
    )
    print("Wrote Play Store assets under play/")


if __name__ == "__main__":
    main()

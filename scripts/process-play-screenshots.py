#!/usr/bin/env python3
"""Convert real device screenshots into Play Store sizes."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "play" / "raw"
PLAY = ROOT / "play"

PHONE = (1080, 1920)
TAB7 = (1200, 1920)
TAB10 = (1920, 1200)


def fit_cover(img: Image.Image, size: tuple[int, int], bias_y: float = 0.45) -> Image.Image:
    """Crop to target aspect (center, vertically biased), then resize. Max 2:1 safe."""
    tw, th = size
    src = img.convert("RGB")
    # Drop common status/nav chrome on tall phones before crop.
    if src.height / src.width > 2.05:
        top = int(src.height * 0.035)
        bottom = int(src.height * 0.015)
        src = src.crop((0, top, src.width, src.height - bottom))
    scale = max(tw / src.width, th / src.height)
    nw, nh = max(1, int(src.width * scale)), max(1, int(src.height * scale))
    resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - tw) // 2
    max_top = max(0, nh - th)
    top = int(max_top * bias_y)
    top = max(0, min(top, max_top))
    return resized.crop((left, top, left + tw, top + th))


def letterbox(img: Image.Image, size: tuple[int, int], bg=(8, 10, 28)) -> Image.Image:
    tw, th = size
    src = img.convert("RGB")
    scale = min(tw / src.width, th / src.height)
    nw, nh = max(1, int(src.width * scale)), max(1, int(src.height * scale))
    resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, bg)
    canvas.paste(resized, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def save(path: Path, img: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(path, "PNG", optimize=True)
    print(path.name, img.size)


def main() -> None:
    shots = {
        # bias_y: 0=top-weighted crop, 1=bottom-weighted (home needs lower UI buttons)
        "phone-01.png": (RAW / "home-01.png", 0.58),
        "phone-02.png": (RAW / "gameplay-01.png", 0.38),
        "phone-03.png": (RAW / "levels-01.png", 0.28),
        "phone-04.png": (
            RAW / "gameplay-early.png" if (RAW / "gameplay-early.png").exists() else RAW / "gameplay-02.png",
            0.38,
        ),
    }
    phone_imgs: list[Image.Image] = []
    for name, (src, bias) in shots.items():
        if not src.exists():
            raise SystemExit(f"missing {src}")
        out = fit_cover(Image.open(src), PHONE, bias_y=bias)
        save(PLAY / "phone" / name, out)
        phone_imgs.append(out)

    # 7" tablet: portrait cover from same sources
    tab7_map = [
        ("tablet7-01.png", shots["phone-01.png"]),
        ("tablet7-02.png", shots["phone-02.png"]),
    ]
    for name, (src, bias) in tab7_map:
        save(PLAY / "tablet-7" / name, fit_cover(Image.open(src), TAB7, bias_y=bias))

    # 10" tablet: landscape letterbox of home + gameplay
    save(PLAY / "tablet-10" / "tablet10-01.png", letterbox(phone_imgs[0], TAB10))
    save(PLAY / "tablet-10" / "tablet10-02.png", letterbox(phone_imgs[1], TAB10))

    listing = PLAY / "LISTING.txt"
    listing.write_text(
        """Google Play graphic assets

Required
• Hi-res icon 512×512 → play/icon-512.png
• Feature graphic 1024×500 → play/feature.png
• Phone screenshots 1080×1920 (real device captures, cropped to ≤2:1)
  - phone-01.png  Home
  - phone-02.png  Gameplay (level 18)
  - phone-03.png  Level select
  - phone-04.png  Early gameplay

Optional
• 7-inch tablet 1200×1920 → play/tablet-7/
• 10-inch tablet 1920×1200 → play/tablet-10/

Raw captures (1080×2640 Flip3) kept in play/raw/

Rebuild store crops from raw:
  python3 scripts/process-play-screenshots.py
""",
        encoding="utf-8",
    )
    print("done")


if __name__ == "__main__":
    main()

"""Create the small, deliberately light-subject BR-001 fixture and its GT mask."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


CASE_DIR = Path(__file__).resolve().parents[1] / "cases" / "BR-001"
SIZE = (512, 512)


def draw_doctor(canvas: Image.Image, *, fill: str) -> None:
    """Draw one stable cartoon silhouette; fill differs for source versus binary GT."""
    draw = ImageDraw.Draw(canvas)
    # Coat, sleeves, legs, head and stethoscope: the white coat is intentionally
    # close to the light-grey background but bounded by coloured details.
    draw.rounded_rectangle((171, 230, 341, 408), radius=24, fill=fill, outline="#506070", width=8)
    draw.rounded_rectangle((112, 244, 195, 357), radius=28, fill=fill, outline="#506070", width=8)
    draw.rounded_rectangle((317, 244, 400, 357), radius=28, fill=fill, outline="#506070", width=8)
    draw.ellipse((123, 324, 169, 370), fill="#ffd2b2", outline="#506070", width=6)
    draw.ellipse((343, 324, 389, 370), fill="#ffd2b2", outline="#506070", width=6)
    draw.rounded_rectangle((193, 392, 242, 455), radius=10, fill="#65758a", outline="#506070", width=6)
    draw.rounded_rectangle((271, 392, 320, 455), radius=10, fill="#65758a", outline="#506070", width=6)
    draw.ellipse((188, 101, 324, 239), fill="#ffd2b2", outline="#506070", width=8)
    draw.arc((196, 111, 316, 215), 180, 360, fill="#4a5868", width=22)
    draw.polygon([(180, 145), (254, 83), (330, 145)], fill="#ffffff", outline="#506070")
    draw.ellipse((222, 158, 236, 174), fill="#2d3748")
    draw.ellipse((276, 158, 290, 174), fill="#2d3748")
    draw.arc((235, 173, 277, 205), 0, 180, fill="#d96565", width=6)
    draw.line((202, 270, 254, 326, 310, 270), fill="#3f697c", width=7, joint="curve")
    draw.ellipse((242, 316, 270, 344), outline="#3f697c", width=7)
    draw.line((210, 288, 210, 375), fill="#e06060", width=7)
    draw.line((298, 288, 298, 375), fill="#e06060", width=7)


def main() -> None:
    CASE_DIR.mkdir(parents=True, exist_ok=True)
    source = Image.new("RGBA", SIZE, "#d8dadd")
    draw_doctor(source, fill="#f8f8f4")
    source.save(CASE_DIR / "source.png")

    mask = Image.new("L", SIZE, 0)
    # The mask must be drawn separately without coloured details/outline gaps.
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((171, 230, 341, 408), radius=24, fill=255)
    draw.rounded_rectangle((112, 244, 195, 357), radius=28, fill=255)
    draw.rounded_rectangle((317, 244, 400, 357), radius=28, fill=255)
    draw.ellipse((123, 324, 169, 370), fill=255)
    draw.ellipse((343, 324, 389, 370), fill=255)
    draw.rounded_rectangle((193, 392, 242, 455), radius=10, fill=255)
    draw.rounded_rectangle((271, 392, 320, 455), radius=10, fill=255)
    draw.ellipse((188, 101, 324, 239), fill=255)
    draw.polygon([(180, 145), (254, 83), (330, 145)], fill=255)
    draw.line((202, 270, 254, 326, 310, 270), fill=255, width=10, joint="curve")
    draw.ellipse((238, 312, 274, 348), fill=255)
    mask.save(CASE_DIR / "ground_truth.png")


if __name__ == "__main__":
    main()

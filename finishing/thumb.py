"""Downscaled JPEG copy of an image (scene check input and page previews).

    python3 thumb.py <in> <out.jpg> [max_side]
"""
import sys

from PIL import Image


def main(argv):
    src, out = argv[1], argv[2]
    side = int(argv[3]) if len(argv) > 3 else 1536
    with Image.open(src) as im:
        im = im.convert("RGB")
        im.thumbnail((side, side), Image.LANCZOS)
        im.save(out, "JPEG", quality=88, optimize=True)


if __name__ == "__main__":
    main(sys.argv)

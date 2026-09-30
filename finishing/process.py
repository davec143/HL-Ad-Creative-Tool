"""Finish one raw render into a delivery file.

    python3 process.py <render> <out.jpg> <W> <H> '<spec json>'

1. Crop: scale to cover W x H, then centre-crop. Same geometry as v16's
   `convert src -resize 'WxH^' -gravity center -extent WxH` (ImageMagick), done in Pillow.
2. Finish: run finish.py (v16, unchanged) on the exact-size image. It locks the brand field
   colour and the CTA gold, checks the logo zone, composites the real logo on the Logo Grid,
   writes the JPEG (<= 460 KB) and prints a one-line report ending in "| FLAGS ..." if any.

Prints the finish.py report on stdout. Exits non-zero on any error.
"""
import os
import runpy
import sys
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))


def cover_crop(im, W, H):
    """ImageMagick 'WxH^' + gravity centre extent, in Pillow."""
    im = im.convert("RGB")
    w, h = im.size
    scale = max(W / w, H / h)
    nw, nh = max(W, int(scale * w + 0.5)), max(H, int(scale * h + 0.5))
    if (nw, nh) != (w, h):
        im = im.resize((nw, nh), Image.LANCZOS)
    x, y = (nw - W) // 2, (nh - H) // 2
    return im.crop((x, y, x + W, y + H))


def main(argv):
    if len(argv) != 6:
        sys.exit("usage: process.py <render> <out.jpg> <W> <H> '<spec json>'")
    src, out, W, H, spec = argv[1], argv[2], int(argv[3]), int(argv[4]), argv[5]
    with Image.open(src) as im:
        exact = cover_crop(im, W, H)
    fd, tmp = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        exact.save(tmp, "PNG")
        saved = sys.argv
        sys.argv = [os.path.join(HERE, "finish.py"), tmp, out, spec]
        try:
            runpy.run_path(os.path.join(HERE, "finish.py"), run_name="__main__")
        finally:
            sys.argv = saved
    finally:
        os.unlink(tmp)


if __name__ == "__main__":
    main(sys.argv)

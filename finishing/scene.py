"""Remove only near-white padding connected to the outside of a scene photo.

Keep the original render. Never repaint or stretch the photo, and leave interior
panels, lettering and other defects for the scene quality gate to reject.
"""
import json
import sys

import numpy as np
from PIL import Image, ImageOps

ALGO = 1


def prepare(im):
    im = ImageOps.exif_transpose(im).convert("RGB")
    rgb = np.asarray(im)
    h, w = rgb.shape[:2]
    white = (rgb.min(axis=2) >= 245)
    rows = white.mean(axis=1) >= 0.995
    cols = white.mean(axis=0) >= 0.995

    def edge_count(values):
        hits = np.flatnonzero(~values)
        return int(hits[0]) if len(hits) else len(values)

    left, right = edge_count(cols), edge_count(cols[::-1])
    top, bottom = edge_count(rows), edge_count(rows[::-1])
    # An almost empty image or an implausibly large border needs human review.
    # Do not turn a white room into an arbitrary crop.
    if (left + right > w * 0.4 or top + bottom > h * 0.4
            or w - left - right < 256 or h - top - bottom < 256):
        left = right = top = bottom = 0
    box = (left, top, w - right, h - bottom)
    return im.crop(box), {
        "ok": True, "algo": ALGO, "cropped": bool(left or right or top or bottom),
        "box": list(box), "original": [w, h], "width": box[2] - left, "height": box[3] - top,
    }


def main(argv):
    if len(argv) != 3:
        sys.exit("usage: scene.py <original> <prepared.png>")
    with Image.open(argv[1]) as im:
        im.load()
        out, result = prepare(im)
    out.save(argv[2], "PNG")
    print("RESULT " + json.dumps(result))


if __name__ == "__main__":
    main(sys.argv)

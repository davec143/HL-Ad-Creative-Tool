"""Remove only near-white padding connected to the outside of a scene photo.

Keep the original render. Never repaint or stretch the photo, and leave interior
panels, lettering and other defects for the scene quality gate to reject.
"""
import json
import sys

import numpy as np
from PIL import Image, ImageOps

ALGO = 2


def narrow_frame(rgb, known_frame=False):
    """Detect a tiny compressed white frame, without trimming broad pale walls.

    JPEG ringing can turn a two-pixel white frame pink/yellow and leave one
    grey antialias pixel next to it. Only accept an outside-connected near-white
    run of at most four pixels, then at most one brighter fringe pixel. A grey
    companion edge is removed only when a white edge established the frame.
    """
    h, w = rgb.shape[:2]
    limit = min(4, int(min(h, w) * 0.005))
    if limit < 1:
        return (0, 0, 0, 0)
    sides = [rgb.transpose(1, 0, 2), rgb, rgb[:, ::-1].transpose(1, 0, 2), rgb[::-1]]
    counts = []
    for side in sides:
        pale = (side[:limit + 1].min(axis=2) >= 225).mean(axis=1) >= 0.99
        stop = np.flatnonzero(~pale)
        n = int(stop[0]) if len(stop) else limit + 1
        if not 0 < n <= limit:
            counts.append(0)
            continue
        # An antialias fringe is consistently brighter than the actual photo.
        delta = side[n].astype(np.int16) - side[n + 1].astype(np.int16)
        if (delta.min(axis=1) > 8).mean() >= 0.99:
            n += 1
        counts.append(n)
    if known_frame or any(counts):
        for i, side in enumerate(sides):
            if counts[i]:
                continue
            outer = side[0].astype(np.int16)
            delta = outer - side[1].astype(np.int16)
            neutral = outer.max(axis=1) - outer.min(axis=1) <= 16
            if (neutral & (delta.min(axis=1) > 35)).mean() >= 0.99:
                counts[i] = 1
    return tuple(counts)


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
    else:
        remaining = rgb[top:h - bottom, left:w - right]
        dl, dt, dr, db = narrow_frame(remaining, known_frame=bool(left or right or top or bottom))
        if w - left - right - dl - dr >= 256 and h - top - bottom - dt - db >= 256:
            left += dl
            top += dt
            right += dr
            bottom += db
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

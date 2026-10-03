"""Product cutout: remove the background from the product photo, once per photo.

    python3 cutout.py <photo> <out.png> [model.onnx]

The product is never redrawn: the cutout keeps the photo's own pixels and only adds transparency.
A photo that already has real transparency (a supplied cutout PNG) is used as is. Otherwise the
background is removed with IS-Net (isnet-general-use, ONNX, CPU) using rembg's pre/post-processing.

The model can be unsure about parts of the product (a light panel, a band at the edge) and make
them half-transparent, so the backdrop would show through the product in the ad. On a plain
studio backdrop, refine() keeps the product's own pixels solid wherever the model hesitated:
  - a half-transparent pixel whose colour clearly differs from the backdrop becomes solid;
  - a gap enclosed by the product is solid if it's product-coloured, and stays transparent if it's
    the backdrop showing through (a real hole, e.g. the centre of a strip reel).
Background the model removed with confidence (alpha ~0, e.g. soft shadows) is never brought back.

The result is trimmed to the product (plus a small margin) and sanity-checked. It is not trusted
blindly: the app shows it to a person once per product photo, and sets made with an unapproved
cutout are held until it is approved (or replaced with an uploaded PNG).

stdout: "RESULT " + JSON {"ok", "width", "height", "coverage", "source", "error"}
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

MODEL_DEFAULT = os.environ.get("CUTOUT_MODEL", "/opt/models/isnet-general-use.onnx")
SIZE = 1024
MIN_COVER, MAX_COVER = 0.02, 0.97  # share of the frame the product may plausibly fill
PAD = 0.03
ALGO = 2  # bump when the cutout method changes: unapproved automatic cutouts are redone


def existing_alpha(im):
    """A supplied PNG with real transparency: return its alpha, else None."""
    if im.mode not in ("RGBA", "LA") and not (im.mode == "P" and "transparency" in im.info):
        return None
    a = np.asarray(im.convert("RGBA"))[:, :, 3]
    return a if (a < 250).mean() > 0.02 else None


def predict(im, model):
    import onnxruntime as ort  # imported here so a supplied cutout needs no model
    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    x = np.asarray(im.convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)).astype(np.float32)
    x = x / max(float(x.max()), 1e-6)
    x = (x - 0.5) / 1.0
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    out = sess.run(None, {sess.get_inputs()[0].name: x})[0][:, 0, :, :]
    lo, hi = float(out.min()), float(out.max())
    pred = (out - lo) / max(hi - lo, 1e-6)
    m = Image.fromarray((np.squeeze(pred) * 255).astype(np.uint8)).resize(im.size, Image.LANCZOS)
    return np.asarray(m)


def backdrop(rgb):
    """Median colour and spread of a thin border strip, or None if the backdrop isn't plain."""
    h, w, _ = rgb.shape
    b = max(2, int(round(min(h, w) * 0.01)))
    strip = np.concatenate([rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3), rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)]).astype(np.float32)
    med = np.median(strip, axis=0)
    spread = float(np.median(np.abs(strip - med).max(axis=1)))
    return (med, spread) if spread <= 12 else None


def enclosed(mask):
    """Pixels of `mask` (True = see-through) not connected to the image border through mask."""
    h, w = mask.shape
    m = Image.new("L", (w + 2, h + 2), 255)                       # padded: the border is see-through
    m.paste(Image.fromarray(np.where(mask, 255, 0).astype(np.uint8)), (1, 1))
    ImageDraw.floodfill(m, (0, 0), 128)                           # everything reachable from outside
    return np.asarray(m)[1:-1, 1:-1] == 255


def refine(rgb, alpha):
    """Keep the product solid where the model hesitated (see the module docstring)."""
    bd = backdrop(rgb)
    if bd is None:
        return alpha, 0.0
    med, spread = bd
    dist = np.abs(rgb.astype(np.float32) - med).max(axis=2)
    t = max(10.0, 4.0 * spread)
    colored = np.clip((dist - t) / 6.0, 0.0, 1.0)                 # 0 = backdrop colour, 1 = clearly not
    a = alpha.astype(np.float32) / 255.0
    unsure = (a > 0.03) & (a < 0.995)
    holes = enclosed(a < 0.5)
    boost = np.where(unsure | holes, colored, 0.0)
    out = np.maximum(a, boost)
    gained = float(((out - a) > 0.25).mean())
    return (out * 255 + 0.5).astype(np.uint8), gained


def clean(alpha):
    """Choke the soft edge slightly (keeps a white photo background from haloing on dark grounds)."""
    a = alpha.astype(np.float32) / 255.0
    a = np.clip((a - 0.08) / 0.84, 0.0, 1.0)
    return (a * 255 + 0.5).astype(np.uint8)


def main(argv):
    if len(argv) not in (3, 4):
        sys.exit("usage: cutout.py <photo> <out.png> [model.onnx]")
    src, out = argv[1], argv[2]
    model = argv[3] if len(argv) == 4 else MODEL_DEFAULT
    res = {"ok": False, "width": None, "height": None, "coverage": None, "source": None, "error": None, "algo": ALGO}
    with Image.open(src) as im:
        im.load()
        alpha = existing_alpha(im)
        if alpha is not None:
            res["source"] = "supplied"
        else:
            if not os.path.exists(model):
                res["error"] = "the background-removal model isn't installed"
                print("RESULT " + json.dumps(res))
                return
            alpha, gained = refine(np.asarray(im.convert("RGB")), clean(predict(im, model)))
            res["source"] = "model"
            res["refined"] = round(gained, 4)
        rgb = np.asarray(im.convert("RGB"))
    solid = alpha > 127
    cover = float(solid.mean())
    res["coverage"] = round(cover, 4)
    if cover < MIN_COVER or cover > MAX_COVER:
        res["error"] = "couldn't separate the product from its background (it fills %d%% of the photo)" % round(cover * 100)
        print("RESULT " + json.dumps(res))
        return
    ys, xs = np.where(alpha > 8)
    h, w = alpha.shape
    pad = int(round(PAD * max(h, w)))
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + 1 + pad)
    rgba = np.dstack([rgb, alpha])[y0:y1, x0:x1]
    Image.fromarray(rgba, "RGBA").save(out, "PNG", optimize=True)
    res.update(ok=True, width=int(x1 - x0), height=int(y1 - y0))
    print("RESULT " + json.dumps(res))


if __name__ == "__main__":
    main(sys.argv)

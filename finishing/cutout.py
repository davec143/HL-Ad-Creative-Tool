"""Product cutout: remove the background from the product photo, once per photo.

    python3 cutout.py <photo> <out.png> [model.onnx]

The product is never redrawn: the cutout keeps the photo's own pixels and only adds transparency.
A photo that already has real transparency (a supplied cutout PNG) is used as is. Otherwise the
background is removed with IS-Net (isnet-general-use, ONNX, CPU) using rembg's pre/post-processing.

The result is trimmed to the product (plus a small margin) and sanity-checked. It is not trusted
blindly: the app shows it to a person once per product photo, and sets made with an unapproved
cutout are held until it is approved (or replaced with an uploaded PNG).

stdout: "RESULT " + JSON {"ok", "width", "height", "coverage", "source", "error"}
"""
import json
import os
import sys

import numpy as np
from PIL import Image

MODEL_DEFAULT = os.environ.get("CUTOUT_MODEL", "/opt/models/isnet-general-use.onnx")
SIZE = 1024
MIN_COVER, MAX_COVER = 0.02, 0.97  # share of the frame the product may plausibly fill
PAD = 0.03


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
    res = {"ok": False, "width": None, "height": None, "coverage": None, "source": None, "error": None}
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
            alpha = clean(predict(im, model))
            res["source"] = "model"
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

"""Product cutout: remove the background from the product photo, once per photo.

    python3 cutout.py <photo> <out.png> [model.onnx]

The product is never redrawn: the cutout keeps the photo's own pixels and only adds transparency.
A photo that already has real transparency (a supplied cutout PNG) is used as is. Otherwise the
background is removed with IS-Net (isnet-general-use, ONNX, CPU) using rembg's pre/post-processing.

The model can mistake white printing and pictures on packaging for background. On a bright,
plain studio backdrop, refinement follows the outside-connected photo background and keeps
large, damaged printed product regions opaque. Neutral hardware is handled separately so its
white body stays solid and compact mounting holes remain open. Model support and colour extent
exclude pale floor reflections. Busy/non-white backgrounds keep the conservative model path.
Only the alpha channel changes. This is still a reviewed cutout, not a guarantee of segmentation
for every possible photograph: exact-white objects without visible boundaries remain ambiguous.

The result is trimmed to the product (plus a small margin) and sanity-checked. It is not trusted
blindly: the app shows it to a person once per product photo, and sets made with an unapproved
cutout are held until it is approved (or replaced with an uploaded PNG).

stdout: "RESULT " + JSON {"ok", "width", "height", "coverage", "source", "error"}
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

MODEL_DEFAULT = os.environ.get("CUTOUT_MODEL", "/opt/models/isnet-general-use.onnx")
SIZE = 1024
MIN_COVER, MAX_COVER = 0.02, 0.97  # share of the frame the product may plausibly fill
PAD = 0.03
ALGO = 3  # bump when the cutout method changes: unapproved automatic cutouts are redone


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


def components(mask):
    h, w = mask.shape
    work = mask.copy()
    result = []
    for y, x in zip(*np.where(work)):
        if not work[y, x]:
            continue
        work[y, x] = False
        stack, pixels = [(y, x)], []
        while stack:
            j, i = stack.pop()
            pixels.append((i, j))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = j + dy, i + dx
                if 0 <= yy < h and 0 <= xx < w and work[yy, xx]:
                    work[yy, xx] = False
                    stack.append((yy, xx))
        result.append(np.array(pixels))
    return sorted(result, key=len, reverse=True)


def studio_repair(rgb, alpha, base):
    bd = backdrop(rgb)
    if bd is None:
        return base
    med, spread = bd
    if med.min() < 240 or med.max() - med.min() > 8 or spread > 4:
        return base
    h, w = alpha.shape
    near = np.abs(rgb.astype(float) - med).max(2) <= max(8, spread * 2)
    border = np.concatenate([near[0], near[-1], near[:, 0], near[:, -1]])
    if border.mean() < .60:
        return base
    retained = ~near | enclosed(near)
    scaled = lambda v: np.asarray(Image.fromarray(v.astype(np.uint8)).resize((512, 512), Image.Resampling.NEAREST))
    small = scaled(retained * 255) > 127
    chroma = rgb.max(2).astype(int) - rgb.min(2).astype(int)
    out = base.copy()
    for pixels in components(small):
        if len(pixels) < 100:
            continue
        mask = np.zeros((512, 512), np.uint8)
        mask[pixels[:, 1], pixels[:, 0]] = 255
        comp = np.asarray(Image.fromarray(mask).resize((w, h), Image.Resampling.NEAREST).filter(ImageFilter.MaxFilter(11))) > 0
        comp &= retained
        colorful = np.mean(chroma[comp] > 64) >= .05
        if colorful:
            # Broad missing regions indicate package artwork rejection; leave ordinary holes alone.
            if np.mean(alpha[comp] < 32) < .20:
                continue
            ys, xs = np.where(comp)
            y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
            keep = comp.copy()
            lows = np.full(w, np.nan)
            for x in range(x0, x1 + 1):
                yy = np.where(comp[:, x] & (chroma[:, x] > 64))[0]
                if len(yy):
                    lows[x] = yy.max()
            support = np.where(~np.isnan(lows))[0]
            if len(support) > (x1 - x0) * .7:
                floor = np.interp(np.arange(w), support, lows[support])
                if np.median(floor[x0:x1 + 1]) > y0 + .65 * (y1 - y0):
                    shadow = (np.arange(h)[:, None] > floor[None, :] + 3) & (rgb.min(2) > 160) & (chroma < 64) & (alpha < 220)
                    # Broad fading reflections only; a small silver connector below
                    # the package's coloured edge is still part of the product.
                    if (comp & shadow).sum() > comp.sum() * .01:
                        keep &= ~shadow
                        out[comp & shadow] = 0
            out[keep] = 255
        else:
            # Solid neutral hardware: keep its white body, use model support to exclude reflections.
            for x in range(w):
                yy = np.where(comp[:, x] & (alpha[:, x] > 240))[0]
                if len(yy):
                    support = comp[:, x] & (np.arange(h) <= yy.max() + 2) & (np.arange(h) >= yy.min() - 2)
                    out[support, x] = 255
            for hole in components(scaled(near & comp) > 0):
                wh = hole.max(0) - hole.min(0) + 1
                # Only compact openings with a dark rim; elongated seams/embossed letters are solid.
                if len(hole) < 26 or len(hole) > len(pixels) * .02 or wh.min() / wh.max() < .25:
                    continue
                hm = np.zeros((512, 512), np.uint8)
                hm[hole[:, 1], hole[:, 0]] = 255
                hm = np.asarray(Image.fromarray(hm).resize((w, h), Image.Resampling.NEAREST).filter(ImageFilter.MaxFilter(7))) > 0
                rim = hm & ~near & comp
                if rim.sum() and np.median(rgb[rim].min(1)) < 220:
                    out[hm & near & comp] = 0
    # Colour alone cannot distinguish a white object edge from its white backdrop.
    # Preserve confident model foreground when the photographic boundary is ambiguous.
    out[~retained & (alpha < 220)] = 0
    return out


def refine(rgb, alpha):
    """Restore product opacity and studio packaging without changing source RGB."""
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
    repaired = studio_repair(rgb, alpha, (out * 255 + 0.5).astype(np.uint8))
    gained = float(((repaired.astype(float) - alpha) > 64).mean())
    return repaired, gained


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
    res.update(ok=True, width=int(x1 - x0), height=int(y1 - y0), crop=[int(x0), int(y0), int(x1), int(y1)])
    print("RESULT " + json.dumps(res))


if __name__ == "__main__":
    main(sys.argv)

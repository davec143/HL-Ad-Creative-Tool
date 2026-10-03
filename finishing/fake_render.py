"""Synthetic renders in the style of each template, at the real Higgsfield 2K sizes.

Used by the finishing tests and by the "fake" renderer (RENDERER=fake), so the whole app can be
run and tested without spending Higgsfield credits.

    python3 fake_render.py <tpl> <kind> <out.png> [fault] [zone-json]
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw

RENDER = {"master": (2048, 2048), "portrait": (1536, 2752), "landscape": (2752, 1536)}
SCENE = (2048, 2048)  # composed templates: the scene photograph only


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def smooth_photo(W, H, top, bottom, seed=1):
    """A calm, low-detail 'photograph': vertical gradient + very soft noise."""
    rng = np.random.default_rng(seed)
    t = np.linspace(0, 1, H)[:, None, None]
    a, b = np.array(top, np.float32), np.array(bottom, np.float32)
    img = a + (b - a) * t + rng.normal(0, 1.2, (H, W, 3))
    return Image.fromarray(np.clip(np.broadcast_to(img, (H, W, 3)), 0, 255).astype(np.uint8))


def pill(d, cx, cy, w, h, fill=(235, 168, 0), text=True):
    d.rounded_rectangle((cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2), radius=h // 2, fill=fill)
    if text:  # dark lettering strokes, as the CTA text would be
        for i in range(6):
            x0 = cx - w // 3 + i * w // 9
            d.rectangle((x0, cy - h // 6, x0 + w // 22, cy + h // 6), fill=(35, 35, 35))


def render(tpl, kind, fault=None, zone=None):
    """Draw a render in the style of the template, in RENDER frame coordinates."""
    W, H = SCENE if kind == "scene" else RENDER[kind]
    s = min(W, H) / 1080.0
    if kind == "scene":  # a scene photograph only (composed templates): warm interior, cove glow
        im = smooth_photo(W, H, (58, 50, 44), (128, 112, 96), seed=7)
        d = ImageDraw.Draw(im)
        d.rectangle((0, int(H * .30), W, int(H * .31)), fill=(255, 214, 150))
        d.rectangle((int(W * .1), int(H * .62), int(W * .9), int(H * .66)), fill=(92, 78, 66))
        if fault == "scenetext":  # lettering the scene must not contain
            for i in range(int(W * .3), int(W * .7), int(24 * s)):
                d.rectangle((i, int(H * .45), i + int(10 * s), int(H * .5)), fill=(250, 250, 250))
        return im
    if tpl == "t1":
        im = Image.new("RGB", (W, H), (86, 58, 122))  # violet drifted a few shades from #523875
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((int(W * .45), int(H * .35), int(W * .95), int(H * .75)), radius=int(30 * s), fill=(120, 110, 100))
        pill(d, W // 2, int(H * .88), int(360 * s), int(90 * s))
    elif tpl == "t2":
        im = smooth_photo(W, H, (150, 165, 180), (95, 105, 120))
        d = ImageDraw.Draw(im)
        if kind == "landscape":
            box = (int(W * .04), int(H * .10), int(W * .52), int(H * .80))
        else:
            top = .14 if kind == "portrait" else .04
            if fault == "high":
                top = .02
            box = (int(W * .06), int(H * top), int(W * .94), int(H * (top + (.40 if kind == "master" else .30))))
        d.rounded_rectangle(box, radius=int(40 * s), fill=(255, 255, 255))
        cx = (box[0] + box[2]) // 2
        pill(d, cx, box[3] - int(80 * s), int(300 * s), int(80 * s))
    elif tpl == "t3":
        im = smooth_photo(W, H, hexrgb("241A30"), hexrgb("120C18"))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((int(W * .06), int(H * .82), int(W * .06) + int(300 * s), int(H * .82) + int(80 * s)), radius=int(12 * s), fill=(235, 168, 0))
        for i in range(5):
            x0 = int(W * .06) + int(40 * s) + i * int(45 * s)
            d.rectangle((x0, int(H * .82) + int(28 * s), x0 + int(15 * s), int(H * .82) + int(52 * s)), fill=(35, 35, 35))
    elif tpl == "t4":
        im = Image.new("RGB", (W, H), (248, 243, 232))  # cream drifted from #FBF6EE
        photo = smooth_photo(W, int(H * .6) if kind != "landscape" else H, (70, 60, 55), (140, 120, 100), seed=4)
        if kind == "landscape":
            photo = photo.crop((0, 0, int(W * .55), H))
        im.paste(photo, (0, 0))
        d = ImageDraw.Draw(im)
        px = int(W * .62) if kind == "landscape" else W // 2
        py = int(H * .82) if kind == "landscape" else int(H * .88)
        pill(d, px, py, int(300 * s), int(80 * s))
    elif tpl == "t5":
        im = smooth_photo(W, H, (40, 30, 24), (70, 50, 35), seed=5)
        d = ImageDraw.Draw(im)
        px = int(W * .75) if kind == "landscape" else W // 2
        pill(d, px, int(H * .45), int(340 * s), int(84 * s))
    else:
        raise ValueError(tpl)
    d = ImageDraw.Draw(im)
    if fault == "nocta":  # repaint every gold pixel grey
        a = np.asarray(im).copy()
        gold = (np.abs(a.astype(int) - [235, 168, 0]).sum(axis=2) < 60)
        a[gold] = (90, 90, 90)
        im = Image.fromarray(a)
        d = ImageDraw.Draw(im)
    if fault in ("collision", "placeholder"):
        z = zone  # logo zone, % of the render frame
        box = (int(W * z[0] / 100) + 10, int(H * z[1] / 100) + 10, int(W * z[2] / 100) - 10, int(H * z[3] / 100) - 10)
        if fault == "collision":
            for i in range(box[0], box[2], int(18 * s)):  # busy lettering-like strokes
                d.rectangle((i, box[1], i + int(8 * s), box[3]), fill=(255, 255, 255))
        else:
            d.rectangle(box, fill=(236, 234, 230))  # blank, flat, pale patch
    return im


if __name__ == "__main__":
    a = sys.argv[1:]
    fault = a[3] if len(a) > 3 and a[3] != "-" else None
    zone = json.loads(a[4]) if len(a) > 4 else None
    render(a[0], a[1], fault, zone).save(a[2])

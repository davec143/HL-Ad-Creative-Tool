"""Finishing tests: crop geometry, Logo Grid placement, colour locks and flags.

Synthetic renders are drawn at the real Higgsfield 2K sizes (2048x2048, 1536x2752, 2752x1536)
to look like each template, then finished through finishing/process.py exactly as the server
runs it (a subprocess). Expected positions come from core/brand.mjs via node, so the test and
the app can never disagree about the grid.
"""
import json
import os
import subprocess
import sys

import numpy as np
import pytest
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROCESS = os.path.join(ROOT, "finishing", "process.py")
RENDER = {"master": (2048, 2048), "portrait": (1536, 2752), "landscape": (2752, 1536)}


def _specs():
    js = ("import('./core/engine.mjs').then(E=>import('./core/brand.mjs').then(B=>{const o={};"
          "for(const t of B.TPL_ORDER){o[t]={};for(const k of B.KINDS){const g=E.gridSpec(t,k);"
          "o[t][k]={grid:g,finish:E.finishSpec(g),W:B.CANVAS[k].W,H:B.CANVAS[k].H};}}"
          "process.stdout.write(JSON.stringify(o));}))")
    return json.loads(subprocess.check_output(["node", "-e", js], cwd=ROOT))


SPECS = _specs()


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


def render(tpl, kind, fault=None):
    """Draw a render in the style of the template, in RENDER frame coordinates."""
    W, H = RENDER[kind]
    s = min(W, H) / 1080.0
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
        g = SPECS[tpl][kind]["grid"]
        z = g["zone"]  # % of the render frame
        box = (int(W * z[0] / 100) + 10, int(H * z[1] / 100) + 10, int(W * z[2] / 100) - 10, int(H * z[3] / 100) - 10)
        if fault == "collision":
            for i in range(box[0], box[2], int(18 * s)):  # busy lettering-like strokes
                d.rectangle((i, box[1], i + int(8 * s), box[3]), fill=(255, 255, 255))
        else:
            d.rectangle(box, fill=(236, 234, 230))  # blank, flat, pale patch
    return im


def finish(tmp_path, tpl, kind, fault=None, spec_override=None):
    src = tmp_path / ("%s-%s-%s.png" % (tpl, kind, fault or "clean"))
    out = tmp_path / ("%s-%s-%s.jpg" % (tpl, kind, fault or "clean"))
    render(tpl, kind, fault).save(src)
    S = SPECS[tpl][kind]
    spec = dict(S["finish"], **(spec_override or {}))
    r = subprocess.run([sys.executable, PROCESS, str(src), str(out), str(S["W"]), str(S["H"]), json.dumps(spec)],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    report = r.stdout.strip()
    flags = report.split("| FLAGS ", 1)[1].split() if "| FLAGS " in report else []
    return out, report, flags, S


ALL = [(t, k) for t in SPECS for k in RENDER]


@pytest.mark.parametrize("tpl,kind", ALL)
def test_clean_render_exact_size_logo_on_grid(tmp_path, tpl, kind):
    out, report, flags, S = finish(tmp_path, tpl, kind)
    im = Image.open(out)
    assert im.size == (S["W"], S["H"])
    assert im.format == "JPEG"
    assert os.path.getsize(out) <= 460000
    g = S["grid"]
    colour = g["colour"]
    blocking = {"COLLISION", "PLACEHOLDER", "SAFEZONE", "NOCTA", "CTACOLOR"}
    assert not (set(flags) & blocking), report
    assert "CONTRAST" not in flags, report
    if g["ground"] == "bubble":
        # T2: centred in the bubble the generator drew, colourway black (template library).
        assert "BUBBLE?" not in flags, report
        assert report.startswith("black logo at ("), report
    else:
        assert report.startswith("%s logo at (%d,%d) w%d" % (colour, g["x"], g["y"], g["w"])), report
    # The logo pixels really are there: sample the lockup's own alpha at its grid position.
    x, y = [int(v) for v in report.split("logo at (")[1].split(")")[0].split(",")]
    lw = int(report.split(") w")[1].split()[0])
    logo = Image.open(os.path.join(ROOT, "finishing", "logo-%s.png" % colour)).convert("RGBA")
    lh = round(lw * logo.height / logo.width)
    alpha = np.asarray(logo.resize((lw, lh), Image.LANCZOS))[..., 3] > 220
    region = np.asarray(im.convert("L"), dtype=np.float32)[y:y + lh, x:x + lw]
    ink = region[alpha].mean()
    if colour == "white":
        assert ink > 200, "white logo not found at (%d,%d): mean %.0f" % (x, y, ink)
    else:
        assert ink < 70, "black logo not found at (%d,%d): mean %.0f" % (x, y, ink)


@pytest.mark.parametrize("kind", list(RENDER))
def test_brand_field_locked_t1_violet(tmp_path, kind):
    out, report, flags, S = finish(tmp_path, "t1", kind)
    assert "field #" in report and "->#523875" in report, report
    a = np.asarray(Image.open(out).convert("RGB"), dtype=np.float32)
    corner = a[S["H"] - 40:S["H"] - 10, S["W"] - 40:S["W"] - 10].reshape(-1, 3).mean(axis=0)
    assert np.abs(corner - hexrgb("523875")).max() < 6, corner


def test_brand_field_locked_t4_cream(tmp_path):
    out, report, flags, S = finish(tmp_path, "t4", "master")
    assert "->#FBF6EE" in report, report


@pytest.mark.parametrize("tpl", list(SPECS))
def test_cta_pulled_to_brand_gold(tmp_path, tpl):
    out, report, flags, S = finish(tmp_path, tpl, "master")
    assert "->#EBA800" in report, report


@pytest.mark.parametrize("tpl,kind", [("t1", "master"), ("t3", "portrait"), ("t1", "landscape")])
def test_collision_flagged(tmp_path, tpl, kind):
    _, report, flags, _ = finish(tmp_path, tpl, kind, "collision")
    assert "COLLISION" in flags, report


@pytest.mark.parametrize("tpl,kind", [("t4", "master"), ("t5", "portrait"), ("t5", "landscape")])
def test_placeholder_patch_flagged_on_photo(tmp_path, tpl, kind):
    _, report, flags, _ = finish(tmp_path, tpl, kind, "placeholder")
    assert "PLACEHOLDER" in flags, report


@pytest.mark.parametrize("tpl", ["t1", "t4", "t5"])
def test_missing_cta_flagged(tmp_path, tpl):
    _, report, flags, _ = finish(tmp_path, tpl, "master", "nocta")
    assert "NOCTA" in flags, report


def test_t2_bubble_too_high_on_portrait_is_safezone(tmp_path):
    _, report, flags, _ = finish(tmp_path, "t2", "portrait", "high")
    assert "SAFEZONE" in flags, report


def test_crop_geometry_matches_imagemagick_cover():
    sys.path.insert(0, os.path.join(ROOT, "finishing"))
    from process import cover_crop
    # 16:9 2K -> 1200x628 scales to 1200x670 and trims 21 px top and bottom.
    im = Image.new("RGB", (2752, 1536))
    ImageDraw.Draw(im).rectangle((0, 0, 2751, 47), fill=(255, 0, 0))  # red band, 48 px -> ~21 px
    out = cover_crop(im, 1200, 628)
    assert out.size == (1200, 628)
    assert np.asarray(out)[0, 600, 0] < 200  # the band's top ~21px were trimmed away
    for (w, h), (W, H) in [((2048, 2048), (1080, 1080)), ((1536, 2752), (1080, 1920)), ((2752, 1536), (1200, 628)), ((1000, 1000), (1080, 1920))]:
        assert cover_crop(Image.new("RGB", (w, h)), W, H).size == (W, H)

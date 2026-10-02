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

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "finishing"))
from fake_render import RENDER, hexrgb, render as _render  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROCESS = os.path.join(ROOT, "finishing", "process.py")


def _specs():
    js = ("import('./core/engine.mjs').then(E=>import('./core/brand.mjs').then(B=>{const o={};"
          "for(const t of B.TPL_ORDER){o[t]={};for(const k of B.KINDS){const g=E.gridSpec(t,k);"
          "o[t][k]={grid:g,finish:E.finishSpec(g),W:B.CANVAS[k].W,H:B.CANVAS[k].H};}}"
          "process.stdout.write(JSON.stringify(o));}))")
    return json.loads(subprocess.check_output(["node", "-e", js], cwd=ROOT))


SPECS = _specs()


def finish(tmp_path, tpl, kind, fault=None, spec_override=None):
    src = tmp_path / ("%s-%s-%s.png" % (tpl, kind, fault or "clean"))
    out = tmp_path / ("%s-%s-%s.jpg" % (tpl, kind, fault or "clean"))
    _render(tpl, kind, fault, SPECS[tpl][kind]["grid"]["zone"]).save(src)
    S = SPECS[tpl][kind]
    spec = dict(S["finish"], **(spec_override or {}))
    r = subprocess.run([sys.executable, PROCESS, str(src), str(out), str(S["W"]), str(S["H"]), json.dumps(spec)],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    report = r.stdout.strip().splitlines()[0]
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


# ---------- delivery contract: exact size, decodes, <= 460,000 bytes (Phase 3) ----------
import hashlib  # noqa: E402

MAX_BYTES = 460000
SPEC_PT = {"x": 64, "y": 288, "w": 320, "colour": "white", "shadow": False, "ground": "panel", "even": False, "field": "-", "safeTop": 269}


def run_process(tmp_path, img, W, H, spec):
    src, out = tmp_path / "in.png", tmp_path / "out.jpg"
    img.save(src)
    r = subprocess.run([sys.executable, PROCESS, str(src), str(out), str(W), str(H), json.dumps(spec)], capture_output=True, text=True, timeout=180)
    res = None
    for line in r.stdout.splitlines():
        if line.startswith("RESULT "):
            res = json.loads(line[7:])
    return r, res, out


def noise(W, H, amp, seed=3):
    rng = np.random.default_rng(seed)
    return Image.fromarray(np.clip(np.full((H, W, 3), 110, np.float32) + rng.normal(0, amp, (H, W, 3)), 0, 255).astype(np.uint8))


def test_finish_py_is_byte_identical_to_v16():
    a = open(os.path.join(ROOT, "finishing", "finish.py"), "rb").read()
    b = open(os.path.join(ROOT, "legacy", "v16", "source", "finish.py"), "rb").read()
    assert hashlib.sha256(a).hexdigest() == hashlib.sha256(b).hexdigest()
    assert hashlib.sha256(a).hexdigest() == open(os.path.join(ROOT, "finishing", "FINISH_PY_SHA256")).read().split()[0]


def test_detailed_image_over_the_limit_is_reencoded_under_it(tmp_path):
    r, res, out = run_process(tmp_path, noise(1080, 1920, 35), 1080, 1920, SPEC_PT)
    assert r.returncode == 0, r.stderr
    assert res["ok"] is True and res["reencoded"] is True and res["quality"] >= 40
    assert os.path.getsize(out) <= MAX_BYTES == 460000
    with Image.open(out) as im:
        assert im.size == (1080, 1920) and im.format == "JPEG" and im.mode == "RGB"
        im.load()


def test_high_entropy_image_fails_explicitly_instead_of_reporting_success(tmp_path):
    r, res, out = run_process(tmp_path, noise(1080, 1920, 90), 1080, 1920, SPEC_PT)
    assert r.returncode == 0
    if res["ok"]:
        assert os.path.getsize(out) <= MAX_BYTES
    else:
        assert "460000" in res["error"] and res["bytes"] > MAX_BYTES


@pytest.mark.parametrize("W,H", [(1080, 1080), (1080, 1920), (1200, 628)])
def test_every_target_size_stays_exact_and_decodes(tmp_path, W, H):
    spec = dict(SPEC_PT, safeTop=None) if (W, H) != (1080, 1920) else SPEC_PT
    spec = {k: v for k, v in spec.items() if v is not None}
    r, res, out = run_process(tmp_path, noise(W * 2, H * 2, 25), W, H, spec)
    assert res["ok"] is True, res
    assert (res["width"], res["height"]) == (W, H) and res["bytes"] <= MAX_BYTES
    with Image.open(out) as im:
        im.load()
        assert im.size == (W, H)


def test_corrupt_input_fails_cleanly(tmp_path):
    src, out = tmp_path / "bad.png", tmp_path / "out.jpg"
    src.write_bytes(b"\x89PNG\r\n\x1a\nthis is not an image")
    r = subprocess.run([sys.executable, PROCESS, str(src), str(out), "1080", "1080", json.dumps(SPEC_PT)], capture_output=True, text=True, timeout=60)
    assert r.returncode != 0
    assert not out.exists()
    assert "RESULT" not in r.stdout

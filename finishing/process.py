"""Finish one raw render into a delivery file.

    python3 process.py <render> <out.jpg> <W> <H> '<spec json>'

1. Crop: scale to cover W x H, then centre-crop. Same geometry as v16's
   `convert src -resize 'WxH^' -gravity center -extent WxH` (ImageMagick), done in Pillow.
2. Finish: run finish.py (v16, byte-identical, never edited) on the exact-size image. It locks the
   brand field colour and the CTA gold, checks the logo zone, composites the real logo on the Logo
   Grid, writes the JPEG and prints a one-line report ending in "| FLAGS ..." if any.
3. Enforce the delivery contract that finish.py doesn't: exact W x H, decodes cleanly, and
   <= MAX_BYTES. finish.py stops lowering quality at 62, so an over-size file is re-encoded from its
   own pixels at QUALITY_STEPS (never resized). If it still doesn't fit at MIN_QUALITY, the result
   is reported as not ok (the app holds it) instead of success.

stdout: line 1 = finish.py's report; line 2 = "RESULT " + JSON:
    {"ok", "width", "height", "bytes", "quality", "reencoded", "error"}
Exit code is non-zero only for crashes (bad input, finish.py failure).
"""
import contextlib
import io
import json
import os
import runpy
import sys
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_BYTES = 460000
QUALITY_STEPS = (60, 56, 52, 48, 44, 40)
MIN_QUALITY = QUALITY_STEPS[-1]


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


def check_jpeg(path, W, H):
    """Decode fully; return (ok, error)."""
    try:
        with Image.open(path) as im:
            im.verify()
        with Image.open(path) as im:
            if im.format != "JPEG":
                return False, "not a JPEG (%s)" % im.format
            im.load()
            if im.size != (W, H):
                return False, "wrong size %dx%d" % im.size
    except Exception as e:  # noqa: BLE001 - any decode failure is a failed output
        return False, "doesn't decode: %s" % e
    return True, None


def enforce_size(path, W, H):
    """Re-encode an over-size finished JPEG from its own pixels. Never changes dimensions."""
    with Image.open(path) as im:
        icc = im.info.get("icc_profile")
        rgb = im.convert("RGB")  # JPEG has no alpha; make sure nothing upstream added one
    if rgb.size != (W, H):
        return None
    tmp = path + ".tmp.jpg"
    for q in QUALITY_STEPS:
        kw = dict(quality=q, optimize=True, progressive=True, subsampling=2)
        if icc:
            kw["icc_profile"] = icc
        rgb.save(tmp, "JPEG", **kw)
        if os.path.getsize(tmp) <= MAX_BYTES:
            os.replace(tmp, path)
            return q
    os.unlink(tmp)
    return None


def main(argv):
    if len(argv) != 6:
        sys.exit("usage: process.py <render> <out.jpg> <W> <H> '<spec json>'")
    src, out, W, H, spec = argv[1], argv[2], int(argv[3]), int(argv[4]), argv[5]
    with Image.open(src) as im:
        exact = cover_crop(im, W, H)
    fd, tmp = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    buf = io.StringIO()
    try:
        exact.save(tmp, "PNG")
        saved = sys.argv
        sys.argv = [os.path.join(HERE, "finish.py"), tmp, out, spec]
        try:
            with contextlib.redirect_stdout(buf):
                runpy.run_path(os.path.join(HERE, "finish.py"), run_name="__main__")
        finally:
            sys.argv = saved
    finally:
        os.unlink(tmp)
    report = buf.getvalue().strip().splitlines()[-1] if buf.getvalue().strip() else ""

    result = {"ok": False, "width": None, "height": None, "bytes": None, "quality": None, "reencoded": False, "error": None}
    ok, err = check_jpeg(out, W, H)
    if ok and os.path.getsize(out) > MAX_BYTES:
        q = enforce_size(out, W, H)
        if q is None:
            ok, err = False, "can't get under %d bytes at quality %d or above (%d bytes)" % (MAX_BYTES, MIN_QUALITY, os.path.getsize(out))
        else:
            result["quality"], result["reencoded"] = q, True
            ok, err = check_jpeg(out, W, H)
    if os.path.exists(out):
        result["bytes"] = os.path.getsize(out)
        try:
            with Image.open(out) as im:
                result["width"], result["height"] = im.size
        except Exception:  # noqa: BLE001
            pass
    result["ok"], result["error"] = bool(ok), err
    print(report)
    print("RESULT " + json.dumps(result))


if __name__ == "__main__":
    main(sys.argv)

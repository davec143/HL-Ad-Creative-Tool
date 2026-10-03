"""Encode a composed ad (PNG from the browser) into the delivery JPEG.

    python3 encode.py <in.png> <out.jpg> <W> <H>

Composed ads carry small, sharp type, so they are encoded with full-resolution colour (4:4:4) at
high quality, stepping quality down only as far as needed to meet the delivery contract:
exact W x H, decodes cleanly, <= MAX_BYTES. If even the lowest step doesn't fit, it reports not ok.

stdout: "RESULT " + JSON {"ok", "width", "height", "bytes", "quality", "error"}
"""
import json
import os
import sys

from PIL import Image, ImageFile

from process import MAX_BYTES, check_jpeg

# (quality, chroma subsampling): full-resolution colour first (crisp small type), then the
# standard 4:2:0 as a fallback so a very detailed scene photo can still meet the size limit.
QUALITY_STEPS = tuple((q, 0) for q in (92, 90, 88, 86, 84, 82, 80, 77, 74, 70)) + tuple((q, 2) for q in (82, 76, 70, 65, 60))


def main(argv):
    if len(argv) != 5:
        sys.exit("usage: encode.py <in.png> <out.jpg> <W> <H>")
    src, out, W, H = argv[1], argv[2], int(argv[3]), int(argv[4])
    res = {"ok": False, "width": None, "height": None, "bytes": None, "quality": None, "error": None}
    with Image.open(src) as im:
        rgb = im.convert("RGB")
    if rgb.size != (W, H):
        res["error"] = "composed image is %dx%d, expected %dx%d" % (rgb.size + (W, H))
        print("RESULT " + json.dumps(res))
        return
    # Progressive + optimized encoding buffers the whole scan: give it room for a detailed photo.
    ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, W * H * 4)
    tmp = out + ".tmp.jpg"
    for q, sub in QUALITY_STEPS:
        rgb.save(tmp, "JPEG", quality=q, optimize=True, progressive=True, subsampling=sub)
        if os.path.getsize(tmp) <= MAX_BYTES:
            os.replace(tmp, out)
            res["quality"], res["subsampling"] = q, ("4:4:4" if sub == 0 else "4:2:0")
            break
    else:
        size = os.path.getsize(tmp)
        os.unlink(tmp)
        res["error"] = "can't get under %d bytes at quality %d or above (%d bytes)" % (MAX_BYTES, QUALITY_STEPS[-1][0], size)
        print("RESULT " + json.dumps(res))
        return
    ok, err = check_jpeg(out, W, H)
    res["bytes"] = os.path.getsize(out)
    res["width"], res["height"] = W, H
    res["ok"], res["error"] = ok, err
    print("RESULT " + json.dumps(res))


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main(sys.argv)

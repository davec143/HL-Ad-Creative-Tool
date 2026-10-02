"""Readiness check for the finishing toolchain: imports and a tiny end-to-end encode."""
import io

import numpy
from PIL import Image

im = Image.new("RGB", (8, 8), (82, 56, 117))
buf = io.BytesIO()
im.save(buf, "JPEG", quality=90)
assert Image.open(io.BytesIO(buf.getvalue())).size == (8, 8)
print("ok numpy %s pillow %s" % (numpy.__version__, Image.__version__))

import ast
import numpy as np
from PIL import Image
w = Image.open("src-white.png").convert("RGBA"); b = Image.open("src-black.png").convert("RGBA")
assert w.size == b.size and w.width > 1000, "unexpected lockup files"
w.save("logo-white.png"); b.save("logo-black.png")
a = np.asarray(b)[..., 3]; o = np.zeros(a.shape + (4,), np.uint8)
o[..., 0], o[..., 1], o[..., 2], o[..., 3] = 0x55, 0x42, 0x6A, a
Image.fromarray(o, "RGBA").save("logo-violet.png")
ast.parse(open("finish.py").read())
print("ok %dx%d" % w.size)

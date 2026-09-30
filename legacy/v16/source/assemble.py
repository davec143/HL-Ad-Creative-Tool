import json, re, base64, io
import numpy as np
from PIL import Image
import os
W = os.path.dirname(os.path.abspath(__file__)) + "/"
s = open(W + "b_script.js", encoding="utf-8").read()
fin = open(W + "finish.py", encoding="utf-8").read().rstrip("\n")
mk = open(W + "mk_logos.py", encoding="utf-8").read().rstrip("\n")
assert "PYEOF" not in fin + mk and "</script" not in (fin + mk).lower()
URLS = {"white": "https://cdn.shopify.com/s/files/1/2097/6403/files/Logo_White_HitLights_R.png?v=1614820672",
        "black": "https://cdn.shopify.com/s/files/1/2097/6403/files/Logo_Black_HitLights_Rs_1e65dd71-06e3-4435-aca2-1728dd559b58.png?v=1614820450"}
block = ("  // finish.py and the lockup builder, as readable source; written into the sandbox by heredoc.\n"
         "  var LOGO_URL=" + json.dumps(URLS) + ";\n"
         "  var FINISH_SRC=" + json.dumps(fin) + ";\n"
         "  var MKLOGO_SRC=" + json.dumps(mk) + ";")
# replace the FINISHPY line (old) or a previous FINISH_SRC block (re-runs)
if "var FINISHPY=" in s:
    s = re.sub(r"^  var FINISHPY=.*$", lambda m: block, s, count=1, flags=re.M)
else:
    s = re.sub(r"^  // finish.py and the lockup builder.*\n  var LOGO_URL=.*\n  var FINISH_SRC=.*\n  var MKLOGO_SRC=.*$", lambda m: block, s, count=1, flags=re.M)
s = s.replace("FIELDCOLOR (brand ground off palette). gzip + base64 of finish.py (readable source in the pack).",
              "FIELDCOLOR (brand ground off palette).")
s = s.replace("var LOGO_AR=84/600;   // height/width of the lockup files", "var LOGO_AR=166/1179; // height/width of the official lockup files")
# violet display copy = black display copy's alpha in #55426A
m = re.search(r'black:"([A-Za-z0-9+/=]+)"', s)
b = Image.open(io.BytesIO(base64.b64decode(m.group(1)))).convert("RGBA")
a = np.asarray(b)[..., 3]; o = np.zeros(a.shape + (4,), np.uint8)
o[..., 0], o[..., 1], o[..., 2], o[..., 3] = 0x55, 0x42, 0x6A, a
buf = io.BytesIO(); Image.fromarray(o, "RGBA").save(buf, "PNG", optimize=True)
s = re.sub(r'violet:"[A-Za-z0-9+/=]+"', 'violet:"' + base64.b64encode(buf.getvalue()).decode() + '"', s, count=1)
assert "FINISHPY" not in s and "base64 -d" not in s, "leftover base64 path"
open(W + "b_script.js", "w", encoding="utf-8").write(s)
h = open(W + "b_head.html", encoding="utf-8").read(); t = open(W + "b_tail.html", encoding="utf-8").read()
open(W + "../HitLights-Ad-Builder.html", "w", encoding="utf-8").write(h + "<script>" + s + "</script>" + t)
print("ok", len(h + s + t), "bytes; violet", b.size)

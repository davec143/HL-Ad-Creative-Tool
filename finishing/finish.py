import sys, os, json
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
# HitLights finishing v3 - places the real logo on the Logo Grid and checks brand colour.
#   python3 finish.py <render-at-exact-size> <out.jpg> '<spec json>'
# Lockups (logo-white.png, logo-black.png, logo-violet.png) sit next to this script: the official
# HitLights lockups from the Shopify CDN (white, black) and the black lockup in logo violet #55426A.
# The logo always lands on the exact grid position for the template and canvas: it never
# searches, never changes corner, never snaps sideways. Template 2 is the one content-aware
# case: the logo centres in the top of the white speech bubble the generator drew.
# Problems are FLAGGED, never "fixed" by moving the logo:
#   PLACEHOLDER blank patch painted where the logo goes (the page repaints it once)
#   COLLISION   artwork inside the logo zone          CONTRAST  fixed lockup illegible, other used
#   BUBBLE?     T2 bubble not found                    SAFEZONE  9:16 logo in the top 14%
#   NOCTA       no gold CTA found                      CTACOLOR  CTA too far off #EBA800 to correct
#   FIELDCOLOR  brand field / ground off-palette
img_p, out = sys.argv[1], sys.argv[2]
spec = json.loads(sys.argv[3])
here = os.path.dirname(os.path.abspath(__file__))
LOGOS = {k: os.path.join(here, "logo-%s.png" % k) for k in ("white", "black", "violet")}

im = Image.open(img_p).convert("RGB"); W, H = im.size
A = np.asarray(im, dtype=np.float32)
flags, notes = [], []

def hexc(c): return "#%02X%02X%02X" % tuple(int(round(float(v))) for v in c)
def rgb(h): return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)
def lab(c):
    c = np.asarray(c, dtype=np.float64) / 255.0
    c = np.where(c > .04045, ((c + .055) / 1.055) ** 2.4, c / 12.92)
    X = (c @ np.array([.4124, .3576, .1805])) / .95047
    Y = (c @ np.array([.2126, .7152, .0722]))
    Z = (c @ np.array([.0193, .1192, .9505])) / 1.08883
    f = lambda t: np.where(t > .008856, np.cbrt(t), 7.787 * t + 16 / 116)
    return np.array([116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))])
def dE(a, b): return float(np.linalg.norm(lab(a) - lab(b)))

# 1. Brand-field colour lock (the generator drifts a flat panel a few shades per render).
field = spec.get("field", "-") or "-"
if field != "-":
    T = rgb(field)
    s = A[::4, ::4].reshape(-1, 3); q = (s // 8).astype(np.int32)
    keys = q[:, 0] * 1024 + q[:, 1] * 32 + q[:, 2]
    vals, cnt = np.unique(keys, return_counts=True); kk = vals[np.argmax(cnt)]
    kq = np.array([kk // 1024, (kk // 32) % 32, kk % 32])
    near = s[np.all(np.abs(q - kq) <= 1, axis=1)]; M = near.mean(axis=0)
    if len(near) > .12 * len(s) and np.linalg.norm(M - T) < 75:
        d = np.linalg.norm(A - M, axis=2)
        wgt = np.clip((64.0 - d) / 28.0, 0, 1)[..., None]
        A = np.clip(A + wgt * (T - M), 0, 255)
        notes.append("field %s->#%s" % (hexc(M), field.upper()))
    else:
        flags.append("FIELDCOLOR")
grad = spec.get("grad")
if grad:  # T3: the dark violet ground, sampled top-right where nothing else sits
    patch = A[int(H * .02):int(H * .08), int(W * .80):int(W * .96)].reshape(-1, 3)
    if len(patch):
        med = np.median(patch, axis=0)
        if dE(med, rgb(grad[0])) > 14 and dE(med, rgb(grad[1])) > 14: flags.append("FIELDCOLOR")
        notes.append("ground %s" % hexc(med))

L = 0.2126 * A[..., 0] + 0.7152 * A[..., 1] + 0.0722 * A[..., 2]
_lw0, _lh0 = Image.open(LOGOS["white"]).size
lw = int(spec["w"]); lh = round(lw * _lh0 / _lw0)
x, y = int(spec["x"]), int(spec["y"])
ground = spec.get("ground", "panel")

# 2. Template 2 only: centre the logo in the top of the white speech bubble.
if ground == "bubble":
    white = A.min(axis=2) > 226
    c0, c1 = int(spec["bx"][0] * W), int(spec["bx"][1] * W)
    rows = white[:int(H * .6), c0:c1].mean(axis=1)
    need = max(12, lh // 2); run = 0; top = None
    for r, v in enumerate(rows):
        run = run + 1 if v > .55 else 0
        if run >= need: top = r - run + 1; break
    ok = False
    if top is not None:
        row = white[min(H - 1, top + need)]
        best, cur, b_ = 0, 0, 0
        for i_ in range(W):
            cur = cur + 1 if row[i_] else 0
            if cur > best: best, b_ = cur, i_
        a_ = b_ - best + 1
        if best > lw * 1.3:
            x = round((a_ + b_) / 2 - lw / 2); y = top + int(spec.get("pad", 40))
            notes.append("bubble x%d-%d top %d" % (a_, b_, top)); ok = True
    if not ok: flags.append("BUBBLE?")
    ground = "panel"

safe = spec.get("safeTop")
if safe is not None and y < int(safe): flags.append("SAFEZONE")

# 3. Check the logo zone (logo box + clear space) BEFORE placing.
pad = round(lh * .6)
x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(W, x + lw + pad), min(H, y + lh + pad)
reg = L[y0:y1, x0:x1]
edge = (np.abs(np.diff(reg, axis=1))[:-1, :] + np.abs(np.diff(reg, axis=0))[:, :-1]) > 45
edge_frac = float(edge.mean()) if edge.size else 0.0
rgbz = A[y0:y1, x0:x1].reshape(-1, 3); med = np.median(rgbz, axis=0)
flat_share = float(np.mean(np.max(np.abs(rgbz - med), axis=1) < 18))
if ground == "photo":
    pale_flat = float(np.mean((rgbz.min(axis=1) > 200) & (np.max(np.abs(rgbz - med), axis=1) < 14)))
    if pale_flat > .6: flags.append("PLACEHOLDER")
    elif edge_frac > .05: flags.append("COLLISION")
elif edge_frac > .012:
    flags.append("COLLISION")

# 4. CTA: find the solid gold button, check it against #EBA800 and pull it onto the exact gold.
G = np.array([235, 168, 0], dtype=np.float32)
if spec.get("cta", True):
    gm = (np.linalg.norm(A - G, axis=2) < 70) & (A[..., 0] - A[..., 2] > 120)
    f = max(2, W // 270)
    hh, ww = H // f, W // f
    small = gm[:hh * f, :ww * f].reshape(hh, f, ww, f).mean(axis=(1, 3)) > .5
    seen = np.zeros_like(small); cand = None
    for i in range(hh):
        for j in range(ww):
            if not small[i, j] or seen[i, j]: continue
            st = [(i, j)]; seen[i, j] = True; n = 0; r0 = r1 = i; q0 = q1 = j
            while st:
                a, b = st.pop(); n += 1
                r0, r1, q0, q1 = min(r0, a), max(r1, a), min(q0, b), max(q1, b)
                for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    na, nb = a + da, b + db
                    if 0 <= na < hh and 0 <= nb < ww and small[na, nb] and not seen[na, nb]:
                        seen[na, nb] = True; st.append((na, nb))
            bw, bh = q1 - q0 + 1, r1 - r0 + 1
            if n * f * f < .0012 * W * H or not (1.6 <= bw / bh <= 14): continue
            X0, Y0, X1, Y1 = q0 * f, r0 * f, (q1 + 1) * f, (r1 + 1) * f
            box = gm[Y0:Y1, X0:X1]; fill = float(box.mean())
            dark = float((L[Y0:Y1, X0:X1] < 70).mean())
            if fill < .5 or not (.015 <= dark <= .38): continue
            if cand is None or n > cand[0]: cand = (n, X0, Y0, X1, Y1)
    if cand is None:
        flags.append("NOCTA")
    else:
        _, X0, Y0, X1, Y1 = cand
        px = A[Y0:Y1, X0:X1][gm[Y0:Y1, X0:X1]]
        M = np.median(px, axis=0); e = dE(M, G)
        if e > 35:
            flags.append("CTACOLOR"); notes.append("CTA %s dE %.0f" % (hexc(M), e))
        else:
            if e > 2:
                X0, Y0, X1, Y1 = max(0, X0 - 3), max(0, Y0 - 3), min(W, X1 + 3), min(H, Y1 + 3)
                sub = A[Y0:Y1, X0:X1]
                d = np.linalg.norm(sub - M, axis=2)
                wgt = np.clip((50.0 - d) / 20.0, 0, 1)[..., None]
                A[Y0:Y1, X0:X1] = np.clip(sub + wgt * (G - M), 0, 255)
            notes.append("CTA %s->#EBA800 (dE %.1f)" % (hexc(M), e))

out_im = Image.fromarray(A.astype(np.uint8), "RGB")

# 5. Flat brand panel (T1 field, T2 bubble) with a few stray marks: even it out. Never on gradients or photos.
if spec.get("even") and flat_share >= .80 and "COLLISION" not in flags:
    patch = Image.new("RGB", (x1 - x0, y1 - y0), tuple(int(v) for v in med))
    m = Image.new("L", (x1 - x0, y1 - y0), 0); k = max(3, lh // 5)
    ImageDraw.Draw(m).rectangle((k, k, x1 - x0 - k, y1 - y0 - k), fill=255)
    out_im.paste(patch, (x0, y0), m.filter(ImageFilter.GaussianBlur(k / 1.5)))
    notes.append("stray marks evened")

# 6. Colourway is fixed per template; only overridden if it would be illegible.
under = np.asarray(out_im.crop((x, y, x + lw, y + lh)), dtype=np.float32)
umean = float((0.2126 * under[..., 0] + 0.7152 * under[..., 1] + 0.0722 * under[..., 2]).mean())
colour = spec.get("colour", "white")
if colour == "white" and umean > 170: colour = "black"; flags.append("CONTRAST")
elif colour in ("black", "violet") and umean < 85: colour = "white"; flags.append("CONTRAST")
lg = Image.open(LOGOS[colour]).convert("RGBA").resize((lw, lh), Image.LANCZOS)

# 7. Soft letterform shadow for a white logo over photography (as in the brand-kit templates).
if colour == "white" and spec.get("shadow"):
    sh = Image.new("RGBA", lg.size, (0, 0, 0, 0))
    sh.putalpha(lg.split()[3].point(lambda v: int(v * .55)))
    p2 = max(4, lh // 3)
    cv = Image.new("RGBA", (lw + p2 * 2, lh + p2 * 2), (0, 0, 0, 0))
    cv.paste(sh, (p2, p2 + max(1, lh // 14)), sh)
    cv = cv.filter(ImageFilter.GaussianBlur(max(2, lh / 9)))
    out_im.paste(cv, (x - p2, y - p2), cv); notes.append("soft shadow")
out_im.paste(lg, (x, y), lg)

q = 92
while q >= 60:
    out_im.save(out, "JPEG", quality=q, optimize=True, progressive=True, subsampling=2)
    if os.path.getsize(out) <= 460000: break
    q -= 6
msg = "%s logo at (%d,%d) w%d%s | ground %.0f edges %.3f" % (
    colour, x, y, lw, (" | " + ", ".join(notes)) if notes else "", umean, edge_frac)
if flags: msg += " | FLAGS " + " ".join(flags)
print(msg)

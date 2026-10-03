// Builds the HTML for one ad size and the in-page script that fits the text and checks the layout.
// Everything is inline (fonts, logo, scene, product), so rendering needs no network.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "../server/config.mjs";

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve("@fontsource/montserrat/package.json")), "files");
export const FONT_WEIGHTS = [500, 600, 700, 800];
const LOGO_FILE = { white: "hitlights-logo-white.png", black: "hitlights-logo-black.png" };

// Characters the bundled Montserrat (latin subset) draws. Anything else would silently fall back to
// another typeface, so it is refused up front.
export const ALLOWED_TEXT = /^[ -~ -ÿ–—‘’“”•…™]*$/;

let fontCss = null;
function fonts() {
  if (fontCss) return fontCss;
  fontCss = FONT_WEIGHTS.map((w) => {
    const b64 = fs.readFileSync(path.join(FONT_DIR, `montserrat-latin-${w}-normal.woff2`)).toString("base64");
    return `@font-face{font-family:"HLMontserrat";font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
  }).join("\n");
  return fontCss;
}
const logoCache = {};
function logoUri(colour) {
  if (!logoCache[colour]) logoCache[colour] = "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "assets", "logos", LOGO_FILE[colour])).toString("base64");
  return logoCache[colour];
}
export function dataUri(buf, type) { return "data:" + type + ";base64," + Buffer.from(buf).toString("base64"); }

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const px = (n) => n + "px";

// spec: layoutFor(...) result. scene/product: data URIs (scene null = labelled placeholder).
export function buildHtml(spec, { scene, product }) {
  const { W, H, L, logo, text: T, colours: K } = spec;
  const fitAttr = (r, lines) => `data-max="${r[0]}" data-min="${r[1]}" data-lines="${lines}"`;
  const ctaBox = L.cta.cx != null
    ? `left:${px(L.cta.cx)};transform:translateX(-50%);` : `left:${px(L.cta.x)};`;
  const contactBox = L.contact.cx != null
    ? `left:${px(L.contact.cx - L.contact.maxW / 2)};width:${px(L.contact.maxW)};text-align:center;` : `left:${px(L.contact.x)};width:${px(L.contact.maxW)};`;
  const proof = T.proof.map((p, i) => `<li id="p${i + 1}" class="fit" ${fitAttr(L.proof.size, L.proof.lines)}><span class="dot"></span><span class="t">${escHtml(p)}</span></li>`).join("");
  const sceneEl = scene
    ? `<img id="photo" class="photo" src="${scene}" alt="">`
    : `<div id="photo" class="photo placeholder"><span>Scene photo<br>rendered by Higgsfield</span></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fonts()}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${px(W)};height:${px(H)};overflow:hidden;background:${K.field}}
body{font-family:"HLMontserrat";-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;position:relative}
.dots{position:absolute;left:${px(L.dots.x || 0)};bottom:0;width:${px(L.dots.w)};height:${px(L.dots.h)};
  background-image:radial-gradient(circle,${K.goldBright} 5.5px,transparent 6.5px);background-size:34px 34px;background-position:6px 6px;opacity:.55;
  -webkit-mask-image:linear-gradient(45deg,#000 30%,transparent 92%);mask-image:linear-gradient(45deg,#000 30%,transparent 92%)}
#logo{position:absolute;left:${px(logo.x)};top:${px(logo.y)};width:${px(logo.w)};height:auto;display:block}
#head{position:absolute;left:${px(L.head.x)};top:${px(L.head.y)};width:${px(L.head.w)}}
#h1{color:${K.goldBright};font-weight:800;line-height:1.04;letter-spacing:-0.01em}
#h2{color:#fff;font-weight:700;line-height:1.08;margin-top:.12em;letter-spacing:-0.005em}
#proof{position:absolute;left:${px(L.proof.x)};width:${px(L.proof.w)};list-style:none}
#proof li{display:flex;align-items:baseline;color:#fff;font-weight:500;line-height:1.22;margin-bottom:${px(L.proof.gap)}}
#proof .dot{flex:0 0 auto;width:.5em;height:.5em;border-radius:50%;background:${K.goldBright};margin-right:.55em;transform:translateY(-.06em)}
#proof .t{flex:1 1 auto;min-width:0}
.photo{position:absolute;left:${px(L.photo.x)};top:${px(L.photo.y)};width:${px(L.photo.w)};height:${px(L.photo.h)};border-radius:${px(L.photo.r)};object-fit:cover;display:block;box-shadow:0 12px 32px rgba(0,0,0,.28)}
.placeholder{background:linear-gradient(135deg,#8a7a5a,#4a4034);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.75);font-weight:600;font-size:22px;text-align:center;line-height:1.4}
#product{position:absolute;left:${px(L.product.x)};top:${px(L.product.y)};width:${px(L.product.w)};height:${px(L.product.h)};object-fit:contain;object-position:50% 100%;
  filter:drop-shadow(0 18px 22px rgba(0,0,0,.45)) drop-shadow(0 0 34px rgba(251,202,16,.38))}
#seal{position:absolute;left:${px(L.seal.cx - L.seal.d / 2)};top:${px(L.seal.cy - L.seal.d / 2)};width:${px(L.seal.d)};height:${px(L.seal.d)};border-radius:50%;background:#fff;color:${K.field};
  display:flex;align-items:center;justify-content:center;text-align:center;font-weight:800;line-height:1.1;padding:${px(Math.round(L.seal.d * 0.12))};box-shadow:0 6px 16px rgba(0,0,0,.3);text-transform:uppercase}
#cta{position:absolute;${ctaBox}top:${px(L.cta.y)};height:${px(L.cta.h)};max-width:${px(L.cta.maxW)};padding:0 1.35em;border-radius:${px(L.cta.h)};background:${K.gold};color:${K.ink};
  font-weight:800;white-space:nowrap;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px rgba(0,0,0,.32);letter-spacing:.01em}
#contact{position:absolute;${contactBox}top:${px(L.contact.y)};color:#fff;font-weight:500;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.45)}
</style></head><body>
<div class="dots" id="dots"></div>
${sceneEl}
<img id="product" src="${product}" alt="">
${T.seal ? `<div id="seal" class="fit" ${fitAttr([Math.round(L.seal.d * 0.17), Math.round(L.seal.d * 0.1)], 3)}><span class="t">${escHtml(T.seal)}</span></div>` : ""}
<img id="logo" src="${logoUri(logo.colour)}" alt="">
<div id="head"><div id="h1" class="fit" ${fitAttr(L.head.h1, 2)}>${escHtml(T.h1)}</div><div id="h2" class="fit" ${fitAttr(L.head.h2, 2)}>${escHtml(T.h2)}</div></div>
<ul id="proof" data-below="${L.proof.below}">${proof}</ul>
<div id="cta" class="fit" ${fitAttr(L.cta.size, 1)}>${escHtml(T.cta)}</div>
${T.contact ? `<div id="contact" class="fit" ${fitAttr(L.contact.size, 1)}>${escHtml(T.contact)}</div>` : ""}
</body></html>`;
}

// Runs inside the page after fonts and images load. Fits every .fit element (largest size that
// fits its box in its line budget, preferring fewer lines for headlines), then checks the rules.
// Returns {ok, errors[], sizes{}, rects{}}.
export function pageScript(rules) {
  const errors = [], sizes = {}, rects = {};
  const $ = (id) => document.getElementById(id);
  const lineCount = (el) => {
    const r = document.createRange(); r.selectNodeContents(el);
    const tops = new Set(); for (const b of r.getClientRects()) if (b.width > 1) tops.add(Math.round(b.top));
    return tops.size;
  };
  const fits = (el, lines) => {
    if (el.id === "cta" || el.id === "contact") {
      const box = el.getBoundingClientRect();
      return el.scrollWidth <= el.clientWidth + 1 && box.width <= rules.maxW[el.id] + 0.5;
    }
    const t = el.querySelector(".t") || el;
    if (el.id === "seal") {
      // The words must sit inside the circle's inner square (its padding), not just the box.
      const cs = getComputedStyle(el), pad = parseFloat(cs.paddingLeft), b = el.getBoundingClientRect(), r = t.getBoundingClientRect();
      const r2 = document.createRange(); r2.selectNodeContents(t); let wmax = 0; for (const q of r2.getClientRects()) wmax = Math.max(wmax, q.width);
      return lineCount(t) <= lines && wmax <= b.width - 2 * pad + 0.5 && r.height <= b.height - 2 * pad + 0.5;
    }
    return lineCount(t) <= lines && el.scrollWidth <= el.clientWidth + 1;
  };
  for (const el of document.querySelectorAll(".fit")) {
    const max = +el.dataset.max, min = +el.dataset.min, lines = +el.dataset.lines;
    // Headlines: one line at any size down to min before allowing a second line.
    const budgets = (el.id === "h1" || el.id === "h2") ? [1, lines] : [lines];
    let ok = false;
    for (const b of budgets) {
      for (let s = max; s >= min; s -= 1) { el.style.fontSize = s + "px"; if (fits(el, b)) { ok = true; break; } }
      if (ok) break;
    }
    sizes[el.id] = parseFloat(el.style.fontSize);
    if (!ok) errors.push({ code: "TEXT_FIT", field: el.id, message: (rules.names[el.id] || el.id) + " is too long for this size, even at the smallest allowed type." });
  }
  // Proof list sits under the headline.
  const head = $("head"), proof = $("proof");
  proof.style.top = (head.offsetTop + head.offsetHeight + (+proof.dataset.below)) + "px";
  // Rectangles in page pixels.
  const R = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  for (const id of ["logo", "head", "proof", "photo", "seal", "cta", "contact"]) if ($(id)) rects[id] = R($(id));
  for (const li of proof.children) rects[li.id] = R(li);
  // The product's drawn area (object-fit: contain, anchored bottom-centre), not its box.
  const p = $("product"), pb = R(p);
  if (!p.naturalWidth) errors.push({ code: "PRODUCT", message: "The product image didn't load." });
  else {
    const s = Math.min(pb.w / p.naturalWidth, pb.h / p.naturalHeight), w = p.naturalWidth * s, h = p.naturalHeight * s;
    rects.product = { x: pb.x + (pb.w - w) / 2, y: pb.y + pb.h - h, w, h };
  }
  if ($("photo").tagName === "IMG" && !$("photo").naturalWidth) errors.push({ code: "SCENE", message: "The scene photo didn't load." });
  // Fonts: every weight in use must be the bundled Montserrat, not a fallback.
  for (const w of rules.weights) if (!document.fonts.check(w + ' 20px "HLMontserrat"')) errors.push({ code: "FONT", message: "Montserrat " + w + " didn't load." });
  // Overlap rules.
  const inter = (a, b, pad = 0) => a && b && a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
  const textIds = ["head", ...[...proof.children].map((li) => li.id), "cta", "contact"].filter((id) => rects[id]);
  const logoClear = rects.logo.h; // clear space: the height of the H mark, on all sides
  const blockers = [...textIds, "photo", "product", "seal"].filter((id) => rects[id]);
  for (const id of blockers) if (inter(rects.logo, rects[id], logoClear)) errors.push({ code: "LOGO_CLEARSPACE", field: id, message: "Nothing may sit within the logo's clear space; " + (rules.names[id] || id) + " does." });
  for (let i = 0; i < textIds.length; i++) {
    for (const other of [...textIds.slice(i + 1), "photo", "product", "seal"]) {
      if (rects[other] && inter(rects[textIds[i]], rects[other], 8)) errors.push({ code: "OVERLAP", field: textIds[i], message: (rules.names[textIds[i]] || textIds[i]) + " runs into " + (rules.names[other] || other) + "." });
    }
  }
  if (rects.seal && rects.product && inter(rects.seal, rects.product, 8)) errors.push({ code: "OVERLAP", field: "seal", message: "The trust seal runs into the product." });
  // Frame and safe zones.
  const M = rules.margin;
  for (const id of [...textIds, "logo", "seal", "product", "photo"]) {
    const r = rects[id]; if (!r) continue;
    if (r.x < M - 0.5 || r.y < M - 0.5 || r.x + r.w > rules.W - M + 0.5 || r.y + r.h > rules.H - M + 0.5) errors.push({ code: "FRAME", field: id, message: (rules.names[id] || id) + " is too close to the edge." });
  }
  if (rules.safe) {
    for (const id of [...textIds, "logo", "seal"]) {
      const r = rects[id]; if (!r) continue;
      if (r.y < rules.safe.top || r.y + r.h > rules.safe.bottom) errors.push({ code: "SAFEZONE", field: id, message: (rules.names[id] || id) + " is outside the Stories/Reels safe zone (14%–80% of the height)." });
    }
  }
  return { ok: errors.length === 0, errors, sizes, rects };
}

export const FIELD_NAMES = { h1: "Headline line 1", h2: "Headline line 2", head: "The headline", p1: "Proof line 1", p2: "Proof line 2", p3: "Proof line 3", cta: "The button text", contact: "The contact line", seal: "The trust seal", photo: "the scene photo", product: "the product", logo: "the logo" };

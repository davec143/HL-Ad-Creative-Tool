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

const BUILDERS = {};
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const px = (n) => n + "px";

// spec: layoutFor(...) result. scene/product: data URIs (scene null = labelled placeholder).
export function buildHtml(spec, images) {
  const b = BUILDERS[spec.tpl];
  if (!b) throw new Error("No page builder for " + spec.tpl);
  return b(spec, images);
}

const head = (W, H, bg) => `<!doctype html><html><head><meta charset="utf-8"><style>
${fonts()}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${px(W)};height:${px(H)};overflow:hidden;background:${bg}}
body{font-family:"HLMontserrat";-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;position:relative}
.placeholder{background:linear-gradient(135deg,#8a7a5a,#4a4034);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.75);font-weight:600;font-size:22px;text-align:center;line-height:1.4}`;
const fitAttr = (r, lines) => `data-max="${r[0]}" data-min="${r[1]}" data-lines="${lines}"`;
const sceneTag = (scene, id = "photo", cls = "photo") => scene ? `<img id="${id}" data-role="image" class="${cls}" src="${scene}" alt="">` : `<div id="${id}" data-role="image" class="${cls} placeholder"><span>Scene photo<br>rendered by Higgsfield</span></div>`;
const proofItems = (T, L) => T.proof.map((p, i) => `<li id="p${i + 1}" data-role="text" class="fit" ${fitAttr(L.proof.size, L.proof.lines)}><span class="dot"></span><span class="t">${escHtml(p)}</span></li>`).join("");
const sealTag = (T, L) => T.seal ? `<div id="seal" class="fit" ${fitAttr([Math.round(L.seal.d * 0.17), Math.round(L.seal.d * 0.1)], 3)}><span class="t">${escHtml(T.seal)}</span></div>` : "";
const sealCss = (L, colour) => `#seal{position:absolute;left:${px(L.seal.cx - L.seal.d / 2)};top:${px(L.seal.cy - L.seal.d / 2)};width:${px(L.seal.d)};height:${px(L.seal.d)};border-radius:50%;background:#fff;color:${colour};
  display:flex;align-items:center;justify-content:center;text-align:center;font-weight:800;line-height:1.1;padding:${px(Math.round(L.seal.d * 0.12))};box-shadow:0 6px 16px rgba(0,0,0,.3);text-transform:uppercase}`;
// The last word of a line, picked out (T4: the payoff word in gold).
function lastWordSpan(s, cls) {
  const t = String(s), i = t.trimEnd().lastIndexOf(" ");
  return i < 0 ? `<span class="${cls}">${escHtml(t)}</span>` : escHtml(t.slice(0, i + 1)) + `<span class="${cls}">${escHtml(t.slice(i + 1))}</span>`;
}

function buildT4(spec, { scene, product }) {
  const { W, H, L, logo, text: T, colours: K } = spec;
  const pad = L.col.pad;
  return head(W, H, K.cream) + `
.photo{position:absolute;left:${px(L.photo.x)};top:${px(L.photo.y)};width:${px(L.photo.w)};height:${px(L.photo.h)};border-radius:${L.photo.radius};object-fit:cover;display:block}
#scrim{position:absolute;left:0;top:0;width:${px(Math.round(L.photo.w * 0.6))};height:${px(Math.round(L.photo.h * 0.45))};border-top-left-radius:0;
  background:radial-gradient(ellipse at 0 0,rgba(0,0,0,.5),rgba(0,0,0,.22) 45%,transparent 72%);pointer-events:none}
#bar{position:absolute;left:${px(L.bar.x)};top:${px(L.bar.y)};width:${px(L.bar.w)};height:${px(L.bar.h)};background:${K.purple}}
#col{position:absolute;left:${px(L.col.x)};top:${px(L.col.y)};width:${px(L.col.w)};height:${px(L.col.h)};padding:${px(pad[0])} 0 ${px(pad[1])};
  display:flex;flex-direction:column;justify-content:${L.col.align === "center" ? "center" : "flex-start"};align-items:flex-start}
#logo{display:block;width:${px(logo.w)};height:auto}
.abslogo{position:absolute;left:${px(logo.x)};top:${px(logo.y)};filter:drop-shadow(0 2px 6px rgba(0,0,0,.35))}
.panellogo{margin-bottom:${px(logo.h + 6)}}
#head{width:100%}
#h1,#h2{color:${K.ink};font-weight:700;line-height:1.1;letter-spacing:-0.01em}
#h2 .gold{color:${K.gold}}
#proof{list-style:none;width:100%;margin-top:.9em}
#proof li{display:flex;align-items:baseline;color:${K.ink};font-weight:500;line-height:1.25;margin-bottom:${px(L.proof.gap)}}
#proof .dot{flex:0 0 auto;width:.42em;height:.42em;border-radius:50%;background:${K.gold};margin-right:.5em;transform:translateY(-.08em)}
#proof .t{flex:1 1 auto;min-width:0}
#cta{height:${px(L.cta.h)};max-width:${px(L.cta.maxW)};padding:0 1.3em;border-radius:${px(L.cta.h)};background:${K.gold};color:${K.ink};margin-top:${px(Math.round(L.cta.h * 0.32))};
  font-weight:800;white-space:nowrap;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px rgba(0,0,0,.18);letter-spacing:.01em;flex:0 0 auto}
#contact{color:${K.ink};font-weight:500;white-space:nowrap;margin-top:${px(Math.round(L.cta.h * 0.24))};max-width:${px(L.contact.maxW)}}
#product{position:absolute;left:${px(L.product.x)};top:${px(L.product.y)};width:${px(L.product.w)};height:${px(L.product.h)};object-fit:contain;object-position:50% 100%;
  filter:drop-shadow(0 16px 18px rgba(0,0,0,.35))}
${sealCss(L, K.field)}
</style></head><body>
${sceneTag(scene)}
${logo.scrim ? '<div id="scrim"></div>' : ""}
<div id="bar"></div>
<img id="product" data-role="image" src="${product}" alt="">
${sealTag(T, L)}
${logo.inPanel ? "" : `<img id="logo" class="abslogo" src="${logoUri(logo.colour)}" alt="">`}
<div id="col">
${logo.inPanel ? `<img id="logo" class="panellogo" src="${logoUri(logo.colour)}" alt="">` : ""}
<div id="head" data-role="text"><div id="h1" class="fit" data-match="head" ${fitAttr(L.head.h1, 2)}>${escHtml(T.h1)}</div><div id="h2" class="fit" data-match="head" ${fitAttr(L.head.h2, 2)}>${lastWordSpan(T.h2, "gold")}</div></div>
<ul id="proof">${proofItems(T, L)}</ul>
<div id="cta" data-role="text" class="fit" ${fitAttr(L.cta.size, 1)}>${escHtml(T.cta)}</div>
${T.contact ? `<div id="contact" data-role="text" class="fit" ${fitAttr(L.contact.size, 1)}>${escHtml(T.contact)}</div>` : ""}
</div>
</body></html>`;
}

// A run of short items on one line separated by thin bars (T2's proof line).
const barred = (items) => items.map((t) => `<span>${escHtml(t)}</span>`).join('<span class="sep">|</span>');
const ctaArrow = `<span class="arrow" aria-hidden="true"></span>`;
const ICON = {
  phone: '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="none" stroke="#fff" stroke-width="1.6"/><path fill="#fff" d="M9.2 7.2c.3-.3.8-.3 1 .1l1 1.7c.2.3.1.7-.1 1l-.7.6c.5 1.1 1.4 2 2.5 2.5l.6-.7c.3-.3.7-.3 1-.1l1.7 1c.4.2.4.7.1 1l-.9.9c-.6.6-1.5.7-2.2.3a9.6 9.6 0 0 1-4.6-4.6c-.4-.7-.3-1.6.3-2.2z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="none" stroke="#fff" stroke-width="1.6"/><rect x="6.5" y="8.2" width="11" height="7.6" rx="1" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M7 8.8l5 3.8 5-3.8" fill="none" stroke="#fff" stroke-width="1.4"/></svg>',
};

function buildT2(spec, { scene, product }) {
  const { W, H, L, logo, text: T, colours: K } = spec;
  const b = L.bubble;
  return head(W, H, "#3c4a5c") + `
.photo{position:absolute;left:0;top:0;width:${px(W)};height:${px(H)};object-fit:cover;display:block}
#bubble{position:absolute;left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};padding:${px(b.pad[0])} ${px(b.pad[1])} ${px(b.pad[2])};background:#fff;border-radius:${px(Math.round(b.w * 0.045))};
  box-shadow:0 14px 34px rgba(0,0,0,.28);display:flex;flex-direction:column;align-items:center;text-align:center}
#bubble::after{content:"";position:absolute;left:12%;bottom:${px(-Math.round(b.w * 0.035))};border-style:solid;border-width:${px(Math.round(b.w * 0.036))} ${px(Math.round(b.w * 0.03))} 0 0;border-color:#fff transparent transparent transparent}
#logo{display:block;width:${px(logo.w)};height:auto;margin-bottom:${px(logo.h + 4)}}
#head{width:100%}
#h1,#h2{color:${K.ink};font-weight:800;line-height:1.08;letter-spacing:-0.01em}
#proofline{color:${K.ink};font-weight:600;white-space:nowrap;margin-top:.7em;max-width:100%}
#proofline .sep{color:#b9b4c2;margin:0 .55em;font-weight:400}
#cta{height:${px(L.cta.h)};max-width:${px(L.cta.maxW)};padding:0 1.3em;border-radius:${px(L.cta.h)};background:${K.gold};color:${K.ink};margin-top:${px(Math.round(L.cta.h * 0.38))};
  font-weight:800;white-space:nowrap;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px rgba(0,0,0,.2);letter-spacing:.01em}
#product{position:absolute;left:${px(L.product.x)};top:${px(L.product.y)};width:${px(L.product.w)};height:${px(L.product.h)};object-fit:contain;object-position:50% 100%;
  filter:drop-shadow(0 18px 22px rgba(0,0,0,.45))}
#contact{position:absolute;left:${px(L.contact.cx - L.contact.maxW / 2)};width:${px(L.contact.maxW)};top:${px(L.contact.y)};text-align:center;color:#fff;font-weight:500;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,.7)}
</style></head><body>
${sceneTag(scene)}
<img id="product" data-role="image" src="${product}" alt="">
<div id="bubble" data-role="panel">
<img id="logo" src="${logoUri(logo.colour)}" alt="">
<div id="head" data-role="text"><div id="h1" class="fit" data-match="head" ${fitAttr(L.head.h1, 2)}>${escHtml(T.h1)}</div><div id="h2" class="fit" data-match="head" ${fitAttr(L.head.h2, 2)}>${escHtml(T.h2)}</div></div>
${T.proof.length ? `<div id="proofline" data-role="text" class="fit" ${fitAttr(L.proofline.size, 1)}>${barred(T.proof)}</div>` : ""}
<div id="cta" data-role="text" class="fit" ${fitAttr(L.cta.size, 1)}>${escHtml(T.cta)}</div>
</div>
${T.contact ? `<div id="contact" data-role="text" class="fit" ${fitAttr(L.contact.size, 1)}>${escHtml(T.contact)}</div>` : ""}
</body></html>`;
}

function buildT3(spec, { scene, product }) {
  const { W, H, L, logo, text: T, colours: K } = spec;
  const c = L.card, g = L.glow;
  return head(W, H, K.promoBottom) + `
body{background:linear-gradient(180deg,${K.promoTop},${K.promoBottom})}
#glow{position:absolute;left:${px(g.cx - g.r)};top:${px(g.cy - g.r)};width:${px(2 * g.r)};height:${px(2 * g.r)};border-radius:50%;
  background:radial-gradient(circle at 42% 45%,rgba(235,168,0,.38),transparent 55%),radial-gradient(circle at 62% 58%,rgba(103,81,133,.55),transparent 62%);filter:blur(18px)}
#logo{position:absolute;left:${px(logo.x)};top:${px(logo.y)};width:${px(logo.w)};height:auto;display:block}
#head{position:absolute;left:${px(L.head.x)};top:${px(L.head.y)};width:${px(L.head.w)}}
#h1{color:${K.goldBright};font-weight:800;line-height:.96;letter-spacing:-0.02em}
#h2{color:#fff;font-weight:700;line-height:1.12;margin-top:.25em}
.card{position:absolute;left:${px(c.x)};top:${px(c.y)};width:${px(c.w)};height:${px(c.h)};border-radius:${px(18)};object-fit:cover;display:block;
  transform:rotate(${c.rot}deg);filter:blur(2.5px) brightness(.72) saturate(1.1);box-shadow:0 22px 44px rgba(0,0,0,.5)}
#product{position:absolute;left:${px(L.product.x)};top:${px(L.product.y)};width:${px(L.product.w)};height:${px(L.product.h)};object-fit:contain;object-position:50% 100%;
  transform:rotate(${L.product.rot}deg);filter:drop-shadow(0 20px 22px rgba(0,0,0,.55)) drop-shadow(0 0 36px rgba(235,168,0,.35))}
#bottom{position:absolute;left:${px(L.bottom.x)};bottom:${px(H - L.bottom.y)};width:${px(L.bottom.w)};display:flex;flex-direction:column;align-items:flex-start}
#deadline{color:#fff;font-weight:600;white-space:nowrap;max-width:100%;margin-bottom:${px(Math.round(L.cta.h * 0.3))}}
#cta{height:${px(L.cta.h)};max-width:${px(L.cta.maxW)};padding:0 1.25em;border-radius:${px(12)};background:${K.gold};color:${K.ink};
  font-weight:800;white-space:nowrap;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px rgba(0,0,0,.35);letter-spacing:.01em}
</style></head><body>
<div id="glow"></div>
${sceneTag(scene, "card", "card")}
<img id="product" data-role="image" src="${product}" alt="">
<img id="logo" src="${logoUri(logo.colour)}" alt="">
<div id="head" data-role="text"><div id="h1" class="fit" ${fitAttr(L.head.h1, 2)}>${escHtml(T.h1)}</div>${T.h2 ? `<div id="h2" class="fit" ${fitAttr(L.head.h2, 2)}>${escHtml(T.h2)}</div>` : ""}</div>
<div id="bottom">
${T.deadline ? `<div id="deadline" data-role="text" class="fit" ${fitAttr(L.deadline.size, 1)}>${escHtml(T.deadline)}</div>` : ""}
<div id="cta" data-role="text" class="fit" ${fitAttr(L.cta.size, 1)}>${escHtml(T.cta)}</div>
</div>
</body></html>`;
}

function buildT5(spec, { scene, product }) {
  const { W, H, L, logo, text: T, colours: K } = spec;
  const st = L.stack, ct = L.contact || {};
  const align = st.align === "end" ? "flex-end" : "center";
  const contactInStack = ct.inline && T.contact;
  return head(W, H, "#1b1411") + `
.photo{position:absolute;left:0;top:0;width:${px(W)};height:${px(H)};object-fit:cover;display:block}
#scrim{position:absolute;inset:0;background:${L.scrim}}
#logo{position:absolute;left:${px(logo.x)};top:${px(logo.y)};width:${px(logo.w)};height:auto;display:block;filter:drop-shadow(0 2px 8px rgba(0,0,0,.6))}
#stack{position:absolute;left:${px(st.x)};top:${px(st.y)};width:${px(st.w)};display:flex;flex-direction:column;align-items:${align};text-align:${st.align === "end" ? "right" : "center"};
  color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.6)}
#head{width:100%}
#h1,#h2{font-weight:800;line-height:1.0;letter-spacing:-0.015em}
#sub{font-weight:500;line-height:1.25;margin-top:.55em;width:100%}
#cta{height:${px(L.cta.h)};max-width:${px(L.cta.maxW)};padding:0 1.25em;border-radius:${px(L.cta.h)};background:${K.gold};color:${K.ink};text-shadow:none;margin-top:${px(Math.round(L.cta.h * 0.42))};
  font-weight:800;white-space:nowrap;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,.45);letter-spacing:.01em}
#cta .arrow{display:inline-block;width:.42em;height:.42em;border-top:.14em solid ${K.ink};border-right:.14em solid ${K.ink};transform:rotate(45deg);margin-left:.5em;margin-right:.1em}
#contact,#contact2{font-weight:500;white-space:nowrap;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.7);display:flex;align-items:center;gap:.45em}
#contact svg,#contact2 svg{flex:0 0 auto}
${ct.stacked ? `#contact,#contact2{position:absolute;right:${px(ct.right)};width:${px(ct.maxW)};justify-content:flex-end}
#contact{top:${px(ct.y)}} #contact2{top:${px(ct.y + Math.round(ct.size[0] * 1.6))}}` : ""}
${contactInStack ? `#contact{margin-top:${px(Math.round(L.cta.h * 0.3))};justify-content:center;max-width:${px(ct.maxW)}}` : ""}
#product{position:absolute;left:${px(L.product.x)};top:${px(L.product.y)};width:${px(L.product.w)};height:${px(L.product.h)};object-fit:contain;object-position:50% 100%;
  filter:drop-shadow(0 0 36px rgba(255,190,110,.55)) drop-shadow(0 16px 20px rgba(0,0,0,.5))}
</style></head><body>
${sceneTag(scene)}
<div id="scrim"></div>
<img id="product" data-role="image" src="${product}" alt="">
<img id="logo" src="${logoUri(logo.colour)}" alt="">
<div id="stack">
<div id="head" data-role="text"><div id="h1" class="fit" data-match="head" ${fitAttr(L.head.h1, 1)}>${escHtml(T.h1)}</div><div id="h2" class="fit" data-match="head" ${fitAttr(L.head.h2, 1)}>${escHtml(T.h2)}</div></div>
${T.sub ? `<div id="sub" data-role="text" class="fit" ${fitAttr(L.sub.size, L.sub.lines)}>${escHtml(T.sub)}</div>` : ""}
<div id="cta" data-role="text" class="fit" ${fitAttr(L.cta.size, 1)}>${escHtml(T.cta)}${ctaArrow}</div>
${contactInStack ? `<div id="contact" data-role="text" class="fit" ${fitAttr(ct.size, 1)}>${escHtml(T.contact)}</div>` : ""}
</div>
${ct.stacked && T.phone ? `<div id="contact" data-role="text" class="fit" ${fitAttr(ct.size, 1)}><span class="t">${escHtml(T.phone)}</span>${ICON.phone}</div>` : ""}
${ct.stacked && T.email ? `<div id="contact2" data-role="text" class="fit" ${fitAttr(ct.size, 1)}><span class="t">${escHtml(T.email)}</span>${ICON.mail}</div>` : ""}
</body></html>`;
}

function buildT1(spec, { scene, product }) {
  const { W, H, L, logo, text: T, colours: K } = spec;
  const fitAttr = (r, lines) => `data-max="${r[0]}" data-min="${r[1]}" data-lines="${lines}"`;
  const ctaBox = L.cta.cx != null
    ? `left:${px(L.cta.cx)};transform:translateX(-50%);` : `left:${px(L.cta.x)};`;
  const contactBox = L.contact.cx != null
    ? `left:${px(L.contact.cx - L.contact.maxW / 2)};width:${px(L.contact.maxW)};text-align:center;` : `left:${px(L.contact.x)};width:${px(L.contact.maxW)};`;
  const proof = T.proof.map((p, i) => `<li id="p${i + 1}" data-role="text" class="fit" ${fitAttr(L.proof.size, L.proof.lines)}><span class="dot"></span><span class="t">${escHtml(p)}</span></li>`).join("");
  const sceneEl = sceneTag(scene);
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
<img id="product" data-role="image" src="${product}" alt="">
${T.seal ? `<div id="seal" class="fit" ${fitAttr([Math.round(L.seal.d * 0.17), Math.round(L.seal.d * 0.1)], 3)}><span class="t">${escHtml(T.seal)}</span></div>` : ""}
<img id="logo" src="${logoUri(logo.colour)}" alt="">
<div id="head" data-role="text"><div id="h1" class="fit" ${fitAttr(L.head.h1, 2)}>${escHtml(T.h1)}</div><div id="h2" class="fit" ${fitAttr(L.head.h2, 2)}>${escHtml(T.h2)}</div></div>
<ul id="proof" data-below="${L.proof.below}">${proof}</ul>
<div id="cta" data-role="text" class="fit" ${fitAttr(L.cta.size, 1)}>${escHtml(T.cta)}</div>
${T.contact ? `<div id="contact" data-role="text" class="fit" ${fitAttr(L.contact.size, 1)}>${escHtml(T.contact)}</div>` : ""}
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
      const mw = rules.maxW[el.id] == null ? Infinity : rules.maxW[el.id];
      return el.scrollWidth <= el.clientWidth + 1 && box.width <= mw + 0.5;
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
  // Lines that must share one size (T4's two headline lines): all take the smallest fitted size.
  const groups = {};
  for (const el of document.querySelectorAll("[data-match]")) (groups[el.dataset.match] = groups[el.dataset.match] || []).push(el);
  for (const g of Object.values(groups)) { const m = Math.min(...g.map((e) => parseFloat(e.style.fontSize))); for (const e of g) { e.style.fontSize = m + "px"; sizes[e.id] = m; } }
  // An absolutely placed proof list sits under the headline (T1); in a flowing column it follows.
  const head = $("head"), proof = $("proof");
  if (proof && head && getComputedStyle(proof).position === "absolute") proof.style.top = (head.offsetTop + head.offsetHeight + (+proof.dataset.below)) + "px";
  // Rectangles in page pixels. Roles come from data-role: text, image, panel (seal and logo by id).
  const R = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  const ids = (role) => [...document.querySelectorAll('[data-role="' + role + '"]')].map((e) => e.id).filter(Boolean);
  for (const id of [...ids("text"), ...ids("image"), ...ids("panel"), "logo", "seal"]) if ($(id) && id !== "product") rects[id] = R($(id));
  // The product's drawn area (object-fit: contain, anchored bottom-centre), not its box.
  const p = $("product"), pb = R(p);
  if (!p.naturalWidth) errors.push({ code: "PRODUCT", message: "The product image didn't load." });
  else {
    const s = Math.min(pb.w / p.naturalWidth, pb.h / p.naturalHeight), w = p.naturalWidth * s, h = p.naturalHeight * s;
    rects.product = { x: pb.x + (pb.w - w) / 2, y: pb.y + pb.h - h, w, h };
  }
  if ($("photo") && $("photo").tagName === "IMG" && !$("photo").naturalWidth) errors.push({ code: "SCENE", message: "The scene photo didn't load." });
  // Fonts: every weight in use must be the bundled Montserrat, not a fallback.
  for (const w of rules.weights) if (!document.fonts.check(w + ' 20px "HLMontserrat"')) errors.push({ code: "FONT", message: "Montserrat " + w + " didn't load." });
  // Overlap rules. "ground" boxes are what text and the logo deliberately sit on (a full-bleed
  // photo, the speech bubble), so they aren't obstacles.
  const ground = rules.ground || [];
  const inter = (a, b, pad = 0) => a && b && a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
  const textIds = ids("text").filter((id) => rects[id]);
  const imageIds = [...ids("image"), ...ids("panel")].filter((id) => rects[id] && !ground.includes(id));
  const logoClear = rects.logo.h; // clear space: the height of the H mark, on all sides
  for (const id of [...textIds, ...imageIds, "seal"].filter((id) => rects[id])) if (inter(rects.logo, rects[id], logoClear)) errors.push({ code: "LOGO_CLEARSPACE", field: id, message: "Nothing may sit within the logo's clear space; " + (rules.names[id] || id) + " does." });
  for (let i = 0; i < textIds.length; i++) {
    for (const other of [...textIds.slice(i + 1), ...imageIds, "seal"]) {
      if (rects[other] && inter(rects[textIds[i]], rects[other], textIds.includes(other) ? 4 : 8)) errors.push({ code: "OVERLAP", field: textIds[i], message: (rules.names[textIds[i]] || textIds[i]) + " runs into " + (rules.names[other] || other) + "." });
    }
  }
  if (rects.seal && rects.product && inter(rects.seal, rects.product, 8)) errors.push({ code: "OVERLAP", field: "seal", message: "The trust seal runs into the product." });
  for (const [a, b] of rules.apart || []) if (rects[a] && rects[b] && inter(rects[a], rects[b], 8)) errors.push({ code: "OVERLAP", field: a, message: (rules.names[a] || a) + " runs into " + (rules.names[b] || b) + "." });
  // Frame and safe zones.
  const M = rules.margin;
  for (const id of [...textIds, ...ids("image"), ...ids("panel"), "logo", "seal"]) {
    const r = rects[id]; if (!r || (rules.bleed || []).includes(id)) continue;
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

export const FIELD_NAMES = { h1: "Headline line 1", h2: "Headline line 2", head: "The headline", sub: "The subheadline", deadline: "The deadline line", proofline: "The proof line", p1: "Proof line 1", p2: "Proof line 2", p3: "Proof line 3", cta: "The button text", contact: "The contact line", contact2: "The email line", seal: "The trust seal", photo: "the scene photo", card: "the scene card", bubble: "the speech bubble", product: "the product", logo: "the logo" };

BUILDERS.t1 = buildT1;
BUILDERS.t4 = buildT4;
BUILDERS.t2 = buildT2;
BUILDERS.t3 = buildT3;
BUILDERS.t5 = buildT5;

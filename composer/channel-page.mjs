// HTML for one social / banner / email image, plus the in-page script that fits the copy and checks
// the layout. Separate from the Meta ad composer (page.mjs / templates.mjs): it reuses only the
// bundled Montserrat files, the logo files and the allowed-glyph rule.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "../server/config.mjs";
import { ALLOWED_TEXT } from "./page.mjs";
import { safeArea, modeFor, BACKGROUNDS, FIELD_LABELS } from "../core/channels.mjs";

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve("@fontsource/montserrat/package.json")), "files");
export const CHANNEL_FONT_WEIGHTS = [500, 600, 700, 800];

let fontCss = null;
function fonts() {
  if (fontCss) return fontCss;
  fontCss = CHANNEL_FONT_WEIGHTS.map((w) => {
    const b64 = fs.readFileSync(path.join(FONT_DIR, `montserrat-latin-${w}-normal.woff2`)).toString("base64");
    return `@font-face{font-family:"HLMontserrat";font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
  }).join("\n");
  return fontCss;
}
const logos = {};
function logoUri(colour) {
  if (!logos[colour]) logos[colour] = "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "assets", "logos", colour === "black" ? "hitlights-logo-black.png" : "hitlights-logo-white.png")).toString("base64");
  return logos[colour];
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const px = (n) => Math.round(n) + "px";

// Characters the bundled font can't draw would silently switch typeface.
export function glyphProblems(fields) {
  const out = [];
  for (const [k, v] of Object.entries(fields)) if (v && !ALLOWED_TEXT.test(v)) out.push({ field: k, message: `${FIELD_LABELS[k] || k} has a character the brand font can't draw (${[...v].filter((c) => !ALLOWED_TEXT.test(c)).join(" ")}).` });
  return out;
}

// spec: {format, style, background, fields, showProduct}; images: {product: dataUri|null, photo: dataUri|null}
export function buildChannelHtml(spec, images) {
  const f = spec.format, S = safeArea(f), mode = modeFor(f), style = spec.style;
  const bg = BACKGROUNDS[spec.background] ? spec.background : "violet";
  const dark = bg !== "cream";
  const T = { ...spec.fields };
  if (f.noCta) { T.url = T.url || "hitlights.com"; T.cta = ""; }
  const product = spec.showProduct && images.product && !(style === "text" && mode !== "tall") && !(style === "promo" && mode === "strip") ? images.product : null;
  const u = Math.min(S.w, S.h); // type scale unit
  const ink = dark ? "#FFFFFF" : "#232323", accent = dark ? "#FBCA10" : "#523875", eyebrowC = dark ? "#FBCA10" : "#675185";
  const subC = dark ? "rgba(255,255,255,.88)" : "#3d3348";

  // Font size ranges [max, min] per field, scaled from the safe area.
  const R = {
    tall: { eyebrow: [0.042, 0.026], h: [0.105, 0.05], sub: [0.046, 0.03], cta: [0.044, 0.03], url: [0.03, 0.022], offer: [0.07, 0.04] },
    wide: { eyebrow: [0.058, 0.034], h: [0.14, 0.06], sub: [0.064, 0.04], cta: [0.06, 0.04], url: [0.042, 0.03], offer: [0.1, 0.06] },
    strip: { eyebrow: [0.15, 0.1], h: [0.3, 0.12], sub: [0.15, 0.09], cta: [0.17, 0.1], url: [0.14, 0.09], offer: [0.2, 0.11] },
  }[mode];
  if (style === "text") { R.h = [R.h[0] * 1.25, R.h[1]]; }
  const sz = (k) => [Math.round(R[k][0] * u), Math.max(11, Math.round(R[k][1] * u))];
  const fit = (k, lines) => { const [mx, mn] = sz(k); return `data-fit data-max="${mx}" data-min="${mn}" data-lines="${lines}" style="font-size:${mx}px"`; };
  const center = style === "text" && mode !== "strip";

  const showSub = !!T.sub && mode !== "strip"; // strips carry one headline line only
  const showUrl = !!T.url && (mode !== "strip" || !T.cta);
  const logoH = Math.round(u * (mode === "strip" ? 0.17 : mode === "wide" ? 0.066 : 0.055));
  const logo = `<img id="logo" data-role="logo" src="${logoUri(dark ? "white" : "black")}" style="height:${logoH}px" alt="">`;
  const offer = style === "promo" && T.offer ? `<div id="offer" class="offer" ${fit("offer", 2)}><span class="t">${esc(T.offer)}</span></div>` : "";
  const cta = T.cta ? `<div class="ctarow"><div id="cta" class="cta" ${fit("cta", 1)}>${esc(T.cta)}</div>${showUrl && mode !== "tall" ? `<div id="url" class="url" ${fit("url", 1)}>${esc(T.url)}</div>` : ""}</div>` : (showUrl && mode !== "tall" ? `<div class="ctarow"><div id="url" class="url" ${fit("url", 1)}>${esc(T.url)}</div></div>` : "");
  const stripCopy = `<div id="copy" class="copy">
    <div id="headline" class="headline" ${fit("h", 2)}>${esc(T.headline)}${T.headline2 ? ` <span class="h2">${esc(T.headline2)}</span>` : ""}</div>
    ${showSub ? `<div id="sub" class="sub" ${fit("sub", 1)}>${esc(T.sub)}</div>` : ""}
  </div>`;
  const copy = mode === "strip" ? stripCopy : `<div id="copy" class="copy">
    ${T.eyebrow ? `<div id="eyebrow" class="eyebrow" ${fit("eyebrow", 1)}>${esc(T.eyebrow)}</div>` : ""}
    <div id="headline" class="headline" ${fit("h", mode === "strip" ? 1 : 3)}>${esc(T.headline)}</div>
    ${T.headline2 ? `<div id="headline2" class="headline2" ${fit("h", mode === "strip" ? 1 : 3)}>${esc(T.headline2)}</div>` : ""}
    ${showSub ? `<div id="sub" class="sub" ${fit("sub", mode === "strip" ? 1 : 3)}>${esc(T.sub)}</div>` : ""}
  </div>`;
  const productTag = product ? `<div id="product" class="productbox"><div class="glow"></div><img data-role="product" src="${product}" alt="">${offer && mode !== "strip" ? offer : ""}</div>` : "";

  let body;
  if (mode === "strip") {
    body = `<div class="safe strip">${logo}<div class="divider"></div>${copy}${productTag}${offer}${cta}</div>`;
  } else if (mode === "wide") {
    if (center || !product) {
      body = `<div class="safe widec">${logo}${copy}${offer}${cta}</div>`;
    } else {
      body = `<div class="safe wide"><div class="col">${logo}${copy}${cta}</div>${productTag}</div>`;
    }
  } else {
    const footer = (T.cta || showUrl) ? `<div class="footer">${T.cta ? `<div id="cta" class="cta" ${fit("cta", 1)}>${esc(T.cta)}</div>` : "<span></span>"}${showUrl ? `<div id="url" class="url" ${fit("url", 1)}>${esc(T.url)}</div>` : ""}</div>` : "";
    body = `<div class="safe tall ${center ? "center" : ""}"><div class="top">${logo}</div>${copy}${product ? productTag : (offer ? `<div class="offerwrap">${offer}</div>` : "")}${footer}</div>`;
  }

  // Backgrounds: brand graphics, or a photo with a legibility scrim on the copy side.
  const dots = `radial-gradient(circle, rgba(251,202,16,.42) ${Math.max(1.5, u * 0.004)}px, transparent ${Math.max(2, u * 0.0045)}px) 0 0/${px(u * 0.035)} ${px(u * 0.035)}`;
  let bgCss;
  if (bg === "cream") bgCss = `background:#FBF6EE`;
  else if (bg === "night") bgCss = `background:radial-gradient(ellipse at ${mode === "tall" ? "50% 68%" : "72% 55%"}, rgba(235,168,0,.30), transparent 55%), linear-gradient(180deg,#241A30,#120C18)`;
  else if (bg === "photo" && images.photo) {
    const scrim = mode === "tall"
      ? "linear-gradient(180deg, rgba(18,12,24,.86) 0%, rgba(18,12,24,.55) 38%, rgba(18,12,24,.15) 62%, rgba(18,12,24,.72) 100%)"
      : center ? "linear-gradient(90deg, rgba(18,12,24,.55), rgba(18,12,24,.75) 50%, rgba(18,12,24,.55))"
        : "linear-gradient(90deg, rgba(18,12,24,.9) 0%, rgba(18,12,24,.72) 42%, rgba(18,12,24,.12) 75%)";
    bgCss = `background:${scrim}, url(${images.photo}) center/cover no-repeat, #241A30`;
  } else bgCss = `background:linear-gradient(135deg,#523875 0%,#3f2a5c 60%,#2e1f45 100%)`;
  const dotLayer = bg === "violet" ? `<div class="dots"></div>` : "";

  const gap = Math.round(u * (mode === "strip" ? 0.06 : 0.035));
  const css = `
${fonts()}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${px(f.W)};height:${px(f.H)};overflow:hidden}
body{font-family:"HLMontserrat";-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;position:relative;${bgCss};color:${ink}}
.dots{position:absolute;left:0;bottom:0;width:${px(f.W * 0.42)};height:${px(f.H * 0.42)};background:${dots};opacity:.55;-webkit-mask-image:radial-gradient(circle at 0 100%, #000 0%, transparent 70%)}
.safe{position:absolute;left:${px(S.x)};top:${px(S.y)};width:${px(S.w)};height:${px(S.h)};display:flex}
.copy{display:flex;flex-direction:column;gap:${px(gap * 0.45)};min-height:0;min-width:0;overflow:hidden}
#logo{flex:0 0 auto;align-self:flex-start;width:auto;max-width:100%;object-fit:contain}
.widec #logo,.tall.center #logo{align-self:center}
.strip #logo{align-self:center}
.headline,.headline2,.sub{text-wrap:balance}
.eyebrow{font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${eyebrowC};line-height:1.2}
.headline{font-weight:800;color:${accent};line-height:1.04;letter-spacing:-.015em}
.headline2{font-weight:700;color:${ink};line-height:1.04;letter-spacing:-.015em}
.sub{font-weight:500;color:${subC};line-height:1.3}
.cta{display:inline-block;background:#EBA800;color:#232323;font-weight:800;border-radius:999px;padding:.55em 1.25em;white-space:nowrap;line-height:1.1;box-shadow:0 .25em .7em rgba(0,0,0,.28)}
.url{font-weight:600;color:${dark ? "rgba(255,255,255,.8)" : "#523875"};white-space:nowrap;line-height:1.2}
.ctarow{display:flex;align-items:center;gap:${px(gap)};flex:0 0 auto}
.offer{display:flex;align-items:center;justify-content:center;text-align:center;background:#FBCA10;color:#232323;font-weight:800;text-transform:uppercase;border-radius:999px;padding:.45em .9em;line-height:1.05;box-shadow:0 .3em .9em rgba(0,0,0,.3);max-width:100%}
.productbox{position:relative;display:flex;align-items:center;justify-content:center;min-height:0;min-width:0}
.productbox img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 ${px(u * 0.02)} ${px(u * 0.03)} rgba(0,0,0,${dark ? 0.45 : 0.22}))}
.productbox .glow{position:absolute;inset:8%;border-radius:50%;background:radial-gradient(circle, rgba(251,202,16,${dark ? 0.32 : 0.22}), transparent 68%)}
.productbox .offer{position:absolute;top:0;right:0;max-width:60%}
/* tall: logo, copy, product (keeps at least ~34% of the height), footer */
.tall{flex-direction:column;gap:${px(gap)}}
.tall .copy{flex:0 0 auto}
.tall .productbox{flex:1 1 0;min-height:${px(S.h * (style === "text" ? 0.2 : 0.34))}}
.tall.center{text-align:center}.tall.center .top{display:flex;justify-content:center}
.tall.center .copy{flex:1 1 auto;justify-content:safe center;align-items:center}
.tall.center .productbox{flex:0 0 ${px(S.h * 0.24)}}
.tall .offerwrap{flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0}
.footer{display:flex;justify-content:space-between;align-items:center;gap:${px(gap)};flex:0 0 auto}
.tall.center .footer{justify-content:center;flex-direction:column}
/* wide: copy column + product */
.wide{flex-direction:row;gap:${px(gap * 1.4)}}
.wide .col{flex:0 0 56%;display:flex;flex-direction:column;justify-content:safe center;gap:${px(gap)};min-width:0;min-height:0}
.wide .col .copy{flex:0 0 auto}
.wide .productbox{flex:1 1 0;align-self:stretch}
.widec{flex-direction:column;align-items:center;justify-content:safe center;text-align:center;gap:${px(gap)}}
.widec .copy{align-items:center;flex:0 0 auto;max-width:86%}
/* strip: one row */
.strip{flex-direction:row;align-items:center;gap:${px(gap)}}
.strip .divider{width:2px;align-self:stretch;margin:6% 0;background:${dark ? "rgba(255,255,255,.28)" : "rgba(82,56,117,.3)"}}
.strip .copy{flex:1 1 0;justify-content:safe center;gap:${px(gap * 0.2)}}
.strip .headline{line-height:1.08}.strip .headline .h2{color:${ink};font-weight:700}

.strip .productbox{flex:0 0 auto;height:100%;width:${px(S.h * 0.95)}}
.strip .offer{flex:0 0 auto}
`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${dotLayer}${body}</body></html>`;
}

// Runs in the page: shrink every fitted text together until the copy fits its box and each line
// limit holds, then report anything that still doesn't fit at the minimum sizes.
export function channelPageScript(rules) {
  const els = [...document.querySelectorAll("[data-fit]")];
  const set = (s) => { for (const e of els) { const mx = +e.dataset.max, mn = +e.dataset.min; e.style.fontSize = Math.max(mn, mx * s) + "px"; } };
  const lineCount = (e) => { const cs = getComputedStyle(e), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.1; const h = e.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth); return Math.round(h / lh); };
  const boxes = [...document.querySelectorAll(".copy, .footer, .ctarow, .col, .safe")];
  // Tight headline leading lets Montserrat's ascenders/descenders overhang the line box by a few
  // pixels; that is not overflow, so allow a fraction of the largest type in the box.
  const tol = (b) => { let m = 0; for (const e of b.querySelectorAll("[data-fit]")) m = Math.max(m, parseFloat(e.style.fontSize) || 0); return Math.max(2, m * 0.2); };
  const overflowing = () => boxes.filter((b) => { const t = tol(b); return b.scrollHeight > b.clientHeight + t || b.scrollWidth > b.clientWidth + 2; });
  const tooManyLines = () => els.filter((e) => getComputedStyle(e).display !== "inline" && lineCount(e) > +e.dataset.lines);
  const S = rules.safe;
  const outside = () => [...document.querySelectorAll("[data-fit], [data-role]")].filter((e) => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return r.left < S.x - 1 || r.top < S.y - 1 || r.right > S.x + S.w + 1 || r.bottom > S.y + S.h + 1;
  });
  const ok = () => !overflowing().length && !tooManyLines().length && !outside().length;
  let lo = 0.2, hi = 1;
  set(1);
  if (ok()) lo = 1;
  else {
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; set(mid); if (ok()) lo = mid; else hi = mid; }
    set(lo);
  }
  const errors = [];
  const names = rules.names || {};
  if (!ok()) {
    const bad = new Set();
    for (const e of tooManyLines()) bad.add(e.id);
    for (const b of overflowing()) for (const e of b.querySelectorAll("[data-fit]")) bad.add(e.id);
    for (const e of outside()) if (e.id) bad.add(e.id);
    if (!bad.size) bad.add("headline");
    errors.push({ code: "FIT", message: "The copy doesn't fit this size even at the smallest legible type: shorten " + [...bad].map((id) => names[id] || id).join(", ") + "." });
  }
  // Everything visible must sit inside the safe area.
  for (const e of outside()) errors.push({ code: "SAFE", message: (names[e.id] || e.dataset.role || e.id) + " runs outside the area this placement always shows." });
  const p = document.querySelector("[data-role=product]");
  if (p && p.getBoundingClientRect().height < rules.minProduct) errors.push({ code: "PRODUCT", message: "The product ends up too small to read at this size — shorten the copy or pick the Announcement style." });
  return { ok: !errors.length, errors, scale: lo };
}

// Brand-layer templates: the ad is built from these exact layouts, not drawn by the image model.
// Source of truth: reference/HitLights_Ad_Templates.html (colours, type, element order) and the
// Logo Grid in core/brand.mjs (logo colourway, position and width per size). The image model only
// supplies the scene photograph; the product is the real photo (background removed), and every
// word, the CTA and the logo are set here in Montserrat, so they are identical on every render.
//
// Units are pixels of the finished file. Each size lists its boxes; the page script (page.mjs)
// fits text into them and then checks the layout rules (no overlaps, safe zones, fonts present)
// before anything is rendered or paid for.
import { BRAND, LOGOGRID, CANVAS, LOGO_AR } from "../core/brand.mjs";

export { COMPOSED_TEMPLATES, isComposed } from "../core/composed.mjs";

// The scene photograph is rendered once per set at this aspect ratio and cropped into each size's
// photo box (object-fit: cover), so one paid render serves all three sizes.
export const SCENE_ASPECT = "1:1";

// Text sizes are [max, min] in px. Text starts at max and shrinks until it fits; below min the
// layout fails (with the field named) instead of squeezing.
const T1 = {
  master: {
    logo: { x: 64, y: 64, w: 280 },
    head: { x: 64, y: 150, w: 952, h1: [76, 50], h2: [54, 36] },
    proof: { x: 64, w: 368, size: [30, 23], lines: 2, gap: 16, below: 36 },
    photo: { x: 456, y: 330, w: 560, h: 520, r: 24 },
    product: { x: 64, y: 548, w: 420, h: 340 },
    seal: { cx: 926, cy: 800, d: 180 },
    cta: { cx: 736, y: 902, h: 80, maxW: 560, size: [32, 24] },
    contact: { cx: 736, y: 1004, maxW: 600, size: [21, 16] },
    dots: { w: 486, h: 400 },
  },
  portrait: {
    logo: { x: 64, y: 288, w: 320 },
    head: { x: 64, y: 380, w: 952, h1: [96, 60], h2: [68, 44] },
    proof: { x: 64, w: 952, size: [38, 28], lines: 1, gap: 18, below: 44 },
    photo: { x: 64, y: 820, w: 952, h: 440, r: 28 },
    product: { x: 64, y: 1010, w: 470, h: 360 },
    seal: { cx: 906, cy: 1210, d: 210 },
    cta: { cx: 540, y: 1388, h: 88, maxW: 900, size: [36, 26] },
    contact: { cx: 540, y: 1496, maxW: 952, size: [24, 18] },
    dots: { w: 560, h: 620 },
    safe: { top: 269, bottom: 1536 },
  },
  landscape: {
    logo: { x: 56, y: 48, w: 240 },
    head: { x: 56, y: 116, w: 540, h1: [50, 32], h2: [38, 26] },
    proof: { x: 56, w: 420, size: [22, 17], lines: 1, gap: 10, below: 22 },
    photo: { x: 640, y: 48, w: 504, h: 512, r: 20 },
    product: { x: 500, y: 300, w: 270, h: 288 },
    seal: { cx: 1078, cy: 494, d: 144 },
    cta: { x: 56, y: 470, h: 60, maxW: 400, size: [24, 18] },
    contact: { x: 56, y: 552, maxW: 430, size: [16, 12] },
    dots: { w: 360, h: 300 },
  },
};

export const LAYOUTS = { t1: T1 };

// The trust seal only repeats a proof line that is a certification or warranty (brand rule).
const SEAL_RX = /\b(warrant(y|ied)|UL|ETL|cETL|listed|certified|certification|DLC|Energy Star|FCC|RoHS|CE)\b/i;
export function sealText(form) {
  const p = ["p1", "p2", "p3"].map((k) => String(form[k] || "").trim()).find((v) => v && SEAL_RX.test(v));
  return p || "";
}

// Everything the page needs for one size. Pure data; page.mjs turns it into HTML.
export function layoutFor(tpl, kind, form) {
  const L = LAYOUTS[tpl] && LAYOUTS[tpl][kind];
  if (!L) throw new Error("No composed layout for " + tpl + " " + kind);
  const C = CANVAS[kind], G = LOGOGRID[tpl];
  // The logo follows the Logo Grid exactly (position, width, colourway).
  const [lx, ly] = G.pos[kind];
  if (lx !== L.logo.x || ly !== L.logo.y || C.w !== L.logo.w) throw new Error("Layout logo box disagrees with the Logo Grid for " + tpl + " " + kind);
  const proof = ["p1", "p2", "p3"].map((k) => String(form[k] || "").trim()).filter(Boolean);
  const contact = [form.phone, form.email].map((v) => String(v || "").trim()).filter(Boolean).join("  ·  ");
  return {
    tpl, kind, W: C.W, H: C.H, L,
    logo: { colour: G.colour, x: lx, y: ly, w: C.w, h: Math.round(C.w * LOGO_AR) },
    text: { h1: String(form.h1 || "").trim(), h2: String(form.h2 || "").trim(), proof, cta: String(form.cta || "").trim(), contact, seal: sealText(form) },
    colours: { field: BRAND.purpleDeep, gold: BRAND.gold, goldBright: BRAND.goldBright, ink: BRAND.ink },
  };
}

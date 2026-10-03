// Brand-layer templates: the ad is built from these exact layouts, not drawn by the image model.
// Source of truth: reference/HitLights_Ad_Templates.html (colours, type, element order) and the
// Logo Grid in core/brand.mjs (logo colourway, position and width per size). The image model only
// supplies the scene photograph; the product is the real photo (background removed), and every
// word, the CTA and the logo are set here in Montserrat, so they are identical on every render.
//
// Units are pixels of the finished file. Each size lists its boxes; the page script (page.mjs)
// fits text into them and then checks the layout rules (no overlaps, safe zones, fonts present)
// before anything is rendered or paid for.
import { BRAND, TPL, LOGOGRID, CANVAS, LOGO_AR } from "../core/brand.mjs";

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
    dots: { w: 520, h: 360 },
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
    dots: { x: 420, w: 280, h: 250 },
  },
};

// Template 4, Styled Room Hero: photo on top (left in landscape), cream panel with a narrow violet
// accent bar, ink headline whose last word is gold, the real product standing on the seam between
// photo and panel. No dot texture in this register. bleed: boxes allowed to touch the frame edge.
// Portrait: the logo sits at the top of the cream panel as the black lockup (always legible, inside
// the Stories/Reels safe zone) instead of floating over the photo at the grid's y=288.
const T4 = {
  master: {
    logo: { x: 64, y: 64, w: 280, colour: "white", scrim: true },
    photo: { x: 0, y: 0, w: 1080, h: 594, radius: "0 0 22px 22px" },
    bar: { x: 0, y: 594, w: 28, h: 486 },
    col: { x: 112, y: 594, w: 548, h: 486, pad: [36, 40], align: "center" },
    head: { h1: [60, 40], h2: [60, 40] },
    proof: { size: [28, 20], lines: 1, gap: 8 },
    cta: { h: 66, maxW: 548, size: [28, 20] },
    contact: { maxW: 548, size: [19, 14] },
    product: { x: 690, y: 300, w: 340, h: 330 },
    seal: { cx: 936, cy: 144, d: 168 },
    bleed: ["photo"], ground: ["photo"],
  },
  portrait: {
    logo: { w: 320, colour: "black", inPanel: true },
    photo: { x: 0, y: 0, w: 1080, h: 820, radius: "0 0 28px 28px" },
    bar: { x: 0, y: 820, w: 36, h: 1100 },
    col: { x: 112, y: 820, w: 860, h: 716, pad: [40, 0], align: "start" },
    head: { h1: [92, 56], h2: [92, 56] },
    proof: { size: [38, 28], lines: 1, gap: 10 },
    cta: { h: 92, maxW: 860, size: [38, 26] },
    contact: { maxW: 860, size: [27, 20] },
    product: { x: 650, y: 460, w: 390, h: 400 },
    seal: { cx: 170, cy: 690, d: 190 },
    safe: { top: 269, bottom: 1536 },
    bleed: ["photo"], ground: ["photo"],
  },
  landscape: {
    logo: { x: 56, y: 48, w: 240, colour: "white", scrim: true },
    photo: { x: 0, y: 0, w: 660, h: 628, radius: "0 22px 22px 0" },
    bar: { x: 660, y: 0, w: 16, h: 628 },
    col: { x: 712, y: 0, w: 440, h: 628, pad: [48, 48], align: "center" },
    head: { h1: [44, 30], h2: [44, 30] },
    proof: { size: [19, 15], lines: 1, gap: 9 },
    cta: { h: 54, maxW: 440, size: [22, 17] },
    contact: { maxW: 440, size: [14, 12] },
    product: { x: 430, y: 318, w: 260, h: 266 },
    seal: { cx: 568, cy: 112, d: 124 },
    bleed: ["photo"], ground: ["photo"],
  },
};

// Template 2, Speech-Bubble Hero: the photo is the ground; a white rounded speech bubble carries the
// black logo (centred), the ink headline, the proof points on one line and the gold pill; the real
// product sits in the lower part, clear of the bubble; small white contact line along the bottom.
const T2 = {
  master: {
    logo: { w: 280, colour: "black", inPanel: true },
    bubble: { x: 65, y: 43, w: 950, pad: [40, 48, 44] },
    head: { h1: [62, 42], h2: [62, 42] }, proofline: { size: [26, 18] }, cta: { h: 72, maxW: 600, size: [30, 22] },
    product: { x: 230, y: 560, w: 620, h: 420 },
    contact: { cx: 540, y: 1006, maxW: 900, size: [20, 15] },
    bleed: ["photo"], ground: ["photo", "bubble"], apart: [["product", "bubble"], ["product", "contact"], ["contact", "bubble"]],
  },
  portrait: {
    logo: { w: 320, colour: "black", inPanel: true },
    bubble: { x: 65, y: 269, w: 950, pad: [44, 52, 48] },
    head: { h1: [76, 50], h2: [76, 50] }, proofline: { size: [32, 22] }, cta: { h: 88, maxW: 700, size: [36, 26] },
    product: { x: 140, y: 930, w: 800, h: 520 },
    contact: { cx: 540, y: 1488, maxW: 950, size: [26, 18] },
    safe: { top: 269, bottom: 1536 },
    bleed: ["photo"], ground: ["photo", "bubble"], apart: [["product", "bubble"], ["product", "contact"], ["contact", "bubble"]],
  },
  landscape: {
    logo: { w: 240, colour: "black", inPanel: true },
    bubble: { x: 40, y: 63, w: 600, pad: [28, 32, 30] },
    head: { h1: [44, 28], h2: [44, 28] }, proofline: { size: [18, 13] }, cta: { h: 54, maxW: 420, size: [22, 16] },
    product: { x: 680, y: 70, w: 480, h: 500 },
    contact: { cx: 340, y: 560, maxW: 600, size: [15, 12] },
    bleed: ["photo"], ground: ["photo", "bubble"], apart: [["product", "bubble"], ["product", "contact"], ["contact", "bubble"]],
  },
};

// Template 3, Discount Deadline: dark violet gradient with a gold/violet glow, the offer huge in
// bright gold, line two in white, the real product on a tilted card made from the (blurred) scene
// photo, then the deadline line and the gold button (rounded rectangle, not a pill).
const T3 = {
  master: {
    logo: { x: 64, y: 64, w: 280 },
    head: { x: 64, y: 210, w: 952, h1: [170, 96], h2: [46, 30] },
    card: { x: 548, y: 500, w: 440, h: 330, rot: -6 },
    product: { x: 560, y: 470, w: 420, h: 390, rot: -6 },
    bottom: { x: 64, y: 1016, w: 440 },
    deadline: { size: [30, 20] }, cta: { h: 80, maxW: 440, size: [32, 22] },
    glow: { cx: 760, cy: 640, r: 420 },
    apart: [["card", "deadline"], ["card", "cta"], ["product", "deadline"], ["product", "cta"]],
  },
  portrait: {
    logo: { x: 64, y: 288, w: 320 },
    head: { x: 64, y: 400, w: 952, h1: [210, 120], h2: [60, 38] },
    card: { x: 150, y: 860, w: 780, h: 420, rot: -6 },
    product: { x: 200, y: 800, w: 680, h: 500, rot: -6 },
    bottom: { x: 64, y: 1530, w: 900 },
    deadline: { size: [40, 26] }, cta: { h: 96, maxW: 700, size: [40, 28] },
    glow: { cx: 540, cy: 1050, r: 560 },
    safe: { top: 269, bottom: 1536 },
    apart: [["card", "deadline"], ["card", "cta"], ["product", "deadline"], ["product", "cta"]],
  },
  landscape: {
    logo: { x: 56, y: 48, w: 240 },
    head: { x: 56, y: 116, w: 560, h1: [104, 60], h2: [30, 20] },
    card: { x: 680, y: 120, w: 440, h: 330, rot: -6 },
    product: { x: 690, y: 80, w: 420, h: 420, rot: -6 },
    bottom: { x: 56, y: 580, w: 560 },
    deadline: { size: [22, 16] }, cta: { h: 56, maxW: 400, size: [24, 17] },
    glow: { cx: 900, cy: 320, r: 360 },
    apart: [["card", "deadline"], ["card", "cta"], ["product", "deadline"], ["product", "cta"], ["card", "head"], ["product", "head"]],
  },
};

// Template 5, Glow Room Hero: a dark warm interior is the ground, gently darkened behind the type;
// everything white with a soft shadow; gold pill with an arrow; the real product large and glowing
// in the foreground, running off the frame edge. No panels, no violet.
const T5 = {
  master: {
    logo: { x: 400, y: 64, w: 280, colour: "white" },
    stack: { x: 90, y: 160, w: 900, align: "center" },
    head: { h1: [104, 64], h2: [104, 64] }, sub: { size: [34, 24], lines: 2 }, cta: { h: 76, maxW: 640, size: [30, 22] },
    product: { x: -40, y: 640, w: 560, h: 470 },
    contact: { stacked: true, right: 64, y: 958, maxW: 520, size: [20, 15] },
    scrim: "radial-gradient(ellipse 75% 62% at 50% 22%,rgba(0,0,0,.55),rgba(0,0,0,.25) 60%,transparent 85%)",
    bleed: ["photo", "product"], ground: ["photo"], apart: [["product", "contact"], ["product", "cta"]],
  },
  portrait: {
    logo: { x: 380, y: 288, w: 320, colour: "white" },
    stack: { x: 80, y: 380, w: 920, align: "center" },
    head: { h1: [128, 76], h2: [128, 76] }, sub: { size: [42, 28], lines: 2 }, cta: { h: 92, maxW: 760, size: [36, 26] },
    contact: { inline: true, maxW: 920, size: [26, 18] },
    product: { x: -60, y: 1240, w: 1200, h: 720 },
    scrim: "linear-gradient(180deg,rgba(0,0,0,.6) 0%,rgba(0,0,0,.35) 45%,transparent 70%)",
    safe: { top: 269, bottom: 1536 },
    bleed: ["photo", "product"], ground: ["photo"], apart: [["product", "contact"], ["product", "cta"]],
  },
  landscape: {
    logo: { x: 904, y: 48, w: 240, colour: "white" },
    stack: { x: 600, y: 120, w: 544, align: "end" },
    head: { h1: [74, 44], h2: [74, 44] }, sub: { size: [24, 16], lines: 2 }, cta: { h: 56, maxW: 420, size: [24, 17] },
    product: { x: -40, y: 210, w: 600, h: 460 },
    scrim: "linear-gradient(270deg,rgba(0,0,0,.6) 0%,rgba(0,0,0,.3) 45%,transparent 70%)",
    bleed: ["photo", "product"], ground: ["photo"], apart: [["product", "cta"]],
  },
};

export const LAYOUTS = { t1: T1, t2: T2, t3: T3, t4: T4, t5: T5 };

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
  // The logo follows the Logo Grid (position, width, colourway), except where a layout places it
  // in its own panel (inPanel: position set by the panel's flow, width still from the grid).
  const [lx, ly] = L.logo.inPanel ? [null, null] : G.pos[kind];
  if (C.w !== L.logo.w || (!L.logo.inPanel && (lx !== L.logo.x || ly !== L.logo.y))) throw new Error("Layout logo box disagrees with the Logo Grid for " + tpl + " " + kind);
  const T = TPL[tpl];
  const proof = T.proof === "none" ? [] : ["p1", "p2", "p3"].map((k) => String(form[k] || "").trim()).filter(Boolean);
  const phone = String(form.phone || "").trim(), email = String(form.email || "").trim();
  const showContact = T.contact && !(T.contactIn && T.contactIn[kind] === "");
  const contact = showContact ? [phone, email].filter(Boolean).join(T.contactIn && T.contactIn[kind] === "inline" ? "  |  " : "  ·  ") : "";
  return {
    tpl, kind, W: C.W, H: C.H, L,
    logo: { colour: L.logo.colour || G.colour, x: lx, y: ly, w: C.w, h: Math.round(C.w * LOGO_AR), inPanel: !!L.logo.inPanel, scrim: !!L.logo.scrim },
    text: {
      h1: String(form.h1 || "").trim(), h2: String(form.h2 || "").trim(), proof, cta: String(form.cta || "").trim(), contact,
      phone: showContact ? phone : "", email: showContact ? email : "",
      sub: T.sub ? String(form.sub || "").trim() : "", deadline: T.deadline ? String(form.deadline || "").trim() : "",
      seal: T.seal ? sealText(form) : "",
    },
    colours: { field: BRAND.purpleDeep, purple: BRAND.purple, gold: BRAND.gold, goldBright: BRAND.goldBright, ink: BRAND.ink, cream: BRAND.cream, promoTop: BRAND.promoTop, promoBottom: BRAND.promoBottom },
  };
}

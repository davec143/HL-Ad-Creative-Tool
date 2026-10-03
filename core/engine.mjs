// HitLights Ad Builder engine: prompts, Logo Grid specs, copy limits, drafting and QA briefs.
// Pure functions, no DOM and no I/O, so the browser (live previews, limit counters) and the
// server (the real run) share exactly the same code. Ported line-for-line from builder v16
// (legacy/v16/source/b_script.js); tests/parity.test.mjs checks every output byte-for-byte
// against the original script.
//
// `form` is a plain object: {tpl, h1, h2, sub, p1, p2, p3, cta, phone, email, deadline, scene, angle}.
import {
  BRAND, TPL, LIMITS, CANVAS, KINDS, LOGOGRID, FIELD, SAFE_TOP, LOGO_AR, LOGOWHERE, ARFOR,
} from "./brand.mjs";
import { isComposed, COMPOSED_SCENE_TXT } from "./composed.mjs";

export const FORM_FIELDS = ["h1", "h2", "sub", "p1", "p2", "p3", "cta", "phone", "email", "deadline", "scene", "angle"];

export function tplOf(id) { return TPL[id] || TPL.t1; }
function val(form, id) { return form && form[id] != null ? String(form[id]) : ""; }

// Prompt-safe text: one line, straight double quotes turned into closing curly quotes.
export function esc(s) { return String(s || "").replace(/\s+/g, " ").replace(/"/g, "”").trim(); }

// ---------- Logo Grid ----------
export function gridSpec(id, kind) {
  const G = LOGOGRID[id] || LOGOGRID.t1, C = CANVAS[kind], p = G.pos[kind];
  const a = typeof G.a === "string" ? G.a : G.a[kind];
  const s = { x: p[0], y: p[1], w: C.w, colour: G.colour, shadow: G.shadow, ground: G.ground, even: G.even, field: FIELD[id] || "-", a: a, where: LOGOWHERE[a] };
  if (G.pad) { s.pad = G.pad[kind]; s.bx = G.bx[kind]; }
  if (G.grad) s.grad = G.grad;
  if (kind === "portrait") s.safeTop = SAFE_TOP;
  // The zone (logo + clear space) as % of the RENDER frame, for the prompt. The 16:9 landscape
  // render loses ~3.5% top and bottom when it is trimmed to 1200x628.
  const lh = Math.round(C.w * LOGO_AR), pd = Math.round(lh * .6);
  const fx = (v) => v / C.W * 100;
  const fy = (v) => { const f = v / C.H; return (kind === "landscape" ? .0348 + f * .9304 : f) * 100; };
  s.zone = [fx(p[0] - pd), fy(p[1] - pd), fx(p[0] + C.w + pd), fy(p[1] + lh + pd)].map((v) => Math.max(0, Math.round(v)));
  return s;
}

// Exactly what finishing/finish.py reads.
export function finishSpec(L) {
  const s = { x: L.x, y: L.y, w: L.w, colour: L.colour, shadow: !!L.shadow, ground: L.ground, even: !!L.even, field: L.field || "-" };
  if (L.pad != null) { s.pad = L.pad; s.bx = L.bx; }
  if (L.safeTop != null) s.safeTop = L.safeTop;
  if (L.grad) s.grad = L.grad;
  return s;
}

// ---------- copy limits ----------
export function words(v) { return v.trim() ? v.trim().split(/\s+/).length : 0; }

// Returns {bad: [messages], fields: {id: {msg, over}}}. `bad` empty means the copy fits.
export function checkLimits(form) {
  const id0 = form.tpl, T = tplOf(id0), LM = LIMITS[id0] || {}, bad = [], fields = {};
  function lim(id, max, label, wr) {
    const v = val(form, id).trim(); let msg = "", over = false;
    if (max) {
      msg = v.length + "/" + max;
      if (v.length > max) { over = true; bad.push(label + " is " + v.length + " characters (max " + max + ")"); }
    }
    if (wr && v) {
      const w = words(v); msg += (msg ? " · " : "") + w + " word" + (w === 1 ? "" : "s");
      if (w < wr[0] || w > wr[1]) { over = true; bad.push(label + " is " + w + " words (" + wr[0] + "–" + wr[1] + ")"); }
    }
    fields[id] = { msg, over };
  }
  lim("h1", LM.h1, "Headline line 1"); lim("h2", LM.h2, "Headline line 2");
  lim("sub", T.sub ? LM.sub : 0, "Subheadline", T.sub ? LM.subWords : null);
  lim("deadline", T.deadline ? LM.deadline : 0, "Deadline line");
  ["p1", "p2", "p3"].forEach((p, i) => { lim(p, T.proof === "none" ? 0 : LM.p, "Proof point " + (i + 1)); });
  lim("cta", LM.cta, "CTA", LM.ctaWords);
  if (LM.hl) {
    const tot = val(form, "h1").trim().length + val(form, "h2").trim().length;
    if (tot > LM.hl) bad.push("Headline is " + tot + " characters across both lines (max " + LM.hl + ")");
  }
  return { bad, fields };
}

// Everything Generate checks before a credit is spent. Returns [] or [{title, body}].
export function validateForGenerate(form, { hasImage }) {
  const T = tplOf(form.tpl), v = (id) => val(form, id).trim();
  if (!hasImage) return [{ title: "Pick a product image first", body: "Search the catalog and choose a product, or paste a public image URL." }];
  if (!v("h1") && !v("h2")) return [{ title: "Write a headline", body: "At least one headline line is needed." }];
  if (T.deadline && (!v("h1") || !v("deadline"))) return [{ title: "Add the offer and deadline", body: "Template 3 needs the offer line (e.g. 11% OFF) and the deadline line. Use only a real, approved offer." }];
  if (!v("cta")) return [{ title: "Write the button", body: "The CTA is required." }];
  const { bad } = checkLimits(form);
  if (bad.length) return [{ title: "The copy doesn’t fit this template", body: bad.join(". ") + ". Long copy is what makes the generator shrink, wrap or misspell text." }];
  return [];
}

// ---------- expected text (for the QA check) ----------
export function expectedText(form) {
  const T = tplOf(form.tpl), v = (id) => esc(val(form, id));
  const e = { h1: v("h1"), h2: v("h2"), cta: v("cta"), sub: T.sub ? v("sub") : "", deadline: T.deadline ? v("deadline") : "",
    proof: T.proof === "none" ? [] : [v("p1"), v("p2"), v("p3")].filter(Boolean), contact: {} };
  KINDS.forEach((k) => {
    const cs = !T.contact ? "" : (T.contactIn ? T.contactIn[k] : "line");
    e.contact[k] = cs ? [T.contact ? v("phone") : "", T.contact ? v("email") : ""].filter(Boolean) : [];
  });
  return e;
}

// ---------- render prompts ----------
export function buildPrompt(form, kind) {
  const T = tplOf(form.tpl), f = (id) => esc(val(form, id));
  const h1 = f("h1"), h2 = f("h2"), cta = f("cta"), phone = T.contact ? f("phone") : "", email = T.contact ? f("email") : "", sub = T.sub ? f("sub") : "", dl = T.deadline ? f("deadline") : "";
  // Contact: which form this template uses at this size ("line" by default; T5 varies per canvas).
  const cStyle = !T.contact || !(phone || email) ? "" : (T.contactIn ? T.contactIn[kind] : "line");
  const ctText = cStyle === "stacked" ? [phone, email].filter(Boolean).map((x) => '"' + x + '"').join(" above ")
    : cStyle ? '"' + [phone, email].filter(Boolean).join(cStyle === "inline" ? " | " : " · ") + '"' : "";
  const ct = cStyle ? [phone, email].filter(Boolean).join(cStyle === "inline" ? " | " : " · ") : "";
  const ps = T.proof === "none" ? [] : [f("p1"), f("p2"), f("p3")].filter(Boolean);
  const sys = T.system + " " + T.craft + " " + T.skeleton + " " + BRAND.punch;
  let proofTxt = "";
  if (ps.length && T.proof === "bullets") proofTxt = " Beneath the headline " + ps.length + " short proof line" + (ps.length === 1 ? "" : "s") + ", each preceded by its own small gold round bullet on the same line as its text: " + ps.map((x) => '"' + x + '"').join(", ") + ".";
  if (ps.length && T.proof === "inline") proofTxt = ' Beneath the headline a single short proof line reading "' + ps.join(" | ") + '", the items separated by thin vertical bars.';
  const typo = "[TYPOGRAPHY] Integrated typography, placed as the composition describes. " + BRAND.typeRule + ' A stacked two-line headline reading "' + h1 + '" then "' + h2 + '".' + (sub ? ' Beneath it the subheadline reading "' + sub + '".' : "") + proofTxt +
    (dl ? ' The deadline line reading "' + dl + '".' : "") +
    " Then the CTA: " + T.cta + " The " + T.ctaNoun + ' reads "' + cta + '".' + (cStyle === "stacked" ? " The contact details on two small right-aligned lines reading " + ctText + ", each followed by its small white circular icon." : "") + (cStyle === "inline" || cStyle === "line" ? " A small contact line reading " + ctText + "." : "") +
    " No other words anywhere in the image, apart from markings already printed on the product itself, which stay exactly as in the reference photo.";
  const avoid = "[AVOID] no AI artifacts, no warped or smeared text, no fake words baked into the image, no garbled letters, no melted typography, no fictional logos, no duplicated text, no plastic look, no cartoonish rendering, no extra fingers, no extra limbs, no warped fingers or hands, no melted geometry, no oversaturated HDR, no HDR halos, no flat fluorescent lighting, no generic stock photography poses, no cliche compositions, no random unrelated brand logos, no wordmark, no brand name, no logo of any kind, no ®, no ™, no trademark or copyright symbols, no watermarks, no empty placeholder shapes, blank boxes, tabs or patches, no garbled or half-formed lettering — any marking too small to render cleanly is left blank instead, no flat solid colour bands disconnected from the scene, no text near the top or bottom edge of the frame, no outline or ghost buttons, no colour outside the HitLights palette" + T.avoidExtra + (T.seal ? "" : ", no badge or seal");
  const LG = gridSpec(form.tpl, kind);
  const zt = "inside the box running from " + LG.zone[0] + "% to " + LG.zone[2] + "% of the frame width and from " + LG.zone[1] + "% to " + LG.zone[3] + "% of the frame height";
  const noMark = " Draw no logo, no wordmark, no brand name and no lettering of any kind there, and no brand mark anywhere else in the image either. No registered-trademark or trademark symbol anywhere in the image — no ® and no ™.";
  const logoBlock = LG.ground === "photo"
    ? "[LOGO ZONE — keep this part of the photograph clear]\nThe real HitLights logo is composited afterwards at a FIXED position: " + LG.where + ", " + zt + ". Keep that box calm and fairly dark — a quiet area of the scene such as cabinetry, a shadowed wall or ceiling — with no bright highlights, no text, no product and no objects of interest in it. Every headline, line of text, button, seal and the product sit outside that box. The photograph simply continues through it: do not draw any shape, panel, tab, badge, box, circle or blank patch there to hold the logo." + noMark
    : LG.ground === "bubble"
      ? "[LOGO ZONE — reserved inside the bubble, leave it EMPTY]\nThe real HitLights logo is composited afterwards, centred in the top of the white speech bubble. Leave the top band of the bubble plain, empty white from its top edge down to about " + LG.zone[3] + "% of the frame height, and start the headline below that band." + noMark
      : "[LOGO ZONE — reserved, leave it EMPTY]\nThe real HitLights logo is composited afterwards at a FIXED position: " + LG.where + ", " + zt + ". Keep that box a single flat, uninterrupted stretch of the background colour with nothing drawn or printed in it. The headline starts below that box" + (LG.a === "tl" ? ", its left edge aligned with the box’s left edge" : "") + "." + noMark;
  if (kind === "master") {
    return "[BRAND SYSTEM — HitLights, non-negotiable]\n" + sys + (T.seal ? " " + BRAND.trust : "") + "\n\n[PRODUCT — must match the reference image exactly]\nThe product shown in the reference image. Preserve its exact proportions, hardware details, markings and finish.\n\n[SCENE]\n" + f("scene") + " " + T.photo + "\n\n[COMPOSITION] " + T.master + "\n\n" + logoBlock + "\n\n" + typo + "\n\n[QUALITY] Scroll-stopping, magazine-quality product advertising, hyper-detailed, performance-ad ready.\n\n" + avoid + "\n\nresolution: 2k";
  }
  const layout = kind === "portrait" ? T.portrait : T.landscape;
  return "Recompose this exact advertisement into a " + (kind === "portrait" ? "TALL VERTICAL 9:16" : "WIDE HORIZONTAL 16:9") + " frame. This must read as the same single ad, simply laid out for a different canvas — not a new design.\n\nKEEP IDENTICAL, with no substitutions: the same photograph and the same subject within it, " + T.keep + ", " + (LG.ground === "photo" ? "the same calm, clear area of the photograph where the logo goes" : "the same empty logo space") + ", the same headline word for word (\"" + h1 + "\" then \"" + h2 + "\")" + (ps.length ? ", the same proof points" : "") + (T.seal ? ", the same trust seal if there is one" : "") + (dl ? ", the same deadline line \"" + dl + "\"" : "") + ", the same solid gold " + BRAND.gold + " " + T.ctaNoun + " reading \"" + cta + "\"" + (ct ? ", the same contact line \"" + ct + "\"" : "") + ", the same typeface, weights and colours throughout. The HitLights palette is fixed: " + T.palette + ".\n\n" + logoBlock + "\n\nCHANGE ONLY THE ARRANGEMENT: " + layout + " Keep every element of text comfortably inside the frame with a generous clear margin at the very top and the very bottom." + (kind === "portrait" ? " This frame runs in Stories and Reels, whose interface covers the top 14% and the bottom 20%: keep every line of text, the button and the logo zone between 14% and 80% of the frame height. Only the photograph and the product may extend into the top 14% and bottom 20%." : "") + (kind === "landscape" ? " This frame is trimmed afterwards to 1.91:1, losing about 4% at the top and 4% at the bottom, so keep all text, the button and the logo area at least 8% in from the top and bottom edges." : "") + "\n\n" + avoid + ", no new or different photograph, no changed wording, no changed colours, no extra elements\n\nresolution: 2k";
}

// One Higgsfield render request. Portrait and landscape are built FROM the square master, with the
// product photo alongside so the hardware stays exact.
export function renderParams(kind, { productId, masterJob, prompt }) {
  const medias = kind === "master"
    ? [{ value: productId, role: "image_references" }]
    : [{ value: masterJob, role: "image_references" }, { value: productId, role: "image_references" }];
  return { model: "nano_banana_pro", aspect_ratio: ARFOR[kind], resolution: "2k", count: 1, use_unlim: false, medias, prompt };
}

// A blank placeholder shape painted where the logo goes can't be hidden behind the logo:
// the render is repainted once, only in that box.
export function repaintPrompt(L) {
  const z = L.zone;
  return "Edit this advertisement only where described. Near " + L.where + ", in the box from " + z[0] + "% to " + z[2] + "% of the frame width and " + z[1] + "% to " + z[3] + "% of the frame height, there is a blank, flat, pale shape painted over the photograph. Remove it completely and continue the photograph naturally through that area — the same scene, surfaces, lighting and grain as around it, calm and fairly dark. Change nothing else at all: every word, the typography, the layout, the colours, the panels, the button, the product and the rest of the photograph stay exactly as they are. Do not add any logo, wordmark, lettering, shape or badge anywhere.\n\nresolution: 2k";
}
export function repaintParams(kind, { job, logo }) {
  return { model: "nano_banana_pro", aspect_ratio: ARFOR[kind], resolution: "2k", count: 1, use_unlim: false,
    medias: [{ value: job, role: "image_references" }], prompt: repaintPrompt(logo) };
}

// ---------- run snapshot ----------
export function todayStr(d = new Date()) {
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
export function folderName(productName, d) {
  let nm = productName || "Untitled product";
  if (/^https?:\/\//i.test(nm)) nm = "Untitled product";
  nm = nm.replace(/[\\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
  return todayStr(d) + " " + nm;
}
// Freeze everything a run depends on at the moment Generate is pressed, so edits or a template
// switch while it renders can never make the three sizes disagree.
export function snapshot(form, picked, d) {
  const product = (picked && (picked.title || picked.label)) || "";
  return {
    tpl: form.tpl, tplName: tplOf(form.tpl).name,
    prompts: { master: buildPrompt(form, "master"), portrait: buildPrompt(form, "portrait"), landscape: buildPrompt(form, "landscape") },
    logo: { master: gridSpec(form.tpl, "master"), portrait: gridSpec(form.tpl, "portrait"), landscape: gridSpec(form.tpl, "landscape") },
    expect: expectedText(form), product,
    folder: folderName(product, d), outOfStock: !!(picked && picked.outOfStock), url: picked && picked.url,
  };
}

// ---------- "Write it for me" brief ----------
const REGISTER_TXT = {
  trade: "professional trade — an electrician, contractor or specifier. Reliability, code compliance and install time lead.",
  lifestyle: "consumer lifestyle — a homeowner improving a room. Mood and everyday benefit first, specification second. No trade or job-site framing at all.",
  promo: "time-limited promotion, audience-agnostic — urgency without hype.",
};
const WRITE_TXT = {
  t1: "h1 — headline line one, 2 to 4 words, upper case, ending in a full stop.\n" +
    "h2 — headline line two, 2 to 4 words, upper case, ending in a full stop. Together the two lines are one short sentence or one tight pairing, under 40 characters in total.\n" +
    "p1, p2, p3 — three proof points, each under 28 characters, sentence case, the most concrete facts available.\n" +
    "cta — 2 to 4 words, upper case, an imperative verb first.\n",
  t2: "h1 — headline line one, 2 to 4 words, title case (in the spirit of “LED Kits Built”).\n" +
    "h2 — headline line two, 2 to 4 words, title case, finishing the thought (in the spirit of “for the Job Site”). Under 40 characters in total.\n" +
    "p1, p2, p3 — three very short proof points, each under 20 characters, title case, the most concrete facts available; they will sit on one line separated by vertical bars.\n" +
    "cta — 2 or 3 words, title case (in the spirit of “View Collection”).\n",
  t3: "h1 — return an empty string. The offer is set only by the marketer; never write a discount.\n" +
    "h2 — 2 to 5 words, title case, naming what the offer applies to and that it is limited (in the spirit of “LED Kits — Limited Time”). Do not state a percentage, price or date.\n" +
    "p1, p2, p3 — return empty strings; this template carries no proof points.\n" +
    "cta — 2 or 3 words, title case, an imperative verb first (in the spirit of “Shop Now”).\n",
  t5: "h1 — headline line one, 1 or 2 words, title case (in the spirit of “Built For”).\n" +
    "h2 — headline line two, 1 or 2 words, title case, completing the claim (in the spirit of “Professionals”). Under 26 characters in total across both lines.\n" +
    "sub — subheadline, one benefit sentence of 5 to 8 words, sentence case, no full stop (in the spirit of “Premium LED strips built for consistent performance”). No figures unless they appear in the product data.\n" +
    "p1, p2, p3 — return empty strings; this template carries no proof points.\n" +
    "cta — 2 or 3 words, title case, an imperative verb first (in the spirit of “View Our Collection”). No arrow; the design adds it.\n",
  t4: "h1 — headline line one, 2 to 4 words, sentence case, mood-first, ending in a comma (in the spirit of “Your space,”).\n" +
    "h2 — headline line two, 2 to 4 words, lower case, ending in a full stop. Its final word is the one the ad picks out in gold, so make it the payoff word. Together the two lines are one short sentence, under 40 characters in total.\n" +
    "p1, p2, p3 — three proof points, each under 28 characters, sentence case, leading with the feeling before the spec, the most concrete facts available.\n" +
    "cta — 2 to 4 words, title case, an imperative verb first (in the spirit of “Shop the Look”).\n",
};
export function draftBrief(tplId, product, angle) {
  let known = "";
  if (product && product.title) known += "Product name: " + product.title + "\n";
  if (product && product.desc) known += "Product listing copy: " + product.desc + "\n";
  if (!known) known = "No product listing was available — work only from the angle below.\n";
  angle = String(angle || "").trim();
  const T = tplOf(tplId), reg = T.register;
  let writeTxt = WRITE_TXT[tplId] || "";
  if (!T.sub) writeTxt += "sub — return an empty string; this template has no subheadline.\n";
  const sceneTxt = isComposed(tplId) ? COMPOSED_SCENE_TXT : reg === "promo"
    ? "scene — ONE sentence describing the setting behind an angled product flat-lay: the surface it rests on and the softly lit room behind. Do not describe the product's appearance, do not mention text, logos, colours or layout.\n\n"
    : "scene — ONE sentence describing a photograph: who is in frame, what they are doing, where. Concrete and physical. Do not describe the product's appearance, do not mention text, logos, colours or layout.\n\n";
  return "You write Meta ad creative for HitLights, a California LED lighting supplier selling UL-listed LED strip, dimmers, drivers and accessories to electricians, contractors, commercial specifiers and homeowners.\n\n" +
    "PRODUCT DATA (the only source of fact you have):\n" + known + "\n" +
    "ANGLE REQUESTED: " + (angle || "none given — choose the strongest angle the product data supports") + "\n" +
    "TEMPLATE: " + T.pillar + " — " + T.name + "\n" +
    "REGISTER: " + REGISTER_TXT[reg] + "\n\n" +
    "HARD RULES:\n" +
    "1. Never invent, estimate or round a specification. Use a figure ONLY if it appears in the product data above. If there are no figures there, write benefit-led proof points that state no numbers at all. A wrong number is worse than no number.\n" +
    "2. Claim nothing the product data does not support. Never invent a discount, price, offer or deadline.\n" +
    "3. Voice: confident, practical, specific. No hype, no exclamation marks, no emoji, no ALL-CAPS words inside sentences.\n\n" +
    "WRITE:\n" + writeTxt + sceneTxt +
    "Reply with JSON only, no commentary: {\"h1\":\"\",\"h2\":\"\",\"sub\":\"\",\"p1\":\"\",\"p2\":\"\",\"p3\":\"\",\"cta\":\"\",\"scene\":\"\"}";
}
// Apply a draft reply the way v16 did: only non-empty strings overwrite a field.
export function applyDraft(form, o) {
  const out = { ...form }, T = tplOf(form.tpl);
  const fill = (id, v) => { if (typeof v === "string" && v.trim()) out[id] = v.trim(); };
  fill("h1", o.h1); fill("h2", o.h2); if (T.sub) fill("sub", o.sub);
  fill("p1", o.p1); fill("p2", o.p2); fill("p3", o.p3);
  fill("cta", o.cta); fill("scene", o.scene);
  return out;
}

// ---------- text & logo check (vision QA) ----------
// group: [{dims, title, kind, logo}]; E: expectedText(form).
export function qaPrompt(E, group) {
  const L = [];
  L.push("You are the final quality check on HitLights paid-social ads before they run. You are given " + group.length + " finished ad image" + (group.length > 1 ? "s" : "") + ", in this order: " + group.map((x, i) => (i + 1) + ") " + x.dims + " " + x.title.toLowerCase()).join(", ") + ".");
  L.push("");
  L.push("EXPECTED TEXT — the only words that may appear (case and punctuation may differ slightly, and a line may wrap):");
  if (E.h1) L.push("- Headline line 1: \"" + E.h1 + "\"");
  if (E.h2) L.push("- Headline line 2: \"" + E.h2 + "\"");
  if (E.sub) L.push("- Subheadline: \"" + E.sub + "\"");
  E.proof.forEach((p, i) => { L.push("- Proof point " + (i + 1) + ": \"" + p + "\""); });
  if (E.deadline) L.push("- Deadline line: \"" + E.deadline + "\"");
  if (E.cta) L.push("- Button: \"" + E.cta + "\" (a small arrow after it is fine)");
  group.forEach((x) => { const c = E.contact[x.kind] || []; L.push("- Contact on the " + x.dims + " image: " + (c.length ? c.map((s) => "\"" + s + "\"").join(" and ") + " (small icons beside them are fine)" : "none")); });
  L.push("Words printed on the physical product itself (model numbers, labels) are allowed. A trust seal may repeat one proof point word for word.");
  L.push("");
  L.push("THE LOGO: the real HitLights logo — an H mark followed by the word HITLIGHTS and ® — was placed deliberately: " + group.map((x) => "on the " + x.dims + " image at " + x.logo.where).join("; ") + ". That one logo is correct.");
  L.push("");
  L.push("FAIL an image if any of these is true:");
  L.push("1. An expected line is missing, misspelled, has letters missing, extra or swapped, or is garbled.");
  L.push("2. Any other text appears that is not expected: invented words, gibberish, duplicated lines, stray letters, a price, percentage or date that is not listed.");
  L.push("3. A second HitLights logo, the brand name or a wordmark is drawn anywhere else, or any other brand's logo appears.");
  L.push("4. Text, the product or other artwork overlaps or touches the placed HitLights logo.");
  L.push("5. Text is cut off by the edge of the frame.");
  L.push("Otherwise PASS. Be strict about spelling. Ignore photo realism and design taste.");
  L.push("");
  L.push("Reply with only JSON: {\"images\":[{\"size\":\"1080x1080\",\"verdict\":\"pass\",\"issues\":[]}]} — one entry per image in the order given; verdict is \"pass\" or \"fail\"; issues are short, specific problems (quote the wrong text), empty when it passes.");
  return L.join("\n");
}
// Parse a QA reply into per-image {pass, issues}, the way v16 did.
export function parseQa(o, n) {
  const arr = (o && o.images) || [], out = [];
  for (let i = 0; i < n; i++) {
    const r = arr[i] || {};
    const issues = (Array.isArray(r.issues) ? r.issues : []).map(String).filter(Boolean).slice(0, 8);
    out.push({ pass: String(r.verdict || "").toLowerCase() === "pass", issues });
  }
  return out;
}

// ---------- prompt pack (for rendering by hand when the app can't) ----------
export function packText(form, picked, d = new Date()) {
  const DASH = "—", T = tplOf(form.tpl);
  const src = (picked && picked.url) ? picked.url : "", name = (picked && picked.label) ? picked.label : "";
  const L = [];
  L.push("HITLIGHTS AD BUILDER " + DASH + " PROMPT PACK");
  // (v16 said "to the Andromeda spec"; Andromeda is Meta's ad-retrieval system, not a file spec.)
  L.push("Built " + d.toISOString().slice(0, 10) + ": one image ad, three placement sizes, one concept.");
  L.push("");
  L.push("HOW TO RUN THIS: paste the whole of this message into a Claude chat that has the Higgsfield");
  L.push("connector, or hand it to someone who does. Work through the three steps in order " + DASH + " step 2");
  L.push("and step 3 must reference the finished render from step 1, not the original product photo.");
  L.push("");
  L.push("TEMPLATE: " + T.pillar + " " + DASH + " " + T.name);
  L.push("PRODUCT: " + (name || "(not chosen in the builder)"));
  L.push("PRODUCT IMAGE: " + (src || "(none " + DASH + " attach the product photo to the chat instead)"));
  L.push("");
  L.push("=".repeat(78));
  L.push("STEP 1 " + DASH + " SQUARE MASTER");
  L.push("Import the product image with Higgsfield media_import_url, then generate_image_batch with:");
  L.push("  model nano_banana_pro | aspect_ratio 1:1 | resolution 2k | count 1");
  L.push("  medias: the imported media_id, role image_references");
  L.push("PROMPT:");
  L.push(buildPrompt(form, "master"));
  L.push("");
  L.push("=".repeat(78));
  L.push("STEP 2 " + DASH + " PORTRAIT, BUILT FROM THE SQUARE");
  L.push("  model nano_banana_pro | aspect_ratio 9:16 | resolution 2k | count 1");
  L.push("  medias: the job_id of the finished square from step 1, then the imported product media_id, both role image_references");
  L.push("PROMPT:");
  L.push(buildPrompt(form, "portrait"));
  L.push("");
  L.push("=".repeat(78));
  L.push("STEP 3 " + DASH + " LANDSCAPE, BUILT FROM THE SQUARE");
  L.push("  model nano_banana_pro | aspect_ratio 16:9 | resolution 2k | count 1");
  L.push("  medias: the job_id of the finished square from step 1, then the imported product media_id, both role image_references");
  L.push("PROMPT:");
  L.push(buildPrompt(form, "landscape"));
  L.push("");
  L.push("=".repeat(78));
  // v16 printed Higgsfield-sandbox finishing commands here. The standalone app finishes files
  // itself, so the pack only gives the Logo Grid for placing the logo by hand.
  L.push("FINISHING " + DASH + " crop each render to exactly 1080x1080 / 1080x1920 / 1200x628 (scale to cover, centre crop),");
  L.push("then place the real logo file (white or black lockup, as below). Never let the generator draw it.");
  L.push("");
  L.push("By hand (Logo Grid " + DASH + " top-left corner of the logo, in pixels on the finished file):");
  KINDS.forEach((k) => {
    const g = gridSpec(form.tpl, k);
    L.push("  " + CANVAS[k].dims + ": x " + g.x + ", y " + g.y + ", " + g.w + " px wide, " + g.colour + " lockup" + (g.shadow ? " with a soft shadow" : "") + (g.ground === "bubble" ? " (centred in the top of the bubble, " + g.pad + " px below its top edge)" : ""));
  });
  L.push("Nothing drawn behind it " + DASH + " no box, no scrim, no haze. Same position every time; never moved to find space.");
  L.push("Check them side by side before handover " + DASH + " same photograph, same wording, same colours.");
  L.push("The three files are one ad at three sizes, never three different designs.");
  return L.join("\n");
}

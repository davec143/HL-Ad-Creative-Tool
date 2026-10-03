// Composed templates: the image model renders ONE scene photograph per set, nothing else. No text,
// no product, no logo, no panels: those are set by the app (composer/). Pure functions.
import { BRAND } from "./brand.mjs";
import { tplOf, esc } from "./engine.mjs";

export const SCENE_MODEL = "nano_banana_pro";

export function scenePrompt(form) {
  const T = tplOf(form.tpl);
  const scene = esc(form.scene || "") || "A bright, upscale modern kitchen at dusk, warm LED strip lighting glowing under the cabinets and along a cove in the ceiling.";
  return [
    "[ONE PHOTOGRAPH — no graphic design]",
    "A single, full-frame editorial interior photograph. It will be cropped to square, tall and wide frames, so keep the main subject near the centre with calm, uncluttered edges.",
    "",
    "[SCENE]",
    scene,
    "The LED lighting effect is the hero: an even, premium glow with realistic falloff on surfaces.",
    T.craft,
    BRAND.punch,
    "",
    "[STRICT — the photograph must contain none of these]",
    "No text, letters, numbers, words, signage, labels, price tags or watermarks anywhere. No logos, wordmarks or brand names. No ® or ™.",
    "No borders, frames, panels, buttons, badges, collage, split screens, overlays or graphic shapes: only the photograph.",
    "No close-up of any electrical device, switch, dimmer, driver, controller, power supply, remote, box or packaging, and no product labels — the product is added separately.",
    "No people's faces. No hands holding a product. No extra limbs or warped fingers, no melted geometry, no plastic look, no HDR halos, no cartoon rendering.",
    "",
    "resolution: 2k",
  ].join("\n");
}

export function sceneParams(prompt, aspect) {
  return { model: SCENE_MODEL, aspect_ratio: aspect, resolution: "2k", count: 1, use_unlim: false, prompt };
}

// Vision check of the scene photograph alone, before it goes into any ad.
export const SCENE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { verdict: { type: "string", enum: ["pass", "fail", "uncertain"] }, issues: { type: "array", items: { type: "string" } } },
  required: ["verdict", "issues"],
};

export function sceneCheckPrompt() {
  return [
    "You are the quality gate for the background photograph of a paid social ad. The image is ONLY the photograph; the brand's text, logo, button and real product photo are added on top afterwards by software. Inspect it closely at full resolution and answer in JSON.",
    "",
    "verdict \"fail\" if ANY of these is visible, however small:",
    "- any text, letters, numbers, signage, labels, watermarks, logos, wordmarks, ® or ™ (including garbled or fake lettering);",
    "- borders, frames, panels, buttons, badges, collage or split-screen layouts, or any other graphic-design element — it must be one plain photograph;",
    "- a close-up electrical device, switch, dimmer, driver, controller, power supply, packaging or product label (a distant, out-of-focus light fixture is fine);",
    "- a human face, a hand holding a product, deformed hands or limbs;",
    "- obvious AI artefacts: melted or impossible geometry, smeared surfaces, duplicated objects.",
    "",
    "verdict \"uncertain\" if something might be one of the above but you can't tell at this resolution. Otherwise \"pass\".",
    "issues: one short sentence per problem, saying what and where. Empty when it passes.",
  ].join("\n");
}

export function parseSceneCheck(o) {
  if (!o || typeof o !== "object") return { ok: false, error: "The scene check's reply wasn't an object." };
  const v = String(o.verdict || "").toLowerCase();
  if (!["pass", "fail", "uncertain"].includes(v)) return { ok: false, error: "The scene check's reply had no verdict." };
  if (o.issues != null && !Array.isArray(o.issues)) return { ok: false, error: "The scene check's reply had malformed issues." };
  const issues = (o.issues || []).map((i) => String(i).slice(0, 300)).filter(Boolean).slice(0, 8);
  if (v === "pass" && issues.length) return { ok: true, verdict: "uncertain", issues }; // a pass that lists problems isn't a pass
  return { ok: true, verdict: v, issues };
}

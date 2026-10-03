// Which templates are built by the composer (composer/templates.mjs): the image model renders only
// the scene photograph; the product photo, text, CTA and logo are set by the app. Shared by the
// page, the engine and the server.
export const COMPOSED_TEMPLATES = ["t1"];
export const isComposed = (tpl) => COMPOSED_TEMPLATES.includes(tpl);

// "Write it for me": for composed templates the scene is the space and the light only.
export const COMPOSED_SCENE_TXT = "scene — ONE sentence describing the space and the light only: the room, its surfaces and where the LED glow falls. No people, no hands, and no devices, switches, drivers, boxes or packaging — the product is added separately from its own photo. Do not mention text, logos, colours or layout.\n\n";

// Sample scene for composed templates (the v16 sample showed hands installing the product, which
// an image model redraws inaccurately).
export const COMPOSED_SAMPLE_SCENE = {
  t1: "A modern kitchen at dusk, warm LED strip light glowing evenly under the upper cabinets and washing across a pale stone backsplash.",
};

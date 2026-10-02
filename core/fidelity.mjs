// Product-fidelity check: does the hardware in each finished ad still match the Shopify product
// photo? Separate from the text & logo check. A vision model can miss things, so it may answer
// "uncertain", which requires a person's approval before delivery; this check never guarantees
// exact product accuracy.

export const FIDELITY_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { images: { type: "array", items: {
    type: "object", additionalProperties: false,
    properties: { size: { type: "string" }, verdict: { type: "string", enum: ["pass", "fail", "uncertain"] }, issues: { type: "array", items: { type: "string" } } },
    required: ["size", "verdict", "issues"],
  } } },
  required: ["images"],
};

// group: [{dims, title}] — the finished ads, sent AFTER the product reference photo.
export function fidelityPrompt(group, source = {}) {
  const L = [];
  L.push("You are checking product fidelity in HitLights ads. The FIRST image is the official product photo" + (source.title ? " of \"" + source.title + (source.variantTitle && source.variantTitle !== "Default Title" ? " — " + source.variantTitle : "") + "\"" : "") + ". The next " + group.length + " image" + (group.length > 1 ? "s are" : " is") + " finished ads, in this order: " + group.map((x, i) => (i + 1) + ") " + x.dims + " " + x.title.toLowerCase()).join(", ") + ".");
  L.push("");
  L.push("For each ad, compare the product shown with the product photo. Ignore the scene, lighting, angle, scale, crop, background, text and logo. Look only at the product hardware.");
  L.push("FAIL an ad if any of these is clearly true:");
  L.push("1. A different number of connectors, terminals, wires, buttons, ports or other components.");
  L.push("2. A different form factor or shape (e.g. a box became a cylinder, a strip became a bulb).");
  L.push("3. Hardware from the photo is missing, or hardware that isn't in the photo was added.");
  L.push("4. A clearly different colour or finish.");
  L.push("5. Visible model markings or labels changed, garbled or invented.");
  L.push("6. The product appears more than once when the photo shows one unit (unless it is plainly a pack).");
  L.push("Answer UNCERTAIN when the product is too small, hidden, cut off or blurred to judge, or when you are not sure. PASS only when it clearly matches.");
  L.push("");
  L.push("Reply with only JSON: {\"images\":[{\"size\":\"1080x1080\",\"verdict\":\"pass\",\"issues\":[]}]} — one entry per ad (not for the product photo), \"size\" exactly as listed above, verdict \"pass\", \"fail\" or \"uncertain\", issues short and specific.");
  return L.join("\n");
}

// Same strictness as the text check: map by declared size; anything malformed is an error.
export function parseFidelity(o, expected) {
  if (!o || typeof o !== "object" || !Array.isArray(o.images)) return { ok: false, error: "The fidelity reply had no images list." };
  const results = {}, seen = new Set();
  for (const r of o.images) {
    if (!r || typeof r !== "object") return { ok: false, error: "The fidelity reply had a malformed entry." };
    const size = String(r.size || "").replace(/\s+/g, "").replace(/[×X]/g, "x");
    if (!expected.includes(size)) return { ok: false, error: "The fidelity reply named an unknown size (" + String(r.size).slice(0, 20) + ")." };
    if (seen.has(size)) return { ok: false, error: "The fidelity reply named " + size + " twice." };
    seen.add(size);
    const v = String(r.verdict || "").toLowerCase();
    if (!["pass", "fail", "uncertain"].includes(v)) return { ok: false, error: "The fidelity reply had no verdict for " + size + "." };
    if (r.issues != null && !Array.isArray(r.issues)) return { ok: false, error: "The fidelity reply had malformed issues for " + size + "." };
    results[size] = { verdict: v, issues: (r.issues || []).map((i) => String(i).slice(0, 300)).filter(Boolean).slice(0, 8) };
  }
  const missing = expected.filter((d) => !seen.has(d));
  if (missing.length) return { ok: false, error: "The fidelity reply didn't cover " + missing.join(", ") + "." };
  return { ok: true, results };
}

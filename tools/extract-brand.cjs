// One-time extraction of the v16 brand data into core/brand.mjs, straight from the running
// original script (no retyping). After extraction core/brand.mjs is the source of truth and is
// edited by hand; tests/brand.test.mjs pins it to v16 except for the documented deviations.
"use strict";
const fs = require("fs"), path = require("path");
const { load } = require("./legacy-harness.cjs");
const H = load();
const pick = (o) => JSON.parse(JSON.stringify(o));
const data = {
  BRAND: pick(H.BRAND), TPL_ORDER: Object.keys(H.TPL), TPL: pick(H.TPL), SAMPLE: pick(H.SAMPLE),
  LIMITS: pick(H.LIMITS), CANVAS: pick(H.CANVAS), KINDS: pick(H.KINDS), LOGOGRID: pick(H.LOGOGRID),
  FIELD: pick(H.FIELD), SAFE_TOP: H.SAFE_TOP, LOGO_AR: H.LOGO_AR, LOGOWHERE: pick(H.LOGOWHERE),
  FLAGTXT: pick(H.FLAGTXT), BLOCKING: pick(H.BLOCKING), CREDITS_PER_RENDER: H.CREDITS_PER_RENDER, ARFOR: pick(H.ARFOR),
};
let out = "// HitLights brand system, Logo Grid and template library for the Ad Builder.\n" +
  "// Extracted verbatim from builder v16 (legacy/v16/source/b_script.js) by tools/extract-brand.cjs.\n" +
  "// This file is now the source of truth. Any change here must keep tests/parity.test.mjs green\n" +
  "// (or be added there as a documented deviation) and must match reference/HitLights_Ad_Templates.html.\n\n";
for (const [k, v] of Object.entries(data)) out += "export const " + k + " = " + JSON.stringify(v, null, 2) + ";\n\n";
fs.writeFileSync(path.join(__dirname, "..", "core", "brand.mjs"), out);
console.log("wrote core/brand.mjs", out.length, "bytes");

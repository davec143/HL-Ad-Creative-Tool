// Delivery gates: the ONE place that decides whether a finished file may leave the app
// automatically (Drive today, any export later) and what the page and Recent sets show for it.
// Pure functions, shared by server and browser.
//
// A file is automatically deliverable only when ALL of these hold:
//   finishing completed, the file exists and passed output validation (exact size, <= 460 KB,
//   decodes), no blocking flag, the text & logo check explicitly passed, and the product-fidelity
//   check explicitly passed (or a person approved an "uncertain" result).
// QA that is off, missing, running or errored is never treated as clean.
//
// Composed ads (composer/: the app sets the text, CTA, logo and the real product photo) are
// gated differently, because those parts are exact by construction: the file must pass output
// validation, the product cutout must have been approved by a person (once per product photo),
// and the scene photograph must pass its check (or a person approved an "uncertain" result).

import { FLAGTXT } from "./brand.mjs";

// Finishing / QA flags that hold a file back. v16 blocked the first six; BUBBLE?, FIELDCOLOR and
// CONTRAST were advisory there and are blocking here because each can mean an off-brand or
// misplaced logo or ground.
export const BLOCKING_FLAGS = ["COLLISION", "PLACEHOLDER", "SAFEZONE", "NOCTA", "CTACOLOR", "TEXT", "BUBBLE?", "FIELDCOLOR", "CONTRAST", "FIDELITY"];

export const FLAG_REASON = {
  ...FLAGTXT,
  TEXT: "The text & logo check failed.",
  FIDELITY: "The product-fidelity check found the product changed.",
};

// item: a run item ({state, file, output, flags, qa, fidelity, override, version}).
// Returns {status, deliverable, reasons}; status is one of
//   pending | failed | passed | held | unchecked | overridden
export function deliverability(x, { requireFidelity = false } = {}) {
  if (!x) return { status: "failed", deliverable: false, reasons: ["Missing item."] };
  if (x.state === "failed" || x.state === "ambiguous") return { status: "failed", deliverable: false, reasons: [x.error || (x.state === "ambiguous" ? "The render's outcome is unconfirmed." : "This size didn't finish.")] };
  if (x.state !== "done") return { status: "pending", deliverable: false, reasons: ["Not finished yet."] };
  const reasons = [];
  let unchecked = false;
  if (x.composed) return composedGate(x, reasons);
  if (!x.file) reasons.push("No finished file.");
  if (!x.output || x.output.ok !== true) reasons.push("The finished file failed validation" + (x.output && x.output.error ? ": " + x.output.error : "."));
  for (const f of x.flags || []) if (BLOCKING_FLAGS.includes(f)) reasons.push(f + ": " + (FLAG_REASON[f] || "Blocking flag."));
  const q = x.qa;
  if (!q) { reasons.push("The text & logo check hasn't run."); unchecked = true; }
  else if (q.state === "off") { reasons.push("The text & logo check is off (no language model configured)."); unchecked = true; }
  else if (q.state === "error") { reasons.push("The text & logo check couldn't run" + (q.message ? ": " + q.message : ".")); unchecked = true; }
  else if (q.state === "running") { reasons.push("The text & logo check is still running."); unchecked = true; }
  else if (q.state === "fail") { if (!(x.flags || []).includes("TEXT")) reasons.push("TEXT: " + FLAG_REASON.TEXT); }
  else if (q.state !== "pass") { reasons.push("Unknown text & logo check state."); unchecked = true; }
  if (requireFidelity) {
    const fq = x.fidelity;
    if (!fq) { reasons.push("The product-fidelity check hasn't run."); unchecked = true; }
    else if (fq.state === "off") { reasons.push("The product-fidelity check is off (no language model configured)."); unchecked = true; }
    else if (fq.state === "error") { reasons.push("The product-fidelity check couldn't run" + (fq.message ? ": " + fq.message : ".")); unchecked = true; }
    else if (fq.state === "running") { reasons.push("The product-fidelity check is still running."); unchecked = true; }
    else if (fq.state === "uncertain" && !fq.approved) reasons.push("Product fidelity is uncertain: a person needs to compare it with the product photo and approve it.");
    else if (fq.state === "fail") { if (!(x.flags || []).includes("FIDELITY")) reasons.push("FIDELITY: " + FLAG_REASON.FIDELITY); }
    else if (!["pass", "uncertain"].includes(fq.state)) { reasons.push("Unknown product-fidelity state."); unchecked = true; }
  }
  return finalize(x, reasons, unchecked, q);
}

function composedGate(x, reasons) {
  let unchecked = false;
  if (!x.file) reasons.push("No finished file.");
  if (!x.output || x.output.ok !== true) reasons.push("The finished file failed validation" + (x.output && x.output.error ? ": " + x.output.error : "."));
  for (const f of x.flags || []) if (BLOCKING_FLAGS.includes(f)) reasons.push(f + ": " + (FLAG_REASON[f] || "Blocking flag."));
  const c = x.cutout;
  if (!c || !["approved", "uploaded"].includes(c.state)) reasons.push("The product cutout needs a one-time check: compare it with the product photo, then approve it (or upload your own).");
  const s = x.sceneQa;
  if (!s) { reasons.push("The scene photo check hasn't run."); unchecked = true; }
  else if (s.state === "off") { reasons.push("The scene photo check is off (no language model configured)."); unchecked = true; }
  else if (s.state === "error") { reasons.push("The scene photo check couldn't run" + (s.message ? ": " + s.message : ".")); unchecked = true; }
  else if (s.state === "running") { reasons.push("The scene photo check is still running."); unchecked = true; }
  else if (s.state === "uncertain" && !s.approved) reasons.push("The scene photo check is unsure: look at the scene and approve it if it's clean.");
  else if (s.state === "fail") reasons.push("SCENE: the scene photo has " + ((s.issues && s.issues.length) ? s.issues.join("; ") : "a problem") + ". Make a new set to get a new scene.");
  else if (!["pass", "uncertain"].includes(s.state)) { reasons.push("Unknown scene check state."); unchecked = true; }
  return finalize(x, reasons, unchecked, null);
}

function finalize(x, reasons, unchecked, q) {
  if (!reasons.length) return { status: "passed", deliverable: true, reasons: [] };
  // A recorded manual override for exactly this version and file.
  const o = x.override;
  if (o && o.version === x.version && o.file === x.file && x.file && x.output && x.output.ok === true) {
    return { status: "overridden", deliverable: true, reasons };
  }
  const onlyUnchecked = unchecked && !(x.flags || []).some((f) => BLOCKING_FLAGS.includes(f)) && x.output && x.output.ok === true && x.file && !(q && q.state === "fail");
  return { status: onlyUnchecked ? "unchecked" : "held", deliverable: false, reasons };
}

// Validate a QA reply locally, even when the provider claims schema enforcement, and map entries
// by their declared size (never by position). expected: ["1080x1080", ...] for this request.
// Returns {ok: true, results: {dims: {pass, issues}}} or {ok: false, error}.
export function parseQaStrict(o, expected) {
  if (!o || typeof o !== "object" || !Array.isArray(o.images)) return { ok: false, error: "The check's reply had no images list." };
  const results = {}, seen = new Set();
  for (const r of o.images) {
    if (!r || typeof r !== "object") return { ok: false, error: "The check's reply had a malformed entry." };
    const size = String(r.size || "").replace(/\s+/g, "").replace(/[×X]/g, "x");
    if (!expected.includes(size)) return { ok: false, error: "The check's reply named an unknown size (" + String(r.size).slice(0, 20) + ")." };
    if (seen.has(size)) return { ok: false, error: "The check's reply named " + size + " twice." };
    seen.add(size);
    const v = String(r.verdict || "").toLowerCase();
    if (v !== "pass" && v !== "fail") return { ok: false, error: "The check's reply had no pass/fail verdict for " + size + "." };
    if (r.issues != null && !Array.isArray(r.issues)) return { ok: false, error: "The check's reply had malformed issues for " + size + "." };
    const issues = (r.issues || []).map((i) => String(i).slice(0, 300)).filter(Boolean).slice(0, 8);
    results[size] = { pass: v === "pass", issues };
  }
  const missing = expected.filter((d) => !seen.has(d));
  if (missing.length) return { ok: false, error: "The check's reply didn't cover " + missing.join(", ") + "." };
  return { ok: true, results };
}

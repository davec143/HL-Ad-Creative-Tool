// Delivery gates: QA must explicitly pass, every brand flag blocks, overrides are exact.
import test from "node:test";
import assert from "node:assert/strict";
import { deliverability, parseQaStrict, BLOCKING_FLAGS } from "../core/gates.mjs";

const clean = (over = {}) => ({ state: "done", file: "master-v1.jpg", version: 1, output: { ok: true, width: 1080, height: 1080, bytes: 200000 }, flags: [], qa: { state: "pass", issues: [] }, ...over });

test("QA pass allows delivery", () => { assert.deepEqual(deliverability(clean()), { status: "passed", deliverable: true, reasons: [] }); });
test("QA fail blocks delivery (held)", () => { const d = deliverability(clean({ qa: { state: "fail", issues: ["DRIVR"] }, flags: ["TEXT"] })); assert.equal(d.deliverable, false); assert.equal(d.status, "held"); });
test("QA off blocks delivery (unchecked)", () => { const d = deliverability(clean({ qa: { state: "off" } })); assert.equal(d.deliverable, false); assert.equal(d.status, "unchecked"); assert.match(d.reasons[0], /is off/); });
test("QA error blocks delivery (unchecked)", () => { const d = deliverability(clean({ qa: { state: "error", message: "rate limited" } })); assert.equal(d.deliverable, false); assert.match(d.reasons[0], /rate limited/); });
test("QA missing or running blocks delivery", () => {
  assert.equal(deliverability(clean({ qa: null })).deliverable, false);
  assert.equal(deliverability(clean({ qa: { state: "running" } })).deliverable, false);
  assert.equal(deliverability(clean({ qa: { state: "weird" } })).deliverable, false);
});
test("every brand/logo/CTA flag blocks delivery", () => {
  for (const f of ["COLLISION", "PLACEHOLDER", "SAFEZONE", "NOCTA", "CTACOLOR", "TEXT", "BUBBLE?", "FIELDCOLOR", "CONTRAST"]) {
    assert.ok(BLOCKING_FLAGS.includes(f), f);
    const d = deliverability(clean({ flags: [f] }));
    assert.equal(d.deliverable, false, f); assert.equal(d.status, "held", f);
    assert.ok(d.reasons.some((r) => r.startsWith(f + ":")), f);
  }
});
test("output validation failure blocks delivery and can't be overridden", () => {
  const x = clean({ output: { ok: false, error: "470000 bytes is over" }, override: { version: 1, file: "master-v1.jpg" } });
  const d = deliverability(x); assert.equal(d.deliverable, false); assert.equal(d.status, "held");
});
test("not finished / failed / ambiguous are never deliverable", () => {
  assert.equal(deliverability(clean({ state: "finishing" })).status, "pending");
  assert.equal(deliverability(clean({ state: "failed" })).status, "failed");
  assert.equal(deliverability(clean({ state: "ambiguous" })).status, "failed");
  assert.equal(deliverability(clean({ file: null })).deliverable, false);
});
test("an override counts only for the exact version and file it was recorded on", () => {
  const held = clean({ flags: ["CONTRAST"] });
  assert.equal(deliverability({ ...held, override: { version: 1, file: "master-v1.jpg" } }).status, "overridden");
  assert.equal(deliverability({ ...held, override: { version: 1, file: "master-v1.jpg" } }).deliverable, true);
  assert.equal(deliverability({ ...held, version: 2, file: "master-v2.jpg", override: { version: 1, file: "master-v1.jpg" } }).deliverable, false);
});
test("product fidelity, when required: fail and uncertain block; approval unblocks uncertain", () => {
  const o = { requireFidelity: true };
  assert.equal(deliverability(clean(), o).deliverable, false, "missing fidelity");
  assert.equal(deliverability(clean({ fidelity: { state: "pass" } }), o).deliverable, true);
  assert.equal(deliverability(clean({ fidelity: { state: "fail" }, flags: ["FIDELITY"] }), o).status, "held");
  assert.equal(deliverability(clean({ fidelity: { state: "uncertain" } }), o).status, "held");
  assert.equal(deliverability(clean({ fidelity: { state: "uncertain", approved: { at: 1 } } }), o).deliverable, true);
  assert.equal(deliverability(clean({ fidelity: { state: "error" } }), o).status, "unchecked");
});

const SIZES = ["1080x1080", "1080x1920", "1200x628"];
test("QA reply: reordered entries map to the right sizes", () => {
  const p = parseQaStrict({ images: [{ size: "1200x628", verdict: "fail", issues: ["x"] }, { size: "1080x1080", verdict: "pass", issues: [] }, { size: "1080 × 1920", verdict: "pass", issues: [] }] }, SIZES);
  assert.equal(p.ok, true);
  assert.equal(p.results["1200x628"].pass, false); assert.equal(p.results["1080x1080"].pass, true); assert.equal(p.results["1080x1920"].pass, true);
});
test("QA reply: missing, duplicate, unknown or malformed entries are rejected", () => {
  assert.equal(parseQaStrict({ images: [{ size: "1080x1080", verdict: "pass", issues: [] }] }, SIZES).ok, false);
  assert.match(parseQaStrict({ images: [{ size: "1080x1080", verdict: "pass" }, { size: "1080x1080", verdict: "pass" }, { size: "1200x628", verdict: "pass" }] }, SIZES).error, /twice/);
  assert.match(parseQaStrict({ images: [{ size: "1080x1350", verdict: "pass" }] }, ["1080x1350x"]).error, /unknown/);
  assert.match(parseQaStrict({ images: [{ size: "1080x1080", verdict: "maybe" }] }, ["1080x1080"]).error, /verdict/);
  assert.equal(parseQaStrict({ images: [{ size: "1080x1080", verdict: "pass", issues: "none" }] }, ["1080x1080"]).ok, false);
  assert.equal(parseQaStrict(null, SIZES).ok, false);
  assert.equal(parseQaStrict({ images: "nope" }, SIZES).ok, false);
});

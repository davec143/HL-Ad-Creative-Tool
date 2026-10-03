// Composed templates (T1): the image model renders only the scene photograph; the app sets the real
// product photo, the text, the CTA and the logo. These tests cover the layout rules, the product
// cutout and its one-time approval, the single paid render, the scene check and the delivery gate.
// Real Chromium, real Python, fake renderer, mock LLM and Drive. No network, no credits.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../server/store.mjs";
import { Pipeline } from "../server/pipeline.mjs";
import { FakeRenderer } from "../server/render/fake.mjs";
import { readConfig, ROOT } from "../server/config.mjs";
import { CutoutStore, sha256 } from "../server/compose.mjs";
import { Composer, chromiumPath, textProblems } from "../composer/render.mjs";
import { layoutFor, sealText, LAYOUTS, LOGO_W } from "../composer/templates.mjs";
import { SAMPLE, LOGOGRID, CANVAS, LOGO_AR } from "../core/brand.mjs";
import { COMPOSED_SAMPLE_SCENE } from "../core/composed.mjs";
import { deliverability } from "../core/gates.mjs";
import { scenePrompt, parseSceneCheck } from "../core/scene.mjs";

const PY = process.env.PYTHON || (fs.existsSync(path.join(ROOT, ".venv/bin/python")) ? path.join(ROOT, ".venv/bin/python") : "python3");
const HAS_BROWSER = !!chromiumPath();
const quiet = { error() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hlab-c-"));

// Product photos made once with Pillow: a PNG that already has transparency (a supplied cutout,
// no model needed) and a flat JPEG (needs the background-removal model).
const FIX = tmp();
execFileSync(PY, ["-c", `
from PIL import Image, ImageDraw
im = Image.new("RGBA", (500, 800), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
d.rounded_rectangle((60, 40, 440, 760), 40, fill=(245, 245, 245, 255), outline=(190, 190, 190, 255), width=6)
d.rounded_rectangle((150, 180, 350, 620), 20, fill=(255, 255, 255, 255), outline=(200, 200, 200, 255), width=4)
im.save("${FIX}/cut.png")
Image.new("RGB", (600, 600), (255, 255, 255)).save("${FIX}/flat.jpg")
`]);
const CUT_PNG = fs.readFileSync(path.join(FIX, "cut.png"));
const FLAT_JPG = fs.readFileSync(path.join(FIX, "flat.jpg"));

const PHONE = "+1 855 768 4135", EMAIL = "customerservice@hitlights.com";
const formT4 = (over = {}) => ({ tpl: "t4", ...SAMPLE.t4, scene: COMPOSED_SAMPLE_SCENE.t4, phone: PHONE, email: EMAIL, angle: "", ...over });
const formT1 = (over = {}) => ({ tpl: "t1", ...SAMPLE.t1, scene: COMPOSED_SAMPLE_SCENE.t1, phone: PHONE, email: EMAIL, angle: "", ...over });
const PICK = { url: "https://cdn.shopify.com/p.png", title: "EZDim Pro", label: "EZDim Pro" };

let composer = null;
const getComposer = () => composer || (composer = new Composer());
test.after(async () => { if (composer) await composer.close(); });

function mockDrive() {
  const uploads = [];
  return { uploads, enabled: true, parent: "P", createFolder: async (n) => ({ id: "F1", url: "https://drive.google.com/drive/folders/F1", name: n }), findByName: async () => null, uploadJpeg: async (f, name, bytes) => { uploads.push(name); assert.ok(bytes.length > 1000); return { id: "d" + uploads.length }; } };
}
function sceneLlm(verdict = "pass", issues = []) {
  const calls = [];
  return { calls, name: "mock", json: async ({ prompt, images }) => { calls.push({ prompt, n: images.length }); return { verdict, issues }; } };
}
function setup({ photo = CUT_PNG, llm = sceneLlm(), drive = null, cfgOver = {}, env = {} } = {}) {
  const dir = tmp();
  const cfg = { ...readConfig({ DATA_DIR: dir, PYTHON: PY, ...env }), ...cfgOver };
  const store = new Store(dir);
  const renderer = new FakeRenderer({ store, python: PY });
  const fetchSource = async (url, dest) => { fs.writeFileSync(dest, photo); return { sha256: sha256(photo), bytes: photo.length, contentType: "image/png" }; };
  const pipeline = new Pipeline({ cfg, store, renderer, llm, drive, log: quiet, fetchSource, composer: getComposer() });
  return { cfg, store, renderer, pipeline, dir };
}
async function settle(p) { for (let i = 0; i < 4; i++) await p.idle(); }
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) { const m = buf[i + 1], len = buf.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]; i += 2 + len; }
  return null;
}

// ---------- layout rules (pure) ----------
test("composed layouts put the logo exactly on the Logo Grid at every size", () => {
  for (const kind of ["master", "portrait", "landscape"]) {
    const s = layoutFor("t1", kind, formT1());
    assert.deepEqual([s.logo.x, s.logo.y, s.logo.w, s.logo.colour], [...LOGOGRID.t1.pos[kind], LOGO_W[kind], "white"]);
    assert.equal(s.logo.h, Math.round(LOGO_W[kind] * LOGO_AR));
    assert.ok(LOGO_W[kind] >= 0.2 * CANVAS[kind].W && LOGO_W[kind] <= 0.36 * CANVAS[kind].W, "brand: 20–36% of frame width");
    assert.deepEqual([s.W, s.H], [CANVAS[kind].W, CANVAS[kind].H]);
  }
  for (const t of ["t1", "t4"]) assert.ok(LAYOUTS[t].portrait.safe.top >= Math.round(1920 * 0.14) && LAYOUTS[t].portrait.safe.bottom <= Math.round(1920 * 0.8));
});

test("T4: white logo on the photo (grid) for square and landscape; black lockup in the cream panel for portrait", () => {
  for (const kind of ["master", "landscape"]) {
    const s = layoutFor("t4", kind, formT4());
    assert.deepEqual([s.logo.x, s.logo.y, s.logo.w, s.logo.colour, s.logo.inPanel], [...LOGOGRID.t4.pos[kind], LOGO_W[kind], "white", false]);
  }
  const p = layoutFor("t4", "portrait", formT4());
  assert.deepEqual([p.logo.w, p.logo.colour, p.logo.inPanel], [LOGO_W.portrait, "black", true]);
});

test("a larger logo keeps the Logo Grid's anchor: centred stays centred, right-aligned keeps its right edge", () => {
  const sq = layoutFor("t5", "master", { tpl: "t5", ...SAMPLE.t5 }), ls = layoutFor("t5", "landscape", { tpl: "t5", ...SAMPLE.t5 });
  assert.equal(sq.logo.x + sq.logo.w / 2, LOGOGRID.t5.pos.master[0] + CANVAS.master.w / 2);
  assert.equal(ls.logo.x + ls.logo.w, LOGOGRID.t5.pos.landscape[0] + CANVAS.landscape.w);
});

test("the trust seal only repeats a certification or warranty proof line", () => {
  assert.equal(sealText({ p1: "Driver, dimmer, CCT", p2: "UL Listed & Class 2" }), "UL Listed & Class 2");
  assert.equal(sealText({ p1: "6-year warranty" }), "6-year warranty");
  assert.equal(sealText({ p1: "Single-pole or 3-way", p2: "120VAC to 24VDC" }), "");
});

test("characters the brand font can't draw are refused with the field named", () => {
  const p = textProblems({ h1: "Glow ✨", h2: "", proof: ["ok"], cta: "Shop →", contact: "", seal: "" });
  assert.deepEqual(p.map((e) => e.field), ["h1", "cta"]);
  assert.equal(textProblems({ h1: "Café “quotes” — 100% ®", h2: "", proof: [], cta: "Go", contact: "", seal: "" }).length, 0);
});

test("scene prompt asks for a photograph only; scene check parsing never turns doubt into a pass", () => {
  const p = scenePrompt(formT1());
  assert.match(p, /No text, letters, numbers/);
  assert.match(p, /No close-up of any electrical device/);
  assert.doesNotMatch(p, /EZDIM|SHOP|reserved logo/i);
  assert.deepEqual(parseSceneCheck({ verdict: "pass", issues: [] }), { ok: true, verdict: "pass", issues: [] });
  assert.equal(parseSceneCheck({ verdict: "pass", issues: ["faint lettering on the wall"] }).verdict, "uncertain");
  assert.equal(parseSceneCheck({ verdict: "maybe" }).ok, false);
});

test("composed gate: needs a valid file, an approved cutout and a passed scene check", () => {
  const base = { composed: true, state: "done", file: "a.jpg", version: 1, flags: [], output: { ok: true }, cutout: { state: "approved" }, sceneQa: { state: "pass" } };
  assert.equal(deliverability(base).status, "passed");
  assert.equal(deliverability({ ...base, cutout: { state: "auto" } }).status, "held");
  assert.equal(deliverability({ ...base, cutout: { state: "uploaded" } }).status, "passed");
  assert.equal(deliverability({ ...base, sceneQa: { state: "fail", issues: ["a sign"] } }).status, "held");
  assert.equal(deliverability({ ...base, sceneQa: { state: "uncertain" } }).status, "held");
  assert.equal(deliverability({ ...base, sceneQa: { state: "uncertain", approved: { at: 1 } } }).status, "passed");
  assert.equal(deliverability({ ...base, sceneQa: { state: "off" } }).status, "unchecked");
  assert.equal(deliverability({ ...base, output: { ok: false, error: "big" } }).deliverable, false);
  // Text QA and product fidelity don't apply: the app set those parts itself.
  assert.equal(deliverability(base, { requireFidelity: true }).status, "passed");
});

// ---------- rendering (Chromium) ----------
test("sample copy fits every T1 size; over-long copy fails with the field named", { skip: !HAS_BROWSER && "no Chromium" }, async () => {
  const product = "data:image/png;base64," + CUT_PNG.toString("base64");
  for (const kind of ["master", "portrait", "landscape"]) {
    const r = await getComposer().compose(layoutFor("t1", kind, formT1()), { scene: null, product });
    assert.ok(r.report.ok, kind + ": " + JSON.stringify(r.report.errors));
    assert.equal(r.png.readUInt32BE(16), CANVAS[kind].W);
    assert.equal(r.png.readUInt32BE(20), CANVAS[kind].H);
  }
  for (const f of [formT4(), formT4({ h1: "Your space,", h2: "made more welcoming.", p1: "Smooth light, high density", p2: "Peace of mind, UL listed", p3: "Ready for damp spaces, IP67", cta: "Shop Luma5" })]) {
    for (const kind of ["master", "portrait", "landscape"]) {
      const r = await getComposer().compose(layoutFor("t4", kind, f), { scene: null, product });
      assert.ok(r.report.ok, "t4 " + kind + ": " + JSON.stringify(r.report.errors));
      assert.equal(r.report.sizes.h1, r.report.sizes.h2, "both T4 headline lines share one size");
    }
  }
  for (const [t, extra] of [["t2", {}], ["t3", { h1: "11% OFF", deadline: "Save 11% Before Oct 31" }], ["t5", {}]]) {
    const f = { tpl: t, ...SAMPLE[t], ...extra, phone: PHONE, email: EMAIL };
    for (const kind of ["master", "portrait", "landscape"]) {
      const r = await getComposer().compose(layoutFor(t, kind, f), { scene: null, product });
      assert.ok(r.report.ok, t + " " + kind + ": " + JSON.stringify(r.report.errors));
    }
  }
  const long = formT1({ h1: "Professional dimming drivers for every single job site in California", cta: "Specify the EZDim Pro for your next commercial project" });
  await assert.rejects(getComposer().compose(layoutFor("t1", "landscape", long), { scene: null, product }), (e) => e.code === "layout" && e.errors.some((x) => x.field === "cta"));
});

// ---------- the pipeline ----------
test("composed set: one paid scene render for all three sizes, exact files, delivered once approved", { skip: !HAS_BROWSER && "no Chromium" }, async () => {
  const drive = mockDrive(), llm = sceneLlm("pass");
  const { pipeline, store, renderer } = setup({ drive, llm });
  const run = pipeline.start(pipeline.create({ form: formT1(), picked: PICK, saveDrive: true }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.status, "done", JSON.stringify(r.log.slice(-4)));
  assert.equal(renderer.accepted.length, 1, "exactly one paid render");
  assert.equal(renderer.accepted[0].aspect_ratio, "1:1");
  assert.ok(!/EZDIM|reserved logo/i.test(renderer.accepted[0].prompt), "the scene prompt carries no ad copy");
  assert.equal(r.credits, 2);
  assert.equal(llm.calls.length, 1, "one scene check, no text or fidelity checks");
  assert.equal(r.cutout.state, "uploaded", "a PNG with transparency counts as a supplied cutout");
  for (const x of r.items) {
    assert.equal(x.state, "done"); assert.equal(x.composed, true);
    const buf = fs.readFileSync(store.filePath(r.id, x.file));
    assert.deepEqual(jpegSize(buf), [x.W, x.H]);
    assert.ok(buf.length <= 460000 && x.output.ok);
    assert.equal(deliverability(x).status, "passed", JSON.stringify(deliverability(x).reasons));
  }
  assert.equal(drive.uploads.length, 3);
});

test("an automatic cutout holds the set until a person approves it (once, for every set)", { skip: !HAS_BROWSER && "no Chromium" }, async () => {
  const drive = mockDrive();
  const { pipeline, store, dir } = setup({ drive, photo: FLAT_JPG });
  // Pretend the model already cut this photo out (the model itself isn't needed for this test).
  const cs = new CutoutStore(dir), sha = sha256(FLAT_JPG);
  fs.writeFileSync(cs.png(sha), CUT_PNG); cs.put(sha, { state: "auto", source: "model" });
  const run = pipeline.start(pipeline.create({ form: formT1(), picked: PICK, saveDrive: true }));
  await settle(pipeline);
  let r = store.getRun(run.id);
  assert.equal(r.status, "done");
  assert.ok(r.items.every((x) => x.held && deliverability(x).reasons.some((m) => /cutout/.test(m))));
  assert.equal(drive.uploads.length, 0);
  pipeline.approveCutout(run.id, { actor: "t" });
  await settle(pipeline);
  r = store.getRun(run.id);
  assert.equal(r.cutout.state, "approved");
  assert.equal(drive.uploads.length, 3);
  assert.equal(cs.get(sha).state, "approved", "the approval is kept for the next set with this photo");
});

test("copy that doesn't fit stops the set before anything is rendered or charged", { skip: !HAS_BROWSER && "no Chromium" }, async () => {
  const { pipeline, store, renderer } = setup();
  const run = pipeline.start(pipeline.create({ form: formT1({ cta: "Specify the EZDim Pro for your next commercial lighting project" }), picked: PICK }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.status, "failed"); assert.equal(r.error.code, "layout");
  assert.match(r.error.message, /nothing was rendered or charged/);
  assert.equal(renderer.accepted.length, 0); assert.equal(store.creditsToday(), 0);
});

test("a cutout that can't be made stops the set before the paid render", { skip: !HAS_BROWSER && "no Chromium" }, async () => {
  const { pipeline, store, renderer } = setup({ photo: FLAT_JPG, env: { CUTOUT_MODEL: "/nonexistent/model.onnx" } });
  const run = pipeline.start(pipeline.create({ form: formT1(), picked: PICK }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.status, "failed"); assert.equal(r.error.code, "cutout");
  assert.equal(renderer.accepted.length, 0);
});

test("scene check fail holds every size; uncertain holds until a person approves the scene", { skip: !HAS_BROWSER && "no Chromium" }, async () => {
  const a = setup({ llm: sceneLlm("fail", ["Lettering on the wall behind the counter"]), drive: mockDrive() });
  const r1 = a.pipeline.start(a.pipeline.create({ form: formT1(), picked: PICK, saveDrive: true }));
  await settle(a.pipeline);
  const x1 = a.store.getRun(r1.id).items[0];
  assert.equal(deliverability(x1).status, "held");
  assert.ok(deliverability(x1).reasons.some((m) => /Lettering/.test(m)));

  const drive = mockDrive(), b = setup({ llm: sceneLlm("uncertain", ["Possible text on a cabinet"]), drive });
  const r2 = b.pipeline.start(b.pipeline.create({ form: formT1(), picked: PICK, saveDrive: true }));
  await settle(b.pipeline);
  assert.equal(drive.uploads.length, 0);
  b.pipeline.approveScene(r2.id, { note: "checked", actor: "t" });
  await settle(b.pipeline);
  assert.equal(drive.uploads.length, 3);
  assert.throws(() => b.pipeline.approveScene(r2.id, {}), /uncertain/, "only an uncertain check can be approved, once it's been decided");
});

test("no language model: the scene check is off and nothing auto-delivers", { skip: !HAS_BROWSER && "no Chromium" }, async () => {
  const drive = mockDrive(), { pipeline, store } = setup({ llm: null, drive });
  const run = pipeline.start(pipeline.create({ form: formT1(), picked: PICK, saveDrive: true }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.ok(r.items.every((x) => deliverability(x).status === "unchecked"));
  assert.equal(drive.uploads.length, 0);
});

test("scene submission timeout: ambiguous, never resubmitted, nothing composed", { skip: !HAS_BROWSER && "no Chromium" }, async () => {
  const { pipeline, store, renderer } = setup();
  renderer.afterAccept = async () => { throw Object.assign(new Error("socket hang up"), { code: "timeout" }); };
  const run = pipeline.start(pipeline.create({ form: formT1(), picked: PICK }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.status, "needs_decision");
  assert.equal(r.scene.state, "ambiguous");
  assert.equal(renderer.accepted.length, 1);
  assert.throws(() => pipeline.resume(run.id), /outcome is unknown/);
  assert.ok(r.items.every((x) => !x.file));
});

test("re-compose is free: same scene, no new render, files rebuilt", { skip: !HAS_BROWSER && "no Chromium" }, async () => {
  const { pipeline, store, renderer } = setup();
  const run = pipeline.start(pipeline.create({ form: formT1(), picked: PICK }));
  await settle(pipeline);
  pipeline.refinish(run.id);
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(renderer.accepted.length, 1); assert.equal(r.credits, 2);
  assert.ok(r.items.every((x) => x.state === "done" && x.file));
});

test("COMPOSED_TEMPLATES= sends T1 back down the original pipeline", () => {
  const { pipeline } = setup({ env: { COMPOSED_TEMPLATES: "" } });
  assert.equal(pipeline.create({ form: formT1(), picked: PICK }).S.composed, false);
  const d = setup();
  assert.equal(d.pipeline.create({ form: formT1(), picked: PICK }).S.composed, true);
  assert.equal(d.pipeline.create({ form: { ...formT1(), tpl: "t2" }, picked: PICK }).S.composed, true);
  const only = setup({ env: { COMPOSED_TEMPLATES: "t1" } });
  assert.equal(only.pipeline.create({ form: { ...formT1(), tpl: "t2" }, picked: PICK }).S.composed, false, "a template left out of the list uses the original pipeline");
  assert.equal(d.pipeline.create({ form: formT4(), picked: PICK }).S.composed, true);
});

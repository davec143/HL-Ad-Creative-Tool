// Pipeline integration tests: real finishing (Python), fake renderer, mock LLM and Drive.
// Covers the paths that cost money or lose work if they go wrong: resume without re-paying,
// the one-time repaint, regenerate, QA holding files back from Drive, and the credit caps.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Pipeline } from "../server/pipeline.mjs";
import { FakeRenderer } from "../server/render/fake.mjs";
import { readConfig, ROOT } from "../server/config.mjs";
import { SAMPLE, LOGOGRID } from "../core/brand.mjs";

const PY = process.env.PYTHON || (fs.existsSync(path.join(ROOT, ".venv/bin/python")) ? path.join(ROOT, ".venv/bin/python") : "python3");
const quiet = { error() {} };

function setup({ fault = "", llm = null, drive = null, cfgOver = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hlab-"));
  const cfg = { ...readConfig({ DATA_DIR: dir, PYTHON: PY }), ...cfgOver };
  const store = new Store(dir);
  const renderer = new FakeRenderer({ store, python: PY, fault });
  const pipeline = new Pipeline({ cfg, store, renderer, llm, drive, log: quiet });
  return { cfg, store, renderer, pipeline, dir };
}
function formFor(tpl) { return { tpl, ...SAMPLE[tpl], phone: "+1 855 768 4135", email: "customerservice@hitlights.com", angle: "" }; }
const PICK = { url: "https://cdn.shopify.com/p.jpg", title: "EZDim 12V LED Dimmer Driver 40W", label: "EZDim 12V LED Dimmer Driver 40W" };
async function settle(p) { await p.queue; await p.queue; }
function jpegSize(buf) { // read width/height from the SOF marker
  let i = 2;
  while (i < buf.length) {
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}

test("full set: three exact-size files, logo on the grid, 6 credits, run log", async () => {
  const { pipeline, store } = setup();
  const run = pipeline.start(pipeline.create({ form: formFor("t1"), picked: PICK }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.status, "done", JSON.stringify(r.log.slice(-3)));
  assert.equal(r.credits, 6);
  assert.equal(store.creditsToday(), 6);
  for (const x of r.items) {
    assert.equal(x.state, "done");
    assert.deepEqual(x.flags, []);
    const buf = fs.readFileSync(store.filePath(r.id, x.file));
    assert.deepEqual(jpegSize(buf), [x.W, x.H]);
    assert.ok(buf.length <= 460000);
    const g = LOGOGRID.t1.pos[x.kind];
    assert.deepEqual([x.at.x, x.at.y, x.at.colour], [g[0], g[1], "white"]);
    assert.equal(x.qa.state, "off");
  }
  assert.ok(r.masterJob && r.productId);
});

test("blank logo patch: repainted once, then clean", async () => {
  const { pipeline, store } = setup({ fault: "placeholder" });
  const run = pipeline.start(pipeline.create({ form: formFor("t4"), picked: PICK }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.status, "done", JSON.stringify(r.log.slice(-4)));
  assert.equal(r.credits, 12, "3 renders + 3 repaints");
  for (const x of r.items) { assert.equal(x.repaired, true); assert.deepEqual(x.flags, []); }
  assert.ok(r.log.some((l) => /Repainting the blank patch/.test(l.msg)));
});

test("per-set credit cap stops a set before it overspends", async () => {
  const { pipeline, store } = setup({ fault: "placeholder", cfgOver: { maxCreditsPerRun: 8 } });
  const run = pipeline.start(pipeline.create({ form: formFor("t4"), picked: PICK }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.status, "failed");
  assert.equal(r.error.code, "credit_cap");
  assert.equal(r.credits, 6, "the repaints were never submitted");
});

test("crash while waiting: resume waits for the paid job instead of paying again", async () => {
  const { pipeline, store, renderer } = setup();
  let submits = 0, failOnce = true;
  const submit = renderer.submit.bind(renderer), wait = renderer.wait.bind(renderer);
  renderer.submit = async (reqs) => { submits += reqs.length; return submit(reqs); };
  renderer.wait = async (jobs) => {
    if (failOnce && jobs.length === 2) { failOnce = false; const e = new Error("Still rendering after about seven minutes."); e.code = "timeout"; throw e; }
    return wait(jobs);
  };
  const run = pipeline.start(pipeline.create({ form: formFor("t3"), picked: PICK }));
  await settle(pipeline);
  let r = store.getRun(run.id);
  assert.equal(r.status, "failed");
  assert.equal(r.error.code, "timeout");
  assert.ok(r.items.filter((x) => x.pending).length === 2, "portrait + landscape jobs kept");
  assert.equal(submits, 3);
  pipeline.resume(run.id);
  await settle(pipeline);
  r = store.getRun(run.id);
  assert.equal(r.status, "done", JSON.stringify(r.log.slice(-3)));
  assert.equal(submits, 3, "nothing re-submitted");
  assert.equal(r.credits, 6);
});

test("server restart mid-run: resumeInterrupted picks it up", async () => {
  const a = setup();
  const run = a.pipeline.create({ form: formFor("t5"), picked: PICK });
  run.status = "running"; a.store.saveRun(run); // as if the process died here
  const b = new Pipeline({ cfg: a.cfg, store: a.store, renderer: a.renderer, llm: null, drive: null, log: quiet });
  b.resumeInterrupted();
  await settle(b);
  assert.equal(a.store.getRun(run.id).status, "done");
});

test("regenerate one size: version 2 from the same master, +2 credits", async () => {
  const { pipeline, store } = setup();
  const run = pipeline.start(pipeline.create({ form: formFor("t1"), picked: PICK }));
  await settle(pipeline);
  const master = store.getRun(run.id).masterJob;
  pipeline.regenerate(run.id, "portrait");
  await settle(pipeline);
  const r = store.getRun(run.id), p = r.items.find((x) => x.kind === "portrait");
  assert.equal(p.version, 2); assert.equal(p.state, "done"); assert.equal(p.file, "portrait-v2.jpg");
  assert.equal(r.masterJob, master); assert.equal(r.credits, 8);
});

test("regenerate the square: a new set with a (set 2) folder", async () => {
  const { pipeline, store } = setup();
  const run = pipeline.start(pipeline.create({ form: formFor("t1"), picked: PICK }));
  await settle(pipeline);
  const next = pipeline.regenerate(run.id, "master");
  await settle(pipeline);
  const r2 = store.getRun(next.id);
  assert.notEqual(next.id, run.id);
  assert.match(r2.S.folder, / \(set 2\)$/);
  assert.equal(r2.status, "done");
});

test("QA fail holds the file back from Drive; clean files are uploaded; force saves it", async () => {
  const uploads = [];
  const drive = { enabled: true, createFolder: async (n) => ({ id: "F1", url: "https://drive.google.com/drive/folders/F1", name: n }), uploadJpeg: async (f, name, bytes) => { uploads.push(name); assert.ok(bytes.length > 1000); return { id: "d" + uploads.length }; } };
  const prompts = [];
  const llm = { name: "mock", json: async ({ prompt, images, schema }) => {
    prompts.push(prompt); assert.equal(images.length, 3); assert.ok(schema);
    return { images: [{ size: "1080x1080", verdict: "pass", issues: [] }, { size: "1080x1920", verdict: "pass", issues: [] }, { size: "1200x628", verdict: "fail", issues: ["Headline reads \"DRIVR\""] }] };
  } };
  const { pipeline, store } = setup({ llm, drive });
  const run = pipeline.start(pipeline.create({ form: formFor("t1"), picked: PICK, saveDrive: true }));
  await settle(pipeline);
  let r = store.getRun(run.id);
  assert.match(prompts[0], /EXPECTED TEXT/);
  const L = r.items.find((x) => x.kind === "landscape");
  assert.deepEqual(L.flags, ["TEXT"]); assert.equal(L.held, true); assert.equal(L.drive, null);
  assert.deepEqual(uploads.sort(), ["1080x1080.jpg", "1080x1920.jpg"]);
  assert.equal(r.folder.id, "F1");
  pipeline.saveToDrive(run.id, "landscape", true);
  await settle(pipeline);
  r = store.getRun(run.id);
  assert.deepEqual(uploads.sort(), ["1080x1080.jpg", "1080x1920.jpg", "1200x628.jpg"]);
});

test("QA error is reported per image and can be re-run", async () => {
  let calls = 0;
  const llm = { name: "mock", json: async () => { calls++; if (calls === 1) { const e = new Error("rate limited"); e.code = "rate_limited"; throw e; } return { images: [{ verdict: "pass", issues: [] }, { verdict: "pass", issues: [] }, { verdict: "pass", issues: [] }] }; } };
  const { pipeline, store } = setup({ llm });
  const run = pipeline.start(pipeline.create({ form: formFor("t2"), picked: PICK }));
  await settle(pipeline);
  assert.ok(store.getRun(run.id).items.every((x) => x.qa.state === "error"));
  pipeline.recheck(run.id);
  await settle(pipeline);
  assert.ok(store.getRun(run.id).items.every((x) => x.qa.state === "pass"));
});

test("refinish reuses the renders at 0 credits", async () => {
  const { pipeline, store } = setup();
  const run = pipeline.start(pipeline.create({ form: formFor("t1"), picked: PICK }));
  await settle(pipeline);
  pipeline.refinish(run.id);
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.credits, 6);
  assert.ok(r.items.every((x) => x.state === "done" && x.file));
});

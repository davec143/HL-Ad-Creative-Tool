// Operational hardening: self-check, single-instance lock, shutdown gate, Drive idempotency, logs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { selfCheck, InstanceLock } from "../server/selfcheck.mjs";
import { readConfig, ROOT } from "../server/config.mjs";
import { Store } from "../server/store.mjs";
import { Pipeline } from "../server/pipeline.mjs";
import { FakeRenderer } from "../server/render/fake.mjs";
import { Obs } from "../server/obs.mjs";
import { SAMPLE } from "../core/brand.mjs";

const PY = process.env.PYTHON || (fs.existsSync(path.join(ROOT, ".venv/bin/python")) ? path.join(ROOT, ".venv/bin/python") : "python3");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hlab-ops-"));
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("self-check passes on a healthy setup and fails on a bad python or unwritable data dir", async () => {
  const ok = await selfCheck(readConfig({ DATA_DIR: tmp(), PYTHON: PY, RENDERER: "fake" }));
  assert.equal(ok.ok, true, JSON.stringify(ok.checks));
  assert.deepEqual(ok.checks.map((c) => c.name), ["data_dir_writable", "python_finishing", "logo_hashes", "finish_py_v16", "renderer_config"]);
  const badPy = await selfCheck(readConfig({ DATA_DIR: tmp(), PYTHON: "/nonexistent/python", RENDERER: "fake" }));
  assert.equal(badPy.checks.find((c) => c.name === "python_finishing").ok, false);
  const file = path.join(tmp(), "not-a-dir"); fs.writeFileSync(file, "x");
  const badDir = await selfCheck(readConfig({ DATA_DIR: file, PYTHON: PY, RENDERER: "fake" }));
  assert.equal(badDir.checks.find((c) => c.name === "data_dir_writable").ok, false);
  const prod = await selfCheck({ ...readConfig({ DATA_DIR: tmp(), PYTHON: PY, RENDERER: "fake" }), production: true });
  assert.equal(prod.checks.find((c) => c.name === "renderer_not_fake_in_production").ok, false);
});

test("instance lock: a second live instance is refused; a stale lock is taken over", async () => {
  const dir = tmp();
  const a = new InstanceLock(dir), b = new InstanceLock(dir);
  await a.acquire();
  await assert.rejects(b.acquire({ waitMs: 50, poll: 10 }), /Another instance/);
  a.release();
  await b.acquire({ waitMs: 50, poll: 10 }); b.release();
  const c = new InstanceLock(dir, { staleMs: 10 });
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  fs.writeFileSync(path.join(dir, "state", "instance.lock"), JSON.stringify({ id: "dead", pid: 1, at: Date.now() - 60000 }));
  await c.acquire({ waitMs: 50, poll: 10 }); assert.equal(c.read().id, c.id); c.release();
});

function setup(drive) {
  const dir = tmp(), store = new Store(dir), lines = [];
  const cfg = readConfig({ DATA_DIR: dir, PYTHON: PY, REQUIRE_PRODUCT_FIDELITY: "0" });
  const llm = { name: "m", json: async () => ({ images: ["1080x1080", "1080x1920", "1200x628"].map((size) => ({ size, verdict: "pass", issues: [] })) }) };
  const obs = new Obs({ store, write: (l) => lines.push(JSON.parse(l)) });
  const pipeline = new Pipeline({ cfg, store, renderer: new FakeRenderer({ store, python: PY }), llm, drive, obs, log: { error() {} }, sleep: async () => {}, fetchSource: async (u, d) => { fs.writeFileSync(d, PNG1); return { sha256: "x", bytes: 1 }; } });
  return { pipeline, store, lines };
}
const PICK = { url: "https://cdn.shopify.com/p.jpg", title: "EZDim" };
const form = { tpl: "t1", ...SAMPLE.t1, phone: "+1 855 768 4135", email: "customerservice@hitlights.com" };
async function settle(p) { for (let i = 0; i < 4; i++) await p.idle(); }

test("shutdown: no new runs and no new paid submissions", async () => {
  const { pipeline, store } = setup(null);
  pipeline.shuttingDown = true;
  assert.throws(() => pipeline.start(pipeline.create({ form, picked: PICK })), /restarting/);
  pipeline.shuttingDown = false;
  const run = pipeline.create({ form, picked: PICK });
  await assert.rejects((async () => { pipeline.shuttingDown = true; await pipeline.paidPreflight(run, 1); })(), /restarting/);
  assert.equal(store.creditsToday(), 0);
});

test("Drive: folder saved right away; a crash mid-upload is reconciled by lookup, never uploaded twice", async () => {
  const uploads = [], files = new Map();
  let crashOnce = true, folders = 0;
  const drive = { enabled: true, parent: "P",
    createFolder: async (n) => { folders++; return { id: "F" + folders, url: "https://drive.google.com/drive/folders/F" + folders }; },
    findByName: async (parent, name) => (files.has(parent + "/" + name) ? { id: files.get(parent + "/" + name) } : null),
    uploadJpeg: async (f, name) => {
      files.set(f + "/" + name, "id-" + name); uploads.push(name);
      if (crashOnce && name === "1080x1920.jpg") { crashOnce = false; throw new Error("socket hang up"); } // stored, but we never heard back
      return { id: "id-" + name };
    } };
  const { pipeline, store } = setup(drive);
  const run = pipeline.start(pipeline.create({ form, picked: PICK, saveDrive: true }));
  await settle(pipeline);
  let r = store.getRun(run.id);
  assert.equal(r.folder.id, "F1");
  assert.equal(r.items.find((x) => x.kind === "portrait").driveUpload.state, "uploading");
  pipeline.saveToDrive(run.id); await settle(pipeline);
  r = store.getRun(run.id);
  assert.equal(folders, 1, "folder not created twice");
  assert.deepEqual(uploads.filter((n) => n === "1080x1920.jpg").length, 1, "the interrupted upload was found, not repeated");
  assert.ok(r.items.every((x) => x.drive), JSON.stringify(r.items.map((x) => x.driveUpload)));
  assert.equal(r.items.find((x) => x.kind === "portrait").driveUpload.reconciled, true);
});

test("structured logs carry run/attempt ids and state transitions, never prompts; metrics count", async () => {
  const { pipeline, store, lines } = setup(null);
  const run = pipeline.start(pipeline.create({ form, picked: PICK }));
  await settle(pipeline);
  const sub = lines.filter((l) => l.event === "render_submitted");
  assert.equal(sub.length, 3, "one per attempt");
  assert.ok(sub.every((l) => l.runId === run.id && l.attemptId && l.from === "prepared" && l.to === "submitting"));
  assert.ok(lines.some((l) => l.event === "render_accepted" && l.jobId));
  assert.ok(!JSON.stringify(lines).includes(SAMPLE.t1.scene), "no prompt text in logs");
  const m = pipeline.obs.metrics();
  assert.equal(m.counters.render_submitted, 3); assert.equal(m.counters.render_accepted, 3);
  assert.equal(m.counters.qa_pass, 3); assert.equal(m.runDurationMs.count, 1);
  void store;
});

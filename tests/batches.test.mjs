// Batch admission, restart and render-credit safety. All providers and images are local fakes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "../server/store.mjs";
import { Pipeline } from "../server/pipeline.mjs";
import { createApp, publicBatch } from "../server/app.mjs";
import { readConfig } from "../server/config.mjs";
import { SAMPLE } from "../core/brand.mjs";

const FORM = { tpl: "t1", ...SAMPLE.t1, scene: "A modern kitchen at dusk with warm under-cabinet lighting.", phone: "+1 855 768 4135", email: "customerservice@hitlights.com" };
const PICK = { url: "https://cdn.shopify.com/test.png", title: "Batch test product" };
const INPUT = { form: FORM, picked: PICK, count: 5, saveDrive: false };
function setup({ dir = fs.mkdtempSync(path.join(os.tmpdir(), "hlab-batches-")), renderer, cfg: overrides = {} } = {}) {
  const store = new Store(dir), cfg = { ...readConfig({ DATA_DIR: dir }), ...overrides };
  renderer ||= {
    accepted: [], waits: [], balance: async () => 1000, status: async () => ({ connected: true }),
    async submit(requests) {
      return { jobs: requests.map((r) => {
        const job_id = "00000000-0000-4000-8000-" + String(this.accepted.length + 1).padStart(12, "0");
        this.accepted.push({ ...r, job_id }); return { index: r.index, job_id, status: "queued" };
      }) };
    },
    async wait(jobs) { this.waits.push(...jobs); return jobs.map((j) => ({ ...j, status: "completed", result_url: "https://example.com/scene.jpg" })); }
  };
  const pipeline = new Pipeline({ cfg, store, renderer, llm: null, drive: null, log: { error() {} }, sleep: async () => {} });
  // Exercise the real composed pipeline, attempts, submission, gate and queue; avoid expensive
  // image work already covered by composed.test.mjs.
  pipeline.stepSource = async (r) => { r.S.source.file = "source.img"; pipeline.save(r); };
  pipeline.stepCutout = async (r) => { r.cutout = { state: "approved" }; pipeline.save(r); };
  pipeline.stepPreflight = async () => {};
  pipeline.stepSceneFetch = async (r) => { r.scene.file = "scene.png"; pipeline.save(r); };
  pipeline.stepSceneQa = async (r) => { r.scene.qa = { state: "pass", version: 1 }; pipeline.save(r); };
  pipeline.stepVisibleSceneQa = async () => {};
  pipeline.stepCompose = async (r, items) => {
    store.runDir(r.id);
    for (const x of items) {
      x.file = x.kind + ".jpg"; x.state = "done"; x.output = { ok: true };
      x.cutout = { state: "approved" }; x.sceneQa = { state: "pass" };
      fs.writeFileSync(store.filePath(r.id, x.file), Buffer.from("local fake output " + r.id + x.kind));
    }
    pipeline.save(r);
  };
  return { dir, cfg, store, renderer, pipeline };
}
async function serve(a, fn) {
  const server = http.createServer(createApp({ ...a, shopify: { enabled: false }, llm: null, drive: null }));
  await new Promise((r) => server.listen(0, r));
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (route, body = {}) => fetch(base + route, { method: "POST", headers: { "content-type": "application/json", origin: new URL(a.cfg.publicUrl).origin }, body: JSON.stringify(body) });
  try { await fn({ base, post }); }
  finally { await a.pipeline.idle(); await new Promise((r) => server.close(r)); }
}

test("five sets run sequentially with distinct scenes, 15 outputs and exactly five charged attempts", async () => {
  const a = setup({ cfg: { maxCreditsPerDay: 10, maxCreditsPerRun: 2 } });
  let active = 0, peak = 0;
  const original = a.renderer.wait;
  a.renderer.wait = async (...args) => { peak = Math.max(peak, ++active); await delay(1); const r = await original.apply(a.renderer, args); active--; return r; };
  const b = a.pipeline.createBatch(INPUT);
  assert.equal(a.store.creditsToday(), 10);
  assert.ok(b.runIds.every((id) => a.store.getRun(id).status === "batch_queued"));
  a.pipeline.startBatch(b); await a.pipeline.idle();
  const out = publicBatch(a.store.getBatch(b.id), { store: a.store });
  assert.equal(out.status, "done"); assert.equal(out.completed, 5); assert.equal(out.readyFiles, 15);
  assert.equal(peak, 1); assert.equal(a.renderer.accepted.length, 5);
  assert.equal(new Set(a.renderer.accepted.map((x) => x.params.prompt)).size, 5);
  assert.ok(out.scenePlans.every((p) => p.scene.includes(FORM.scene)));
  assert.deepEqual(out.scenePlans.map((p) => p.scene), b.runIds.map((id) => a.store.getRun(id).form.scene));
  assert.equal(out.credits, 10); assert.equal(out.creditsDetail.reserved, 0); assert.equal(out.creditsDetail.spent, 10);
  assert.equal(a.store.creditsToday(), 10);
});

test("batch size, composed mode, credit caps and HTTP balance are validated before children exist", async () => {
  const a = setup({ cfg: { maxCreditsPerDay: 6 } });
  for (const count of [0, 6, -1, 1.5, "2", null]) assert.throws(() => a.pipeline.createBatch({ ...INPUT, count }), { code: "bad_request" });
  assert.throws(() => a.pipeline.createBatch(INPUT), { code: "credit_cap" });
  assert.equal(a.store.listRuns().length, 0);
  await serve(a, async ({ post }) => {
    a.renderer.balance = async () => 3;
    assert.equal((await post("/api/batches", { ...INPUT, count: 2 })).status, 402);
    assert.equal((await post("/api/batches", { ...INPUT, count: 2, form: { ...FORM, sceneLayout: "bogus" } })).status, 400);
    assert.equal(a.store.listBatches().length, 0);
  });
});

test("single-set and batch admission share one lock across a 20-request burst", async () => {
  const a = setup();
  a.renderer.status = async () => { await delay(25); return { connected: true }; };
  a.renderer.wait = async (jobs) => { await delay(20); return jobs.map((j) => ({ ...j, status: "completed", result_url: "https://example.com/s.jpg" })); };
  await serve(a, async ({ post }) => {
    const answers = await Promise.all(Array.from({ length: 20 }, (_, i) => post(i % 2 ? "/api/runs" : "/api/batches", { ...INPUT, count: 2 })));
    assert.equal(answers.filter((x) => x.status === 201).length, 1);
    assert.equal(answers.filter((x) => x.status === 409).length, 19);
    await a.pipeline.idle();
    assert.ok(a.renderer.accepted.length <= 2);
  });
});

test("replaying a completed batch request does not generate again; changed payload conflicts", async () => {
  const a = setup();
  await serve(a, async ({ post }) => {
    const request = { ...INPUT, count: 1, requestId: "batch-request-123" };
    const first = await post("/api/batches", request); assert.equal(first.status, 201);
    const { batch } = await first.json(); await a.pipeline.idle();
    const again = await post("/api/batches", request); assert.equal(again.status, 200);
    assert.equal((await again.json()).batch.id, batch.id);
    assert.equal(a.renderer.accepted.length, 1);
    assert.equal((await post("/api/batches", { ...request, count: 2 })).status, 409);
  });
});

test("unconfirmed render pauses later sets; repeated Resume cannot resubmit it", async () => {
  const a = setup(), submit = a.renderer.submit;
  a.renderer.submit = async (...args) => { await submit.apply(a.renderer, args); throw new Error("lost response"); };
  const b = a.pipeline.createBatch(INPUT); a.pipeline.startBatch(b); await a.pipeline.idle();
  assert.equal(a.store.getBatch(b.id).status, "paused");
  assert.equal(a.store.getRun(b.runIds[0]).status, "needs_decision");
  assert.equal(a.renderer.accepted.length, 1); assert.equal(a.store.creditsForBatch(b.id).reserved, 10);
  assert.throws(() => a.pipeline.resumeBatch(b.id), { code: "ambiguous" });
  const recovered = setup({ dir: a.dir, renderer: a.renderer });
  recovered.pipeline.resumeInterrupted(); await recovered.pipeline.idle();
  assert.equal(a.renderer.accepted.length, 1);
  a.pipeline.cancelBatch(b.id);
  assert.equal(a.store.creditsForBatch(b.id).reserved, 2, "only the ambiguous attempt stays reserved");
});

test("accepted render survives wait failure and restart without another submit", async () => {
  const a = setup(); let once = true;
  const wait = a.renderer.wait;
  a.renderer.wait = async (...args) => { if (once) { once = false; throw new Error("wait failed"); } return wait.apply(a.renderer, args); };
  const b = a.pipeline.createBatch({ ...INPUT, count: 3 }); a.pipeline.startBatch(b); await a.pipeline.idle();
  assert.equal(a.store.getBatch(b.id).status, "paused"); assert.equal(a.renderer.accepted.length, 1);
  const recovered = setup({ dir: a.dir, renderer: a.renderer });
  recovered.pipeline.resumeBatch(b.id); recovered.pipeline.resumeBatch(b.id); await recovered.pipeline.idle();
  assert.equal(a.renderer.accepted.length, 3); assert.equal(recovered.store.getBatch(b.id).status, "done");
});

test("partial composition resumes without repeating scenes or finished sizes", async () => {
  const a = setup(), compose = a.pipeline.stepCompose; let failed = false;
  a.pipeline.stepCompose = async (r, items) => {
    if (!failed) { failed = true; await compose(r, items.slice(0, 2)); r.items[2].state = "failed"; a.pipeline.save(r); }
    else await compose(r, items);
  };
  const b = a.pipeline.createBatch({ ...INPUT, count: 2 }); a.pipeline.startBatch(b); await a.pipeline.idle();
  assert.equal(a.store.getBatch(b.id).status, "paused"); assert.equal(a.renderer.accepted.length, 1);
  a.pipeline.resumeBatch(b.id); await a.pipeline.idle();
  assert.equal(a.store.getBatch(b.id).status, "done"); assert.equal(a.renderer.accepted.length, 2);
});

test("cancel during balance await prevents a new submission and releases unused plans", async () => {
  const a = setup(); let entered, release;
  const pending = new Promise((r) => { release = r; }); const seen = new Promise((r) => { entered = r; });
  a.renderer.balance = async () => { entered(); await pending; return 1000; };
  const b = a.pipeline.createBatch(INPUT); a.pipeline.startBatch(b); await seen;
  a.pipeline.cancelBatch(b.id); release(); await a.pipeline.idle();
  assert.equal(a.renderer.accepted.length, 0); assert.equal(a.store.creditsToday(), 0);
  assert.equal(a.store.getBatch(b.id).status, "cancelled");
});

test("cancel finishes the accepted current set but starts no later sets", async () => {
  const a = setup(); let entered, release;
  const pending = new Promise((r) => { release = r; }); const seen = new Promise((r) => { entered = r; });
  const wait = a.renderer.wait;
  a.renderer.wait = async (...args) => { entered(); await pending; return wait.apply(a.renderer, args); };
  const b = a.pipeline.createBatch(INPUT); a.pipeline.startBatch(b); await seen;
  a.pipeline.cancelBatch(b.id); release(); await a.pipeline.idle();
  assert.equal(a.store.getRun(b.runIds[0]).status, "done"); assert.equal(a.renderer.accepted.length, 1);
  assert.equal(a.store.getBatch(b.id).status, "cancelled"); assert.equal(a.store.creditsToday(), 2);
});

test("restart after cancellation finishes the persisted accepted child before cancelling", async () => {
  const a = setup(), b = a.pipeline.createBatch({ ...INPUT, count: 3 });
  const r = a.store.getRun(b.runIds[1]);
  const first = a.store.getRun(b.runIds[0]); first.status = "done"; a.store.saveRun(first); a.store.releaseBatchPlans(b.id, first.id);
  const att = a.pipeline.newAttempt(r, r.scene, "render", { prompt: r.S.scenePrompt });
  const response = await a.renderer.submit([{ index: att.index, params: att.params }]);
  att.state = "accepted"; att.jobId = response.jobs[0].job_id; a.store.markSpent(att.id); r.status = "running"; a.pipeline.save(r);
  b.status = "running"; b.activeRunId = r.id; b.cancelRequested = true; a.store.saveBatch(b);
  const recovered = setup({ dir: a.dir, renderer: a.renderer }); recovered.pipeline.resumeInterrupted(); await recovered.pipeline.idle();
  assert.equal(a.store.getRun(r.id).status, "done"); assert.equal(a.store.getBatch(b.id).status, "cancelled");
  assert.equal(a.renderer.accepted.length, 1); assert.equal(a.store.getRun(b.runIds[2]).status, "batch_queued");
});

test("restart completes interrupted admission once and never resumes orphan children alone", async () => {
  const a = setup(), save = a.store.saveRun.bind(a.store); let writes = 0;
  a.store.saveRun = (r) => { if (++writes === 2) throw new Error("simulated admission crash"); return save(r); };
  assert.throws(() => a.pipeline.createBatch({ ...INPUT, count: 3 }), /crash/);
  const b = a.store.listBatches()[0]; assert.equal(b.status, "initializing");
  assert.equal(a.store.listRuns()[0].status, "batch_queued");
  const recovered = setup({ dir: a.dir, renderer: a.renderer }); recovered.pipeline.resumeInterrupted(); await recovered.pipeline.idle();
  assert.equal(a.store.getBatch(b.id).status, "done"); assert.equal(a.store.listRuns().length, 3); assert.equal(a.renderer.accepted.length, 3);
});

test("missing admitted child pauses safely and cannot manufacture a replacement render", async () => {
  const a = setup(), b = a.pipeline.createBatch({ ...INPUT, count: 2 });
  fs.unlinkSync(a.store.runPath(b.runIds[0]));
  assert.throws(() => a.pipeline.resumeBatch(b.id), { code: "batch_integrity" });
  a.pipeline.resumeInterrupted(); await a.pipeline.idle();
  assert.equal(a.store.getBatch(b.id).status, "paused"); assert.equal(a.renderer.accepted.length, 0);
});

test("outstanding plans remain budgeted after UTC rollover and transfer without double counting", async () => {
  const a = setup({ cfg: { maxCreditsPerDay: 10 } }), b = a.pipeline.createBatch(INPUT);
  const ledger = a.store.ledger(); for (const e of Object.values(ledger.entries)) e.day = "2000-01-01"; a.store.setState("ledger", ledger);
  assert.equal(a.store.creditsToday(), 10);
  a.pipeline.startBatch(b); await a.pipeline.idle();
  assert.equal(a.store.getBatch(b.id).status, "done"); assert.equal(a.store.creditsToday(), 10);
});

test("batch ZIP groups ready files by set and excludes held files", async () => {
  const a = setup(), b = a.pipeline.createBatch({ ...INPUT, count: 2 });
  a.pipeline.startBatch(b); await a.pipeline.idle();
  const r = a.store.getRun(b.runIds[1]); r.items[1].sceneQa = { state: "fail", issues: ["stray text"] }; a.store.saveRun(r);
  await serve(a, async ({ base }) => {
    const response = await fetch(base + "/api/batches/" + b.id + "/zip"); assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer()), names = []; let off = 0;
    while (bytes.readUInt32LE(off) === 0x04034b50) {
      const length = bytes.readUInt32LE(off + 18), nl = bytes.readUInt16LE(off + 26);
      names.push(bytes.subarray(off + 30, off + 30 + nl).toString()); off += 30 + nl + length;
    }
    assert.equal(names.length, 5); assert.ok(names.includes("Set-01/1080x1920.jpg")); assert.ok(!names.includes("Set-02/1080x1920.jpg"));
  });
});

test("restart resumes a later edit on a completed batch child without repeating its scene", async () => {
  const a = setup(), b = a.pipeline.createBatch({ ...INPUT, count: 2 });
  a.pipeline.startBatch(b); await a.pipeline.idle();
  const r = a.store.getRun(b.runIds[0]); r.status = "running"; r.items[0].file = null; r.items[0].state = "finishing"; a.store.saveRun(r);
  const recovered = setup({ dir: a.dir, renderer: a.renderer }); recovered.pipeline.resumeInterrupted(); await recovered.pipeline.idle();
  assert.equal(a.store.getRun(r.id).status, "done"); assert.ok(a.store.getRun(r.id).items[0].file);
  assert.equal(a.renderer.accepted.length, 2);
});

test("crash on either side of planned-to-attempt transfer preserves budget and submits once", async () => {
  for (const afterTransfer of [false, true]) {
    const a = setup({ cfg: { maxCreditsPerDay: 4, maxCreditsPerRun: 2 } }), b = a.pipeline.createBatch({ ...INPUT, count: 2 });
    const r = a.store.getRun(b.runIds[0]), reserve = a.store.reserve.bind(a.store);
    a.store.reserve = (...args) => { if (afterTransfer) reserve(...args); throw new Error("transfer crash"); };
    assert.throws(() => a.pipeline.newAttempt(r, r.scene, "render", { prompt: r.S.scenePrompt }), /transfer crash/);
    b.status = "running"; b.activeRunId = r.id; a.store.saveBatch(b);
    const recovered = setup({ dir: a.dir, renderer: a.renderer, cfg: { maxCreditsPerDay: 4, maxCreditsPerRun: 2 } });
    recovered.pipeline.resumeInterrupted(); await recovered.pipeline.idle();
    assert.equal(a.store.getBatch(b.id).status, "done", String(afterTransfer));
    assert.equal(a.renderer.accepted.length, 2); assert.equal(a.store.creditsToday(), 4);
    assert.ok(Number.isFinite(a.store.reservedCredits()));
    assert.ok(Number.isFinite(a.store.creditTotals(() => true).released));
  }
});

test("restart after last child finishes but before parent finalization does not repeat work", async () => {
  const a = setup(), b = a.pipeline.createBatch({ ...INPUT, count: 2 });
  a.pipeline.startBatch(b); await a.pipeline.idle();
  const interrupted = a.store.getBatch(b.id); interrupted.status = "running"; interrupted.activeRunId = b.runIds[1]; a.store.saveBatch(interrupted);
  const recovered = setup({ dir: a.dir, renderer: a.renderer }); recovered.pipeline.resumeInterrupted(); await recovered.pipeline.idle();
  assert.equal(a.store.getBatch(b.id).status, "done"); assert.equal(a.renderer.accepted.length, 2);
});

test("one cutout approval refreshes every finished sibling, preserves pixels and spends nothing", async () => {
  const a = setup(), meta = { state: "auto", sha: "a".repeat(64), revision: "b".repeat(64) };
  a.pipeline._cutouts = { get: () => ({ ...meta }), approve: async (sha, actor, rev) => { assert.equal(rev, meta.revision); meta.state = "approved"; } };
  a.pipeline.stepCutout = async (r) => { r.cutout = { ...meta }; a.pipeline.save(r); };
  const b = a.pipeline.createBatch({ ...INPUT, count: 3 }); a.pipeline.startBatch(b); await a.pipeline.idle();
  const filesBefore = b.runIds.map((id) => a.store.getRun(id).items.map((x) => fs.readFileSync(a.store.filePath(id, x.file))));
  assert.equal(publicBatch(a.store.getBatch(b.id), { store: a.store }).held, 3);
  await a.pipeline.approveCutout(b.runIds[0], { actor: "test", revision: meta.revision });
  assert.equal(a.store.getBatch(b.id).status, "done"); assert.equal(a.renderer.accepted.length, 3);
  assert.equal(publicBatch(a.store.getBatch(b.id), { store: a.store }).readyFiles, 9);
  for (const [i, id] of b.runIds.entries()) assert.deepEqual(a.store.getRun(id).items.map((x) => fs.readFileSync(a.store.filePath(id, x.file))), filesBefore[i]);
});

test("approval refresh cannot start pending children in a paused batch and survives restart", async () => {
  const a = setup(), meta = { state: "approved", sha: "a".repeat(64), revision: "b".repeat(64) };
  a.pipeline._cutouts = { get: () => ({ ...meta }) };
  a.pipeline.stepCutout = async (r) => { r.cutout = { ...meta }; a.pipeline.save(r); };
  const b = a.pipeline.createBatch({ ...INPUT, count: 3 });
  await a.pipeline.process(b.runIds[0]);
  b.status = "queued"; b.refresh = { sha: meta.sha, revision: meta.revision, runIds: [b.runIds[0]], returnStatus: "paused", returnError: { code: "original_error" }, returnCancelRequested: false }; a.store.saveBatch(b);
  const recovered = setup({ dir: a.dir, renderer: a.renderer });
  recovered.pipeline._cutouts = a.pipeline._cutouts;
  recovered.pipeline.stepCutout = async (r) => { r.cutout = { ...meta }; recovered.pipeline.save(r); };
  recovered.pipeline.resumeInterrupted(); await recovered.pipeline.idle();
  assert.equal(a.store.getBatch(b.id).status, "paused"); assert.equal(a.store.getBatch(b.id).error.code, "original_error");
  assert.equal(a.renderer.accepted.length, 1); assert.equal(a.store.plannedForRun(b.runIds[1]), 2);
  assert.equal(a.store.getRun(b.runIds[1]).status, "batch_queued");
});

test("all child mutation actions are blocked throughout a running batch", async () => {
  const a = setup(); let enter, release;
  const seen = new Promise((r) => { enter = r; }), wait = new Promise((r) => { release = r; });
  a.renderer.balance = async () => { enter(); await wait; return 1000; };
  const b = a.pipeline.createBatch({ ...INPUT, count: 2 }); a.pipeline.startBatch(b); await seen;
  const id = b.runIds[1], before = a.store.getRun(id);
  for (const call of [() => a.pipeline.resume(id), () => a.pipeline.regenerate(id, "master"), () => a.pipeline.refinish(id), () => a.pipeline.recheck(id), () => a.pipeline.saveToDrive(id), () => a.pipeline.approveScene(id, {})]) assert.throws(call, { code: "busy" });
  assert.deepEqual(a.store.getRun(id), before);
  a.pipeline.cancelBatch(b.id); release(); await a.pipeline.idle();
});

test("T6 graphic default uses zero paid scenes and rejects multiple identical graphic sets", async () => {
  const a = setup(); let providerCalls = 0;
  for (const name of ["balance", "status", "submit", "wait"]) a.renderer[name] = async () => { providerCalls++; throw new Error("No provider needed"); };
  for (const name of ["stepSceneFetch", "stepSceneQa", "stepVisibleSceneQa"]) a.pipeline[name] = Pipeline.prototype[name].bind(a.pipeline);
  const form = { ...FORM, tpl: "t6", sceneLayout: "template" };
  assert.equal(a.pipeline.estimate(form), 0);
  assert.throws(() => a.pipeline.createBatch({ ...INPUT, form, count: 2 }), { code: "bad_request" });
  const b = a.pipeline.createBatch({ ...INPUT, form, count: 1 }); a.pipeline.startBatch(b); await a.pipeline.idle();
  const r = a.store.getRun(b.runIds[0]);
  assert.equal(r.status, "done"); assert.equal(providerCalls, 0); assert.equal(r.credits, 0);
  assert.equal(r.scene.qa.state, "not_applicable"); assert.equal(r.S.sceneRequired, false);
  assert.equal(publicBatch(a.store.getBatch(b.id), { store: a.store }).readyFiles, 3);
  assert.equal(a.pipeline.estimate({ ...form, sceneLayout: "full" }, 5), 10);
});

test("T6 zero-credit HTTP admission never requires renderer authentication or balance", async () => {
  const a = setup();
  for (const name of ["balance", "status", "submit", "wait"]) a.renderer[name] = async () => { throw new Error("renderer unavailable"); };
  for (const name of ["stepSceneFetch", "stepSceneQa", "stepVisibleSceneQa"]) a.pipeline[name] = Pipeline.prototype[name].bind(a.pipeline);
  const form = { tpl: "t6", ...SAMPLE.t6, sceneLayout: "template", phone: FORM.phone, email: FORM.email };
  await serve(a, async ({ post }) => {
    assert.equal((await post("/api/batches", { ...INPUT, form, count: 2 })).status, 400);
    const batch = await post("/api/batches", { ...INPUT, form, count: 1 }); assert.equal(batch.status, 201, await batch.clone().text());
    await a.pipeline.idle();
    const single = await post("/api/runs", { ...INPUT, form }); assert.equal(single.status, 201, await single.clone().text());
    await a.pipeline.idle(); assert.equal(a.store.creditsToday(), 0);
  });
});

test("pending batch reservations cannot be spent by newly admitted work", async () => {
  const a = setup(), b = a.pipeline.createBatch({ ...INPUT, count: 3 });
  b.status = "paused"; a.store.saveBatch(b);
  a.renderer.balance = async () => 6;
  await serve(a, async ({ post }) => {
    assert.equal((await post("/api/batches", { ...INPUT, count: 1 })).status, 402);
    assert.equal((await post("/api/runs", INPUT)).status, 402);
    assert.equal(a.store.listBatches().length, 1);
    a.pipeline.cancelBatch(b.id);
    assert.equal((await post("/api/batches", { ...INPUT, count: 1 })).status, 201);
  });
});

test("uploaded corrected cutout rebuilds every saved sibling from the exact new revision for free", async () => {
  const a = setup(), meta = { state: "approved", sha: "a".repeat(64), revision: "b".repeat(64) };
  a.pipeline._cutouts = {
    get: () => ({ ...meta }),
    upload: async () => { meta.revision = "c".repeat(64); meta.state = "uploaded"; return { ...meta }; }
  };
  a.pipeline.stepCutout = async (r) => {
    if (r.cutout && r.cutout.revision !== meta.revision) a.pipeline.invalidateCutoutOutputs(r);
    r.cutout = { ...meta }; a.pipeline.save(r);
  };
  const compose = a.pipeline.stepCompose;
  a.pipeline.stepCompose = async (r, items) => { await compose(r, items); for (const x of items) fs.appendFileSync(a.store.filePath(r.id, x.file), meta.revision); };
  const b = a.pipeline.createBatch({ ...INPUT, count: 3 }); a.pipeline.startBatch(b); await a.pipeline.idle();
  await a.pipeline.uploadCutout(b.runIds[0], Buffer.from("test PNG handled by fake"), { actor: "test" });
  assert.equal(a.renderer.accepted.length, 3); assert.equal(a.store.getBatch(b.id).status, "done");
  for (const id of b.runIds) {
    const r = a.store.getRun(id); assert.equal(r.cutout.revision, meta.revision);
    for (const x of r.items) { assert.ok(fs.readFileSync(a.store.filePath(id, x.file)).toString().endsWith(meta.revision)); assert.ok(a.pipeline.gate(x).deliverable); }
  }
});

test("approval refresh stops if shared pixels change during its cutout snapshot", async () => {
  const a = setup(), meta = { state: "auto", sha: "a".repeat(64), revision: "b".repeat(64) }; let change = false;
  a.pipeline._cutouts = { get: () => ({ ...meta }), approve: async () => { meta.state = "approved"; change = true; } };
  a.pipeline.stepCutout = async (r) => {
    if (change) { change = false; meta.revision = "c".repeat(64); a.pipeline.invalidateCutoutOutputs(r); }
    r.cutout = { ...meta }; a.pipeline.save(r);
  };
  const b = a.pipeline.createBatch({ ...INPUT, count: 2 }); a.pipeline.startBatch(b); await a.pipeline.idle();
  await a.pipeline.approveCutout(b.runIds[0], { actor: "test", revision: meta.revision });
  assert.equal(a.renderer.accepted.length, 2);
  const out = a.store.getBatch(b.id); assert.equal(out.status, "paused"); assert.equal(out.error.code, "stale_cutout");
  assert.ok(a.store.getRun(b.runIds[0]).items.every((x) => !x.file));
});

test("a transient source download failure can resume the batch without replacing its children", async () => {
  const a = setup(); let calls = 0;
  a.pipeline.stepSource = Pipeline.prototype.stepSource.bind(a.pipeline);
  a.pipeline.fetchSource = async (url, file) => { if (++calls === 1) throw new Error("temporary source timeout"); fs.writeFileSync(file, "local source"); return { sha256: "a".repeat(64), bytes: 12 }; };
  const b = a.pipeline.createBatch({ ...INPUT, count: 2 }); a.pipeline.startBatch(b); await a.pipeline.idle();
  assert.equal(a.store.getBatch(b.id).status, "paused"); assert.equal(a.renderer.accepted.length, 0);
  a.pipeline.resumeBatch(b.id); await a.pipeline.idle();
  assert.equal(a.store.getBatch(b.id).status, "done"); assert.equal(a.renderer.accepted.length, 2);
  assert.equal(a.store.listRuns().length, 2); assert.equal(calls, 3);
});

test("uploading a cutout into an unrendered paused or cancelled batch cannot restart paid work", async () => {
  for (const cancelled of [false, true]) {
    const a = setup(), meta = { state: "failed", sha: "a".repeat(64), revision: null };
    a.pipeline._cutouts = { get: () => ({ ...meta }), upload: async () => { meta.state = "uploaded"; meta.revision = "b".repeat(64); return { ...meta }; } };
    a.pipeline.stepCutout = async (r) => { r.cutout = { ...meta }; a.pipeline.save(r); };
    const b = a.pipeline.createBatch({ ...INPUT, count: 2 }); b.status = "paused"; a.store.saveBatch(b);
    const r = a.store.getRun(b.runIds[0]); r.cutout = { ...meta }; r.status = "failed"; a.store.saveRun(r);
    if (cancelled) a.pipeline.cancelBatch(b.id);
    await a.pipeline.uploadCutout(r.id, Buffer.from("test upload"), { actor: "test" });
    assert.equal(a.renderer.accepted.length, 0, String(cancelled));
    assert.equal(a.store.getBatch(b.id).status, cancelled ? "cancelled" : "paused");
    assert.equal(a.store.getRun(r.id).cutout.state, "uploaded");
  }
});

test("regenerating a graphic with no scene cannot create duplicate sets or paid work", async () => {
  const a = setup(), form = { ...FORM, tpl: "t6", sceneLayout: "template" };
  const r = a.pipeline.create({ form, picked: PICK });
  assert.throws(() => a.pipeline.regenerate(r.id, "master"), { code: "bad_request" });
  assert.equal(a.store.listRuns().length, 1); assert.equal(a.renderer.accepted.length, 0);
});


test("renderer status outages leave free tooling and the effective template list available", async () => {
  const a = setup({ cfg: { composedTemplates: [] } });
  a.renderer.status = async () => { throw new Error("provider offline"); };
  await serve(a, async ({ base }) => {
    const response = await fetch(base + "/api/status"); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.renderer.connected, false);
    assert.deepEqual(body.composed, ["t6", "t7", "t8", "t9", "t10", "t11"]);
    assert.equal(body.balance, null);
  });
});

// Paid-render safety: crash injection around Higgsfield submissions. Every test counts how many
// jobs the (fake) provider actually created, which is what would have been charged.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Pipeline } from "../server/pipeline.mjs";
import { FakeRenderer } from "../server/render/fake.mjs";
import { RenderError } from "../server/render/higgsfield-mcp.mjs";
import { readConfig, ROOT } from "../server/config.mjs";
import { SAMPLE } from "../core/brand.mjs";

const PY = process.env.PYTHON || (fs.existsSync(path.join(ROOT, ".venv/bin/python")) ? path.join(ROOT, ".venv/bin/python") : "python3");
const quiet = { error() {} };
const PICK = { url: "https://cdn.shopify.com/p.jpg", title: "EZDim 12V", label: "EZDim 12V" };
const form = (tpl = "t1") => ({ tpl, ...SAMPLE[tpl], phone: "+1 855 768 4135", email: "customerservice@hitlights.com" });

function setup(cfgOver = {}, { dir, renderer } = {}) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), "hlab-safe-"));
  const cfg = { ...readConfig({ DATA_DIR: dir, PYTHON: PY, COMPOSED_TEMPLATES: "" }), ...cfgOver };
  const store = new Store(dir);
  renderer = renderer || new FakeRenderer({ store, python: PY });
  const pipeline = new Pipeline({ cfg, store, renderer, llm: null, drive: null, log: quiet, sleep: async () => {} });
  return { cfg, store, renderer, pipeline, dir };
}
async function settle(p) { for (let i = 0; i < 4; i++) await p.idle(); }
const states = (r) => r.attempts.map((a) => a.kind + ":" + a.state);

test("crash before the request leaves: Resume submits it once", async () => {
  const a = setup();
  const run = a.pipeline.create({ form: form(), picked: PICK });
  // Simulate a process that died after preparing the master attempt, before sending it.
  run.productId = "fake-media-x"; run.status = "running";
  const M = run.items[0];
  const att = a.pipeline.newAttempt(run, M, "render", { model: "nano_banana_pro", prompt: run.S.prompts.master, aspect_ratio: "1:1", medias: [] });
  a.store.saveRun(run);
  assert.equal(a.store.creditsForRun(run.id).reserved, 2);
  const b = setup({}, { dir: a.dir, renderer: a.renderer });
  b.pipeline.resumeInterrupted();
  await settle(b.pipeline);
  const r = b.store.getRun(run.id);
  assert.equal(r.status, "done", JSON.stringify(r.log.slice(-3)));
  assert.equal(a.renderer.accepted.length, 3, "one job per size, no duplicate");
  const old = r.attempts.find((x) => x.id === att.id);
  assert.equal(old.state, "failed"); assert.equal(old.notSent, true);
  assert.equal(b.store.ledger().entries[att.id].state, "released");
  assert.equal(r.credits, 6);
});

test("provider accepts, then the process dies before the job id is saved: ambiguous, never resubmitted", async () => {
  const a = setup();
  const run = a.pipeline.start(a.pipeline.create({ form: form(), picked: PICK }));
  await settle(a.pipeline);
  // Simulate exactly that state on disk for a fresh regeneration: attempt "submitting", job created.
  const r0 = a.store.getRun(run.id), P = r0.items.find((x) => x.kind === "portrait");
  P.version++; P.state = "rendering"; P.url = null; P.file = null;
  const att = a.pipeline.newAttempt(r0, P, "render", { model: "nano_banana_pro", prompt: r0.S.prompts.portrait, aspect_ratio: "9:16", medias: [] });
  att.state = "submitting"; att.submittedAt = Date.now();
  a.renderer.createJob({ index: att.index, params: att.params, meta: att.meta }); // Higgsfield did create it
  r0.status = "running"; a.store.saveRun(r0);
  const before = a.renderer.accepted.length;
  const b = setup({}, { dir: a.dir, renderer: a.renderer });
  b.pipeline.resumeInterrupted();
  await settle(b.pipeline);
  const r = b.store.getRun(run.id);
  assert.equal(r.status, "needs_decision");
  assert.equal(r.attempts.find((x) => x.id === att.id).state, "ambiguous");
  assert.equal(a.renderer.accepted.length, before, "nothing resubmitted");
  assert.equal(b.store.ledger().entries[att.id].state, "reserved", "credits stay reserved");
  assert.throws(() => b.pipeline.resume(run.id), /outcome is unknown/);
});

test("submission timeout: ambiguous, no automatic resubmission", async () => {
  const { pipeline, store, renderer } = setup();
  let calls = 0;
  renderer.beforeSubmit = async (reqs) => { calls++; if (reqs.length === 2) { reqs.forEach((q) => renderer.createJob(q)); throw new RenderError("server_unavailable", "Higgsfield didn't answer: timed out", { sent: true }); } };
  const run = pipeline.start(pipeline.create({ form: form(), picked: PICK }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.status, "needs_decision");
  assert.deepEqual(states(r), ["master:completed", "portrait:ambiguous", "landscape:ambiguous"]);
  assert.equal(calls, 2, "master once, derived once, never again");
  assert.equal(r.credits, 6, "2 spent + 4 reserved");
  assert.deepEqual(r.creditsDetail, { reserved: 4, spent: 2, released: 0, estimate: true });
});

test("a request that never left the server (sign-in failed first) is released, not ambiguous", async () => {
  const { pipeline, store, renderer } = setup();
  renderer.beforeSubmit = async () => { throw new RenderError("needs_auth", "Sign in to Higgsfield.", { sent: false }); };
  const run = pipeline.start(pipeline.create({ form: form(), picked: PICK }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.status, "failed"); assert.equal(r.error.code, "needs_auth");
  assert.deepEqual(states(r), ["master:failed"]);
  assert.equal(r.credits, 0);
});

test("a batch answer missing an item: that item is ambiguous, no automatic retry", async () => {
  const { pipeline, store, renderer } = setup();
  let derivedCalls = 0;
  renderer.submitResponse = (reqs, create) => {
    if (reqs.length === 2) { derivedCalls++; reqs.forEach(create); return { jobs: [{ index: reqs[0].index, job_id: renderer.accepted.at(-2).job_id, status: "queued" }], raw: {} }; }
    return { jobs: reqs.map((q) => ({ index: q.index, job_id: create(q), status: "queued" })), raw: {} };
  };
  const run = pipeline.start(pipeline.create({ form: form(), picked: PICK }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.deepEqual(states(r), ["master:completed", "portrait:accepted", "landscape:ambiguous"]);
  assert.equal(derivedCalls, 1);
  assert.equal(r.status, "needs_decision");
});

test("explicit submission_failed: exactly one retry, then the size fails", async () => {
  const { pipeline, store, renderer } = setup();
  let landscapeTries = 0;
  renderer.submitResponse = (reqs, create) => ({ raw: {}, jobs: reqs.map((q) => {
    if (q.meta.kind === "landscape") { landscapeTries++; return { index: q.index, status: "submission_failed" }; }
    return { index: q.index, job_id: create(q), status: "queued" };
  }) });
  const run = pipeline.start(pipeline.create({ form: form(), picked: PICK }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(landscapeTries, 2, "first try + one retry");
  assert.equal(r.items.find((x) => x.kind === "landscape").state, "failed");
  assert.equal(r.status, "partial");
  assert.equal(r.credits, 4, "rejected attempts released");
  assert.equal(r.creditsDetail.released, 4);
});

test("explicit rejection on the first try, accepted on the retry", async () => {
  const { pipeline, store, renderer } = setup();
  let n = 0;
  renderer.submitResponse = (reqs, create) => ({ raw: {}, jobs: reqs.map((q) => (q.meta.kind === "portrait" && n++ === 0) ? { index: q.index, status: "submission_failed" } : { index: q.index, job_id: create(q), status: "queued" }) });
  const run = pipeline.start(pipeline.create({ form: form(), picked: PICK }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.status, "done");
  assert.equal(renderer.accepted.length, 3);
  assert.equal(r.attempts.filter((a) => a.retryOf).length, 1);
});

test("repeated Resume requests queue the work once", async () => {
  const { pipeline, store, renderer } = setup();
  renderer.beforeWait = async (jobs) => { if (jobs.length === 2 && !renderer.waited) { renderer.waited = true; const e = new Error("still rendering"); e.code = "timeout"; throw e; } };
  const run = pipeline.start(pipeline.create({ form: form(), picked: PICK }));
  await settle(pipeline);
  assert.equal(store.getRun(run.id).status, "failed");
  pipeline.resume(run.id); pipeline.resume(run.id); pipeline.resume(run.id);
  assert.throws(() => pipeline.refinish(run.id), /already queued/);
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.status, "done");
  assert.equal(renderer.accepted.length, 3);
  assert.equal(r.log.filter((l) => /Resuming/.test(l.msg)).length, 1);
});

test("regeneration obeys the daily cap, counting reservations", async () => {
  const { pipeline, store } = setup({ maxCreditsPerDay: 8 });
  const run = pipeline.start(pipeline.create({ form: form(), picked: PICK }));
  await settle(pipeline);
  pipeline.regenerate(run.id, "portrait"); await settle(pipeline);
  assert.equal(store.getRun(run.id).credits, 8);
  pipeline.regenerate(run.id, "landscape"); await settle(pipeline);
  const r = store.getRun(run.id);
  assert.match(r.log.at(-1).msg, /daily|Today's credit cap/);
  assert.equal(r.credits, 8);
});

test("regeneration checks the live balance first", async () => {
  const { pipeline, store, renderer } = setup();
  const run = pipeline.start(pipeline.create({ form: form(), picked: PICK }));
  await settle(pipeline);
  renderer.credits = 1;
  pipeline.regenerate(run.id, "portrait"); await settle(pipeline);
  const r = store.getRun(run.id);
  assert.match(r.log.at(-1).msg, /balance is 1/);
  assert.equal(renderer.accepted.length, 3);
});

test("repaint obeys the per-set cap", async () => {
  const { pipeline, store, renderer } = setup({ maxCreditsPerRun: 8 });
  renderer.fault = "placeholder";
  const run = pipeline.start(pipeline.create({ form: form("t4"), picked: PICK }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.error.code, "credit_cap");
  assert.equal(renderer.accepted.length, 3, "no repaint submitted");
});

test("ambiguous reservations block another set from passing the daily cap", async () => {
  const { pipeline, store, renderer } = setup({ maxCreditsPerDay: 8 });
  renderer.beforeSubmit = async (reqs) => { if (reqs.length === 2 && !renderer.once) { renderer.once = true; throw new RenderError("server_unavailable", "dropped", { sent: true }); } };
  const a = pipeline.start(pipeline.create({ form: form(), picked: PICK }));
  await settle(pipeline);
  assert.equal(store.creditsToday(), 6, "2 spent + 4 reserved");
  const b = pipeline.start(pipeline.create({ form: form("t2"), picked: PICK }));
  await settle(pipeline);
  const rb = store.getRun(b.id);
  assert.equal(rb.error.code, "credit_cap", "master fits (8), the derived pair would not");
  assert.equal(store.getRun(a.id).status, "needs_decision");
});

test("ambiguous stays reserved until resolved: skip (not charged) releases, adopt counts as spent", async () => {
  const { pipeline, store, renderer } = setup();
  renderer.beforeSubmit = async (reqs) => { if (reqs.length === 2 && !renderer.once) { renderer.once = true; reqs.forEach((q) => renderer.createJob(q)); throw new RenderError("server_unavailable", "dropped", { sent: true }); } };
  const run = pipeline.start(pipeline.create({ form: form(), picked: PICK }));
  await settle(pipeline);
  let r = store.getRun(run.id);
  const [pa, la] = r.attempts.filter((a) => a.state === "ambiguous");
  assert.equal(store.ledger().entries[pa.id].state, "reserved");
  const { supported, candidates } = await pipeline.candidates(run.id, pa.id);
  assert.ok(supported && candidates.length === 1, "the job is found in history");
  const after1 = pipeline.resolve(run.id, pa.id, { action: "adopt", jobId: candidates[0].jobId, actor: "test" });
  assert.equal(after1.status, "needs_decision", "landscape still undecided");
  pipeline.resolve(run.id, la.id, { action: "skip", charged: false, actor: "test" });
  await settle(pipeline);
  r = store.getRun(run.id);
  assert.equal(store.ledger().entries[pa.id].state, "spent");
  assert.equal(store.ledger().entries[la.id].state, "released");
  assert.equal(r.items.find((x) => x.kind === "portrait").state, "done", "adopted job finished");
  assert.equal(r.items.find((x) => x.kind === "landscape").state, "failed");
  assert.equal(r.attempts.find((a) => a.id === pa.id).resolution.actor, "test");
  assert.equal(renderer.accepted.length, 3, "adopting never submits");
});

test("resolve: retry re-renders knowingly and counts the old attempt as charged when told so", async () => {
  const { pipeline, store, renderer } = setup();
  renderer.beforeSubmit = async (reqs) => { if (reqs.length === 2 && !renderer.once) { renderer.once = true; throw new RenderError("server_unavailable", "dropped", { sent: true }); } };
  const run = pipeline.start(pipeline.create({ form: form(), picked: PICK }));
  await settle(pipeline);
  for (const a of store.getRun(run.id).attempts.filter((x) => x.state === "ambiguous")) pipeline.resolve(run.id, a.id, { action: "retry", charged: true });
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.equal(r.status, "done");
  assert.equal(r.credits, 10, "2 + 4 (counted charged) + 4 re-render");
  assert.throws(() => pipeline.resolve(run.id, r.attempts[0].id, { action: "adopt", jobId: "x" }), /isn't waiting/);
});

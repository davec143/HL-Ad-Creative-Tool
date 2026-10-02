// Development renderer: draws a synthetic render in the style of the template (finishing/fake_render.py)
// instead of calling Higgsfield. Same interface as HiggsfieldMcpRenderer; costs nothing.
// Set FAKE_FAULT=collision|placeholder|nocta|high to exercise the flag paths end to end.
// Tests can set `renderer.beforeSubmit` / `afterAccept` / `submitResponse` to inject failures.
import path from "node:path";
import fs from "node:fs";
import { ROOT } from "../config.mjs";
import { runPython } from "../py.mjs";

export class FakeRenderer {
  constructor({ store, python, fault = process.env.FAKE_FAULT || "", balance = 999 }) {
    this.store = store; this.python = python; this.fault = fault; this.name = "Fake renderer";
    this.dir = path.join(store.dir, "fake"); fs.mkdirSync(this.dir, { recursive: true });
    this.jobs = new Map(); this.n = 0; this.credits = balance;
    this.accepted = []; // every job this "provider" created, for duplicate-spend assertions
  }
  async status() { return { connected: true, fake: true }; }
  async balance() { return this.credits; }
  async importMedia(url) { return "fake-media-" + Buffer.from(url).toString("base64url").slice(0, 16); }
  async close() {}

  createJob(r) {
    const id = "00000000-0000-4000-8000-" + String(++this.n).padStart(12, "0");
    const m = r.meta || {};
    const out = path.join(this.dir, id + ".png");
    this.jobs.set(id, runPython(this.python, path.join(ROOT, "finishing", "fake_render.py"),
      // A repaint clears the fault, as a successful Higgsfield repaint would.
      [m.tpl || "t1", m.kind || "master", out, m.repaint ? "-" : (this.fault || "-"), JSON.stringify(m.zone || [0, 0, 0, 0])])
      .then(() => ({ status: "completed", result_url: "file://" + out }), (e) => ({ status: "failed", error: e.message })));
    this.credits -= 2;
    this.accepted.push({ job_id: id, index: r.index, prompt: r.params.prompt, aspect_ratio: r.params.aspect_ratio, at: Date.now() });
    return id;
  }

  async submit(requests) {
    if (this.beforeSubmit) await this.beforeSubmit(requests);
    if (this.submitResponse) return this.submitResponse(requests, (r) => this.createJob(r));
    const jobs = requests.map((r) => ({ index: r.index, job_id: this.createJob(r), status: "queued" }));
    if (this.afterAccept) await this.afterAccept(jobs);
    return { jobs, raw: {} };
  }
  async wait(jobs) {
    if (this.beforeWait) await this.beforeWait(jobs);
    const out = [];
    for (const j of jobs) out.push({ index: j.index, job_id: j.job_id, ...(await this.jobs.get(j.job_id) || { status: "failed" }) });
    return out;
  }
  async findCandidates(attempt) {
    return this.accepted.filter((a) => a.prompt === attempt.params.prompt && a.aspect_ratio === attempt.params.aspect_ratio)
      .map((a) => ({ jobId: a.job_id, createdAt: a.at, status: "completed" }));
  }
}

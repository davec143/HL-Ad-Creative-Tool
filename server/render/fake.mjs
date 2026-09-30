// Development renderer: draws a synthetic render in the style of the template (finishing/fake_render.py)
// instead of calling Higgsfield. Same interface as HiggsfieldMcpRenderer; costs nothing.
// Set FAKE_FAULT=collision|placeholder|nocta|high to exercise the flag paths end to end.
import path from "node:path";
import fs from "node:fs";
import { ROOT } from "../config.mjs";
import { runPython } from "../py.mjs";

export class FakeRenderer {
  constructor({ store, python, fault = process.env.FAKE_FAULT || "" }) {
    this.store = store; this.python = python; this.fault = fault; this.name = "Fake renderer";
    this.dir = path.join(store.dir, "fake"); fs.mkdirSync(this.dir, { recursive: true });
    this.jobs = new Map(); this.n = 0; this.credits = 999;
  }
  async status() { return { connected: true, fake: true }; }
  async balance() { return this.credits; }
  async importMedia(url) { return "fake-media-" + Buffer.from(url).toString("base64url").slice(0, 16); }
  async submit(requests) {
    const jobs = [];
    for (const r of requests) {
      const id = "00000000-0000-4000-8000-" + String(++this.n).padStart(12, "0");
      const m = r.meta || {};
      const out = path.join(this.dir, id + ".png");
      this.jobs.set(id, runPython(this.python, path.join(ROOT, "finishing", "fake_render.py"),
        // A repaint clears the fault, as a successful Higgsfield repaint would.
        [m.tpl || "t1", m.kind || "master", out, m.repaint ? "-" : (this.fault || "-"), JSON.stringify(m.zone || [0, 0, 0, 0])])
        .then(() => ({ status: "completed", result_url: "file://" + out }), (e) => ({ status: "failed", error: e.message })));
      this.credits -= 2;
      jobs.push({ index: r.index, job_id: id, status: "queued" });
    }
    return jobs;
  }
  async wait(jobs) {
    const out = [];
    for (const j of jobs) out.push({ index: j.index, job_id: j.job_id, ...(await this.jobs.get(j.job_id) || { status: "failed" }) });
    return out;
  }
}

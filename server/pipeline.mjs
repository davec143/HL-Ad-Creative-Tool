// The run pipeline, v16's order with every step persisted:
//   import product photo -> render the 1:1 master -> render 9:16 + 16:9 FROM the master ->
//   finish (exact size, colour locks, real logo) -> repaint a blank logo patch once ->
//   text & logo check -> save clean files to Drive -> done.
// A run is a JSON document in the store. Each step checks what is already done, and a submitted
// render's job id is saved the moment Higgsfield returns it, so resuming after a crash, restart
// or timeout waits for that job instead of paying for it again.
import fs from "node:fs";
import path from "node:path";
import { Store } from "./store.mjs";
import { finishOne, fetchRender } from "./finish.mjs";
import { snapshot, renderParams, repaintParams, qaPrompt, parseQa } from "../core/engine.mjs";
import { CANVAS, KINDS, BLOCKING } from "../core/brand.mjs";
import { QA_SCHEMA } from "./providers/llm.mjs";

const INDEX = { master: 1, portrait: 2, landscape: 3 };

export class PipelineError extends Error { constructor(code, message) { super(message); this.code = code; } }

export function fileName(x) { return x.dims + (x.version > 1 ? "-v" + x.version : "") + ".jpg"; }
export function blockingFlags(x) { return (x.flags || []).filter((f) => BLOCKING.includes(f)); }

export class Pipeline {
  constructor({ cfg, store, renderer, llm, drive, log = console }) {
    Object.assign(this, { cfg, store, renderer, llm, drive, logger: log });
    this.active = null; // id of the run being worked on (one at a time)
    this.queue = Promise.resolve();
  }

  // ---------- helpers ----------
  log(run, msg, cls = "run") { run.log.push({ t: Date.now(), msg, cls }); this.store.saveRun(run); }
  item(run, kind) { return run.items.find((x) => x.kind === kind); }
  save(run) { this.store.saveRun(run); }

  spendCheck(run, n) {
    const c = n * this.cfg.creditsPerRender;
    if (run.credits + c > this.cfg.maxCreditsPerRun) throw new PipelineError("credit_cap", `This set has used ${run.credits} credits; another ${c} would pass the per-set cap of ${this.cfg.maxCreditsPerRun} (MAX_CREDITS_PER_RUN).`);
    if (this.store.creditsToday() + c > this.cfg.maxCreditsPerDay) throw new PipelineError("credit_cap", `Today's credit cap of ${this.cfg.maxCreditsPerDay} would be passed (MAX_CREDITS_PER_DAY). It resets at midnight UTC.`);
  }
  spent(run, n) { const c = n * this.cfg.creditsPerRender; run.credits += c; this.store.addCredits(c); }

  // ---------- creating runs ----------
  // input: {form, picked:{url,title,label,outOfStock,desc}, saveDrive}
  create({ form, picked, saveDrive, setNo = 1, folderOverride }) {
    const S = snapshot(form, picked);
    if (folderOverride) S.folder = folderOverride;
    const run = {
      id: Store.newId(), ts: Date.now(), status: "queued", error: null, log: [],
      form, picked, S, setNo, saveDrive: !!saveDrive, credits: 0, pass: 0,
      productId: null, masterJob: null, folder: null,
      items: KINDS.map((k) => ({
        kind: k, dims: CANVAS[k].dims, title: CANVAS[k].title, W: CANVAS[k].W, H: CANVAS[k].H,
        logo: S.logo[k], version: 1, state: k === "master" ? "rendering" : "waiting",
        job: null, url: null, pending: null, file: null, mode: "", flags: [], repaired: false, qa: null, drive: null, held: false, error: null,
      })),
    };
    this.log(run, "Settings captured — edits from here on won't affect this set.");
    return run;
  }

  // Serialize all work: one run (or regeneration) at a time, like v16's busy lock.
  enqueue(id, fn) {
    const p = this.queue.then(async () => {
      this.active = id;
      try { await fn(); } finally { this.active = null; }
    });
    this.queue = p.catch(() => {});
    return p;
  }
  busy() { return this.active; }

  start(run) { run.status = "queued"; this.save(run); this.enqueue(run.id, () => this.process(run.id)); return run; }
  resume(id) {
    const run = this.store.getRun(id);
    if (!run) throw new PipelineError("not_found", "No such set.");
    if (this.active === id) return run;
    run.status = "queued"; run.error = null; this.save(run);
    this.log(run, "Resuming from where it stopped — renders already paid for are reused.");
    this.enqueue(id, () => this.process(id));
    return run;
  }
  // On boot: pick up anything that was mid-flight when the server stopped.
  resumeInterrupted() {
    for (const r of this.store.listRuns(50)) if (r.status === "running" || r.status === "queued") this.resume(r.id);
  }

  // ---------- the run ----------
  async process(id) {
    const run = this.store.getRun(id);
    run.status = "running"; this.save(run);
    try {
      await this.stepImport(run);
      await this.stepMaster(run);
      await this.stepDerived(run);
      await this.stepFinish(run, run.items.filter((x) => x.url && !x.file && x.state !== "failed"));
      await this.stepRepaint(run);
      await this.stepQa(run, run.items.filter((x) => x.file && !x.qa));
      await this.stepDrive(run, run.items.filter((x) => x.file && !x.drive));
      run.status = run.items.some((x) => x.state === "failed") ? "partial" : "done";
      this.log(run, run.status === "done" ? "Set finished." : "Set finished with a size missing — use Regenerate on it.", run.status === "done" ? "ok" : "err");
    } catch (e) {
      run.status = "failed"; run.error = { code: e.code || "error", message: e.message };
      for (const x of run.items) {
        if (x.pending) continue;                       // a submitted render: Resume waits for it
        if (x.state === "finishing") x.state = "rendered"; // Resume re-finishes it for free
        else if (x.state === "rendering" && !x.url) x.state = "failed";
      }
      this.log(run, (e.code === "needs_auth" ? "Higgsfield sign-in needed — " : "Stopped — ") + e.message, "err");
      this.logger.error && this.logger.error("run", id, e.code, e.message);
    }
    this.save(run);
  }

  async stepImport(run) {
    if (run.productId) return;
    this.log(run, "Importing the product image…");
    run.productId = await this.renderer.importMedia(run.S.url);
    this.log(run, "Image imported.", "ok");
  }

  // Submit renders for items and save their job ids immediately; returns once all are terminal.
  async renderItems(run, list, paramsFor, purpose) {
    const fresh = list.filter((x) => !x.pending);
    if (fresh.length) {
      this.spendCheck(run, fresh.length);
      const reqs = fresh.map((x) => {
        const index = (purpose === "repaint" ? 40 : INDEX[x.kind]) + (run.pass++) * 10;
        return { index, params: paramsFor(x), meta: { tpl: run.S.tpl, kind: x.kind, zone: x.logo.zone, repaint: purpose === "repaint" } };
      });
      this.save(run);
      let jobs;
      try { jobs = await this.renderer.submit(reqs); }
      catch (e) {
        // A failed or timed-out submission may still have created jobs: never auto-retry it.
        if (e.code !== "needs_auth") e.message += " If this keeps happening, check Higgsfield's history before regenerating so nothing is paid for twice.";
        throw e;
      }
      this.spent(run, jobs.length);
      for (const j of jobs) {
        const k = reqs.findIndex((q) => q.index === j.index);
        if (k > -1) fresh[k].pending = { index: j.index, job_id: j.job_id, purpose };
      }
      for (const x of fresh) if (!x.pending) { x.state = "failed"; x.error = "Higgsfield didn't accept this render."; }
      this.save(run);
    }
    const waiting = list.filter((x) => x.pending);
    if (!waiting.length) return;
    const done = await this.renderer.wait(waiting.map((x) => x.pending));
    for (const x of waiting) {
      const j = done.find((d) => d.job_id === x.pending.job_id);
      if (j && j.status === "completed" && j.result_url) {
        x.url = j.result_url; x.job = j.job_id; x.state = "rendered"; x.error = null;
      } else if (purpose === "repaint") {
        this.log(run, "  " + x.dims + " couldn't be repainted — keeping the original.", "err");
      } else {
        x.state = "failed"; x.error = "The " + x.title.toLowerCase() + " render didn't finish (" + ((j && j.status) || "no job") + ").";
      }
      x.pending = null;
    }
    this.save(run);
  }

  async stepMaster(run) {
    const M = this.item(run, "master");
    if (run.masterJob) return;
    // (A master that failed before is tried again: reaching here again means Resume was pressed.)
    M.state = "rendering"; M.error = null; this.log(run, "Rendering the square master…");
    await this.renderItems(run, [M], () => renderParams("master", { productId: run.productId, prompt: run.S.prompts.master }), "render");
    if (!M.url) throw new PipelineError("render_failed", M.error || "The square master didn't render.");
    run.masterJob = M.job;
    this.log(run, "Square master done. Building portrait and landscape from it…", "ok");
  }

  async stepDerived(run) {
    const list = ["portrait", "landscape"].map((k) => this.item(run, k)).filter((x) => !x.url && x.state !== "failed");
    if (!list.length) return;
    for (const x of list) x.state = "rendering";
    this.save(run);
    await this.renderItems(run, list, (x) => renderParams(x.kind, { productId: run.productId, masterJob: run.masterJob, prompt: run.S.prompts[x.kind] }), "render");
    for (const x of list) if (x.state === "failed") this.log(run, "The " + x.title.toLowerCase() + " render didn't finish — use Regenerate this size.", "err");
    if (run.S.outOfStock) this.log(run, "Reminder: the product you picked has zero inventory.", "err");
  }

  async finishItem(run, x) {
    const dir = this.store.runDir(run.id);
    const tag = x.kind + "-v" + x.version + (x.repaired ? "-r" : "");
    const src = path.join(dir, tag + ".src");
    const out = path.join(dir, tag + ".jpg");
    x.state = "finishing"; this.save(run);
    await fetchRender(x.url, src, { dataDir: this.cfg.dataDir });
    const r = await finishOne({ python: this.cfg.python, src, out, W: x.W, H: x.H, logo: x.logo });
    try { fs.unlinkSync(src); } catch { /* ignore */ }
    x.file = path.basename(out); x.mode = r.mode; x.flags = r.flags; x.at = { x: r.x, y: r.y, w: r.w, colour: r.colour };
    x.state = "done"; x.qa = null; x.drive = null; x.held = false;
    this.log(run, "  " + x.dims + " — " + r.mode.replace(/\s*\|\s*FLAGS.*$/, ""), r.flags.length ? "err" : "run");
    if (r.flags.length) this.log(run, "    flagged: " + r.flags.join(", "), "err");
  }

  async stepFinish(run, list) {
    if (!list.length) return;
    this.log(run, "Finishing " + list.map((x) => x.dims).join(", ") + " — exact size, brand colour, logo…");
    for (const x of list) {
      try { await this.finishItem(run, x); }
      catch (e) { x.state = "failed"; x.error = "Finishing failed: " + e.message; this.log(run, "  " + x.dims + " — " + x.error, "err"); }
    }
    this.save(run);
  }

  // A blank placeholder shape where the logo goes can't be hidden behind it: repaint once.
  async stepRepaint(run) {
    const bad = run.items.filter((x) => x.flags.includes("PLACEHOLDER") && !x.repaired && x.job);
    if (!bad.length) return;
    this.log(run, "Repainting the blank patch in " + bad.map((x) => x.dims).join(", ") + " (" + this.cfg.creditsPerRender + " credits each)…");
    for (const x of bad) x.repaired = true;
    this.save(run);
    const before = new Map(bad.map((x) => [x.kind, x.url]));
    await this.renderItems(run, bad, (x) => repaintParams(x.kind, { job: x.job, logo: x.logo }), "repaint");
    const changed = bad.filter((x) => x.url !== before.get(x.kind));
    for (const x of changed) this.log(run, "  " + x.dims + " repainted.", "ok");
    for (const x of changed) x.file = null;
    await this.stepFinish(run, changed);
  }

  async stepQa(run, list) {
    list = list.filter((x) => x.state === "done");
    if (!list.length) return;
    if (!this.llm) { for (const x of list) x.qa = { state: "off" }; this.save(run); return; }
    this.log(run, "Checking text and logo…");
    for (let i = 0; i < list.length; i += 3) {
      const g = list.slice(i, i + 3);
      for (const x of g) x.qa = { state: "running" };
      this.save(run);
      try {
        const images = g.map((x) => fs.readFileSync(this.store.filePath(run.id, x.file)));
        const o = await this.llm.json({ prompt: qaPrompt(run.S.expect, g), images, schema: QA_SCHEMA, model: this.cfg.llmQaModel, effort: "medium" });
        parseQa(o, g.length).forEach((r, k) => {
          const x = g[k];
          x.qa = { state: r.pass ? "pass" : "fail", issues: r.issues };
          x.flags = x.flags.filter((f) => f !== "TEXT"); if (!r.pass) x.flags.push("TEXT");
          this.log(run, "  " + x.dims + " text & logo check: " + (r.pass ? "passed" : "failed — " + r.issues.join("; ")), r.pass ? "ok" : "err");
        });
      } catch (e) {
        for (const x of g) x.qa = { state: "error", code: e.code || "error", message: e.message };
        this.log(run, "  Text & logo check couldn't run: " + e.message, "err");
      }
      this.save(run);
    }
  }

  // Only clean files go to Drive, so the folder never holds one that shouldn't run.
  async stepDrive(run, list, force = false) {
    list = list.filter((x) => x.state === "done" && x.file && !x.drive);
    if (!list.length) return;
    if (!this.drive || !this.drive.enabled || !run.saveDrive) return;
    for (const x of list) x.held = !force && blockingFlags(x).length > 0;
    const go = list.filter((x) => !x.held);
    this.save(run);
    if (!go.length) return;
    try {
      if (!run.folder) run.folder = await this.drive.createFolder(run.S.folder);
      for (const x of go) {
        const f = await this.drive.uploadJpeg(run.folder.id, fileName(x), fs.readFileSync(this.store.filePath(run.id, x.file)));
        x.drive = { id: f.id, name: fileName(x) }; x.held = false;
        this.log(run, "  " + fileName(x) + " saved to Drive.", "ok");
        this.save(run);
      }
    } catch (e) {
      run.driveError = e.message;
      this.log(run, "Drive save failed — " + e.message, "err");
    }
    this.save(run);
  }

  // ---------- actions on a finished set ----------
  regenerate(id, kind) {
    const run = this.store.getRun(id);
    if (!run) throw new PipelineError("not_found", "No such set.");
    if (kind === "master") {
      // A new square means a new set: same settings, next "(set n)" folder.
      const n = (run.setNo || 1) + 1;
      const next = this.create({ form: run.form, picked: run.picked, saveDrive: run.saveDrive, setNo: n,
        folderOverride: run.S.folder.replace(/ \(set \d+\)$/, "") + " (set " + n + ")" });
      return this.start(next);
    }
    const x = this.item(run, kind);
    if (!x || !run.masterJob) throw new PipelineError("bad_request", "This size can't be regenerated until the square master exists.");
    this.enqueue(id, async () => {
      const r = this.store.getRun(id), y = this.item(r, kind);
      Object.assign(y, { version: (y.version || 1) + 1, state: "rendering", job: null, url: null, pending: null, file: null, mode: "", flags: [], repaired: false, qa: null, drive: null, held: false, error: null });
      r.status = "running"; r.error = null;
      this.log(r, "Regenerating the " + y.title.toLowerCase() + " from the same master…");
      try {
        await this.renderItems(r, [y], () => renderParams(kind, { productId: r.productId, masterJob: r.masterJob, prompt: r.S.prompts[kind] }), "render");
        if (!y.url) throw new PipelineError("render_failed", y.error || "The render didn't finish.");
        await this.stepFinish(r, [y]);
        await this.stepRepaint(r);
        await this.stepQa(r, [y]);
        await this.stepDrive(r, [y]);
        r.status = r.items.some((z) => z.state === "failed") ? "partial" : "done";
      } catch (e) {
        if (y.state !== "done") y.state = "failed";
        y.error = e.message; r.status = "partial"; this.log(r, "Regenerate failed — " + e.message, "err");
      }
      this.save(r);
    });
    return run;
  }

  // Re-run finishing on the renders already paid for (0 credits).
  refinish(id) {
    this.enqueue(id, async () => {
      const r = this.store.getRun(id);
      const list = r.items.filter((x) => x.url);
      for (const x of list) { x.file = null; x.repaired = x.repaired || false; }
      await this.stepFinish(r, list);
      await this.stepQa(r, list.filter((x) => x.file));
      await this.stepDrive(r, list.filter((x) => x.file));
      this.save(r);
    });
    return this.store.getRun(id);
  }
  recheck(id, kind) {
    this.enqueue(id, async () => {
      const r = this.store.getRun(id);
      const list = r.items.filter((x) => x.file && (!kind || x.kind === kind));
      for (const x of list) x.qa = null;
      await this.stepQa(r, list);
      await this.stepDrive(r, list);
    });
    return this.store.getRun(id);
  }
  saveToDrive(id, kind, force) {
    this.enqueue(id, async () => {
      const r = this.store.getRun(id);
      r.saveDrive = true; r.driveError = null;
      await this.stepDrive(r, r.items.filter((x) => !kind || x.kind === kind), force);
    });
    return this.store.getRun(id);
  }
}

// The run pipeline, v16's order with every step persisted:
//   import product photo -> render the 1:1 master -> render 9:16 + 16:9 FROM the master ->
//   finish (exact size, colour locks, real logo) -> repaint a blank logo patch once ->
//   text & logo check -> save clean files to Drive -> done.
//
// Paid-render safety (at-most-once, not exactly-once: Higgsfield exposes no idempotency key).
// Every paid request is an "attempt" record on the run, saved BEFORE it is sent:
//   prepared -> submitting -> accepted -> waiting -> completed
//                          -> explicitly_rejected   (Higgsfield said no: credits released)
//                          -> ambiguous             (outcome unknown: credits stay reserved)
//                          -> failed                (provably never sent, or the job failed)
// Only an item explicitly returned as submission_failed is retried automatically (once). A
// timeout, dropped connection, missing/malformed response item, or a crash mid-submission makes
// the attempt ambiguous: the set stops, and a person adopts a found job, re-renders knowingly,
// or skips. Nothing ambiguous is ever resubmitted silently.
import fs from "node:fs";
import path from "node:path";
import { Store } from "./store.mjs";
import { finishOne, fetchRender } from "./finish.mjs";
import { snapshot, renderParams, repaintParams, qaPrompt, parseQa } from "../core/engine.mjs";
import { CANVAS, KINDS, BLOCKING } from "../core/brand.mjs";
import { QA_SCHEMA } from "./providers/llm.mjs";
import crypto from "node:crypto";

const INDEX = { master: 1, portrait: 2, landscape: 3 };
const LIVE = ["prepared", "submitting", "accepted", "waiting", "ambiguous"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stable hash of a request (sorted keys at every level), for reconciliation and audit.
export function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
export function fingerprint(params) { return crypto.createHash("sha256").update(canonical(params)).digest("hex").slice(0, 32); }

export class PipelineError extends Error { constructor(code, message) { super(message); this.code = code; } }

export function fileName(x) { return x.dims + (x.version > 1 ? "-v" + x.version : "") + ".jpg"; }
export function blockingFlags(x) { return (x.flags || []).filter((f) => BLOCKING.includes(f)); }

export class Pipeline {
  constructor({ cfg, store, renderer, llm, drive, log = console, sleep }) {
    Object.assign(this, { cfg, store, renderer, llm, drive, logger: log });
    this.active = null;          // id of the run being worked on (one at a time)
    this.pending = new Set();    // ids queued or active: a second request for the same run is refused
    this.queue = Promise.resolve();
    this.shuttingDown = false;   // set on SIGTERM: no new runs, no new paid submissions
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ---------- helpers ----------
  log(run, msg, cls = "run") { run.log.push({ t: Date.now(), msg, cls }); this.store.saveRun(run); }
  item(run, kind) { return run.items.find((x) => x.kind === kind); }
  save(run) {
    const t = this.store.creditsForRun(run.id);
    run.credits = t.committed; run.creditsDetail = { reserved: t.reserved, spent: t.spent, released: t.released, estimate: true };
    this.store.saveRun(run);
  }
  attempt(run, id) { return id ? (run.attempts || []).find((a) => a.id === id) : null; }
  liveAttempt(run, x) { const a = this.attempt(run, x.attemptId); return a && LIVE.includes(a.state) ? a : null; }

  // Before ANY new paid request: shutdown, both caps (reservations included) and the live balance.
  async paidPreflight(run, n) {
    if (this.shuttingDown) throw new PipelineError("shutting_down", "The server is restarting. Press Resume in a minute.");
    const c = n * this.cfg.creditsPerRender;
    const used = this.store.creditsForRun(run.id).committed;
    if (used + c > this.cfg.maxCreditsPerRun) throw new PipelineError("credit_cap", `This set has ${used} credits reserved or spent; another ${c} would pass the per-set cap of ${this.cfg.maxCreditsPerRun} (MAX_CREDITS_PER_RUN).`);
    const today = this.store.creditsToday();
    if (today + c > this.cfg.maxCreditsPerDay) throw new PipelineError("credit_cap", `Today's credit cap of ${this.cfg.maxCreditsPerDay} would be passed (${today} reserved or spent). It resets at midnight UTC (MAX_CREDITS_PER_DAY).`);
    let bal;
    try { bal = await this.renderer.balance(); }
    catch (e) { throw new PipelineError(e.code === "needs_auth" ? "needs_auth" : "balance_unavailable", "Couldn't read the Higgsfield balance before spending (" + e.message + "). Nothing was submitted."); }
    if (typeof bal === "number" && bal < c) throw new PipelineError("credits", `This needs about ${c} Higgsfield credits and the balance is ${bal}. Top up, then press Resume.`);
  }

  newAttempt(run, x, purpose, params) {
    const a = {
      id: "a" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex"),
      kind: x.kind, version: x.version, purpose, index: (purpose === "repaint" ? 40 : INDEX[x.kind]) + (run.pass++) * 10,
      params, meta: { tpl: run.S.tpl, kind: x.kind, zone: x.logo.zone, repaint: purpose === "repaint" },
      fingerprint: fingerprint(params), state: "prepared", jobId: null, credits: this.cfg.creditsPerRender,
      preparedAt: Date.now(), submittedAt: null, resolvedAt: null, retryOf: null, error: null,
    };
    (run.attempts = run.attempts || []).push(a);
    x.attemptId = a.id;
    this.save(run);                                          // the attempt exists on disk first...
    this.store.reserve(a.id, run.id, a.credits);             // ...then its credits are reserved
    return a;
  }

  // After a crash/restart: "prepared" never left (release it); "submitting" may have reached
  // Higgsfield (ambiguous).
  recover(run) {
    let changed = false;
    for (const a of run.attempts || []) {
      if (a.state === "prepared") {
        a.state = "failed"; a.notSent = true; a.error = "Stopped before it was sent."; a.resolvedAt = Date.now();
        this.store.release(a.id); changed = true;
        for (const x of run.items) if (x.attemptId === a.id) x.attemptId = null;
      } else if (a.state === "submitting") {
        a.state = "ambiguous"; a.error = "The server stopped while this render was being submitted; Higgsfield may or may not have accepted it."; changed = true;
      }
    }
    if (changed) this.save(run);
  }

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
        job: null, url: null, attemptId: null, file: null, mode: "", flags: [], repaired: false, qa: null, drive: null, held: false, error: null,
      })),
    };
    this.log(run, "Settings captured — edits from here on won't affect this set.");
    return run;
  }

  // Serialize all work: one run (or regeneration) at a time, like v16's busy lock. A run that is
  // already queued or active can't be queued again (double-clicked Resume, two tabs...).
  enqueue(id, fn) {
    if (this.pending.has(id)) throw new PipelineError("already_queued", "This set is already queued or running.");
    if (this.shuttingDown) throw new PipelineError("shutting_down", "The server is restarting. Try again in a minute.");
    this.pending.add(id);
    const p = this.queue.then(async () => {
      this.active = id;
      try { await fn(); } finally { this.active = null; this.pending.delete(id); }
    });
    this.queue = p.catch(() => {});
    return p;
  }
  busy() { return this.active || this.pending.values().next().value || null; }
  idle() { return this.queue; }

  start(run) { run.status = "queued"; this.save(run); this.enqueue(run.id, () => this.process(run.id)); return run; }
  resume(id) {
    const run = this.store.getRun(id);
    if (!run) throw new PipelineError("not_found", "No such set.");
    if (this.pending.has(id)) return run; // already on its way: a second click does nothing
    const amb = (run.attempts || []).filter((a) => a.state === "ambiguous");
    if (amb.length) throw new PipelineError("ambiguous", "A render's outcome is unknown. Decide what to do with it first (adopt the job, re-render, or skip).");
    run.status = "queued"; run.error = null; this.save(run);
    this.log(run, "Resuming from where it stopped — renders already accepted by Higgsfield are reused.");
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
    this.recover(run);
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
      const amb = e.code === "ambiguous";
      run.status = amb ? "needs_decision" : "failed"; run.error = { code: e.code || "error", message: e.message };
      for (const x of run.items) {
        if (this.liveAttempt(run, x)) continue;            // accepted/waiting/ambiguous: kept as is
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

  // Render the given items: new attempts for items without a live one, then wait for all.
  async renderItems(run, list, paramsFor, purpose) {
    const fresh = list.filter((x) => !this.liveAttempt(run, x));
    if (fresh.length) {
      await this.paidPreflight(run, fresh.length);
      const atts = fresh.map((x) => this.newAttempt(run, x, purpose, paramsFor(x)));
      await this.submitAttempts(run, atts, true);
    }
    const amb = list.filter((x) => { const a = this.liveAttempt(run, x); return a && a.state === "ambiguous"; });
    if (amb.length) {
      for (const x of amb) { x.state = "ambiguous"; x.error = this.attempt(run, x.attemptId).error; }
      this.save(run);
      throw new PipelineError("ambiguous", "Higgsfield may have accepted the " + amb.map((x) => x.dims).join(", ") + " render, but this app couldn't confirm it. Nothing was resubmitted. Check for the job, then adopt it, re-render, or skip.");
    }
    const waiting = list.filter((x) => { const a = this.liveAttempt(run, x); return a && (a.state === "accepted" || a.state === "waiting"); });
    if (!waiting.length) return;
    for (const x of waiting) this.attempt(run, x.attemptId).state = "waiting";
    this.save(run);
    const done = await this.renderer.wait(waiting.map((x) => { const a = this.attempt(run, x.attemptId); return { index: a.index, job_id: a.jobId }; }));
    for (const x of waiting) {
      const a = this.attempt(run, x.attemptId);
      const j = done.find((d) => d.job_id === a.jobId);
      a.resolvedAt = Date.now();
      if (j && j.status === "completed" && j.result_url) {
        a.state = "completed";
        x.url = j.result_url; x.job = a.jobId; x.state = "rendered"; x.error = null;
      } else {
        // Higgsfield may refund failed jobs; that isn't reported to us, so the estimate stays counted.
        a.state = "failed"; a.error = "Job ended " + ((j && j.status) || "with no result");
        if (purpose === "repaint") this.log(run, "  " + x.dims + " couldn't be repainted — keeping the original.", "err");
        else { x.state = "failed"; x.error = "The " + x.title.toLowerCase() + " render didn't finish (" + ((j && j.status) || "no job") + ")."; }
      }
      x.attemptId = null;
    }
    this.save(run);
  }

  // Send prepared attempts in one batch and classify every item of the answer.
  async submitAttempts(run, atts, allowRetry) {
    for (const a of atts) { a.state = "submitting"; a.submittedAt = Date.now(); }
    this.save(run);
    let res;
    try {
      res = await this.renderer.submit(atts.map((a) => ({ index: a.index, params: a.params, meta: a.meta })));
    } catch (e) {
      const at = Date.now();
      if (e.sent === false) {                     // never left this server
        for (const a of atts) { a.state = "failed"; a.notSent = true; a.error = e.message; a.resolvedAt = at; this.store.release(a.id); this.detach(run, a); }
        this.save(run); throw e;
      }
      if (e.rejected) {                           // Higgsfield answered with an error
        for (const a of atts) { a.state = "explicitly_rejected"; a.error = e.message; a.resolvedAt = at; this.store.release(a.id); this.detach(run, a, "Higgsfield refused the render: " + e.message); }
        this.save(run); throw new PipelineError("rejected", "Higgsfield refused the render: " + e.message);
      }
      for (const a of atts) { a.state = "ambiguous"; a.error = "Submission " + (e.code === "timeout" ? "timed out" : "was interrupted") + ": " + e.message; }
      this.save(run);
      return; // renderItems sees the ambiguous attempts and stops
    }
    const jobs = (res && Array.isArray(res.jobs)) ? res.jobs : [];
    const nothingSubmitted = res && res.raw && res.raw.unlim_choice && !jobs.length; // documented: submits nothing
    const retry = [];
    for (const a of atts) {
      const hits = jobs.filter((j) => j && j.index === a.index);
      const j = hits.length === 1 ? hits[0] : null;
      if (j && typeof j.job_id === "string" && UUID.test(j.job_id) && j.status !== "submission_failed") {
        a.state = "accepted"; a.jobId = j.job_id; this.store.markSpent(a.id);
      } else if ((j && j.status === "submission_failed" && !j.job_id) || nothingSubmitted) {
        a.state = "explicitly_rejected"; a.resolvedAt = Date.now(); a.error = (res.raw && res.raw.problem) || "submission_failed";
        this.store.release(a.id);
        if (allowRetry && !nothingSubmitted) retry.push(a); else this.detach(run, a, "Higgsfield didn't accept this render (" + a.error + ").");
      } else {
        a.state = "ambiguous";
        a.error = hits.length > 1 ? "Higgsfield returned this request twice." : !j ? "Higgsfield's answer didn't mention this request." : "Higgsfield's answer for this request was malformed.";
      }
    }
    this.save(run);
    if (!retry.length) return;
    // Exactly one retry, only for items Higgsfield explicitly marked submission_failed.
    await this.sleep(5000);
    await this.paidPreflight(run, retry.length);
    const again = retry.map((old) => {
      const x = this.item(run, old.kind);
      const a = this.newAttempt(run, x, old.purpose, old.params);
      a.retryOf = old.id; return a;
    });
    this.save(run);
    await this.submitAttempts(run, again, false);
  }
  detach(run, a, error) {
    for (const x of run.items) if (x.attemptId === a.id) { x.attemptId = null; if (error && a.purpose !== "repaint") { x.state = "failed"; x.error = error; } }
  }

  // ---------- ambiguous attempts: a person decides ----------
  async candidates(id, attemptId) {
    const run = this.store.getRun(id), a = run && this.attempt(run, attemptId);
    if (!a || a.state !== "ambiguous") throw new PipelineError("bad_request", "That render isn't waiting for a decision.");
    if (!this.renderer.findCandidates) return { supported: false, candidates: [] };
    return { supported: true, candidates: await this.renderer.findCandidates(a) };
  }
  // action: "adopt" {jobId} | "retry" {charged} | "skip" {charged}. Recorded on the attempt.
  resolve(id, attemptId, { action, jobId, charged, actor }) {
    if (this.pending.has(id)) throw new PipelineError("already_queued", "This set is busy. Try again when it stops.");
    const run = this.store.getRun(id), a = run && this.attempt(run, attemptId);
    if (!a || a.state !== "ambiguous") throw new PipelineError("bad_request", "That render isn't waiting for a decision.");
    const x = this.item(run, a.kind);
    a.resolution = { action, at: Date.now(), actor: actor || null, jobId: jobId || null, charged: action === "adopt" ? true : !!charged };
    if (action === "adopt") {
      if (!UUID.test(String(jobId || ""))) throw new PipelineError("bad_request", "That doesn't look like a Higgsfield job id.");
      a.state = "accepted"; a.jobId = jobId; this.store.markSpent(a.id);
      x.state = "rendering"; x.error = null;
    } else if (action === "retry" || action === "skip") {
      a.state = "abandoned"; a.resolvedAt = Date.now();
      if (charged) this.store.markSpent(a.id); else this.store.release(a.id);
      x.attemptId = null;
      if (action === "retry") { x.state = "rendering"; x.error = null; if (a.purpose === "repaint") x.repaired = false; }
      else { if (a.purpose !== "repaint") { x.state = "failed"; x.error = "Skipped after an unconfirmed submission."; } }
    } else throw new PipelineError("bad_request", "Unknown decision.");
    this.log(run, "Decision on the " + x.dims + " render: " + action + (action === "adopt" ? " job " + jobId : charged ? " (counted as charged)" : " (counted as not charged)") + ".", "run");
    run.status = "failed"; run.error = null;
    this.save(run);
    if ((run.attempts || []).some((z) => z.state === "ambiguous")) { run.status = "needs_decision"; this.save(run); return run; }
    return this.resume(id);
  }

  async stepMaster(run) {
    const M = this.item(run, "master");
    if (run.masterJob) return;
    // (A master that failed before is tried again: reaching here again means Resume was pressed.)
    M.state = "rendering"; M.error = null;
    this.log(run, this.liveAttempt(run, M) ? "Waiting for the square master Higgsfield already accepted…" : "Rendering the square master…");
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
    const bad = run.items.filter((x) => x.job && ((x.flags.includes("PLACEHOLDER") && !x.repaired) || (this.liveAttempt(run, x) && this.liveAttempt(run, x).purpose === "repaint")));
    if (!bad.length) return;
    this.log(run, "Repainting the blank patch in " + bad.map((x) => x.dims).join(", ") + " (about " + this.cfg.creditsPerRender + " credits each)…");
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
      Object.assign(y, { version: (y.version || 1) + 1, state: "rendering", job: null, url: null, attemptId: null, file: null, mode: "", flags: [], repaired: false, qa: null, drive: null, held: false, error: null });
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
        if (e.code === "ambiguous") { r.status = "needs_decision"; r.error = { code: e.code, message: e.message }; }
        else { if (y.state !== "done") y.state = "failed"; y.error = e.message; r.status = "partial"; }
        this.log(r, "Regenerate stopped — " + e.message, "err");
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

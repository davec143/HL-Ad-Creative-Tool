// File-backed storage: one JSON document per run plus its image files, under DATA_DIR.
// Writes are atomic (write to a temp file, then rename), so a crash never leaves a half-written
// run, and the pipeline can resume any run from its last saved state.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.runsDir = path.join(dataDir, "runs");
    this.filesDir = path.join(dataDir, "files");
    this.batchesDir = path.join(dataDir, "batches");
    this.stateDir = path.join(dataDir, "state");
    for (const d of [this.runsDir, this.filesDir, this.stateDir, this.batchesDir]) fs.mkdirSync(d, { recursive: true });
  }

  static newId() { return "r" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex"); }
  static validId(id) { return typeof id === "string" && /^[a-z0-9]{6,40}$/.test(id); }

  // Write to a temp file, fsync it, then rename over the target: a crash leaves either the old or
  // the new document, never a torn one. (Single replica only: there is no cross-process locking.)
  writeJson(file, obj) {
    const tmp = file + "." + process.pid + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    const fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeSync(fd, JSON.stringify(obj, null, 1)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  }
  readJson(file, fallback = null) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
  }

  // ---- runs ----
  runPath(id) { if (!Store.validId(id)) throw new Error("bad run id"); return path.join(this.runsDir, id + ".json"); }
  saveRun(run) { run.updatedAt = Date.now(); this.writeJson(this.runPath(run.id), run); return run; }
  getRun(id) { return Store.validId(id) ? this.readJson(this.runPath(id)) : null; }
  listRuns(limit = 20) {
    const files = fs.readdirSync(this.runsDir).filter((f) => f.endsWith(".json"));
    const runs = files.map((f) => this.readJson(path.join(this.runsDir, f))).filter(Boolean);
    runs.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return runs.slice(0, limit);
  }

  // ---- batches: immutable child order; execution state survives server restarts ----
  batchPath(id) { if (!Store.validId(id)) throw new Error("bad batch id"); return path.join(this.batchesDir, id + ".json"); }
  saveBatch(batch) { batch.updatedAt = Date.now(); this.writeJson(this.batchPath(batch.id), batch); return batch; }
  getBatch(id) { return Store.validId(id) ? this.readJson(this.batchPath(id)) : null; }
  listBatches(limit = 20) {
    return fs.readdirSync(this.batchesDir).filter((f) => f.endsWith(".json"))
      .map((f) => this.readJson(path.join(this.batchesDir, f))).filter(Boolean)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, limit);
  }

  // ---- files ----
  runDir(id) { const d = path.join(this.filesDir, id); fs.mkdirSync(d, { recursive: true }); return d; }
  filePath(id, name) {
    if (!Store.validId(id) || !/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) throw new Error("bad file name");
    return path.join(this.filesDir, id, name);
  }

  // ---- small key/value state (OAuth tokens, credit ledger) ----
  getState(key, fallback = null) { return this.readJson(path.join(this.stateDir, key + ".json"), fallback); }
  setState(key, value) {
    const file = path.join(this.stateDir, key + ".json");
    this.writeJson(file, value);
    try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  }
  delState(key) { try { fs.unlinkSync(path.join(this.stateDir, key + ".json")); } catch { /* absent */ } }

  // ---- credit ledger ----
  // One entry per paid render attempt: {runId, day, amount, state, at}. state is
  //   reserved  written BEFORE the request leaves; kept while the outcome is unknown (ambiguous)
  //   spent     Higgsfield accepted the job (an estimate: CREDITS_PER_RENDER, not provider-reported)
  //   released  the request provably never created a job (never sent, or explicitly rejected)
  // Caps count reserved + spent, so an ambiguous attempt keeps blocking spend until it is resolved.
  static today() { return new Date().toISOString().slice(0, 10); }
  ledger() { return this.getState("ledger", { entries: {} }); }
  ledgerSet(attemptId, patch) {
    const led = this.ledger();
    const cur = led.entries[attemptId] || {};
    led.entries[attemptId] = { ...cur, ...patch, at: Date.now() };
    this.setState("ledger", led);
    return led.entries[attemptId];
  }
  // Transfer a batch's planned reservation to the real attempt in ONE atomic ledger write.
  // Saving the prepared attempt happens first; a crash before transfer is safely not-sent.
  reserve(attemptId, runId, amount) {
    const led = this.ledger(), key = "plan-" + runId, plan = led.entries[key];
    if (led.entries[attemptId]) return led.entries[attemptId];
    if (plan && plan.state === "reserved") {
      plan.amount = Math.max(0, plan.amount - amount);
      if (!plan.amount) plan.state = "released";
    }
    const e = { runId, batchId: plan && plan.batchId || null, amount, day: Store.today(), state: "reserved", at: Date.now() };
    led.entries[attemptId] = e; this.setState("ledger", led); return e;
  }
  reserveBatch(batchId, runIds, amount) {
    const led = this.ledger();
    for (const runId of runIds) {
      const key = "plan-" + runId;
      if (!led.entries[key]) led.entries[key] = { kind: "batch_plan", batchId, runId, amount, initialAmount: amount, day: Store.today(), state: "reserved", at: Date.now() };
    }
    this.setState("ledger", led);
  }
  plannedForRun(runId) { const e = this.ledger().entries["plan-" + runId]; return e && e.state === "reserved" ? e.amount : 0; }
  releaseBatchPlans(batchId, runId = null) {
    const led = this.ledger();
    for (const e of Object.values(led.entries)) if (e.kind === "batch_plan" && e.batchId === batchId && (!runId || e.runId === runId) && e.state === "reserved") e.state = "released";
    this.setState("ledger", led);
  }
  creditsForBatch(batchId) { return this.creditTotals((e) => e.batchId === batchId); }
  reservedCredits() { return this.creditTotals(() => true).reserved; }
  markSpent(attemptId) { return this.ledgerSet(attemptId, { state: "spent" }); }
  release(attemptId) {
    const e = this.ledger().entries[attemptId];
    // Recovery may release a prepared attempt saved just before reserve() was reached.
    return this.ledgerSet(attemptId, { state: "released", ...(!e || !Number.isFinite(e.amount) ? { amount: 0 } : {}) });
  }
  creditTotals(filter) {
    const t = { reserved: 0, spent: 0, released: 0 };
    for (const e of Object.values(this.ledger().entries)) if (filter(e)) t[e.state] = (t[e.state] || 0) + e.amount;
    t.committed = t.reserved + t.spent;
    return t;
  }
  creditsForDay(day = Store.today()) { return this.creditTotals((e) => e.day === day || (e.kind === "batch_plan" && e.state === "reserved")); }
  creditsForRun(runId) { return this.creditTotals((e) => e.runId === runId); }
  // Backwards-compatible: reserved + spent today.
  creditsToday() { return this.creditsForDay().committed; }
}

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
    this.stateDir = path.join(dataDir, "state");
    for (const d of [this.runsDir, this.filesDir, this.stateDir]) fs.mkdirSync(d, { recursive: true });
  }

  static newId() { return "r" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex"); }
  static validId(id) { return typeof id === "string" && /^[a-z0-9]{6,40}$/.test(id); }

  writeJson(file, obj) {
    const tmp = file + "." + process.pid + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
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

  // Credits spent per day (UTC), for the daily cap.
  addCredits(n) {
    const day = new Date().toISOString().slice(0, 10);
    const led = this.getState("credits", {});
    led[day] = (led[day] || 0) + n;
    this.setState("credits", led);
  }
  creditsToday() { return (this.getState("credits", {}))[new Date().toISOString().slice(0, 10)] || 0; }
}

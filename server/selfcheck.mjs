// Startup / readiness self-check. Critical failures stop the server from starting: a container that
// can't write its volume, run finishing, or prove it has the approved logos must not take orders.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./config.mjs";
import { runPython } from "./py.mjs";

const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export async function selfCheck(cfg) {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });
  // 1. DATA_DIR exists, is writable, and rename (the store's atomic write) works there.
  try {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    const a = path.join(cfg.dataDir, ".selfcheck." + process.pid), b = a + ".renamed";
    fs.writeFileSync(a, "ok"); fs.renameSync(a, b);
    const ok = fs.readFileSync(b, "utf8") === "ok"; fs.unlinkSync(b);
    add("data_dir_writable", ok);
  } catch (e) { add("data_dir_writable", false, e.code || "error"); }
  // 2. Python + finishing imports.
  try {
    const r = await runPython(cfg.python, path.join(ROOT, "finishing", "selfcheck.py"), [], { timeoutMs: 30000 });
    add("python_finishing", /^ok /.test(r.stdout.trim()), r.stdout.trim().slice(0, 80));
  } catch (e) { add("python_finishing", false, String(e.message).slice(0, 120)); }
  // 3. Approved logo files match their recorded hashes (assets and the finishing copies).
  try {
    const sums = Object.fromEntries(fs.readFileSync(path.join(ROOT, "assets", "logos", "SHA256SUMS"), "utf8").trim().split("\n").map((l) => l.trim().split(/\s+/).reverse()));
    const bad = Object.entries(sums).filter(([f, h]) => sha(path.join(ROOT, "assets", "logos", f)) !== h).map(([f]) => f);
    if (sha(path.join(ROOT, "finishing", "logo-white.png")) !== sums["hitlights-logo-white.png"]) bad.push("finishing/logo-white.png");
    if (sha(path.join(ROOT, "finishing", "logo-black.png")) !== sums["hitlights-logo-black.png"]) bad.push("finishing/logo-black.png");
    add("logo_hashes", !bad.length, bad.join(", "));
  } catch (e) { add("logo_hashes", false, e.code || String(e.message).slice(0, 80)); }
  // 4. finish.py is byte-identical to the v16 reference (hash recorded in the repo).
  try {
    const want = fs.readFileSync(path.join(ROOT, "finishing", "FINISH_PY_SHA256"), "utf8").split(/\s+/)[0];
    add("finish_py_v16", sha(path.join(ROOT, "finishing", "finish.py")) === want);
  } catch (e) { add("finish_py_v16", false, e.code || "error"); }
  // 5. Renderer configuration.
  add("renderer_config", ["higgsfield-mcp", "fake"].includes(cfg.renderer) && (cfg.renderer !== "higgsfield-mcp" || /^https:\/\//.test(cfg.higgsfieldMcpUrl)), cfg.renderer);
  if (cfg.production) add("renderer_not_fake_in_production", cfg.renderer !== "fake", cfg.renderer);
  return { ok: checks.every((c) => c.ok), checks };
}

// One replica only: a heartbeat lock in DATA_DIR. A second live instance on the same volume
// refuses to start (a stale lock, e.g. from a crashed container, is taken over).
export class InstanceLock {
  constructor(dataDir, { staleMs = 30000, beatMs = 10000 } = {}) {
    this.file = path.join(dataDir, "state", "instance.lock"); this.staleMs = staleMs; this.beatMs = beatMs;
    this.id = crypto.randomBytes(8).toString("hex"); this.timer = null;
  }
  read() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return null; } }
  write() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const t = this.file + "." + this.id; fs.writeFileSync(t, JSON.stringify({ id: this.id, pid: process.pid, at: Date.now() })); fs.renameSync(t, this.file); }
  // Wait up to waitMs for another live holder to go away (overlapping deploys), then give up.
  async acquire({ waitMs = 45000, poll = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    const until = Date.now() + waitMs;
    for (;;) {
      const cur = this.read();
      if (!cur || cur.id === this.id || Date.now() - cur.at > this.staleMs) break;
      if (Date.now() >= until) throw new Error("Another instance is using this data volume (lock held by pid " + cur.pid + "). Run exactly one replica.");
      await sleep(poll);
    }
    this.write();
    this.timer = setInterval(() => { try { const cur = this.read(); if (cur && cur.id !== this.id) { console.error(JSON.stringify({ level: "error", event: "instance_lock_lost" })); return; } this.write(); } catch { /* retry next beat */ } }, this.beatMs);
    this.timer.unref();
  }
  release() { if (this.timer) clearInterval(this.timer); const cur = this.read(); if (cur && cur.id === this.id) { try { fs.unlinkSync(this.file); } catch { /* gone */ } } }
}

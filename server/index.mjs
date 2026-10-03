// Entry point: config -> self-check -> single-instance lock -> listen -> resume interrupted runs.
// SIGTERM/SIGINT: stop accepting runs and paid submissions, let in-flight work reach a saved state,
// close the HTTP server and Higgsfield connection, release the lock, then exit naturally.
import http from "node:http";
import { loadDotEnv, readConfig, checkConfig } from "./config.mjs";
import { Store } from "./store.mjs";
import { Pipeline } from "./pipeline.mjs";
import { HiggsfieldMcpRenderer } from "./render/higgsfield-mcp.mjs";
import { FakeRenderer } from "./render/fake.mjs";
import { Shopify } from "./providers/shopify.mjs";
import { makeLlm } from "./providers/llm.mjs";
import { Drive } from "./providers/drive.mjs";
import { createApp } from "./app.mjs";
import { selfCheck, InstanceLock } from "./selfcheck.mjs";
import { Obs } from "./obs.mjs";
import { Composer } from "../composer/render.mjs";

const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS || 20000);

loadDotEnv();
const cfg = readConfig();
const { errors, warnings } = checkConfig(cfg);
const obs = new Obs();
if (errors.length) { obs.log("error", "config_invalid", { errors }); console.error("Configuration errors:\n  - " + errors.join("\n  - ")); process.exit(1); }
for (const w of warnings) obs.log("warn", "config_warning", { message: w });

const check = await selfCheck(cfg);
for (const c of check.checks) obs.log(c.ok ? "info" : "error", "selfcheck", { name: c.name, ok: c.ok, detail: c.detail || undefined });
if (!check.ok) { console.error("Self-check failed: " + check.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")); process.exit(1); }

const store = new Store(cfg.dataDir);
const lock = new InstanceLock(cfg.dataDir);
try { await lock.acquire(); } catch (e) { obs.log("error", "instance_lock", { message: e.message }); console.error(e.message); process.exit(1); }

const renderer = cfg.renderer === "fake"
  ? new FakeRenderer({ store, python: cfg.python })
  : new HiggsfieldMcpRenderer({ store, url: cfg.higgsfieldMcpUrl, publicUrl: cfg.publicUrl, renderTimeoutMs: cfg.renderTimeoutMs });
const shopify = new Shopify({ store: cfg.shopifyStore, token: cfg.shopifyToken, apiVersion: cfg.shopifyApiVersion });
const llm = makeLlm(cfg);
let drive = null;
try { drive = new Drive({ serviceAccountJson: cfg.driveServiceAccount, parentId: cfg.driveParent }); }
catch (e) { warnings.push(e.message); obs.log("warn", "drive_config", { message: e.message }); }
const composer = new Composer();
const pipeline = new Pipeline({ cfg, store, renderer, llm, drive, composer, obs: new Obs({ store }), log: { error: (...a) => obs.log("error", "pipeline", { detail: a.join(" ").slice(0, 300) }) } });

let shuttingDown = false;
const readiness = async () => ({ ok: check.ok && !shuttingDown, shuttingDown, checks: check.checks.map((c) => ({ name: c.name, ok: c.ok })) });
const server = http.createServer(createApp({ cfg, store, pipeline, renderer, shopify, llm, drive, warnings, readiness }));
server.requestTimeout = 5 * 60 * 1000;
server.listen(cfg.port, () => {
  obs.log("info", "listening", { url: cfg.publicUrl, renderer: cfg.renderer, llm: cfg.llmProvider, draftModel: llm ? cfg.llmDraftModel : undefined, qaModel: llm ? cfg.llmQaModel : undefined, requireFidelity: cfg.requireFidelity });
  pipeline.resumeInterrupted();
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true; pipeline.shuttingDown = true;   // no new runs, no new paid submissions
  obs.log("info", "shutdown_begin", { signal });
  server.close();                                      // stop accepting connections
  server.closeIdleConnections && server.closeIdleConnections();
  // Let the current step reach a saved state (every step persists before and after external calls).
  await Promise.race([pipeline.idle(), new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_MS).unref())]);
  try { await renderer.close(); } catch { /* best effort */ }
  try { await composer.close(); } catch { /* best effort */ }
  lock.release();
  obs.log("info", "shutdown_done", { signal, busy: pipeline.busy() || undefined });
  // No process.exit(): the event loop drains and Node exits on its own. A hard stop is the platform's.
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { shutdown(sig); });

// Entry point: read config, wire providers, resume interrupted runs, listen.
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

loadDotEnv();
const cfg = readConfig();
const { errors, warnings } = checkConfig(cfg);
if (errors.length) { console.error("Configuration errors:\n  - " + errors.join("\n  - ")); process.exit(1); }
for (const w of warnings) console.warn("warning:", w);

const store = new Store(cfg.dataDir);
const renderer = cfg.renderer === "fake"
  ? new FakeRenderer({ store, python: cfg.python })
  : new HiggsfieldMcpRenderer({ store, url: cfg.higgsfieldMcpUrl, publicUrl: cfg.publicUrl, renderTimeoutMs: cfg.renderTimeoutMs });
const shopify = new Shopify({ store: cfg.shopifyStore, token: cfg.shopifyToken, apiVersion: cfg.shopifyApiVersion });
const llm = makeLlm(cfg);
let drive = null;
try { drive = new Drive({ serviceAccountJson: cfg.driveServiceAccount, parentId: cfg.driveParent }); }
catch (e) { warnings.push(e.message); console.warn("warning:", e.message); }
const pipeline = new Pipeline({ cfg, store, renderer, llm, drive });

const server = http.createServer(createApp({ cfg, store, pipeline, renderer, shopify, llm, drive, warnings }));
server.requestTimeout = 5 * 60 * 1000;
server.listen(cfg.port, () => {
  console.log(`HitLights Ad Builder on ${cfg.publicUrl} (renderer: ${cfg.renderer}, llm: ${cfg.llmProvider}${llm ? " " + cfg.llmDraftModel + " / " + cfg.llmQaModel : ""})`);
  pipeline.resumeInterrupted();
});
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { server.close(); process.exit(0); });

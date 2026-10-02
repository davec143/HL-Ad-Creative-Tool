// All runtime configuration comes from environment variables (see .env.example).
// Nothing account-specific is hard-coded anywhere else.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_SECRET } from "./security.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Load .env for local development (never overrides real environment variables).
export function loadDotEnv(file = path.join(ROOT, ".env")) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function num(v, d) { const n = Number(v); return Number.isFinite(n) && v !== "" && v != null ? n : d; }

export function readConfig(env = process.env) {
  const port = num(env.PORT, 8080);
  const cfg = {
    port,
    // Railway sets RAILWAY_PUBLIC_DOMAIN automatically; PUBLIC_URL overrides it (e.g. a custom domain).
    publicUrl: (env.PUBLIC_URL || (env.RAILWAY_PUBLIC_DOMAIN ? "https://" + env.RAILWAY_PUBLIC_DOMAIN : "http://localhost:" + port)).replace(/\/+$/, ""),
    dataDir: path.resolve(env.DATA_DIR || path.join(ROOT, "data")),
    python: env.PYTHON || "python3",
    // Access: a shared team password (see docs/adr/0002-google-sso.md for the SSO proposal).
    production: env.NODE_ENV === "production",
    appPassword: env.APP_PASSWORD || "",
    sessionSecret: env.SESSION_SECRET || "",
    sessionDays: num(env.SESSION_DAYS, 7),
    // Behind Railway's proxy the client address is the last X-Forwarded-For hop.
    trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY === "1" : !!env.RAILWAY_ENVIRONMENT_NAME,

    // Image rendering. "higgsfield-mcp" = Higgsfield's official MCP server (the same tools, model
    // and subscription credits v16 used). "fake" = local placeholder renders for development.
    renderer: env.RENDERER || "higgsfield-mcp",
    higgsfieldMcpUrl: env.HIGGSFIELD_MCP_URL || "https://mcp.higgsfield.ai/mcp",
    higgsfieldApiKey: env.HIGGSFIELD_API_KEY || "",
    creditsPerRender: num(env.CREDITS_PER_RENDER, 2),
    maxCreditsPerRun: num(env.MAX_CREDITS_PER_RUN, 12),
    maxCreditsPerDay: num(env.MAX_CREDITS_PER_DAY, 120),
    renderTimeoutMs: num(env.RENDER_TIMEOUT_MS, 7 * 60 * 1000),

    // Product catalog.
    shopifyStore: (env.SHOPIFY_STORE || "").replace(/^https?:\/\//, "").replace(/\/+$/, ""),
    shopifyToken: env.SHOPIFY_ADMIN_TOKEN || "",
    shopifyApiVersion: env.SHOPIFY_API_VERSION || "2025-10",

    // Copy drafting and the text & logo check. Provider-agnostic: "anthropic" (Claude API) or
    // "openai-compatible" (OpenAI, Google Gemini's OpenAI endpoint, OpenRouter, etc.). "none" turns
    // both features off; the page says so and everything else works.
    llmProvider: env.LLM_PROVIDER || (env.ANTHROPIC_API_KEY ? "anthropic" : (env.LLM_API_KEY ? "openai-compatible" : "none")),
    llmApiKey: env.LLM_API_KEY || env.ANTHROPIC_API_KEY || "",
    llmBaseUrl: env.LLM_BASE_URL || "",
    llmDraftModel: env.LLM_DRAFT_MODEL || "",
    llmQaModel: env.LLM_QA_MODEL || "",

    // Google Drive delivery (optional). Service-account JSON, and the folder it can write to.
    driveServiceAccount: env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
    driveParent: env.DRIVE_PARENT || "",
  };
  const DEFAULT_MODELS = {
    anthropic: { draft: "claude-haiku-4-5", qa: "claude-sonnet-5-5" },
    "openai-compatible": { draft: "", qa: "" },
    none: { draft: "", qa: "" },
  };
  const d = DEFAULT_MODELS[cfg.llmProvider] || DEFAULT_MODELS.none;
  cfg.llmDraftModel = cfg.llmDraftModel || d.draft;
  cfg.llmQaModel = cfg.llmQaModel || d.qa || cfg.llmDraftModel;
  return cfg;
}

// Problems that should stop the server from starting, and warnings shown on the status page.
export function checkConfig(cfg) {
  const errors = [], warnings = [];
  if (!["higgsfield-mcp", "fake"].includes(cfg.renderer)) errors.push("RENDERER must be higgsfield-mcp or fake");
  if (!["anthropic", "openai-compatible", "none"].includes(cfg.llmProvider)) errors.push("LLM_PROVIDER must be anthropic, openai-compatible or none");
  if (cfg.llmProvider === "openai-compatible" && (!cfg.llmBaseUrl || !cfg.llmDraftModel)) errors.push("LLM_PROVIDER=openai-compatible needs LLM_BASE_URL and LLM_DRAFT_MODEL");
  if (cfg.llmProvider !== "none" && !cfg.llmApiKey) errors.push("LLM_PROVIDER=" + cfg.llmProvider + " needs an API key (ANTHROPIC_API_KEY or LLM_API_KEY)");
  if (cfg.production && !cfg.appPassword) errors.push("NODE_ENV=production requires APP_PASSWORD: without it anyone who reaches this server can spend Higgsfield credits.");
  if (cfg.production && cfg.appPassword && cfg.appPassword.length < 10) errors.push("APP_PASSWORD must be at least 10 characters in production.");
  if ((cfg.production || cfg.appPassword) && cfg.sessionSecret.length < MIN_SECRET) errors.push(`SESSION_SECRET must be at least ${MIN_SECRET} random characters.`);
  if (cfg.production && !cfg.publicUrl.startsWith("https://")) errors.push("NODE_ENV=production requires an https PUBLIC_URL (or Railway's generated domain).");
  if (!cfg.appPassword) warnings.push("APP_PASSWORD is not set: anyone who can reach this server can spend Higgsfield credits (development only).");
  if (cfg.shopifyStore && !cfg.shopifyToken) warnings.push("SHOPIFY_STORE is set without SHOPIFY_ADMIN_TOKEN: catalog search is off.");
  if (!!cfg.driveServiceAccount !== !!cfg.driveParent) warnings.push("Drive needs both GOOGLE_SERVICE_ACCOUNT_JSON and DRIVE_PARENT: Drive saving is off.");
  if (cfg.renderer === "fake") warnings.push("RENDERER=fake: images are local placeholders, not real renders.");
  return { errors, warnings };
}

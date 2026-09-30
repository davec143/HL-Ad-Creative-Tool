// Higgsfield renderer over Higgsfield's official MCP server (https://mcp.higgsfield.ai/mcp).
// These are the same tools, model (nano_banana_pro, 2K) and subscription credits the v16 Ad Builder
// used through the Claude connector, called from this server instead. The first time, someone signs
// in to Higgsfield once (OAuth, from the app's status banner); tokens are stored in DATA_DIR/state
// and refreshed automatically.
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

export class RenderError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// OAuth client provider that persists everything in the app's state store.
class StoreOAuthProvider {
  constructor(store, redirectUrl) { this.store = store; this._redirect = redirectUrl; this.pendingAuthUrl = null; }
  get redirectUrl() { return this._redirect; }
  get clientMetadata() {
    return { client_name: "HitLights Ad Builder", redirect_uris: [this._redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
  }
  state() { const s = crypto.randomBytes(16).toString("hex"); this.store.setState("hf-oauth-state", { s, at: Date.now() }); return s; }
  clientInformation() { return this.store.getState("hf-client") || undefined; }
  saveClientInformation(info) { this.store.setState("hf-client", info); }
  tokens() { return this.store.getState("hf-tokens") || undefined; }
  saveTokens(t) { this.store.setState("hf-tokens", t); }
  redirectToAuthorization(url) { this.pendingAuthUrl = url.toString(); }
  saveCodeVerifier(v) { this.store.setState("hf-verifier", { v }); }
  codeVerifier() { const x = this.store.getState("hf-verifier"); if (!x) throw new Error("no PKCE verifier"); return x.v; }
  invalidateCredentials(scope) {
    if (scope === "all" || scope === "client") this.store.delState("hf-client");
    if (scope === "all" || scope === "tokens") this.store.delState("hf-tokens");
    if (scope === "all" || scope === "verifier") this.store.delState("hf-verifier");
  }
}

// MCP tool results carry JSON either as structuredContent or as a JSON text block.
export function payloadOf(result) {
  if (!result) return {};
  const text = (result.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  if (result.isError) throw new RenderError("tool_error", text.slice(0, 400) || "Higgsfield reported an error.");
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  try { return JSON.parse(text); } catch { return { text }; }
}

export class HiggsfieldMcpRenderer {
  constructor({ store, url, publicUrl, renderTimeoutMs = 7 * 60 * 1000, sleep }) {
    this.store = store; this.url = new URL(url);
    this.provider = new StoreOAuthProvider(store, publicUrl + "/oauth/higgsfield/callback");
    this.client = null; this.transport = null; this.connecting = null;
    this.maxWaits = Math.max(1, Math.ceil(renderTimeoutMs / 15000));
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.name = "Higgsfield";
  }

  async connect() {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const transport = new StreamableHTTPClientTransport(this.url, { authProvider: this.provider });
      const client = new Client({ name: "hitlights-ad-builder", version: "1.0.0" });
      try {
        await client.connect(transport);
      } catch (e) {
        this.transport = transport; // kept for finishAuth
        if (e instanceof UnauthorizedError || this.provider.pendingAuthUrl) {
          throw new RenderError("needs_auth", "Sign in to Higgsfield to start rendering.");
        }
        throw new RenderError("server_unavailable", "Couldn't reach Higgsfield: " + (e && e.message || e));
      }
      this.client = client; this.transport = transport;
      return client;
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  // For the status banner: connected, or the sign-in link.
  async status() {
    try { await this.connect(); return { connected: true }; }
    catch (e) {
      if (e.code === "needs_auth") return { connected: false, needsAuth: true, authUrl: this.provider.pendingAuthUrl };
      return { connected: false, error: e.message };
    }
  }

  async finishAuth(code, state) {
    const saved = this.store.getState("hf-oauth-state");
    if (!saved || !state || saved.s !== state) throw new RenderError("bad_state", "Sign-in link expired or was not started here. Try again.");
    this.store.delState("hf-oauth-state");
    const transport = this.transport || new StreamableHTTPClientTransport(this.url, { authProvider: this.provider });
    await transport.finishAuth(code);
    this.client = null; this.transport = null; this.provider.pendingAuthUrl = null;
    await this.connect();
  }

  async call(tool, args) {
    for (let attempt = 0; ; attempt++) {
      const client = await this.connect();
      try {
        return payloadOf(await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 120000 }));
      } catch (e) {
        if (e instanceof RenderError) throw e;
        // Dropped session or expired token: reconnect once, then report.
        this.client = null;
        if (attempt >= 1) {
          if (e instanceof UnauthorizedError) throw new RenderError("needs_auth", "Higgsfield sign-in expired. Sign in again.");
          throw new RenderError("server_unavailable", "Higgsfield didn't answer: " + (e && e.message || e));
        }
      }
    }
  }

  async balance() {
    const p = await this.call("balance", {});
    return typeof p.credits === "number" ? p.credits : null;
  }

  async importMedia(url) {
    const p = await this.call("media_import_url", { url, type: "image" });
    if (!p.media_id) throw new RenderError("tool_error", "The image URL couldn't be imported. It must be a direct, publicly reachable image link.");
    return p.media_id;
  }

  // Submit a batch and keep only the items that really became jobs. Higgsfield can reject a single
  // item (e.g. a momentary 503) while accepting the rest; those items get one retry (as v16).
  async submit(requests) {
    const send = async (reqs) => {
      // Only {index, params} go to Higgsfield: its schema rejects any other field (e.g. our meta).
      const p = await this.call("generate_image_batch", { requests: reqs.map((q) => ({ index: q.index, params: q.params })) });
      const ok = (p.jobs || []).filter((j) => j && j.job_id && j.status !== "submission_failed");
      return { ok, p };
    };
    const a = await send(requests);
    const got = new Set(a.ok.map((j) => j.index));
    const missing = requests.filter((q) => !got.has(q.index));
    if (!missing.length) return a.ok;
    await this.sleep(5000);
    const b = await send(missing);
    const all = a.ok.concat(b.ok);
    if (!all.length) throw new RenderError("tool_error", "No render job was created. " + jobProblem(b.p));
    return all;
  }

  // Long-poll until every job is terminal (about 7 minutes at most).
  async wait(jobs) {
    const q = jobs.map((j) => ({ index: j.index, job_id: j.job_id }));
    for (let i = 0; i < this.maxWaits; i++) {
      const p = await this.call("jobs_wait", { jobs: q, timeout_seconds: 15 });
      if (p.all_terminal) return p.jobs || [];
    }
    throw new RenderError("timeout", "Still rendering after about seven minutes. Higgsfield may be busy. Nothing is lost: press Resume to keep waiting.");
  }
}

export function jobProblem(p) {
  p = p || {};
  if (p.unlim_choice) return "Higgsfield asked which balance to use; this tool always uses credits. Run it again.";
  const e = p.errors || p.rejected || p.error;
  if (e) return String(typeof e === "string" ? e : JSON.stringify(e)).slice(0, 240);
  return "Check your Higgsfield credit balance.";
}

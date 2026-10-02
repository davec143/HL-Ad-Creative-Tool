// Higgsfield renderer over Higgsfield's official MCP server (https://mcp.higgsfield.ai/mcp).
// These are the same tools, model (nano_banana_pro, 2K) and subscription credits the v16 Ad Builder
// used through the Claude connector, called from this server instead. The first time, someone signs
// in to Higgsfield once (OAuth, from the app's status banner); tokens are stored in DATA_DIR/state
// and refreshed automatically.
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

// sent: false  = the request provably never left this server (connect/sign-in failed first).
// sent: true   = it may have reached Higgsfield; the outcome is unknown.
export class RenderError extends Error {
  constructor(code, message, { sent } = {}) { super(message); this.code = code; if (sent !== undefined) this.sent = sent; }
}

// OAuth client provider that persists everything in the app's state store. Each sign-in attempt
// gets its own single-use state, bound to the app session that started it, holding that attempt's
// PKCE verifier and expiring after 10 minutes, so concurrent attempts can't overwrite each other.
// (The SDK calls state() -> saveCodeVerifier() -> redirectToAuthorization() in that order.)
const STATE_TTL = 10 * 60 * 1000;
class StoreOAuthProvider {
  constructor(store, redirectUrl) { this.store = store; this._redirect = redirectUrl; this.pendingAuthUrl = null; this.sid = null; this.current = null; this.completing = null; }
  get redirectUrl() { return this._redirect; }
  get clientMetadata() {
    return { client_name: "HitLights Ad Builder", redirect_uris: [this._redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
  }
  pending() {
    const all = this.store.getState("hf-oauth-pending", {}), now = Date.now();
    for (const [k, v] of Object.entries(all)) if (!v || now - v.at > STATE_TTL) delete all[k];
    return all;
  }
  state() {
    const s = crypto.randomBytes(24).toString("base64url");
    const all = this.pending(); all[s] = { sid: this.sid, at: Date.now() };
    this.store.setState("hf-oauth-pending", all);
    this.current = s;
    return s;
  }
  clientInformation() { return this.store.getState("hf-client") || undefined; }
  saveClientInformation(info) { this.store.setState("hf-client", info); }
  tokens() { return this.store.getState("hf-tokens") || undefined; }
  saveTokens(t) { this.store.setState("hf-tokens", t); }
  redirectToAuthorization(url) { this.pendingAuthUrl = url.toString(); }
  saveCodeVerifier(v) {
    const all = this.pending();
    if (this.current && all[this.current]) { all[this.current].verifier = v; this.store.setState("hf-oauth-pending", all); }
  }
  codeVerifier() {
    const p = this.completing && this.pending()[this.completing];
    if (!p || !p.verifier) throw new Error("no PKCE verifier for this sign-in");
    return p.verifier;
  }
  // Validate and consume a state: it must exist, be unexpired, unused and belong to this session.
  consume(state, sid) {
    const all = this.pending(), p = state && all[state];
    if (!p) throw new RenderError("bad_state", "Sign-in link expired, was already used, or wasn't started here.");
    if (p.sid !== sid) throw new RenderError("bad_state", "This sign-in was started from a different session.");
    delete all[state]; this.store.setState("hf-oauth-pending", all);
    return p;
  }
  invalidateCredentials(scope) {
    if (scope === "all" || scope === "client") this.store.delState("hf-client");
    if (scope === "all" || scope === "tokens") this.store.delState("hf-tokens");
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

  // Close a client/transport that is being replaced, so reconnects don't leak sessions.
  async dropClient() {
    const c = this.client; this.client = null;
    if (c) { try { await c.close(); } catch { /* already gone */ } }
  }
  async close() { await this.dropClient(); this.transport = null; }

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

  // Start a sign-in for an app session. Returns the Higgsfield URL, or null if already connected.
  async beginAuth(sid) {
    await this.dropClient(); this.transport = null; this.provider.pendingAuthUrl = null; this.provider.sid = sid;
    const st = await this.status();
    if (st.connected) return null;
    if (!this.provider.pendingAuthUrl) throw new RenderError("server_unavailable", "Higgsfield didn't offer a sign-in link: " + (st.error || "unknown"));
    return this.provider.pendingAuthUrl;
  }

  async finishAuth(code, state, sid) {
    const p = this.provider.consume(state, sid); // single use, session-bound, unexpired
    this.provider.completing = state;
    try {
      // The verifier is consumed with the state; keep it in memory just for this exchange.
      this.provider.codeVerifier = () => { if (!p.verifier) throw new Error("no PKCE verifier for this sign-in"); return p.verifier; };
      const transport = this.transport || new StreamableHTTPClientTransport(this.url, { authProvider: this.provider });
      await transport.finishAuth(code);
    } finally {
      delete this.provider.codeVerifier; this.provider.completing = null;
    }
    await this.dropClient(); this.transport = null; this.provider.pendingAuthUrl = null;
    await this.connect();
  }

  // Call a tool. Read-only tools (balance, jobs_wait, history) may be retried once after a dropped
  // session. Paid tools (generate_image_batch) are NEVER retried here: a request that may have
  // reached Higgsfield is reported with sent:true so the pipeline can treat it as ambiguous.
  async call(tool, args, { retry = true, timeoutMs = 120000 } = {}) {
    for (let attempt = 0; ; attempt++) {
      let client;
      try { client = await this.connect(); }
      catch (e) { e.sent = false; throw e; } // never left this server
      try {
        return payloadOf(await client.callTool({ name: tool, arguments: args }, undefined, { timeout: timeoutMs }));
      } catch (e) {
        // The tool answered with an error result (e.g. insufficient credits): an explicit rejection.
        if (e instanceof RenderError) { e.sent = true; e.rejected = true; throw e; }
        await this.dropClient();
        // 401: refused by sign-in before the tool ran, so no job can exist.
        if (e instanceof UnauthorizedError) throw new RenderError("needs_auth", "Higgsfield sign-in expired. Sign in again.", { sent: false });
        // Anything else (timeout, dropped connection): the request may have been processed.
        if (!retry || attempt >= 1) throw new RenderError("server_unavailable", "Higgsfield didn't answer: " + (e && e.message || e), { sent: true });
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

  // Send ONE generate_image_batch request and return what Higgsfield said, unmodified:
  //   {jobs: [{index, job_id?, status}], raw}. No retries here: the pipeline decides, per item,
  //   what is accepted, explicitly rejected (status "submission_failed") or ambiguous.
  async submit(requests) {
    // Only {index, params} go to Higgsfield: its schema rejects any other field (e.g. our meta).
    const p = await this.call("generate_image_batch", { requests: requests.map((q) => ({ index: q.index, params: q.params })) }, { retry: false });
    return { jobs: Array.isArray(p.jobs) ? p.jobs : [], raw: { unlim_choice: !!p.unlim_choice, problem: jobProblem(p) } };
  }

  // Best-effort reconciliation for an ambiguous submission: look in the account's generation
  // history for a job with the same prompt and aspect ratio created after the attempt started.
  // show_generations lists COMPLETED generations only, so "no match" is not proof that nothing was
  // charged; a job still rendering won't appear yet. The person decides.
  async findCandidates(attempt) {
    const p = await this.call("show_generations", { type: "image", size: 40 });
    const since = (attempt.submittedAt || attempt.preparedAt || 0) / 1000 - 120;
    return (p.items || [])
      .filter((g) => g && g.params && g.params.prompt === attempt.params.prompt && String(g.params.aspect_ratio) === String(attempt.params.aspect_ratio) && (g.createdAt || 0) >= since)
      .map((g) => ({ jobId: g.id, createdAt: Math.round((g.createdAt || 0) * 1000), model: g.model, status: g.status || "completed" }));
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

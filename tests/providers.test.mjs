// Provider tests with mocked network: Shopify, LLM (Anthropic + OpenAI-compatible), Drive, Higgsfield MCP.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { Shopify, buildSearchQuery, toProduct } from "../server/providers/shopify.mjs";
import { makeLlm, extractJson, DRAFT_SCHEMA, QA_SCHEMA } from "../server/providers/llm.mjs";
import { Drive } from "../server/providers/drive.mjs";
import { HiggsfieldMcpRenderer, payloadOf } from "../server/render/higgsfield-mcp.mjs";
import { readConfig, checkConfig } from "../server/config.mjs";

const require = createRequire(import.meta.url);

function res(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => Buffer.from("") }; }

// ---------- Shopify ----------
test("shopify: search query is identical to v16's", async () => {
  const { load } = require("../tools/legacy-harness.cjs");
  const H = load();
  for (const q of ["EZDim", "EZDim Pro 24V", 'strip "light" (16ft)', "HL-24V*100W", "  a  b "]) {
    let sent = null;
    H.setMcp({ callTool(s, tool, input) { sent = input.search_query; return Promise.resolve({ payload: { data: { products: { edges: [] } } } }); } });
    H.$("q").value = q; H.$("search").fire("click");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(buildSearchQuery(q), sent, q);
  }
  assert.equal(buildSearchQuery("   "), null);
});

test("shopify: maps products, featured image first, stock and SKU", async () => {
  const node = {
    id: "gid://shopify/Product/1", title: "EZDim 12V", description: "UL listed.", totalInventory: 0,
    featuredMedia: { preview: { image: { url: "https://cdn/f.jpg", width: 800, height: 800 } } },
    media: { edges: [{ node: { mediaContentType: "IMAGE", preview: { image: { url: "https://cdn/a.jpg" } } } }, { node: { mediaContentType: "IMAGE", preview: { image: { url: "https://cdn/f.jpg" } } } }, { node: { mediaContentType: "VIDEO", preview: { image: { url: "https://cdn/v.jpg" } } } }] },
    variants: { edges: [{ node: { sku: "EZD-12", price: "39.99" } }] },
  };
  const p = toProduct(node);
  assert.equal(p.url, "https://cdn/f.jpg");
  assert.deepEqual(p.images.map((i) => i.url), ["https://cdn/f.jpg", "https://cdn/a.jpg"]);
  assert.equal(p.inventory, 0); assert.equal(p.sku, "EZD-12");
  let call;
  const s = new Shopify({ store: "hitlights.myshopify.com", token: "shpat_x", apiVersion: "2025-10", fetchImpl: async (url, init) => { call = { url, init }; return res(200, { data: { products: { edges: [{ node }] } } }); } });
  const out = await s.search("EZDim");
  assert.equal(out.length, 1);
  assert.equal(call.url, "https://hitlights.myshopify.com/admin/api/2025-10/graphql.json");
  assert.equal(call.init.headers["X-Shopify-Access-Token"], "shpat_x");
  assert.equal(JSON.parse(call.init.body).variables.q, "status:active AND ((title:*EZDim*) OR sku:*EZDim*)");
});

test("shopify: clear errors for bad token and GraphQL errors", async () => {
  const bad = new Shopify({ store: "s.myshopify.com", token: "t", apiVersion: "2025-10", fetchImpl: async () => res(401, {}) });
  await assert.rejects(bad.search("x"), /access token/);
  const gq = new Shopify({ store: "s.myshopify.com", token: "t", apiVersion: "2025-10", fetchImpl: async () => res(200, { errors: [{ message: "Access denied for totalInventory" }] }) });
  await assert.rejects(gq.search("x"), /totalInventory/);
  const off = new Shopify({ store: "", token: "" });
  await assert.rejects(off.search("x"), (e) => e.code === "not_configured");
});

// ---------- LLM ----------
test("llm: anthropic request uses structured output, images first, effort only off Haiku", async () => {
  const calls = [];
  const client = { messages: { create: async (req) => { calls.push(req); return { stop_reason: "end_turn", content: [{ type: "text", text: '{"images":[{"size":"1080x1080","verdict":"pass","issues":[]}]}' }] }; } } };
  const llm = makeLlm({ llmProvider: "anthropic", llmApiKey: "k" }, { anthropicClient: client });
  const o = await llm.json({ prompt: "check", images: [Buffer.from("jpg")], schema: QA_SCHEMA, model: "claude-sonnet-5-5", effort: "medium" });
  assert.equal(o.images[0].verdict, "pass");
  const q = calls[0];
  assert.equal(q.model, "claude-sonnet-5-5");
  assert.equal(q.messages[0].content[0].type, "image");
  assert.equal(q.messages[0].content[0].source.media_type, "image/jpeg");
  assert.equal(q.messages[0].content[1].text, "check");
  assert.deepEqual(q.output_config, { format: { type: "json_schema", schema: QA_SCHEMA }, effort: "medium" });
  assert.ok(q.max_tokens >= 16000);
  await llm.json({ prompt: "draft", schema: DRAFT_SCHEMA, model: "claude-haiku-4-5", effort: "medium" });
  assert.deepEqual(calls[1].output_config, { format: { type: "json_schema", schema: DRAFT_SCHEMA } });
  await llm.json({ prompt: "plain", model: "claude-haiku-4-5" });
  assert.equal(calls[2].output_config, undefined);
});

test("llm: anthropic refusal and truncation are errors, not bad JSON", async () => {
  for (const [stop, code] of [["refusal", "refusal"], ["max_tokens", "truncated"]]) {
    const client = { messages: { create: async () => ({ stop_reason: stop, content: [] }) } };
    const llm = makeLlm({ llmProvider: "anthropic", llmApiKey: "k" }, { anthropicClient: client });
    await assert.rejects(llm.json({ prompt: "x", model: "claude-haiku-4-5" }), (e) => e.code === code);
  }
});

test("llm: openai-compatible request shape (OpenAI / Gemini / OpenRouter)", async () => {
  let call;
  const llm = makeLlm({ llmProvider: "openai-compatible", llmApiKey: "k", llmBaseUrl: "https://example.com/v1/" }, {
    fetchImpl: async (url, init) => { call = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }; return res(200, { choices: [{ finish_reason: "stop", message: { content: "```json\n{\"h1\":\"A\"}\n```" } }] }); },
  });
  const o = await llm.json({ prompt: "p", images: [Buffer.from("x")], schema: DRAFT_SCHEMA, model: "gemini-flash" });
  assert.equal(o.h1, "A");
  assert.equal(call.url, "https://example.com/v1/chat/completions");
  assert.equal(call.auth, "Bearer k");
  assert.match(call.body.messages[0].content[0].image_url.url, /^data:image\/jpeg;base64,/);
  assert.deepEqual(call.body.response_format.json_schema.schema, DRAFT_SCHEMA);
  assert.equal(call.body.response_format.type, "json_schema");
});

test("llm: extractJson tolerates fences and prose, rejects junk", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":2}\n```'), { a: 2 });
  assert.throws(() => extractJson("no json here"), (e) => e.code === "bad_json");
});

test("config: provider defaults and validation", () => {
  const a = readConfig({ ANTHROPIC_API_KEY: "k" });
  assert.equal(a.llmProvider, "anthropic"); assert.equal(a.llmDraftModel, "claude-haiku-4-5"); assert.equal(a.llmQaModel, "claude-sonnet-5-5");
  const n = readConfig({});
  assert.equal(n.llmProvider, "none"); assert.equal(n.renderer, "higgsfield-mcp");
  assert.deepEqual(checkConfig(n).errors, []);
  const o = readConfig({ LLM_PROVIDER: "openai-compatible", LLM_API_KEY: "k" });
  assert.ok(checkConfig(o).errors.some((e) => /LLM_BASE_URL/.test(e)));
  const p = readConfig({ APP_PASSWORD: "x" });
  assert.ok(checkConfig(p).errors.some((e) => /SESSION_SECRET/.test(e)));
  const m = readConfig({ LLM_PROVIDER: "openai-compatible", LLM_API_KEY: "k", LLM_BASE_URL: "https://x", LLM_DRAFT_MODEL: "m" });
  assert.equal(m.llmQaModel, "m", "QA falls back to the draft model");
});

// ---------- Drive ----------
test("drive: signs a valid service-account JWT and uploads multipart", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sa = { client_email: "ads@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };
  const calls = [];
  const drive = new Drive({ serviceAccountJson: JSON.stringify(sa), parentId: "PARENT", fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.includes("oauth2")) return res(200, { access_token: "tok", expires_in: 3600 });
    if (url.includes("upload")) return res(200, { id: "file1", webViewLink: "https://drive/file1" });
    return res(200, { id: "folder1", webViewLink: "https://drive/folder1" });
  } });
  const jwt = drive.jwt(1000).split(".");
  assert.ok(crypto.createVerify("RSA-SHA256").update(jwt[0] + "." + jwt[1]).verify(publicKey, Buffer.from(jwt[2], "base64url")));
  const claim = JSON.parse(Buffer.from(jwt[1], "base64url"));
  assert.equal(claim.iss, sa.client_email); assert.equal(claim.exp, 4600);
  const f = await drive.createFolder("2026-09-30 EZDim");
  assert.equal(f.id, "folder1");
  assert.deepEqual(JSON.parse(calls[1].init.body).parents, ["PARENT"]);
  await drive.uploadJpeg("folder1", "1080x1080.jpg", Buffer.from([0xff, 0xd8, 0xff]));
  const up = calls[2];
  assert.match(up.url, /uploadType=multipart/);
  assert.equal(up.init.headers.Authorization, "Bearer tok");
  assert.ok(up.init.body.includes(Buffer.from('"name":"1080x1080.jpg"')));
  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1, "token cached");
  assert.throws(() => new Drive({ serviceAccountJson: "{nope" }), /valid JSON/);
});

// ---------- Higgsfield MCP ----------
test("higgsfield: payloadOf reads structured or text JSON; tool errors throw", () => {
  assert.deepEqual(payloadOf({ structuredContent: { credits: 5 } }), { credits: 5 });
  assert.deepEqual(payloadOf({ content: [{ type: "text", text: '{"media_id":"m1"}' }] }), { media_id: "m1" });
  assert.throws(() => payloadOf({ isError: true, content: [{ type: "text", text: "Insufficient credits" }] }), /Insufficient credits/);
});

function mcpRenderer(responses) {
  const store = { getState() {}, setState() {}, delState() {} };
  const r = new HiggsfieldMcpRenderer({ store, url: "https://mcp.example/mcp", publicUrl: "http://localhost", renderTimeoutMs: 45000, sleep: async () => {} });
  r.calls = [];
  r.call = async (tool, args) => { r.calls.push({ tool, args }); const f = responses[tool]; return typeof f === "function" ? f(args, r.calls) : f; };
  return r;
}

test("higgsfield: submit keeps accepted jobs and retries only the rejected item once", async () => {
  let n = 0;
  const r = mcpRenderer({ generate_image_batch: (args) => {
    n++;
    if (n === 1) return { jobs: [{ index: 2, job_id: "a", status: "queued" }, { index: 3, status: "submission_failed" }] };
    return { jobs: args.requests.map((q) => ({ index: q.index, job_id: "b" + q.index, status: "queued" })) };
  } });
  const jobs = await r.submit([{ index: 2, params: {} }, { index: 3, params: {} }]);
  assert.deepEqual(jobs.map((j) => j.job_id).sort(), ["a", "b3"]);
  assert.equal(r.calls[1].args.requests.length, 1);
  assert.equal(r.calls[1].args.requests[0].index, 3);
});

test("higgsfield: nothing accepted at all is an error that names the problem", async () => {
  const r = mcpRenderer({ generate_image_batch: { jobs: [], unlim_choice: { q: "?" } } });
  await assert.rejects(r.submit([{ index: 1, params: {} }]), /always uses credits/);
});

test("higgsfield: requests are sent without the internal meta field", async () => {
  const r = mcpRenderer({ generate_image_batch: (args) => ({ jobs: args.requests.map((q) => ({ index: q.index, job_id: "j" })) }) });
  await r.submit([{ index: 1, params: { model: "nano_banana_pro" }, meta: { tpl: "t1" } }]);
  assert.equal(r.calls[0].args.requests[0].meta, undefined);
});

test("higgsfield: wait long-polls until all_terminal, then times out cleanly", async () => {
  let n = 0;
  const r = mcpRenderer({ jobs_wait: () => (++n < 3 ? { all_terminal: false } : { all_terminal: true, jobs: [{ index: 1, job_id: "j", status: "completed", result_url: "https://cdn/x.png" }] }) });
  const done = await r.wait([{ index: 1, job_id: "j" }]);
  assert.equal(done[0].result_url, "https://cdn/x.png");
  assert.equal(r.calls[0].args.timeout_seconds, 15);
  const slow = mcpRenderer({ jobs_wait: { all_terminal: false } });
  await assert.rejects(slow.wait([{ index: 1, job_id: "j" }]), (e) => e.code === "timeout");
  assert.equal(slow.calls.length, 3, "45 s budget / 15 s polls");
});

test("higgsfield: import returns the media id or a clear error", async () => {
  assert.equal(await mcpRenderer({ media_import_url: { media_id: "m1" } }).importMedia("https://x/y.jpg"), "m1");
  await assert.rejects(mcpRenderer({ media_import_url: {} }).importMedia("https://x"), /publicly reachable/);
});

// Language-model provider for "Write it for me" (copy drafting) and the text & logo check (vision QA).
// Provider-agnostic: both features call json({prompt, images, schema, model}) and get a parsed object.
//   anthropic          Claude API via the official SDK. Defaults: claude-haiku-4-5 drafts,
//                      claude-sonnet-5-5 checks (strict spelling on images is where accuracy pays).
//   openai-compatible  Any Chat Completions endpoint: OpenAI, Google Gemini (OpenAI-compatible
//                      endpoint), OpenRouter, etc. Set LLM_BASE_URL + model names.
//   none               Both features off; the rest of the app works.
import Anthropic from "@anthropic-ai/sdk";

export class LlmError extends Error { constructor(code, message) { super(message); this.code = code; } }

// Media type from the file's magic bytes (finished ads are JPEG; product photos may not be).
export function sniffImage(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") return "image/webp";
  if (b.slice(0, 3).toString() === "GIF") return "image/gif";
  return null;
}
function mediaTypeOf(b) { const t = sniffImage(b); if (!t) throw new LlmError("bad_image", "An image for the check isn't a JPEG, PNG, WebP or GIF."); return t; }

// JSON schemas for the two replies (strict: every object closed, every field required).
export const DRAFT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: Object.fromEntries(["h1", "h2", "sub", "p1", "p2", "p3", "cta", "scene"].map((k) => [k, { type: "string" }])),
  required: ["h1", "h2", "sub", "p1", "p2", "p3", "cta", "scene"],
};
export const QA_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { images: { type: "array", items: {
    type: "object", additionalProperties: false,
    properties: { size: { type: "string" }, verdict: { type: "string", enum: ["pass", "fail"] }, issues: { type: "array", items: { type: "string" } } },
    required: ["size", "verdict", "issues"],
  } } },
  required: ["images"],
};

// Pull a JSON object out of model text (tolerates code fences or stray prose around it).
export function extractJson(text) {
  const s = String(text || "").trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a > -1 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ } }
  throw new LlmError("bad_json", "The model's reply wasn't valid JSON.");
}

function outputConfig(schema, effort, model) {
  const oc = {};
  if (schema) oc.format = { type: "json_schema", schema };
  if (effort && !/haiku/.test(model)) oc.effort = effort; // Haiku 4.5 rejects the effort setting
  return Object.keys(oc).length ? { output_config: oc } : {};
}

class AnthropicLlm {
  constructor({ apiKey, client }) { this.client = client || new Anthropic({ apiKey, maxRetries: 2, timeout: 120000 }); this.name = "Claude"; }
  // maxTokens is generous on purpose: on current models thinking tokens count toward it.
  async json({ prompt, images = [], schema, model, maxTokens = 16000, effort }) {
    const content = images.map((b) => ({ type: "image", source: { type: "base64", media_type: mediaTypeOf(b), data: b.toString("base64") } }));
    content.push({ type: "text", text: prompt });
    let res;
    try {
      res = await this.client.messages.create({
        model, max_tokens: maxTokens,
        messages: [{ role: "user", content }],
        ...outputConfig(schema, effort, model),
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new LlmError("auth", "The Anthropic API key was rejected.");
      if (e instanceof Anthropic.RateLimitError) throw new LlmError("rate_limited", "Too many requests just now. Wait a moment and try again.");
      if (e instanceof Anthropic.BadRequestError) throw new LlmError("bad_request", "Claude rejected the request: " + e.message);
      if (e instanceof Anthropic.APIError) throw new LlmError("upstream", "Claude didn't answer: " + e.message);
      throw new LlmError("upstream", "Couldn't reach Claude: " + (e && e.message));
    }
    if (res.stop_reason === "refusal") throw new LlmError("refusal", "The model declined this request.");
    if (res.stop_reason === "max_tokens") throw new LlmError("truncated", "The model's reply was cut off.");
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return extractJson(text);
  }
}

class OpenAiCompatibleLlm {
  constructor({ apiKey, baseUrl, fetchImpl = fetch }) { this.key = apiKey; this.base = baseUrl.replace(/\/+$/, ""); this.fetch = fetchImpl; this.name = "LLM"; }
  async json({ prompt, images = [], schema, model, maxTokens = 16000 }) {
    const content = images.map((b) => ({ type: "image_url", image_url: { url: "data:" + mediaTypeOf(b) + ";base64," + b.toString("base64") } }));
    content.push({ type: "text", text: prompt });
    const body = { model, max_tokens: maxTokens, messages: [{ role: "user", content }] };
    if (schema) body.response_format = { type: "json_schema", json_schema: { name: "reply", strict: true, schema } };
    const res = await this.fetch(this.base + "/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.key },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
    });
    if (res.status === 401 || res.status === 403) throw new LlmError("auth", "The LLM API key was rejected.");
    if (res.status === 429) throw new LlmError("rate_limited", "Too many requests just now. Wait a moment and try again.");
    if (!res.ok) throw new LlmError("upstream", "The LLM returned HTTP " + res.status + ": " + (await res.text()).slice(0, 200));
    const j = await res.json();
    const choice = j.choices && j.choices[0];
    if (!choice) throw new LlmError("upstream", "The LLM returned no answer.");
    if (choice.finish_reason === "length") throw new LlmError("truncated", "The model's reply was cut off.");
    return extractJson(choice.message && choice.message.content);
  }
}

export function makeLlm(cfg, deps = {}) {
  if (cfg.llmProvider === "anthropic") return new AnthropicLlm({ apiKey: cfg.llmApiKey, client: deps.anthropicClient });
  if (cfg.llmProvider === "openai-compatible") return new OpenAiCompatibleLlm({ apiKey: cfg.llmApiKey, baseUrl: cfg.llmBaseUrl, fetchImpl: deps.fetchImpl });
  return null;
}

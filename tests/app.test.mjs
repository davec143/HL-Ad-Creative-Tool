// HTTP layer tests: auth gate, validation before any credit is spent, file access, zip, OAuth state.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp, zip, publicRun } from "../server/app.mjs";
import { Store } from "../server/store.mjs";
import { Pipeline } from "../server/pipeline.mjs";
import { FakeRenderer } from "../server/render/fake.mjs";
import { readConfig, ROOT } from "../server/config.mjs";
import { SAMPLE, TPL_ORDER } from "../core/brand.mjs";

const PY = process.env.PYTHON || (fs.existsSync(path.join(ROOT, ".venv/bin/python")) ? path.join(ROOT, ".venv/bin/python") : "python3");

async function boot(env = {}, over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hlab-app-"));
  const cfg = readConfig({ DATA_DIR: dir, PYTHON: PY, COMPOSED_TEMPLATES: "", ...env });
  const store = new Store(dir);
  const renderer = over.renderer || new FakeRenderer({ store, python: PY });
  const pipeline = new Pipeline({ cfg, store, renderer, llm: null, drive: null, log: { error() {} } });
  const shopify = { enabled: false, search: async () => { throw Object.assign(new Error("off"), { code: "not_configured" }); } };
  const server = http.createServer(createApp({ cfg, store, pipeline, renderer, shopify, llm: over.llm || null, drive: null }));
  await new Promise((r) => server.listen(0, r));
  const base = "http://127.0.0.1:" + server.address().port;
  const req = async (p, opts = {}) => {
    const origin = opts.method && opts.method !== "GET" ? { origin: new URL(cfg.publicUrl).origin } : {};
    const r = await fetch(base + p, { redirect: "manual", ...opts, headers: { "content-type": "application/json", ...origin, ...(opts.headers || {}) }, body: opts.body && JSON.stringify(opts.body) });
    const ct = r.headers.get("content-type") || "";
    return { status: r.status, headers: r.headers, json: ct.includes("json") ? await r.json() : null, buf: ct.includes("json") ? null : Buffer.from(await r.arrayBuffer()) };
  };
  return { cfg, store, pipeline, server, req, close: () => new Promise((r) => server.close(r)) };
}
const FORM = { tpl: "t1", ...SAMPLE.t1, phone: "+1 855 768 4135", email: "customerservice@hitlights.com" };
const PICK = { url: "https://cdn.shopify.com/p.jpg", title: "EZDim 12V" };

test("live library route serves the complete registry with revalidation", async () => {
  const a = await boot();
  try {
    const r = await a.req('/reference');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.match(r.headers.get('content-security-policy'), /script-src 'none'/);
    for (const tpl of TPL_ORDER) assert.ok(r.buf.toString().includes(`data-template="${tpl}"`), `missing ${tpl}`);
  } finally { await a.close(); }
});

test("password gate: API locked until sign-in; wrong password refused", async () => {
  const a = await boot({ APP_PASSWORD: "hunter2", SESSION_SECRET: "s".repeat(40) });
  try {
    assert.equal((await a.req("/api/status")).status, 401);
    assert.equal((await a.req("/")).status, 200, "the page itself loads (it shows the sign-in form)");
    assert.equal((await a.req("/api/login", { method: "POST", body: { password: "nope" } })).status, 401);
    const ok = await a.req("/api/login", { method: "POST", body: { password: "hunter2" } });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get("set-cookie").split(";")[0];
    assert.equal((await a.req("/api/status", { headers: { cookie } })).status, 200);
    assert.equal((await a.req("/api/status", { headers: { cookie: cookie.slice(0, -2) + "xx" } })).status, 401, "tampered cookie");
  } finally { await a.close(); }
});

test("generate: copy that breaks the template limits is refused before any credit is spent", async () => {
  const a = await boot();
  try {
    const r = await a.req("/api/runs", { method: "POST", body: { form: { ...FORM, h1: "X".repeat(40) }, picked: PICK } });
    assert.equal(r.status, 400); assert.match(r.json.error, /doesn’t fit this template/);
    const noImg = await a.req("/api/runs", { method: "POST", body: { form: FORM, picked: { url: "http://insecure/x.jpg" } } });
    assert.equal(noImg.status, 400); assert.match(noImg.json.error, /must start with https/);
    const t3 = await a.req("/api/runs", { method: "POST", body: { form: { tpl: "t3", ...SAMPLE.t3 }, picked: PICK } });
    assert.equal(t3.status, 400); assert.match(t3.json.error, /offer and deadline/);
    assert.equal(a.store.creditsToday(), 0);
    assert.equal(a.store.listRuns().length, 0);
  } finally { await a.close(); }
});

test("generate: low balance and needs-sign-in are refused up front", async () => {
  const low = { name: "x", status: async () => ({ connected: true }), balance: async () => 4 };
  const a = await boot({}, { renderer: low });
  try { const r = await a.req("/api/runs", { method: "POST", body: { form: FORM, picked: PICK } }); assert.equal(r.status, 402); assert.match(r.json.error, /balance is 4/); }
  finally { await a.close(); }
  const auth = { name: "x", status: async () => ({ connected: false, needsAuth: true }), balance: async () => null };
  const b = await boot({}, { renderer: auth });
  try { const r = await b.req("/api/runs", { method: "POST", body: { form: FORM, picked: PICK } }); assert.equal(r.status, 409); assert.equal(r.json.code, "needs_auth"); }
  finally { await b.close(); }
});

test("full set over HTTP: poll, files, download name, zip; bad file names refused", async () => {
  const a = await boot();
  try {
    const c = await a.req("/api/runs", { method: "POST", body: { form: FORM, picked: PICK } });
    assert.equal(c.status, 201);
    const id = c.json.run.id;
    assert.equal((await a.req("/api/runs", { method: "POST", body: { form: FORM, picked: PICK } })).status, 409, "one set at a time");
    await a.pipeline.queue;
    const g = await a.req("/api/runs/" + id);
    assert.equal(g.json.run.status, "done");
    const it = g.json.run.items[0];
    assert.equal(it.rawUrl, null, "local fake paths are never exposed");
    const f = await a.req(it.file + "?dl=1");
    assert.equal(f.status, 200); assert.equal(f.headers.get("content-type"), "image/jpeg");
    assert.equal(f.headers.get("cache-control"), "private, no-store", "re-composition cannot serve a stale image");
    assert.match(f.headers.get("content-disposition"), /filename="1080x1080.jpg"/);
    const z = await a.req("/api/runs/" + id + "/zip");
    assert.equal(z.status, 200); assert.equal(z.buf.readUInt32LE(0), 0x04034b50);
    assert.equal((await a.req("/api/runs/" + id + "/files/..%2F..%2Fstate%2Fhf-tokens.json")).status, 404);
    assert.equal((await a.req("/api/runs/" + id + "/files/other.jpg")).status, 404);
    assert.equal((await a.req("/api/runs/nope123/files/x.jpg")).status, 404);
    const list = await a.req("/api/runs");
    assert.equal(list.json.runs.length, 1); assert.equal(list.json.runs[0].log, undefined);
  } finally { await a.close(); }
});

test("draft: off without an LLM; with one, fills only the fields it returns", async () => {
  const a = await boot();
  try { const r = await a.req("/api/draft", { method: "POST", body: { form: FORM, picked: PICK } }); assert.equal(r.status, 400); assert.equal(r.json.code, "no_llm"); }
  finally { await a.close(); }
  let brief = null;
  const llm = { name: "m", json: async ({ prompt }) => { brief = prompt; return { h1: "NEW ONE.", h2: "", sub: "", p1: "p", p2: "", p3: "", cta: "SHOP NOW", scene: "A scene." }; } };
  const b = await boot({}, { llm });
  try {
    const r = await b.req("/api/draft", { method: "POST", body: { form: { ...FORM, angle: "for electricians" }, picked: { ...PICK, desc: "UL listed dimmer." } } });
    assert.equal(r.status, 200);
    assert.equal(r.json.form.h1, "NEW ONE."); assert.equal(r.json.form.h2, FORM.h2, "empty reply fields keep what was there");
    assert.match(brief, /Product listing copy: UL listed dimmer\./); assert.match(brief, /ANGLE REQUESTED: for electricians/);
  } finally { await b.close(); }
});

test("oauth callback errors are a clean 400; success redirects home", async () => {
  const renderer = { name: "Higgsfield", status: async () => ({ connected: false, needsAuth: true }), balance: async () => null,
    beginAuth: async () => "https://auth.example/authorize", finishAuth: async (code, state) => { if (state !== "good") throw new Error("Sign-in link expired"); } };
  const a = await boot({}, { renderer });
  try {
    const st = await a.req("/oauth/higgsfield/start");
    assert.equal(st.status, 302); assert.equal(st.headers.get("location"), "https://auth.example/authorize");
    const bad = await a.req("/oauth/higgsfield/callback?code=c&state=evil");
    assert.equal(bad.status, 400); assert.match(bad.json.error, /didn't complete/);
    const ok = await a.req("/oauth/higgsfield/callback?code=c&state=good");
    assert.equal(ok.status, 302); assert.equal(ok.headers.get("location"), "/?higgsfield=connected");
  } finally { await a.close(); }
});

test("zip writer produces a readable archive", () => {
  const z = zip([{ name: "a.jpg", data: Buffer.from("hello") }, { name: "b.jpg", data: Buffer.from("world!") }]);
  assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50);
  assert.equal(z.readUInt16LE(z.length - 12), 2);
});

test("publicRun never leaks server paths", () => {
  const r = { id: "rabc123", ts: 1, status: "done", log: [], S: { product: "p", tpl: "t1", tplName: "T1", folder: "f", outOfStock: false }, items: [{ kind: "master", dims: "1080x1080", title: "Square", version: 1, state: "done", flags: [], logo: { x: 1, y: 2, where: "w" }, url: "file:///data/fake/x.png", file: "master-v1.jpg" }] };
  const s = JSON.stringify(publicRun(r));
  assert.ok(!s.includes("/data/")); assert.ok(s.includes("/api/runs/rabc123/files/master-v1.jpg"));
  r.scene = { preview: "scene-v1-prepared-preview.jpg" };
  r.items[0].output = { ok: true, sha256: "abc123" };
  const p = publicRun(r);
  assert.match(p.scene.preview, /\?v=scene-v1-prepared-preview.jpg$/);
  assert.match(p.items[0].file, /\?v=abc123$/);
});

test("cutout approval is bound to the viewed revision and its own run", async () => {
  const a = await boot({ COMPOSED_TEMPLATES: "t1" });
  try {
    const first = "a".repeat(64), second = "b".repeat(64), cs = a.pipeline.cutouts;
    fs.writeFileSync(cs.png(first), Buffer.from("first cutout pixels"));
    fs.writeFileSync(cs.png(second), Buffer.from("second cutout pixels"));
    const one = cs.put(first, { state: "auto", algo: 3 }), two = cs.put(second, { state: "auto", algo: 3 });
    const run = a.pipeline.create({ form: FORM, picked: PICK });
    run.cutout = { sha: second, state: "auto", revision: two.revision }; a.store.saveRun(run);
    const mismatch = await a.req("/api/cutouts/" + first + "/approve", { method: "POST", body: { confirm: true, runId: run.id, revision: one.revision } });
    assert.equal(mismatch.status, 400);
    assert.equal(cs.get(first).state, "auto"); assert.equal(cs.get(second).state, "auto");
    const oldImage = await a.req("/api/cutouts/" + first + "?v=" + one.revision);
    assert.equal(oldImage.status, 200);
    assert.equal(oldImage.headers.get("cache-control"), "private, no-store");
    fs.writeFileSync(cs.png(first), Buffer.from("new corrected pixels"));
    cs.put(first, { state: "auto", algo: 3 });
    assert.equal((await a.req("/api/cutouts/" + first + "?v=" + one.revision)).status, 409, "an old preview URL never displays different pixels");
    const stale = await a.req("/api/cutouts/" + first + "/approve", { method: "POST", body: { confirm: true, revision: one.revision } });
    assert.equal(stale.status, 409); assert.equal(cs.get(first).state, "auto");
    const missing = await a.req("/api/cutouts/" + first + "/approve", { method: "POST", body: { confirm: true } });
    assert.equal(missing.status, 409);
    const fresh = cs.get(first);
    const approved = await a.req("/api/cutouts/" + first + "/approve", { method: "POST", body: { confirm: true, revision: fresh.revision } });
    assert.equal(approved.status, 200); assert.equal(approved.json.cutout.state, "approved");
    assert.equal(approved.json.cutout.revision, fresh.revision);
    assert.equal(cs.get(second).state, "auto");
  } finally { await a.close(); }
});

test("a run with older product pixels is shown held until it is recomposed", async () => {
  const a = await boot({ COMPOSED_TEMPLATES: "t1" });
  try {
    const sha = "c".repeat(64), cs = a.pipeline.cutouts;
    fs.writeFileSync(cs.png(sha), Buffer.from("corrected pixels"));
    const current = cs.put(sha, { state: "uploaded" });
    const run = a.pipeline.create({ form: FORM, picked: PICK });
    run.cutout = { sha, state: "approved", revision: "old" };
    run.items[0].file = "old.jpg";
    const visible = publicRun(run, { cutouts: cs });
    assert.equal(visible.cutout.revision, current.revision);
    assert.equal(visible.cutout.stale, true);
    assert.equal(visible.items[0].delivery.status, "held");
    assert.match(visible.cutout.image, new RegExp("v=" + current.revision + "$"));
  } finally { await a.close(); }
});

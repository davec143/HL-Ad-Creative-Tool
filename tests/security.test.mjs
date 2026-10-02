// Security: production config, sessions, logout, brute force, CSRF, OAuth state, leak checks.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";
import { Store } from "../server/store.mjs";
import { Pipeline } from "../server/pipeline.mjs";
import { FakeRenderer } from "../server/render/fake.mjs";
import { HiggsfieldMcpRenderer } from "../server/render/higgsfield-mcp.mjs";
import { readConfig, checkConfig, ROOT } from "../server/config.mjs";
import { Sessions, LoginLimiter, parseCookies, checkImageUrl } from "../server/security.mjs";
import { SAMPLE } from "../core/brand.mjs";

const PY = process.env.PYTHON || (fs.existsSync(path.join(ROOT, ".venv/bin/python")) ? path.join(ROOT, ".venv/bin/python") : "python3");
const SECRET = "x".repeat(48);

async function boot(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hlab-sec-"));
  const cfg = readConfig({ DATA_DIR: dir, PYTHON: PY, APP_PASSWORD: "correct horse battery", SESSION_SECRET: SECRET, ...env });
  const store = new Store(dir);
  const renderer = new FakeRenderer({ store, python: PY });
  const pipeline = new Pipeline({ cfg, store, renderer, llm: null, drive: null, log: { error() {} } });
  const shopify = { enabled: false, search: async () => [] };
  const server = http.createServer(createApp({ cfg, store, pipeline, renderer, shopify, llm: null, drive: null }));
  await new Promise((r) => server.listen(0, r));
  const base = "http://127.0.0.1:" + server.address().port, origin = new URL(cfg.publicUrl).origin;
  const req = async (p, { method = "GET", body, headers = {}, xorigin } = {}) => {
    const h = { "content-type": "application/json", ...headers };
    if (method !== "GET" && xorigin !== null) h.origin = xorigin || origin;
    const r = await fetch(base + p, { method, redirect: "manual", headers: h, body: body && JSON.stringify(body) });
    const ct = r.headers.get("content-type") || "";
    return { status: r.status, headers: r.headers, json: ct.includes("json") ? await r.json() : null, text: ct.includes("json") ? null : await r.text() };
  };
  const login = async (pw = "correct horse battery") => {
    const r = await req("/api/login", { method: "POST", body: { password: pw } });
    return { r, cookie: r.headers.get("set-cookie") ? r.headers.get("set-cookie").split(";")[0] : null };
  };
  return { cfg, store, pipeline, req, login, dir, close: () => new Promise((r) => server.close(r)) };
}

test("production refuses to start without auth, a strong secret, or https", () => {
  const e = (env) => checkConfig(readConfig({ NODE_ENV: "production", PUBLIC_URL: "https://ads.example", ...env })).errors.join(" ");
  assert.match(e({}), /requires APP_PASSWORD/);
  assert.match(e({ APP_PASSWORD: "longenough1" }), /SESSION_SECRET must be at least 32/);
  assert.match(e({ APP_PASSWORD: "longenough1", SESSION_SECRET: "short" }), /SESSION_SECRET/);
  assert.match(e({ APP_PASSWORD: "short", SESSION_SECRET: SECRET }), /at least 10/);
  assert.equal(e({ APP_PASSWORD: "longenough1", SESSION_SECRET: SECRET }), "");
  assert.match(checkConfig(readConfig({ NODE_ENV: "production", PUBLIC_URL: "http://ads.example", APP_PASSWORD: "longenough1", SESSION_SECRET: SECRET })).errors.join(" "), /https PUBLIC_URL/);
  assert.equal(readConfig({ NODE_ENV: "production", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }).publicUrl, "https://x.up.railway.app");
});

test("sessions: signed payload with iat/exp/sid; expired, tampered and revoked tokens fail", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hlab-s-")), store = new Store(dir);
  let now = 1_000_000;
  const S = new Sessions({ store, secret: SECRET, ttlMs: 1000, now: () => now });
  const { token, sid } = S.create();
  const p = S.verify(token);
  assert.equal(p.sid, sid); assert.equal(p.iat, 1_000_000); assert.equal(p.exp, 1_001_000);
  assert.equal(S.verify(token.slice(0, -2) + "AA"), null, "tampered");
  assert.equal(S.verify("garbage"), null); assert.equal(S.verify(""), null); assert.equal(S.verify("a.b.c.d"), null);
  now += 1001; assert.equal(S.verify(token), null, "expired");
  now -= 1001; S.revoke(sid); assert.equal(S.verify(token), null, "revoked");
  const other = new Sessions({ store, secret: "y".repeat(48), now: () => now });
  assert.equal(other.verify(S.create().token), null, "wrong secret");
});

test("login sets a hardened cookie; logout invalidates the session server-side", async () => {
  const a = await boot({ PUBLIC_URL: "https://ads.example" });
  try {
    const { r, cookie } = await a.login();
    const sc = r.headers.get("set-cookie");
    assert.match(sc, /^__Host-hlab=/); assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /SameSite=Lax/); assert.match(sc, /Path=\//);
    const ok = await a.req("/api/status", { headers: { cookie } });
    assert.equal(ok.status, 200);
    const out = await a.req("/api/logout", { method: "POST", headers: { cookie }, xorigin: "https://ads.example" });
    assert.equal(out.status, 200);
    assert.equal((await a.req("/api/status", { headers: { cookie } })).status, 401, "old cookie no longer works");
  } finally { await a.close(); }
});

test("malformed cookies are a 401, never a 500", async () => {
  const a = await boot();
  try {
    for (const cookie of ["hlab=%E0%A4%A", "hlab=", "hlab", "=x", "hlab=" + "a".repeat(5000), "hlab=e30.e30"]) {
      assert.equal((await a.req("/api/status", { headers: { cookie } })).status, 401, cookie.slice(0, 20));
    }
  } finally { await a.close(); }
});

test("brute-force limiter: parallel guesses can't exceed the limit; a later correct password is refused too", async () => {
  const a = await boot();
  try {
    const rs = await Promise.all(Array.from({ length: 12 }, () => a.login("wrong")));
    const codes = rs.map((x) => x.r.status);
    assert.equal(codes.filter((c) => c === 401).length, 8);
    assert.equal(codes.filter((c) => c === 429).length, 4);
    assert.equal((await a.login()).r.status, 429, "locked out for the window");
  } finally { await a.close(); }
  const L = new LoginLimiter({ perClient: 3, global: 5 });
  for (const c of ["a", "a", "a"]) assert.ok(L.take(c).ok);
  assert.equal(L.take("a").ok, false);
  assert.ok(L.take("b").ok); assert.ok(L.take("c").ok);
  assert.equal(L.take("d").ok, false, "global cap");
});

test("cross-origin or origin-less state-changing requests are refused", async () => {
  const a = await boot();
  try {
    const { cookie } = await a.login();
    const body = { form: { tpl: "t1", ...SAMPLE.t1 }, picked: { url: "https://cdn.shopify.com/p.jpg" } };
    const evil = await a.req("/api/runs", { method: "POST", body, headers: { cookie }, xorigin: "https://evil.example" });
    assert.equal(evil.status, 403); assert.equal(evil.json.code, "origin");
    const none = await a.req("/api/runs", { method: "POST", body, headers: { cookie }, xorigin: null });
    assert.equal(none.status, 403);
    const sameSite = await a.req("/api/runs", { method: "POST", body, headers: { cookie, "sec-fetch-site": "same-origin" }, xorigin: null });
    assert.equal(sameSite.status, 201, "Fetch Metadata same-origin is accepted");
    assert.equal((await a.req("/api/login", { method: "POST", body: { password: "x" }, xorigin: "https://evil.example" })).status, 403, "login CSRF");
  } finally { await a.close(); }
});

test("OAuth state: wrong, reused, expired or other-session states fail", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hlab-o-")), store = new Store(dir);
  const r = new HiggsfieldMcpRenderer({ store, url: "https://mcp.example/mcp", publicUrl: "https://ads.example" });
  const P = r.provider;
  P.sid = "S1"; const s1 = P.state(); P.saveCodeVerifier("v1");
  P.sid = "S2"; const s2 = P.state(); P.saveCodeVerifier("v2");
  assert.throws(() => P.consume("nope", "S1"), /expired|already used/);
  assert.throws(() => P.consume(s1, "S2"), /different session/);
  assert.equal(P.consume(s1, "S1").verifier, "v1", "concurrent attempts keep their own verifier");
  assert.throws(() => P.consume(s1, "S1"), /already used/);
  const all = store.getState("hf-oauth-pending"); all[s2].at -= 11 * 60 * 1000; store.setState("hf-oauth-pending", all);
  assert.throws(() => P.consume(s2, "S2"), /expired/);
});

test("OAuth start and callback require a signed-in session", async () => {
  const a = await boot();
  try {
    assert.equal((await a.req("/oauth/higgsfield/start")).status, 401);
    assert.equal((await a.req("/oauth/higgsfield/callback?code=c&state=s")).status, 401);
  } finally { await a.close(); }
});

test("public API never exposes tokens, secrets or local paths", async () => {
  const a = await boot();
  try {
    a.store.setState("hf-tokens", { access_token: "SECRET-ACCESS-TOKEN", refresh_token: "SECRET-REFRESH" });
    const { cookie } = await a.login();
    const c = await a.req("/api/runs", { method: "POST", headers: { cookie }, body: { form: { tpl: "t1", ...SAMPLE.t1, phone: "+1 855 768 4135", email: "customerservice@hitlights.com" }, picked: { url: "https://cdn.shopify.com/p.jpg", title: "EZDim" } } });
    assert.equal(c.status, 201);
    await a.pipeline.idle(); await a.pipeline.idle();
    const blobs = [await a.req("/api/status", { headers: { cookie } }), await a.req("/api/runs", { headers: { cookie } }), await a.req("/api/runs/" + c.json.run.id, { headers: { cookie } })].map((x) => JSON.stringify(x.json));
    for (const b of blobs) {
      assert.ok(!b.includes("SECRET-"), "token leaked"); assert.ok(!b.includes(SECRET), "session secret leaked");
      assert.ok(!b.includes(a.dir), "local path leaked"); assert.ok(!b.includes("file://"), "file URL leaked");
      assert.ok(!b.includes("correct horse"), "password leaked");
    }
  } finally { await a.close(); }
});

test("security headers: CSP, no framing, HSTS on https only", async () => {
  const a = await boot({ PUBLIC_URL: "https://ads.example" });
  try {
    const r = await a.req("/");
    assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
    assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.match(r.headers.get("strict-transport-security"), /max-age=/);
    assert.match((await a.req("/reference")).headers.get("content-security-policy"), /script-src 'none'/);
  } finally { await a.close(); }
  const b = await boot();
  try { assert.equal((await b.req("/")).headers.get("strict-transport-security"), null); } finally { await b.close(); }
});

test("path traversal stays blocked", async () => {
  const a = await boot();
  try {
    const { cookie } = await a.login();
    for (const p of ["/api/runs/abc123/files/..%2F..%2Fstate%2Fsessions.json", "/api/runs/..%2Fstate/files/x.jpg", "/core/../server/config.mjs", "/%2e%2e/.env", "/api/runs/abc123/files/%2e%2e"]) {
      const r = await a.req(p, { headers: { cookie } });
      assert.ok([400, 404].includes(r.status), p + " -> " + r.status);
    }
  } finally { await a.close(); }
});

test("image URLs: https only, no credentials, bounded, Shopify vs external", () => {
  assert.equal(checkImageUrl("http://cdn.shopify.com/a.jpg").ok, false);
  assert.equal(checkImageUrl("https://user:pw@cdn.shopify.com/a.jpg").ok, false);
  assert.equal(checkImageUrl("https://cdn.shopify.com/" + "a".repeat(3000)).ok, false);
  assert.equal(checkImageUrl("javascript:alert(1)").ok, false);
  assert.equal(checkImageUrl("https://localhost/a.jpg").ok, false);
  assert.equal(checkImageUrl("https://cdn.shopify.com/s/files/a.jpg").source, "shopify");
  assert.equal(checkImageUrl("https://hitlights.myshopify.com/a.jpg").source, "shopify");
  assert.equal(checkImageUrl("https://images.example.com/a.jpg").source, "external");
  assert.deepEqual(parseCookies("a=1; b=%E0%A4%A; c=3"), { a: "1", c: "3" });
});

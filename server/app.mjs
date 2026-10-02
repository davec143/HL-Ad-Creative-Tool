// HTTP layer: JSON API + static page. No framework, so the dependency surface stays tiny.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { ROOT } from "./config.mjs";
import { validateForGenerate, draftBrief, applyDraft, FORM_FIELDS } from "../core/engine.mjs";
import { TPL } from "../core/brand.mjs";
import { DRAFT_SCHEMA } from "./providers/llm.mjs";
import { fileName, blockingFlags, PipelineError } from "./pipeline.mjs";

const STATIC = {
  "/": "web/index.html", "/app.js": "web/app.js", "/styles.css": "web/styles.css",
  "/core/engine.mjs": "core/engine.mjs", "/core/brand.mjs": "core/brand.mjs",
  "/assets/logos/hitlights-logo-white.png": "assets/logos/hitlights-logo-white.png",
  "/assets/logos/hitlights-logo-black.png": "assets/logos/hitlights-logo-black.png",
  "/assets/logos/hitlights-mark.png": "assets/logos/hitlights-mark.png",
  "/reference": "reference/HitLights_Ad_Templates.html",
};
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg" };

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

// ---- signed session cookie (only used when APP_PASSWORD is set) ----
function sign(secret, value) { return value + "." + crypto.createHmac("sha256", secret).update(value).digest("base64url"); }
function unsign(secret, token) {
  const i = String(token || "").lastIndexOf("."); if (i < 1) return null;
  const v = token.slice(0, i);
  const a = Buffer.from(sign(secret, v)), b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? v : null;
}
function cookies(req) { return Object.fromEntries(String(req.headers.cookie || "").split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf("="); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; })); }

// ---- minimal ZIP (stored, no compression: JPEGs are already compressed) ----
export function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), data = f.data, crc = zlib.crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    parts.push(h, name, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, name);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

// What the page sees of a run (no server paths).
export function publicRun(r) {
  if (!r) return null;
  return {
    id: r.id, ts: r.ts, status: r.status, error: r.error, log: r.log.slice(-200), setNo: r.setNo,
    product: r.S.product, tpl: r.S.tpl, tplName: r.S.tplName, folder: r.S.folder, folderUrl: r.folder ? r.folder.url : "",
    driveError: r.driveError || null, saveDrive: r.saveDrive, credits: r.credits, creditsDetail: r.creditsDetail || null, outOfStock: r.S.outOfStock, masterReady: !!r.masterJob,
    attempts: (r.attempts || []).map((a) => ({ id: a.id, kind: a.kind, version: a.version, purpose: a.purpose, state: a.state, jobId: a.jobId, error: a.error, submittedAt: a.submittedAt, resolution: a.resolution || null, retryOf: a.retryOf })),
    items: r.items.map((x) => ({
      kind: x.kind, dims: x.dims, title: x.title, version: x.version, state: x.state, error: x.error, attemptId: x.attemptId || null,
      flags: x.flags, blocking: blockingFlags(x), mode: x.mode, at: x.at || null, grid: { x: x.logo.x, y: x.logo.y, where: x.logo.where },
      qa: x.qa, held: x.held, drive: x.drive, rawUrl: /^https:/.test(x.url || "") ? x.url : null,
      file: x.file ? `/api/runs/${r.id}/files/${x.file}` : null, fileName: fileName(x),
    })),
  };
}

export function createApp({ cfg, store, pipeline, renderer, shopify, llm, drive, warnings = [] }) {
  const sessionName = "hlab";

  async function body(req) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > 1e6) throw new HttpError(413, "Request too large."); chunks.push(c); }
    if (!n) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "Invalid JSON."); }
  }
  function send(res, status, obj, headers = {}) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
    res.end(JSON.stringify(obj));
  }
  function authed(req) { return !cfg.appPassword || unsign(cfg.sessionSecret, cookies(req)[sessionName]) === "ok"; }
  function cleanForm(f) {
    f = f || {}; const out = { tpl: TPL[f.tpl] ? f.tpl : "t1" };
    for (const k of FORM_FIELDS) out[k] = typeof f[k] === "string" ? f[k].slice(0, 600) : "";
    return out;
  }
  function cleanPicked(p) {
    p = p || {};
    const url = String(p.url || "").trim();
    let ok = false; try { const u = new URL(url); ok = u.protocol === "https:"; } catch { ok = false; }
    return { url: ok ? url : "", title: String(p.title || "").slice(0, 200), label: String(p.label || p.title || "").slice(0, 200), desc: String(p.desc || "").slice(0, 4000), outOfStock: !!p.outOfStock };
  }
  function pipelineHttp(e) {
    if (!(e instanceof PipelineError)) return e;
    const status = { already_queued: 409, ambiguous: 409, busy: 409, shutting_down: 503, not_found: 404 }[e.code] || 400;
    return new HttpError(status, e.message, e.code);
  }
  function actorOf() { return "team"; } // single shared password: no per-person identity yet
  function runOr404(id) { const r = store.getRun(id); if (!r) throw new HttpError(404, "No such set."); return r; }

  const routes = [
    ["POST", /^\/api\/login$/, async (req, res) => {
      const b = await body(req);
      const a = Buffer.from(String(b.password || "")), p = Buffer.from(cfg.appPassword);
      if (!cfg.appPassword || (a.length === p.length && crypto.timingSafeEqual(a, p))) {
        const secure = cfg.publicUrl.startsWith("https:") ? "; Secure" : "";
        return send(res, 200, { ok: true }, { "Set-Cookie": `${sessionName}=${encodeURIComponent(sign(cfg.sessionSecret || "x", "ok"))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}` });
      }
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      throw new HttpError(401, "Wrong password.");
    }, { open: true }],

    ["GET", /^\/api\/status$/, async (req, res) => {
      const st = await renderer.status();
      let balance = null;
      if (st.connected) { try { balance = await renderer.balance(); } catch { balance = null; } }
      send(res, 200, {
        renderer: { name: renderer.name, ...st, authUrl: st.needsAuth ? "/oauth/higgsfield/start" : undefined },
        balance, creditsPerRender: cfg.creditsPerRender, creditsToday: store.creditsToday(), caps: { perRun: cfg.maxCreditsPerRun, perDay: cfg.maxCreditsPerDay },
        shopify: shopify.enabled, llm: llm ? { name: llm.name, draftModel: cfg.llmDraftModel, qaModel: cfg.llmQaModel } : null,
        drive: drive && drive.enabled ? { email: drive.email } : null, warnings, busy: pipeline.busy(),
      });
    }],

    ["GET", /^\/api\/products$/, async (req, res, m, url) => {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
      try { send(res, 200, { products: await shopify.search(q) }); }
      catch (e) { throw new HttpError(e.code === "not_configured" ? 400 : 502, e.message); }
    }],

    ["POST", /^\/api\/draft$/, async (req, res) => {
      if (!llm) throw new HttpError(400, "Drafting is off: no language model is configured.", "no_llm");
      const b = await body(req), form = cleanForm(b.form), p = cleanPicked(b.picked);
      const product = p.title || p.desc ? { title: p.title, desc: p.desc } : null;
      if (!product && !form.angle.trim()) throw new HttpError(400, "Pick a product first, or describe the angle.");
      try {
        const o = await llm.json({ prompt: draftBrief(form.tpl, product, form.angle), schema: DRAFT_SCHEMA, model: cfg.llmDraftModel });
        send(res, 200, { form: applyDraft(form, o || {}) });
      } catch (e) { throw new HttpError(502, e.message, e.code); }
    }],

    ["GET", /^\/api\/runs$/, async (req, res) => {
      send(res, 200, { runs: store.listRuns(12).map((r) => { const p = publicRun(r); delete p.log; return p; }) });
    }],

    ["POST", /^\/api\/runs$/, async (req, res) => {
      const b = await body(req), form = cleanForm(b.form), picked = cleanPicked(b.picked);
      const bad = validateForGenerate(form, { hasImage: !!picked.url });
      if (bad.length) throw new HttpError(400, bad[0].title + ". " + bad[0].body, "invalid");
      if (pipeline.busy()) throw new HttpError(409, "A set is already running. Wait for it to finish.", "busy");
      if (pipeline.shuttingDown) throw new HttpError(503, "The server is restarting. Try again in a minute.", "shutting_down");
      const need = 3 * cfg.creditsPerRender;
      const st = await renderer.status();
      if (st.needsAuth) throw new HttpError(409, "Sign in to Higgsfield first (see the banner at the top).", "needs_auth");
      if (!st.connected) throw new HttpError(502, "Higgsfield isn't reachable right now. " + (st.error || ""), "renderer_down");
      let bal = null; try { bal = await renderer.balance(); } catch { bal = null; }
      if (bal != null && bal < need) throw new HttpError(402, `A set needs ${need} Higgsfield credits and the balance is ${bal}. Top up Higgsfield, then generate again.`, "credits");
      if (store.creditsToday() + need > cfg.maxCreditsPerDay) throw new HttpError(429, `Today's credit cap (${cfg.maxCreditsPerDay}) would be passed. It resets at midnight UTC.`, "credit_cap");
      const run = pipeline.start(pipeline.create({ form, picked, saveDrive: b.saveDrive !== false }));
      send(res, 201, { run: publicRun(run) });
    }],

    ["GET", /^\/api\/runs\/([a-z0-9]+)$/, async (req, res, m) => { send(res, 200, { run: publicRun(runOr404(m[1])), busy: pipeline.busy() }); }],

    ["POST", /^\/api\/runs\/([a-z0-9]+)\/(resume|regenerate|refinish|recheck|drive)$/, async (req, res, m) => {
      const id = m[1], action = m[2], b = await body(req); runOr404(id);
      const kind = ["master", "portrait", "landscape"].includes(b.kind) ? b.kind : null;
      if (pipeline.busy() && pipeline.busy() !== id) throw new HttpError(409, "Another set is running. Wait for it to finish.", "busy");
      try {
        let r;
        if (action === "resume") r = pipeline.resume(id);
        else if (action === "regenerate") { if (!kind) throw new HttpError(400, "Which size?"); r = pipeline.regenerate(id, kind); }
        else if (action === "refinish") r = pipeline.refinish(id);
        else if (action === "recheck") r = pipeline.recheck(id, kind);
        else r = pipeline.saveToDrive(id, kind, !!b.force);
        send(res, 202, { run: publicRun(r) });
      } catch (e) { throw pipelineHttp(e); }
    }],

    ["GET", /^\/api\/runs\/([a-z0-9]+)\/attempts\/([a-z0-9]+)\/candidates$/, async (req, res, m) => {
      runOr404(m[1]);
      try { send(res, 200, await pipeline.candidates(m[1], m[2])); }
      catch (e) { if (e instanceof PipelineError) throw pipelineHttp(e); throw new HttpError(502, "Couldn't search Higgsfield's history: " + e.message); }
    }],

    // A person's decision on an ambiguous paid submission. Recorded on the attempt.
    ["POST", /^\/api\/runs\/([a-z0-9]+)\/attempts\/([a-z0-9]+)\/resolve$/, async (req, res, m) => {
      const b = await body(req); runOr404(m[1]);
      if (!["adopt", "retry", "skip"].includes(b.action)) throw new HttpError(400, "Choose adopt, retry or skip.");
      if (b.action !== "adopt" && b.confirm !== true) throw new HttpError(400, "Confirm the decision first.", "confirm");
      try { send(res, 202, { run: publicRun(pipeline.resolve(m[1], m[2], { action: b.action, jobId: b.jobId, charged: !!b.charged, actor: actorOf(req) })) }); }
      catch (e) { throw pipelineHttp(e); }
    }],

    ["GET", /^\/api\/runs\/([a-z0-9]+)\/files\/([A-Za-z0-9._-]+)$/, async (req, res, m, url) => {
      const r = runOr404(m[1]); const x = r.items.find((i) => i.file === m[2]);
      if (!x) throw new HttpError(404, "No such file.");
      const data = fs.readFileSync(store.filePath(r.id, x.file));
      const h = { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" };
      if (url.searchParams.get("dl")) h["Content-Disposition"] = `attachment; filename="${fileName(x)}"`;
      res.writeHead(200, h); res.end(data);
    }],

    ["GET", /^\/api\/runs\/([a-z0-9]+)\/zip$/, async (req, res, m) => {
      const r = runOr404(m[1]);
      const files = r.items.filter((x) => x.file).map((x) => ({ name: fileName(x), data: fs.readFileSync(store.filePath(r.id, x.file)) }));
      if (!files.length) throw new HttpError(404, "No finished files yet.");
      const name = r.S.folder.replace(/[^A-Za-z0-9 ._()-]+/g, "-") + ".zip";
      res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"` });
      res.end(zip(files));
    }],

    ["GET", /^\/oauth\/higgsfield\/start$/, async (req, res) => {
      if (!renderer.provider) throw new HttpError(400, "This renderer has no sign-in.");
      renderer.provider.pendingAuthUrl = null; renderer.client = null;
      const st = await renderer.status();
      if (st.connected) { res.writeHead(302, { Location: "/" }); return res.end(); }
      if (!renderer.provider.pendingAuthUrl) throw new HttpError(502, "Higgsfield didn't offer a sign-in link: " + (st.error || "unknown"));
      res.writeHead(302, { Location: renderer.provider.pendingAuthUrl }); res.end();
    }],

    ["GET", /^\/oauth\/higgsfield\/callback$/, async (req, res, m, url) => {
      const code = url.searchParams.get("code"), state = url.searchParams.get("state");
      if (!code) throw new HttpError(400, "Higgsfield sign-in was cancelled: " + (url.searchParams.get("error") || "no code"));
      try { await renderer.finishAuth(code, state); }
      catch (e) { throw new HttpError(400, "Higgsfield sign-in didn't complete: " + e.message + " Go back to the Ad Builder and try again."); }
      res.writeHead(302, { Location: "/?higgsfield=connected" }); res.end();
    }],
  ];

  function serveStatic(req, res, pathname) {
    const rel = STATIC[pathname]; if (!rel) return false;
    const file = path.join(ROOT, rel);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(fs.readFileSync(file));
    return true;
  }

  return async function handler(req, res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    let url;
    try { url = new URL(req.url, "http://x"); } catch { res.writeHead(400); return res.end(); }
    try {
      if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
      if (req.method === "GET" && serveStatic(req, res, url.pathname)) return;
      for (const [method, re, fn, opt] of routes) {
        const m = url.pathname.match(re);
        if (!m || req.method !== method) continue;
        if (!(opt && opt.open) && !authed(req)) throw new HttpError(401, "Sign in first.", "login");
        return await fn(req, res, m, url);
      }
      throw new HttpError(404, "Not found.");
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(req.method, url.pathname, e);
      if (!res.headersSent) send(res, status, { error: e.message || "Server error.", code: e.code || (status === 401 ? "login" : "error") });
      else res.end();
    }
  };
}

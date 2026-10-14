// HTTP layer: JSON API + static page. No framework, so the dependency surface stays tiny.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { ROOT } from "./config.mjs";
import { validateForGenerate, draftBrief, applyDraft, FORM_FIELDS } from "../core/engine.mjs";
import { TPL } from "../core/brand.mjs";
import { DRAFT_SCHEMA, sniffImage } from "./providers/llm.mjs";
import { fileName, blockingFlags, PipelineError, fingerprint } from "./pipeline.mjs";
import { deliverability } from "../core/gates.mjs";
import { guardDraft } from "../core/facts.mjs";
import { Sessions, LoginLimiter, parseCookies, originOk, checkImageUrl, securityHeaders } from "./security.mjs";

const STATIC = {
  "/": "web/index.html", "/app.js": "web/app.js", "/styles.css": "web/styles.css",
  "/core/engine.mjs": "core/engine.mjs", "/core/brand.mjs": "core/brand.mjs", "/core/composed.mjs": "core/composed.mjs",
  "/assets/logos/hitlights-logo-white.png": "assets/logos/hitlights-logo-white.png",
  "/assets/logos/hitlights-logo-black.png": "assets/logos/hitlights-logo-black.png",
  "/assets/logos/hitlights-mark.png": "assets/logos/hitlights-mark.png",
  "/reference": "reference/HitLights_Ad_Templates.html",
};
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg" };

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

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
export function publicRun(r, opts = {}) {
  if (!r) return null;
  const c = r.cutout && (r.cutout.state !== "failed" && opts.cutouts && r.cutout.sha && opts.cutouts.get(r.cutout.sha) || r.cutout);
  let runCutoutRevision = r.cutout && r.cutout.revision;
  if (!runCutoutRevision && c && opts.store) {
    try { runCutoutRevision = crypto.createHash("sha256").update(fs.readFileSync(opts.store.filePath(r.id, "cutout.png"))).digest("hex"); } catch { /* old run without a private cutout */ }
  }
  const cutoutStale = !!(c && c.revision && c.revision !== runCutoutRevision);
  const totals = opts.store && opts.store.creditsForRun(r.id);
  return {
    id: r.id, ts: r.ts, status: r.status, error: r.error, log: r.log.slice(-200), setNo: r.setNo, batchId: r.batchId || null,
    product: r.S.product, tpl: r.S.tpl, tplName: r.S.tplName, folder: r.S.folder, folderUrl: r.folder ? r.folder.url : "",
    source: r.S.source ? { sku: r.S.source.sku, variantTitle: r.S.source.variantTitle, price: r.S.source.price, stock: r.S.source.stock, imageSource: r.S.source.imageSource, sha256: r.S.source.sha256 || null, kept: !!r.S.source.file, error: r.S.source.fetchError || null } : null,
    composed: !!r.S.composed, sceneRequired: r.S.sceneRequired !== false,
    scene: r.scene ? { state: r.scene.state, version: r.scene.version, error: r.scene.error, qa: r.scene.qa || null, preparation: r.scene.preparation || null, attemptId: r.scene.attemptId || null, preview: r.scene.preview ? `/api/runs/${r.id}/scene?v=${encodeURIComponent(r.scene.preview)}` : null } : null,
    cutout: c ? { sha: c.sha || null, state: c.state, error: c.error || null, revision: c.revision || null, stale: cutoutStale, image: c.sha && c.state !== "failed" ? `/api/cutouts/${c.sha}${c.revision ? "?v=" + c.revision : ""}` : null } : null,
    preflight: r.preflight || null,
    driveError: r.driveError || null, saveDrive: r.saveDrive, credits: totals ? totals.committed : r.credits, creditsDetail: totals ? { ...totals, estimate: true } : r.creditsDetail || null, outOfStock: r.S.outOfStock, masterReady: !!r.masterJob,
    attempts: (r.attempts || []).map((a) => ({ id: a.id, kind: a.kind, version: a.version, purpose: a.purpose, state: a.state, jobId: a.jobId, error: a.error, submittedAt: a.submittedAt, resolution: a.resolution || null, retryOf: a.retryOf })),
    items: r.items.map((x) => ({
      kind: x.kind, dims: x.dims, title: x.title, version: x.version, state: x.state, error: x.error, attemptId: x.attemptId || null, composed: !!x.composed, sceneRequired: x.sceneRequired !== false,
      flags: x.flags, blocking: blockingFlags(x), mode: x.mode, at: x.at || null, grid: { x: x.logo.x, y: x.logo.y, where: x.logo.where },
      qa: x.qa, fidelity: x.fidelity || null, held: x.held, drive: x.drive, output: x.output || null,
      override: x.override ? { at: x.override.at, reason: x.override.reason, actor: x.override.actor, version: x.override.version } : null,
      delivery: cutoutStale && x.file ? { status: "held", deliverable: false, reasons: ["The product cutout changed. Re-compose this set to update every size before using it."] } : deliverability(x, { requireFidelity: !!opts.requireFidelity }), rawUrl: /^https:\/\/[^?#]+$/.test(x.url || "") ? x.url : null,
      file: x.file ? `/api/runs/${r.id}/files/${x.file}${x.output && x.output.sha256 ? "?v=" + x.output.sha256 : ""}` : null, fileName: fileName(x),
    })),
  };
}

export function publicBatch(batch, { store, ...opts }) {
  const runs = batch.runIds.map((id) => store.getRun(id)).filter(Boolean).map((r) => publicRun(r, { ...opts, store }));
  const credits = store.creditsForBatch(batch.id);
  return {
    id: batch.id, ts: batch.ts, status: batch.status, count: batch.count, operation: batch.refresh ? "refresh_cutout" : "generate",
    activeRunId: batch.activeRunId, cancelRequested: !!batch.cancelRequested,
    scenePlans: batch.scenePlans, estimatedCredits: batch.estimatedCredits,
    credits: credits.committed, creditsDetail: { ...credits, estimate: true },
    completed: runs.filter((r) => r.status === "done").length,
    failed: runs.filter((r) => ["failed", "partial", "needs_decision"].includes(r.status)).length,
    held: runs.filter((r) => r.items.some((x) => x.file && !x.delivery.deliverable)).length,
    readyFiles: runs.reduce((n, r) => n + r.items.filter((x) => x.file && x.delivery.deliverable).length, 0),
    driveErrors: runs.filter((r) => r.driveError).length,
    error: batch.error, runs,
  };
}

export function createApp({ cfg, store, pipeline, renderer, shopify, llm, drive, warnings = [], readiness = null }) {
  const PR = { requireFidelity: !!cfg.requireFidelity, cutouts: pipeline.cutouts, store };
  const https = cfg.publicUrl.startsWith("https:");
  const publicOrigin = new URL(cfg.publicUrl).origin;
  // __Host- prefix: Secure, Path=/, no Domain — the browser enforces all three.
  const sessionName = https ? "__Host-hlab" : "hlab";
  const sessions = cfg.appPassword ? new Sessions({ store, secret: cfg.sessionSecret, ttlMs: cfg.sessionDays * 24 * 3600 * 1000 }) : null;
  const limiter = new LoginLimiter();
  let startingRun = false; // reserve admission before any provider await (two tabs/double clicks)
  const clientOf = (req) => {
    if (cfg.trustProxy && req.headers["x-forwarded-for"]) return String(req.headers["x-forwarded-for"]).split(",").pop().trim();
    return req.socket.remoteAddress || "?";
  };
  const cookieAttrs = (maxAge) => `; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${https ? "; Secure" : ""}`;

  async function body(req, limit = 1e6) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > limit) throw new HttpError(413, "Request too large."); chunks.push(c); }
    if (!n) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "Invalid JSON."); }
  }
  function send(res, status, obj, headers = {}) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
    res.end(JSON.stringify(obj));
  }
  // The session for this request, or null. Without APP_PASSWORD (development only) everyone is "dev".
  function session(req) { return sessions ? sessions.verify(parseCookies(req.headers.cookie)[sessionName]) : { sid: "dev" }; }
  function cleanForm(f) {
    f = f || {};
    if (f.sceneLayout != null && !["template", "full", "panel", ""].includes(f.sceneLayout)) throw new HttpError(400, "Choose a supported background layout.", "invalid");
    const out = { tpl: TPL[f.tpl] ? f.tpl : "t1" };
    for (const k of FORM_FIELDS) out[k] = typeof f[k] === "string" ? f[k].slice(0, 600) : "";
    return out;
  }
  function cleanPicked(p) {
    p = p || {};
    const chk = checkImageUrl(p.url, { shopifyStore: cfg.shopifyStore });
    const str = (v, n) => String(v == null ? "" : v).slice(0, n);
    return {
      url: chk.ok ? chk.url : "", urlError: chk.ok ? null : chk.error, source: chk.ok ? chk.source : null,
      title: str(p.title, 200), label: str(p.label || p.title, 200), desc: str(p.desc, 4000), outOfStock: !!p.outOfStock,
      productId: str(p.productId, 100), variantId: str(p.variantId, 100), variantTitle: str(p.variantTitle, 200),
      sku: str(p.sku, 100), price: str(p.price, 40), stock: ["in_stock", "out_of_stock", "unknown", "not_tracked"].includes(p.stock) ? p.stock : "unknown",
    };
  }
  function pipelineHttp(e) {
    if (e.code === "stale_cutout") return new HttpError(409, e.message, e.code);
    if (!(e instanceof PipelineError)) return e;
    const status = { already_queued: 409, ambiguous: 409, busy: 409, shutting_down: 503, not_found: 404, credit_cap: 429, credits: 402, batch_integrity: 409 }[e.code] || 400;
    return new HttpError(status, e.message, e.code);
  }
  // Shared team password: the actor is the session, not a person (see the SSO ADR).
  function actorOf(req) { const s = session(req); return s ? "team-session:" + String(s.sid).slice(0, 8) : null; }
  function runOr404(id) { const r = store.getRun(id); if (!r) throw new HttpError(404, "No such set."); return r; }

  const routes = [
    ["POST", /^\/api\/login$/, async (req, res) => {
      if (!sessions) return send(res, 200, { ok: true });
      const who = clientOf(req), t = limiter.take(who); // counted before the password is checked
      if (!t.ok) throw new HttpError(429, "Too many sign-in attempts. Try again in " + Math.ceil(t.retryAfter / 60) + " min.", "rate_limited");
      const b = await body(req);
      const a = crypto.createHash("sha256").update(String(b.password || "")).digest(), p = crypto.createHash("sha256").update(cfg.appPassword).digest();
      if (!crypto.timingSafeEqual(a, p)) { await new Promise((r) => setTimeout(r, 400)); throw new HttpError(401, "Wrong password.", "bad_password"); }
      limiter.success(who);
      const s = sessions.create();
      send(res, 200, { ok: true, expires: s.exp }, { "Set-Cookie": `${sessionName}=${encodeURIComponent(s.token)}${cookieAttrs(Math.floor((s.exp - Date.now()) / 1000))}` });
    }, { open: true }],

    ["POST", /^\/api\/logout$/, async (req, res) => {
      const s = session(req);
      if (sessions && s) sessions.revoke(s.sid);
      send(res, 200, { ok: true }, { "Set-Cookie": `${sessionName}=${cookieAttrs(0)}` });
    }, { open: true }],

    ["GET", /^\/api\/status$/, async (req, res) => {
      let st;
      try { st = await renderer.status(); }
      catch { st = { connected: false, error: "The renderer status is temporarily unavailable. Free previews and graphic layouts still work." }; }
      let balance = null;
      if (st.connected) { try { balance = await renderer.balance(); } catch { balance = null; } }
      send(res, 200, {
        renderer: { name: renderer.name, ...st, authUrl: st.needsAuth ? "/oauth/higgsfield/start" : undefined },
        balance, creditsPerRender: cfg.creditsPerRender, creditsToday: store.creditsToday(), caps: { perRun: cfg.maxCreditsPerRun, perDay: cfg.maxCreditsPerDay },
        shopify: shopify.enabled, llm: llm ? { name: llm.name, draftModel: cfg.llmDraftModel, qaModel: cfg.llmQaModel } : null,
        drive: drive && drive.enabled ? { email: drive.email } : null, warnings, busy: pipeline.busy(),
        composed: Object.keys(TPL).filter((t) => pipeline.isComposed(t)),
      });
    }],

    ["GET", /^\/api\/metrics$/, async (req, res) => {
      const t = store.creditsForDay();
      send(res, 200, { ...pipeline.obs.metrics(), creditsToday: { reserved: t.reserved, spent: t.spent, released: t.released, estimate: true } });
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
        // Anything the model claims that the product data doesn't contain is kept out.
        const g = guardDraft(form, applyDraft(form, o || {}), [p.title, p.desc, p.variantTitle, p.sku].join("\n"));
        send(res, 200, { form: g.form, violations: g.violations });
      } catch (e) { throw new HttpError(502, e.message, e.code); }
    }],

    ["GET", /^\/api\/batches$/, async (req, res) => {
      send(res, 200, { batches: store.listBatches(12).map((b) => publicBatch(b, PR)) });
    }],
    ["POST", /^\/api\/batches$/, async (req, res) => {
      const b = await body(req), form = cleanForm(b.form), picked = cleanPicked(b.picked), count = b.count;
      if (!Number.isInteger(count) || count < 1 || count > 5) throw new HttpError(400, "Choose between 1 and 5 sets.", "invalid");
      if (!pipeline.isComposed(form.tpl)) throw new HttpError(400, "Batch generation requires a composed template.", "invalid");
      if (!pipeline.requiresScene(form) && count > 1) throw new HttpError(400, "This graphic template has no scene. Choose a full or panel photo background for multiple distinct sets.", "invalid");
      if (b.picked && b.picked.url && !picked.url) throw new HttpError(400, picked.urlError, "bad_url");
      const bad = validateForGenerate(form, { hasImage: !!picked.url });
      if (bad.length) throw new HttpError(400, bad[0].title + ". " + bad[0].body, "invalid");
      const requestId = b.requestId == null ? null : b.requestId;
      if (requestId !== null && (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId))) throw new HttpError(400, "Invalid batch request ID.", "invalid");
      const input = { form, picked, saveDrive: b.saveDrive !== false, count };
      const requestFingerprint = fingerprint(input);
      const previous = requestId && store.listBatches(Infinity).find((x) => x.requestId === requestId);
      if (previous) {
        if (previous.requestFingerprint !== requestFingerprint) throw new HttpError(409, "This request ID already belongs to a different batch.", "request_conflict");
        return send(res, 200, { batch: publicBatch(previous, PR) });
      }
      if (startingRun || pipeline.busy()) throw new HttpError(409, "A set or batch is already running. Wait for it to finish.", "busy");
      if (pipeline.shuttingDown) throw new HttpError(503, "The server is restarting. Try again in a minute.", "shutting_down");
      startingRun = true;
      try {
        const need = pipeline.estimate(form, count);
        if (pipeline.estimate(form) > cfg.maxCreditsPerRun || (need > 0 && store.creditsToday() + need > cfg.maxCreditsPerDay)) throw new HttpError(429, "This batch would pass the configured credit cap. Choose fewer sets or wait for the daily cap to reset.", "credit_cap");
        if (need > 0) {
          const st = await renderer.status();
          if (st.needsAuth) throw new HttpError(409, "Sign in to Higgsfield first.", "needs_auth");
          if (!st.connected) throw new HttpError(502, "Higgsfield isn't reachable right now.", "renderer_down");
          let balance;
          try { balance = await renderer.balance(); }
          catch (e) { throw new HttpError(502, "Couldn't check the Higgsfield balance. No batch was started.", "balance_unavailable"); }
          const reserved = store.reservedCredits();
          if (typeof balance === "number" && balance < need + reserved) throw new HttpError(402, `This batch needs about ${need} Higgsfield credits, with ${reserved} reserved for other pending work, and the balance is ${balance}.`, "credits");
        }
        const batch = pipeline.createBatch({ ...input, requestId, requestFingerprint });
        pipeline.startBatch(batch);
        send(res, 201, { batch: publicBatch(batch, PR) });
      } catch (e) { throw pipelineHttp(e); }
      finally { startingRun = false; }
    }],
    ["GET", /^\/api\/batches\/([a-z0-9]+)$/, async (req, res, m) => {
      const b = store.getBatch(m[1]);
      if (!b) throw new HttpError(404, "No such batch.", "not_found");
      send(res, 200, { batch: publicBatch(b, PR), busy: pipeline.busy() });
    }],
    ["POST", /^\/api\/batches\/([a-z0-9]+)\/(resume|cancel)$/, async (req, res, m) => {
      await body(req);
      try { const b = m[2] === "resume" ? pipeline.resumeBatch(m[1]) : pipeline.cancelBatch(m[1]); send(res, 202, { batch: publicBatch(b, PR) }); }
      catch (e) { throw pipelineHttp(e); }
    }],
    ["GET", /^\/api\/batches\/([a-z0-9]+)\/zip$/, async (req, res, m) => {
      const b = store.getBatch(m[1]);
      if (!b) throw new HttpError(404, "No such batch.", "not_found");
      const files = [];
      for (const id of b.runIds) {
        const r = store.getRun(id); if (!r) continue;
        const ready = publicRun(r, PR).items.filter((x) => x.file && x.delivery.deliverable).map((x) => x.kind);
        for (const x of r.items.filter((x) => x.file && ready.includes(x.kind))) files.push({ name: "Set-" + String(r.setNo).padStart(2, "0") + "/" + fileName(x), data: fs.readFileSync(store.filePath(r.id, x.file)) });
      }
      if (!files.length) throw new HttpError(404, "No approved, ready-to-use files yet.");
      res.writeHead(200, { "Content-Type": "application/zip", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="HitLights-batch-${b.id}.zip"` });
      res.end(zip(files));
    }],

    ["GET", /^\/api\/runs$/, async (req, res) => {
      send(res, 200, { runs: store.listRuns(12).map((r) => { const p = publicRun(r, PR); delete p.log; return p; }) });
    }],

    ["POST", /^\/api\/runs$/, async (req, res) => {
      const b = await body(req), form = cleanForm(b.form), picked = cleanPicked(b.picked);
      if (b.picked && b.picked.url && !picked.url) throw new HttpError(400, picked.urlError, "bad_url");
      const bad = validateForGenerate(form, { hasImage: !!picked.url });
      if (bad.length) throw new HttpError(400, bad[0].title + ". " + bad[0].body, "invalid");
      if (startingRun || pipeline.busy()) throw new HttpError(409, "A set is already running. Wait for it to finish.", "busy");
      if (pipeline.shuttingDown) throw new HttpError(503, "The server is restarting. Try again in a minute.", "shutting_down");
      startingRun = true;
      try {
        const need = pipeline.estimate(form);
        if (need > 0) {
          const st = await renderer.status();
          if (st.needsAuth) throw new HttpError(409, "Sign in to Higgsfield first (see the banner at the top).", "needs_auth");
          if (!st.connected) throw new HttpError(502, "Higgsfield isn't reachable right now. " + (st.error || ""), "renderer_down");
          let bal = null; try { bal = await renderer.balance(); } catch { bal = null; }
          const reserved = store.reservedCredits();
          if (bal != null && bal < need + reserved) throw new HttpError(402, `A set needs ${need} Higgsfield credits, with ${reserved} reserved for other pending work, and the balance is ${bal}. Top up Higgsfield, then generate again.`, "credits");
          if (store.creditsToday() + need > cfg.maxCreditsPerDay || need > cfg.maxCreditsPerRun) throw new HttpError(429, "This set would pass the configured credit cap.", "credit_cap");
        }
        if (pipeline.busy()) throw new HttpError(409, "A set is already running. Wait for it to finish.", "busy");
        if (pipeline.shuttingDown) throw new HttpError(503, "The server is restarting. Try again in a minute.", "shutting_down");
        const run = pipeline.start(pipeline.create({ form, picked, saveDrive: b.saveDrive !== false }));
        send(res, 201, { run: publicRun(run, PR) });
      } finally { startingRun = false; }
    }],

    ["GET", /^\/api\/runs\/([a-z0-9]+)$/, async (req, res, m) => { send(res, 200, { run: publicRun(runOr404(m[1]), PR), busy: pipeline.busy() }); }],

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
        else r = pipeline.saveToDrive(id, kind);
        send(res, 202, { run: publicRun(r, PR) });
      } catch (e) { throw pipelineHttp(e); }
    }],

    ["GET", /^\/api\/runs\/([a-z0-9]+)\/attempts\/([a-z0-9]+)\/candidates$/, async (req, res, m) => {
      runOr404(m[1]);
      try { send(res, 200, await pipeline.candidates(m[1], m[2])); }
      catch (e) { if (e instanceof PipelineError) throw pipelineHttp(e); throw new HttpError(502, "Couldn't search Higgsfield's history: " + e.message); }
    }],

    // "Save anyway": explicit confirmation + reason, recorded on the item and the run.
    ["POST", /^\/api\/runs\/([a-z0-9]+)\/items\/(master|portrait|landscape)\/override$/, async (req, res, m) => {
      const b = await body(req); runOr404(m[1]);
      if (b.confirm !== true) throw new HttpError(400, "Confirm the override first.", "confirm");
      try { send(res, 202, { run: publicRun(pipeline.override(m[1], m[2], { reason: b.reason, actor: actorOf(req) }), PR) }); }
      catch (e) { throw pipelineHttp(e); }
    }],

    ["POST", /^\/api\/runs\/([a-z0-9]+)\/items\/(master|portrait|landscape)\/approve-fidelity$/, async (req, res, m) => {
      const b = await body(req); runOr404(m[1]);
      if (b.confirm !== true) throw new HttpError(400, "Confirm you compared it with the product photo.", "confirm");
      try { send(res, 202, { run: publicRun(pipeline.approveFidelity(m[1], m[2], { note: b.note, actor: actorOf(req) }), PR) }); }
      catch (e) { throw pipelineHttp(e); }
    }],

    // A person's decision on an ambiguous paid submission. Recorded on the attempt.
    ["POST", /^\/api\/runs\/([a-z0-9]+)\/attempts\/([a-z0-9]+)\/resolve$/, async (req, res, m) => {
      const b = await body(req); runOr404(m[1]);
      if (!["adopt", "retry", "skip"].includes(b.action)) throw new HttpError(400, "Choose adopt, retry or skip.");
      if (b.action !== "adopt" && b.confirm !== true) throw new HttpError(400, "Confirm the decision first.", "confirm");
      try { send(res, 202, { run: publicRun(pipeline.resolve(m[1], m[2], { action: b.action, jobId: b.jobId, charged: !!b.charged, actor: actorOf(req) }), PR) }); }
      catch (e) { throw pipelineHttp(e); }
    }],

    ["GET", /^\/api\/runs\/([a-z0-9]+)\/files\/([A-Za-z0-9._-]+)$/, async (req, res, m, url) => {
      const r = runOr404(m[1]); const x = r.items.find((i) => i.file === m[2]);
      if (!x) throw new HttpError(404, "No such file.");
      const data = fs.readFileSync(store.filePath(r.id, x.file));
      const h = { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" };
      if (url.searchParams.get("dl")) h["Content-Disposition"] = `attachment; filename="${fileName(x)}"`;
      res.writeHead(200, h); res.end(data);
    }],

    // ---- composed templates: free preview, product cutouts, scene photo ----
    ["POST", /^\/api\/preview$/, async (req, res) => {
      const b = await body(req), form = cleanForm(b.form), picked = cleanPicked(b.picked);
      if (b.picked && b.picked.url && !picked.url) throw new HttpError(400, picked.urlError, "bad_url");
      try { send(res, 200, await pipeline.preview({ form, picked })); }
      catch (e) { throw pipelineHttp(e); }
    }],

    ["GET", /^\/api\/cutouts\/([0-9a-f]{64})$/, async (req, res, m, url) => {
      const c = pipeline.cutouts.get(m[1]);
      if (!c) throw new HttpError(404, "No such cutout.");
      if (url.searchParams.has("v") && url.searchParams.get("v") !== c.revision) throw new HttpError(409, "The cutout changed. Refresh the preview.", "stale_cutout");
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "private, no-store" });
      res.end(fs.readFileSync(pipeline.cutouts.png(m[1])));
    }],

    ["GET", /^\/api\/cutouts\/([0-9a-f]{64})\/photo$/, async (req, res, m) => {
      let buf;
      try { buf = fs.readFileSync(pipeline.cutouts.photo(m[1])); } catch { throw new HttpError(404, "No photo for that cutout."); }
      const type = sniffImage(buf);
      if (!type) throw new HttpError(404, "No photo for that cutout.");
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "private, max-age=3600" });
      res.end(buf);
    }],

    ["POST", /^\/api\/cutouts\/([0-9a-f]{64})\/approve$/, async (req, res, m) => {
      const b = await body(req);
      if (b.confirm !== true) throw new HttpError(400, "Confirm you compared the cutout with the product photo.", "confirm");
      if (!pipeline.cutouts.get(m[1])) throw new HttpError(404, "No such cutout.");
      if (b.runId) {
        const r = runOr404(b.runId);
        if (!r.cutout || r.cutout.sha !== m[1]) throw new HttpError(400, "That cutout doesn't belong to this set.");
      }
      if (!/^[0-9a-f]{64}$/.test(b.revision || "")) throw new HttpError(409, "Refresh the preview before approving this cutout.", "stale_cutout");
      try {
        const run = b.runId ? publicRun(await pipeline.approveCutout(b.runId, { actor: actorOf(req), revision: b.revision }), PR) : null;
        const c = b.runId ? pipeline.cutouts.get(m[1]) : await pipeline.cutouts.approve(m[1], actorOf(req), b.revision);
        send(res, 200, { cutout: { sha: c.sha, state: c.state, revision: c.revision }, run });
      } catch (e) { throw pipelineHttp(e); }
    }],

    // A person's own cutout: {png: base64} of a PNG with a transparent background.
    ["POST", /^\/api\/cutouts\/([0-9a-f]{64})\/upload$/, async (req, res, m) => {
      const b = await body(req, 16e6);
      const png = Buffer.from(String(b.png || ""), "base64");
      if (!png.length) throw new HttpError(400, "No image received.");
      if (b.runId) {
        const r = runOr404(b.runId);
        if (!r.cutout || r.cutout.sha !== m[1]) throw new HttpError(400, "That cutout doesn't belong to this set.");
        try { send(res, 200, { run: publicRun(await pipeline.uploadCutout(b.runId, png, { actor: actorOf(req) }), PR) }); }
        catch (e) { throw pipelineHttp(e); }
        return;
      }
      try { const c = await pipeline.cutouts.upload(m[1], png, { python: cfg.python, actor: actorOf(req) }); send(res, 200, { cutout: { sha: c.sha, state: c.state, revision: c.revision } }); }
      catch (e) { throw new HttpError(400, e.message); }
    }],

    ["GET", /^\/api\/runs\/([a-z0-9]+)\/scene$/, async (req, res, m) => {
      const r = runOr404(m[1]);
      if (!r.scene || !r.scene.preview) throw new HttpError(404, "No scene photo yet.");
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" });
      res.end(fs.readFileSync(store.filePath(r.id, r.scene.preview)));
    }],

    ["POST", /^\/api\/runs\/([a-z0-9]+)\/scene\/approve$/, async (req, res, m) => {
      const b = await body(req); runOr404(m[1]);
      if (b.confirm !== true) throw new HttpError(400, "Confirm you looked at the scene photo.", "confirm");
      try { send(res, 202, { run: publicRun(pipeline.approveScene(m[1], { note: b.note, actor: actorOf(req) }), PR) }); }
      catch (e) { throw pipelineHttp(e); }
    }],

    ["GET", /^\/api\/runs\/([a-z0-9]+)\/source$/, async (req, res, m) => {
      const r = runOr404(m[1]), src = r.S.source || {};
      if (!src.file) throw new HttpError(404, "No copy of the product photo.");
      res.writeHead(200, { "Content-Type": /^image\/(jpeg|png|webp|gif)$/.test(src.contentType || "") ? src.contentType : "application/octet-stream", "Cache-Control": "private, max-age=3600" });
      res.end(fs.readFileSync(store.filePath(r.id, src.file)));
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
      if (!renderer.beginAuth) throw new HttpError(400, "This renderer has no sign-in.");
      const url = await renderer.beginAuth(session(req).sid);
      if (!url) { res.writeHead(302, { Location: "/" }); return res.end(); } // already connected
      res.writeHead(302, { Location: url }); res.end();
    }],

    ["GET", /^\/oauth\/higgsfield\/callback$/, async (req, res, m, url) => {
      const code = url.searchParams.get("code"), state = url.searchParams.get("state");
      if (!code) throw new HttpError(400, "Higgsfield sign-in was cancelled: " + String(url.searchParams.get("error") || "no code").slice(0, 100));
      try { await renderer.finishAuth(code, state, session(req).sid); }
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
    let url;
    try { url = new URL(req.url, "http://x"); } catch { res.writeHead(400); return res.end(); }
    securityHeaders(res, { https, reference: url.pathname === "/reference" });
    try {
      if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
      if (req.method === "GET" && url.pathname === "/readyz") {
        const r = readiness ? await readiness() : { ok: true };
        return send(res, r.ok ? 200 : 503, r);
      }
      if (req.method === "GET" && serveStatic(req, res, url.pathname)) return;
      for (const [method, re, fn, opt] of routes) {
        const m = url.pathname.match(re);
        if (!m || req.method !== method) continue;
        // CSRF: every state-changing request must come from this app's own pages.
        if (method !== "GET" && !originOk(req, publicOrigin)) throw new HttpError(403, "Cross-site request refused.", "origin");
        if (!(opt && opt.open) && !session(req)) throw new HttpError(401, "Sign in first.", "login");
        return await fn(req, res, m, url);
      }
      throw new HttpError(404, "Not found.");
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(JSON.stringify({ level: "error", event: "http_error", method: req.method, path: url.pathname, code: e.code || null, message: String(e.message || e).slice(0, 300) }));
      // 5xx without an HttpError are internal: never echo their message (paths, tokens) to the page.
      const message = e instanceof HttpError ? e.message : "Something went wrong on the server. Try again.";
      if (!res.headersSent) send(res, status, { error: message, code: e.code || (status === 401 ? "login" : "error") });
      else res.end();
    }
  };
}

// Social / banner / email studio: server side. A separate tool beside the Meta ad builder.
// - Never charges credits: no Higgsfield call, no attempt ledger, no batch queue.
// - Uses its own Chromium instance (closed when idle), so it never waits on or blocks ad sets.
// - Reads, but never changes, ad-builder state: the shared product-cutout store (approve a product
//   photo once, use it in both tools) and existing scene photos from recent ad sets.
// - Keeps its renders under DATA_DIR/channels/<id>/ and prunes them after a week.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Composer } from "../composer/render.mjs";
import { buildChannelHtml, channelPageScript, glyphProblems, CHANNEL_FONT_WEIGHTS } from "../composer/channel-page.mjs";
import { CHANNELS, BACKGROUNDS, formatFor, safeArea, cleanChannelFields, checkChannelFields, channelDraftBrief, CHANNEL_DRAFT_SCHEMA, CHANNEL_DRAFT_KEYS, FIELD_LABELS } from "../core/channels.mjs";
import { factViolations } from "../core/facts.mjs";
import { sniffImage } from "./providers/llm.mjs";
import { cutoutApproved } from "./compose.mjs";
import { checkImageUrl } from "./security.mjs";

const ID = /^[a-f0-9]{16}$/;
const KEEP_MS = 7 * 24 * 3600 * 1000;
const IDLE_MS = 3 * 60 * 1000;
const dataUri = (buf, type) => "data:" + type + ";base64," + Buffer.from(buf).toString("base64");
export class ChannelError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

export class ChannelStudio {
  // cutouts / fetchSource: the ad builder's (read-only use). launch: tests can inject a browser.
  constructor({ cfg, store, cutouts, fetchSource, launch } = {}) {
    Object.assign(this, { cfg, store, cutouts, fetchSource });
    this.dir = path.join(cfg.dataDir, "channels");
    this.browserHost = new Composer({ launch }); // only its browser launcher is used
    this.chain = Promise.resolve();
    this.idle = null;
  }

  async browser() {
    clearTimeout(this.idle);
    return this.browserHost.ensure();
  }
  scheduleClose() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => { this.browserHost.close().catch(() => {}); }, IDLE_MS);
    this.idle.unref?.();
  }
  async close() { clearTimeout(this.idle); await this.browserHost.close(); }

  // One render at a time (each is ~1 s); returns {buf, report, quality}.
  renderOne(spec, images, budget) {
    const run = async () => {
      const f = spec.format, b = await this.browser();
      const page = await b.newPage({ viewport: { width: f.W, height: f.H }, deviceScaleFactor: 1 });
      try {
        await page.setContent(buildChannelHtml(spec, images), { waitUntil: "load", timeout: 30000 });
        await page.evaluate((ws) => Promise.all(ws.map((w) => document.fonts.load(w + ' 20px "HLMontserrat"'))), CHANNEL_FONT_WEIGHTS);
        await page.evaluate(() => document.fonts.ready);
        const report = await page.evaluate(channelPageScript, { safe: safeArea(f), names: FIELD_LABELS, minProduct: Math.min(f.W, f.H) * 0.12 });
        let q = 90, buf;
        for (;;) {
          buf = await page.screenshot({ type: "jpeg", quality: q, clip: { x: 0, y: 0, width: f.W, height: f.H }, animations: "disabled" });
          if (buf.length <= budget || q <= 50) break;
          q -= 8;
        }
        if (buf.length > budget) report.errors.push({ code: "SIZE", message: `The file is ${Math.round(buf.length / 1000)} KB, over the ${Math.round(budget / 1000)} KB target for this channel.` });
        report.ok = !report.errors.length;
        return { buf, report, quality: q };
      } finally { await page.close().catch(() => {}); }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  // Scenes already rendered (and paid for) by ad sets, offered as free photo backgrounds.
  scenes(limit = 24) {
    const out = [];
    for (const r of this.store.listRuns(60)) {
      if (!r.scene || !r.scene.preview) continue;
      try { if (!fs.existsSync(this.store.filePath(r.id, r.scene.preview))) continue; } catch { continue; }
      out.push({ runId: r.id, product: r.S && r.S.product, tplName: r.S && r.S.tplName, ts: r.ts, url: `/api/runs/${r.id}/scene?v=${encodeURIComponent(r.scene.preview)}` });
      if (out.length >= limit) break;
    }
    return out;
  }

  async productCutout(url) {
    const dir = path.join(this.cfg.dataDir, "preview"); fs.mkdirSync(dir, { recursive: true });
    const src = path.join(dir, "ch-" + crypto.randomBytes(8).toString("hex") + ".img");
    try {
      try { await this.fetchSource(url, src); }
      catch (e) { throw new ChannelError(400, "Couldn't download the product photo: " + e.message, "bad_url"); }
      return await this.cutouts.ensure(src, { python: this.cfg.python, model: this.cfg.cutoutModel, snapshot: true });
    } finally { try { fs.unlinkSync(src); } catch { /* none */ } }
  }

  async photoBackground(bg) {
    if (bg.sceneRunId) {
      const r = this.store.getRun(String(bg.sceneRunId));
      if (!r || !r.scene || !r.scene.preview) throw new ChannelError(400, "That scene photo isn't available any more.", "bad_scene");
      const buf = fs.readFileSync(this.store.filePath(r.id, r.scene.preview));
      return dataUri(buf, sniffImage(buf) || "image/jpeg");
    }
    if (bg.upload) {
      const buf = Buffer.from(String(bg.upload), "base64");
      const type = sniffImage(buf);
      if (!buf.length || !["image/jpeg", "image/png", "image/webp"].includes(type)) throw new ChannelError(400, "Upload a JPEG, PNG or WebP photo for the background.", "bad_image");
      return dataUri(buf, type);
    }
    if (bg.url) {
      const dir = path.join(this.cfg.dataDir, "preview"); fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, "chbg-" + crypto.randomBytes(8).toString("hex") + ".img");
      try {
        try { await this.fetchSource(bg.url, f); }
        catch (e) { throw new ChannelError(400, "Couldn't download the background photo: " + e.message, "bad_url"); }
        const buf = fs.readFileSync(f), type = sniffImage(buf);
        if (!["image/jpeg", "image/png", "image/webp"].includes(type)) throw new ChannelError(400, "The background must be a JPEG, PNG or WebP photo.", "bad_image");
        return dataUri(buf, type);
      } finally { try { fs.unlinkSync(f); } catch { /* none */ } }
    }
    throw new ChannelError(400, "Choose a background photo: upload one or pick a scene from a recent ad set.", "no_photo");
  }

  prune(now = Date.now()) {
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { return; }
    for (const n of names) {
      if (!ID.test(n)) continue;
      try { const m = JSON.parse(fs.readFileSync(path.join(this.dir, n, "meta.json"), "utf8")); if (now - m.ts > KEEP_MS) fs.rmSync(path.join(this.dir, n), { recursive: true, force: true }); }
      catch { /* half-written or foreign: leave it */ }
    }
  }

  // req: {channel, style, formats[], fields, background:{kind, sceneRunId?, upload?, url?}, picked?:{url,title}, showProduct}
  async render(req, { actor } = {}) {
    const channel = CHANNELS[req.channel] ? req.channel : null;
    if (!channel) throw new ChannelError(400, "Choose social, banner or email.", "invalid");
    const C = CHANNELS[channel];
    const style = C.styles.some((s) => s.id === req.style) ? req.style : "product";
    const ids = Array.isArray(req.formats) ? [...new Set(req.formats.map(String))] : [];
    const formats = ids.map((id) => formatFor(channel, id)).filter(Boolean);
    if (!formats.length) throw new ChannelError(400, "Pick at least one size.", "invalid");
    const fields = cleanChannelFields(req.fields);
    const bad = [...checkChannelFields(fields, { style }), ...glyphProblems(fields)];
    if (bad.length) throw new ChannelError(400, bad.map((b) => b.message).join(" "), "invalid");
    const background = BACKGROUNDS[req.background && req.background.kind] ? req.background.kind : "violet";

    const wantsProduct = req.showProduct !== false;
    let cutout = null, product = null;
    if (wantsProduct && req.picked && req.picked.url) {
      const chk = checkImageUrl(req.picked.url, { shopifyStore: this.cfg.shopifyStore });
      if (!chk.ok) throw new ChannelError(400, chk.error, "bad_url");
      const c = await this.productCutout(chk.url);
      cutout = { sha: c.sha, state: c.state, error: c.error || null, revision: c.revision || null };
      if (c.state !== "failed") product = dataUri(c.png, "image/png");
    }
    const photo = background === "photo" ? await this.photoBackground(req.background || {}) : null;

    const id = crypto.randomBytes(8).toString("hex"), dir = path.join(this.dir, id);
    fs.mkdirSync(dir, { recursive: true });
    const files = [];
    try {
      for (const f of formats) {
        const spec = { format: f, style, background, fields, showProduct: !!product };
        const { buf, report, quality } = await this.renderOne(spec, { product, photo }, C.budget);
        const name = `HitLights-${channel}-${f.id}-${f.W}x${f.H}.jpg`;
        fs.writeFileSync(path.join(dir, name), buf);
        files.push({ format: f.id, title: f.name, W: f.W, H: f.H, name, bytes: buf.length, quality, ok: report.ok, problems: report.errors.map((e) => e.message) });
      }
    } finally { this.scheduleClose(); }
    const meta = { id, ts: Date.now(), actor: actor || null, channel, style, background, fields, product: req.picked ? String(req.picked.title || "").slice(0, 200) : "", cutoutSha: product ? cutout.sha : null, files };
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
    try { this.prune(); } catch { /* best effort */ }
    return this.publicSet(meta, cutout);
  }

  get(id) {
    if (!ID.test(String(id))) return null;
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, id, "meta.json"), "utf8")); } catch { return null; }
  }
  // Files are ready only when their layout check passed and any product cutout is approved.
  readiness(meta) {
    const c = meta.cutoutSha ? this.cutouts.get(meta.cutoutSha) : null;
    const cutoutOk = !meta.cutoutSha || cutoutApproved(c);
    return { cutout: c, cutoutOk };
  }
  publicSet(meta, cutoutInfo) {
    const { cutout, cutoutOk } = this.readiness(meta);
    const c = cutout || cutoutInfo;
    return {
      id: meta.id, ts: meta.ts, channel: meta.channel, style: meta.style, background: meta.background, product: meta.product,
      cutout: c ? { sha: c.sha, state: c.state, error: c.error || null, revision: c.revision || null, approved: cutoutApproved(c), image: c.sha && c.state !== "failed" ? `/api/cutouts/${c.sha}${c.revision ? "?v=" + c.revision : ""}` : null, photo: c.sha ? `/api/cutouts/${c.sha}/photo` : null } : (cutoutInfo || null),
      files: meta.files.map((x) => {
        const reasons = [...x.problems];
        if (!cutoutOk) reasons.push("Approve the product cutout first.");
        return { ...x, ready: !reasons.length, reasons, url: `/api/channels/${meta.id}/files/${encodeURIComponent(x.name)}` };
      }),
    };
  }
  file(id, name) {
    const meta = this.get(id);
    if (!meta) throw new ChannelError(404, "No such set.", "not_found");
    const x = meta.files.find((f) => f.name === name);
    if (!x) throw new ChannelError(404, "No such file.", "not_found");
    const pub = this.publicSet(meta).files.find((f) => f.name === name);
    return { buf: fs.readFileSync(path.join(this.dir, meta.id, x.name)), ready: pub.ready, reasons: pub.reasons };
  }
  readyFiles(id) {
    const meta = this.get(id);
    if (!meta) throw new ChannelError(404, "No such set.", "not_found");
    return this.publicSet(meta).files.filter((f) => f.ready).map((f) => ({ name: f.name, data: fs.readFileSync(path.join(this.dir, meta.id, f.name)) }));
  }
}

// Draft copy with the language model, then remove anything the product data doesn't support.
export async function draftChannelCopy(llm, cfg, { channel, style, picked, angle, current }) {
  if (!CHANNELS[channel]) throw new ChannelError(400, "Choose social, banner or email.", "invalid");
  const product = picked && (picked.title || picked.desc) ? { title: String(picked.title || "").slice(0, 200), desc: String(picked.desc || "").slice(0, 4000) } : null;
  const o = await llm.json({ prompt: channelDraftBrief(channel, style, product, String(angle || "").slice(0, 300)), schema: CHANNEL_DRAFT_SCHEMA, model: cfg.llmDraftModel });
  const out = {};
  for (const k of CHANNEL_DRAFT_KEYS) out[k] = typeof (o || {})[k] === "string" ? o[k].replace(/\s+/g, " ").trim().slice(0, k === "caption" ? 600 : 200) : "";
  out.offer = (current && current.offer) || ""; // offers are never drafted
  const source = product ? [product.title, product.desc, picked.variantTitle, picked.sku].join("\n") : "HitLights LED lighting";
  const checked = {}; for (const k of CHANNEL_DRAFT_KEYS) if (k !== "offer" && k !== "hashtags") checked[k] = out[k];
  const violations = factViolations(checked, source);
  for (const v of violations) out[v.field] = (current && typeof current[v.field] === "string") ? current[v.field] : "";
  return { draft: out, violations };
}

// Routes for createApp. Helpers come from the app so auth, CSRF, limits and errors behave the same.
export function channelRoutes({ studio, llm, cfg, body, send, HttpError, actorOf, zip }) {
  const wrap = (e) => (e instanceof ChannelError ? new HttpError(e.status, e.message, e.code) : e);
  return [
    ["GET", /^\/api\/channels\/scenes$/, async (req, res) => { send(res, 200, { scenes: studio.scenes() }); }],
    ["POST", /^\/api\/channels\/render$/, async (req, res) => {
      const b = await body(req, 20e6);
      try { send(res, 200, { set: await studio.render(b, { actor: actorOf(req) }) }); }
      catch (e) { throw wrap(e); }
    }],
    ["GET", /^\/api\/channels\/([a-f0-9]{16})$/, async (req, res, m) => {
      const meta = studio.get(m[1]); if (!meta) throw new HttpError(404, "No such set.", "not_found");
      send(res, 200, { set: studio.publicSet(meta) });
    }],
    ["POST", /^\/api\/channels\/draft$/, async (req, res) => {
      if (!llm) throw new HttpError(400, "Drafting is off: no language model is configured.", "no_llm");
      const b = await body(req);
      try { send(res, 200, await draftChannelCopy(llm, cfg, b)); }
      catch (e) { if (e instanceof ChannelError) throw wrap(e); throw new HttpError(502, e.message, e.code); }
    }],
    ["GET", /^\/api\/channels\/([a-f0-9]{16})\/files\/([A-Za-z0-9._-]+)$/, async (req, res, m, url) => {
      let f; try { f = studio.file(m[1], m[2]); } catch (e) { throw wrap(e); }
      const dl = url.searchParams.get("dl");
      if (dl && !f.ready) throw new HttpError(409, "Not ready to download: " + f.reasons.join(" "), "held");
      const h = { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" };
      if (dl) h["Content-Disposition"] = `attachment; filename="${m[2]}"`;
      res.writeHead(200, h); res.end(f.buf);
    }],
    ["GET", /^\/api\/channels\/([a-f0-9]{16})\/zip$/, async (req, res, m) => {
      let files; try { files = studio.readyFiles(m[1]); } catch (e) { throw wrap(e); }
      if (!files.length) throw new HttpError(409, "No ready files yet: approve the product cutout and fix any layout problems.", "held");
      res.writeHead(200, { "Content-Type": "application/zip", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="HitLights-${m[1]}.zip"` });
      res.end(zip(files));
    }],
  ];
}

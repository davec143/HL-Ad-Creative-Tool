// Social / banner / email studio (the second tab). Layout coverage for every channel, style and
// size; the API's auth, holding rules and file delivery; and the drafting fact guard.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createApp } from "../server/app.mjs";
import { Store } from "../server/store.mjs";
import { Pipeline } from "../server/pipeline.mjs";
import { FakeRenderer } from "../server/render/fake.mjs";
import { readConfig, ROOT } from "../server/config.mjs";
import { ChannelStudio, draftChannelCopy } from "../server/channels.mjs";
import { CHANNELS, CHANNEL_SAMPLE, safeArea, modeFor, checkChannelFields } from "../core/channels.mjs";

const PY = process.env.PYTHON || (fs.existsSync(path.join(ROOT, ".venv/bin/python")) ? path.join(ROOT, ".venv/bin/python") : "python3");
const PRODUCT = fs.readFileSync(path.join(ROOT, "assets", "logos", "hitlights-mark.png"));
const productUri = "data:image/png;base64," + PRODUCT.toString("base64");
const jpegSize = (b) => { for (let i = 2; i < b.length;) { const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return { H: b.readUInt16BE(i + 5), W: b.readUInt16BE(i + 7) }; i += 2 + len; } return null; };

// A cutout store stand-in: one "auto" cutout that a person can approve.
function fakeCutouts() {
  const sha = crypto.createHash("sha256").update(PRODUCT).digest("hex");
  const c = { sha, state: "auto", revision: "r".repeat(64) };
  return { c, get: () => ({ ...c }), ensure: async () => ({ ...c, png: PRODUCT }), approve() { c.state = "approved"; } };
}

test("every channel, style and size lays out the sample copy inside its safe area", { timeout: 300000 }, async () => {
  const studio = new ChannelStudio({ cfg: { dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "hlch-")) } });
  try {
    for (const [ch, C] of Object.entries(CHANNELS)) for (const s of C.styles) for (const f of C.formats) {
      const fields = { ...CHANNEL_SAMPLE[ch], offer: s.id === "promo" ? "Save 15%" : "" };
      const r = await studio.renderOne({ format: f, style: s.id, background: ch === "email" ? "cream" : "violet", fields, showProduct: true }, { product: productUri, photo: null }, C.budget);
      assert.ok(r.report.ok, `${ch}/${s.id}/${f.id}: ${r.report.errors.map((e) => e.message).join(" ")}`);
      assert.deepEqual(jpegSize(r.buf), { W: f.W, H: f.H }, `${ch}/${f.id} exact pixel size`);
      assert.ok(r.buf.length <= C.budget, `${ch}/${f.id} within the channel's file-size target`);
    }
  } finally { await studio.close(); }
});

test("copy that can't fit is reported with the field to shorten, never silently cut", async () => {
  const studio = new ChannelStudio({ cfg: { dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "hlch-")) } });
  try {
    const f = CHANNELS.banner.formats.find((x) => x.id === "promo-strip");
    const long = "Light every shelf cove and cabinet in the whole house tonight with no electrician needed at all";
    const r = await studio.renderOne({ format: f, style: "product", background: "violet", fields: { ...CHANNEL_SAMPLE.banner, headline: long }, showProduct: false }, { product: null, photo: null }, 600000);
    assert.equal(r.report.ok, false);
    assert.match(r.report.errors[0].message, /shorten .*Headline/);
  } finally { await studio.close(); }
});

test("platform safe areas and layout families", () => {
  const story = CHANNELS.social.formats.find((f) => f.id === "story");
  assert.ok(safeArea(story).y >= 250 && safeArea(story).y + safeArea(story).h <= 1920 - 340, "story keeps the app UI zones clear");
  const yt = CHANNELS.banner.formats.find((f) => f.id === "yt-banner");
  assert.deepEqual(safeArea(yt), { x: 507, y: 509, w: 1546, h: 423 });
  assert.equal(modeFor(CHANNELS.email.formats.find((f) => f.id === "email-header")), "strip");
  assert.equal(modeFor(CHANNELS.social.formats.find((f) => f.id === "feed-portrait")), "tall");
  assert.equal(modeFor(CHANNELS.banner.formats.find((f) => f.id === "web-hero")), "wide");
  assert.deepEqual(checkChannelFields({ headline: "", offer: "" }, { style: "promo" }).map((p) => p.field), ["headline", "offer"]);
});

async function boot(env = {}, over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hlch-app-"));
  const cfg = readConfig({ DATA_DIR: dir, PYTHON: PY, COMPOSED_TEMPLATES: "", ...env });
  const store = new Store(dir);
  const renderer = new FakeRenderer({ store, python: PY });
  const pipeline = new Pipeline({ cfg, store, renderer, llm: null, drive: null, log: { error() {} } });
  const cutouts = fakeCutouts();
  const channels = new ChannelStudio({ cfg, store, cutouts, fetchSource: async (url, dest) => { fs.writeFileSync(dest, PRODUCT); return { file: dest }; } });
  const shopify = { enabled: false, search: async () => { throw Object.assign(new Error("off"), { code: "not_configured" }); } };
  const server = http.createServer(createApp({ cfg, store, pipeline, renderer, shopify, llm: over.llm || null, drive: null, channels }));
  await new Promise((r) => server.listen(0, r));
  const base = "http://127.0.0.1:" + server.address().port;
  const req = async (p, opts = {}) => {
    const origin = opts.method && opts.method !== "GET" ? { origin: new URL(cfg.publicUrl).origin } : {};
    const r = await fetch(base + p, { redirect: "manual", ...opts, headers: { "content-type": "application/json", ...origin, ...(opts.headers || {}) }, body: opts.body && JSON.stringify(opts.body) });
    const ct = r.headers.get("content-type") || "";
    return { status: r.status, headers: r.headers, json: ct.includes("json") ? await r.json() : null, buf: ct.includes("json") ? null : Buffer.from(await r.arrayBuffer()) };
  };
  return { cfg, store, pipeline, cutouts, channels, req, close: async () => { await channels.close(); await new Promise((r) => server.close(r)); } };
}

test("studio API is behind the same sign-in and cross-site checks as the ad builder", async () => {
  const a = await boot({ APP_PASSWORD: "hunter2pass", SESSION_SECRET: "s".repeat(40) });
  try {
    assert.equal((await a.req("/api/channels/scenes")).status, 401);
    assert.equal((await a.req("/api/channels/render", { method: "POST", body: {} })).status, 401);
    const r = await a.req("/api/channels/render", { method: "POST", body: {}, headers: { origin: "https://evil.example" } });
    assert.equal(r.status, 403);
    assert.equal((await a.req("/channels.js")).status, 200, "page script is public like app.js");
    assert.equal((await a.req("/core/channels.mjs")).status, 200);
  } finally { await a.close(); }
});

test("render: files are held until the shared product cutout is approved, then download and zip", { timeout: 120000 }, async () => {
  const a = await boot();
  try {
    const bad = await a.req("/api/channels/render", { method: "POST", body: { channel: "social", formats: [], fields: CHANNEL_SAMPLE.social } });
    assert.equal(bad.status, 400);
    const r = await a.req("/api/channels/render", { method: "POST", body: {
      channel: "social", style: "product", formats: ["feed-square", "story"], fields: CHANNEL_SAMPLE.social,
      background: { kind: "night" }, picked: { url: "https://cdn.shopify.com/p.jpg", title: "EZDim" },
    } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const set = r.json.set;
    assert.equal(set.files.length, 2);
    assert.equal(set.cutout.approved, false);
    assert.ok(set.files.every((f) => !f.ready && f.reasons.some((x) => /cutout/.test(x))));
    // The preview image is viewable; the download and zip are refused while held.
    assert.equal((await a.req(set.files[0].url)).status, 200);
    assert.equal((await a.req(set.files[0].url + "?dl=1")).status, 409);
    assert.equal((await a.req(`/api/channels/${set.id}/zip`)).status, 409);
    a.cutouts.approve();
    const after = (await a.req(`/api/channels/${set.id}`)).json.set;
    assert.ok(after.files.every((f) => f.ready), JSON.stringify(after.files));
    const dl = await a.req(after.files[1].url + "?dl=1");
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get("content-disposition"), /attachment; filename="HitLights-social-story-1080x1920\.jpg"/);
    assert.deepEqual(jpegSize(dl.buf), { W: 1080, H: 1920 });
    const z = await a.req(`/api/channels/${set.id}/zip`);
    assert.equal(z.status, 200);
    assert.equal(z.buf.readUInt32LE(0), 0x04034b50);
    // No ad-builder state was created or touched.
    assert.equal(a.store.listRuns(10).length, 0);
    assert.equal(a.store.listBatches(10).length, 0);
    assert.equal(a.store.creditsToday(), 0);
  } finally { await a.close(); }
});

test("render without a product needs no approval; photo background accepts an upload only as an image", { timeout: 120000 }, async () => {
  const a = await boot();
  try {
    const r = await a.req("/api/channels/render", { method: "POST", body: { channel: "email", style: "text", formats: ["email-header"], fields: CHANNEL_SAMPLE.email, background: { kind: "violet" } } });
    assert.equal(r.status, 200);
    assert.ok(r.json.set.files[0].ready, JSON.stringify(r.json.set.files[0]));
    const notImage = await a.req("/api/channels/render", { method: "POST", body: { channel: "email", style: "text", formats: ["email-header"], fields: CHANNEL_SAMPLE.email, background: { kind: "photo", upload: Buffer.from("hello").toString("base64") } } });
    assert.equal(notImage.status, 400);
    const noPhoto = await a.req("/api/channels/render", { method: "POST", body: { channel: "email", style: "text", formats: ["email-header"], fields: CHANNEL_SAMPLE.email, background: { kind: "photo" } } });
    assert.equal(noPhoto.status, 400);
    assert.equal((await a.req("/api/channels/0123456789abcdef/files/x.jpg")).status, 404);
    assert.equal((await a.req("/api/channels/../../etc/files/passwd")).status, 404);
  } finally { await a.close(); }
});

test("drafting: invented figures and offers are kept out; the offer is never drafted", async () => {
  const llm = { json: async () => ({ eyebrow: "New", headline: "Save 40% today", headline2: "", sub: "Lasts 50,000 hours", cta: "Shop now", offer: "50% OFF", caption: "Our best dimmer, rated 5 stars.", hashtags: "#LED #DIY", subject: "", preheader: "", alt: "A dimmer switch" }) };
  const r = await draftChannelCopy(llm, { llmDraftModel: "x" }, { channel: "social", style: "product", picked: { title: "EZDim Pro", desc: "Smooth dimming for 12V and 24V LED strips." }, current: { headline: "Before", offer: "" } });
  assert.equal(r.draft.offer, "");
  assert.equal(r.draft.headline, "Before", "headline with an invented offer keeps the previous value");
  assert.equal(r.draft.sub, "");
  assert.equal(r.draft.caption, "");
  assert.equal(r.draft.cta, "Shop now");
  assert.equal(r.draft.hashtags, "#LED #DIY");
  assert.ok(r.violations.length >= 3);
});

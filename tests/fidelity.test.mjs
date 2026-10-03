// Product fidelity: separate from text QA, blocks delivery on fail/error, needs a person for
// "uncertain". Plus the SSRF guard on fetching the product photo.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "../server/store.mjs";
import { Pipeline } from "../server/pipeline.mjs";
import { FakeRenderer } from "../server/render/fake.mjs";
import { readConfig, ROOT } from "../server/config.mjs";
import { parseFidelity, fidelityPrompt } from "../core/fidelity.mjs";
import { isPrivateAddress, fetchSourceImage } from "../server/source-image.mjs";
import { SAMPLE } from "../core/brand.mjs";

const PY = process.env.PYTHON || (fs.existsSync(path.join(ROOT, ".venv/bin/python")) ? path.join(ROOT, ".venv/bin/python") : "python3");
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PICK = { url: "https://cdn.shopify.com/p.jpg", title: "EZDim 12V", label: "EZDim 12V", variantTitle: "Default Title" };
const form = { tpl: "t1", ...SAMPLE.t1, phone: "+1 855 768 4135", email: "customerservice@hitlights.com" };
const SIZES = ["1080x1080", "1080x1920", "1200x628"];

function setup(fidelityVerdicts, { source = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hlab-fid-"));
  const cfg = readConfig({ DATA_DIR: dir, PYTHON: PY, COMPOSED_TEMPLATES: "" });
  const store = new Store(dir);
  const uploads = [], seen = [];
  const drive = { enabled: true, createFolder: async () => ({ id: "F", url: "https://drive.google.com/drive/folders/F" }), uploadJpeg: async (f, n) => { uploads.push(n); return { id: "d" }; } };
  const llm = { name: "mock", json: async ({ prompt, images }) => {
    const fid = /official product photo/.test(prompt);
    seen.push({ fid, n: images.length, first: images[0] });
    return { images: SIZES.map((size) => ({ size, verdict: fid ? fidelityVerdicts[size] : "pass", issues: fid && fidelityVerdicts[size] !== "pass" ? ["Two connectors instead of three"] : [] })) };
  } };
  const fetchSource = source ? async (u, dest) => { fs.writeFileSync(dest, PNG1); return { sha256: crypto.createHash("sha256").update(PNG1).digest("hex"), bytes: PNG1.length, contentType: "image/png" }; } : async () => { throw new Error("HTTP 403"); };
  const pipeline = new Pipeline({ cfg, store, renderer: new FakeRenderer({ store, python: PY }), llm, drive, log: { error() {} }, fetchSource });
  return { pipeline, store, uploads, seen };
}
async function settle(p) { for (let i = 0; i < 4; i++) await p.idle(); }

test("fidelity runs separately with the product photo first; pass delivers", async () => {
  const { pipeline, store, uploads, seen } = setup({ "1080x1080": "pass", "1080x1920": "pass", "1200x628": "pass" });
  const run = pipeline.start(pipeline.create({ form, picked: PICK, saveDrive: true }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  const f = seen.find((x) => x.fid);
  assert.ok(f && f.n === 4 && f.first.equals(PNG1), "reference photo + 3 ads");
  assert.ok(seen.some((x) => !x.fid && x.n === 3), "text QA is its own call");
  assert.equal(r.S.source.sha256, crypto.createHash("sha256").update(PNG1).digest("hex"));
  assert.equal(uploads.length, 3);
});

test("fidelity fail flags FIDELITY and holds; uncertain holds until a person approves", async () => {
  const { pipeline, store, uploads } = setup({ "1080x1080": "pass", "1080x1920": "fail", "1200x628": "uncertain" });
  const run = pipeline.start(pipeline.create({ form, picked: PICK, saveDrive: true }));
  await settle(pipeline);
  let r = store.getRun(run.id);
  const P = r.items.find((x) => x.kind === "portrait"), L = r.items.find((x) => x.kind === "landscape");
  assert.ok(P.flags.includes("FIDELITY") && P.held);
  assert.equal(L.fidelity.state, "uncertain"); assert.ok(L.held);
  assert.deepEqual(uploads, ["1080x1080.jpg"]);
  assert.throws(() => pipeline.approveFidelity(run.id, "portrait", {}), /Only an uncertain/);
  pipeline.approveFidelity(run.id, "landscape", { actor: "team", note: "connector count checked" });
  await settle(pipeline);
  r = store.getRun(run.id);
  assert.deepEqual(uploads.sort(), ["1080x1080.jpg", "1200x628.jpg"]);
  assert.equal(r.items.find((x) => x.kind === "landscape").fidelity.approved.actor, "team");
});

test("no copy of the product photo: the fidelity check is an error and nothing auto-delivers", async () => {
  const { pipeline, store, uploads } = setup({}, { source: false });
  const run = pipeline.start(pipeline.create({ form, picked: PICK, saveDrive: true }));
  await settle(pipeline);
  const r = store.getRun(run.id);
  assert.match(r.S.source.fetchError, /403/);
  assert.ok(r.items.every((x) => x.fidelity.state === "error" && x.held));
  assert.deepEqual(uploads, []);
});

test("fidelity reply parsing is strict and size-mapped", () => {
  assert.equal(parseFidelity({ images: [{ size: "1200x628", verdict: "uncertain", issues: [] }, { size: "1080x1080", verdict: "pass", issues: [] }, { size: "1080x1920", verdict: "fail", issues: ["x"] }] }, SIZES).results["1080x1920"].verdict, "fail");
  assert.equal(parseFidelity({ images: [{ size: "1080x1080", verdict: "probably", issues: [] }] }, ["1080x1080"]).ok, false);
  assert.equal(parseFidelity({ images: [] }, ["1080x1080"]).ok, false);
  assert.match(fidelityPrompt([{ dims: "1080x1080", title: "Square" }], { title: "EZDim" }), /FIRST image is the official product photo of "EZDim"/);
});

test("SSRF guard: private, loopback, link-local and mapped addresses are refused", async () => {
  for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ["23.227.38.65", "151.101.1.1", "2606:4700::1"]) assert.ok(!isPrivateAddress(ip), ip);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hlab-ssrf-")), dest = path.join(dir, "s.img");
  const lookup = async (h) => (h === "evil.example" ? [{ address: "169.254.169.254" }] : [{ address: "23.227.38.65" }]);
  await assert.rejects(fetchSourceImage("https://evil.example/a.jpg", dest, { lookup, fetchImpl: async () => assert.fail("must not fetch") }), /private/);
  const redirect = async (u) => ({ status: 302, ok: false, headers: new Map([["location", "https://evil.example/x"]]) });
  await assert.rejects(fetchSourceImage("https://cdn.shopify.com/a.jpg", dest, { lookup, fetchImpl: redirect }), /private/);
  const html = async () => ({ status: 200, ok: true, headers: new Map([["content-type", "text/html"]]), arrayBuffer: async () => new ArrayBuffer(4) });
  await assert.rejects(fetchSourceImage("https://cdn.shopify.com/a.jpg", dest, { lookup, fetchImpl: html }), /not an image/);
  const big = async () => ({ status: 200, ok: true, headers: new Map([["content-type", "image/jpeg"], ["content-length", String(20 * 1024 * 1024)]]), arrayBuffer: async () => new ArrayBuffer(4) });
  await assert.rejects(fetchSourceImage("https://cdn.shopify.com/a.jpg", dest, { lookup, fetchImpl: big }), /15 MB/);
  await assert.rejects(fetchSourceImage("http://cdn.shopify.com/a.jpg", dest, { lookup }), /https/);
  const ok = async () => ({ status: 200, ok: true, headers: new Map([["content-type", "image/png"]]), arrayBuffer: async () => PNG1 });
  const r = await fetchSourceImage("https://cdn.shopify.com/a.png", dest, { lookup, fetchImpl: ok });
  assert.equal(r.sha256, crypto.createHash("sha256").update(PNG1).digest("hex")); assert.ok(fs.readFileSync(dest).equals(PNG1));
});

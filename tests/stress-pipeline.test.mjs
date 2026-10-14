// Bursts and failure injection; local storage and mocked providers only, no paid renders.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pipeline } from "../server/pipeline.mjs";
import { Store } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import { readConfig } from "../server/config.mjs";
import { SAMPLE } from "../core/brand.mjs";
import { Drive } from "../server/providers/drive.mjs";
import { CutoutStore, sha256, CUTOUT_ALGO } from "../server/compose.mjs";

const FORM = { tpl: "t1", ...SAMPLE.t1, phone: "+1 855 768 4135", email: "customerservice@hitlights.com" };
const PICK = { url: "https://cdn.shopify.com/test.png", title: "Synthetic test product" };
function setup({ renderer = {}, drive = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hlab-stress-"));
  const cfg = readConfig({ DATA_DIR: dir });
  const store = new Store(dir);
  const pipeline = new Pipeline({ cfg, store, renderer, drive, llm: null, log: { error() {} } });
  return { dir, cfg, store, pipeline, renderer };
}
function completed(a) {
  const r = a.pipeline.create({ form: FORM, picked: PICK, saveDrive: true });
  r.status = "done"; r.cutout = { state: "approved", sha: "a".repeat(64) };
  r.scene.qa = { state: "uncertain", version: 1 };
  for (const x of r.items) Object.assign(x, { state: "done", file: x.kind + ".jpg", output: { ok: true }, fidelity: { state: "uncertain" } });
  a.store.saveRun(r); return r;
}

test("a 32-request Generate burst admits exactly one set while checking the provider", async () => {
  const renderer = { name: "fake", status: async () => { await delay(25); return { connected: true }; }, balance: async () => { await delay(25); return 1000; } };
  const a = setup({ renderer }); let processed = 0;
  a.pipeline.process = async (id) => { processed++; await delay(60); const r = a.store.getRun(id); r.status = "done"; a.store.saveRun(r); };
  const server = http.createServer(createApp({ ...a, shopify: { enabled: false }, llm: null, drive: null }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const responses = await Promise.all(Array.from({ length: 32 }, () => fetch(base + "/api/runs", { method: "POST", headers: { "Content-Type": "application/json", origin: new URL(a.cfg.publicUrl).origin }, body: JSON.stringify({ form: FORM, picked: PICK }) })));
    assert.equal(responses.filter((r) => r.status === 201).length, 1);
    assert.equal(responses.filter((r) => r.status === 409).length, 31);
    await a.pipeline.idle();
    assert.equal(a.store.listRuns(100).length, 1);
    assert.equal(processed, 1);
  } finally { await a.pipeline.idle(); await new Promise((resolve) => server.close(resolve)); }
});

test("busy approvals and overrides reject without mutating the active run", async () => {
  for (const action of ["scene", "fidelity", "override"]) {
    const a = setup(), r = completed(a), before = a.store.getRun(r.id);
    let release; const wait = new Promise((resolve) => { release = resolve; });
    a.pipeline.enqueue(r.id, () => wait);
    try {
      assert.throws(() => {
        if (action === "scene") a.pipeline.approveScene(r.id, { actor: "test" });
        else if (action === "fidelity") a.pipeline.approveFidelity(r.id, "master", { actor: "test" });
        else a.pipeline.override(r.id, "master", { actor: "test", reason: "Compared exact output" });
      }, { code: "already_queued" });
      assert.deepEqual(a.store.getRun(r.id), before, action);
    } finally { release(); await a.pipeline.idle(); }
  }
});

test("shutdown refuses run mutations before changing saved status or creating another set", () => {
  const a = setup(), r = completed(a), before = a.store.getRun(r.id);
  a.pipeline.shuttingDown = true;
  assert.throws(() => a.pipeline.resume(r.id), { code: "shutting_down" });
  assert.deepEqual(a.store.getRun(r.id), before);
  assert.throws(() => a.pipeline.regenerate(r.id, "master"), { code: "shutting_down" });
  assert.equal(a.store.listRuns(100).length, 1);
  assert.throws(() => a.pipeline.approveScene(r.id, { actor: "test" }), { code: "shutting_down" });
  assert.deepEqual(a.store.getRun(r.id), before);
});

test("restart recovery finds interrupted historical runs beyond the 50 newest sets", async () => {
  const a = setup(), interrupted = completed(a);
  interrupted.ts = 1; interrupted.status = "running"; a.store.saveRun(interrupted);
  for (let i = 0; i < 70; i++) a.store.saveRun({ ...interrupted, id: "rhistory" + i, ts: 100 + i, status: "done" });
  const resumed = []; a.pipeline.process = async (id) => { resumed.push(id); };
  a.pipeline.resumeInterrupted(); await a.pipeline.idle();
  assert.deepEqual(resumed, [interrupted.id]);
});

test("an ambiguous submission persisted during restart holds that run without blocking other recovery", async () => {
  const a = setup(), ambiguous = completed(a), other = completed(a);
  ambiguous.status = "running"; ambiguous.ts = 999; ambiguous.attempts = [{ id: "uncertain", state: "ambiguous" }]; a.store.saveRun(ambiguous);
  other.status = "running"; other.ts = 1; a.store.saveRun(other);
  const resumed = []; a.pipeline.process = async (id) => { resumed.push(id); };
  assert.doesNotThrow(() => a.pipeline.resumeInterrupted());
  await a.pipeline.idle();
  assert.equal(a.store.getRun(ambiguous.id).status, "needs_decision");
  assert.equal(a.store.getRun(ambiguous.id).error.code, "ambiguous");
  assert.deepEqual(resumed, [other.id]);
  assert.equal(a.store.creditsToday(), 0);
});

function driveDouble() {
  const files = new Map(), calls = []; let serial = 0, fail = false;
  return { files, calls, enabled: true, parent: "P", failNext() { fail = true; },
    createFolder: async () => ({ id: "F", url: "https://drive.google.com/drive/folders/F" }),
    findByName: async (parent, name, folder, { md5Checksum } = {}) => {
      const f = [...files.values()].find((f) => f.parent === parent && f.name === name && (!md5Checksum || crypto.createHash("md5").update(f.bytes).digest("hex") === md5Checksum));
      return f ? { id: f.id } : null;
    },
    uploadJpeg: async (parent, name, bytes, { fileId } = {}) => {
      const id = fileId || "file" + (++serial); calls.push({ id, fileId, name }); files.set(id, { id, parent, name, bytes });
      if (fail) { fail = false; throw new Error("Connection lost after Drive accepted bytes"); }
      return { id };
    },
  };
}
function driveReady(a) {
  const r = completed(a); r.scene.qa.state = "pass"; a.store.runDir(r.id);
  for (const x of r.items) fs.writeFileSync(a.store.filePath(r.id, x.file), Buffer.from("original bytes " + x.kind));
  return r;
}

test("re-composing identical output reuses Drive files; changed output updates the same known file", async () => {
  const drive = driveDouble(), a = setup({ drive }), r = driveReady(a);
  await a.pipeline.stepDrive(r, r.items);
  const ids = r.items.map((x) => x.drive.id);
  assert.equal(drive.files.size, 3);
  for (const x of r.items) { a.pipeline.rememberDrive(r, x); x.drive = null; }
  await a.pipeline.stepDrive(r, r.items);
  assert.equal(drive.calls.length, 3, "identical bytes cause no network upload");
  assert.deepEqual(r.items.map((x) => x.drive.id), ids);
  for (const x of r.items) {
    a.pipeline.rememberDrive(r, x); x.drive = null;
    fs.writeFileSync(a.store.filePath(r.id, x.file), Buffer.from("corrected bytes " + x.kind));
  }
  await a.pipeline.stepDrive(r, r.items);
  assert.equal(drive.files.size, 3, "updates cannot leave same-name stale duplicates");
  assert.deepEqual(r.items.map((x) => x.drive.id), ids);
  assert.ok(drive.calls.slice(3).every((c) => c.fileId));
  assert.ok([...drive.files.values()].every((f) => f.bytes.toString().startsWith("corrected")));
});

test("a lost Drive update response reconciles exact bytes without duplicate uploads", async () => {
  const drive = driveDouble(), a = setup({ drive }), r = driveReady(a);
  await a.pipeline.stepDrive(r, r.items);
  const x = r.items[0], id = x.drive.id;
  a.pipeline.rememberDrive(r, x); x.drive = null;
  fs.writeFileSync(a.store.filePath(r.id, x.file), Buffer.from("corrected master bytes"));
  drive.failNext(); await a.pipeline.stepDrive(r, [x]);
  assert.match(r.driveError, /Connection lost/);
  assert.equal(x.driveUpload.targetId, id);
  await a.pipeline.stepDrive(r, [x]);
  assert.equal(x.drive.id, id);
  assert.equal(x.driveUpload.reconciled, true);
  assert.equal(drive.calls.length, 4);
  assert.equal(drive.files.size, 3);
  assert.equal(r.driveError, null, "a successful retry clears the earlier failure");
});

test("changed output after an interrupted first Drive upload replaces the exact earlier file", async () => {
  const drive = driveDouble(), a = setup({ drive }), r = driveReady(a), x = r.items[0];
  drive.failNext(); await a.pipeline.stepDrive(r, [x]);
  assert.equal(drive.files.size, 1); assert.equal(x.drive, null);
  const earlierId = [...drive.files.keys()][0];
  a.pipeline.rememberDrive(r, x); x.driveUpload = null;
  fs.writeFileSync(a.store.filePath(r.id, x.file), Buffer.from("new cutout corrected pixels"));
  await a.pipeline.stepDrive(r, [x]);
  assert.equal(drive.files.size, 1);
  assert.equal(x.drive.id, earlierId);
  assert.equal(drive.calls[1].fileId, earlierId);
  assert.equal(drive.files.get(earlierId).bytes.toString(), "new cutout corrected pixels");
});

test("reverting to earlier pixels after an unconfirmed Drive update restores actual remote bytes", async () => {
  for (const clearedByCutoutChange of [false, true]) {
    const drive = driveDouble(), a = setup({ drive }), r = driveReady(a), x = r.items[0];
    const original = fs.readFileSync(a.store.filePath(r.id, x.file));
    await a.pipeline.stepDrive(r, [x]); const id = x.drive.id;
    a.pipeline.rememberDrive(r, x); x.drive = null;
    fs.writeFileSync(a.store.filePath(r.id, x.file), Buffer.from("replacement B"));
    drive.failNext(); await a.pipeline.stepDrive(r, [x]);
    assert.equal(drive.files.get(id).bytes.toString(), "replacement B");
    a.pipeline.rememberDrive(r, x);
    if (clearedByCutoutChange) x.driveUpload = null;
    fs.writeFileSync(a.store.filePath(r.id, x.file), original);
    await a.pipeline.stepDrive(r, [x]);
    assert.equal(x.drive.id, id);
    assert.deepEqual(drive.files.get(id).bytes, original, "remembered SHA(A) cannot prove A survived the unknown write of B");
    assert.equal(x.drive.sha256, sha256(drive.files.get(id).bytes));
    assert.equal(drive.files.size, 1);
    assert.equal(drive.calls.length, 3, "A must be restored by an idempotent PATCH to the known file");
  }
});

test("Drive never updates a file remembered from another version or folder", async () => {
  for (const mismatch of ["version", "folderId"]) {
    const drive = driveDouble(), a = setup({ drive }), r = driveReady(a), x = r.items[0];
    r.folder = { id: "F" };
    x.drivePrevious = { id: "unrelated", name: "1080x1080.jpg", version: 1, folderId: "F", [mismatch]: mismatch === "version" ? 9 : "other" };
    await a.pipeline.stepDrive(r, [x]);
    assert.equal(drive.calls[0].fileId, null);
    assert.notEqual(x.drive.id, "unrelated");
  }
});

test("Drive lookup ignores older same-name content and searches later pages for matching bytes", async () => {
  const drive = new Drive({ parentId: "P", serviceAccountJson: "" }); const calls = [];
  drive.api = async (url) => {
    calls.push(url);
    return calls.length === 1 ? { files: [{ id: "old", md5Checksum: "old-bytes" }], nextPageToken: "next" } : { files: [{ id: "correct", md5Checksum: "current-bytes" }] };
  };
  const found = await drive.findByName("F", "1080x1080.jpg", false, { md5Checksum: "current-bytes", createdAfter: 1000 });
  assert.equal(found.id, "correct"); assert.equal(calls.length, 2);
  assert.match(calls[1], /pageToken=next/);
  assert.ok(decodeURIComponent(calls[0]).includes("createdTime >"));
});

test("Drive replaces only the explicit file ID using PATCH and keeps its parent", async () => {
  const drive = new Drive({ parentId: "P", serviceAccountJson: "" }); let request;
  drive.api = async (url, init) => { request = { url, ...init }; return { id: "known" }; };
  await drive.uploadJpeg("F", "1080x1080.jpg", Buffer.from("new pixels"), { fileId: "known" });
  assert.match(request.url, /files\/known\?uploadType=multipart/);
  assert.equal(request.method, "PATCH");
  assert.ok(!request.body.includes(Buffer.from('"parents"')));
});

test("a shared cutout replaced after ensure cannot mix old revision metadata with new run pixels", async () => {
  const a = setup(), r = completed(a), cs = new CutoutStore(a.dir);
  const source = Buffer.from("source photo identity"), original = Buffer.from("original PNG snapshot"), replacement = Buffer.from("replacement PNG snapshot");
  const sha = sha256(source); a.store.runDir(r.id); r.S.source.file = "source.png";
  fs.writeFileSync(a.store.filePath(r.id, r.S.source.file), source);
  fs.writeFileSync(cs.png(sha), original); cs.put(sha, { state: "approved", algo: CUTOUT_ALGO });
  const ensure = cs.ensure.bind(cs); let replacing;
  cs.ensure = (...args) => {
    const read = ensure(...args);
    replacing = cs.locked(sha, async () => { fs.writeFileSync(cs.png(sha), replacement); cs.put(sha, { state: "uploaded" }); });
    return read;
  };
  a.pipeline._cutouts = cs;
  await a.pipeline.stepCutout(r); await replacing;
  assert.equal(r.cutout.revision, sha256(original));
  assert.deepEqual(fs.readFileSync(a.pipeline.cutoutFile(r)), original);
  assert.equal(cs.get(sha).revision, sha256(replacement), "the shared replacement happened independently");
});

test("free preview composes the exact frozen cutout revision even when its shared PNG changes", async () => {
  const a = setup(), cs = new CutoutStore(a.dir), source = Buffer.from("preview source"), original = Buffer.from("preview snapshot"), replacement = Buffer.from("new shared image");
  const sha = sha256(source); fs.writeFileSync(cs.png(sha), original); cs.put(sha, { state: "approved", algo: CUTOUT_ALGO });
  const ensure = cs.ensure.bind(cs); let replacing;
  cs.ensure = (...args) => {
    const read = ensure(...args);
    replacing = cs.locked(sha, async () => { fs.writeFileSync(cs.png(sha), replacement); cs.put(sha, { state: "uploaded" }); });
    return read;
  };
  a.pipeline._cutouts = cs; a.pipeline.fetchSource = async (url, file) => { fs.writeFileSync(file, source); };
  const used = []; a.pipeline.composer = { compose: async (spec, images) => { used.push(images.product); return { png: Buffer.from("fake preview"), report: { ok: true, errors: [] } }; } };
  const preview = await a.pipeline.preview({ form: FORM, picked: PICK }); await replacing;
  assert.equal(preview.cutout.revision, sha256(original));
  assert.equal(used.length, 3);
  assert.ok(used.every((data) => data === "data:image/png;base64," + original.toString("base64")));
});

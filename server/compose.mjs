// Server side of composed templates: product cutouts (one per product photo, approved once by a
// person) and turning a composed size into a delivery JPEG.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./config.mjs";
import { runPython } from "./py.mjs";
import { parseResult } from "./finish.mjs";
import { sniffImage } from "./providers/llm.mjs";
import { dataUri } from "../composer/page.mjs";

const CUTOUT = path.join(ROOT, "finishing", "cutout.py");
const ENCODE = path.join(ROOT, "finishing", "encode.py");
const SHA = /^[0-9a-f]{64}$/;
// Cutout method version (finishing/cutout.py ALGO). An automatic cutout made by an older method and
// not yet approved is redone; approved and uploaded cutouts are never touched.
export const CUTOUT_ALGO = 4;
export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const cutoutLocks = new Map(); // one replica; shared by every store instance in this process
const unique = () => process.pid + "." + crypto.randomBytes(8).toString("hex");

// Cutouts are keyed by the SHA-256 of the product photo they were made from, so the same photo is
// cut out (and approved) once, across all sets. state: auto | approved | uploaded.
export class CutoutStore {
  constructor(dataDir) { this.dir = path.join(dataDir, "cutouts"); fs.mkdirSync(this.dir, { recursive: true }); }
  png(sha) { if (!SHA.test(sha)) throw new Error("bad cutout id"); return path.join(this.dir, sha + ".png"); }
  metaPath(sha) { return this.png(sha).replace(/\.png$/, ".json"); }
  // The product photo the cutout was made from, kept beside it so the approval panel can show both.
  photo(sha) { return this.png(sha).replace(/\.png$/, ".photo"); }
  get(sha) {
    try {
      const m = JSON.parse(fs.readFileSync(this.metaPath(sha), "utf8"));
      return { ...m, revision: sha256(fs.readFileSync(this.png(sha))) };
    } catch { return null; }
  }
  put(sha, meta) {
    const m = { ...meta, sha, revision: sha256(fs.readFileSync(this.png(sha))), at: Date.now() }, f = this.metaPath(sha), t = f + "." + unique() + ".tmp";
    fs.writeFileSync(t, JSON.stringify(m)); fs.renameSync(t, f); return m;
  }
  async locked(sha, fn) {
    const key = path.resolve(this.png(sha)), before = cutoutLocks.get(key) || Promise.resolve();
    const work = before.catch(() => {}).then(fn);
    cutoutLocks.set(key, work);
    try { return await work; }
    finally { if (cutoutLocks.get(key) === work) cutoutLocks.delete(key); }
  }
  // Make (or reuse) the cutout for a product photo. Never throws for a bad photo: returns
  // {state: "failed", error} so the caller can say why before any credits are spent.
  async ensure(srcFile, { python, model, snapshot = false }) {
    const buf = fs.readFileSync(srcFile), sha = sha256(buf);
    return this.locked(sha, async () => {
      const have = this.get(sha);
      const result = (meta) => snapshot ? { ...meta, png: fs.readFileSync(this.png(sha)) } : meta;
      if (!fs.existsSync(this.photo(sha))) { const t = this.photo(sha) + "." + unique() + ".tmp"; fs.writeFileSync(t, buf); fs.renameSync(t, this.photo(sha)); }
      if (have && !(have.state === "auto" && (have.algo || 1) < CUTOUT_ALGO)) return result(have);
      const out = this.png(sha), tmp = out + "." + unique() + ".tmp.png";
      let r;
      try {
        const args = [srcFile, tmp]; if (model) args.push(model);
        r = parseResult((await runPython(python, CUTOUT, args, { timeoutMs: 180000 })).stdout);
      } catch (e) { try { fs.unlinkSync(tmp); } catch { /* none */ } return { sha, state: "failed", error: "Background removal crashed: " + String(e.message).slice(0, 200) }; }
      if (!r || !r.ok) { try { fs.unlinkSync(tmp); } catch { /* none */ } return { sha, state: "failed", error: (r && r.error) || "Background removal returned nothing." }; }
      fs.renameSync(tmp, out);
      // A supplied PNG that already had transparency counts as a person's cutout.
      return result(this.put(sha, { state: r.source === "supplied" ? "uploaded" : "auto", source: r.source, width: r.width, height: r.height, coverage: r.coverage, algo: r.algo || 1, refined: r.refined || 0 }));
    });
  }
  async approve(sha, actor, revision) {
    return this.locked(sha, async () => {
      const m = this.get(sha); if (!m) throw new Error("No such cutout.");
      if (!revision || revision !== m.revision) throw Object.assign(new Error("The cutout changed since this preview. Refresh and compare it again before approving."), { code: "stale_cutout" });
      return this.put(sha, { ...m, state: m.state === "uploaded" ? "uploaded" : "approved", approvedBy: actor || null, approvedAt: Date.now() });
    });
  }
  // A person supplies their own cutout (PNG with transparency) for a product photo.
  async upload(sha, pngBuf, { python, actor }) {
    if (!SHA.test(sha)) throw new Error("bad cutout id");
    if (sniffImage(pngBuf) !== "image/png") throw new Error("Upload a PNG with a transparent background.");
    return this.locked(sha, async () => {
      const tmpIn = path.join(this.dir, sha + ".upload." + unique() + ".png"), tmpOut = tmpIn + ".out.png";
      fs.writeFileSync(tmpIn, pngBuf);
      try {
        const r = parseResult((await runPython(python, CUTOUT, [tmpIn, tmpOut], { timeoutMs: 60000 })).stdout);
        if (!r || !r.ok) throw new Error((r && r.error) || "That PNG couldn't be used.");
        if (r.source !== "supplied") throw new Error("That PNG has no transparent background. Remove the background first, or approve the automatic cutout.");
        fs.renameSync(tmpOut, this.png(sha));
        return this.put(sha, { state: "uploaded", source: "uploaded", width: r.width, height: r.height, coverage: r.coverage, approvedBy: actor || null, approvedAt: Date.now() });
      } finally { for (const f of [tmpIn, tmpOut]) { try { fs.unlinkSync(f); } catch { /* none */ } } }
    });
  }
}

export const cutoutApproved = (c) => !!c && (c.state === "approved" || c.state === "uploaded");

export function imageUri(file) {
  const buf = fs.readFileSync(file), type = sniffImage(buf);
  if (!type) throw new Error("not an image: " + path.basename(file));
  return dataUri(buf, type);
}

// Compose one size and encode it to the delivery JPEG. Returns {report, result} from encode.py.
export async function composeToJpeg(composer, spec, images, { python, out }) {
  const { png, report } = await composer.compose(spec, images);
  const tmp = out + ".compose.png";
  fs.writeFileSync(tmp, png);
  try {
    const r = parseResult((await runPython(python, ENCODE, [tmp, out, spec.W, spec.H], { timeoutMs: 60000 })).stdout);
    return { report, result: r || { ok: false, error: "encoding returned no result" } };
  } finally { try { fs.unlinkSync(tmp); } catch { /* none */ } }
}

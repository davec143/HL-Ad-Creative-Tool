// Finishing: fetch a raw render, then run finishing/process.py (cover-crop to the exact size + v16
// finish.py: brand colour lock, CTA gold lock, logo on the Logo Grid, JPEG <= 460 KB).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.mjs";
import { runPython } from "./py.mjs";
import { finishSpec } from "../core/engine.mjs";

const PROCESS = path.join(ROOT, "finishing", "process.py");

// Download a render to a local file. Only https (Higgsfield CDN) and, for the fake renderer,
// file:// paths inside DATA_DIR are accepted.
export async function fetchRender(url, dest, { dataDir, fetchImpl = fetch, timeoutMs = 90000 } = {}) {
  if (url.startsWith("file://")) {
    const p = path.resolve(url.slice(7));
    if (!p.startsWith(path.resolve(dataDir) + path.sep)) throw new Error("render path outside the data folder");
    fs.copyFileSync(p, dest); return dest;
  }
  if (!/^https:\/\//i.test(url)) throw new Error("render URL must be https");
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error("download failed: HTTP " + res.status);
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      return dest;
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw new Error("Couldn't download the render: " + (last && last.message));
}

// Parse finish.py's one-line report: "<colour> logo at (x,y) wN | notes | ground .. edges .. | FLAGS A B".
export function parseReport(report) {
  const lines = String(report || "").trim().split("\n").filter((l) => !l.startsWith("RESULT "));
  const line = lines.pop() || "";
  const m = line.match(/^(\w+) logo at \((\d+),(\d+)\) w(\d+)/);
  const fl = line.match(/\| FLAGS (.*)$/);
  return {
    mode: line,
    colour: m ? m[1] : null, x: m ? +m[2] : null, y: m ? +m[3] : null, w: m ? +m[4] : null,
    flags: fl ? fl[1].trim().split(/\s+/) : [],
  };
}

export const MAX_BYTES = 460000;

// Read a JPEG's pixel size from its SOF marker (no decoding). Returns [w, h] or null.
export function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m === 0xd9 || m === 0xda) return null;
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}
// Independent check of a finished file: exists, is a JPEG of exactly W x H, <= 460 KB.
export function validateOutput(file, W, H) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return { ok: false, error: "file missing" }; }
  const dims = jpegSize(buf);
  if (!dims) return { ok: false, error: "not a readable JPEG", bytes: buf.length };
  if (dims[0] !== W || dims[1] !== H) return { ok: false, error: `wrong size ${dims[0]}x${dims[1]}`, width: dims[0], height: dims[1], bytes: buf.length };
  if (buf.length > MAX_BYTES) return { ok: false, error: `${buf.length} bytes is over the ${MAX_BYTES}-byte limit`, width: W, height: H, bytes: buf.length };
  return { ok: true, width: W, height: H, bytes: buf.length };
}

// Structured result from process.py's "RESULT {...}" line.
export function parseResult(stdout) {
  const line = String(stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return null;
  try { return JSON.parse(line.slice(7)); } catch { return null; }
}

export async function finishOne({ python, src, out, W, H, logo }) {
  const { stdout } = await runPython(python, PROCESS, [src, out, W, H, JSON.stringify(finishSpec(logo))], { timeoutMs: 180000 });
  const r = parseReport(stdout);
  if (r.x == null) throw new Error("Finishing produced no report.");
  if (!fs.existsSync(out)) throw new Error("Finishing produced no file.");
  r.result = parseResult(stdout) || { ok: false, error: "finishing returned no result" };
  return r;
}

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
  const line = String(report || "").trim().split("\n").pop() || "";
  const m = line.match(/^(\w+) logo at \((\d+),(\d+)\) w(\d+)/);
  const fl = line.match(/\| FLAGS (.*)$/);
  return {
    mode: line,
    colour: m ? m[1] : null, x: m ? +m[2] : null, y: m ? +m[3] : null, w: m ? +m[4] : null,
    flags: fl ? fl[1].trim().split(/\s+/) : [],
  };
}

export async function finishOne({ python, src, out, W, H, logo }) {
  const { stdout } = await runPython(python, PROCESS, [src, out, W, H, JSON.stringify(finishSpec(logo))], { timeoutMs: 180000 });
  const r = parseReport(stdout);
  if (r.x == null) throw new Error("Finishing produced no report: " + stdout.slice(0, 200));
  if (!fs.existsSync(out)) throw new Error("Finishing produced no file.");
  return r;
}

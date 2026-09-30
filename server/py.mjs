// Run a Python script (finishing/*.py) as a subprocess, with a timeout. Arguments are passed as an
// argv array, never through a shell, so nothing in them can be interpreted as shell syntax.
import { spawn } from "node:child_process";

export function runPython(python, script, args, { timeoutMs = 120000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(python, [script, ...args.map(String)], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("finishing timed out")); }, timeoutMs);
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error((err || out || "python exited " + code).trim().split("\n").slice(-3).join(" ").slice(0, 400)));
    });
  });
}

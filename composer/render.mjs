// Renders a composed ad size with headless Chromium. One browser is reused; renders are serialised
// (the pipeline already runs one set at a time, and previews are small).
import fs from "node:fs";
import { buildHtml, pageScript, FIELD_NAMES, FONT_WEIGHTS, ALLOWED_TEXT } from "./page.mjs";

const CANDIDATES = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];

export function chromiumPath() {
  for (const p of CANDIDATES) if (p && fs.existsSync(p)) return p;
  // Development: Playwright's bundled browser (PLAYWRIGHT_BROWSERS_PATH).
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    for (const d of fs.readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
      for (const sub of ["chrome-linux/chrome", "chrome-linux64/chrome"]) { const p = base + "/" + d + "/" + sub; if (fs.existsSync(p)) return p; }
    }
  } catch { /* none */ }
  return null;
}

export class ComposeError extends Error {
  constructor(code, message, errors = []) { super(message); this.code = code; this.errors = errors; }
}

// Text the bundled font can't draw would silently switch typeface: refuse it with the field named.
export function textProblems(text) {
  const out = [];
  const check = (name, v) => { if (v && !ALLOWED_TEXT.test(v)) out.push({ code: "GLYPH", field: name, message: (FIELD_NAMES[name] || name) + " has a character the brand font can't draw (" + [...v].filter((c) => !ALLOWED_TEXT.test(c)).join(" ") + ")." }); };
  check("h1", text.h1); check("h2", text.h2); check("cta", text.cta); check("contact", text.contact); check("seal", text.seal);
  text.proof.forEach((p, i) => check("p" + (i + 1), p));
  if (!text.h1) out.push({ code: "MISSING", field: "h1", message: "Headline line 1 is empty." });
  if (!text.cta) out.push({ code: "MISSING", field: "cta", message: "The button text is empty." });
  return out;
}

export class Composer {
  constructor({ launch } = {}) { this.launchImpl = launch; this.browser = null; this.chain = Promise.resolve(); }

  async ensure() {
    if (this.browser && this.browser.isConnected()) return this.browser;
    if (this.launchImpl) { this.browser = await this.launchImpl(); return this.browser; }
    const { chromium } = await import("playwright-core");
    const args = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--font-render-hinting=none", "--disable-lcd-text"];
    // Prefer Playwright's own headless build for its version (what the Docker image installs);
    // fall back to any Chromium found on this machine (development).
    if (!process.env.CHROMIUM_PATH) {
      try { this.browser = await chromium.launch({ args }); return this.browser; }
      catch (e) { if (!/Executable doesn't exist|browserType\.launch: .*(not found|install)/i.test(String(e.message))) throw e; }
    }
    const exe = chromiumPath();
    if (!exe) throw new ComposeError("no_browser", "Chromium isn't installed, so ads can't be composed.");
    this.browser = await chromium.launch({ executablePath: exe, args });
    return this.browser;
  }

  // spec from layoutFor(); images: {scene: dataUri|null, product: dataUri}.
  // Returns {png: Buffer, report}. Throws ComposeError("layout") with every problem listed.
  // allowInvalid (previews only): return the picture and the problems instead of throwing.
  compose(spec, images, { screenshot = true, allowInvalid = false, type = "png", quality } = {}) {
    const run = async () => {
      const pre = textProblems(spec.text);
      if (pre.length) throw new ComposeError("layout", pre.map((e) => e.message).join(" "), pre);
      const browser = await this.ensure();
      const page = await browser.newPage({ viewport: { width: spec.W, height: spec.H }, deviceScaleFactor: 1 });
      try {
        await page.setContent(buildHtml(spec, images), { waitUntil: "load", timeout: 30000 });
        // Load every bundled weight explicitly (faces load lazily, only when used), then wait.
        await page.evaluate((ws) => Promise.all(ws.map((w) => document.fonts.load(w + ' 20px "HLMontserrat"'))), FONT_WEIGHTS);
        await page.evaluate(() => document.fonts.ready);
        const rules = {
          W: spec.W, H: spec.H, margin: 40, safe: spec.L.safe || null, bleed: spec.L.bleed || [], ground: spec.L.ground || [], weights: FONT_WEIGHTS, names: FIELD_NAMES,
          maxW: { cta: spec.L.cta.maxW, contact: spec.L.contact.maxW },
        };
        const report = await page.evaluate(pageScript, rules);
        if (!report.ok && !allowInvalid) throw new ComposeError("layout", report.errors.map((e) => e.message).join(" "), report.errors);
        const shot = { type, clip: { x: 0, y: 0, width: spec.W, height: spec.H }, animations: "disabled" };
        if (type === "jpeg") shot.quality = quality || 80;
        const png = screenshot ? await page.screenshot(shot) : null;
        return { png, report };
      } finally { await page.close().catch(() => {}); }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  async close() { const b = this.browser; this.browser = null; if (b) await b.close().catch(() => {}); }
}

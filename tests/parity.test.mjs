// Parity: the new engine must produce byte-identical output to the ORIGINAL v16 script for every
// template, size and a spread of copy inputs. The only allowed differences are listed in
// DEVIATIONS and are asserted explicitly, so any new drift fails the build.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as E from "../core/engine.mjs";
import { SAMPLE, TPL_ORDER, KINDS, CANVAS } from "../core/brand.mjs";

const require = createRequire(import.meta.url);
const { load, HTML_DEFAULTS } = require("../tools/legacy-harness.cjs");
const H = load();

// Documented, intentional differences from v16.
const DEVIATIONS = {
  // Template library: white or black lockup only; T2's card uses black (decided Sept 30, 2026).
  logoColour: { t2: ["violet", "black"] },
  // Terminology (Oct 2026): Andromeda is Meta's ad-retrieval system, not a three-size file spec.
  packHeader: [" to the Andromeda spec: one image ad, three sizes, one concept.", ": one image ad, three placement sizes, one concept."],
};
function legacyGrid(tpl, kind) {
  const g = JSON.parse(JSON.stringify(H.gridSpec(tpl, kind)));
  const d = DEVIATIONS.logoColour[tpl];
  if (d) { assert.equal(g.colour, d[0]); g.colour = d[1]; }
  return g;
}

const PHONE = "+1 855 768 4135", EMAIL = "customerservice@hitlights.com";
function cases() {
  const out = [];
  for (const tpl of TPL_ORDER) {
    const s = SAMPLE[tpl];
    out.push({ name: tpl + " sample", form: { tpl, ...s, phone: PHONE, email: EMAIL } });
    out.push({ name: tpl + " html defaults", form: { tpl, ...HTML_DEFAULTS, ground: undefined } });
    out.push({ name: tpl + " empty", form: { tpl } });
    out.push({ name: tpl + " no contact, one proof", form: { tpl, ...s, p2: "", p3: "", phone: "", email: "" } });
    out.push({ name: tpl + " phone only", form: { tpl, ...s, phone: PHONE, email: "" } });
    out.push({ name: tpl + " messy text", form: { tpl, h1: '  The  "Best"\n kit ', h2: "for\tpros.", sub: 'Say "hi"  there now ok', p1: " a ", p2: "b  c", p3: "", cta: ' Shop  "Now" ', deadline: "Ends  Friday", scene: 'A "quoted"\nscene.', phone: PHONE, email: EMAIL } });
    out.push({ name: tpl + " over limits", form: { tpl, h1: "X".repeat(30), h2: "Y".repeat(30), sub: "one two", p1: "Z".repeat(40), p2: "p", p3: "q", cta: "Go", deadline: "D".repeat(40), phone: PHONE, email: EMAIL } });
    out.push({ name: tpl + " t3-style offer", form: { tpl, ...SAMPLE.t3, h1: "11% OFF", deadline: "Save 11% Before Oct 31", phone: PHONE, email: EMAIL } });
  }
  return out;
}

for (const c of cases()) {
  test("parity: " + c.name, () => {
    H.setForm(c.form);
    for (const kind of KINDS) {
      assert.equal(E.buildPrompt(c.form, kind), H.prompt_(kind), "prompt " + kind);
      const g = legacyGrid(c.form.tpl, kind);
      assert.deepEqual(E.gridSpec(c.form.tpl, kind), g, "gridSpec " + kind);
      assert.deepEqual(E.finishSpec(E.gridSpec(c.form.tpl, kind)), JSON.parse(JSON.stringify(H.finishSpec(g))), "finishSpec " + kind);
    }
    assert.deepEqual(E.expectedText(c.form), JSON.parse(JSON.stringify(H.expectedText())), "expectedText");
    assert.deepEqual(E.checkLimits(c.form).bad, JSON.parse(JSON.stringify(H.checkLimits())), "checkLimits");
  });
}

test("parity: draft brief, every template, with and without product data", async () => {
  for (const tpl of TPL_ORDER) {
    for (const [product, angle] of [[{ title: "EZDim 12V LED Dimmer Driver 40W", desc: "UL listed. 0-10V." }, "for electricians"], [null, "bedroom glow-up"], [{ title: "Strip", desc: "" }, ""]]) {
      H.setForm({ tpl, angle });
      H.setPicked(product ? { url: "https://x/y.jpg", label: product.title, title: product.title, desc: product.desc } : null);
      let brief = null;
      H.setSample({ json(b) { brief = b; return Promise.resolve({}); } });
      H.$("draft").fire("click");
      await new Promise((r) => setTimeout(r, 0));
      assert.ok(brief, "legacy draft fired");
      assert.equal(E.draftBrief(tpl, product, angle), brief, tpl + " brief");
    }
  }
  H.setSample(null); H.setPicked(null);
});

test("parity: QA prompt for 1 and 3 images", () => {
  for (const tpl of TPL_ORDER) {
    const form = { tpl, ...SAMPLE[tpl], phone: PHONE, email: EMAIL };
    H.setForm(form);
    const items = KINDS.map((k) => ({ kind: k, dims: CANVAS[k].dims, title: CANVAS[k].title, logo: legacyGrid(tpl, k) }));
    H.setRun({ S: { expect: H.expectedText() } });
    for (const g of [items, [items[1]]]) assert.equal(E.qaPrompt(E.expectedText(form), g), H.qaPrompt(g));
  }
});

test("parity: render and repaint requests", async () => {
  for (const tpl of TPL_ORDER) {
    const form = { tpl, ...SAMPLE[tpl], phone: PHONE, email: EMAIL };
    H.setForm(form);
    const S = { prompts: { master: H.prompt_("master"), portrait: H.prompt_("portrait"), landscape: H.prompt_("landscape") } };
    H.setRun({ S, productId: "media-1", masterJob: "job-m", pass: 0, credits: 0 });
    for (const [kind, i] of [["master", 1], ["portrait", 2], ["landscape", 3]]) {
      const r = JSON.parse(JSON.stringify(H.renderReq(kind, i)));
      assert.deepEqual(E.renderParams(kind, { productId: "media-1", masterJob: "job-m", prompt: S.prompts[kind] }), r.params);
    }
    const sent = [];
    H.setMcp({ callTool(server, tool, input) { sent.push(JSON.parse(JSON.stringify(input))); return Promise.resolve({ payload: { jobs: [] } }); } });
    const list = KINDS.map((k) => ({ kind: k, dims: CANVAS[k].dims, job: "job-" + k, logo: H.gridSpec(tpl, k) }));
    await H.repaint(list).catch(() => {});
    assert.ok(sent.length >= 1);
    sent[0].requests.forEach((q, i) => assert.deepEqual(E.repaintParams(list[i].kind, { job: list[i].job, logo: list[i].logo }), q.params));
  }
  H.setMcp(null);
});

test("parity: prompt pack steps 1-3 and Logo Grid lines", () => {
  const d = new Date();
  for (const tpl of TPL_ORDER) {
    const form = { tpl, ...SAMPLE[tpl], phone: PHONE, email: EMAIL };
    H.setForm(form);
    const picked = { url: "https://cdn.shopify.com/p.jpg", label: "EZDim Pro" };
    H.setPicked(picked);
    const a = E.packText(form, picked, d), b0 = H.packText();
    assert.ok(b0.includes(DEVIATIONS.packHeader[0]), "v16 pack header as documented");
    const b = b0.replace(DEVIATIONS.packHeader[0], DEVIATIONS.packHeader[1]);
    const cut = (s) => s.slice(0, s.indexOf("FINISHING"));
    assert.equal(cut(a), cut(b), "steps 1-3");
    const grid = (s) => s.slice(s.indexOf("By hand"));
    let lg = grid(b);
    const dv = DEVIATIONS.logoColour[tpl];
    if (dv) lg = lg.split(dv[0] + " lockup").join(dv[1] + " lockup");
    assert.equal(grid(a), lg, "logo grid lines");
  }
  H.setPicked(null);
});

test("parity: folder name", () => {
  const d = new Date();
  for (const nm of ["EZDim 12V LED Dimmer Driver 40W", 'Strip: 16ft "Pro" / 24V', "https://x.com/a.jpg", "", "  a   b  "]) {
    H.setPicked(nm ? { title: nm, label: nm } : null);
    assert.equal(E.folderName(nm, d), H.folderName());
  }
  H.setPicked(null);
});

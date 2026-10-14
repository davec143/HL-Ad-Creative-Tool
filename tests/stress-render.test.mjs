// Real-browser stress checks for shape extremes, rejected inputs and queue recovery.
// Fixtures are generated in memory; no customer photos, network or paid renderer.
import test from "node:test";
import assert from "node:assert/strict";
import { Composer, chromiumPath } from "../composer/render.mjs";
import { layoutFor } from "../composer/templates.mjs";
import { SAMPLE, CANVAS } from "../core/brand.mjs";
import { validateForGenerate } from "../core/engine.mjs";

const BROWSER = !!chromiumPath();
const TEMPLATES = ["t1", "t2", "t3", "t4", "t5"];
const KINDS = ["master", "portrait", "landscape"];
const product = (w = 500, h = 800) => "data:image/svg+xml;base64," + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="#ededed" stroke="#333" stroke-width="4"/><path d="M 4 4 L ${w - 4} ${h - 4}" stroke="#675185" stroke-width="8"/></svg>`).toString("base64");
const form = (tpl, over = {}) => ({ tpl, ...SAMPLE[tpl], phone: "+1 855 768 4135", email: "customerservice@hitlights.com", ...(tpl === "t3" ? { h1: "11% OFF", deadline: "Save 11% Before Oct 31" } : {}), ...over });
let composer;
const getComposer = () => composer || (composer = new Composer());
test.after(async () => { if (composer) await composer.close(); });

test("all 15 placements accept narrow, wide and square product photos", { skip: !BROWSER && "no Chromium" }, async () => {
  for (const [w, h] of [[120, 1000], [1000, 120], [800, 800]]) {
    for (const tpl of TEMPLATES) for (const kind of KINDS) {
      const r = await getComposer().compose(layoutFor(tpl, kind, form(tpl)), { product: product(w, h), scene: null }, { screenshot: false });
      assert.ok(r.report.ok, `${tpl}/${kind}/${w}x${h}: ${JSON.stringify(r.report.errors)}`);
      assert.ok(r.report.rects.product.w > 0 && r.report.rects.product.h > 0);
    }
  }
});

test("every template rejects a broken scene image, including the T3 scene card", { skip: !BROWSER && "no Chromium" }, async () => {
  for (const tpl of TEMPLATES) {
    await assert.rejects(getComposer().compose(layoutFor(tpl, "master", form(tpl)), { product: product(), scene: "data:image/png;base64,YmFk" }, { screenshot: false }),
      (e) => e.code === "layout" && e.errors.some((x) => x.code === "SCENE"), tpl);
  }
});

test("a second-line-only headline accepted by the form also composes", { skip: !BROWSER && "no Chromium" }, async () => {
  for (const tpl of TEMPLATES.filter((x) => x !== "t3")) for (const kind of KINDS) {
    const f = form(tpl, { h1: "", h2: "Made to shine" });
    assert.deepEqual(validateForGenerate(f, { hasImage: true }), []);
    const r = await getComposer().compose(layoutFor(tpl, kind, f), { product: product(), scene: null }, { screenshot: false });
    assert.ok(r.report.ok, tpl + "/" + kind);
  }
  for (const over of [{ h1: "" }, { deadline: "" }]) {
    await assert.rejects(getComposer().compose(layoutFor("t3", "master", form("t3", over)), { product: product(), scene: null }, { screenshot: false }),
      (e) => e.code === "layout" && e.errors.some((x) => x.code === "MISSING"));
  }
});

test("concurrent composition survives invalid images and copy without leaking pages", { skip: !BROWSER && "no Chromium" }, async () => {
  const jobs = Array.from({ length: 20 }, (_, i) => {
    const tpl = TEMPLATES[i % TEMPLATES.length], kind = KINDS[i % KINDS.length];
    const invalidImage = i % 5 === 1, invalidCopy = i % 5 === 2;
    const f = form(tpl, invalidCopy ? { h1: "W".repeat(300) } : {});
    return { expected: !(invalidImage || invalidCopy), promise: getComposer().compose(layoutFor(tpl, kind, f), { product: invalidImage ? "data:image/png;base64,YmFk" : product(), scene: null }, { screenshot: false }) };
  });
  const results = await Promise.allSettled(jobs.map((j) => j.promise));
  results.forEach((r, i) => {
    assert.equal(r.status === "fulfilled", jobs[i].expected, "job " + i);
    if (r.status === "rejected") assert.equal(r.reason.code, "layout");
  });
  assert.equal(getComposer().browser.contexts().length, 0, "each success/failure closes its isolated page/context");
});

test("composition reconnects after Chromium exits and retains exact output dimensions", { skip: !BROWSER && "no Chromium" }, async () => {
  const c = getComposer();
  await c.ensure(); await c.browser.close();
  for (const kind of KINDS) {
    const r = await c.compose(layoutFor("t1", kind, form("t1")), { product: product(), scene: null });
    assert.equal(r.png.readUInt32BE(16), CANVAS[kind].W);
    assert.equal(r.png.readUInt32BE(20), CANVAS[kind].H);
  }
  assert.equal(c.browser.contexts().length, 0);
});

test("a browser exit during a render does not poison the queued next render", { skip: !BROWSER && "no Chromium" }, async () => {
  const c = getComposer(), browser = await c.ensure();
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (opts) => { const page = await newPage(opts); await browser.close(); return page; };
  const spec = layoutFor("t1", "master", form("t1")), images = { product: product(), scene: null };
  const results = await Promise.allSettled([c.compose(spec, images, { screenshot: false }), c.compose(spec, images, { screenshot: false })]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
  assert.ok(results[1].value.report.ok);
  assert.equal(c.browser.contexts().length, 0);
});

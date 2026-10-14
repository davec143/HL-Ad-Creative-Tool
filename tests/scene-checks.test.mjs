// Scene QA tests exercise prompts, malformed provider replies and persisted verdicts.
// No image generation, network, Chromium or paid providers are used here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scenePrompt, sceneCheckPrompt, visibleSceneCheckPrompt, parseSceneCheck } from "../core/scene.mjs";
import { COMPOSED_TEMPLATES, SCENE_LAYOUTS, resolveSceneLayout } from "../core/composed.mjs";
import { SAMPLE } from "../core/brand.mjs";
import { deliverability } from "../core/gates.mjs";
import { Store } from "../server/store.mjs";
import { Pipeline } from "../server/pipeline.mjs";
import { readConfig } from "../server/config.mjs";

function setup(t, llm) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hlab-scene-qa-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir), cfg = readConfig({ DATA_DIR: dir });
  const pipeline = new Pipeline({ cfg, store, llm, renderer: {}, log: { error() {} } });
  const run = pipeline.create({ form: { tpl: "t3", ...SAMPLE.t3, sceneLayout: "panel" }, picked: { title: "Local QA fixture", url: "https://cdn.shopify.com/test.png" } });
  store.runDir(run.id);
  run.S.source.file = "source.png";
  fs.writeFileSync(store.filePath(run.id, run.S.source.file), "original product reference");
  run.cutout = { state: "approved" };
  run.scene.qa = { state: "fail", issues: ["White border in source photo"], version: run.scene.version };
  for (const x of run.items) {
    x.file = x.kind + ".jpg"; x.state = "done"; x.output = { ok: true };
    fs.writeFileSync(store.filePath(run.id, x.file), "panel fixture " + x.kind);
  }
  return { pipeline, store, run };
}

test("finished scene QA uses the resolved treatment for all eleven templates and three choices", () => {
  assert.equal(COMPOSED_TEMPLATES.length, 11);
  for (const tpl of COMPOSED_TEMPLATES) for (const sceneLayout of SCENE_LAYOUTS) {
    const prompt = visibleSceneCheckPrompt({ tpl, sceneLayout });
    const expected = { full: "Selected scene treatment: full background.", panel: "Selected scene treatment: photo panel.", none: "Selected scene treatment: product graphic without a room photograph." }[resolveSceneLayout(tpl, sceneLayout)];
    assert.ok(prompt.includes(expected), tpl + "/" + sceneLayout);
    assert.doesNotMatch(prompt, /tilted rounded photo card|template's blur/);
    assert.match(prompt, /three finished social ads at their native pixel sizes/);
    assert.match(prompt, /not approval of the ad's overall design/);
  }
});

test("a graphic without a scene is explicitly not applicable and still requires cutout and output checks", () => {
  const item = { composed: true, state: "done", file: "master.jpg", output: { ok: true }, cutout: { state: "approved" }, sceneRequired: false, sceneQa: { state: "not_applicable", reason: "layout_no_scene" } };
  assert.equal(deliverability(item).deliverable, true);
  for (const change of [
    { sceneRequired: undefined }, { sceneRequired: true }, { sceneQa: null },
    { sceneQa: { state: "not_applicable" } }, { sceneQa: { state: "off" } },
    { sceneQa: { state: "fail", issues: ["visible margin"] } },
    { cutout: { state: "auto" } }, { output: { ok: false } }, { file: null },
  ]) assert.equal(deliverability({ ...item, ...change }).deliverable, false, JSON.stringify(change));
});

test("saved sets without the scene selector are assessed as shown without a new layout assumption", () => {
  for (const tpl of ["t1", "t2", "t3", "t4", "t5"]) {
    const prompt = visibleSceneCheckPrompt({ tpl });
    assert.match(prompt, /saved set predates the scene-treatment selector/);
    assert.doesNotMatch(prompt, /Selected scene treatment:/);
  }
});

test("scene generation keeps T3 room detail clear and source screening limits its verdict scope", () => {
  const prompt = scenePrompt({ tpl: "t3", sceneLayout: "full", scene: "A living room at dusk." });
  assert.match(prompt, /clearly visible architectural details throughout the room/);
  assert.doesNotMatch(prompt, /softly out-of-focus room background/);
  assert.match(sceneCheckPrompt(), /not the finished ad's design, readability, product fidelity or advertising claims/);
});

test("scene check replies fail closed when the required issues array is missing or malformed", () => {
  for (const issues of [undefined, null, "", {}, [null], [false], [{}]]) {
    assert.equal(parseSceneCheck({ verdict: "pass", issues }).ok, false, JSON.stringify(issues));
  }
  assert.deepEqual(parseSceneCheck({ verdict: "pass", issues: [] }), { ok: true, verdict: "pass", issues: [] });
  assert.deepEqual(parseSceneCheck({ verdict: "pass", issues: ["  visible margin  "] }), { ok: true, verdict: "uncertain", issues: ["visible margin"] });
});

test("a mode change that exposes a source defect invalidates approval for the previous output pixels", async (t) => {
  const calls = [];
  let verdict = "pass";
  const { pipeline, store, run } = setup(t, { json: async ({ prompt, images }) => {
    calls.push({ prompt, images: images.map((x) => x.toString()) });
    return { verdict, issues: verdict === "pass" ? [] : ["Landscape: white margin visible at left"] };
  } });
  await pipeline.stepVisibleSceneQa(run); pipeline.syncComposed(run);
  assert.equal(calls.length, 1); assert.equal(calls[0].images.length, 4);
  assert.match(calls[0].prompt, /Selected scene treatment: photo panel/);
  assert.ok(run.items.every((x) => deliverability(x).deliverable));
  assert.equal(run.scene.qa.sourceCheck.state, "fail");
  await pipeline.stepVisibleSceneQa(run);
  assert.equal(calls.length, 1, "unchanged output pixels reuse the verdict");
  run.scene.qa.state = "uncertain";
  run.scene.qa.approved = { at: Date.now(), version: run.scene.version };
  run.form.sceneLayout = "full";
  fs.writeFileSync(store.filePath(run.id, run.items[2].file), "full background exposes margin");
  verdict = "fail";
  await pipeline.stepVisibleSceneQa(run); pipeline.syncComposed(run);
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /Selected scene treatment: full background/);
  assert.equal(run.scene.qa.approved, undefined);
  assert.equal(run.scene.qa.state, "fail");
  assert.ok(run.items.every((x) => !deliverability(x).deliverable));
  assert.equal(store.getRun(run.id).scene.qa.state, "fail", "failure survives reload");
});

test("a malformed final check cannot replace a failed source check with a pass", async (t) => {
  const { pipeline, run } = setup(t, { json: async () => ({ verdict: "pass" }) });
  await pipeline.stepVisibleSceneQa(run); pipeline.syncComposed(run);
  assert.equal(run.scene.qa.state, "error");
  assert.equal(run.scene.qa.code, "bad_reply");
  assert.equal(run.scene.qa.sourceCheck.state, "fail");
  assert.ok(run.items.every((x) => !deliverability(x).deliverable));
});

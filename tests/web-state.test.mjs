// Run the actual page handlers with deferred HTTP responses. The tiny DOM below only supplies
// browser plumbing; rendering functions are spies so these tests exercise response ownership.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { TPL, TPL_ORDER, SAMPLE, LIMITS, FLAGTXT } from "../core/brand.mjs";
import { checkLimits, validateForGenerate, packText, FORM_FIELDS } from "../core/engine.mjs";
import { isComposed, COMPOSED_SAMPLE_SCENE, resolveSceneLayout } from "../core/composed.mjs";

function page() {
  const nodes = new Map(), requests = [], paints = [], previews = [], errors = [], timers = new Map();
  let nextTimer = 0;
  const node = () => ({ value: "", hidden: true, textContent: "", innerHTML: "", disabled: false,
    style: {}, children: [], childNodes: [], listeners: {}, classList: { toggle() {}, add() {} },
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
    insertAdjacentElement() {}, setAttribute() {}, querySelectorAll() { return []; },
    appendChild(n) { this.children.push(n); this.childNodes.push(n); return n; }, append(...ns) { ns.forEach(n => this.appendChild(n)); },
    prepend() {}, scrollIntoView() {}, replaceWith() {}, remove() {},
  });
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  get("ground").value = "t1";
  for (const key of FORM_FIELDS) get(key).value = SAMPLE.t1[key] || "";
  const saved = new Map();
  const ctx = vm.createContext({ TPL, TPL_ORDER, SAMPLE, LIMITS, FLAGTXT, checkLimits, validateForGenerate, packText, FORM_FIELDS, isComposed, COMPOSED_SAMPLE_SCENE, resolveSceneLayout,
    document: { getElementById: get, createElement: node, createTextNode: text => ({ textContent: text }), querySelector: node, querySelectorAll: () => [] },
    localStorage: { getItem: k => saved.get(k), setItem: (k,v) => saved.set(k,v), removeItem: k => saved.delete(k) },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({url, options, resolve: (body, status = 200) => resolve({ok: status < 400, status, json: async () => body}), reject})),
    crypto: { randomUUID: () => "test-request-id" }, URLSearchParams, location: { search: "" }, history: { replaceState() {} }, window: { scrollTo() {} },
    confirm: () => true, paints, previews, errors, console,
  });
  const source = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "").replace(/\nboot\(\);\s*$/, "\n");
  vm.runInContext(source, ctx);
  vm.runInContext("const actualPaintRun = paintRun; paintRun = r => paints.push(r.id); paintPreview = p => previews.push(p); fail = (a,b) => errors.push([a,b]); loadRuns = async () => {}; loadBatches = async () => {}; refreshStatus = async () => {};", ctx);
  return { ctx, get, requests, paints, previews, errors, timers, saved,
    run: code => vm.runInContext(code, ctx),
    event: async (id, name) => { for (const fn of get(id).listeners[name] || []) await fn({ target: get(id) }); },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test("switching sets rejects delayed polls, including a delayed 404", async () => {
  for (const staleStatus of [200, 404]) {
    const p = page();
    p.run('openRun("runA"); openRun("runB");');
    p.requests[1].resolve({ run: { id: "runB", status: "done" }, busy: false }); await flush();
    p.requests[0].resolve({ run: { id: "runA", status: "running" }, error: "Gone" }, staleStatus); await flush();
    assert.deepEqual(p.paints, ["runB"]);
    assert.equal(p.run("currentRun"), "runB");
    assert.equal(p.saved.get("hl-run"), "runB");
    assert.equal(p.timers.size, 0, "obsolete requests cannot restart polling");
  }
});

test("out-of-order polls of the same set cannot restore older state", async () => {
  const p = page(); p.run('currentRun = "runA"; poll(); poll();');
  p.requests[1].resolve({run:{id:"runA",status:"done"}, busy:false}); await flush();
  p.requests[0].resolve({run:{id:"runA",status:"running"}, busy:"runA"}); await flush();
  assert.deepEqual(p.paints, ["runA"]);
  assert.equal(p.timers.size, 0);
});

test("a completed action on a previous set cannot switch the selected set", async () => {
  const p = page(); p.run('currentRun = "runA"; act("regenerate"); openRun("runB");');
  p.requests[1].resolve({run:{id:"runB",status:"done"},busy:false}); await flush();
  p.requests[0].resolve({run:{id:"newRunA",status:"queued"}}); await flush();
  assert.equal(p.run("currentRun"), "runB");
  assert.deepEqual(p.paints, ["runB"]);
  assert.equal(p.requests.length, 2);
});

test("a slow Generate response respects a subsequently selected set", async () => {
  for (const status of [201, 503]) {
    const p=page(); p.run('currentRun="runOld"; picked={url:"https://cdn.shopify.com/product.jpg"};');
    const generating=p.event("go","click");
    p.run('openRun("runB")');
    p.requests[1].resolve({run:{id:"runB",status:"running"},busy:"runB"}); await flush();
    p.requests[0].resolve({batch:{id:"batchA",status:"queued",runs:[]},error:"Restarting"},status); await generating;
    assert.equal(p.run("currentRun"),"runB");
    assert.deepEqual(p.paints,["runB"]);
    assert.equal(p.get("go").disabled,true,"a stale error cannot re-enable Generate");
  }
});

test("product or copy edits discard a preview still in flight", async () => {
  for (const edit of ['picked = {url:"https://cdn.shopify.com/other.jpg"}', '$("h1").value = "EDITED COPY"']) {
    const p = page(); p.run('picked = {url:"https://cdn.shopify.com/one.jpg"}; refreshPreview();');
    p.run(edit);
    p.requests[0].resolve({cutout:{sha:"old"},sizes:[]}); await flush();
    assert.deepEqual(p.previews, []);
    assert.equal(p.get("previewBtn").disabled, false);
  }
});

test("a draft arriving after an edit never overwrites the user's copy", async () => {
  const p = page(); p.run('picked = {url:"https://cdn.shopify.com/one.jpg",title:"One"};');
  const drafting = p.event("draft", "click");
  p.get("h1").value = "MY EDIT";
  p.requests[0].resolve({form:{h1:"LATE DRAFT"}}); await drafting;
  assert.equal(p.get("h1").value, "MY EDIT");
  assert.match(p.get("drafthint").textContent, /changed|edited/i);
  assert.equal(p.get("draft").disabled, false);
});

test("the latest catalog query owns the results", async () => {
  const p = page(); p.get("q").value = "dimmer"; p.run("search()");
  p.get("q").value = "strip"; p.run("search()");
  p.requests[1].resolve({products:[]}); await flush();
  p.requests[0].resolve({products:[]}); await flush();
  assert.match(p.get("log").textContent, /strip/);
});

test("a variant without its own image uses the product photo, not the prior variant", () => {
  const p=page();
  p.run('picked={title:"Switch",url:"https://cdn.shopify.com/default.jpg",images:[{url:"https://cdn.shopify.com/default.jpg"}]}; bindVariant(picked,{id:"black",title:"Black",image:{url:"https://cdn.shopify.com/black.jpg"}}); bindVariant(picked,{id:"white",title:"White",image:null});');
  assert.equal(p.run("picked.url"),"https://cdn.shopify.com/default.jpg");
  assert.equal(p.run("picked.variantId"),"white");
});

test("clearing or invalidating a pasted photo clears the old product selection", async () => {
  const p=page(); p.run('picked={url:"https://cdn.shopify.com/old.jpg"};');
  p.get("imgurl").value="http://invalid.example/photo.jpg";
  await p.event("imgurl","change");
  assert.equal(p.run("picked"),null);
  assert.equal(p.get("picked").hidden,true);
});

test("a delayed batch poll cannot replace a newer selected set", async () => {
  const p = page(); p.run('openBatch("batchA"); openRun("runB");');
  p.requests[1].resolve({run:{id:"runB",status:"done"},busy:false}); await flush();
  p.requests[0].resolve({batch:{id:"batchA",status:"running",count:5,runs:[{id:"runA",status:"running",setNo:1}],credits:2,completed:0},busy:"batchA"}); await flush();
  assert.equal(p.run("currentBatch"), null); assert.equal(p.run("currentRun"), "runB");
  assert.deepEqual(p.paints,["runB"]); assert.equal(p.timers.size,0);
});

test("batch navigation keeps each set action bound to the chosen child", async () => {
  const p = page(); p.run('openBatch("batchA",null,"run2")');
  p.requests[0].resolve({batch:{id:"batchA",status:"done",count:2,runs:[{id:"run1",status:"done",setNo:1},{id:"run2",status:"done",setNo:2}],credits:4,completed:2,readyFiles:6},busy:false}); await flush();
  assert.deepEqual(p.paints,["run2"]); assert.equal(p.run("currentRun"),"run2"); assert.equal(p.saved.get("hl-batch"),"batchA");
});

test("unknown Generate outcome reuses request id when retried, including after reload", async () => {
  const p=page(); p.run('picked={url:"https://cdn.shopify.com/product.jpg"};'); p.get("setCount").value="5";
  const first=p.event("go","click"); p.requests[0].reject(new Error("Connection lost")); await first;
  const one=JSON.parse(p.requests[0].options.body); assert.equal(one.count,5); assert.ok(one.requestId);
  p.run('pendingGeneration=null');
  const retry=p.event("go","click"); const two=JSON.parse(p.requests[1].options.body);
  assert.equal(two.requestId,one.requestId); assert.equal(p.requests[1].url,"/api/batches");
  p.requests[1].resolve({batch:{id:"batchA",status:"queued",count:5,runs:[],credits:0,completed:0}},201); await retry;
  assert.equal(p.saved.has("hl-pending-generation"),false); assert.equal(p.run("currentBatch"),"batchA");
});

test("Generate cannot submit twice while the admission request is pending", async () => {
  const p=page(); p.run('picked={url:"https://cdn.shopify.com/product.jpg"};');
  const first=p.event("go","click"); await p.event("go","click"); assert.equal(p.requests.length,1);
  p.requests[0].resolve({error:"Busy"},409); await first; assert.equal(p.get("go").disabled,false);
});

test("batch cancel response cannot reopen a batch after switching away", async () => {
  const p=page(); p.run('currentBatch="batchA"; batchAction("cancel"); openRun("runB");');
  p.requests[1].resolve({run:{id:"runB",status:"done"},busy:false}); await flush();
  p.requests[0].resolve({batch:{id:"batchA",status:"cancelled",runs:[]}},202); await flush();
  assert.equal(p.run("currentBatch"),null); assert.equal(p.run("currentRun"),"runB"); assert.equal(p.requests.length,2);
});

test("cost estimate and button label scale to five three-size sets", () => {
  const p=page(); p.get("setCount").value="5"; p.run('showCost()');
  assert.match(p.get("cost").textContent,/5 sets · 15 files · about 10 Higgsfield credits/);
  assert.equal(p.get("go").textContent,"Generate 5 sets · 15 files");
});

test("a delayed Generate response releases the button after navigating to a completed set", async () => {
  for (const status of [201, 503]) {
    const p = page(); p.run('picked={url:"https://cdn.shopify.com/product.jpg"};');
    const generating = p.event("go", "click");
    p.run('openRun("runB")');
    p.requests[1].resolve({ run: { id: "runB", status: "done" }, busy: false }); await flush();
    assert.equal(p.get("go").disabled, true, "admission is still pending");
    p.requests[0].resolve({ batch: { id: "batchA", status: "queued", runs: [] }, error: "Restarting" }, status); await generating;
    assert.equal(p.run("currentRun"), "runB");
    assert.equal(p.run("generationBusy"), false);
    assert.equal(p.get("go").disabled, false);
    assert.equal(p.timers.size, 0);
  }
});

test("a busy retry cannot discard the request ID from an earlier unknown Generate outcome", async () => {
  const p = page();
  p.run('let nextId=0; crypto.randomUUID=()=>"request-id-"+(++nextId); picked={url:"https://cdn.shopify.com/product.jpg"};');
  let generating = p.event("go", "click");
  p.requests[0].reject(new Error("Connection lost")); await generating;
  generating = p.event("go", "click");
  p.requests[1].resolve({ error: "An admission is still running", code: "busy" }, 409); await generating;
  p.run("pendingGeneration=null");
  generating = p.event("go", "click");
  const ids = p.requests.map((r) => JSON.parse(r.options.body).requestId);
  assert.deepEqual(ids, ["request-id-1", "request-id-1", "request-id-1"]);
  p.requests[2].resolve({ batch: { id: "batchA", status: "done", count: 1, runs: [], credits: 2, completed: 1 } }); await generating;
  assert.equal(p.saved.has("hl-pending-generation"), false);
});

test("a paused batch displays the actionable server message", () => {
  const p = page();
  p.run('paintBatch({id:"batchA",status:"paused",count:1,runs:[],credits:2,completed:0,error:{code:"ambiguous",message:"Resolve the unconfirmed render."}},false)');
  assert.ok(p.get("batch").children.some((n) => n.textContent === "Resolve the unconfirmed render."));
});

test("legacy fallback keeps one set and sends the supported single-run route", async () => {
  const p = page();
  p.run('status={composed:[],creditsPerRender:2,renderer:{needsAuth:false}}; picked={url:"https://cdn.shopify.com/product.jpg"};');
  p.get("setCount").value = "5"; p.run("showCost()");
  assert.equal(p.get("setCount").value, "1"); assert.equal(p.get("setCount").disabled, true);
  const generating = p.event("go", "click");
  assert.equal(p.requests[0].url, "/api/runs");
  p.requests[0].resolve({ run: { id: "runLegacy", status: "queued" } }, 201); await generating;
  assert.equal(p.run("currentRun"), "runLegacy");
});

test("T6 graphic uses one zero-credit set and does not require Higgsfield sign-in", async () => {
  const p = page(); p.get("ground").value = "t6"; p.get("sceneLayout").value = "template";
  for (const key of FORM_FIELDS) if (key !== "sceneLayout") p.get(key).value = SAMPLE.t6[key] || "";
  p.run('status={composed:["t6"],creditsPerRender:2,renderer:{needsAuth:true}}; picked={url:"https://cdn.shopify.com/product.jpg"};');
  p.get("setCount").value = "5"; p.run("showCost()");
  assert.equal(p.get("setCount").value, "1"); assert.equal(p.get("setCount").disabled, true);
  assert.match(p.get("cost").textContent, /1 set · 3 files · about 0 Higgsfield credits/);
  const generating = p.event("go", "click");
  assert.equal(p.requests.length, 1, JSON.stringify(p.errors));
  assert.equal(p.requests[0].url, "/api/batches");
  p.requests[0].resolve({ error: "Busy", code: "busy" }, 409); await generating;
  p.get("sceneLayout").value = "full"; await p.event("sceneLayout", "change");
  assert.equal(p.get("setCount").disabled, false);
  assert.match(p.get("cost").textContent, /about 2 Higgsfield credits/);
});

test("no-scene output shows N/A and still offers free recomposition", async () => {
  const p = page();
  p.run('actualPaintRun({id:"runGraphic",status:"done",composed:true,items:[],attempts:[],sceneRequired:false,scene:{state:"not_applicable",version:1,qa:{state:"not_applicable",reason:"layout_no_scene"}}},false);');
  const allText = (n) => [n.textContent || "", ...(n.children || []).map(allText)].join(" ");
  assert.match(allText(p.get("out")), /Scene screening does not apply/);
  assert.doesNotMatch(allText(p.get("out")), /one paid render/);
  const button = p.get("runbtns").children.find((n) => n.textContent === "Re-compose (0 credits)");
  assert.ok(button);
  assert.doesNotMatch(allText(p.get("runbtns")), /New scene/);
  const acting = button.onclick();
  assert.equal(p.requests[0].url, "/api/runs/runGraphic/refinish");
  p.requests[0].resolve({ run: { id: "runGraphic" } }, 202); await acting;
});

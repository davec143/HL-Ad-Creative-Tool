// Run the actual page handlers with deferred HTTP responses. The tiny DOM below only supplies
// browser plumbing; rendering functions are spies so these tests exercise response ownership.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { TPL, SAMPLE, LIMITS, FLAGTXT } from "../core/brand.mjs";
import { checkLimits, validateForGenerate, packText, FORM_FIELDS } from "../core/engine.mjs";
import { isComposed, COMPOSED_SAMPLE_SCENE } from "../core/composed.mjs";

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
  const ctx = vm.createContext({ TPL, SAMPLE, LIMITS, FLAGTXT, checkLimits, validateForGenerate, packText, FORM_FIELDS, isComposed, COMPOSED_SAMPLE_SCENE,
    document: { getElementById: get, createElement: node, createTextNode: text => ({ textContent: text }), querySelector: node, querySelectorAll: () => [] },
    localStorage: { getItem: k => saved.get(k), setItem: (k,v) => saved.set(k,v), removeItem: k => saved.delete(k) },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({url, options, resolve: (body, status = 200) => resolve({ok: status < 400, status, json: async () => body}), reject})),
    URLSearchParams, location: { search: "" }, history: { replaceState() {} }, window: { scrollTo() {} },
    confirm: () => true, paints, previews, errors, console,
  });
  const source = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "").replace(/\nboot\(\);\s*$/, "\n");
  vm.runInContext(source, ctx);
  vm.runInContext("paintRun = r => paints.push(r.id); paintPreview = p => previews.push(p); fail = (a,b) => errors.push([a,b]); loadRuns = async () => {}; refreshStatus = async () => {};", ctx);
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
    p.requests[0].resolve({run:{id:"newRunA",status:"queued"},error:"Restarting"},status); await generating;
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

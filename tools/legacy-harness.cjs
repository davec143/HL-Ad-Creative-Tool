// Runs the ORIGINAL v16 page script (legacy/v16/source/b_script.js) unchanged inside a
// minimal fake DOM, and exposes its internals. This is the parity oracle: every prompt,
// spec and brief the new engine produces is compared byte-for-byte against this.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "legacy", "v16", "source", "b_script.js");

// Default form values as they appear in legacy/v16/source/b_head.html.
const HTML_DEFAULTS = {
  ground: "t1", q: "", imgurl: "", imgname: "", angle: "",
  h1: "DRIVER + DIMMER.", h2: "ONE GANG BOX.", deadline: "", sub: "",
  p1: "UL Listed & Class 2", p2: "100% to 0.3% dimming", p3: "6-year warranty",
  cta: "SHOP EZDIM PRO", phone: "+1 855 768 4135", email: "customerservice@hitlights.com",
  scene: "A licensed electrician's gloved hands seating the product into a single steel gang box in an open drywall wall, neat copper conductors visible, deep violet shadow behind.",
};

function makeDom() {
  const byId = new Map();
  function el(id) {
    const listeners = {};
    const e = {
      id, value: "", hidden: false, disabled: false, checked: true, textContent: "", innerHTML: "",
      className: "", type: "", href: "", target: "", rel: "", src: "", alt: "",
      dataset: {}, style: {}, children: [], childNodes: [],
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, getAttribute() { return null; },
      appendChild(c) { this.children.push(c); this.childNodes.push(c); return c; },
      insertAdjacentElement() {}, replaceWith() {}, remove() {}, select() {}, scrollTo() {},
      closest() { return null; }, querySelector() { return el(); }, querySelectorAll() { return []; },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      fire(type) { (listeners[type] || []).forEach((fn) => fn({})); },
      attachShadow() { return el(); },
    };
    return e;
  }
  const document = {
    getElementById(id) {
      if (!byId.has(id)) { const e = el(id); if (id in HTML_DEFAULTS) e.value = HTML_DEFAULTS[id]; byId.set(id, e); }
      return byId.get(id);
    },
    createElement() { return el(); },
    createTextNode(t) { return { textContent: t }; },
    querySelector() { return el(); },
    querySelectorAll() { return []; },
    head: el(), body: el(),
  };
  return { document, byId };
}

function load() {
  let src = fs.readFileSync(SRC, "utf8");
  const tailMarker = "  boot(false);\n})();";
  if (!src.includes(tailMarker)) throw new Error("v16 script tail changed; harness needs updating");
  src = src.replace(tailMarker, "  boot(false);\n  globalThis.__HL={" +
    "BRAND:BRAND,TPL:TPL,SAMPLE:SAMPLE,LIMITS:LIMITS,CANVAS:CANVAS,KINDS:KINDS,LOGOGRID:LOGOGRID,FIELD:FIELD," +
    "SAFE_TOP:SAFE_TOP,LOGO_AR:LOGO_AR,LOGOWHERE:LOGOWHERE,LOGO_URL:LOGO_URL,FLAGTXT:FLAGTXT,BLOCKING:BLOCKING," +
    "CREDITS_PER_RENDER:CREDITS_PER_RENDER,ARFOR:ARFOR,PHOTO_TRADE:PHOTO_TRADE,PHOTO_LIFE:PHOTO_LIFE," +
    "prompt_:prompt_,gridSpec:gridSpec,finishSpec:finishSpec,expectedText:expectedText,checkLimits:checkLimits," +
    "packText:packText,qaPrompt:qaPrompt,renderReq:renderReq,repaint:repaint,snapshot:snapshot,folderName:folderName," +
    "setPicked:function(p){picked=p},setRun:function(r){RUN=r},setSample:function(s){sample=s},setMcp:function(m){mcp=m}," +
    "swapSamples:swapSamples,applyTpl:applyTpl};\n})();");
  const { document, byId } = makeDom();
  const window = { scrollTo() {} };
  const ctx = {
    document, window, console, navigator: {}, localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout, clearTimeout, Promise, Date, Math, JSON, atob: (s) => Buffer.from(s, "base64").toString("binary"),
    Blob: function () {}, Uint8Array,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "b_script.js" });
  const HL = ctx.__HL;
  HL.$ = (id) => document.getElementById(id);
  // Set every form field at once; unspecified fields are blanked so cases are explicit.
  HL.setForm = (form) => {
    for (const id of ["h1", "h2", "sub", "p1", "p2", "p3", "cta", "phone", "email", "deadline", "scene", "angle"]) {
      document.getElementById(id).value = form[id] == null ? "" : String(form[id]);
    }
    document.getElementById("ground").value = form.tpl || "t1";
  };
  HL.byId = byId;
  return HL;
}

module.exports = { load, HTML_DEFAULTS };

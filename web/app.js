// HitLights Ad Builder page. Talks to this app's own API; shares core/engine.mjs with the server
// so limits, prompts and the prompt pack are computed by exactly the same code in both places.
import { TPL, SAMPLE, LIMITS, FLAGTXT } from "/core/brand.mjs";
import { checkLimits, validateForGenerate, packText, FORM_FIELDS } from "/core/engine.mjs";
import { isComposed, COMPOSED_SAMPLE_SCENE } from "/core/composed.mjs";

const $ = (id) => document.getElementById(id);
const logEl = $("log"), outEl = $("out");
let status = null, picked = null, currentRun = null, pollTimer = null, lastTpl = "t1";
// Composed templates: the server's list wins (COMPOSED_TEMPLATES can switch them off).
const composedNow = (tpl) => (status && Array.isArray(status.composed) ? status.composed.includes(tpl) : isComposed(tpl));
// Sample copy, with a space-and-light scene for composed templates.
function sampleFor(tpl) { const s = { ...(SAMPLE[tpl] || {}) }; if (composedNow(tpl) && COMPOSED_SAMPLE_SCENE[tpl]) s.scene = COMPOSED_SAMPLE_SCENE[tpl]; return s; }

// ---------- small helpers ----------
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let j = {}; try { j = await res.json(); } catch { j = {}; }
  if (res.status === 401 && j.code === "login") { showLogin(); throw Object.assign(new Error("Sign in first."), { code: "login" }); }
  if (!res.ok) throw Object.assign(new Error(j.error || ("HTTP " + res.status)), { code: j.code, status: res.status });
  return j;
}
function fail(title, body) {
  const d = el("div", "err"); d.appendChild(el("b", null, title)); d.appendChild(document.createTextNode(body || ""));
  outEl.prepend(d); d.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function form() {
  const f = { tpl: $("ground").value };
  for (const k of FORM_FIELDS) f[k] = $(k) ? $(k).value : "";
  return f;
}
function store(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } }
function recall(k) { try { return localStorage.getItem(k); } catch { return null; } }

// ---------- sign in ----------
function showLogin() { $("login").hidden = false; $("app").hidden = true; }
$("pwgo").addEventListener("click", async () => {
  try { await api("/api/login", { method: "POST", body: { password: $("pw").value } }); $("login").hidden = true; boot(); }
  catch (e) { $("pwhint").textContent = e.message; }
});
$("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") $("pwgo").click(); });

// ---------- status banner + cost line ----------
function showGate() {
  const g = $("gate"); g.innerHTML = ""; g.hidden = true; g.className = "gate";
  const r = status.renderer, lines = [];
  if (r.needsAuth) {
    g.hidden = false;
    g.appendChild(el("b", null, "Connect Higgsfield to start generating"));
    g.appendChild(el("p", null, "Renders use the HitLights Higgsfield account and its credits (Nano Banana Pro, 2 credits per image). Sign in once; the connection is remembered."));
    const a = el("a", "btn-gold", "Sign in to Higgsfield ↗"); a.href = r.authUrl; a.style.padding = "10px 22px"; g.appendChild(a);
    return;
  }
  if (!r.connected) lines.push("Higgsfield isn't reachable right now: " + (r.error || "unknown error") + ". The prompt pack still works.");
  if (!status.shopify) lines.push("Shopify isn't configured, so catalog search is off — use the Paste an image URL tab.");
  if (!status.llm) lines.push("No language model is configured, so “Write it for me” and the text & logo check are off. Read each finished image yourself.");
  for (const w of status.warnings || []) lines.push(w);
  if (lines.length) {
    g.hidden = false; g.classList.add("ok");
    g.appendChild(el("b", null, r.connected ? "Generating works — a few things are off" : "Heads up"));
    for (const t of lines) g.appendChild(el("p", null, t));
  }
}
function showCost() {
  const c = $("cost"), per = status ? status.creditsPerRender : 2, comp = composedNow($("ground").value), set = (comp ? 1 : 3) * per;
  const bal = status && status.balance;
  c.textContent = (comp
    ? "A set uses about " + set + " Higgsfield credits: one scene photo for all three sizes. Re-composing after a fix is free."
    : "A set uses " + set + " Higgsfield credits (3 renders × " + per + "). Regenerating one size, or repainting a blank patch, adds " + per + ".") + (bal != null ? " Balance: " + Math.round(bal * 10) / 10 + " credits." : "");
  c.classList.toggle("low", bal != null && bal < set);
}

// ---------- tabs ----------
function tab(which) {
  const s = which === "shop";
  $("tab-shop").setAttribute("aria-selected", String(s)); $("tab-url").setAttribute("aria-selected", String(!s));
  $("pane-shop").hidden = !s; $("pane-url").hidden = s;
}
$("tab-shop").addEventListener("click", () => tab("shop"));
$("tab-url").addEventListener("click", () => tab("url"));

// ---------- product ----------
const STOCK_LABEL = { in_stock: "In stock", out_of_stock: "Out of stock", unknown: "Inventory unknown", not_tracked: "Inventory not tracked" };
// Bind the selected variant: its id, SKU, price, stock and (if it has one) its own photo.
function bindVariant(p, v) {
  if (!v) return;
  Object.assign(p, { variantId: v.id, variantTitle: v.title, sku: v.sku, price: v.price, stock: v.stock, outOfStock: v.stock === "out_of_stock" && !v.oversell });
  if (v.image && v.image.url) p.url = v.image.url;
  p.label = p.title + (v.title && v.title !== "Default Title" ? " — " + v.title : "");
}
function setPicked(p) {
  picked = p; const box = $("picked"); box.hidden = false; box.innerHTML = "";
  const b = el("b", null, "Using: "); box.appendChild(b); box.appendChild(document.createTextNode(p.label));
  if (p.variants && p.variants.length > 1) {
    const lab = el("label", null, "Variant"); lab.htmlFor = "variant"; lab.style.marginTop = "8px";
    const sel = el("select"); sel.id = "variant";
    p.variants.forEach((v, i) => { const o = el("option", null, [v.title, v.sku, v.price ? "$" + v.price : "", STOCK_LABEL[v.stock]].filter(Boolean).join(" · ")); o.value = String(i); if (v.id === p.variantId) o.selected = true; sel.appendChild(o); });
    sel.onchange = () => { bindVariant(p, p.variants[+sel.value]); setPicked(p); };
    box.append(lab, sel);
  }
  if (p.stock) { const w = el("div", null, STOCK_LABEL[p.stock] + (p.sku ? " · " + p.sku : "") + (p.price ? " · $" + p.price : "")); w.style.cssText = "margin-top:6px;color:" + (p.stock === "in_stock" ? "var(--ok)" : p.stock === "out_of_stock" ? "var(--stop)" : "var(--warn)"); box.appendChild(w); }
  if (p.outOfStock) { const w = el("div", null, "This variant has zero inventory in Shopify — point the ad at an in-stock SKU before you spend on it."); w.style.cssText = "margin-top:6px;color:var(--stop)"; box.appendChild(w); }
  if (p.images && p.images.length > 1) {
    box.appendChild(el("div", "hint", "Build from this photo:"));
    const row = el("div", "imgpick");
    p.images.forEach((im) => {
      const bt = el("button"); bt.type = "button"; bt.title = im.alt || "Product photo"; bt.setAttribute("aria-pressed", String(im.url === p.url));
      const i = el("img"); i.src = im.url + (im.url.includes("?") ? "&" : "?") + "width=160"; i.alt = im.alt || "Product photo"; bt.appendChild(i);
      bt.onclick = () => { p.url = im.url; setPicked(p); };
      row.appendChild(bt);
    });
    box.appendChild(row);
  }
}
async function search() {
  const q = $("q").value.trim(); if (!q) return;
  const r = $("results"); r.innerHTML = "";
  logEl.textContent = "Searching the catalog for “" + q + "”…";
  try {
    const { products } = await api("/api/products?q=" + encodeURIComponent(q));
    if (!products.length) { logEl.textContent = "No active products matched “" + q + "”."; return; }
    logEl.textContent = "Found " + products.length + " product" + (products.length === 1 ? "" : "s") + ".";
    products.forEach((n) => {
      const btn = el("button", "prod" + (n.url ? " withthumb" : "")); btn.type = "button"; btn.setAttribute("aria-pressed", "false");
      if (!n.url) btn.disabled = true;
      if (n.url) { const t = el("img", "thumb"); t.src = n.url + (n.url.includes("?") ? "&" : "?") + "width=120"; t.alt = ""; btn.appendChild(t); }
      const left = el("span"); left.appendChild(el("b", null, n.title));
      left.appendChild(el("span", "m", (n.sku ? n.sku + "  ·  " : "") + (n.url ? (n.images.length > 1 ? n.images.length + " photos" : "image on file") : "no image on file")));
      btn.appendChild(left);
      const inStock = n.variants.filter((v) => v.stock === "in_stock").length;
      const chip = n.variants.length > 1 ? (inStock + "/" + n.variants.length + " variants in stock") : (STOCK_LABEL[n.stock] + (n.variants[0] && n.variants[0].inventory != null ? " (" + n.variants[0].inventory + ")" : ""));
      btn.appendChild(el("span", "stk " + (n.stock === "in_stock" || inStock ? "in" : "out"), chip));
      btn.addEventListener("click", () => {
        Array.from(r.children).forEach((c) => c.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        const p = { url: n.url, label: n.title, title: n.title, desc: n.desc, images: n.images, variants: n.variants, productId: n.id };
        bindVariant(p, n.variants[0]); if (!n.variants.length) p.stock = "unknown";
        setPicked(p);
      });
      r.appendChild(btn);
    });
  } catch (e) { if (e.code !== "login") { logEl.textContent = e.message; fail("Catalog search didn't work", e.message); } }
}
$("search").addEventListener("click", search);
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
function pickUrl() {
  const v = $("imgurl").value.trim(), nm = $("imgname").value.trim();
  if (/^https:\/\//i.test(v)) setPicked({ url: v, label: nm || v, title: nm, desc: "", outOfStock: false, stock: "unknown" });
}
$("imgurl").addEventListener("change", pickUrl);
$("imgname").addEventListener("change", () => { if (picked && picked.url === $("imgurl").value.trim()) pickUrl(); });

// ---------- template switcher, sample copy and limits (as v16) ----------
const SAMPLE_FIELDS = ["h1", "h2", "sub", "p1", "p2", "p3", "cta", "deadline", "scene"];
function swapSamples() {
  const from = sampleFor(lastTpl), to = sampleFor($("ground").value);
  SAMPLE_FIELDS.forEach((f) => {
    const e = $(f); if (!e) return;
    // The Template 3 offer and deadline belong to that promo only: never carry them into another template.
    const promoOnly = lastTpl === "t3" && (f === "h1" || f === "deadline");
    if (promoOnly || e.value.trim() === (from[f] || "").trim()) e.value = to[f] || "";
  });
  lastTpl = $("ground").value;
}
function applyTpl() {
  const id = $("ground").value, T = TPL[id], LM = LIMITS[id] || {};
  document.querySelector('label[for="h1"]').textContent = T.labels.h1;
  document.querySelector('label[for="h2"]').textContent = T.labels.h2;
  $("proofWrap").hidden = T.proof === "none";
  $("contactWrap").hidden = !T.contact; $("contactHint").hidden = !T.contact;
  $("subWrap").hidden = !T.sub; $("deadlineWrap").hidden = !T.deadline;
  document.querySelector('label[for="cta"]').textContent = "CTA " + T.ctaNoun + " — " + LM.ctaWords[0] + " to " + LM.ctaWords[1] + " words";
  $("tplnote").textContent = T.pillar + " · " + T.name;
  const comp = composedNow(id);
  $("previewRow").hidden = !comp; if (!comp) $("preview").hidden = true;
  $("howComposed").hidden = !comp; $("howLegacy").hidden = comp;
  $("sceneLabel").textContent = comp ? "The scene — the space and the light" : "The shot — what's happening in the photo";
  $("sceneHint").textContent = comp ? "Describe the room and where the LED glow falls. No people, hands or devices: the product is added from its own photo." : "Describe a real scene. The product itself is carried over from the image above.";
  $("go").textContent = "Generate the three sizes";
  if (status) showCost();
  showLimits();
}
const LIMIT_FIELDS = ["h1", "h2", "sub", "deadline", "p1", "p2", "p3", "cta"];
LIMIT_FIELDS.forEach((id) => {
  const e = $(id); const n = el("span", "lim"); n.id = "lim-" + id; e.insertAdjacentElement("afterend", n);
  e.addEventListener("input", showLimits);
});
function showLimits() {
  const { bad, fields } = checkLimits(form());
  for (const id of LIMIT_FIELDS) {
    const n = $("lim-" + id), f = fields[id] || { msg: "", over: false };
    n.textContent = f.msg; n.classList.toggle("over", f.over);
  }
  return bad;
}
$("ground").addEventListener("change", () => { swapSamples(); applyTpl(); store("hl-tpl", $("ground").value); });

// ---------- draft ----------
$("draft").addEventListener("click", async () => {
  const btn = $("draft"), hint = $("drafthint");
  if (!picked && !$("angle").value.trim()) { hint.textContent = "Pick a product first, or describe the angle here."; return; }
  btn.disabled = true; const was = btn.textContent; btn.textContent = "Writing…"; hint.textContent = "Reading the product and drafting…";
  try {
    const { form: f, violations = [] } = await api("/api/draft", { method: "POST", body: { form: form(), picked } });
    for (const k of ["h1", "h2", "sub", "p1", "p2", "p3", "cta", "scene"]) if ($(k) && f[k] !== undefined) $(k).value = f[k];
    showLimits();
    hint.textContent = "Drafted from the product listing — read it over and edit anything that's off." +
      (violations.length ? " Kept out (not in the product data): " + violations.map((v) => v.field + ": " + v.reason).join("; ") + "." : "");
  } catch (e) { hint.textContent = e.code === "login" ? "" : "Couldn't draft it: " + e.message; }
  btn.disabled = false; btn.textContent = was;
});

// ---------- free preview (composed templates) ----------
$("previewBtn").addEventListener("click", async () => {
  const box = $("preview"), btn = $("previewBtn");
  if (!picked || !picked.url) { box.hidden = false; box.innerHTML = ""; box.appendChild(el("p", "hint", "Pick a product first.")); return; }
  btn.disabled = true; btn.textContent = "Laying it out…";
  box.hidden = false; box.innerHTML = ""; box.appendChild(el("p", "hint", "Cutting the product out of its photo and laying out the three sizes (the first time for a product takes a few seconds)…"));
  try {
    const p = await api("/api/preview", { method: "POST", body: { form: form(), picked } });
    paintPreview(p);
  } catch (e) { box.innerHTML = ""; if (e.code !== "login") box.appendChild(el("div", "err", "Preview didn't work: " + e.message)); }
  btn.disabled = false; btn.textContent = "Preview free (0 credits)";
});
function paintPreview(p) {
  const box = $("preview"); box.innerHTML = "";
  box.appendChild(cutoutPanel(p.cutout, null));
  if (!p.sizes.length) return;
  const okAll = p.sizes.every((s) => s.ok);
  box.appendChild(el("div", "qa " + (okAll ? "pass" : "fail"), okAll ? "The copy fits all three sizes. The grey panel is where the scene photo goes." : "Some copy doesn't fit — fix it before generating (nothing is charged until it fits):"));
  const strip = el("div", "side");
  for (const s of p.sizes) {
    const d = el("div");
    if (s.image) { const i = el("img"); i.src = s.image; i.alt = s.dims + " preview"; d.appendChild(i); }
    d.appendChild(el("span", null, s.dims + (s.ok ? "" : " — doesn't fit")));
    strip.appendChild(d);
  }
  box.appendChild(strip);
  const probs = p.sizes.filter((s) => !s.ok);
  if (probs.length) { const ul = el("ul", "qa fail"); for (const s of probs) for (const m of s.problems) ul.appendChild(el("li", null, s.dims + ": " + m)); box.appendChild(ul); }
}

// ---------- product cutout: checked once per product photo ----------
const CUTOUT_LABEL = { auto: "Product cutout: made automatically — check it once", approved: "Product cutout: approved", uploaded: "Product cutout: your own PNG", failed: "Product cutout: couldn't be made" };
function cutoutPanel(c, run) {
  const box = el("div", "qa " + (c && (c.state === "approved" || c.state === "uploaded") ? "pass" : "fail"));
  if (!c) { box.textContent = "Product cutout: not made yet."; return box; }
  box.appendChild(el("b", null, CUTOUT_LABEL[c.state] || c.state));
  if (c.error) box.appendChild(el("div", null, c.error));
  const img = c.sha && c.state !== "failed" ? "/api/cutouts/" + c.sha : null;
  const photo = c.sha ? "/api/cutouts/" + c.sha + "/photo" : null;
  if (img) {
    // The original photo next to the cutout (on a checkerboard and on the brand violet), so a
    // missing or see-through part of the product is easy to spot before approving.
    const pair = el("div", "cutpair");
    const fig = (src, cls, cap) => { const f = el("figure", cls); const i = el("img"); i.src = src; i.alt = cap; f.appendChild(i); f.appendChild(el("figcaption", null, cap)); return f; };
    if (photo) pair.appendChild(fig(photo, "cutout photo", "Product photo"));
    pair.appendChild(fig(img + "?t=" + Date.now(), "cutout", "Cutout"));
    pair.appendChild(fig(img + "?t=" + Date.now(), "cutout violet", "Cutout on violet"));
    box.appendChild(pair);
  }
  if (c.state === "auto") box.appendChild(el("p", "hint", "Compare the cutout with the product photo: every part of the product there and solid (nothing see-through), nothing extra, clean edges. Once approved, every set with this photo can deliver automatically. If anything's off, replace it with your own PNG."));
  const row = el("div", "rowbtn");
  if (c.state === "auto") {
    const ok = el("button", "btn-quiet", "Approve cutout"); ok.type = "button";
    ok.onclick = async () => {
      if (!confirm("You compared the cutout with the product photo and it's the whole product, cleanly cut out?")) return;
      try { const r = await api("/api/cutouts/" + c.sha + "/approve", { method: "POST", body: { confirm: true, runId: run ? run.id : undefined } }); if (r.run) { paintRun(r.run); poll(); } else { c.state = r.cutout.state; box.replaceWith(cutoutPanel(c, run)); } }
      catch (e) { if (e.code !== "login") fail("That didn't work", e.message); }
    };
    row.appendChild(ok);
  }
  if (c.sha) {
    const up = el("button", "btn-quiet", c.state === "failed" ? "Upload a cutout PNG" : "Replace with my own PNG"); up.type = "button";
    const inp = el("input"); inp.type = "file"; inp.accept = "image/png"; inp.hidden = true;
    up.onclick = () => inp.click();
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      if (f.size > 12e6) { fail("That file is too big", "Use a PNG under 12 MB."); return; }
      const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(f); });
      try { const r = await api("/api/cutouts/" + c.sha + "/upload", { method: "POST", body: { png: b64, runId: run ? run.id : undefined } }); if (r.run) { paintRun(r.run); setBusy(true); poll(); } else { c.state = r.cutout.state; c.error = null; box.replaceWith(cutoutPanel(c, run)); } }
      catch (e) { if (e.code !== "login") fail("That PNG couldn't be used", e.message); }
    };
    row.append(up, inp);
  }
  if (run && run.source && run.source.kept) { const a = el("a", "hint", "product photo ↗"); a.href = "/api/runs/" + run.id + "/source"; a.target = "_blank"; a.rel = "noopener"; row.appendChild(a); }
  if (row.childNodes.length) box.appendChild(row);
  return box;
}

// ---------- the scene photo (composed sets) ----------
function scenePanel(r, working) {
  const X = r.scene, box = el("div", "outcard");
  box.appendChild(el("b", null, "Scene photo — the one paid render" + (X.version > 1 ? " · v" + X.version : "")));
  if (X.state === "ambiguous" && X.attemptId) { box.appendChild(decisionPanel(r, { ...X, dims: "scene photo" }, working)); return box; }
  if (X.preview) { const i = el("img"); i.src = X.preview; i.alt = "Scene photo"; box.appendChild(i); }
  else box.appendChild(el("span", "dim", { waiting: "Waiting for the cutout and the copy check…", rendering: "Rendering…", failed: "Didn't render. " + (X.error || "") }[X.state] || X.state));
  const q = X.qa;
  if (q) {
    const label = { pass: "Scene check: clean photo — no stray text, panels, faces or devices.", fail: "Scene check: failed — make a new set for a new scene.", uncertain: "Scene check: unsure — look at the photo yourself.", running: "Scene check: looking at the photo…", off: "Scene check: off (no language model configured) — look at the photo yourself.", error: "Scene check: couldn't run (" + (q.message || q.code || "error") + ")." }[q.state] || q.state;
    const d = el("div", "qa " + (q.state === "pass" || q.approved ? "pass" : "fail")); d.appendChild(el("b", null, label));
    if (q.issues && q.issues.length) { const ul = el("ul"); q.issues.forEach((i) => ul.appendChild(el("li", null, i))); d.appendChild(ul); }
    if (q.approved) d.appendChild(el("div", "dim", "Approved by a person " + new Date(q.approved.at).toLocaleString()));
    else if (q.state === "uncertain" && !working) {
      const b = el("button", "linkbtn", "I looked — the photo is clean"); b.type = "button";
      b.onclick = async () => {
        if (!confirm("No text, logos, panels, faces or close-up devices anywhere in the scene photo?")) return;
        try { const { run } = await api("/api/runs/" + r.id + "/scene/approve", { method: "POST", body: { confirm: true } }); paintRun(run); poll(); }
        catch (e) { if (e.code !== "login") fail("That didn't work", e.message); }
      };
      d.appendChild(b);
    } else if (q.state === "error" && !working) { const b = el("button", "linkbtn", "Run it again"); b.type = "button"; b.onclick = () => act("recheck"); d.appendChild(b); }
    box.appendChild(d);
  }
  return box;
}

// ---------- generate ----------
function setBusy(b) {
  $("go").disabled = b; $("go").textContent = b ? "Working…" : "Generate the three sizes";
  document.querySelectorAll(".regen").forEach((r) => { r.disabled = b; });
}
$("go").addEventListener("click", async () => {
  outEl.querySelectorAll(".err").forEach((e) => e.remove());
  const f = form();
  const bad = validateForGenerate(f, { hasImage: !!(picked && picked.url) });
  if (bad.length) { fail(bad[0].title, bad[0].body); return; }
  if (status && status.renderer.needsAuth) { fail("Connect Higgsfield first", "Use the sign-in button at the top of the page."); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  setBusy(true);
  try {
    const { run } = await api("/api/runs", { method: "POST", body: { form: f, picked, saveDrive: $("saveDrive").checked } });
    openRun(run.id, run);
  } catch (e) { setBusy(false); if (e.code !== "login") fail("Couldn't start the set", e.message); }
});

// ---------- output ----------
function openRun(id, run) {
  currentRun = id; store("hl-run", id);
  if (run) paintRun(run);
  poll();
}
async function poll() {
  clearTimeout(pollTimer);
  if (!currentRun) return;
  try {
    const { run, busy } = await api("/api/runs/" + currentRun);
    paintRun(run, busy);
    const live = ["queued", "running"].includes(run.status) || busy === run.id;
    setBusy(!!busy);
    if (live || busy) pollTimer = setTimeout(poll, 2500);
    else { loadRuns(); refreshStatus(); }
  } catch (e) { if (e.status === 404) { store("hl-run", null); currentRun = null; } else pollTimer = setTimeout(poll, 5000); }
}
async function act(action, body = {}) {
  try { const { run } = await api("/api/runs/" + currentRun + "/" + action, { method: "POST", body }); if (run.id !== currentRun) currentRun = run.id; store("hl-run", currentRun); setBusy(true); poll(); }
  catch (e) { if (e.code !== "login") fail("That didn't work", e.message); }
}
function paintRun(r, busy) {
  logEl.innerHTML = "";
  for (const l of r.log) { const s = el("span", "s-" + (l.cls || "run"), l.msg + "\n"); logEl.appendChild(s); }
  logEl.scrollTop = logEl.scrollHeight;
  // run-level buttons
  const rb = $("runbtns"); rb.innerHTML = ""; rb.hidden = false;
  const working = ["queued", "running"].includes(r.status) || busy === r.id;
  if (!working && (r.status === "failed" || r.status === "partial") && !r.attempts.some((a) => a.state === "ambiguous")) { const b = el("button", "btn-quiet regen", "Resume this set"); b.type = "button"; b.onclick = () => act("resume"); rb.appendChild(b); }
  if (r.items.some((x) => x.file)) { const a = el("a", "btn-quiet", "Download all (.zip)"); a.href = "/api/runs/" + r.id + "/zip"; a.style.textDecoration = "none"; rb.appendChild(a); }
  if (!working && !r.composed && r.items.some((x) => x.rawUrl)) { const b = el("button", "btn-quiet regen", "Finish these renders again (0 credits)"); b.type = "button"; b.onclick = () => act("refinish"); rb.appendChild(b); }
  if (!working && r.composed && r.scene && r.scene.preview) { const b = el("button", "btn-quiet regen", "Re-compose (0 credits)"); b.type = "button"; b.onclick = () => act("refinish"); rb.appendChild(b); }
  if (!working && r.composed && r.scene && (r.scene.preview || r.scene.state === "failed")) {
    const per = status ? status.creditsPerRender : 2;
    const b = el("button", "btn-quiet regen", "New scene — a new set (" + per + " credits)"); b.type = "button";
    b.onclick = () => { if (confirm("Render a new scene photo as a new set (about " + per + " credits)? The copy and product stay the same.")) act("regenerate", { kind: "master" }); };
    rb.appendChild(b);
  }
  const cd = r.creditsDetail;
  rb.appendChild(el("span", "hint", r.folder + " · ~" + r.credits + " credits" + (cd && cd.reserved ? " (" + cd.reserved + " reserved, unconfirmed)" : "") + " (estimate)"));
  if (r.status === "needs_decision") fail("This set needs a decision", "A paid render's outcome is unknown. Use the buttons on that size below; nothing is resubmitted until you choose.");
  // side-by-side strip
  const side = $("side"); side.innerHTML = "";
  const done = r.items.filter((x) => x.file);
  side.hidden = done.length < 2;
  for (const x of done) { const d = el("div"); const i = el("img"); i.src = x.file; i.alt = x.title; d.appendChild(i); d.appendChild(el("span", null, x.dims)); side.appendChild(d); }
  // cards
  outEl.querySelectorAll(".outcard, .composedpanel").forEach((c) => c.remove());
  if (r.composed) {
    const cp = el("div", "outcard composedpanel"); cp.appendChild(el("b", null, "Product"));
    cp.appendChild(cutoutPanel(r.cutout, r)); outEl.appendChild(cp);
    if (r.scene) { const sp = scenePanel(r, working); sp.classList.add("composedpanel"); outEl.appendChild(sp); }
  }
  for (const x of r.items) outEl.appendChild(card(r, x, working));
  // drive
  const dv = $("drive"); dv.innerHTML = "";
  if (r.folderUrl || r.driveError) {
    const c = el("div", "outcard"); c.appendChild(el("b", null, "Google Drive"));
    if (r.driveError) c.appendChild(el("span", "dim", "Not saved: " + r.driveError));
    if (r.folderUrl) { const a = el("a", null, "Open the Drive folder ↗"); a.href = r.folderUrl; a.target = "_blank"; a.rel = "noopener noreferrer"; c.appendChild(a); }
    dv.appendChild(c);
  }
}
function card(r, x, working) {
  const c = el("div", "outcard");
  c.appendChild(el("b", null, x.title + " — " + x.dims.replace("x", " × ") + (x.version > 1 ? " · v" + x.version : "")));
  const st = { waiting: x.composed ? "Waiting for the scene photo…" : "Waiting for the square master…", rendering: "Rendering…", rendered: "Rendered. Finishing comes next.", finishing: "Finishing: exact size, brand colour, logo…", failed: "This size didn't finish. " + (x.error || "See the status log.") }[x.state];
  if (x.state === "ambiguous" && x.attemptId) c.appendChild(decisionPanel(r, x, working));
  else if (x.state === "done") {
    const at = x.at ? x.at.x + "," + x.at.y : x.grid.x + "," + x.grid.y;
    const clean = !x.flags.filter((f) => f !== "TEXT").length;
    c.appendChild(el("span", "dim", "Exact size · logo on the Logo Grid at (" + at + ")" + (x.at ? " · " + x.at.colour + " lockup" : "") + (clean ? "" : " · check the notes below")));
    const img = el("img"); img.src = x.file; img.alt = x.title + " ad"; c.appendChild(img);
    if (x.composed) {
      const q = el("div", "qa pass", "Built by the app: your exact copy in Montserrat, the real logo, the gold CTA and the real product photo — nothing redrawn by the image model.");
      c.appendChild(q); c.appendChild(deliveryBox(r, x, working));
      if (x.drive) c.appendChild(el("span", "dim", "Saved to Drive as " + x.drive.name));
      const row = el("div", "rowbtn"); const a = el("a", "btn-quiet", "Download " + x.fileName); a.href = x.file + "?dl=1"; a.style.textDecoration = "none"; row.appendChild(a); c.appendChild(row);
      return c;
    }
    x.flags.forEach((f) => { const t = FLAGTXT[f]; if (t) { const w = el("div", "err", t); w.style.marginTop = "4px"; c.appendChild(w); } });
    const q = el("div", "qa");
    if (!x.qa) q.textContent = "Text & logo check: waiting…";
    else if (x.qa.state === "running") q.textContent = "Text & logo check: reading the image…";
    else if (x.qa.state === "pass") { q.textContent = "Text & logo check: passed — every line matches, no stray text or logos."; q.classList.add("pass"); }
    else if (x.qa.state === "fail") {
      q.classList.add("fail"); q.appendChild(el("b", null, "Text & logo check: failed"));
      const ul = el("ul"); (x.qa.issues.length ? x.qa.issues : ["Marked as failing without detail — look it over."]).forEach((i) => ul.appendChild(el("li", null, i))); q.appendChild(ul);
    } else if (x.qa.state === "off") q.textContent = "Text & logo check: off (no language model configured) — read the image over yourself.";
    else { q.textContent = "Text & logo check: couldn't run (" + (x.qa.message || x.qa.code || "error") + "). "; const rb = el("button", "linkbtn", "Run it again"); rb.type = "button"; rb.onclick = () => act("recheck", { kind: x.kind }); q.appendChild(rb); }
    c.appendChild(q);
    if (x.fidelity) c.appendChild(fidelityBox(r, x, working));
    c.appendChild(deliveryBox(r, x, working));
    if (x.drive) c.appendChild(el("span", "dim", "Saved to Drive as " + x.drive.name));
  } else if (st) c.appendChild(el("span", "dim", st));
  const row = el("div", "rowbtn");
  if (x.state === "done") { const a = el("a", "btn-quiet", "Download " + x.fileName); a.href = x.file + "?dl=1"; a.style.textDecoration = "none"; row.appendChild(a); }
  if ((x.state === "done" || x.state === "failed") && r.masterReady && !working) {
    const per = status ? status.creditsPerRender : 2;
    const rg = el("button", "btn-quiet regen", x.kind === "master" ? "Regenerate the whole set (" + 3 * per + " credits)" : "Regenerate this size (" + per + " credits)");
    rg.type = "button"; rg.onclick = () => { if (confirm(x.kind === "master" ? "Render a new set of three (" + 3 * per + " credits)?" : "Re-render this size (" + per + " credits)?")) act("regenerate", { kind: x.kind }); };
    row.appendChild(rg);
  }
  if (x.rawUrl) { const a = el("a", "hint", "raw render ↗"); a.href = x.rawUrl; a.target = "_blank"; a.rel = "noopener noreferrer"; row.appendChild(a); }
  if (row.childNodes.length) c.appendChild(row);
  return c;
}

// ---------- delivery status (core/gates.mjs decides; the page only shows it) ----------
const DELIVERY_LABEL = { passed: "Ready to use — every check passed.", held: "Held back — don't use this file yet.", unchecked: "Unchecked — not verified, so it isn't delivered automatically.", overridden: "Used anyway — a person overrode the checks.", failed: "Failed.", pending: "In progress." };
function deliveryBox(r, x, working) {
  const d = x.delivery || { status: "pending", reasons: [] };
  const box = el("div", "qa " + (d.status === "passed" ? "pass" : d.status === "overridden" ? "" : "fail"));
  box.appendChild(el("b", null, DELIVERY_LABEL[d.status] || d.status));
  if (d.reasons.length) { const ul = el("ul"); d.reasons.forEach((t) => ul.appendChild(el("li", null, t))); box.appendChild(ul); }
  if (x.override) box.appendChild(el("div", "dim", "Override: “" + x.override.reason + "” (" + new Date(x.override.at).toLocaleString() + ")"));
  if ((d.status === "held" || d.status === "unchecked") && x.output && x.output.ok && !working) {
    const b = el("button", "linkbtn", "Use it anyway…"); b.type = "button";
    b.onclick = async () => {
      const reason = prompt("Why is the " + x.dims + " OK to use as it is? This is recorded with the set.");
      if (!reason || reason.trim().length < 3) return;
      if (!confirm("Mark the " + x.dims + " as approved despite: " + d.reasons.join(" ") + "?")) return;
      try { const { run } = await api("/api/runs/" + r.id + "/items/" + x.kind + "/override", { method: "POST", body: { reason, confirm: true } }); paintRun(run); poll(); }
      catch (e) { if (e.code !== "login") fail("That didn't work", e.message); }
    };
    box.appendChild(b);
  }
  return box;
}

function fidelityBox(r, x, working) {
  const f = x.fidelity, q = el("div", "qa");
  const label = { pass: "Product check: matches the product photo.", fail: "Product check: the product looks changed.", uncertain: "Product check: uncertain — compare it with the product photo yourself.", running: "Product check: comparing with the product photo…", off: "Product check: off (no language model configured).", error: "Product check: couldn't run (" + (f.message || f.code || "error") + ")." }[f.state] || f.state;
  q.appendChild(el(f.state === "fail" || f.state === "uncertain" ? "b" : "span", null, label));
  if (f.state === "pass") q.classList.add("pass");
  if (f.state === "fail" || (f.state === "uncertain" && !f.approved)) q.classList.add("fail");
  if (f.issues && f.issues.length) { const ul = el("ul"); f.issues.forEach((i) => ul.appendChild(el("li", null, i))); q.appendChild(ul); }
  if (r.source && r.source.kept) { const a = el("a", "hint", "product photo ↗"); a.href = "/api/runs/" + r.id + "/source"; a.target = "_blank"; a.rel = "noopener"; q.appendChild(a); }
  if (f.state === "uncertain" && f.approved) q.appendChild(el("div", "dim", "Approved by a person " + new Date(f.approved.at).toLocaleString()));
  else if (f.state === "uncertain" && !working) {
    const b = el("button", "linkbtn", " I compared it — the product matches"); b.type = "button";
    b.onclick = async () => {
      if (!confirm("You compared the " + x.dims + " with the product photo and the hardware matches (connectors, shape, colour, markings)?")) return;
      try { const { run } = await api("/api/runs/" + r.id + "/items/" + x.kind + "/approve-fidelity", { method: "POST", body: { confirm: true } }); paintRun(run); poll(); }
      catch (e) { if (e.code !== "login") fail("That didn't work", e.message); }
    };
    q.appendChild(b);
  }
  return q;
}

// ---------- unconfirmed paid submissions: a person decides ----------
function decisionPanel(r, x, working) {
  const box = el("div", "err");
  box.appendChild(el("b", null, "Unconfirmed render — nothing was resubmitted"));
  box.appendChild(el("p", null, (x.error || "The request may or may not have reached Higgsfield.") + " Its credits stay reserved until you decide."));
  const row = el("div", "rowbtn"), out = el("div");
  const resolve = async (body) => {
    try { const { run } = await api("/api/runs/" + r.id + "/attempts/" + x.attemptId + "/resolve", { method: "POST", body }); paintRun(run); poll(); }
    catch (e) { if (e.code !== "login") fail("That didn't work", e.message); }
  };
  const look = el("button", "btn-quiet", "Look for the job in Higgsfield"); look.type = "button"; look.disabled = working;
  look.onclick = async () => {
    out.textContent = "Searching recent Higgsfield generations…";
    try {
      const { supported, candidates } = await api("/api/runs/" + r.id + "/attempts/" + x.attemptId + "/candidates");
      out.innerHTML = "";
      if (!supported) { out.textContent = "This renderer can't search its history. Check Higgsfield yourself."; return; }
      if (!candidates.length) { out.textContent = "No finished matching job yet. One still rendering wouldn't show — try again in a few minutes before re-rendering."; return; }
      for (const cnd of candidates) {
        const b = el("button", "btn-quiet", "Use job " + cnd.jobId.slice(0, 8) + "… (" + new Date(cnd.createdAt).toLocaleTimeString() + ")"); b.type = "button";
        b.onclick = () => resolve({ action: "adopt", jobId: cnd.jobId });
        out.appendChild(b);
      }
    } catch (e) { out.textContent = e.message; }
  };
  const retry = el("button", "btn-quiet", "Re-render (may charge twice)"); retry.type = "button"; retry.disabled = working;
  retry.onclick = () => {
    if (!confirm("Re-render the " + x.dims + "? If Higgsfield did accept the first request, you pay for both.")) return;
    const charged = confirm("Count the unconfirmed request as charged? OK = yes (safer for the caps), Cancel = no (only if you checked Higgsfield and it isn't there).");
    resolve({ action: "retry", charged, confirm: true });
  };
  const skip = el("button", "btn-quiet", "Skip this size"); skip.type = "button"; skip.disabled = working;
  skip.onclick = () => {
    if (!confirm("Skip the " + x.dims + " for this set?")) return;
    const charged = confirm("Count the unconfirmed request as charged? OK = yes, Cancel = no (only if you checked Higgsfield).");
    resolve({ action: "skip", charged, confirm: true });
  };
  row.append(look, retry, skip); box.append(row, out);
  return box;
}

// ---------- recent sets ----------
async function loadRuns() {
  try {
    const { runs } = await api("/api/runs");
    const box = $("runs"); $("runsCard").hidden = false; box.innerHTML = "";
    if (!runs.length) { box.appendChild(el("p", "hint", "No sets yet. Each set you generate is listed here with its checks and Drive link.")); return; }
    const t = el("table", "runs"), h = el("tr");
    ["When", "Product", "Template", "1080×1080", "1080×1920", "1200×628", ""].forEach((s) => h.appendChild(el("th", null, s))); t.appendChild(h);
    for (const r of runs) {
      const tr = el("tr"), dt = new Date(r.ts);
      tr.appendChild(el("td", null, dt.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })));
      const pc = el("td"); const pb = el("button", "linkbtn", r.product || "—"); pb.type = "button"; pb.onclick = () => { openRun(r.id); window.scrollTo({ top: 0, behavior: "smooth" }); }; pc.appendChild(pb); tr.appendChild(pc);
      tr.appendChild(el("td", null, String(r.tplName || "").replace(/^Template (\d) — /, "T$1 ")));
      for (const x of r.items) {
        const td = el("td"), st = (x.delivery && x.delivery.status) || "pending";
        const tag = el("span", "chip " + ({ passed: "ok", overridden: "warn", unchecked: "warn", held: "bad", failed: "bad" }[st] || "warn"));
        tag.textContent = { passed: "passed", held: "held" + (x.flags.length ? " · " + x.flags.join(" ") : ""), unchecked: "unchecked", failed: "failed", overridden: "overridden", pending: x.state }[st] || st;
        tag.title = (x.delivery && x.delivery.reasons.join(" ")) || "";
        if (x.version > 1) tag.textContent += " · v" + x.version;
        td.appendChild(tag); tr.appendChild(td);
      }
      const lk = el("td"); if (r.folderUrl) { const a = el("a", null, "Drive ↗"); a.href = r.folderUrl; a.target = "_blank"; a.rel = "noopener noreferrer"; lk.appendChild(a); } tr.appendChild(lk);
      t.appendChild(tr);
    }
    const w = el("div", "tblwrap"); w.appendChild(t); box.appendChild(w);
  } catch { /* the card stays as it was */ }
}

// ---------- prompt pack ----------
$("packbtn").addEventListener("click", () => {
  const f = form();
  if (!f.h1.trim() && !f.h2.trim()) { $("packhint").textContent = "Write at least one headline line first."; return; }
  const bad = showLimits();
  if (bad.length) { $("packhint").textContent = "The copy doesn't fit this template: " + bad.join(". ") + "."; return; }
  $("packtext").value = packText(f, picked);
  $("pack").hidden = false; $("packhint").textContent = "Built from the fields above. Rebuild it after any edit."; $("packcopied").textContent = "";
});
$("packcopy").addEventListener("click", () => {
  const t = $("packtext");
  navigator.clipboard.writeText(t.value).then(() => { $("packcopied").textContent = "Copied."; }, () => { t.select(); $("packcopied").textContent = "Press Ctrl/Cmd+C to copy."; });
});

$("logout").addEventListener("click", async () => { try { await api("/api/logout", { method: "POST" }); } catch { /* ignore */ } location.reload(); });

// ---------- boot ----------
async function refreshStatus() {
  status = await api("/api/status");
  showGate(); showCost();
  if ($("ground").value) applyTpl();
  $("draftbox").hidden = !status.llm;
  $("driveWrap").hidden = !status.drive;
  $("tab-shop").disabled = !status.shopify;
  if (!status.shopify) tab("url");
}
async function boot() {
  // Start from the remembered template with its sample copy (v16 opened on T1's).
  const t = recall("hl-tpl"); if (t && TPL[t]) $("ground").value = t;
  lastTpl = $("ground").value;
  try { await refreshStatus(); } catch (e) { if (e.code === "login") return; fail("The server didn't answer", e.message); }
  const s = sampleFor(lastTpl);
  for (const f of SAMPLE_FIELDS) if ($(f)) $(f).value = s[f] || "";
  applyTpl();
  try { $("saveDrive").checked = recall("hl-save-drive") !== "0"; } catch { /* ignore */ }
  $("saveDrive").addEventListener("change", () => store("hl-save-drive", $("saveDrive").checked ? "1" : "0"));
  if (!status) return;
  $("app").hidden = false; $("login").hidden = true; $("logout").hidden = false;
  if (new URLSearchParams(location.search).get("higgsfield") === "connected") { history.replaceState(null, "", "/"); logEl.textContent = "Higgsfield connected. Pick a product, check the message, then generate."; }
  else if (status.renderer.connected) logEl.textContent = "Ready. " + (status.shopify ? "Pick a product" : "Paste a product image URL") + ", check the message, then generate.";
  loadRuns();
  const last = recall("hl-run"); if (last) openRun(last);
}
$("app").hidden = false;
boot();

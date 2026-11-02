// Social / banner / email studio: the second tab of the page. Independent of web/app.js (the Meta
// ad builder): its own state, its own API (/api/channels/*), no shared variables. It only reads
// the shared catalog search and the shared product-cutout approval endpoints.
import { CHANNELS, CHANNEL_ORDER, BACKGROUNDS, CHANNEL_LIMITS, FIELD_LABELS, CHANNEL_SAMPLE, CHANNEL_FIELDS, checkChannelFields } from "/core/channels.mjs";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const recall = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let j = {}; try { j = await res.json(); } catch { j = {}; }
  if (res.status === 401) throw Object.assign(new Error("Sign in first."), { code: "login" });
  if (!res.ok) throw Object.assign(new Error(j.error || "HTTP " + res.status), { code: j.code });
  return j;
}

// ---------- tabs ----------
const appEl = $("app"), section = $("channels");
let built = false;
function showTool(which) {
  const ch = which === "channels";
  appEl.classList.toggle("mode-channels", ch);
  section.hidden = !ch;
  $("apptab-ads").setAttribute("aria-selected", String(!ch));
  $("apptab-channels").setAttribute("aria-selected", String(ch));
  remember("hl-tool", which);
  if (ch && !built) {
    try { build(); built = true; }
    catch (e) { section.textContent = "This tab couldn't load: " + e.message + " Reload the page; if it keeps happening, tell Dave."; console.error(e); }
  }
}
$("apptab-ads").addEventListener("click", () => showTool("ads"));
$("apptab-channels").addEventListener("click", () => showTool("channels"));

// ---------- state ----------
const S = {
  channel: CHANNEL_ORDER.includes(recall("hl-ch-channel")) ? recall("hl-ch-channel") : "social",
  formats: new Set(), style: "product", fields: {}, picked: null, showProduct: true,
  bg: { kind: "violet" }, set: null, extra: null, busy: false, version: 0,
};

const TEMPLATE = `
<div class="cols">
  <div>
    <div class="card"><h2><span class="n">01</span> Channel &amp; sizes</h2><div class="bd">
      <div class="chpick" id="chPick" role="group" aria-label="Channel"></div>
      <div class="f"><label>Sizes to make</label><div class="fmtlist" id="chFormats"></div>
        <p class="hint">Each size is laid out on its own and checked: copy that doesn't fit, or anything outside the area the platform always shows, is flagged.</p></div>
      <div class="f"><label>Layout style</label><div class="stylelist" id="chStyles"></div></div>
    </div></div>

    <div class="card"><h2><span class="n">02</span> Product <span class="hint" style="font-weight:400;font-family:var(--body)">optional</span></h2><div class="bd">
      <div class="f">
        <label for="chQ">Product name or SKU</label>
        <div style="display:flex;gap:8px"><input type="text" id="chQ" placeholder="EZDim Pro" autocomplete="off"><button class="btn-quiet" id="chSearch" type="button" style="white-space:nowrap">Search</button></div>
        <p class="hint">Uses the product's own Shopify photo with its background removed — the same cutout (and approval) as the ad builder.</p>
      </div>
      <div class="results" id="chResults"></div>
      <div class="note" id="chPicked" hidden></div>
    </div></div>

    <div class="card"><h2><span class="n">03</span> Copy</h2><div class="bd">
      <div class="f draftbox" id="chDraftBox">
        <label for="chAngle">Draft it for me — what's the angle?</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><input type="text" id="chAngle" placeholder="holiday gift idea · weekend DIY project · new product drop" style="flex:1 1 240px"><button class="btn-quiet" id="chDraft" type="button" style="white-space:nowrap">Write it for me</button></div>
        <p class="hint" id="chDraftHint"></p>
      </div>
      <div id="chFields"></div>
    </div></div>

    <div class="card"><h2><span class="n">04</span> Background &amp; create</h2><div class="bd">
      <div class="bgpick" id="chBg" role="group" aria-label="Background"></div>
      <div id="chPhoto" hidden>
        <div class="f"><label for="chUpload">Upload a photo</label><input type="file" id="chUpload" accept="image/jpeg,image/png,image/webp">
          <p class="hint">Or reuse a room scene already made for an ad set (no new credits):</p>
          <div class="scenes" id="chScenes"></div></div>
      </div>
      <button class="btn-gold" id="chGo" type="button">Create images (free)</button>
      <p class="bhint">Built in the app from brand colours, Montserrat, the real logo and gold CTA, and the real product. No Higgsfield render and no credits.</p>
    </div></div>
  </div>

  <div>
    <div class="card"><h2><span class="n">05</span> Output</h2><div class="bd">
      <div class="status" id="chLog">Pick a channel, write the copy and press Create images.</div>
      <div id="chCut"></div>
      <div class="rowbtn" id="chZipRow" hidden></div>
      <div class="gallery" id="chGallery"></div>
      <div class="copyout" id="chCopyOut" hidden></div>
    </div></div>
    <div class="card"><h2>How this tab differs from the ad builder</h2><div class="bd">
      <ul class="chk">
        <li><p><b>Made for each channel.</b> Feed, story and pin sizes for social; website heroes, promo strips and profile covers for banners; 2× retina images for email — with platform safe areas built in.</p></li>
        <li><p><b>Free and instant.</b> Everything is composed here. Photo backgrounds come from your own upload or a scene already rendered for an ad set.</p></li>
        <li><p><b>Copy to paste comes with it.</b> The draft also writes the post caption and hashtags, or the email subject line and preheader, plus alt text.</p></li>
        <li><p><b>Same quality bar.</b> Files with a layout problem, or a product cutout no one has approved, stay held until they're fixed.</p></li>
      </ul>
    </div></div>
  </div>
</div>`;

function build() {
  section.innerHTML = TEMPLATE;
  for (const id of CHANNEL_ORDER) {
    const c = CHANNELS[id], b = el("button"); b.type = "button"; b.dataset.ch = id;
    b.append(el("b", null, c.name), el("span", null, c.blurb));
    b.onclick = () => setChannel(id);
    $("chPick").appendChild(b);
  }
  for (const [k, v] of Object.entries(BACKGROUNDS)) {
    const b = el("button"); b.type = "button"; b.dataset.bg = k;
    const sw = el("i"); sw.style.background = { violet: "linear-gradient(135deg,#523875,#2e1f45)", night: "radial-gradient(circle at 60% 60%,#c88f10,#120C18 70%)", cream: "#FBF6EE", photo: "linear-gradient(135deg,#8a7a5a,#4a4034)" }[k];
    b.append(sw, document.createTextNode(v.name));
    b.onclick = () => { S.bg = { kind: k }; paintBg(); };
    $("chBg").appendChild(b);
  }
  $("chSearch").onclick = search;
  $("chQ").addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
  $("chDraft").onclick = draft;
  $("chGo").onclick = create;
  $("chUpload").onchange = upload;
  setChannel(S.channel, true);
  paintBg();
  api("/api/status").then((st) => { if (!st.llm) { $("chDraftBox").hidden = true; } }).catch(() => {});
}

// ---------- channel, sizes, style ----------
function setChannel(id, first = false) {
  const prev = S.channel; S.channel = id; remember("hl-ch-channel", id);
  const c = CHANNELS[id];
  // Swap the sample copy only if the person hasn't edited the previous channel's sample.
  const untouched = CHANNEL_FIELDS.every((k) => (S.fields[k] || "") === (CHANNEL_SAMPLE[prev][k] || ""));
  if (first || untouched) S.fields = { ...CHANNEL_SAMPLE[id] };
  S.formats = new Set(c.defaults);
  if (!c.styles.some((s) => s.id === S.style)) S.style = "product";
  [...$("chPick").children].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ch === id)));
  const fl = $("chFormats"); fl.innerHTML = "";
  for (const f of c.formats) {
    const lab = el("label"), cb = el("input"); cb.type = "checkbox"; cb.checked = S.formats.has(f.id);
    cb.onchange = () => { cb.checked ? S.formats.add(f.id) : S.formats.delete(f.id); };
    const t = el("span"); const top = el("span"); top.append(el("b", null, f.name + " "), el("span", "dims", f.W + "×" + f.H)); t.append(top, el("small", null, f.note));
    lab.append(cb, t); fl.appendChild(lab);
  }
  const sl = $("chStyles"); sl.innerHTML = "";
  for (const s of c.styles) {
    const lab = el("label"), r = el("input"); r.type = "radio"; r.name = "chStyle"; r.value = s.id; r.checked = s.id === S.style;
    r.onchange = () => { S.style = s.id; paintFields(); };
    const t = el("span"); t.append(el("b", null, s.name), el("small", null, s.hint));
    lab.append(r, t); sl.appendChild(lab);
  }
  $("chDraftHint").textContent = { social: "Reads the product listing and writes the image text plus the post caption and hashtags.", banner: "Reads the product listing and writes short, scannable banner copy plus alt text.", email: "Reads the product listing and writes the image text plus the subject line, preheader and alt text." }[id];
  paintFields();
  S.extra = null; paintExtra();
}

function paintFields() {
  const box = $("chFields"); box.innerHTML = "";
  const show = CHANNEL_FIELDS.filter((k) => k !== "offer" || S.style === "promo");
  for (const k of show) {
    const f = el("div", "f"), lab = el("label"), counter = el("span", "counter");
    lab.htmlFor = "ch-" + k; lab.append(document.createTextNode(FIELD_LABELS[k] + (k === "headline" ? "" : " — optional")), counter);
    const i = el("input"); i.type = "text"; i.id = "ch-" + k; i.value = S.fields[k] || ""; i.autocomplete = "off"; i.maxLength = 200;
    const upd = () => { S.fields[k] = i.value; counter.textContent = i.value.length + "/" + CHANNEL_LIMITS[k]; counter.classList.toggle("over", i.value.length > CHANNEL_LIMITS[k]); };
    i.oninput = upd; upd();
    f.append(lab, i);
    if (k === "offer") f.appendChild(el("p", "hint", "Only a real, approved offer — drafting never writes it."));
    if (k === "headline") f.appendChild(el("p", "hint", "Line 1 is gold, line 2 is white (violet and ink on cream)."));
    box.appendChild(f);
  }
  const wrap = el("label", "drivechk"); const cb = el("input"); cb.type = "checkbox"; cb.checked = S.showProduct; cb.onchange = () => { S.showProduct = cb.checked; };
  wrap.append(cb, el("span", null, "Show the product in the image (when one is picked). Announcement and headline styles keep it small or leave it out on wide sizes."));
  box.appendChild(wrap);
}

function paintBg() {
  [...$("chBg").children].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.bg === S.bg.kind)));
  $("chPhoto").hidden = S.bg.kind !== "photo";
  if (S.bg.kind === "photo") loadScenes();
}
let scenesLoaded = false;
async function loadScenes() {
  if (scenesLoaded) return; scenesLoaded = true;
  const box = $("chScenes");
  try {
    const { scenes } = await api("/api/channels/scenes");
    if (!scenes.length) { box.appendChild(el("p", "hint", "No ad-set scenes yet.")); return; }
    for (const s of scenes) {
      const b = el("button"); b.type = "button"; b.title = (s.product || "") + " · " + (s.tplName || ""); b.setAttribute("aria-pressed", "false");
      const i = el("img"); i.src = s.url; i.alt = b.title; i.loading = "lazy"; b.appendChild(i);
      b.onclick = () => { S.bg = { kind: "photo", sceneRunId: s.runId }; $("chUpload").value = ""; [...box.children].forEach((c) => c.setAttribute("aria-pressed", String(c === b))); };
      box.appendChild(b);
    }
  } catch (e) { box.appendChild(el("p", "hint", "Couldn't load scenes: " + e.message)); scenesLoaded = false; }
}
function upload() {
  const file = $("chUpload").files[0]; if (!file) return;
  if (file.size > 12e6) { log("That photo is over 12 MB. Use a smaller one."); $("chUpload").value = ""; return; }
  const r = new FileReader();
  r.onload = () => { S.bg = { kind: "photo", upload: String(r.result).split(",")[1] }; [...$("chScenes").children].forEach((c) => c.setAttribute && c.setAttribute("aria-pressed", "false")); log("Background photo ready: " + file.name); };
  r.readAsDataURL(file);
}

// ---------- product ----------
async function search() {
  const q = $("chQ").value.trim(); if (!q) return;
  const box = $("chResults"); box.innerHTML = ""; log("Searching the catalog for “" + q + "”…");
  try {
    const { products } = await api("/api/products?q=" + encodeURIComponent(q));
    log(products.length ? "Found " + products.length + " product" + (products.length === 1 ? "" : "s") + "." : "No active products matched “" + q + "”.");
    for (const n of products) {
      const btn = el("button", "prod" + (n.url ? " withthumb" : "")); btn.type = "button"; btn.disabled = !n.url; btn.setAttribute("aria-pressed", "false");
      if (n.url) { const t = el("img", "thumb"); t.src = n.url + (n.url.includes("?") ? "&" : "?") + "width=120"; t.alt = ""; btn.appendChild(t); }
      const left = el("span"); left.append(el("b", null, n.title), el("span", "m", n.sku || "")); btn.appendChild(left);
      btn.onclick = () => {
        [...box.children].forEach((c) => c.setAttribute("aria-pressed", "false")); btn.setAttribute("aria-pressed", "true");
        const v = (n.variants || [])[0] || {};
        setPicked({ url: (v.image && v.image.url) || n.url, title: n.title, desc: n.desc, sku: v.sku || n.sku || "", variantTitle: v.title || "", images: n.images || [] });
      };
      box.appendChild(btn);
    }
  } catch (e) { log("Catalog search didn't work: " + e.message); }
}
function setPicked(p) {
  S.picked = p;
  const box = $("chPicked"); box.innerHTML = ""; box.hidden = !p;
  if (!p) return;
  box.append(el("b", null, "Using: "), document.createTextNode(p.title + (p.variantTitle && p.variantTitle !== "Default Title" ? " — " + p.variantTitle : "")));
  if (p.images && p.images.length > 1) {
    box.appendChild(el("div", "hint", "Use this photo:"));
    const row = el("div", "imgpick");
    for (const im of p.images) {
      const b = el("button"); b.type = "button"; b.setAttribute("aria-pressed", String(im.url === p.url));
      const i = el("img"); i.src = im.url + (im.url.includes("?") ? "&" : "?") + "width=160"; i.alt = im.alt || "Product photo"; b.appendChild(i);
      b.onclick = () => { p.url = im.url; setPicked(p); };
      row.appendChild(b);
    }
    box.appendChild(row);
  }
  const clear = el("button", "linkbtn", "Remove product"); clear.type = "button"; clear.style.marginTop = "8px"; clear.onclick = () => { setPicked(null); [...$("chResults").children].forEach((c) => c.setAttribute("aria-pressed", "false")); };
  box.appendChild(el("div")).appendChild(clear);
}

// ---------- draft ----------
async function draft() {
  const btn = $("chDraft"); btn.disabled = true; btn.textContent = "Writing…";
  try {
    const r = await api("/api/channels/draft", { method: "POST", body: { channel: S.channel, style: S.style, picked: S.picked, angle: $("chAngle").value, current: S.fields } });
    for (const k of CHANNEL_FIELDS) if (k !== "offer" && typeof r.draft[k] === "string") S.fields[k] = r.draft[k];
    S.extra = { channel: S.channel, ...r.draft };
    paintFields(); paintExtra();
    log(r.violations.length ? "Drafted. Kept out unsupported claims: " + r.violations.map((v) => FIELD_LABELS[v.field] || v.field).join(", ") + " — " + r.violations.map((v) => v.reason).join("; ") + "." : "Drafted from the product listing. Edit anything before creating images.");
  } catch (e) { log("Drafting didn't work: " + e.message); }
  finally { btn.disabled = false; btn.textContent = "Write it for me"; }
}
function paintExtra() {
  const box = $("chCopyOut"); if (!box) return; box.innerHTML = "";
  const x = S.extra; if (!x || x.channel !== S.channel) { box.hidden = true; return; }
  const rows = S.channel === "social" ? [["Caption", [x.caption, x.hashtags].filter(Boolean).join("\n\n")], ["Alt text", x.alt]]
    : S.channel === "email" ? [["Subject line", x.subject], ["Preheader", x.preheader], ["Alt text", x.alt]] : [["Alt text", x.alt]];
  box.appendChild(el("h3", null, "Copy to paste")).style.cssText = "font-size:14px;margin-bottom:8px";
  for (const [label, text] of rows) {
    if (!text) continue;
    const r = el("div", "row"); r.append(el("b", null, label), el("p", null, text));
    const c = el("button", "btn-quiet", "Copy"); c.type = "button"; c.onclick = async () => { try { await navigator.clipboard.writeText(text); c.textContent = "Copied"; setTimeout(() => (c.textContent = "Copy"), 1500); } catch { c.textContent = "Select and copy"; } };
    r.appendChild(c); box.appendChild(r);
  }
  box.hidden = false;
}

// ---------- create ----------
function log(t) { const l = $("chLog"); if (l) l.textContent = t; }
async function create() {
  if (S.busy) return;
  const bad = checkChannelFields(S.fields, { style: S.style });
  if (!S.formats.size) bad.unshift({ message: "Pick at least one size." });
  if (S.bg.kind === "photo" && !S.bg.sceneRunId && !S.bg.upload) bad.push({ message: "Upload a background photo or pick a scene." });
  if (bad.length) { log(bad.map((b) => b.message).join(" ")); return; }
  const ids = CHANNELS[S.channel].formats.map((f) => f.id).filter((id) => S.formats.has(id));
  S.busy = true; const version = ++S.version; const go = $("chGo"); go.disabled = true; go.textContent = "Creating…";
  log("Laying out " + ids.length + " size" + (ids.length === 1 ? "" : "s") + (S.picked && S.showProduct ? " — removing the product background first (first time for a photo takes up to a minute)…" : "…"));
  try {
    const r = await api("/api/channels/render", { method: "POST", body: {
      channel: S.channel, style: S.style, formats: ids, fields: S.fields, showProduct: S.showProduct,
      background: S.bg, picked: S.picked ? { url: S.picked.url, title: S.picked.title } : null,
    } });
    if (version !== S.version) return;
    S.set = r.set; paintSet();
  } catch (e) { log("Couldn't create the images: " + e.message); }
  finally { S.busy = false; go.disabled = false; go.textContent = "Create images (free)"; }
}

function paintSet() {
  const set = S.set, g = $("chGallery"); g.innerHTML = "";
  const ready = set.files.filter((f) => f.ready).length;
  log(ready === set.files.length ? `All ${ready} images are ready to download.` : `${ready} of ${set.files.length} images ready. The rest show what to fix.`);
  // Cutout approval, shared with the ad builder.
  const cut = $("chCut"); cut.innerHTML = "";
  const c = set.cutout;
  if (c && c.state === "failed") cut.appendChild(el("div", "err", "The product background couldn't be removed: " + (c.error || "unknown error") + ". Try another photo or untick “Show the product”."));
  else if (c && !c.approved) {
    const p = el("div", "cutpanel");
    p.appendChild(el("b", null, "Check the product cutout once"));
    p.appendChild(el("p", "hint", "Compare it with the original photo: every part of the product should be there and the background gone. Approving here also approves it for the ad builder."));
    const pair = el("div", "pair");
    for (const [src, cap] of [[c.photo, "Original"], [c.image, "Cutout"]]) { const fg = el("figure"); const i = el("img"); i.src = src; i.alt = cap; fg.appendChild(i); pair.appendChild(fg); }
    p.appendChild(pair);
    const b = el("button", "btn-gold", "Approve cutout"); b.type = "button";
    b.onclick = async () => {
      b.disabled = true;
      try { await api("/api/cutouts/" + c.sha + "/approve", { method: "POST", body: { confirm: true, revision: c.revision } }); S.set = (await api("/api/channels/" + set.id)).set; paintSet(); }
      catch (e) { b.disabled = false; log("Couldn't approve the cutout: " + e.message); }
    };
    p.appendChild(b); cut.appendChild(p);
  }
  const zr = $("chZipRow"); zr.innerHTML = ""; zr.hidden = !ready;
  if (ready) { const a = el("a", "btn-gold", `Download ${ready} ready file${ready === 1 ? "" : "s"} (zip)`); a.href = "/api/channels/" + set.id + "/zip"; a.style.textDecoration = "none"; zr.appendChild(a); }
  for (const f of set.files) {
    const it = el("div", "gitem"), im = el("div", "img"), i = el("img"); i.src = f.url; i.alt = f.title; im.appendChild(i);
    const meta = el("div", "meta"), left = el("span");
    left.append(el("b", null, f.title + " "), el("span", "dims", f.W + "×" + f.H + " · " + Math.round(f.bytes / 1000) + " KB"));
    const right = el("span"); right.style.cssText = "display:flex;gap:8px;align-items:center";
    right.appendChild(el("span", "pill " + (f.ready ? "ok" : "held"), f.ready ? "Ready" : "Held"));
    if (f.ready) { const a = el("a", "btn-quiet", "Download"); a.href = f.url + "?dl=1"; a.style.textDecoration = "none"; right.appendChild(a); }
    meta.append(left, right); it.append(im, meta);
    if (f.reasons.length) it.appendChild(el("div", "probs", f.reasons.join(" ")));
    g.appendChild(it);
  }
  paintExtra();
}

// Reopen the tab the person last used. This must run last: build() needs every declaration above.
if (recall("hl-tool") === "channels" || location.hash === "#social") showTool("channels");

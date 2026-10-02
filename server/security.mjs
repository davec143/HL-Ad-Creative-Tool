// Authentication and request-hardening helpers.
//   Sessions     signed, expiring session cookies with a server-side session list (logout revokes)
//   LoginLimiter brute-force limiter (per client and global), counted before the password check
//   originOk     Origin / Fetch-Metadata check for state-changing requests (CSRF)
//   checkImageUrl strict validation of product image URLs
import crypto from "node:crypto";

export const MIN_SECRET = 32;
const b64 = (s) => Buffer.from(s).toString("base64url");

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(/;\s*/)) {
    if (!part) continue;
    const i = part.indexOf("=");
    if (i < 1) continue;
    let v = part.slice(i + 1);
    try { v = decodeURIComponent(v); } catch { continue; } // malformed: ignore (-> 401), never 500
    out[part.slice(0, i)] = v;
  }
  return out;
}

export class Sessions {
  constructor({ store, secret, ttlMs = 7 * 24 * 3600 * 1000, now = () => Date.now() }) {
    this.store = store; this.secret = secret; this.ttl = ttlMs; this.now = now;
  }
  sign(payload) { return payload + "." + crypto.createHmac("sha256", this.secret).update(payload).digest("base64url"); }
  list() { return this.store.getState("sessions", {}); }
  create() {
    const sid = crypto.randomBytes(18).toString("base64url"), iat = this.now(), exp = iat + this.ttl;
    const all = this.list();
    for (const [k, v] of Object.entries(all)) if (!v || v.exp < iat) delete all[k]; // prune
    all[sid] = { iat, exp };
    this.store.setState("sessions", all);
    return { token: this.sign(b64(JSON.stringify({ sid, iat, exp }))), sid, exp };
  }
  // Returns {sid, iat, exp} for a valid, unexpired, unrevoked token; otherwise null. Never throws.
  verify(token) {
    try {
      const t = String(token || ""), i = t.lastIndexOf(".");
      if (i < 1 || t.length > 1000) return null;
      const payload = t.slice(0, i);
      const a = Buffer.from(this.sign(payload)), b = Buffer.from(t);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
      const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (!p || typeof p.sid !== "string" || typeof p.exp !== "number" || p.exp <= this.now()) return null;
      const s = this.list()[p.sid];
      if (!s || s.exp <= this.now()) return null;
      return p;
    } catch { return null; }
  }
  revoke(sid) { const all = this.list(); if (all[sid]) { delete all[sid]; this.store.setState("sessions", all); } }
}

// Counts an attempt synchronously BEFORE the (async) password check, so a burst of parallel
// requests can't slip past the limit. A success clears that client's counter.
export class LoginLimiter {
  constructor({ perClient = 8, global = 40, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
    Object.assign(this, { perClient, global, windowMs, now }); this.hits = new Map(); this.all = [];
  }
  prune(arr) { const cut = this.now() - this.windowMs; while (arr.length && arr[0] < cut) arr.shift(); return arr; }
  take(client) {
    const mine = this.prune(this.hits.get(client) || []);
    this.prune(this.all);
    if (mine.length >= this.perClient || this.all.length >= this.global) {
      return { ok: false, retryAfter: Math.ceil(((mine[0] || this.all[0] || this.now()) + this.windowMs - this.now()) / 1000) };
    }
    mine.push(this.now()); this.all.push(this.now()); this.hits.set(client, mine);
    return { ok: true };
  }
  success(client) { this.hits.delete(client); }
}

// CSRF defence for state-changing requests: the Origin must be this app; without an Origin header
// the browser's Fetch Metadata must say same-origin. Anything else is refused.
export function originOk(req, publicOrigin) {
  const origin = req.headers.origin;
  if (origin) return origin === publicOrigin;
  const site = req.headers["sec-fetch-site"];
  return site === "same-origin";
}

// Product image URLs: https only, no embedded credentials, sane length. Classified as Shopify
// (catalog CDN or the store) or external (pasted by a person).
export function checkImageUrl(raw, { shopifyStore } = {}) {
  const s = String(raw || "").trim();
  if (!s) return { ok: false, error: "No image URL." };
  if (s.length > 2048) return { ok: false, error: "That image URL is too long." };
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: "That isn't a valid URL." }; }
  if (u.protocol !== "https:") return { ok: false, error: "The image URL must start with https://." };
  if (u.username || u.password) return { ok: false, error: "Image URLs with a username or password aren't allowed." };
  if (!u.hostname.includes(".")) return { ok: false, error: "That image host isn't allowed." };
  const h = u.hostname.toLowerCase();
  const shopify = h === "cdn.shopify.com" || h.endsWith(".myshopify.com") || (shopifyStore && h === shopifyStore.toLowerCase());
  return { ok: true, url: u.toString(), source: shopify ? "shopify" : "external" };
}

export function securityHeaders(res, { https, reference = false }) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  // Scripts only from this app. Inline styles are allowed because the v16 markup uses style
  // attributes; no inline scripts anywhere.
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'", reference ? "script-src 'none'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https://cdn.shopify.com", "connect-src 'self'",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join("; "));
  if (https) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

// Keep an exact copy of the product photo a set was made from (for the fidelity check and audit).
// Fetching a URL a person pasted is an SSRF risk, so: https only, every resolved address must be
// public, redirects are followed manually (max 3) and re-checked, image content types only, 15 MB cap.
import dns from "node:dns/promises";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import { checkImageUrl } from "./security.mjs";

const MAX = 15 * 1024 * 1024;

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

export async function assertPublicHost(hostname, lookup = dns.lookup) {
  if (net.isIP(hostname)) { if (isPrivateAddress(hostname)) throw new Error("private address"); return; }
  const addrs = await lookup(hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("host resolves to a private address");
}

// Returns {file, sha256, bytes, contentType}.
export async function fetchSourceImage(url, dest, { fetchImpl = fetch, lookup = dns.lookup, shopifyStore } = {}) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const chk = checkImageUrl(current, { shopifyStore });
    if (!chk.ok) throw new Error(chk.error);
    const u = new URL(chk.url);
    await assertPublicHost(u.hostname, lookup);
    const res = await fetchImpl(u, { redirect: "manual", signal: AbortSignal.timeout(30000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { current = new URL(res.headers.get("location"), u).toString(); continue; }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const ct = String(res.headers.get("content-type") || "");
    if (!/^image\//i.test(ct)) throw new Error("not an image (" + ct.slice(0, 40) + ")");
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX) throw new Error("image is larger than 15 MB");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX) throw new Error("image is larger than 15 MB");
    fs.writeFileSync(dest, buf);
    return { file: dest, sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length, contentType: ct.split(";")[0] };
  }
  throw new Error("too many redirects");
}

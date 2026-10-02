// Google Drive delivery with a service account (no user sign-in). Share the destination folder
// (e.g. "Claude + Higgsfield Ad Creatives") with the service account's email as Editor.
// Each set gets a sub-folder "YYYY-MM-DD Product" and only clean files are uploaded (as v16).
import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export class Drive {
  constructor({ serviceAccountJson, parentId, fetchImpl = fetch }) {
    this.parent = parentId; this.fetch = fetchImpl; this.token = null;
    this.sa = null;
    if (serviceAccountJson) {
      try { this.sa = JSON.parse(serviceAccountJson); } catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON isn't valid JSON."); }
      if (!this.sa.client_email || !this.sa.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON needs client_email and private_key.");
    }
  }
  get enabled() { return !!(this.sa && this.parent); }
  get email() { return this.sa && this.sa.client_email; }

  jwt(now = Math.floor(Date.now() / 1000)) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const head = b64({ alg: "RS256", typ: "JWT" });
    const claim = b64({ iss: this.sa.client_email, scope: "https://www.googleapis.com/auth/drive", aud: TOKEN_URL, iat: now, exp: now + 3600 });
    const sig = crypto.createSign("RSA-SHA256").update(head + "." + claim).sign(this.sa.private_key).toString("base64url");
    return head + "." + claim + "." + sig;
  }
  async accessToken() {
    if (this.token && this.token.exp > Date.now() + 60000) return this.token.value;
    const res = await this.fetch(TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: this.jwt() }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error("Google sign-in for Drive failed (HTTP " + res.status + "). Check the service account key.");
    const j = await res.json();
    this.token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return this.token.value;
  }
  async api(url, init) {
    const res = await this.fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: "Bearer " + await this.accessToken() }, signal: AbortSignal.timeout(60000) });
    if (res.status === 404) throw new Error("Drive folder not found, or not shared with " + this.email + ".");
    if (res.status === 403) throw new Error("Drive refused: share the folder with " + this.email + " as Editor.");
    if (!res.ok) throw new Error("Drive returned HTTP " + res.status + ": " + (await res.text()).slice(0, 200));
    return res.json();
  }
  // Look up an existing file/folder by exact name under a parent (lookup-before-create, and
  // reconciling an upload whose outcome is unknown after a crash).
  async findByName(parentId, name, folder = false, { createdAfter } = {}) {
    const q = [`name = '${String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`, `'${parentId}' in parents`, "trashed = false", folder ? "mimeType = 'application/vnd.google-apps.folder'" : "mimeType != 'application/vnd.google-apps.folder'"]
      .concat(createdAfter ? [`createdTime > '${new Date(createdAfter).toISOString()}'`] : []).join(" and ");
    const j = await this.api(API + "?supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=2&fields=files(id,webViewLink)&q=" + encodeURIComponent(q), { method: "GET" });
    const f = (j.files || [])[0];
    return f ? { id: f.id, url: f.webViewLink || (folder ? "https://drive.google.com/drive/folders/" + f.id : "") } : null;
  }

  async createFolder(name) {
    const j = await this.api(API + "?supportsAllDrives=true&fields=id,webViewLink", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [this.parent] }),
    });
    return { id: j.id, url: j.webViewLink || "https://drive.google.com/drive/folders/" + j.id };
  }
  async uploadJpeg(folderId, name, bytes) {
    const boundary = "hl" + crypto.randomBytes(8).toString("hex");
    const meta = JSON.stringify({ name, parents: [folderId], mimeType: "image/jpeg" });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--`),
    ]);
    const j = await this.api(UPLOAD + "?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink", {
      method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body,
    });
    return { id: j.id, url: j.webViewLink || "" };
  }
}

// Shopify catalog search through the Admin GraphQL API (custom-app token, read_products +
// read_inventory). Same search rules as v16: active products only; every title word must match,
// or a single token may also match a SKU.

export function buildSearchQuery(q) {
  const terms = String(q || "").replace(/["'()*:\\]/g, " ").split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  let sq = "(" + terms.map((t) => "title:*" + t + "*").join(" AND ") + ")";
  if (terms.length === 1) sq = "(" + sq + " OR sku:*" + terms[0] + "*)";
  return "status:active AND " + sq; // archived and draft listings can't take ad traffic
}

// Validated against the Shopify Admin schema (no deprecated fields). Scopes used: read_products,
// read_inventory (inventoryQuantity / inventoryItem.tracked).
const QUERY = `query Search($q: String!, $n: Int!) {
  products(first: $n, query: $q, sortKey: RELEVANCE) {
    edges { node {
      id title handle description status totalInventory tracksInventory hasOnlyDefaultVariant
      featuredMedia { preview { image { url width height altText } } }
      media(first: 10) { edges { node { id mediaContentType preview { image { url width height altText } } } } }
      variants(first: 50) { edges { node {
        id title sku price availableForSale inventoryQuantity inventoryPolicy
        inventoryItem { tracked }
        media(first: 1) { edges { node { preview { image { url width height altText } } } } }
      } } }
    } }
  }
}`;

// Stock for one variant: in_stock | out_of_stock | unknown | not_tracked.
export function variantStock(v) {
  if (v.inventoryItem && v.inventoryItem.tracked === false) return "not_tracked";
  if (typeof v.inventoryQuantity !== "number") return "unknown";
  return v.inventoryQuantity > 0 ? "in_stock" : "out_of_stock";
}

// Flatten one GraphQL product node into what the page needs.
export function toProduct(n) {
  n = n || {};
  const img = (m) => m && m.preview && m.preview.image;
  const featured = img(n.featuredMedia);
  const images = [];
  const seen = new Set();
  for (const e of (n.media && n.media.edges) || []) {
    const i = img(e.node);
    if (e.node && e.node.mediaContentType === "IMAGE" && i && i.url && !seen.has(i.url)) { seen.add(i.url); images.push({ url: i.url, width: i.width, height: i.height, alt: i.altText || "" }); }
  }
  // The featured image always comes first (it is the default pick, as in v16).
  if (featured && featured.url) {
    const i = images.findIndex((x) => x.url === featured.url);
    const f = i > -1 ? images.splice(i, 1)[0] : { url: featured.url, width: featured.width, height: featured.height, alt: featured.altText || "" };
    images.unshift(f);
  }
  const variants = ((n.variants && n.variants.edges) || []).map((e) => e.node || {}).map((v) => {
    const vi = v.media && v.media.edges && v.media.edges[0] && img(v.media.edges[0].node);
    return {
      id: v.id || "", title: v.title || "", sku: v.sku || "", price: v.price || "",
      inventory: typeof v.inventoryQuantity === "number" ? v.inventoryQuantity : null,
      stock: variantStock(v), availableForSale: v.availableForSale !== false,
      oversell: v.inventoryPolicy === "CONTINUE",
      image: vi && vi.url ? { url: vi.url, alt: vi.altText || "" } : null,
    };
  });
  const first = variants[0] || {};
  return {
    id: n.id || "", title: n.title || "Untitled", handle: n.handle || "", desc: n.description || "", status: n.status || "",
    url: (first.image && first.image.url) || (featured && featured.url) || (images[0] && images[0].url) || "", images,
    variants, singleVariant: !!n.hasOnlyDefaultVariant || variants.length <= 1,
    // Product-level total, kept for display only; decisions use the selected variant's stock.
    inventory: typeof n.totalInventory === "number" ? n.totalInventory : null,
    sku: first.sku || "", price: first.price || "", stock: first.stock || "unknown",
  };
}

export class Shopify {
  constructor({ store, token, apiVersion, fetchImpl = fetch }) {
    this.store = store; this.token = token; this.apiVersion = apiVersion; this.fetch = fetchImpl;
  }
  get enabled() { return !!(this.store && this.token); }
  async search(q, n = 8) {
    if (!this.enabled) throw Object.assign(new Error("Shopify isn't configured. Paste an image URL instead."), { code: "not_configured" });
    const query = buildSearchQuery(q);
    if (!query) return [];
    const res = await this.fetch(`https://${this.store}/admin/api/${this.apiVersion}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": this.token },
      body: JSON.stringify({ query: QUERY, variables: { q: query, n } }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error("Shopify rejected the access token. Check SHOPIFY_ADMIN_TOKEN and its read_products / read_inventory scopes."), { code: "auth" });
    if (!res.ok) throw Object.assign(new Error("Shopify returned HTTP " + res.status), { code: "upstream" });
    const body = await res.json();
    if (body.errors && body.errors.length) throw Object.assign(new Error("Shopify: " + (body.errors[0].message || JSON.stringify(body.errors[0]))), { code: "upstream" });
    const edges = (body.data && body.data.products && body.data.products.edges) || [];
    // Active-only is enforced in the search query and checked again here.
    return edges.map((e) => e.node).filter((n) => !n.status || n.status === "ACTIVE").map(toProduct);
  }
}

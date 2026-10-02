// Shopify contract tests (mocked responses shaped like the validated Admin GraphQL query) and the
// drafting fact guard.
import test from "node:test";
import assert from "node:assert/strict";
import { Shopify, toProduct, variantStock } from "../server/providers/shopify.mjs";
import { factViolations, guardDraft } from "../core/facts.mjs";
import { Pipeline } from "../server/pipeline.mjs";

const img = (url) => ({ preview: { image: { url, width: 800, height: 800, altText: "" } } });
const variant = (o) => ({ id: "gid://shopify/ProductVariant/" + o.n, title: o.title, sku: o.sku, price: o.price, availableForSale: o.qty !== 0, inventoryQuantity: o.qty, inventoryPolicy: o.policy || "DENY", inventoryItem: { tracked: o.tracked !== false }, media: { edges: o.img ? [{ node: img(o.img) }] : [] } });
const STRIP = {
  id: "gid://shopify/Product/9", title: "LED Strip 16ft", description: "UL listed 24V strip, 3000K, 5-year warranty.", status: "ACTIVE", totalInventory: 40, hasOnlyDefaultVariant: false,
  featuredMedia: img("https://cdn.shopify.com/feat.jpg"),
  media: { edges: [{ node: { mediaContentType: "IMAGE", ...img("https://cdn.shopify.com/feat.jpg") } }, { node: { mediaContentType: "IMAGE", ...img("https://cdn.shopify.com/2700k.jpg") } }] },
  variants: { edges: [
    { node: variant({ n: 1, title: "2700K", sku: "STR-27", price: "49.99", qty: 0, img: "https://cdn.shopify.com/2700k.jpg" }) },
    { node: variant({ n: 2, title: "3000K", sku: "STR-30", price: "49.99", qty: 40 }) },
    { node: variant({ n: 3, title: "5000K", sku: "STR-50", price: "52.00", qty: null, tracked: false }) },
    { node: variant({ n: 4, title: "6500K", sku: "STR-65", price: "52.00", qty: 0, policy: "CONTINUE" }) },
  ] },
};

test("multi-variant product: each variant carries its own SKU, price, stock and image", () => {
  const p = toProduct(STRIP);
  assert.equal(p.singleVariant, false);
  assert.deepEqual(p.variants.map((v) => [v.title, v.sku, v.price, v.stock]), [["2700K", "STR-27", "49.99", "out_of_stock"], ["3000K", "STR-30", "49.99", "in_stock"], ["5000K", "STR-50", "52.00", "not_tracked"], ["6500K", "STR-65", "52.00", "out_of_stock"]]);
  assert.equal(p.variants[0].image.url, "https://cdn.shopify.com/2700k.jpg");
  assert.equal(p.variants[1].image, null, "no variant image: falls back to the product's");
  assert.equal(p.variants[3].oversell, true);
  assert.equal(p.inventory, 40, "product total is display-only; the sold-out 2700K is still out of stock");
});

test("stock states: in stock, out of stock, unknown, not tracked", () => {
  assert.equal(variantStock({ inventoryQuantity: 3, inventoryItem: { tracked: true } }), "in_stock");
  assert.equal(variantStock({ inventoryQuantity: 0, inventoryItem: { tracked: true } }), "out_of_stock");
  assert.equal(variantStock({ inventoryQuantity: -2 }), "out_of_stock");
  assert.equal(variantStock({ inventoryQuantity: null, inventoryItem: { tracked: true } }), "unknown");
  assert.equal(variantStock({}), "unknown");
  assert.equal(variantStock({ inventoryQuantity: 5, inventoryItem: { tracked: false } }), "not_tracked");
});

test("missing images: no media at all gives an empty url (the page disables it)", () => {
  const p = toProduct({ id: "x", title: "Bare", status: "ACTIVE", variants: { edges: [{ node: variant({ n: 1, title: "Default Title", sku: "B", price: "1", qty: 1 }) }] } });
  assert.equal(p.url, ""); assert.deepEqual(p.images, []); assert.equal(p.singleVariant, true);
});

test("search keeps only active products and sends the validated query", async () => {
  let body;
  const s = new Shopify({ store: "hitlights.myshopify.com", token: "t", apiVersion: "2025-10", fetchImpl: async (u, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [{ node: STRIP }, { node: { ...STRIP, id: "draft", status: "DRAFT" } }] } } }) }; } });
  const out = await s.search("strip");
  assert.deepEqual(out.map((p) => p.id), ["gid://shopify/Product/9"]);
  assert.match(body.query, /inventoryItem \{ tracked \}/); assert.doesNotMatch(body.query, /(^|\n)\s*image \{/, "no deprecated variant.image");
  assert.match(body.variables.q, /^status:active AND /);
});

test("the selected variant, image, SKU, price and stock are frozen into the set", () => {
  const P = new Pipeline({ cfg: { creditsPerRender: 2 }, store: { saveRun() {}, creditsForRun: () => ({ committed: 0, reserved: 0, spent: 0, released: 0 }) }, renderer: {}, log: { error() {} } });
  const run = P.create({ form: { tpl: "t1", h1: "A", h2: "B", cta: "Shop now" }, picked: { url: "https://cdn.shopify.com/2700k.jpg", source: "shopify", title: "LED Strip 16ft", productId: "gid://shopify/Product/9", variantId: "gid://shopify/ProductVariant/1", variantTitle: "2700K", sku: "STR-27", price: "49.99", stock: "out_of_stock", outOfStock: true } });
  assert.deepEqual(run.S.source, { imageUrl: "https://cdn.shopify.com/2700k.jpg", imageSource: "shopify", productId: "gid://shopify/Product/9", variantId: "gid://shopify/ProductVariant/1", variantTitle: "2700K", sku: "STR-27", price: "49.99", stock: "out_of_stock" });
  assert.equal(run.S.outOfStock, true);
});

test("fact guard: invented figures, prices, percentages, certifications and offers are kept out", () => {
  const src = "LED Strip 16ft\nUL listed 24V strip, 3000K, 5-year warranty.";
  assert.deepEqual(factViolations({ p1: "UL listed", p2: "5-year warranty", h1: "24V. 3000K." }, src), []);
  const v = factViolations({ p1: "60,000-hour life", p2: "ETL certified", p3: "$49 today", h1: "20% OFF", cta: "Save now" }, src);
  const by = (f) => v.filter((x) => x.field === f).map((x) => x.reason).join(" | ");
  assert.match(by("p1"), /60000/); assert.match(by("p2"), /ETL/); assert.match(by("p3"), /price/); assert.match(by("h1"), /percentage/); assert.match(by("cta"), /save/);
  const before = { h1: "OLD", p1: "Old proof", p2: "", p3: "", cta: "Shop", h2: "", sub: "", scene: "s" };
  const g = guardDraft(before, { ...before, h1: "BRIGHTER.", p1: "100,000 hours" }, src);
  assert.equal(g.form.h1, "BRIGHTER."); assert.equal(g.form.p1, "Old proof", "violating field keeps its previous value");
  assert.equal(g.violations.length, 1);
});
